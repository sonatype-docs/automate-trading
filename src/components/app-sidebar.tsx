import { useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  BookMarked,
  BookOpen,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Cpu,
  Database,
  FileText,
  FlaskConical,
  GitCompare,
  LayoutDashboard,
  LineChart,
  ListOrdered,
  PlayCircle,
  Settings as SettingsIcon,
  Shield,
  Sparkles,
  Target,
  Sunrise,
  Waves,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

type NavEntry = { title: string; url: string; icon: LucideIcon };

type NavGroup = {
  id: string;
  label: string;
  items: NavEntry[];
};

const groups: NavGroup[] = [
  {
    id: "overview",
    label: "Overview",
    items: [
      { title: "Command Center", url: "/", icon: LayoutDashboard },
      { title: "Journal", url: "/journal", icon: BookOpen },
      { title: "Analytics", url: "/analytics", icon: BarChart3 },
      { title: "Reports", url: "/reports", icon: FileText },
    ],
  },
  {
    id: "research",
    label: "Research",
    items: [
      { title: "Strategies", url: "/strategy-engine", icon: FlaskConical },
      { title: "Quant Engine", url: "/quant-engine", icon: Cpu },
      { title: "Research", url: "/research", icon: BarChart3 },
      { title: "Research Lab", url: "/research-lab", icon: FlaskConical },
      { title: "AI Research", url: "/ai-research", icon: Sparkles },
      { title: "Optimizer", url: "/optimizer", icon: Sparkles },
      { title: "Trade Intelligence", url: "/trade-intelligence", icon: Database },
    ],
  },
  {
    id: "backtesting",
    label: "Backtesting",
    items: [
      { title: "Fib Zone Lab", url: "/backtest", icon: FlaskConical },
      { title: "Silver Bullet", url: "/backtest/silver-bullet", icon: Zap },
      { title: "Asian Sweep", url: "/backtest/asian-sweep", icon: Sunrise },
      { title: "Multi-Session ORB", url: "/backtest/orb", icon: Target },
      { title: "PDH/PDL Sweep", url: "/backtest/pdh-pdl-sweep", icon: Waves },
      { title: "Compare Strategies", url: "/backtest/compare", icon: GitCompare },
    ],
  },
  {
    id: "trading",
    label: "Trading",
    items: [
      { title: "Bots", url: "/bot", icon: Bot },
      { title: "Pending Orders", url: "/pending-orders", icon: ListOrdered },
      { title: "Paper Trading", url: "/paper-trading", icon: Activity },
      { title: "Live Trading", url: "/live-trading", icon: Zap },
      { title: "Pipeline", url: "/pipeline", icon: PlayCircle },
    ],
  },
  {
    id: "data-engines",
    label: "Data & Engines",
    items: [
      { title: "Market Data", url: "/market-data", icon: Database },
      { title: "Execution Engine", url: "/execution-engine", icon: Zap },
      { title: "Strategy Engine", url: "/strategy-engine", icon: Cpu },
    ],
  },
  {
    id: "resources",
    label: "Resources",
    items: [
      { title: "XAU/USD Handbook", url: "/handbook", icon: BookMarked },
      { title: "London ORB Guide", url: "/handbook/v1/london-orb", icon: Target },
      { title: "Docs", url: "/docs", icon: FileText },
      { title: "Settings", url: "/settings", icon: SettingsIcon },
    ],
  },
];

function pathIsActive(pathname: string, url: string) {
  if (url === "/") return pathname === "/";
  return pathname === url || pathname.startsWith(url + "/");
}

export function AppSidebar() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { state, isMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(groups.map((group) => [group.id, group.id === "overview"])),
  );

  return (
    <Sidebar collapsible="icon" className="bg-sidebar">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
        <Link
          to="/"
          aria-label="Go to Command Center"
          className="flex items-center gap-3 rounded-lg p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Activity className="h-4.5 w-4.5" aria-hidden />
          </div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <div className="truncate text-sm font-semibold tracking-tight text-sidebar-foreground">
              QUANT-BOT
            </div>
            <div className="mt-0.5 truncate text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Quant workspace
            </div>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className="gap-5 px-3 py-4">
        {groups.map((group) => {
          const activeGroup = group.items.some((item) => pathIsActive(pathname, item.url));
          const isOpen = !collapsed && (openGroups[group.id] ?? false);

          return (
            <div key={group.id} className="space-y-1.5">
              <button
                type="button"
                onClick={() =>
                  setOpenGroups((current) => ({
                    ...current,
                    [group.id]: !(current[group.id] ?? false),
                  }))
                }
                aria-expanded={isOpen}
                className={[
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
                  "text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
                  "group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0",
                  activeGroup ? "text-sidebar-foreground" : "",
                ].join(" ")}
              >
                <span className="truncate group-data-[collapsible=icon]:hidden">{group.label}</span>
                <ChevronDown
                  className={[
                    "h-3.5 w-3.5 shrink-0 transition-transform group-data-[collapsible=icon]:hidden",
                    isOpen ? "rotate-0" : "-rotate-90",
                  ].join(" ")}
                  aria-hidden
                />
              </button>

              {(isOpen || collapsed || isMobile) && (
                <SidebarMenu className="gap-1">
                  {group.items.map((item) => (
                    <NavItem
                      key={item.url}
                      title={item.title}
                      active={pathIsActive(pathname, item.url)}
                    >
                      <Link to={item.url as never}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </NavItem>
                  ))}
                </SidebarMenu>
              )}
            </div>
          );
        })}

        <div className="rounded-lg border border-primary/15 bg-primary/5 p-3 group-data-[collapsible=icon]:hidden">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <Shield className="h-3.5 w-3.5 text-primary" aria-hidden />
            Safety
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden />
            Controls server-enforced
          </div>
          <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">
            Live trading controls remain protected by server-side risk gates.
          </p>
        </div>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3">
        <CollapseToggle />
      </SidebarFooter>
    </Sidebar>
  );
}

function NavItem({
  title,
  active,
  children,
}: {
  title: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        tooltip={title}
        className={[
          "h-9 rounded-md px-2.5 text-sm",
          "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
          "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground",
          "data-[active=true]:font-medium",
        ].join(" ")}
      >
        {children}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function CollapseToggle() {
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";

  return (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground group-data-[collapsible=icon]:justify-center"
    >
      {collapsed ? (
        <ChevronsRight className="h-4 w-4 shrink-0" />
      ) : (
        <ChevronsLeft className="h-4 w-4 shrink-0" />
      )}
      <span className="group-data-[collapsible=icon]:hidden">
        {collapsed ? "Expand" : "Collapse"}
      </span>
    </button>
  );
}
