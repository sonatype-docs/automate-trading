import { getPool } from "@/lib/db-admin.server";

/**
 * Returns whether NEW live exposure is currently allowed.
 * Missing control state or any database error is fail-closed.
 *
 * Reduce-only exits are intentionally handled separately by the exchange client
 * so disabling live trading cannot trap an already-open position.
 */
export async function getGlobalLiveTradingEnabled(): Promise<boolean> {
  try {
    const pool = await getPool();
    const { rows } = await pool.query<{ global_live_enabled: boolean; mode: string; kill_switch: boolean }>(
      "SELECT global_live_enabled, mode, kill_switch FROM public.trading_controls WHERE id = true LIMIT 1",
    );
    return rows.length === 1
      && rows[0].global_live_enabled === true
      && rows[0].mode === "LIVE"
      && rows[0].kill_switch === false;
  } catch (error) {
    console.error("[trading-control] live trading state unavailable; failing closed", error);
    return false;
  }
}

export type TradingMode = "DISABLED" | "PAPER" | "LIVE";

export async function getTradingMode(): Promise<TradingMode> {
  try {
    const pool = await getPool();
    const { rows } = await pool.query<{ mode: TradingMode }>(
      "SELECT mode FROM public.trading_controls WHERE id = true LIMIT 1",
    );
    return rows[0]?.mode ?? "DISABLED";
  } catch (error) {
    console.error("[trading-control] trading mode unavailable; failing closed", error);
    return "DISABLED";
  }
}

export async function assertLiveTradingEntryEnabled(): Promise<void> {
  if (await getGlobalLiveTradingEnabled()) return;
  throw new Error("Live trading is disabled by the global trading control.");
}
