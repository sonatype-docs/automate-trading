// Time Edge Discovery — main dashboard panel.
// Consumes trades from an IndexedDB-cached snapshot (same store used by Research).
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, Sparkles, Play, RefreshCw, Loader2, TrendingUp, TrendingDown, Layers } from "lucide-react";
import { useDatasetsProgress } from "@/hooks/use-datasets-progress";
import { listSnapshots } from "@/lib/trade-intelligence.functions";
import { generateTimeEdgeNarrative } from "@/lib/time-edge.functions";
import { analyzeTimeEdges } from "@/lib/time-edge/analysis";
import { bucketMonteCarlo, bootstrapNetPerTrade, walkForward } from "@/lib/time-edge/validation";
import { groupByDim } from "@/lib/time-edge/buckets";
import type { TradeRecord } from "@/lib/trade-intelligence/types";
import { applyFees, DEFAULT_FEE_MODEL } from "@/lib/trade-intelligence/fees";
import { bucketsToCsv, reportToJson, reportToMarkdown } from "@/lib/time-edge/export";
import type { BucketDim, BucketMetrics, HeatmapMetric, TimeEdgeReport } from "@/lib/time-edge/types";

function download(name: string, body: string, mime: string) {
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export function TimeEdgePanel() {
  const snapshotsFn = useServerFn(listSnapshots);
  const { data: snapshotList } = useQuery({
    queryKey: ["time-edge-snapshots"],
    queryFn: () => snapshotsFn(),
    refetchOnWindowFocus: false,
  });
  const snapshots = snapshotList?.snapshots ?? [];
  const [snapshotName, setSnapshotName] = useState<string>("");
  const [resyncKey, setResyncKey] = useState(0);
  const [minTrades, setMinTrades] = useState(10);
  const [clusters, setClusters] = useState(4);
  const [includeFees, setIncludeFees] = useState(true);

  const activeDatasets = useMemo(() => (snapshotName ? [snapshotName] : []), [snapshotName]);
  const { data: byDataset, progress, isLoading } = useDatasetsProgress(activeDatasets, resyncKey);
  const rawTrades = byDataset[snapshotName] ?? [];
  const trades = useMemo(
    () => (includeFees ? applyFees(rawTrades, DEFAULT_FEE_MODEL) : rawTrades),
    [rawTrades, includeFees],
  );
  const prog = progress[snapshotName];

  const [report, setReport] = useState<TimeEdgeReport | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const runAnalysis = async () => {
    if (!trades.length) return;
    setAnalyzing(true);
    await new Promise((r) => setTimeout(r, 30));
    try {
      const r = analyzeTimeEdges(trades, { minTrades, clusters });
      setReport(r);
    } finally { setAnalyzing(false); }
  };

  // Auto-run once trades finish loading and no report yet.
  useEffect(() => {
    if (trades.length > 0 && !report && !analyzing && prog?.done) void runAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trades.length, prog?.done]);

  const narrativeFn = useServerFn(generateTimeEdgeNarrative);
  const [narrative, setNarrative] = useState<string>("");
  const narrativeMut = useMutation({
    mutationFn: async () => {
      if (!report) throw new Error("Run the analysis first");
      const summary = report.clusters.slice(0, 4).map((c) =>
        `${c.label}: ${c.size} buckets, expectancy ${c.aggregate.expectancy.toFixed(2)}, PF ${c.aggregate.profitFactor.toFixed(2)}`).join("\n");
      const bMap = (b: BucketMetrics) => ({
        label: b.label, trades: b.trades, expectancy: b.expectancy,
        profitFactor: b.profitFactor, winRate: b.winRate,
        robustness: b.robustness, confidence: b.confidence,
      });
      return narrativeFn({
        data: {
          totalTrades: report.totalTrades,
          symbols: report.totalSymbols,
          strategies: report.totalStrategies,
          robustnessTop: report.robustnessTop.slice(0, 8).map(bMap),
          hiddenEdges: report.hiddenEdges.slice(0, 8).map(bMap),
          warnings: report.warnings.slice(0, 8).map(bMap),
          clusterSummary: summary,
        },
      });
    },
    onSuccess: (r) => { setNarrative(r.narrative); toast.success("AI insights ready"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card className="border-primary/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="h-4 w-4" /> Time Edge Discovery Engine
          </CardTitle>
          <CardDescription>
            Mines the cached Trade Intelligence dataset for statistically significant time-of-day, weekday, session, and cross-asset edges.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto_auto_auto]">
            <div>
              <Label className="text-xs">Snapshot</Label>
              <Select value={snapshotName} onValueChange={setSnapshotName}>
                <SelectTrigger><SelectValue placeholder="Pick a snapshot…" /></SelectTrigger>
                <SelectContent>
                  {snapshots.map((s) => (
                    <SelectItem key={s.name} value={s.name}>{s.name} · {s.count.toLocaleString()} trades</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Min trades/bucket</Label>
              <Input type="number" className="h-9 w-24" value={minTrades} onChange={(e) => setMinTrades(Number(e.target.value) || 10)} />
            </div>
            <div>
              <Label className="text-xs">Clusters</Label>
              <Input type="number" className="h-9 w-20" value={clusters} onChange={(e) => setClusters(Number(e.target.value) || 4)} />
            </div>
            <div className="flex items-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setResyncKey((k) => k + 1)} disabled={!snapshotName}>
                <RefreshCw className="mr-1 h-4 w-4" /> Resync
              </Button>
            </div>
            <div className="flex items-end">
              <Button size="sm" onClick={runAnalysis} disabled={!trades.length || analyzing}>
                {analyzing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Play className="mr-1 h-4 w-4" />}
                Analyze
              </Button>
            </div>
          </div>

          {snapshotName && (
            <div className="text-xs text-muted-foreground">
              {isLoading ? "Loading trades from cache/DB…" : "Loaded"}: {trades.length.toLocaleString()} rows
              {prog ? ` · status ${prog.status}${prog.error ? ` · ${prog.error}` : ""}` : ""}
            </div>
          )}
        </CardContent>
      </Card>

      {!snapshotName && (
        <Card><CardContent className="p-8 text-center text-muted-foreground">
          Pick a snapshot to begin. Cached snapshots load instantly from IndexedDB.
        </CardContent></Card>
      )}

      {report && (
        <>
          {/* Headline cards */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            <HeadlineCard label="Trades" value={report.totalTrades.toLocaleString()} />
            <HeadlineCard label="Symbols" value={report.totalSymbols.length.toString()} sub={report.totalSymbols.slice(0, 3).join(", ")} />
            <HeadlineCard label="Strategies" value={report.totalStrategies.length.toString()} />
            <HeadlineCard label="Top Robustness" value={`${report.robustnessTop[0]?.robustness ?? 0}/100`} sub={report.robustnessTop[0]?.label} />
            <HeadlineCard label="Hidden Edges" value={report.hiddenEdges.length.toString()} sub="p<0.10" />
            <HeadlineCard label="Warnings" value={report.warnings.length.toString()} sub="avoid" />
          </div>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Headline</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">{report.headlineSummary}</CardContent>
          </Card>

          <Tabs defaultValue="rankings" className="space-y-4">
            <TabsList className="flex flex-wrap gap-1">
              <TabsTrigger value="rankings">Rankings</TabsTrigger>
              <TabsTrigger value="heatmaps">Heatmaps</TabsTrigger>
              <TabsTrigger value="robustness">Robustness</TabsTrigger>
              <TabsTrigger value="validation">Validation</TabsTrigger>
              <TabsTrigger value="clusters">Clusters</TabsTrigger>
              <TabsTrigger value="cross">Cross-Asset</TabsTrigger>
              <TabsTrigger value="insights">AI Insights</TabsTrigger>
              <TabsTrigger value="export">Export</TabsTrigger>
            </TabsList>

            <TabsContent value="rankings"><RankingsPanel report={report} /></TabsContent>
            <TabsContent value="heatmaps"><HeatmapsPanel report={report} /></TabsContent>
            <TabsContent value="robustness"><RobustnessPanel report={report} /></TabsContent>
            <TabsContent value="validation"><ValidationPanel report={report} trades={trades} /></TabsContent>
            <TabsContent value="clusters"><ClustersPanel report={report} /></TabsContent>
            <TabsContent value="cross"><CrossAssetPanel report={report} /></TabsContent>
            <TabsContent value="insights">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2"><Sparkles className="h-4 w-4" /> AI Deployment Recommendations</CardTitle>
                  <CardDescription>Powered by Lovable AI (Gemini). One-click natural-language summary of every finding above.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Button size="sm" onClick={() => narrativeMut.mutate()} disabled={narrativeMut.isPending}>
                    {narrativeMut.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
                    Generate narrative
                  </Button>
                  {narrative && (
                    <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap rounded border bg-muted/30 p-4 text-sm">
                      {narrative}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="export"><ExportPanel report={report} /></TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function HeadlineCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card><CardContent className="p-3">
      <div className="text-[11px] uppercase text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground truncate">{sub}</div>}
    </CardContent></Card>
  );
}

// ---------------- Rankings ----------------
type SortKey = "robustness" | "expectancy" | "netProfit" | "profitFactor" | "winRate" | "trades" | "confidence";

function RankingsPanel({ report }: { report: TimeEdgeReport }) {
  const dims = Object.keys(report.buckets) as BucketDim[];
  const [dim, setDim] = useState<BucketDim>(dims[0] ?? "hour_ist");
  const [sort, setSort] = useState<SortKey>("robustness");
  const rows = useMemo(() => {
    const arr = [...(report.buckets[dim] ?? [])];
    arr.sort((a, b) => (b[sort] as number) - (a[sort] as number));
    return arr;
  }, [report, dim, sort]);

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle className="text-sm">Time Bucket Rankings</CardTitle>
          <CardDescription className="text-xs">Every bucket ranked with statistical significance vs the rest of the dataset.</CardDescription>
        </div>
        <div className="flex gap-2">
          <Select value={dim} onValueChange={(v) => setDim(v as BucketDim)}>
            <SelectTrigger className="w-40 h-8"><SelectValue /></SelectTrigger>
            <SelectContent>{dims.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Bucket</TableHead>
            <SortHead k="trades" sort={sort} setSort={setSort}>Trades</SortHead>
            <SortHead k="netProfit" sort={sort} setSort={setSort}>Net</SortHead>
            <SortHead k="winRate" sort={sort} setSort={setSort}>Win%</SortHead>
            <SortHead k="profitFactor" sort={sort} setSort={setSort}>PF</SortHead>
            <SortHead k="expectancy" sort={sort} setSort={setSort}>Expectancy</SortHead>
            <SortHead k="confidence" sort={sort} setSort={setSort}>Confidence</SortHead>
            <SortHead k="robustness" sort={sort} setSort={setSort}>Robustness</SortHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((b) => (
              <TableRow key={b.key}>
                <TableCell className="font-mono text-xs">{b.label}</TableCell>
                <TableCell>{b.trades}</TableCell>
                <TableCell className={b.netProfit >= 0 ? "text-emerald-500" : "text-red-500"}>${b.netProfit.toFixed(0)}</TableCell>
                <TableCell>{(b.winRate * 100).toFixed(1)}%</TableCell>
                <TableCell>{b.profitFactor.toFixed(2)}</TableCell>
                <TableCell className={b.expectancy >= 0 ? "text-emerald-500" : "text-red-500"}>{b.expectancy.toFixed(2)}</TableCell>
                <TableCell>{(b.confidence * 100).toFixed(0)}%</TableCell>
                <TableCell><RobustnessBar value={b.robustness} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function SortHead({ k, sort, setSort, children }: { k: SortKey; sort: SortKey; setSort: (k: SortKey) => void; children: React.ReactNode }) {
  const active = sort === k;
  return (
    <TableHead>
      <button onClick={() => setSort(k)} className={`text-xs ${active ? "font-bold text-primary" : ""}`}>
        {children}{active ? " ↓" : ""}
      </button>
    </TableHead>
  );
}

function RobustnessBar({ value }: { value: number }) {
  const color = value >= 70 ? "bg-emerald-500" : value >= 45 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-16 rounded bg-muted overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs font-mono">{value}</span>
    </div>
  );
}

// ---------------- Heatmaps ----------------
function HeatmapsPanel({ report }: { report: TimeEdgeReport }) {
  const [idx, setIdx] = useState(0);
  const hm = report.heatmaps[idx];
  const values = hm.cells.map((c) => c.value);
  const min = Math.min(...values, 0), max = Math.max(...values, 0);
  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-sm">Heatmap · {metricLabel(hm.metric)} · {hm.yLabel} × {hm.xLabel}</CardTitle>
          <CardDescription className="text-xs">Green = profitable, red = losing. Hover cells for detail.</CardDescription>
        </div>
        <Select value={String(idx)} onValueChange={(v) => setIdx(Number(v))}>
          <SelectTrigger className="w-64 h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            {report.heatmaps.map((h, i) => (
              <SelectItem key={i} value={String(i)}>{h.yLabel} × {h.xLabel} · {metricLabel(h.metric)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="text-[10px] font-mono">
          <thead>
            <tr>
              <th className="p-1"></th>
              {hm.xs.map((x) => <th key={x} className="p-1 text-muted-foreground">{x.slice(0, 2)}</th>)}
            </tr>
          </thead>
          <tbody>
            {hm.ys.map((y) => (
              <tr key={y}>
                <td className="p-1 pr-2 text-muted-foreground">{y}</td>
                {hm.xs.map((x) => {
                  const cell = hm.cells.find((c) => c.x === x && c.y === y)!;
                  const bg = cell.trades === 0 ? "transparent" : heatColor(cell.value, min, max);
                  return (
                    <td key={x} className="p-0" title={`${y} · ${x} — ${metricLabel(hm.metric)}: ${cell.value.toFixed(2)} · ${cell.trades} trades`}>
                      <div className="h-6 w-8 rounded-sm" style={{ background: bg }} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function metricLabel(m: HeatmapMetric): string {
  return { net_profit: "Net Profit", profit_factor: "Profit Factor", win_rate: "Win Rate", expectancy: "Expectancy", sharpe: "Sharpe", trades: "Trades" }[m];
}
function heatColor(v: number, min: number, max: number): string {
  if (v > 0) {
    const t = max > 0 ? Math.min(1, v / max) : 0;
    return `rgba(16, 185, 129, ${0.15 + t * 0.7})`;
  }
  if (v < 0) {
    const t = min < 0 ? Math.min(1, v / min) : 0;
    return `rgba(239, 68, 68, ${0.15 + t * 0.7})`;
  }
  return "rgba(148, 163, 184, 0.15)";
}

// ---------------- Robustness ----------------
function RobustnessPanel({ report }: { report: TimeEdgeReport }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4 text-emerald-500" /> Top Robust Edges</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {report.robustnessTop.slice(0, 10).map((b) => (
            <div key={b.key} className="flex items-center justify-between rounded border p-2 text-xs">
              <div className="min-w-0">
                <div className="truncate font-mono">{b.label}</div>
                <div className="text-muted-foreground">{b.trades} trades · exp {b.expectancy.toFixed(2)} · PF {b.profitFactor.toFixed(2)}</div>
              </div>
              <RobustnessBar value={b.robustness} />
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><TrendingDown className="h-4 w-4 text-red-500" /> Warnings — Avoid These Windows</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {report.warnings.length === 0 && <div className="text-xs text-muted-foreground">No statistically significant loss zones found.</div>}
          {report.warnings.map((b) => (
            <div key={b.key} className="flex items-center justify-between rounded border border-red-500/30 bg-red-500/5 p-2 text-xs">
              <div className="min-w-0">
                <div className="truncate font-mono">{b.label}</div>
                <div className="text-muted-foreground">{b.trades} trades · exp {b.expectancy.toFixed(2)} · conf {(b.confidence * 100).toFixed(0)}%</div>
              </div>
              <Badge variant="destructive">avoid</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------- Validation ----------------
function ValidationPanel({ report, trades }: { report: TimeEdgeReport; trades: TradeRecord[] }) {
  const candidates = report.robustnessTop.slice(0, 20);
  const [selectedKey, setSelectedKey] = useState<string>(candidates[0]?.key ?? "");
  const selected = candidates.find((c) => c.key === selectedKey) ?? candidates[0];

  const result = useMemo(() => {
    if (!selected) return null;
    const groups = groupByDim(trades, selected.dim);
    const g = groups.get(selected.key);
    if (!g) return null;
    return {
      mc: bucketMonteCarlo(g.rows, trades, 1500),
      boot: bootstrapNetPerTrade(g.rows, 800),
      wf: walkForward(g.rows, 5),
      rows: g.rows.length,
    };
  }, [selected, trades]);

  if (!selected) return <Card><CardContent className="p-6 text-sm text-muted-foreground">No buckets to validate.</CardContent></Card>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Statistical Validation</CardTitle>
          <Select value={selectedKey} onValueChange={setSelectedKey}>
            <SelectTrigger className="w-72 h-8"><SelectValue /></SelectTrigger>
            <SelectContent>{candidates.map((c) => <SelectItem key={c.key} value={c.key}>{c.label} · {c.dim}</SelectItem>)}</SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {!result ? (
            <div className="text-sm text-muted-foreground">Not enough trades for validation.</div>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              <ValCard title="Monte Carlo (1500 iters)">
                <Line label="Observed net" value={`$${result.mc.observedNetProfit.toFixed(0)}`} />
                <Line label="Random mean" value={`$${result.mc.meanRandomNet.toFixed(0)}`} />
                <Line label="5%–95% band" value={`$${result.mc.p5.toFixed(0)} — $${result.mc.p95.toFixed(0)}`} />
                <Line label="p-value" value={result.mc.pValue.toFixed(3)} highlight={result.mc.pValue < 0.1} />
              </ValCard>
              <ValCard title="Bootstrap CI (800 iters)">
                <Line label="Mean per trade" value={`$${result.boot.mean.toFixed(2)}`} />
                <Line label="95% CI" value={`$${result.boot.ci95Low.toFixed(2)} — $${result.boot.ci95High.toFixed(2)}`} />
                <Line label="P(positive)" value={`${(result.boot.probPositive * 100).toFixed(1)}%`} highlight={result.boot.probPositive > 0.9} />
              </ValCard>
              <ValCard title="Walk-Forward (5 folds)">
                <Line label="Profitable folds" value={`${result.wf.folds.filter((f) => f.netProfit > 0).length}/5`} />
                <Line label="Stability" value={`${(result.wf.stability * 100).toFixed(0)}%`} highlight={result.wf.stability >= 0.8} />
                <div className="mt-2 space-y-1 text-[11px] font-mono">
                  {result.wf.folds.map((f) => (
                    <div key={f.index} className="flex justify-between">
                      <span>Fold {f.index}</span>
                      <span className={f.netProfit >= 0 ? "text-emerald-500" : "text-red-500"}>${f.netProfit.toFixed(0)} · {f.trades}t</span>
                    </div>
                  ))}
                </div>
              </ValCard>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ValCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border p-3">
      <div className="text-xs font-semibold mb-2">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
function Line({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono ${highlight ? "text-emerald-500 font-semibold" : ""}`}>{value}</span>
    </div>
  );
}

// ---------------- Clusters ----------------
function ClustersPanel({ report }: { report: TimeEdgeReport }) {
  if (!report.clusters.length) return <Card><CardContent className="p-6 text-sm text-muted-foreground">Not enough hour×weekday buckets to cluster.</CardContent></Card>;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {report.clusters.map((c) => (
        <Card key={c.index}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{c.label}</CardTitle>
            <CardDescription>{c.size} buckets · {c.aggregate.trades} trades</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-4 gap-2 text-xs">
              <Metric label="Expectancy" value={c.aggregate.expectancy.toFixed(2)} />
              <Metric label="PF" value={c.aggregate.profitFactor.toFixed(2)} />
              <Metric label="Win%" value={`${(c.aggregate.winRate * 100).toFixed(0)}%`} />
              <Metric label="Sharpe" value={c.aggregate.sharpe.toFixed(2)} />
            </div>
            <div className="flex flex-wrap gap-1">
              {c.bucketKeys.slice(0, 24).map((k) => (
                <Badge key={k} variant="outline" className="text-[10px] font-mono">{k}</Badge>
              ))}
              {c.bucketKeys.length > 24 && <Badge variant="outline" className="text-[10px]">+{c.bucketKeys.length - 24}</Badge>}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="font-mono">{value}</div>
    </div>
  );
}

// ---------------- Cross-Asset ----------------
function CrossAssetPanel({ report }: { report: TimeEdgeReport }) {
  if (report.crossAsset.length === 0) {
    return <Card><CardContent className="p-6 text-sm text-muted-foreground">Cross-asset analysis needs ≥2 symbols in the dataset.</CardContent></Card>;
  }
  const symbols = Array.from(new Set(report.crossAsset.flatMap((r) => Object.keys(r.symbolStats))));
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Cross-Asset Consistency · Hour of Day (IST)</CardTitle>
        <CardDescription>Time buckets ranked by how many symbols they work on. Universal edges show up here.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Bucket</TableHead>
            <TableHead>Consistency</TableHead>
            {symbols.map((s) => <TableHead key={s}>{s} Net</TableHead>)}
            <TableHead>Universal</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {report.crossAsset.slice(0, 30).map((r) => (
              <TableRow key={r.bucketKey}>
                <TableCell className="font-mono text-xs">{r.label}</TableCell>
                <TableCell>{(r.consistencyScore * 100).toFixed(0)}%</TableCell>
                {symbols.map((s) => {
                  const st = r.symbolStats[s];
                  return (
                    <TableCell key={s} className={st ? (st.netProfit >= 0 ? "text-emerald-500" : "text-red-500") : "text-muted-foreground"}>
                      {st ? `$${st.netProfit.toFixed(0)}` : "—"}
                    </TableCell>
                  );
                })}
                <TableCell><RobustnessBar value={Math.min(100, r.universalScore)} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---------------- Export ----------------
function ExportPanel({ report }: { report: TimeEdgeReport }) {
  const allBuckets = Object.values(report.buckets).flat();
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">Export</CardTitle></CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => download("time-edge-buckets.csv", bucketsToCsv(allBuckets), "text/csv")}>
          <Download className="mr-1 h-4 w-4" /> CSV (all buckets)
        </Button>
        <Button size="sm" variant="outline" onClick={() => download("time-edge-report.json", reportToJson(report), "application/json")}>
          <Download className="mr-1 h-4 w-4" /> JSON (full report)
        </Button>
        <Button size="sm" variant="outline" onClick={() => download("time-edge-report.md", reportToMarkdown(report), "text/markdown")}>
          <Download className="mr-1 h-4 w-4" /> Markdown
        </Button>
      </CardContent>
    </Card>
  );
}
