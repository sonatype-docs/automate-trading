import { useEffect, useRef } from "react";
import { toast } from "sonner";

type MinItem = Record<string, any>;

/**
 * Toasts once whenever a new item (by key) appears in `items`.
 * Seeds silently on first load so history doesn't spam toasts.
 */
export function useNewTradeToasts<T extends MinItem>(
  items: T[] | undefined,
  label: string,
  opts?: { keyFn?: (t: T) => string; describe?: (t: T) => string },
) {
  const seenRef = useRef<Set<string> | null>(null);
  const keyFn = opts?.keyFn ?? ((t: T) => String(t.id));
  const describe =
    opts?.describe ??
    ((t: T) => {
      const side = String(t.side ?? t.direction ?? "").toUpperCase();
      const sym = t.symbol ?? "—";
      const px = t.entry_price != null ? ` @ ${t.entry_price}` : "";
      const qty = t.qty != null ? ` × ${t.qty}` : "";
      return `${side} ${sym}${qty}${px}`;
    });

  useEffect(() => {
    if (!items) return;
    if (seenRef.current === null) {
      seenRef.current = new Set(items.map(keyFn));
      return;
    }
    const seen = seenRef.current;
    const fresh = items.filter((t) => !seen.has(keyFn(t)));
    if (!fresh.length) return;
    for (const t of fresh) {
      seen.add(keyFn(t));
      toast.success(`${label} order placed`, { description: describe(t) });
    }
  }, [items, label, keyFn, describe]);
}
