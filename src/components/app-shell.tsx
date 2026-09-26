import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Command as CommandIcon, HelpCircle, Search, Bell, Activity, ChevronRight } from "lucide-react";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { ThemeToggle } from "./theme-toggle";
import { MobileNavCarousel } from "./mobile-nav-carousel";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";

const TITLES: Record<string, string> = {
  "/": "Command Center",
  "/journal": "Journal",
  "/analytics": "Analytics",
  "/reports": "Reports",
  "/backtest": "Backtesting",
  "/backtest/compare": "Comparator Lab",
  "/bot": "Bots",
  "/paper-trading": "Paper Trading",
  "/live-trading": "Live Trading",
  "/pending-orders": "Pending Orders",
  "/research": "Research",
  "/research-lab": "Research Lab",
  "/ai-research": "AI Research",
  "/optimizer": "Optimizer",
  "/pipeline": "Research Pipeline",
  "/trade-intelligence": "Trade Intelligence",
  "/quant-engine": "Quant Engine",
  "/strategy-engine": "Strategy Engine",
  "/execution-engine": "Execution Engine",
  "/market-data": "Market Data",
  "/settings": "Settings",
  "/docs": "Documentation",
  "/handbook": "XAU/USD Handbook",
  "/files": "Files",
  "/login": "Sign in",
};

const SEARCH_TARGETS = [
  { label: "Command Center", group: "Overview", url: "/" },
  { label: "Bots", group: "Trading", url: "/bot" },
  { label: "Paper Trading", group: "Trading", url: "/paper-trading" },
  { label: "Live Trading", group: "Trading", url: "/live-trading" },
  { label: "Pending Orders", group: "Trading", url: "/pending-orders" },
  { label: "Backtesting", group: "Research", url: "/backtest" },
  { label: "Compare Strategies", group: "Research", url: "/backtest/compare" },
  { label: "Quant Engine", group: "Research", url: "/quant-engine" },
  { label: "Research Lab", group: "Research", url: "/research-lab" },
  { label: "AI Research", group: "Research", url: "/ai-research" },
  { label: "Optimizer", group: "Research", url: "/optimizer" },
  { label: "Market Data", group: "Data", url: "/market-data" },
  { label: "Analytics", group: "Analytics", url: "/analytics" },
  { label: "Reports", group: "Analytics", url: "/reports" },
  { label: "Settings", group: "System", url: "/settings" },
  { label: "Documentation", group: "System", url: "/docs" },
];

function pageTitle(pathname: string) {
  const match = Object.keys(TITLES)
    .filter((route) => (route === "/" ? pathname === route : pathname === route || pathname.startsWith(route + "/")))
    .sort((a, b) => b.length - a.length)[0];

  return TITLES[match ?? "/"] ?? "Command Center";
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const navigate = useNavigate();
  const [commandOpen, setCommandOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const groupedTargets = useMemo(() => {
    return SEARCH_TARGETS.reduce<Record<string, typeof SEARCH_TARGETS>>((acc, target) => {
      (acc[target.group] ??= []).push(target);
      return acc;
    }, {});
  }, []);

  const navigateTo = (url: string) => {
    setCommandOpen(false);
    navigate({ to: url as never });
  };

  return (
    <SidebarProvider defaultOpen={true}>
      <AppSidebar />
      <SidebarInset className="min-w-0 bg-background">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
        >
          Skip to main content
        </a>

        <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-border/80 bg-background/95 px-4 backdrop-blur sm:px-6">
          <SidebarTrigger className="h-9 w-9 shrink-0" aria-label="Toggle navigation" />

          <div className="hidden items-center gap-2 lg:flex">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">
              <Activity className="h-4 w-4" aria-hidden />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight text-foreground">QUANT-BOT</div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Research & trading
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            className="group flex h-9 min-w-0 flex-1 max-w-xl items-center gap-2 rounded-md border border-input bg-card px-3 text-left text-sm text-muted-foreground transition-colors hover:border-primary/35 hover:bg-accent/35"
            aria-label="Open global search"
          >
            <Search className="h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">Search strategies, bots, runs, symbols…</span>
            <kbd className="hidden items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] sm:flex">
              <CommandIcon className="h-3 w-3" aria-hidden /> K
            </kbd>
          </button>

          <div className="ml-auto flex items-center gap-1.5">
            <div className="hidden items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground xl:flex">
              <span className="h-2 w-2 rounded-full bg-success" aria-hidden />
              System live
            </div>

            <button
              type="button"
              className="relative grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Notifications"
              title="Notifications"
            >
              <Bell className="h-4 w-4" aria-hidden />
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
            </button>

            <button
              type="button"
              className="hidden h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground sm:grid"
              aria-label="Help"
              title="Help"
            >
              <HelpCircle className="h-4 w-4" aria-hidden />
            </button>

            <ThemeToggle />
          </div>
        </header>

        <MobileNavCarousel />

        <main
          id="main-content"
          key={pathname}
          className="min-h-[calc(100dvh-4rem)] min-w-0 animate-fade-in pb-20 md:pb-0"
        >
          <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
            <div className="mb-6 space-y-3">
              <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted-foreground">
                <button type="button" onClick={() => navigateTo("/")} className="hover:text-foreground">Command Center</button>
                {pathname !== "/" && (
                  <>
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                    <span className="truncate">{pageTitle(pathname)}</span>
                  </>
                )}
              </nav>
              <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border/70 pb-5">
                <div className="min-w-0">
                  <h1 className="text-[28px] font-semibold leading-9 tracking-tight text-foreground">
                    {pageTitle(pathname)}
                  </h1>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                    {pathname === "/" ? "Monitor research, trading, performance and risk from one workspace." : "Use the workspace below to research, configure, analyze and monitor this part of QUANT-BOT."}
                  </p>
                </div>

              </div>
            </div>
            {children}
          </div>
        </main>
      </SidebarInset>

      <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
        <CommandInput placeholder="Search QUANT-BOT…" />
        <CommandList>
          <CommandEmpty>No matching workspace found.</CommandEmpty>
          {Object.entries(groupedTargets).map(([group, targets]) => (
            <CommandGroup key={group} heading={group}>
              {targets.map((target) => (
                <CommandItem
                  key={target.url}
                  value={`${target.label} ${target.group}`}
                  onSelect={() => navigateTo(target.url)}
                >
                  <Search className="h-4 w-4 text-muted-foreground" aria-hidden />
                  <span>{target.label}</span>
                  <CommandShortcut>{target.url}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </SidebarProvider>
  );
}
