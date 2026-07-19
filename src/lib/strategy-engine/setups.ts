// Setup detection — pure. Every detector returns null or a Trigger describing
// a level and initial direction. The entry module decides how to enter around
// that level.
import type { EnrichedCandle } from "@/lib/market-data/types";
import type { SetupConfig, SetupKind, SignalDirection } from "./types";

export interface SetupTrigger {
  kind: SetupKind;
  direction: SignalDirection;
  level: number;              // reference price (breakout, sweep, etc.)
  swingHigh: number | null;
  swingLow: number | null;
  meta: Record<string, string | number | boolean | null>;
}

export function detectSetup(
  bars: EnrichedCandle[],
  i: number,
  cfg: SetupConfig,
): SetupTrigger | null {
  const bar = bars[i]; const prev = bars[i - 1];
  if (!bar || !prev) return null;
  const buf = (cfg.breakBufferPct ?? 0) / 100;

  switch (cfg.kind) {
    case "opening_range_break": {
      if (bar.openingRangeSize === null || bar.breakDistance === null) return null;
      // We need a level: assume mid + half-size are the OR high/low.
      const half = bar.openingRangeSize / 2;
      const orMid = bar.close - bar.breakDistance * (bar.close > prev.close ? 1 : -1);
      const orHigh = orMid + half; const orLow = orMid - half;
      if (bar.close > orHigh * (1 + buf) && prev.close <= orHigh)
        return t("opening_range_break", "long", orHigh, bar);
      if (bar.close < orLow * (1 - buf) && prev.close >= orLow)
        return t("opening_range_break", "short", orLow, bar);
      return null;
    }
    case "prev_day_high_sweep": {
      if (bar.prevDayHigh == null) return null;
      if (bar.high > bar.prevDayHigh && bar.close < bar.prevDayHigh)
        return t("prev_day_high_sweep", "short", bar.prevDayHigh, bar);
      return null;
    }
    case "prev_day_low_sweep": {
      if (bar.prevDayLow == null) return null;
      if (bar.low < bar.prevDayLow && bar.close > bar.prevDayLow)
        return t("prev_day_low_sweep", "long", bar.prevDayLow, bar);
      return null;
    }
    case "equal_high_sweep":
      if (bar.equalHigh && bar.swingHigh != null && bar.high > bar.swingHigh && bar.close < bar.swingHigh)
        return t("equal_high_sweep", "short", bar.swingHigh, bar);
      return null;
    case "equal_low_sweep":
      if (bar.equalLow && bar.swingLow != null && bar.low < bar.swingLow && bar.close > bar.swingLow)
        return t("equal_low_sweep", "long", bar.swingLow, bar);
      return null;
    case "liquidity_sweep": {
      // Any sweep of recent swing that closes back inside.
      if (bar.swingHigh != null && bar.high > bar.swingHigh && bar.close < bar.swingHigh)
        return t("liquidity_sweep", "short", bar.swingHigh, bar);
      if (bar.swingLow != null && bar.low < bar.swingLow && bar.close > bar.swingLow)
        return t("liquidity_sweep", "long", bar.swingLow, bar);
      return null;
    }
    case "breakout": {
      if (bar.swingHigh != null && prev.close <= bar.swingHigh && bar.close > bar.swingHigh * (1 + buf))
        return t("breakout", "long", bar.swingHigh, bar);
      if (bar.swingLow != null && prev.close >= bar.swingLow && bar.close < bar.swingLow * (1 - buf))
        return t("breakout", "short", bar.swingLow, bar);
      return null;
    }
    case "retest": {
      const tol = (cfg.retestTolerancePct ?? 0.1) / 100;
      if (bar.swingHigh != null && Math.abs(bar.low - bar.swingHigh) / bar.swingHigh <= tol && bar.close > bar.swingHigh)
        return t("retest", "long", bar.swingHigh, bar);
      if (bar.swingLow != null && Math.abs(bar.high - bar.swingLow) / bar.swingLow <= tol && bar.close < bar.swingLow)
        return t("retest", "short", bar.swingLow, bar);
      return null;
    }
    case "bos":
      if (bar.bos === "bull") return t("bos", "long", bar.swingHigh ?? bar.close, bar);
      if (bar.bos === "bear") return t("bos", "short", bar.swingLow ?? bar.close, bar);
      return null;
    case "choch":
      if (bar.choch === "bull") return t("choch", "long", bar.swingHigh ?? bar.close, bar);
      if (bar.choch === "bear") return t("choch", "short", bar.swingLow ?? bar.close, bar);
      return null;
    case "mss":
      if (bar.mss === "bull") return t("mss", "long", bar.swingHigh ?? bar.close, bar);
      if (bar.mss === "bear") return t("mss", "short", bar.swingLow ?? bar.close, bar);
      return null;
    case "vwap_cross":
      if (bar.vwapDaily == null || prev.vwapDaily == null) return null;
      if (prev.close <= prev.vwapDaily && bar.close > bar.vwapDaily) return t("vwap_cross", "long", bar.vwapDaily, bar);
      if (prev.close >= prev.vwapDaily && bar.close < bar.vwapDaily) return t("vwap_cross", "short", bar.vwapDaily, bar);
      return null;
    case "poc_rejection":
      if (cfg.poc == null) return null;
      if (bar.high >= cfg.poc && bar.close < cfg.poc) return t("poc_rejection", "short", cfg.poc, bar);
      if (bar.low <= cfg.poc && bar.close > cfg.poc) return t("poc_rejection", "long", cfg.poc, bar);
      return null;
    case "vah_break":
      if (cfg.vah == null) return null;
      if (prev.close <= cfg.vah && bar.close > cfg.vah) return t("vah_break", "long", cfg.vah, bar);
      return null;
    case "val_break":
      if (cfg.val == null) return null;
      if (prev.close >= cfg.val && bar.close < cfg.val) return t("val_break", "short", cfg.val, bar);
      return null;
    case "pdh_pdl_sweep":
      // Handled directly by the engine (needs multi-bar armed state).
      return null;
    case "donchian_break": {
      const N = Math.max(2, cfg.donchianLookback ?? 20);
      if (i < N) return null;
      let hi = -Infinity, lo = Infinity;
      for (let k = i - N; k < i; k++) {
        if (bars[k].high > hi) hi = bars[k].high;
        if (bars[k].low < lo) lo = bars[k].low;
      }
      if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
      if (bar.close > hi * (1 + buf) && prev.close <= hi)
        return t("donchian_break", "long", hi, bar);
      if (bar.close < lo * (1 - buf) && prev.close >= lo)
        return t("donchian_break", "short", lo, bar);
      return null;
    }
    case "supertrend_flip": {
      const st = computeSuperTrend(bars, cfg.supertrendPeriod ?? 10, cfg.supertrendMultiplier ?? 3);
      const cur = st[i]; const prv = st[i - 1];
      if (!cur || !prv) return null;
      if (prv.dir < 0 && cur.dir > 0) return t("supertrend_flip", "long", cur.line, bar);
      if (prv.dir > 0 && cur.dir < 0) return t("supertrend_flip", "short", cur.line, bar);
      return null;
    }
    case "rsi_extreme": {
      const rsiVal = bar.rsi;
      const prevRsi = prev.rsi;
      if (rsiVal == null || prevRsi == null) return null;
      const os = cfg.rsiOversold ?? 5;
      const ob = cfg.rsiOverbought ?? 95;
      // Trigger on the bar the RSI crosses back through the extreme (reversal confirmation)
      if (prevRsi < os && rsiVal >= os) return t("rsi_extreme", "long", bar.close, bar);
      if (prevRsi > ob && rsiVal <= ob) return t("rsi_extreme", "short", bar.close, bar);
      return null;
    }
    case "bb_zscore_fade": {
      const N = Math.max(5, cfg.bbPeriod ?? 20);
      const sigma = cfg.bbSigma ?? 2.5;
      if (i < N) return null;
      let sum = 0;
      for (let k = i - N; k < i; k++) sum += bars[k].close;
      const mean = sum / N;
      let sq = 0;
      for (let k = i - N; k < i; k++) { const d = bars[k].close - mean; sq += d * d; }
      const std = Math.sqrt(sq / N);
      if (std <= 0) return null;
      const upper = mean + sigma * std;
      const lower = mean - sigma * std;
      // Fade: prev closed outside the band, this bar closes back inside → mean-revert to mean.
      if (prev.close < lower && bar.close > lower) return t("bb_zscore_fade", "long", mean, bar);
      if (prev.close > upper && bar.close < upper) return t("bb_zscore_fade", "short", mean, bar);
      return null;
    }
  }
  return null;
}

// ── SuperTrend indicator ── memoized per bars array so the O(N) walk happens once.
interface StPoint { line: number; dir: 1 | -1 }
const _stCache = new WeakMap<object, { key: string; data: (StPoint | null)[] }>();
function computeSuperTrend(bars: EnrichedCandle[], period: number, mult: number): (StPoint | null)[] {
  const key = `${period}:${mult}:${bars.length}`;
  const hit = _stCache.get(bars as unknown as object);
  if (hit && hit.key === key) return hit.data;
  const n = bars.length;
  const out: (StPoint | null)[] = new Array(n).fill(null);
  if (n === 0) return out;
  // Use existing ATR field on the enriched candle — assumed period matches (14). We accept some drift.
  let prevLine = 0; let prevDir: 1 | -1 = 1;
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    const atrV = b.atr;
    if (atrV == null) continue;
    const hl2 = (b.high + b.low) / 2;
    const upBand = hl2 + mult * atrV;
    const dnBand = hl2 - mult * atrV;
    let line: number; let dir: 1 | -1;
    if (i === 0 || !out[i - 1]) {
      line = dnBand; dir = 1;
    } else {
      const p = out[i - 1]!;
      if (p.dir > 0) {
        line = Math.max(dnBand, p.line);
        dir = b.close < line ? -1 : 1;
        if (dir < 0) line = upBand;
      } else {
        line = Math.min(upBand, p.line);
        dir = b.close > line ? 1 : -1;
        if (dir > 0) line = dnBand;
      }
    }
    prevLine = line; prevDir = dir;
    out[i] = { line: prevLine, dir: prevDir };
  }
  _stCache.set(bars as unknown as object, { key, data: out });
  return out;
}


function t(kind: SetupKind, direction: SignalDirection, level: number, bar: EnrichedCandle): SetupTrigger {
  return {
    kind, direction, level,
    swingHigh: bar.swingHigh,
    swingLow: bar.swingLow,
    meta: { session: bar.session, atr: bar.atr, structure: bar.structure },
  };
}
