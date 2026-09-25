import { describe, expect, it } from "vitest";
import { ABANDONED_AFTER_MS, MAX_ATTEMPTS, failureStatus, isAbandoned, shouldRequeue } from "./worker-policy";

describe("compute worker recovery policy", () => {
  it("requeues only before the maximum attempt", () => {
    expect(MAX_ATTEMPTS).toBe(3);
    expect(shouldRequeue(1)).toBe(true);
    expect(shouldRequeue(2)).toBe(true);
    expect(shouldRequeue(3)).toBe(false);
    expect(failureStatus(2)).toBe("queued");
    expect(failureStatus(3)).toBe("failed");
  });

  it("identifies abandoned claims after the recovery window", () => {
    const now = new Date("2026-09-25T12:00:00.000Z");
    expect(isAbandoned(new Date(now.getTime() - ABANDONED_AFTER_MS - 1), now)).toBe(true);
    expect(isAbandoned(new Date(now.getTime() - ABANDONED_AFTER_MS + 1), now)).toBe(false);
    expect(isAbandoned(null, now)).toBe(false);
  });
});
