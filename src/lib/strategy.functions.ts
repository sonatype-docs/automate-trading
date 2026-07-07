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
  days: z.number().int().min(1).max(365),
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
  days: z.number().int().min(1).max(365),
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
