import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createSharkClient, type Kline } from "@/lib/exchange/shark-client.server";
import { processSignal } from "@/lib/trading/engine.server";

const IST_OFFSET_MIN = 330; // UTC+5:30

// (istDate helper removed — engine uses sessionDate for trading-day boundaries.)


// Return the "trading session date" (YYYY-MM-DD in IST) for `now`, where a
// session runs from sessionStartIst (e.g. 06:00) of day D until sessionStartIst
// of day D+1. So between 00:00 and 05:29 IST, the session date is the previous
// calendar day. Yesterday's pending setups are expired the moment this rolls.
function sessionDate(msUtc: number, sessionStartIst: string): string {
  const [hh, mm] = sessionStartIst.split(":").map((n) => parseInt(n, 10));
  const startMinOfDay = hh * 60 + (mm || 0);
  const ist = new Date(msUtc + IST_OFFSET_MIN * 60_000);
  const minOfDay = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  if (minOfDay < startMinOfDay) {
    ist.setUTCDate(ist.getUTCDate() - 1);
  }
  return ist.toISOString().slice(0, 10);
}

function istWeekday(istDateStr: string): number {
  const [y, m, d] = istDateStr.split("-").map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sun … 6 Sat
}

// The 1h candle openTime (UTC ms) for the IST session-start hour on a given IST date.
// Default 06:00 IST → 00:00 UTC.
function sessionOpenUtcMs(istDateStr: string, sessionStartIst: string): number {
  const [hh, mm] = sessionStartIst.split(":").map((n) => parseInt(n, 10));
  const totalMin = hh * 60 + (mm || 0) - IST_OFFSET_MIN;
  // Normalize possibly negative minutes → previous UTC day
  const [y, m, d] = istDateStr.split("-").map((n) => parseInt(n, 10));
  const baseUtc = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  const openMs = baseUtc + totalMin * 60_000;
  // Snap to hour open
  return Math.floor(openMs / 3_600_000) * 3_600_000;
}

interface StrategySettingsRow {
  enabled: boolean;
  symbol: string;
  sl_risk_usd: number;
  rr: number;
  session_start_ist: string;
  trail_enabled?: boolean;
  trail_activate_r?: number;
  trail_step_r?: number;
  skip_weekends?: boolean;
}

interface SessionRow {
  ist_date: string;
  symbol: string;
  zone_high: number;
  zone_low: number;
  fib_25: number;
  fib_75: number;
  break_side: "long" | "short" | null;
  break_detected_at: string | null;
  break_close_price: number | null;
}

interface SetupRow {
  id: string;
  ist_date: string;
  symbol: string;
  side: "long" | "short";
  entry_price: number;
  sl_price: number;
  tp_price: number;
  qty: number;
  status: "armed" | "triggered" | "closed" | "expired" | "cancelled";
  order_id: string | null;
  close_order_id: string | null;
  close_reason: string | null;
  pnl_usd: number | null;
  filled_at: string | null;
  closed_at: string | null;
  peak_r?: number;
  initial_sl_price?: number | null;
}

export interface StrategyTickResult {
  ok: boolean;
  reason?: string;
  ist_date?: string;
  session?: SessionRow | null;
  actions: string[];
}

async function log(severity: "info" | "warn" | "error", message: string, context?: Record<string, unknown>) {
  await supabaseAdmin.from("activity_log").insert({
    severity,
    message: `[strategy] ${message}`,
    context: (context as never) ?? null,
  });
}

export async function runStrategyTick(): Promise<StrategyTickResult> {
  const actions: string[] = [];

  const { data: settings } = await supabaseAdmin
    .from("strategy_settings")
    .select("*")
    .eq("id", true)
    .single();
  const s = settings as StrategySettingsRow | null;
  if (!s) return { ok: false, reason: "settings_missing", actions };
  if (!s.enabled) return { ok: true, reason: "disabled", actions };

  const { data: globalSettings } = await supabaseAdmin
    .from("settings")
    .select("kill_switch, paper_mode")
    .eq("id", true)
    .single();
  if (globalSettings?.kill_switch) return { ok: true, reason: "kill_switch", actions };

  const client = createSharkClient();

  // Fetch enough 1h klines to cover today's session + subsequent bars
  let klines: Kline[];
  try {
    klines = await client.getKlines(s.symbol, "1h", 96);
  } catch (e) {
    await log("error", "klines fetch failed", { error: (e as Error).message });
    return { ok: false, reason: "klines_failed", actions };
  }
  if (klines.length === 0) return { ok: false, reason: "no_klines", actions };

  const now = Date.now();
  const todayIst = sessionDate(now, s.session_start_ist);

  // Expire leftover armed setups from previous IST session days. Runs first so
  // stale orders are cancelled the moment the new session date rolls (≈06:00 IST).
  const { data: expiredRows } = await supabaseAdmin
    .from("strategy_setups")
    .update({ status: "expired", updated_at: new Date().toISOString() })
    .lt("ist_date", todayIst)
    .eq("status", "armed")
    .select("id");
  if (expiredRows && expiredRows.length > 0) {
    actions.push(`expired_prev_day=${expiredRows.length}`);
  }

  // Optional: skip Sunday (low volume). Sat/Fri etc. remain tradeable.
  if (s.skip_weekends) {
    const wd = istWeekday(todayIst);
    if (wd === 0) {
      return { ok: true, reason: "sunday_skip", ist_date: todayIst, actions };
    }
  }

  const sessionOpen = sessionOpenUtcMs(todayIst, s.session_start_ist);
  const sessionCandle = klines.find((k) => k.openTime === sessionOpen);
  if (!sessionCandle) {
    return { ok: true, reason: "session_candle_not_yet_available", ist_date: todayIst, actions };
  }
  // Need it to be closed
  if (sessionCandle.closeTime > now) {
    return { ok: true, reason: "session_candle_forming", ist_date: todayIst, actions };
  }

  // Upsert session zone
  const zone_high = sessionCandle.high;
  const zone_low = sessionCandle.low;
  const range = zone_high - zone_low;
  const fib_25 = zone_high - range * 0.25;
  const fib_75 = zone_high - range * 0.75;

  const { data: existingSessionRaw } = await supabaseAdmin
    .from("strategy_sessions")
    .select("*")
    .eq("ist_date", todayIst)
    .maybeSingle();
  let session = existingSessionRaw as SessionRow | null;

  if (!session) {
    const { data: inserted } = await supabaseAdmin
      .from("strategy_sessions")
      .insert({
        ist_date: todayIst,
        symbol: s.symbol,
        zone_high,
        zone_low,
        fib_25,
        fib_75,
      })
      .select()
      .single();
    session = inserted as SessionRow;
    actions.push(`session_created zone=${zone_low}-${zone_high}`);
  }

  // Detect break: scan 1h closed candles AFTER session candle
  if (!session.break_side) {
    const later = klines.filter(
      (k) => k.openTime > sessionCandle.openTime && k.closeTime <= now,
    );
    for (const k of later) {
      if (k.close > zone_high) {
        session.break_side = "long";
        session.break_close_price = k.close;
        session.break_detected_at = new Date(k.closeTime).toISOString();
        break;
      }
      if (k.close < zone_low) {
        session.break_side = "short";
        session.break_close_price = k.close;
        session.break_detected_at = new Date(k.closeTime).toISOString();
        break;
      }
    }
    if (session.break_side) {
      await supabaseAdmin
        .from("strategy_sessions")
        .update({
          break_side: session.break_side,
          break_close_price: session.break_close_price,
          break_detected_at: session.break_detected_at,
          updated_at: new Date().toISOString(),
        })
        .eq("ist_date", todayIst);
      actions.push(`break=${session.break_side} @${session.break_close_price}`);
    }
  }

  // Arm setup if break happened and no setup yet for that side today
  if (session.break_side) {
    const { data: existingSetup } = await supabaseAdmin
      .from("strategy_setups")
      .select("*")
      .eq("ist_date", todayIst)
      .eq("side", session.break_side)
      .maybeSingle();

    if (!existingSetup) {
      const side = session.break_side;
      const entry = side === "long" ? fib_25 : fib_75;
      const sl = side === "long" ? fib_75 : fib_25;
      const risk = Math.abs(entry - sl);
      const tp = side === "long" ? entry + risk * s.rr : entry - risk * s.rr;
      const qty = risk > 0 ? s.sl_risk_usd / risk : 0;
      if (qty > 0) {
        await supabaseAdmin.from("strategy_setups").insert({
          ist_date: todayIst,
          symbol: s.symbol,
          side,
          entry_price: entry,
          sl_price: sl,
          initial_sl_price: sl,
          tp_price: tp,
          qty,
          status: "armed",
        });
        actions.push(`armed ${side} entry=${entry.toFixed(2)} sl=${sl.toFixed(2)} tp=${tp.toFixed(2)} qty=${qty.toFixed(4)}`);
      }
    }
  }

  // Current price for triggers / TP-SL monitoring
  let lastPrice: number | null = null;
  try {
    lastPrice = await client.getLastPrice(s.symbol);
  } catch {
    lastPrice = klines[klines.length - 1]?.close ?? null;
  }
  const currentBar = klines[klines.length - 1];

  // Trigger armed setups
  const { data: armedRows } = await supabaseAdmin
    .from("strategy_setups")
    .select("*")
    .eq("ist_date", todayIst)
    .eq("status", "armed");
  for (const setup of (armedRows ?? []) as SetupRow[]) {
    const barLow = currentBar?.low ?? lastPrice ?? setup.entry_price;
    const barHigh = currentBar?.high ?? lastPrice ?? setup.entry_price;
    const trigger =
      setup.side === "long"
        ? barLow <= setup.entry_price
        : barHigh >= setup.entry_price;
    if (!trigger) continue;
    const result = await processSignal(
      {
        symbol: setup.symbol,
        action: setup.side === "long" ? "buy" : "sell",
        price: setup.entry_price,
        size_usd: setup.qty * setup.entry_price,
        alert_id: `strategy-${setup.id}-entry`,
      },
      // synthesize a webhook_event row so orders link somewhere
      await ensureStrategyEvent(setup, "entry"),
    );
    await supabaseAdmin
      .from("strategy_setups")
      .update({
        status: result.status === "executed" ? "triggered" : "cancelled",
        order_id: result.order_id ?? null,
        filled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", setup.id);
    actions.push(`trigger ${setup.side} → ${result.status}`);
  }

  // Monitor triggered setups for TP / SL
  const { data: triggered } = await supabaseAdmin
    .from("strategy_setups")
    .select("*")
    .eq("status", "triggered");
  const trailEnabled = !!s.trail_enabled;
  const trailActivateR = Math.max(0.1, Number(s.trail_activate_r ?? 2));
  const trailStepR = Math.max(0.1, Number(s.trail_step_r ?? 1));
  for (const setup of (triggered ?? []) as SetupRow[]) {
    if (lastPrice == null) break;
    const initialSl = Number(setup.initial_sl_price ?? setup.sl_price);
    const risk = Math.abs(setup.entry_price - initialSl);

    // Update peak-R using both the current bar's favorable extreme AND lastPrice.
    const favBar =
      setup.side === "long"
        ? Math.max(currentBar?.high ?? lastPrice, lastPrice)
        : Math.min(currentBar?.low ?? lastPrice, lastPrice);
    const curR = risk > 0 ? ((favBar - setup.entry_price) * (setup.side === "long" ? 1 : -1)) / risk : 0;
    const peakR = Math.max(Number(setup.peak_r ?? 0), curR);

    // Compute the trailed SL, if trailing is armed.
    let dynSl = Number(setup.sl_price);
    if (trailEnabled && peakR >= trailActivateR && risk > 0) {
      const steps = Math.floor((peakR - trailActivateR) / trailStepR);
      const slR = steps * trailStepR;
      const newSl =
        setup.side === "long" ? setup.entry_price + slR * risk : setup.entry_price - slR * risk;
      if (setup.side === "long" ? newSl > dynSl : newSl < dynSl) dynSl = newSl;
    }

    // Persist trailing progress if it advanced or peak changed.
    if (peakR > Number(setup.peak_r ?? 0) || dynSl !== Number(setup.sl_price)) {
      await supabaseAdmin
        .from("strategy_setups")
        .update({
          peak_r: peakR,
          sl_price: dynSl,
          updated_at: new Date().toISOString(),
        })
        .eq("id", setup.id);
      if (dynSl !== Number(setup.sl_price)) {
        actions.push(`trail ${setup.side} peak=${peakR.toFixed(2)}R sl→${dynSl.toFixed(2)}`);
      }
    }

    const hitTp =
      setup.side === "long" ? lastPrice >= setup.tp_price : lastPrice <= setup.tp_price;
    const hitSl =
      setup.side === "long" ? lastPrice <= dynSl : lastPrice >= dynSl;
    if (!hitTp && !hitSl) continue;
    const reason: "tp" | "sl" = hitTp ? "tp" : "sl";
    const result = await processSignal(
      {
        symbol: setup.symbol,
        action: "close",
        price: lastPrice,
        alert_id: `strategy-${setup.id}-close-${reason}`,
      },
      await ensureStrategyEvent(setup, `close_${reason}`),
    );
    const pnl =
      setup.side === "long"
        ? (lastPrice - setup.entry_price) * setup.qty
        : (setup.entry_price - lastPrice) * setup.qty;
    await supabaseAdmin
      .from("strategy_setups")
      .update({
        status: "closed",
        close_reason: reason,
        close_order_id: result.order_id ?? null,
        pnl_usd: pnl,
        closed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", setup.id);
    actions.push(`close ${setup.side} @${lastPrice} reason=${reason} pnl=${pnl.toFixed(2)}`);
  }

  // (Prior-day armed setups are expired at the top of the tick.)



  return { ok: true, ist_date: todayIst, session, actions };
}

async function ensureStrategyEvent(
  setup: SetupRow,
  kind: string,
): Promise<string> {
  const alertId = `strategy-${setup.id}-${kind}-${Date.now()}`;
  const { data } = await supabaseAdmin
    .from("webhook_events")
    .insert({
      alert_id: alertId,
      status: "received",
      raw_payload: { source: "strategy", setup_id: setup.id, kind } as never,
    })
    .select("id")
    .single();
  return (data?.id as string) ?? "";
}
