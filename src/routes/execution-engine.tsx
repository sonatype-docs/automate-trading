import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Activity, Gauge, Loader2 } from "lucide-react";
import { runExecutionEngine, type RunExecutionResult } from "@/lib/execution-engine.functions";
import { STRATEGY_PRESETS } from "@/lib/strategy-engine/presets";
import { EXEC_PRESETS } from "@/lib/execution-engine/presets";
import { TIMEFRAMES, TIMEZONES, type Timeframe, type Timezone } from "@/lib/market-data/types";

export const Route = createFileRoute("/execution-engine")({
  head: () => ({
    meta: [
      { title: "Universal Execution Engine — Realistic Fill Simulation" },
      {
        name: "description",
        content:
          "Strategy-agnostic execution simulator: orders, fills, slippage, spread, commissions, sizing, break-even, trailing, gap handling, risk caps, and trade recording.",
      },
      { property: "og:title", content: "Universal Execution Engine" },
      { property: "og:description", content: "Consumes signals, simulates realistic order execution and returns complete trade objects." },
    ],
  }),
  component: ExecutionEnginePage,
});

function fmt(n: number | null | undefined, d = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
}
function fmtMoney(n: number) { return `${n < 0 ? "-" : ""}$${fmt(Math.abs(n))}`; }
function toIso(ts: number) { return new Date(ts).toISOString().slice(0, 16).replace("T", " "); }

function ExecutionEnginePage() {
  const now = Date.now();
  const [strategyPresetId, setStrategyPresetId] = useState<string>("london_orb");
  const [execPresetId, setExecPresetId] = useState<string>("conservative_default");
  const [source, setSource] = useState<"yahoo" | "shark">("yahoo");
  const [symbol, setSymbol] = useState("XAUUSDT");
  const [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const [displayTz, setDisplayTz] = useState<Timezone>("IST");
  const [strategyTz, setStrategyTz] = useState<Timezone>("London");
  const [days, setDays] = useState(30);
  const [mode, setMode] = useState<"historical" | "live" | "replay" | "paper">("historical");

  const runner = useServerFn(runExecutionEngine);
  const mut = useMutation<RunExecutionResult>({
    mutationFn: async () => {
      const toMs = now;
      const fromMs = toMs - days * 86_400_000;
      return await runner({
        data: {
          source, symbol, timeframe,
          displayTimezone: displayTz, strategyTimezone: strategyTz,
          fromMs, toMs, strategyPresetId, execPresetId, mode,
        },
      });
    },
  });

  const r = mut.data?.result;
  const winRate = useMemo(() => {
    if (!r || r.stats.tradesClosed === 0) return 0;
    return (r.stats.winners / r.stats.tradesClosed) * 100;
  }, [r]);

  const execCfg = EXEC_PRESETS[execPresetId];

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-16 z-20 border-b border-border/70 bg-background/70 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-3 md:px-6 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-primary to-primary/60 text-primary-foreground">
              <Gauge className="w-4 h-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Platform</div>
              <h1 className="font-display text-sm font-semibold tracking-tight truncate">Universal Execution Engine</h1>
            </div>
          </div>
          <Badge variant="outline" className="uppercase text-[9px] tracking-widest">Fills-only</Badge>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 md:px-6 py-4 md:py-6 space-y-6">
        <Card>
          <CardHeader><CardTitle className="text-sm font-mono tracking-widest">Run Configuration</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4">
            <Field label="Strategy preset">
              <Select value={strategyPresetId} onValueChange={setStrategyPresetId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STRATEGY_PRESETS).map(([id, c]) => (
                    <SelectItem key={id} value={id}>{c.strategyName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Execution preset">
              <Select value={execPresetId} onValueChange={setExecPresetId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.keys(EXEC_PRESETS).map((id) => (
                    <SelectItem key={id} value={id}>{id.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Source">
              <Select value={source} onValueChange={(v) => setSource(v as "yahoo" | "shark")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="yahoo">Yahoo Finance (GC=F)</SelectItem>
                  <SelectItem value="shark">SharkExchange (XAUUSDT)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Symbol"><Input value={symbol} onChange={(e) => setSymbol(e.target.value)} /></Field>
            <Field label="Timeframe">
              <Select value={timeframe} onValueChange={(v) => setTimeframe(v as Timeframe)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TIMEFRAMES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Lookback (days)">
              <Input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value) || 1)} />
            </Field>
            <Field label="Display TZ">
              <Select value={displayTz} onValueChange={(v) => setDisplayTz(v as Timezone)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TIMEZONES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Strategy TZ">
              <Select value={strategyTz} onValueChange={(v) => setStrategyTz(v as Timezone)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TIMEZONES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Mode">
              <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="historical">Historical</SelectItem>
                  <SelectItem value="live">Live</SelectItem>
                  <SelectItem value="replay">Replay</SelectItem>
                  <SelectItem value="paper">Paper</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <div className="md:col-span-4 flex items-end">
              <Button className="w-full md:w-auto" onClick={() => mut.mutate()} disabled={mut.isPending}>
                {mut.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Simulating</> : <><Activity className="w-4 h-4 mr-2" />Run execution</>}
              </Button>
            </div>
          </CardContent>
        </Card>

        {execCfg && (
          <Card>
            <CardHeader><CardTitle className="text-sm font-mono tracking-widest">Execution config</CardTitle></CardHeader>
            <CardContent>
              <pre className="text-xs font-mono bg-muted/40 rounded-md p-3 overflow-x-auto">{JSON.stringify(execCfg, null, 2)}</pre>
            </CardContent>
          </Card>
        )}

        {mut.isError && (
          <Card className="border-destructive/60">
            <CardContent className="py-4 text-sm text-destructive">{(mut.error as Error).message}</CardContent>
          </Card>
        )}

        {r && (
          <>
            <div className="grid gap-3 md:grid-cols-6">
              <Stat label="Signals in" value={r.stats.signalsIn.toString()} />
              <Stat label="Orders filled" value={r.stats.ordersFilled.toString()} />
              <Stat label="Trades closed" value={r.stats.tradesClosed.toString()} />
              <Stat label="Win rate" value={`${fmt(winRate, 1)}%`} />
              <Stat label="Net PnL" value={fmtMoney(r.stats.netPnL)} tone={r.stats.netPnL >= 0 ? "pos" : "neg"} />
              <Stat label="Max DD" value={`${fmt(r.stats.maxDrawdownPct, 2)}%`} tone="neg" />
            </div>

            <Tabs defaultValue="trades">
              <TabsList>
                <TabsTrigger value="trades">Trades ({r.trades.length})</TabsTrigger>
                <TabsTrigger value="orders">Cancelled ({r.cancelledOrders.length})</TabsTrigger>
                <TabsTrigger value="events">Events</TabsTrigger>
                <TabsTrigger value="equity">Equity</TabsTrigger>
                <TabsTrigger value="risk">Risk blocks</TabsTrigger>
                <TabsTrigger value="raw">Raw JSON</TabsTrigger>
              </TabsList>

              <TabsContent value="trades" className="mt-4">
                <Card>
                  <CardHeader><CardTitle className="text-sm font-mono tracking-widest">Trade log</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto max-h-[600px]">
                    <table className="w-full text-xs font-mono">
                      <thead className="text-muted-foreground sticky top-0 bg-background">
                        <tr className="text-left">
                          <th className="py-1 pr-3">Entry</th>
                          <th className="py-1 pr-3">Dir</th>
                          <th className="py-1 pr-3">Fill</th>
                          <th className="py-1 pr-3">SL</th>
                          <th className="py-1 pr-3">TP</th>
                          <th className="py-1 pr-3">Exit</th>
                          <th className="py-1 pr-3">Reason</th>
                          <th className="py-1 pr-3">RR</th>
                          <th className="py-1 pr-3">Gross</th>
                          <th className="py-1 pr-3">Fees</th>
                          <th className="py-1 pr-3">Net</th>
                          <th className="py-1 pr-3">MAE</th>
                          <th className="py-1 pr-3">MFE</th>
                          <th className="py-1 pr-3">Hold</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.trades.map((t) => (
                          <tr key={t.tradeId} className="border-t border-border/40">
                            <td className="py-1 pr-3">{toIso(t.entryTime)}</td>
                            <td className="py-1 pr-3"><Badge variant="outline" className="text-[9px]">{t.direction}</Badge></td>
                            <td className="py-1 pr-3">{fmt(t.fillPrice)}</td>
                            <td className="py-1 pr-3">{fmt(t.stopPrice)}</td>
                            <td className="py-1 pr-3">{fmt(t.targetPrice)}</td>
                            <td className="py-1 pr-3">{fmt(t.exitPrice)}</td>
                            <td className="py-1 pr-3 text-muted-foreground">{t.exitReason}</td>
                            <td className="py-1 pr-3">{fmt(t.rr, 2)}</td>
                            <td className="py-1 pr-3">{fmtMoney(t.grossPnL)}</td>
                            <td className="py-1 pr-3 text-muted-foreground">{fmtMoney(t.fees)}</td>
                            <td className={`py-1 pr-3 ${t.netPnL >= 0 ? "text-emerald-500" : "text-destructive"}`}>{fmtMoney(t.netPnL)}</td>
                            <td className="py-1 pr-3">{fmt(t.mae)}</td>
                            <td className="py-1 pr-3">{fmt(t.mfe)}</td>
                            <td className="py-1 pr-3">{t.holdingTime}b</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="orders" className="mt-4">
                <Card>
                  <CardHeader><CardTitle className="text-sm font-mono tracking-widest">Cancelled / Expired orders</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="w-full text-xs font-mono">
                      <thead className="text-muted-foreground">
                        <tr className="text-left">
                          <th className="py-1 pr-3">Created</th><th className="py-1 pr-3">Side</th>
                          <th className="py-1 pr-3">Kind</th><th className="py-1 pr-3">Trigger</th>
                          <th className="py-1 pr-3">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.cancelledOrders.map((o) => (
                          <tr key={o.orderId} className="border-t border-border/40">
                            <td className="py-1 pr-3">{toIso(o.createdTs)}</td>
                            <td className="py-1 pr-3">{o.side}</td>
                            <td className="py-1 pr-3">{o.kind}</td>
                            <td className="py-1 pr-3">{fmt(o.triggerPrice)}</td>
                            <td className="py-1 pr-3"><Badge variant="outline" className="text-[9px]">{o.status}</Badge></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="events" className="mt-4">
                <Card>
                  <CardHeader><CardTitle className="text-sm font-mono tracking-widest">Last {r.events.length} events</CardTitle></CardHeader>
                  <CardContent className="max-h-[500px] overflow-y-auto">
                    <table className="w-full text-xs font-mono">
                      <thead className="text-muted-foreground sticky top-0 bg-background">
                        <tr className="text-left"><th className="py-1 pr-3">TS</th><th className="py-1 pr-3">Name</th><th className="py-1 pr-3">Data</th></tr>
                      </thead>
                      <tbody>
                        {r.events.slice(-200).reverse().map((e, k) => (
                          <tr key={k} className="border-t border-border/40">
                            <td className="py-1 pr-3">{new Date(e.ts).toISOString().slice(11, 19)}</td>
                            <td className="py-1 pr-3">{e.name}</td>
                            <td className="py-1 pr-3 text-muted-foreground truncate max-w-md">{JSON.stringify(e.data)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="equity" className="mt-4">
                <Card>
                  <CardHeader><CardTitle className="text-sm font-mono tracking-widest">Equity curve</CardTitle></CardHeader>
                  <CardContent>
                    <EquitySparkline points={r.equityCurve} />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="risk" className="mt-4">
                <Card>
                  <CardHeader><CardTitle className="text-sm font-mono tracking-widest">Risk blocks</CardTitle></CardHeader>
                  <CardContent>
                    <table className="w-full text-sm">
                      <thead className="text-muted-foreground text-xs">
                        <tr className="text-left"><th className="py-1">Reason</th><th className="py-1">Count</th></tr>
                      </thead>
                      <tbody>
                        {Object.entries(r.stats.riskBlocks).map(([k, v]) => (
                          <tr key={k} className="border-t border-border/40">
                            <td className="py-1 font-mono">{k}</td>
                            <td className="py-1 font-mono">{v}</td>
                          </tr>
                        ))}
                        {Object.keys(r.stats.riskBlocks).length === 0 && (
                          <tr><td className="py-2 text-muted-foreground text-xs" colSpan={2}>No risk blocks fired.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="raw" className="mt-4">
                <Card>
                  <CardContent className="py-3">
                    <pre className="text-xs font-mono bg-muted/40 rounded-md p-3 overflow-x-auto max-h-[500px]">
                      {JSON.stringify(r.trades.slice(0, 3), null, 2)}
                    </pre>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
function Stat({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  const cls = tone === "pos" ? "text-emerald-500" : tone === "neg" ? "text-destructive" : "";
  return (
    <Card>
      <CardContent className="py-3">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">{label}</div>
        <div className={`font-display text-lg font-semibold ${cls}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function EquitySparkline({ points }: { points: Array<{ ts: number; equity: number; drawdownPct: number }> }) {
  if (!points.length) return <div className="text-xs text-muted-foreground">No equity data.</div>;
  const w = 900, h = 200, pad = 8;
  const min = Math.min(...points.map((p) => p.equity));
  const max = Math.max(...points.map((p) => p.equity));
  const range = max - min || 1;
  const step = (w - pad * 2) / Math.max(1, points.length - 1);
  const path = points.map((p, i) => {
    const x = pad + i * step;
    const y = h - pad - ((p.equity - min) / range) * (h - pad * 2);
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-48">
        <path d={path} stroke="currentColor" className="text-primary" strokeWidth={1.5} fill="none" />
      </svg>
      <div className="flex justify-between text-[10px] font-mono text-muted-foreground mt-1">
        <span>{toIso(points[0].ts)} · {fmtMoney(points[0].equity)}</span>
        <span>{toIso(points[points.length - 1].ts)} · {fmtMoney(points[points.length - 1].equity)}</span>
      </div>
    </div>
  );
}
