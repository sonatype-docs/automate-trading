// Map a LiquiditySweepConfig → StrategyConfig overrides for the existing
// Universal Strategy Engine. Keeps the Lab decoupled from engine internals.
//
// Zone mapping notes:
//   - PDH/PDL → engine setup "pdh_pdl_sweep" (natively supported).
//   - Other zones fall back to "pdh_pdl_sweep" for now; the engine still
//     produces sweep triggers around PDH/PDL, and the config is preserved so
//     future engine extensions (weekly/monthly/session zones) can consume it
//     without touching the Lab.
import type { LiquiditySweepConfig } from "./config";
import type { StrategyConfig } from "@/lib/strategy-engine/types";

export function toStrategyOverrides(cfg: LiquiditySweepConfig): Partial<StrategyConfig> & Record<string, unknown> {
  const entryModel = mapEntryModel(cfg);
  const stopModel = mapStop(cfg);

  return {
    direction: cfg.direction,
    session: {
      allowedSessions: cfg.session.allowed.length ? (cfg.session.allowed as StrategyConfig["session"] extends infer S ? (S extends { allowedSessions?: infer A } ? A : never) : never) : undefined,
      allowedWeekdays: cfg.session.weekdays.length === 7 ? undefined : cfg.session.weekdays,
      blockWeekend: cfg.session.blockWeekend,
      blockHoliday: cfg.session.blockHoliday,
      hoursOfDay: cfg.session.hoursOfDay.length ? cfg.session.hoursOfDay : undefined,
    },
    trend: {
      emaAlignment: cfg.filters.ema.enabled
        ? cfg.filters.ema.side === "above"
          ? { above: cfg.filters.ema.periods }
          : { below: cfg.filters.ema.periods }
        : undefined,
      vwapSide: cfg.filters.vwap.enabled ? cfg.filters.vwap.side : null,
      adxMin: cfg.filters.adx.enabled ? cfg.filters.adx.min : undefined,
      adxMax: cfg.filters.adx.enabled ? cfg.filters.adx.max : undefined,
      higherTimeframeBias: cfg.filters.htfTrend.enabled ? cfg.filters.htfTrend.bias : null,
      requireStructure: cfg.filters.structure.enabled && cfg.filters.structure.require.length
        ? cfg.filters.structure.require
        : undefined,
    },
    volatility: {
      atrPercentileMin: cfg.filters.atr.enabled ? cfg.filters.atr.minPercentile : undefined,
      atrPercentileMax: cfg.filters.atr.enabled ? cfg.filters.atr.maxPercentile : undefined,
    },
    setup: {
      kind: "pdh_pdl_sweep",
      breakBufferPct: cfg.breakout.minDistancePct,
    },
    confirmation: {
      requireClose: cfg.confirmation.requireClose,
      minBodyPct: cfg.confirmation.minBodyPct,
      minVolumeMult: cfg.filters.volume.enabled ? cfg.filters.volume.minMult : undefined,
      minAtrMultiple: cfg.breakout.rule === "atr_mult" ? cfg.breakout.atrMult : undefined,
    },
    entry: {
      model: entryModel,
      expiryBars: cfg.entry.expiryBars,
      delayBars: cfg.entry.delayBars,
    },
    stop: stopModel,
    targets: {
      legs: cfg.targets.legs.map((l) => ({ kind: l.kind, value: l.value, sizePct: l.sizePct })),
      moveToBreakEvenAtR: cfg.targets.moveToBreakEvenAtR,
      trailAfterR: cfg.targets.trailAfterR,
      trailStepR: cfg.targets.trailStepR,
    },
    management: {
      maxDailyTrades: cfg.maxDailyTrades,
      maxAttemptsPerSweep: cfg.attempts.max === -1 ? 999 : cfg.attempts.max,
    },
    invalidation: { maxDelayBars: cfg.entry.expiryBars },
    risk: { riskPerTradeUsd: cfg.riskUsd },
  } as Partial<StrategyConfig> & Record<string, unknown>;
}

function mapEntryModel(cfg: LiquiditySweepConfig): StrategyConfig["entry"]["model"] {
  const e = cfg.entry;
  switch (e.kind) {
    case "market":
    case "candle_extreme":
    case "candle_close":
    case "candle_50":
    case "candle_open":
      return { kind: "market" };
    case "limit":
      return { kind: "limit", pullbackPct: e.pullbackPct };
    case "order_block":
      return { kind: "order_block", lookback: 20 };
    case "fvg":
      return { kind: "fvg", lookback: 20 };
    case "custom_offset":
      return { kind: "limit", pullbackPct: e.offsetPct };
    default:
      return { kind: "limit", pullbackPct: 0.02 };
  }
}

function mapStop(cfg: LiquiditySweepConfig): StrategyConfig["stop"] {
  const s = cfg.stop;
  switch (s.kind) {
    case "sweep_extreme":
      return { kind: "sweep_extreme", bufferPct: s.bufferPct };
    case "atr":
      return { kind: "atr", multiple: s.atrMult };
    case "fixed_pts":
      return { kind: "fixed_pts", points: s.fixedPts };
    case "fixed_pct":
      return { kind: "percentage", pct: s.fixedPct };
    case "swing_hl":
      return { kind: "swing" };
    case "confirmation_hl":
    case "breakout_hl":
      return { kind: "previous_candle" };
    case "prev_liquidity":
      return { kind: "opposite_range" };
    case "order_block":
      return { kind: "swing" };
    case "custom_offset":
      return { kind: "percentage", pct: s.fixedPct };
    default:
      return { kind: "sweep_extreme", bufferPct: 0.02 };
  }
}
