import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import {
  listLiveExchangeOrders,
  cancelExchangeOrder,
  listLiveTrades,
  type ExchangePendingOrder,
  type LiveTradeDTO,
} from "@/lib/live-trading.functions";

function fmtNum(n: number | null | undefined, d = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Number(n).toFixed(d);
}
function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function sideBadge(side: string) {
  const s = side.toUpperCase();
  const tone =
    s === "BUY" || s === "LONG"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
      : s === "SELL" || s === "SHORT"
        ? "border-destructive/40 bg-destructive/10 text-destructive"
        : "border-muted-foreground/30 bg-muted/40 text-muted-foreground";
  return <span className={`text-[10px] px-1.5 py-0.5 rounded border ${tone} font-medium`}>{s}</span>;
}
function labelForPending(o: ExchangePendingOrder): string {
  if (o.subType === "STOP_LOSS") return "Stop-loss";
  if (o.subType === "TAKE_PROFIT") return "Take-profit";
  if (o.reduceOnly) return "Reduce-only";
  return o.type || "Order";
}
function hasRealizedPnl(t: LiveTradeDTO): boolean {
  return t.net_pnl != null && Number.isFinite(Number(t.net_pnl));
}
function noFillReason(reason: string | null | undefined): boolean {
  return reason === "expired" || reason === "cancelled" || reason === "cancelled_replaced" || reason === "expired_queue";
}
function outcomeForTrade(t: LiveTradeDTO): string {
  if (t.status === "error") return "Failed";
  if (hasRealizedPnl(t)) return "Filled";
  if (noFillReason(t.exit_reason)) return "No fill";
  return t.status;
}
function pnlText(t: LiveTradeDTO): string {
  if (hasRealizedPnl(t)) return fmtNum(Number(t.net_pnl));
  if (t.status === "error") return "Failed";
  if (noFillReason(t.exit_reason)) return "No fill";
  return "—";
}

export function ExchangeOrdersCard() {
  const fn = useServerFn(listLiveExchangeOrders);
  const cancelFn = useServerFn(cancelExchangeOrder);
  const tradesFn = useServerFn(listLiveTrades);
  const qc = useQueryClient();
  const [tab, setTab] = useState<"server" | "pending" | "closed" | "live">("server");

  const q = useQuery({
    queryKey: ["exchange-orders"],
    queryFn: () => fn(),
    refetchInterval: 5_000,
  });

  const tradesQ = useQuery({
    queryKey: ["live-trades-card"],
    queryFn: () => tradesFn({ data: { limit: 2000 } }),
    refetchInterval: 5_000,
  });

  const cancelMut = useMutation({
    mutationFn: (clientOrderId: string) => cancelFn({ data: { clientOrderId } }),
    onSuccess: (res) => {
      if (res.ok) toast.success("Order cancelled on exchange");
      else toast.error(`Cancel failed [${res.status}]: ${res.body.slice(0, 120)}`);
      qc.invalidateQueries({ queryKey: ["exchange-orders"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const data = q.data;
  const pending = data?.pending ?? [];
  const executed = data?.executed ?? [];
  const allTrades = tradesQ.data ?? [];
  const serverQueued = allTrades.filter((t) => t.status === "queued");
  const liveRunning = allTrades.filter((t) => t.status === "open");
  // Our own runner attempts that have finished. Rows with net_pnl=null are
  // no-fill attempts (expired/cancelled/failed before execution), not P&L trades.
  const finishedTrades = allTrades
    .filter((t) => t.status === "closed" || t.status === "error")
    .sort((a, b) => (b.exit_ts ?? b.entry_ts).localeCompare(a.exit_ts ?? a.entry_ts));
  const realizedTrades = finishedTrades.filter(hasRealizedPnl);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTodayMs = startOfToday.getTime();
  const isTodayAttempt = (t: LiveTradeDTO) => {
    const tsSrc = t.exit_ts ?? t.entry_ts;
    const ts = tsSrc ? new Date(tsSrc).getTime() : 0;
    return ts >= startOfTodayMs;
  };
  const finishedToday = finishedTrades.filter(isTodayAttempt);
  let overallPnl = 0;
  let todayPnl = 0;
  let todayRealizedCount = 0;
  let todayAttempts = 0;
  let todayNoFill = 0;
  let todayErrors = 0;
  let todayWins = 0;
  for (const t of realizedTrades) {
    const p = Number(t.net_pnl ?? 0);
    overallPnl += p;
  }
  for (const t of finishedTrades) {
    const tsSrc = t.exit_ts ?? t.entry_ts;
    const ts = tsSrc ? new Date(tsSrc).getTime() : 0;
    if (ts >= startOfTodayMs) {
      todayAttempts += 1;
      if (t.status === "error") todayErrors += 1;
      else if (!hasRealizedPnl(t)) todayNoFill += 1;
      else {
        const p = Number(t.net_pnl ?? 0);
        todayPnl += p;
        todayRealizedCount += 1;
        if (p > 0) todayWins += 1;
      }
    }
  }
  const todayWinRate = todayRealizedCount > 0 ? (todayWins / todayRealizedCount) * 100 : null;
  const pnlTone = (v: number) =>
    v > 0 ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
      : v < 0 ? "border-destructive/40 bg-destructive/10 text-destructive"
        : "border-muted-foreground/30 bg-muted/40 text-muted-foreground";
  const refreshSection = () => {
    q.refetch();
    tradesQ.refetch();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <CardTitle className="text-base">Exchange orders · live</CardTitle>
            <span
              className={`text-[11px] px-2 py-0.5 rounded border font-medium font-mono ${pnlTone(overallPnl)}`}
              title="Sum of runner rows that have confirmed realized P&L. Expired/cancelled no-fill attempts are excluded."
            >
              Overall {realizedTrades.length > 0 ? `${overallPnl >= 0 ? "+" : ""}${fmtNum(overallPnl)} USDT` : "—"}
            </span>
            <span
              className={`text-[11px] px-2 py-0.5 rounded border font-medium font-mono ${pnlTone(todayPnl)}`}
              title="Confirmed realized P&L since midnight local. No-fill and failed attempts are shown separately."
            >
              Today {todayRealizedCount > 0 ? `${todayPnl >= 0 ? "+" : ""}${fmtNum(todayPnl)}` : "—"}
              {" · "}{todayRealizedCount} filled
              {todayAttempts > todayRealizedCount ? ` · ${todayNoFill} no-fill${todayErrors ? ` · ${todayErrors} error` : ""}` : ""}
              {" · "}{todayWinRate == null ? "—" : `${todayWinRate.toFixed(0)}%`} win
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {data?.fetchedAt && <span>updated {fmtTime(data.fetchedAt)}</span>}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={refreshSection}
              disabled={q.isFetching || tradesQ.isFetching}
              title="Refresh"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${q.isFetching || tradesQ.isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
        {data?.error && (
          <div className="mt-2 text-xs text-destructive">{data.error}</div>
        )}
        {tradesQ.error && (
          <div className="mt-2 text-xs text-destructive">
            {tradesQ.error instanceof Error ? tradesQ.error.message : "Failed to load runner trades"}
          </div>
        )}
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <div className="-mx-2 px-2 overflow-x-auto scrollbar-none">
            <TabsList className="w-max min-w-full flex-nowrap justify-start">
              <TabsTrigger value="server" className="whitespace-nowrap">
                <span className="sm:hidden">Server</span>
                <span className="hidden sm:inline">Pending in server</span>
                <Badge variant="outline" className="ml-2">{serverQueued.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="pending" className="whitespace-nowrap">
                <span className="sm:hidden">Exchange</span>
                <span className="hidden sm:inline">Pending in exchange</span>
                <Badge variant="outline" className="ml-2">{pending.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="live" className="whitespace-nowrap">
                <span className="sm:hidden">Live</span>
                <span className="hidden sm:inline">Live running</span>
                <Badge variant="outline" className="ml-2">{liveRunning.length || executed.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="closed" className="whitespace-nowrap">
                <span className="sm:hidden">Closed</span>
                <span className="hidden sm:inline">Executed &amp; Closed</span>
                <Badge variant="outline" className="ml-2">{finishedToday.length}</Badge>
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Pending in server: signals queued locally, not yet sent to exchange */}
          <TabsContent value="server" className="mt-3">
            {serverQueued.length === 0 ? (
              <EmptyRow text="No signals queued on the server." />
            ) : (
              <div className="rounded border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Symbol</TableHead>
                      <TableHead>TF</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Entry</TableHead>
                      <TableHead className="text-right">Stop</TableHead>
                      <TableHead className="text-right">Target</TableHead>
                      <TableHead>Queued</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {serverQueued.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium">{t.symbol}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{t.timeframe}</TableCell>
                        <TableCell>{sideBadge(t.direction)}</TableCell>
                        <TableCell className="text-right font-mono">{fmtNum(t.qty, 3)}</TableCell>
                        <TableCell className="text-right font-mono">{fmtNum(t.entry_price)}</TableCell>
                        <TableCell className="text-right font-mono">{fmtNum(t.stop_price)}</TableCell>
                        <TableCell className="text-right font-mono">{fmtNum(t.target_price)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmtTime(t.entry_ts)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* Pending in exchange: open orders on the book (limit, SL, TP) */}
          <TabsContent value="pending" className="mt-3">
            {pending.length === 0 ? (
              <EmptyRow text="No pending orders on the exchange." />
            ) : (
              <div className="rounded border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead>Kind</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Trigger</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pending.map((o) => {
                      const trigger =
                        o.stopPrice ?? o.stopLossPrice ?? o.takeProfitPrice ?? null;
                      return (
                        <TableRow key={o.clientOrderId}>
                          <TableCell className="font-medium">{o.symbol}</TableCell>
                          <TableCell>{sideBadge(o.side)}</TableCell>
                          <TableCell className="text-xs">{labelForPending(o)}</TableCell>
                          <TableCell className="text-right font-mono">{fmtNum(o.quantity, 3)}</TableCell>
                          <TableCell className="text-right font-mono">{fmtNum(o.price)}</TableCell>
                          <TableCell className="text-right font-mono">{fmtNum(trigger)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{fmtTime(o.createdAt)}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              disabled={cancelMut.isPending}
                              onClick={() => cancelMut.mutate(o.clientOrderId)}
                              title="Cancel order"
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* Executed: currently open positions on the exchange */}
          <TabsContent value="live" className="mt-3">
            {liveRunning.length === 0 && executed.length === 0 ? (
              <EmptyRow text="No live runner trades or open exchange positions." />
            ) : liveRunning.length > 0 ? (
              <div className="rounded border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Symbol</TableHead>
                      <TableHead>TF</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Entry</TableHead>
                      <TableHead className="text-right">Stop</TableHead>
                      <TableHead className="text-right">Target</TableHead>
                      <TableHead>Exchange position</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {liveRunning.map((t) => {
                      const pos = executed.find((p) =>
                        p.symbol.toUpperCase() === t.symbol.toUpperCase() &&
                        ((t.direction === "long" && ["LONG", "BUY"].includes(p.side.toUpperCase())) ||
                          (t.direction === "short" && ["SHORT", "SELL"].includes(p.side.toUpperCase())))
                      );
                      return (
                        <TableRow key={t.id}>
                          <TableCell className="font-medium">{t.symbol}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{t.timeframe}</TableCell>
                          <TableCell>{sideBadge(t.direction)}</TableCell>
                          <TableCell className="text-right font-mono">{fmtNum(t.qty, 3)}</TableCell>
                          <TableCell className="text-right font-mono">{fmtNum(t.fill_price ?? t.entry_price)}</TableCell>
                          <TableCell className="text-right font-mono">{fmtNum(t.stop_price)}</TableCell>
                          <TableCell className="text-right font-mono">{fmtNum(t.target_price)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {pos ? `${fmtNum(pos.qty, 3)} @ ${fmtNum(pos.entryPrice)}` : "not seen"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="rounded border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Entry price</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {executed.map((p, i) => (
                        <TableRow key={`${p.symbol}-${p.side}-${i}`}>
                          <TableCell className="font-medium">{p.symbol}</TableCell>
                          <TableCell>{sideBadge(p.side)}</TableCell>
                          <TableCell className="text-right font-mono">{fmtNum(p.qty, 3)}</TableCell>
                          <TableCell className="text-right font-mono">{fmtNum(p.entryPrice)}</TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* Closed: our runner trades that finished today or recently */}
          <TabsContent value="closed" className="mt-3">
            {finishedToday.length === 0 ? (
              <EmptyRow text="No finished runner attempts today." />
            ) : (
              <div className="rounded border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Exit time</TableHead>
                      <TableHead>Symbol</TableHead>
                      <TableHead>TF</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Entry</TableHead>
                      <TableHead className="text-right">Exit</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Outcome</TableHead>
                      <TableHead className="text-right">Net PnL</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {finishedToday.map((t) => {
                      const pnl = Number(t.net_pnl ?? 0);
                      const realized = hasRealizedPnl(t);
                      const pnlCls =
                        !realized
                          ? "text-muted-foreground"
                          : pnl > 0
                          ? "text-emerald-500"
                          : pnl < 0
                            ? "text-destructive"
                            : "text-muted-foreground";
                      const reason = t.status === "error"
                        ? (t.error ? `error: ${t.error.slice(0, 40)}` : "error")
                        : (t.exit_reason || "—");
                      return (
                        <TableRow key={t.id}>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {fmtTime(t.exit_ts ?? t.entry_ts)}
                          </TableCell>
                          <TableCell className="font-medium">{t.symbol}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{t.timeframe}</TableCell>
                          <TableCell>{sideBadge(t.direction)}</TableCell>
                          <TableCell className="text-right font-mono">{fmtNum(t.qty, 3)}</TableCell>
                          <TableCell className="text-right font-mono">
                            {fmtNum(t.fill_price ?? t.entry_price)}
                          </TableCell>
                          <TableCell className="text-right font-mono">{fmtNum(t.exit_price)}</TableCell>
                          <TableCell className="text-xs">{reason}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{outcomeForTrade(t)}</TableCell>
                          <TableCell className={`text-right font-mono ${pnlCls}`}>
                            {pnlText(t)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="rounded-md border p-4 text-sm text-muted-foreground text-center">
      {text}
    </div>
  );
}
