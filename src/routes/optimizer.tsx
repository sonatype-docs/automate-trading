import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip as RTooltip,
  XAxis, YAxis, ScatterChart, Scatter, ZAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Download, Play, Sparkles, Zap } from "lucide-react";
import { queryTrades } from "@/lib/trade-intelligence.functions";
import type { TradeRecord } from "@/lib/trade-intelligence/types";
import type {
  ObjectiveKey, ObjectiveSpec, ParamDim, SearchMethod, OptimizationResult,
} from "@/lib/optimizer/types";
import { walkForward } from "@/lib/optimizer/walk-forward";
import { monteCarlo } from "@/lib/optimizer/monte-carlo";
import { buildHeatmap, type HeatmapMetric } from "@/lib/optimizer/heatmap";
import { featureImportance } from "@/lib/optimizer/feature-importance";
import { kmeans } from "@/lib/optimizer/clustering";
import { regimeReport } from "@/lib/optimizer/regime";
import { discoverRules } from "@/lib/optimizer/filter-discovery";
import { recommend } from "@/lib/optimizer/recommendations";
import { computeMetrics } from "@/lib/optimizer/objectives";
import { extractFeatures, allNumericKeys, allCategoricalKeys } from "@/lib/optimizer/dimensions";
import { topToCsv, toJson, toMarkdown } from "@/lib/optimizer/report";
import { candidateToRule, ruleToPredicate } from "@/lib/optimizer/filters";
import { TimeEdgePanel } from "@/components/time-edge/time-edge-panel";
import { getComputeArtifactUrl, getComputeJob, submitOptimizerSearchJob } from "@/lib/compute.functions";
import { PageFrame, PageHero } from "@/components/page-frame";
import { QuantResearchPanel } from "@/components/quant-research/quant-research-panel";

export const Route = createFileRoute("/optimizer")({
  head: () => ({
    meta: [
      { title: "Universal Research Optimizer — Quant Platform" },
      { name: "description", content: "Discover statistically significant trading edges: grid, random, GA, PSO, SA, walk-forward, Monte Carlo, feature importance, clustering, regime discovery." },
    ],
  }),
  component: OptimizerPage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-destructive">
      Error: {error instanceof Error ? error.message : String(error)}
    </div>
  ),
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

const OBJECTIVE_OPTIONS: { key: ObjectiveKey; label: string }[] = [
  { key: "net_profit", label: "Net Profit" },
  { key: "profit_factor", label: "Profit Factor" },
  { key: "expectancy", label: "Expectancy" },
  { key: "sharpe", label: "Sharpe" },
  { key: "sortino", label: "Sortino" },
  { key: "calmar", label: "Calmar" },
  { key: "recovery_factor", label: "Recovery Factor" },
  { key: "max_drawdown_neg", label: "Minimize Max Drawdown" },
  { key: "win_rate", label: "Win Rate" },
  { key: "avg_rr", label: "Average RR" },
  { key: "risk_adjusted_return", label: "Risk-Adjusted Return" },
  { key: "ulcer_index_neg", label: "Minimize Ulcer Index" },
  { key: "custom", label: "Custom Formula" },
];

const METHODS: { key: SearchMethod; label: string }[] = [
  { key: "grid", label: "Grid Search" },
  { key: "random", label: "Random Search" },
  { key: "genetic", label: "Genetic Algorithm" },
  { key: "bayesian", label: "Bayesian (light)" },
  { key: "pso", label: "Particle Swarm" },
  { key: "annealing", label: "Simulated Annealing" },
];

function download(name: string, body: string, mime: string) {
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function OptimizerPage() {
  const qFn = useServerFn(queryTrades);
  const [limit, setLimit] = useState(2000);
  const [strategyId, setStrategyId] = useState("");
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["optimizer-trades", limit, strategyId],
    queryFn: () => qFn({ data: { limit, strategyId: strategyId || undefined, orderBy: "exit_time", order: "desc" } }),
  });
  const rows: TradeRecord[] = data?.rows ?? [];
  const total = data?.total ?? 0;
  const baseMetrics = useMemo(() => computeMetrics(rows), [rows]);

  return (
    <PageFrame>
      <PageHero eyebrow="Quant research workspace" title="Universal Research Optimizer" description="Discover when, where, and why the strategy performs best using the Trade Intelligence Database." actions={
        <>
          <Label className="text-xs text-muted-foreground">Strategy</Label>
          <Input placeholder="all" className="h-8 w-32 sm:w-40" value={strategyId} onChange={(e) => setStrategyId(e.target.value)} />
          <Label className="text-xs text-muted-foreground">Limit</Label>
          <Input type="number" className="h-8 w-20 sm:w-24" value={limit} onChange={(e) => setLimit(Number(e.target.value) || 500)} />
          <Button size="sm" onClick={() => refetch()}>Reload</Button>
        </>
      } />

      <QuantResearchPanel mode="sweep" title="Canonical Quant Sweep" description="Run the embedded Python strategy engine with reproducible risk and slippage parameters before comparing against the legacy optimizer views below." />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <StatCard label="Loaded" value={String(rows.length)} sub={`of ${total}`} />
        <StatCard label="Net P&L" value={`$${baseMetrics.net_profit.toFixed(0)}`} />
        <StatCard label="Win %" value={`${(baseMetrics.win_rate * 100).toFixed(1)}%`} />
        <StatCard label="Profit Factor" value={baseMetrics.profit_factor.toFixed(2)} />
        <StatCard label="Sharpe" value={baseMetrics.sharpe.toFixed(2)} />
        <StatCard label="Max DD" value={`$${baseMetrics.max_drawdown.toFixed(0)}`} />
      </div>

      {isLoading ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">Loading trades…</CardContent></Card>
      ) : rows.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">
          No trades in the Trade Intelligence database yet. Run a backtest from the Trade Intelligence page to populate it.
        </CardContent></Card>
      ) : (
        <Tabs defaultValue="optimize" className="space-y-4">
          <TabsList className="flex flex-wrap gap-1 h-auto w-full justify-start">
            <TabsTrigger value="optimize">Optimization</TabsTrigger>
            <TabsTrigger value="time-edge">Time Edge</TabsTrigger>
            <TabsTrigger value="wf">Walk-Forward</TabsTrigger>
            <TabsTrigger value="mc">Monte Carlo</TabsTrigger>
            <TabsTrigger value="heatmap">Heatmaps</TabsTrigger>
            <TabsTrigger value="importance">Feature Importance</TabsTrigger>
            <TabsTrigger value="clusters">Clusters</TabsTrigger>
            <TabsTrigger value="regime">Regimes</TabsTrigger>
            <TabsTrigger value="rules">Rule Discovery</TabsTrigger>
            <TabsTrigger value="recs">AI Recommendations</TabsTrigger>
          </TabsList>

          <TabsContent value="optimize"><OptimizePanel rows={rows} baseMetrics={baseMetrics} /></TabsContent>
          <TabsContent value="time-edge"><TimeEdgePanel /></TabsContent>
          <TabsContent value="wf"><WalkForwardPanel rows={rows} /></TabsContent>
          <TabsContent value="mc"><MonteCarloPanel rows={rows} /></TabsContent>
          <TabsContent value="heatmap"><HeatmapPanel rows={rows} /></TabsContent>
          <TabsContent value="importance"><ImportancePanel rows={rows} /></TabsContent>
          <TabsContent value="clusters"><ClusterPanel rows={rows} /></TabsContent>
          <TabsContent value="regime"><RegimePanel rows={rows} /></TabsContent>
          <TabsContent value="rules"><RulePanel rows={rows} /></TabsContent>
          <TabsContent value="recs"><RecsPanel rows={rows} /></TabsContent>
        </Tabs>
      )}
    </PageFrame>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card><CardContent className="p-3">
      <div className="text-[11px] uppercase text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </CardContent></Card>
  );
}

// ---------------- Optimize panel ----------------
function OptimizePanel({ rows, baseMetrics }: { rows: TradeRecord[]; baseMetrics: ReturnType<typeof computeMetrics> }) {
  const fv = useMemo(() => rows.map(extractFeatures), [rows]);
  const numericKeys = useMemo(() => allNumericKeys(fv), [fv]);
  const categoricalKeys = useMemo(() => allCategoricalKeys(fv), [fv]);
  const [method, setMethod] = useState<SearchMethod>("random");
  const [objectiveKey, setObjectiveKey] = useState<ObjectiveKey>("expectancy");
  const [formula, setFormula] = useState("net_profit / (max_drawdown + 1)");
  const [minTrades, setMinTrades] = useState(20);
  const [budget, setBudget] = useState(400);
  const [selectedNumeric, setSelectedNumeric] = useState<string[]>(numericKeys.slice(0, 3));
  const [selectedCat, setSelectedCat] = useState<string[]>(categoricalKeys.slice(0, 2));
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [runError, setRunError] = useState<string | null>(null);
  const submitSearch = useServerFn(submitOptimizerSearchJob);
  const getSearchJob = useServerFn(getComputeJob);
  const getSearchArtifact = useServerFn(getComputeArtifactUrl);

  const dims: ParamDim[] = useMemo(() => {
    const out: ParamDim[] = [];
    for (const k of selectedNumeric) {
      const values = fv.map((f) => f.numeric[k] ?? 0).filter(Number.isFinite);
      if (!values.length) continue;
      const min = Math.min(...values), max = Math.max(...values);
      out.push({ kind: "numeric", id: k, label: k, min, max, step: (max - min) / 8 });
    }
    for (const k of selectedCat) {
      const uniq = Array.from(new Set(fv.map((f) => f.categorical[k] ?? "unknown")));
      out.push({ kind: "categorical", id: k, label: k, values: uniq });
    }
    return out;
  }, [fv, selectedNumeric, selectedCat]);

  const run = async () => {
    setRunning(true); setProgress(0);
    setRunError(null);
    try {
      const spec: ObjectiveSpec = { key: objectiveKey, formula: objectiveKey === "custom" ? formula : undefined, minTrades };
      const queued = await submitSearch({
        data: {
          rows: rows as unknown as Record<string, unknown>[],
          method,
          dims: dims as unknown as Record<string, unknown>[],
          objective: spec,
          budget,
        },
      });
      setProgress(10);
      for (let attempt = 0; attempt < 1_200; attempt += 1) {
        const job = await getSearchJob({ data: { job_id: queued.job_id } });
        if (job.status === "failed") throw new Error(job.error || "Optimizer job failed");
        if (job.status === "succeeded") {
          let output = job.result as unknown;
          const artifact = (output as { artifact?: { s3_key?: string } } | null)?.artifact;
          if (artifact?.s3_key) {
            const signed = await getSearchArtifact({ data: { job_id: queued.job_id } });
            const response = await fetch(signed.url);
            if (!response.ok) throw new Error(`Optimizer artifact download failed: ${response.status}`);
            output = await response.json();
          }
          setResult(output as OptimizationResult);
          setProgress(100);
          return;
        }
        setProgress(Math.min(95, 10 + Math.round((attempt / 1200) * 85)));
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      throw new Error("Optimizer job timed out");
    } catch (error) {
      setResult(null);
      setRunError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };

  const originalScore = useMemo(() => {
    const m = baseMetrics as unknown as Record<string, number>;
    return m[objectiveKey === "max_drawdown_neg" ? "max_drawdown" : objectiveKey === "ulcer_index_neg" ? "ulcer_index" : objectiveKey] ?? 0;
  }, [baseMetrics, objectiveKey]);

  return (
    <div className="grid gap-4 md:grid-cols-[380px_1fr]">
      <Card>
        <CardHeader><CardTitle className="text-base">Search Configuration</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Method</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as SearchMethod)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{METHODS.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Objective</Label>
            <Select value={objectiveKey} onValueChange={(v) => setObjectiveKey(v as ObjectiveKey)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{OBJECTIVE_OPTIONS.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {objectiveKey === "custom" && (
            <div>
              <Label>Custom formula</Label>
              <Input value={formula} onChange={(e) => setFormula(e.target.value)} placeholder="net_profit / (max_drawdown + 1)" />
              <p className="mt-1 text-[11px] text-muted-foreground">Vars: net_profit, profit_factor, expectancy, sharpe, sortino, calmar, max_drawdown, win_rate, avg_rr, ulcer_index, recovery_factor, trades.</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Budget</Label>
              <Input type="number" value={budget} onChange={(e) => setBudget(Number(e.target.value) || 100)} />
            </div>
            <div>
              <Label>Min trades</Label>
              <Input type="number" value={minTrades} onChange={(e) => setMinTrades(Number(e.target.value) || 1)} />
            </div>
          </div>
          <div>
            <Label>Numeric dimensions</Label>
            <MultiSelect items={numericKeys} value={selectedNumeric} onChange={setSelectedNumeric} />
          </div>
          <div>
            <Label>Categorical dimensions</Label>
            <MultiSelect items={categoricalKeys} value={selectedCat} onChange={setSelectedCat} />
          </div>
          <Button onClick={run} disabled={running || dims.length === 0} className="w-full">
            <Play className="mr-2 h-4 w-4" /> {running ? `Running… ${progress}%` : "Run Optimization"}
          </Button>
        </CardContent>
      </Card>

      {runError && <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{runError}</div>}

      <div className="space-y-4">
        {result && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4" /> Best Candidate
                </CardTitle>
                <CardDescription>
                  Score {result.best?.score.toFixed(4)} · vs original {Number(originalScore).toFixed(4)} · {result.evaluated} evaluated in {result.elapsedMs} ms
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-2 flex flex-wrap gap-1">
                  {result.best && Object.entries(result.best.candidate).map(([k, v]) => (
                    <Badge key={k} variant="outline">{k}: {String(v)}</Badge>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                  {result.best && Object.entries(result.best.metrics).slice(0, 12).map(([k, v]) => (
                    <div key={k} className="rounded border bg-card px-2 py-1">
                      <div className="text-[10px] uppercase text-muted-foreground">{k}</div>
                      <div className="font-mono">{Number(v).toFixed(3)}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => download("optimizer.json", toJson(result), "application/json")}>
                    <Download className="mr-1 h-4 w-4" /> JSON
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => download("optimizer-top.csv", topToCsv(result.top), "text/csv")}>
                    <Download className="mr-1 h-4 w-4" /> CSV
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => download("optimizer.md", toMarkdown(result), "text/markdown")}>
                    <Download className="mr-1 h-4 w-4" /> Markdown
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Top 25 · Original vs Optimized</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>#</TableHead><TableHead>Score</TableHead><TableHead>Trades</TableHead>
                    <TableHead>Net</TableHead><TableHead>PF</TableHead><TableHead>Win%</TableHead>
                    <TableHead>Sharpe</TableHead><TableHead>Max DD</TableHead><TableHead>Candidate</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {result.top.map((r, i) => (
                      <TableRow key={r.id}>
                        <TableCell>{i + 1}</TableCell>
                        <TableCell className="font-mono">{r.score.toFixed(3)}</TableCell>
                        <TableCell>{r.trades}</TableCell>
                        <TableCell>${(r.metrics.net_profit ?? 0).toFixed(0)}</TableCell>
                        <TableCell>{(r.metrics.profit_factor ?? 0).toFixed(2)}</TableCell>
                        <TableCell>{((r.metrics.win_rate ?? 0) * 100).toFixed(1)}%</TableCell>
                        <TableCell>{(r.metrics.sharpe ?? 0).toFixed(2)}</TableCell>
                        <TableCell>${(r.metrics.max_drawdown ?? 0).toFixed(0)}</TableCell>
                        <TableCell className="text-xs">{Object.entries(r.candidate).map(([k, v]) => `${k}=${v}`).join(", ")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
        {!result && (
          <Card><CardContent className="p-8 text-center text-muted-foreground">Configure a search and press Run.</CardContent></Card>
        )}
      </div>
    </div>
  );
}

function MultiSelect({ items, value, onChange }: { items: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (k: string) => onChange(value.includes(k) ? value.filter((v) => v !== k) : [...value, k]);
  return (
    <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto rounded border p-2">
      {items.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => toggle(k)}
          className={`rounded px-2 py-0.5 text-xs ${value.includes(k) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
        >{k}</button>
      ))}
    </div>
  );
}

// ---------------- Walk-Forward ----------------
function WalkForwardPanel({ rows }: { rows: TradeRecord[] }) {
  const [folds, setFolds] = useState(4);
  const [objectiveKey, setObjectiveKey] = useState<ObjectiveKey>("expectancy");
  const segments = useMemo(() => {
    return walkForward(
      rows,
      // very simple optimizer: keep best categorical session
      (train) => {
        const bySession = new Map<string, TradeRecord[]>();
        for (const t of train) {
          const s = t.session ?? "unknown";
          const arr = bySession.get(s) ?? []; arr.push(t); bySession.set(s, arr);
        }
        let best = "unknown", bestVal = -Infinity;
        for (const [s, arr] of bySession) {
          const m = computeMetrics(arr);
          const v = (m as unknown as Record<string, number>)[objectiveKey] ?? m.net_profit;
          if (v > bestVal) { bestVal = v; best = s; }
        }
        const rule = candidateToRule({ session: best }, [{ kind: "categorical", id: "session", label: "session", values: [] }]);
        return ruleToPredicate(rule);
      },
      { key: objectiveKey },
      folds,
    );
  }, [rows, folds, objectiveKey]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Walk-Forward Validation</CardTitle>
        <CardDescription>Optimize on train fold, score on out-of-sample test fold.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-end gap-3">
          <div><Label>Folds</Label><Input type="number" value={folds} onChange={(e) => setFolds(Math.max(2, Number(e.target.value) || 4))} className="w-24" /></div>
          <div><Label>Objective</Label>
            <Select value={objectiveKey} onValueChange={(v) => setObjectiveKey(v as ObjectiveKey)}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>{OBJECTIVE_OPTIONS.filter((o) => o.key !== "custom").map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Fold</TableHead><TableHead>Train range</TableHead><TableHead>Test range</TableHead>
            <TableHead>Train score</TableHead><TableHead>Test score</TableHead>
            <TableHead>Train / Test trades</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {segments.map((s) => (
              <TableRow key={s.index}>
                <TableCell>{s.index}</TableCell>
                <TableCell className="text-xs">{new Date(s.trainStart).toLocaleDateString()} → {new Date(s.trainEnd).toLocaleDateString()}</TableCell>
                <TableCell className="text-xs">{new Date(s.testStart).toLocaleDateString()} → {new Date(s.testEnd).toLocaleDateString()}</TableCell>
                <TableCell className="font-mono">{s.trainScore.toFixed(3)}</TableCell>
                <TableCell className={`font-mono ${s.testScore > 0 ? "text-emerald-500" : "text-destructive"}`}>{s.testScore.toFixed(3)}</TableCell>
                <TableCell>{s.trainTrades} / {s.testTrades}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {segments.length === 0 && <div className="text-sm text-muted-foreground">Not enough trades for {folds} folds.</div>}
      </CardContent>
    </Card>
  );
}

// ---------------- Monte Carlo ----------------
function MonteCarloPanel({ rows }: { rows: TradeRecord[] }) {
  const [runs, setRuns] = useState(1000);
  const [initial, setInitial] = useState(10000);
  const [ruinFrac, setRuinFrac] = useState(0.5);
  const result = useMemo(() => monteCarlo(rows, { runs, initialEquity: initial, ruinFractionOfInitial: ruinFrac }), [rows, runs, initial, ruinFrac]);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Monte Carlo Simulation</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div><Label>Runs</Label>
            <Select value={String(runs)} onValueChange={(v) => setRuns(Number(v))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>{[100, 500, 1000, 5000, 10000].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Initial equity</Label><Input type="number" value={initial} onChange={(e) => setInitial(Number(e.target.value) || 10000)} className="w-32" /></div>
          <div><Label>Ruin @ DD frac</Label><Input type="number" step="0.05" value={ruinFrac} onChange={(e) => setRuinFrac(Number(e.target.value) || 0.5)} className="w-32" /></div>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <StatCard label="Expected Net" value={`$${result.expectedNet.toFixed(0)}`} />
          <StatCard label="CI 5% / 50% / 95%" value={`${result.ci05.toFixed(0)} / ${result.ci50.toFixed(0)} / ${result.ci95.toFixed(0)}`} />
          <StatCard label="Worst Net" value={`$${result.worstNet.toFixed(0)}`} />
          <StatCard label="Best Net" value={`$${result.bestNet.toFixed(0)}`} />
          <StatCard label="Expected Max DD" value={`$${result.expectedMaxDd.toFixed(0)}`} />
          <StatCard label="Worst Max DD" value={`$${result.worstMaxDd.toFixed(0)}`} />
          <StatCard label="Prob of Ruin" value={`${(result.probRuin * 100).toFixed(1)}%`} />
          <StatCard label="Exp. Win/Loss Streak" value={`${result.expectedWinStreak.toFixed(1)} / ${result.expectedLossStreak.toFixed(1)}`} />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------- Heatmap ----------------
function HeatmapPanel({ rows }: { rows: TradeRecord[] }) {
  const fv = useMemo(() => rows.map(extractFeatures), [rows]);
  const numKeys = allNumericKeys(fv);
  const catKeys = allCategoricalKeys(fv);
  const allDims = [...numKeys, ...catKeys];
  const [xDim, setXDim] = useState<string>(allDims[0] ?? "hour");
  const [yDim, setYDim] = useState<string>(allDims[1] ?? "weekday");
  const [metric, setMetric] = useState<HeatmapMetric>("net_profit");
  const isNumericX = numKeys.includes(xDim);
  const isNumericY = numKeys.includes(yDim);
  const bins = (key: string) => {
    const values = fv.map((f) => f.numeric[key] ?? NaN).filter(Number.isFinite);
    if (!values.length) return undefined;
    const min = Math.min(...values), max = Math.max(...values);
    const step = (max - min) / 6;
    return Array.from({ length: 7 }, (_, i) => Number((min + i * step).toFixed(2)));
  };
  const heat = useMemo(() => buildHeatmap(rows, xDim, yDim, metric, isNumericX ? bins(xDim) : undefined, isNumericY ? bins(yDim) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, xDim, yDim, metric]);
  const color = (v: number) => {
    if (heat.max === heat.min) return "hsl(220 15% 30%)";
    const t = (v - heat.min) / (heat.max - heat.min);
    const hue = t * 130; // red→green
    return `hsl(${hue} 65% ${45 - t * 15}%)`;
  };
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Interactive Heatmap</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div><Label>X</Label>
            <Select value={xDim} onValueChange={setXDim}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>{allDims.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Y</Label>
            <Select value={yDim} onValueChange={setYDim}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>{allDims.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Metric</Label>
            <Select value={metric} onValueChange={(v) => setMetric(v as HeatmapMetric)}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["net_profit", "profit_factor", "expectancy", "win_rate", "sharpe", "max_drawdown", "trades"].map((m) =>
                  <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="overflow-auto">
          <table className="text-xs">
            <thead>
              <tr><th></th>{heat.xLabels.map((x) => <th key={x} className="px-2 py-1 text-muted-foreground">{x}</th>)}</tr>
            </thead>
            <tbody>
              {heat.yLabels.map((y) => (
                <tr key={y}>
                  <td className="pr-2 text-muted-foreground">{y}</td>
                  {heat.xLabels.map((x) => {
                    const c = heat.cells.find((c) => c.x === x && c.y === y);
                    if (!c) return <td key={x} className="border border-border/40 px-2 py-1" />;
                    return (
                      <td key={x} className="border border-border/40 px-2 py-1 text-center" title={`${x} × ${y}: ${c.value.toFixed(2)} (${c.trades} trades)`}
                        style={{ background: color(c.value), color: "white" }}>
                        {c.value.toFixed(1)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------- Feature Importance ----------------
function ImportancePanel({ rows }: { rows: TradeRecord[] }) {
  const ranks = useMemo(() => featureImportance(rows), [rows]);
  const chart = ranks.slice(0, 15).map((r) => ({ name: r.feature, score: Number((r.score * 100).toFixed(1)) }));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Zap className="h-4 w-4" /> Feature Importance</CardTitle>
        <CardDescription>Contribution of each feature to profitability (0–100).</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} layout="vertical" margin={{ left: 80 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" domain={[0, 100]} />
              <YAxis dataKey="name" type="category" width={120} />
              <RTooltip />
              <Bar dataKey="score" fill="hsl(var(--primary))" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <Table className="mt-4">
          <TableHeader><TableRow>
            <TableHead>Feature</TableHead><TableHead>Kind</TableHead><TableHead>Score</TableHead>
            <TableHead>Best slice</TableHead><TableHead>Best mean $</TableHead><TableHead>Worst slice</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {ranks.slice(0, 25).map((r) => (
              <TableRow key={r.feature}>
                <TableCell>{r.feature}</TableCell>
                <TableCell><Badge variant="outline">{r.kind}</Badge></TableCell>
                <TableCell className="font-mono">{(r.score * 100).toFixed(1)}</TableCell>
                <TableCell>{r.bestSlice}</TableCell>
                <TableCell className="text-emerald-500">${r.bestScore.toFixed(1)}</TableCell>
                <TableCell className="text-destructive">{r.worstSlice}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---------------- Clusters ----------------
const CLUSTER_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#a855f7", "#84cc16", "#ec4899"];

function topN(map: Record<string, number>, n = 3): { key: string; count: number; pct: number }[] {
  const total = Object.values(map).reduce((s, v) => s + v, 0) || 1;
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n).map(([key, count]) => ({ key, count, pct: count / total }));
}

function hoursHistogram(indexes: number[], rows: TradeRecord[]): number[] {
  const h = new Array(24).fill(0);
  indexes.forEach((i) => { const t = rows[i]; if (t) h[new Date(t.entryTime).getUTCHours()]++; });
  return h;
}

function ClusterPanel({ rows }: { rows: TradeRecord[] }) {
  const [k, setK] = useState(4);
  const [xAxis, setXAxis] = useState<string>("atr_pct");
  const [yAxis, setYAxis] = useState<string>("adx");
  const [selectedCluster, setSelectedCluster] = useState<number>(0);

  const clusters = useMemo(() => kmeans(rows, k), [rows, k]);
  const featuresList = useMemo(() => rows.map(extractFeatures), [rows]);
  const numericKeys = useMemo(() => allNumericKeys(featuresList), [featuresList]);
  const categoricalKeys = useMemo(() => allCategoricalKeys(featuresList), [featuresList]);

  // Global averages for baseline comparison
  const globalNumericAvg = useMemo(() => {
    const avg: Record<string, number> = {};
    numericKeys.forEach((k) => {
      let sum = 0, n = 0;
      featuresList.forEach((f) => { const v = f.numeric[k]; if (Number.isFinite(v)) { sum += v; n++; } });
      avg[k] = n ? sum / n : 0;
    });
    return avg;
  }, [featuresList, numericKeys]);

  // Enriched cluster stats
  const enriched = useMemo(() => clusters.map((c) => {
    const memberRows = c.members.map((i) => rows[i]);
    const memberFeats = c.members.map((i) => featuresList[i]);
    // categorical distributions
    const cats: Record<string, Record<string, number>> = {};
    categoricalKeys.forEach((k) => (cats[k] = {}));
    memberFeats.forEach((f) => {
      categoricalKeys.forEach((k) => { const v = f.categorical[k] ?? "unknown"; cats[k][v] = (cats[k][v] || 0) + 1; });
    });
    // numeric averages
    const nums: Record<string, number> = {};
    numericKeys.forEach((k) => {
      let s = 0, n = 0;
      memberFeats.forEach((f) => { const v = f.numeric[k]; if (Number.isFinite(v)) { s += v; n++; } });
      nums[k] = n ? s / n : 0;
    });
    // durations, RR, MAE, MFE stats
    const durations = memberRows.map((t) => (t.durationMs ?? 0) / 60000);
    const rrs = memberRows.map((t) => t.actualRr ?? 0);
    const maes = memberRows.map((t) => t.mae ?? 0);
    const mfes = memberRows.map((t) => t.mfe ?? 0);
    const avg = (a: number[]) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
    // cumulative equity
    const sorted = [...memberRows].sort((a, b) => a.exitTime - b.exitTime);
    let eq = 0; const equity: { t: number; eq: number }[] = [];
    sorted.forEach((t) => { eq += t.netPnl; equity.push({ t: t.exitTime, eq }); });
    // hour histogram
    const hourHist = hoursHistogram(c.members, rows);
    // long/short split
    const longs = memberRows.filter((t) => t.direction === "long").length;
    const shorts = memberRows.length - longs;
    // pnl distribution buckets
    const pnls = memberRows.map((t) => t.netPnl).sort((a, b) => a - b);
    const p = (q: number) => pnls.length ? pnls[Math.min(pnls.length - 1, Math.floor(pnls.length * q))] : 0;
    return {
      ...c,
      cats,
      nums,
      avgDuration: avg(durations),
      avgRR: avg(rrs),
      avgMAE: avg(maes),
      avgMFE: avg(mfes),
      equity,
      hourHist,
      longPct: memberRows.length ? longs / memberRows.length : 0,
      shortPct: memberRows.length ? shorts / memberRows.length : 0,
      pnlP10: p(0.1), pnlMedian: p(0.5), pnlP90: p(0.9),
      pctOfAll: rows.length ? c.size / rows.length : 0,
    };
  }), [clusters, rows, featuresList, categoricalKeys, numericKeys]);

  const bestCluster = useMemo(() => enriched.slice().sort((a, b) => b.metrics.expectancy - a.metrics.expectancy)[0], [enriched]);
  const worstCluster = useMemo(() => enriched.slice().sort((a, b) => a.metrics.expectancy - b.metrics.expectancy)[0], [enriched]);
  const detail = enriched[selectedCluster] ?? enriched[0];

  const scatter = useMemo(() => {
    const pts: { x: number; y: number; cluster: number; pnl: number }[] = [];
    clusters.forEach((c) => c.members.forEach((idx) => {
      const f = featuresList[idx];
      pts.push({
        x: f.numeric[xAxis] ?? 0,
        y: f.numeric[yAxis] ?? 0,
        cluster: c.index,
        pnl: rows[idx].netPnl,
      });
    }));
    return pts;
  }, [clusters, rows, featuresList, xAxis, yAxis]);

  const exportCsv = () => {
    const header = ["cluster","size","pct","net","pf","expectancy","win_rate","avg_rr","sharpe","sortino","max_dd","avg_dur_min","avg_mae","avg_mfe","long_pct","top_symbol","top_strategy","top_session","top_direction","top_exit"];
    const rows_ = enriched.map((c) => [
      c.index + 1, c.size, (c.pctOfAll * 100).toFixed(1),
      c.metrics.net_profit.toFixed(2), c.metrics.profit_factor.toFixed(2),
      c.metrics.expectancy.toFixed(2), (c.metrics.win_rate * 100).toFixed(2),
      c.avgRR.toFixed(2), c.metrics.sharpe.toFixed(2), c.metrics.sortino.toFixed(2),
      c.metrics.max_drawdown.toFixed(2), c.avgDuration.toFixed(1),
      c.avgMAE.toFixed(2), c.avgMFE.toFixed(2), (c.longPct * 100).toFixed(1),
      topN(c.cats.symbol || {}, 1)[0]?.key ?? "",
      topN(c.cats.strategy || {}, 1)[0]?.key ?? "",
      topN(c.cats.session || {}, 1)[0]?.key ?? "",
      topN(c.cats.direction || {}, 1)[0]?.key ?? "",
      topN(c.cats.exit_reason || {}, 1)[0]?.key ?? "",
    ]);
    const csv = [header.join(","), ...rows_.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `clusters-k${k}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle className="text-base">Trade Clustering — K-means on standardized feature vectors</CardTitle>
              <CardDescription>Unsupervised grouping of {rows.length.toLocaleString()} trades across {numericKeys.length} numeric + {categoricalKeys.length} categorical dimensions.</CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={exportCsv}><Download className="mr-2 h-3.5 w-3.5" />Export cluster summary CSV</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <Label className="text-xs">K (2–8)</Label>
              <Input type="number" value={k} min={2} max={8} onChange={(e) => setK(Math.max(2, Math.min(8, Number(e.target.value) || 4)))} />
            </div>
            <div>
              <Label className="text-xs">Projection X-axis</Label>
              <Select value={xAxis} onValueChange={setXAxis}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{numericKeys.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Projection Y-axis</Label>
              <Select value={yAxis} onValueChange={setYAxis}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{numericKeys.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Drill-down cluster</Label>
              <Select value={String(selectedCluster)} onValueChange={(v) => setSelectedCluster(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{enriched.map((c) => <SelectItem key={c.index} value={String(c.index)}>Cluster {c.index + 1} ({c.size})</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Best / Worst */}
      {bestCluster && worstCluster && (
        <div className="grid gap-3 md:grid-cols-2">
          <Card className="border-emerald-500/40">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-emerald-500">🏆 Best cluster — #{bestCluster.index + 1}</CardTitle></CardHeader>
            <CardContent className="text-xs space-y-1">
              <div className="font-mono">Net ${bestCluster.metrics.net_profit.toFixed(0)} · PF {bestCluster.metrics.profit_factor.toFixed(2)} · Exp ${bestCluster.metrics.expectancy.toFixed(2)} · Win {(bestCluster.metrics.win_rate * 100).toFixed(1)}%</div>
              <div>Sharpe {bestCluster.metrics.sharpe.toFixed(2)} · Sortino {bestCluster.metrics.sortino.toFixed(2)} · MaxDD ${bestCluster.metrics.max_drawdown.toFixed(0)}</div>
              <div>Top symbol: <span className="font-medium">{topN(bestCluster.cats.symbol || {}, 1)[0]?.key}</span> · Strategy: <span className="font-medium">{topN(bestCluster.cats.strategy || {}, 1)[0]?.key}</span> · Session: <span className="font-medium">{topN(bestCluster.cats.session || {}, 1)[0]?.key}</span></div>
            </CardContent>
          </Card>
          <Card className="border-red-500/40">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-red-500">⚠ Worst cluster — #{worstCluster.index + 1}</CardTitle></CardHeader>
            <CardContent className="text-xs space-y-1">
              <div className="font-mono">Net ${worstCluster.metrics.net_profit.toFixed(0)} · PF {worstCluster.metrics.profit_factor.toFixed(2)} · Exp ${worstCluster.metrics.expectancy.toFixed(2)} · Win {(worstCluster.metrics.win_rate * 100).toFixed(1)}%</div>
              <div>Sharpe {worstCluster.metrics.sharpe.toFixed(2)} · Sortino {worstCluster.metrics.sortino.toFixed(2)} · MaxDD ${worstCluster.metrics.max_drawdown.toFixed(0)}</div>
              <div>Top symbol: <span className="font-medium">{topN(worstCluster.cats.symbol || {}, 1)[0]?.key}</span> · Strategy: <span className="font-medium">{topN(worstCluster.cats.strategy || {}, 1)[0]?.key}</span> · Session: <span className="font-medium">{topN(worstCluster.cats.session || {}, 1)[0]?.key}</span></div>
              <div className="text-red-500/80">Consider blocking or inverting entries matching this cluster's centroid.</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Master summary table */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Cluster performance matrix</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>% of all</TableHead>
                <TableHead>Net $</TableHead>
                <TableHead>PF</TableHead>
                <TableHead>Exp $</TableHead>
                <TableHead>Win %</TableHead>
                <TableHead>Avg RR</TableHead>
                <TableHead>Sharpe</TableHead>
                <TableHead>Sortino</TableHead>
                <TableHead>MaxDD</TableHead>
                <TableHead>Avg Dur (m)</TableHead>
                <TableHead>MAE</TableHead>
                <TableHead>MFE</TableHead>
                <TableHead>Long/Short</TableHead>
                <TableHead>P10 / Med / P90</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {enriched.map((c) => (
                <TableRow key={c.index} className={c.index === selectedCluster ? "bg-primary/5" : ""}>
                  <TableCell><Badge style={{ backgroundColor: CLUSTER_COLORS[c.index], color: "#fff" }}>{c.index + 1}</Badge></TableCell>
                  <TableCell className="font-mono">{c.size}</TableCell>
                  <TableCell className="font-mono">{(c.pctOfAll * 100).toFixed(1)}%</TableCell>
                  <TableCell className={c.metrics.net_profit >= 0 ? "text-emerald-500 font-mono" : "text-red-500 font-mono"}>${c.metrics.net_profit.toFixed(0)}</TableCell>
                  <TableCell className="font-mono">{c.metrics.profit_factor.toFixed(2)}</TableCell>
                  <TableCell className={c.metrics.expectancy >= 0 ? "text-emerald-500 font-mono" : "text-red-500 font-mono"}>${c.metrics.expectancy.toFixed(2)}</TableCell>
                  <TableCell className="font-mono">{(c.metrics.win_rate * 100).toFixed(1)}%</TableCell>
                  <TableCell className="font-mono">{c.avgRR.toFixed(2)}</TableCell>
                  <TableCell className="font-mono">{c.metrics.sharpe.toFixed(2)}</TableCell>
                  <TableCell className="font-mono">{c.metrics.sortino.toFixed(2)}</TableCell>
                  <TableCell className="font-mono text-red-500">${c.metrics.max_drawdown.toFixed(0)}</TableCell>
                  <TableCell className="font-mono">{c.avgDuration.toFixed(0)}</TableCell>
                  <TableCell className="font-mono text-red-500">${c.avgMAE.toFixed(1)}</TableCell>
                  <TableCell className="font-mono text-emerald-500">${c.avgMFE.toFixed(1)}</TableCell>
                  <TableCell className="font-mono text-xs">{(c.longPct * 100).toFixed(0)}/{(c.shortPct * 100).toFixed(0)}%</TableCell>
                  <TableCell className="font-mono text-xs">{c.pnlP10.toFixed(0)}/{c.pnlMedian.toFixed(0)}/{c.pnlP90.toFixed(0)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Two-column: projection scatter + expectancy bar */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">{xAxis} × {yAxis} projection</CardTitle></CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer>
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" dataKey="x" name={xAxis} />
                  <YAxis type="number" dataKey="y" name={yAxis} />
                  <ZAxis range={[30, 30]} />
                  <RTooltip cursor={{ strokeDasharray: "3 3" }} />
                  {clusters.map((c) => (
                    <Scatter key={c.index} name={`C${c.index + 1}`} data={scatter.filter((p) => p.cluster === c.index)} fill={CLUSTER_COLORS[c.index]} />
                  ))}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Expectancy per cluster</CardTitle></CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer>
                <BarChart data={enriched.map((c) => ({ name: `C${c.index + 1}`, expectancy: c.metrics.expectancy, net: c.metrics.net_profit, idx: c.index }))}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <RTooltip />
                  <Bar dataKey="expectancy">
                    {enriched.map((c) => <Cell key={c.index} fill={CLUSTER_COLORS[c.index]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Cumulative equity per cluster */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Hour-of-day distribution (UTC) per cluster</CardTitle></CardHeader>
        <CardContent>
          <div className="h-80">
            <ResponsiveContainer>
              <BarChart data={Array.from({ length: 24 }, (_, h) => {
                const row: Record<string, number | string> = { hour: h };
                enriched.forEach((c) => { row[`C${c.index + 1}`] = c.hourHist[h]; });
                return row;
              })}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour" />
                <YAxis />
                <RTooltip />
                {enriched.map((c) => (
                  <Bar key={c.index} dataKey={`C${c.index + 1}`} stackId="a" fill={CLUSTER_COLORS[c.index]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Drill-down: selected cluster */}
      {detail && (
        <Card className="border-2" style={{ borderColor: CLUSTER_COLORS[detail.index] + "60" }}>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Badge style={{ backgroundColor: CLUSTER_COLORS[detail.index], color: "#fff" }}>Cluster {detail.index + 1}</Badge>
              <span>Detail — {detail.size.toLocaleString()} trades ({(detail.pctOfAll * 100).toFixed(1)}% of dataset)</span>
            </CardTitle>
            <CardDescription>
              Net ${detail.metrics.net_profit.toFixed(0)} · PF {detail.metrics.profit_factor.toFixed(2)} · Exp ${detail.metrics.expectancy.toFixed(2)} · Sharpe {detail.metrics.sharpe.toFixed(2)} · MaxDD ${detail.metrics.max_drawdown.toFixed(0)} · Streaks W{detail.metrics.max_win_streak}/L{detail.metrics.max_loss_streak}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Categorical distributions grid */}
            <div className="grid gap-3 md:grid-cols-3">
              {(["symbol","strategy","session","direction","trade_type","exit_reason","ema_alignment","vwap_side"] as const).filter((k) => detail.cats[k]).map((k) => (
                <div key={k} className="rounded border p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{k}</div>
                  <div className="space-y-1">
                    {topN(detail.cats[k], 5).map((r) => (
                      <div key={r.key} className="text-xs">
                        <div className="flex justify-between font-mono"><span className="truncate">{r.key}</span><span>{(r.pct * 100).toFixed(0)}%</span></div>
                        <div className="h-1.5 rounded bg-muted overflow-hidden"><div className="h-full" style={{ width: `${r.pct * 100}%`, backgroundColor: CLUSTER_COLORS[detail.index] }} /></div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Numeric centroid vs global */}
            <div className="rounded border p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Numeric centroid vs global average (Δ%)</div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Feature</TableHead>
                      <TableHead className="text-right">Cluster avg</TableHead>
                      <TableHead className="text-right">Global avg</TableHead>
                      <TableHead className="text-right">Δ%</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {numericKeys.map((k) => {
                      const cv = detail.nums[k] ?? 0;
                      const gv = globalNumericAvg[k] ?? 0;
                      const delta = gv !== 0 ? ((cv - gv) / Math.abs(gv)) * 100 : 0;
                      return (
                        <TableRow key={k}>
                          <TableCell className="text-xs">{k}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{cv.toFixed(3)}</TableCell>
                          <TableCell className="text-right font-mono text-xs text-muted-foreground">{gv.toFixed(3)}</TableCell>
                          <TableCell className={`text-right font-mono text-xs ${Math.abs(delta) > 20 ? (delta > 0 ? "text-emerald-500" : "text-red-500") : "text-muted-foreground"}`}>
                            {delta >= 0 ? "+" : ""}{delta.toFixed(1)}%
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------- Regime ----------------
function RegimePanel({ rows }: { rows: TradeRecord[] }) {
  const report = useMemo(() => regimeReport(rows), [rows]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Market Regime Discovery</CardTitle>
        <CardDescription>Trades tagged by ATR percentile + ADX. Highest-expectancy regime is on top.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Regime</TableHead><TableHead>Trades</TableHead><TableHead>Net</TableHead>
            <TableHead>PF</TableHead><TableHead>Win%</TableHead><TableHead>Expectancy</TableHead>
            <TableHead>Max DD</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {report.map((r) => (
              <TableRow key={r.regime}>
                <TableCell><Badge>{r.regime}</Badge></TableCell>
                <TableCell>{r.trades}</TableCell>
                <TableCell>${r.metrics.net_profit.toFixed(0)}</TableCell>
                <TableCell>{r.metrics.profit_factor.toFixed(2)}</TableCell>
                <TableCell>{(r.metrics.win_rate * 100).toFixed(1)}%</TableCell>
                <TableCell>${r.metrics.expectancy.toFixed(2)}</TableCell>
                <TableCell>${r.metrics.max_drawdown.toFixed(0)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---------------- Rule Discovery ----------------
function RulePanel({ rows }: { rows: TradeRecord[] }) {
  const [depth, setDepth] = useState(3);
  const [objectiveKey, setObjectiveKey] = useState<ObjectiveKey>("expectancy");
  const [minTrades, setMinTrades] = useState(20);
  const rules = useMemo(() => discoverRules(rows, { key: objectiveKey, minTrades }, { maxDepth: depth, minTrades }), [rows, depth, objectiveKey, minTrades]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Automatic Filter / Rule Discovery</CardTitle>
        <CardDescription>Beam-search over feature slices that lift the objective.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div><Label>Depth</Label><Input type="number" value={depth} onChange={(e) => setDepth(Math.max(1, Math.min(4, Number(e.target.value) || 3)))} className="w-24" /></div>
          <div><Label>Objective</Label>
            <Select value={objectiveKey} onValueChange={(v) => setObjectiveKey(v as ObjectiveKey)}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>{OBJECTIVE_OPTIONS.filter((o) => o.key !== "custom").map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Min trades</Label><Input type="number" value={minTrades} onChange={(e) => setMinTrades(Number(e.target.value) || 10)} className="w-24" /></div>
        </div>
        <Table>
          <TableHeader><TableRow>
            <TableHead>#</TableHead><TableHead>Rule</TableHead><TableHead>Trades</TableHead>
            <TableHead>Score</TableHead><TableHead>Lift vs base</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rules.map((r, i) => (
              <TableRow key={i}>
                <TableCell>{i + 1}</TableCell>
                <TableCell className="text-xs">{r.description}</TableCell>
                <TableCell>{r.trades}</TableCell>
                <TableCell className="font-mono">{r.score.toFixed(3)}</TableCell>
                <TableCell className="text-emerald-500">+{r.liftPct.toFixed(1)}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---------------- Recommendations ----------------
function RecsPanel({ rows }: { rows: TradeRecord[] }) {
  const [objectiveKey, setObjectiveKey] = useState<ObjectiveKey>("profit_factor");
  const recs = useMemo(() => recommend(rows, { key: objectiveKey }), [rows, objectiveKey]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">AI Recommendations</CardTitle>
        <CardDescription>Actions that measurably improve the objective on this dataset.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-end gap-3">
          <div><Label>Objective</Label>
            <Select value={objectiveKey} onValueChange={(v) => setObjectiveKey(v as ObjectiveKey)}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>{OBJECTIVE_OPTIONS.filter((o) => o.key !== "custom").map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        {recs.length === 0 ? (
          <div className="text-sm text-muted-foreground">No high-impact recommendations found for this objective on the current dataset.</div>
        ) : (
          <div className="space-y-2">
            {recs.map((r, i) => (
              <div key={i} className="rounded border bg-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{r.action}</div>
                    <div className="text-xs text-muted-foreground">{r.detail}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-emerald-500 font-mono">+{r.liftPct.toFixed(1)}%</div>
                    <div className="text-[10px] text-muted-foreground font-mono">{r.before.toFixed(2)} → {r.after.toFixed(2)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <CellPlaceholder />
      </CardContent>
    </Card>
  );
}

// silences an unused-import warning if the app strips them
function CellPlaceholder() { return <Cell />; }
