import { createFileRoute } from "@tanstack/react-router";
import { getPool } from "@/lib/db-admin.server";

const REQUIRED_TABLES = [
  "owner",
  "trades",
  "live_trades",
  "paper_trades",
  "trade_intelligence",
] as const;

export const Route = createFileRoute("/api/public/ready")({
  server: {
    handlers: {
      GET: async () => {
        const missingEnv = [
          ["DATABASE_HOST", process.env.DATABASE_HOST],
          ["DATABASE_NAME", process.env.DATABASE_NAME],
          ["COGNITO_USER_POOL_ID", process.env.COGNITO_USER_POOL_ID],
          ["COGNITO_CLIENT_ID", process.env.COGNITO_CLIENT_ID],
        ]
          .filter(([, value]) => !value)
          .map(([name]) => name);

        if (missingEnv.length > 0) {
          return Response.json(
            { ok: false, checks: { environment: { ok: false, missing: missingEnv } } },
            { status: 503, headers: { "cache-control": "no-store" } },
          );
        }

        try {
          const pool = await getPool();
          await pool.query("SELECT 1");

          const { rows } = await pool.query<{ table_name: string }>(
            `SELECT table_name
             FROM information_schema.tables
             WHERE table_schema = 'public'
               AND table_name = ANY($1::text[])
             ORDER BY table_name`,
            [REQUIRED_TABLES],
          );

          const present = new Set(rows.map((r) => r.table_name));
          const missingTables = REQUIRED_TABLES.filter((table) => !present.has(table));

          if (missingTables.length > 0) {
            return Response.json(
              {
                ok: false,
                checks: {
                  database: { ok: true },
                  requiredTables: { ok: false, missing: missingTables },
                },
              },
              { status: 503, headers: { "cache-control": "no-store" } },
            );
          }

          return Response.json(
            {
              ok: true,
              checks: {
                environment: { ok: true },
                database: { ok: true },
                requiredTables: { ok: true, tables: REQUIRED_TABLES },
              },
            },
            { headers: { "cache-control": "no-store" } },
          );
        } catch (error) {
          console.error("[ready] dependency check failed", error);
          return Response.json(
            {
              ok: false,
              checks: {
                environment: { ok: true },
                database: { ok: false },
              },
            },
            { status: 503, headers: { "cache-control": "no-store" } },
          );
        }
      },
    },
  },
});
