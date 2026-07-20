// Liquidity Sweep Research Lab — single source-of-truth config schema.
// Fully declarative, Zod-validated. Every field is optional with a sensible
// default so saved presets stay small. The engine consumes this and maps it
// onto the Universal Strategy Engine's StrategyConfig.
import { z } from "zod";
import { TIMEFRAMES, TIMEZONES } from "@/lib/market-data/types";

// ── Zones ──────────────────────────────────────────────────────────────
export const ZONE_KINDS = [
  "PDH", "PDL", "PWH", "PWL", "PMH", "PML",
  "ASIA_H", "ASIA_L", "LONDON_H", "LONDON_L", "NY_H", "NY_L",
  "PREV_SESSION_H", "PREV_SESSION_L", "CUSTOM_H", "CUSTOM_L",
] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];

export const CustomSessionSchema = z.object({
  name: z.string().default("Custom"),
  startHour: z.number().min(0).max(23).default(9),
  endHour: z.number().min(0).max(23).default(11),
  timezone: z.enum([...TIMEZONES] as [string, ...string[]]).default("London"),
});

// ── Breakout rule ──────────────────────────────────────────────────────
export const BREAKOUT_RULES = [
  "close_outside", "high_outside", "low_outside",
  "body_outside", "body_pct_outside",
  "atr_mult", "tick_count", "pct_of_price",
] as const;
export type BreakoutRule = (typeof BREAKOUT_RULES)[number];

export const BreakoutSchema = z.object({
  rule: z.enum(BREAKOUT_RULES).default("close_outside"),
  minDistancePct: z.number().min(0).default(0.02),
  bodyPct: z.number().min(0).max(100).default(50),
  atrMult: z.number().min(0).default(0.25),
  ticks: z.number().min(0).default(5),
});

// ── Confirmation ───────────────────────────────────────────────────────
export const CONFIRMATION_METHODS = [
  "opposite_candle", "engulfing", "pin_bar", "rejection",
  "sweep", "order_block", "fvg", "bos", "choch", "ltf_bos",
] as const;
export type ConfirmationMethod = (typeof CONFIRMATION_METHODS)[number];

export const ConfirmationSchema = z.object({
  methods: z.array(z.enum(CONFIRMATION_METHODS)).default(["opposite_candle"]),
  lookback: z.number().min(1).max(50).default(5),
  requireClose: z.boolean().default(true),
  minBodyPct: z.number().min(0).max(100).default(35),
});

// ── Entry model ────────────────────────────────────────────────────────
export const ENTRY_MODELS = [
  "market", "candle_extreme", "candle_close", "candle_50", "candle_open",
  "limit", "order_block", "fvg", "custom_offset",
] as const;
export type EntryModelKind = (typeof ENTRY_MODELS)[number];

export const EntryModelSchema = z.object({
  kind: z.enum(ENTRY_MODELS).default("limit"),
  pullbackPct: z.number().min(0).default(0.02),
  offsetPts: z.number().default(0),
  offsetPct: z.number().default(0),
  offsetAtrMult: z.number().default(0),
  expiryBars: z.number().min(1).max(200).default(3),
  delayBars: z.number().min(0).max(50).default(0),
});

// ── Stop loss ──────────────────────────────────────────────────────────
export const STOP_MODELS = [
  "confirmation_hl", "breakout_hl", "swing_hl",
  "atr", "prev_liquidity", "order_block",
  "fixed_pts", "fixed_pct", "custom_offset", "sweep_extreme",
] as const;
export type StopModelKind = (typeof STOP_MODELS)[number];

export const StopSchema = z.object({
  kind: z.enum(STOP_MODELS).default("sweep_extreme"),
  atrMult: z.number().min(0).default(1.5),
  fixedPts: z.number().min(0).default(0),
  fixedPct: z.number().min(0).default(0),
  bufferPct: z.number().min(0).default(0.02),
});

// ── Take profit legs ───────────────────────────────────────────────────
export const TP_KINDS = [
  "rr", "swing", "liquidity", "opposite_range",
  "vwap", "poc", "vah", "val",
  "opposite_pdx", "atr_multiple",
] as const;
export type TpKind = (typeof TP_KINDS)[number];

export const TpLegSchema = z.object({
  kind: z.enum(TP_KINDS).default("rr"),
  value: z.number().default(4),
  sizePct: z.number().min(1).max(100).default(100),
});

export const TargetsSchema = z.object({
  legs: z.array(TpLegSchema).min(1).default([{ kind: "rr", value: 4, sizePct: 100 }]),
  moveToBreakEvenAtR: z.number().nullable().default(1),
  trailAfterR: z.number().nullable().default(2),
  trailStepR: z.number().default(0.5),
});

// ── Swing detection ────────────────────────────────────────────────────
export const SWING_ALGOS = ["fractal", "pivot", "zigzag", "market_structure"] as const;
export const SwingSchema = z.object({
  algorithm: z.enum(SWING_ALGOS).default("pivot"),
  pivotLen: z.number().min(2).max(50).default(5),
  swingLen: z.number().min(2).max(100).default(10),
  internalSwings: z.boolean().default(false),
});

// ── Attempts ───────────────────────────────────────────────────────────
export const AttemptsSchema = z.object({
  max: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(-1)]).default(1),
  mode: z.enum(["fresh_breakout", "new_confirmation"]).default("fresh_breakout"),
});

// ── Filters ────────────────────────────────────────────────────────────
export const FiltersSchema = z.object({
  ema: z.object({
    enabled: z.boolean().default(false),
    periods: z.array(z.number()).default([50, 200]),
    side: z.enum(["above", "below"]).default("above"),
  }).default({}),
  vwap: z.object({
    enabled: z.boolean().default(false),
    side: z.enum(["above", "below"]).default("above"),
  }).default({}),
  adx: z.object({
    enabled: z.boolean().default(false),
    min: z.number().default(18),
    max: z.number().default(100),
  }).default({}),
  atr: z.object({
    enabled: z.boolean().default(false),
    minPercentile: z.number().min(0).max(100).default(20),
    maxPercentile: z.number().min(0).max(100).default(95),
  }).default({}),
  volume: z.object({
    enabled: z.boolean().default(false),
    minMult: z.number().default(1.2),
  }).default({}),
  rsi: z.object({
    enabled: z.boolean().default(false),
    min: z.number().min(0).max(100).default(30),
    max: z.number().min(0).max(100).default(70),
  }).default({}),
  htfTrend: z.object({
    enabled: z.boolean().default(false),
    bias: z.enum(["bull", "bear"]).default("bull"),
  }).default({}),
  structure: z.object({
    enabled: z.boolean().default(false),
    require: z.array(z.enum(["HH", "HL", "LH", "LL"])).default([]),
  }).default({}),
  premiumDiscount: z.object({
    enabled: z.boolean().default(false),
    zone: z.enum(["premium", "discount", "equilibrium"]).default("discount"),
  }).default({}),
  priorSweep: z.object({
    enabled: z.boolean().default(false),
    lookback: z.number().default(20),
  }).default({}),
});

// ── Sessions ───────────────────────────────────────────────────────────
export const SESSIONS = ["asian", "london", "ny", "london_ny_overlap", "asian_london_overlap"] as const;
export const SessionSchema = z.object({
  allowed: z.array(z.enum(SESSIONS)).default([]),
  weekdays: z.array(z.number().min(0).max(6)).default([1, 2, 3, 4, 5]),
  blockWeekend: z.boolean().default(true),
  blockHoliday: z.boolean().default(false),
  hoursOfDay: z.array(z.number().min(0).max(23)).default([]),
  custom: CustomSessionSchema.optional(),
});

// ── Realism (fees / slippage / intrabar SL/TP model) ───────────────────
export const INTRABAR_MODES = ["conservative", "optimistic", "proximity"] as const;
export const SLIPPAGE_MODELS = ["none", "fixed_pts", "pct", "atr_mult"] as const;

export const RealismSchema = z.object({
  intrabar: z.enum(INTRABAR_MODES).default("conservative"),
  slippage: z.object({
    model: z.enum(SLIPPAGE_MODELS).default("none"),
    value: z.number().min(0).default(0),
  }).default({}),
  fees: z.object({
    enabled: z.boolean().default(true),
    makerRate: z.number().min(0).default(0.0002),
    takerRate: z.number().min(0).default(0.0005),
    takerThresholdMs: z.number().min(0).default(30 * 60_000),
  }).default({}),
});
export type RealismConfig = z.infer<typeof RealismSchema>;

// ── Top-level Lab config ───────────────────────────────────────────────
export const LiquiditySweepConfigSchema = z.object({
  version: z.literal(1).default(1),
  name: z.string().default("Untitled Lab Config"),

  // Data
  symbol: z.string().default("XAUUSDT"),
  source: z.enum(["yahoo", "shark"]).default("yahoo"),
  entryTimeframe: z.enum([...TIMEFRAMES] as [string, ...string[]]).default("5m"),
  displayTimezone: z.enum([...TIMEZONES] as [string, ...string[]]).default("IST"),
  strategyTimezone: z.enum([...TIMEZONES] as [string, ...string[]]).default("London"),
  daysBack: z.number().min(1).max(3650).default(60),

  // Direction
  direction: z.enum(["long", "short", "both"]).default("both"),

  // Zones (multi-select)
  zones: z.array(z.enum(ZONE_KINDS)).min(1).default(["PDH", "PDL"]),
  customSession: CustomSessionSchema.optional(),

  // Blocks
  breakout: BreakoutSchema.default({}),
  confirmation: ConfirmationSchema.default({}),
  entry: EntryModelSchema.default({}),
  stop: StopSchema.default({}),
  targets: TargetsSchema.default({}),
  swing: SwingSchema.default({}),
  attempts: AttemptsSchema.default({}),
  filters: FiltersSchema.default({}),
  session: SessionSchema.default({}),
  realism: RealismSchema.default({}),

  // Risk
  riskUsd: z.number().min(1).default(10),
  maxDailyTrades: z.number().min(1).default(2),
});


export type LiquiditySweepConfig = z.infer<typeof LiquiditySweepConfigSchema>;

export function defaultLabConfig(): LiquiditySweepConfig {
  return LiquiditySweepConfigSchema.parse({});
}

// Convenience preset: legacy PDH/PDL sweep matching the removed page.
export function pdhPdlPreset(): LiquiditySweepConfig {
  return LiquiditySweepConfigSchema.parse({
    name: "PDH/PDL Sweep (1:4)",
    symbol: "XAUUSDT",
    entryTimeframe: "5m",
    zones: ["PDH", "PDL"],
    breakout: { rule: "close_outside", minDistancePct: 0.02, bodyPct: 35 },
    confirmation: { methods: ["opposite_candle"], requireClose: true, minBodyPct: 35 },
    entry: { kind: "limit", pullbackPct: 0.02, expiryBars: 3 },
    stop: { kind: "sweep_extreme", bufferPct: 0.02 },
    targets: {
      legs: [{ kind: "rr", value: 4, sizePct: 100 }],
      moveToBreakEvenAtR: 1, trailAfterR: 2, trailStepR: 0.5,
    },
    attempts: { max: 1, mode: "fresh_breakout" },
    session: { blockWeekend: true },
    riskUsd: 10,
    maxDailyTrades: 2,
  });
}
