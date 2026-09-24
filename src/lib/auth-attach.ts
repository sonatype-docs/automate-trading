import { createMiddleware } from "@tanstack/react-start";
import { getAccessToken } from "./auth-client";

// Attaches the signed-in user's token (Cognito or Lovable Cloud) to server function calls.
export const attachAuth = createMiddleware({ type: "function" }).client(async ({ next }) => {
  const token = await getAccessToken();
  return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
});
