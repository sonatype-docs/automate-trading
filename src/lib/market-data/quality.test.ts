import { describe, expect, it } from "vitest";
import { runQualityChecks } from "./quality";
import type { RawCandle } from "./types";

const candle = (ts: number, overrides: Partial<RawCandle> = {}): RawCandle => ({
  ts,
  open: 100,
  high: 101,
  low: 99,
  close: 100.5,
  volume: 10,
  ...overrides,
});

describe("market data quality gate", () => {
  it("accepts a clean contiguous series", () => {
    const report = runQualityChecks(
      [candle(0), candle(60_000), candle(120_000)],
      "1m",
    );
    expect(report.usable).toBe(true);
    expect(report.fatalIssues).toBe(0);
    expect(report.gapCandles).toBe(0);
  });

  it("marks malformed OHLC as fatal", () => {
    const report = runQualityChecks(
      [candle(0), candle(60_000, { high: 98 })],
      "1m",
    );
    expect(report.usable).toBe(false);
    expect(report.countsByKind.bad_ohlc).toBe(1);
    expect(report.fatalIssues).toBe(1);
  });

  it("keeps weekend gaps observable without making them fatal", () => {
    const friday = 5 * 86_400_000;
    const sunday = 7 * 86_400_000;
    const report = runQualityChecks(
      [candle(friday), candle(sunday)],
      "1d",
    );
    expect(report.usable).toBe(true);
    expect(report.countsByKind.weekend_gap).toBe(1);
    expect(report.fatalIssues).toBe(0);
  });

  it("marks duplicate timestamps as fatal", () => {
    const report = runQualityChecks(
      [candle(0), candle(60_000), candle(60_000)],
      "1m",
    );
    expect(report.usable).toBe(false);
    expect(report.countsByKind.duplicate).toBe(1);
  });
});
