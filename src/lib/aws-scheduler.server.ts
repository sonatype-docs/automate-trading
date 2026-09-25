import type { PoolClient } from "pg";
import { getPool } from "@/lib/db-admin.server";

// In-container scheduler for AWS. Replaces the old database cron jobs.
// Each job is protected by a transaction-scoped PostgreSQL advisory lock so
// multiple ECS tasks cannot execute the same scheduled job concurrently.
const JOBS = [
  { path: "/api/public/hooks/live-tick", everyMs: 60_000, flag: "SCHEDULE_LIVE" },
  { path: "/api/public/hooks/paper-tick", everyMs: 60_000, flag: "SCHEDULE_PAPER" },
  { path: "/api/public/hooks/strategy-tick", everyMs: 60_000, flag: "SCHEDULE_STRATEGY" },
  { path: "/api/public/hooks/live-watchdog", everyMs: 30 * 60_000, flag: "SCHEDULE_WATCHDOG" },
];

let started = false;

type AcquireClient = () => Promise<PoolClient>;

async function acquireDefaultClient(): Promise<PoolClient> {
  const pool = await getPool();
  return pool.connect();
}

/**
 * Runs a scheduled job while holding a transaction-scoped advisory lock.
 * The lock is released automatically on COMMIT/ROLLBACK and the client is
 * always returned to the pool.
 */
export async function withSchedulerJobLock(
  jobPath: string,
  task: () => Promise<void>,
  acquireClient: AcquireClient = acquireDefaultClient,
): Promise<boolean> {
  const client = await acquireClient();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked",
      [jobPath],
    );
    if (rows[0]?.locked !== true) {
      await client.query("ROLLBACK");
      return false;
    }

    try {
      await task();
      await client.query("COMMIT");
      return true;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original task error if rollback itself fails.
      }
      throw error;
    }
  } finally {
    client.release();
  }
}

export function startAwsScheduler() {
  if (started || typeof process === "undefined" || process.env.DATA_BACKEND !== "aws") return;
  started = true;
  const secret = process.env.SCHEDULER_SECRET;
  const base = `http://127.0.0.1:${process.env.PORT ?? 3000}`;
  if (!secret) {
    console.warn("[scheduler] SCHEDULER_SECRET missing; schedules disabled");
    return;
  }

  for (const job of JOBS) {
    if (process.env[job.flag] !== "true") {
      console.log(`[scheduler] ${job.path} paused (${job.flag}!=true)`);
      continue;
    }

    let running = false;
    setInterval(async () => {
      if (running) return;
      running = true;
      try {
        const acquired = await withSchedulerJobLock(job.path, async () => {
          const r = await fetch(base + job.path, {
            method: "POST",
            headers: { "x-scheduler-secret": secret },
          });
          if (!r.ok) {
            throw new Error(
              `[scheduler] ${job.path} -> ${r.status} ${(await r.text()).slice(0, 300)}`,
            );
          }
        });
        if (!acquired) {
          console.log(`[scheduler] ${job.path} skipped; another task owns the lock`);
        }
      } catch (e) {
        console.error(`[scheduler] ${job.path} failed`, e);
      } finally {
        running = false;
      }
    }, job.everyMs);

    console.log(`[scheduler] ${job.path} every ${job.everyMs / 1000}s`);
  }
}
