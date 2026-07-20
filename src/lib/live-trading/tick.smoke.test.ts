// Live-sync smoke test.
//
// Regression guard for the bug where the live tick ignored still-valid
// pending LIMIT signals from the strategy engine because it only looked at
// `eres.trades` (already simulated fills). This test builds a synthetic
// strategy/execution result with a pending LIMIT in `openOrders`, asserts
// that `pickLiveEntryCandidate` picks it as an entry candidate, and then
// drives `placeWithMarginRetry` with a mocked Shark client to verify the
// candidate is actually submitted to the exchange on the next tick.
import { describe, it, expect, vi } from "vitest";
import {
  pickLiveEntryCandidate,
  placeWithMarginRetry,
} from "./tick.server";
import type { Order } from "@/lib/execution-engine/types";
import type { StrategySignal } from "@/lib/strategy-engine/types";

const runner = {
  id: "r1",
  label: "TEST",
  source: "shark",
  symbol: "BTCUSDT",
  timeframe: "5m",
  strategy_preset: "turtle_s1",
  exec_preset: "default",
  risk_usd: 10,
  lookback_days: 30,
  leverage: 150,
  direction_filter: null,
  window_start_hour_ist: null,
  window_end_hour_ist: null,
  weekdays_ist: null,
};

function makePendingLimit(overrides: Partial<Order> = {}): Order {
  return {
    orderId: "o-1",
    signalId: "sig-1",
    strategyId: "turtle_s1",
    symbol: "BTCUSDT",
    side: "buy",
    kind: "limit",
    triggerPrice: 63662.17,
    stopPrice: 63725.9,
    targetPrice: 63500.0,
    targetLegs: [],
    units: 1,
    remainingUnits: 1,
    createdTs: Date.now() - 60_000,
    expiryTs: null,
    expiryBars: null,
    status: "pending",
    fillPrice: null,
    filledTs: null,
    fillDelayBars: null,
    metadata: {},
    ...overrides,
  };
}

function makeSignal(id: string, ts: number): StrategySignal {
  return {
    signalId: id,
    strategyId: "turtle_s1",
    symbol: "BTCUSDT",
    timeframe: "5m",
    direction: "long",
    type: "entry",
    timestamp: ts,
    entryPrice: 63662.17,
    stopPrice: 63725.9,
    targetPrice: 63500.0,
    expiryTs: null,
  } as unknown as StrategySignal;
}

describe("live-sync smoke: pending openOrders → Shark submission", () => {
  it("picks a still-valid pending LIMIT from openOrders (regression: old code returned null)", () => {
    const now = Date.now();
    const order = makePendingLimit({ createdTs: now - 60_000 });
    const sres = { signals: [makeSignal("sig-1", now - 60_000)] } as never;
    const eres = { openOrders: [order], trades: [] } as never;

    const candidate = pickLiveEntryCandidate(runner as never, sres, eres, now);

    expect(candidate).not.toBeNull();
    expect(candidate!.source).toBe("pending_limit");
    expect(candidate!.direction).toBe("long");
    expect(candidate!.entryPrice).toBe(63662.17);
    expect(candidate!.signalId).toBe("sig-1");
  });

  it("skips stale pending orders past maxAge", () => {
    const now = Date.now();
    const staleTs = now - 60 * 60 * 1000; // 60 min old, tf=5m → maxAge=15min
    const order = makePendingLimit({ createdTs: staleTs });
    const sres = { signals: [makeSignal("sig-1", staleTs)] } as never;
    const eres = { openOrders: [order], trades: [] } as never;

    expect(pickLiveEntryCandidate(runner as never, sres, eres, now)).toBeNull();
  });

  it("next tick: candidate is submitted to Shark as a LIMIT order with candidate price/side/qty", async () => {
    const now = Date.now();
    const order = makePendingLimit({ createdTs: now - 60_000 });
    const sres = { signals: [makeSignal("sig-1", now - 60_000)] } as never;
    const eres = { openOrders: [order], trades: [] } as never;

    const candidate = pickLiveEntryCandidate(runner as never, sres, eres, now);
    expect(candidate).not.toBeNull();

    const placeOrder = vi.fn(async () => ({
      status: "pending" as const,
      exchangeOrderId: "shark-123",
      filledPrice: null,
      raw: {},
    }));
    const getLastPrice = vi.fn(async () => 63662);
    const client = { placeOrder, getLastPrice } as never;

    const stopDist = Math.abs(candidate!.stopPrice - candidate!.entryPrice);
    const qty = Number((10 / stopDist).toFixed(3));

    const result = await placeWithMarginRetry(client, {
      symbol: runner.symbol,
      side: candidate!.direction === "long" ? "buy" : "sell",
      qty,
      price: candidate!.entryPrice,
      stopDist,
      riskUsd: runner.risk_usd,
      minRiskUsd: 10,
    });

    expect(placeOrder).toHaveBeenCalledTimes(1);
    expect(placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "BTCUSDT",
        side: "buy",
        type: "limit",
        price: 63662.17,
      }),
    );
    expect(result.res.exchangeOrderId).toBe("shark-123");
  });
});
