import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  LayoutDashboard,
  BookOpen,
  Beaker,
  ListOrdered,
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
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const primary = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Journal", url: "/journal", icon: BookOpen },
  { title: "Analytics", url: "/analytics", icon: BarChart3 },
  { title: "Reports", url: "/reports", icon: FileText },
];

const trading = [
  { title: "ORB Bot", url: "/bot", icon: Bot },
  { title: "Pending Orders", url: "/pending-orders", icon: ListOrdered },
  { title: "Paper Trading", url: "/paper-trading", icon: Activity },
  { title: "Live Trading Bot", url: "/live-trading", icon: Zap },
];

const backtest = [
  { title: "Fib Zone Lab", url: "/backtest", icon: Beaker },
  { title: "Silver Bullet", url: "/backtest/silver-bullet", icon: Zap },
  { title: "Asian Sweep", url: "/backtest/asian-sweep", icon: Sunrise },
  { title: "Multi-Session ORB", url: "/backtest/orb", icon: Target },
  { title: "PDH/PDL Sweep", url: "/backtest/pdh-pdl-sweep", icon: Waves },
  { title: "Compare all", url: "/backtest/compare", icon: GitCompare },
];

const meta = [
  { title: "Pipeline", url: "/pipeline", icon: PlayCircle },
  { title: "Market Data Engine", url: "/market-data", icon: Database },
  { title: "Strategy Engine", url: "/strategy-engine", icon: Cpu },
  { title: "Execution Engine", url: "/execution-engine", icon: Zap },
  { title: "Trade Intelligence", url: "/trade-intelligence", icon: Database },
  { title: "Research", url: "/research", icon: BarChart3 },
  { title: "Optimizer", url: "/optimizer", icon: Sparkles },
  { title: "AI Research", url: "/ai-research", icon: Sparkles },
  { title: "Research Lab", url: "/research-lab", icon: FlaskConical },
  { title: "Docs", url: "/docs", icon: FileText },
  { title: "Settings", url: "/settings", icon: SettingsIcon },
];

export function AppSidebar() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (u: string) => (u === "/" ? pathname === "/" : pathname.startsWith(u));

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
        <NavigationGroup label="Overview" items={primary} isActive={isActive} />
        <NavigationGroup label="Trading" items={trading} isActive={isActive} />
        <NavigationGroup
          label="Backtest"
          items={backtest}
          isActive={(url) => (url === "/backtest" ? pathname === "/backtest" : isActive(url))}
        />
        <SidebarGroup className="border-t border-sidebar-border pt-3">
          <SidebarGroupLabel>Handbook</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavItem
                title="XAU/USD Handbook"
                active={pathname === "/handbook" || pathname.startsWith("/handbook")}
              >
                <Link to="/handbook">
                  <BookMarked className="h-4 w-4" />
                  <span>XAU/USD Handbook</span>
                </Link>
              </NavItem>
              <NavItem title="London ORB" active={pathname.startsWith("/handbook/v1/london-orb")}>
                <Link
                  to="/handbook/$volume/$strategy"
                  params={{ volume: "v1", strategy: "london-orb" }}
                >
                  <Target className="h-4 w-4" />
                  <span>London ORB</span>
                </Link>
              </NavItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <NavigationGroup label="System" items={meta} isActive={isActive} separated />
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-2">
        <CollapseToggle />
      </SidebarFooter>
    </Sidebar>
  );
}

type NavEntry = { title: string; url: string; icon: LucideIcon };

function NavigationGroup({
  label,
  items,
  isActive,
  separated = false,
}: {
  label: string;
  items: NavEntry[];
  isActive: (url: string) => boolean;
  separated?: boolean;
}) {
  return (
    <SidebarGroup className={separated ? "border-t border-sidebar-border pt-3" : ""}>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <NavItem key={item.url} title={item.title} active={isActive(item.url)}>
              <Link to={item.url as never}>
                <item.icon className="h-4 w-4" />
                <span>{item.title}</span>
              </Link>
            </NavItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
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
        className="h-8 rounded-md text-sidebar-foreground/72 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground data-[active=true]:shadow-sm"
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
      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-xs font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
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
