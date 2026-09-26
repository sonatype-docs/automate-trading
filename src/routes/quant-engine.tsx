import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Activity, BarChart3, Cpu, Database, Loader2, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getQuantEngineHealth, listQuantStrategies, runQuantBacktest, runQuantSweep, runQuantWalkForward, runQuantPairBacktest, runQuantOrderFlowReplay } from "@/lib/quant-engine.functions";
import { loadEnrichedCandles } from "@/lib/market-data.functions";
import { TIMEFRAMES, type Timeframe } from "@/lib/market-data/types";

type Strategy = { strategy_id: string; name: string; description: string };
type QuantBacktestResult = {
  run_id: string;
  symbol: string;
  strategy_id: string;
  engine_version: string;
  request_fingerprint: string;
  dataset_fingerprint: string;
  metrics: {
    total_return_pct: number;
    annualized_return_pct: number;
    sharpe: number;
    sortino: number;
    profit_factor: number | null;
    max_drawdown_pct: number;
    win_rate_pct: number;
    expectancy: number;
    trade_count: number;
  };
  trades: Array<{
    entry_time: string;
    exit_time: string;
    side: "BUY" | "SELL";
    entry_price: number;
    exit_price: number;
    quantity: number;
    net_pnl: number;
  }>;
};
type SweepRow = { parameters: Record<string, number>; result: QuantBacktestResult };
type WalkRow = { train_start: number; train_end: number; test_start: number; test_end: number; result: QuantBacktestResult };
type PairResult = { run_id: string; x_symbol: string; y_symbol: string; engine_version: string; metrics: { total_return_pct: number; annualized_return_pct: number; sharpe: number; max_drawdown_pct: number; profit_factor: number | null; win_rate_pct: number; trade_count: number }; trades: Array<{ entry_time: string; exit_time: string; direction: string; hedge_ratio: number; entry_z: number; exit_z: number; net_pnl: number }> };

const SPECIALIST_STRATEGIES = new Set(["STRAT-03-STAT-COINT", "STRAT-06-ORDER-FLOW-DELTA"]);

function fmt(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const Route = createFileRoute("/quant-engine")({
  component: QuantEnginePage,
  head: () => ({
    meta: [
      { title: "Quant Engine — Executable Research Core" },
      { name: "description", content: "Run canonical strategy backtests, parameter sweeps and walk-forward validation from the production trading platform." },
    ],
  }),
});

function QuantEnginePage() {
  const health = useQuery({
    queryKey: ["quant-engine-health"],
    queryFn: () => getQuantEngineHealth(),
    refetchInterval: 30_000,
  });
  const strategies = useQuery({
    queryKey: ["quant-engine-strategies"],
    queryFn: () => listQuantStrategies() as Promise<Strategy[]>,
    enabled: health.isSuccess,
  });

  const loadFn = useServerFn(loadEnrichedCandles);
  const backtestFn = useServerFn(runQuantBacktest);
  const sweepFn = useServerFn(runQuantSweep);
  const walkFn = useServerFn(runQuantWalkForward);
  const pairFn = useServerFn(runQuantPairBacktest);
  const orderFlowFn = useServerFn(runQuantOrderFlowReplay);

  const [symbol, setSymbol] = useState("XAUUSDT");
  const [source, setSource] = useState<"yahoo" | "shark">("yahoo");
  const [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const [days, setDays] = useState(30);
  const [strategyId, setStrategyId] = useState("");
  const [capital, setCapital] = useState(25000);
  const [risk, setRisk] = useState(0.01);
  const [feeBps, setFeeBps] = useState(4);
  const [slippageBps, setSlippageBps] = useState(1);
  const [loadedMeta, setLoadedMeta] = useState<{ count: number; firstTs: number | null; lastTs: number | null } | null>(null);
  const [backtest, setBacktest] = useState<QuantBacktestResult | null>(null);
  const [sweep, setSweep] = useState<SweepRow[] | null>(null);
  const [walk, setWalk] = useState<WalkRow[] | null>(null);
  const [pairSymbol, setPairSymbol] = useState("BTCUSDT");
  const [pairResult, setPairResult] = useState<PairResult | null>(null);
  const [orderFlowJson, setOrderFlowJson] = useState("");
  const [orderFlowResult, setOrderFlowResult] = useState<any>(null);

  const selectedStrategy = useMemo(
    () => (strategies.data ?? []).find((s) => s.strategy_id === strategyId) ?? null,
    [strategies.data, strategyId],
  );
  const specialistOnly = strategyId ? SPECIALIST_STRATEGIES.has(strategyId) : false;

  const request = async () => {
    const toMs = Date.now();
    const loaded = await loadFn({
      data: {
        source,
        symbol,
        timeframe,
        displayTimezone: "IST",
        strategyTimezone: "London",
        fromMs: toMs - days * 86400000,
        toMs,
        maxRows: 5000,
      },
    });
    setLoadedMeta({ count: loaded.count, firstTs: loaded.summary.firstTs, lastTs: loaded.summary.lastTs });
    return {
      bars: loaded.candles.map((bar) => ({
        timestamp: new Date(bar.ts).toISOString(),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: Math.max(0, bar.volume),
      })),
    };
  };

  const loadData = useMutation({
    mutationFn: request,
    onSuccess: () => {
      setBacktest(null);
      setSweep(null);
      setWalk(null);
    },
  });

  const backtestRun = useMutation({
    mutationFn: async () => {
      const loaded = await request();
      return backtestFn({
        data: {
          symbol,
          strategy_id: strategyId,
          bars: loaded.bars,
          initial_capital: capital,
          risk_per_trade: risk,
          fee_bps: feeBps,
          slippage_bps: slippageBps,
        },
      }) as Promise<QuantBacktestResult>;
    },
    onSuccess: (result) => {
      setBacktest(result);
      setSweep(null);
      setWalk(null);
    },
  });

  const sweepRun = useMutation({
    mutationFn: async () => {
      const loaded = await request();
      return sweepFn({
        data: {
          request: {
            symbol,
            strategy_id: strategyId,
            bars: loaded.bars,
            initial_capital: capital,
            risk_per_trade: risk,
            fee_bps: feeBps,
            slippage_bps: slippageBps,
          },
          parameter_grid: {
            risk_per_trade: [Math.max(0.005, risk / 2), risk, Math.min(0.05, risk * 2)],
            slippage_bps: [slippageBps, Math.min(10, slippageBps + 1)],
          },
        },
      }) as Promise<SweepRow[]>;
    },
    onSuccess: (result) => {
      setSweep(result);
      setBacktest(null);
      setWalk(null);
    },
  });

  const walkRun = useMutation({
    mutationFn: async () => {
      const loaded = await request();
      return walkFn({
        data: {
          request: {
            symbol,
            strategy_id: strategyId,
            bars: loaded.bars,
            initial_capital: capital,
            risk_per_trade: risk,
            fee_bps: feeBps,
            slippage_bps: slippageBps,
          },
          train_bars: 900,
          test_bars: 450,
          step_bars: 450,
        },
      }) as Promise<WalkRow[]>;
    },
    onSuccess: (result) => {
      setWalk(result);
      setBacktest(null);
      setSweep(null);
    },
  });

  const pairRun = useMutation({
    mutationFn: async () => {
      const now = Date.now();
      const [x, y] = await Promise.all([
        loadFn({ data: { source, symbol, timeframe, displayTimezone: "IST", strategyTimezone: "London", fromMs: now - days * 86400000, toMs: now, maxRows: 5000 } }),
        loadFn({ data: { source, symbol: pairSymbol, timeframe, displayTimezone: "IST", strategyTimezone: "London", fromMs: now - days * 86400000, toMs: now, maxRows: 5000 } }),
      ]);
      return pairFn({ data: {
        x_symbol: symbol, y_symbol: pairSymbol,
        x_bars: x.candles.map((b) => ({ timestamp: new Date(b.ts).toISOString(), open: b.open, high: b.high, low: b.low, close: b.close, volume: Math.max(0, b.volume) })),
        y_bars: y.candles.map((b) => ({ timestamp: new Date(b.ts).toISOString(), open: b.open, high: b.high, low: b.low, close: b.close, volume: Math.max(0, b.volume) })),
        initial_capital: capital, risk_per_trade: risk, fee_bps: feeBps, slippage_bps: slippageBps,
      } }) as Promise<PairResult>;
    },
    onSuccess: (result) => setPairResult(result),
  });

  const runError = backtestRun.error ?? sweepRun.error ?? walkRun.error ?? pairRun.error ?? loadData.error;
  const dateRange = loadedMeta
    ? " · " + (loadedMeta.firstTs ? new Date(loadedMeta.firstTs).toLocaleDateString() : "—") +
      " → " + (loadedMeta.lastTs ? new Date(loadedMeta.lastTs).toLocaleDateString() : "—")
    : "";

  return (
    <main className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">QUANT ENGINE</div>
          <h1 className="text-2xl font-semibold tracking-tight mt-1">Executable Research Core</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">Canonical strategy rules, deterministic backtests, parameter sweeps and walk-forward validation run through the embedded Python engine while the existing trading UI remains intact.</p>
        </div>
        <Badge variant={health.isSuccess ? "default" : "destructive"}>{health.isSuccess ? "ENGINE ONLINE" : health.isPending ? "CHECKING" : "ENGINE OFFLINE"}</Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card><CardHeader><CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" /> Engine</CardTitle></CardHeader><CardContent className="text-xs text-muted-foreground">{health.isSuccess ? "Sidecar API reachable inside the application task." : errorText(health.error)}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm flex items-center gap-2"><Database className="h-4 w-4" /> Data</CardTitle></CardHeader><CardContent className="text-xs text-muted-foreground">Existing Market Data Engine → normalized OHLCV → canonical quant engine.</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm flex items-center gap-2"><Cpu className="h-4 w-4" /> Registry</CardTitle></CardHeader><CardContent><div className="font-mono text-2xl">{strategies.data?.length ?? "—"}</div><div className="text-xs text-muted-foreground">executable strategy contracts</div></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Execution</CardTitle></CardHeader><CardContent className="text-xs text-muted-foreground">Research is isolated; live execution remains behind an explicit broker/risk boundary.</CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Research Controls</CardTitle><CardDescription>Use the platform's existing market-data service as the source of canonical bars.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <div><Label>Source</Label><Select value={source} onValueChange={(v) => setSource(v as "yahoo" | "shark")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="yahoo">Yahoo</SelectItem><SelectItem value="shark">Shark</SelectItem></SelectContent></Select></div>
            <div><Label>Symbol</Label><Input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} /></div>
            <div><Label>Timeframe</Label><Select value={timeframe} onValueChange={(v) => setTimeframe(v as Timeframe)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{TIMEFRAMES.map((tf) => <SelectItem key={tf} value={tf}>{tf}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>History (days)</Label><Input type="number" min={5} max={365} value={days} onChange={(e) => setDays(Number(e.target.value) || 30)} /></div>
            <div><Label>Initial capital</Label><Input type="number" min={1000} value={capital} onChange={(e) => setCapital(Number(e.target.value) || 25000)} /></div>
            <div><Label>Risk / trade</Label><Input type="number" min={0.001} max={0.25} step={0.001} value={risk} onChange={(e) => setRisk(Number(e.target.value) || 0.01)} /></div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div><Label>Fee (bps)</Label><Input type="number" min={0} value={feeBps} onChange={(e) => setFeeBps(Number(e.target.value) || 0)} /></div>
            <div><Label>Slippage (bps)</Label><Input type="number" min={0} value={slippageBps} onChange={(e) => setSlippageBps(Number(e.target.value) || 0)} /></div>
            <div className="md:col-span-2 flex items-end"><div className="w-full rounded border border-border px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">Strategy</span>{specialistOnly && <Badge variant="outline">Specialist data required</Badge>}</div>
              <Select value={strategyId} onValueChange={setStrategyId}><SelectTrigger className="mt-1"><SelectValue placeholder="Choose an executable strategy" /></SelectTrigger><SelectContent>{(strategies.data ?? []).map((strategy) => <SelectItem key={strategy.strategy_id} value={strategy.strategy_id}>{strategy.strategy_id} — {strategy.name}</SelectItem>)}</SelectContent></Select>
            </div></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => loadData.mutate()} disabled={loadData.isPending || !strategyId}><Database className="h-4 w-4 mr-2" />{loadData.isPending ? "Loading…" : "Load market data"}</Button>
            {selectedStrategy && <div className="text-xs text-muted-foreground self-center max-w-2xl">{selectedStrategy.description}</div>}
          </div>
          {loadedMeta && <div className="rounded border border-border bg-muted/20 p-3 text-xs">Loaded {loadedMeta.count.toLocaleString()} bars available to the quant run{dateRange}.</div>}
          {runError && <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{errorText(runError)}</div>}
        </CardContent>
      </Card>

      <Tabs defaultValue="backtest">
        <TabsList><TabsTrigger value="backtest">Backtest</TabsTrigger><TabsTrigger value="sweep">Parameter Sweep</TabsTrigger><TabsTrigger value="walk">Walk-Forward</TabsTrigger><TabsTrigger value="pair">Pair / Stat-Arb</TabsTrigger></TabsList>
        <TabsContent value="backtest" className="mt-4 space-y-4">
          <Card><CardHeader><CardTitle className="text-sm">Canonical Strategy Backtest</CardTitle><CardDescription>Deterministic execution with fees, slippage and risk sizing.</CardDescription></CardHeader><CardContent><Button onClick={() => backtestRun.mutate()} disabled={backtestRun.isPending || !strategyId || specialistOnly || !health.isSuccess}>{backtestRun.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <BarChart3 className="h-4 w-4 mr-2" />}Run canonical backtest</Button></CardContent></Card>
          {backtest && <BacktestResultView result={backtest} />}
        </TabsContent>
        <TabsContent value="sweep" className="mt-4 space-y-4">
          <Card><CardHeader><CardTitle className="text-sm">Risk + Slippage Sweep</CardTitle><CardDescription>Scans a compact, reproducible parameter grid against the same dataset.</CardDescription></CardHeader><CardContent><Button onClick={() => sweepRun.mutate()} disabled={sweepRun.isPending || !strategyId || specialistOnly || !health.isSuccess}>{sweepRun.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <BarChart3 className="h-4 w-4 mr-2" />}Run parameter sweep</Button></CardContent></Card>
          {sweep && <SweepView rows={sweep} />}
        </TabsContent>
        <TabsContent value="pair" className="mt-4 space-y-4">
          <Card><CardHeader><CardTitle className="text-sm">Pair Spread / Stat-Arb</CardTitle><CardDescription>Aligned two-symbol spread backtest using rolling hedge ratio and z-score entry/exit. This models the spread; it does not claim a formal cointegration test.</CardDescription></CardHeader><CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div><Label>Leg X</Label><Input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} /></div>
              <div><Label>Leg Y</Label><Input value={pairSymbol} onChange={(e) => setPairSymbol(e.target.value.toUpperCase())} /></div>
              <div><Label>Entry Z</Label><Input value="2.0" readOnly /></div>
              <div><Label>Window</Label><Input value="60" readOnly /></div>
            </div>
            <Button onClick={() => pairRun.mutate()} disabled={pairRun.isPending || !health.isSuccess || !pairSymbol || pairSymbol === symbol}>{pairRun.isPending ? "Running pair backtest…" : "Run pair backtest"}</Button>
          </CardContent></Card>
          {pairResult && <PairResultView result={pairResult} />}
        </TabsContent>

        <TabsContent value="walk" className="mt-4 space-y-4">
          <Card><CardHeader><CardTitle className="text-sm">Walk-Forward Validation</CardTitle><CardDescription>900-bar train / 450-bar test windows stepped by 450 bars to expose stability across time.</CardDescription></CardHeader><CardContent><Button onClick={() => walkRun.mutate()} disabled={walkRun.isPending || !strategyId || specialistOnly || !health.isSuccess}>{walkRun.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <BarChart3 className="h-4 w-4 mr-2" />}Run walk-forward</Button></CardContent></Card>
          {walk && <WalkView rows={walk} />}
        </TabsContent>
      </Tabs>

      <Card><CardHeader><CardTitle className="text-sm">Canonical Strategy Registry</CardTitle><CardDescription>IDs are sourced from the embedded engine, not duplicated in the UI.</CardDescription></CardHeader><CardContent className="grid grid-cols-1 md:grid-cols-2 gap-2">{(strategies.data ?? []).map((s) => (
        <div key={s.strategy_id} className="rounded border border-border p-3"><div className="flex items-center justify-between gap-2"><span className="font-mono text-xs">{s.strategy_id}</span><Badge variant={SPECIALIST_STRATEGIES.has(s.strategy_id) ? "outline" : "default"}>{SPECIALIST_STRATEGIES.has(s.strategy_id) ? "specialist" : "bar-native"}</Badge></div><p className="text-xs text-muted-foreground mt-2">{s.name} — {s.description}</p></div>
      ))}</CardContent></Card>
    </main>
  );
}

function Metric({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="rounded border border-border p-3"><div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div><div className={mono ? "mt-1 text-sm font-mono" : "mt-1 text-sm font-semibold"}>{value}</div></div>;
}

function BacktestResultView({ result }: { result: QuantBacktestResult }) {
  const m = result.metrics;
  return <Card><CardHeader><CardTitle className="text-sm">Backtest Result</CardTitle><CardDescription>Run {result.run_id} · engine {result.engine_version} · dataset {result.dataset_fingerprint.slice(0, 12)}…</CardDescription></CardHeader><CardContent className="space-y-4">
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <Metric label="Return" value={fmt(m.total_return_pct) + "%"} /><Metric label="Annualized" value={fmt(m.annualized_return_pct) + "%"} /><Metric label="Sharpe" value={fmt(m.sharpe)} /><Metric label="Max DD" value={fmt(m.max_drawdown_pct) + "%"} /><Metric label="Win rate" value={fmt(m.win_rate_pct) + "%"} /><Metric label="Profit factor" value={fmt(m.profit_factor)} /><Metric label="Sortino" value={fmt(m.sortino)} /><Metric label="Expectancy" value={fmt(m.expectancy)} /><Metric label="Trades" value={m.trade_count.toLocaleString()} /><Metric label="Fingerprint" value={result.request_fingerprint.slice(0, 12) + "…"} mono />
    </div>
    <div className="rounded border border-border overflow-auto"><table className="w-full text-xs"><thead className="bg-muted/40"><tr><th className="p-2 text-left">Side</th><th className="p-2 text-left">Entry</th><th className="p-2 text-left">Exit</th><th className="p-2 text-right">Entry px</th><th className="p-2 text-right">Exit px</th><th className="p-2 text-right">Net PnL</th></tr></thead><tbody>{result.trades.slice(-12).reverse().map((t, i) => (
      <tr key={t.entry_time + "-" + i} className="border-t border-border/60"><td className="p-2 font-mono">{t.side}</td><td className="p-2">{new Date(t.entry_time).toLocaleString()}</td><td className="p-2">{new Date(t.exit_time).toLocaleString()}</td><td className="p-2 text-right font-mono">{fmt(t.entry_price, 3)}</td><td className="p-2 text-right font-mono">{fmt(t.exit_price, 3)}</td><td className="p-2 text-right font-mono">{fmt(t.net_pnl)}</td></tr>
    ))}</tbody></table></div>
  </CardContent></Card>;
}

function PairResultView({ result }: { result: PairResult }) {
  const m = result.metrics;
  return <Card><CardHeader><CardTitle className="text-sm">Pair Backtest Result</CardTitle><CardDescription>{result.x_symbol} / {result.y_symbol} · run {result.run_id} · engine {result.engine_version}</CardDescription></CardHeader><CardContent className="space-y-4">
    <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
      <Metric label="Return" value={fmt(m.total_return_pct) + "%"} /><Metric label="Annualized" value={fmt(m.annualized_return_pct) + "%"} /><Metric label="Sharpe" value={fmt(m.sharpe)} /><Metric label="Max DD" value={fmt(m.max_drawdown_pct) + "%"} /><Metric label="PF" value={fmt(m.profit_factor)} /><Metric label="Trades" value={String(m.trade_count)} />
    </div>
    <div className="rounded border border-border overflow-auto"><table className="w-full text-xs"><thead><tr><th className="p-2 text-left">Direction</th><th className="p-2 text-left">Entry</th><th className="p-2 text-left">Exit</th><th className="p-2 text-right">Beta</th><th className="p-2 text-right">Entry Z</th><th className="p-2 text-right">PnL</th></tr></thead><tbody>{result.trades.slice().reverse().map((t, i) => <tr key={i} className="border-t border-border/60"><td className="p-2">{t.direction}</td><td className="p-2">{new Date(t.entry_time).toLocaleString()}</td><td className="p-2">{new Date(t.exit_time).toLocaleString()}</td><td className="p-2 text-right font-mono">{fmt(t.hedge_ratio, 4)}</td><td className="p-2 text-right font-mono">{fmt(t.entry_z)}</td><td className="p-2 text-right font-mono">{fmt(t.net_pnl)}</td></tr>)}</tbody></table></div>
  </CardContent></Card>;
}

function SweepView({ rows }: { rows: SweepRow[] }) {
  return <Card><CardHeader><CardTitle className="text-sm">Sweep Results</CardTitle></CardHeader><CardContent className="overflow-auto"><table className="w-full text-xs"><thead className="bg-muted/40"><tr><th className="p-2 text-left">Risk</th><th className="p-2 text-left">Slippage</th><th className="p-2 text-right">Return</th><th className="p-2 text-right">Sharpe</th><th className="p-2 text-right">Max DD</th><th className="p-2 text-right">PF</th><th className="p-2 text-right">Trades</th></tr></thead><tbody>{rows.map((row, i) => (
    <tr key={i} className="border-t border-border/60"><td className="p-2 font-mono">{fmt(row.parameters.risk_per_trade * 100) + "%"}</td><td className="p-2 font-mono">{fmt(row.parameters.slippage_bps)}</td><td className="p-2 text-right font-mono">{fmt(row.result.metrics.total_return_pct) + "%"}</td><td className="p-2 text-right font-mono">{fmt(row.result.metrics.sharpe)}</td><td className="p-2 text-right font-mono">{fmt(row.result.metrics.max_drawdown_pct) + "%"}</td><td className="p-2 text-right font-mono">{fmt(row.result.metrics.profit_factor)}</td><td className="p-2 text-right font-mono">{row.result.metrics.trade_count}</td></tr>
  ))}</tbody></table></CardContent></Card>;
}

function WalkView({ rows }: { rows: WalkRow[] }) {
  return <Card><CardHeader><CardTitle className="text-sm">Walk-Forward Windows</CardTitle></CardHeader><CardContent className="overflow-auto"><table className="w-full text-xs"><thead className="bg-muted/40"><tr><th className="p-2 text-left">Train bars</th><th className="p-2 text-left">Test bars</th><th className="p-2 text-right">Return</th><th className="p-2 text-right">Sharpe</th><th className="p-2 text-right">Max DD</th><th className="p-2 text-right">Trades</th></tr></thead><tbody>{rows.map((row, i) => (
    <tr key={i} className="border-t border-border/60"><td className="p-2 font-mono">{row.train_end - row.train_start}</td><td className="p-2 font-mono">{row.test_end - row.test_start}</td><td className="p-2 text-right font-mono">{fmt(row.result.metrics.total_return_pct) + "%"}</td><td className="p-2 text-right font-mono">{fmt(row.result.metrics.sharpe)}</td><td className="p-2 text-right font-mono">{fmt(row.result.metrics.max_drawdown_pct) + "%"}</td><td className="p-2 text-right font-mono">{row.result.metrics.trade_count}</td></tr>
  ))}</tbody></table></CardContent></Card>;
}
