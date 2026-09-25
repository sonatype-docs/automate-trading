// Cron endpoint — hit once per minute by pg_cron to run one LIVE trading tick.
import { createFileRoute } from "@tanstack/react-router";
import { authorizeScheduledRequest } from "@/lib/scheduler-auth.server";

export const Route = createFileRoute("/api/public/hooks/live-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = authorizeScheduledRequest(request);
        if (unauthorized) return unauthorized;
        const { runLiveTradingTick } = await import("@/lib/live-trading/tick.server");
        try {
          const result = await runLiveTradingTick();
          return Response.json(result);
        } catch (e) {
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 500 },
          );
        }
      },
      GET: async () => Response.json({ error: "POST required" }, { status: 405, headers: { Allow: "POST" } }),
    },
  },
});
