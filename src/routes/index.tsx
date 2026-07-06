import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getDashboard,
  updateSettings,
  sendTestSignal,
  getMarketTicker,
  getExchangeAccount,
} from "@/lib/trading.functions";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Settings as SettingsIcon,
  Zap,
  Shield,
  BookOpen,
} from "lucide-react";
import {
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from "recharts";

export const Route = createFileRoute("/")({
  component: Dashboard,
  head: () => ({
    meta: [
      { title: "Dashboard — Shark Auto-Trader" },
      { name: "description", content: "Live trading control panel." },
    ],
  }),
});

function StatusBar({
  paperMode,
  killSwitch,
}: {
  paperMode: boolean;
  killSwitch: boolean;
}) {
  const state = killSwitch ? "KILLED" : paperMode ? "PAPER" : "LIVE";
  const cls =
    state === "KILLED"
      ? "bg-destructive-soft"
      : state === "PAPER"
        ? "bg-warning-soft"
        : "bg-success-soft";
  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1 rounded font-mono text-xs tracking-widest ${cls}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
      {state}
    </div>
  );
}

const INITIAL_CAPITAL_INR = 51770;

function Dashboard() {
  const qc = useQueryClient();
  const getDash = useServerFn(getDashboard);
  const updateSettingsFn = useServerFn(updateSettings);
  const sendTest = useServerFn(sendTestSignal);
  const getAcct = useServerFn(getExchangeAccount);

  const dashQ = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => getDash(),
    refetchInterval: 5000,
  });
  const acctQ = useQuery({
    queryKey: ["exchange-account"],
    queryFn: () => getAcct(),
    refetchInterval: 15000,
  });

  const settingsMut = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      updateSettingsFn({ data: patch as never }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Settings updated");
    },
    onError: (e) => toast.error(e.message),
  });

  const [testForm, setTestForm] = useState({
    symbol: "BTCUSDT",
    action: "buy" as "buy" | "sell" | "close",
    price: 60000,
    size_usd: 50,
  });
  const testMut = useMutation({
    mutationFn: () => sendTest({ data: testForm }),
    onSuccess: (r) => {
      toast[r.status === "executed" ? "success" : "warning"](
        `Test signal: ${r.status}${r.reason ? ` (${r.reason})` : ""}`,
      );
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (!dashQ.data) {
    return <div className="p-8 text-muted-foreground">Loading dashboard…</div>;
  }

  const { settings, orders, trades, positions, logs, events, metrics } = dashQ.data;

  const start = Number(settings?.paper_starting_equity ?? 10000);
  let eq = start;
  const equityCurve = [...trades]
    .reverse()
    .map((t) => ({ t: new Date(t.closed_at).getTime(), eq: (eq += Number(t.pnl_usd)) }));
  if (equityCurve.length === 0) equityCurve.push({ t: Date.now(), eq: start });

  return (
    <div className="min-h-screen">
      <header className="border-b border-border sticky top-0 bg-background/95 backdrop-blur z-10">
        <div className="max-w-7xl mx-auto px-4 md:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="w-5 h-5 text-primary" />
            <span className="font-mono text-sm tracking-widest">SHARK.AUTO</span>
            <StatusBar
              paperMode={!!settings?.paper_mode}
              killSwitch={!!settings?.kill_switch}
            />
          </div>
          <div className="flex items-center gap-2">
            <Link to="/docs">
              <Button variant="ghost" size="sm">
                <BookOpen className="w-4 h-4 mr-2" /> Webhook setup
              </Button>
            </Link>
            <Link to="/settings">
              <Button variant="ghost" size="sm">
                <SettingsIcon className="w-4 h-4 mr-2" /> Settings
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardContent className="pt-6 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-mono tracking-wide">
                  <Shield className="w-4 h-4 text-destructive" /> KILL SWITCH
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {settings?.kill_switch ? "Blocking all new orders." : "Orders will execute normally."}
                </p>
              </div>
              <Switch
                checked={!!settings?.kill_switch}
                onCheckedChange={(v) => settingsMut.mutate({ kill_switch: v })}
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-mono tracking-wide">
                  <Zap className="w-4 h-4 text-warning" /> PAPER MODE
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {settings?.paper_mode ? "Simulated fills, no exchange calls." : "LIVE — real orders on SharkExchange."}
                </p>
              </div>
              <Switch
                checked={!!settings?.paper_mode}
                onCheckedChange={(v) => settingsMut.mutate({ paper_mode: v })}
              />
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Metric label="EQUITY" value={`$${metrics.equity.toFixed(2)}`} />
          <Metric
            label="TODAY P&L"
            value={`${metrics.todaysPnl >= 0 ? "+" : ""}$${metrics.todaysPnl.toFixed(2)}`}
            tone={metrics.todaysPnl >= 0 ? "long" : "short"}
          />
          <Metric label="OPEN POS" value={metrics.openPositions.toString()} />
          <Metric label="WIN RATE" value={`${metrics.winRate.toFixed(1)}%`} />
        </div>

        <LiveTicker defaultSymbol="XAUUSDT" />

        <ExchangeAccount />





        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono tracking-wide">EQUITY CURVE</CardTitle>
          </CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={equityCurve}>
                <XAxis
                  dataKey="t"
                  tickFormatter={(v) => new Date(v).toLocaleDateString()}
                  stroke="var(--muted-foreground)"
                  fontSize={10}
                />
                <YAxis stroke="var(--muted-foreground)" fontSize={10} domain={["auto", "auto"]} />
                <ReTooltip
                  contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)" }}
                  labelFormatter={(v) => new Date(v).toLocaleString()}
                  formatter={(v: number) => [`$${v.toFixed(2)}`, "Equity"]}
                />
                <Line type="monotone" dataKey="eq" stroke="var(--primary)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-mono tracking-wide">POSITIONS</CardTitle>
            </CardHeader>
            <CardContent>
              {positions.length === 0 ? (
                <p className="text-xs text-muted-foreground py-6 text-center">No open positions.</p>
              ) : (
                <table className="w-full text-sm font-mono">
                  <thead className="text-xs text-muted-foreground">
                    <tr>
                      <th className="text-left py-1">Symbol</th>
                      <th className="text-right py-1">Qty</th>
                      <th className="text-right py-1">Avg Entry</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((p) => (
                      <tr key={p.symbol} className="border-t border-border">
                        <td className="py-2">{p.symbol}</td>
                        <td className={`text-right ${Number(p.qty) > 0 ? "text-long" : "text-short"}`}>
                          {Number(p.qty).toFixed(6)}
                        </td>
                        <td className="text-right">${Number(p.avg_entry_price).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-mono tracking-wide">SEND TEST SIGNAL</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Symbol</Label>
                  <Input value={testForm.symbol} onChange={(e) => setTestForm({ ...testForm, symbol: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Action</Label>
                  <select
                    className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                    value={testForm.action}
                    onChange={(e) => setTestForm({ ...testForm, action: e.target.value as "buy" | "sell" | "close" })}
                  >
                    <option value="buy">buy</option>
                    <option value="sell">sell</option>
                    <option value="close">close</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Price</Label>
                  <Input type="number" value={testForm.price} onChange={(e) => setTestForm({ ...testForm, price: Number(e.target.value) })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Size (USD)</Label>
                  <Input type="number" value={testForm.size_usd} onChange={(e) => setTestForm({ ...testForm, size_usd: Number(e.target.value) })} />
                </div>
              </div>
              <Button onClick={() => testMut.mutate()} disabled={testMut.isPending} className="w-full">
                {testMut.isPending ? "Sending…" : "Fire signal"}
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono tracking-wide">RECENT ORDERS</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {orders.length === 0 ? (
              <p className="text-xs text-muted-foreground py-6 text-center">No orders yet.</p>
            ) : (
              <table className="w-full text-sm font-mono">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left py-1">Time</th>
                    <th className="text-left py-1">Symbol</th>
                    <th className="text-left py-1">Side</th>
                    <th className="text-right py-1">Qty</th>
                    <th className="text-right py-1">Price</th>
                    <th className="text-left py-1 pl-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id} className="border-t border-border">
                      <td className="py-2 text-xs text-muted-foreground">
                        {new Date(o.created_at).toLocaleTimeString()}
                      </td>
                      <td>{o.symbol}</td>
                      <td>
                        <span className={o.side === "buy" ? "text-long" : "text-short"}>
                          {o.side === "buy" ? <ArrowUpRight className="inline w-3 h-3" /> : <ArrowDownRight className="inline w-3 h-3" />}{" "}
                          {o.side}
                        </span>
                      </td>
                      <td className="text-right">{Number(o.qty).toFixed(6)}</td>
                      <td className="text-right">${Number(o.filled_price ?? o.price ?? 0).toFixed(2)}</td>
                      <td className="pl-3">
                        <Badge variant={o.status === "filled" ? "default" : o.status === "rejected" ? "destructive" : "secondary"}>
                          {o.status}
                        </Badge>
                        {o.paper && <span className="ml-2 text-xs text-warning">paper</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-mono tracking-wide">ACTIVITY LOG</CardTitle>
            </CardHeader>
            <CardContent className="max-h-80 overflow-y-auto">
              {logs.length === 0 ? (
                <p className="text-xs text-muted-foreground py-6 text-center">Quiet.</p>
              ) : (
                <ul className="space-y-2 text-xs font-mono">
                  {logs.map((l) => (
                    <li key={l.id} className="flex gap-2">
                      <span className="text-muted-foreground shrink-0">
                        {new Date(l.created_at).toLocaleTimeString()}
                      </span>
                      <span
                        className={
                          l.severity === "error"
                            ? "text-destructive"
                            : l.severity === "warn"
                              ? "text-warning"
                              : ""
                        }
                      >
                        [{l.severity}]
                      </span>
                      <span>{l.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-mono tracking-wide">WEBHOOK EVENTS</CardTitle>
            </CardHeader>
            <CardContent className="max-h-80 overflow-y-auto">
              {events.length === 0 ? (
                <div className="text-xs text-muted-foreground py-6 text-center space-y-2">
                  <AlertTriangle className="w-4 h-4 mx-auto" />
                  <p>No alerts received yet.</p>
                  <p>
                    <Link to="/docs" className="underline">Wire up TradingView →</Link>
                  </p>
                </div>
              ) : (
                <ul className="space-y-2 text-xs font-mono">
                  {events.map((e) => (
                    <li key={e.id} className="border-t border-border pt-2">
                      <div className="flex justify-between">
                        <span>{(e.raw_payload as { symbol?: string })?.symbol ?? "—"} · {(e.raw_payload as { action?: string })?.action ?? "—"}</span>
                        <Badge
                          variant={
                            e.status === "executed" ? "default" : e.status === "rejected" ? "destructive" : "secondary"
                          }
                        >
                          {e.status}
                        </Badge>
                      </div>
                      {e.reason && <div className="text-muted-foreground">{e.reason}</div>}
                      <div className="text-muted-foreground">
                        {new Date(e.received_at).toLocaleString()}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "long" | "short";
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs font-mono text-muted-foreground tracking-widest">{label}</div>
        <div
          className={`text-2xl font-mono mt-1 ${
            tone === "long" ? "text-long" : tone === "short" ? "text-short" : ""
          }`}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function LiveTicker({ defaultSymbol }: { defaultSymbol: string }) {
  const [symbol, setSymbol] = useState(defaultSymbol);
  const [input, setInput] = useState(defaultSymbol);
  const getTicker = useServerFn(getMarketTicker);
  const q = useQuery({
    queryKey: ["ticker", symbol],
    queryFn: () => getTicker({ data: { symbol } }),
    refetchInterval: 2000,
    refetchIntervalInBackground: true,
  });

  const fmt = (v: number | null | undefined, digits = 2) =>
    v === null || v === undefined || Number.isNaN(v)
      ? "—"
      : v.toLocaleString(undefined, {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        });

  const t = q.data;
  const pct = t?.priceChangePct ?? 0;
  const up = pct >= 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-sm font-mono tracking-wide flex items-center gap-2">
            LIVE TICKER · {symbol}
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
            <span className="text-[10px] text-muted-foreground">
              {q.isFetching ? "updating…" : "live"}
            </span>
          </CardTitle>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const s = input.trim().toUpperCase();
              if (/^[A-Z0-9]{3,24}$/.test(s)) setSymbol(s);
              else toast.error("Symbol must be uppercase alphanumeric (e.g. XAUUSDT)");
            }}
            className="flex items-center gap-2"
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase())}
              className="h-8 w-32 font-mono text-xs"
              placeholder="XAUUSDT"
            />
            <Button type="submit" size="sm" variant="secondary" className="h-8">
              Load
            </Button>
          </form>
        </div>
      </CardHeader>
      <CardContent>
        {q.isError ? (
          <div className="text-xs text-destructive font-mono py-4">
            {q.error instanceof Error ? q.error.message : "Failed to load ticker."}
          </div>
        ) : !t ? (
          <div className="text-xs text-muted-foreground py-4">Loading ticker…</div>
        ) : (
          <>
            <div className="flex items-baseline gap-4 flex-wrap">
              <div className={`text-4xl font-mono ${up ? "text-long" : "text-short"}`}>
                {fmt(t.lastPrice, 2)}
              </div>
              <div
                className={`text-sm font-mono ${up ? "text-long" : "text-short"} flex items-center gap-1`}
              >
                {up ? (
                  <ArrowUpRight className="w-4 h-4" />
                ) : (
                  <ArrowDownRight className="w-4 h-4" />
                )}
                {up ? "+" : ""}
                {fmt(t.priceChange, 2)} ({up ? "+" : ""}
                {fmt(t.priceChangePct, 2)}%)
              </div>
              <div className="text-[10px] text-muted-foreground font-mono ml-auto">
                {t.eventTime ? new Date(t.eventTime).toLocaleTimeString() : ""}
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-x-6 gap-y-2 mt-4 text-xs font-mono">
              <TickerStat label="24H OPEN" value={fmt(t.open, 2)} />
              <TickerStat label="24H HIGH" value={fmt(t.high, 2)} tone="long" />
              <TickerStat label="24H LOW" value={fmt(t.low, 2)} tone="short" />
              <TickerStat label="24H VOL" value={fmt(t.volume, 3)} />
              <TickerStat label="TRADES" value={fmt(t.trades, 0)} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TickerStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "long" | "short";
}) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground tracking-widest">{label}</div>
      <div
        className={`mt-0.5 ${tone === "long" ? "text-long" : tone === "short" ? "text-short" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

type Snap = {
  futuresWallet?: unknown;
  fundingWallet?: unknown;
  openPositions?: unknown;
  openOrders?: unknown;
  tradeHistory?: unknown;
  transactionHistory?: unknown;
  errors?: Record<string, string>;
};

function asArray(v: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(v)) return v as Array<Record<string, unknown>>;
  if (v && typeof v === "object") {
    const d = (v as { data?: unknown }).data;
    if (Array.isArray(d)) return d as Array<Record<string, unknown>>;
  }
  return [];
}

function asObject(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object") return null;
  const d = (v as { data?: unknown }).data;
  if (d && typeof d === "object" && !Array.isArray(d)) return d as Record<string, unknown>;
  return v as Record<string, unknown>;
}

function num(v: unknown, digits = 2): string {
  const n = typeof v === "number" ? v : v == null ? NaN : Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function ExchangeAccount() {
  const getAcct = useServerFn(getExchangeAccount);
  const q = useQuery({
    queryKey: ["exchange-account"],
    queryFn: () => getAcct(),
    refetchInterval: 15000,
  });

  const snap = (q.data?.snapshot ?? null) as Snap | null;
  const fw = asObject(snap?.futuresWallet);
  const fund = asObject(snap?.fundingWallet);
  const positions = asArray(snap?.openPositions);
  const openOrders = asArray(snap?.openOrders);
  const trades = asArray(snap?.tradeHistory);
  const txns = asArray(snap?.transactionHistory);
  const errors = snap?.errors ?? {};

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-mono tracking-wide flex items-center gap-2">
            SHARKEXCHANGE ACCOUNT
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
            <span className="text-[10px] text-muted-foreground">
              {q.isFetching ? "syncing…" : "live"}
            </span>
          </CardTitle>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => q.refetch()}
            disabled={q.isFetching}
            className="h-7 text-xs"
          >
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {q.data && !q.data.ok && (
          <div className="text-xs font-mono text-destructive">{q.data.message}</div>
        )}
        {!q.data && <div className="text-xs text-muted-foreground">Loading account…</div>}

        {/* Wallets */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <WalletCard title="FUTURES WALLET" data={fw} error={errors.futuresWallet} />
          <WalletCard title="FUNDING WALLET" data={fund} error={errors.fundingWallet} />
        </div>

        {/* Open positions */}
        <div>
          <div className="text-xs font-mono text-muted-foreground tracking-widest mb-2">
            OPEN POSITIONS ({positions.length})
            {errors.openPositions && (
              <span className="text-destructive ml-2">· {errors.openPositions}</span>
            )}
          </div>
          {positions.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3">No open positions on the exchange.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left py-1">Symbol</th>
                    <th className="text-left py-1">Side</th>
                    <th className="text-right py-1">Qty</th>
                    <th className="text-right py-1">Entry</th>
                    <th className="text-right py-1">Liq</th>
                    <th className="text-right py-1">Lev</th>
                    <th className="text-right py-1">Margin</th>
                    <th className="text-right py-1">PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p, i) => {
                    const side = String(p.positionType ?? "");
                    const long = side === "LONG";
                    return (
                      <tr key={String(p.positionId ?? i)} className="border-t border-border">
                        <td className="py-1">{String(p.contractPair ?? p.symbol ?? "—")}</td>
                        <td className={long ? "text-long" : "text-short"}>{side}</td>
                        <td className="text-right">{num(p.quantity, 6)}</td>
                        <td className="text-right">{num(p.entryPrice)}</td>
                        <td className="text-right">{num(p.liquidationPrice)}</td>
                        <td className="text-right">{num(p.leverage, 0)}x</td>
                        <td className="text-right">{num(p.margin)} {String(p.marginAsset ?? "")}</td>
                        <td className={`text-right ${Number(p.realizedProfit ?? 0) >= 0 ? "text-long" : "text-short"}`}>
                          {num(p.realizedProfit)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Open orders */}
        <div>
          <div className="text-xs font-mono text-muted-foreground tracking-widest mb-2">
            OPEN ORDERS ({openOrders.length})
            {errors.openOrders && (
              <span className="text-destructive ml-2">· {errors.openOrders}</span>
            )}
          </div>
          {openOrders.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3">No resting orders.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left py-1">Time</th>
                    <th className="text-left py-1">Symbol</th>
                    <th className="text-left py-1">Side</th>
                    <th className="text-left py-1">Type</th>
                    <th className="text-right py-1">Qty</th>
                    <th className="text-right py-1">Price</th>
                    <th className="text-right py-1">Filled</th>
                  </tr>
                </thead>
                <tbody>
                  {openOrders.map((o, i) => (
                    <tr key={String(o.clientOrderId ?? i)} className="border-t border-border">
                      <td className="py-1 text-muted-foreground">
                        {o.time ? new Date(String(o.time)).toLocaleTimeString() : "—"}
                      </td>
                      <td>{String(o.symbol ?? "—")}</td>
                      <td className={String(o.side) === "BUY" ? "text-long" : "text-short"}>
                        {String(o.side ?? "—")}
                      </td>
                      <td>{String(o.type ?? "—")}</td>
                      <td className="text-right">{num(o.orderAmount, 6)}</td>
                      <td className="text-right">{num(o.price)}</td>
                      <td className="text-right">{num(o.filledAmount, 6)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Trade history */}
          <div>
            <div className="text-xs font-mono text-muted-foreground tracking-widest mb-2">
              RECENT TRADES ({trades.length})
              {errors.tradeHistory && (
                <span className="text-destructive ml-2">· {errors.tradeHistory}</span>
              )}
            </div>
            {trades.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3">No trades yet.</p>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-xs font-mono">
                  <thead className="text-muted-foreground sticky top-0 bg-background">
                    <tr>
                      <th className="text-left py-1">Time</th>
                      <th className="text-left py-1">Symbol</th>
                      <th className="text-left py-1">Side</th>
                      <th className="text-right py-1">Qty</th>
                      <th className="text-right py-1">Price</th>
                      <th className="text-right py-1">Fee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((t, i) => (
                      <tr key={String(t.id ?? i)} className="border-t border-border">
                        <td className="py-1 text-muted-foreground">
                          {t.time ? new Date(String(t.time)).toLocaleTimeString() : "—"}
                        </td>
                        <td>{String(t.symbol ?? "—")}</td>
                        <td className={String(t.side) === "BUY" ? "text-long" : "text-short"}>
                          {String(t.side ?? "—")}
                        </td>
                        <td className="text-right">{num(t.quantity, 6)}</td>
                        <td className="text-right">{num(t.price)}</td>
                        <td className="text-right">{num(t.fee, 4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Transaction history */}
          <div>
            <div className="text-xs font-mono text-muted-foreground tracking-widest mb-2">
              TRANSACTIONS ({txns.length})
              {errors.transactionHistory && (
                <span className="text-destructive ml-2">· {errors.transactionHistory}</span>
              )}
            </div>
            {txns.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3">No transactions.</p>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-xs font-mono">
                  <thead className="text-muted-foreground sticky top-0 bg-background">
                    <tr>
                      <th className="text-left py-1">Time</th>
                      <th className="text-left py-1">Type</th>
                      <th className="text-left py-1">Symbol</th>
                      <th className="text-right py-1">Amount</th>
                      <th className="text-left py-1 pl-2">Asset</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txns.map((x, i) => {
                      const amt = Number(x.amount ?? 0);
                      return (
                        <tr key={String(x.id ?? i)} className="border-t border-border">
                          <td className="py-1 text-muted-foreground">
                            {x.time ? new Date(String(x.time)).toLocaleTimeString() : "—"}
                          </td>
                          <td>{String(x.type ?? "—")}</td>
                          <td>{String(x.symbol ?? "—")}</td>
                          <td className={`text-right ${amt >= 0 ? "text-long" : "text-short"}`}>
                            {amt >= 0 ? "+" : ""}{num(amt, 4)}
                          </td>
                          <td className="pl-2">{String(x.asset ?? "—")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function WalletCard({
  title,
  data,
  error,
}: {
  title: string;
  data: Record<string, unknown> | null;
  error?: string;
}) {
  const entries = data
    ? Object.entries(data).filter(([, v]) => v !== null && typeof v !== "object")
    : [];
  return (
    <div className="border border-border rounded-md p-3">
      <div className="text-xs font-mono text-muted-foreground tracking-widest mb-2">{title}</div>
      {error ? (
        <div className="text-xs text-destructive font-mono">{error}</div>
      ) : entries.length === 0 ? (
        <div className="text-xs text-muted-foreground">No data.</div>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono">
          {entries.map(([k, v]) => (
            <div key={k} className="flex justify-between col-span-2">
              <dt className="text-muted-foreground">{k}</dt>
              <dd>{typeof v === "number" ? num(v, 4) : String(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

