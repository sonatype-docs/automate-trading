import { useState, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
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
  const [open, setOpen] = useState(false);

  return (
    <SidebarProvider open={open} onOpenChange={setOpen}>
      <AppSidebar />
      <SidebarInset>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
        >
          Skip to main content
        </a>
        <header className="sticky top-0 z-30 flex h-11 items-center gap-3 border-b border-border/40 bg-background/50 px-3 backdrop-blur-2xl supports-[backdrop-filter]:bg-background/30 sm:px-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <span className="hidden text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70 sm:inline">
                Shark
              </span>
              <span className="hidden text-muted-foreground/40 sm:inline" aria-hidden>/</span>
              <h1 className="truncate font-display text-[15px] font-semibold tracking-tight text-foreground">
                {title}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border/50 bg-card/50 px-2.5 py-1 backdrop-blur-md">
            <span className="relative inline-flex h-1.5 w-1.5 shrink-0" aria-hidden>
              <span className="absolute inset-0 rounded-full bg-emerald-400/60 animate-ping" />
              <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_theme(colors.emerald.400)]" />
            </span>
            <span className="text-[11px] font-medium tracking-wide text-muted-foreground">Live</span>
          </div>
          <ThemeToggle />
        </header>
        <main
          id="main-content"
          key={pathname}
          className="min-h-[calc(100dvh-2.75rem)] animate-fade-in"
        >
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
