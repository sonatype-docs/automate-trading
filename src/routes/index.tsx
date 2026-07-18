import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  getDashboard,
  getMarketTicker,
  getExchangeAccount,
} from "@/lib/trading.functions";



import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Settings as SettingsIcon,
  BookOpen,
  Beaker,
  ListOrdered,
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

const MANUAL_DEPOSITS_INR = [51770, 25000, 25000] as const;
const MANUAL_NET_DEPOSITS_INR = MANUAL_DEPOSITS_INR.reduce((sum, amount) => sum + amount, 0);
const FEE_TYPES = new Set([
  "COMMISSION",
  "GST_ON_COMMISSION",
  "FUNDING_FEE",
  "GST_ON_FUNDING_FEE",
  "FUNDING",
  "INSURANCE_CLEAR",
  "LIQUIDATION",
  "LIQUIDATION_FEE",
]);

function finiteNumber(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function marginRate(row: Record<string, unknown>): number {
  return finiteNumber(row.marginSettlementRate ?? row.marginConversionRate, 1);
}

function tradeFeeInr(row: Record<string, unknown>): number {
  const direct = finiteNumber(row.feeInMarginAsset, NaN);
  if (Number.isFinite(direct)) return Math.abs(direct);
  return Math.abs(finiteNumber(row.fee) * marginRate(row));
}

function tradePnlInr(row: Record<string, unknown>): number {
  const direct = finiteNumber(row.realizedProfitInMarginAsset, NaN);
  if (Number.isFinite(direct)) return direct;
  return finiteNumber(row.realizedProfit) * marginRate(row);
}

function Dashboard() {
  const getDash = useServerFn(getDashboard);
  
  const getAcct = useServerFn(getExchangeAccount);

  const dashQ = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => getDash(),
    staleTime: 60_000,
  });
  const acctQ = useQuery({
    queryKey: ["exchange-account"],
    queryFn: () => getAcct(),
    staleTime: 60_000,
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
  const walletAsset = String(fw?.asset ?? fw?.marginAsset ?? "INR");

  const tradeFeesSum = exTrades.reduce((s, t) => s + tradeFeeInr(t), 0);
  const commissionTxSum = exTxns
    .filter((x) => FEE_TYPES.has(String(x.type ?? "").toUpperCase()))
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
      fee: tradeFeeInr(t),
      pnl: tradePnlInr(t),
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

  // Deposits & realized P&L from transactionHistory.
  // SharkExchange doesn't currently expose a dedicated deposit-history endpoint,
  // but every wallet movement (deposits, withdrawals, realized P&L, commissions,
  // funding fees, liquidations) surfaces in /v1/user-data/transaction-history.
  // Strategy: capture any explicit deposit/withdrawal entries AND derive net
  // deposits from wallet - realized_from_tx, so the equity math still works even
  // when the exchange doesn't tag entries as DEPOSIT.
  const DEPOSIT_TYPES = new Set(["DEPOSIT", "TRANSFER_IN", "FUND_TRANSFER_IN", "INTERNAL_TRANSFER_IN", "CREDIT", "WALLET_DEPOSIT", "USER_DEPOSIT"]);
  const WITHDRAW_TYPES = new Set(["WITHDRAWAL", "WITHDRAW", "TRANSFER_OUT", "FUND_TRANSFER_OUT", "INTERNAL_TRANSFER_OUT", "DEBIT", "WALLET_WITHDRAWAL", "USER_WITHDRAWAL"]);
  const REALIZED_TYPES = new Set(["REALIZED_PNL", "REALIZED_PROFIT", "PNL", "PROFIT_AND_LOSS", "TRADE"]);
  let depositsIn = 0;
  let depositsOut = 0;
  let realizedGross = 0;
  let feeChargesSigned = 0; // typically negative
  for (const x of exTxns) {
    const type = String(x.type ?? "").toUpperCase();
    const amt = Number(x.amount ?? 0);
    if (!Number.isFinite(amt)) continue;
    if (DEPOSIT_TYPES.has(type)) depositsIn += Math.abs(amt);
    else if (WITHDRAW_TYPES.has(type)) depositsOut += Math.abs(amt);
    else if (REALIZED_TYPES.has(type)) realizedGross += amt;
    else if (FEE_TYPES.has(type)) feeChargesSigned += amt < 0 ? amt : -amt;
  }
  const explicitNetDeposits = depositsIn - depositsOut;
  const realizedFromTx = realizedGross + feeChargesSigned;
  const tradeHistoryRealized = pnlTrades.reduce((s, t) => s + t.net, 0);
  // Prefer the richer of the two realized signals (txn-history usually complete,
  // trade-history can be a truncated page).
  const realizedAllTime = Math.abs(realizedFromTx) > Math.abs(tradeHistoryRealized)
    ? realizedFromTx
    : tradeHistoryRealized;

  // netDeposits = the actual capital placed on the exchange.
  // Shark currently omits deposit rows from transactionHistory, so keep the
  // user's known cash deposits as the authoritative fallback: 51,770 + 25,000 + 25,000.
  const netDeposits = explicitNetDeposits > 0
    ? explicitNetDeposits
    : MANUAL_NET_DEPOSITS_INR;
  const netDepositsSource = explicitNetDeposits > 0 ? "from exchange txns" : "manual deposits";

  // Definitive realized P&L when there are no open positions:
  //   wallet_now - net_deposits.  Falls back to trade-history sum only when wallet is unknown.
  const realizedPnl = hasWallet ? walletTotal - netDeposits : realizedAllTime;

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
        <div className="max-w-7xl mx-auto px-3 md:px-6 min-h-14 flex flex-col gap-2 py-2 md:flex-row md:items-center md:justify-between md:py-0">
          <div className="flex items-center gap-2 min-w-0">
            <Activity className="w-5 h-5 text-primary shrink-0" />
            <span className="font-mono text-xs sm:text-sm tracking-widest truncate">SHARK.AUTO</span>
            <StatusBar
              paperMode={!!settings?.paper_mode}
              killSwitch={!!settings?.kill_switch}
            />
          </div>
          <div className="-mx-3 md:mx-0 overflow-x-auto">
            <div className="flex items-center gap-1 px-3 md:px-0 md:flex-wrap">
              <Link to="/backtest">
                <Button variant="ghost" size="sm" className="shrink-0">
                  <Beaker className="w-4 h-4 md:mr-2" /> <span className="hidden md:inline">Backtest</span>
                </Button>
              </Link>
              <Link to="/pending-orders">
                <Button variant="ghost" size="sm" className="shrink-0">
                  <ListOrdered className="w-4 h-4 md:mr-2" /> <span className="hidden md:inline">Pending Orders</span>
                </Button>
              </Link>
              <Link to="/journal">
                <Button variant="ghost" size="sm" className="shrink-0">
                  <BookOpen className="w-4 h-4 md:mr-2" /> <span className="hidden md:inline">Journal</span>
                </Button>
              </Link>
              <Link to="/docs">
                <Button variant="ghost" size="sm" className="shrink-0">
                  <BookOpen className="w-4 h-4 md:mr-2" /> <span className="hidden md:inline">Webhook setup</span>
                </Button>
              </Link>
              <Link to="/settings">
                <Button variant="ghost" size="sm" className="shrink-0">
                  <SettingsIcon className="w-4 h-4 md:mr-2" /> <span className="hidden md:inline">Settings</span>
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 md:px-6 py-4 md:py-6 space-y-4 md:space-y-6">




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
            label="DEPOSITS"
            value={fmtINR(netDeposits)}
            sub={
              netDepositsSource
            }
          />
          <Metric label="LOCKED MARGIN" value={fmtINR(walletLocked)} />
        </div>







        <Card>
          <CardHeader className="pb-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
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

function PositionPnLCell({
  symbol,
  side,
  qty,
  entry,
  nativePnl,
}: {
  symbol: string;
  side: string;
  qty: number;
  entry: number;
  nativePnl: number;
}) {
  const getTicker = useServerFn(getMarketTicker);
  const q = useQuery({
    queryKey: ["pos-ticker", symbol],
    queryFn: () => getTicker({ data: { symbol } }),
    staleTime: 60_000,
    enabled: !!symbol,
  });
  const last = Number(q.data?.lastPrice ?? NaN);
  let pnl = Number.isFinite(nativePnl) ? nativePnl : NaN;
  if (!Number.isFinite(pnl) && Number.isFinite(last) && Number.isFinite(entry) && Number.isFinite(qty)) {
    const dir = side === "LONG" ? 1 : side === "SHORT" ? -1 : 0;
    pnl = dir * (last - entry) * qty;
  }
  const good = Number.isFinite(pnl) && pnl >= 0;
  return (
    <td className={`text-right ${good ? "text-long" : "text-short"}`}>
      {Number.isFinite(pnl)
        ? `${pnl >= 0 ? "+" : ""}${pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : "—"}
      {q.isFetching && <span className="ml-1 text-[9px] text-muted-foreground">•</span>}
    </td>
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
    staleTime: 60_000,
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
                        <PositionPnLCell
                          symbol={String(p.contractPair ?? p.symbol ?? "")}
                          side={side}
                          qty={Number(p.quantity ?? 0)}
                          entry={Number(p.entryPrice ?? 0)}
                          nativePnl={
                            Number(
                              (p as Record<string, unknown>).unrealizedProfit ??
                                (p as Record<string, unknown>).unRealizedProfit ??
                                (p as Record<string, unknown>).unrealisedPnl ??
                                (p as Record<string, unknown>).unrealizedPnl ??
                                (p as Record<string, unknown>).pnl ??
                                NaN,
                            )
                          }
                        />
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
