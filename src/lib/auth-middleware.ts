import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

// Cognito-verified auth on AWS.
// context: { supabase, userId } — on AWS "supabase" is the server data client,
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

  const existing = await pool.query<{ id: string; is_owner: boolean }>(
    `select id, is_owner
       from public.users
      where cognito_sub = $1
      limit 1`,
    [payload.sub],
  );

  let user = existing.rows[0];

  if (!user) {
    const ownerExists = await pool.query<{ exists: boolean }>(
      `select exists (
         select 1 from public.users where is_owner = true
       ) as exists`,
    );
    if (ownerExists.rows[0]?.exists) {
      throw new Response("Forbidden", { status: 403 });
    }

    const created = await pool.query<{ id: string; is_owner: boolean }>(
      `insert into public.users (id, cognito_sub, email, is_owner)
       values (gen_random_uuid(), $1, $2, true)
       returning id, is_owner`,
      [payload.sub, typeof payload.email === "string" ? payload.email : null],
    );
    user = created.rows[0];
  }

  if (!user?.id || user.is_owner !== true) {
    throw new Response("Forbidden", { status: 403 });
  }

  return { userId: user.id, claims: payload };
}

const awsAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const request = getRequest();
  if (!request) throw new Response("Unauthorized", { status: 401 });
  const { userId, claims } = await verifyCognitoRequest(request);
  const { supabaseAdmin } = await import("./db-admin.server");
  return next({ context: { supabase: supabaseAdmin, userId, claims } });
});

export const requireAuth = awsAuth;
