// Client-callable server functions for the LIVE trading dashboard.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export interface LiveRunnerDTO {
  id: string;
  label: string;
  source: string;
  symbol: string;
  timeframe: string;
  strategy_preset: string;
  exec_preset: string;
  risk_usd: number;
  leverage: number;
  lookback_days: number;
  running: boolean;
  started_at: string | null;
  last_tick_at: string | null;
  last_tick_error: string | null;
}

export interface LiveTradeDTO {
  id: string;
  runner_id: string;
  client_order_id: string | null;
  symbol: string;
  timeframe: string;
  direction: string;
  qty: number;
  entry_ts: string;
  entry_price: number;
  fill_price: number | null;
  stop_price: number;
  target_price: number;
  exit_ts: string | null;
  exit_price: number | null;
  exit_reason: string | null;
  rr: number | null;
  net_pnl: number | null;
  status: string;
  error: string | null;
}

export const listLiveRunners = createServerFn({ method: "GET" }).handler(async (): Promise<LiveRunnerDTO[]> => {
  const s = await admin();
  const { data, error } = await s.from("live_runners").select("*").order("label");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as LiveRunnerDTO[];
});

export const listLiveTrades = createServerFn({ method: "GET" })
  .inputValidator((raw) => z.object({ limit: z.number().int().min(1).max(2000).default(500) }).parse(raw))
  .handler(async ({ data }): Promise<LiveTradeDTO[]> => {
    const s = await admin();
    const { data: rows, error } = await s
      .from("live_trades").select("*")
      .order("entry_ts", { ascending: false }).limit(data.limit);
    if (error) throw new Error(error.message);
    return (rows ?? []) as unknown as LiveTradeDTO[];
  });

export const setLiveRunnerRunning = createServerFn({ method: "POST" })
  .inputValidator((raw) => z.object({ id: z.string().uuid(), running: z.boolean() }).parse(raw))
  .handler(async ({ data }) => {
    const s = await admin();
    const patch = data.running
      ? { running: true, started_at: new Date().toISOString(), last_tick_error: null }
      : { running: false };
    const { error } = await s.from("live_runners").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateLiveRunner = createServerFn({ method: "POST" })
  .inputValidator((raw) =>
    z.object({
      id: z.string().uuid(),
      risk_usd: z.number().positive().max(10_000).optional(),
      leverage: z.number().int().min(1).max(125).optional(),
    }).parse(raw),
  )
  .handler(async ({ data }) => {
    const s = await admin();
    const patch: { risk_usd?: number; leverage?: number } = {};
    if (data.risk_usd != null) patch.risk_usd = data.risk_usd;
    if (data.leverage != null) patch.leverage = data.leverage;
    const { error } = await s.from("live_runners").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const testLiveConnection = createServerFn({ method: "POST" }).handler(async () => {
  const { createSharkClient } = await import("@/lib/exchange/shark-client.server");
  const client = createSharkClient();
  try {
    const r = await client.testConnection();
    return { ok: r.ok, status: r.status, message: r.message };
  } catch (e) {
    return { ok: false, status: 0, message: e instanceof Error ? e.message : String(e) };
  }
});

export const runLiveTickNow = createServerFn({ method: "POST" }).handler(async () => {
  const { runLiveTradingTick } = await import("@/lib/live-trading/tick.server");
  return await runLiveTradingTick();
});

export interface RuleCheckDTO {
  group: "session" | "trend" | "volatility" | "setup" | "entry" | "risk";
  label: string;
  requirement: string;
  actual: string;
  pass: boolean;
}

export interface RunnerDiagnosticsDTO {
  runner_id: string;
  label: string;
  symbol: string;
  timeframe: string;
  strategy_preset: string;
  running: boolean;
  windowActive: boolean;
  nextOpenMinutes: number | null;
  barsProcessed: number;
  setupsDetected: number;
  signalsCreated: number;
  signalsInvalidated: number;
  filterRejects: Array<{ label: string; count: number }>;
  rules: RuleCheckDTO[];
  lastBar: {
    ts: number;
    close: number;
    session: string;
    checks: Array<{ label: string; pass: boolean; reason?: string }>;
  } | null;
  pending: {
    direction: string;
    entryPrice: number;
    stop: number;
    target: number;
    ageBars: number;
  } | null;
  lastSignal: {
    ts: number;
    direction: string;
    type: string;
    entryPrice: number;
    stop: number;
    target: number;
    strength: number;
  } | null;
  error: string | null;
}

export const diagnoseLiveRunners = createServerFn({ method: "POST" }).handler(
  async (): Promise<RunnerDiagnosticsDTO[]> => {
    const s = await admin();
    const { data: runners, error } = await s
      .from("live_runners")
      .select("id, label, source, symbol, timeframe, strategy_preset, exec_preset, risk_usd, lookback_days, running")
      .order("label");
    if (error) throw new Error(error.message);

    const [
      { loadRawCandles },
      { enrichCandles },
      { DEFAULT_CONFIG },
      { runStrategy },
      { STRATEGY_PRESETS },
      { evalSessionFilter, evalTrendFilter, evalVolatilityFilter },
      { windowsForPreset, isWindowActive, minutesUntilOpen },
    ] = await Promise.all([
      import("@/lib/market-data/loader.server"),
      import("@/lib/market-data/enrich"),
      import("@/lib/market-data/types"),
      import("@/lib/strategy-engine/engine"),
      import("@/lib/strategy-engine/presets"),
      import("@/lib/strategy-engine/filters"),
      import("@/lib/session-windows"),
    ]);

    const out: RunnerDiagnosticsDTO[] = [];
    for (const r of runners ?? []) {
      const base: RunnerDiagnosticsDTO = {
        runner_id: r.id, label: r.label, symbol: r.symbol, timeframe: r.timeframe,
        strategy_preset: r.strategy_preset, running: r.running,
        windowActive: false, nextOpenMinutes: null,
        barsProcessed: 0, setupsDetected: 0, signalsCreated: 0, signalsInvalidated: 0,
        filterRejects: [], rules: [], lastBar: null, pending: null, lastSignal: null, error: null,
      };
      try {
        const windows = windowsForPreset(r.strategy_preset);
        base.windowActive = windows.length === 0 || windows.some(isWindowActive);
        if (!base.windowActive && windows.length > 0) {
          const m = windows.reduce<number>(
            (acc, w) => Math.min(acc, minutesUntilOpen(w)),
            Number.POSITIVE_INFINITY,
          );
          base.nextOpenMinutes = Number.isFinite(m) ? m : null;
        }

        const scfg = STRATEGY_PRESETS[r.strategy_preset as keyof typeof STRATEGY_PRESETS];
        if (!scfg) throw new Error(`Unknown strategy preset ${r.strategy_preset}`);

        const toMs = Date.now();
        const fromMs = toMs - Number(r.lookback_days) * 24 * 60 * 60 * 1000;
        const { candles } = await loadRawCandles({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          source: r.source as any,
          symbol: r.symbol,
          timeframe: r.timeframe as never,
          fromMs, toMs,
        });
        if (candles.length) {
          const enriched = enrichCandles(candles, {
            ...DEFAULT_CONFIG, symbol: r.symbol, timeframe: r.timeframe as never,
          });
          const sres = runStrategy(enriched, scfg, { mode: "live", symbol: r.symbol });
          base.barsProcessed = sres.stats.barsProcessed;
          base.setupsDetected = sres.stats.setupsDetected;
          base.signalsCreated = sres.stats.signalsCreated;
          base.signalsInvalidated = sres.stats.signalsInvalidated;
          base.filterRejects = Object.entries(sres.stats.filterRejects)
            .map(([label, count]) => ({ label, count: count as number }))
            .sort((a, b) => b.count - a.count).slice(0, 10);

          const last = enriched[enriched.length - 1];
          const prev = enriched[enriched.length - 2] ?? null;
          const idx = enriched.length - 1;
          const checks = [
            evalSessionFilter(last, scfg.session),
            evalTrendFilter(last, enriched, idx, scfg.trend),
            evalVolatilityFilter(last, prev, scfg.volatility),
          ].map((c) => ({ label: c.label, pass: c.pass, reason: c.reason }));
          base.lastBar = { ts: last.ts, close: last.close, session: last.session, checks };

          const ls = sres.signals[sres.signals.length - 1];
          if (ls) {
            base.lastSignal = {
              ts: ls.timestamp, direction: ls.direction, type: ls.type,
              entryPrice: ls.entryPrice, stop: ls.stopLoss, target: ls.takeProfit,
              strength: ls.signalStrength,
            };
          }
          const invIds = new Set(sres.invalidated.map((x) => x.signalId));
          const filledIds = new Set(
            sres.events.filter((e) => e.name === "OnTradeFilled").map((e) => e.data.signalId as string),
          );
          const pendingSig = [...sres.signals].reverse().find(
            (sig) => sig.type !== "BUY" && sig.type !== "SELL"
              && !invIds.has(sig.signalId) && !filledIds.has(sig.signalId),
          );
          if (pendingSig) {
            const detectedIdx = enriched.findIndex((b) => b.ts === pendingSig.timestamp);
            base.pending = {
              direction: pendingSig.direction, entryPrice: pendingSig.entryPrice,
              stop: pendingSig.stopLoss, target: pendingSig.takeProfit,
              ageBars: detectedIdx >= 0 ? enriched.length - 1 - detectedIdx : 0,
            };
          }
        }
      } catch (e) {
        base.error = e instanceof Error ? e.message : String(e);
      }
      out.push(base);
    }
    return out;
  },
);

export const cancelLiveOrder = createServerFn({ method: "POST" })
  .inputValidator((raw) => z.object({ trade_id: z.string().uuid() }).parse(raw))
  .handler(async ({ data }) => {
    const s = await admin();
    const { data: row, error } = await s.from("live_trades")
      .select("client_order_id").eq("id", data.trade_id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!row?.client_order_id) throw new Error("No exchange order id on this trade");
    const { createSharkClient } = await import("@/lib/exchange/shark-client.server");
    const client = createSharkClient();
    const res = await client.cancelOrder(row.client_order_id);
    await s.from("live_trades").update({
      status: "cancelled",
      exit_ts: new Date().toISOString(),
      exit_reason: "manual_cancel",
    }).eq("id", data.trade_id);
    return { ok: res.ok, status: res.status };
  });
