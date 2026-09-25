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

async function assertOwner(userId: string) {
  const pool = await getPool();
  const { rows } = await pool.query<{ user_id: string }>(
    "SELECT user_id FROM public.owner WHERE id = true LIMIT 1",
  );
  if (rows[0]?.user_id && rows[0].user_id !== userId) {
    throw new Response("Forbidden", { status: 403 });
  }
  if (!rows[0]?.user_id) {
    await pool.query(
      "INSERT INTO public.owner (id, user_id) VALUES (true, $1) ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id",
      [userId],
    );
  }
}

export async function enqueueStrategyOptimizer(userId: string, payload: z.infer<typeof StrategyOptimizerJobSchema>) {
  await assertOwner(userId);
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
