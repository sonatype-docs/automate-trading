import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getDashboard,
  updateSettings,
  getMarketTicker,
  getExchangeAccount,
} from "@/lib/trading.functions";
import {
  getStrategyState,
  getStrategyTimeline,
  runStrategyTickNow,
  repriceArmedNow,
  updateStrategySettings,
  listStrategyPresets,
  createStrategyPreset,
  deleteStrategyPreset,
  applyStrategyPreset,
} from "@/lib/strategy.functions";



import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Settings as SettingsIcon,
  Zap,
  Shield,
  BookOpen,
  Beaker,
  ChevronDown,
  ListOrdered,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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


  if (!dashQ.data) {
    return <div className="p-8 text-muted-foreground">Loading dashboard…</div>;
  }

  const { settings, orders, positions, logs } = dashQ.data;

  // Live metrics from SharkExchange account snapshot
  const snap = (acctQ.data?.snapshot ?? null) as Snap | null;
  const fw = asObject(snap?.futuresWallet);
  const exTrades = asArray(snap?.tradeHistory);
  const exTxns = asArray(snap?.transactionHistory);
  const exPositions = asArray(snap?.openPositions);

  const walletLocked = Number(fw?.lockedBalance ?? 0);
  const walletFree = Number(
    fw?.withdrawableBalance ?? fw?.availableBalance ?? fw?.balance ?? 0,
  );
  const walletTotal = walletLocked + walletFree;
  const walletAsset = String(fw?.asset ?? "INR");

  const tradeFeesSum = exTrades.reduce((s, t) => s + Math.abs(Number(t.fee ?? 0)), 0);
  const commissionTxSum = exTxns
    .filter((x) => String(x.type ?? "").toUpperCase() === "COMMISSION")
    .reduce((s, x) => s + Math.abs(Number(x.amount ?? 0)), 0);
  // Commissions in transactionHistory and fees on trades represent the same charges —
  // pick the higher of the two to avoid double counting while still catching any fills
  // that fell outside the trade-history page.
  const feesTotal = Math.max(tradeFeesSum, commissionTxSum);

  const parseTime = (v: unknown): number => {
    if (v == null || v === "") return 0;
    if (typeof v === "number") return v > 1e12 ? v : v * 1000;
    const s = String(v);
    if (/^\d+$/.test(s)) {
      const n = Number(s);
      return n > 1e12 ? n : n * 1000;
    }
    const d = new Date(s).getTime();
    return Number.isFinite(d) ? d : 0;
  };

  // Journal-ready trade fills sorted chronologically (oldest → newest).
  const tradeFills = exTrades
    .map((t) => ({
      id: String(t.id ?? t.tradeId ?? ""),
      time: parseTime(t.time ?? t.createdAt ?? t.updatedAt),
      symbol: String(t.symbol ?? "—"),
      side: String(t.side ?? "").toUpperCase(),
      qty: Number(t.quantity ?? t.qty ?? 0),
      price: Number(t.price ?? 0),
      fee: Math.abs(Number(t.fee ?? 0)),
      pnl: Number(t.realizedProfit ?? 0),
      raw: t,
    }))
    .filter((t) => t.time > 0)
    .sort((a, b) => a.time - b.time);

  // Per-fill net used for win/loss stats and today's P&L.
  const pnlTrades = tradeFills
    .filter((t) => Number.isFinite(t.pnl))
    .map((t) => ({ ...t, net: t.pnl - t.fee }));

  const grossPnl = pnlTrades.reduce((s, t) => s + t.pnl, 0);

  // A fill is only counted as a win/loss if it actually closed something (has non-zero P&L).
  const closingFills = pnlTrades.filter((t) => t.pnl !== 0);
  const wins = closingFills.filter((t) => t.net > 0).length;
  const losses = closingFills.filter((t) => t.net < 0).length;
  const decided = wins + losses;
  const winRate = decided ? (wins / decided) * 100 : 0;
  const lossRate = decided ? (losses / decided) * 100 : 0;

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const todaysPnl = pnlTrades
    .filter((t) => t.time >= dayStart.getTime())
    .reduce((s, t) => s + t.net, 0);

  const hasWallet = Boolean(fw);

  // Net deposits from transactionHistory (fallback to INITIAL_CAPITAL_INR).
  // Anything that moved cash IN/OUT of the futures wallet without being a trade.
  const DEPOSIT_TYPES = new Set(["DEPOSIT", "TRANSFER_IN", "FUND_TRANSFER_IN", "INTERNAL_TRANSFER_IN", "CREDIT"]);
  const WITHDRAW_TYPES = new Set(["WITHDRAWAL", "WITHDRAW", "TRANSFER_OUT", "FUND_TRANSFER_OUT", "INTERNAL_TRANSFER_OUT", "DEBIT"]);
  let depositsIn = 0;
  let depositsOut = 0;
  for (const x of exTxns) {
    const type = String(x.type ?? "").toUpperCase();
    const amt = Number(x.amount ?? 0);
    if (!Number.isFinite(amt)) continue;
    if (DEPOSIT_TYPES.has(type)) depositsIn += Math.abs(amt);
    else if (WITHDRAW_TYPES.has(type)) depositsOut += Math.abs(amt);
  }
  const netDepositsFromTx = depositsIn - depositsOut;
  const netDeposits = netDepositsFromTx > 0 ? netDepositsFromTx : INITIAL_CAPITAL_INR;

  // Definitive realized P&L when there are no open positions:
  //   wallet_now - net_deposits.  Falls back to trade-history sum only when wallet is unknown.
  const tradeHistoryRealized = pnlTrades.reduce((s, t) => s + t.net, 0);
  const realizedPnl = hasWallet ? walletTotal - netDeposits : tradeHistoryRealized;

  const equity = hasWallet ? walletTotal : netDeposits + realizedPnl;
  const equityChange = equity - netDeposits;
  const equityChangePct = netDeposits > 0 ? (equityChange / netDeposits) * 100 : 0;



  // Equity curve in INR: start at net deposits, cumulate trade-history net per fill,
  // then anchor the final point to the true current wallet so the chart reconciles
  // with the top-level EQUITY / REALIZED P&L metrics.
  let eqRun = netDeposits;
  const equityCurve: Array<{ t: number; eq: number }> = [];
  if (pnlTrades.length > 0) {
    equityCurve.push({ t: pnlTrades[0].time - 60_000, eq: netDeposits });
  } else {
    equityCurve.push({ t: Date.now() - 86_400_000, eq: netDeposits });
    equityCurve.push({ t: Date.now(), eq: equity });
  }
  for (const t of pnlTrades) {
    eqRun += t.pnl - t.fee;
    equityCurve.push({ t: t.time, eq: eqRun });
  }
  // Reconcile last point with real wallet if there's drift (trade history may be paged).
  if (hasWallet && pnlTrades.length > 0 && Math.abs(equity - eqRun) > 0.01) {
    equityCurve.push({ t: Date.now(), eq: equity });
  }


  const fmtINR = (n: number, digits = 2) =>
    `₹${n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;



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
            <Link to="/backtest">
              <Button variant="ghost" size="sm">
                <Beaker className="w-4 h-4 mr-2" /> Backtest
              </Button>
            </Link>
            <Link to="/pending-orders">
              <Button variant="ghost" size="sm">
                <ListOrdered className="w-4 h-4 mr-2" /> Pending Orders
              </Button>
            </Link>
            <Link to="/journal">
              <Button variant="ghost" size="sm">
                <BookOpen className="w-4 h-4 mr-2" /> Journal
              </Button>
            </Link>
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
        <LiveTicker defaultSymbol="XAUUSDT" />


        <StrategyCard />




        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Metric
            label={`EQUITY (${walletAsset})`}
            value={fmtINR(equity)}
            sub={`${equityChange >= 0 ? "+" : ""}${fmtINR(equityChange)} (${equityChangePct >= 0 ? "+" : ""}${equityChangePct.toFixed(2)}%)`}
            tone={equityChange >= 0 ? "long" : "short"}
          />
          <Metric
            label="REALIZED P&L (NET)"
            value={`${realizedPnl >= 0 ? "+" : ""}${fmtINR(realizedPnl)}`}
            sub={`Today ${todaysPnl >= 0 ? "+" : ""}${fmtINR(todaysPnl)}`}
            tone={realizedPnl >= 0 ? "long" : "short"}
          />
          <Metric
            label="OPEN POS"
            value={String(exPositions.length || positions.length)}
            sub={`Free ${fmtINR(walletFree)}`}
          />
          <Metric
            label="TOTAL FEES"
            value={fmtINR(feesTotal, 4)}
            sub={`${exTrades.length} trades`}
            tone="short"
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Metric label="WIN RATE" value={`${winRate.toFixed(1)}%`} sub={`${wins}/${decided} closes`} tone="long" />
          <Metric label="LOSS RATE" value={`${lossRate.toFixed(1)}%`} sub={`${losses}/${decided} closes`} tone="short" />
          <Metric
            label="INITIAL CAPITAL"
            value={fmtINR(netDeposits)}
            sub={netDepositsFromTx > 0 ? "from deposits" : "fallback"}
          />
          <Metric label="LOCKED MARGIN" value={fmtINR(walletLocked)} />
        </div>

        <ExchangeAccount />






        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-mono tracking-wide">
              EQUITY CURVE
            </CardTitle>
            <span className="text-xs font-mono text-muted-foreground">
              {fmtINR(equity)} · {pnlTrades.length} fills
            </span>
          </CardHeader>
          <CardContent className="h-56">
            {equityCurve.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                No realized P&amp;L yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={equityCurve}>
                  <XAxis
                    dataKey="t"
                    tickFormatter={(v) => new Date(v).toLocaleDateString()}
                    stroke="var(--muted-foreground)"
                    fontSize={10}
                  />
                  <YAxis
                    stroke="var(--muted-foreground)"
                    fontSize={10}
                    domain={["auto", "auto"]}
                    tickFormatter={(v) => fmtINR(Number(v), 0)}
                  />
                  <ReTooltip
                    contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)" }}
                    labelFormatter={(v) => new Date(v).toLocaleString()}
                    formatter={(v: number) => [fmtINR(v), "P&L"]}
                  />
                  <Line
                    type="monotone"
                    dataKey="eq"
                    stroke="var(--primary)"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>



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
      </main>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone?: "long" | "short";
  sub?: string;
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
        {sub && (
          <div className="text-[10px] font-mono text-muted-foreground mt-1">{sub}</div>
        )}
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


function StrategyCard() {
  const qc = useQueryClient();
  const getState = useServerFn(getStrategyState);
  const runNow = useServerFn(runStrategyTickNow);
  const repriceNow = useServerFn(repriceArmedNow);
  const updateStrat = useServerFn(updateStrategySettings);
  const q = useQuery({
    queryKey: ["strategy-state"],
    queryFn: () => getState(),
    refetchInterval: 30_000,
  });
  const mut = useMutation({
    mutationFn: () => runNow(),
    onSuccess: (r) => {
      toast.success(`Tick ok — ${(r.actions ?? []).length} action(s)`);
      qc.invalidateQueries({ queryKey: ["strategy-state"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const repriceMut = useMutation({
    mutationFn: () => repriceNow(),
    onSuccess: (r) => {
      const acts = r.actions ?? [];
      if (acts.length === 0) {
        toast.message(r.reason ? `Nothing to reprice (${r.reason})` : "Nothing to reprice");
      } else {
        const ok = acts.filter((a) => a.startsWith("reprice_now ")).length;
        const skip = acts.length - ok;
        toast.success(`Reprice: ${ok} replaced, ${skip} skipped`);
      }
      qc.invalidateQueries({ queryKey: ["strategy-state"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const trailSaveMut = useMutation({
    mutationFn: (patch: {
      trail_enabled?: boolean;
      trail_activate_r?: number;
      trail_step_r?: number;
      skip_weekends?: boolean;
      session_start_ist?: string;
      sl_risk_usd?: number;
      rr?: number;
    }) => updateStrat({ data: patch }),
    onSuccess: () => {
      toast.success("Strategy settings saved");
      qc.invalidateQueries({ queryKey: ["strategy-state"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Trailing SL uses saved values for live; no per-run override on the dashboard.
  const [trailOverride, setTrailOverride] = useState<TrailOverride>(null);

  const s = q.data?.settings as
    | {
        enabled: boolean;
        symbol: string;
        sl_risk_usd: number;
        rr: number;
        session_start_ist: string;
        trail_enabled?: boolean;
        trail_activate_r?: number;
        trail_step_r?: number;
        skip_weekends?: boolean;
        entry_depth_pct?: number;
        sl_depth_pct?: number;
      }
    | null
    | undefined;
  const session = q.data?.session as
    | {
        ist_date: string;
        zone_high: number;
        zone_low: number;
        fib_25: number;
        fib_75: number;
        break_side: "long" | "short" | null;
      }
    | null
    | undefined;
  const setups = (q.data?.setups ?? []) as Array<{
    id: string;
    ist_date: string;
    side: "long" | "short";
    entry_price: number;
    sl_price: number;
    tp_price: number;
    qty: number;
    status: string;
    pnl_usd: number | null;
    close_reason: string | null;
  }>;

  const active = setups.filter((x) => x.status === "armed" || x.status === "triggered");
  const closed = setups.filter((x) => x.status === "closed" || x.status === "expired");

  const status = !s?.enabled
    ? { label: "DISABLED", cls: "bg-muted" }
    : !session
      ? { label: "WAITING FOR ZONE", cls: "bg-warning-soft" }
      : !session.break_side
        ? { label: "ZONE SET · NO BREAK", cls: "bg-warning-soft" }
        : active.some((a) => a.status === "triggered")
          ? { label: "IN TRADE", cls: "bg-success-soft" }
          : { label: `BROKEN ${session.break_side.toUpperCase()}`, cls: "bg-success-soft" };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-sm font-mono tracking-widest">
            STRATEGY — {s?.symbol ?? "XAUUSDT"} · 1H
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            IST {s?.session_start_ist?.slice(0, 5) ?? "05:30"} session · SL ${s?.sl_risk_usd ?? 25} · RR 1:{s?.rr ?? 2}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-2 px-3 py-1 rounded font-mono text-xs tracking-widest ${status.cls}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
            {status.label}
          </span>
          <Button size="sm" variant="outline" disabled={mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "Running…" : "Run tick"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={repriceMut.isPending}
            onClick={() => repriceMut.mutate()}
            title="Cancel any still-pending exchange order for today's armed setup and re-place it with current entry/SL/TP depths."
          >
            {repriceMut.isPending ? "Repricing…" : "Reprice now"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <CollapsibleSection title="Trailing SL" defaultOpen={false}>
          <TrailingSlControls
            saved={{
              enabled: !!s?.trail_enabled,
              activateR: Number(s?.trail_activate_r ?? 2),
              stepR: Number(s?.trail_step_r ?? 1),
            }}
            override={trailOverride}
            onOverrideChange={setTrailOverride}
            onSave={(patch) => trailSaveMut.mutate(patch)}
            saving={trailSaveMut.isPending}
          />
        </CollapsibleSection>
        <CollapsibleSection title="Live Session Rules" defaultOpen={false}>
          <LiveSessionRulesEditor
            settings={{
              session_start_ist: s?.session_start_ist?.slice(0, 5) ?? "05:30",
              sl_risk_usd: Number(s?.sl_risk_usd ?? 25),
              rr: Number(s?.rr ?? 2),
              skip_weekends: !!s?.skip_weekends,
            }}
            onSave={(patch) => trailSaveMut.mutate(patch)}
            saving={trailSaveMut.isPending}
          />
        </CollapsibleSection>
        <CollapsibleSection title="Strategy Presets" defaultOpen={false}>
          <StrategyPresetsCard
            currentSymbol={s?.symbol ?? "XAUUSDT"}
            currentSl={Number(s?.sl_risk_usd ?? 25)}
            currentRr={Number(s?.rr ?? 2)}
          />
        </CollapsibleSection>
        <CollapsibleSection title="Session Timeline" defaultOpen>
          <SessionTimeline />
        </CollapsibleSection>

        {session ? (() => {
          const eDepth = s?.entry_depth_pct ?? 0.15;
          const slDepth = s?.sl_depth_pct ?? 0.60;
          const range = session.zone_high - session.zone_low;
          const longEntry = session.zone_high - range * eDepth;   // fib (1 - eDepth)
          const longSl    = session.zone_high - range * slDepth;  // fib (1 - slDepth)
          const shortEntry = session.zone_low + range * eDepth;   // fib eDepth
          const shortSl    = session.zone_low + range * slDepth;  // fib slDepth
          const longFib  = (1 - eDepth).toFixed(2);
          const shortFib = eDepth.toFixed(2);
          const longSlFib  = (1 - slDepth).toFixed(2);
          const shortSlFib = slDepth.toFixed(2);
          return (
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2 font-mono text-xs">
              <ZoneCell label="HIGH · fib 1" value={session.zone_high} />
              <ZoneCell label={`fib ${longFib} · LONG entry`}  value={longEntry}  highlight={session.break_side === "long"} />
              <ZoneCell label={`fib ${longSlFib} · LONG sl`}   value={longSl} />
              <ZoneCell label={`fib ${shortFib} · SHORT entry`} value={shortEntry} highlight={session.break_side === "short"} />
              <ZoneCell label={`fib ${shortSlFib} · SHORT sl`}  value={shortSl} />
              <ZoneCell label="LOW · fib 0" value={session.zone_low} />
            </div>
          );
        })() : (
          <p className="text-xs text-muted-foreground font-mono">
            Zone is always the {s?.session_start_ist?.slice(0, 5) ?? "05:30"}–06:30 IST 1H candle — no other candle is used. Waiting for that candle to close, or hit “Run tick” to sync.
          </p>
        )}

        {active.length > 0 && (
          <div>
            <div className="text-xs font-mono text-muted-foreground mb-2">ACTIVE SETUPS</div>
            <div className="border border-border rounded divide-y divide-border">
              {active.map((a) => (
                <div key={a.id} className="grid grid-cols-6 gap-2 px-3 py-2 text-xs font-mono">
                  <span className={a.side === "long" ? "text-long" : "text-short"}>
                    {a.side.toUpperCase()}
                  </span>
                  <span>entry {a.entry_price.toFixed(2)}</span>
                  <span>sl {a.sl_price.toFixed(2)}</span>
                  <span>tp {a.tp_price.toFixed(2)}</span>
                  <span>qty {a.qty.toFixed(4)}</span>
                  <span className="uppercase text-muted-foreground">{a.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {closed.length > 0 && (
          <div>
            <div className="text-xs font-mono text-muted-foreground mb-2">RECENT SETUPS</div>
            <div className="border border-border rounded divide-y divide-border">
              {closed.slice(0, 8).map((c) => (
                <div key={c.id} className="grid grid-cols-6 gap-2 px-3 py-2 text-xs font-mono">
                  <span>{c.ist_date}</span>
                  <span className={c.side === "long" ? "text-long" : "text-short"}>
                    {c.side.toUpperCase()}
                  </span>
                  <span>entry {c.entry_price.toFixed(2)}</span>
                  <span className="uppercase text-muted-foreground">{c.status}</span>
                  <span className="uppercase text-muted-foreground">{c.close_reason ?? "—"}</span>
                  <span className={((c.pnl_usd ?? 0) >= 0) ? "text-long" : "text-short"}>
                    {c.pnl_usd == null ? "—" : `${c.pnl_usd >= 0 ? "+" : ""}${c.pnl_usd.toFixed(2)}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ZoneCell({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`border rounded px-2 py-1.5 ${highlight ? "border-primary bg-primary/5" : "border-border"}`}>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-sm">{value.toFixed(2)}</div>
    </div>
  );
}

type TimelineEvent = {
  at: string; // ISO
  kind: "session" | "break" | "armed" | "pending" | "triggered" | "closed" | "expired" | "cancelled";
  title: string;
  detail?: string;
  tone: "muted" | "info" | "warn" | "long" | "short" | "success" | "error";
};

function fmtIst(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false });
}

function SessionTimeline() {
  const getTimeline = useServerFn(getStrategyTimeline);
  const q = useQuery({
    queryKey: ["strategy-timeline"],
    queryFn: () => getTimeline(),
    refetchInterval: 30_000,
  });

  if (q.isLoading) {
    return <div className="text-xs text-muted-foreground font-mono">Loading…</div>;
  }
  if (!q.data?.session) {
    return (
      <div className="text-xs text-muted-foreground font-mono">
        No session yet. Timeline will populate once today's zone candle closes.
      </div>
    );
  }

  const { session, setups, orders } = q.data;
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const events: TimelineEvent[] = [];

  events.push({
    at: (session as { created_at: string }).created_at,
    kind: "session",
    title: `Zone set · ${session.zone_low.toFixed(2)} – ${session.zone_high.toFixed(2)}`,
    detail: `range ${(session.zone_high - session.zone_low).toFixed(2)} · high ${session.zone_high.toFixed(2)} · low ${session.zone_low.toFixed(2)}`,
    tone: "info",
  });

  if (session.break_side && session.break_detected_at) {
    events.push({
      at: session.break_detected_at,
      kind: "break",
      title: `Break ${session.break_side.toUpperCase()} @ ${Number(session.break_close_price ?? 0).toFixed(2)}`,
      detail: `1H candle close · ${fmtIst(session.break_detected_at)} IST`,
      tone: session.break_side === "long" ? "long" : "short",
    });
  }

  for (const st of setups) {
    events.push({
      at: st.created_at,
      kind: "armed",
      title: `Armed ${st.side.toUpperCase()}`,
      detail: `entry ${st.entry_price.toFixed(2)} · sl ${st.sl_price.toFixed(2)} · tp ${st.tp_price.toFixed(2)} · qty ${st.qty.toFixed(4)}`,
      tone: "warn",
    });
    if (st.exchange_order_id) {
      events.push({
        at: st.created_at,
        kind: "pending",
        title: `LIMIT sent to exchange`,
        detail: `order_id ${st.exchange_order_id}`,
        tone: "info",
      });
    }
    if (st.filled_at && (st.status === "triggered" || st.status === "closed")) {
      const ord = st.order_id ? orderById.get(st.order_id) : null;
      const fp = ord?.filled_price != null ? Number(ord.filled_price).toFixed(2) : st.entry_price.toFixed(2);
      events.push({
        at: st.filled_at,
        kind: "triggered",
        title: `Filled ${st.side.toUpperCase()} @ ${fp}`,
        detail: ord?.exchange_order_id
          ? `order_id ${ord.exchange_order_id} · ${ord.order_type ?? "limit"}`
          : st.exchange_order_id
            ? `order_id ${st.exchange_order_id}`
            : "paper fill",
        tone: "success",
      });
    }
    if (st.closed_at && st.status === "closed") {
      const pnl = st.pnl_usd == null ? "—" : `${Number(st.pnl_usd) >= 0 ? "+" : ""}${Number(st.pnl_usd).toFixed(2)}`;
      events.push({
        at: st.closed_at,
        kind: "closed",
        title: `Closed · ${(st.close_reason ?? "").toUpperCase() || "—"}`,
        detail: `pnl ${pnl}`,
        tone: Number(st.pnl_usd ?? 0) >= 0 ? "success" : "error",
      });
    }
    if (st.status === "expired") {
      events.push({
        at: st.updated_at,
        kind: "expired",
        title: `Expired ${st.side.toUpperCase()}`,
        detail: st.exchange_order_id ? `cancelled on exchange · ${st.exchange_order_id}` : undefined,
        tone: "muted",
      });
    }
    if (st.status === "cancelled") {
      events.push({
        at: st.updated_at,
        kind: "cancelled",
        title: `Cancelled ${st.side.toUpperCase()}`,
        tone: "error",
      });
    }
  }

  events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const toneCls: Record<TimelineEvent["tone"], string> = {
    muted: "bg-muted-foreground",
    info: "bg-primary",
    warn: "bg-warning",
    long: "bg-long",
    short: "bg-short",
    success: "bg-long",
    error: "bg-destructive",
  };

  return (
    <div className="font-mono text-xs">
      <div className="flex items-center justify-between mb-2 text-[10px] tracking-widest text-muted-foreground">
        <span>SESSION {session.ist_date}</span>
        <button
          className="hover:text-foreground"
          onClick={() => q.refetch()}
          disabled={q.isFetching}
        >
          {q.isFetching ? "refreshing…" : "refresh"}
        </button>
      </div>
      {events.length === 0 ? (
        <div className="text-muted-foreground">No events yet.</div>
      ) : (
        <ol className="relative border-l border-border ml-2 space-y-3">
          {events.map((e, i) => (
            <li key={i} className="pl-4 relative">
              <span
                className={`absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full ring-2 ring-background ${toneCls[e.tone]}`}
              />
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-foreground">{e.title}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {fmtIst(e.at)}
                </span>
              </div>
              {e.detail && (
                <div className="text-[10px] text-muted-foreground break-all">{e.detail}</div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border border-border rounded">
      <CollapsibleTrigger className="w-full flex items-center justify-between px-3 py-2 font-mono text-[11px] tracking-widest text-muted-foreground hover:text-foreground transition-colors">
        <span>{title.toUpperCase()}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3 pt-1">{children}</CollapsibleContent>
    </Collapsible>
  );
}




type TrailOverride = { enabled: boolean; activateR: number; stepR: number } | null;

function TrailingSlControls({
  saved,
  override,
  onOverrideChange,
  onSave,
  saving,
}: {
  saved: { enabled: boolean; activateR: number; stepR: number };
  override: TrailOverride;
  onOverrideChange: (v: TrailOverride) => void;
  onSave: (patch: { trail_enabled: boolean; trail_activate_r: number; trail_step_r: number }) => void;
  saving: boolean;
}) {
  const active = override ?? saved;
  const dirty =
    override != null &&
    (override.enabled !== saved.enabled ||
      override.activateR !== saved.activateR ||
      override.stepR !== saved.stepR);
  const set = (patch: Partial<{ enabled: boolean; activateR: number; stepR: number }>) =>
    onOverrideChange({ ...active, ...patch });
  return (
    <div className="font-mono text-xs space-y-2">
      <div className="flex items-center justify-end">
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">Enable</span>
          <Switch checked={active.enabled} onCheckedChange={(v) => set({ enabled: v })} />
        </label>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
        <div>
          <Label className="text-[10px] text-muted-foreground">Activate at (R)</Label>
          <Input
            type="number"
            step="0.1"
            min="0.1"
            value={active.activateR}
            onChange={(e) => set({ activateR: Number(e.target.value) || 0.1 })}
            className="h-8 font-mono text-xs"
          />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Step (R)</Label>
          <Input
            type="number"
            step="0.1"
            min="0.1"
            value={active.stepR}
            onChange={(e) => set({ stepR: Number(e.target.value) || 0.1 })}
            className="h-8 font-mono text-xs"
          />
        </div>
        <div className="md:col-span-2 flex gap-2 justify-end">
          {dirty && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onOverrideChange(null)}
              disabled={saving}
            >
              Reset
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            disabled={saving || !override}
            onClick={() =>
              onSave({
                trail_enabled: active.enabled,
                trail_activate_r: active.activateR,
                trail_step_r: active.stepR,
              })
            }
          >
            {saving ? "Saving…" : "Save (live)"}
          </Button>
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Once price reaches {active.activateR}R, SL moves to breakeven. Each additional {active.stepR}R gain moves SL up
        by {active.stepR}R (e.g. 1:{active.activateR}→BE, 1:{active.activateR + active.stepR}→{active.stepR}R,
        1:{active.activateR + 2 * active.stepR}→{2 * active.stepR}R, …). Applies to live triggers and backtests.
        {override ? " · Backtest is using the values above." : " · Backtest uses saved values."}
      </p>
    </div>
  );
}

function LiveSessionRulesEditor({
  settings,
  onSave,
  saving,
}: {
  settings: {
    session_start_ist: string;
    sl_risk_usd: number;
    rr: number;
    skip_weekends: boolean;
  };
  onSave: (patch: {
    session_start_ist?: string;
    sl_risk_usd?: number;
    rr?: number;
    skip_weekends?: boolean;
  }) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState(settings);
  useEffect(() => {
    setForm(settings);
  }, [settings.session_start_ist, settings.sl_risk_usd, settings.rr, settings.skip_weekends]);
  const dirty =
    form.session_start_ist !== settings.session_start_ist ||
    form.sl_risk_usd !== settings.sl_risk_usd ||
    form.rr !== settings.rr ||
    form.skip_weekends !== settings.skip_weekends;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <Button
          size="sm"
          variant="secondary"
          disabled={saving || !dirty}
          onClick={() => onSave(form)}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="space-y-1">
          <label className="text-[10px] font-mono tracking-widest text-muted-foreground">SESSION START IST</label>
          <Input
            value={form.session_start_ist}
            onChange={(e) => setForm({ ...form, session_start_ist: e.target.value })}
            placeholder="05:30"
            className="h-8 font-mono text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-mono tracking-widest text-muted-foreground">SL RISK ($)</label>
          <Input
            type="number"
            value={form.sl_risk_usd}
            onChange={(e) => setForm({ ...form, sl_risk_usd: Number(e.target.value) })}
            className="h-8 font-mono text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-mono tracking-widest text-muted-foreground">R:R (TP)</label>
          <Input
            type="number"
            step="0.1"
            value={form.rr}
            onChange={(e) => setForm({ ...form, rr: Number(e.target.value) })}
            className="h-8 font-mono text-xs"
          />
        </div>
        <label className="flex items-end justify-between gap-2 pb-1">
          <span className="text-[10px] font-mono tracking-widest text-muted-foreground">SKIP SUNDAY</span>
          <Switch
            checked={form.skip_weekends}
            onCheckedChange={(v) => setForm({ ...form, skip_weekends: v })}
          />
        </label>
      </div>
      <p className="text-[10px] text-muted-foreground font-mono">
        Prior-day pending (armed) orders auto-cancel at {settings.session_start_ist} IST when the new session opens.
      </p>
    </div>
  );
}



function StrategyPresetsCard({
  currentSymbol,
  currentSl,
  currentRr,
}: {
  currentSymbol: string;
  currentSl: number;
  currentRr: number;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listStrategyPresets);
  const createFn = useServerFn(createStrategyPreset);
  const deleteFn = useServerFn(deleteStrategyPreset);
  const applyFn = useServerFn(applyStrategyPreset);
  const q = useQuery({ queryKey: ["strategy-presets"], queryFn: () => listFn() });
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState<string>(currentSymbol);
  const [sl, setSl] = useState<number>(currentSl);
  const [rr, setRr] = useState<number>(currentRr);
  const [scope, setScope] = useState<string>("current");
  const SUPPORTED_SYMBOLS = ["XAUUSDT", "BTCUSDT"];
  const extraSymbols = SUPPORTED_SYMBOLS.filter((s) => s !== currentSymbol.toUpperCase());


  useEffect(() => {
    setSymbol(currentSymbol);
    setSl(currentSl);
    setRr(currentRr);
  }, [currentSymbol, currentSl, currentRr]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["strategy-presets"] });
    qc.invalidateQueries({ queryKey: ["strategy-state"] });
  };

  const createMut = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          name: name.trim(),
          symbol: scope === "any" ? null : (scope === "current" ? symbol.trim().toUpperCase() : scope),
          sl_risk_usd: sl,
          rr,
        },
      }),
    onSuccess: () => {
      toast.success("Preset saved");
      setName("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const applyMut = useMutation({
    mutationFn: (id: string) => applyFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Preset applied to live strategy");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Preset deleted");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const presets = (q.data ?? []) as Array<{
    id: string;
    name: string;
    symbol: string | null;
    sl_risk_usd: number;
    rr: number;
  }>;

  return (
    <div className="border border-border rounded p-3 bg-muted/30 space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-mono text-xs tracking-widest text-muted-foreground">
          STRATEGY PRESETS (SL / R:R)
        </div>
        <span className="text-[10px] text-muted-foreground font-mono">
          Reuse across symbols
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
        <div className="space-y-1 md:col-span-2">
          <label className="text-[10px] font-mono tracking-widest text-muted-foreground">PRESET NAME</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Conservative"
            className="h-8 font-mono text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-mono tracking-widest text-muted-foreground">SL ($)</label>
          <Input
            type="number"
            value={sl}
            onChange={(e) => setSl(Number(e.target.value))}
            className="h-8 font-mono text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-mono tracking-widest text-muted-foreground">R:R</label>
          <Input
            type="number"
            step="0.1"
            value={rr}
            onChange={(e) => setRr(Number(e.target.value))}
            className="h-8 font-mono text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-mono tracking-widest text-muted-foreground">SCOPE</label>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="h-8 w-full rounded border border-input bg-background px-2 font-mono text-xs"
          >
            <option value="current">Current symbol ({currentSymbol})</option>
            <option value="any">Any symbol</option>
            {extraSymbols.map((sym) => (
              <option key={sym} value={sym}>
                {sym}
              </option>
            ))}
          </select>
        </div>
      </div>


      <div className="flex justify-end">
        <Button
          size="sm"
          variant="secondary"
          disabled={createMut.isPending || !name.trim() || sl <= 0 || rr <= 0}
          onClick={() => createMut.mutate()}
        >
          {createMut.isPending ? "Saving…" : "Save preset"}
        </Button>
      </div>

      {presets.length === 0 ? (
        <p className="text-[10px] text-muted-foreground font-mono">
          No presets yet. Save one above to reuse SL and R:R quickly.
        </p>
      ) : (
        <div className="space-y-1">
          {presets.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between border border-border rounded px-2 py-1.5 font-mono text-xs bg-background/50"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold">{p.name}</span>
                <span className="text-muted-foreground">
                  {p.symbol ? p.symbol : "any symbol"}
                </span>
                <span>SL ${Number(p.sl_risk_usd)}</span>
                <span>RR 1:{Number(p.rr)}</span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  disabled={applyMut.isPending}
                  onClick={() => applyMut.mutate(p.id)}
                >
                  Apply
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[11px] text-short"
                  disabled={deleteMut.isPending}
                  onClick={() => deleteMut.mutate(p.id)}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
