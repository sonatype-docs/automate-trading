// Live unrealized P&L widget for the app header.
// Sums (mark - entry) * qty * sideSign across all open exchange positions.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { listLiveExchangeOrders, getLastPrice } from "@/lib/live-trading.functions";

function fmtUsd(n: number) {
  const sign = n > 0 ? "+" : n < 0 ? "" : "";
  return `${sign}${n.toFixed(2)}`;
}

export function HeaderLivePnl() {
  const listFn = useServerFn(listLiveExchangeOrders);
  const priceFn = useServerFn(getLastPrice);

  const ordersQ = useQuery({
    queryKey: ["header-live-orders"],
    queryFn: () => listFn({}),
    // Poll slowly when idle; the price query below ramps to 5s once a position is open.
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const positions = ordersQ.data?.executed ?? [];
  const symbols = Array.from(new Set(positions.map((p) => p.symbol).filter((s): s is string => !!s && s.trim().length > 0)));
  const hasOpen = symbols.length > 0;

  const pricesQ = useQuery({
    queryKey: ["header-live-prices", symbols.join(",")],
    enabled: hasOpen,
    queryFn: async () => {
      const out: Record<string, number> = {};
      await Promise.all(
        symbols.map(async (sym) => {
          try {
            const r = await priceFn({ data: { symbol: sym } });
            out[sym] = r.price;
          } catch {
            /* ignore */
          }
        }),
      );
      return out;
    },
    // Only tick fast while there is live P&L to refresh.
    refetchInterval: hasOpen ? 5_000 : false,
    staleTime: 4_000,
  });


  const rows = positions
    .map((p) => {
      if (!p.symbol || !p.entryPrice || !p.qty) return null;
      const mark = pricesQ.data?.[p.symbol] ?? 0;
      const sign = p.side.toLowerCase().startsWith("s") ? -1 : 1;
      const pnl = mark > 0 ? (mark - p.entryPrice) * p.qty * sign : 0;
      return { symbol: p.symbol, side: p.side, qty: p.qty, entry: p.entryPrice, mark, pnl, hasMark: mark > 0 };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const total = rows.reduce((s, r) => s + r.pnl, 0);
  const hasPos = rows.length > 0;
  const allLoading = hasPos && rows.every((r) => !r.hasMark);
  const tone =
    !hasPos ? "text-muted-foreground border-border/50 bg-muted/30"
    : allLoading ? "text-muted-foreground border-border/50 bg-muted/30"
    : total > 0 ? "text-emerald-500 border-emerald-500/40 bg-emerald-500/10"
    : total < 0 ? "text-rose-500 border-rose-500/40 bg-rose-500/10"
    : "text-muted-foreground border-border/50 bg-muted/30";
  const Icon = !hasPos ? Minus : total >= 0 ? TrendingUp : TrendingDown;

  return (
    <div
      className={`flex items-center gap-2 rounded-full border-2 px-4 py-1.5 font-mono text-base font-bold tabular-nums shadow-lg transition-colors sm:text-lg ${tone}`}
      title={
        hasPos
          ? rows
              .map(
                (r) =>
                  `${r.symbol} ${r.side} ${r.qty} @ ${r.entry.toFixed(2)} → ${r.hasMark ? r.mark.toFixed(2) : "…"}  P&L ${r.hasMark ? fmtUsd(r.pnl) : "loading"}`,
              )
              .join("\n")
          : "No open positions"
      }
    >
      
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">P&amp;L</span>
      <span className="text-base sm:text-xl">{!hasPos ? "$0.00" : allLoading ? "…" : `$${fmtUsd(total)}`}</span>
      {hasPos && (
        <span className="hidden text-[10px] uppercase tracking-wider text-muted-foreground/80 font-semibold sm:inline">
          {rows.length} pos
        </span>
      )}
    </div>
  );
}
