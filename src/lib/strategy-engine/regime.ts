// Regime overlay — classify a bar into a coarse market regime label using
// pre-computed ADX + ATR percentile from EnrichedCandle. Strategies opt in via
// StrategyConfig.regime.allowed / .blocked.
import type { EnrichedCandle } from "@/lib/market-data/types";

export type RegimeTag =
  | "trend_strong"    // ADX >= 25 AND atrPct >= 40
  | "trend_weak"      // ADX 18-25
  | "range_calm"      // ADX < 18 AND atrPct < 50
  | "range_volatile"  // ADX < 18 AND atrPct >= 50
  | "unknown";

export interface RegimeFilter {
  allowed?: RegimeTag[];  // if set, bar regime must be in this list
  blocked?: RegimeTag[];  // if set, bar regime must NOT be in this list
}

export function classifyRegime(bar: EnrichedCandle): RegimeTag {
  const adx = bar.adx;
  const pct = bar.atrPercentile;
  if (adx === null || pct === null) return "unknown";
  if (adx >= 25 && pct >= 40) return "trend_strong";
  if (adx >= 18) return "trend_weak";
  if (pct >= 50) return "range_volatile";
  return "range_calm";
}

export function evalRegimeFilter(bar: EnrichedCandle, f: RegimeFilter | undefined):
  { pass: boolean; label: string; reason?: string } {
  if (!f || (!f.allowed?.length && !f.blocked?.length)) return { pass: true, label: "regime" };
  const tag = classifyRegime(bar);
  if (f.allowed?.length && !f.allowed.includes(tag))
    return { pass: false, label: "regime.allowed", reason: `regime=${tag}` };
  if (f.blocked?.length && f.blocked.includes(tag))
    return { pass: false, label: "regime.blocked", reason: `regime=${tag}` };
  return { pass: true, label: "regime" };
}
