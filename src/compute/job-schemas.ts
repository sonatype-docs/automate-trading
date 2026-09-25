import { z } from "zod";

export const StrategyOptimizerJobSchema = z.object({
  strategy: z.enum(["silver_bullet", "asian_sweep", "orb_sessions"]),
  symbol: z.string().min(3).max(24),
  windows: z.array(z.number().int().min(15).max(730)).min(1).max(5),
  sl_risk_usd: z.number().positive(),
  skip_weekdays: z.array(z.number().int().min(0).max(6)).max(7),
  population: z.number().int().min(20).max(120).optional(),
  generations: z.number().int().min(5).max(60).optional(),
  top_n: z.number().int().min(5).max(50).optional(),
});

export const ComputeSmokeTestSchema = z.object({
  operation: z.literal("sum"),
  values: z.array(z.number().finite()).min(1).max(100),
});

export const BacktestJobSchema = z.object({
  symbol: z
    .string()
    .min(3)
    .max(24)
    .regex(/^[A-Z0-9_-]+$/),
  sessionStartIst: z.string().regex(/^\d{2}:\d{2}$/),
  slRiskUsd: z.number().positive().max(1_000_000),
  rr: z.number().positive().max(100),
  days: z.number().int().min(1).max(730),
  dataSource: z.enum(["shark", "yahoo"]).optional(),
  skipWeekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
});

export const PipelineBatchJobSchema = z.object({
  source: z.enum(["yahoo", "shark"]).default("shark"),
  symbol: z.string().min(1).max(24),
  timeframe: z.string().min(1).max(8),
  displayTimezone: z.string().min(1).max(64).default("IST"),
  strategyTimezone: z.string().min(1).max(64).default("London"),
  fromMs: z.number().finite(),
  toMs: z.number().finite(),
  combos: z.array(z.object({ strategyPresetId: z.string(), execPresetId: z.string() })).min(1).max(48),
  tags: z.array(z.string()).optional(),
  riskUsdOverride: z.number().positive().optional(),
  snapshotName: z.string().min(1).max(120).optional(),
});

export const ResearchAnalyticsJobSchema = z.object({
  features: z.array(z.record(z.string(), z.unknown())).min(1).max(20_000),
  runs: z.number().int().min(100).max(10_000).default(2_000),
  folds: z.number().int().min(2).max(10).default(5),
});

export { LiquidityMatrixJobSchema } from "@/lib/liquidity-matrix.core";

export const TimeEdgeValidationJobSchema = z.object({
  bucketRows: z.array(z.record(z.string(), z.unknown())).max(20_000),
  population: z.array(z.record(z.string(), z.unknown())).max(20_000),
  iterations: z.number().int().min(100).max(10_000).default(1_500),
  bootstrapIterations: z.number().int().min(100).max(10_000).default(800),
  folds: z.number().int().min(2).max(10).default(5),
});

export const OptimizerSearchJobSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(20_000),
  method: z.enum(["grid", "random", "genetic", "bayesian", "pso", "annealing"]),
  dims: z.array(z.record(z.string(), z.unknown())).min(1).max(20),
  objective: z.object({
    key: z.string().min(1),
    formula: z.string().optional(),
    minTrades: z.number().int().min(1).max(100_000),
  }),
  budget: z.number().int().min(10).max(100_000),
});
