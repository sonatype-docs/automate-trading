// Server functions for Time Edge Discovery — natural-language AI insights.
// Uses Lovable AI Gateway (google/gemini-3-flash-preview).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const BucketSummary = z.object({
  label: z.string(),
  trades: z.number(),
  expectancy: z.number(),
  profitFactor: z.number(),
  winRate: z.number(),
  robustness: z.number(),
  confidence: z.number(),
});

const NarrativeInput = z.object({
  totalTrades: z.number(),
  symbols: z.array(z.string()),
  strategies: z.array(z.string()),
  robustnessTop: z.array(BucketSummary).max(10),
  hiddenEdges: z.array(BucketSummary).max(10),
  warnings: z.array(BucketSummary).max(10),
  clusterSummary: z.string().default(""),
});

export const generateTimeEdgeNarrative = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => NarrativeInput.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY not configured");

    const prompt = [
      `You are a senior quantitative trading analyst. Summarize the following time-based edge discovery results for a professional trader in 4-6 concise paragraphs. Be direct and specific — reference actual bucket labels and numbers. No fluff.`,
      "",
      `## Dataset`,
      `- ${data.totalTrades.toLocaleString()} trades across ${data.symbols.length} symbols: ${data.symbols.slice(0, 10).join(", ")}`,
      `- Strategies: ${data.strategies.slice(0, 10).join(", ")}`,
      "",
      `## Top Robust Time Edges`,
      ...data.robustnessTop.map((b) => `- ${b.label}: expectancy ${b.expectancy.toFixed(2)}, PF ${b.profitFactor.toFixed(2)}, WR ${(b.winRate * 100).toFixed(1)}%, ${b.trades} trades, robustness ${b.robustness}/100`),
      "",
      `## Hidden Statistically Significant Edges (p<0.10)`,
      ...data.hiddenEdges.map((b) => `- ${b.label}: expectancy ${b.expectancy.toFixed(2)}, confidence ${(b.confidence * 100).toFixed(0)}%, ${b.trades} trades`),
      "",
      `## Warnings — loss-generating windows`,
      ...data.warnings.map((b) => `- ${b.label}: expectancy ${b.expectancy.toFixed(2)}, ${b.trades} trades`),
      "",
      data.clusterSummary ? `## Time Clusters\n${data.clusterSummary}` : "",
      "",
      `Structure the response as:`,
      `1. **Headline Findings** — top 2-3 insights.`,
      `2. **Hidden Edges** — which time windows deserve extra allocation.`,
      `3. **Risk Warnings** — which windows to filter out.`,
      `4. **Deployment Recommendation** — concrete next actions (which sessions/hours/weekdays to enable or disable).`,
    ].join("\n");

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "You are a senior quantitative trading analyst. Write with precision, brevity, and institutional tone." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!resp.ok) {
      const errorBody = await resp.text();
      if (resp.status === 429) throw new Error("Rate limited — please retry in a moment.");
      if (resp.status === 402) throw new Error("Lovable AI credits exhausted — top up in Settings.");
      throw new Error(`AI request failed [${resp.status}]: ${errorBody}`);
    }
    const json = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content ?? "";
    return { narrative: content };
  });
