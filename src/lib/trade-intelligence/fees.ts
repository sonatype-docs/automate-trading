// Retroactive exchange fee model for stored TradeRecords.
// The pipeline backtests were run with feeRate=0, so this module applies
// realistic Shark-exchange maker/taker fees on-the-fly for research/analytics.
//
// Rules (aligned with our live tick.server.ts execution policy):
//   - Entry orders are always LIMIT → maker fee.
//   - Exit orders are MARKET (taker) if trade duration < 30 min,
//     otherwise LIMIT (maker).
//   - Fee = notional_entry * makerRate
//         + notional_exit * (takerRate if <30m else makerRate)
//   - notional = |price| * positionSize (units). If positionSize is
//     missing we fall back to (riskUsd / |entry - stop|) * price.
//
// If a TradeRecord already carries a non-zero `fees` value (real live
// trade recorded from the exchange), we DO NOT touch it — those fees are
// already reflected in netPnl.

import type { TradeRecord } from "./types";

export interface FeeModel {
  makerRate: number; // fraction of notional, e.g. 0.0002 = 0.02%
  takerRate: number; // fraction of notional, e.g. 0.0005 = 0.05%
  takerThresholdMs: number; // exits shorter than this use taker (market)
  enabled: boolean;
}

export const DEFAULT_FEE_MODEL: FeeModel = {
  makerRate: 0.0002,        // 0.02% — Shark futures maker
  takerRate: 0.0005,        // 0.05% — Shark futures taker
  takerThresholdMs: 30 * 60_000, // 30 minutes
  enabled: true,
};

function positionUnits(t: TradeRecord): number {
  if (t.positionSize && t.positionSize > 0) return t.positionSize;
  const stop = t.stopPrice ?? 0;
  const risk = t.riskUsd ?? 0;
  const dist = Math.abs((t.entryPrice ?? 0) - stop);
  if (risk > 0 && dist > 0) return risk / dist;
  return 0;
}

export function estimateTradeFee(t: TradeRecord, model: FeeModel = DEFAULT_FEE_MODEL): number {
  const units = positionUnits(t);
  if (units <= 0) return 0;
  const entryNotional = Math.abs(t.entryPrice ?? 0) * units;
  const exitNotional = Math.abs(t.exitPrice ?? 0) * units;
  const duration =
    t.durationMs ??
    (t.exitTime && t.entryTime ? t.exitTime - t.entryTime : 0);
  const exitIsTaker = duration > 0 && duration < model.takerThresholdMs;
  const entryFee = entryNotional * model.makerRate;
  const exitFee = exitNotional * (exitIsTaker ? model.takerRate : model.makerRate);
  return entryFee + exitFee;
}

/**
 * Returns a new TradeRecord array with fees applied. Original array is not
 * mutated. Trades that already carry non-zero fees are left as-is.
 */
export function applyFees(
  trades: TradeRecord[],
  model: FeeModel = DEFAULT_FEE_MODEL,
): TradeRecord[] {
  if (!model.enabled || trades.length === 0) return trades;
  const out = new Array<TradeRecord>(trades.length);
  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    const existing = t.fees ?? 0;
    if (existing > 0) { out[i] = t; continue; }
    const fee = estimateTradeFee(t, model);
    if (fee <= 0) { out[i] = t; continue; }
    const gross = t.grossPnl ?? t.netPnl;
    out[i] = {
      ...t,
      fees: fee,
      commission: fee,
      grossPnl: gross,
      netPnl: gross - fee,
    };
  }
  return out;
}
