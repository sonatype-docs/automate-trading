import { createSharkClient, type Kline } from "@/lib/exchange/shark-client.server";
import { simulateFromKlines } from "@/lib/strategy/backtest-range.server";

type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface HourStat {
  hour: string; // "HH:00"
  trades: number;
  wins: number;
  losses: number;
  win_rate_pct: number;
  total_pnl_usd: number;
  max_drawdown_usd: number;
  best_day: { ist_date: string; pnl_usd: number } | null;
  worst_day: { ist_date: string; pnl_usd: number } | null;
  profit_factor: number;
  expectancy_usd: number;
  avg_r: number;
}

export interface SweepRangeResult {
  days: number;
  hours: HourStat[];
}

export interface SweepResult {
  symbol: string;
  sl_risk_usd: number;
  rr: number;
  trail: { enabled: boolean; activate_r: number; step_r: number };
  skip_weekdays: Weekday[];
  ranges: SweepRangeResult[];
  generated_at: number;
}

export async function runSweep(opts: {
  symbol: string;
  ranges: number[];
  slRiskUsd: number;
  rr: number;
  trailEnabled?: boolean;
  trailActivateR?: number;
  trailStepR?: number;
  skipWeekdays?: Weekday[];
}): Promise<SweepResult> {
  const maxDays = Math.max(...opts.ranges, 1);
  const client = createSharkClient();
  const now = Date.now();
  const fromMs = now - maxDays * 86_400_000;
  const klines: Kline[] = await client.getKlinesRange(opts.symbol, "1h", fromMs, now);

  // IST candles open at HH:30 (UTC hour boundaries + 5:30). Use :30 slots so each
  // sweep hour maps to a real candle instead of getting floored onto the previous one.
  const hours: string[] = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:30`);
  const rangeResults: SweepRangeResult[] = [];

  for (const days of opts.ranges) {
    const rangeFromMs = now - days * 86_400_000;
    const hourStats: HourStat[] = [];
    for (const hour of hours) {
      const r = simulateFromKlines(klines, {
        symbol: opts.symbol,
        sessionStartIst: hour,
        slRiskUsd: opts.slRiskUsd,
        rr: opts.rr,
        days,
        fromMs: rangeFromMs,
        nowMs: now,
        trailEnabled: opts.trailEnabled,
        trailActivateR: opts.trailActivateR,
        trailStepR: opts.trailStepR,
        skipWeekdays: opts.skipWeekdays,
      });
      const decidedDays = r.days.filter((d) => d.outcome === "tp" || d.outcome === "sl");
      const best = r.days.length
        ? r.days.reduce((a, b) => (b.pnl_usd > a.pnl_usd ? b : a))
        : null;
      const worst = r.days.length
        ? r.days.reduce((a, b) => (b.pnl_usd < a.pnl_usd ? b : a))
        : null;
      hourStats.push({
        hour,
        trades: decidedDays.length,
        wins: r.summary.tp,
        losses: r.summary.sl,
        win_rate_pct: r.summary.win_rate_pct,
        total_pnl_usd: r.summary.total_pnl_usd,
        max_drawdown_usd: r.summary.max_drawdown_usd,
        best_day:
          best && best.pnl_usd !== 0
            ? { ist_date: best.ist_date, pnl_usd: best.pnl_usd }
            : null,
        worst_day:
          worst && worst.pnl_usd !== 0
            ? { ist_date: worst.ist_date, pnl_usd: worst.pnl_usd }
            : null,
        profit_factor: r.summary.profit_factor,
        expectancy_usd: r.summary.expectancy_usd,
        avg_r: r.summary.avg_r,
      });
    }
    rangeResults.push({ days, hours: hourStats });
  }

  return {
    symbol: opts.symbol,
    sl_risk_usd: opts.slRiskUsd,
    rr: opts.rr,
    trail: {
      enabled: !!opts.trailEnabled,
      activate_r: opts.trailActivateR ?? 2,
      step_r: opts.trailStepR ?? 1,
    },
    skip_weekdays: opts.skipWeekdays ?? [],
    ranges: rangeResults,
    generated_at: now,
  };
}
