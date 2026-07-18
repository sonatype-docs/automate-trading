import { createFileRoute } from "@tanstack/react-router";

// Streams the FULL snapshot (all 68 columns, including JSONB) as CSV.
// JSONB / array fields are serialized as JSON strings so nothing is lost.
// Public route (single-owner app): no sign-in required.

const ALL_COLUMNS = [
  "id","trade_id","strategy_id","strategy_version","symbol","timeframe","direction",
  "trade_type","entry_type","stop_type","target_type","status",
  "signal_time","order_time","fill_time","entry_time","exit_time",
  "weekday","week_number","month","quarter","year","session",
  "entry_price","fill_price","exit_price","stop_price","target_price",
  "position_size","risk_usd","risk_pct","actual_rr","gross_pnl","net_pnl",
  "pnl_pct","pnl_r","mae","mfe","fees","commission","slippage","spread_cost",
  "holding_bars","duration_ms","exit_reason",
  "price","risk","performance","duration","volatility","trend","structure",
  "liquidity","smart_money","volume_profile","breakout","entry_quality",
  "stop","target","filters","news","regime","custom","tags","raw",
  "created_at","updated_at","snapshot_name",
];

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s: string;
  if (typeof v === "object") {
    try { s = JSON.stringify(v); } catch { s = String(v); }
  } else {
    s = String(v);
  }
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export const Route = createFileRoute("/api/public/export-snapshot")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const snapshot = url.searchParams.get("snapshot");
        if (!snapshot) return new Response("Missing snapshot", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const PAGE = 2000;
        const header = ALL_COLUMNS.join(",") + "\n";
        const encoder = new TextEncoder();

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(encoder.encode(header));
            let cursorTime: string | null = null;
            let cursorId: string | null = null;
            let total = 0;
            try {
              while (true) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                let q: any = (supabaseAdmin as any)
                  .from("trade_intelligence_archive")
                  .select(ALL_COLUMNS.join(","))
                  .eq("snapshot_name", snapshot)
                  .order("entry_time", { ascending: true, nullsFirst: true })
                  .order("trade_id", { ascending: true })
                  .limit(PAGE);
                if (cursorTime !== null && cursorId !== null) {
                  q = q.or(
                    `and(entry_time.eq.${cursorTime},trade_id.gt.${cursorId}),entry_time.gt.${cursorTime}`,
                  );
                } else if (cursorTime === null && cursorId !== null) {
                  q = q.is("entry_time", null).gt("trade_id", cursorId);
                }
                const { data, error } = await q;
                if (error) throw new Error(error.message);
                const rows = (data ?? []) as Record<string, unknown>[];
                if (rows.length === 0) break;
                let chunk = "";
                for (const r of rows) {
                  chunk += ALL_COLUMNS.map((c) => csvEscape(r[c])).join(",") + "\n";
                }
                controller.enqueue(encoder.encode(chunk));
                total += rows.length;
                const last = rows[rows.length - 1];
                cursorTime = (last.entry_time as string | null) ?? null;
                cursorId = (last.trade_id as string | null) ?? null;
                if (rows.length < PAGE) break;
              }
              controller.enqueue(encoder.encode(`# exported ${total} rows\n`));
              controller.close();
            } catch (e) {
              controller.enqueue(
                encoder.encode(`\n# ERROR: ${(e as Error).message}\n`),
              );
              controller.close();
            }
          },
        });

        const filename = `snapshot-${snapshot.replace(/[^a-z0-9_.-]/gi, "_")}.csv`;
        return new Response(stream, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
