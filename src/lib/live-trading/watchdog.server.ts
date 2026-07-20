// Hourly watchdog — for every RUNNING runner:
//   - If it placed ≥1 live_trade in the last hour → healthy, skip.
//   - Else if it's outside its trading window → skip (no entry expected).
//   - Else re-run the strategy in read-only mode. If NO candidate exists →
//     the strategy simply didn't fire; that's fine, skip.
//   - Else (candidate exists but nothing was placed) → this is the bug the
//     user cares about. Log a diagnosis to activity_log, clear the runner's
//     last_tick_error, and force a tickOne(r) retry. Log the retry outcome.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadRawCandles } from "@/lib/market-data/loader.server";
import { enrichCandles } from "@/lib/market-data/enrich";
import { DEFAULT_CONFIG, type Timeframe } from "@/lib/market-data/types";
import { runStrategy } from "@/lib/strategy-engine/engine";
import { runExecution } from "@/lib/execution-engine/engine";
import { STRATEGY_PRESETS } from "@/lib/strategy-engine/presets";
import { EXEC_PRESETS, withRiskUsd } from "@/lib/execution-engine/presets";
import type { KlineSourceId } from "@/lib/exchange/kline-source.server";
import { pickLiveEntryCandidate, tickOne, type RunnerRow } from "./tick.server";

export interface WatchdogReport {
  ok: boolean;
  checked: number;
  healthy: number;
  outOfWindow: number;
  noSignal: number;
  fixed: number;
  stillBroken: number;
  results: Array<{
    runner_id: string;
    label: string;
    verdict:
      | "healthy"
      | "out_of_window"
      | "no_signal"
      | "fixed"
      | "still_broken";
    reason?: string;
    placed?: number;
    error?: string;
  }>;
}

async function logDiagnosis(
  severity: "info" | "warning" | "error",
  message: string,
  context: Record<string, unknown>,
) {
  try {
    await supabaseAdmin.from("activity_log").insert({
      severity,
      message,
      context: context as never,
    });
  } catch {
    /* logging must never break the watchdog */
  }
}

export async function runLiveWatchdog(): Promise<WatchdogReport> {
  const { data: runners, error } = await supabaseAdmin
    .from("live_runners")
    .select(
      "id, label, source, symbol, timeframe, strategy_preset, exec_preset, risk_usd, lookback_days, leverage, direction_filter, window_start_hour_ist, window_end_hour_ist, weekdays_ist, last_tick_error",
    )
    .eq("running", true);
  if (error) throw new Error(error.message);

  const report: WatchdogReport = {
    ok: true,
    checked: 0,
    healthy: 0,
    outOfWindow: 0,
    noSignal: 0,
    fixed: 0,
    stillBroken: 0,
    results: [],
  };
  if (!runners?.length) return report;

  const { windowsForPreset, isWindowActive, minutesUntilOpen, isRunnerAllowedNow } =
    await import("@/lib/session-windows");
  const { isCalendarBlocked } = await import("@/lib/economic-calendar");

  const oneHourAgoIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  for (const rr of runners) {
    const r = rr as RunnerRow & { last_tick_error: string | null };
    report.checked += 1;

    // 1) Recent activity? Any live_trade row created in the last hour counts
    //    (placed / queued / errored — all mean the tick DID run and reach
    //    the DB). Zero rows means either no signal or a silent gap.
    const { count: recent } = await supabaseAdmin
      .from("live_trades")
      .select("id", { count: "exact", head: true })
      .eq("runner_id", r.id)
      .gte("created_at", oneHourAgoIso);
    if ((recent ?? 0) > 0) {
      report.healthy += 1;
      report.results.push({ runner_id: r.id, label: r.label, verdict: "healthy" });
      continue;
    }

    // 2) In-window check — mirrors the tick.
    const windows = windowsForPreset(r.strategy_preset);
    const inSessionWindow =
      windows.length === 0 ||
      windows.some((w) => isWindowActive(w) || minutesUntilOpen(w) <= 5);
    const inRunnerWindow = isRunnerAllowedNow({
      window_start_hour_ist: r.window_start_hour_ist,
      window_end_hour_ist: r.window_end_hour_ist,
      weekdays_ist: r.weekdays_ist,
    });
    const cal = isCalendarBlocked(r.symbol);
    if (!inSessionWindow || !inRunnerWindow || cal.blocked) {
      report.outOfWindow += 1;
      report.results.push({
        runner_id: r.id,
        label: r.label,
        verdict: "out_of_window",
        reason: !inSessionWindow
          ? "outside session window"
          : !inRunnerWindow
            ? "outside runner IST window / weekday"
            : `calendar block: ${cal.reason ?? "event"}`,
      });
      continue;
    }

    // 3) Re-run the strategy to see if there SHOULD have been an entry.
    let candidate: ReturnType<typeof pickLiveEntryCandidate> = null;
    try {
      const scfg = STRATEGY_PRESETS[r.strategy_preset];
      const baseE = EXEC_PRESETS[r.exec_preset];
      if (!scfg || !baseE) throw new Error("unknown preset");
      const ecfg = withRiskUsd(baseE, Number(r.risk_usd));
      const toMs = Date.now();
      const fromMs = toMs - Number(r.lookback_days) * 24 * 60 * 60 * 1000;
      const { candles } = await loadRawCandles({
        source: r.source as KlineSourceId,
        symbol: r.symbol,
        timeframe: r.timeframe as Timeframe,
        fromMs,
        toMs,
      });
      if (candles.length) {
        const enriched = enrichCandles(candles, {
          ...DEFAULT_CONFIG,
          symbol: r.symbol,
          timeframe: r.timeframe as Timeframe,
        });
        const sres = runStrategy(enriched, scfg, { mode: "live", symbol: r.symbol });
        const eres = runExecution(enriched, sres.signals, ecfg, { symbol: r.symbol });
        candidate = pickLiveEntryCandidate(
          r,
          sres,
          eres,
          enriched[enriched.length - 1]?.ts ?? Date.now(),
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logDiagnosis("error", `[watchdog] strategy re-run failed for ${r.label}`, {
        runner_id: r.id,
        error: msg,
      });
      report.stillBroken += 1;
      report.results.push({
        runner_id: r.id,
        label: r.label,
        verdict: "still_broken",
        error: msg,
      });
      continue;
    }

    if (!candidate) {
      report.noSignal += 1;
      report.results.push({ runner_id: r.id, label: r.label, verdict: "no_signal" });
      continue;
    }

    // 4) Candidate exists but nothing was placed in the last hour — repair.
    await logDiagnosis(
      "warning",
      `[watchdog] ${r.label} has a valid ${candidate.direction.toUpperCase()} candidate but placed 0 orders in the last hour — forcing tickOne()`,
      {
        runner_id: r.id,
        label: r.label,
        strategy: r.strategy_preset,
        symbol: r.symbol,
        candidate,
        last_tick_error: r.last_tick_error,
      },
    );

    // Clear any stale sticky error so the UI reflects the retry cleanly.
    if (r.last_tick_error) {
      await supabaseAdmin
        .from("live_runners")
        .update({ last_tick_error: null })
        .eq("id", r.id);
    }

    try {
      const res = await tickOne(r);
      const fixed = res.placed > 0;
      if (fixed) {
        report.fixed += 1;
        report.results.push({
          runner_id: r.id,
          label: r.label,
          verdict: "fixed",
          placed: res.placed,
        });
        await logDiagnosis("info", `[watchdog] repaired ${r.label} — placed ${res.placed}`, {
          runner_id: r.id,
          placed: res.placed,
        });
      } else {
        report.stillBroken += 1;
        report.results.push({
          runner_id: r.id,
          label: r.label,
          verdict: "still_broken",
          reason: "tickOne ran cleanly but placed 0 (likely symbol locked, queued, or dedup)",
        });
        await logDiagnosis(
          "warning",
          `[watchdog] ${r.label} still broken — tickOne placed 0`,
          { runner_id: r.id, reconciled: res.reconciled },
        );
      }
      await supabaseAdmin
        .from("live_runners")
        .update({ last_tick_at: new Date().toISOString() })
        .eq("id", r.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      report.stillBroken += 1;
      report.results.push({
        runner_id: r.id,
        label: r.label,
        verdict: "still_broken",
        error: msg,
      });
      await supabaseAdmin
        .from("live_runners")
        .update({ last_tick_error: msg })
        .eq("id", r.id);
      await logDiagnosis("error", `[watchdog] repair attempt threw for ${r.label}`, {
        runner_id: r.id,
        error: msg,
      });
    }
  }

  return report;
}
