import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  BacktestJobSchema,
  ComputeSmokeTestSchema,
  PipelineBatchJobSchema,
  StrategyOptimizerJobSchema,
} from "@/compute/job-schemas";
import { requireAuth } from "./auth-middleware";
import { getPool } from "./db-admin.server";
import { presignS3Url } from "./s3-presign.server";

export {
  BacktestJobSchema,
  ComputeSmokeTestSchema,
  PipelineBatchJobSchema,
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

export const submitPipelineBatchJob = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((raw) => PipelineBatchJobSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const pool = await getPool();
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO public.compute_jobs (user_id, job_type, status, payload)
       VALUES ($1, 'pipeline_batch', 'queued', $2::jsonb) RETURNING id`,
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
      `SELECT id, job_type, status, result, result_s3_key, result_size_bytes, error, attempts, created_at, started_at, completed_at
       FROM public.compute_jobs
       WHERE id=$1 AND user_id=$2
       LIMIT 1`,
      [data.job_id, userId],
    );
    if (!rows[0]) throw new Response("Not Found", { status: 404 });
    return rows[0];
  });

export const getComputeArtifactUrl = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((raw) => z.object({ job_id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const pool = await getPool();
    const { rows } = await pool.query<{ result_s3_key: string | null }>(
      `SELECT result_s3_key FROM public.compute_jobs WHERE id=$1 AND user_id=$2 LIMIT 1`,
      [data.job_id, userId],
    );
    const key = rows[0]?.result_s3_key;
    if (!key) throw new Response("Artifact Not Found", { status: 404 });
    const bucket = process.env.QUANT_ARTIFACTS_BUCKET;
    if (!bucket) throw new Error("QUANT_ARTIFACTS_BUCKET is not configured");
    return {
      url: await presignS3Url({
        method: "GET",
        bucket,
        key,
        region: process.env.AWS_REGION ?? "ap-southeast-2",
        expiresSeconds: 600,
      }),
      expires_in: 600,
    };
  });
