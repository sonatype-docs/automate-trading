// Client-callable server functions for the LIVE trading dashboard.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export interface LiveRunnerDTO {
  id: string;
  label: string;
  source: string;
  symbol: string;
  timeframe: string;
  strategy_preset: string;
  exec_preset: string;
  risk_usd: number;
  leverage: number;
  lookback_days: number;
  running: boolean;
  started_at: string | null;
  last_tick_at: string | null;
  last_tick_error: string | null;
}

export interface LiveTradeDTO {
  id: string;
  runner_id: string;
  client_order_id: string | null;
  symbol: string;
  timeframe: string;
  direction: string;
  qty: number;
  entry_ts: string;
  entry_price: number;
  fill_price: number | null;
  stop_price: number;
  target_price: number;
  exit_ts: string | null;
  exit_price: number | null;
  exit_reason: string | null;
  rr: number | null;
  net_pnl: number | null;
  status: string;
  error: string | null;
}

export const listLiveRunners = createServerFn({ method: "GET" }).handler(async (): Promise<LiveRunnerDTO[]> => {
  const s = await admin();
  const { data, error } = await s.from("live_runners").select("*").order("label");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as LiveRunnerDTO[];
});

export const listLiveTrades = createServerFn({ method: "GET" })
  .inputValidator((raw) => z.object({ limit: z.number().int().min(1).max(2000).default(500) }).parse(raw))
  .handler(async ({ data }): Promise<LiveTradeDTO[]> => {
    const s = await admin();
    const { data: rows, error } = await s
      .from("live_trades").select("*")
      .order("entry_ts", { ascending: false }).limit(data.limit);
    if (error) throw new Error(error.message);
    return (rows ?? []) as unknown as LiveTradeDTO[];
  });

export const setLiveRunnerRunning = createServerFn({ method: "POST" })
  .inputValidator((raw) => z.object({ id: z.string().uuid(), running: z.boolean() }).parse(raw))
  .handler(async ({ data }) => {
    const s = await admin();
    const patch = data.running
      ? { running: true, started_at: new Date().toISOString(), last_tick_error: null }
      : { running: false };
    const { error } = await s.from("live_runners").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateLiveRunner = createServerFn({ method: "POST" })
  .inputValidator((raw) =>
    z.object({
      id: z.string().uuid(),
      risk_usd: z.number().positive().max(10_000).optional(),
      leverage: z.number().int().min(1).max(125).optional(),
    }).parse(raw),
  )
  .handler(async ({ data }) => {
    const s = await admin();
    const patch: { risk_usd?: number; leverage?: number } = {};
    if (data.risk_usd != null) patch.risk_usd = data.risk_usd;
    if (data.leverage != null) patch.leverage = data.leverage;
    const { error } = await s.from("live_runners").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const runLiveTickNow = createServerFn({ method: "POST" }).handler(async () => {
  const { runLiveTradingTick } = await import("@/lib/live-trading/tick.server");
  return await runLiveTradingTick();
});

export const cancelLiveOrder = createServerFn({ method: "POST" })
  .inputValidator((raw) => z.object({ trade_id: z.string().uuid() }).parse(raw))
  .handler(async ({ data }) => {
    const s = await admin();
    const { data: row, error } = await s.from("live_trades")
      .select("client_order_id").eq("id", data.trade_id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!row?.client_order_id) throw new Error("No exchange order id on this trade");
    const { createSharkClient } = await import("@/lib/exchange/shark-client.server");
    const client = createSharkClient();
    const res = await client.cancelOrder(row.client_order_id);
    await s.from("live_trades").update({
      status: "cancelled",
      exit_ts: new Date().toISOString(),
      exit_reason: "manual_cancel",
    }).eq("id", data.trade_id);
    return { ok: res.ok, status: res.status };
  });
