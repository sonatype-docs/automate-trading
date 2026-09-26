import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AUTH_BACKEND, completeNewPassword, signIn, signOut } from "@/lib/auth-client";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — Shark Auto Trader" },
      { name: "description", content: "Sign in to save presets and manage your trading workspace." },
      { property: "og:title", content: "Sign in — Shark Auto Trader" },
      { property: "og:description", content: "Sign in to save presets and manage your trading workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "new-password">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "in") {
        const result = await signIn(email, password);
        if (result.needsNewPassword) {
          setNewPassword("");
          setMode("new-password");
          toast.success("Choose a new password to finish your first sign-in");
        } else {
          toast.success("Signed in");
          navigate({ to: "/" });
        }
      } else {
        await completeNewPassword(newPassword);
        toast.success("Password updated");
        navigate({ to: "/" });
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm items-center p-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{mode === "in" ? "Sign in" : "Set your password"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={mode === "new-password"}
              autoComplete="email"
            />
            {mode === "in" ? (
              <Input
                type="password"
                placeholder="Temporary password or password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={12}
                autoComplete="current-password"
              />
            ) : (
              <Input
                type="password"
                placeholder="New password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={12}
                autoComplete="new-password"
              />
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Please wait…" : mode === "in" ? "Sign in" : "Set password"}
            </Button>
          </form>
          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            {mode === "new-password" ? (
              <button type="button" className="underline" onClick={() => {
                setMode("in");
                setNewPassword("");
              }}>
                Back to sign in
              </button>
            ) : (
              <span>Use the invitation email to access the AWS account.</span>
            )}
            <button type="button" className="underline" onClick={() => signOut().then(() => toast.success("Signed out"))}>Sign out</button>
          </div>
          {AUTH_BACKEND === "aws" && (
            <p className="mt-3 text-xs text-muted-foreground">Accounts are managed on AWS.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
