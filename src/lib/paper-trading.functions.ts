// Client-callable server functions for the Paper Trading dashboard.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface RunnerDTO {
  id: string;
  label: string;
  source: string;
  symbol: string;
  timeframe: string;
  strategy_preset: string;
  exec_preset: string;
  risk_usd: number;
  lookback_days: number;
  running: boolean;
  started_at: string | null;
  last_tick_at: string | null;
  last_tick_error: string | null;
}

export interface PositionDTO {
  runner_id: string;
  symbol: string;
  timeframe: string;
  strategy_preset: string;
  direction: string;
  entry_ts: string;
  entry_price: number;
  stop_price: number;
  target_price: number;
  last_price: number;
  unrealized_pnl: number;
  updated_at: string;
}

export interface TradeDTO {
  id: string;
  runner_id: string;
  symbol: string;
  timeframe: string;
  strategy_preset: string;
  direction: string;
  entry_ts: string;
  entry_price: number;
  fill_price: number;
  stop_price: number;
  target_price: number;
  exit_ts: string;
  exit_price: number;
  exit_reason: string;
  rr: number;
  net_pnl: number;
  gross_pnl: number;
  fees: number;
}

export const listPaperRunners = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RunnerDTO[]> => {
    const { data, error } = await context.supabase
      .from("paper_runners")
      .select("*")
      .order("timeframe", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as RunnerDTO[];
  });

export const listPaperPositions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PositionDTO[]> => {
    const { data, error } = await context.supabase.from("paper_positions").select("*");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as PositionDTO[];
  });

export const listPaperTrades = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ limit: z.number().int().min(1).max(2000).default(500) }).parse(raw))
  .handler(async ({ data, context }): Promise<TradeDTO[]> => {
    const { data: rows, error } = await context.supabase
      .from("paper_trades")
      .select("*")
      .order("exit_ts", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return (rows ?? []) as unknown as TradeDTO[];
  });

export const setRunnerRunning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ id: z.string().uuid(), running: z.boolean() }).parse(raw))
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = { running: data.running };
    if (data.running) patch.started_at = new Date().toISOString();
    const { error } = await context.supabase.from("paper_runners").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setAllRunnersRunning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ running: z.boolean() }).parse(raw))
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = { running: data.running };
    if (data.running) patch.started_at = new Date().toISOString();
    const { error } = await context.supabase
      .from("paper_runners")
      .update(patch)
      .not("id", "is", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const runPaperTickNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { runPaperTradingTick } = await import("@/lib/paper-trading/tick.server");
    return await runPaperTradingTick();
  });

export const resetPaperRunner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { error: e1 } = await context.supabase.from("paper_trades").delete().eq("runner_id", data.id);
    if (e1) throw new Error(e1.message);
    const { error: e2 } = await context.supabase.from("paper_positions").delete().eq("runner_id", data.id);
    if (e2) throw new Error(e2.message);
    return { ok: true };
  });
