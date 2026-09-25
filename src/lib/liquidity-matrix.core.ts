import { z } from "zod";
import { LiquiditySweepConfigSchema, type LiquiditySweepConfig, ZONE_KINDS, CONFIRMATION_METHODS } from "./liquidity-lab/config";
import { toStrategyOverrides } from "./liquidity-lab/to-strategy-config";
import type { StrategyConfig } from "./strategy-engine/types";
import { simulateTrades, type LabTrade, type LabStats } from "./liquidity-lab/simulator";
import { TIMEFRAMES, type Timeframe } from "./market-data/types";

export const LAB_FILTER_KEYS = [
  "ema", "vwap", "adx", "atr", "volume", "rsi", "htfTrend", "structure", "premiumDiscount", "priorSweep",
] as const;
export type LabFilterKey = (typeof LAB_FILTER_KEYS)[number];

export const LiquidityMatrixJobSchema = z.object({
  baseConfig: LiquiditySweepConfigSchema,
  symbols: z.array(z.string()).min(1).max(20),
  timeframes: z.array(z.enum([...TIMEFRAMES] as [Timeframe, ...Timeframe[]])).min(1).max(14),
  zoneSets: z.array(z.array(z.enum(ZONE_KINDS)).min(1)).min(1).max(32),
  confirmationSets: z.array(z.array(z.enum(CONFIRMATION_METHODS)).min(1)).min(1).max(16),
  filterSets: z.array(z.array(z.enum(LAB_FILTER_KEYS))).min(1).max(24),
  sources: z.array(z.enum(["yahoo", "shark"])).min(1).max(2),
  daysBack: z.number().min(1).max(3650),
});

export interface MatrixRow {
  symbol: string;
  timeframe: Timeframe;
  zones: string[];
  source: "yahoo" | "shark";
  confirmation: string[];
  filters: string[];
  ok: boolean;
  error: string | null;
  bars: number;
  signals: number;
  stats: LabStats | null;
  trades: LabTrade[];
  elapsedMs: number;
}

export interface MatrixResult {
  rows: MatrixRow[];
  totalCombos: number;
  totalMs: number;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge<T>(base: T, overrides: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) continue;
    const cur = out[k];
    if (isPlainObject(cur) && isPlainObject(v)) out[k] = deepMerge(cur, v);
    else out[k] = v;
  }
  return out as T;
}

function applyFilterToggles(
  baseFilters: LiquiditySweepConfig["filters"],
  onKeys: readonly LabFilterKey[],
): LiquiditySweepConfig["filters"] {
  const on = new Set<string>(onKeys);
  const out = { ...baseFilters } as LiquiditySweepConfig["filters"];
  for (const k of LAB_FILTER_KEYS) {
    const block = baseFilters[k];
    (out as Record<string, unknown>)[k] = { ...block, enabled: on.has(k) };
  }
  return out;
}

export async function runLiquidityLabMatrixCore(data: z.infer<typeof LiquidityMatrixJobSchema>): Promise<MatrixResult> {
  const startedAll = Date.now();
  const [
    { loadRawCandles }, { enrichCandles }, { DEFAULT_CONFIG },
    { runStrategy }, { STRATEGY_PRESETS },
  ] = await Promise.all([
    import("@/lib/market-data/loader.server"),
    import("@/lib/market-data/enrich"),
    import("@/lib/market-data/types"),
    import("@/lib/strategy-engine/engine"),
    import("@/lib/strategy-engine/presets"),
  ]);

  const { baseConfig: base } = data;
  const toMs = Date.now();
  const fromMs = toMs - data.daysBack * 86_400_000;
  type Enriched = ReturnType<typeof enrichCandles>;
  const dataCache = new Map<string, { enriched: Enriched; error?: string }>();
  const rows: MatrixRow[] = [];

  for (const source of data.sources) {
    for (const symbol of data.symbols) {
      for (const timeframe of data.timeframes) {
        const key = `${source}::${symbol}::${timeframe}`;
        if (!dataCache.has(key)) {
          try {
            const { candles } = await loadRawCandles({ source, symbol, timeframe, fromMs, toMs });
            const enriched = enrichCandles(candles, {
              ...DEFAULT_CONFIG,
              symbol,
              timeframe,
              displayTimezone: base.displayTimezone as never,
              strategyTimezone: base.strategyTimezone as never,
            });
            dataCache.set(key, { enriched });
          } catch (e) {
            dataCache.set(key, { enriched: [] as Enriched, error: e instanceof Error ? e.message : String(e) });
          }
        }
        const cached = dataCache.get(key)!;
        for (const zones of data.zoneSets) {
          for (const confirmation of data.confirmationSets) {
            for (const filterKeys of data.filterSets) {
              const started = Date.now();
              if (cached.error) {
                rows.push({ symbol, timeframe, zones, source, confirmation, filters: filterKeys, ok: false, error: cached.error, bars: 0, signals: 0, stats: null, trades: [], elapsedMs: Date.now() - started });
                continue;
              }
              try {
                const cfg: LiquiditySweepConfig = {
                  ...base,
                  source,
                  symbol,
                  entryTimeframe: timeframe,
                  zones: zones as LiquiditySweepConfig["zones"],
                  confirmation: { ...base.confirmation, methods: confirmation as LiquiditySweepConfig["confirmation"]["methods"] },
                  filters: applyFilterToggles(base.filters, filterKeys),
                };
                const effective = deepMerge(STRATEGY_PRESETS.pdh_pdl_sweep_1m, toStrategyOverrides(cfg)) as StrategyConfig;
                effective.strategyName = `${source}·${symbol} ${timeframe} ${zones.join("+")} · conf:${confirmation.join("+")} · flt:${filterKeys.join("+") || "none"}`;
                const result = runStrategy(cached.enriched, effective, { mode: "historical", symbol });
                const { trades, labStats } = simulateTrades(cached.enriched, result.signals, cfg.riskUsd, cfg.realism);
                rows.push({ symbol, timeframe, zones, source, confirmation, filters: filterKeys, ok: true, error: null, bars: cached.enriched.length, signals: result.signals.length, stats: labStats, trades, elapsedMs: Date.now() - started });
              } catch (e) {
                rows.push({ symbol, timeframe, zones, source, confirmation, filters: filterKeys, ok: false, error: e instanceof Error ? e.message : String(e), bars: cached.enriched.length, signals: 0, stats: null, trades: [], elapsedMs: Date.now() - started });
              }
            }
          }
        }
      }
    }
  }
  return {
    rows,
    totalCombos: data.sources.length * data.symbols.length * data.timeframes.length * data.zoneSets.length * data.confirmationSets.length * data.filterSets.length,
    totalMs: Date.now() - startedAll,
  };
}
