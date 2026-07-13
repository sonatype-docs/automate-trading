import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createSharkClient, type Kline } from "@/lib/exchange/shark-client.server";
import { getKlineSource } from "@/lib/exchange/kline-source.server";
import { processSignal } from "@/lib/trading/engine.server";
import { computeEntry, entryConfigFromSettings } from "@/lib/strategy/entry-modes.server";



const IST_OFFSET_MIN = 330; // UTC+5:30

// (istDate helper removed — engine uses sessionDate for trading-day boundaries.)


// Return the "trading session date" (YYYY-MM-DD in IST) for `now`, where a
// session runs from sessionStartIst (e.g. 05:30) of day D until sessionStartIst
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
// Default 05:30 IST → 00:00 UTC.
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
  skip_weekdays?: number[] | null;
  fee_usd_per_order?: number;
  zone_source?: "range" | "breakout" | null;
  data_source?: "shark" | "yahoo" | null;
  ai_grading_enabled?: boolean;
  ai_grading_model?: unknown;
  ai_risk_multipliers?: Record<string, number> | null;
  ai_min_grade?: string;
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
  exchange_order_id?: string | null;
  sl_child_order_id?: string | null;
  tp_child_order_id?: string | null;
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

// Detect "Insufficient margin" style rejections from SharkExchange so we can
// retry full planned qty after the exchange releases any locked margin.
function isInsufficientMarginError(msg: string | null | undefined): boolean {
  if (!msg) return false;
  const s = msg.toLowerCase();
  return s.includes("insufficient margin") || s.includes('"3018"') || s.includes("code:3018");
}

function isRecoverableCapacityError(msg: string | null | undefined): boolean {
  if (!msg) return false;
  const s = msg.toLowerCase();
  return isInsufficientMarginError(msg) || s.includes('"3070"') || s.includes("maximum position size");
}

function roundExchangeQty(qty: number): number {
  return Math.round(qty * 1000) / 1000;
}

function roundExchangePrice(price: number): number {
  return Math.round(price * 100) / 100;
}

function sameExchangeNumber(a: number | null | undefined, b: number, decimals: 2 | 3): boolean {
  if (a == null || !Number.isFinite(Number(a)) || !Number.isFinite(b)) return false;
  const factor = decimals === 2 ? 100 : 1000;
  return Math.round(Number(a) * factor) === Math.round(b * factor);
}

function samePendingSetupOrder(order: { side: string; price: number | null; quantity: number | null }, setup: SetupRow): boolean {
  const expectedSide = setup.side === "long" ? "BUY" : "SELL";
  return (
    order.side.toUpperCase() === expectedSide &&
    sameExchangeNumber(order.price, setup.entry_price, 2) &&
    sameExchangeNumber(order.quantity, setup.qty, 3)
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface MarginRetryResult {
  res: Awaited<ReturnType<ReturnType<typeof createSharkClient>["placeOrder"]>> | null;
  finalQty: number;
  error: string | null;
  attempts: number;
  shrunk: boolean;
}

function extractNumericField(source: unknown, keys: string[]): number | null {
  if (!source || typeof source !== "object") return null;
  const obj = source as Record<string, unknown>;
  for (const key of keys) {
    const n = Number(obj[key]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

async function estimateMaxCapacityQty(
  client: ReturnType<typeof createSharkClient>,
  symbol: string,
  price: number,
): Promise<number | null> {
  try {
    const snap = await client.getAccountSnapshot();
    const wallet = snap.futuresWallet;
    const marginBalance = extractNumericField(wallet, [
      "marginBalance",
      "withdrawableBalance",
      "maxWithdrawableBalance",
      "walletBalance",
      "inrBalance",
    ]);
    if (!marginBalance || !Number.isFinite(price) || price <= 0) return null;

    const marginAsset =
      wallet && typeof wallet === "object"
        ? String((wallet as Record<string, unknown>).marginAsset ?? "").toUpperCase()
        : "";
    // Shark reports the XAUUSDT futures wallet in INR on this account while
    // order prices are USDT. Successful exchange responses show ~102 INR/USDT.
    // Keep a safety buffer so the exchange does not auto-reject after rounding.
    const quoteToMarginRate = marginAsset === "INR" && symbol.toUpperCase().endsWith("USDT") ? 102 : 1;
    const leverage = 75;
    return Math.floor(((marginBalance / quoteToMarginRate) * leverage * 0.94 / price) * 1000) / 1000;
  } catch {
    return null;
  }
}

// Place a Shark order at the exact exchange-supported planned size. We do NOT
// shrink qty here: the strategy's qty is derived from the configured SL risk,
// so reducing it silently changes planned risk. On insufficient-margin errors
// we retry the same full exchange-rounded qty, which handles the exchange's
// brief margin-release delay after cancel/replace.
async function placeOrderWithMarginRetry(
  client: ReturnType<typeof createSharkClient>,
  params: {
    symbol: string;
    side: "buy" | "sell";
    qty: number;
    type: "market" | "limit";
    price: number;
    stopLossPrice: number;
    takeProfitPrice: number;
  },
  opts: { minQty?: number; shrinkFactor?: number; maxAttempts?: number; fullQtyAttempts?: number; retryDelayMs?: number } = {},
): Promise<MarginRetryResult> {
  const minQty = opts.minQty ?? 0.001;
  const retryDelayMs = opts.retryDelayMs ?? 1500;
  const maxAttempts = opts.maxAttempts ?? 10;
  const shrinkFactor = opts.shrinkFactor ?? 0.9;
  const fullQtyAttempts = opts.fullQtyAttempts ?? 1;
  let qty = roundExchangeQty(params.qty);
  let attempts = 0;
  let lastError: string | null = null;
  let shrunk = false;
  while (attempts < maxAttempts && qty >= minQty) {
    attempts += 1;
    try {
      const res = await client.placeOrder({ ...params, qty });
      if (res.status === "rejected") {
        lastError = "exchange rejected";
        break;
      }
      return { res, finalQty: qty, error: null, attempts, shrunk };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      lastError = msg;
      if (!isRecoverableCapacityError(msg)) break;
      if (attempts < fullQtyAttempts) {
        await log("warn", "place: retrying full qty after exchange capacity rejection", {
          symbol: params.symbol,
          side: params.side,
          qty,
          attempt: attempts,
        });
        await wait(retryDelayMs);
        continue;
      }

      const estimatedMax = await estimateMaxCapacityQty(client, params.symbol, params.price);
      const nextQty = roundExchangeQty(
        estimatedMax && estimatedMax > 0 && estimatedMax < qty
          ? estimatedMax
          : qty * shrinkFactor,
      );
      if (nextQty >= qty || nextQty < minQty) break;
      await log("warn", "place: full planned qty exceeds exchange capacity; retrying capped qty", {
        symbol: params.symbol,
        side: params.side,
        planned_qty: roundExchangeQty(params.qty),
        retry_qty: nextQty,
        attempt: attempts,
        error: msg,
      });
      qty = nextQty;
      shrunk = true;
      if (attempts < maxAttempts) await wait(retryDelayMs);
    }
  }
  return { res: null, finalQty: qty, error: lastError ?? "place_failed", attempts, shrunk };
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
  // stale orders are cancelled the moment the new session date rolls (≈05:30 IST).
  // For live setups with a pending LIMIT on the exchange, cancel it there too.
  const { data: staleSetupsRaw } = await supabaseAdmin
    .from("strategy_setups")
    .select("id, exchange_order_id, symbol")
    .lt("ist_date", todayIst)
    .eq("status", "armed");
  const staleSetups = (staleSetupsRaw ?? []) as Array<{ id: string; exchange_order_id: string | null; symbol: string }>;
  if (staleSetups.length > 0) {
    if (!globalSettings?.paper_mode) {
      for (const st of staleSetups) {
        if (!st.exchange_order_id) continue;
        try {
          await client.cancelOrder(st.exchange_order_id, st.symbol);
        } catch (e) {
          await log("warn", "cancel prior-day pending failed", {
            setup_id: st.id,
            exchange_order_id: st.exchange_order_id,
            error: (e as Error).message,
          });
        }
      }
    }
    await supabaseAdmin
      .from("strategy_setups")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .in("id", staleSetups.map((s) => s.id));
    actions.push(`expired_prev_day=${staleSetups.length}`);
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

  // Arm setup if break happened and no ACTIVE setup yet for that side today.
  // A previously "cancelled" setup (e.g. insufficient margin on first attempt)
  // is eligible for re-arm — we UPDATE that row instead of inserting a new one.
  if (session.break_side) {
    const { data: existingSetup } = await supabaseAdmin
      .from("strategy_setups")
      .select("*")
      .eq("ist_date", todayIst)
      .eq("side", session.break_side)
      .maybeSingle();

    const eligibleForArm = !existingSetup || existingSetup.status === "cancelled";

    if (eligibleForArm) {
      const side = session.break_side;
      const cfg = entryConfigFromSettings(s as unknown as Record<string, unknown>);
      const breakClose = Number(session.break_close_price ?? (side === "long" ? zone_high : zone_low));
      const { entry, sl, market } = computeEntry(side, zone_high, zone_low, breakClose, cfg);
      const risk = Math.abs(entry - sl);
      const tp = side === "long" ? entry + risk * s.rr : entry - risk * s.rr;

      // ---- AI Grading gate + risk scaling (post-hoc model) ----
      let effectiveSlRiskUsd = s.sl_risk_usd;
      // aiGradeInfo captured in action log for observability
      if (s.ai_grading_enabled && s.ai_grading_model) {
        try {
          const { scoreCandidate, DEFAULT_RISK_MULTIPLIERS, GRADE_ORDER } = await import("@/lib/research/grading");
          // Build a partial live TradeFeatures from what we know now.
          const breakCandle = klines.find(
            (k) => k.openTime === new Date(session.break_detected_at ?? "").getTime() - 3_600_000 + 3_600_000,
          ) ?? klines.filter((k) => k.openTime > sessionCandle.openTime && k.close === breakClose)[0];
          const bc = breakCandle;
          const bcRange = bc ? bc.high - bc.low : 0;
          const bcBody = bc ? Math.abs(bc.close - bc.open) : 0;
          const orRange = zone_high - zone_low;
          const breakDistanceUsd = side === "long" ? breakClose - zone_high : zone_low - breakClose;
          const breakHourIst = session.break_detected_at
            ? new Date(new Date(session.break_detected_at).getTime() + IST_OFFSET_MIN * 60_000).getUTCHours()
            : null;
          const istDate = new Date(todayIst + "T00:00:00Z");
          const candidate = {
            side,
            or_size_usd: orRange,
            break_distance_usd: breakDistanceUsd,
            break_distance_pct_or: orRange > 0 ? (breakDistanceUsd / orRange) * 100 : null,
            body_pct: bcRange > 0 ? (bcBody / bcRange) * 100 : null,
            upper_wick_pct: bc && bcRange > 0 ? ((bc.high - Math.max(bc.open, bc.close)) / bcRange) * 100 : null,
            lower_wick_pct: bc && bcRange > 0 ? ((Math.min(bc.open, bc.close) - bc.low) / bcRange) * 100 : null,
            break_hour_ist: breakHourIst,
            weekday: istDate.getUTCDay(),
            month: istDate.getUTCMonth() + 1,
            quarter: Math.floor(istDate.getUTCMonth() / 3) + 1,
          };
          const model = s.ai_grading_model as Parameters<typeof scoreCandidate>[1];
          const graded = scoreCandidate(candidate as never, model);
          const multMap = (s.ai_risk_multipliers && typeof s.ai_risk_multipliers === "object"
            ? (s.ai_risk_multipliers as Record<string, number>)
            : (DEFAULT_RISK_MULTIPLIERS as unknown as Record<string, number>));
          const mult = multMap[graded.grade] ?? DEFAULT_RISK_MULTIPLIERS[graded.grade] ?? 0;
          const minGrade = (s.ai_min_grade ?? "C") as (typeof GRADE_ORDER)[number];
          const gradeRank = GRADE_ORDER.indexOf(graded.grade);
          const minRank = GRADE_ORDER.indexOf(minGrade);
          void graded;
          if (gradeRank > minRank || mult <= 0) {
            await log("info", "ai_grade skip", { side, grade: graded.grade, score: graded.score, minGrade, mult });
            actions.push(`ai_skip ${side} grade=${graded.grade} score=${graded.score} < min=${minGrade}`);
            // mark existing (cancelled row) untouched and exit arm branch
            return { ok: true, ist_date: todayIst, actions, session };
          }
          effectiveSlRiskUsd = s.sl_risk_usd * mult;
          actions.push(`ai_grade ${side} grade=${graded.grade} score=${graded.score} mult=${mult}x risk=$${effectiveSlRiskUsd.toFixed(2)}`);
        } catch (e) {
          await log("warn", "ai_grade failed — proceeding with base risk", { error: (e as Error).message });
        }
      }

      const requestedQty = risk > 0 ? effectiveSlRiskUsd / risk : 0;
      if (requestedQty > 0) {

        // Place a pending LIMIT (or MARKET when entry_mode='market') on the exchange.
        let exchangeOrderId: string | null = null;
        let placeError: string | null = null;
        let finalQty = requestedQty;
        if (!globalSettings?.paper_mode) {
          const attempt = await placeOrderWithMarginRetry(client, {
            symbol: s.symbol,
            side: side === "long" ? "buy" : "sell",
            qty: requestedQty,
            type: market ? "market" : "limit",
            price: entry,
            stopLossPrice: sl,
            takeProfitPrice: tp,
          });
          if (attempt.res) {
            exchangeOrderId = attempt.res.exchangeOrderId || null;
            finalQty = attempt.finalQty;
            await log("info", "arm: shark placeOrder response", {
              side, entry, qty: finalQty, requestedQty, shrunk: attempt.shrunk,
              attempts: attempt.attempts, mode: cfg.mode, market,
              parsed: { exchangeOrderId: attempt.res.exchangeOrderId, status: attempt.res.status, filledPrice: attempt.res.filledPrice },
              raw: attempt.res.raw,
            });
          } else {
            placeError = attempt.error;
          }
        }
        const setupPayload = {
          ist_date: todayIst,
          symbol: s.symbol,
          side,
          entry_price: entry,
          sl_price: sl,
          initial_sl_price: sl,
          tp_price: tp,
          qty: finalQty,
          status: placeError && !isRecoverableCapacityError(placeError) ? ("cancelled" as const) : ("armed" as const),
          exchange_order_id: exchangeOrderId,
          updated_at: new Date().toISOString(),
        };
        if (existingSetup) {
          await supabaseAdmin
            .from("strategy_setups")
            .update(setupPayload)
            .eq("id", existingSetup.id);
        } else {
          await supabaseAdmin.from("strategy_setups").insert(setupPayload);
        }
        if (placeError) {
          await log(isRecoverableCapacityError(placeError) ? "warn" : "error", "arm: exchange order place failed", { side, entry, qty: finalQty, requestedQty, mode: cfg.mode, error: placeError });
          actions.push(`arm_blocked ${side} qty=${finalQty.toFixed(4)} err=${placeError}`);
        } else {
          actions.push(
            `${existingSetup ? "re-armed" : "armed"} ${side} mode=${cfg.mode} entry=${entry.toFixed(2)} sl=${sl.toFixed(2)} tp=${tp.toFixed(2)} qty=${finalQty.toFixed(4)}` +
              (exchangeOrderId ? ` pending=${exchangeOrderId}` : " (paper/no-id)"),
          );
        }
      }
    } else if (
      existingSetup.status === "armed" &&
      !existingSetup.exchange_order_id &&
      !globalSettings?.paper_mode
    ) {
      const lastAttemptAt = existingSetup.updated_at ? new Date(existingSetup.updated_at).getTime() : 0;
      if (Number.isFinite(lastAttemptAt) && Date.now() - lastAttemptAt < 120_000) {
        actions.push(`restore_pending_wait ${existingSetup.side}`);
      } else {
      const side = existingSetup.side as "long" | "short";
      const attempt = await placeOrderWithMarginRetry(client, {
        symbol: existingSetup.symbol,
        side: side === "long" ? "buy" : "sell",
        qty: Number(existingSetup.qty),
        type: "limit",
        price: Number(existingSetup.entry_price),
        stopLossPrice: Number(existingSetup.sl_price),
        takeProfitPrice: Number(existingSetup.tp_price),
      }, { maxAttempts: 3 });
      if (attempt.res?.exchangeOrderId) {
        await supabaseAdmin
          .from("strategy_setups")
          .update({
            exchange_order_id: attempt.res.exchangeOrderId,
            qty: attempt.finalQty,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingSetup.id);
        await log("info", "arm: restored missing live pending order", {
          setup_id: existingSetup.id,
          exchange_order_id: attempt.res.exchangeOrderId,
          qty: attempt.finalQty,
          attempts: attempt.attempts,
        });
        actions.push(`restored_pending ${side} qty=${attempt.finalQty.toFixed(4)} pending=${attempt.res.exchangeOrderId}`);
      } else {
        await log("warn", "arm: restore missing pending order failed", {
          setup_id: existingSetup.id,
          qty: existingSetup.qty,
          error: attempt.error,
        });
        actions.push(`restore_pending_failed ${side} err=${attempt.error}`);
      }
      }

    } else if (

      existingSetup.status === "armed" &&
      existingSetup.exchange_order_id &&
      !globalSettings?.paper_mode
    ) {
      // Re-price a still-pending order when strategy settings changed (e.g.
      // entry_depth_pct / sl_depth_pct / rr / sl_risk_usd). Shark has no
      // amend endpoint, so cancel + place a new order.
      const side = existingSetup.side as "long" | "short";
      const cfg = entryConfigFromSettings(s as unknown as Record<string, unknown>);
      const breakClose = Number(session.break_close_price ?? (side === "long" ? zone_high : zone_low));
      const { entry, sl, market } = computeEntry(side, zone_high, zone_low, breakClose, cfg);
      const risk = Math.abs(entry - sl);
      const tp = side === "long" ? entry + risk * s.rr : entry - risk * s.rr;
      const qty = risk > 0 ? s.sl_risk_usd / risk : 0;
      const exchangeEntry = roundExchangePrice(entry);
      const exchangeSl = roundExchangePrice(sl);
      const exchangeTp = roundExchangePrice(tp);
      const exchangeQty = roundExchangeQty(qty);

      const tol = 1e-6;
      const changed =
        qty > 0 &&
        (Math.abs(exchangeEntry - roundExchangePrice(Number(existingSetup.entry_price))) > tol ||
          Math.abs(exchangeSl - roundExchangePrice(Number(existingSetup.sl_price))) > tol ||
          Math.abs(exchangeTp - roundExchangePrice(Number(existingSetup.tp_price))) > tol ||
          Math.abs(exchangeQty - roundExchangeQty(Number(existingSetup.qty))) > tol);

      if (changed) {
        await log("warn", "reprice: settings changed but live order kept", {
          setup_id: existingSetup.id,
          exchange_order_id: existingSetup.exchange_order_id,
          current: {
            entry: existingSetup.entry_price,
            sl: existingSetup.sl_price,
            tp: existingSetup.tp_price,
            qty: existingSetup.qty,
          },
          planned: { entry, sl, tp, qty },
        });
        actions.push(`reprice_hold ${side} live order kept; manual reprice required`);

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

  // Detect fills on armed setups.
  //  - Live (has exchange_order_id): poll Shark open-orders once; if the id is no
  //    longer open, look up its trade in trade-history and mark the setup triggered.
  //  - Paper (no exchange_order_id): keep local barLow/barHigh trigger detection.
  const { data: armedRows } = await supabaseAdmin
    .from("strategy_setups")
    .select("*")
    .eq("ist_date", todayIst)
    .eq("status", "armed");
  const armed = (armedRows ?? []) as SetupRow[];
  const liveArmed = armed.filter((a) => a.exchange_order_id);
  const paperArmed = globalSettings?.paper_mode ? armed.filter((a) => !a.exchange_order_id) : [];

  if (liveArmed.length > 0 && !globalSettings?.paper_mode) {
    let openOrders: Awaited<ReturnType<typeof client.getOpenOrders>> | null = null;
    let openIds: Set<string> | null = null;
    try {
      openOrders = await client.getOpenOrders(s.symbol);
      openIds = new Set(openOrders.map((o) => o.clientOrderId).filter((id) => id.length > 0));
    } catch (e) {
      await log("warn", "open-orders fetch failed", { error: (e as Error).message });
    }
    if (openIds) {
      for (const setup of liveArmed) {
        const oid = setup.exchange_order_id!;
        if (openIds.has(oid)) continue; // still pending on exchange

        const matchingOpen = openOrders?.find((order) => samePendingSetupOrder(order, setup));
        if (matchingOpen?.clientOrderId) {
          await supabaseAdmin
            .from("strategy_setups")
            .update({ exchange_order_id: matchingOpen.clientOrderId, updated_at: new Date().toISOString() })
            .eq("id", setup.id);
          await log("warn", "armed order id changed on exchange; relinked pending order", {
            setup_id: setup.id,
            old_exchange_order_id: oid,
            new_exchange_order_id: matchingOpen.clientOrderId,
          });
          actions.push(`relinked_pending ${setup.side} pending=${matchingOpen.clientOrderId}`);
          continue;
        }

        // No longer open → look up fill
        let fill: { price: number; qty: number } | null = null;
        try {
          fill = await client.getFillForClientOrderId(oid);
        } catch (e) {
          await log("warn", "trade-history lookup failed", { setup_id: setup.id, error: (e as Error).message });
        }
        if (!fill?.price) {
          await log("warn", "armed order disappeared without fill; replacing immediately", {
            setup_id: setup.id,
            missing_exchange_order_id: oid,
            qty: setup.qty,
            entry: setup.entry_price,
          });
          const attempt = await placeOrderWithMarginRetry(client, {
            symbol: setup.symbol,
            side: setup.side === "long" ? "buy" : "sell",
            qty: Number(setup.qty),
            type: "limit",
            price: Number(setup.entry_price),
            stopLossPrice: Number(setup.sl_price),
            takeProfitPrice: Number(setup.tp_price),
          }, { maxAttempts: 3 });
          if (attempt.res?.exchangeOrderId) {
            await supabaseAdmin
              .from("strategy_setups")
              .update({
                exchange_order_id: attempt.res.exchangeOrderId,
                qty: attempt.finalQty,
                updated_at: new Date().toISOString(),
              })
              .eq("id", setup.id);
            await log("info", "armed order replaced after disappearing without fill", {
              setup_id: setup.id,
              old_exchange_order_id: oid,
              new_exchange_order_id: attempt.res.exchangeOrderId,
              qty: attempt.finalQty,
              attempts: attempt.attempts,
            });
            actions.push(`replace_missing_pending ${setup.side} qty=${attempt.finalQty.toFixed(4)} pending=${attempt.res.exchangeOrderId}`);
          } else {
            await supabaseAdmin
              .from("strategy_setups")
              .update({ exchange_order_id: null, updated_at: new Date().toISOString() })
              .eq("id", setup.id);
            await log("error", "armed order disappeared and replacement failed", {
              setup_id: setup.id,
              old_exchange_order_id: oid,
              qty: setup.qty,
              error: attempt.error,
            });
            actions.push(`replace_missing_pending_failed ${setup.side} err=${attempt.error}`);
          }
          continue;
        }
        const fillPrice = fill.price;
        // Record an orders row for accounting + update position
        const webhookEventId = await ensureStrategyEvent(setup, "entry");
        const { data: orderRow } = await supabaseAdmin
          .from("orders")
          .insert({
            webhook_event_id: webhookEventId,
            symbol: setup.symbol,
            side: setup.side === "long" ? "buy" : "sell",
            order_type: "limit",
            qty: setup.qty,
            price: setup.entry_price,
            filled_price: fillPrice,
            exchange_order_id: oid,
            paper: false,
            status: "filled",
            filled_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        await supabaseAdmin
          .from("strategy_setups")
          .update({
            status: "triggered",
            order_id: orderRow?.id ?? null,
            filled_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", setup.id);
        actions.push(`fill ${setup.side} @${fillPrice.toFixed(2)}`);
      }
    }
  }

  for (const setup of paperArmed) {
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
    const isLive = !!setup.exchange_order_id && !globalSettings?.paper_mode;

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

    // Discover the exchange-side child SL order id if we don't have it yet (live only).
    // Once known, trailing can PATCH stopPrice so the exchange enforces the new SL even
    // if our tick loop stops running.
    let slChildId = setup.sl_child_order_id ?? null;
    if (isLive && !slChildId) {
      try {
        const openRows = await client.getOpenOrders(setup.symbol);
        const exitSide = setup.side === "long" ? "SELL" : "BUY";
        const candidates = openRows.filter((o) => {
          const type = (o.type || "").toUpperCase();
          const side = (o.side || "").toUpperCase();
          const sub = (o.subType || "").toUpperCase();
          const link = (o.linkType || "").toUpperCase();
          const looksStop = type.startsWith("STOP") || sub.includes("STOP_LOSS") || link.includes("SL");
          const looksTp = sub.includes("TAKE_PROFIT") || link.includes("TP");
          return looksStop && !looksTp && side === exitSide;
        });
        // Prefer the one whose stopPrice/price is closest to our current sl_price.
        const target = Number(setup.sl_price);
        candidates.sort((a, b) => {
          const ap = Math.abs((a.stopPrice ?? a.price ?? 0) - target);
          const bp = Math.abs((b.stopPrice ?? b.price ?? 0) - target);
          return ap - bp;
        });
        const match = candidates[0];
        if (match) {
          slChildId = match.clientOrderId;
          await supabaseAdmin
            .from("strategy_setups")
            .update({ sl_child_order_id: slChildId, updated_at: new Date().toISOString() })
            .eq("id", setup.id);
          await log("info", "trail: discovered exchange SL child order", {
            setup_id: setup.id, sl_child_order_id: slChildId, sl_price: setup.sl_price,
          });
        }
      } catch (e) {
        await log("warn", "trail: sl child discovery failed", {
          setup_id: setup.id, error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // Discover the exchange-side child TP order id (live only) so the UI can edit TP via API.
    let tpChildId = setup.tp_child_order_id ?? null;
    if (isLive && !tpChildId) {
      try {
        const openRows = await client.getOpenOrders(setup.symbol);
        const exitSide = setup.side === "long" ? "SELL" : "BUY";
        const candidates = openRows.filter((o) => {
          const type = (o.type || "").toUpperCase();
          const side = (o.side || "").toUpperCase();
          const sub = (o.subType || "").toUpperCase();
          const link = (o.linkType || "").toUpperCase();
          const looksTp = sub.includes("TAKE_PROFIT") || link.includes("TP") || type.includes("TAKE_PROFIT");
          const looksSl = sub.includes("STOP_LOSS") || link.includes("SL");
          return looksTp && !looksSl && side === exitSide;
        });
        const target = Number(setup.tp_price);
        candidates.sort((a, b) => {
          const ap = Math.abs((a.price ?? a.stopPrice ?? 0) - target);
          const bp = Math.abs((b.price ?? b.stopPrice ?? 0) - target);
          return ap - bp;
        });
        const match = candidates[0];
        if (match) {
          tpChildId = match.clientOrderId;
          await supabaseAdmin
            .from("strategy_setups")
            .update({ tp_child_order_id: tpChildId, updated_at: new Date().toISOString() })
            .eq("id", setup.id);
          await log("info", "trail: discovered exchange TP child order", {
            setup_id: setup.id, tp_child_order_id: tpChildId, tp_price: setup.tp_price,
          });
        }
      } catch (e) {
        await log("warn", "trail: tp child discovery failed", {
          setup_id: setup.id, error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // Persist trailing progress if it advanced or peak changed.
    const slChanged = dynSl !== Number(setup.sl_price);
    if (peakR > Number(setup.peak_r ?? 0) || slChanged) {
      await supabaseAdmin
        .from("strategy_setups")
        .update({
          peak_r: peakR,
          sl_price: dynSl,
          updated_at: new Date().toISOString(),
        })
        .eq("id", setup.id);
      if (slChanged) {
        actions.push(`trail ${setup.side} peak=${peakR.toFixed(2)}R sl→${dynSl.toFixed(2)}`);

        // Push the trailed SL to the exchange so it is enforced there.
        if (isLive && slChildId) {
          try {
            const editRes = await client.editOrder({ clientOrderId: slChildId, stopPrice: dynSl });
            if (editRes.ok) {
              await log("info", "trail: exchange SL updated", {
                setup_id: setup.id, sl_child_order_id: slChildId, new_stop: dynSl,
              });
              actions.push(`trail_exchange_sl ok ${slChildId}→${dynSl.toFixed(2)}`);
            } else {
              await log("warn", "trail: exchange SL edit rejected", {
                setup_id: setup.id, sl_child_order_id: slChildId, new_stop: dynSl,
                status: editRes.status, body: editRes.body.slice(0, 300),
              });
              actions.push(`trail_exchange_sl fail [${editRes.status}]`);
              // If the exchange says the order is gone (e.g. cancelled/replaced), clear id so we re-discover next tick.
              if (editRes.status === 404 || /not.?found|does not exist/i.test(editRes.body)) {
                await supabaseAdmin
                  .from("strategy_setups")
                  .update({ sl_child_order_id: null, updated_at: new Date().toISOString() })
                  .eq("id", setup.id);
              }
            }
          } catch (e) {
            await log("warn", "trail: exchange SL edit threw", {
              setup_id: setup.id, sl_child_order_id: slChildId, new_stop: dynSl,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
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

/**
 * Force-reprice every armed setup for today that still has a pending exchange
 * order, using current strategy settings. Bypasses the "changed" tolerance
 * check in the tick — cancels the pending order and places a fresh one with
 * the latest entry/SL/TP/qty. Returns per-setup action strings.
 */
export async function repriceArmedSetupsNow(): Promise<{
  ok: boolean;
  reason?: string;
  actions: string[];
}> {
  const actions: string[] = [];

  const { data: settings } = await supabaseAdmin
    .from("strategy_settings")
    .select("*")
    .eq("id", true)
    .single();
  const s = settings as StrategySettingsRow | null;
  if (!s) return { ok: false, reason: "settings_missing", actions };

  const { data: globalSettings } = await supabaseAdmin
    .from("settings")
    .select("kill_switch, paper_mode")
    .eq("id", true)
    .single();
  if (globalSettings?.paper_mode) return { ok: true, reason: "paper_mode", actions };

  const todayIst = sessionDate(Date.now(), s.session_start_ist);

  const { data: sessionRow } = await supabaseAdmin
    .from("strategy_sessions")
    .select("*")
    .eq("ist_date", todayIst)
    .maybeSingle();
  const session = sessionRow as SessionRow | null;
  if (!session) return { ok: true, reason: "no_session_today", actions };

  const { data: armedRows } = await supabaseAdmin
    .from("strategy_setups")
    .select("*")
    .eq("ist_date", todayIst)
    .eq("status", "armed");
  const armed = ((armedRows ?? []) as SetupRow[]).filter((a) => a.exchange_order_id);
  if (armed.length === 0) return { ok: true, reason: "no_pending_armed", actions };

  const cfg = entryConfigFromSettings(s as unknown as Record<string, unknown>);
  const client = createSharkClient();

  for (const setup of armed) {
    const side = setup.side;
    const oldOid = setup.exchange_order_id!;
    const breakClose = Number(
      session.break_close_price ?? (side === "long" ? session.zone_high : session.zone_low),
    );
    const { entry, sl, market } = computeEntry(
      side,
      session.zone_high,
      session.zone_low,
      breakClose,
      cfg,
    );
    const risk = Math.abs(entry - sl);
    const tp = side === "long" ? entry + risk * s.rr : entry - risk * s.rr;
    const requestedQty = risk > 0 ? s.sl_risk_usd / risk : 0;
    if (requestedQty <= 0) {
      actions.push(`reprice_now_skip ${side} qty=0`);
      continue;
    }

    // Skip when nothing meaningful changed (avoids churning the exchange).
    const priceEps = Math.max(0.01, Math.abs(entry) * 0.0001);
    const qtyEps = Math.max(1e-6, requestedQty * 0.001);
    const unchanged =
      Math.abs(Number(setup.entry_price) - entry) < priceEps &&
      Math.abs(Number(setup.sl_price) - sl) < priceEps &&
      Math.abs(Number(setup.tp_price) - tp) < priceEps &&
      Math.abs(Number(setup.qty) - requestedQty) < qtyEps;
    if (unchanged) {
      actions.push(`reprice_now_noop ${side}`);
      continue;
    }

    // 1) Cancel the still-pending exchange order.
    try {
      await client.cancelOrder(oldOid, s.symbol);
    } catch (e) {
      // If cancel fails the order may have already filled — bail on this setup.
      await log("warn", "reprice_now: cancel failed, skipping replace", {
        setup_id: setup.id,
        exchange_order_id: oldOid,
        error: (e as Error).message,
      });
      actions.push(`reprice_now_cancel_failed ${side}`);
      continue;
    }

    // Detach the stale id right away so a concurrent tick doesn't reuse it.
    await supabaseAdmin
      .from("strategy_setups")
      .update({ exchange_order_id: null, updated_at: new Date().toISOString() })
      .eq("id", setup.id);

    // 2) Place a new order with the current entry / SL / TP / qty.
    const attempt = await placeOrderWithMarginRetry(client, {
      symbol: s.symbol,
      side: side === "long" ? "buy" : "sell",
      qty: requestedQty,
      type: market ? "market" : "limit",
      price: entry,
      stopLossPrice: sl,
      takeProfitPrice: tp,
    });

    if (!attempt.res) {
      await supabaseAdmin
        .from("strategy_setups")
        .update({
          status: "cancelled",
          updated_at: new Date().toISOString(),
        })
        .eq("id", setup.id);
      await log("error", "reprice_now: replace placeOrder failed", {
        setup_id: setup.id,
        error: attempt.error,
      });
      actions.push(`reprice_now_replace_failed ${side}`);
      continue;
    }

    await supabaseAdmin
      .from("strategy_setups")
      .update({
        entry_price: entry,
        sl_price: sl,
        initial_sl_price: sl,
        tp_price: tp,
        qty: attempt.finalQty,
        status: "armed",
        exchange_order_id: attempt.res.exchangeOrderId || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", setup.id);

    await log("info", "reprice_now: replaced live order", {
      setup_id: setup.id,
      old_exchange_order_id: oldOid,
      new_exchange_order_id: attempt.res.exchangeOrderId,
      entry, sl, tp, qty: attempt.finalQty,
      mode: cfg.mode, market,
    });
    actions.push(
      `reprice_now ${side} entry=${entry.toFixed(2)} sl=${sl.toFixed(2)} tp=${tp.toFixed(2)} qty=${attempt.finalQty}`,
    );
  }

  return { ok: true, actions };
}

