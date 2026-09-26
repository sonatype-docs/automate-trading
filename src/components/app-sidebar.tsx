import { useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  BookOpen,
  BarChart3,
  FileText,
  Settings as SettingsIcon,
  Waves,
  Bot,
  Target,
  Sunrise,
  Zap,
  GitCompare,
  BookMarked,
  Database,
  Cpu,
  Sparkles,
  FlaskConical,
  ChevronsLeft,
  ChevronsRight,
  PlayCircle,
  Activity,
  ChevronDown,
  Folder,
  LineChart,
  Shield,
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

const folders: Array<{
  id: string;
  label: string;
  icon: LucideIcon;
  items: NavEntry[];
  defaultOpen?: boolean;
}> = [
  {
    id: "overview",
    label: "Overview",
    icon: LayoutDashboard,
    defaultOpen: false,
    items: [
      { title: "Dashboard", url: "/", icon: LayoutDashboard },
      { title: "Journal", url: "/journal", icon: BookOpen },
      { title: "Analytics", url: "/analytics", icon: BarChart3 },
      { title: "Reports", url: "/reports", icon: FileText },
    ],
  },
  {
    id: "trading",
    label: "Trading",
    icon: Activity,
    defaultOpen: false,
    items: [
      { title: "ORB Bot", url: "/bot", icon: Bot },
      { title: "Pending Orders", url: "/pending-orders", icon: FileText },
      { title: "Paper Trading", url: "/paper-trading", icon: Activity },
      { title: "Live Trading", url: "/live-trading", icon: Zap },
    ],
  },
  {
    id: "backtesting",
    label: "Backtesting",
    icon: LineChart,
    defaultOpen: false,
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
    id: "research",
    label: "Research & Quant",
    icon: Sparkles,
    defaultOpen: false,
    items: [
      { title: "Quant Engine", url: "/quant-engine", icon: Cpu },
      { title: "Research", url: "/research", icon: BarChart3 },
      { title: "Research Lab", url: "/research-lab", icon: FlaskConical },
      { title: "AI Research", url: "/ai-research", icon: Sparkles },
      { title: "Optimizer", url: "/optimizer", icon: Sparkles },
      { title: "Pipeline", url: "/pipeline", icon: PlayCircle },
      { title: "Trade Intelligence", url: "/trade-intelligence", icon: Database },
    ],
  },
  {
    id: "engines",
    label: "Data & Engines",
    icon: Database,
    defaultOpen: false,
    items: [
      { title: "Market Data", url: "/market-data", icon: Database },
      { title: "Strategy Engine", url: "/strategy-engine", icon: Cpu },
      { title: "Execution Engine", url: "/execution-engine", icon: Zap },
    ],
  },
  {
    id: "resources",
    label: "Resources",
    icon: BookMarked,
    defaultOpen: false,
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
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(folders.map((folder) => [folder.id, folder.defaultOpen ?? false])),
  );

  const activeFolder = folders.find((folder) =>
    folder.items.some((item) => pathIsActive(pathname, item.url)),
  )?.id;

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border bg-sidebar">
      <SidebarHeader className="border-b border-sidebar-border px-2 py-3">
        <div className="flex items-center gap-2.5 px-1">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary text-primary-foreground shadow-sm">
            <Waves className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <div className="truncate font-display text-sm font-semibold tracking-tight text-sidebar-foreground">
              Shark Auto-Trader
            </div>
            <div className="mt-0.5 truncate text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Trading workspace
            </div>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-1 px-2 py-2">
        {folders.map((folder) => {
          const FolderIcon = folder.icon;
          const isOpen = collapsed ? false : (openFolders[folder.id] ?? false) || isActive;
          const isActive = activeFolder === folder.id;

          return (
            <div
              key={folder.id}
              className={`overflow-hidden rounded-xl border transition-colors ${
                isActive ? "border-primary/20 bg-sidebar-accent/35 shadow-sm" : "border-sidebar-border/70 bg-sidebar/40 hover:border-sidebar-border hover:bg-sidebar-accent/20"
              }`}
            >
              <button
                type="button"
                onClick={() =>
                  setOpenFolders((current) => ({ ...current, [folder.id]: !isOpen }))
                }
                className="group flex w-full items-center gap-2.5 px-2.5 py-2.5 text-left"
                aria-expanded={isOpen}
              >
                <FolderIcon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-xs font-semibold tracking-wide text-sidebar-foreground group-data-[collapsible=icon]:hidden">
                  {folder.label}
                  {isActive && (
                    <span className="mt-0.5 block truncate text-[9px] font-normal tracking-normal text-muted-foreground">
                      {folder.items.find((item) => pathIsActive(pathname, item.url))?.title ?? "Workspace"}
                    </span>
                  )}
                </span>
                <span className="mr-0.5 rounded-full bg-sidebar-accent px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground group-data-[collapsible=icon]:hidden">
                  {folder.items.length}
                </span>
                <ChevronDown
                  className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-data-[collapsible=icon]:hidden ${
                    isOpen ? "rotate-0" : "-rotate-90"
                  }`}
                  aria-hidden
                />
              </button>

              {isOpen && (
                <SidebarMenu className="border-t border-sidebar-border/60 px-1.5 py-1.5 group-data-[collapsible=icon]:px-0">
                  {folder.items.map((item) => (
                    <NavItem
                      key={item.url}
                      title={item.title}
                      active={pathIsActive(pathname, item.url)}
                    >
                      <Link to={item.url as never}>
                        <item.icon className="h-3.5 w-3.5" />
                        <span>{item.title}</span>
                      </Link>
                    </NavItem>
                  ))}
                </SidebarMenu>
              )}
            </div>
          );
        })}

        <div className="mt-1 rounded-xl border border-primary/15 bg-primary/5 px-2.5 py-2 group-data-[collapsible=icon]:hidden">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <Shield className="h-3.5 w-3.5 text-primary" />
            Safety
          </div>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
            Trading controls remain server-enforced.
          </p>
        </div>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">
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
        className="h-8 rounded-md pl-3 text-sidebar-foreground/72 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground data-[active=true]:shadow-sm"
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
      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-xs font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
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
