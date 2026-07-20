// Aggregate insights across a matrix run: totals, groupings, breakdowns, CSV.
import type { MatrixRow } from "@/lib/liquidity-lab.functions";
import type { LabTrade } from "./simulator";

export interface Totals {
  runs: number;
  okRuns: number;
  failed: number;
  totalSignals: number;
  totalTrades: number;
  wins: number;
  losses: number;
  open: number;
  winRate: number;
  grossWinUsd: number;
  grossLossUsd: number;
  totalPnlUsd: number;
  profitFactor: number;
  expectancyR: number;
  avgRR: number;
  maxDrawdownUsd: number;
  longs: number;
  shorts: number;
  longWinRate: number;
  shortWinRate: number;
  bestCombo?: { key: string; pnl: number };
  worstCombo?: { key: string; pnl: number };
}

export interface Bucket {
  key: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  pnlUsd: number;
  profitFactor: number;
  expectancyR: number;
}

const comboKey = (r: MatrixRow) => `${r.symbol} ${r.timeframe} ${r.zones.join("+")}`;

export function computeTotals(rows: MatrixRow[]): Totals {
  const ok = rows.filter((r) => r.ok);
  const failed = rows.length - ok.length;
  let wins = 0, losses = 0, open = 0, gw = 0, gl = 0, totalR = 0, longs = 0, shorts = 0, lw = 0, sw = 0, sig = 0;
  let bestCombo: { key: string; pnl: number } | undefined;
  let worstCombo: { key: string; pnl: number } | undefined;

  // Merge chronological trades to compute a true combined equity curve / DD.
  const allTrades: LabTrade[] = [];
  for (const r of ok) {
    sig += r.signals;
    for (const t of r.trades) allTrades.push(t);
    const s = r.stats;
    if (!s) continue;
    if (!bestCombo || s.totalPnlUsd > bestCombo.pnl) bestCombo = { key: comboKey(r), pnl: s.totalPnlUsd };
    if (!worstCombo || s.totalPnlUsd < worstCombo.pnl) worstCombo = { key: comboKey(r), pnl: s.totalPnlUsd };
  }
  allTrades.sort((a, b) => a.exitTs - b.exitTs);

  for (const t of allTrades) {
    if (t.outcome === "win") wins++;
    else if (t.outcome === "loss") losses++;
    else open++;
    if (t.pnlUsd > 0) gw += t.pnlUsd;
    else if (t.pnlUsd < 0) gl += -t.pnlUsd;
    totalR += t.rMultiple;
    if (t.direction === "long") { longs++; if (t.outcome === "win") lw++; }
    else { shorts++; if (t.outcome === "win") sw++; }
  }

  let eq = 0, peak = 0, maxDd = 0;
  for (const t of allTrades) {
    eq += t.pnlUsd;
    if (eq > peak) peak = eq;
    if (peak - eq > maxDd) maxDd = peak - eq;
  }

  const closed = wins + losses;
  const totalTrades = allTrades.length;
  const avgRRList = ok.map((r) => r.stats?.avgRR ?? 0).filter((x) => x > 0);
  const avgRR = avgRRList.length ? avgRRList.reduce((a, b) => a + b, 0) / avgRRList.length : 0;

  return {
    runs: rows.length,
    okRuns: ok.length,
    failed,
    totalSignals: sig,
    totalTrades,
    wins, losses, open,
    winRate: closed ? (wins / closed) * 100 : 0,
    grossWinUsd: gw,
    grossLossUsd: gl,
    totalPnlUsd: gw - gl,
    profitFactor: gl > 0 ? gw / gl : (gw > 0 ? 999 : 0),
    expectancyR: closed ? totalR / closed : 0,
    avgRR,
    maxDrawdownUsd: maxDd,
    longs, shorts,
    longWinRate: longs ? (lw / longs) * 100 : 0,
    shortWinRate: shorts ? (sw / shorts) * 100 : 0,
    bestCombo, worstCombo,
  };
}

export function groupBy(
  rows: MatrixRow[],
  keyFn: (r: MatrixRow, t: LabTrade) => string,
): Bucket[] {
  type Acc = { trades: number; wins: number; losses: number; totalR: number; gw: number; gl: number };
  const map = new Map<string, Acc>();
  for (const r of rows) {
    if (!r.ok) continue;
    for (const t of r.trades) {
      const k = keyFn(r, t);
      const a = map.get(k) ?? { trades: 0, wins: 0, losses: 0, totalR: 0, gw: 0, gl: 0 };
      a.trades++;
      if (t.outcome === "win") a.wins++;
      else if (t.outcome === "loss") a.losses++;
      a.totalR += t.rMultiple;
      if (t.pnlUsd > 0) a.gw += t.pnlUsd; else if (t.pnlUsd < 0) a.gl += -t.pnlUsd;
      map.set(k, a);
    }
  }
  return Array.from(map.entries()).map(([key, a]) => {
    const closed = a.wins + a.losses;
    return {
      key,
      trades: a.trades,
      wins: a.wins,
      losses: a.losses,
      winRate: closed ? (a.wins / closed) * 100 : 0,
      pnlUsd: a.gw - a.gl,
      profitFactor: a.gl > 0 ? a.gw / a.gl : (a.gw > 0 ? 999 : 0),
      expectancyR: closed ? a.totalR / closed : 0,
    };
  }).sort((x, y) => y.pnlUsd - x.pnlUsd);
}

export function bySymbol(rows: MatrixRow[]) { return groupBy(rows, (r) => r.symbol); }
export function byTimeframe(rows: MatrixRow[]) { return groupBy(rows, (r) => r.timeframe); }
export function byZone(rows: MatrixRow[]) { return groupBy(rows, (r) => r.zones.join("+")); }
export function byDirection(rows: MatrixRow[]) { return groupBy(rows, (_r, t) => t.direction); }
export function byOutcome(rows: MatrixRow[]) { return groupBy(rows, (_r, t) => t.outcome); }
export function byWeekday(rows: MatrixRow[]) {
  const dn = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return groupBy(rows, (_r, t) => dn[new Date(t.ts).getUTCDay()]);
}
export function byHourUTC(rows: MatrixRow[]) {
  return groupBy(rows, (_r, t) => String(new Date(t.ts).getUTCHours()).padStart(2, "0") + ":00");
}

export function tradesCsv(rows: MatrixRow[]): string {
  const header = [
    "symbol", "timeframe", "zones",
    "entry_ts_utc", "exit_ts_utc", "direction", "outcome",
    "entry", "stop", "target", "r_multiple", "pnl_usd", "bars_held",
  ].join(",");
  const lines: string[] = [header];
  for (const r of rows) {
    if (!r.ok) continue;
    for (const t of r.trades) {
      lines.push([
        r.symbol, r.timeframe, r.zones.join("+"),
        new Date(t.ts).toISOString(), new Date(t.exitTs).toISOString(),
        t.direction, t.outcome,
        t.entry.toFixed(6), t.stop.toFixed(6), t.target.toFixed(6),
        t.rMultiple.toFixed(3), t.pnlUsd.toFixed(2), String(t.barsHeld),
      ].join(","));
    }
  }
  return lines.join("\n");
}

export function downloadCsv(name: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}
