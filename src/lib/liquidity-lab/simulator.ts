// Extracted trade simulator + stats for the Liquidity Lab. Shared between
// the single-config runner and the matrix runner.
import type { EngineRunResult } from "@/lib/strategy-engine/types";

export interface LabTrade {
  ts: number;
  exitTs: number;
  direction: "long" | "short";
  entry: number;
  stop: number;
  target: number;
  outcome: "win" | "loss" | "open";
  rMultiple: number;
  pnlUsd: number;
  barsHeld: number;
}

export interface LabStats {
  trades: number;
  wins: number;
  losses: number;
  open: number;
  winRate: number;
  avgRR: number;
  avgWinR: number;
  avgLossR: number;
  expectancyR: number;
  profitFactor: number;
  totalPnlUsd: number;
  grossWinUsd: number;
  grossLossUsd: number;
  maxDrawdownUsd: number;
  longs: number;
  shorts: number;
  longWinRate: number;
  shortWinRate: number;
}

type SimBar = { ts: number; high: number; low: number };

export function simulateTrades(
  bars: SimBar[],
  signals: EngineRunResult["signals"],
  riskUsd: number,
): { trades: LabTrade[]; labStats: LabStats } {
  const trades: LabTrade[] = [];
  const idxByTs = new Map<number, number>();
  for (let i = 0; i < bars.length; i++) idxByTs.set(bars[i].ts, i);
  const MAX_HOLD = 500;

  for (const s of signals) {
    const startIdx = idxByTs.get(s.timestamp);
    if (startIdx == null) continue;
    const entry = s.entryPrice, stop = s.stopLoss, target = s.takeProfit;
    const long = s.direction === "long";
    const expiryIdx = s.expiryTs ? (idxByTs.get(s.expiryTs) ?? startIdx + 5) : startIdx + 5;

    let fillIdx = -1;
    for (let i = startIdx + 1; i <= Math.min(expiryIdx, bars.length - 1); i++) {
      const b = bars[i];
      if (long ? b.high >= entry : b.low <= entry) { fillIdx = i; break; }
    }
    if (fillIdx < 0) continue;

    let outcome: LabTrade["outcome"] = "open";
    let exitBar = fillIdx;
    for (let i = fillIdx; i < Math.min(bars.length, fillIdx + MAX_HOLD); i++) {
      const b = bars[i];
      const hitSl = long ? b.low <= stop : b.high >= stop;
      const hitTp = long ? b.high >= target : b.low <= target;
      if (hitSl) { outcome = "loss"; exitBar = i; break; }
      if (hitTp) { outcome = "win"; exitBar = i; break; }
    }

    const rDist = Math.abs(entry - stop) || 1;
    const rMultiple = outcome === "win" ? Math.abs(target - entry) / rDist
                    : outcome === "loss" ? -1 : 0;
    trades.push({
      ts: bars[fillIdx].ts, exitTs: bars[exitBar].ts, direction: s.direction,
      entry, stop, target, outcome, rMultiple,
      pnlUsd: outcome === "open" ? 0 : rMultiple * riskUsd,
      barsHeld: exitBar - fillIdx,
    });
  }

  const wins = trades.filter((t) => t.outcome === "win");
  const losses = trades.filter((t) => t.outcome === "loss");
  const open = trades.filter((t) => t.outcome === "open");
  const longs = trades.filter((t) => t.direction === "long");
  const shorts = trades.filter((t) => t.direction === "short");
  const grossWin = wins.reduce((a, t) => a + t.pnlUsd, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnlUsd, 0));
  const closedCount = wins.length + losses.length;

  let eq = 0, peak = 0, maxDd = 0;
  for (const t of trades) {
    eq += t.pnlUsd;
    if (eq > peak) peak = eq;
    if (peak - eq > maxDd) maxDd = peak - eq;
  }

  const avgRR = signals.length ? signals.reduce((a, s) => a + (s.rr || 0), 0) / signals.length : 0;
  const wrOf = (arr: LabTrade[]) => {
    const closed = arr.filter((t) => t.outcome !== "open");
    return closed.length ? (arr.filter((t) => t.outcome === "win").length / closed.length) * 100 : 0;
  };

  const labStats: LabStats = {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    open: open.length,
    winRate: closedCount ? (wins.length / closedCount) * 100 : 0,
    avgRR,
    avgWinR: wins.length ? wins.reduce((a, t) => a + t.rMultiple, 0) / wins.length : 0,
    avgLossR: losses.length ? losses.reduce((a, t) => a + t.rMultiple, 0) / losses.length : 0,
    expectancyR: closedCount
      ? (wins.reduce((a, t) => a + t.rMultiple, 0) + losses.reduce((a, t) => a + t.rMultiple, 0)) / closedCount
      : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? 999 : 0),
    totalPnlUsd: grossWin - grossLoss,
    grossWinUsd: grossWin,
    grossLossUsd: grossLoss,
    maxDrawdownUsd: maxDd,
    longs: longs.length,
    shorts: shorts.length,
    longWinRate: wrOf(longs),
    shortWinRate: wrOf(shorts),
  };
  return { trades, labStats };
}

// Canonical universe of tradable symbols the Lab / Matrix supports.
export const LAB_SYMBOLS = [
  "XAUUSDT", "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT",
  "XRPUSDT", "DOGEUSDT", "AVAXUSDT", "LINKUSDT", "ADAUSDT",
  "MATICUSDT", "LTCUSDT", "DOTUSDT", "TRXUSDT", "ATOMUSDT",
] as const;
export type LabSymbol = (typeof LAB_SYMBOLS)[number];
