// Runs one LIVE trading tick — places REAL orders on SharkExchange for any
// brand-new signal produced by the strategy engine, and reconciles previously
// opened live_trades against the exchange to detect SL/TP exits.
//
// Idempotency: each trade is keyed by runner_id + strategy signalId.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadRawCandles } from "@/lib/market-data/loader.server";
import { enrichCandles } from "@/lib/market-data/enrich";
import { DEFAULT_CONFIG, type Timeframe } from "@/lib/market-data/types";
import { runStrategy } from "@/lib/strategy-engine/engine";
import { runExecution } from "@/lib/execution-engine/engine";
import { STRATEGY_PRESETS } from "@/lib/strategy-engine/presets";
import { EXEC_PRESETS, withRiskUsd } from "@/lib/execution-engine/presets";
import { createSharkClient } from "@/lib/exchange/shark-client.server";
import type { KlineSourceId } from "@/lib/exchange/kline-source.server";

interface RunnerRow {
  id: string;
  label: string;
  source: string;
  symbol: string;
  timeframe: string;
  strategy_preset: string;
  exec_preset: string;
  risk_usd: number;
  lookback_days: number;
  leverage: number;
}

export interface LiveTickReport {
  ok: boolean;
  runners: number;
  results: Array<{
    runner_id: string;
    label: string;
    placed: number;
    reconciled: number;
    error?: string;
  }>;
}

export async function runLiveTradingTick(): Promise<LiveTickReport> {
  const { data: runners, error } = await supabaseAdmin
    .from("live_runners")
    .select("id, label, source, symbol, timeframe, strategy_preset, exec_preset, risk_usd, lookback_days, leverage")
    .eq("running", true);
  if (error) throw new Error(error.message);

  const { windowsForPreset, isWindowActive, minutesUntilOpen } = await import(
    "@/lib/session-windows"
  );

  const out: LiveTickReport["results"] = [];
  for (const r of (runners ?? []) as RunnerRow[]) {
    try {
      // Session-window guard: skip runners that are far outside their entry
      // window AND have no open orders to reconcile. Enter the window 5 min
      // early so the first bar of the session is not missed.
      const windows = windowsForPreset(r.strategy_preset);
      const inWindow =
        windows.length === 0 || // unknown preset → always tick
        windows.some((w) => isWindowActive(w) || minutesUntilOpen(w) <= 5);

      if (!inWindow) {
        const { count } = await supabaseAdmin
          .from("live_trades")
          .select("id", { count: "exact", head: true })
          .eq("runner_id", r.id)
          .in("status", ["open", "pending"]);
        if ((count ?? 0) === 0) {
          out.push({ runner_id: r.id, label: r.label, placed: 0, reconciled: 0 });
          await supabaseAdmin.from("live_runners")
            .update({ last_tick_at: new Date().toISOString(), last_tick_error: null })
            .eq("id", r.id);
          continue;
        }
        // Fall through — we still need to reconcile open orders even off-window.
      }

      const res = await tickOne(r);
      out.push({ runner_id: r.id, label: r.label, ...res });
      await supabaseAdmin.from("live_runners")
        .update({ last_tick_at: new Date().toISOString(), last_tick_error: null })
        .eq("id", r.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out.push({ runner_id: r.id, label: r.label, placed: 0, reconciled: 0, error: msg });
      await supabaseAdmin.from("live_runners")
        .update({ last_tick_at: new Date().toISOString(), last_tick_error: msg })
        .eq("id", r.id);
    }
  }
  return { ok: true, runners: out.length, results: out };
}

async function tickOne(r: RunnerRow): Promise<{ placed: number; reconciled: number }> {
  const scfg = STRATEGY_PRESETS[r.strategy_preset];
  if (!scfg) throw new Error(`Unknown strategy preset ${r.strategy_preset}`);
  const baseE = EXEC_PRESETS[r.exec_preset];
  if (!baseE) throw new Error(`Unknown exec preset ${r.exec_preset}`);
  const ecfg = withRiskUsd(baseE, Number(r.risk_usd));

  const client = createSharkClient();

  // 0) Sweep stale PENDING limits older than 15 min — prevents orphan queue buildup.
  const STALE_MS = 15 * 60 * 1000;
  const cutoff = new Date(Date.now() - STALE_MS).toISOString();
  const { data: stale } = await supabaseAdmin
    .from("live_trades")
    .select("id, client_order_id")
    .eq("runner_id", r.id)
    .eq("status", "pending")
    .lt("entry_ts", cutoff);
  for (const sp of stale ?? []) {
    if (sp.client_order_id) {
      await client.cancelOrder(sp.client_order_id).catch(() => undefined);
    }
    await supabaseAdmin.from("live_trades").update({
      status: "closed",
      exit_ts: new Date().toISOString(),
      exit_reason: "expired",
    }).eq("id", sp.id);
  }

  // 1) Reconcile still-open live trades against the exchange.
  const reconciled = await reconcileOpen(r, client);


  // 2) Load fresh candles and run the strategy.
  const toMs = Date.now();
  const fromMs = toMs - Number(r.lookback_days) * 24 * 60 * 60 * 1000;
  const { candles } = await loadRawCandles({
    source: r.source as KlineSourceId,
    symbol: r.symbol,
    timeframe: r.timeframe as Timeframe,
    fromMs, toMs,
  });
  if (!candles.length) return { placed: 0, reconciled };

  const enriched = enrichCandles(candles, {
    ...DEFAULT_CONFIG,
    symbol: r.symbol,
    timeframe: r.timeframe as Timeframe,
  });
  const sres = runStrategy(enriched, scfg, { mode: "live", symbol: r.symbol });
  const eres = runExecution(enriched, sres.signals, ecfg, { symbol: r.symbol });

  // Only look at the newest "still-open" flushed trade — that's the current signal.
  const openFlush = eres.trades.find((t) => t.exitReason === "end_of_data");
  if (!openFlush) return { placed: 0, reconciled };

  // Dedup: skip if a live_trade already exists for this signalId.
  const { data: existing } = await supabaseAdmin
    .from("live_trades")
    .select("id")
    .eq("runner_id", r.id)
    .eq("dedup_key", openFlush.signalId)
    .maybeSingle();
  if (existing) return { placed: 0, reconciled };

  // Cancel-and-replace: if a still-PENDING limit order exists for this runner
  // (parent not yet filled) with a different signalId, cancel it on the
  // exchange and mark the DB row cancelled before placing the new one.
  const { data: stalePendings } = await supabaseAdmin
    .from("live_trades")
    .select("id, client_order_id")
    .eq("runner_id", r.id)
    .eq("status", "pending");
  for (const sp of stalePendings ?? []) {
    if (sp.client_order_id) {
      await client.cancelOrder(sp.client_order_id).catch(() => undefined);
    }
    await supabaseAdmin
      .from("live_trades")
      .update({
        status: "closed",
        exit_ts: new Date().toISOString(),
        exit_reason: "cancelled_replaced",
      })
      .eq("id", sp.id);
  }


  // Contradictory-entry rule (LIVE, IMMEDIATE):
  // If a still-open live_trade exists for this runner on the same symbol
  // but the opposite direction, DON'T wait for a candle close.
  //  - If it's currently in profit → ignore the new signal.
  //  - If it's in loss → close it right now on the exchange (market,
  //    reduce-only), cancel its SL/TP children, mark the DB row closed,
  //    THEN place the reverse.
  const { data: openOpposite } = await supabaseAdmin
    .from("live_trades")
    .select("id, client_order_id, direction, qty, entry_price, stop_price, target_price")
    .eq("runner_id", r.id)
    .eq("symbol", r.symbol)
    .in("status", ["open", "pending"])
    .neq("direction", openFlush.direction)
    .maybeSingle();
  if (openOpposite) {
    let last = 0;
    try { last = await client.getLastPrice(r.symbol); } catch { /* keep 0 */ }
    if (last > 0) {
      const dir = openOpposite.direction === "long" ? 1 : -1;
      const uPnl = (last - Number(openOpposite.entry_price)) * dir * Number(openOpposite.qty);
      if (uPnl >= 0) {
        // In profit → ignore this contradictory signal entirely.
        return { placed: 0, reconciled };
      }
      // In loss → force-close now.
      // 1) Cancel any child SL/TP orders still open on this symbol.
      try {
        const childOrders = await client.getOpenOrders(r.symbol);
        for (const co of childOrders) {
          if (!co.clientOrderId) continue;
          if (openOpposite.client_order_id && co.clientOrderId === openOpposite.client_order_id) continue;
          if (co.reduceOnly === true || co.subType === "STOP_LOSS" || co.subType === "TAKE_PROFIT") {
            await client.cancelOrder(co.clientOrderId).catch(() => undefined);
          }
        }
      } catch { /* ignore */ }
      // 2) Reduce-only market close in the opposite side.
      const closeSide: "buy" | "sell" = openOpposite.direction === "long" ? "sell" : "buy";
      let exitPrice = last;
      try {
        const closeRes = await client.placeOrder({
          symbol: r.symbol,
          side: closeSide,
          qty: Number(openOpposite.qty),
          type: "market",
          reduceOnly: true,
        });
        if (closeRes.filledPrice && closeRes.filledPrice > 0) exitPrice = closeRes.filledPrice;
      } catch {
        // If the reduce-only close fails, bail out — we won't place a
        // contradictory entry while the opposite exposure is still live.
        return { placed: 0, reconciled };
      }
      // 3) Also cancel the parent order id if still listed.
      if (openOpposite.client_order_id) {
        await client.cancelOrder(openOpposite.client_order_id).catch(() => undefined);
      }
      // 4) Update DB row.
      const grossPnl = uPnl;
      const stopDist = Math.abs(Number(openOpposite.entry_price) - Number(openOpposite.stop_price));
      const rr = stopDist > 0
        ? ((exitPrice - Number(openOpposite.entry_price)) * dir) / stopDist
        : 0;
      await supabaseAdmin.from("live_trades").update({
        status: "closed",
        exit_ts: new Date().toISOString(),
        exit_price: exitPrice,
        exit_reason: "reverse_on_loss",
        rr,
        gross_pnl: grossPnl,
        net_pnl: grossPnl,
        fees: 0,
      }).eq("id", openOpposite.id);
    } else {
      // No fresh price → don't guess. Skip this tick.
      return { placed: 0, reconciled };
    }
  }

  // 3) Size from stop distance so loss ≈ risk_usd on hit.
  const stopDist = Math.abs(openFlush.fillPrice - openFlush.stopPrice);
  if (stopDist <= 0) return { placed: 0, reconciled };
  const qty = Math.max(0.001, Number((Number(r.risk_usd) / stopDist).toFixed(3)));

  // 4) Best-effort leverage update — ignore errors.
  try { await client.updateLeverage(r.symbol, r.leverage); } catch { /* ignore */ }

  // 5) Place market order with attached SL/TP.
  let placedOk = 0;
  const insertBase = {
    runner_id: r.id,
    dedup_key: openFlush.signalId,
    symbol: r.symbol,
    timeframe: r.timeframe,
    strategy_preset: r.strategy_preset,
    direction: openFlush.direction,
    qty,
    entry_ts: new Date(openFlush.entryTime).toISOString(),
    entry_price: openFlush.fillPrice,
    stop_price: openFlush.stopPrice,
    target_price: openFlush.targetPrice,
  };
  try {
    const res = await client.placeOrder({
      symbol: r.symbol,
      side: openFlush.direction === "long" ? "buy" : "sell",
      qty,
      type: "limit",
      price: openFlush.fillPrice,
      stopLossPrice: openFlush.stopPrice,
      takeProfitPrice: openFlush.targetPrice,
    });
    await supabaseAdmin.from("live_trades").insert({
      ...insertBase,
      client_order_id: res.exchangeOrderId || null,
      fill_price: res.filledPrice ?? null,
      status: res.status === "filled" ? "open" : "pending",
      raw_place: res.raw as never,
    });

    await supabaseAdmin.from("live_trades").insert({
      ...insertBase,
      client_order_id: res.exchangeOrderId || null,
      fill_price: res.filledPrice ?? null,
      status: res.status === "filled" ? "open" : "pending",
      raw_place: res.raw as never,
    });
    placedOk = 1;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabaseAdmin.from("live_trades").insert({
      ...insertBase,
      status: "error",
      error: msg.slice(0, 500),
    });
    throw e;
  }
  return { placed: placedOk, reconciled };
}

/** Check every open/pending live_trades row; mark closed when the exchange
 *  no longer shows an open child order for that clientOrderId. */
async function reconcileOpen(
  r: RunnerRow,
  client: ReturnType<typeof createSharkClient>,
): Promise<number> {
  const { data: openRows } = await supabaseAdmin
    .from("live_trades")
    .select("id, status, client_order_id, direction, qty, entry_price, stop_price, target_price")
    .eq("runner_id", r.id)
    .in("status", ["open", "pending"]);
  if (!openRows?.length) return 0;

  let openOrders: Awaited<ReturnType<typeof client.getOpenOrders>> = [];
  try { openOrders = await client.getOpenOrders(r.symbol); } catch { return 0; }
  const openIds = new Set(openOrders.map((o) => o.clientOrderId));

  let last = 0;
  try { last = await client.getLastPrice(r.symbol); } catch { /* keep 0 */ }

  let n = 0;
  for (const row of openRows) {
    if (!row.client_order_id) continue;

    // PENDING LIMIT: parent order still on the book → still pending.
    if (row.status === "pending" && openIds.has(row.client_order_id)) continue;

    if (row.status === "pending") {
      // Parent gone from open orders → either filled or cancelled.
      const fill = await client.getFillForClientOrderId(row.client_order_id).catch(() => null);
      if (fill?.price && fill.price > 0 && (fill.qty ?? 0) > 0) {
        await supabaseAdmin.from("live_trades").update({
          status: "open",
          fill_price: fill.price,
          entry_price: fill.price,
        }).eq("id", row.id);
        n += 1;
      } else {
        // No fill → treat as cancelled by exchange (expiry/manual).
        await supabaseAdmin.from("live_trades").update({
          status: "closed",
          exit_ts: new Date().toISOString(),
          exit_reason: "cancelled",
        }).eq("id", row.id);
        n += 1;
      }
      continue;
    }

    // OPEN (already filled): if parent id still listed as an open child, keep open.
    if (openIds.has(row.client_order_id)) continue;

    const fill = await client.getFillForClientOrderId(row.client_order_id).catch(() => null);
    const exitPrice = fill?.price && fill.price > 0 ? fill.price : last;
    if (!exitPrice) continue;

    const dir = row.direction === "long" ? 1 : -1;
    const grossPnl = (exitPrice - Number(row.entry_price)) * dir * Number(row.qty);
    const stopDist = Math.abs(Number(row.entry_price) - Number(row.stop_price));
    const rr = stopDist > 0 ? ((exitPrice - Number(row.entry_price)) * dir) / stopDist : 0;
    const exitReason =
      dir === 1
        ? exitPrice <= Number(row.stop_price) * 1.001 ? "stop"
        : exitPrice >= Number(row.target_price) * 0.999 ? "target" : "closed"
        : exitPrice >= Number(row.stop_price) * 0.999 ? "stop"
        : exitPrice <= Number(row.target_price) * 1.001 ? "target" : "closed";

    await supabaseAdmin.from("live_trades").update({
      status: "closed",
      exit_ts: new Date().toISOString(),
      exit_price: exitPrice,
      exit_reason: exitReason,
      rr,
      gross_pnl: grossPnl,
      net_pnl: grossPnl,
      fees: 0,
    }).eq("id", row.id);
    n += 1;
  }
  return n;
}
