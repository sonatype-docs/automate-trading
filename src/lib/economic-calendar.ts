// Economic Calendar kill-list.
// Curated list of high-impact recurring events that historically cause slippage
// and whipsaws on XAU and BTC. Runners can be gated against these windows.
//
// Times are stored in UTC (release time). We block a symmetric window
// [release - preMin, release + postMin]. All dates use UTC boundaries.

export interface CalendarEvent {
  id: string;
  name: string;
  impact: "high" | "medium";
  affects: ("XAUUSDT" | "BTCUSDT" | "*")[]; // "*" = all symbols
  preMin: number;   // minutes before to block
  postMin: number;  // minutes after to block
  // Recurrence rules — one of:
  monthlyNthWeekday?: { nth: 1 | 2 | 3 | 4 | -1; weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6; utcHour: number; utcMin: number };
  weekly?: { weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6; utcHour: number; utcMin: number };
  // One-off dates (YYYY-MM-DD in UTC + utcHour/utcMin). Populated for FOMC schedule.
  oneOffs?: { date: string; utcHour: number; utcMin: number }[];
}

// ─────────────────────────────────────────────────────────────────
// Recurring high-impact events (curated — most gold/crypto sensitive)
// ─────────────────────────────────────────────────────────────────
export const CALENDAR_EVENTS: CalendarEvent[] = [
  {
    id: "nfp",
    name: "US Non-Farm Payrolls",
    impact: "high",
    affects: ["XAUUSDT", "BTCUSDT"],
    preMin: 15,
    postMin: 60,
    monthlyNthWeekday: { nth: 1, weekday: 5, utcHour: 12, utcMin: 30 }, // 1st Friday 12:30 UTC
  },
  {
    id: "cpi",
    name: "US CPI",
    impact: "high",
    affects: ["XAUUSDT", "BTCUSDT"],
    preMin: 15,
    postMin: 45,
    // Second Wednesday ~12:30 UTC (approximate — BLS varies release day between Tue/Wed/Thu ~10-15th)
    monthlyNthWeekday: { nth: 2, weekday: 3, utcHour: 12, utcMin: 30 },
  },
  {
    id: "ppi",
    name: "US PPI",
    impact: "medium",
    affects: ["XAUUSDT"],
    preMin: 10,
    postMin: 30,
    monthlyNthWeekday: { nth: 2, weekday: 4, utcHour: 12, utcMin: 30 },
  },
  {
    id: "retail_sales",
    name: "US Retail Sales",
    impact: "medium",
    affects: ["XAUUSDT"],
    preMin: 10,
    postMin: 30,
    monthlyNthWeekday: { nth: 3, weekday: 2, utcHour: 12, utcMin: 30 },
  },
  {
    id: "unemployment_claims",
    name: "US Initial Jobless Claims",
    impact: "medium",
    affects: ["XAUUSDT"],
    preMin: 5,
    postMin: 15,
    weekly: { weekday: 4, utcHour: 12, utcMin: 30 }, // Every Thursday 12:30 UTC
  },
];

// FOMC statement + press conference (one-off, ~8 per year). Update annually.
// Times: statement 18:00 UTC, presser 18:30 UTC — we block a wide window.
export const FOMC_EVENT: CalendarEvent = {
  id: "fomc",
  name: "FOMC Statement + Press Conference",
  impact: "high",
  affects: ["XAUUSDT", "BTCUSDT"],
  preMin: 30,
  postMin: 120,
  oneOffs: [
    // 2026 FOMC schedule (published by the Fed — verify annually)
    { date: "2026-01-28", utcHour: 18, utcMin: 0 },
    { date: "2026-03-18", utcHour: 18, utcMin: 0 },
    { date: "2026-04-29", utcHour: 18, utcMin: 0 },
    { date: "2026-06-17", utcHour: 18, utcMin: 0 },
    { date: "2026-07-29", utcHour: 18, utcMin: 0 },
    { date: "2026-09-16", utcHour: 18, utcMin: 0 },
    { date: "2026-11-04", utcHour: 19, utcMin: 0 }, // DST end
    { date: "2026-12-16", utcHour: 19, utcMin: 0 },
  ],
};

const ALL_EVENTS: CalendarEvent[] = [...CALENDAR_EVENTS, FOMC_EVENT];

/** Compute the UTC Date of the Nth given weekday in a given month. nth=-1 → last. */
function nthWeekdayOfMonth(year: number, month0: number, nth: number, weekday: number): Date {
  if (nth === -1) {
    const last = new Date(Date.UTC(year, month0 + 1, 0));
    const diff = (last.getUTCDay() - weekday + 7) % 7;
    return new Date(Date.UTC(year, month0, last.getUTCDate() - diff));
  }
  const first = new Date(Date.UTC(year, month0, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month0, 1 + offset + (nth - 1) * 7));
}

/** Return true if `now` falls inside a block window for a symbol. */
export function isCalendarBlocked(symbol: string, now = new Date()): { blocked: boolean; event?: CalendarEvent; releaseUtc?: Date } {
  const nowMs = now.getTime();
  for (const ev of ALL_EVENTS) {
    if (!ev.affects.includes("*") && !ev.affects.includes(symbol as "XAUUSDT" | "BTCUSDT")) continue;
    const releases = candidateReleases(ev, now);
    for (const r of releases) {
      const start = r.getTime() - ev.preMin * 60_000;
      const end = r.getTime() + ev.postMin * 60_000;
      if (nowMs >= start && nowMs <= end) return { blocked: true, event: ev, releaseUtc: r };
    }
  }
  return { blocked: false };
}

/** Next block window for a symbol (for UI countdown). Returns null if none in next 14 days. */
export function nextCalendarBlock(symbol: string, now = new Date()): { event: CalendarEvent; releaseUtc: Date; windowStart: Date; windowEnd: Date } | null {
  let best: { event: CalendarEvent; releaseUtc: Date; windowStart: Date; windowEnd: Date } | null = null;
  const horizon = now.getTime() + 14 * 24 * 60 * 60_000;
  for (const ev of ALL_EVENTS) {
    if (!ev.affects.includes("*") && !ev.affects.includes(symbol as "XAUUSDT" | "BTCUSDT")) continue;
    const releases = candidateReleases(ev, now, 14);
    for (const r of releases) {
      const start = r.getTime() - ev.preMin * 60_000;
      const end = r.getTime() + ev.postMin * 60_000;
      if (end < now.getTime()) continue;
      if (start > horizon) continue;
      if (!best || start < best.windowStart.getTime()) {
        best = { event: ev, releaseUtc: r, windowStart: new Date(start), windowEnd: new Date(end) };
      }
    }
  }
  return best;
}

function candidateReleases(ev: CalendarEvent, now: Date, daysAhead = 3): Date[] {
  const out: Date[] = [];
  if (ev.oneOffs) {
    for (const o of ev.oneOffs) {
      const [y, m, d] = o.date.split("-").map(Number);
      out.push(new Date(Date.UTC(y, m - 1, d, o.utcHour, o.utcMin)));
    }
  }
  if (ev.monthlyNthWeekday) {
    // Check current, previous, and next month to catch edge windows
    for (let dm = -1; dm <= 1; dm++) {
      const y = now.getUTCFullYear();
      const m = now.getUTCMonth() + dm;
      const r = nthWeekdayOfMonth(y, m, ev.monthlyNthWeekday.nth, ev.monthlyNthWeekday.weekday);
      r.setUTCHours(ev.monthlyNthWeekday.utcHour, ev.monthlyNthWeekday.utcMin, 0, 0);
      out.push(r);
    }
  }
  if (ev.weekly) {
    // Emit this week and next few weeks
    for (let dw = -1; dw <= Math.ceil(daysAhead / 7); dw++) {
      const base = new Date(now.getTime() + dw * 7 * 24 * 60 * 60_000);
      const diff = (ev.weekly.weekday - base.getUTCDay() + 7) % 7;
      const r = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + diff, ev.weekly.utcHour, ev.weekly.utcMin));
      out.push(r);
    }
  }
  return out;
}
