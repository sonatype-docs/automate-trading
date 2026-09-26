import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { CalendarRange, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PnlCalendarCard } from "@/components/pnl-calendar-card";
import { getStrategyPerformance } from "@/lib/analytics.functions";

export const Route = createFileRoute("/reports")({
  head: () => ({ meta: [{ title: "Reports — Shark" }, { name: "description", content: "Daily, weekly, and monthly performance reports." }, { name: "robots", content: "noindex" }] }),
  component: ReportsPage,
});

type Period = "week" | "month" | "ytd" | "all";
type Mode = "all" | "paper" | "live";

function istToday() { return new Date(Date.now() + 5.5 * 60 * 60_000).toISOString().slice(0, 10); }
function money(value: number) { return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`; }

function ReportsPage() {
  const [period, setPeriod] = useState<Period>("month");
  const [mode, setMode] = useState<Mode>("all");
  const fetchPerformance = useServerFn(getStrategyPerformance);
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["reports-performance", period, mode],
    queryFn: () => fetchPerformance({ data: { period, mode, anchor: istToday() } }),
    staleTime: 30_000,
  });
  const totals = data?.totals;
  const rows = useMemo(() => data?.rows ?? [], [data?.rows]);

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold tracking-tight">Reports</h1><p className="text-sm text-muted-foreground">Live performance summaries from paper and live trade records.</p></div><div className="flex items-center gap-2">
        <Select value={period} onValueChange={(v) => setPeriod(v as Period)}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="week">This week</SelectItem><SelectItem value="month">This month</SelectItem><SelectItem value="ytd">Year to date</SelectItem><SelectItem value="all">All time</SelectItem></SelectContent></Select>
        <Select value={mode} onValueChange={(v) => setMode(v as Mode)}><SelectTrigger className="w-24"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="paper">Paper</SelectItem><SelectItem value="live">Live</SelectItem></SelectContent></Select>
        <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching} title="Refresh report"><RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /></Button>
      </div></div>
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">{[["Net P&L", money(Number(totals?.netPnl ?? 0)), Number(totals?.netPnl ?? 0) >= 0], ["Trades", String(totals?.totalTrades ?? 0), true], ["Win rate", totals?.totalTrades ? `${((totals.wins / totals.totalTrades) * 100).toFixed(1)}%` : "—", true], ["Fees", money(Number(totals?.fees ?? 0)), false]].map(([label, value, positive]) => <Card key={String(label)}><CardContent className="p-4"><div className="text-xs text-muted-foreground">{label}</div><div className={`mt-1 font-mono text-2xl font-bold ${positive ? "text-long" : "text-short"}`}>{value}</div></CardContent></Card>)}</div>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><CalendarRange className="h-4 w-4 text-primary" />Daily performance</CardTitle></CardHeader><CardContent><PnlCalendarCard defaultMode={mode} lockMode showStrategyFilter showKpis={false} showToday /></CardContent></Card>
      <Card><CardHeader><CardTitle>Strategy performance</CardTitle></CardHeader><CardContent className="overflow-x-auto">{isLoading ? <p className="text-sm text-muted-foreground">Loading report…</p> : error ? <p className="text-sm text-destructive">Unable to load report: {error instanceof Error ? error.message : String(error)}</p> : rows.length === 0 ? <p className="text-sm text-muted-foreground">No closed trades in this period.</p> : <table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-4">Source</th><th className="py-2 pr-4">Symbol</th><th className="py-2 pr-4">Strategy</th><th className="py-2 pr-4">Trades</th><th className="py-2 pr-4">Win rate</th><th className="py-2 text-right">Net P&L</th></tr></thead><tbody>{rows.map((row) => <tr key={row.key} className="border-b last:border-0"><td className="py-2 pr-4 capitalize">{row.source}</td><td className="py-2 pr-4">{row.symbol}</td><td className="py-2 pr-4">{row.strategy_preset}</td><td className="py-2 pr-4">{row.totalTrades}</td><td className="py-2 pr-4">{(row.winRate * 100).toFixed(1)}%</td><td className={`py-2 text-right font-mono ${row.netPnl >= 0 ? "text-long" : "text-short"}`}>{money(row.netPnl)}</td></tr>)}</tbody></table>}</CardContent></Card>
    </div>
  );
}
