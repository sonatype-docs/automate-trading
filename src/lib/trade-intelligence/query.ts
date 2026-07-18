// Query Engine — builds a Supabase query from a TradeQuerySpec.
// Uses the authenticated user's supabase client (RLS scoped to owner).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TradeQuerySpec } from "./types";

export function applyQuery(
  client: SupabaseClient,
  table: string,
  spec: TradeQuerySpec & { snapshotName?: string },
) {
  // Do not request PostgREST counts here. Planned counts can badly
  // underestimate filtered snapshot rows while a pipeline is appending, which
  // makes later chunks return 416 "Requested range not satisfiable" even when
  // rows exist. The Research page only needs the rows; snapshot counts come
  // from listSnapshots().
  let q = client.from(table).select("*");
  if (spec.snapshotName) q = q.eq("snapshot_name", spec.snapshotName);
  if (spec.strategyId) q = q.eq("strategy_id", spec.strategyId);
  if (spec.symbol) q = q.eq("symbol", spec.symbol);
  if (spec.timeframe) q = q.eq("timeframe", spec.timeframe);
  if (spec.direction) q = q.eq("direction", spec.direction);
  if (spec.session) q = q.eq("session", spec.session);
  if (spec.weekday != null) q = q.eq("weekday", spec.weekday);
  if (spec.fromMs != null) q = q.gte("entry_time", new Date(spec.fromMs).toISOString());
  if (spec.toMs != null) q = q.lte("entry_time", new Date(spec.toMs).toISOString());
  if (spec.minNetPnl != null) q = q.gte("net_pnl", spec.minNetPnl);
  if (spec.maxNetPnl != null) q = q.lte("net_pnl", spec.maxNetPnl);
  if (spec.winnersOnly) q = q.gt("net_pnl", 0);
  if (spec.losersOnly) q = q.lt("net_pnl", 0);
  if (spec.tags?.length) q = q.contains("tags", spec.tags);
  if (spec.customContains && Object.keys(spec.customContains).length) q = q.contains("custom", spec.customContains);
  if (spec.filtersContains && Object.keys(spec.filtersContains).length) q = q.contains("filters", spec.filtersContains);
  const orderBy = spec.orderBy ?? "entry_time";
  q = q.order(orderBy, { ascending: spec.order === "asc" });
  const limit = Math.min(spec.limit ?? 100, 20000);
  const offset = spec.offset ?? 0;
  q = q.range(offset, offset + limit - 1);
  return q;
}
