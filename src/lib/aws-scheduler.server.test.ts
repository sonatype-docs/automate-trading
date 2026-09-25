import { describe, expect, it, vi } from "vitest";
import { withSchedulerJobLock } from "./aws-scheduler.server";

function fakeClient(locked: boolean) {
  const queries: string[] = [];
  const client = {
    query: vi.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.includes("pg_try_advisory_xact_lock")) return { rows: [{ locked }] };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { client, queries };
}

describe("withSchedulerJobLock", () => {
  it("runs the task only when the advisory lock is acquired", async () => {
    const { client, queries } = fakeClient(true);
    const task = vi.fn(async () => undefined);

    const acquired = await withSchedulerJobLock(
      "/api/public/hooks/live-tick",
      task,
      async () => client as never,
    );

    expect(acquired).toBe(true);
    expect(task).toHaveBeenCalledTimes(1);
    expect(queries).toEqual(["BEGIN", "SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked", "COMMIT"]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("skips the task and rolls back when another task owns the lock", async () => {
    const { client, queries } = fakeClient(false);
    const task = vi.fn(async () => undefined);

    const acquired = await withSchedulerJobLock(
      "/api/public/hooks/live-tick",
      task,
      async () => client as never,
    );

    expect(acquired).toBe(false);
    expect(task).not.toHaveBeenCalled();
    expect(queries).toEqual(["BEGIN", "SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked", "ROLLBACK"]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("rolls back and releases the client when the task fails", async () => {
    const { client, queries } = fakeClient(true);
    const task = vi.fn(async () => {
      throw new Error("boom");
    });

    await expect(
      withSchedulerJobLock(
        "/api/public/hooks/live-tick",
        task,
        async () => client as never,
      ),
    ).rejects.toThrow("boom");

    expect(queries).toContain("ROLLBACK");
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
