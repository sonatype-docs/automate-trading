// CSV / JSON export for Time Edge Report.
import type { TimeEdgeReport, BucketMetrics } from "./types";

const CSV_COLS: (keyof BucketMetrics)[] = [
  "dim", "label", "trades", "wins", "losses",
  "netProfit", "winRate", "profitFactor", "expectancy", "avgRr",
  "sharpe", "sortino", "maxDrawdown", "recoveryFactor",
  "avgHoldingBars", "medianHoldingBars",
  "pValueMean", "pValueWin", "confidence", "robustness",
];

export function bucketsToCsv(buckets: BucketMetrics[]): string {
  const header = CSV_COLS.join(",");
  const lines = buckets.map((b) =>
    CSV_COLS.map((k) => {
      const v = b[k];
      if (typeof v === "number") return Number.isFinite(v) ? v.toFixed(4) : "0";
      if (Array.isArray(v)) return `"${v.join("|")}"`;
      return String(v);
    }).join(","),
  );
  return [header, ...lines].join("\n");
}

export function reportToJson(report: TimeEdgeReport): string {
  return JSON.stringify(report, null, 2);
}

export function reportToMarkdown(report: TimeEdgeReport): string {
  const lines: string[] = [];
  lines.push(`# Time Edge Discovery Report`);
  lines.push(`Generated ${new Date(report.generatedAt).toISOString()}`);
  lines.push("");
  lines.push(`**${report.headlineSummary}**`);
  lines.push("");
  lines.push(`- Total trades: ${report.totalTrades.toLocaleString()}`);
  lines.push(`- Symbols: ${report.totalSymbols.join(", ")}`);
  lines.push(`- Strategies: ${report.totalStrategies.join(", ")}`);
  lines.push("");
  lines.push(`## Top Robust Edges`);
  lines.push(`| Bucket | Trades | Expectancy | PF | Win% | Robustness |`);
  lines.push(`|---|---:|---:|---:|---:|---:|`);
  for (const b of report.robustnessTop.slice(0, 10)) {
    lines.push(`| ${b.label} | ${b.trades} | ${b.expectancy.toFixed(2)} | ${b.profitFactor.toFixed(2)} | ${(b.winRate * 100).toFixed(1)}% | ${b.robustness}/100 |`);
  }
  lines.push("");
  if (report.hiddenEdges.length) {
    lines.push(`## Hidden Edges (statistically significant, p<0.10)`);
    for (const b of report.hiddenEdges) {
      lines.push(`- **${b.label}** — expectancy ${b.expectancy.toFixed(2)}, ${b.trades} trades, confidence ${(b.confidence * 100).toFixed(0)}%`);
    }
    lines.push("");
  }
  if (report.warnings.length) {
    lines.push(`## Time Windows To Avoid`);
    for (const b of report.warnings) {
      lines.push(`- **${b.label}** — expectancy ${b.expectancy.toFixed(2)}, ${b.trades} trades, confidence ${(b.confidence * 100).toFixed(0)}%`);
    }
  }
  return lines.join("\n");
}
