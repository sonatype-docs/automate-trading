import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  StrategyPageShell,
  ResultCard,
} from "@/components/backtest-strategy-shell";
import { runUniversalStrategy, type RunStrategyResult } from "@/lib/strategy-engine.functions";
import { STRATEGY_PRESETS } from "@/lib/strategy-engine/presets";
import type { Timeframe } from "@/lib/market-data/types";

export const Route = createFileRoute("/backtest/pdh-pdl-sweep")({
  component: PdhPdlPage,
  head: () => ({
    meta: [
      { title: "PDH / PDL Sweep — Backtest" },
      {
        name: "description",
        content:
          "Customize and backtest the PDH/PDL liquidity sweep strategy: buffer, pullback, RR, break-even, trail, daily cap.",
      },
      { property: "og:title", content: "PDH / PDL Sweep — Backtest" },
      { property: "og:description", content: "Tune and backtest the PDH/PDL liquidity sweep strategy in isolation." },
    ],
  }),
});

const TFS: Timeframe[] = ["1m", "3m", "5m", "15m", "30m", "1h"];

function PdhPdlPage() {
  const run = useServerFn(runUniversalStrategy);
  const [form, setForm] = useState({
    symbol: "XAUUSDT",
    source: "yahoo" as "yahoo" | "shark",
    timeframe: "5m" as Timeframe,
    days: 60,
    breakBufferPct: 0.02,
    slBufferPct: 0.02,
    pullbackPct: 0.02,
    rr: 4,
    breakEvenAtR: 1,
    trailAfterR: 2,
    trailStepR: 0.5,
    maxDailyTrades: 2,
    maxAttemptsPerSweep: 1,
    riskUsd: 10,
    requireClose: true,
    minBodyPct: 35,
    expiryBars: 3,
    direction: "both" as "long" | "short" | "both",
    blockWeekend: true,
  });
  const [data, setData] = useState<RunStrategyResult | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      const toMs = Date.now();
      const fromMs = toMs - form.days * 86_400_000;
      return await run({
        data: {
          source: form.source,
          symbol: form.symbol,
          timeframe: form.timeframe,
          displayTimezone: "IST",
          strategyTimezone: "London",
          fromMs,
          toMs,
          presetId: "pdh_pdl_sweep_1m",
          mode: "historical",
          configOverrides: {
            direction: form.direction,
            session: { blockWeekend: form.blockWeekend },
            setup: { kind: "pdh_pdl_sweep", breakBufferPct: form.breakBufferPct },
            confirmation: { requireClose: form.requireClose, minBodyPct: form.minBodyPct },
            entry: { model: { kind: "limit", pullbackPct: form.pullbackPct }, expiryBars: form.expiryBars },
            stop: { kind: "sweep_extreme", bufferPct: form.slBufferPct },
            targets: {
              legs: [{ kind: "rr", value: form.rr, sizePct: 100 }],
              moveToBreakEvenAtR: form.breakEvenAtR,
              trailAfterR: form.trailAfterR,
              trailStepR: form.trailStepR,
            },
            management: { maxDailyTrades: form.maxDailyTrades, maxAttemptsPerSweep: form.maxAttemptsPerSweep },
            risk: { riskPerTradeUsd: form.riskUsd },
          },
        },
      });
    },
    onSuccess: (r) => {
      setData(r);
      toast.success(`${r.result.stats.signalsCreated} signals from ${r.result.stats.setupsDetected} setups`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const rejects = useMemo(
    () => data ? Object.entries(data.result.stats.filterRejects).sort((a, b) => b[1] - a[1]) : [],
    [data],
  );

  const preset = STRATEGY_PRESETS["pdh_pdl_sweep_1m"];

  return (
    <StrategyPageShell
      title="PDH / PDL Sweep"
      subtitle="Sweep of previous-day high/low with body-back-inside confirmation · isolated backtest with full parameter control"
    >
      <ResultCard title="Parameters">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Symbol">
            <select value={form.symbol} onChange={(e) => set("symbol", e.target.value)}
              className="h-8 w-full rounded border border-input bg-background px-2 font-mono text-xs">
              <option value="XAUUSDT">XAUUSDT</option>
              <option value="BTCUSDT">BTCUSDT</option>
              <option value="ETHUSDT">ETHUSDT</option>
            </select>
          </Field>
          <Field label="Source">
            <select value={form.source} onChange={(e) => set("source", e.target.value as "yahoo" | "shark")}
              className="h-8 w-full rounded border border-input bg-background px-2 font-mono text-xs">
              <option value="yahoo">Yahoo</option>
              <option value="shark">Shark</option>
            </select>
          </Field>
          <Field label="Timeframe">
            <select value={form.timeframe} onChange={(e) => set("timeframe", e.target.value as Timeframe)}
              className="h-8 w-full rounded border border-input bg-background px-2 font-mono text-xs">
              {TFS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Days back">
            <Input type="number" value={form.days}
              onChange={(e) => set("days", Math.max(7, Math.min(720, Number(e.target.value) || 60)))}
              className="h-8 font-mono text-xs" />
          </Field>

          <Field label="Direction">
            <select value={form.direction} onChange={(e) => set("direction", e.target.value as typeof form.direction)}
              className="h-8 w-full rounded border border-input bg-background px-2 font-mono text-xs">
              <option value="both">Both</option>
              <option value="long">Long only</option>
              <option value="short">Short only</option>
            </select>
          </Field>
          <Field label="Break buffer %">
            <Input type="number" step="0.01" value={form.breakBufferPct}
              onChange={(e) => set("breakBufferPct", Math.max(0, Number(e.target.value) || 0))}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="SL buffer %">
            <Input type="number" step="0.01" value={form.slBufferPct}
              onChange={(e) => set("slBufferPct", Math.max(0, Number(e.target.value) || 0))}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="Pullback %">
            <Input type="number" step="0.01" value={form.pullbackPct}
              onChange={(e) => set("pullbackPct", Math.max(0, Number(e.target.value) || 0))}
              className="h-8 font-mono text-xs" />
          </Field>

          <Field label="RR">
            <Input type="number" step="0.1" value={form.rr}
              onChange={(e) => set("rr", Math.max(0.5, Number(e.target.value) || 4))}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="Break-even @ R">
            <Input type="number" step="0.1" value={form.breakEvenAtR}
              onChange={(e) => set("breakEvenAtR", Math.max(0, Number(e.target.value) || 0))}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="Trail after R">
            <Input type="number" step="0.1" value={form.trailAfterR}
              onChange={(e) => set("trailAfterR", Math.max(0, Number(e.target.value) || 0))}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="Trail step R">
            <Input type="number" step="0.1" value={form.trailStepR}
              onChange={(e) => set("trailStepR", Math.max(0, Number(e.target.value) || 0))}
              className="h-8 font-mono text-xs" />
          </Field>

          <Field label="Max daily trades">
            <Input type="number" value={form.maxDailyTrades}
              onChange={(e) => set("maxDailyTrades", Math.max(1, Number(e.target.value) || 1))}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="Attempts per sweep">
            <Input type="number" value={form.maxAttemptsPerSweep}
              onChange={(e) => set("maxAttemptsPerSweep", Math.max(1, Number(e.target.value) || 1))}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="Risk $ / trade">
            <Input type="number" value={form.riskUsd}
              onChange={(e) => set("riskUsd", Math.max(1, Number(e.target.value) || 10))}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="Entry expiry (bars)">
            <Input type="number" value={form.expiryBars}
              onChange={(e) => set("expiryBars", Math.max(1, Number(e.target.value) || 3))}
              className="h-8 font-mono text-xs" />
          </Field>

          <Field label="Require close inside">
            <select value={form.requireClose ? "y" : "n"}
              onChange={(e) => set("requireClose", e.target.value === "y")}
              className="h-8 w-full rounded border border-input bg-background px-2 font-mono text-xs">
              <option value="y">Yes</option>
              <option value="n">No</option>
            </select>
          </Field>
          <Field label="Min body %">
            <Input type="number" value={form.minBodyPct}
              onChange={(e) => set("minBodyPct", Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="Block weekend">
            <select value={form.blockWeekend ? "y" : "n"}
              onChange={(e) => set("blockWeekend", e.target.value === "y")}
              className="h-8 w-full rounded border border-input bg-background px-2 font-mono text-xs">
              <option value="y">Yes</option>
              <option value="n">No</option>
            </select>
          </Field>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Button size="sm" onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? "Running…" : "Run backtest"}
          </Button>
          {data && (
            <span className="text-xs text-muted-foreground font-mono">
              {data.barsIn.toLocaleString()} bars · {data.result.stats.setupsDetected} setups · {data.result.stats.signalsCreated} signals
            </span>
          )}
        </div>
      </ResultCard>

      {data && (
        <ResultCard title="Stats">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="Bars" value={data.result.stats.barsProcessed.toLocaleString()} />
            <Stat label="Setups" value={data.result.stats.setupsDetected.toLocaleString()} />
            <Stat label="Signals" value={data.result.stats.signalsCreated.toLocaleString()} />
            <Stat label="Invalidated" value={data.result.stats.signalsInvalidated.toLocaleString()} />
            <Stat label="Events" value={data.result.events.length.toLocaleString()} />
          </div>
        </ResultCard>
      )}

      {data && rejects.length > 0 && (
        <ResultCard title="Filter rejects">
          <div className="flex flex-wrap gap-2">
            {rejects.map(([k, v]) => (
              <Badge key={k} variant="outline" className="font-mono text-[10px]">
                {k}: {v}
              </Badge>
            ))}
          </div>
        </ResultCard>
      )}

      {data && data.result.signals.length > 0 && (
        <ResultCard title={`Signals (${data.result.signals.length})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] font-mono">
              <thead>
                <tr className="text-left border-b text-muted-foreground">
                  <th className="py-1 pr-3">Time</th>
                  <th className="py-1 pr-3">Dir</th>
                  <th className="py-1 pr-3">Entry</th>
                  <th className="py-1 pr-3">SL</th>
                  <th className="py-1 pr-3">TP</th>
                  <th className="py-1 pr-3">RR</th>
                  <th className="py-1 pr-3">Strength</th>
                </tr>
              </thead>
              <tbody>
                {data.result.signals.slice(-200).reverse().map((s, i) => (
                  <tr key={i} className="border-b border-border/30">
                    <td className="py-1 pr-3">{new Date(s.timestamp).toISOString().replace("T", " ").slice(0, 16)}</td>
                    <td className={`py-1 pr-3 ${s.direction === "long" ? "text-emerald-500" : "text-red-500"}`}>{s.direction}</td>
                    <td className="py-1 pr-3">{s.entryPrice.toFixed(2)}</td>
                    <td className="py-1 pr-3">{s.stopLoss.toFixed(2)}</td>
                    <td className="py-1 pr-3">{s.takeProfit.toFixed(2)}</td>
                    <td className="py-1 pr-3">{s.rr.toFixed(2)}</td>
                    <td className="py-1 pr-3">{s.signalStrength.toFixed(0)}</td>
                  </tr>

                ))}
              </tbody>
            </table>
          </div>
        </ResultCard>
      )}

      <ResultCard title="Base preset (pdh_pdl_sweep_1m)">
        <pre className="text-[10px] font-mono bg-muted/40 rounded-md p-3 overflow-x-auto">
{JSON.stringify(preset, null, 2)}
        </pre>
      </ResultCard>
    </StrategyPageShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/50 bg-muted/20 p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-sm">{value}</div>
    </div>
  );
}
