// Time Edge Discovery Engine — public types.
// Pure. Consumes TradeRecord[] from the Trade Intelligence DB / IndexedDB cache.

import type { TradeRecord } from "@/lib/trade-intelligence/types";

export type BucketDim =
  | "hour_ist"
  | "hour_utc"
  | "weekday"
  | "month"
  | "quarter"
  | "session"
  | "symbol"
  | "hour_weekday"
  | "session_weekday"
  | "custom_window";

export interface CustomWindow {
  label: string;
  startMinutesIst: number;
  endMinutesIst: number;
}

export interface BucketMetrics {
  key: string;
  label: string;
  dim: BucketDim;
  trades: number;
  wins: number;
  losses: number;
  netProfit: number;
  grossProfit: number;
  grossLoss: number;
  winRate: number;
  profitFactor: number;
  expectancy: number;
  avgRr: number;
  avgWin: number;
  avgLoss: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  ulcerIndex: number;
  recoveryFactor: number;
  avgHoldingBars: number;
  medianHoldingBars: number;
  // significance vs the rest of the population
  pValueMean: number;
  pValueWin: number;
  confidence: number; // 1 - min(p)
  // robustness 0..100
  robustness: number;
  // context
  symbols: string[];
  strategies: string[];
}

export interface HeatmapCell {
  x: string;
  y: string;
  value: number;
  trades: number;
}

export interface Heatmap {
  metric: HeatmapMetric;
  xLabel: string;
  yLabel: string;
  xs: string[];
  ys: string[];
  cells: HeatmapCell[];
}

export type HeatmapMetric =
  | "net_profit"
  | "profit_factor"
  | "win_rate"
  | "expectancy"
  | "sharpe"
  | "trades";

export interface TimeCluster {
  index: number;
  size: number;
  bucketKeys: string[];
  centroid: { winRate: number; expectancy: number; profitFactor: number; sharpe: number };
  aggregate: BucketMetrics;
  label: string;
}

export interface CrossAssetRow {
  bucketKey: string;
  label: string;
  symbolStats: Record<string, { trades: number; netProfit: number; winRate: number; profitFactor: number }>;
  consistencyScore: number; // 0..1 fraction of symbols with positive expectancy
  universalScore: number;   // 0..100 blended
}

export interface TimeEdgeReport {
  totalTrades: number;
  totalSymbols: string[];
  totalStrategies: string[];
  buckets: Record<BucketDim, BucketMetrics[]>;
  heatmaps: Heatmap[];
  clusters: TimeCluster[];
  crossAsset: CrossAssetRow[];
  robustnessTop: BucketMetrics[];
  hiddenEdges: BucketMetrics[];
  warnings: BucketMetrics[];
  headlineSummary: string;
  generatedAt: number;
}

export interface AnalyzeOptions {
  minTrades?: number;
  clusters?: number;
  customWindows?: CustomWindow[];
  includeDims?: BucketDim[];
}

export type { TradeRecord };
