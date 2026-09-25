import { useState, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { ThemeToggle } from "./theme-toggle";
import { MobileNavCarousel } from "./mobile-nav-carousel";

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/journal": "Journal",
  "/analytics": "Analytics",
  "/reports": "Reports",
  "/backtest": "Backtest",
  "/bot": "ORB Bot",
  "/paper-trading": "Paper Trading",
  "/live-trading": "Live Trading",
  "/research": "Research",
  "/settings": "Settings",
  "/pending-orders": "Pending Orders",
  "/docs": "Documentation",
};

function pageTitle(pathname: string) {
  const match = Object.keys(TITLES)
    .filter((route) => (route === "/" ? pathname === route : pathname.startsWith(route)))
    .sort((a, b) => b.length - a.length)[0];
  return TITLES[match ?? "/"];
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const [open, setOpen] = useState(true);
  const title = pageTitle(pathname);

  return (
    <SidebarProvider open={open} onOpenChange={setOpen}>
      <AppSidebar />
      <SidebarInset className="relative overflow-hidden bg-background">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-0 h-72 bg-[radial-gradient(circle_at_18%_0%,color-mix(in_oklch,var(--color-primary)_18%,transparent),transparent_52%),radial-gradient(circle_at_82%_0%,color-mix(in_oklch,var(--color-brand-violet)_12%,transparent),transparent_48%)]" />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground focus:shadow-lg"
        >
          Skip to main content
        </a>
        <header className="sticky top-0 z-40 flex h-[4.5rem] items-center gap-3 border-b border-border/70 bg-background/78 px-4 backdrop-blur-2xl sm:px-6">
          <SidebarTrigger className="-ml-1 md:hidden" />
          <div className="relative min-w-0 flex-1">
            <p className="hidden text-[10px] font-semibold uppercase tracking-[0.2em] text-primary sm:block">
              Control center <span className="text-muted-foreground/60">/</span> Shark Auto-Trader
            </p>
            <h1 className="truncate font-display text-lg font-semibold tracking-tight text-foreground sm:mt-0.5">
              {title}
            </h1>
          </div>
          <div
            className="hidden items-center gap-2 rounded-full border border-success/25 bg-success/8 px-3 py-1.5 sm:flex"
            aria-label="System status: live"
          >
            <span className="relative flex h-2 w-2" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/45" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
            </span>
            <span className="text-[11px] font-semibold tracking-wide text-success">SYSTEM LIVE</span>
          </div>
          <ThemeToggle />
        </header>
        <MobileNavCarousel />
        <main
          id="main-content"
          key={pathname}
          className="relative z-10 min-h-[calc(100dvh-4.5rem)] animate-fade-in pb-20 md:pb-0"
        >
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
