import { createMiddleware } from "@tanstack/react-start";
import { getAccessToken } from "./auth-client";

// Attaches the signed-in user's Cognito token to server function calls.
export const attachAuth = createMiddleware({ type: "function" }).client(async ({ next }) => {
  const token = await getAccessToken();
  return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
});
