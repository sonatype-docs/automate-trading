// Browser auth facade: Cognito on AWS builds, Lovable Cloud otherwise.
export const AUTH_BACKEND: "aws" | "cloud" =
  import.meta.env.VITE_DATA_BACKEND === "aws" ? "aws" : "cloud";

const POOL_ID = (import.meta.env.VITE_COGNITO_USER_POOL_ID as string | undefined) ?? "ap-southeast-2_3CQ298jr5";
const CLIENT_ID = (import.meta.env.VITE_COGNITO_CLIENT_ID as string | undefined) ?? "4e1pclujqdgd24nljmbriu2e7l";

type Listener = (signedIn: boolean) => void;
const listeners = new Set<Listener>();
const emit = (v: boolean) => listeners.forEach((l) => l(v));

async function cognito() {
  if (typeof (globalThis as any).global === "undefined") (globalThis as any).global = globalThis;
  const m = await import("amazon-cognito-identity-js");
  const pool = new m.CognitoUserPool({ UserPoolId: POOL_ID, ClientId: CLIENT_ID });
  return { m, pool };
}

export async function getAccessToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (AUTH_BACKEND === "cloud") {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }
  const { pool } = await cognito();
  const user = pool.getCurrentUser();
  if (!user) return null;
  return new Promise((resolve) => {
    user.getSession((err: Error | null, session: any) => {
      if (err || !session?.isValid()) return resolve(null);
      resolve(session.getIdToken().getJwtToken());
    });
  });
}

export function onAuthChange(cb: Listener): () => void {
  listeners.add(cb);
  getAccessToken().then((t) => cb(!!t));
  let unsub: (() => void) | undefined;
  if (AUTH_BACKEND === "cloud") {
    import("@/integrations/supabase/client").then(({ supabase }) => {
      const { data } = supabase.auth.onAuthStateChange((_e, s) => cb(!!s));
      unsub = () => data.subscription.unsubscribe();
    });
  }
  return () => { listeners.delete(cb); unsub?.(); };
}

export async function signIn(email: string, password: string): Promise<void> {
  if (AUTH_BACKEND === "cloud") {
    const { supabase } = await import("@/integrations/supabase/client");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return emit(true);
  }
  const { m, pool } = await cognito();
  const user = new m.CognitoUser({ Username: email, Pool: pool });
  await new Promise<void>((resolve, reject) =>
    user.authenticateUser(new m.AuthenticationDetails({ Username: email, Password: password }), {
      onSuccess: () => resolve(),
      onFailure: (e) => reject(e),
    }),
  );
  emit(true);
}

export async function signUp(email: string, password: string): Promise<{ needsCode: boolean }> {
  if (AUTH_BACKEND === "cloud") {
    const { supabase } = await import("@/integrations/supabase/client");
    const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
    if (error) throw error;
    return { needsCode: false };
  }
  const { m, pool } = await cognito();
  await new Promise<void>((resolve, reject) =>
    pool.signUp(email, password, [new m.CognitoUserAttribute({ Name: "email", Value: email })], [], (e) => (e ? reject(e) : resolve())),
  );
  return { needsCode: true };
}

export async function confirmSignUp(email: string, code: string): Promise<void> {
  const { m, pool } = await cognito();
  const user = new m.CognitoUser({ Username: email, Pool: pool });
  await new Promise<void>((resolve, reject) => user.confirmRegistration(code, true, (e) => (e ? reject(e) : resolve())));
}

export async function signOut(): Promise<void> {
  if (AUTH_BACKEND === "cloud") {
    const { supabase } = await import("@/integrations/supabase/client");
    await supabase.auth.signOut();
  } else {
    const { pool } = await cognito();
    pool.getCurrentUser()?.signOut();
  }
  emit(false);
}
