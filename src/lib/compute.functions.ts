import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  BacktestJobSchema,
  ComputeSmokeTestSchema,
  StrategyOptimizerJobSchema,
} from "@/compute/job-schemas";
import { requireAuth } from "./auth-middleware";
import { getPool } from "./db-admin.server";

export {
  BacktestJobSchema,
  ComputeSmokeTestSchema,
  StrategyOptimizerJobSchema,
} from "@/compute/job-schemas";

export async function enqueueStrategyOptimizer(
  userId: string,
  payload: z.infer<typeof StrategyOptimizerJobSchema>,
) {
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

export async function enqueueSmokeTest(
  userId: string,
  payload: z.infer<typeof ComputeSmokeTestSchema>,
) {
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
