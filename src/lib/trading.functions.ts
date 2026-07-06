import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const getDashboard = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = await admin();

  const [settingsRes, ordersRes, tradesRes, positionsRes, logsRes, eventsRes] =
    await Promise.all([
      supabase.from("settings").select("*").eq("id", true).single(),
      supabase.from("orders").select("*").order("created_at", { ascending: false }).limit(25),
      supabase.from("trades").select("*").order("closed_at", { ascending: false }).limit(100),
      supabase.from("positions").select("*"),
      supabase.from("activity_log").select("*").order("created_at", { ascending: false }).limit(30),
      supabase.from("webhook_events").select("*").order("received_at", { ascending: false }).limit(15),
    ]);

  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const trades = tradesRes.data ?? [];
  const todaysPnl = trades
    .filter((t) => new Date(t.closed_at) >= dayStart)
    .reduce((a, t) => a + Number(t.pnl_usd), 0);
  const totalPnl = trades.reduce((a, t) => a + Number(t.pnl_usd), 0);
  const wins = trades.filter((t) => Number(t.pnl_usd) > 0).length;
  const winRate = trades.length ? (wins / trades.length) * 100 : 0;

  return {
    settings: settingsRes.data,
    orders: ordersRes.data ?? [],
    trades,
    positions: positionsRes.data ?? [],
    logs: logsRes.data ?? [],
    events: eventsRes.data ?? [],
    metrics: {
      equity: Number(settingsRes.data?.paper_starting_equity ?? 0) + totalPnl,
      totalPnl,
      todaysPnl,
      winRate,
      openPositions: (positionsRes.data ?? []).length,
      totalTrades: trades.length,
    },
  };
});

const SettingsSchema = z.object({
  kill_switch: z.boolean().optional(),
  paper_mode: z.boolean().optional(),
  max_position_usd: z.number().min(0).optional(),
  max_open_positions: z.number().int().min(0).max(50).optional(),
  max_daily_loss_usd: z.number().min(0).optional(),
  allowed_symbols: z.array(z.string().min(1).max(32)).optional(),
  paper_starting_equity: z.number().min(0).optional(),
});

export const updateSettings = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => SettingsSchema.parse(input))
  .handler(async ({ data }) => {
    const supabase = await admin();
    const { data: row, error } = await supabase
      .from("settings")
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq("id", true)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const getWebhookInfo = createServerFn({ method: "GET" }).handler(async () => {
  const hasSecret = !!process.env.TRADINGVIEW_WEBHOOK_SECRET;
  const hasExchangeKey =
    !!process.env.SHARKEXCHANGE_API_KEY && !!process.env.SHARKEXCHANGE_API_SECRET;
  return { hasSecret, hasExchangeKey };
});

export const sendTestSignal = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        symbol: z.string().min(1).max(32),
        action: z.enum(["buy", "sell", "close"]),
        price: z.number().positive(),
        size_usd: z.number().positive().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const supabase = await admin();
    const { processSignal } = await import("@/lib/trading/engine.server");
    const alertId = `test-${Date.now()}-${data.symbol}`;
    const { data: eventRow, error } = await supabase
      .from("webhook_events")
      .insert({
        alert_id: alertId,
        raw_payload: { ...data, source: "manual_test" },
        status: "received",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    const result = await processSignal({ ...data, alert_id: alertId }, eventRow.id);
    await supabase
      .from("webhook_events")
      .update({ status: result.status, reason: result.reason ?? null })
      .eq("id", eventRow.id);
    return result;
  });

export const testExchangeConnection = createServerFn({ method: "POST" }).handler(async () => {
  const hasKey = !!process.env.SHARKEXCHANGE_API_KEY;
  const hasSecret = !!process.env.SHARKEXCHANGE_API_SECRET;
  if (!hasKey || !hasSecret) {
    return {
      ok: false as const,
      stage: "credentials" as const,
      message: `Missing ${!hasKey ? "SHARKEXCHANGE_API_KEY" : ""}${!hasKey && !hasSecret ? " and " : ""}${!hasSecret ? "SHARKEXCHANGE_API_SECRET" : ""}. Add them in Settings → Secrets.`,
    };
  }
  try {
    const { createSharkClient } = await import("@/lib/exchange/shark-client.server");
    const client = createSharkClient();
    const balance = await client.getBalance("USDT");
    return {
      ok: true as const,
      stage: "connected" as const,
      message: `Authenticated. USDT balance: ${balance}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false as const,
      stage: "request" as const,
      message: msg,
    };
  }
});
