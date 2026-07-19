// Server functions for Time Edge Discovery — natural-language AI insights.
// Uses Lovable AI Gateway (google/gemini-3-flash-preview).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { STRATEGY_PRESETS } from "@/lib/strategy-engine/presets";

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

// ---------------------------------------------------------------------------
// Deploy selected Time Edge buckets as live_runners / paper_runners.
// Each bucket is turned into one runner keyed by asset + strategy + direction.
// Existing rows for the same asset + strategy are removed first so the top
// picks are the only ones present, per user policy.
// ---------------------------------------------------------------------------
const DeployBucket = z.object({
  label: z.string(),
  symbol: z.string(),
  timeframe: z.string(),
  strategyPreset: z.string(),
  execPreset: z.string().default("conservative_default"),
  source: z.enum(["yahoo", "shark"]).optional(),
  riskUsd: z.number().positive().max(10_000).default(10),
  leverage: z.number().int().min(1).max(200).optional(),
  lookbackDays: z.number().int().min(1).max(365).default(30),
  hoursIst: z.array(z.number()).optional(),
  weekdays: z.array(z.number()).optional(),
  sessions: z.array(z.string()).optional(),
  direction: z.string().optional(),
  /** Optional pinned trading window (IST hour range, inclusive start, exclusive end). */
  windowStartHourIst: z.number().int().min(0).max(23).optional(),
  windowEndHourIst: z.number().int().min(1).max(24).optional(),
});
const DeployInput = z.object({
  target: z.enum(["live", "paper", "both"]),
  buckets: z.array(DeployBucket).min(1).max(50),
  replaceExisting: z.boolean().default(true),
});

function runnerKey(b: z.infer<typeof DeployBucket>): string {
  const dir = (b.direction ?? "both").toLowerCase();
  return `${b.symbol.toUpperCase()}|${b.strategyPreset}|${dir}`;
}

function defaultSource(symbol: string): "yahoo" | "shark" {
  const s = symbol.toUpperCase();
  if (s.includes("XAU") || s.includes("GOLD")) return "yahoo";
  return "shark";
}
function defaultLeverage(symbol: string): number {
  const s = symbol.toUpperCase();
  if (s.includes("BTC")) return 150;
  if (s.includes("XAU") || s.includes("GOLD")) return 75;
  return 5;
}

export const deployTimeEdgeBuckets = createServerFn({ method: "POST" })
  .inputValidator((raw) => DeployInput.parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { presetDirectionConflict } = await import("@/lib/session-windows");
    const s = supabaseAdmin;
    const validStrategies = new Set(Object.keys(STRATEGY_PRESETS));
    const invalid = data.buckets.find((b) => !validStrategies.has(b.strategyPreset));
    if (invalid) {
      throw new Error(`${invalid.strategyPreset} is not registered as a live strategy. Pick a supported preset before deploying.`);
    }

    const dedupedBuckets: Array<z.infer<typeof DeployBucket>> = [];
    const seen = new Set<string>();
    const duplicateCountByKey = new Map<string, number>();
    for (const b of data.buckets) {
      const key = runnerKey(b);
      if (seen.has(key)) {
        duplicateCountByKey.set(key, (duplicateCountByKey.get(key) ?? 0) + 1);
        continue;
      }
      seen.add(key);
      dedupedBuckets.push(b);
    }

    const targets: Array<"live" | "paper"> =
      data.target === "both" ? ["live", "paper"] : [data.target];

    const summary = {
      live: { removed: 0, inserted: 0, runners: [] as string[], removedRunners: [] as string[] },
      paper: { removed: 0, inserted: 0, runners: [] as string[], removedRunners: [] as string[] },
      skipped: [] as Array<{ label: string; reason: string }>,
    };

    for (const [key, count] of duplicateCountByKey) {
      const [symbol, preset, direction] = key.split("|");
      summary.skipped.push({
        label: `${symbol} · ${preset} · ${direction}`,
        reason: `duplicate asset+strategy selection collapsed (${count} extra)`,
      });
    }

    for (const tgt of targets) {
      const table = tgt === "live" ? "live_runners" : "paper_runners";

      if (data.replaceExisting) {
        const { data: staleInvalid } = await s
          .from(table)
          .select("id, label, symbol, timeframe, strategy_preset")
          .not("strategy_preset", "in", `(${Array.from(validStrategies).join(",")})`);
        if (staleInvalid?.length) {
          const ids = staleInvalid.map((r: { id: string }) => r.id);
          const tradeTable = tgt === "live" ? "live_trades" : "paper_trades";
          await s.from(tradeTable).delete().in("runner_id", ids);
          await s.from(table).delete().in("id", ids);
          summary[tgt].removed += staleInvalid.length;
          summary[tgt].removedRunners.push(...staleInvalid.map((r: { label?: string | null; symbol?: string; timeframe?: string; strategy_preset?: string }) =>
            r.label ?? `${r.symbol ?? "?"} · ${r.strategy_preset ?? "?"} · ${r.timeframe ?? "?"}`,
          ));
        }

        // Remove existing rows whose asset + strategy collides with the new
        // selection, regardless of timeframe/exec. This prevents duplicate
        // BTC/XAU runners across 1m/5m/15m from firing competing entries.
        for (const b of dedupedBuckets) {
          const { data: hits } = await s
            .from(table)
            .select("id, label, symbol, timeframe, strategy_preset")
            .eq("symbol", b.symbol)
            .eq("strategy_preset", b.strategyPreset);
          if (hits && hits.length) {
            await s.from(table).delete().in("id", hits.map((h: { id: string }) => h.id));
            summary[tgt].removed += hits.length;
            summary[tgt].removedRunners.push(...hits.map((h: { label?: string | null; symbol?: string; timeframe?: string; strategy_preset?: string }) =>
              h.label ?? `${h.symbol ?? "?"} · ${h.strategy_preset ?? "?"} · ${h.timeframe ?? "?"}`,
            ));
          }
        }
      }

      for (const b of dedupedBuckets) {
        const src = b.source ?? defaultSource(b.symbol);
        const lev = b.leverage ?? defaultLeverage(b.symbol);
        // Expand pinned window (start..end IST) into an hours list; overrides hoursIst.
        let hoursList = b.hoursIst;
        let windowLabel = "";
        if (b.windowStartHourIst != null && b.windowEndHourIst != null) {
          const start = b.windowStartHourIst;
          const end = b.windowEndHourIst;
          const list: number[] = [];
          if (end > start) for (let h = start; h < end; h++) list.push(h);
          else { for (let h = start; h < 24; h++) list.push(h); for (let h = 0; h < end; h++) list.push(h); }
          hoursList = list;
          windowLabel = `${String(start).padStart(2, "0")}:00→${String(end).padStart(2, "0")}:00 IST`;
        }
        // Validate direction against preset compatibility. Auto-remap
        // long-only ↔ short-only preset pairs when the user picked the
        // opposite side (e.g. liquidity_sweep_long + short → _short variant).
        const dirRaw = (b.direction ?? "both").toLowerCase();
        const dir: "long" | "short" | "both" =
          dirRaw === "long" || dirRaw === "short" ? dirRaw : "both";
        let presetId = b.strategyPreset;
        let conflict = presetDirectionConflict(presetId, dir);
        if (conflict) {
          const swapped = presetId.endsWith("_long") && dir === "short"
            ? presetId.replace(/_long$/, "_short")
            : presetId.endsWith("_short") && dir === "long"
              ? presetId.replace(/_short$/, "_long")
              : null;
          if (swapped && validStrategies.has(swapped)) {
            presetId = swapped;
            conflict = presetDirectionConflict(presetId, dir);
          }
        }
        if (conflict) {
          summary.skipped.push({ label: b.label, reason: conflict });
          continue;
        }

        const contextBits: string[] = [];
        if (windowLabel) contextBits.push(windowLabel);
        else if (hoursList?.length) contextBits.push(`hrs ${hoursList.join(",")}`);
        if (b.weekdays?.length) contextBits.push(`wk ${b.weekdays.join(",")}`);
        if (b.sessions?.length) contextBits.push(b.sessions.join("/"));
        contextBits.push(dir);
        const label = `${b.symbol} · ${presetId} · ${b.timeframe}${contextBits.length ? " · " + contextBits.join(" · ") : ""}${tgt === "live" ? " (live)" : ""}`;

        const row: Record<string, unknown> = {
          label,
          source: src,
          symbol: b.symbol,
          timeframe: b.timeframe,
          strategy_preset: presetId,
          exec_preset: b.execPreset,
          risk_usd: b.riskUsd,
          lookback_days: b.lookbackDays,
          running: false,
          direction_filter: dir,
          window_start_hour_ist: b.windowStartHourIst ?? null,
          window_end_hour_ist: b.windowEndHourIst ?? null,
          weekdays_ist: b.weekdays && b.weekdays.length > 0 ? b.weekdays : null,
        };
        if (tgt === "live") row.leverage = lev;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await s.from(table).insert(row as any);
        if (error) throw new Error(`${tgt} insert failed for ${label}: ${error.message}`);
        summary[tgt].inserted += 1;
        summary[tgt].runners.push(label);
      }
    }

    return summary;
  });


