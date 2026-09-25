import { getPool } from "@/lib/db-admin.server";
import { runOptimizer } from "@/lib/strategy/optimizer.server";
import { executeSmokeTest } from "./smoke";
import { MAX_ATTEMPTS } from "./worker-policy";

type ComputeJob = {
  id: string;
  job_type: string;
  payload: unknown;
};

let lastSchemaWarningAt = 0;
let stopping = false;

async function claimNextJob() {
  const pool = await getPool();

  try {
    // Requeue abandoned worker claims so a task replacement does not strand jobs.
    await pool.query(
      `UPDATE public.compute_jobs
       SET status='queued', error=NULL
           ,started_at=NULL
       WHERE status='running'
         AND started_at < now() - interval '2 hours'
         AND attempts < ${MAX_ATTEMPTS}`,
    );

    const { rows } = await pool.query<ComputeJob>(
      `WITH next_job AS (
         SELECT id
         FROM public.compute_jobs
         WHERE status='queued'
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE public.compute_jobs j
       SET status='running',
           attempts=j.attempts + 1,
           started_at=COALESCE(j.started_at, now()),
           error=NULL
       FROM next_job
       WHERE j.id=next_job.id
       RETURNING j.id, j.job_type, j.payload`,
    );

    return rows[0] ?? null;
  } catch (error) {
    if ((error as { code?: string })?.code === "42P01") {
      const now = Date.now();
      if (now - lastSchemaWarningAt > 30_000) {
        lastSchemaWarningAt = now;
        console.warn("[compute-worker] compute_jobs table is not ready yet; retrying");
      }
      return null;
    }
    throw error;
  }
}

async function processJob(job: ComputeJob) {
  const pool = await getPool();

  try {
    let result: unknown;
    switch (job.job_type) {
      case "strategy_optimizer":
        result = await runOptimizer(job.payload);
        break;
      case "smoke_test":
        result = executeSmokeTest(job.payload);
        break;
      default:
        throw new Error(`Unsupported compute job type: ${job.job_type}`);
    }

    await pool.query(
      `UPDATE public.compute_jobs
       SET status='succeeded', result=$2::jsonb, completed_at=now(), error=NULL
       WHERE id=$1`,
      [job.id, JSON.stringify(result)],
    );
    console.log(`[compute-worker] completed ${job.job_type} job ${job.id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await pool.query(
      `UPDATE public.compute_jobs
       SET status=CASE WHEN attempts < ${MAX_ATTEMPTS} THEN 'queued' ELSE 'failed' END,
           error=$2,
           started_at=CASE WHEN attempts < ${MAX_ATTEMPTS} THEN NULL ELSE started_at END,
           completed_at=CASE WHEN attempts < ${MAX_ATTEMPTS} THEN NULL ELSE now() END
       WHERE id=$1`,
      [job.id, message.slice(0, 4000)],
    );
    console.error(`[compute-worker] failed ${job.id}`, error);
  }
}

async function main() {
  console.log("[compute-worker] starting DB-polled research worker");
  const pollMs = 2000;

  process.once("SIGTERM", () => {
    stopping = true;
    console.log("[compute-worker] shutdown requested; finishing current job");
  });
  process.once("SIGINT", () => {
    stopping = true;
    console.log("[compute-worker] interrupt requested; finishing current job");
  });

  while (!stopping) {
    const job = await claimNextJob();
    if (job) {
      await processJob(job);
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  console.log("[compute-worker] stopped");
}

await main();
