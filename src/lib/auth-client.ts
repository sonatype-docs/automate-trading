// Browser authentication for the AWS deployment. Cognito is the only
// production identity provider.
export const AUTH_BACKEND = "aws" as const;

const POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID as string | undefined;
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID as string | undefined;
type Listener = (signedIn: boolean) => void;
const listeners = new Set<Listener>();
const emit = (value: boolean) => listeners.forEach((listener) => listener(value));

let pendingNewPasswordUser: any = null;

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

export async function signIn(email: string, password: string): Promise<{ needsNewPassword: boolean }> {
  const { m, pool } = await cognito();
  const user = new m.CognitoUser({ Username: email, Pool: pool });

  return new Promise((resolve, reject) => user.authenticateUser(
    new m.AuthenticationDetails({ Username: email, Password: password }),
    {
      onSuccess: () => {
        pendingNewPasswordUser = null;
        emit(true);
        resolve({ needsNewPassword: false });
      },
      newPasswordRequired: () => {
        pendingNewPasswordUser = user;
        resolve({ needsNewPassword: true });
      },
      onFailure: (error) => reject(error),
    },
  ));
}

export async function completeNewPassword(newPassword: string): Promise<void> {
  const user = pendingNewPasswordUser;
  if (!user) throw new Error("Your sign-in session expired. Please sign in again.");
  await new Promise<void>((resolve, reject) => user.completeNewPasswordChallenge(
    newPassword,
    {},
    {
      onSuccess: () => {
        pendingNewPasswordUser = null;
        emit(true);
        resolve();
      },
      onFailure: (error: Error) => reject(error),
    },
  ));
}

export async function signOut(): Promise<void> {
  const { pool } = await cognito();
  pool.getCurrentUser()?.signOut();
  pendingNewPasswordUser = null;
  emit(false);
}
