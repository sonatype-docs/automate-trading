import { createFileRoute } from "@tanstack/react-router";
import { authorizeScheduledRequest } from "@/lib/scheduler-auth.server";

export const Route = createFileRoute("/api/public/hooks/strategy-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = authorizeScheduledRequest(request);
        if (unauthorized) return unauthorized;
        const { runStrategyTick } = await import("@/lib/strategy/engine.server");
        try {
          const result = await runStrategyTick();
          return Response.json(result);
        } catch (e) {
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 500 },
          );
        }
      },
      GET: async () => Response.json({ ok: true, hint: "POST to run a tick" }),
    },
  },
});
