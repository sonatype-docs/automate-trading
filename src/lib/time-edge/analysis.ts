// Time Edge core analysis. Pure. Given TradeRecord[] → per-bucket metrics,
// heatmaps, clustering, cross-asset consistency, robustness score.

import type { TradeRecord } from "@/lib/trade-intelligence/types";
import { computeMetrics } from "@/lib/optimizer/objectives";
import { mean, welchT, propZ } from "@/lib/ai-research/stats";
import type {
  BucketDim, BucketMetrics, Heatmap, HeatmapCell, HeatmapMetric,
  TimeCluster, CrossAssetRow, TimeEdgeReport, AnalyzeOptions, CustomWindow,
} from "./types";
import { groupByDim, WEEKDAY_LABELS, formatHour, bucketOf } from "./buckets";

const DEFAULT_DIMS: BucketDim[] = [
  "hour_ist", "weekday", "month", "quarter",
  "session", "symbol", "hour_weekday", "session_weekday",
];

export function bucketMetrics(
  key: string,
  label: string,
  dim: BucketDim,
  rows: TradeRecord[],
  outside: TradeRecord[],
): BucketMetrics {
  const m = computeMetrics(rows);
  const insidePnl = rows.map((r) => r.netPnl);
  const outsidePnl = outside.map((r) => r.netPnl);
  const tt = welchT(insidePnl, outsidePnl);
  const insideWins = rows.filter((r) => r.netPnl > 0).length;
  const outsideWins = outside.filter((r) => r.netPnl > 0).length;
  const pz = propZ(insideWins, rows.length, outsideWins, outside.length);
  const confidence = 1 - Math.min(tt.p, pz.p);
  const holds = rows.map((r) => r.holdingBars ?? 0).filter((v) => v > 0).sort((a, b) => a - b);
  const medianHold = holds.length ? holds[Math.floor(holds.length / 2)] : 0;
  const robustness = computeRobustness(m, rows.length, confidence);
  return {
    key, label, dim,
    trades: m.trades, wins: m.wins, losses: m.losses,
    netProfit: m.net_profit, grossProfit: m.gross_profit, grossLoss: m.gross_loss,
    winRate: m.win_rate, profitFactor: Math.min(m.profit_factor, 999),
    expectancy: m.expectancy, avgRr: m.avg_rr,
    avgWin: m.avg_win, avgLoss: m.avg_loss,
    sharpe: m.sharpe, sortino: m.sortino,
    maxDrawdown: m.max_drawdown, ulcerIndex: m.ulcer_index,
    recoveryFactor: m.recovery_factor,
    avgHoldingBars: mean(rows.map((r) => r.holdingBars ?? 0)),
    medianHoldingBars: medianHold,
    pValueMean: tt.p, pValueWin: pz.p, confidence,
    robustness,
    symbols: Array.from(new Set(rows.map((r) => r.symbol))).slice(0, 20),
    strategies: Array.from(new Set(rows.map((r) => r.strategyId))).slice(0, 20),
  };
}

export function computeRobustness(
  m: ReturnType<typeof computeMetrics>,
  sample: number,
  confidence: number,
): number {
  const pfScore = clamp01((m.profit_factor - 1) / 2) * 25;
  const expScore = clamp01(m.expectancy / 50) * 15;
  const winScore = clamp01((m.win_rate - 0.4) / 0.4) * 10;
  const sampleScore = clamp01(Math.log10(Math.max(1, sample)) / 3) * 15;
  const ddScore = clamp01(1 - (m.max_drawdown / Math.max(1, m.gross_profit))) * 10;
  const sharpeScore = clamp01(m.sharpe / 2) * 10;
  const confScore = clamp01(confidence) * 15;
  return Math.round(pfScore + expScore + winScore + sampleScore + ddScore + sharpeScore + confScore);
}

function clamp01(x: number): number { return Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0)); }

// Fast pooled stats — one linear pass; outside = totals - inside (O(n) not O(n²)).
type PoolStats = { n: number; sum: number; sumSq: number; wins: number };
function poolStats(rows: TradeRecord[]): PoolStats {
  let n = 0, s = 0, ss = 0, w = 0;
  for (const r of rows) {
    const p = r.netPnl ?? 0;
    n++; s += p; ss += p * p;
    if (p > 0) w++;
  }
  return { n, sum: s, sumSq: ss, wins: w };
}
function subtractPool(a: PoolStats, b: PoolStats): PoolStats {
  return { n: a.n - b.n, sum: a.sum - b.sum, sumSq: a.sumSq - b.sumSq, wins: a.wins - b.wins };
}
function normCdfLocal(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}
function welchFromPools(inside: PoolStats, outside: PoolStats): { t: number; p: number } {
  if (inside.n < 2 || outside.n < 2) return { t: 0, p: 1 };
  const ma = inside.sum / inside.n;
  const mb = outside.sum / outside.n;
  const va = Math.max(0, (inside.sumSq - inside.sum * inside.sum / inside.n) / (inside.n - 1));
  const vb = Math.max(0, (outside.sumSq - outside.sum * outside.sum / outside.n) / (outside.n - 1));
  const se = Math.sqrt(va / inside.n + vb / outside.n);
  if (se <= 0) return { t: 0, p: 1 };
  const t = (ma - mb) / se;
  const z = Math.abs(t);
  return { t, p: Math.max(0, Math.min(1, 2 * (1 - normCdfLocal(z)))) };
}

export function analyzeDim(
  trades: TradeRecord[],
  dim: BucketDim,
  minTrades = 10,
  customWindows: CustomWindow[] = [],
): BucketMetrics[] {
  const groups = groupByDim(trades, dim, customWindows);
  const totals = poolStats(trades);
  const out: BucketMetrics[] = [];
  for (const [key, g] of groups) {
    if (g.rows.length < minTrades) continue;
    const inside = poolStats(g.rows);
    const outside = subtractPool(totals, inside);
    const m = computeMetrics(g.rows);
    const tt = welchFromPools(inside, outside);
    const pz = propZ(inside.wins, inside.n, outside.wins, outside.n);
    const confidence = 1 - Math.min(tt.p, pz.p);
    const holds = g.rows.map((r) => r.holdingBars ?? 0).filter((v) => v > 0).sort((a, b) => a - b);
    const medianHold = holds.length ? holds[Math.floor(holds.length / 2)] : 0;
    const robustness = computeRobustness(m, g.rows.length, confidence);
    out.push({
      key, label: g.label, dim,
      trades: m.trades, wins: m.wins, losses: m.losses,
      netProfit: m.net_profit, grossProfit: m.gross_profit, grossLoss: m.gross_loss,
      winRate: m.win_rate, profitFactor: Math.min(m.profit_factor, 999),
      expectancy: m.expectancy, avgRr: m.avg_rr,
      avgWin: m.avg_win, avgLoss: m.avg_loss,
      sharpe: m.sharpe, sortino: m.sortino,
      maxDrawdown: m.max_drawdown, ulcerIndex: m.ulcer_index,
      recoveryFactor: m.recovery_factor,
      avgHoldingBars: mean(g.rows.map((r) => r.holdingBars ?? 0)),
      medianHoldingBars: medianHold,
      pValueMean: tt.p, pValueWin: pz.p, confidence,
      robustness,
      symbols: Array.from(new Set(g.rows.map((r) => r.symbol))).slice(0, 20),
      strategies: Array.from(new Set(g.rows.map((r) => r.strategyId))).slice(0, 20),
    });
  }
  return out.sort((a, b) => b.expectancy - a.expectancy);
}

// ------------------ Heatmaps ------------------
export function buildHeatmap(
  trades: TradeRecord[],
  yDim: "weekday" | "session",
  metric: HeatmapMetric,
  customWindows: CustomWindow[] = [],
): Heatmap {
  const xs = Array.from({ length: 24 }, (_, i) => formatHour(i));
  const ysSet = new Set<string>();
  const cellMap = new Map<string, { rows: TradeRecord[] }>();
  for (const t of trades) {
    const hb = bucketOf(t, "hour_ist", customWindows);
    if (!hb) continue;
    const yb = bucketOf(t, yDim, customWindows);
    if (!yb) continue;
    const yLabel = yb.label;
    ysSet.add(yLabel);
    const key = `${hb.label}|${yLabel}`;
    const cur = cellMap.get(key);
    if (cur) cur.rows.push(t);
    else cellMap.set(key, { rows: [t] });
  }
  const ys = yDim === "weekday" ? WEEKDAY_LABELS.filter((w) => ysSet.has(w)) : Array.from(ysSet).sort();
  const cells: HeatmapCell[] = [];
  for (const y of ys) {
    for (const x of xs) {
      const cell = cellMap.get(`${x}|${y}`);
      const rows = cell?.rows ?? [];
      let value = 0;
      if (rows.length) {
        const m = computeMetrics(rows);
        value = metricValue(m, metric);
      }
      cells.push({ x, y, value, trades: rows.length });
    }
  }
  return {
    metric, xLabel: "Hour (IST)",
    yLabel: yDim === "weekday" ? "Weekday" : "Session",
    xs, ys, cells,
  };
}

function metricValue(m: ReturnType<typeof computeMetrics>, metric: HeatmapMetric): number {
  switch (metric) {
    case "net_profit": return m.net_profit;
    case "profit_factor": return Math.min(m.profit_factor, 10);
    case "win_rate": return m.win_rate;
    case "expectancy": return m.expectancy;
    case "sharpe": return m.sharpe;
    case "trades": return m.trades;
  }
}

// ------------------ Time Clustering ------------------
// Cluster hour_ist × weekday buckets by their [winRate, expectancy, PF, sharpe]
// vectors using a small deterministic k-means.
export function clusterTimeBuckets(
  hourWeekdayBuckets: BucketMetrics[],
  k = 4,
  seed = 7,
): TimeCluster[] {
  if (hourWeekdayBuckets.length < k) return [];
  const feats = hourWeekdayBuckets.map((b) => [
    b.winRate, b.expectancy, Math.min(b.profitFactor, 5), b.sharpe,
  ]);
  const means = [0, 0, 0, 0].map((_, j) => mean(feats.map((f) => f[j])));
  const stds = means.map((_m, j) => {
    const v = mean(feats.map((f) => (f[j] - means[j]) ** 2));
    return Math.sqrt(v) || 1;
  });
  const X = feats.map((f) => f.map((v, j) => (v - means[j]) / stds[j]));
  const rand = mulberry32(seed);
  const centers = Array.from({ length: k }, () => X[Math.floor(rand() * X.length)].slice());
  const labels = new Array(X.length).fill(0);
  const dist = (a: number[], b: number[]) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);
  for (let it = 0; it < 30; it++) {
    for (let i = 0; i < X.length; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) { const d = dist(X[i], centers[c]); if (d < bd) { bd = d; best = c; } }
      labels[i] = best;
    }
    const sums = Array.from({ length: k }, () => [0, 0, 0, 0]);
    const counts = new Array(k).fill(0);
    for (let i = 0; i < X.length; i++) {
      counts[labels[i]]++;
      for (let j = 0; j < 4; j++) sums[labels[i]][j] += X[i][j];
    }
    for (let c = 0; c < k; c++) if (counts[c]) centers[c] = sums[c].map((s) => s / counts[c]);
  }
  const groups: number[][] = Array.from({ length: k }, () => []);
  labels.forEach((c, i) => groups[c].push(i));
  return groups.map((members, i) => {
    const bs = members.map((idx) => hourWeekdayBuckets[idx]);
    const cx = centers[i].map((v, j) => v * stds[j] + means[j]);
    const avgExp = mean(bs.map((b) => b.expectancy));
    const label = avgExp > 0 ? `Cluster ${i + 1} · Profitable` : avgExp < 0 ? `Cluster ${i + 1} · Losing` : `Cluster ${i + 1} · Neutral`;
    return {
      index: i, size: bs.length,
      bucketKeys: bs.map((b) => b.key),
      centroid: { winRate: cx[0], expectancy: cx[1], profitFactor: cx[2], sharpe: cx[3] },
      aggregate: aggregateBuckets(bs),
      label,
    };
  }).sort((a, b) => b.aggregate.expectancy - a.aggregate.expectancy);
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function aggregateBuckets(bs: BucketMetrics[]): BucketMetrics {
  const trades = bs.reduce((s, b) => s + b.trades, 0);
  const wins = bs.reduce((s, b) => s + b.wins, 0);
  const gp = bs.reduce((s, b) => s + b.grossProfit, 0);
  const gl = bs.reduce((s, b) => s + b.grossLoss, 0);
  const net = bs.reduce((s, b) => s + b.netProfit, 0);
  return {
    key: "cluster", label: `${bs.length} buckets`, dim: "hour_weekday",
    trades, wins, losses: trades - wins,
    netProfit: net, grossProfit: gp, grossLoss: gl,
    winRate: trades ? wins / trades : 0,
    profitFactor: gl > 0 ? gp / gl : gp > 0 ? 999 : 0,
    expectancy: trades ? net / trades : 0,
    avgRr: mean(bs.map((b) => b.avgRr)),
    avgWin: mean(bs.map((b) => b.avgWin)),
    avgLoss: mean(bs.map((b) => b.avgLoss)),
    sharpe: mean(bs.map((b) => b.sharpe)),
    sortino: mean(bs.map((b) => b.sortino)),
    maxDrawdown: Math.max(...bs.map((b) => b.maxDrawdown), 0),
    ulcerIndex: mean(bs.map((b) => b.ulcerIndex)),
    recoveryFactor: mean(bs.map((b) => b.recoveryFactor)),
    avgHoldingBars: mean(bs.map((b) => b.avgHoldingBars)),
    medianHoldingBars: mean(bs.map((b) => b.medianHoldingBars)),
    pValueMean: mean(bs.map((b) => b.pValueMean)),
    pValueWin: mean(bs.map((b) => b.pValueWin)),
    confidence: mean(bs.map((b) => b.confidence)),
    robustness: Math.round(mean(bs.map((b) => b.robustness))),
    symbols: Array.from(new Set(bs.flatMap((b) => b.symbols))).slice(0, 20),
    strategies: Array.from(new Set(bs.flatMap((b) => b.strategies))).slice(0, 20),
  };
}

// ------------------ Cross-Asset Consistency ------------------
export function crossAssetAnalysis(
  trades: TradeRecord[],
  dim: BucketDim = "hour_ist",
  minTradesPerSymbol = 5,
): CrossAssetRow[] {
  const symbols = Array.from(new Set(trades.map((t) => t.symbol)));
  if (symbols.length < 2) return [];
  const perSymbol = new Map<string, Map<string, { label: string; rows: TradeRecord[] }>>();
  for (const s of symbols) {
    perSymbol.set(s, groupByDim(trades.filter((t) => t.symbol === s), dim));
  }
  const allKeys = new Set<string>();
  const labelMap = new Map<string, string>();
  for (const gm of perSymbol.values()) {
    for (const [k, g] of gm) { allKeys.add(k); labelMap.set(k, g.label); }
  }
  const out: CrossAssetRow[] = [];
  for (const key of allKeys) {
    const symbolStats: CrossAssetRow["symbolStats"] = {};
    let positives = 0, total = 0;
    for (const s of symbols) {
      const g = perSymbol.get(s)?.get(key);
      if (!g || g.rows.length < minTradesPerSymbol) continue;
      const m = computeMetrics(g.rows);
      symbolStats[s] = {
        trades: m.trades, netProfit: m.net_profit,
        winRate: m.win_rate, profitFactor: Math.min(m.profit_factor, 999),
      };
      total += 1;
      if (m.expectancy > 0) positives += 1;
    }
    if (total < 2) continue;
    const consistency = positives / total;
    // universal score = consistency * combined edge strength
    const netSum = Object.values(symbolStats).reduce((s, v) => s + v.netProfit, 0);
    const universalScore = Math.round(consistency * 100 * clamp01(netSum / 1000));
    out.push({
      bucketKey: key, label: labelMap.get(key) ?? key,
      symbolStats, consistencyScore: consistency, universalScore,
    });
  }
  return out.sort((a, b) => b.universalScore - a.universalScore);
}

// ------------------ Full report ------------------
export function analyzeTimeEdges(trades: TradeRecord[], opts: AnalyzeOptions = {}): TimeEdgeReport {
  const minTrades = opts.minTrades ?? 10;
  const dims = opts.includeDims ?? DEFAULT_DIMS;
  const buckets = {} as TimeEdgeReport["buckets"];
  for (const dim of dims) {
    buckets[dim] = analyzeDim(trades, dim, minTrades, opts.customWindows);
  }
  if (opts.customWindows?.length) {
    buckets["custom_window"] = analyzeDim(trades, "custom_window", minTrades, opts.customWindows);
  }

  const heatmaps: Heatmap[] = [
    buildHeatmap(trades, "weekday", "expectancy"),
    buildHeatmap(trades, "weekday", "win_rate"),
    buildHeatmap(trades, "weekday", "trades"),
    buildHeatmap(trades, "session", "expectancy"),
  ];

  const hourWeekday = buckets["hour_weekday"] ?? [];
  const clusters = clusterTimeBuckets(hourWeekday, opts.clusters ?? 4);
  const crossAsset = crossAssetAnalysis(trades, "hour_ist", 5);

  const allBuckets = Object.values(buckets).flat();
  const robustnessTop = [...allBuckets].sort((a, b) => b.robustness - a.robustness).slice(0, 15);
  const hiddenEdges = allBuckets
    .filter((b) => b.expectancy > 0 && b.confidence >= 0.9 && b.trades >= minTrades)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10);
  const warnings = allBuckets
    .filter((b) => b.expectancy < 0 && b.confidence >= 0.9 && b.trades >= minTrades)
    .sort((a, b) => a.expectancy - b.expectancy)
    .slice(0, 10);

  const totalSymbols = Array.from(new Set(trades.map((t) => t.symbol)));
  const totalStrategies = Array.from(new Set(trades.map((t) => t.strategyId)));
  const headlineSummary = buildHeadline(trades.length, robustnessTop, hiddenEdges, warnings);

  return {
    totalTrades: trades.length,
    totalSymbols, totalStrategies,
    buckets, heatmaps, clusters, crossAsset,
    robustnessTop, hiddenEdges, warnings,
    headlineSummary,
    generatedAt: Date.now(),
  };
}

function buildHeadline(
  total: number,
  robustnessTop: BucketMetrics[],
  hidden: BucketMetrics[],
  warnings: BucketMetrics[],
): string {
  if (!total) return "No trades in the current dataset.";
  const bits: string[] = [`Analyzed ${total.toLocaleString()} trades.`];
  const best = robustnessTop[0];
  if (best) bits.push(`Strongest edge: ${best.label} (robustness ${best.robustness}/100, expectancy ${best.expectancy.toFixed(2)} across ${best.trades} trades).`);
  if (hidden.length) bits.push(`${hidden.length} statistically significant edges found (p<0.10).`);
  if (warnings.length) bits.push(`${warnings.length} loss-generating windows to avoid.`);
  return bits.join(" ");
}
