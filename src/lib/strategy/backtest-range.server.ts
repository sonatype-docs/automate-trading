import { createSharkClient, type Kline } from "@/lib/exchange/shark-client.server";
import type { FilterConfig } from "@/lib/strategy/filters";
import { needsDailyBias } from "@/lib/strategy/filters";
import { computeDailyBias, type DailyBiasEntry } from "@/lib/strategy/filter-bias.server";
import {
  computeEntry,
  DEFAULT_ENTRY_CONFIG,
  type EntryConfig,
} from "@/lib/strategy/entry-modes.server";


const IST_OFFSET_MIN = 330;

function istDate(msUtc: number): string {
  return new Date(msUtc + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}
function sessionOpenUtcMs(istDateStr: string, sessionStartIst: string): number {
  const [hh, mm] = sessionStartIst.split(":").map((n) => parseInt(n, 10));
  const totalMin = hh * 60 + (mm || 0) - IST_OFFSET_MIN;
  const [y, m, d] = istDateStr.split("-").map((n) => parseInt(n, 10));
  const openMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0) + totalMin * 60_000;
  return Math.floor(openMs / 3_600_000) * 3_600_000;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
function istWeekday(dateStr: string): Weekday {
  const [y, m, d] = dateStr.split("-").map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() as Weekday;
}

export interface DayResult {
  ist_date: string;
  weekday: Weekday;
  weekday_label: string;
  skipped: boolean;
  session_open: number | null;
  zone_high: number | null;
  zone_low: number | null;
  fib_25: number | null;
  fib_75: number | null;
  break_side: "long" | "short" | null;
  break_at: number | null;
  break_close: number | null;
  entry: number | null;
  sl: number | null;
  tp: number | null;
  qty: number | null;
  trigger_at: number | null;
  outcome:
    | "no_session"
    | "no_break"
    | "armed_no_trigger"
    | "tp"
    | "sl"
    | "open"
    | "skipped"
    | "filtered";
  filter_reason: string | null;
  pnl_usd: number;
  final_sl: number | null;
  peak_r: number;
  exit_r: number | null;
}

export interface WeekdayStat {
  weekday: Weekday;
  label: string;
  trades: number;
  wins: number;
  losses: number;
  win_rate_pct: number;
  total_pnl_usd: number;
  avg_pnl_usd: number;
}


export interface RangeBacktestResult {
  symbol: string;
  session_start_ist: string;
  sl_risk_usd: number;
  rr: number;
  days_requested: number;
  from_ms: number;
  to_ms: number;
  bars_scanned: number;
  trail: { enabled: boolean; activate_r: number; step_r: number };
  skip_weekdays: Weekday[];
  days: DayResult[];
  weekdays: WeekdayStat[];
  equity: { ist_date: string; cum_pnl_usd: number }[];
  summary: {
    total_days: number;
    days_with_session: number;
    skipped_days: number;
    filtered_days: number;
    breaks: number;
    triggered: number;
    tp: number;
    sl: number;
    open: number;
    armed_no_trigger: number;
    win_rate_pct: number;
    total_pnl_usd: number;
    avg_r: number;
    best_pnl_usd: number;
    worst_pnl_usd: number;
    best_weekday: { label: string; total_pnl_usd: number } | null;
    worst_weekday: { label: string; total_pnl_usd: number } | null;
    profit_factor: number;   // gross wins / gross losses
    expectancy_usd: number;  // avg $ per decided trade
    avg_win_usd: number;
    avg_loss_usd: number;
    max_drawdown_usd: number;
    max_consec_wins: number;
    max_consec_losses: number;
  };
  filters?: FilterConfig;
}


export async function runBacktestRange(opts: {
  symbol: string;
  sessionStartIst: string;
  slRiskUsd: number;
  rr: number;
  days: number;
  trailEnabled?: boolean;
  trailActivateR?: number;
  trailStepR?: number;
  skipWeekdays?: Weekday[]; // e.g. [0, 6] to skip Sun & Sat
  filters?: FilterConfig;
}): Promise<RangeBacktestResult> {
  const client = createSharkClient();
  const now = Date.now();
  const fromMs = now - opts.days * 86_400_000;
  const klines: Kline[] = await client.getKlinesRange(opts.symbol, "1h", fromMs, now);

  let dailyBias: Map<string, DailyBiasEntry> | undefined;
  if (needsDailyBias(opts.filters)) {
    const emaLen = opts.filters?.htf?.daily_ema_len ?? 20;
    const atrLen = opts.filters?.quality?.atr_len ?? 14;
    const warmupDays = Math.max(emaLen, atrLen) + 10;
    const dailyFromMs = fromMs - warmupDays * 86_400_000;
    const daily = await client.getKlinesRange(opts.symbol, "1d", dailyFromMs, now);
    dailyBias = computeDailyBias(daily, { emaLen, atrLen });
  }

  return simulateFromKlines(klines, { ...opts, fromMs, nowMs: now, dailyBias });
}

export function simulateFromKlines(
  klines: Kline[],
  opts: {
    symbol: string;
    sessionStartIst: string;
    slRiskUsd: number;
    rr: number;
    days: number;
    fromMs: number;
    nowMs: number;
    trailEnabled?: boolean;
    trailActivateR?: number;
    trailStepR?: number;
    skipWeekdays?: Weekday[];
    filters?: FilterConfig;
    dailyBias?: Map<string, DailyBiasEntry>;
  },
): RangeBacktestResult {
  const trailEnabled = !!opts.trailEnabled;
  const trailActivateR = Math.max(0.1, opts.trailActivateR ?? 2);
  const trailStepR = Math.max(0.1, opts.trailStepR ?? 1);
  const skipSet = new Set<Weekday>(opts.skipWeekdays ?? []);
  const now = opts.nowMs;
  const fromMs = opts.fromMs;
  const filters = opts.filters?.enabled ? opts.filters : undefined;
  const htf = filters?.htf;
  const quality = filters?.quality;

  // Restrict to the requested window (allows callers to pass a superset).
  const filtered = klines.filter((k) => k.openTime >= fromMs && k.closeTime <= now);

  // Bucket by IST date for fast session lookup.
  const byOpen = new Map<number, Kline>();
  for (const k of filtered) byOpen.set(k.openTime, k);

  // Collect the unique IST dates present in the range.
  const dates = new Set<string>();
  for (const k of filtered) dates.add(istDate(k.openTime));
  const sortedDates = [...dates].sort();



  const days: DayResult[] = [];

  for (const dateStr of sortedDates) {
    const sessionOpen = sessionOpenUtcMs(dateStr, opts.sessionStartIst);
    const sessionCandle = byOpen.get(sessionOpen);
    const weekday = istWeekday(dateStr);
    const skipped = skipSet.has(weekday);
    const dr: DayResult = {
      ist_date: dateStr,
      weekday,
      weekday_label: WEEKDAY_LABELS[weekday],
      skipped,
      session_open: sessionCandle?.openTime ?? null,
      zone_high: null,
      zone_low: null,
      fib_25: null,
      fib_75: null,
      break_side: null,
      break_at: null,
      break_close: null,
      entry: null,
      sl: null,
      tp: null,
      qty: null,
      trigger_at: null,
      outcome: skipped ? "skipped" : "no_session",
      filter_reason: null,
      pnl_usd: 0,
      final_sl: null,
      peak_r: 0,
      exit_r: null,
    };

    if (skipped) {
      days.push(dr);
      continue;
    }

    if (!sessionCandle || sessionCandle.closeTime > now) {
      days.push(dr);
      continue;
    }

    const zone_high = sessionCandle.high;
    const zone_low = sessionCandle.low;
    const range = zone_high - zone_low;
    const fib_25 = zone_high - range * 0.25; // near high
    const fib_75 = zone_high - range * 0.75; // near low
    dr.zone_high = zone_high;
    dr.zone_low = zone_low;
    dr.fib_25 = fib_25;
    dr.fib_75 = fib_75;

    // ---- Setup quality: zone size + ATR regime (evaluated before break search) ----
    if (quality?.zone_size_enabled) {
      const unit = quality.zone_size_unit ?? "usd";
      const val = unit === "pct" ? (range / sessionCandle.open) * 100 : range;
      const min = quality.zone_size_min ?? 0;
      const max = quality.zone_size_max ?? 0;
      if (min > 0 && val < min) {
        dr.outcome = "filtered";
        dr.filter_reason = `zone < ${min}${unit === "pct" ? "%" : "$"}`;
        days.push(dr);
        continue;
      }
      if (max > 0 && val > max) {
        dr.outcome = "filtered";
        dr.filter_reason = `zone > ${max}${unit === "pct" ? "%" : "$"}`;
        days.push(dr);
        continue;
      }
    }

    const biasEntry = opts.dailyBias?.get(dateStr);
    if (quality?.atr_enabled) {
      const atr = biasEntry?.atr ?? null;
      const min = quality.atr_min ?? 0;
      const max = quality.atr_max ?? 0;
      if (atr === null) {
        dr.outcome = "filtered";
        dr.filter_reason = "atr unavailable";
        days.push(dr);
        continue;
      }
      if (min > 0 && atr < min) {
        dr.outcome = "filtered";
        dr.filter_reason = `atr < ${min}`;
        days.push(dr);
        continue;
      }
      if (max > 0 && atr > max) {
        dr.outcome = "filtered";
        dr.filter_reason = `atr > ${max}`;
        days.push(dr);
        continue;
      }
    }

    // Precompute HTF bias-allowed side for this day so we can reject on break.
    let allowedSide: "long" | "short" | "both" | "none" = "both";
    if (htf) {
      const price = sessionCandle.open;
      const votes: ("long" | "short")[] = [];
      const vote = (ref: number | null | undefined) => {
        if (ref === null || ref === undefined) return;
        if (price > ref) votes.push("long");
        else if (price < ref) votes.push("short");
      };
      if (htf.daily_ema_enabled) vote(biasEntry?.ema ?? null);
      if (htf.prev_day_close_enabled) vote(biasEntry?.prev_close ?? null);
      if (htf.weekly_open_enabled) vote(biasEntry?.week_open ?? null);
      if (votes.length > 0) {
        const unique = new Set(votes);
        allowedSide = unique.size === 1 ? votes[0] : "none";
      }
    }


    // Look at bars strictly after the session candle, within THIS IST date only.
    const laterSameDay = filtered.filter(
      (k) =>
        k.openTime > sessionCandle.openTime &&
        k.closeTime <= now &&
        istDate(k.openTime) === dateStr,
    );

    // First 1H close outside the zone wins.
    let breakBar: Kline | null = null;
    let breakSide: "long" | "short" | null = null;
    for (const k of laterSameDay) {
      if (k.close > zone_high) { breakBar = k; breakSide = "long"; break; }
      if (k.close < zone_low)  { breakBar = k; breakSide = "short"; break; }
    }
    if (!breakBar || !breakSide) {
      dr.outcome = "no_break";
      days.push(dr);
      continue;
    }
    dr.break_side = breakSide;
    dr.break_at = breakBar.closeTime;
    dr.break_close = breakBar.close;

    // ---- Break-time filters (HTF bias side match + break quality) ----
    if (allowedSide === "none" || (allowedSide !== "both" && allowedSide !== breakSide)) {
      dr.outcome = "filtered";
      dr.filter_reason =
        allowedSide === "none" ? "htf bias conflict" : `htf bias = ${allowedSide}`;
      days.push(dr);
      continue;
    }

    if (quality?.break_strength_enabled) {
      const beyond =
        breakSide === "long" ? breakBar.close - zone_high : zone_low - breakBar.close;
      const pct = range > 0 ? (beyond / range) * 100 : 0;
      const need = quality.break_strength_pct ?? 0;
      if (pct < need) {
        dr.outcome = "filtered";
        dr.filter_reason = `break strength ${pct.toFixed(1)}% < ${need}%`;
        days.push(dr);
        continue;
      }
    }

    if (quality?.break_body_enabled) {
      const barRange = breakBar.high - breakBar.low;
      const body = Math.abs(breakBar.close - breakBar.open);
      const pct = barRange > 0 ? (body / barRange) * 100 : 0;
      const need = quality.break_body_pct ?? 0;
      if (pct < need) {
        dr.outcome = "filtered";
        dr.filter_reason = `body ${pct.toFixed(0)}% < ${need}%`;
        days.push(dr);
        continue;
      }
    }

    if (quality?.break_timing_enabled) {
      const need = quality.break_timing_hours ?? 0;
      if (need > 0) {
        const hoursAfter = (breakBar.openTime - sessionCandle.closeTime) / 3_600_000;
        if (hoursAfter > need) {
          dr.outcome = "filtered";
          dr.filter_reason = `break +${hoursAfter.toFixed(1)}h > ${need}h`;
          days.push(dr);
          continue;
        }
      }
    }


    const entry = breakSide === "long" ? fib_25 : fib_75;
    const sl    = breakSide === "long" ? fib_75 : fib_25;
    const risk  = Math.abs(entry - sl);
    const tp    = breakSide === "long" ? entry + risk * opts.rr : entry - risk * opts.rr;
    const qty   = risk > 0 ? opts.slRiskUsd / risk : 0;
    dr.entry = entry;
    dr.sl = sl;
    dr.tp = tp;
    dr.qty = qty;

    const post = laterSameDay.filter((k) => k.openTime > breakBar.openTime);
    let triggered = false;
    let resolved = false;
    let dynSl = sl;
    let peakR = 0;
    for (const k of post) {
      if (!triggered) {
        const hit = breakSide === "long" ? k.low <= entry : k.high >= entry;
        if (hit) {
          triggered = true;
          dr.trigger_at = k.openTime;
        } else {
          continue;
        }
      }
      // Update peak-R using bar extremes in the favorable direction.
      const favorableExtreme = breakSide === "long" ? k.high : k.low;
      const barR = ((favorableExtreme - entry) * (breakSide === "long" ? 1 : -1)) / risk;
      if (barR > peakR) peakR = barR;

      // Advance trailing SL if enabled.
      if (trailEnabled && peakR >= trailActivateR) {
        const steps = Math.floor((peakR - trailActivateR) / trailStepR);
        const slR = steps * trailStepR; // 0, step, 2*step, ...
        const newSl = breakSide === "long" ? entry + slR * risk : entry - slR * risk;
        if (breakSide === "long" ? newSl > dynSl : newSl < dynSl) dynSl = newSl;
      }

      const hitTp = breakSide === "long" ? k.high >= tp : k.low <= tp;
      const hitSl = breakSide === "long" ? k.low <= dynSl : k.high >= dynSl;
      const slR = ((dynSl - entry) * (breakSide === "long" ? 1 : -1)) / risk;
      if (hitTp && hitSl) {
        // Conservative same-bar assumption: SL first.
        dr.outcome = "sl";
        dr.pnl_usd = slR * opts.slRiskUsd;
        dr.exit_r = slR;
        resolved = true;
        break;
      }
      if (hitTp) {
        dr.outcome = "tp";
        dr.pnl_usd = opts.slRiskUsd * opts.rr;
        dr.exit_r = opts.rr;
        resolved = true;
        break;
      }
      if (hitSl) {
        dr.outcome = "sl";
        dr.pnl_usd = slR * opts.slRiskUsd;
        dr.exit_r = slR;
        resolved = true;
        break;
      }
    }
    dr.final_sl = dynSl;
    dr.peak_r = peakR;
    if (!resolved) {
      dr.outcome = triggered ? "open" : "armed_no_trigger";
    }
    days.push(dr);
  }

  const daysWithSession = days.filter((d) => d.zone_high !== null).length;
  const breaks = days.filter((d) => d.break_side !== null).length;
  const triggered = days.filter((d) => d.trigger_at !== null).length;
  const tp = days.filter((d) => d.outcome === "tp").length;
  const sl = days.filter((d) => d.outcome === "sl").length;
  const openCount = days.filter((d) => d.outcome === "open").length;
  const armedNoTrigger = days.filter((d) => d.outcome === "armed_no_trigger").length;
  const decided = tp + sl;
  const winRate = decided > 0 ? (tp / decided) * 100 : 0;
  const totalPnl = days.reduce((s, d) => s + d.pnl_usd, 0);
  const rMultiples = days
    .filter((d) => d.outcome === "tp" || d.outcome === "sl")
    .map((d) => (d.exit_r ?? (d.outcome === "tp" ? opts.rr : -1)));
  const avgR = rMultiples.length > 0 ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length : 0;
  const bestPnl = days.reduce((m, d) => Math.max(m, d.pnl_usd), 0);
  const worstPnl = days.reduce((m, d) => Math.min(m, d.pnl_usd), 0);
  const skippedDays = days.filter((d) => d.skipped).length;
  const filteredDays = days.filter((d) => d.outcome === "filtered").length;

  // Per-weekday stats — count only decided trades (tp/sl).
  const weekdays: WeekdayStat[] = ([0, 1, 2, 3, 4, 5, 6] as Weekday[]).map((wd) => {
    const rows = days.filter((d) => d.weekday === wd && (d.outcome === "tp" || d.outcome === "sl"));
    const wins = rows.filter((d) => d.outcome === "tp").length;
    const losses = rows.filter((d) => d.outcome === "sl").length;
    const total = rows.reduce((s, d) => s + d.pnl_usd, 0);
    const trades = rows.length;
    return {
      weekday: wd,
      label: WEEKDAY_LABELS[wd],
      trades,
      wins,
      losses,
      win_rate_pct: trades > 0 ? (wins / trades) * 100 : 0,
      total_pnl_usd: total,
      avg_pnl_usd: trades > 0 ? total / trades : 0,
    };
  });
  const withTrades = weekdays.filter((w) => w.trades > 0);
  const bestWd = withTrades.length ? withTrades.reduce((a, b) => (b.total_pnl_usd > a.total_pnl_usd ? b : a)) : null;
  const worstWd = withTrades.length ? withTrades.reduce((a, b) => (b.total_pnl_usd < a.total_pnl_usd ? b : a)) : null;

  // Advanced stats over chronological decided trades.
  const decidedRows = days.filter((d) => d.outcome === "tp" || d.outcome === "sl");
  const grossWin = decidedRows.filter((d) => d.pnl_usd > 0).reduce((s, d) => s + d.pnl_usd, 0);
  const grossLoss = Math.abs(decidedRows.filter((d) => d.pnl_usd < 0).reduce((s, d) => s + d.pnl_usd, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
  const expectancy = decidedRows.length > 0 ? (grossWin - grossLoss) / decidedRows.length : 0;
  const winRows = decidedRows.filter((d) => d.pnl_usd > 0);
  const lossRows = decidedRows.filter((d) => d.pnl_usd < 0);
  const avgWin = winRows.length ? grossWin / winRows.length : 0;
  const avgLoss = lossRows.length ? grossLoss / lossRows.length : 0;

  // Streaks + equity curve + drawdown, walk chronologically.
  let curWin = 0, curLoss = 0, maxWin = 0, maxLoss = 0;
  let cum = 0, peak = 0, maxDd = 0;
  const equity: { ist_date: string; cum_pnl_usd: number }[] = [];
  for (const d of days) {
    if (d.outcome === "tp") { curWin += 1; curLoss = 0; if (curWin > maxWin) maxWin = curWin; }
    else if (d.outcome === "sl") { curLoss += 1; curWin = 0; if (curLoss > maxLoss) maxLoss = curLoss; }
    cum += d.pnl_usd;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDd) maxDd = dd;
    equity.push({ ist_date: d.ist_date, cum_pnl_usd: cum });
  }

  return {
    symbol: opts.symbol,
    session_start_ist: opts.sessionStartIst,
    sl_risk_usd: opts.slRiskUsd,
    rr: opts.rr,
    days_requested: opts.days,
    from_ms: fromMs,
    to_ms: now,
    bars_scanned: filtered.length,
    trail: { enabled: trailEnabled, activate_r: trailActivateR, step_r: trailStepR },
    skip_weekdays: opts.skipWeekdays ?? [],
    days,
    weekdays,
    equity,
    summary: {
      total_days: days.length,
      days_with_session: daysWithSession,
      skipped_days: skippedDays,
      filtered_days: filteredDays,
      breaks,
      triggered,
      tp,
      sl,
      open: openCount,
      armed_no_trigger: armedNoTrigger,
      win_rate_pct: winRate,
      total_pnl_usd: totalPnl,
      avg_r: avgR,
      best_pnl_usd: bestPnl,
      worst_pnl_usd: worstPnl,
      best_weekday: bestWd ? { label: bestWd.label, total_pnl_usd: bestWd.total_pnl_usd } : null,
      worst_weekday: worstWd ? { label: worstWd.label, total_pnl_usd: worstWd.total_pnl_usd } : null,
      profit_factor: profitFactor,
      expectancy_usd: expectancy,
      avg_win_usd: avgWin,
      avg_loss_usd: avgLoss,
      max_drawdown_usd: maxDd,
      max_consec_wins: maxWin,
      max_consec_losses: maxLoss,
    },
    filters: opts.filters,
  };
}
