import { createFileRoute } from "@tanstack/react-router";
import { verifyCognitoRequest } from "@/lib/auth-middleware";

export const Route = createFileRoute("/api/files/list")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let auth: Awaited<ReturnType<typeof verifyCognitoRequest>>;
        try {
          auth = await verifyCognitoRequest(request);
        } catch (error) {
          return error instanceof Response
            ? error
            : Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { getPool } = await import("@/lib/db-admin.server");
        const { rows } = await (await getPool()).query(
          `select id, filename, content_type, size_bytes, checksum, status, created_at
           from public.private_files
           where user_id = $1
           order by created_at desc
           limit 100`,
          [auth.userId],
        );
        return Response.json({ files: rows }, { headers: { "cache-control": "no-store" } });
      },
    },
  },
});
