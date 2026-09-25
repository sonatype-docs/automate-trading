import { getPool } from "@/lib/db-admin.server";
import { receiveSqsMessage, deleteSqsMessage } from "@/lib/sqs.server";
import { runOptimizer } from "@/lib/strategy/optimizer.server";

type ComputeEnvelope = { jobId: string; jobType: string };

const queueUrl = process.env.COMPUTE_QUEUE_URL;

async function processMessage(message: NonNullable<Awaited<ReturnType<typeof receiveSqsMessage>>>) {
  const envelope = message.body as ComputeEnvelope;
  if (!envelope?.jobId || !envelope?.jobType) throw new Error("Malformed compute job message");

  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT id, job_type, status, payload
     FROM public.compute_jobs
     WHERE id=$1
     LIMIT 1`,
    [envelope.jobId],
  );
  const job = rows[0];
  if (!job) {
    console.warn(`[compute-worker] job ${envelope.jobId} missing; dropping message`);
    return;
  }
  if (job.status === "succeeded") {
    await deleteSqsMessage(queueUrl!, message.receiptHandle);
    return;
  }

  await pool.query(
    `UPDATE public.compute_jobs
     SET status='running', attempts=attempts+1, started_at=COALESCE(started_at, now()), error=NULL
     WHERE id=$1`,
    [envelope.jobId],
  );

  try {
    let result: unknown;
    switch (envelope.jobType) {
      case "strategy_optimizer":
        result = await runOptimizer(job.payload);
        break;
      default:
        throw new Error(`Unsupported compute job type: ${envelope.jobType}`);
    }

    await pool.query(
      `UPDATE public.compute_jobs
       SET status='succeeded', result=$2::jsonb, completed_at=now(), error=NULL
       WHERE id=$1`,
      [envelope.jobId, JSON.stringify(result)],
    );
    await deleteSqsMessage(queueUrl!, message.receiptHandle);
    console.log(`[compute-worker] completed ${envelope.jobType} job ${envelope.jobId}`);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    await pool.query(
      `UPDATE public.compute_jobs SET status='failed', error=$2 WHERE id=$1`,
      [envelope.jobId, messageText.slice(0, 4000)],
    );
    console.error(`[compute-worker] failed ${envelope.jobId}`, error);
    throw error;
  }
}

async function main() {
  if (!queueUrl) throw new Error("COMPUTE_QUEUE_URL is required");
  console.log("[compute-worker] starting");
  while (true) {
    const message = await receiveSqsMessage(queueUrl, 20);
    if (!message) continue;
    try {
      await processMessage(message);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

await main();
