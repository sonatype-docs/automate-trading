import { PipelineBatchJobSchema } from "@/compute/job-schemas";
import { z } from "zod";

export type PipelineBatchInput = z.infer<typeof PipelineBatchJobSchema>;

export interface BatchComboResult {
  strategyPresetId: string;
  execPresetId: string;
  ok: boolean;
  inserted: number;
  tradesInRun: number;
  error: string | null;
  elapsedMs: number;
}

export interface BatchResult {
  results: BatchComboResult[];
  bars: number;
  dataMs: number;
  totalMs: number;
}

/** Worker-safe pipeline batch engine. It has no TanStack server-function
 * imports, so it can be bundled into the ECS compute worker. */
export async function runComboBatchCore(data: PipelineBatchInput): Promise<BatchResult> {
  const startedAll = Date.now();
  const { supabaseAdmin: supabase } = await import("@/lib/db-admin.server");
  const [
    { loadRawCandles },
    { enrichCandles },
    { DEFAULT_CONFIG },
    { runStrategy },
    { runExecution },
    { STRATEGY_PRESETS },
    { EXEC_PRESETS, withRiskUsd },
    { recordToRow },
    { toTradeRecord },
  ] = await Promise.all([
    import("@/lib/market-data/loader.server"),
    import("@/lib/market-data/enrich"),
    import("@/lib/market-data/types"),
    import("@/lib/strategy-engine/engine"),
    import("@/lib/execution-engine/engine"),
    import("@/lib/strategy-engine/presets"),
    import("@/lib/execution-engine/presets"),
    import("@/lib/trade-intelligence/mapper"),
    import("@/lib/trade-intelligence/recorder"),
  ]);

  const dataStart = Date.now();
  const { candles } = await loadRawCandles({
    source: data.source,
    symbol: data.symbol,
    timeframe: data.timeframe as never,
    fromMs: data.fromMs,
    toMs: data.toMs,
  });
  const enriched = enrichCandles(candles, {
    ...DEFAULT_CONFIG,
    symbol: data.symbol,
    timeframe: data.timeframe as never,
    displayTimezone: data.displayTimezone as never,
    strategyTimezone: data.strategyTimezone as never,
  });
  const dataMs = Date.now() - dataStart;
  const strategyCache = new Map<string, ReturnType<typeof runStrategy>>();
  const results: BatchComboResult[] = [];
  const targetTable = data.snapshotName ? "trade_intelligence_archive" : "trade_intelligence";
  const onConflict = data.snapshotName ? "snapshot_name,trade_id" : "trade_id";
  const CHUNK = 500;

  for (const combo of data.combos) {
    const startedCombo = Date.now();
    try {
      const scfg = STRATEGY_PRESETS[combo.strategyPresetId as keyof typeof STRATEGY_PRESETS];
      if (!scfg) throw new Error(`Unknown strategy preset: ${combo.strategyPresetId}`);
      const baseEcfg = EXEC_PRESETS[combo.execPresetId as keyof typeof EXEC_PRESETS];
      if (!baseEcfg) throw new Error(`Unknown execution preset: ${combo.execPresetId}`);
      const ecfg = data.riskUsdOverride != null ? withRiskUsd(baseEcfg, data.riskUsdOverride) : baseEcfg;
      let sres = strategyCache.get(combo.strategyPresetId);
      if (!sres) {
        sres = runStrategy(enriched, scfg, { mode: "historical", symbol: data.symbol });
        strategyCache.set(combo.strategyPresetId, sres);
      }
      const eres = runExecution(enriched, sres.signals, ecfg, { symbol: data.symbol });
      const signalsById = new Map(sres.signals.map((s) => [s.signalId, s]));
      const records = eres.trades.map((t) => toTradeRecord(t, {
        strategyId: combo.strategyPresetId,
        strategyVersion: "1",
        symbol: data.symbol,
        timeframe: data.timeframe,
        bars: enriched,
        signalsById,
        extraTags: data.tags ?? [],
      }));
      for (const r of records) {
        const ts = r.signalTime ?? r.entryTime;
        r.tradeId = `ti_${combo.strategyPresetId}_${combo.execPresetId}_${r.symbol}_${r.timeframe ?? "na"}_${data.strategyTimezone}_${r.direction}_${ts}`;
      }
      let inserted = 0;
      if (records.length > 0) {
        const rows = records.map(recordToRow);
        if (data.snapshotName) for (const row of rows as Record<string, unknown>[]) row.snapshot_name = data.snapshotName;
        for (let i = 0; i < rows.length; i += CHUNK) {
          const slice = rows.slice(i, i + CHUNK);
          const { error, count } = await supabase.from(targetTable).upsert(slice as never, { onConflict, count: "exact" });
          if (error) throw new Error(error.message);
          inserted += count ?? slice.length;
        }
      }
      results.push({ strategyPresetId: combo.strategyPresetId, execPresetId: combo.execPresetId, ok: true, inserted, tradesInRun: eres.trades.length, error: null, elapsedMs: Date.now() - startedCombo });
    } catch (e) {
      results.push({ strategyPresetId: combo.strategyPresetId, execPresetId: combo.execPresetId, ok: false, inserted: 0, tradesInRun: 0, error: e instanceof Error ? e.message : String(e), elapsedMs: Date.now() - startedCombo });
    }
  }
  return { results, bars: enriched.length, dataMs, totalMs: Date.now() - startedAll };
}
