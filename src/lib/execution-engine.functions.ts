// Server functions — synchronous execution for a single run and queued execution for matrix work.
import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "./auth-middleware";
import { getPool } from "./db-admin.server";
import { ExecutionEngineInputSchema, runExecutionEngineCore, type RunExecutionResult } from "./execution-engine/core.server";
export type { RunExecutionResult };

export { ExecutionEngineInputSchema } from "./execution-engine/core.server";
export type { ExecutionEngineInput } from "./execution-engine/core.server";

export const runExecutionEngine = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((raw) => ExecutionEngineInputSchema.parse(raw))
  .handler(async ({ data }): Promise<RunExecutionResult> => runExecutionEngineCore(data));

export const submitExecutionEngineJob = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((raw) => ExecutionEngineInputSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const pool = await getPool();
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO public.compute_jobs (user_id, job_type, status, payload)
       VALUES ($1, 'execution_engine', 'queued', $2::jsonb)
       RETURNING id`,
      [userId, JSON.stringify(data)],
    );
    return { job_id: rows[0].id, status: "queued" as const };
  });
