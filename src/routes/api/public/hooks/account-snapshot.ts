// Debug endpoint — read exchange account snapshot (balances, positions).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/account-snapshot")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const apikey = request.headers.get("apikey") ?? new URL(request.url).searchParams.get("apikey");
        if (expected && apikey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const { createSharkClient } = await import("@/lib/exchange/shark-client.server");
          const snap = await createSharkClient().getAccountSnapshot();
          return Response.json(snap);
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
        }
      },
    },
  },
});
