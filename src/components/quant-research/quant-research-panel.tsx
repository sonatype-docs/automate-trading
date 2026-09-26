import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, BarChart3, Database, Loader2, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  getQuantEngineHealth,
  getQuantResearchJob,
  getQuantResearchJobResult,
  listQuantStrategies,
  runQuantBacktest,
  runQuantSweep,
  runQuantWalkForward,
  submitQuantResearchJob,
} from "@/lib/quant-engine.functions";
import { loadEnrichedCandles } from "@/lib/market-data.functions";
import type { Timeframe } from "@/lib/market-data/types";

type Strategy = { strategy_id: string; name: string; description: string };
type QuantResult = {
  run_id: string;
  engine_version: string;
  dataset_fingerprint: string;
  request_fingerprint: string;
  metrics: {
    total_return_pct: number;
    annualized_return_pct: number;
    sharpe: number;
    max_drawdown_pct: number;
    win_rate_pct: number;
    profit_factor: number;
    sortino: number;
    expectancy: number;
    trade_count: number;
  };
};
type SweepRow = { parameters: { risk_per_trade: number; slippage_bps: number }; result: QuantResult };
type WalkRow = { train_start: number; train_end: number; test_start: number; test_end: number; result: QuantResult };

const SPECIALIST = new Set(["STRAT-03-STAT-COINT", "STRAT-06-ORDER-FLOW-DELTA"]);
const TIMEFRAMES: Timeframe[] = ["5m", "15m", "30m", "1h", "4h", "1d"];

const fmt = (n: number | null | undefined, digits = 2) =>
  n == null || !Number.isFinite(n) ? "—" : n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function QuantResearchPanel({
  mode,
  title,
  description,
}: {
  mode: "backtest" | "sweep" | "walk";
  title: string;
  description: string;
}) {
  const health = useQuery({ queryKey: ["quant-engine-health"], queryFn: () => getQuantEngineHealth(), refetchInterval: 30_000 });
  const strategies = useQuery({
    queryKey: ["quant-engine-strategies"],
    queryFn: () => listQuantStrategies() as Promise<Strategy[]>,
    enabled: health.isSuccess,
    staleTime: 5 * 60_000,
  });
  const load = useServerFn(loadEnrichedCandles);
  const backtest = useServerFn(runQuantBacktest);
  const sweep = useServerFn(runQuantSweep);
  const walk = useServerFn(runQuantWalkForward);
  const submitJob = useServerFn(submitQuantResearchJob);
  const statusFn = useServerFn(getQuantResearchJob);
  const resultFn = useServerFn(getQuantResearchJobResult);

  const [symbol, setSymbol] = useState("XAUUSDT");
  const [source, setSource] = useState<"yahoo" | "shark">("yahoo");
  const [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const [days, setDays] = useState(30);
  const [strategyId, setStrategyId] = useState("");
  const [capital, setCapital] = useState(25_000);
  const [risk, setRisk] = useState(0.01);
  const [feeBps, setFeeBps] = useState(4);
  const [slippageBps, setSlippageBps] = useState(1);
  const [result, setResult] = useState<QuantResult | null>(null);
  const [sweepRows, setSweepRows] = useState<SweepRow[] | null>(null);
  const [walkRows, setWalkRows] = useState<WalkRow[] | null>(null);
  const [loaded, setLoaded] = useState<{ count: number; first: number | null; last: number | null } | null>(null);
  const [asyncJobId, setAsyncJobId] = useState<string | null>(null);

  const selected = useMemo(() => (strategies.data ?? []).find((s) => s.strategy_id === strategyId), [strategies.data, strategyId]);
  const specialist = SPECIALIST.has(strategyId);

  const execute = useMutation({
    mutationFn: async () => {
      const toMs = Date.now();
      const data = await load({
        data: {
          source,
          symbol,
          timeframe,
          displayTimezone: "IST",
          strategyTimezone: "London",
          fromMs: toMs - days * 86_400_000,
          toMs,
          maxRows: 5000,
        },
      });
      setLoaded({ count: data.count, first: data.summary.firstTs, last: data.summary.lastTs });
      const bars = data.candles.map((b) => ({
        timestamp: new Date(b.ts).toISOString(),
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: Math.max(0, b.volume),
      }));
      const request = {
        symbol,
        strategy_id: strategyId,
        bars,
        initial_capital: capital,
        risk_per_trade: risk,
        fee_bps: feeBps,
        slippage_bps: slippageBps,
      };
      if (mode === "backtest") return { kind: "backtest" as const, value: await backtest({ data: request }) as QuantResult };
      if (mode === "sweep") {
        return {
          kind: "sweep" as const,
          value: await sweep({
            data: {
              request,
              parameter_grid: {
                risk_per_trade: [Math.max(0.005, risk / 2), risk, Math.min(0.05, risk * 2)],
                slippage_bps: [slippageBps, Math.min(10, slippageBps + 1)],
              },
            },
          }) as SweepRow[],
        };
      }
      return {
        kind: "walk" as const,
        value: await walk({ data: { request, train_bars: 900, test_bars: 450, step_bars: 450 } }) as WalkRow[],
      };
    },
    onSuccess: (out) => {
      setResult(null);
      setSweepRows(null);
      setWalkRows(null);
      if (out.kind === "backtest") setResult(out.value);
      if (out.kind === "sweep") setSweepRows(out.value);
      if (out.kind === "walk") setWalkRows(out.value);
    },
  });

  const asyncJob = useQuery({
    queryKey: ["quant-research-job", asyncJobId],
    queryFn: () => statusFn({ data: { job_id: asyncJobId! } }) as Promise<{ status: string; error?: string | null }>,
    enabled: mode === "backtest" && !!asyncJobId,
    refetchInterval: (q) => ["SUCCEEDED", "FAILED"].includes(q.state.data?.status ?? "") ? false : 2000,
  });
  const asyncResult = useQuery({
    queryKey: ["quant-research-job-result", asyncJobId],
    queryFn: () => resultFn({ data: { job_id: asyncJobId! } }) as Promise<QuantResult>,
    enabled: mode === "backtest" && !!asyncJobId && asyncJob.data?.status === "SUCCEEDED",
    staleTime: Infinity,
  });
  const asyncRun = useMutation({
    mutationFn: async () => {
      const toMs = Date.now();
      const data = await load({
        data: {
          source, symbol, timeframe,
          displayTimezone: "IST",
          strategyTimezone: "London",
          fromMs: toMs - days * 86_400_000,
          toMs,
          maxRows: 5000,
        },
      });
      setLoaded({ count: data.count, first: data.summary.firstTs, last: data.summary.lastTs });
      return submitJob({
        data: {
          symbol,
          strategy_id: strategyId,
          bars: data.candles.map((b) => ({
            timestamp: new Date(b.ts).toISOString(),
            open: b.open, high: b.high, low: b.low, close: b.close,
            volume: Math.max(0, b.volume),
          })),
          initial_capital: capital,
          risk_per_trade: risk,
          fee_bps: feeBps,
          slippage_bps: slippageBps,
        },
      }) as Promise<{ job_id: string }>;
    },
    onSuccess: (job) => setAsyncJobId(job.job_id),
  });

  const canRun = health.isSuccess && !!strategyId && !specialist && !execute.isPending;
  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="h-4 w-4" />{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <Badge variant={health.isSuccess ? "default" : health.isPending ? "secondary" : "destructive"}>
            {health.isSuccess ? "ENGINE ONLINE" : health.isPending ? "CHECKING" : "ENGINE OFFLINE"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
          <div><Label>Source</Label><Select value={source} onValueChange={(v) => setSource(v as "yahoo" | "shark")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="yahoo">Yahoo</SelectItem><SelectItem value="shark">Shark</SelectItem></SelectContent></Select></div>
          <div><Label>Symbol</Label><Input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} /></div>
          <div><Label>Timeframe</Label><Select value={timeframe} onValueChange={(v) => setTimeframe(v as Timeframe)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{TIMEFRAMES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Days</Label><Input type="number" min={5} max={365} value={days} onChange={(e) => setDays(Number(e.target.value) || 30)} /></div>
          <div><Label>Capital</Label><Input type="number" min={1000} value={capital} onChange={(e) => setCapital(Number(e.target.value) || 25000)} /></div>
          <div><Label>Risk</Label><Input type="number" min={0.001} max={0.25} step={0.001} value={risk} onChange={(e) => setRisk(Number(e.target.value) || 0.01)} /></div>
          <div><Label>Fee bps</Label><Input type="number" min={0} value={feeBps} onChange={(e) => setFeeBps(Math.max(0, Number(e.target.value) || 0))} /></div>
          <div><Label>Slip bps</Label><Input type="number" min={0} value={slippageBps} onChange={(e) => setSlippageBps(Math.max(0, Number(e.target.value) || 0))} /></div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[280px] flex-1">
            <Label>Canonical strategy</Label>
            <Select value={strategyId} onValueChange={setStrategyId}>
              <SelectTrigger><SelectValue placeholder="Choose an executable strategy" /></SelectTrigger>
              <SelectContent>{(strategies.data ?? []).map((s) => <SelectItem key={s.strategy_id} value={s.strategy_id}>{s.strategy_id} — {s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button onClick={() => execute.mutate()} disabled={!canRun}>
            
            {execute.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Activity className="h-4 w-4 mr-2" />}
            Run {mode === "backtest" ? "quant backtest" : mode === "sweep" ? "quant sweep" : "walk-forward"}
          </Button>
        </div>

        {selected && <div className="text-xs text-muted-foreground">{selected.description}{specialist && " — specialist strategies require specialist market data and are intentionally gated here."}</div>}
        {loaded && <div className="text-xs rounded border border-border bg-muted/20 p-2 flex items-center gap-2"><Database className="h-3.5 w-3.5" /> Loaded {loaded.count.toLocaleString()} bars · {loaded.first ? new Date(loaded.first).toLocaleDateString() : "—"} → {loaded.last ? new Date(loaded.last).toLocaleDateString() : "—"}</div>}
        {execute.error && <div className="text-xs rounded border border-destructive/40 bg-destructive/10 text-destructive p-2">{execute.error instanceof Error ? execute.error.message : String(execute.error)}</div>}
        {mode === "backtest" && (
          <div className="rounded border border-border bg-muted/20 p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-medium">Async research job</div>
                <div className="text-[11px] text-muted-foreground">Queue the same canonical backtest through SQS/DynamoDB/S3 so long runs survive request timeouts.</div>
              </div>
              <Button variant="secondary" size="sm" onClick={() => asyncRun.mutate()} disabled={!canRun || asyncRun.isPending || (asyncJobId != null && !["SUCCEEDED", "FAILED"].includes(asyncJob.data?.status ?? ""))}>
                {asyncRun.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Activity className="h-4 w-4 mr-2" />}
                Queue backtest
              </Button>
            </div>
            {asyncJobId && <div className="text-[10px] font-mono text-muted-foreground">job {asyncJobId} · {asyncJob.data?.status ?? "QUEUED"}</div>}
            {asyncJob.data?.error && <div className="text-xs text-destructive">{asyncJob.data.error}</div>}
            {asyncResult.data && <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <Metric label="Async return" value={fmt(asyncResult.data.metrics.total_return_pct) + "%"} />
              <Metric label="Sharpe" value={fmt(asyncResult.data.metrics.sharpe)} />
              <Metric label="Max DD" value={fmt(asyncResult.data.metrics.max_drawdown_pct) + "%"} />
              <Metric label="PF" value={fmt(asyncResult.data.metrics.profit_factor)} />
              <Metric label="Trades" value={String(asyncResult.data.metrics.trade_count)} />
            </div>}
          </div>
        )}


        {result && <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Metric label="Return" value={fmt(result.metrics.total_return_pct) + "%"} />
          <Metric label="Sharpe" value={fmt(result.metrics.sharpe)} />
          <Metric label="Max DD" value={fmt(result.metrics.max_drawdown_pct) + "%"} />
          <Metric label="Profit factor" value={fmt(result.metrics.profit_factor)} />
          <Metric label="Trades" value={String(result.metrics.trade_count)} />
        </div>}

        {sweepRows && <div className="overflow-auto rounded border border-border"><table className="w-full text-xs"><thead className="bg-muted/40"><tr><th className="p-2 text-left">Risk</th><th className="p-2 text-left">Slippage</th><th className="p-2 text-right">Return</th><th className="p-2 text-right">Sharpe</th><th className="p-2 text-right">Max DD</th><th className="p-2 text-right">PF</th></tr></thead><tbody>{sweepRows.map((r, i) => <tr key={i} className="border-t border-border/60"><td className="p-2 font-mono">{fmt(r.parameters.risk_per_trade * 100)}%</td><td className="p-2 font-mono">{fmt(r.parameters.slippage_bps)}</td><td className="p-2 text-right font-mono">{fmt(r.result.metrics.total_return_pct)}%</td><td className="p-2 text-right font-mono">{fmt(r.result.metrics.sharpe)}</td><td className="p-2 text-right font-mono">{fmt(r.result.metrics.max_drawdown_pct)}%</td><td className="p-2 text-right font-mono">{fmt(r.result.metrics.profit_factor)}</td></tr>)}</tbody></table></div>}

        {walkRows && <div className="overflow-auto rounded border border-border"><table className="w-full text-xs"><thead className="bg-muted/40"><tr><th className="p-2 text-left">Train</th><th className="p-2 text-left">Test</th><th className="p-2 text-right">Return</th><th className="p-2 text-right">Sharpe</th><th className="p-2 text-right">Max DD</th><th className="p-2 text-right">Trades</th></tr></thead><tbody>{walkRows.map((r, i) => <tr key={i} className="border-t border-border/60"><td className="p-2 font-mono">{r.train_end - r.train_start}</td><td className="p-2 font-mono">{r.test_end - r.test_start}</td><td className="p-2 text-right font-mono">{fmt(r.result.metrics.total_return_pct)}%</td><td className="p-2 text-right font-mono">{fmt(r.result.metrics.sharpe)}</td><td className="p-2 text-right font-mono">{fmt(r.result.metrics.max_drawdown_pct)}%</td><td className="p-2 text-right font-mono">{r.result.metrics.trade_count}</td></tr>)}</tbody></table></div>}

        {!selected && <div className="text-xs text-muted-foreground flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5" />Research execution is isolated from live trading.</div>}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded border border-border p-2"><div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div><div className="mt-1 text-sm font-semibold font-mono">{value}</div></div>;
}
