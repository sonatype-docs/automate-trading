// Server functions for the Liquidity Sweep Research Lab.
// - runLab: executes a Lab config against enriched market data via the
//   Universal Strategy Engine.
// - Preset CRUD: list / save / rename / duplicate / delete / import.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LiquiditySweepConfigSchema, type LiquiditySweepConfig } from "./liquidity-lab/config";
import { toStrategyOverrides } from "./liquidity-lab/to-strategy-config";
import type { EngineRunResult, StrategyConfig } from "./strategy-engine/types";

const RunInput = z.object({
  config: LiquiditySweepConfigSchema,
});

export interface LabTrade {
  ts: number;
  exitTs: number;
  direction: "long" | "short";
  entry: number;
  stop: number;
  target: number;
  outcome: "win" | "loss" | "open";
  rMultiple: number;
  pnlUsd: number;
  barsHeld: number;
}

export interface LabStats {
  trades: number;
  wins: number;
  losses: number;
  open: number;
  winRate: number;      // 0..100
  avgRR: number;        // avg planned R:R across signals
  avgWinR: number;
  avgLossR: number;
  expectancyR: number;
  profitFactor: number;
  totalPnlUsd: number;
  grossWinUsd: number;
  grossLossUsd: number;
  maxDrawdownUsd: number;
  longs: number;
  shorts: number;
  longWinRate: number;
  shortWinRate: number;
}

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
