// Server functions for the Liquidity Sweep Research Lab.
// - runLab: executes a Lab config against enriched market data via the
//   Universal Strategy Engine.
// - runLiquidityLabMatrix: sweeps symbols × timeframes × zones combos and
//   returns a ranked summary table.
// - Preset CRUD: list / save / rename / duplicate / delete / import.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LiquiditySweepConfigSchema, type LiquiditySweepConfig, ZONE_KINDS } from "./liquidity-lab/config";
import { toStrategyOverrides } from "./liquidity-lab/to-strategy-config";
import type { EngineRunResult, StrategyConfig } from "./strategy-engine/types";
import { simulateTrades, type LabTrade, type LabStats } from "./liquidity-lab/simulator";
import { TIMEFRAMES, type Timeframe } from "./market-data/types";

const RunInput = z.object({
  config: LiquiditySweepConfigSchema,
});

export type { LabTrade, LabStats };

export interface RunLabResult {
  result: EngineRunResult;
  barsIn: number;
  effectiveConfigJson: string;
  trades: LabTrade[];
  labStats: LabStats;
}



export const runLiquidityLab = createServerFn({ method: "POST" })
  .inputValidator((raw) => RunInput.parse(raw))
  .handler(async ({ data }): Promise<RunLabResult> => {
    const cfg = data.config;
    const [{ loadRawCandles }, { enrichCandles }, { DEFAULT_CONFIG }, { runStrategy }, { STRATEGY_PRESETS }] = await Promise.all([
      import("@/lib/market-data/loader.server"),
      import("@/lib/market-data/enrich"),
      import("@/lib/market-data/types"),
      import("@/lib/strategy-engine/engine"),
      import("@/lib/strategy-engine/presets"),
    ]);

    const toMs = Date.now();
    const fromMs = toMs - cfg.daysBack * 86_400_000;

    const { candles } = await loadRawCandles({
      source: cfg.source,
      symbol: cfg.symbol,
      timeframe: cfg.entryTimeframe as never,
      fromMs,
      toMs,
    });

    const enriched = enrichCandles(candles, {
      ...DEFAULT_CONFIG,
      symbol: cfg.symbol,
      timeframe: cfg.entryTimeframe as never,
      displayTimezone: cfg.displayTimezone as never,
      strategyTimezone: cfg.strategyTimezone as never,
    });

    // Start from the PDH/PDL base preset (well-tuned defaults) then overlay
    // Lab-driven overrides so nothing is hardcoded on the config side.
    const base = STRATEGY_PRESETS.pdh_pdl_sweep_1m;
    const overrides = toStrategyOverrides(cfg);
    const effective = deepMerge(base, overrides) as StrategyConfig;
    effective.strategyName = cfg.name || "Liquidity Lab Run";

    const result = runStrategy(enriched, effective, {
      mode: "historical",
      symbol: cfg.symbol,
    });
    result.events = result.events.slice(-500);

    const { trades, labStats } = simulateTrades(enriched, result.signals, cfg.riskUsd);

    return {
      result,
      barsIn: enriched.length,
      effectiveConfigJson: JSON.stringify(effective),
      trades,
      labStats,
    };
  });

// ── Preset CRUD ────────────────────────────────────────────────────────

export const listLabPresets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as { supabase: import("@supabase/supabase-js").SupabaseClient; userId: string };
    const { data, error } = await supabase
      .from("liquidity_lab_presets")
      .select("id, name, config, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const SaveInput = z.object({
  name: z.string().trim().min(1).max(80),
  config: LiquiditySweepConfigSchema,
  id: z.string().uuid().optional(),
});

export const saveLabPreset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => SaveInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: import("@supabase/supabase-js").SupabaseClient; userId: string };
    if (data.id) {
      const { error } = await supabase
        .from("liquidity_lab_presets")
        .update({ name: data.name, config: data.config })
        .eq("id", data.id).eq("user_id", userId);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await supabase
      .from("liquidity_lab_presets")
      .upsert({ user_id: userId, name: data.name, config: data.config }, { onConflict: "user_id,name" })
      .select("id").single();
    if (error) throw new Error(error.message);
    return { id: row!.id as string };
  });

export const deleteLabPreset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: import("@supabase/supabase-js").SupabaseClient; userId: string };
    const { error } = await supabase.from("liquidity_lab_presets")
      .delete().eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const duplicateLabPreset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ id: z.string().uuid(), newName: z.string().min(1).max(80) }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: import("@supabase/supabase-js").SupabaseClient; userId: string };
    const { data: src, error: e1 } = await supabase.from("liquidity_lab_presets")
      .select("config").eq("id", data.id).eq("user_id", userId).single();
    if (e1) throw new Error(e1.message);
    const { data: row, error } = await supabase.from("liquidity_lab_presets")
      .insert({ user_id: userId, name: data.newName, config: src!.config }).select("id").single();
    if (error) throw new Error(error.message);
    return { id: row!.id as string };
  });

// ── helpers ────────────────────────────────────────────────────────────
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

// Re-export so client code can import both from one module.
export type { LiquiditySweepConfig };

// ── Matrix runner ──────────────────────────────────────────────────────
// Sweeps symbols × timeframes × zone-sets against the same base config and
// returns a ranked leaderboard of {symbol, timeframe, zones, stats}.

const MatrixInput = z.object({
  baseConfig: LiquiditySweepConfigSchema,
  symbols: z.array(z.string()).min(1).max(20),
  timeframes: z.array(z.enum([...TIMEFRAMES] as [Timeframe, ...Timeframe[]])).min(1).max(14),
  // Each entry is one zone-selection (a "combo"). Default = each zone alone.
  zoneSets: z.array(z.array(z.enum(ZONE_KINDS)).min(1)).min(1).max(32),
  source: z.enum(["yahoo", "shark"]).optional(),
  daysBack: z.number().min(7).max(720).optional(),
});

export interface MatrixRow {
  symbol: string;
  timeframe: Timeframe;
  zones: string[];
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

export const runLiquidityLabMatrix = createServerFn({ method: "POST" })
  .inputValidator((raw) => MatrixInput.parse(raw))
  .handler(async ({ data }): Promise<MatrixResult> => {
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

    const base = data.baseConfig;
    const source = data.source ?? base.source;
    const daysBack = data.daysBack ?? base.daysBack;
    const toMs = Date.now();
    const fromMs = toMs - daysBack * 86_400_000;

    // Cache enriched candles per (symbol, timeframe) so zone-combos re-use it.
    type Enriched = ReturnType<typeof enrichCandles>;
    const dataCache = new Map<string, { enriched: Enriched; error?: string }>();

    const rows: MatrixRow[] = [];

    for (const symbol of data.symbols) {
      for (const tf of data.timeframes) {
        const key = `${symbol}::${tf}`;
        if (!dataCache.has(key)) {
          try {
            const { candles } = await loadRawCandles({
              source, symbol, timeframe: tf, fromMs, toMs,
            });
            const enriched = enrichCandles(candles, {
              ...DEFAULT_CONFIG,
              symbol, timeframe: tf,
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
          const started = Date.now();
          if (cached.error) {
            rows.push({
              symbol, timeframe: tf, zones, ok: false, error: cached.error,
              bars: 0, signals: 0, stats: null, trades: [], elapsedMs: Date.now() - started,
            });
            continue;
          }
          try {
            const cfg: LiquiditySweepConfig = {
              ...base, symbol, entryTimeframe: tf, zones: zones as LiquiditySweepConfig["zones"],
            };
            const overrides = toStrategyOverrides(cfg);
            const preset = STRATEGY_PRESETS.pdh_pdl_sweep_1m;
            const effective = deepMerge(preset, overrides) as StrategyConfig;
            effective.strategyName = `${symbol} ${tf} ${zones.join("+")}`;

            const res = runStrategy(cached.enriched, effective, { mode: "historical", symbol });
            const { trades, labStats } = simulateTrades(cached.enriched, res.signals, cfg.riskUsd);
            rows.push({
              symbol, timeframe: tf, zones, ok: true, error: null,
              bars: cached.enriched.length, signals: res.signals.length,
              stats: labStats, trades, elapsedMs: Date.now() - started,
            });
          } catch (e) {
            rows.push({
              symbol, timeframe: tf, zones, ok: false,
              error: e instanceof Error ? e.message : String(e),
              bars: cached.enriched.length, signals: 0, stats: null, trades: [],
              elapsedMs: Date.now() - started,
            });
          }
        }
      }
    }

    return {
      rows,
      totalCombos: data.symbols.length * data.timeframes.length * data.zoneSets.length,
      totalMs: Date.now() - startedAll,
    };
  });


