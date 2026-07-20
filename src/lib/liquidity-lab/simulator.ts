// Extracted trade simulator + stats for the Liquidity Lab. Shared between
// the single-config runner and the matrix runner.
//
// Realism model (all configurable via `RealismOptions`):
//   • Fees        — maker/taker per DEFAULT_FEE_MODEL (entry LIMIT = maker;
//                   exit MARKET/taker if duration < taker threshold, else LIMIT/maker).
//   • Slippage    — none | fixed points | % of price | ATR × mult. Applied
//                   against the trader on entry AND exit fills.
//   • Intrabar    — conservative (SL first) | optimistic (TP first) |
//                   proximity (whichever level is closer to bar open wins).
//   • Gap-through — if bar opens beyond SL/TP, fill at bar open (never at the
//                   level, since price never traded at the level).
//
// Look-ahead safety: signal `s.timestamp` is the emitting (confirmation) bar.
// Fills are scanned from `startIdx + 1` onward — entry can never occur on
// the confirmation candle itself. No index ever reads `bars[i+1]`.
import type { EngineRunResult } from "@/lib/strategy-engine/types";
import { DEFAULT_FEE_MODEL, type FeeModel } from "@/lib/trade-intelligence/fees";

export interface LabTrade {
  ts: number;
  exitTs: number;
  direction: "long" | "short";
  entry: number;
  stop: number;
  target: number;
  outcome: "win" | "loss" | "open";
  rMultiple: number;
  /** Gross P&L (before fees). */
  pnlUsd: number;
  /** Net P&L (after fees). */
  netPnlUsd: number;
  feesUsd: number;
  barsHeld: number;
  exitPrice: number;
  exitReason: "tp" | "sl" | "open" | "gap_sl" | "gap_tp";
  durationMs: number;
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
  /** Gross P&L (before fees). Kept name for backward compat with existing UI. */
  totalPnlUsd: number;
  /** Net P&L (after fees). */
  netPnlUsd: number;
  totalFeesUsd: number;
  grossWinUsd: number;
  grossLossUsd: number;
  maxDrawdownUsd: number;
  longs: number;
  shorts: number;
  longWinRate: number;
  shortWinRate: number;
}

export type IntrabarMode = "conservative" | "optimistic" | "proximity";
export type SlippageModel = "none" | "fixed_pts" | "pct" | "atr_mult";

export interface SlippageOptions {
  model: SlippageModel;
  /** Points for fixed_pts, percent (0.05 = 0.05%) for pct, multiplier for atr_mult. */
  value: number;
}

export interface RealismOptions {
  intrabar: IntrabarMode;
  slippage: SlippageOptions;
  fees: FeeModel;
}

export const DEFAULT_REALISM: RealismOptions = {
  intrabar: "conservative",
  slippage: { model: "none", value: 0 },
  fees: DEFAULT_FEE_MODEL,
};

type SimBar = { ts: number; open?: number; high: number; low: number; close?: number; atr?: number | null };

function slippagePoints(bar: SimBar, opts: SlippageOptions): number {
  const px = bar.close ?? bar.open ?? (bar.high + bar.low) / 2;
  switch (opts.model) {
    case "none": return 0;
    case "fixed_pts": return Math.max(0, opts.value);
    case "pct": return Math.max(0, px * (opts.value / 100));
    case "atr_mult": return Math.max(0, (bar.atr ?? 0) * opts.value);
  }
}

export function simulateTrades(
  bars: SimBar[],
  signals: EngineRunResult["signals"],
  riskUsd: number,
  realism: RealismOptions = DEFAULT_REALISM,
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

    // Locate entry-fill bar. Must be strictly AFTER the confirmation bar.
    let fillIdx = -1;
    for (let i = startIdx + 1; i <= Math.min(expiryIdx, bars.length - 1); i++) {
      const b = bars[i];
      if (long ? b.high >= entry : b.low <= entry) { fillIdx = i; break; }
    }
    if (fillIdx < 0) continue;
    // Dev-only guard: never fill on the signal bar itself.
    if (fillIdx <= startIdx) continue;

    // Apply slippage on entry fill.
    const entryBar = bars[fillIdx];
    const entrySlip = slippagePoints(entryBar, realism.slippage);
    const filledEntry = long ? entry + entrySlip : entry - entrySlip;

    // Compute position size using the ORIGINAL planned risk distance (not
    // post-slippage). This mirrors how live sizing is done at signal time.
    const riskDist = Math.abs(entry - stop) || 1;
    const units = riskUsd / riskDist;

    // Walk forward looking for SL/TP.
    let outcome: LabTrade["outcome"] = "open";
    let exitReason: LabTrade["exitReason"] = "open";
    let exitIdx = fillIdx;
    let exitPrice = long ? bars[fillIdx].close ?? filledEntry : bars[fillIdx].close ?? filledEntry;

    for (let i = fillIdx; i < Math.min(bars.length, fillIdx + MAX_HOLD); i++) {
      const b = bars[i];
      const openPx = b.open ?? b.close ?? (b.high + b.low) / 2;

      // ── Gap handling on the bar's open ──
      // If price opens past the level, we couldn't have exited at the level.
      // Book the fill at the open (worse than the level for stops, better for
      // targets — realistic exchange behavior).
      const gapSl = long ? openPx <= stop : openPx >= stop;
      const gapTp = long ? openPx >= target : openPx <= target;
      if (gapSl) {
        exitPrice = openPx; exitIdx = i;
        outcome = "loss"; exitReason = "gap_sl"; break;
      }
      if (gapTp) {
        exitPrice = openPx; exitIdx = i;
        outcome = "win"; exitReason = "gap_tp"; break;
      }

      const hitSl = long ? b.low <= stop : b.high >= stop;
      const hitTp = long ? b.high >= target : b.low <= target;

      if (hitSl && hitTp) {
        // Both touched — resolve per intrabar mode.
        let slFirst: boolean;
        if (realism.intrabar === "optimistic") slFirst = false;
        else if (realism.intrabar === "proximity") {
          slFirst = Math.abs(openPx - stop) <= Math.abs(openPx - target);
        } else slFirst = true; // conservative
        if (slFirst) { outcome = "loss"; exitReason = "sl"; exitPrice = stop; }
        else { outcome = "win"; exitReason = "tp"; exitPrice = target; }
        exitIdx = i; break;
      }
      if (hitSl) { outcome = "loss"; exitReason = "sl"; exitPrice = stop; exitIdx = i; break; }
      if (hitTp) { outcome = "win"; exitReason = "tp"; exitPrice = target; exitIdx = i; break; }
    }

    // Apply slippage on exit fill (worsen the trader).
    if (outcome !== "open") {
      const exitBar = bars[exitIdx];
      const exitSlip = slippagePoints(exitBar, realism.slippage);
      if (exitReason === "sl" || exitReason === "gap_sl") {
        exitPrice = long ? exitPrice - exitSlip : exitPrice + exitSlip;
      } else if (exitReason === "tp" || exitReason === "gap_tp") {
        exitPrice = long ? exitPrice - exitSlip : exitPrice + exitSlip;
      }
    }

    // Gross P&L in USD using actual filled prices and units.
    const grossPnl = outcome === "open"
      ? 0
      : (long ? (exitPrice - filledEntry) : (filledEntry - exitPrice)) * units;
    const rMultiple = outcome === "open" ? 0 : grossPnl / riskUsd;

    // Fees.
    const durationMs = bars[exitIdx].ts - bars[fillIdx].ts;
    let feesUsd = 0;
    if (realism.fees.enabled && outcome !== "open") {
      const entryNotional = Math.abs(filledEntry) * units;
      const exitNotional = Math.abs(exitPrice) * units;
      const exitIsTaker = durationMs > 0 && durationMs < realism.fees.takerThresholdMs;
      const entryFee = entryNotional * realism.fees.makerRate;
      const exitFee = exitNotional * (exitIsTaker ? realism.fees.takerRate : realism.fees.makerRate);
      feesUsd = entryFee + exitFee;
    }
    const netPnl = grossPnl - feesUsd;

    trades.push({
      ts: bars[fillIdx].ts, exitTs: bars[exitIdx].ts, direction: s.direction,
      entry: filledEntry, stop, target, outcome, rMultiple,
      pnlUsd: grossPnl,
      netPnlUsd: netPnl,
      feesUsd,
      barsHeld: exitIdx - fillIdx,
      exitPrice,
      exitReason,
      durationMs,
    });
  }

  const wins = trades.filter((t) => t.outcome === "win");
  const losses = trades.filter((t) => t.outcome === "loss");
  const open = trades.filter((t) => t.outcome === "open");
  const longs = trades.filter((t) => t.direction === "long");
  const shorts = trades.filter((t) => t.direction === "short");
  // Use NET P&L for PF / gross-win / gross-loss so stats reflect realized economics.
  const grossWin = wins.reduce((a, t) => a + Math.max(0, t.netPnlUsd), 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + Math.min(0, t.netPnlUsd), 0));
  const closedCount = wins.length + losses.length;
  const totalFees = trades.reduce((a, t) => a + t.feesUsd, 0);

  let eq = 0, peak = 0, maxDd = 0;
  for (const t of trades) {
    eq += t.netPnlUsd;
    if (eq > peak) peak = eq;
    if (peak - eq > maxDd) maxDd = peak - eq;
  }

  const avgRR = signals.length ? signals.reduce((a, s) => a + (s.rr || 0), 0) / signals.length : 0;
  const wrOf = (arr: LabTrade[]) => {
    const closed = arr.filter((t) => t.outcome !== "open");
    return closed.length ? (arr.filter((t) => t.outcome === "win").length / closed.length) * 100 : 0;
  };

  const totalGross = trades.reduce((a, t) => a + t.pnlUsd, 0);
  const totalNet = trades.reduce((a, t) => a + t.netPnlUsd, 0);

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
    totalPnlUsd: totalGross,
    netPnlUsd: totalNet,
    totalFeesUsd: totalFees,
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
