import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AUTH_BACKEND, confirmSignUp, signIn, signOut, signUp } from "@/lib/auth-client";

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
  const [mode, setMode] = useState<"in" | "up" | "code">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "in") {
        await signIn(email, password);
        toast.success("Signed in");
        navigate({ to: "/" });
      } else if (mode === "up") {
        const r = await signUp(email, password);
        if (r.needsCode) { setMode("code"); toast.success("Check your email for a verification code"); }
        else { toast.success("Check your email to confirm your account"); setMode("in"); }
      } else {
        await confirmSignUp(email, code);
        await signIn(email, password);
        toast.success("Account confirmed");
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
          <CardTitle>{mode === "in" ? "Sign in" : mode === "up" ? "Create account" : "Verify email"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            {mode !== "code" && (
              <>
                <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
                <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete={mode === "in" ? "current-password" : "new-password"} />
              </>
            )}
            {mode === "code" && (
              <Input placeholder="Verification code" value={code} onChange={(e) => setCode(e.target.value)} required inputMode="numeric" />
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Please wait…" : mode === "in" ? "Sign in" : mode === "up" ? "Create account" : "Verify"}
            </Button>
          </form>
          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            {mode === "in" ? (
              <button type="button" className="underline" onClick={() => setMode("up")}>Create account</button>
            ) : (
              <button type="button" className="underline" onClick={() => setMode("in")}>Back to sign in</button>
            )}
            <button type="button" className="underline" onClick={() => signOut().then(() => toast.success("Signed out"))}>Sign out</button>
          </div>
          {AUTH_BACKEND === "aws" && <p className="mt-3 text-xs text-muted-foreground">Accounts are managed on AWS.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
