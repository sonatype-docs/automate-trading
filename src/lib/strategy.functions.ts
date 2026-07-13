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
  skip_weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  entry_mode: EntryModeEnum.optional(),
  entry_depth_pct: z.number().min(0).max(0.5).optional(),
  sl_depth_pct: z.number().min(0.1).max(1).optional(),
  adaptive_strong_break_pct: z.number().min(1).max(100).optional(),
  adaptive_shallow_depth: z.number().min(0).max(0.5).optional(),
  adaptive_deep_depth: z.number().min(0).max(0.5).optional(),
  retest_sl_r: z.number().positive().max(5).optional(),
  fee_usd_per_order: z.number().min(0).max(1000).optional(),
  zone_source: z.enum(["range", "breakout"]).optional(),
  data_source: z.enum(["shark", "yahoo"]).optional(),
  ai_grading_enabled: z.boolean().optional(),
  ai_min_grade: z.enum(["A+++", "A++", "A+", "A", "B", "C"]).optional(),
  ai_risk_multipliers: z.record(z.string(), z.number().min(0).max(10)).optional(),
});


const GradeKey = z.enum(["A+++", "A++", "A+", "A", "B", "C"]);
const GradingModelSchema = z.object({
  version: z.literal(1),
  trained_at: z.number(),
  symbol: z.string().nullable(),
  sample_size: z.number(),
  bucketExpectancy: z.record(z.string(), z.number()),
  bucketWinRate: z.record(z.string(), z.number()),
  bucketCount: z.record(z.string(), z.number()),
  edges: z.record(z.string(), z.array(z.number())),
  thresholds: z.record(GradeKey, z.number()),
  scoreMin: z.number(),
  scoreMax: z.number(),
});

export const saveGradingModel = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => GradingModelSchema.parse(input))
  .handler(async ({ data }) => {
    const supabase = await admin();
    const { error } = await supabase
      .from("strategy_settings")
      .update({ ai_grading_model: data as never, updated_at: new Date().toISOString() })
      .eq("id", true);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const clearGradingModel = createServerFn({ method: "POST" }).handler(async () => {
  const supabase = await admin();
  const { error } = await supabase
    .from("strategy_settings")
    .update({ ai_grading_model: null, ai_grading_enabled: false, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) throw new Error(error.message);
  return { ok: true };
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

// ------------------------------------------------------------------
// Bot cockpit helpers — winning-preset apply, cancel today, flatten position.
// ------------------------------------------------------------------

export const ORB_WINNING_PRESET = {
  enabled: true,
  symbol: "XAUUSDT",
  session_start_ist: "05:30",
  entry_mode: "adaptive" as const,
  entry_depth_pct: 0.15,
  sl_depth_pct: 0.6,
  adaptive_strong_break_pct: 30,
  adaptive_shallow_depth: 0.1,
  adaptive_deep_depth: 0.35,
  retest_sl_r: 0.5,
  rr: 2,
  sl_risk_usd: 25,
  trail_enabled: false,
  skip_weekends: false,
};

export const applyOrbWinningPreset = createServerFn({ method: "POST" }).handler(async () => {
  const supabase = await admin();
  const { data, error } = await supabase
    .from("strategy_settings")
    .update({ ...ORB_WINNING_PRESET, updated_at: new Date().toISOString() })
    .eq("id", true)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
});

function todayIstSessionDate(sessionStart: string): string {
  const [hh, mm] = sessionStart.split(":").map(Number);
  const istMs = Date.now() + 5.5 * 3600 * 1000;
  const d = new Date(istMs);
  const minutesOfDay = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (minutesOfDay < hh * 60 + mm) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export const cancelTodayArmedSetup = createServerFn({ method: "POST" }).handler(async () => {
  const supabase = await admin();
  const { data: settings } = await supabase
    .from("strategy_settings")
    .select("session_start_ist")
    .eq("id", true)
    .single();
  const sessionStart = String(settings?.session_start_ist ?? "05:30").slice(0, 5);
  const istDateStr = todayIstSessionDate(sessionStart);

  const { data: setups } = await supabase
    .from("strategy_setups")
    .select("id, exchange_order_id, symbol, side")
    .eq("ist_date", istDateStr)
    .eq("status", "armed");

  if (!setups || setups.length === 0) return { cancelled: 0, results: [] as string[] };

  const { createSharkClient } = await import("@/lib/exchange/shark-client.server");
  const client = createSharkClient();
  const results: string[] = [];
  let cancelled = 0;
  for (const s of setups) {
    if (s.exchange_order_id) {
      try {
        const r = await client.cancelOrder(s.exchange_order_id, s.symbol);
        results.push(`${s.side} ${s.exchange_order_id} → ${r.ok ? "ok" : `err ${r.status}`}`);
      } catch (e) {
        results.push(`${s.side} ${s.exchange_order_id} → threw ${(e as Error).message}`);
      }
    }
    await supabase
      .from("strategy_setups")
      .update({ status: "cancelled", closed_at: new Date().toISOString(), close_reason: "manual_cancel" })
      .eq("id", s.id);
    cancelled += 1;
  }
  return { cancelled, results };
});

export const flattenSymbol = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ symbol: z.string().min(3).max(24) }).parse(input),
  )
  .handler(async ({ data }) => {
    const supabase = await admin();
    const { data: pos } = await supabase
      .from("positions")
      .select("*")
      .eq("symbol", data.symbol)
      .maybeSingle();
    if (!pos || Number(pos.qty) === 0) return { ok: true, message: "no open position" };
    const qty = Math.abs(Number(pos.qty));
    const side: "buy" | "sell" = Number(pos.qty) > 0 ? "sell" : "buy";
    const { createSharkClient } = await import("@/lib/exchange/shark-client.server");
    const client = createSharkClient();
    const res = await client.placeOrder({ symbol: data.symbol, side, qty, type: "market" });
    return { ok: true, message: `market ${side} ${qty} — ${res.status}`, exchange_order_id: res.exchangeOrderId };
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
  days: z.number().int().min(1).max(730),
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
  fee_usd_per_order: z.number().min(0).max(1000).optional(),
  zone_source: z.enum(["range", "breakout"]).optional(),
  data_source: z.enum(["shark", "yahoo"]).optional(),
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
      feeUsdPerOrder: data.fee_usd_per_order,
      zoneSource: data.zone_source,
      dataSource: data.data_source,
    });
  });

const SessionsCompareSchema = RangeSchema.omit({ session_start_ist: true }).extend({
  sessions: z.array(z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/)).min(1).max(48),
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
          feeUsdPerOrder: data.fee_usd_per_order,
        });
        return {
          session: sess.slice(0, 5),
          summary: {
            days_with_session: r.summary.days_with_session,
            filtered_days: r.summary.filtered_days,
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
            avg_win_usd: r.summary.avg_win_usd,
            avg_loss_usd: r.summary.avg_loss_usd,
            best_pnl_usd: r.summary.best_pnl_usd,
            worst_pnl_usd: r.summary.worst_pnl_usd,
            max_drawdown_usd: r.summary.max_drawdown_usd,
            max_consec_wins: r.summary.max_consec_wins,
            max_consec_losses: r.summary.max_consec_losses,
            fill_rate_pct: r.summary.fill_rate_pct,
            median_miss_r: r.summary.median_miss_r,
            near_miss_count: r.summary.near_miss_count,
            est_fees_usd: r.summary.est_fees_usd,
            best_weekday: r.summary.best_weekday,
            worst_weekday: r.summary.worst_weekday,
            mae_wins_p95: r.summary.mae_wins?.p95 ?? null,
            mae_losses_p95: r.summary.mae_losses?.p95 ?? null,
          },

          equity: r.equity,
        };
      }),
    );
    return JSON.parse(JSON.stringify({
      symbol,
      days: data.days,
      sl_risk_usd: slRiskUsd,
      rr,
      sessions: results,
    })) as {
      symbol: string;
      days: number;
      sl_risk_usd: number;
      rr: number;
      sessions: typeof results;
    };
  });


const LiquiditySweepSchema = z.object({
  symbol: z.string().min(3).max(24),
  days: z.number().int().min(1).max(730),
  sl_risk_usd: z.number().positive(),
  rr: z.number().positive(),
  asian_start_ist: z.number().int().min(0).max(23),
  asian_end_ist: z.number().int().min(1).max(24),
  entry_end_ist: z.number().int().min(1).max(24),
  min_range_usd: z.number().nonnegative().optional(),
  entry_pullback_pct: z.number().min(0).max(1).optional(),
  sl_buffer_pct: z.number().min(0).max(1).optional(),
  tp_mode: z.enum(["rr", "opposite", "midrange"]),
  require_close_inside: z.boolean().optional(),
  skip_weekdays: z.array(z.number().int().min(0).max(6)).optional(),
});

export const backtestLiquiditySweep = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => LiquiditySweepSchema.parse(input))
  .handler(async ({ data }) => {
    const { runSweepBacktest } = await import("@/lib/strategy/sweep-liquidity.server");
    const r = await runSweepBacktest({
      symbol: data.symbol,
      days: data.days,
      asianStartIst: data.asian_start_ist,
      asianEndIst: data.asian_end_ist,
      entryEndIst: data.entry_end_ist,
      minRangeUsd: data.min_range_usd,
      entryPullbackPct: data.entry_pullback_pct,
      slBufferPct: data.sl_buffer_pct,
      rr: data.rr,
      tpMode: data.tp_mode,
      slRiskUsd: data.sl_risk_usd,
      requireCloseInside: data.require_close_inside,
      skipWeekdays: data.skip_weekdays,
    });
    // Strip Infinity for Seroval.
    return JSON.parse(JSON.stringify(r)) as typeof r;
  });

const SilverBulletSchema = z.object({
  symbol: z.string().min(3).max(24),
  days: z.number().int().min(1).max(730),
  sl_risk_usd: z.number().positive(),
  rr: z.number().positive(),
  window_start_ist: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  window_end_ist: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  hold_cutoff_ist: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  swing_lookback: z.number().int().min(5).max(100).optional(),
  fvg_min_usd: z.number().min(0).max(50).optional(),
  sl_buffer_usd: z.number().min(0).max(10).optional(),
  max_trades_per_day: z.number().int().min(1).max(5).optional(),
  execution_tf: z.enum(["3m", "5m", "15m"]).optional(),
  skip_weekdays: z.array(z.number().int().min(0).max(6)).optional(),
});

export const backtestSilverBullet = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => SilverBulletSchema.parse(input))
  .handler(async ({ data }) => {
    const { runSilverBulletBacktest } = await import("@/lib/strategy/silver-bullet.server");
    const r = await runSilverBulletBacktest({
      symbol: data.symbol,
      days: data.days,
      slRiskUsd: data.sl_risk_usd,
      rr: data.rr,
      windowStartIst: data.window_start_ist,
      windowEndIst: data.window_end_ist,
      holdCutoffIst: data.hold_cutoff_ist,
      swingLookback: data.swing_lookback,
      fvgMinUsd: data.fvg_min_usd,
      slBufferUsd: data.sl_buffer_usd,
      maxTradesPerDay: data.max_trades_per_day,
      executionTf: data.execution_tf,
      skipWeekdays: data.skip_weekdays,
    });
    return JSON.parse(JSON.stringify(r)) as typeof r;
  });


const EntryZoneSweepSchema = z.object({
  symbol: z.string().min(3).max(24),
  days: z.number().int().min(1).max(730),
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
  ranges: z.array(z.number().int().min(1).max(730)).min(1).max(6),
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

// ------------------------------------------------------------------
// Optimizer — genetic search over ICT Silver Bullet / Asian Sweep params.
// ------------------------------------------------------------------
const OptimizerSchema = z.object({
  strategy: z.enum(["silver_bullet", "asian_sweep", "orb_sessions"]),
  symbol: z.string().min(3).max(24),
  windows: z.array(z.number().int().min(15).max(730)).min(1).max(5),
  sl_risk_usd: z.number().positive(),
  skip_weekdays: z.array(z.number().int().min(0).max(6)).optional(),
  population: z.number().int().min(20).max(120).optional(),
  generations: z.number().int().min(5).max(60).optional(),
  top_n: z.number().int().min(5).max(50).optional(),
});

export const runStrategyOptimizer = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => OptimizerSchema.parse(input))
  .handler(async ({ data }) => {
    const { runOptimizer } = await import("@/lib/strategy/optimizer.server");
    const r = await runOptimizer({
      strategy: data.strategy,
      symbol: data.symbol,
      windows: Array.from(new Set(data.windows)).sort((a, b) => a - b),
      slRiskUsd: data.sl_risk_usd,
      skipWeekdays: data.skip_weekdays ?? [],
      population: data.population,
      generations: data.generations,
      topN: data.top_n,
    });
    return JSON.parse(JSON.stringify(r)) as typeof r;
  });

// ------------------------------------------------------------------
// Live-trade controls: edit SL / TP / close of the currently triggered setup.
// Trailing continues to run on the tick — a manual SL edit resets the baseline
// (initial_sl_price and peak_r) so the ratchet recomputes from the new SL.
// ------------------------------------------------------------------

export const getLiveTriggeredSetup = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = await admin();
  const { data } = await supabase
    .from("strategy_setups")
    .select("*")
    .eq("status", "triggered")
    .order("filled_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
});

const EditLevelSchema = z.object({
  setup_id: z.string().uuid(),
  sl_price: z.number().positive().optional(),
  tp_price: z.number().positive().optional(),
});

export const editLiveTradeLevels = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => EditLevelSchema.parse(input))
  .handler(async ({ data }) => {
    if (data.sl_price === undefined && data.tp_price === undefined) {
      throw new Error("Nothing to update — provide sl_price and/or tp_price.");
    }
    const supabase = await admin();
    const { data: setup, error: setupErr } = await supabase
      .from("strategy_setups")
      .select("*")
      .eq("id", data.setup_id)
      .single();
    if (setupErr || !setup) throw new Error(setupErr?.message ?? "Setup not found");
    if (setup.status !== "triggered") throw new Error(`Setup is ${setup.status}, only 'triggered' can be edited.`);

    const side = setup.side as "long" | "short";
    // Sanity checks: SL on the losing side, TP on the winning side, relative to entry.
    if (data.sl_price !== undefined) {
      if (side === "long" && data.sl_price >= Number(setup.entry_price))
        throw new Error("SL must be BELOW entry for a long.");
      if (side === "short" && data.sl_price <= Number(setup.entry_price))
        throw new Error("SL must be ABOVE entry for a short.");
    }
    if (data.tp_price !== undefined) {
      if (side === "long" && data.tp_price <= Number(setup.entry_price))
        throw new Error("TP must be ABOVE entry for a long.");
      if (side === "short" && data.tp_price >= Number(setup.entry_price))
        throw new Error("TP must be BELOW entry for a short.");
    }

    const results: Array<{ leg: "sl" | "tp"; ok: boolean; status?: number; message: string }> = [];
    const { data: globalSettings } = await supabase
      .from("settings")
      .select("paper_mode")
      .eq("id", true)
      .maybeSingle();
    const isLive = !!setup.exchange_order_id && !globalSettings?.paper_mode;

    let client: ReturnType<typeof import("@/lib/exchange/shark-client.server").createSharkClient> | null = null;
    if (isLive) {
      const { createSharkClient } = await import("@/lib/exchange/shark-client.server");
      client = createSharkClient();
    }

    // ---- SL edit ----
    if (data.sl_price !== undefined) {
      let slChildId = setup.sl_child_order_id;
      if (isLive && client && !slChildId) {
        // Try to discover if we don't have it yet.
        try {
          const openRows = await client.getOpenOrders(setup.symbol);
          const exitSide = side === "long" ? "SELL" : "BUY";
          const match = openRows
            .filter((o) => {
              const type = (o.type || "").toUpperCase();
              const sub = (o.subType || "").toUpperCase();
              const link = (o.linkType || "").toUpperCase();
              const looksStop = type.startsWith("STOP") || sub.includes("STOP_LOSS") || link.includes("SL");
              const looksTp = sub.includes("TAKE_PROFIT") || link.includes("TP");
              return looksStop && !looksTp && (o.side || "").toUpperCase() === exitSide;
            })
            .sort((a, b) => Math.abs((a.stopPrice ?? a.price ?? 0) - Number(setup.sl_price)) - Math.abs((b.stopPrice ?? b.price ?? 0) - Number(setup.sl_price)))[0];
          if (match) slChildId = match.clientOrderId;
        } catch {
          /* fall through */
        }
      }
      if (isLive && client && slChildId) {
        const editRes = await client.editOrder({ clientOrderId: slChildId, stopPrice: data.sl_price });
        results.push({
          leg: "sl",
          ok: editRes.ok,
          status: editRes.status,
          message: editRes.ok ? `SL updated on exchange → ${data.sl_price}` : `Exchange rejected [${editRes.status}]: ${editRes.body.slice(0, 200)}`,
        });
        if (!editRes.ok && (editRes.status === 404 || /not.?found/i.test(editRes.body))) {
          slChildId = null;
        }
      } else {
        results.push({ leg: "sl", ok: true, message: isLive ? "SL saved (exchange child not yet discovered — next tick will sync)" : "SL saved (paper mode)" });
      }
      // Reset trailing baseline so the ratchet recomputes from the new SL.
      await supabase
        .from("strategy_setups")
        .update({
          sl_price: data.sl_price,
          initial_sl_price: data.sl_price,
          peak_r: 0,
          sl_child_order_id: slChildId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", setup.id);
    }

    // ---- TP edit ----
    if (data.tp_price !== undefined) {
      let tpChildId = setup.tp_child_order_id;
      if (isLive && client && !tpChildId) {
        try {
          const openRows = await client.getOpenOrders(setup.symbol);
          const exitSide = side === "long" ? "SELL" : "BUY";
          const match = openRows
            .filter((o) => {
              const sub = (o.subType || "").toUpperCase();
              const link = (o.linkType || "").toUpperCase();
              const type = (o.type || "").toUpperCase();
              const looksTp = sub.includes("TAKE_PROFIT") || link.includes("TP") || type.includes("TAKE_PROFIT");
              const looksSl = sub.includes("STOP_LOSS") || link.includes("SL");
              return looksTp && !looksSl && (o.side || "").toUpperCase() === exitSide;
            })
            .sort((a, b) => Math.abs((a.price ?? a.stopPrice ?? 0) - Number(setup.tp_price)) - Math.abs((b.price ?? b.stopPrice ?? 0) - Number(setup.tp_price)))[0];
          if (match) tpChildId = match.clientOrderId;
        } catch {
          /* fall through */
        }
      }
      if (isLive && client && tpChildId) {
        // TP is a limit — edit price. Fallback to stopPrice for exchanges that use STOP_LIMIT TPs.
        const editRes = await client.editOrder({ clientOrderId: tpChildId, price: data.tp_price });
        results.push({
          leg: "tp",
          ok: editRes.ok,
          status: editRes.status,
          message: editRes.ok ? `TP updated on exchange → ${data.tp_price}` : `Exchange rejected [${editRes.status}]: ${editRes.body.slice(0, 200)}`,
        });
        if (!editRes.ok && (editRes.status === 404 || /not.?found/i.test(editRes.body))) {
          tpChildId = null;
        }
      } else {
        results.push({ leg: "tp", ok: true, message: isLive ? "TP saved (exchange child not yet discovered — next tick will sync)" : "TP saved (paper mode)" });
      }
      await supabase
        .from("strategy_setups")
        .update({
          tp_price: data.tp_price,
          tp_child_order_id: tpChildId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", setup.id);
    }

    return { ok: results.every((r) => r.ok), results };
  });

export const closeLiveTradeNow = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ setup_id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const supabase = await admin();
    const { data: setup, error } = await supabase
      .from("strategy_setups")
      .select("*")
      .eq("id", data.setup_id)
      .single();
    if (error || !setup) throw new Error(error?.message ?? "Setup not found");
    if (setup.status !== "triggered") throw new Error(`Setup is ${setup.status}, cannot close.`);

    const { data: globalSettings } = await supabase
      .from("settings")
      .select("paper_mode")
      .eq("id", true)
      .maybeSingle();
    const isLive = !!setup.exchange_order_id && !globalSettings?.paper_mode;
    const side = setup.side as "long" | "short";
    const exitSide: "buy" | "sell" = side === "long" ? "sell" : "buy";

    let exchangeOrderId: string | null = null;
    let message = "closed (paper mode)";
    if (isLive) {
      const { createSharkClient } = await import("@/lib/exchange/shark-client.server");
      const client = createSharkClient();
      const res = await client.placeOrder({
        symbol: setup.symbol,
        side: exitSide,
        qty: Math.abs(Number(setup.qty)),
        type: "market",
        reduceOnly: true,
      });
      exchangeOrderId = res.exchangeOrderId;
      message = `market ${exitSide} ${setup.qty} — ${res.status}`;
    }
    await supabase
      .from("strategy_setups")
      .update({
        status: "closed",
        close_reason: "manual_close",
        close_order_id: exchangeOrderId,
        closed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", setup.id);
    return { ok: true, message };
  });

