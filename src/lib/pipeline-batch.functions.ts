import { createServerFn } from "@tanstack/react-start";
import { PipelineBatchJobSchema } from "@/compute/job-schemas";
import { requireAuth } from "./auth-middleware";
import { getPool } from "./db-admin.server";
import {
  runComboBatchCore,
  type BatchComboResult,
  type BatchResult,
} from "./pipeline-batch.core";

export { PipelineBatchJobSchema, runComboBatchCore };
export type { BatchComboResult, BatchResult };

export const runComboBatch = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((raw) => PipelineBatchJobSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const pool = await getPool();
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO public.compute_jobs (user_id, job_type, status, payload)
       VALUES ($1, 'pipeline_batch', 'queued', $2::jsonb)
       RETURNING id`,
      [userId, JSON.stringify(data)],
    );
    return { job_id: rows[0].id, status: "queued" as const };
  });
