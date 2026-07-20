// Server function — runs the Universal Strategy Engine against a fresh
// slice of enriched market data. No hardcoded strategy; the caller picks a
// preset (or supplies raw config).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { TIMEFRAMES, TIMEZONES, type Timeframe, type Timezone } from "@/lib/market-data/types";
import { STRATEGY_PRESETS } from "@/lib/strategy-engine/presets";
import type { EngineRunResult } from "@/lib/strategy-engine/types";

const Input = z.object({
  source: z.enum(["yahoo", "shark"]).default("yahoo"),
  symbol: z.string().default("XAUUSDT"),
  timeframe: z.enum([...TIMEFRAMES] as [Timeframe, ...Timeframe[]]).default("15m"),
  displayTimezone: z.enum([...TIMEZONES] as [Timezone, ...Timezone[]]).default("IST"),
  strategyTimezone: z.enum([...TIMEZONES] as [Timezone, ...Timezone[]]).default("London"),
  fromMs: z.number(),
  toMs: z.number(),
  presetId: z.string(),
  mode: z.enum(["historical", "live", "replay", "paper"]).default("historical"),
  configOverrides: z.record(z.string(), z.unknown()).optional(),
});


export interface RunStrategyResult {
  presetId: string;
  result: EngineRunResult;
  barsIn: number;
}

export const runUniversalStrategy = createServerFn({ method: "POST" })
  .inputValidator((raw) => Input.parse(raw))
  .handler(async ({ data }): Promise<RunStrategyResult> => {
    const base = STRATEGY_PRESETS[data.presetId as keyof typeof STRATEGY_PRESETS];
    if (!base) throw new Error(`Unknown strategy preset: ${data.presetId}`);
    const cfg = data.configOverrides
      ? deepMerge(base, data.configOverrides as Record<string, unknown>)
      : base;


    const [{ loadRawCandles }, { enrichCandles }, { DEFAULT_CONFIG }, { runStrategy }] = await Promise.all([
      import("@/lib/market-data/loader.server"),
      import("@/lib/market-data/enrich"),
      import("@/lib/market-data/types"),
      import("@/lib/strategy-engine/engine"),
    ]);

    const { candles } = await loadRawCandles({
      source: data.source,
      symbol: data.symbol,
      timeframe: data.timeframe,
      fromMs: data.fromMs,
      toMs: data.toMs,
    });

    const enriched = enrichCandles(candles, {
      ...DEFAULT_CONFIG,
      symbol: data.symbol,
      timeframe: data.timeframe,
      displayTimezone: data.displayTimezone,
      strategyTimezone: data.strategyTimezone,
    });

    const result = runStrategy(enriched, cfg, {
      mode: data.mode,
      symbol: data.symbol,
    });
    // Trim events for wire size.
    result.events = result.events.slice(-500);
    return { presetId: data.presetId, result, barsIn: enriched.length };
  });

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge<T>(base: T, overrides: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) continue;
    const cur = out[k];
    if (isPlainObject(cur) && isPlainObject(v)) {
      out[k] = deepMerge(cur, v);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

