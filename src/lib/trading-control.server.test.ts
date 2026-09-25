import { beforeEach, describe, expect, it, vi } from "vitest";

const { getPool } = vi.hoisted(() => ({
  getPool: vi.fn(),
}));

vi.mock("@/lib/db-admin.server", () => ({ getPool }));

import { assertLiveTradingEntryEnabled, getGlobalLiveTradingEnabled } from "./trading-control.server";

describe("trading control", () => {
  beforeEach(() => {
    getPool.mockReset();
  });

  it("returns true only when the control row explicitly enables live trading", async () => {
    getPool.mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [{ global_live_enabled: true, mode: "LIVE", kill_switch: false }] }),
    });
    await expect(getGlobalLiveTradingEnabled()).resolves.toBe(true);
    await expect(assertLiveTradingEntryEnabled()).resolves.toBeUndefined();
  });

  it("fails closed when the control row is disabled", async () => {
    getPool.mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [{ global_live_enabled: false }] }),
    });
    await expect(getGlobalLiveTradingEnabled()).resolves.toBe(false);
    await expect(assertLiveTradingEntryEnabled()).rejects.toThrow("Live trading is disabled");
  });

  it("fails closed when the control table cannot be read", async () => {
    getPool.mockResolvedValue({
      query: vi.fn().mockRejectedValue(new Error("database unavailable")),
    });
    await expect(getGlobalLiveTradingEnabled()).resolves.toBe(false);
    await expect(assertLiveTradingEntryEnabled()).rejects.toThrow("Live trading is disabled");
  });

  it("fails closed when the control row is missing", async () => {
    getPool.mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
    });
    await expect(assertLiveTradingEntryEnabled()).rejects.toThrow("Live trading is disabled");
  });
});
