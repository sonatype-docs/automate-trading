// Server functions for Time Edge Discovery — grounded, deterministic insights.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { STRATEGY_PRESETS } from "@/lib/strategy-engine/presets";
import { requireAuth } from "@/lib/auth-middleware";

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
  .middleware([requireAuth])
  .inputValidator((input: unknown) => NarrativeInput.parse(input))
  .handler(async ({ data }) => {
    const top = data.robustnessTop.slice(0, 3);
    const hidden = data.hiddenEdges.slice(0, 3);
    const warnings = data.warnings.slice(0, 3);
    const line = (b: z.infer<typeof BucketSummary>) =>
      `- ${b.label}: expectancy ${b.expectancy.toFixed(2)}, PF ${b.profitFactor.toFixed(2)}, WR ${(b.winRate * 100).toFixed(1)}%, ${b.trades} trades.`;
    const narrative = [
      `## Headline Findings\nThe dataset contains ${data.totalTrades.toLocaleString()} trades across ${data.symbols.length} symbols. The strongest robust windows are:`,
      ...(top.length ? top.map(line) : ["- No robust windows were identified in the supplied results."]),
      `\n## Hidden Edges\n${hidden.length ? hidden.map(line).join("\n") : "No hidden edge passed the supplied filters."}`,
      `\n## Risk Warnings\n${warnings.length ? warnings.map(line).join("\n") : "No loss-generating windows were supplied."}`,
      `\n## Deployment Recommendation\nKeep live trading disabled while validating these windows in paper mode. Prefer the robust windows, investigate hidden edges with out-of-sample testing, and exclude warning windows until they are explained.${data.clusterSummary ? `\n\nTime clusters: ${data.clusterSummary}` : ""}`,
    ].join("\n");
    return { narrative };
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
  /** Optional Lab-tuned strategy overrides (zones, buffers, entry, stops, filters).
   *  Deep-merged onto the preset in the live tick. */
  configOverrides: z.record(z.string(), z.unknown()).optional(),
});
const DeployInput = z.object({
  target: z.enum(["live", "paper", "both"]),
  buckets: z.array(DeployBucket).min(1).max(50),
  replaceExisting: z.boolean().default(true),
});

function normalDirection(direction?: string): "long" | "short" | "both" {
  const dir = (direction ?? "both").toLowerCase();
  return dir === "long" || dir === "short" ? dir : "both";
}

function siblingPresetIds(preset: string): string[] {
  const ids = new Set([preset]);
  if (preset.endsWith("_long")) ids.add(preset.replace(/_long$/, "_short"));
  if (preset.endsWith("_short")) ids.add(preset.replace(/_short$/, "_long"));
  return Array.from(ids);
}

function normalizeList(values?: Array<string | number>): string {
  if (!values?.length) return "*";
  return [...values].map(String).sort().join(",");
}

function runnerKey(b: z.infer<typeof DeployBucket>, presetId = b.strategyPreset): string {
  const dir = normalDirection(b.direction);
  return [
    b.symbol.toUpperCase(),
    presetId,
    dir,
    b.timeframe,
    b.windowStartHourIst ?? "*",
    b.windowEndHourIst ?? "*",
    normalizeList(b.weekdays),
    normalizeList(b.sessions),
  ].join("|");
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
  .middleware([requireAuth])
  .inputValidator((raw) => DeployInput.parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/lib/db-admin.server");
    const { presetDirectionConflict } = await import("@/lib/session-windows");
    const s = supabaseAdmin;
    const validStrategies = new Set(Object.keys(STRATEGY_PRESETS));
    const invalid = data.buckets.find((b) => !validStrategies.has(b.strategyPreset));
    if (invalid) {
      throw new Error(`${invalid.strategyPreset} is not registered as a live strategy. Pick a supported preset before deploying.`);
    }

    const preparedBuckets: Array<z.infer<typeof DeployBucket> & { presetId: string; dir: "long" | "short" | "both" }> = [];
    const seen = new Set<string>();
    const duplicateCountByKey = new Map<string, number>();
    for (const b of data.buckets) {
      const dir = normalDirection(b.direction);
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
        preparedBuckets.push({ ...b, presetId, dir });
        continue;
      }

      const key = runnerKey(b, presetId);
      if (seen.has(key)) {
        duplicateCountByKey.set(key, (duplicateCountByKey.get(key) ?? 0) + 1);
        continue;
      }
      seen.add(key);
      preparedBuckets.push({ ...b, presetId, dir });
    }

    const targets: Array<"live" | "paper"> =
      data.target === "both" ? ["live", "paper"] : [data.target];

    const summary = {
      live: { removed: 0, inserted: 0, runners: [] as string[], removedRunners: [] as string[] },
      paper: { removed: 0, inserted: 0, runners: [] as string[], removedRunners: [] as string[] },
      skipped: [] as Array<{ label: string; reason: string }>,
    };

    for (const [key, count] of duplicateCountByKey) {
      const [symbol, preset, direction, timeframe, start, end] = key.split("|");
      summary.skipped.push({
        label: `${symbol} · ${preset} · ${direction} · ${timeframe} · ${start}→${end}`,
        reason: `exact duplicate runner collapsed (${count} extra)`,
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

        // Remove existing rows once per asset + strategy-family before the
        // new set is inserted. New selections are de-duped only by exact
        // runner config, so multiple distinct time windows no longer collapse
        // into a single BTC/XAU runner.
        const deleteKeys = new Set<string>();
        for (const b of preparedBuckets) {
          const variants = siblingPresetIds(b.presetId).filter((id) => validStrategies.has(id));
          const deleteKey = `${b.symbol.toUpperCase()}|${variants.sort().join(",")}`;
          if (deleteKeys.has(deleteKey)) continue;
          deleteKeys.add(deleteKey);
          const { data: hits } = await s
            .from(table)
            .select("id, label, symbol, timeframe, strategy_preset")
            .eq("symbol", b.symbol)
            .in("strategy_preset", variants);
          if (hits && hits.length) {
            await s.from(table).delete().in("id", hits.map((h: { id: string }) => h.id));
            summary[tgt].removed += hits.length;
            summary[tgt].removedRunners.push(...hits.map((h: { label?: string | null; symbol?: string; timeframe?: string; strategy_preset?: string }) =>
              h.label ?? `${h.symbol ?? "?"} · ${h.strategy_preset ?? "?"} · ${h.timeframe ?? "?"}`,
            ));
          }
        }
      }

      for (const b of preparedBuckets) {
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
        const dir = b.dir;
        const presetId = b.presetId;
        const conflict = presetDirectionConflict(presetId, dir);
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
          config_overrides: b.configOverrides ?? null,
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


