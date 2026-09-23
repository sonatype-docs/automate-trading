// Debug endpoint — place a manual order on the exchange with explicit params.
import { createFileRoute } from "@tanstack/react-router";
import { authorizeScheduledRequest } from "@/lib/scheduler-auth.server";

export const Route = createFileRoute("/api/public/hooks/manual-place")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const unauthorized = authorizeScheduledRequest(request);
        if (unauthorized) return unauthorized;
        const url = new URL(request.url);
        try {
          const symbol = url.searchParams.get("symbol") ?? "XAUUSDT";
          const side = (url.searchParams.get("side") ?? "sell") as "buy" | "sell";
          const qty = Number(url.searchParams.get("qty") ?? "12");
          const price = Number(url.searchParams.get("price") ?? "4021.25");
          const sl = url.searchParams.get("sl") ? Number(url.searchParams.get("sl")) : undefined;
          const tp = url.searchParams.get("tp") ? Number(url.searchParams.get("tp")) : undefined;
          const leverage = Number(url.searchParams.get("leverage") ?? "75");

          const { createSharkClient } = await import("@/lib/exchange/shark-client.server");
          const client = createSharkClient();
          const lev = await client.updateLeverage(symbol, leverage);
          try {
            const result = await client.placeOrder({
              symbol,
              side,
              qty,
              type: "limit",
              price,
              stopLossPrice: sl,
              takeProfitPrice: tp,
            });
            return Response.json({ ok: true, leverage: lev, order: result });
          } catch (err) {
            return Response.json(
              { ok: false, leverage: lev, error: err instanceof Error ? err.message : String(err) },
              { status: 500 },
            );
          }
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
        }
      },
    },
  },
});
