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
import { Activity, Cpu, Loader2 } from "lucide-react";
import { runUniversalStrategy, type RunStrategyResult } from "@/lib/strategy-engine.functions";
import { STRATEGY_PRESETS } from "@/lib/strategy-engine/presets";
import { TIMEFRAMES, TIMEZONES, type Timeframe, type Timezone } from "@/lib/market-data/types";

export const Route = createFileRoute("/strategy-engine")({
  head: () => ({
    meta: [
      { title: "Universal Strategy Engine — Modular Signal Generator" },
      {
        name: "description",
        content:
          "Strategy-agnostic engine: session/trend/volatility filters, setup detection, confirmation, entry/stop/target planners, invalidation and event stream — no execution, only signals.",
      },
      { property: "og:title", content: "Universal Strategy Engine" },
      { property: "og:description", content: "Modular building blocks that run any trading strategy from a config object." },
    ],
  }),
  component: StrategyEnginePage,
});

function fmt(n: number | null | undefined, d = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
}

function StrategyEnginePage() {
  const now = Date.now();
  const [preset, setPreset] = useState<string>("london_orb");
  const [source, setSource] = useState<"yahoo" | "shark">("yahoo");
  const [symbol, setSymbol] = useState("XAUUSDT");
  const [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const [displayTz, setDisplayTz] = useState<Timezone>("IST");
  const [strategyTz, setStrategyTz] = useState<Timezone>("London");
  const [days, setDays] = useState(30);
  const [mode, setMode] = useState<"historical" | "live" | "replay" | "paper">("historical");

  const runner = useServerFn(runUniversalStrategy);
  const mut = useMutation<RunStrategyResult>({
    mutationFn: async () => {
      const toMs = now;
      const fromMs = toMs - days * 86_400_000;
      return await runner({
        data: {
          source, symbol, timeframe,
          displayTimezone: displayTz, strategyTimezone: strategyTz,
          fromMs, toMs, presetId: preset, mode,
        },
      });
    },
  });

  const r = mut.data?.result;
  const rejects = useMemo(
    () => r ? Object.entries(r.stats.filterRejects).sort((a, b) => b[1] - a[1]) : [],
    [r],
  );

  const presetCfg = STRATEGY_PRESETS[preset];

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-16 z-20 border-b border-border/70 bg-background/70 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-3 md:px-6 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-primary to-primary/60 text-primary-foreground">
              <Cpu className="w-4 h-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Platform</div>
              <h1 className="font-display text-sm font-semibold tracking-tight truncate">Universal Strategy Engine</h1>
            </div>
          </div>
          <Badge variant="outline" className="uppercase text-[9px] tracking-widest">Signal-only</Badge>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 md:px-6 py-4 md:py-6 space-y-6">
        <Card>
          <CardHeader><CardTitle className="text-sm font-mono tracking-widest">Run Configuration</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4">
            <Field label="Strategy preset">
              <Select value={preset} onValueChange={setPreset}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STRATEGY_PRESETS).map(([id, c]) => (
                    <SelectItem key={id} value={id}>{c.strategyName}</SelectItem>
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
                <SelectContent>
                  {TIMEFRAMES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
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
                {mut.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Running</> : <><Activity className="w-4 h-4 mr-2" />Run engine</>}
              </Button>
            </div>
          </CardContent>
        </Card>

        {presetCfg && (
          <Card>
            <CardHeader><CardTitle className="text-sm font-mono tracking-widest">Loaded Configuration</CardTitle></CardHeader>
            <CardContent>
              <pre className="text-xs font-mono bg-muted/40 rounded-md p-3 overflow-x-auto">{JSON.stringify(presetCfg, null, 2)}</pre>
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
            <div className="grid gap-3 md:grid-cols-5">
              <Stat label="Bars processed" value={r.stats.barsProcessed.toLocaleString()} />
              <Stat label="Setups detected" value={r.stats.setupsDetected.toLocaleString()} />
              <Stat label="Signals created" value={r.stats.signalsCreated.toLocaleString()} />
              <Stat label="Signals invalidated" value={r.stats.signalsInvalidated.toLocaleString()} />
              <Stat label="Events" value={r.events.length.toLocaleString()} />
            </div>

            <Tabs defaultValue="signals">
              <TabsList>
                <TabsTrigger value="signals">Signals</TabsTrigger>
                <TabsTrigger value="rejects">Filter Rejects</TabsTrigger>
                <TabsTrigger value="events">Event Stream</TabsTrigger>
                <TabsTrigger value="invalidated">Invalidated</TabsTrigger>
                <TabsTrigger value="raw">Raw JSON</TabsTrigger>
              </TabsList>

              <TabsContent value="signals" className="mt-4">
                <Card>
                  <CardHeader><CardTitle className="text-sm font-mono tracking-widest">Signals ({r.signals.length})</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="w-full text-xs font-mono">
                      <thead className="text-muted-foreground">
                        <tr className="text-left">
                          <th className="py-1 pr-3">Time</th>
                          <th className="py-1 pr-3">Type</th>
                          <th className="py-1 pr-3">Dir</th>
                          <th className="py-1 pr-3">Entry</th>
                          <th className="py-1 pr-3">SL</th>
                          <th className="py-1 pr-3">TP</th>
                          <th className="py-1 pr-3">RR</th>
                          <th className="py-1 pr-3">Strength</th>
                          <th className="py-1 pr-3">Setup</th>
                          <th className="py-1 pr-3">Passed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.signals.map((s) => (
                          <tr key={s.signalId} className="border-t border-border/40">
                            <td className="py-1 pr-3">{new Date(s.timestamp).toISOString().slice(0, 16).replace("T", " ")}</td>
                            <td className="py-1 pr-3"><Badge variant="outline" className="text-[9px]">{s.type}</Badge></td>
                            <td className="py-1 pr-3">{s.direction}</td>
                            <td className="py-1 pr-3">{fmt(s.entryPrice)}</td>
                            <td className="py-1 pr-3">{fmt(s.stopLoss)}</td>
                            <td className="py-1 pr-3">{fmt(s.takeProfit)}</td>
                            <td className="py-1 pr-3">{fmt(s.rr, 2)}</td>
                            <td className="py-1 pr-3">
                              <div className="flex items-center gap-1.5">
                                <div className="w-16 h-1 bg-muted rounded overflow-hidden">
                                  <div className="h-full bg-primary" style={{ width: `${s.signalStrength}%` }} />
                                </div>
                                <span>{s.signalStrength}</span>
                              </div>
                            </td>
                            <td className="py-1 pr-3 text-muted-foreground">{s.setupType}</td>
                            <td className="py-1 pr-3 text-muted-foreground">{s.confirmationType.join(",")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="rejects" className="mt-4">
                <Card>
                  <CardHeader><CardTitle className="text-sm font-mono tracking-widest">Filter rejections</CardTitle></CardHeader>
                  <CardContent>
                    <table className="w-full text-sm">
                      <thead className="text-muted-foreground text-xs">
                        <tr className="text-left"><th className="py-1">Filter</th><th className="py-1">Count</th></tr>
                      </thead>
                      <tbody>
                        {rejects.map(([k, v]) => (
                          <tr key={k} className="border-t border-border/40">
                            <td className="py-1 font-mono">{k}</td>
                            <td className="py-1 font-mono">{v}</td>
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

              <TabsContent value="invalidated" className="mt-4">
                <Card>
                  <CardHeader><CardTitle className="text-sm font-mono tracking-widest">Invalidated pending signals</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="w-full text-xs font-mono">
                      <thead className="text-muted-foreground">
                        <tr className="text-left">
                          <th className="py-1 pr-3">Time</th><th className="py-1 pr-3">Dir</th>
                          <th className="py-1 pr-3">Entry</th><th className="py-1 pr-3">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.invalidated.map((s) => (
                          <tr key={s.signalId} className="border-t border-border/40">
                            <td className="py-1 pr-3">{new Date(s.timestamp).toISOString().slice(0, 16).replace("T", " ")}</td>
                            <td className="py-1 pr-3">{s.direction}</td>
                            <td className="py-1 pr-3">{fmt(s.entryPrice)}</td>
                            <td className="py-1 pr-3 text-destructive">{s.invalidationReason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="raw" className="mt-4">
                <Card>
                  <CardContent className="py-3">
                    <pre className="text-xs font-mono bg-muted/40 rounded-md p-3 overflow-x-auto max-h-[500px]">
                      {JSON.stringify(r.signals.slice(0, 5), null, 2)}
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
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-3">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">{label}</div>
        <div className="font-display text-lg font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}
