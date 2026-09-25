import { createHash } from "node:crypto";
import { getPool } from "@/lib/db-admin.server";
import { presignS3Url } from "@/lib/s3-presign.server";
import { runOptimizer } from "@/lib/strategy/optimizer.server";
import { executeSmokeTest } from "./smoke";
import { MAX_ATTEMPTS } from "./worker-policy";
import { BacktestJobSchema, StrategyOptimizerJobSchema } from "./job-schemas";

type ComputeJob = {
  id: string;
  user_id: string;
  job_type: string;
  payload: unknown;
};

const INLINE_RESULT_LIMIT = 512_000;

async function persistResult(job: ComputeJob, result: unknown) {
  const serialized = JSON.stringify(result);
  const size = Buffer.byteLength(serialized, "utf8");
  if (size <= INLINE_RESULT_LIMIT) {
    return { resultJson: serialized, s3Key: null as string | null, size };
  }

  const bucket = process.env.QUANT_ARTIFACTS_BUCKET;
  const region = process.env.AWS_REGION ?? "ap-southeast-2";
  if (!bucket) throw new Error("QUANT_ARTIFACTS_BUCKET is not configured for the compute worker");
  const s3Key = `private/accounts/${job.user_id}/compute/${job.id}.json`;
  const url = await presignS3Url({ method: "PUT", bucket, key: s3Key, region, expiresSeconds: 600 });
  const upload = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: serialized,
    signal: AbortSignal.timeout(120_000),
  });
  if (!upload.ok) throw new Error(`compute artifact upload failed: ${upload.status}`);
  const digest = createHash("sha256").update(serialized).digest("hex");
  return {
    resultJson: JSON.stringify({ artifact: { s3_key: s3Key, size_bytes: size, sha256: digest } }),
    s3Key,
    size,
  };
}

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
         RETURNING j.id, j.user_id, j.job_type, j.payload`,
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
        {
          const payload = StrategyOptimizerJobSchema.parse(job.payload);
          result = await runOptimizer({
            strategy: payload.strategy,
            symbol: payload.symbol,
            windows: payload.windows,
            slRiskUsd: payload.sl_risk_usd,
            skipWeekdays: payload.skip_weekdays,
            population: payload.population,
            generations: payload.generations,
            topN: payload.top_n,
          });
        }
        break;
      case "smoke_test":
        result = executeSmokeTest(job.payload);
        break;
      case "backtest": {
        const payload = BacktestJobSchema.parse(job.payload);
        const { runBacktestRange } = await import("@/lib/strategy/backtest-range.server");
        result = await runBacktestRange({
          symbol: payload.symbol,
          sessionStartIst: payload.sessionStartIst,
          slRiskUsd: payload.slRiskUsd,
          rr: payload.rr,
          days: payload.days,
          dataSource: payload.dataSource,
          skipWeekdays: payload.skipWeekdays as (0 | 1 | 2 | 3 | 4 | 5 | 6)[] | undefined,
        });
        break;
      }
      default:
        throw new Error(`Unsupported compute job type: ${job.job_type}`);
    }

    const persisted = await persistResult(job, result);
    await pool.query(
      `UPDATE public.compute_jobs
       SET status='succeeded', result=$2::jsonb, result_s3_key=$3, result_size_bytes=$4,
           completed_at=now(), error=NULL
       WHERE id=$1`,
      [job.id, persisted.resultJson, persisted.s3Key, persisted.size],
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
