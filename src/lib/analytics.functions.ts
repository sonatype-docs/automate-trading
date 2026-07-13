import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const CalendarInput = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/), // "YYYY-MM" (IST)
  symbol: z.string().min(1).max(24).optional(),
  mode: z.enum(["all", "paper", "live"]).default("all"),
});

function istRangeForMonth(month: string): { startUtc: string; endUtc: string } {
  // IST is UTC+5:30, no DST. Convert month boundaries in IST to UTC for filtering.
  const [y, m] = month.split("-").map((n) => Number(n));
  // First day 00:00 IST == previous day 18:30 UTC
  const startUtcMs = Date.UTC(y, m - 1, 1, 0, 0, 0) - (5 * 60 + 30) * 60_000;
  const endUtcMs = Date.UTC(y, m, 1, 0, 0, 0) - (5 * 60 + 30) * 60_000;
  return { startUtc: new Date(startUtcMs).toISOString(), endUtc: new Date(endUtcMs).toISOString() };
}

function istDateKey(iso: string): string {
  const d = new Date(new Date(iso).getTime() + (5 * 60 + 30) * 60_000);
  return d.toISOString().slice(0, 10);
}

type DayCell = {
  date: string;      // YYYY-MM-DD in IST
  realized: number;  // USD
  trades: number;
  wins: number;
  losses: number;
};

export const getPnlCalendar = createServerFn({ method: "GET" })
  .validator((raw: unknown) => CalendarInput.parse(raw))
  .handler(async ({ data }) => {
    const supabase = await admin();
    const { startUtc, endUtc } = istRangeForMonth(data.month);

    // Realized: closed trades within the month (by closed_at, IST bucket).
    let q = supabase
      .from("trades")
      .select("symbol, pnl_usd, paper, closed_at")
      .not("closed_at", "is", null)
      .gte("closed_at", startUtc)
      .lt("closed_at", endUtc);
    if (data.symbol) q = q.eq("symbol", data.symbol);
    if (data.mode === "paper") q = q.eq("paper", true);
    if (data.mode === "live") q = q.eq("paper", false);

    const { data: trades, error } = await q;
    if (error) throw new Error(error.message);

    const byDay = new Map<string, DayCell>();
    for (const t of trades ?? []) {
      if (!t.closed_at) continue;
      const key = istDateKey(t.closed_at as string);
      const pnl = Number(t.pnl_usd ?? 0);
      const cell = byDay.get(key) ?? { date: key, realized: 0, trades: 0, wins: 0, losses: 0 };
      cell.realized += pnl;
      cell.trades += 1;
      if (pnl > 0) cell.wins += 1;
      else if (pnl < 0) cell.losses += 1;
      byDay.set(key, cell);
    }

    // Available symbols for the strategy filter (distinct across all trades).
    const { data: symRows } = await supabase.from("trades").select("symbol");
    const symbols = Array.from(new Set((symRows ?? []).map((r) => r.symbol as string))).sort();

    // Unrealized (today, IST): mark-to-market open positions.
    let posQ = supabase.from("positions").select("symbol, qty, avg_entry_price, paper");
    if (data.symbol) posQ = posQ.eq("symbol", data.symbol);
    if (data.mode === "paper") posQ = posQ.eq("paper", true);
    if (data.mode === "live") posQ = posQ.eq("paper", false);
    const { data: positions } = await posQ;

    let unrealized = 0;
    const openPositions: Array<{ symbol: string; qty: number; entry: number; last: number; upnl: number }> = [];
    if (positions && positions.length > 0) {
      const { createSharkClient } = await import("@/lib/exchange/shark-client.server");
      const client = createSharkClient();
      const uniqueSymbols = Array.from(new Set(positions.map((p) => p.symbol as string)));
      const prices = new Map<string, number>();
      await Promise.all(
        uniqueSymbols.map(async (sym) => {
          try {
            prices.set(sym, await client.getLastPrice(sym));
          } catch {
            // skip on failure — mark as 0 upnl for that symbol
          }
        }),
      );
      for (const p of positions) {
        const qty = Number(p.qty ?? 0);
        const entry = Number(p.avg_entry_price ?? 0);
        const last = prices.get(p.symbol as string);
        if (!last || !Number.isFinite(qty) || !Number.isFinite(entry) || qty === 0) continue;
        const upnl = (last - entry) * qty; // qty carries sign for shorts if stored as negative
        unrealized += upnl;
        openPositions.push({ symbol: p.symbol as string, qty, entry, last, upnl });
      }
    }

    const days = Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));
    const monthTotal = days.reduce((s, d) => s + d.realized, 0);
    const totalTrades = days.reduce((s, d) => s + d.trades, 0);
    const wins = days.reduce((s, d) => s + d.wins, 0);
    const losses = days.reduce((s, d) => s + d.losses, 0);

    return {
      month: data.month,
      days,
      symbols,
      unrealized,
      openPositions,
      summary: { monthTotal, trades: totalTrades, wins, losses },
    };
  });
