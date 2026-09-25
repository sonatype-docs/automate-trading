// Server-only data client. On AWS (DATA_BACKEND=aws) it talks to RDS PostgreSQL
// through a supabase-js compatible builder; otherwise it uses the Lovable Cloud admin client.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin as cloudAdmin } from "@/integrations/supabase/client.server";
import { createPgClient } from "./pg-query.server";

type Client = SupabaseClient<Database>;

let pgClient: Client | undefined;
let poolPromise: Promise<import("pg").Pool> | undefined;

export function isAwsBackend(): boolean {
  return process.env.DATA_BACKEND === "aws";
}

function tsText(v: string | null): string | null {
  if (v == null) return v;
  // "2026-09-24 12:00:00.123+00" -> "2026-09-24T12:00:00.123+00:00" (PostgREST style)
  return v.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
}

export async function getPool(): Promise<import("pg").Pool> {
  if (!poolPromise) {
    poolPromise = (async () => {
      const pg = await import("pg");
      const { Pool, types } = pg.default ?? pg;
      types.setTypeParser(1700, (v: string) => (v == null ? null : Number(v))); // numeric
      types.setTypeParser(20, (v: string) => (v == null ? null : Number(v))); // int8
      types.setTypeParser(1184, tsText); // timestamptz
      types.setTypeParser(1114, (v: string) => v); // timestamp
      types.setTypeParser(1082, (v: string) => v); // date
      const configuredPoolMax = Number(process.env.PGPOOL_MAX ?? "5");
      const poolMax = Number.isFinite(configuredPoolMax)
        ? Math.max(2, Math.min(8, Math.floor(configuredPoolMax)))
        : 5;
      const pool = new Pool({
        host: process.env.DATABASE_HOST,
        port: Number(process.env.DATABASE_PORT ?? 5432),
        database: process.env.DATABASE_NAME ?? "sharktrader",
        user: process.env.DATABASE_USER,
        password: process.env.DATABASE_PASSWORD,
        ssl: { rejectUnauthorized: false },
        max: poolMax,
        idleTimeoutMillis: 30_000,
        options: "-c timezone=UTC",
      });
      pool.on("error", (e) => console.error("[db] pool error", e.message));
      return pool;
    })();
  }
  return poolPromise;
}

function awsClient(): Client {
  if (!pgClient) {
    // Lazily resolve the pool on first query.
    const lazy = {
      from: (t: string) => {
        const chain: any[] = [];
        const proxy: any = new Proxy({}, {
          get(_, prop) {
            if (prop === "then") {
              return (res: any, rej: any) =>
                getPool().then((pool) => {
                  let b: any = createPgClient(pool).from(t);
                  for (const [m, args] of chain) b = b[m](...args);
                  return b.execute();
                }).then(res, rej);
            }
            return (...args: any[]) => { chain.push([prop, args]); return proxy; };
          },
        });
        return proxy;
      },
      rpc: async (fn: string, args?: Record<string, unknown>) => createPgClient(await getPool()).rpc(fn, args),
    };
    pgClient = lazy as unknown as Client;
  }
  return pgClient;
}

export const supabaseAdmin: Client = new Proxy({} as Client, {
  get(_, prop, receiver) {
    const target = isAwsBackend() ? awsClient() : cloudAdmin;
    return Reflect.get(target as object, prop, receiver);
  },
});
