import { useEffect, useRef } from "react";
import { toast } from "sonner";

type MinTrade = {
  id: string;
  symbol?: string | null;
  side?: string | null;
  status?: string | null;
  entry_price?: number | null;
  qty?: number | null;
  created_at?: string | null;
  entry_ts?: string | null;
};

/**
 * Toasts once whenever a new trade id appears in `trades`.
 * On first load it seeds the set silently so we don't toast for history.
 */
export function useNewTradeToasts(trades: MinTrade[] | undefined, label: string) {
  const seenRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!trades) return;
    if (seenRef.current === null) {
      seenRef.current = new Set(trades.map((t) => t.id));
      return;
    }
    const seen = seenRef.current;
    const fresh = trades.filter((t) => !seen.has(t.id));
    if (!fresh.length) return;
    for (const t of fresh) {
      seen.add(t.id);
      const side = (t.side || "").toUpperCase();
      const sym = t.symbol || "—";
      const px = t.entry_price != null ? ` @ ${t.entry_price}` : "";
      const qty = t.qty != null ? ` × ${t.qty}` : "";
      toast.success(`${label} order placed`, {
        description: `${side} ${sym}${qty}${px}`,
      });
    }
  }, [trades, label]);
}
