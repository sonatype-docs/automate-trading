import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";

import appCss from "../styles.css?url";
import { ThemeProvider, themeNoFlashScript } from "@/components/theme-provider";
import { AppShell } from "@/components/app-shell";
import { Toaster } from "@/components/ui/sonner";
import { onAuthChange } from "@/lib/auth-client";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              // A full reload also replaces stale chunks left in an open tab
              // after a deployment; router.invalidate() alone can reuse them.
              if (typeof window !== "undefined") {
                window.location.reload();
              } else {
                router.invalidate();
                reset();
              }
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "QUANT-BOT — Quant Workspace" },
      { name: "description", content: "Quantitative research, backtesting, trading and risk workspace." },
      { name: "author", content: "QUANT-BOT" },
      { property: "og:title", content: "QUANT-BOT — Quant Workspace" },
      { property: "og:description", content: "Quantitative research, backtesting, trading and risk workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "QUANT-BOT — Quant Workspace" },
      { name: "twitter:description", content: "Quantitative research, backtesting, trading and risk workspace." },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head suppressHydrationWarning>
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeNoFlashScript }} />
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthGate>
          <AppShell>
            {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
            <Outlet />
          </AppShell>
        </AuthGate>
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function AuthGate({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const router = useRouter();
  const [authReady, setAuthReady] = useState(pathname === "/login");
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    if (pathname === "/login") {
      setAuthReady(true);
      return;
    }

    setAuthReady(false);
    return onAuthChange((next) => {
      setSignedIn(next);
      setAuthReady(true);
      if (!next) {
        router.navigate({ to: "/login", replace: true });
      }
    });
  }, [pathname, router]);

  if (pathname === "/login") return <>{children}</>;

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="text-sm text-muted-foreground">Checking sign-in…</div>
      </div>
    );
  }

  if (!signedIn) return null;
  return <>{children}</>;
}
