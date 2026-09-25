// Authenticated manual order intent endpoint.
// GET and scheduler-secret access are intentionally forbidden.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { verifyCognitoRequest } from "@/lib/auth-middleware";

const OrderSchema = z.object({
  symbol: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/),
  side: z.enum(["buy", "sell"]),
  qty: z.number().finite().positive().max(1_000_000),
  type: z.enum(["market", "limit"]).default("limit"),
  price: z.number().finite().positive().optional(),
  sl: z.number().finite().positive().optional(),
  tp: z.number().finite().positive().optional(),
  reduceOnly: z.boolean().default(false),
});

export const Route = createFileRoute("/api/public/hooks/manual-place")({
  server: {
    handlers: {
      GET: async () => Response.json({ error: "POST required" }, { status: 405, headers: { Allow: "POST" } }),
      POST: async ({ request }) => {
        if (process.env.DATA_BACKEND !== "aws") {
          return Response.json({ ok: false, error: "AWS authentication is required" }, { status: 503 });
        }

        let auth: Awaited<ReturnType<typeof verifyCognitoRequest>>;
        try {
          auth = await verifyCognitoRequest(request);
        } catch (error) {
          return error instanceof Response ? error : Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const idempotencyKey = request.headers.get("idempotency-key")?.trim();
        if (!idempotencyKey || idempotencyKey.length > 200) {
          return Response.json({ ok: false, error: "idempotency_key_required" }, { status: 400 });
        }

        let parsed: z.infer<typeof OrderSchema>;
        try {
          parsed = OrderSchema.parse(await request.json());
          if (parsed.type === "limit" && !parsed.price) throw new Error("LIMIT orders require price");
        } catch (error) {
          return Response.json({ ok: false, error: error instanceof Error ? error.message : "invalid_payload" }, { status: 400 });
        }

        const { getPool } = await import("@/lib/db-admin.server");
        const pool = await getPool();
        const payload = { ...parsed, symbol: parsed.symbol.toUpperCase() };
        const inserted = await pool.query<{ id: string }>(
          `insert into public.manual_order_intents (idempotency_key, user_id, payload)
           values ($1, $2, $3::jsonb)
           on conflict (idempotency_key) do nothing
           returning id`,
          [idempotencyKey, auth.userId, JSON.stringify(payload)],
        );

        if (!inserted.rows[0]) {
          const existing = await pool.query<{ id: string; user_id: string; status: string; broker_order_id: string | null; error: string | null }>(
            `select id, user_id, status, broker_order_id, error from public.manual_order_intents where idempotency_key = $1`,
            [idempotencyKey],
          );
          const row = existing.rows[0];
          if (!row || row.user_id !== auth.userId) {
            return Response.json({ ok: false, error: "idempotency_key_unavailable" }, { status: 409 });
          }
          return Response.json({ ok: true, duplicate: true, intent: { ...row, user_id: undefined } });
        }

        try {
          const { createSharkClient } = await import("@/lib/exchange/shark-client.server");
          const result = await createSharkClient().placeOrder({
            symbol: payload.symbol,
            side: payload.side,
            qty: payload.qty,
            type: payload.type,
            price: payload.price,
            stopLossPrice: payload.sl,
            takeProfitPrice: payload.tp,
            reduceOnly: payload.reduceOnly,
          });
          await pool.query(
            `update public.manual_order_intents set status = 'submitted', broker_order_id = $2, updated_at = now() where id = $1`,
            [inserted.rows[0].id, result.exchangeOrderId ?? null],
          );
          return Response.json({ ok: true, intentId: inserted.rows[0].id, order: result });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await pool.query(
            `update public.manual_order_intents set status = 'rejected', error = $2, updated_at = now() where id = $1`,
            [inserted.rows[0].id, message.slice(0, 1000)],
          );
          return Response.json({ ok: false, intentId: inserted.rows[0].id, error: message }, { status: 409 });
        }
      },
    },
  },
});
