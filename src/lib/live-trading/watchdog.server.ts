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
  const thirtyMinAgoIso = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  // -1) SAFETY NET — every OPEN live_trade must have a broker-side stop on
  //     the exchange. Runs regardless of runner window. This exists because
  //     an entry placed before the stopLossPrice fix (or any manual entry)
  //     can end up naked on the exchange; if our tick loop stalls, the
  //     position rides all the way to liquidation.
  try {
    const { createSharkClient } = await import("@/lib/exchange/shark-client.server");
    const client = createSharkClient();
    const { data: openTrades } = await supabaseAdmin
      .from("live_trades")
      .select("id, runner_id, symbol, direction, qty, entry_price, stop_price, target_price, fill_ts, entry_ts, client_order_id, exit_client_order_id")
      .eq("status", "open");

    for (const t of openTrades ?? []) {
      const symbol = String(t.symbol);
      const stop = Number(t.stop_price);
      const qty = Number(t.qty);
      if (!(stop > 0) || !(qty > 0)) continue;

      // Does the exchange actually still hold this position?
      let hasPosition = false;
      try {
        const pos = await client.getOpenPositions(symbol);
        hasPosition = pos.some(
          (p) => p.symbol.toUpperCase() === symbol.toUpperCase() && p.qty > 0,
        );
      } catch {
        continue; // don't act on unreliable exchange state
      }
      if (!hasPosition) continue; // reconciler will close the DB row on next tick

      // Is there a reduce-only exit already resting on the book?
      let openOrdersForSym: Awaited<ReturnType<typeof client.getOpenOrders>> = [];
      try {
        openOrdersForSym = await client.getOpenOrders(symbol);
      } catch {
        continue;
      }
      const closeSideU = t.direction === "long" ? "SELL" : "BUY";
      const protective = openOrdersForSym.find(
        (o) =>
          (o.reduceOnly === true ||
            o.subType === "STOP_LOSS" ||
            o.subType === "TAKE_PROFIT") &&
          String(o.side).toUpperCase() === closeSideU,
      );
      if (protective) continue;

      // No broker-side protection. Emergency close if stop already breached,
      // otherwise attach a reduce-only limit at stop_price as a resting guard.
      let lastPrice = 0;
      try {
        lastPrice = await client.getLastPrice(symbol);
      } catch {
        /* ignore */
      }
      const stopBreached =
        lastPrice > 0 &&
        (t.direction === "long" ? lastPrice <= stop : lastPrice >= stop);

      const closeSideLower: "buy" | "sell" = t.direction === "long" ? "sell" : "buy";
      if (stopBreached) {
        try {
          const exitRes = await client.placeOrder({
            symbol,
            side: closeSideLower,
            qty,
            type: "market",
            reduceOnly: true,
          });
          await supabaseAdmin
            .from("live_trades")
            .update({ exit_client_order_id: exitRes.exchangeOrderId || null })
            .eq("id", t.id);
          await logDiagnosis(
            "error",
            `[watchdog][SAFETY] ${symbol} ${t.direction} was UNPROTECTED and price breached stop — emergency market close fired`,
            { trade_id: t.id, runner_id: t.runner_id, symbol, stop, lastPrice, qty },
          );
        } catch (e) {
          await logDiagnosis(
            "error",
            `[watchdog][SAFETY] emergency close FAILED for ${symbol} — position is naked and past stop`,
            { trade_id: t.id, symbol, error: e instanceof Error ? e.message : String(e) },
          );
        }
      } else {
        try {
          const exitRes = await client.placeOrder({
            symbol,
            side: closeSideLower,
            qty,
            type: "limit",
            price: stop,
            reduceOnly: true,
          });
          await supabaseAdmin
            .from("live_trades")
            .update({ exit_client_order_id: exitRes.exchangeOrderId || null })
            .eq("id", t.id);
          await logDiagnosis(
            "warning",
            `[watchdog][SAFETY] attached reduce-only stop-guard at ${stop} for ${symbol} ${t.direction} (was naked)`,
            { trade_id: t.id, runner_id: t.runner_id, symbol, stop, qty },
          );
        } catch (e) {
          await logDiagnosis(
            "error",
            `[watchdog][SAFETY] failed to attach stop-guard for ${symbol} — position remains unprotected`,
            { trade_id: t.id, symbol, stop, error: e instanceof Error ? e.message : String(e) },
          );
        }
      }
    }
  } catch (e) {
    await logDiagnosis("error", "[watchdog][SAFETY] protection pass threw", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // 0) Cross-runner sweep: any LIMIT that was placed to the exchange and got
  //    cancelled within 60s of placement — likely rejected by exchange (post-only
  //    trip, price crossed, or transient error). Repair by clearing the row and
  //    letting the next tick re-place.
  try {
    const { data: quickCancels } = await supabaseAdmin
      .from("live_trades")
      .select("id, runner_id, symbol, created_at, exit_ts, exit_reason, status")
      .gte("created_at", thirtyMinAgoIso)
      .eq("status", "closed")
      .not("exit_reason", "is", null);
    const suspects = (quickCancels ?? []).filter((t) => {
      const reason = String(t.exit_reason ?? "").toLowerCase();
      if (!reason.includes("cancel") && !reason.includes("reject")) return false;
      if (!t.exit_ts || !t.created_at) return false;
      const ageMs = new Date(t.exit_ts).getTime() - new Date(t.created_at).getTime();
      return ageMs >= 0 && ageMs <= 60_000;
    });
    if (suspects.length) {
      await logDiagnosis(
        "warning",
        `[watchdog] detected ${suspects.length} order(s) cancelled within 60s of placement — will retry via tickOne`,
        { suspects: suspects.map((s) => ({ id: s.id, runner_id: s.runner_id, symbol: s.symbol, exit_reason: s.exit_reason })) },
      );
    }
  } catch {
    /* non-fatal */
  }

  for (const rr of runners) {
    const r = rr as RunnerRow & { last_tick_error: string | null };
    report.checked += 1;

    // 1) Recent activity? Any live_trade row created in the last hour counts
    //    as healthy — UNLESS every one of them was cancelled within 60s of
    //    placement (exchange rejected / auto-cancelled). Those are the exact
    //    "order sent then immediately cancelled" cases the user asked to fix.
    const { data: recentTrades } = await supabaseAdmin
      .from("live_trades")
      .select("id, status, created_at, exit_ts, exit_reason")
      .eq("runner_id", r.id)
      .gte("created_at", oneHourAgoIso);
    const genuineActivity = (recentTrades ?? []).filter((t) => {
      const reason = String(t.exit_reason ?? "").toLowerCase();
      const isQuickCancel =
        t.status === "closed" &&
        (reason.includes("cancel") || reason.includes("reject")) &&
        t.exit_ts &&
        t.created_at &&
        new Date(t.exit_ts).getTime() - new Date(t.created_at).getTime() <= 60_000;
      return !isQuickCancel;
    });
    if (genuineActivity.length > 0) {
      report.healthy += 1;
      report.results.push({ runner_id: r.id, label: r.label, verdict: "healthy" });
      continue;
    }
    if ((recentTrades?.length ?? 0) > 0) {
      await logDiagnosis(
        "warning",
        `[watchdog] ${r.label} had ${recentTrades!.length} order(s) but all were cancelled within 60s — treating as broken and forcing repair`,
        { runner_id: r.id, quick_cancels: recentTrades!.length },
      );
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
            : `calendar block: ${cal.event?.name ?? "event"}`,
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

    let placed = 0;
    let lastErr: string | undefined;
    let repairSteps: string[] = [];
    try {
      const res1 = await tickOne(r);
      placed = res1.placed;

      // If first retry still placed nothing, aggressively clear known blockers
      // and try one more time — never leave the runner stuck.
      if (placed === 0) {
        const { createSharkClient } = await import("@/lib/exchange/shark-client.server");
        const client = createSharkClient();

        // A) Cancel every open exchange order for this symbol (stuck limits,
        //    orphan SL/TP children) so the symbol lock can release.
        try {
          const openOrders = await client.getOpenOrders(r.symbol);
          for (const o of openOrders) {
            if (o.clientOrderId) {
              await client.cancelOrder(o.clientOrderId).catch(() => undefined);
            }
          }
          repairSteps.push(`cancelled ${openOrders.length} exchange order(s)`);
        } catch (e) {
          repairSteps.push(`cancel-all failed: ${e instanceof Error ? e.message : String(e)}`);
        }

        // B) Force-close every stuck pending/queued live_trades row for this
        //    runner+symbol — they are the reason the symbol-lock check trips.
        //    Only touches THIS runner's rows to avoid closing another
        //    strategy's live position.
        const { data: stuck } = await supabaseAdmin
          .from("live_trades")
          .select("id, status")
          .eq("runner_id", r.id)
          .eq("symbol", r.symbol)
          .in("status", ["pending", "queued"]);
        for (const s of stuck ?? []) {
          await supabaseAdmin
            .from("live_trades")
            .update({
              status: "closed",
              exit_ts: new Date().toISOString(),
              exit_reason: `watchdog_cleared_${s.status}`,
            })
            .eq("id", s.id);
        }
        if ((stuck?.length ?? 0) > 0) {
          repairSteps.push(`cleared ${stuck!.length} stuck ${stuck![0].status} row(s)`);
        }

        // C) Retry tickOne now that blockers are gone.
        const res2 = await tickOne(r);
        placed = res2.placed;
      }

      if (placed > 0) {
        report.fixed += 1;
        report.results.push({
          runner_id: r.id,
          label: r.label,
          verdict: "fixed",
          placed,
          reason: repairSteps.join("; ") || "tickOne on first retry",
        });
        await logDiagnosis("info", `[watchdog] repaired ${r.label} — placed ${placed}`, {
          runner_id: r.id,
          placed,
          repairSteps,
        });
      } else {
        report.stillBroken += 1;
        report.results.push({
          runner_id: r.id,
          label: r.label,
          verdict: "still_broken",
          reason: `even after cleanup (${repairSteps.join("; ") || "none"}) tickOne placed 0 — candidate may have gone stale`,
        });
        await logDiagnosis(
          "warning",
          `[watchdog] ${r.label} still broken after auto-repair`,
          { runner_id: r.id, repairSteps },
        );
      }
      await supabaseAdmin
        .from("live_runners")
        .update({ last_tick_at: new Date().toISOString() })
        .eq("id", r.id);
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      report.stillBroken += 1;
      report.results.push({
        runner_id: r.id,
        label: r.label,
        verdict: "still_broken",
        error: lastErr,
        reason: repairSteps.join("; ") || undefined,
      });
      await supabaseAdmin
        .from("live_runners")
        .update({ last_tick_error: lastErr })
        .eq("id", r.id);
      await logDiagnosis("error", `[watchdog] repair attempt threw for ${r.label}`, {
        runner_id: r.id,
        error: lastErr,
        repairSteps,
      });
    }
  }

  return report;
}
