/**
 * Yahoo Finance klines adapter (server-only, no API key required).
 *
 * Public JSON endpoint: query1.finance.yahoo.com/v8/finance/chart/{symbol}
 * Coverage: ~730 days of 1h bars for gold futures (GC=F) — ~4× deeper than
 * SharkExchange's 180d cap. Great for the 2:30 AM IST 1h strategy.
 *
 * Caveats:
 *   - GC=F is COMEX gold futures, not the XAUUSDT perp. Prices differ by a
 *     small basis (futures premium/backwardation) but the OHLC structure —
 *     which is what our range/break/fib strategies depend on — is virtually
 *     identical to spot gold at the 1h scale.
 *   - Futures have session gaps (COMEX closes daily); expect some hours to
 *     be missing vs. a 24×7 perp. Simulator already tolerates this.
 */

import type { Kline } from "@/lib/exchange/shark-client.server";

/** Map our internal symbols to the equivalent Yahoo Finance ticker. */
function toYahooSymbol(symbol: string): string {
  const s = symbol.toUpperCase();
  if (s === "XAUUSDT" || s === "XAUUSD" || s === "GOLD") return "GC=F";
  if (s === "BTCUSDT" || s === "BTCUSD") return "BTC-USD";
  if (s === "ETHUSDT" || s === "ETHUSD") return "ETH-USD";
  return s; // pass-through for anything else the user types
}

function toYahooInterval(interval: string): string {
  // Yahoo intervals: 1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h, 1d, 1wk, 1mo
  // 1h and 60m are equivalent; use 60m as the canonical form.
  switch (interval) {
    case "1m":
    case "2m":
    case "5m":
    case "15m":
    case "30m":
    case "1d":
      return interval;
    case "1w":
    case "1wk":
      return "1wk";
    case "1M":
      return "1mo";
    case "1h":
      return "60m";
    case "4h":
      // Yahoo doesn't support 4h natively; caller must resample. Fall back
      // to 60m and let the strategy resample if needed.
      return "60m";
    default:
      return interval;
  }
}

interface YahooChartResponse {
  chart: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }>;
      };
      meta?: { gmtoffset?: number };
    }>;
    error?: { code?: string; description?: string } | null;
  };
}

async function fetchYahoo(
  symbol: string,
  interval: string,
  fromMs: number,
  toMs: number,
): Promise<Kline[]> {
  const ySym = toYahooSymbol(symbol);
  const yInt = toYahooInterval(interval);
  const period1 = Math.floor(fromMs / 1000);
  const period2 = Math.floor(toMs / 1000);
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}` +
    `?interval=${yInt}&period1=${period1}&period2=${period2}` +
    `&includePrePost=false&events=div%2Csplit`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7_500);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "SharkAutoTraderBacktest/1.0",
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Yahoo klines timed out for ${symbol} ${interval}`);
    }
    throw new Error(`Yahoo klines request failed for ${symbol} ${interval}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Yahoo klines failed [${res.status}]: ${text.slice(0, 300)}`);
  }
  let parsed: YahooChartResponse;
  try {
    parsed = JSON.parse(text) as YahooChartResponse;
  } catch {
    throw new Error(`Yahoo klines: response not JSON`);
  }
  if (parsed.chart.error) {
    throw new Error(
      `Yahoo klines error: ${parsed.chart.error.description ?? parsed.chart.error.code ?? "unknown"}`,
    );
  }
  const result = parsed.chart.result?.[0];
  const ts = result?.timestamp ?? [];
  const q = result?.indicators?.quote?.[0];
  if (!q || ts.length === 0) return [];

  const intervalMs =
    interval === "1m" ? 60_000 :
    interval === "5m" ? 5 * 60_000 :
    interval === "15m" ? 15 * 60_000 :
    interval === "30m" ? 30 * 60_000 :
    interval === "1h" || interval === "60m" ? 3_600_000 :
    interval === "4h" ? 4 * 3_600_000 :
    interval === "1d" ? 86_400_000 : 3_600_000;

  const out: Kline[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    if (o == null || h == null || l == null || c == null) continue; // Yahoo can null-out bars
    const openTime = ts[i] * 1000;
    out.push({
      openTime,
      open: Number(o),
      high: Number(h),
      low: Number(l),
      close: Number(c),
      volume: Number(q.volume?.[i] ?? 0),
      closeTime: openTime + intervalMs - 1,
    });
  }
  return out;
}

export interface YahooKlineSource {
  getKlinesRange(
    symbol: string,
    interval: string,
    fromMs: number,
    toMs: number,
  ): Promise<Kline[]>;
  getKlines(
    symbol: string,
    interval?: string,
    limit?: number,
    opts?: { startTime?: number; endTime?: number },
  ): Promise<Kline[]>;
}

export function createYahooClient(): YahooKlineSource {
  return {
    async getKlinesRange(symbol, interval, fromMs, toMs) {
      // Yahoo has short maximum lookbacks for intraday intervals. Use a
      // deliberately conservative total window so the application remains
      // responsive, then fetch that window in smaller chunks. If an individual
      // chunk is rejected or times out, retry it with a smaller range and keep
      // any data that was successfully returned.
      const maxHistoryDays =
        interval === "1m" ? 7 :
        interval === "2m" ? 30 :
        interval === "5m" ? 30 :
        interval === "15m" ? 60 :
        interval === "30m" ? 60 :
        interval === "1h" || interval === "60m" || interval === "4h" ? 729 :
        3650;
      const maxHistoryMs = maxHistoryDays * 86_400_000;
      const effectiveFromMs = Math.max(fromMs, toMs - maxHistoryMs);

      const initialChunkMs =
        interval === "1m" ? 2 * 86_400_000 :
        interval === "2m" || interval === "5m" || interval === "15m" || interval === "30m" ? 10 * 86_400_000 :
        interval === "1h" || interval === "60m" || interval === "4h" ? 90 * 86_400_000 :
        365 * 86_400_000;
      const minimumChunkMs =
        interval === "1m" ? 12 * 60 * 60_000 :
        interval === "2m" || interval === "5m" || interval === "15m" || interval === "30m" ? 3 * 86_400_000 :
        30 * 86_400_000;

      const chunks: Kline[] = [];
      const seen = new Set<number>();
      let cursor = effectiveFromMs;

      while (cursor < toMs) {
        let windowMs = Math.min(initialChunkMs, toMs - cursor);
        let accepted = false;

        while (windowMs >= minimumChunkMs) {
          const end = Math.min(cursor + windowMs, toMs);
          try {
            const rows = await fetchYahoo(symbol, interval, cursor, end);
            for (const row of rows) {
              if (!seen.has(row.openTime)) {
                seen.add(row.openTime);
                chunks.push(row);
              }
            }
            accepted = true;
            cursor = end;
            break;
          } catch {
            windowMs = Math.floor(windowMs / 2);
          }
        }

        if (!accepted) {
          // The provider may have an unavailable/illiquid segment. Skip only
          // that small segment and continue so later available data survives.
          cursor = Math.min(cursor + minimumChunkMs, toMs);
        }
      }

      chunks.sort((a, b) => a.openTime - b.openTime);
      if (chunks.length === 0) {
        throw new Error(
          `Yahoo Finance returned no usable ${interval} bars for ${symbol} in the requested window. The provider may not expose that interval/history for this symbol.`,
        );
      }
      return chunks;
    },
    async getKlines(symbol, interval = "1h", limit = 100, opts) {
      const intervalMs =
        interval === "1m" ? 60_000 :
        interval === "5m" ? 5 * 60_000 :
        interval === "15m" ? 15 * 60_000 :
        interval === "30m" ? 30 * 60_000 :
        interval === "1h" || interval === "60m" ? 3_600_000 :
        interval === "4h" ? 4 * 3_600_000 :
        interval === "1d" ? 86_400_000 : 3_600_000;
      const endTime = opts?.endTime ?? Date.now();
      const startTime = opts?.startTime ?? endTime - limit * intervalMs;
      const rows = await fetchYahoo(symbol, interval, startTime, endTime);
      return rows.slice(-limit);
    },
  };
}
