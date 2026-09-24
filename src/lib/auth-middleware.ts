import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Cognito-verified auth on AWS; Lovable Cloud auth otherwise.
// context: { supabase, userId } — on AWS `supabase` is the server data client,
// so every query MUST filter by userId explicitly.
const awsAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const header = getRequest()?.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new Response("Unauthorized", { status: 401 });
  const { CognitoJwtVerifier } = await import("aws-jwt-verify");
  const verifier = CognitoJwtVerifier.create({
    userPoolId: process.env.COGNITO_USER_POOL_ID!,
    clientId: process.env.COGNITO_CLIENT_ID!,
    tokenUse: "id",
  });
  let payload: { sub: string; email?: unknown };
  try {
    payload = (await verifier.verify(token)) as any;
  } catch {
    throw new Response("Unauthorized", { status: 401 });
  }
  const { getPool, supabaseAdmin } = await import("./db-admin.server");
  const pool = await getPool();
  await pool.query(
    "insert into auth.users (id, email) values ($1, $2) on conflict (id) do update set email = excluded.email",
    [payload.sub, typeof payload.email === "string" ? payload.email : null],
  );
  return next({ context: { supabase: supabaseAdmin, userId: payload.sub, claims: payload } });
});

export const requireAuth = import.meta.env.VITE_DATA_BACKEND === "aws" ? awsAuth : requireSupabaseAuth;
