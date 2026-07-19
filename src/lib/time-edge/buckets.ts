// Time-window bucket generators. Pure. IST-first (project convention).
import type { TradeRecord } from "@/lib/trade-intelligence/types";
import type { BucketDim, CustomWindow } from "./types";

const IST_OFFSET_MIN = 330; // +5:30

export function istMinutes(ms: number): number {
  const d = new Date(ms);
  return (d.getUTCHours() * 60 + d.getUTCMinutes() + IST_OFFSET_MIN + 24 * 60) % (24 * 60);
}
export function istHour(ms: number): number { return Math.floor(istMinutes(ms) / 60); }
export function utcHour(ms: number): number { return new Date(ms).getUTCHours(); }

export function formatHour(h: number): string { return `${String(h).padStart(2, "0")}:00`; }

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function weekdayIst(ms: number): number {
  const d = new Date(ms + IST_OFFSET_MIN * 60_000);
  return d.getUTCDay();
}
export function monthIst(ms: number): number {
  const d = new Date(ms + IST_OFFSET_MIN * 60_000);
  return d.getUTCMonth() + 1;
}
export function quarterIst(ms: number): number {
  return Math.ceil(monthIst(ms) / 3);
}

/** Returns a stable bucket key + display label for a trade under a dim. */
export function bucketOf(
  t: TradeRecord,
  dim: BucketDim,
  customWindows: CustomWindow[] = [],
): { key: string; label: string } | null {
  switch (dim) {
    case "hour_ist": {
      const h = istHour(t.entryTime);
      return { key: `h${h}`, label: `${formatHour(h)} IST` };
    }
    case "hour_utc": {
      const h = utcHour(t.entryTime);
      return { key: `u${h}`, label: `${formatHour(h)} UTC` };
    }
    case "weekday": {
      const w = t.weekday ?? weekdayIst(t.entryTime);
      return { key: `w${w}`, label: WEEKDAY_LABELS[w] ?? String(w) };
    }
    case "month": {
      const m = t.month ?? monthIst(t.entryTime);
      return { key: `m${m}`, label: MONTH_LABELS[m - 1] ?? String(m) };
    }
    case "quarter": {
      const q = t.quarter ?? quarterIst(t.entryTime);
      return { key: `q${q}`, label: `Q${q}` };
    }
    case "session": {
      const s = (t.session || "unknown").toString();
      return { key: `s:${s}`, label: s };
    }
    case "symbol": {
      const s = (t.symbol || "unknown").toString();
      return { key: `sym:${s}`, label: s };
    }
    case "hour_weekday": {
      const h = istHour(t.entryTime);
      const w = t.weekday ?? weekdayIst(t.entryTime);
      return { key: `h${h}_w${w}`, label: `${WEEKDAY_LABELS[w]} ${formatHour(h)}` };
    }
    case "session_weekday": {
      const s = (t.session || "unknown").toString();
      const w = t.weekday ?? weekdayIst(t.entryTime);
      return { key: `s:${s}_w${w}`, label: `${WEEKDAY_LABELS[w]} · ${s}` };
    }
    case "custom_window": {
      const mins = istMinutes(t.entryTime);
      for (const w of customWindows) {
        const inside = w.startMinutesIst <= w.endMinutesIst
          ? mins >= w.startMinutesIst && mins < w.endMinutesIst
          : mins >= w.startMinutesIst || mins < w.endMinutesIst; // wraps midnight
        if (inside) return { key: `cw:${w.label}`, label: w.label };
      }
      return null;
    }
  }
}

export function groupByDim(
  trades: TradeRecord[],
  dim: BucketDim,
  customWindows: CustomWindow[] = [],
): Map<string, { label: string; rows: TradeRecord[] }> {
  const map = new Map<string, { label: string; rows: TradeRecord[] }>();
  for (const t of trades) {
    const b = bucketOf(t, dim, customWindows);
    if (!b) continue;
    const existing = map.get(b.key);
    if (existing) existing.rows.push(t);
    else map.set(b.key, { label: b.label, rows: [t] });
  }
  return map;
}
