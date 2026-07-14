// Trade Intelligence — server functions.
// - recordTradesFromExecution: rerun strategy+execution, record all trades
// - queryTrades: filtered query with pagination
// - deleteTrade / clearStrategy: cleanup helpers
// - exportTrades: return CSV/JSON body for download
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
// admin client loaded inside handlers (project uses admin-only server access)
import { TIMEFRAMES, TIMEZONES, type Timeframe, type Timezone } from "@/lib/market-data/types";
import type { TradeQuerySpec, TradeRecord } from "./trade-intelligence/types";

const RunAndRecordInput = z.object({
  source: z.enum(["yahoo", "shark"]).default("yahoo"),
  symbol: z.string().default("XAUUSDT"),
  timeframe: z.enum([...TIMEFRAMES] as [Timeframe, ...Timeframe[]]).default("15m"),
  displayTimezone: z.enum([...TIMEZONES] as [Timezone, ...Timezone[]]).default("IST"),
  strategyTimezone: z.enum([...TIMEZONES] as [Timezone, ...Timezone[]]).default("London"),
  fromMs: z.number(),
  toMs: z.number(),
  strategyPresetId: z.string(),
  execPresetId: z.string(),
  tags: z.array(z.string()).optional(),
});

function recordToRow(r: TradeRecord) {
  return {
    trade_id: r.tradeId,
    strategy_id: r.strategyId,
    strategy_version: r.strategyVersion,
    symbol: r.symbol,
    timeframe: r.timeframe,
    direction: r.direction,
    trade_type: r.tradeType,
    entry_type: r.entryType,
    stop_type: r.stopType,
    target_type: r.targetType,
    status: r.status,
    session: r.session,
    signal_time: r.signalTime ? new Date(r.signalTime).toISOString() : null,
    order_time: r.orderTime ? new Date(r.orderTime).toISOString() : null,
    fill_time: r.fillTime ? new Date(r.fillTime).toISOString() : null,
    entry_time: new Date(r.entryTime).toISOString(),
    exit_time: new Date(r.exitTime).toISOString(),
    weekday: r.weekday, week_number: r.weekNumber, month: r.month,
    quarter: r.quarter, year: r.year,
    entry_price: r.entryPrice, fill_price: r.fillPrice, exit_price: r.exitPrice,
    stop_price: r.stopPrice, target_price: r.targetPrice,
    position_size: r.positionSize, risk_usd: r.riskUsd, risk_pct: r.riskPct,
    actual_rr: r.actualRr, gross_pnl: r.grossPnl, net_pnl: r.netPnl,
    pnl_pct: r.pnlPct, pnl_r: r.pnlR, mae: r.mae, mfe: r.mfe,
    fees: r.fees, commission: r.commission, slippage: r.slippage,
    spread_cost: r.spreadCost,
    holding_bars: r.holdingBars, duration_ms: r.durationMs, exit_reason: r.exitReason,
    price: r.price, risk: r.risk, performance: r.performance, duration: r.duration,
    volatility: r.volatility, trend: r.trend, structure: r.structure,
    liquidity: r.liquidity, smart_money: r.smartMoney, volume_profile: r.volumeProfile,
    breakout: r.breakout, entry_quality: r.entryQuality, stop: r.stop, target: r.target,
    filters: r.filters, news: r.news, regime: r.regime, custom: r.custom,
    tags: r.tags, raw: r.raw,
  };
}

function rowToRecord(row: Record<string, unknown>): TradeRecord {
  const toMs = (v: unknown) => (v ? new Date(String(v)).getTime() : null);
  return {
    tradeId: String(row.trade_id),
    strategyId: String(row.strategy_id),
    strategyVersion: row.strategy_version as string | null,
    symbol: String(row.symbol),
    timeframe: row.timeframe as string | null,
    direction: row.direction as "long" | "short",
    tradeType: row.trade_type as string | null,
    entryType: row.entry_type as string | null,
    stopType: row.stop_type as string | null,
    targetType: row.target_type as string | null,
    status: row.status as "closed" | "open" | "cancelled",
    session: row.session as string | null,
    signalTime: toMs(row.signal_time),
    orderTime: toMs(row.order_time),
    fillTime: toMs(row.fill_time),
    entryTime: toMs(row.entry_time) ?? 0,
    exitTime: toMs(row.exit_time) ?? 0,
    weekday: row.weekday as number | null,
    weekNumber: row.week_number as number | null,
    month: row.month as number | null,
    quarter: row.quarter as number | null,
    year: row.year as number | null,
    entryPrice: Number(row.entry_price),
    fillPrice: row.fill_price as number | null,
    exitPrice: Number(row.exit_price),
    stopPrice: row.stop_price as number | null,
    targetPrice: row.target_price as number | null,
    positionSize: row.position_size as number | null,
    riskUsd: row.risk_usd as number | null,
    riskPct: row.risk_pct as number | null,
    actualRr: row.actual_rr as number | null,
    grossPnl: row.gross_pnl as number | null,
    netPnl: Number(row.net_pnl),
    pnlPct: row.pnl_pct as number | null,
    pnlR: row.pnl_r as number | null,
    mae: row.mae as number | null,
    mfe: row.mfe as number | null,
    fees: row.fees as number | null,
    commission: row.commission as number | null,
    slippage: row.slippage as number | null,
    spreadCost: row.spread_cost as number | null,
    holdingBars: row.holding_bars as number | null,
    durationMs: row.duration_ms as number | null,
    exitReason: row.exit_reason as string | null,
    price: (row.price ?? {}) as Record<string, unknown>,
    risk: (row.risk ?? {}) as Record<string, unknown>,
    performance: (row.performance ?? {}) as Record<string, unknown>,
    duration: (row.duration ?? {}) as Record<string, unknown>,
    volatility: (row.volatility ?? {}) as Record<string, unknown>,
    trend: (row.trend ?? {}) as Record<string, unknown>,
    structure: (row.structure ?? {}) as Record<string, unknown>,
    liquidity: (row.liquidity ?? {}) as Record<string, unknown>,
    smartMoney: (row.smart_money ?? {}) as Record<string, unknown>,
    volumeProfile: (row.volume_profile ?? {}) as Record<string, unknown>,
    breakout: (row.breakout ?? {}) as Record<string, unknown>,
    entryQuality: (row.entry_quality ?? {}) as Record<string, unknown>,
    stop: (row.stop ?? {}) as Record<string, unknown>,
    target: (row.target ?? {}) as Record<string, unknown>,
    filters: (row.filters ?? {}) as Record<string, unknown>,
    news: (row.news ?? {}) as Record<string, unknown>,
    regime: (row.regime ?? {}) as Record<string, unknown>,
    custom: (row.custom ?? {}) as Record<string, unknown>,
    tags: (row.tags ?? []) as string[],
    raw: (row.raw ?? {}) as Record<string, unknown>,
  };
}

export const recordTradesFromExecution = createServerFn({ method: "POST" })

  .inputValidator((raw) => RunAndRecordInput.parse(raw))
  .handler(async ({ data, context }) => {
    const [{ loadRawCandles }, { enrichCandles }, { DEFAULT_CONFIG }, { runStrategy }, { runExecution }, { STRATEGY_PRESETS }, { EXEC_PRESETS }, { toTradeRecord }] =
      await Promise.all([
        import("@/lib/market-data/loader.server"),
        import("@/lib/market-data/enrich"),
        import("@/lib/market-data/types"),
        import("@/lib/strategy-engine/engine"),
        import("@/lib/execution-engine/engine"),
        import("@/lib/strategy-engine/presets"),
        import("@/lib/execution-engine/presets"),
        import("./trade-intelligence/recorder"),
      ]);

    const scfg = STRATEGY_PRESETS[data.strategyPresetId as keyof typeof STRATEGY_PRESETS];
    if (!scfg) throw new Error(`Unknown strategy preset: ${data.strategyPresetId}`);
    const ecfg = EXEC_PRESETS[data.execPresetId as keyof typeof EXEC_PRESETS];
    if (!ecfg) throw new Error(`Unknown execution preset: ${data.execPresetId}`);

    const { candles } = await loadRawCandles({
      source: data.source, symbol: data.symbol, timeframe: data.timeframe,
      fromMs: data.fromMs, toMs: data.toMs,
    });
    const enriched = enrichCandles(candles, {
      ...DEFAULT_CONFIG,
      symbol: data.symbol, timeframe: data.timeframe,
      displayTimezone: data.displayTimezone, strategyTimezone: data.strategyTimezone,
    });
    const sres = runStrategy(enriched, scfg, { mode: "historical", symbol: data.symbol });
    const eres = runExecution(enriched, sres.signals, ecfg, { symbol: data.symbol });

    const signalsById = new Map(sres.signals.map((s) => [s.signalId, s]));
    const records = eres.trades.map((t) =>
      toTradeRecord(t, {
        strategyId: data.strategyPresetId,
        strategyVersion: "1",
        symbol: data.symbol,
        timeframe: data.timeframe,
        bars: enriched,
        signalsById,
        extraTags: data.tags ?? [],
      }),
    );
    if (records.length === 0) {
      return { inserted: 0, tradesInRun: 0, skipped: 0 };
    }
    const rows = records.map(recordToRow);
    // Upsert on trade_id so re-runs are idempotent.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error, count } = await supabase
      .from("trade_intelligence")
      .upsert(rows as any, { onConflict: "trade_id", count: "exact" });

    if (error) throw new Error(error.message);
    return { inserted: count ?? rows.length, tradesInRun: eres.trades.length, skipped: 0 };
  });

const QueryInput = z.object({
  strategyId: z.string().optional(),
  symbol: z.string().optional(),
  direction: z.enum(["long", "short"]).optional(),
  session: z.string().optional(),
  weekday: z.number().int().min(0).max(6).optional(),
  fromMs: z.number().optional(),
  toMs: z.number().optional(),
  minNetPnl: z.number().optional(),
  maxNetPnl: z.number().optional(),
  winnersOnly: z.boolean().optional(),
  losersOnly: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  customContains: z.record(z.string(), z.unknown()).optional(),
  filtersContains: z.record(z.string(), z.unknown()).optional(),
  orderBy: z.enum(["entry_time", "exit_time", "net_pnl", "actual_rr"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  limit: z.number().int().positive().max(1000).optional(),
  offset: z.number().int().min(0).optional(),
});

export const queryTrades = createServerFn({ method: "POST" })

  .inputValidator((raw) => QueryInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { applyQuery } = await import("./trade-intelligence/query");
    const spec = data as TradeQuerySpec;
    const q = applyQuery(supabase, "trade_intelligence", spec);
    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);
    return {
      rows: (rows ?? []).map((r) => rowToRecord(r as Record<string, unknown>)),
      total: count ?? 0,
    };
  });

export const exportTrades = createServerFn({ method: "POST" })

  .inputValidator((raw) => QueryInput.extend({ format: z.enum(["json", "csv"]) }).parse(raw))
  .handler(async ({ data, context }) => {
    const { applyQuery } = await import("./trade-intelligence/query");
    const { exportRecords } = await import("./trade-intelligence/exporter");
    const spec: TradeQuerySpec = { ...data, limit: 1000 };
    const q = applyQuery(supabase, "trade_intelligence", spec);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const records = (rows ?? []).map((r) => rowToRecord(r as Record<string, unknown>));
    return exportRecords(records, data.format);
  });

export const deleteTrade = createServerFn({ method: "POST" })

  .inputValidator((raw) => z.object({ tradeId: z.string() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { error } = await supabase
      .from("trade_intelligence").delete().eq("trade_id", data.tradeId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const clearStrategy = createServerFn({ method: "POST" })

  .inputValidator((raw) => z.object({ strategyId: z.string() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { error, count } = await supabase
      .from("trade_intelligence").delete({ count: "exact" }).eq("strategy_id", data.strategyId);
    if (error) throw new Error(error.message);
    return { deleted: count ?? 0 };
  });

export const summariseTrades = createServerFn({ method: "POST" })

  .handler(async ({ context }) => {
    const { data, error } = await supabase
      .from("trade_intelligence")
      .select("strategy_id, symbol, direction, net_pnl");
    if (error) throw new Error(error.message);
    const total = data.length;
    const winners = data.filter((r) => Number(r.net_pnl) > 0).length;
    const losers = data.filter((r) => Number(r.net_pnl) < 0).length;
    const net = data.reduce((s, r) => s + Number(r.net_pnl), 0);
    const strategies = Array.from(new Set(data.map((r) => r.strategy_id)));
    const symbols = Array.from(new Set(data.map((r) => r.symbol)));
    return { total, winners, losers, netPnl: net, strategies, symbols };
  });
