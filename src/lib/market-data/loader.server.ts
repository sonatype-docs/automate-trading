// Server-only data loader — pulls raw klines via the existing kline source
// router, resamples if the requested timeframe is not native, and returns
// clean RawCandle[]. Never bundled into the client.
import { getKlineSource, type KlineSourceId } from "@/lib/exchange/kline-source.server";
import { resample } from "./resample";
import { runQualityChecks, type QualityReport } from "./quality";
import { TIMEFRAME_MS, type RawCandle, type Timeframe } from "./types";

const NATIVE_SHARK = new Set<Timeframe>(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]);
const NATIVE_YAHOO = new Set<Timeframe>(["1m", "2m", "5m", "15m", "30m", "1h", "1d", "1w", "1M"]);

function maxSafeHistoryMs(source: KlineSourceId, interval: Timeframe): number {
  if (source === "yahoo") {
    const daysByInterval: Partial<Record<Timeframe, number>> = {
      "1m": 7,
      "2m": 30,
      "5m": 30,
      "15m": 60,
      "30m": 60,
      "1h": 729,
      "2h": 729,
      "4h": 729,
      "1d": 3650,
      "1w": 3650,
      "1M": 3650,
    };
    return (daysByInterval[interval] ?? 30) * 86_400_000;
  }
  const daysByInterval: Partial<Record<Timeframe, number>> = {
    "1m": 2,
    "5m": 40,
    "15m": 120,
    "30m": 180,
    "1h": 180,
    "4h": 180,
    "1d": 365,
  };
  return (daysByInterval[interval] ?? 40) * 86_400_000;
}
function isTransientDataError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /429|500|502|503|504|timeout|timed out|fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT/i.test(message);
}

async function fetchRangeWithRetry(
  source: Awaited<ReturnType<typeof getKlineSource>>,
  symbol: string,
  interval: Timeframe,
  fromMs: number,
  toMs: number,
): Promise<Awaited<ReturnType<typeof source.getKlinesRange>>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await source.getKlinesRange(symbol, interval, fromMs, toMs);
    } catch (error) {
      lastError = error;
      if (!isTransientDataError(error) || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function pickBase(source: KlineSourceId, target: Timeframe): Timeframe {
  const native = source === "yahoo" ? NATIVE_YAHOO : NATIVE_SHARK;
  if (native.has(target)) return target;
  // For odd intraday TFs, fetch the largest native TF that divides into target.
  const targetMs = TIMEFRAME_MS[target];
  const candidates: Timeframe[] = source === "yahoo"
    ? ["1h", "30m", "15m", "5m", "2m", "1m"]
    : ["1h", "30m", "15m", "5m", "1m"];
  for (const c of candidates) {
    if (targetMs % TIMEFRAME_MS[c] === 0) return c;
  }
  return "1m";
}

export async function loadRawCandles(opts: {
  source: KlineSourceId;
  symbol: string;
  timeframe: Timeframe;
  fromMs: number;
  toMs: number;
}): Promise<{
  candles: RawCandle[];
  base: Timeframe;
  quality: QualityReport;
  requestedFromMs: number;
  effectiveFromMs: number;
  rangeAdjusted: boolean;
  rangeWarning?: string;
}> {
  const base = pickBase(opts.source, opts.timeframe);
  const safeWindowMs = maxSafeHistoryMs(opts.source, base);
  const effectiveFromMs = Number.isFinite(safeWindowMs)
    ? Math.max(opts.fromMs, opts.toMs - safeWindowMs)
    : opts.fromMs;
  const rangeAdjusted = effectiveFromMs > opts.fromMs;
  const src = await getKlineSource(opts.source);
  const raw = await fetchRangeWithRetry(src, opts.symbol, base, effectiveFromMs, opts.toMs);
  const baseCandles: RawCandle[] = raw.map((k) => ({
    ts: k.openTime,
    open: k.open, high: k.high, low: k.low, close: k.close,
    volume: k.volume,
  }));
  const candles = base === opts.timeframe ? baseCandles : resample(baseCandles, opts.timeframe);
  const quality = runQualityChecks(candles, opts.timeframe);
  if (!quality.usable) {
    const fatal = Object.entries(quality.countsByKind)
      .filter(([kind, count]) => count > 0 && ["bad_ohlc", "negative_price", "corrupted", "duplicate"].includes(kind))
      .map(([kind, count]) => kind + "=" + count)
      .join(", ");
    throw new Error("Market data quality gate failed for " + opts.symbol + " " + opts.timeframe + ": " + (fatal || "insufficient data"));
  }
  return {
    candles,
    base,
    quality,
    requestedFromMs: opts.fromMs,
    effectiveFromMs,
    rangeAdjusted,
    rangeWarning: rangeAdjusted
      ? `${opts.source} ${base} history was capped to ${Math.round(safeWindowMs / 86_400_000)} days to keep the production data request within the API/CloudFront latency budget.`
      : undefined,
  };
}
