export interface PortfolioRiskSnapshot {
  openPositions: number;
  dailyTrades: number;
  dailyPnlUsd: number;
  openRiskUsd: number;
  consecutiveLosses: number;
}

export interface PortfolioRiskLimits {
  maxOpenPositions: number;
  maxDailyTrades: number;
  maxDailyLossUsd: number;
  maxTotalOpenRiskUsd: number;
  maxConsecutiveLosses: number;
}

export interface PortfolioRiskDecision {
  allowed: boolean;
  reason: string | null;
}

export function evaluatePortfolioRisk(
  snapshot: PortfolioRiskSnapshot,
  limits: PortfolioRiskLimits,
  candidateRiskUsd: number,
): PortfolioRiskDecision {
  if (!Number.isFinite(candidateRiskUsd) || candidateRiskUsd <= 0) {
    return { allowed: false, reason: "invalid_candidate_risk" };
  }
  if (snapshot.openPositions >= limits.maxOpenPositions) {
    return { allowed: false, reason: "portfolio_max_open_positions" };
  }
  if (snapshot.dailyTrades >= limits.maxDailyTrades) {
    return { allowed: false, reason: "portfolio_max_daily_trades" };
  }
  if (snapshot.dailyPnlUsd <= -Math.abs(limits.maxDailyLossUsd)) {
    return { allowed: false, reason: "portfolio_max_daily_loss" };
  }
  if (snapshot.consecutiveLosses >= limits.maxConsecutiveLosses) {
    return { allowed: false, reason: "portfolio_max_consecutive_losses" };
  }
  if (snapshot.openRiskUsd + candidateRiskUsd > Math.abs(limits.maxTotalOpenRiskUsd)) {
    return { allowed: false, reason: "portfolio_max_open_risk" };
  }
  return { allowed: true, reason: null };
}
