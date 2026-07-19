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
import { generateTimeEdgeNarrative, deployTimeEdgeBuckets } from "@/lib/time-edge.functions";
import { analyzeTimeEdges, analyzeDim } from "@/lib/time-edge/analysis";
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
            <div>
              <Label className="text-xs">Exchange fees</Label>
              <label className="flex items-center gap-2 h-9 px-2 rounded-md border text-xs cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeFees}
                  onChange={(e) => { setIncludeFees(e.target.checked); setReport(null); }}
                />
                <span>Include ({(DEFAULT_FEE_MODEL.makerRate * 100).toFixed(3)}% / {(DEFAULT_FEE_MODEL.takerRate * 100).toFixed(3)}%)</span>
              </label>
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
            <TabsContent value="robustness"><RobustnessPanel report={report} trades={trades} /></TabsContent>
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
type SortKey = "robustness" | "expectancy" | "netProfit" | "profitFactor" | "winRate" | "trades" | "confidence" | "sharpe" | "avgRr";

function RankingsPanel({ report }: { report: TimeEdgeReport }) {
  const dims = Object.keys(report.buckets) as BucketDim[];
  const [dim, setDim] = useState<BucketDim>(dims[0] ?? "hour_ist");
  const [sort, setSort] = useState<SortKey>("robustness");
  const [search, setSearch] = useState("");
  const [minTrades, setMinTrades] = useState(0);
  const [minPf, setMinPf] = useState(0);
  const [minWin, setMinWin] = useState(0);
  const [minExp, setMinExp] = useState(-9999);
  const [minConf, setMinConf] = useState(0);
  const [profitOnly, setProfitOnly] = useState(false);
  const [signifOnly, setSignifOnly] = useState(false);
  const [limit, setLimit] = useState(50);

  const rows = useMemo(() => {
    let arr = [...(report.buckets[dim] ?? [])];
    const q = search.trim().toLowerCase();
    if (q) arr = arr.filter((b) => b.label.toLowerCase().includes(q));
    if (minTrades > 0) arr = arr.filter((b) => b.trades >= minTrades);
    if (minPf > 0) arr = arr.filter((b) => b.profitFactor >= minPf);
    if (minWin > 0) arr = arr.filter((b) => b.winRate * 100 >= minWin);
    if (minExp > -9999) arr = arr.filter((b) => b.expectancy >= minExp);
    if (minConf > 0) arr = arr.filter((b) => b.confidence * 100 >= minConf);
    if (profitOnly) arr = arr.filter((b) => b.netProfit > 0);
    if (signifOnly) arr = arr.filter((b) => b.confidence >= 0.9);
    arr.sort((a, b) => (b[sort] as number) - (a[sort] as number));
    return arr;
  }, [report, dim, sort, search, minTrades, minPf, minWin, minExp, minConf, profitOnly, signifOnly]);

  const shown = rows.slice(0, limit);
  const totalAvailable = (report.buckets[dim] ?? []).length;

  const resetFilters = () => {
    setSearch(""); setMinTrades(0); setMinPf(0); setMinWin(0);
    setMinExp(-9999); setMinConf(0); setProfitOnly(false); setSignifOnly(false);
  };

  // Selection + deploy (mirrors Robustness panel).
  interface RowOverride {
    symbol?: string;
    timeframe?: string;
    strategy?: string;
    direction?: string;
    windowStart?: number;
    windowEnd?: number;
  }
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, RowOverride>>({});
  const rowId = (b: BucketMetrics) => `${b.dim}::${b.key}`;
  const defaultOverride = (b: BucketMetrics): RowOverride => {
    const hrs = b.hours.length ? [...b.hours].sort((a, x) => a - x) : [];
    const dirs = b.directions ?? [];
    const dir = dirs.length === 1 ? dirs[0] : "both";
    return {
      symbol: b.symbols[0],
      timeframe: b.timeframes[0] ?? "15m",
      strategy: b.strategies[0],
      direction: dir,
      windowStart: hrs.length ? hrs[0] : 0,
      windowEnd: hrs.length ? (hrs[hrs.length - 1] + 1) : 24,
    };
  };
  const toggle = (b: BucketMetrics) => {
    const id = rowId(b);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setOverrides((prev) => (prev[id] ? prev : { ...prev, [id]: defaultOverride(b) }));
  };
  const patchOverride = (id: string, patch: Partial<RowOverride>) =>
    setOverrides((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...patch } }));
  const selectAllVisible = () => {
    setSelected(new Set(shown.map((b) => rowId(b))));
    setOverrides((prev) => {
      const next = { ...prev };
      for (const b of shown) { const id = rowId(b); if (!next[id]) next[id] = defaultOverride(b); }
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());

  const [deployTarget, setDeployTarget] = useState<"live" | "paper" | "both">("paper");
  const [deployRisk, setDeployRisk] = useState<number>(20);
  const [deployExec, setDeployExec] = useState<string>("conservative_default");
  const [deployTf, setDeployTf] = useState<string>("auto");
  const [replaceExisting, setReplaceExisting] = useState<boolean>(true);

  const deployFn = useServerFn(deployTimeEdgeBuckets);
  const deployMut = useMutation({
    mutationFn: async () => {
      const picked = shown.filter((b) => selected.has(rowId(b)));
      if (!picked.length) throw new Error("Select at least one bucket");
      const buckets = picked.flatMap((b) => {
        const id = rowId(b);
        const ov = overrides[id] ?? defaultOverride(b);
        const symbol = ov.symbol ?? b.symbols[0] ?? "";
        const strategyPreset = ov.strategy ?? b.strategies[0] ?? "";
        const timeframe = deployTf !== "auto" ? deployTf : (ov.timeframe ?? b.timeframes[0] ?? "15m");
        const dirChoice = ov.direction ?? "both";
        if (!symbol || !strategyPreset) throw new Error(`Bucket "${b.label}" is missing symbol/strategy — pick one in the row.`);
        const windowStartHourIst = ov.windowStart;
        const windowEndHourIst = ov.windowEnd;
        const dirs = dirChoice === "both" ? ["long", "short"] : [dirChoice];
        return dirs.map((direction) => ({
          label: b.label,
          symbol,
          timeframe,
          strategyPreset,
          execPreset: deployExec,
          riskUsd: deployRisk,
          lookbackDays: 30,
          hoursIst: (windowStartHourIst == null || windowEndHourIst == null) ? b.hours : undefined,
          weekdays: b.weekdays,
          sessions: b.sessions,
          direction,
          windowStartHourIst,
          windowEndHourIst,
        }));
      });
      return deployFn({ data: { target: deployTarget, buckets, replaceExisting } });
    },
    onSuccess: (r) => {
      const parts: string[] = [];
      if (r.live.inserted || r.live.removed) parts.push(`Live: +${r.live.inserted} / −${r.live.removed}`);
      if (r.paper.inserted || r.paper.removed) parts.push(`Paper: +${r.paper.inserted} / −${r.paper.removed}`);
      toast.success(`Deployed. ${parts.join(" · ") || "no changes"}`);
      setSelected(new Set());
    },
    onError: (e: Error) => toast.error(e.message),
  });


  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle className="text-sm">Time Bucket Rankings</CardTitle>
          <CardDescription className="text-xs">
            {rows.length.toLocaleString()} of {totalAvailable.toLocaleString()} buckets after filters · showing top {Math.min(limit, rows.length)}
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Select value={dim} onValueChange={(v) => setDim(v as BucketDim)}>
            <SelectTrigger className="w-48 h-8"><SelectValue /></SelectTrigger>
            <SelectContent>{dims.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Micro filter bar */}
        <div className="grid gap-2 md:grid-cols-4 lg:grid-cols-8 items-end rounded-md border bg-muted/20 p-2">
          <div className="lg:col-span-2">
            <Label className="text-[10px] uppercase text-muted-foreground">Search label</Label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. BTC, 20:00, LDN…" className="h-8" />
          </div>
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">Min trades</Label>
            <Input type="number" min={0} value={minTrades} onChange={(e) => setMinTrades(Number(e.target.value) || 0)} className="h-8" />
          </div>
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">Min PF</Label>
            <Input type="number" step="0.1" min={0} value={minPf} onChange={(e) => setMinPf(Number(e.target.value) || 0)} className="h-8" />
          </div>
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">Min Win %</Label>
            <Input type="number" step="1" min={0} max={100} value={minWin} onChange={(e) => setMinWin(Number(e.target.value) || 0)} className="h-8" />
          </div>
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">Min Expectancy</Label>
            <Input type="number" step="0.1" value={minExp === -9999 ? "" : minExp} placeholder="any" onChange={(e) => setMinExp(e.target.value === "" ? -9999 : Number(e.target.value))} className="h-8" />
          </div>
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">Min Conf %</Label>
            <Input type="number" step="1" min={0} max={100} value={minConf} onChange={(e) => setMinConf(Number(e.target.value) || 0)} className="h-8" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-1 text-xs cursor-pointer">
              <input type="checkbox" checked={profitOnly} onChange={(e) => setProfitOnly(e.target.checked)} />
              Profit only
            </label>
            <label className="flex items-center gap-1 text-xs cursor-pointer">
              <input type="checkbox" checked={signifOnly} onChange={(e) => setSignifOnly(e.target.checked)} />
              p&lt;0.10 only
            </label>
          </div>
          <div className="flex gap-1 md:col-span-4 lg:col-span-8 justify-between items-center pt-1 border-t">
            <div className="flex items-center gap-2 text-xs">
              <Label className="text-[10px] uppercase text-muted-foreground">Show</Label>
              <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
                <SelectTrigger className="w-24 h-7"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[25, 50, 100, 250, 500, 2000].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={resetFilters}>Reset filters</Button>
          </div>
        </div>

        {/* Deploy toolbar */}
        <div className="rounded-md border border-primary/30 bg-primary/5 p-2 space-y-2">
          <div className="text-xs font-semibold flex items-center gap-2"><Play className="h-3 w-3" /> Ship selected rankings to runners</div>
          <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 items-end">
            <div className="min-w-0">
              <Label className="text-[10px] text-muted-foreground">Target</Label>
              <Select value={deployTarget} onValueChange={(v) => setDeployTarget(v as "live" | "paper" | "both")}>
                <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="paper">Paper only</SelectItem>
                  <SelectItem value="live">Live only</SelectItem>
                  <SelectItem value="both">Both live + paper</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0">
              <Label className="text-[10px] text-muted-foreground">Risk USD</Label>
              <Input type="number" min={1} max={1000} className="h-8 w-full" value={deployRisk} onChange={(e) => setDeployRisk(Number(e.target.value) || 20)} />
            </div>
            <div className="min-w-0">
              <Label className="text-[10px] text-muted-foreground">Exec preset</Label>
              <Select value={deployExec} onValueChange={setDeployExec}>
                <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="conservative_default">conservative_default</SelectItem>
                  <SelectItem value="optimistic_scalper">optimistic_scalper</SelectItem>
                  <SelectItem value="no_management">no_management</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0">
              <Label className="text-[10px] text-muted-foreground">Timeframe</Label>
              <Select value={deployTf} onValueChange={setDeployTf}>
                <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">auto (from bucket)</SelectItem>
                  {["1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"].map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-xs cursor-pointer h-8 px-2 rounded border bg-background">
              <input type="checkbox" checked={replaceExisting} onChange={(e) => setReplaceExisting(e.target.checked)} />
              Replace duplicates
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-2">
            <span className="text-xs text-muted-foreground mr-auto">{selected.size} selected of {shown.length} visible</span>
            <Button size="sm" variant="outline" onClick={selectAllVisible}>Select all ({shown.length})</Button>
            <Button size="sm" variant="ghost" onClick={clearSelection}>Clear</Button>
            <Button size="sm" disabled={!selected.size || deployMut.isPending} onClick={() => deployMut.mutate()}>
              {deployMut.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Play className="mr-1 h-4 w-4" />}
              Deploy {selected.size || ""}
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Bucket</TableHead>
              <TableHead className="text-xs">Symbol</TableHead>
              <TableHead className="text-xs">TF</TableHead>
              <TableHead className="text-xs">Strategy</TableHead>
              <TableHead className="text-xs">Dir</TableHead>
              <TableHead className="text-xs">Window IST</TableHead>
              <SortHead k="trades" sort={sort} setSort={setSort}>Trades</SortHead>
              <SortHead k="netProfit" sort={sort} setSort={setSort}>Net</SortHead>
              <SortHead k="winRate" sort={sort} setSort={setSort}>Win%</SortHead>
              <SortHead k="profitFactor" sort={sort} setSort={setSort}>PF</SortHead>
              <SortHead k="expectancy" sort={sort} setSort={setSort}>Expectancy</SortHead>
              <SortHead k="avgRr" sort={sort} setSort={setSort}>Avg RR</SortHead>
              <SortHead k="sharpe" sort={sort} setSort={setSort}>Sharpe</SortHead>
              <SortHead k="confidence" sort={sort} setSort={setSort}>Confidence</SortHead>
              <SortHead k="robustness" sort={sort} setSort={setSort}>Robustness</SortHead>
            </TableRow></TableHeader>
            <TableBody>
              {shown.map((b) => {
                const id = rowId(b);
                const isSel = selected.has(id);
                const ov = overrides[id] ?? defaultOverride(b);
                return (
                  <TableRow key={b.key} className={isSel ? "bg-primary/5" : ""}>
                    <TableCell><input type="checkbox" checked={isSel} onChange={() => toggle(b)} /></TableCell>
                    <TableCell className="font-mono text-xs max-w-[220px] truncate" title={b.label}>{b.label}</TableCell>
                    <TableCell className="text-[11px] font-mono w-[130px] max-w-[130px]">
                      {isSel && b.symbols.length > 1 ? (
                        <Select value={ov.symbol} onValueChange={(v) => patchOverride(id, { symbol: v })}>
                          <SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger>
                          <SelectContent>{b.symbols.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                        </Select>
                      ) : (
                        <div className="truncate" title={b.symbols.join(", ")}>{isSel ? ov.symbol : (b.symbols.slice(0, 2).join(",") || "—")}{!isSel && b.symbols.length > 2 ? `+${b.symbols.length - 2}` : ""}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-[11px] w-[100px] max-w-[100px]">
                      {isSel ? (
                        <Select value={ov.timeframe ?? b.timeframes[0] ?? "15m"} onValueChange={(v) => patchOverride(id, { timeframe: v })}>
                          <SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Array.from(new Set([...(b.timeframes ?? []), "1m","3m","5m","15m","30m","1h","4h"])).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : (
                        <div className="truncate" title={b.timeframes.join(", ")}>{b.timeframes.join(",") || "—"}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-[11px] font-mono w-[160px] max-w-[160px]">
                      {isSel && b.strategies.length > 1 ? (
                        <Select value={ov.strategy} onValueChange={(v) => patchOverride(id, { strategy: v })}>
                          <SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger>
                          <SelectContent>{b.strategies.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                        </Select>
                      ) : (
                        <div className="truncate" title={b.strategies.join(", ")}>{isSel ? ov.strategy : (b.strategies.slice(0, 2).join(",") || "—")}{!isSel && b.strategies.length > 2 ? `+${b.strategies.length - 2}` : ""}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-[11px]">
                      {isSel ? (
                        <Select value={ov.direction ?? "both"} onValueChange={(v) => patchOverride(id, { direction: v })}>
                          <SelectTrigger className="h-6 text-[10px] w-20"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="both">both</SelectItem>
                            <SelectItem value="long">long</SelectItem>
                            <SelectItem value="short">short</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <span>{b.directions.join("/") || "—"}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-[10px] font-mono">
                      {isSel ? (
                        <div className="flex items-center gap-1">
                          <Select value={String(ov.windowStart ?? 0)} onValueChange={(v) => patchOverride(id, { windowStart: Number(v) })}>
                            <SelectTrigger className="h-6 text-[10px] w-16"><SelectValue /></SelectTrigger>
                            <SelectContent>{Array.from({ length: 24 }, (_, i) => i).map((h) => <SelectItem key={h} value={String(h)}>{String(h).padStart(2, "0")}:00</SelectItem>)}</SelectContent>
                          </Select>
                          <span className="text-muted-foreground">→</span>
                          <Select value={String(ov.windowEnd ?? 24)} onValueChange={(v) => patchOverride(id, { windowEnd: Number(v) })}>
                            <SelectTrigger className="h-6 text-[10px] w-16"><SelectValue /></SelectTrigger>
                            <SelectContent>{Array.from({ length: 24 }, (_, i) => i + 1).map((h) => <SelectItem key={h} value={String(h)}>{String(h).padStart(2, "0")}:00</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                      ) : (
                        <span title={b.hours.join(",")}>{b.hours.length ? (b.hours.length <= 4 ? b.hours.join(",") : `${b.hours.length} hrs`) : "—"}</span>
                      )}
                    </TableCell>
                    <TableCell>{b.trades}</TableCell>
                    <TableCell className={b.netProfit >= 0 ? "text-emerald-500" : "text-red-500"}>${b.netProfit.toFixed(0)}</TableCell>
                    <TableCell>{(b.winRate * 100).toFixed(1)}%</TableCell>
                    <TableCell>{b.profitFactor.toFixed(2)}</TableCell>
                    <TableCell className={b.expectancy >= 0 ? "text-emerald-500" : "text-red-500"}>{b.expectancy.toFixed(2)}</TableCell>
                    <TableCell>{b.avgRr.toFixed(2)}</TableCell>
                    <TableCell>{b.sharpe.toFixed(2)}</TableCell>
                    <TableCell>{(b.confidence * 100).toFixed(0)}%</TableCell>
                    <TableCell><RobustnessBar value={b.robustness} /></TableCell>
                  </TableRow>
                );
              })}
              {shown.length === 0 && (
                <TableRow><TableCell colSpan={16} className="text-center text-muted-foreground text-xs py-6">No buckets match the current filters.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
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
type Verdict = "elite" | "strong" | "decent" | "weak" | "avoid";

const VERDICT_META: Record<Verdict, { label: string; hint: string; badgeClass: string; rowClass: string }> = {
  elite:  { label: "ELITE",  hint: "Deploy with confidence",        badgeClass: "bg-emerald-600 text-white",         rowClass: "bg-emerald-500/5 border-emerald-500/40" },
  strong: { label: "STRONG", hint: "Good edge, size normally",       badgeClass: "bg-emerald-500/80 text-white",      rowClass: "bg-emerald-500/5 border-emerald-500/20" },
  decent: { label: "DECENT", hint: "Usable, monitor closely",        badgeClass: "bg-amber-500 text-black",           rowClass: "bg-amber-500/5 border-amber-500/20" },
  weak:   { label: "WEAK",   hint: "Not statistically reliable",     badgeClass: "bg-slate-500 text-white",           rowClass: "bg-muted/30 border-muted" },
  avoid:  { label: "AVOID",  hint: "Statistically losing window",    badgeClass: "bg-red-600 text-white",             rowClass: "bg-red-500/5 border-red-500/40" },
};

function classify(b: BucketMetrics): { verdict: Verdict; reasons: string[]; positives: string[] } {
  const reasons: string[] = [];
  const positives: string[] = [];
  if (b.trades < 20) reasons.push(`small sample (${b.trades})`);
  else positives.push(`${b.trades} trades`);
  if (b.confidence < 0.8) reasons.push(`low significance (conf ${(b.confidence * 100).toFixed(0)}%)`);
  else positives.push(`conf ${(b.confidence * 100).toFixed(0)}%`);
  if (b.profitFactor < 1) reasons.push(`PF ${b.profitFactor.toFixed(2)} < 1`);
  else if (b.profitFactor >= 1.5) positives.push(`PF ${b.profitFactor.toFixed(2)}`);
  if (b.expectancy <= 0) reasons.push(`expectancy ${b.expectancy.toFixed(2)}`);
  else if (b.expectancy > 0) positives.push(`exp ${b.expectancy.toFixed(2)}`);
  if (b.winRate < 0.35) reasons.push(`win rate ${(b.winRate * 100).toFixed(0)}%`);
  else if (b.winRate >= 0.55) positives.push(`win ${(b.winRate * 100).toFixed(0)}%`);
  if (b.sharpe < 0) reasons.push(`sharpe ${b.sharpe.toFixed(2)}`);
  else if (b.sharpe >= 1) positives.push(`sharpe ${b.sharpe.toFixed(2)}`);
  if (b.maxDrawdown < -Math.abs(b.netProfit) * 1.5 && b.netProfit > 0) reasons.push(`drawdown > 1.5× net`);

  let verdict: Verdict;
  if (b.expectancy < 0 && b.confidence >= 0.8 && b.trades >= 20) verdict = "avoid";
  else if (b.profitFactor < 0.8 && b.trades >= 20) verdict = "avoid";
  else if (b.robustness >= 75 && b.trades >= 30 && b.profitFactor >= 1.5 && b.confidence >= 0.9 && b.expectancy > 0) verdict = "elite";
  else if (b.robustness >= 60 && b.trades >= 20 && b.profitFactor >= 1.3 && b.expectancy > 0) verdict = "strong";
  else if (b.robustness >= 45 && b.profitFactor >= 1.1 && b.expectancy > 0) verdict = "decent";
  else verdict = "weak";
  return { verdict, reasons, positives };
}

function RobustnessPanel({ report, trades }: { report: TimeEdgeReport; trades: TradeRecord[] }) {
  // Split every dimension by (timeframe × symbol) so each row = one TF+Symbol verdict.
  const all = useMemo(() => {
    const dims = Object.keys(report.buckets) as BucketDim[];
    const groupMap = new Map<string, { tf: string; sym: string; trades: TradeRecord[] }>();
    for (const t of trades) {
      const tf = t.timeframe || "unknown";
      const sym = t.symbol || "unknown";
      const k = `${tf}::${sym}`;
      const g = groupMap.get(k);
      if (g) g.trades.push(t); else groupMap.set(k, { tf, sym, trades: [t] });
    }
    const flat: BucketMetrics[] = [];
    for (const [, g] of groupMap) {
      if (g.trades.length < 10) continue;
      for (const dim of dims) {
        const bs = analyzeDim(g.trades, dim, 10);
        for (const b of bs) {
          flat.push({
            ...b,
            key: `${g.tf}::${g.sym}::${b.key}`,
            label: `[${g.sym} · ${g.tf}] ${b.label}`,
            timeframes: [g.tf],
            symbols: [g.sym],
          });
        }
      }
    }
    // Merge sibling rows identical in every parameter except direction (long+short → both)
    // AND collapse hour references into 8-hour IST windows (00-08, 08-16, 16-24).
    const to8hWindow = (h: number) => {
      const s = Math.floor(h / 8) * 8;
      const e = s + 8;
      return `${String(s).padStart(2, "0")}-${String(e).padStart(2, "0")}h IST`;
    };
    const collapseHours = (s: string) =>
      s.replace(/\b(\d{2}):(\d{2})(\s*(IST|UTC))?/g, (_m, hh) => to8hWindow(Number(hh)));
    const stripDirLabel = (s: string) =>
      s.replace(/\b(Long|Short|LONG|SHORT|long|short|BUY|SELL|Buy|Sell)\b/g, "")
       .replace(/[·•|]\s*[·•|]/g, "·")
       .replace(/\s{2,}/g, " ")
       .replace(/[·•|\s]+$/g, "")
       .trim();
    const normLabel = (b: BucketMetrics) => collapseHours(stripDirLabel(b.label));
    const mergeKey = (b: BucketMetrics) =>
      [normLabel(b), b.symbols.join(","), b.timeframes.join(","),
       b.strategies.join(","), b.sessions.join(",")].join("|");
    const groups = new Map<string, BucketMetrics[]>();
    for (const b of flat) {
      const k = mergeKey(b);
      const arr = groups.get(k);
      if (arr) arr.push(b); else groups.set(k, [b]);
    }
    const merged: BucketMetrics[] = [];
    for (const [, arr] of groups) {
      if (arr.length === 1) { merged.push({ ...arr[0], label: normLabel(arr[0]) }); continue; }
      const total = arr.reduce((s, x) => s + x.trades, 0) || 1;
      const wAvg = (f: (b: BucketMetrics) => number) =>
        arr.reduce((s, x) => s + f(x) * x.trades, 0) / total;
      const sum = (f: (b: BucketMetrics) => number) => arr.reduce((s, x) => s + f(x), 0);
      const gp = sum((x) => x.grossProfit);
      const gl = sum((x) => x.grossLoss);
      const wins = sum((x) => x.wins);
      const losses = sum((x) => x.losses);
      const first = arr[0];
      const dirs = Array.from(new Set(arr.flatMap((x) => x.directions))).sort();
      merged.push({
        ...first,
        key: `${first.key}::merged(${dirs.join("+")})`,
        label: `${normLabel(first)} · both`,
        trades: total,
        wins, losses,
        netProfit: sum((x) => x.netProfit),
        grossProfit: gp,
        grossLoss: gl,
        winRate: total ? wins / total : 0,
        profitFactor: gl > 0 ? gp / gl : (gp > 0 ? Infinity : 0),
        expectancy: total ? sum((x) => x.expectancy * x.trades) / total : 0,
        avgRr: wAvg((x) => x.avgRr),
        avgWin: wins ? sum((x) => x.avgWin * x.wins) / wins : 0,
        avgLoss: losses ? sum((x) => x.avgLoss * x.losses) / losses : 0,
        sharpe: wAvg((x) => x.sharpe),
        sortino: wAvg((x) => x.sortino),
        maxDrawdown: Math.max(...arr.map((x) => x.maxDrawdown)),
        ulcerIndex: wAvg((x) => x.ulcerIndex),
        recoveryFactor: wAvg((x) => x.recoveryFactor),
        avgHoldingBars: wAvg((x) => x.avgHoldingBars),
        medianHoldingBars: wAvg((x) => x.medianHoldingBars),
        pValueMean: Math.min(...arr.map((x) => x.pValueMean)),
        pValueWin: Math.min(...arr.map((x) => x.pValueWin)),
        confidence: Math.max(...arr.map((x) => x.confidence)),
        robustness: wAvg((x) => x.robustness),
        directions: dirs,
      });
    }
    return merged.map((b) => ({ b, ...classify(b) }));
  }, [report, trades]);



  const counts = useMemo(() => {
    const c: Record<Verdict, number> = { elite: 0, strong: 0, decent: 0, weak: 0, avoid: 0 };
    for (const r of all) c[r.verdict]++;
    return c;
  }, [all]);


  const [verdictFilter, setVerdictFilter] = useState<string>("all");
  const [minTrades, setMinTrades] = useState<number>(10);
  const [search, setSearch] = useState<string>("");
  type SortKey = "verdict" | "label" | "symbol" | "timeframe" | "strategy" | "direction" | "session" | "hours" | "weekdays" | "trades" | "expectancy" | "profitFactor" | "winRate" | "sharpe" | "confidence" | "robustness" | "netProfit";
  const [sortKey, setSortKey] = useState<SortKey>("robustness");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(k); setSortDir(k === "label" || k === "symbol" || k === "timeframe" || k === "strategy" || k === "direction" || k === "session" ? "asc" : "desc"); }
  };

  const [symbolFilter, setSymbolFilter] = useState<string>("all");
  const [tfFilter, setTfFilter] = useState<string>("all");
  const [strategyFilter, setStrategyFilter] = useState<string>("all");
  const [dirFilter, setDirFilter] = useState<string>("all");

  const allSymbols = useMemo(() => Array.from(new Set(all.flatMap((r) => r.b.symbols))).sort(), [all]);
  const allTfs = useMemo(() => Array.from(new Set(all.flatMap((r) => r.b.timeframes))).sort(), [all]);
  const allStrategies = useMemo(() => Array.from(new Set(all.flatMap((r) => r.b.strategies))).sort(), [all]);
  const allDirections = useMemo(() => Array.from(new Set(all.flatMap((r) => r.b.directions))).sort(), [all]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = all.filter((r) => {
      if (verdictFilter !== "all" && r.verdict !== verdictFilter) return false;
      if (r.b.trades < minTrades) return false;
      if (q && !r.b.label.toLowerCase().includes(q)) return false;
      if (symbolFilter !== "all" && !r.b.symbols.includes(symbolFilter)) return false;
      if (tfFilter !== "all" && !r.b.timeframes.includes(tfFilter)) return false;
      if (strategyFilter !== "all" && !r.b.strategies.includes(strategyFilter)) return false;
      if (dirFilter !== "all" && !r.b.directions.includes(dirFilter)) return false;
      return true;
    });
    const order: Record<Verdict, number> = { elite: 0, strong: 1, decent: 2, weak: 3, avoid: 4 };
    const mul = sortDir === "desc" ? -1 : 1;
    const getVal = (r: (typeof all)[number]): number | string => {
      switch (sortKey) {
        case "verdict": return order[r.verdict];
        case "label": return r.b.label;
        case "symbol": return r.b.symbols[0] ?? "";
        case "timeframe": return r.b.timeframes[0] ?? "";
        case "strategy": return r.b.strategies[0] ?? "";
        case "direction": return r.b.directions.join("/");
        case "session": return r.b.sessions.join("/");
        case "hours": return r.b.hours[0] ?? -1;
        case "weekdays": return r.b.weekdays[0] ?? -1;
        default: return (r.b[sortKey] as number) ?? 0;
      }
    };
    filtered.sort((a, b) => {
      const va = getVal(a), vb = getVal(b);
      if (typeof va === "string" || typeof vb === "string") {
        return String(va).localeCompare(String(vb)) * mul;
      }
      if (vb !== va) return ((va as number) - (vb as number)) * mul;
      return order[a.verdict] - order[b.verdict];
    });
    return filtered.slice(0, 200);
  }, [all, verdictFilter, minTrades, search, sortKey, sortDir, symbolFilter, tfFilter, strategyFilter, dirFilter]);


  // ------- Selection + per-row overrides -------
  interface RowOverride {
    symbol?: string;
    timeframe?: string;
    strategy?: string;
    direction?: string;
    windowStart?: number;
    windowEnd?: number;
  }
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, RowOverride>>({});
  const rowId = (b: BucketMetrics) => `${b.dim}::${b.key}`;
  const defaultOverride = (b: BucketMetrics): RowOverride => {
    const hrs = b.hours.length ? [...b.hours].sort((a, x) => a - x) : [];
    const dirs = b.directions ?? [];
    const dir = dirs.length === 1 ? dirs[0] : "both";
    return {
      symbol: b.symbols[0],
      timeframe: b.timeframes[0] ?? "15m",
      strategy: b.strategies[0],
      direction: dir,
      windowStart: hrs.length ? hrs[0] : 0,
      windowEnd: hrs.length ? (hrs[hrs.length - 1] + 1) : 24,
    };
  };
  const toggle = (b: BucketMetrics) => {
    const id = rowId(b);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setOverrides((prev) => (prev[id] ? prev : { ...prev, [id]: defaultOverride(b) }));
  };
  const patchOverride = (id: string, patch: Partial<RowOverride>) =>
    setOverrides((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...patch } }));
  const selectAllVisible = () => {
    setSelected(new Set(rows.map((r) => rowId(r.b))));
    setOverrides((prev) => {
      const next = { ...prev };
      for (const r of rows) { const id = rowId(r.b); if (!next[id]) next[id] = defaultOverride(r.b); }
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());

  const [deployTarget, setDeployTarget] = useState<"live" | "paper" | "both">("paper");
  const [deployRisk, setDeployRisk] = useState<number>(20);
  const [deployExec, setDeployExec] = useState<string>("conservative_default");
  const [deployTf, setDeployTf] = useState<string>("auto");
  const [replaceExisting, setReplaceExisting] = useState<boolean>(true);

  const deployFn = useServerFn(deployTimeEdgeBuckets);
  const deployMut = useMutation({
    mutationFn: async () => {
      const picked = rows.filter((r) => selected.has(rowId(r.b))).map((r) => r.b);
      if (!picked.length) throw new Error("Select at least one bucket");
      const buckets = picked.flatMap((b) => {
        const id = rowId(b);
        const ov = overrides[id] ?? defaultOverride(b);
        const symbol = ov.symbol ?? b.symbols[0] ?? "";
        const strategyPreset = ov.strategy ?? b.strategies[0] ?? "";
        const timeframe = deployTf !== "auto" ? deployTf : (ov.timeframe ?? b.timeframes[0] ?? "15m");
        const dirChoice = ov.direction ?? "both";
        if (!symbol || !strategyPreset) throw new Error(`Bucket "${b.label}" is missing symbol/strategy — pick one in the row.`);
        const windowStartHourIst = ov.windowStart;
        const windowEndHourIst = ov.windowEnd;
        const dirs = dirChoice === "both" ? ["long", "short"] : [dirChoice];
        return dirs.map((direction) => ({
          label: b.label,
          symbol,
          timeframe,
          strategyPreset,
          execPreset: deployExec,
          riskUsd: deployRisk,
          lookbackDays: 30,
          hoursIst: (windowStartHourIst == null || windowEndHourIst == null) ? b.hours : undefined,
          weekdays: b.weekdays,
          sessions: b.sessions,
          direction,
          windowStartHourIst,
          windowEndHourIst,
        }));
      });
      return deployFn({ data: { target: deployTarget, buckets, replaceExisting } });
    },
    onSuccess: (r) => {
      const parts: string[] = [];
      if (r.live.inserted || r.live.removed) parts.push(`Live: +${r.live.inserted} / −${r.live.removed}`);
      if (r.paper.inserted || r.paper.removed) parts.push(`Paper: +${r.paper.inserted} / −${r.paper.removed}`);
      toast.success(`Deployed. ${parts.join(" · ") || "no changes"}`);
      setSelected(new Set());
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="grid gap-2 grid-cols-2 md:grid-cols-5">
        {(Object.keys(VERDICT_META) as Verdict[]).map((v) => {
          const meta = VERDICT_META[v];
          return (
            <button
              key={v}
              onClick={() => setVerdictFilter(verdictFilter === v ? "all" : v)}
              className={`rounded border p-3 text-left transition ${meta.rowClass} ${verdictFilter === v ? "ring-2 ring-primary" : ""}`}
            >
              <div className="flex items-center justify-between">
                <Badge className={meta.badgeClass}>{meta.label}</Badge>
                <span className="text-xl font-bold">{counts[v]}</span>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">{meta.hint}</div>
            </button>
          );
        })}
      </div>

      {/* Deploy toolbar */}
      <Card className="border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Play className="h-4 w-4" /> Ship selected edges to runners
          </CardTitle>
          <CardDescription className="text-xs">
            Pick rows below → each checked row exposes inline pickers for Symbol · TF · Strategy · Direction · Window (start→end IST). Deploy replaces runners with the same symbol + strategy + timeframe + exec preset.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 items-end">
            <div className="min-w-0">
              <Label className="text-[10px] text-muted-foreground">Target</Label>
              <Select value={deployTarget} onValueChange={(v) => setDeployTarget(v as "live" | "paper" | "both")}>
                <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="paper">Paper only</SelectItem>
                  <SelectItem value="live">Live only</SelectItem>
                  <SelectItem value="both">Both live + paper</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0">
              <Label className="text-[10px] text-muted-foreground">Risk USD / trade</Label>
              <Input type="number" min={1} max={1000} className="h-8 w-full" value={deployRisk} onChange={(e) => setDeployRisk(Number(e.target.value) || 20)} />
            </div>
            <div className="min-w-0">
              <Label className="text-[10px] text-muted-foreground">Exec preset</Label>
              <Select value={deployExec} onValueChange={setDeployExec}>
                <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="conservative_default">conservative_default</SelectItem>
                  <SelectItem value="optimistic_scalper">optimistic_scalper</SelectItem>
                  <SelectItem value="no_management">no_management</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0">
              <Label className="text-[10px] text-muted-foreground">Timeframe</Label>
              <Select value={deployTf} onValueChange={setDeployTf}>
                <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">auto (from bucket)</SelectItem>
                  {["1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"].map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-xs cursor-pointer h-8 px-2 rounded border bg-muted/30">
              <input type="checkbox" checked={replaceExisting} onChange={(e) => setReplaceExisting(e.target.checked)} />
              Replace duplicates
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
            <span className="text-xs text-muted-foreground mr-auto">{selected.size} selected of {rows.length} visible</span>
            <Button size="sm" variant="outline" onClick={selectAllVisible}>Select all ({rows.length})</Button>
            <Button size="sm" variant="ghost" onClick={clearSelection}>Clear</Button>
            <Button size="sm" disabled={!selected.size || deployMut.isPending} onClick={() => deployMut.mutate()}>
              {deployMut.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Play className="mr-1 h-4 w-4" />}
              Deploy {selected.size || ""}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 space-y-3">
          <div>
            <CardTitle className="text-sm">Configuration Verdicts</CardTitle>
            <CardDescription className="text-xs">Every time-bucket ranked by statistical strength. Filter by strategy/tf/symbol, then tick rows to deploy.</CardDescription>
          </div>
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">

            <div className="min-w-0">
              <Label className="text-[10px] text-muted-foreground">Symbol</Label>
              <Select value={symbolFilter} onValueChange={setSymbolFilter}>
                <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {allSymbols.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0">
              <Label className="text-[10px] text-muted-foreground">TF</Label>
              <Select value={tfFilter} onValueChange={setTfFilter}>
                <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {allTfs.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0">
              <Label className="text-[10px] text-muted-foreground">Strategy</Label>
              <Select value={strategyFilter} onValueChange={setStrategyFilter}>
                <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {allStrategies.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0">
              <Label className="text-[10px] text-muted-foreground">Dir</Label>
              <Select value={dirFilter} onValueChange={setDirFilter}>
                <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {allDirections.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0">
              <Label className="text-[10px] text-muted-foreground">Verdict</Label>
              <Select value={verdictFilter} onValueChange={setVerdictFilter}>
                <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {(Object.keys(VERDICT_META) as Verdict[]).map((v) => <SelectItem key={v} value={v}>{VERDICT_META[v].label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0">
              <Label className="text-[10px] text-muted-foreground">Min trades</Label>
              <Input type="number" className="h-8 w-full" value={minTrades} onChange={(e) => setMinTrades(Number(e.target.value) || 0)} />
            </div>
            <div className="min-w-0 col-span-2">
              <Label className="text-[10px] text-muted-foreground">Search</Label>
              <Input className="h-8 w-full" placeholder="e.g. BTC · London" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="min-w-0">
              <Label className="text-[10px] text-muted-foreground">Sort</Label>
              <div className="h-8 flex items-center text-[11px] text-muted-foreground px-2 rounded border border-dashed">
                Click any column header ↕
              </div>
            </div>

          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              {(() => {
                const arrow = (k: SortKey) => sortKey === k ? (sortDir === "desc" ? " ▼" : " ▲") : "";
                const SortTH = ({ k, label, align }: { k: SortKey; label: string; align?: "right" }) => (
                  <TableHead
                    className={`text-xs cursor-pointer select-none hover:bg-muted/50 ${align === "right" ? "text-right" : ""}`}
                    onClick={() => toggleSort(k)}
                  >
                    {label}<span className="text-muted-foreground">{arrow(k)}</span>
                  </TableHead>
                );
                return (
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <SortTH k="verdict" label="Verdict" />
                    <SortTH k="label" label="Bucket" />
                    
                    <SortTH k="symbol" label="Symbol" />
                    <SortTH k="timeframe" label="TF" />
                    <SortTH k="strategy" label="Strategy" />
                    <SortTH k="direction" label="Dir" />
                    <SortTH k="session" label="Session" />
                    <SortTH k="hours" label="Hrs IST" />
                    <SortTH k="weekdays" label="Wkdys" />
                    <SortTH k="trades" label="Trades" align="right" />
                    <SortTH k="expectancy" label="Exp" align="right" />
                    <SortTH k="profitFactor" label="PF" align="right" />
                    <SortTH k="winRate" label="Win%" align="right" />
                    <SortTH k="sharpe" label="Sharpe" align="right" />
                    <SortTH k="confidence" label="Conf" align="right" />
                    <SortTH k="robustness" label="Robustness" />
                    <TableHead className="text-xs">Why</TableHead>
                  </TableRow>
                );
              })()}
            </TableHeader>

            <TableBody>
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={18} className="text-center text-xs text-muted-foreground py-6">No buckets match the current filters.</TableCell></TableRow>
              )}
              {rows.map(({ b, verdict, reasons, positives }) => {
                const meta = VERDICT_META[verdict];
                const id = rowId(b);
                const isSel = selected.has(id);
                const ov = overrides[id] ?? defaultOverride(b);
                const wkLabels = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
                const hrsSorted = [...b.hours].sort((a, x) => a - x);
                const hrOptions = hrsSorted.length ? hrsSorted : Array.from({ length: 24 }, (_, i) => i);
                return (
                  <TableRow key={id} className={meta.rowClass}>
                    <TableCell>
                      <input type="checkbox" checked={isSel} onChange={() => toggle(b)} />
                    </TableCell>
                    <TableCell><Badge className={meta.badgeClass}>{meta.label}</Badge></TableCell>
                    <TableCell className="font-mono text-xs max-w-[180px] truncate" title={b.label}>{b.label}</TableCell>
                    
                    <TableCell className="text-[11px] font-mono w-[140px] max-w-[140px]">
                      {isSel && b.symbols.length > 1 ? (
                        <Select value={ov.symbol} onValueChange={(v) => patchOverride(id, { symbol: v })}>
                          <SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger>
                          <SelectContent>{b.symbols.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                        </Select>
                      ) : (
                        <div className="truncate" title={b.symbols.join(", ")}>{isSel ? ov.symbol : (b.symbols.slice(0, 2).join(",") || "—")}{!isSel && b.symbols.length > 2 ? `+${b.symbols.length - 2}` : ""}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-[11px] w-[110px] max-w-[110px]">
                      {isSel ? (
                        <Select value={ov.timeframe ?? b.timeframes[0] ?? "15m"} onValueChange={(v) => patchOverride(id, { timeframe: v })}>
                          <SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Array.from(new Set([...(b.timeframes ?? []), "1m","3m","5m","15m","30m","1h","4h"])).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : (
                        <div className="truncate" title={b.timeframes.join(", ")}>{b.timeframes.join(",") || "—"}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-[11px] font-mono w-[180px] max-w-[180px]">
                      {isSel && b.strategies.length > 1 ? (
                        <Select value={ov.strategy} onValueChange={(v) => patchOverride(id, { strategy: v })}>
                          <SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger>
                          <SelectContent>{b.strategies.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                        </Select>
                      ) : (
                        <div className="truncate" title={b.strategies.join(", ")}>{isSel ? ov.strategy : (b.strategies.slice(0, 2).join(",") || "—")}{!isSel && b.strategies.length > 2 ? `+${b.strategies.length - 2}` : ""}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-[11px]">
                      {isSel ? (
                        <Select value={ov.direction ?? "both"} onValueChange={(v) => patchOverride(id, { direction: v })}>
                          <SelectTrigger className="h-6 text-[10px] w-20"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="both">both</SelectItem>
                            <SelectItem value="long">long</SelectItem>
                            <SelectItem value="short">short</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <span>{b.directions.join("/") || "—"}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-[11px]">{b.sessions.join("/") || "—"}</TableCell>
                    <TableCell className="text-[10px] font-mono max-w-[180px]">
                      {isSel ? (
                        <div className="flex items-center gap-1">
                          <Select value={String(ov.windowStart ?? hrOptions[0])} onValueChange={(v) => patchOverride(id, { windowStart: Number(v) })}>
                            <SelectTrigger className="h-6 text-[10px] w-16"><SelectValue /></SelectTrigger>
                            <SelectContent>{Array.from({ length: 24 }, (_, i) => i).map((h) => <SelectItem key={h} value={String(h)}>{String(h).padStart(2, "0")}:00</SelectItem>)}</SelectContent>
                          </Select>
                          <span className="text-muted-foreground">→</span>
                          <Select value={String(ov.windowEnd ?? ((hrOptions[hrOptions.length - 1] ?? 23) + 1))} onValueChange={(v) => patchOverride(id, { windowEnd: Number(v) })}>
                            <SelectTrigger className="h-6 text-[10px] w-16"><SelectValue /></SelectTrigger>
                            <SelectContent>{Array.from({ length: 24 }, (_, i) => i + 1).map((h) => <SelectItem key={h} value={String(h)}>{String(h).padStart(2, "0")}:00</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                      ) : (
                        <span title={b.hours.join(",")}>{b.hours.length ? (b.hours.length <= 4 ? b.hours.join(",") : `${b.hours.length} hrs`) : "—"}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-[10px]">{b.weekdays.length ? b.weekdays.map((w) => wkLabels[w] ?? w).join(",") : "—"}</TableCell>
                    <TableCell className="text-right text-xs">{b.trades}</TableCell>
                    <TableCell className={`text-right text-xs ${b.expectancy > 0 ? "text-emerald-500" : "text-red-500"}`}>{b.expectancy.toFixed(2)}</TableCell>
                    <TableCell className="text-right text-xs">{b.profitFactor.toFixed(2)}</TableCell>
                    <TableCell className="text-right text-xs">{(b.winRate * 100).toFixed(1)}</TableCell>
                    <TableCell className="text-right text-xs">{b.sharpe.toFixed(2)}</TableCell>
                    <TableCell className="text-right text-xs">{(b.confidence * 100).toFixed(0)}%</TableCell>
                    <TableCell><RobustnessBar value={b.robustness} /></TableCell>
                    <TableCell className="text-[10px]">
                      {verdict === "elite" || verdict === "strong" ? (
                        <span className="text-emerald-600">{positives.slice(0, 3).join(" · ") || "clean stats"}</span>
                      ) : verdict === "avoid" ? (
                        <span className="text-red-500">{reasons.slice(0, 3).join(" · ")}</span>
                      ) : (
                        <span className="text-muted-foreground">{(reasons.length ? reasons : positives).slice(0, 3).join(" · ")}</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {rows.length >= 200 && (
            <div className="mt-2 text-[10px] text-muted-foreground">Showing top 200 rows — narrow filters to see more.</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Scoring legend</CardTitle></CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-5 text-[11px]">
          <div><Badge className={VERDICT_META.elite.badgeClass}>ELITE</Badge><div className="mt-1 text-muted-foreground">Robustness ≥ 75, ≥30 trades, PF ≥ 1.5, confidence ≥ 90%.</div></div>
          <div><Badge className={VERDICT_META.strong.badgeClass}>STRONG</Badge><div className="mt-1 text-muted-foreground">Robustness ≥ 60, ≥20 trades, PF ≥ 1.3, positive expectancy.</div></div>
          <div><Badge className={VERDICT_META.decent.badgeClass}>DECENT</Badge><div className="mt-1 text-muted-foreground">Robustness ≥ 45, PF ≥ 1.1, positive expectancy.</div></div>
          <div><Badge className={VERDICT_META.weak.badgeClass}>WEAK</Badge><div className="mt-1 text-muted-foreground">Positive but small sample or low significance.</div></div>
          <div><Badge className={VERDICT_META.avoid.badgeClass}>AVOID</Badge><div className="mt-1 text-muted-foreground">Negative expectancy w/ ≥80% confidence, or PF &lt; 0.8.</div></div>
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
