import { createSharkClient, type Kline } from "@/lib/exchange/shark-client.server";

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

export interface DayResult {
  ist_date: string;
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
    | "open";
  pnl_usd: number;
  final_sl: number | null;
  peak_r: number;
  exit_r: number | null;
}

export interface RangeBacktestResult {
  symbol: string;
  session_start_ist: string;
  days_requested: number;
  from_ms: number;
  to_ms: number;
  bars_scanned: number;
  trail: { enabled: boolean; activate_r: number; step_r: number };
  days: DayResult[];
  summary: {
    total_days: number;
    days_with_session: number;
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
  };
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
}): Promise<RangeBacktestResult> {
  const trailEnabled = !!opts.trailEnabled;
  const trailActivateR = Math.max(0.1, opts.trailActivateR ?? 2);
  const trailStepR = Math.max(0.1, opts.trailStepR ?? 1);
  const client = createSharkClient();
  const now = Date.now();
  const fromMs = now - opts.days * 86_400_000;

  const klines: Kline[] = await client.getKlinesRange(opts.symbol, "1h", fromMs, now);

  // Bucket by IST date for fast session lookup.
  const byOpen = new Map<number, Kline>();
  for (const k of klines) byOpen.set(k.openTime, k);

  // Collect the unique IST dates present in the range.
  const dates = new Set<string>();
  for (const k of klines) dates.add(istDate(k.openTime));
  const sortedDates = [...dates].sort();

  const days: DayResult[] = [];

  for (const dateStr of sortedDates) {
    const sessionOpen = sessionOpenUtcMs(dateStr, opts.sessionStartIst);
    const sessionCandle = byOpen.get(sessionOpen);
    const dr: DayResult = {
      ist_date: dateStr,
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
      outcome: "no_session",
      pnl_usd: 0,
    };

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

    // Look at bars strictly after the session candle, within THIS IST date only.
    const laterSameDay = klines.filter(
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
      const hitTp = breakSide === "long" ? k.high >= tp : k.low <= tp;
      const hitSl = breakSide === "long" ? k.low <= sl : k.high >= sl;
      if (hitTp && hitSl) {
        dr.outcome = "sl"; // conservative same-bar assumption
        dr.pnl_usd = -opts.slRiskUsd;
        resolved = true;
        break;
      }
      if (hitTp) {
        dr.outcome = "tp";
        dr.pnl_usd = opts.slRiskUsd * opts.rr;
        resolved = true;
        break;
      }
      if (hitSl) {
        dr.outcome = "sl";
        dr.pnl_usd = -opts.slRiskUsd;
        resolved = true;
        break;
      }
    }
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
    .map((d) => (d.outcome === "tp" ? opts.rr : -1));
  const avgR = rMultiples.length > 0 ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length : 0;
  const bestPnl = days.reduce((m, d) => Math.max(m, d.pnl_usd), 0);
  const worstPnl = days.reduce((m, d) => Math.min(m, d.pnl_usd), 0);

  return {
    symbol: opts.symbol,
    session_start_ist: opts.sessionStartIst,
    days_requested: opts.days,
    from_ms: fromMs,
    to_ms: now,
    bars_scanned: klines.length,
    days,
    summary: {
      total_days: days.length,
      days_with_session: daysWithSession,
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
    },
  };
}
