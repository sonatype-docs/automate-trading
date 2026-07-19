// Statistical validation for a specific time bucket:
// Monte Carlo of bucket vs random equally-sized samples,
// bootstrap CI on net PnL, and walk-forward stability.

import type { TradeRecord } from "@/lib/trade-intelligence/types";
import { mean } from "@/lib/ai-research/stats";

export interface MonteCarloResult {
  iterations: number;
  observedNetProfit: number;
  meanRandomNet: number;
  p5: number;
  p95: number;
  pValue: number; // fraction of random samples with netProfit >= observed
}

export function bucketMonteCarlo(
  bucketRows: TradeRecord[],
  population: TradeRecord[],
  iterations = 2000,
  seed = 42,
): MonteCarloResult {
  const n = bucketRows.length;
  if (n === 0 || population.length <= n) {
    return { iterations: 0, observedNetProfit: 0, meanRandomNet: 0, p5: 0, p95: 0, pValue: 1 };
  }
  const observed = bucketRows.reduce((s, r) => s + r.netPnl, 0);
  const pnls = population.map((r) => r.netPnl);
  const rand = mulberry32(seed);
  const draws: number[] = new Array(iterations);
  for (let i = 0; i < iterations; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += pnls[Math.floor(rand() * pnls.length)];
    draws[i] = s;
  }
  draws.sort((a, b) => a - b);
  const p5 = draws[Math.floor(iterations * 0.05)];
  const p95 = draws[Math.floor(iterations * 0.95)];
  const better = draws.filter((v) => v >= observed).length;
  return {
    iterations,
    observedNetProfit: observed,
    meanRandomNet: mean(draws),
    p5, p95,
    pValue: better / iterations,
  };
}

export interface BootstrapCI {
  mean: number;
  ci95Low: number;
  ci95High: number;
  probPositive: number;
}

export function bootstrapNetPerTrade(
  bucketRows: TradeRecord[],
  iterations = 1000,
  seed = 7,
): BootstrapCI {
  if (bucketRows.length === 0) return { mean: 0, ci95Low: 0, ci95High: 0, probPositive: 0 };
  const pnls = bucketRows.map((r) => r.netPnl);
  const rand = mulberry32(seed);
  const means: number[] = new Array(iterations);
  for (let i = 0; i < iterations; i++) {
    let s = 0;
    for (let j = 0; j < pnls.length; j++) s += pnls[Math.floor(rand() * pnls.length)];
    means[i] = s / pnls.length;
  }
  means.sort((a, b) => a - b);
  const ciLow = means[Math.floor(iterations * 0.025)];
  const ciHigh = means[Math.floor(iterations * 0.975)];
  const pos = means.filter((m) => m > 0).length / iterations;
  return { mean: mean(means), ci95Low: ciLow, ci95High: ciHigh, probPositive: pos };
}

export interface WalkForwardFold {
  index: number;
  fromMs: number;
  toMs: number;
  trades: number;
  netProfit: number;
  winRate: number;
  expectancy: number;
}

export function walkForward(
  bucketRows: TradeRecord[],
  folds = 5,
): { folds: WalkForwardFold[]; stability: number } {
  if (bucketRows.length < folds) return { folds: [], stability: 0 };
  const sorted = [...bucketRows].sort((a, b) => a.entryTime - b.entryTime);
  const size = Math.floor(sorted.length / folds);
  const out: WalkForwardFold[] = [];
  for (let i = 0; i < folds; i++) {
    const slice = sorted.slice(i * size, i === folds - 1 ? sorted.length : (i + 1) * size);
    const net = slice.reduce((s, r) => s + r.netPnl, 0);
    const wins = slice.filter((r) => r.netPnl > 0).length;
    out.push({
      index: i + 1,
      fromMs: slice[0]?.entryTime ?? 0,
      toMs: slice.at(-1)?.entryTime ?? 0,
      trades: slice.length,
      netProfit: net,
      winRate: slice.length ? wins / slice.length : 0,
      expectancy: slice.length ? net / slice.length : 0,
    });
  }
  const positiveFolds = out.filter((f) => f.netProfit > 0).length;
  const stability = folds ? positiveFolds / folds : 0;
  return { folds: out, stability };
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
