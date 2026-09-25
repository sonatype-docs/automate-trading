// AI Research — server functions.
// - runResearch: query the trade DB and generate the full research report.
// - askResearch: natural-language question grounded in the computed report.
//   The model is forbidden from inventing statistics; every answer must cite
//   the numbers already contained in the report context.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { TradeRecord } from "@/lib/trade-intelligence/types";
import { generateResearch } from "./ai-research/insights";
import { toMarkdown } from "./ai-research/report";
import { reviewTrade } from "./ai-research/trade-review";
import { deriveAll } from "./ai-research/features-ext";
import { requireAuth } from "./auth-middleware";

const RunInput = z.object({
  strategyId: z.string().optional(),
  symbol: z.string().optional(),
  fromMs: z.number().optional(),
  toMs: z.number().optional(),
  limit: z.number().int().positive().max(20000).default(5000),
});

async function fetchTrades(spec: z.infer<typeof RunInput>): Promise<TradeRecord[]> {
  const { supabaseAdmin } = await import("@/lib/db-admin.server");
  const { applyQuery } = await import("./trade-intelligence/query");
  const { rowToRecord } = await import("@/lib/trade-intelligence/mapper");
  const q = applyQuery(supabaseAdmin, "trade_intelligence", {
    strategyId: spec.strategyId,
    symbol: spec.symbol,
    fromMs: spec.fromMs,
    toMs: spec.toMs,
    orderBy: "exit_time",
    order: "asc",
    limit: spec.limit,
  });
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => rowToRecord(r as unknown as Record<string, unknown>));
}

export const runResearch = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((raw) => RunInput.parse(raw))
  .handler(async ({ data }) => {
    const trades = await fetchTrades(data);
    if (!trades.length) {
      return { report: null, markdown: "", tradeCount: 0 };
    }
    const report = generateResearch(trades);
    return { report, markdown: toMarkdown(report), tradeCount: trades.length };
  });

export const reviewOneTrade = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((raw) => z.object({ tradeId: z.string() }).parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/lib/db-admin.server");
    const { rowToRecord } = await import("@/lib/trade-intelligence/mapper");
    const { data: rows, error } = await supabaseAdmin
      .from("trade_intelligence").select("*").eq("trade_id", data.tradeId).limit(1);
    if (error) throw new Error(error.message);
    if (!rows?.length) throw new Error("Trade not found");
    const target = rowToRecord(rows[0] as Record<string, unknown>);
    // Peer set = all trades for same strategy.
    const { data: peerRows } = await supabaseAdmin
      .from("trade_intelligence").select("*").eq("strategy_id", target.strategyId).limit(5000);
    const peers = deriveAll((peerRows ?? []).map((r) => rowToRecord(r as Record<string, unknown>)));
    return reviewTrade(target, peers);
  });

const AskInput = z.object({
  question: z.string().min(2),
  strategyId: z.string().optional(),
  symbol: z.string().optional(),
});

export const askResearch = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((raw) => AskInput.parse(raw))
  .handler(async ({ data }) => {
    const trades = await fetchTrades({ strategyId: data.strategyId, symbol: data.symbol, limit: 5000 });
    if (!trades.length) return { answer: "No trades in the intelligence database yet. Record some trades first.", citations: [] };
    const report = generateResearch(trades);
    const insights = selectGroundedInsights(report, data.question);
    const answer = [
      `Analysis is grounded in ${report.sampleSize} trades from the selected dataset.`,
      ...insights.map((i) => `- **${i.title}** — ${i.summary}`),
    ].join("\n");
    return { answer, citations: insights.map(shortInsight) };
  });

/**
 * Extractive research answers are deliberately local and deterministic. This
 * keeps production independent of Lovable Cloud and guarantees that answers
 * cannot invent statistics outside the computed report.
 */
export function selectGroundedInsights(report: ReturnType<typeof generateResearch>, question: string) {
  const terms = question.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length >= 3);
  const all = [
    ...report.sections.executive,
    ...report.sections.edges,
    ...report.sections.failure,
    ...report.sections.filters,
    ...report.sections.regime,
    ...report.sections.walkForward,
    ...report.sections.monteCarlo,
    ...report.sections.comparison,
  ];
  const scored = all.map((insight) => {
    const text = `${insight.title} ${insight.summary}`.toLowerCase();
    return { insight, score: terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0) };
  });
  const selected = scored.filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 6).map((item) => item.insight);
  return selected.length ? selected : all.slice(0, 6);
}

function shortInsight(i: { title: string; summary: string; evidence: { sampleSize: number; pValue?: number | null; confidence?: number } }) {
  return {
    title: i.title,
    summary: i.summary,
    n: i.evidence.sampleSize,
    p: i.evidence.pValue ?? null,
    confidence: i.evidence.confidence ?? null,
  };
}
