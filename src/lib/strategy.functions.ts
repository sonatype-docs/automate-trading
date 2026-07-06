import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const getStrategyState = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = await admin();
  const [settingsRes, sessionsRes, setupsRes] = await Promise.all([
    supabase.from("strategy_settings").select("*").eq("id", true).maybeSingle(),
    supabase
      .from("strategy_sessions")
      .select("*")
      .order("ist_date", { ascending: false })
      .limit(1),
    supabase
      .from("strategy_setups")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  return {
    settings: settingsRes.data,
    session: sessionsRes.data?.[0] ?? null,
    setups: setupsRes.data ?? [],
  };
});

const StrategySettingsSchema = z.object({
  enabled: z.boolean().optional(),
  symbol: z.string().min(3).max(24).optional(),
  sl_risk_usd: z.number().positive().optional(),
  rr: z.number().positive().optional(),
  session_start_ist: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .optional(),
});

export const updateStrategySettings = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => StrategySettingsSchema.parse(input))
  .handler(async ({ data }) => {
    const supabase = await admin();
    const { data: row, error } = await supabase
      .from("strategy_settings")
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq("id", true)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const runStrategyTickNow = createServerFn({ method: "POST" }).handler(async () => {
  const { runStrategyTick } = await import("@/lib/strategy/engine.server");
  return runStrategyTick();
});

export const backtestToday = createServerFn({ method: "POST" }).handler(async () => {
  const supabase = await admin();
  const { data: settings } = await supabase
    .from("strategy_settings")
    .select("*")
    .eq("id", true)
    .single();
  if (!settings) throw new Error("Strategy settings not found");
  const { runBacktestToday } = await import("@/lib/strategy/backtest.server");
  return runBacktestToday({
    symbol: settings.symbol,
    sessionStartIst: String(settings.session_start_ist).slice(0, 5),
    slRiskUsd: Number(settings.sl_risk_usd),
    rr: Number(settings.rr),
  });
});

const RangeSchema = z.object({ days: z.number().int().min(1).max(365) });

export const backtestRange = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => RangeSchema.parse(input))
  .handler(async ({ data }) => {
    const supabase = await admin();
    const { data: settings } = await supabase
      .from("strategy_settings")
      .select("*")
      .eq("id", true)
      .single();
    if (!settings) throw new Error("Strategy settings not found");
    const { runBacktestRange } = await import("@/lib/strategy/backtest-range.server");
    return runBacktestRange({
      symbol: settings.symbol,
      sessionStartIst: String(settings.session_start_ist).slice(0, 5),
      slRiskUsd: Number(settings.sl_risk_usd),
      rr: Number(settings.rr),
      days: data.days,
    });
  });
