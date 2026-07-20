// Hourly watchdog — auto-diagnoses "runner ready but 0 orders placed" gaps
// and forces a repair tick when a valid strategy candidate is being ignored.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/live-watchdog")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const apikey = request.headers.get("apikey");
        if (expected && apikey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { runLiveWatchdog } = await import("@/lib/live-trading/watchdog.server");
        try {
          const result = await runLiveWatchdog();
          return Response.json(result);
        } catch (e) {
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 500 },
          );
        }
      },
      GET: async () => Response.json({ ok: true, hint: "POST to run the live watchdog" }),
    },
  },
});
