import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { FiltersZod } from "@/lib/strategy/filters";



async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const getStrategyState = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = await admin();
  const [settingsRes, sessionsRes, setupsRes] = await Promise.all([
    supabase.from("strategy_settings").select("*").eq("id", true).maybeSingle(),
    supabase
      .from("strategy_sessions")
      .select("*")
      .order("ist_date", { ascending: false })
      .limit(1),
    supabase
      .from("strategy_setups")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  return {
    settings: settingsRes.data,
    session: sessionsRes.data?.[0] ?? null,
    setups: setupsRes.data ?? [],
  };
});

const EntryModeEnum = z.enum(["fib", "retest", "market", "adaptive"]);

const StrategySettingsSchema = z.object({
  enabled: z.boolean().optional(),
  symbol: z.string().min(3).max(24).optional(),
  sl_risk_usd: z.number().positive().optional(),
  rr: z.number().positive().optional(),
  session_start_ist: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .optional(),
  trail_enabled: z.boolean().optional(),
  trail_activate_r: z.number().positive().optional(),
  trail_step_r: z.number().positive().optional(),
  skip_weekends: z.boolean().optional(),
  entry_mode: EntryModeEnum.optional(),
  entry_depth_pct: z.number().min(0).max(0.5).optional(),
  sl_depth_pct: z.number().min(0.1).max(1).optional(),
  adaptive_strong_break_pct: z.number().min(1).max(100).optional(),
  adaptive_shallow_depth: z.number().min(0).max(0.5).optional(),
  adaptive_deep_depth: z.number().min(0).max(0.5).optional(),
  retest_sl_r: z.number().positive().max(5).optional(),
});


export const updateStrategySettings = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => StrategySettingsSchema.parse(input))
  .handler(async ({ data }) => {
    const supabase = await admin();
    const { data: row, error } = await supabase
      .from("strategy_settings")
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq("id", true)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const runStrategyTickNow = createServerFn({ method: "POST" }).handler(async () => {
  const { runStrategyTick } = await import("@/lib/strategy/engine.server");
  return runStrategyTick();
});

export const repriceArmedNow = createServerFn({ method: "POST" }).handler(async () => {
  const { repriceArmedSetupsNow } = await import("@/lib/strategy/engine.server");
  return repriceArmedSetupsNow();
});


export const getPendingSharkOrders = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { createSharkClient } = await import("@/lib/exchange/shark-client.server");
    const client = createSharkClient();
    const rows = await client.getOpenOrders();
    // Strip `raw` (unknown → not serializable) before returning.
    const cleaned = rows.map(({ raw: _raw, ...r }) => r);
    return { ok: true as const, rows: cleaned, error: null as string | null, fetchedAt: new Date().toISOString() };
  } catch (e) {
    return {
      ok: false as const,
      rows: [] as Array<Omit<import("@/lib/exchange/shark-client.server").OpenOrderRow, "raw">>,
      error: e instanceof Error ? e.message : String(e),
      fetchedAt: new Date().toISOString(),
    };
  }
});

export const getStrategyTimeline = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = await admin();
  const { data: sessionRow } = await supabase
    .from("strategy_sessions")
    .select("*")
    .order("ist_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sessionRow) return { session: null, setups: [], orders: [] };
  const { data: setups } = await supabase
    .from("strategy_setups")
    .select(
      "id, ist_date, side, entry_price, sl_price, tp_price, qty, status, order_id, close_order_id, close_reason, pnl_usd, exchange_order_id, created_at, filled_at, closed_at, updated_at",
    )
    .eq("ist_date", sessionRow.ist_date)
    .order("created_at", { ascending: true });
  const orderIds = (setups ?? [])
    .flatMap((s) => [s.order_id, s.close_order_id])
    .filter((v): v is string => !!v);
  let orders: Array<{
    id: string;
    exchange_order_id: string | null;
    filled_price: number | null;
    status: string;
    order_type: string;
    side: string;
    qty: number;
  }> = [];
  if (orderIds.length > 0) {
    const { data: orderRows } = await supabase
      .from("orders")
      .select("id, exchange_order_id, filled_price, status, order_type, side, qty")
      .in("id", orderIds);
    orders = (orderRows ?? []) as typeof orders;
  }
  return { session: sessionRow, setups: setups ?? [], orders };
});

function entryFromSettings(settings: Record<string, unknown>) {
  return {
    mode: (settings.entry_mode as "fib" | "retest" | "market" | "adaptive") ?? "fib",
    entryDepthPct: Number(settings.entry_depth_pct ?? 0.15),
    slDepthPct: Number(settings.sl_depth_pct ?? 0.60),
    adaptiveStrongBreakPct: Number(settings.adaptive_strong_break_pct ?? 30),
    adaptiveShallowDepth: Number(settings.adaptive_shallow_depth ?? 0.10),
    adaptiveDeepDepth: Number(settings.adaptive_deep_depth ?? 0.35),
    retestSlR: Number(settings.retest_sl_r ?? 0.5),
  };
}

export const backtestToday = createServerFn({ method: "POST" }).handler(async () => {
  const supabase = await admin();
  const { data: settings } = await supabase
    .from("strategy_settings")
    .select("*")
    .eq("id", true)
    .single();
  if (!settings) throw new Error("Strategy settings not found");
  const { runBacktestToday } = await import("@/lib/strategy/backtest.server");
  return runBacktestToday({
    symbol: settings.symbol,
    sessionStartIst: String(settings.session_start_ist).slice(0, 5),
    slRiskUsd: Number(settings.sl_risk_usd),
    rr: Number(settings.rr),
    entry: entryFromSettings(settings as unknown as Record<string, unknown>),
  });
});

const EntryOverrideSchema = z
  .object({
    mode: EntryModeEnum,
    entry_depth_pct: z.number().min(0).max(0.5),
    sl_depth_pct: z.number().min(0.1).max(1),
    adaptive_strong_break_pct: z.number().min(1).max(100),
    adaptive_shallow_depth: z.number().min(0).max(0.5),
    adaptive_deep_depth: z.number().min(0).max(0.5),
    retest_sl_r: z.number().positive().max(5),
  })
  .partial()
  .optional();


const RangeSchema = z.object({
  days: z.number().int().min(1).max(365),
  trail_enabled: z.boolean().optional(),
  trail_activate_r: z.number().positive().optional(),
  trail_step_r: z.number().positive().optional(),
  skip_weekdays: z.array(z.number().int().min(0).max(6)).optional(),
  // advanced overrides (fall back to saved settings)
  symbol: z.string().min(3).max(24).optional(),
  session_start_ist: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  sl_risk_usd: z.number().positive().optional(),
  rr: z.number().positive().optional(),
  filters: FiltersZod,
  entry: EntryOverrideSchema,
  fee_rate: z.number().min(0).max(0.01).optional(),
});

export const backtestRange = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => RangeSchema.parse(input))
  .handler(async ({ data }) => {
    const supabase = await admin();
    const { data: settings } = await supabase
      .from("strategy_settings")
      .select("*")
      .eq("id", true)
      .single();
    if (!settings) throw new Error("Strategy settings not found");
    const { runBacktestRange } = await import("@/lib/strategy/backtest-range.server");
    const trailEnabled = data.trail_enabled ?? Boolean((settings as { trail_enabled?: boolean }).trail_enabled);
    const trailActivateR = data.trail_activate_r ?? Number((settings as { trail_activate_r?: number }).trail_activate_r ?? 2);
    const trailStepR = data.trail_step_r ?? Number((settings as { trail_step_r?: number }).trail_step_r ?? 1);
    const savedEntry = entryFromSettings(settings as unknown as Record<string, unknown>);
    const entry = {
      mode: data.entry?.mode ?? savedEntry.mode,
      entryDepthPct: data.entry?.entry_depth_pct ?? savedEntry.entryDepthPct,
      slDepthPct: data.entry?.sl_depth_pct ?? savedEntry.slDepthPct,
      adaptiveStrongBreakPct: data.entry?.adaptive_strong_break_pct ?? savedEntry.adaptiveStrongBreakPct,
      adaptiveShallowDepth: data.entry?.adaptive_shallow_depth ?? savedEntry.adaptiveShallowDepth,
      adaptiveDeepDepth: data.entry?.adaptive_deep_depth ?? savedEntry.adaptiveDeepDepth,
      retestSlR: data.entry?.retest_sl_r ?? savedEntry.retestSlR,
    };
    return runBacktestRange({
      symbol: data.symbol ?? settings.symbol,
      sessionStartIst: (data.session_start_ist ?? String(settings.session_start_ist)).slice(0, 5),
      slRiskUsd: data.sl_risk_usd ?? Number(settings.sl_risk_usd),
      rr: data.rr ?? Number(settings.rr),
      days: data.days,
      trailEnabled,
      trailActivateR,
      trailStepR,
      skipWeekdays: (data.skip_weekdays ?? []) as (0 | 1 | 2 | 3 | 4 | 5 | 6)[],
      filters: data.filters,
      entry,
      feeRate: data.fee_rate,
    });
  });

const SessionsCompareSchema = RangeSchema.omit({ session_start_ist: true }).extend({
  sessions: z.array(z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/)).min(1).max(12),
});

export const backtestSessionsCompare = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => SessionsCompareSchema.parse(input))
  .handler(async ({ data }) => {
    const supabase = await admin();
    const { data: settings } = await supabase
      .from("strategy_settings")
      .select("*")
      .eq("id", true)
      .single();
    if (!settings) throw new Error("Strategy settings not found");
    const { runBacktestRange } = await import("@/lib/strategy/backtest-range.server");
    const trailEnabled = data.trail_enabled ?? Boolean((settings as { trail_enabled?: boolean }).trail_enabled);
    const trailActivateR = data.trail_activate_r ?? Number((settings as { trail_activate_r?: number }).trail_activate_r ?? 2);
    const trailStepR = data.trail_step_r ?? Number((settings as { trail_step_r?: number }).trail_step_r ?? 1);
    const savedEntry = entryFromSettings(settings as unknown as Record<string, unknown>);
    const entry = {
      mode: data.entry?.mode ?? savedEntry.mode,
      entryDepthPct: data.entry?.entry_depth_pct ?? savedEntry.entryDepthPct,
      slDepthPct: data.entry?.sl_depth_pct ?? savedEntry.slDepthPct,
      adaptiveStrongBreakPct: data.entry?.adaptive_strong_break_pct ?? savedEntry.adaptiveStrongBreakPct,
      adaptiveShallowDepth: data.entry?.adaptive_shallow_depth ?? savedEntry.adaptiveShallowDepth,
      adaptiveDeepDepth: data.entry?.adaptive_deep_depth ?? savedEntry.adaptiveDeepDepth,
      retestSlR: data.entry?.retest_sl_r ?? savedEntry.retestSlR,
    };
    const symbol = data.symbol ?? settings.symbol;
    const slRiskUsd = data.sl_risk_usd ?? Number(settings.sl_risk_usd);
    const rr = data.rr ?? Number(settings.rr);
    const skipWeekdays = (data.skip_weekdays ?? []) as (0 | 1 | 2 | 3 | 4 | 5 | 6)[];

    // Run sessions in parallel — each call is a separate simulation.
    const results = await Promise.all(
      data.sessions.map(async (sess) => {
        const r = await runBacktestRange({
          symbol,
          sessionStartIst: sess.slice(0, 5),
          slRiskUsd,
          rr,
          days: data.days,
          trailEnabled,
          trailActivateR,
          trailStepR,
          skipWeekdays,
          filters: data.filters,
          entry,
          feeRate: data.fee_rate,
        });
        return {
          session: sess.slice(0, 5),
          summary: {
            days_with_session: r.summary.days_with_session,
            breaks: r.summary.breaks,
            triggered: r.summary.triggered,
            tp: r.summary.tp,
            sl: r.summary.sl,
            open: r.summary.open,
            armed_no_trigger: r.summary.armed_no_trigger,
            win_rate_pct: r.summary.win_rate_pct,
            total_pnl_usd: r.summary.total_pnl_usd,
            net_pnl_usd: r.summary.net_pnl_usd,
            profit_factor: r.summary.profit_factor,
            expectancy_usd: r.summary.expectancy_usd,
            avg_r: r.summary.avg_r,
            max_drawdown_usd: r.summary.max_drawdown_usd,
            fill_rate_pct: r.summary.fill_rate_pct,
            est_fees_usd: r.summary.est_fees_usd,
          },
          equity: r.equity,
        };
      }),
    );
    return {
      symbol,
      days: data.days,
      sl_risk_usd: slRiskUsd,
      rr,
      sessions: results,
    };
  });

const EntryZoneSweepSchema = z.object({
  symbol: z.string().min(3).max(24),
  days: z.number().int().min(1).max(365),
  session_start_ist: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  sl_risk_usd: z.number().positive(),
  rr: z.number().positive(),
  entry_depths: z.array(z.number().min(0).max(1)).min(1).max(32),
  sl_depths: z.array(z.number().min(0).max(2)).min(1).max(32),
  modes: z.array(EntryModeEnum).min(1).max(4),
  trail_enabled: z.boolean().optional(),
  trail_activate_r: z.number().positive().optional(),
  trail_step_r: z.number().positive().optional(),
  skip_weekdays: z.array(z.number().int().min(0).max(6)).optional(),
  filters: FiltersZod,
  fee_rate: z.number().min(0).max(0.01).optional(),
});

export const runEntryZoneSweep = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => EntryZoneSweepSchema.parse(input))
  .handler(async ({ data }) => {
    const { runEntryZoneSweep: run } = await import("@/lib/strategy/sweep.server");
    const result = await run({
      symbol: data.symbol,
      days: data.days,
      sessionStartIst: data.session_start_ist.slice(0, 5),
      slRiskUsd: data.sl_risk_usd,
      rr: data.rr,
      entryDepths: data.entry_depths,
      slDepths: data.sl_depths,
      modes: data.modes,
      trailEnabled: data.trail_enabled,
      trailActivateR: data.trail_activate_r,
      trailStepR: data.trail_step_r,
      skipWeekdays: (data.skip_weekdays ?? []) as (0 | 1 | 2 | 3 | 4 | 5 | 6)[],
      filters: data.filters,
      feeRate: data.fee_rate,
    });
    // Round-trip through JSON to strip Infinity/NaN/undefined which Seroval rejects.
    return JSON.parse(JSON.stringify(result)) as typeof result;
  });


export const listStrategyPresets = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = await admin();
  const { data, error } = await supabase
    .from("strategy_presets")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
});

const PresetCreateSchema = z.object({
  name: z.string().min(1).max(64),
  symbol: z.string().min(1).max(24).optional().nullable(),
  sl_risk_usd: z.number().positive(),
  rr: z.number().positive(),
});

export const createStrategyPreset = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => PresetCreateSchema.parse(input))
  .handler(async ({ data }) => {
    const supabase = await admin();
    const { data: row, error } = await supabase
      .from("strategy_presets")
      .insert({
        name: data.name,
        symbol: data.symbol ?? null,
        sl_risk_usd: data.sl_risk_usd,
        rr: data.rr,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteStrategyPreset = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const supabase = await admin();
    const { error } = await supabase.from("strategy_presets").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const applyStrategyPreset = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const supabase = await admin();
    const { data: preset, error: pErr } = await supabase
      .from("strategy_presets")
      .select("*")
      .eq("id", data.id)
      .single();
    if (pErr || !preset) throw new Error(pErr?.message ?? "Preset not found");
    const patch: {
      sl_risk_usd: number;
      rr: number;
      updated_at: string;
      symbol?: string;
    } = {
      sl_risk_usd: Number(preset.sl_risk_usd),
      rr: Number(preset.rr),
      updated_at: new Date().toISOString(),
    };
    if (preset.symbol) patch.symbol = preset.symbol;
    const { data: row, error } = await supabase
      .from("strategy_settings")
      .update(patch)
      .eq("id", true)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return row;
  });

const SweepSchema = z.object({
  symbol: z.string().min(3).max(24),
  ranges: z.array(z.number().int().min(1).max(365)).min(1).max(6),
  sl_risk_usd: z.number().positive(),
  rr: z.number().positive(),
  trail_enabled: z.boolean().optional(),
  trail_activate_r: z.number().positive().optional(),
  trail_step_r: z.number().positive().optional(),
  skip_weekdays: z.array(z.number().int().min(0).max(6)).optional(),
  filters: FiltersZod,
});

export const sweepHoursBacktest = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => SweepSchema.parse(input))
  .handler(async ({ data }) => {
    const { runSweep } = await import("@/lib/strategy/sweep.server");
    return runSweep({
      symbol: data.symbol,
      ranges: Array.from(new Set(data.ranges)).sort((a, b) => a - b),
      slRiskUsd: data.sl_risk_usd,
      rr: data.rr,
      trailEnabled: data.trail_enabled,
      trailActivateR: data.trail_activate_r,
      trailStepR: data.trail_step_r,
      skipWeekdays: (data.skip_weekdays ?? []) as (0 | 1 | 2 | 3 | 4 | 5 | 6)[],
      filters: data.filters,
    });
  });
