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
  /** Fixed USD risk per trade. Applied by cloning the exec preset's sizing. */
  riskUsdOverride: z.number().positive().optional(),
});

// Mapping helpers live in ./trade-intelligence/mapper (client-safe, shared
// across every server-fn module and safe under the server-fn split transform).

export const recordTradesFromExecution = createServerFn({ method: "POST" })

  .inputValidator((raw) => RunAndRecordInput.parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin: supabase } = await import("@/integrations/supabase/client.server");
    const [{ loadRawCandles }, { enrichCandles }, { DEFAULT_CONFIG }, { runStrategy }, { runExecution }, { STRATEGY_PRESETS }, { EXEC_PRESETS, withRiskUsd }, { toTradeRecord }, { recordToRow }] =
      await Promise.all([
        import("@/lib/market-data/loader.server"),
        import("@/lib/market-data/enrich"),
        import("@/lib/market-data/types"),
        import("@/lib/strategy-engine/engine"),
        import("@/lib/execution-engine/engine"),
        import("@/lib/strategy-engine/presets"),
        import("@/lib/execution-engine/presets"),
        import("./trade-intelligence/recorder"),
        import("./trade-intelligence/mapper"),
      ]);

    const scfg = STRATEGY_PRESETS[data.strategyPresetId as keyof typeof STRATEGY_PRESETS];
    if (!scfg) throw new Error(`Unknown strategy preset: ${data.strategyPresetId}`);
    const baseEcfg = EXEC_PRESETS[data.execPresetId as keyof typeof EXEC_PRESETS];
    if (!baseEcfg) throw new Error(`Unknown execution preset: ${data.execPresetId}`);
    const ecfg = data.riskUsdOverride != null ? withRiskUsd(baseEcfg, data.riskUsdOverride) : baseEcfg;

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
    // Deterministic trade_id so re-runs UPSERT the same row instead of
    // duplicating. Identity = strategy + exec + symbol + tf + direction +
    // signal/entry timestamp. Any of these differ => different row.
    for (const r of records) {
      const ts = r.signalTime ?? r.entryTime;
      r.tradeId = `ti_${data.strategyPresetId}_${data.execPresetId}_${r.symbol}_${r.timeframe ?? "na"}_${r.direction}_${ts}`;
    }

    if (records.length === 0) {
      return { inserted: 0, tradesInRun: 0, skipped: 0 };
    }
    const rows = records.map(recordToRow);
    // Chunk upserts — a single 10k-row request can time out or exceed
    // PostgREST's payload cap. 500/chunk keeps every request well within limits.
    const CHUNK = 500;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error, count } = await supabase
        .from("trade_intelligence")
        .upsert(slice as any, { onConflict: "trade_id", count: "exact" });
      if (error) throw new Error(error.message);
      inserted += count ?? slice.length;
    }
    return { inserted, tradesInRun: eres.trades.length, skipped: 0 };
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
  limit: z.number().int().positive().max(100000).optional(),
  offset: z.number().int().min(0).optional(),
});

export const queryTrades = createServerFn({ method: "POST" })

  .inputValidator((raw) => QueryInput.parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin: supabase } = await import("@/integrations/supabase/client.server");
    const { applyQuery } = await import("./trade-intelligence/query");
    const { rowToRecord } = await import("./trade-intelligence/mapper");
    const spec = data as TradeQuerySpec;
    const requestedLimit = Math.min(spec.limit ?? 100, 20000);
    const baseOffset = spec.offset ?? 0;
    const CHUNK = 1000; // PostgREST default max_rows cap
    const allRows: Record<string, unknown>[] = [];
    let total = 0;
    for (let fetched = 0; fetched < requestedLimit; fetched += CHUNK) {
      const remaining = requestedLimit - fetched;
      const chunkSize = Math.min(CHUNK, remaining);
      const q = applyQuery(supabase, "trade_intelligence", {
        ...spec,
        limit: chunkSize,
        offset: baseOffset + fetched,
      });
      const { data: rows, error, count } = await q;
      if (error) throw new Error(error.message);
      total = count ?? total;
      if (!rows || rows.length === 0) break;
      allRows.push(...(rows as Record<string, unknown>[]));
      if (rows.length < chunkSize) break;
    }
    return {
      rows: allRows.map((r) => rowToRecord(r)),
      total,
    };
  });

export const exportTrades = createServerFn({ method: "POST" })

  .inputValidator((raw) => QueryInput.extend({ format: z.enum(["json", "csv"]) }).parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin: supabase } = await import("@/integrations/supabase/client.server");
    const { applyQuery } = await import("./trade-intelligence/query");
    const { exportRecords } = await import("./trade-intelligence/exporter");
    const { rowToRecord } = await import("./trade-intelligence/mapper");
    const CHUNK = 1000;
    const MAX = 20000;
    const allRows: Record<string, unknown>[] = [];
    for (let offset = 0; offset < MAX; offset += CHUNK) {
      const spec: TradeQuerySpec = { ...data, limit: CHUNK, offset };
      const q = applyQuery(supabase, "trade_intelligence", spec);
      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      if (!rows || rows.length === 0) break;
      allRows.push(...(rows as Record<string, unknown>[]));
      if (rows.length < CHUNK) break;
    }
    const records = allRows.map((r) => rowToRecord(r));
    return exportRecords(records, data.format);
  });

export const deleteTrade = createServerFn({ method: "POST" })

  .inputValidator((raw) => z.object({ tradeId: z.string() }).parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin: supabase } = await import("@/integrations/supabase/client.server");
    const { error } = await supabase
      .from("trade_intelligence").delete().eq("trade_id", data.tradeId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const clearStrategy = createServerFn({ method: "POST" })

  .inputValidator((raw) => z.object({ strategyId: z.string() }).parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin: supabase } = await import("@/integrations/supabase/client.server");
    const { error, count } = await supabase
      .from("trade_intelligence").delete({ count: "exact" }).eq("strategy_id", data.strategyId);
    if (error) throw new Error(error.message);
    return { deleted: count ?? 0 };
  });

export const summariseTrades = createServerFn({ method: "POST" })

  .handler(async () => {
    const { supabaseAdmin: supabase } = await import("@/integrations/supabase/client.server");
    // Chunked scan — PostgREST caps rows at 1000 per response.
    const CHUNK = 1000;
    const rows: { strategy_id: string; symbol: string; direction: string; net_pnl: number }[] = [];
    for (let offset = 0; ; offset += CHUNK) {
      const { data, error } = await supabase
        .from("trade_intelligence")
        .select("strategy_id, symbol, direction, net_pnl")
        .range(offset, offset + CHUNK - 1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      rows.push(...(data as typeof rows));
      if (data.length < CHUNK) break;
    }
    const total = rows.length;
    const winners = rows.filter((r) => Number(r.net_pnl) > 0).length;
    const losers = rows.filter((r) => Number(r.net_pnl) < 0).length;
    const net = rows.reduce((s, r) => s + Number(r.net_pnl), 0);
    const strategies = Array.from(new Set(rows.map((r) => r.strategy_id)));
    const symbols = Array.from(new Set(rows.map((r) => r.symbol)));
    return { total, winners, losers, netPnl: net, strategies, symbols };
  });
