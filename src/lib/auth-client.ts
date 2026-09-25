// Browser authentication for the AWS deployment. Cognito is the only
// production identity provider; no hosted Supabase/Lovable session is used.
export const AUTH_BACKEND = "aws" as const;

const POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID as string | undefined;
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID as string | undefined;
type Listener = (signedIn: boolean) => void;
const listeners = new Set<Listener>();
const emit = (value: boolean) => listeners.forEach((listener) => listener(value));

async function cognito() {
  if (!POOL_ID || !CLIENT_ID) throw new Error("Cognito is not configured for this AWS build");
  if (typeof (globalThis as any).global === "undefined") (globalThis as any).global = globalThis;
  const m = await import("amazon-cognito-identity-js");
  const pool = new m.CognitoUserPool({ UserPoolId: POOL_ID, ClientId: CLIENT_ID });
  return { m, pool };
}

export async function getAccessToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const { pool } = await cognito();
  const user = pool.getCurrentUser();
  if (!user) return null;
  return new Promise((resolve) => user.getSession((error: Error | null, session: any) => {
    if (error || !session?.isValid()) return resolve(null);
    resolve(session.getIdToken().getJwtToken());
  }));
}

export function onAuthChange(callback: Listener): () => void {
  listeners.add(callback);
  getAccessToken().then((token) => callback(!!token)).catch(() => callback(false));
  return () => listeners.delete(callback);
}

export async function signIn(email: string, password: string): Promise<void> {
  const { m, pool } = await cognito();
  const user = new m.CognitoUser({ Username: email, Pool: pool });
  await new Promise<void>((resolve, reject) => user.authenticateUser(
    new m.AuthenticationDetails({ Username: email, Password: password }),
    { onSuccess: () => resolve(), onFailure: (error) => reject(error) },
  ));
  emit(true);
}

export async function signUp(email: string, password: string): Promise<{ needsCode: boolean }> {
  const { m, pool } = await cognito();
  await new Promise<void>((resolve, reject) => pool.signUp(
    email, password, [new m.CognitoUserAttribute({ Name: "email", Value: email })], [],
    (error) => error ? reject(error) : resolve(),
  ));
  return { needsCode: true };
}

export async function confirmSignUp(email: string, code: string): Promise<void> {
  const { m, pool } = await cognito();
  const user = new m.CognitoUser({ Username: email, Pool: pool });
  await new Promise<void>((resolve, reject) => user.confirmRegistration(code, true, (error) => error ? reject(error) : resolve()));
}

export async function signOut(): Promise<void> {
  const { pool } = await cognito();
  pool.getCurrentUser()?.signOut();
  emit(false);
}
