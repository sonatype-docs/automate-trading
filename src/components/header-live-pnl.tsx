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
    refetchInterval: 5_000,
    staleTime: 4_000,
  });

  const positions = ordersQ.data?.executed ?? [];
  const symbols = Array.from(new Set(positions.map((p) => p.symbol)));

  const pricesQ = useQuery({
    queryKey: ["header-live-prices", symbols.join(",")],
    enabled: symbols.length > 0,
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
    refetchInterval: 3_000,
    staleTime: 2_500,
  });

  const rows = positions
    .map((p) => {
      const mark = pricesQ.data?.[p.symbol];
      if (!mark || !p.entryPrice || !p.qty) return null;
      const sign = p.side.toLowerCase().startsWith("s") ? -1 : 1;
      const pnl = (mark - p.entryPrice) * p.qty * sign;
      return { symbol: p.symbol, side: p.side, qty: p.qty, entry: p.entryPrice, mark, pnl };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const total = rows.reduce((s, r) => s + r.pnl, 0);
  const hasPos = rows.length > 0;
  const tone =
    !hasPos ? "text-muted-foreground border-border/50 bg-muted/30"
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
                  `${r.symbol} ${r.side} ${r.qty} @ ${r.entry.toFixed(2)} → ${r.mark.toFixed(2)}  P&L ${fmtUsd(r.pnl)}`,
              )
              .join("\n")
          : "No open positions"
      }
    >
      <Icon className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden />
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">P&amp;L</span>
      <span className="text-base sm:text-xl">{hasPos ? `$${fmtUsd(total)}` : "$0.00"}</span>
      {hasPos && (
        <span className="hidden text-[10px] uppercase tracking-wider text-muted-foreground/80 font-semibold sm:inline">
          {rows.length} pos
        </span>
      )}
    </div>
  );
}
