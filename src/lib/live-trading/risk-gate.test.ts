import { describe, expect, it } from "vitest";
import { evaluatePortfolioRisk } from "./risk-gate";

const limits = {
  maxOpenPositions: 3,
  maxDailyTrades: 20,
  maxDailyLossUsd: 300,
  maxTotalOpenRiskUsd: 100,
  maxConsecutiveLosses: 6,
};

const clean = {
  openPositions: 0,
  dailyTrades: 0,
  dailyPnlUsd: 0,
  openRiskUsd: 0,
  consecutiveLosses: 0,
};

describe("portfolio risk gate", () => {
  it("allows a clean candidate inside all limits", () => {
    expect(evaluatePortfolioRisk(clean, limits, 20)).toEqual({ allowed: true, reason: null });
  });

  it("blocks a new entry after the daily loss limit", () => {
    expect(evaluatePortfolioRisk({ ...clean, dailyPnlUsd: -300 }, limits, 20).reason)
      .toBe("portfolio_max_daily_loss");
  });

  it("blocks when reserved risk would exceed the portfolio cap", () => {
    expect(evaluatePortfolioRisk({ ...clean, openRiskUsd: 90 }, limits, 20).reason)
      .toBe("portfolio_max_open_risk");
  });

  it("blocks after the consecutive-loss limit", () => {
    expect(evaluatePortfolioRisk({ ...clean, consecutiveLosses: 6 }, limits, 20).reason)
      .toBe("portfolio_max_consecutive_losses");
  });

  it("fails closed for invalid candidate risk", () => {
    expect(evaluatePortfolioRisk(clean, limits, 0).reason).toBe("invalid_candidate_risk");
  });
});
