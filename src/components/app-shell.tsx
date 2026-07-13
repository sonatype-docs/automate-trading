import type { ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { AppSidebar } from "./app-sidebar";
import { ThemeToggle } from "./theme-toggle";

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/journal": "Journal",
  "/analytics": "Analytics",
  "/reports": "Reports",
  "/backtest": "Backtest",
  "/pending-orders": "Pending Orders",
  "/docs": "Docs",
  "/settings": "Settings",
};

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const title = TITLES[pathname] ?? TITLES[Object.keys(TITLES).find((k) => k !== "/" && pathname.startsWith(k)) ?? "/"] ?? "Shark";

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
        >
          Skip to main content
        </a>
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border/50 bg-background/60 px-3 backdrop-blur-2xl supports-[backdrop-filter]:bg-background/40">
          <SidebarTrigger className="h-9 w-9" aria-label="Toggle navigation" />
          <Separator orientation="vertical" className="h-5 opacity-60" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <span className="relative inline-flex h-2 w-2 shrink-0" aria-hidden>
                <span className="absolute inset-0 rounded-full bg-primary/50 animate-ping" />
                <span className="relative inline-block h-2 w-2 rounded-full bg-primary shadow-[0_0_12px_var(--color-primary)]" />
              </span>
              <h1 className="truncate font-display text-sm font-semibold tracking-tight">{title}</h1>
            </div>
          </div>
          <ThemeToggle />
        </header>
        <main
          id="main-content"
          key={pathname}
          className="min-h-[calc(100dvh-3.5rem)] animate-fade-in"
        >
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
