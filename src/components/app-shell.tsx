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
  const [open, setOpen] = useState(false);
  const title = pageTitle(pathname);

  return (
    <SidebarProvider open={open} onOpenChange={setOpen}>
      <AppSidebar />
      <SidebarInset className="bg-background">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground focus:shadow-lg"
        >
          Skip to main content
        </a>
        <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-border bg-background/92 px-4 backdrop-blur-xl sm:px-6">
          <SidebarTrigger className="-ml-1 md:hidden" />
          <div className="min-w-0 flex-1">
            <p className="hidden text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:block">
              Shark Auto-Trader
            </p>
            <h1 className="truncate font-display text-base font-semibold tracking-tight text-foreground sm:mt-0.5">
              {title}
            </h1>
          </div>
          <div
            className="hidden items-center gap-2 border-l border-border pl-4 sm:flex"
            aria-label="System status: live"
          >
            <span className="relative flex h-2 w-2" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/45" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
            </span>
            <span className="text-xs font-medium text-muted-foreground">System live</span>
          </div>
          <ThemeToggle />
        </header>
        <MobileNavCarousel />
        <main
          id="main-content"
          key={pathname}
          className="min-h-[calc(100dvh-4rem)] animate-fade-in pb-20 md:pb-0"
        >
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
