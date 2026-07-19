// Human-readable entry window schedule (IST) for each strategy preset.
// Session UTC bounds mirror src/lib/market-data/sessions.ts. IST = UTC + 5:30.

export type SessionKey =
  | "london"
  | "new_york"
  | "london_ny_overlap"
  | "asian"
  | "sydney";

interface UtcWindow { startH: number; endH: number } // endH may exceed 24 (wraps)

const UTC_WINDOWS: Record<SessionKey, UtcWindow> = {
  asian:             { startH: 0,  endH: 9 },
  london:            { startH: 7,  endH: 16 },
  london_ny_overlap: { startH: 12, endH: 16 },
  new_york:          { startH: 12, endH: 21 },
  sydney:            { startH: 21, endH: 30 }, // 21:00..06:00 next day
};

const IST_OFFSET_MIN = 5 * 60 + 30;

function pad(n: number) { return String(n).padStart(2, "0"); }

function fmtIstMinutes(m: number) {
  const mod = ((m % 1440) + 1440) % 1440;
  return `${pad(Math.floor(mod / 60))}:${pad(mod % 60)}`;
}

export interface IstWindow {
  session: SessionKey;
  label: string;   // "12:30 – 21:30 IST"
  startMin: number; // minutes since IST midnight (may wrap)
  endMin: number;
}

export function istWindowFor(session: SessionKey): IstWindow {
  const w = UTC_WINDOWS[session];
  const startMin = w.startH * 60 + IST_OFFSET_MIN;
  const endMin = w.endH * 60 + IST_OFFSET_MIN;
  return {
    session,
    startMin,
    endMin,
    label: `${fmtIstMinutes(startMin)} – ${fmtIstMinutes(endMin)} IST`,
  };
}

export function istNowMinutes(now = new Date()): number {
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  return (utcMin + IST_OFFSET_MIN) % 1440;
}

export function isWindowActive(w: IstWindow, nowMin = istNowMinutes()): boolean {
  const start = ((w.startMin % 1440) + 1440) % 1440;
  const end = w.endMin; // may exceed 1440 to indicate wrap
  if (end <= 1440) return nowMin >= start && nowMin < end;
  const endMod = end % 1440;
  return nowMin >= start || nowMin < endMod;
}

export function minutesUntilOpen(w: IstWindow, nowMin = istNowMinutes()): number {
  const start = ((w.startMin % 1440) + 1440) % 1440;
  const diff = (start - nowMin + 1440) % 1440;
  return diff;
}

export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${pad(m)}m`;
}

// Sessions each strategy preset is allowed to enter in (mirrors STRATEGY_PRESETS).
export const PRESET_SESSIONS: Record<string, SessionKey[]> = {
  london_orb: ["london", "london_ny_overlap"],
  liquidity_sweep_long: ["london", "london_ny_overlap", "new_york"],
  vwap_mean_revert: ["london", "new_york", "london_ny_overlap"],
};

export function windowsForPreset(preset: string): IstWindow[] {
  const keys = PRESET_SESSIONS[preset] ?? [];
  return keys.map(istWindowFor);
}

/** True if `hourIst` (0-23) is inside [startH, endH) with midnight-wrap support. */
export function isHourInWindow(hourIst: number, startH: number, endH: number): boolean {
  if (endH === startH) return false;
  if (endH > startH) return hourIst >= startH && hourIst < endH;
  return hourIst >= startH || hourIst < endH;
}

/** IST weekday for `now`. Returns BOTH numbering schemes so the gate accepts
 *  either convention the caller stored: ISO (Mon=1..Sun=7) or JS (Sun=0..Sat=6). */
export function istWeekday(now = new Date()): { iso: number; js: number } {
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const dayShift = Math.floor((utcMin + IST_OFFSET_MIN) / 1440);
  const js = (now.getUTCDay() + dayShift + 7) % 7; // 0=Sun..6=Sat
  const iso = js === 0 ? 7 : js;
  return { iso, js };
}

/** Gate a runner by pinned IST window + weekday whitelist. Null/empty = no filter.
 *  Accepts weekday lists in either ISO (1..7) or JS (0..6) — a match on either
 *  scheme lets the tick through, so historical rows saved in the JS scheme keep
 *  working after we normalize the picker to ISO. */
export function isRunnerAllowedNow(
  cfg: {
    window_start_hour_ist?: number | null;
    window_end_hour_ist?: number | null;
    weekdays_ist?: number[] | null;
  },
  now = new Date(),
): boolean {
  const hourIst = Math.floor(istNowMinutes(now) / 60);
  if (cfg.window_start_hour_ist != null && cfg.window_end_hour_ist != null) {
    if (!isHourInWindow(hourIst, cfg.window_start_hour_ist, cfg.window_end_hour_ist)) return false;
  }
  if (cfg.weekdays_ist && cfg.weekdays_ist.length > 0) {
    const { iso, js } = istWeekday(now);
    if (!cfg.weekdays_ist.includes(iso) && !cfg.weekdays_ist.includes(js)) return false;
  }
  return true;
}

/** Is today (IST) in the runner's weekday whitelist? Null/empty = every day. */
export function isTodayAllowedForRunner(
  weekdays_ist?: number[] | null,
  now = new Date(),
): boolean {
  if (!weekdays_ist || weekdays_ist.length === 0) return true;
  const { iso, js } = istWeekday(now);
  return weekdays_ist.includes(iso) || weekdays_ist.includes(js);
}

const IST_DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function istTodayName(now = new Date()): string {
  return IST_DAY_NAMES[istWeekday(now).js];
}


/** Returns null if `direction` is compatible with `preset`, else a reason string. */
export function presetDirectionConflict(
  preset: string,
  direction: "long" | "short" | "both",
): string | null {
  const p = preset.toLowerCase();
  if (p.includes("long") && direction === "short") return `${preset} is long-only`;
  if (p.includes("short") && direction === "long") return `${preset} is short-only`;
  return null;
}
