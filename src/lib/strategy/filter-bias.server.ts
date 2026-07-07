// Server-only helpers that compute the daily bias / ATR map used by backtest filters.
import type { Kline } from "@/lib/exchange/shark-client.server";

const IST_OFFSET_MIN = 330;

function istDate(msUtc: number): string {
  return new Date(msUtc + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}
function addDaysIso(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map((n) => parseInt(n, 10));
  const t = Date.UTC(y, m - 1, d) + delta * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
function isoWeekMonday(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map((n) => parseInt(n, 10));
  const t = new Date(Date.UTC(y, m - 1, d));
  const dow = t.getUTCDay(); // 0=Sun..6=Sat
  const diff = (dow + 6) % 7; // days back to Monday
  return new Date(t.getTime() - diff * 86_400_000).toISOString().slice(0, 10);
}

export interface DailyBiasEntry {
  prev_close: number | null;
  ema: number | null;
  week_open: number | null;
  atr: number | null;
}

/**
 * Compute an IST-date-keyed bias map. Each entry describes the state that was
 * KNOWN AT THE START of that IST day (yesterday's close/ema/atr + this week's
 * Monday open), so callers never risk lookahead.
 */
export function computeDailyBias(
  daily: Kline[],
  opts: { emaLen: number; atrLen: number },
): Map<string, DailyBiasEntry> {
  const sorted = [...daily].sort((a, b) => a.openTime - b.openTime);
  const map = new Map<string, DailyBiasEntry>();

  const emaLen = Math.max(1, Math.floor(opts.emaLen));
  const k = 2 / (emaLen + 1);
  let ema: number | null = null;
  const closeWarmup: number[] = [];

  const atrLen = Math.max(1, Math.floor(opts.atrLen));
  const trWarmup: number[] = [];
  let atr: number | null = null;

  const weekOpenByMonday = new Map<string, number>();

  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    const date = istDate(c.openTime);

    // True range
    const prev = i > 0 ? sorted[i - 1] : null;
    const tr = prev
      ? Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close))
      : c.high - c.low;
    if (atr === null) {
      trWarmup.push(tr);
      if (trWarmup.length >= atrLen) {
        atr = trWarmup.reduce((s, x) => s + x, 0) / atrLen;
      }
    } else {
      atr = (atr * (atrLen - 1) + tr) / atrLen;
    }

    // EMA of close
    if (ema === null) {
      closeWarmup.push(c.close);
      if (closeWarmup.length >= emaLen) {
        ema = closeWarmup.reduce((s, x) => s + x, 0) / emaLen;
      }
    } else {
      ema = c.close * k + ema * (1 - k);
    }

    // Weekly open cache — first candle whose IST date maps to this Monday
    const monday = isoWeekMonday(date);
    if (!weekOpenByMonday.has(monday)) weekOpenByMonday.set(monday, c.open);

    // Attach bias to the NEXT IST date so it reflects known-yesterday values.
    const nextDate = addDaysIso(date, 1);
    map.set(nextDate, {
      prev_close: c.close,
      ema,
      week_open: weekOpenByMonday.get(isoWeekMonday(nextDate)) ?? null,
      atr,
    });
  }

  return map;
}
