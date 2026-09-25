import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "./auth-middleware";
import { getPool } from "./db-admin.server";

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
  symbol: z.string().min(3).max(24).regex(/^[A-Z0-9_-]+$/),
  sessionStartIst: z.string().regex(/^\d{2}:\d{2}$/),
  slRiskUsd: z.number().positive().max(1_000_000),
  rr: z.number().positive().max(100),
  days: z.number().int().min(1).max(730),
  dataSource: z.enum(["shark", "yahoo"]).optional(),
  skipWeekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
});

export async function enqueueStrategyOptimizer(userId: string, payload: z.infer<typeof StrategyOptimizerJobSchema>) {
  const pool = await getPool();
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO public.compute_jobs (user_id, job_type, status, payload)
     VALUES ($1, 'strategy_optimizer', 'queued', $2::jsonb)
     RETURNING id`,
    [userId, JSON.stringify(payload)],
  );
  const jobId = rows[0].id;
  return { job_id: jobId, status: "queued" as const };
}

export const submitStrategyOptimizer = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((raw) => StrategyOptimizerJobSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    return enqueueStrategyOptimizer(userId, data);
  });

export async function enqueueSmokeTest(userId: string, payload: z.infer<typeof ComputeSmokeTestSchema>) {
  const pool = await getPool();
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO public.compute_jobs (user_id, job_type, status, payload)
     VALUES ($1, 'smoke_test', 'queued', $2::jsonb)
     RETURNING id`,
    [userId, JSON.stringify(payload)],
  );
  return { job_id: rows[0].id, status: "queued" as const };
}

export const submitComputeSmokeTest = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((raw) => ComputeSmokeTestSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    return enqueueSmokeTest(userId, data);
  });

export const submitBacktestJob = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((raw) => BacktestJobSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const pool = await getPool();
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO public.compute_jobs (user_id, job_type, status, payload)
       VALUES ($1, 'backtest', 'queued', $2::jsonb)
       RETURNING id`,
      [userId, JSON.stringify(data)],
    );
    return { job_id: rows[0].id, status: "queued" as const };
  });

export const getComputeJob = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((raw) => z.object({ job_id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const pool = await getPool();
    const { rows } = await pool.query(
      `SELECT id, job_type, status, result, error, attempts, created_at, started_at, completed_at
       FROM public.compute_jobs
       WHERE id=$1 AND user_id=$2
       LIMIT 1`,
      [data.job_id, userId],
    );
    if (!rows[0]) throw new Response("Not Found", { status: 404 });
    return rows[0];
  });
