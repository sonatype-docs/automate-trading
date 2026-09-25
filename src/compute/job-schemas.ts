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
