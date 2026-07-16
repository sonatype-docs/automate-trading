import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  listLiveRunners, listLiveTrades, setLiveRunnerRunning,
  runLiveTickNow, updateLiveRunner, cancelLiveOrder, testLiveConnection,
  type LiveRunnerDTO, type LiveTradeDTO,
} from "@/lib/live-trading.functions";
import { PlayCircle, StopCircle, RefreshCw, AlertTriangle, X, Plug } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StrategyPerformanceCard } from "@/components/strategy-performance-card";

export const Route = createFileRoute("/live-trading")({
  head: () => ({
    meta: [
      { title: "Live Trading Bot" },
      { name: "description", content: "Real-money trading bot on SharkExchange." },
    ],
  }),
  component: LiveTradingPage,
});

const fmtUsd = (n: number | null | undefined) =>
  n == null ? "—" : `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
const fmtTs = (s: string | null) => (s ? new Date(s).toLocaleString() : "—");

function LiveTradingPage() {
  const qc = useQueryClient();
  const runnersFn = useServerFn(listLiveRunners);
  const tradesFn = useServerFn(listLiveTrades);
  const setRun = useServerFn(setLiveRunnerRunning);
  const tickNow = useServerFn(runLiveTickNow);
  const update = useServerFn(updateLiveRunner);
  const cancel = useServerFn(cancelLiveOrder);

  const runners = useQuery({
    queryKey: ["live-runners"], queryFn: () => runnersFn(), refetchInterval: 5000,
  });
  const trades = useQuery({
    queryKey: ["live-trades"], queryFn: () => tradesFn({ data: { limit: 500 } }), refetchInterval: 5000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["live-runners"] });
    qc.invalidateQueries({ queryKey: ["live-trades"] });
  };

  const toggle = useMutation({
    mutationFn: (v: { id: string; running: boolean }) => setRun({ data: v }),
    onSuccess: invalidate,
  });
  const tick = useMutation({ mutationFn: () => tickNow(), onSuccess: invalidate });
  const upd = useMutation({
    mutationFn: (v: { id: string; risk_usd?: number; leverage?: number }) => update({ data: v }),
    onSuccess: invalidate,
  });
  const cx = useMutation({
    mutationFn: (id: string) => cancel({ data: { trade_id: id } }),
    onSuccess: invalidate,
  });

  const runnersList = runners.data ?? [];
  const tradesList = trades.data ?? [];
  const openTrades = tradesList.filter((t) => t.status === "open" || t.status === "pending");
  const closedTrades = tradesList.filter((t) => t.status === "closed" || t.status === "cancelled");
  const errorTrades = tradesList.filter((t) => t.status === "error");
  const totalPnl = closedTrades.reduce((s, t) => s + Number(t.net_pnl ?? 0), 0);

  return (
    <AppShell>
      <Tabs defaultValue="dashboard" className="space-y-6">
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="performance">Strategy performance</TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard" className="space-y-6">
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 flex gap-3">
          <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-destructive">Real-money mode — SharkExchange</p>
            <p className="text-muted-foreground">
              Every entry signal places a live market order with an attached stop-loss and take-profit.
              Position size is auto-computed so a stop hit ≈ your configured risk in USD. Start with a small risk value.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Live runners</CardTitle>
            <Button size="sm" variant="outline" onClick={() => tick.mutate()} disabled={tick.isPending}>
              <RefreshCw className={`h-4 w-4 mr-1 ${tick.isPending ? "animate-spin" : ""}`} />
              Tick now
            </Button>
          </CardHeader>
          <CardContent>
            <RunnersTable
              runners={runnersList}
              onToggle={(r) => {
                if (!r.running && !confirm(`Start LIVE trading for ${r.label}? Real orders will be placed.`)) return;
                toggle.mutate({ id: r.id, running: !r.running });
              }}
              onSave={(v) => upd.mutate(v)}
            />
            <p className="text-xs text-muted-foreground mt-3">
              A background job polls every minute. When the strategy fires an entry, a market order is sent to SharkExchange
              with the stop &amp; target attached. Exits are detected on the next tick.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Open live orders ({openTrades.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <OpenTable trades={openTrades} onCancel={(id) => {
              if (confirm("Cancel this live order on the exchange?")) cx.mutate(id);
            }} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Closed live trades</CardTitle>
            <span className={`text-sm font-medium ${totalPnl >= 0 ? "text-emerald-500" : "text-destructive"}`}>
              Total realised: {fmtUsd(totalPnl)}
            </span>
          </CardHeader>
          <CardContent>
            <ClosedTable trades={closedTrades} />
          </CardContent>
        </Card>

        {errorTrades.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-destructive">Order errors</CardTitle></CardHeader>
            <CardContent>
              <ErrorsTable trades={errorTrades} />
            </CardContent>
          </Card>
        )}
        </TabsContent>
        <TabsContent value="performance">
          <StrategyPerformanceCard defaultMode="live" lockMode showStrategyFilter />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

function RunnersTable({ runners, onToggle, onSave }: {
  runners: LiveRunnerDTO[];
  onToggle: (r: LiveRunnerDTO) => void;
  onSave: (v: { id: string; risk_usd?: number; leverage?: number }) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Label</TableHead>
          <TableHead>Symbol / TF</TableHead>
          <TableHead>Strategy</TableHead>
          <TableHead>Risk $</TableHead>
          <TableHead>Leverage</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Last tick</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runners.map((r) => <RunnerRow key={r.id} r={r} onToggle={onToggle} onSave={onSave} />)}
        {runners.length === 0 && (
          <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No live runners</TableCell></TableRow>
        )}
      </TableBody>
    </Table>
  );
}

function RunnerRow({ r, onToggle, onSave }: {
  r: LiveRunnerDTO;
  onToggle: (r: LiveRunnerDTO) => void;
  onSave: (v: { id: string; risk_usd?: number; leverage?: number }) => void;
}) {
  const [risk, setRisk] = useState(String(r.risk_usd));
  const [lev, setLev] = useState(String(r.leverage));
  const dirty = Number(risk) !== Number(r.risk_usd) || Number(lev) !== Number(r.leverage);
  return (
    <TableRow>
      <TableCell className="font-medium">{r.label}</TableCell>
      <TableCell>{r.symbol} · {r.timeframe}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{r.strategy_preset}</TableCell>
      <TableCell>
        <Input value={risk} onChange={(e) => setRisk(e.target.value)}
          disabled={r.running} className="h-8 w-20" inputMode="decimal" />
      </TableCell>
      <TableCell>
        <Input value={lev} onChange={(e) => setLev(e.target.value)}
          disabled={r.running} className="h-8 w-16" inputMode="numeric" />
      </TableCell>
      <TableCell>
        {r.running ? <Badge className="bg-destructive text-destructive-foreground">LIVE</Badge> : <Badge variant="outline">Stopped</Badge>}
        {r.last_tick_error ? <div className="text-xs text-destructive mt-1 max-w-xs truncate" title={r.last_tick_error}>{r.last_tick_error}</div> : null}
      </TableCell>
      <TableCell className="text-xs">{fmtTs(r.last_tick_at)}</TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          {dirty && !r.running && (
            <Button size="sm" variant="secondary" onClick={() =>
              onSave({ id: r.id, risk_usd: Number(risk), leverage: Number(lev) })
            }>Save</Button>
          )}
          <Button size="sm" variant={r.running ? "destructive" : "default"} onClick={() => onToggle(r)}>
            {r.running
              ? <><StopCircle className="h-3.5 w-3.5 mr-1" />Stop</>
              : <><PlayCircle className="h-3.5 w-3.5 mr-1" />Start</>}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function OpenTable({ trades, onCancel }: { trades: LiveTradeDTO[]; onCancel: (id: string) => void }) {
  if (!trades.length) return <p className="text-sm text-muted-foreground">No open live orders.</p>;
  return (
    <Table>
      <TableHeader><TableRow>
        <TableHead>Symbol</TableHead><TableHead>Dir</TableHead><TableHead>Qty</TableHead>
        <TableHead>Entry</TableHead><TableHead>Stop</TableHead><TableHead>Target</TableHead>
        <TableHead>Status</TableHead><TableHead>Since</TableHead><TableHead className="text-right"> </TableHead>
      </TableRow></TableHeader>
      <TableBody>
        {trades.map((t) => (
          <TableRow key={t.id}>
            <TableCell>{t.symbol}</TableCell>
            <TableCell><Badge variant={t.direction === "long" ? "default" : "destructive"}>{t.direction}</Badge></TableCell>
            <TableCell>{Number(t.qty).toFixed(3)}</TableCell>
            <TableCell>{Number(t.fill_price ?? t.entry_price).toFixed(2)}</TableCell>
            <TableCell>{Number(t.stop_price).toFixed(2)}</TableCell>
            <TableCell>{Number(t.target_price).toFixed(2)}</TableCell>
            <TableCell><Badge variant="outline">{t.status}</Badge></TableCell>
            <TableCell className="text-xs">{fmtTs(t.entry_ts)}</TableCell>
            <TableCell className="text-right">
              <Button size="sm" variant="ghost" onClick={() => onCancel(t.id)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ClosedTable({ trades }: { trades: LiveTradeDTO[] }) {
  if (!trades.length) return <p className="text-sm text-muted-foreground">No closed live trades yet.</p>;
  return (
    <div className="max-h-[500px] overflow-auto">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Symbol</TableHead><TableHead>Dir</TableHead>
          <TableHead>Entry</TableHead><TableHead>Exit</TableHead><TableHead>Reason</TableHead>
          <TableHead>RR</TableHead><TableHead className="text-right">Net PnL</TableHead><TableHead>Closed</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {trades.map((t) => (
            <TableRow key={t.id}>
              <TableCell>{t.symbol}</TableCell>
              <TableCell><Badge variant={t.direction === "long" ? "default" : "destructive"}>{t.direction}</Badge></TableCell>
              <TableCell>{Number(t.fill_price ?? t.entry_price).toFixed(2)}</TableCell>
              <TableCell>{t.exit_price != null ? Number(t.exit_price).toFixed(2) : "—"}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{t.exit_reason ?? "—"}</TableCell>
              <TableCell>{t.rr != null ? Number(t.rr).toFixed(2) : "—"}</TableCell>
              <TableCell className={`text-right font-medium ${Number(t.net_pnl ?? 0) >= 0 ? "text-emerald-500" : "text-destructive"}`}>
                {fmtUsd(t.net_pnl)}
              </TableCell>
              <TableCell className="text-xs">{fmtTs(t.exit_ts)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ErrorsTable({ trades }: { trades: LiveTradeDTO[] }) {
  return (
    <Table>
      <TableHeader><TableRow>
        <TableHead>When</TableHead><TableHead>Symbol</TableHead><TableHead>Dir</TableHead><TableHead>Error</TableHead>
      </TableRow></TableHeader>
      <TableBody>
        {trades.map((t) => (
          <TableRow key={t.id}>
            <TableCell className="text-xs">{fmtTs(t.entry_ts)}</TableCell>
            <TableCell>{t.symbol}</TableCell>
            <TableCell>{t.direction}</TableCell>
            <TableCell className="text-xs text-destructive">{t.error}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
