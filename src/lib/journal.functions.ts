import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "./auth-middleware";

export type JournalDbTrade = {
  id: string;
  source: "paper" | "live";
  time: string;
  symbol: string;
  side: "BUY" | "SELL";
  qty: number;
  price: number;
  fee: number;
  grossPnl: number;
  netPnl: number;
  status: string;
  strategyPreset: string;
  timeframe: string;
  exitReason: string | null;
};

export const getJournalDbData = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async (): Promise<{ trades: JournalDbTrade[]; counts: { paper: number; live: number; total: number } }> => {
    const { getPool } = await import("@/lib/db-admin.server");
    const pool = await getPool();
    const { rows } = await pool.query<{
      id: string;
      source: "paper" | "live";
      time: string;
      symbol: string;
      side: "BUY" | "SELL";
      qty: number;
      price: number;
      fee: number;
      gross_pnl: number;
      net_pnl: number;
      status: string;
      strategy_preset: string;
      timeframe: string;
      exit_reason: string | null;
    }>(
      `SELECT *
         FROM (
           SELECT id::text,
                  'paper'::text AS source,
                  COALESCE(exit_ts, entry_ts)::text AS time,
                  symbol,
                  CASE WHEN lower(direction) IN ('long','buy') THEN 'BUY' ELSE 'SELL' END AS side,
                  units::double precision AS qty,
                  COALESCE(fill_price, entry_price)::double precision AS price,
                  ABS(COALESCE(fees,0))::double precision AS fee,
                  COALESCE(gross_pnl,0)::double precision AS gross_pnl,
                  COALESCE(net_pnl,0)::double precision AS net_pnl,
                  'closed'::text AS status,
                  strategy_preset,
                  timeframe,
                  exit_reason
             FROM public.paper_trades
           UNION ALL
           SELECT id::text,
                  'live'::text AS source,
                  COALESCE(exit_ts, fill_ts, entry_ts)::text AS time,
                  symbol,
                  CASE WHEN lower(direction) IN ('long','buy') THEN 'BUY' ELSE 'SELL' END AS side,
                  qty::double precision AS qty,
                  COALESCE(fill_price, entry_price)::double precision AS price,
                  ABS(COALESCE(fees,0))::double precision AS fee,
                  COALESCE(gross_pnl,0)::double precision AS gross_pnl,
                  COALESCE(net_pnl,0)::double precision AS net_pnl,
                  status,
                  strategy_preset,
                  timeframe,
                  exit_reason
             FROM public.live_trades
           WHERE status <> 'queued'
         ) t
        ORDER BY time ASC, id ASC
        LIMIT 100000`,
    );
    const trades = rows.map((r) => ({ ...r, source: r.source, qty: Number(r.qty), price: Number(r.price), fee: Number(r.fee), grossPnl: Number(r.gross_pnl), netPnl: Number(r.net_pnl) }));
    return {
      trades,
      counts: {
        paper: trades.filter((r) => r.source === "paper").length,
        live: trades.filter((r) => r.source === "live").length,
        total: trades.length,
      },
    };
  });
