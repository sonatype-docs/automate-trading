import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

// Cognito-verified auth on AWS; Supabase auth remains only for local preview.
// context: { supabase, userId } — on AWS `supabase` is the server data client,
// so every query MUST filter by userId explicitly.
export async function verifyCognitoRequest(request: Request): Promise<{
  userId: string;
  claims: { sub: string; email?: unknown };
}> {
  const header = request.headers.get("authorization") ?? "";
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
  const { getPool } = await import("./db-admin.server");
  const pool = await getPool();
  const { rows } = await pool.query<{ id: string }>(
    `insert into public.users (id, cognito_sub, email)
     values (gen_random_uuid(), $1, $2)
     on conflict (cognito_sub) do update set email = excluded.email
     returning id`,
    [payload.sub, typeof payload.email === "string" ? payload.email : null],
  );
  if (!rows[0]?.id) throw new Response("Unable to map authenticated user", { status: 500 });
  return { userId: rows[0].id, claims: payload };
}

const awsAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const request = getRequest();
  if (!request) throw new Response("Unauthorized", { status: 401 });
  const { userId, claims } = await verifyCognitoRequest(request);
  const { supabaseAdmin } = await import("./db-admin.server");
  return next({ context: { supabase: supabaseAdmin, userId, claims } });
});

export const requireAuth = awsAuth;
