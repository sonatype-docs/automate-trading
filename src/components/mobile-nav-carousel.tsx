import { useEffect, useRef } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, BookOpen, Beaker, ListOrdered, BarChart3, FileText,
  Settings as SettingsIcon, Bot, Target, Sunrise, Zap, GitCompare,
  BookMarked, Database, Cpu, Sparkles, FlaskConical, PlayCircle, Activity,
} from "lucide-react";

type Item = { title: string; url: string; icon: React.ComponentType<{ className?: string }> };

const items: Item[] = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Journal", url: "/journal", icon: BookOpen },
  { title: "Analytics", url: "/analytics", icon: BarChart3 },
  { title: "Reports", url: "/reports", icon: FileText },
  { title: "ORB Bot", url: "/bot", icon: Bot },
  { title: "Pending", url: "/pending-orders", icon: ListOrdered },
  { title: "Paper", url: "/paper-trading", icon: Activity },
  { title: "Live", url: "/live-trading", icon: Zap },
  { title: "Fib Zone", url: "/backtest", icon: Beaker },
  { title: "Silver Bullet", url: "/backtest/silver-bullet", icon: Zap },
  { title: "Asian Sweep", url: "/backtest/asian-sweep", icon: Sunrise },
  { title: "ORB BT", url: "/backtest/orb", icon: Target },
  { title: "PDH/PDL", url: "/backtest/pdh-pdl-sweep", icon: Target },
  { title: "Compare", url: "/backtest/compare", icon: GitCompare },
  { title: "Handbook", url: "/handbook", icon: BookMarked },
  { title: "Pipeline", url: "/pipeline", icon: PlayCircle },
  { title: "Market Data", url: "/market-data", icon: Database },
  { title: "Strategy", url: "/strategy-engine", icon: Cpu },
  { title: "Execution", url: "/execution-engine", icon: Zap },
  { title: "Trade Intel", url: "/trade-intelligence", icon: Database },
  { title: "Research", url: "/research", icon: BarChart3 },
  { title: "Optimizer", url: "/optimizer", icon: Sparkles },
  { title: "AI Research", url: "/ai-research", icon: Sparkles },
  { title: "Research Lab", url: "/research-lab", icon: FlaskConical },
  { title: "Docs", url: "/docs", icon: FileText },
  { title: "Settings", url: "/settings", icon: SettingsIcon },
];

export function MobileNavCarousel() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const scrollerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);

  const isActive = (u: string) => (u === "/" ? pathname === "/" : pathname.startsWith(u));

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [pathname]);

  return (
    <nav
      aria-label="Sections"
      className="md:hidden sticky top-11 z-30 border-b border-border/60 bg-background/95 backdrop-blur-2xl supports-[backdrop-filter]:bg-background/80"
    >
      <div
        ref={scrollerRef}
        className="flex gap-1.5 overflow-x-auto scroll-smooth px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((i) => {
          const active = isActive(i.url);
          return (
            <Link
              key={i.url}
              to={i.url}
              ref={active ? activeRef : undefined}
              className={[
                "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "border-primary/50 bg-primary/15 text-primary"
                  : "border-border/60 bg-card/50 text-muted-foreground hover:text-foreground hover:bg-muted/50",
              ].join(" ")}
            >
              <i.icon className="h-3.5 w-3.5" />
              <span className="whitespace-nowrap">{i.title}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
