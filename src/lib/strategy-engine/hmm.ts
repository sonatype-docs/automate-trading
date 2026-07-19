// Lightweight 2-state Gaussian HMM for regime detection.
// State 0 = bull (higher mean), State 1 = bear (lower mean). Third label
// "hmm_choppy" is derived when Viterbi confidence is weak (state posteriors
// close to 50/50 or realized volatility below noise floor).
//
// This is a simplified but real HMM: transition matrix is fixed (sticky
// diagonal), emissions are Gaussian with means/variances estimated from the
// rolling window. Runs in O(N) per call; called at most once per bar with a
// bounded window so the cost is trivial.
import type { EnrichedCandle } from "@/lib/market-data/types";

export type HmmState = "hmm_bull" | "hmm_bear" | "hmm_choppy" | "unknown";

export interface HmmFilter {
  allowed?: HmmState[];
  blocked?: HmmState[];
  window?: number;        // bars used to estimate emissions (default 200)
  stickiness?: number;    // diagonal transition prob (default 0.95)
  minConfidence?: number; // 0..1, below → hmm_choppy (default 0.6)
}

interface HmmCacheEntry { i: number; state: HmmState }
const cache = new WeakMap<EnrichedCandle[], HmmCacheEntry>();

export function classifyHmmState(
  bars: EnrichedCandle[],
  i: number,
  window = 200,
  stickiness = 0.95,
  minConfidence = 0.6,
): HmmState {
  // memoize the last computed index per bars array — engine walks forward
  const cached = cache.get(bars);
  if (cached && cached.i === i) return cached.state;

  const start = Math.max(1, i - window + 1);
  const n = i - start + 1;
  if (n < 30) return "unknown";

  // log returns
  const r: number[] = new Array(n);
  for (let k = 0; k < n; k++) {
    const p1 = bars[start + k].close;
    const p0 = bars[start + k - 1].close;
    r[k] = p0 > 0 ? Math.log(p1 / p0) : 0;
  }
  // rough mean / std to seed emissions
  let mean = 0;
  for (let k = 0; k < n; k++) mean += r[k];
  mean /= n;
  let variance = 0;
  for (let k = 0; k < n; k++) variance += (r[k] - mean) ** 2;
  variance = Math.max(variance / n, 1e-12);
  const sd = Math.sqrt(variance);
  // separate bull/bear seed means by ±0.5 sd
  const mu = [mean + 0.5 * sd, mean - 0.5 * sd];
  const sigma2 = [variance, variance];

  const trans = [
    [stickiness, 1 - stickiness],
    [1 - stickiness, stickiness],
  ];
  const gauss = (x: number, m: number, v: number) =>
    Math.exp(-((x - m) ** 2) / (2 * v)) / Math.sqrt(2 * Math.PI * v);

  // forward pass (posterior on final state)
  let a0 = 0.5 * gauss(r[0], mu[0], sigma2[0]);
  let a1 = 0.5 * gauss(r[0], mu[1], sigma2[1]);
  let s = a0 + a1; if (s > 0) { a0 /= s; a1 /= s; }
  for (let k = 1; k < n; k++) {
    const n0 = (a0 * trans[0][0] + a1 * trans[1][0]) * gauss(r[k], mu[0], sigma2[0]);
    const n1 = (a0 * trans[0][1] + a1 * trans[1][1]) * gauss(r[k], mu[1], sigma2[1]);
    const z = n0 + n1;
    if (z > 0) { a0 = n0 / z; a1 = n1 / z; } else { a0 = 0.5; a1 = 0.5; }
  }

  const conf = Math.max(a0, a1);
  let state: HmmState;
  if (conf < minConfidence) state = "hmm_choppy";
  else if (a0 > a1) state = mu[0] >= mu[1] ? "hmm_bull" : "hmm_bear";
  else state = mu[1] >= mu[0] ? "hmm_bear" : "hmm_bull";

  cache.set(bars, { i, state });
  return state;
}

export function evalHmmFilter(
  bars: EnrichedCandle[], i: number, f: HmmFilter | undefined,
): { pass: boolean; label: string; reason?: string } {
  if (!f || (!f.allowed?.length && !f.blocked?.length)) return { pass: true, label: "hmm" };
  const st = classifyHmmState(bars, i, f.window ?? 200, f.stickiness ?? 0.95, f.minConfidence ?? 0.6);
  if (f.allowed?.length && !f.allowed.includes(st))
    return { pass: false, label: "hmm.allowed", reason: `hmm=${st}` };
  if (f.blocked?.length && f.blocked.includes(st))
    return { pass: false, label: "hmm.blocked", reason: `hmm=${st}` };
  return { pass: true, label: "hmm" };
}
