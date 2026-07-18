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
  /** When set, insert into trade_intelligence_archive under this snapshot
   *  (surfaces as a separate Dataset in the UI). When omitted, writes to
   *  the live trade_intelligence table. */
  snapshotName: z.string().min(1).max(120).optional(),
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
    // duplicating. Identity = strategy + exec + symbol + tf + tz + direction +
    // signal/entry timestamp. TZ is included so multi-timezone matrix runs
    // don't overwrite each other under (snapshot_name, trade_id).
    for (const r of records) {
      const ts = r.signalTime ?? r.entryTime;
      r.tradeId = `ti_${data.strategyPresetId}_${data.execPresetId}_${r.symbol}_${r.timeframe ?? "na"}_${data.strategyTimezone}_${r.direction}_${ts}`;
    }

    if (records.length === 0) {
      return { inserted: 0, tradesInRun: 0, skipped: 0 };
    }
    const rows = records.map(recordToRow);
    const targetTable = data.snapshotName ? "trade_intelligence_archive" : "trade_intelligence";
    const onConflict = data.snapshotName ? "snapshot_name,trade_id" : "trade_id";
    if (data.snapshotName) {
      for (const row of rows as Record<string, unknown>[]) row.snapshot_name = data.snapshotName;
    }
    // Chunk upserts — a single 10k-row request can time out or exceed
    // PostgREST's payload cap. 500/chunk keeps every request well within limits.
    const CHUNK = 500;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error, count } = await supabase
        .from(targetTable)
        .upsert(slice as any, { onConflict, count: "exact" });
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
  /** "live" = trade_intelligence (default); otherwise a snapshot label in the archive. */
  dataset: z.string().optional(),
});

function resolveTable(dataset?: string): { table: string; snapshotName?: string } {
  if (!dataset || dataset === "live") return { table: "trade_intelligence" };
  return { table: "trade_intelligence_archive", snapshotName: dataset };
}

export const queryTrades = createServerFn({ method: "POST" })

  .inputValidator((raw) => QueryInput.parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin: supabase } = await import("@/integrations/supabase/client.server");
    const { applyQuery } = await import("./trade-intelligence/query");
    const { rowToRecord } = await import("./trade-intelligence/mapper");
    const spec = data as TradeQuerySpec;
    const { table, snapshotName } = resolveTable(data.dataset);
    const requestedLimit = Math.min(spec.limit ?? 100, 20000);
    const baseOffset = spec.offset ?? 0;
    const CHUNK = 1000; // PostgREST default max_rows cap
    const allRows: Record<string, unknown>[] = [];
    let total = 0;
    for (let fetched = 0; fetched < requestedLimit; fetched += CHUNK) {
      const remaining = requestedLimit - fetched;
      const chunkSize = Math.min(CHUNK, remaining);
      const q = applyQuery(supabase, table, {
        ...spec,
        snapshotName,
        limit: chunkSize,
        offset: baseOffset + fetched,
      });
      const { data: rows, error } = await q;
      if (error) {
        // When a dataset is actively being appended, PostgREST can briefly
        // reject a later page with 416 even though earlier pages loaded. Also
        // deep-offset scans on large snapshots can hit Postgres's
        // statement_timeout (57014). In both cases, keep the already-loaded
        // rows instead of blanking the whole Research view.
        const msg = error.message || "";
        if (
          error.code === "PGRST103" ||
          error.code === "57014" ||
          /range not satisfiable/i.test(msg) ||
          /statement timeout/i.test(msg)
        ) break;
        throw new Error(msg);
      }
      if (!rows || rows.length === 0) break;
      allRows.push(...(rows as Record<string, unknown>[]));
      if (rows.length < chunkSize) break;
    }
    return {
      rows: allRows.map((r) => rowToRecord(r)),
      total: allRows.length,
    };
  });

export const exportTrades = createServerFn({ method: "POST" })

  .inputValidator((raw) => QueryInput.extend({ format: z.enum(["json", "csv"]) }).parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin: supabase } = await import("@/integrations/supabase/client.server");
    const { applyQuery } = await import("./trade-intelligence/query");
    const { exportRecords } = await import("./trade-intelligence/exporter");
    const { rowToRecord } = await import("./trade-intelligence/mapper");
    const { table, snapshotName } = resolveTable(data.dataset);
    const CHUNK = 1000;
    const MAX = 20000;
    const allRows: Record<string, unknown>[] = [];
    for (let offset = 0; offset < MAX; offset += CHUNK) {
      const spec: TradeQuerySpec & { snapshotName?: string } = { ...data, snapshotName, limit: CHUNK, offset };
      const q = applyQuery(supabase, table, spec);
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

/**
 * Remove exact-duplicate trades from the live table.
 * Group key: (strategy_id, symbol, timeframe, direction, entry_time, exit_time,
 * net_pnl, entry_price, exit_price). Keeps the lexicographically smallest
 * trade_id in each group; deletes the rest. Only runs on the live dataset —
 * archived snapshots are read-only.
 */
export const dedupeTrades = createServerFn({ method: "POST" })
  .inputValidator((raw) =>
    z.object({ dataset: z.string().optional() }).optional().parse(raw),
  )
  .handler(async ({ data }) => {
    if (data?.dataset && data.dataset !== "live") {
      throw new Error("Dedupe only runs on the live dataset.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = supabaseAdmin as any;

    const CHUNK = 1000;
    type Row = {
      trade_id: string;
      strategy_id: string;
      symbol: string;
      timeframe: string | null;
      direction: string;
      entry_time: string;
      exit_time: string;
      net_pnl: number | null;
      entry_price: number | null;
      exit_price: number | null;
    };
    const rows: Row[] = [];
    for (let offset = 0; ; offset += CHUNK) {
      const { data: chunk, error } = await supabase
        .from("trade_intelligence")
        .select("trade_id, strategy_id, symbol, timeframe, direction, entry_time, exit_time, net_pnl, entry_price, exit_price")
        .range(offset, offset + CHUNK - 1);
      if (error) throw new Error(error.message);
      if (!chunk || chunk.length === 0) break;
      rows.push(...(chunk as Row[]));
      if (chunk.length < CHUNK) break;
    }

    const groups = new Map<string, string[]>();
    for (const r of rows) {
      const key = [
        r.strategy_id, r.symbol, r.timeframe ?? "", r.direction,
        r.entry_time, r.exit_time,
        r.net_pnl ?? "", r.entry_price ?? "", r.exit_price ?? "",
      ].join("|");
      const arr = groups.get(key);
      if (arr) arr.push(r.trade_id);
      else groups.set(key, [r.trade_id]);
    }

    const toDelete: string[] = [];
    for (const ids of groups.values()) {
      if (ids.length < 2) continue;
      ids.sort();
      // keep ids[0], remove the rest
      for (let i = 1; i < ids.length; i++) toDelete.push(ids[i]);
    }

    if (toDelete.length === 0) {
      return { scanned: rows.length, duplicateGroups: 0, deleted: 0 };
    }

    let deleted = 0;
    const DEL_CHUNK = 200;
    for (let i = 0; i < toDelete.length; i += DEL_CHUNK) {
      const slice = toDelete.slice(i, i + DEL_CHUNK);
      const { error, count } = await supabase
        .from("trade_intelligence")
        .delete({ count: "exact" })
        .in("trade_id", slice);
      if (error) throw new Error(error.message);
      deleted += count ?? slice.length;
    }
    const duplicateGroups = Array.from(groups.values()).filter((a) => a.length > 1).length;
    return { scanned: rows.length, duplicateGroups, deleted };
  });

export const summariseTrades = createServerFn({ method: "POST" })

  .inputValidator((raw) => z.object({ dataset: z.string().optional() }).optional().parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = supabaseAdmin as any;
    const { table, snapshotName } = resolveTable(data?.dataset);
    // Chunked scan — PostgREST caps rows at 1000 per response.
    const CHUNK = 1000;
    const rows: { strategy_id: string; symbol: string; direction: string; net_pnl: number }[] = [];
    for (let offset = 0; ; offset += CHUNK) {
      let q = supabase
        .from(table)
        .select("strategy_id, symbol, direction, net_pnl")
        .range(offset, offset + CHUNK - 1);
      if (snapshotName) q = q.eq("snapshot_name", snapshotName);
      const { data: rowsChunk, error } = await q;
      if (error) throw new Error(error.message);
      if (!rowsChunk || rowsChunk.length === 0) break;
      rows.push(...(rowsChunk as typeof rows));
      if (rowsChunk.length < CHUNK) break;
    }
    const total = rows.length;
    const winners = rows.filter((r) => Number(r.net_pnl) > 0).length;
    const losers = rows.filter((r) => Number(r.net_pnl) < 0).length;
    const net = rows.reduce((s, r) => s + Number(r.net_pnl), 0);
    const strategies = Array.from(new Set(rows.map((r) => r.strategy_id)));
    const symbols = Array.from(new Set(rows.map((r) => r.symbol)));
    return { total, winners, losers, netPnl: net, strategies, symbols };
  });

export const listSnapshots = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = supabaseAdmin as any;
  const { data, error } = await supabase.rpc("list_trade_snapshots");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { name: string; count: number | string; last_updated: string | null }[];
  return {
    snapshots: rows
      .map((r) => ({
        name: r.name,
        count: Number(r.count) || 0,
        lastUpdated: r.last_updated ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
});

const PreviewInput = z.object({ name: z.string().min(1).max(120) });
export const getSnapshotPreview = createServerFn({ method: "POST" })
  .inputValidator((raw) => PreviewInput.parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = supabaseAdmin as any;
    const { count, error: cErr } = await supabase
      .from("trade_intelligence_archive")
      .select("trade_id", { count: "exact", head: true })
      .eq("snapshot_name", data.name);
    if (cErr) throw new Error(cErr.message);
    const { data: latest, error: lErr } = await supabase
      .from("trade_intelligence_archive")
      .select("updated_at, created_at, exit_time")
      .eq("snapshot_name", data.name)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (lErr) throw new Error(lErr.message);
    // Sample recent rows to summarise strategies/symbols without scanning all.
    const { data: sample, error: sErr } = await supabase
      .from("trade_intelligence_archive")
      .select("strategy_id, symbol, timeframe")
      .eq("snapshot_name", data.name)
      .order("updated_at", { ascending: false })
      .limit(500);
    if (sErr) throw new Error(sErr.message);
    const rows = (sample ?? []) as { strategy_id: string; symbol: string; timeframe: string | null }[];
    const strategies = Array.from(new Set(rows.map((r) => r.strategy_id))).slice(0, 12);
    const symbols = Array.from(new Set(rows.map((r) => r.symbol))).slice(0, 12);
    const timeframes = Array.from(new Set(rows.map((r) => r.timeframe ?? "—"))).slice(0, 12);
    const first = (latest?.[0] ?? null) as { updated_at: string | null; created_at: string | null; exit_time: string | null } | null;
    return {
      name: data.name,
      count: count ?? 0,
      lastUpdated: first?.updated_at ?? null,
      createdAt: first?.created_at ?? null,
      lastExitTime: first?.exit_time ?? null,
      strategies, symbols, timeframes,
    };
  });

const DeleteInput = z.object({ name: z.string().min(1).max(120) });
export const deleteSnapshot = createServerFn({ method: "POST" })
  .inputValidator((raw) => DeleteInput.parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = supabaseAdmin as any;
    const { error, count } = await supabase
      .from("trade_intelligence_archive")
      .delete({ count: "exact" })
      .eq("snapshot_name", data.name);
    if (error) throw new Error(error.message);
    return { deleted: count ?? 0 };
  });

const RenameInput = z.object({
  from: z.string().min(1).max(120),
  to: z.string().min(1).max(120).regex(/^[A-Za-z0-9_\-.: ]+$/, "Only letters, numbers, spaces and _-.: allowed"),
});
export const renameSnapshot = createServerFn({ method: "POST" })
  .inputValidator((raw) => RenameInput.parse(raw))
  .handler(async ({ data }) => {
    if (data.from === data.to) return { updated: 0 };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = supabaseAdmin as any;
    const { data: existing, error: existErr } = await supabase
      .from("trade_intelligence_archive")
      .select("snapshot_name")
      .eq("snapshot_name", data.to)
      .limit(1);
    if (existErr) throw new Error(existErr.message);
    if (existing && existing.length > 0) throw new Error(`Dataset "${data.to}" already exists`);
    const { error, count } = await supabase
      .from("trade_intelligence_archive")
      .update({ snapshot_name: data.to }, { count: "exact" })
      .eq("snapshot_name", data.from);
    if (error) throw new Error(error.message);
    return { updated: count ?? 0 };
  });


