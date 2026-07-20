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

// ── Trade simulator ────────────────────────────────────────────────────
// Simple stop-entry walk-forward. Long fills when high >= entry; then check
// SL (low <= stop) and TP (high >= target). Short mirrored. Same-bar SL+TP
// is treated as SL (conservative).
type SimBar = { ts: number; high: number; low: number };

function simulateTrades(
  bars: SimBar[],
  signals: EngineRunResult["signals"],
  riskUsd: number,
): { trades: LabTrade[]; labStats: LabStats } {
  const trades: LabTrade[] = [];
  const idxByTs = new Map<number, number>();
  for (let i = 0; i < bars.length; i++) idxByTs.set(bars[i].ts, i);
  const MAX_HOLD = 500;

  for (const s of signals) {
    const startIdx = idxByTs.get(s.timestamp);
    if (startIdx == null) continue;
    const entry = s.entryPrice, stop = s.stopLoss, target = s.takeProfit;
    const long = s.direction === "long";
    const expiryIdx = s.expiryTs ? (idxByTs.get(s.expiryTs) ?? startIdx + 5) : startIdx + 5;

    let fillIdx = -1;
    for (let i = startIdx + 1; i <= Math.min(expiryIdx, bars.length - 1); i++) {
      const b = bars[i];
      if (long ? b.high >= entry : b.low <= entry) { fillIdx = i; break; }
    }
    if (fillIdx < 0) continue;

    let outcome: LabTrade["outcome"] = "open";
    let exitBar = fillIdx;
    for (let i = fillIdx; i < Math.min(bars.length, fillIdx + MAX_HOLD); i++) {
      const b = bars[i];
      const hitSl = long ? b.low <= stop : b.high >= stop;
      const hitTp = long ? b.high >= target : b.low <= target;
      if (hitSl) { outcome = "loss"; exitBar = i; break; }
      if (hitTp) { outcome = "win"; exitBar = i; break; }
    }

    const rDist = Math.abs(entry - stop) || 1;
    const rMultiple = outcome === "win" ? Math.abs(target - entry) / rDist
                    : outcome === "loss" ? -1 : 0;
    trades.push({
      ts: bars[fillIdx].ts, exitTs: bars[exitBar].ts, direction: s.direction,
      entry, stop, target, outcome, rMultiple,
      pnlUsd: outcome === "open" ? 0 : rMultiple * riskUsd,
      barsHeld: exitBar - fillIdx,
    });
  }

  const wins = trades.filter((t) => t.outcome === "win");
  const losses = trades.filter((t) => t.outcome === "loss");
  const open = trades.filter((t) => t.outcome === "open");
  const longs = trades.filter((t) => t.direction === "long");
  const shorts = trades.filter((t) => t.direction === "short");
  const grossWin = wins.reduce((a, t) => a + t.pnlUsd, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnlUsd, 0));
  const closedCount = wins.length + losses.length;

  let eq = 0, peak = 0, maxDd = 0;
  for (const t of trades) {
    eq += t.pnlUsd;
    if (eq > peak) peak = eq;
    if (peak - eq > maxDd) maxDd = peak - eq;
  }

  const avgRR = signals.length ? signals.reduce((a, s) => a + (s.rr || 0), 0) / signals.length : 0;
  const wrOf = (arr: LabTrade[]) => {
    const closed = arr.filter((t) => t.outcome !== "open");
    return closed.length ? (arr.filter((t) => t.outcome === "win").length / closed.length) * 100 : 0;
  };

  const labStats: LabStats = {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    open: open.length,
    winRate: closedCount ? (wins.length / closedCount) * 100 : 0,
    avgRR,
    avgWinR: wins.length ? wins.reduce((a, t) => a + t.rMultiple, 0) / wins.length : 0,
    avgLossR: losses.length ? losses.reduce((a, t) => a + t.rMultiple, 0) / losses.length : 0,
    expectancyR: closedCount
      ? (wins.reduce((a, t) => a + t.rMultiple, 0) + losses.reduce((a, t) => a + t.rMultiple, 0)) / closedCount
      : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? 999 : 0),
    totalPnlUsd: grossWin - grossLoss,
    grossWinUsd: grossWin,
    grossLossUsd: grossLoss,
    maxDrawdownUsd: maxDd,
    longs: longs.length,
    shorts: shorts.length,
    longWinRate: wrOf(longs),
    shortWinRate: wrOf(shorts),
  };
  return { trades, labStats };
}

// Re-export so client code can import both from one module.
export type { LiquiditySweepConfig };

