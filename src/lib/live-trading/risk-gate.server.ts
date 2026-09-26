import { supabaseAdmin } from "@/lib/db-admin.server";
import {
  evaluatePortfolioRisk,
  type PortfolioRiskLimits,
  type PortfolioRiskSnapshot,
} from "./risk-gate";

const n = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export function getPortfolioRiskLimits(): PortfolioRiskLimits {
  return {
    maxOpenPositions: Math.floor(n(process.env.LIVE_MAX_OPEN_POSITIONS, 3)),
    maxDailyTrades: Math.floor(n(process.env.LIVE_MAX_DAILY_TRADES, 20)),
    maxDailyLossUsd: n(process.env.LIVE_MAX_DAILY_LOSS_USD, 300),
    maxTotalOpenRiskUsd: n(process.env.LIVE_MAX_TOTAL_RISK_USD, 100),
    maxConsecutiveLosses: Math.floor(n(process.env.LIVE_MAX_CONSECUTIVE_LOSSES, 6)),
  };
}

export async function getPortfolioRiskSnapshot(now = new Date()): Promise<PortfolioRiskSnapshot> {
  const startOfDay = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  )).toISOString();

  const [{ data: trades, error: tradeError }, { data: runners, error: runnerError }] = await Promise.all([
    supabaseAdmin
      .from("live_trades")
      .select("runner_id,status,qty,entry_price,stop_price,exit_ts,net_pnl")
      .in("status", ["open", "pending", "closed"])
      .order("exit_ts", { ascending: false, nullsFirst: false })
      .limit(1000),
    supabaseAdmin
      .from("live_runners")
      .select("id,risk_usd"),
  ]);
  if (tradeError) throw new Error("Portfolio risk trade query failed: " + tradeError.message);
  if (runnerError) throw new Error("Portfolio risk runner query failed: " + runnerError.message);

  const riskByRunner = new Map<string, number>(
    (runners ?? []).map((r) => [String(r.id), Math.max(0, Number(r.risk_usd) || 0)]),
  );
  const rows = trades ?? [];

  const active = rows.filter((row) => row.status === "open" || row.status === "pending");
  const closedToday = rows.filter(
    (row) => row.status === "closed" && typeof row.exit_ts === "string" && row.exit_ts >= startOfDay,
  );

  let dailyPnlUsd = 0;
  for (const row of closedToday) dailyPnlUsd += Number(row.net_pnl) || 0;

  let consecutiveLosses = 0;
  for (const row of rows) {
    if (row.status !== "closed" || !row.exit_ts) continue;
    const pnl = Number(row.net_pnl) || 0;
    if (pnl < 0) consecutiveLosses++;
    else break;
  }

  const openRiskUsd = active.reduce(
    (sum, row) => sum + (riskByRunner.get(String(row.runner_id)) ?? 0),
    0,
  );

  return {
    openPositions: active.length,
    dailyTrades: closedToday.length,
    dailyPnlUsd,
    openRiskUsd,
    consecutiveLosses,
  };
}

export async function evaluateLivePortfolioEntry(candidateRiskUsd: number): Promise<{
  allowed: boolean;
  reason: string | null;
  snapshot: PortfolioRiskSnapshot;
  limits: PortfolioRiskLimits;
}> {
  const [snapshot, limits] = await Promise.all([
    getPortfolioRiskSnapshot(),
    Promise.resolve(getPortfolioRiskLimits()),
  ]);
  const decision = evaluatePortfolioRisk(snapshot, limits, candidateRiskUsd);
  return { ...decision, snapshot, limits };
}
