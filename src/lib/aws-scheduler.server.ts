// In-container scheduler for AWS. Replaces the old database cron jobs.
// Runs only when DATA_BACKEND=aws; each job stays off until its switch is "true".
const JOBS = [
  { path: "/api/public/hooks/live-tick", everyMs: 60_000, flag: "SCHEDULE_LIVE" },
  { path: "/api/public/hooks/paper-tick", everyMs: 60_000, flag: "SCHEDULE_PAPER" },
  { path: "/api/public/hooks/strategy-tick", everyMs: 60_000, flag: "SCHEDULE_STRATEGY" },
  { path: "/api/public/hooks/live-watchdog", everyMs: 30 * 60_000, flag: "SCHEDULE_WATCHDOG" },
];

let started = false;

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
        const r = await fetch(base + job.path, { method: "POST", headers: { "x-scheduler-secret": secret } });
        if (!r.ok) console.error(`[scheduler] ${job.path} -> ${r.status} ${(await r.text()).slice(0, 300)}`);
      } catch (e) {
        console.error(`[scheduler] ${job.path} failed`, e);
      } finally {
        running = false;
      }
    }, job.everyMs);
    console.log(`[scheduler] ${job.path} every ${job.everyMs / 1000}s`);
  }
}
