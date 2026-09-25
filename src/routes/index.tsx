import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, ArrowUpRight, BarChart3, FlaskConical, Workflow } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { PageFrame, PageHero } from "@/components/page-frame";

export const Route = createFileRoute("/")({
  component: DashboardPage,
  head: () => ({
    meta: [
      { title: "Dashboard — Shark Auto Trader" },
      { name: "description", content: "Shark Auto-Trader control center." },
    ],
  }),
});

const workspaces = [
  { href: "/paper-trading", label: "Paper Trading", eyebrow: "Safe execution", description: "Manage runners and simulate execution without touching live orders.", icon: Activity, tone: "text-emerald-500" },
  { href: "/analytics", label: "Analytics", eyebrow: "Performance", description: "Review realized PnL, open exposure, calendars, and strategy results.", icon: BarChart3, tone: "text-violet-500" },
  { href: "/backtest", label: "Backtesting", eyebrow: "Strategy lab", description: "Run historical strategy studies and compare research results.", icon: FlaskConical, tone: "text-amber-500" },
  { href: "/pipeline", label: "Pipeline", eyebrow: "Compute", description: "Launch datasets and monitor heavy research work on AWS compute.", icon: Workflow, tone: "text-cyan-500" },
] as const;

function DashboardPage() {
  return (
    <PageFrame>
      <PageHero eyebrow="Control center" title="Dashboard" description="Your trading workspace at a glance. Jump directly into execution, performance, research, or compute." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {workspaces.map(({ href, label, eyebrow, description, icon: Icon, tone }) => (
          <Link key={href} to={href} className="group">
            <Card className="h-full transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5">
              <CardContent className="flex h-full min-h-44 flex-col p-5">
                <div className="flex items-start justify-between">
                  <div className={`grid size-10 place-items-center rounded-2xl bg-muted/70 ${tone}`}><Icon className="size-5" /></div>
                  <ArrowUpRight className="size-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </div>
                <div className="mt-auto pt-8">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{eyebrow}</div>
                  <h2 className="mt-1 text-lg font-semibold tracking-tight">{label}</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card className="border-primary/10 bg-primary/[0.03]">
        <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold">Need the detailed performance view?</div>
            <p className="mt-1 text-sm text-muted-foreground">Analytics now owns the calendar and Strategy Performance content.</p>
          </div>
          <Link to="/analytics" className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">Open Analytics <ArrowUpRight className="size-4" /></Link>
        </CardContent>
      </Card>
    </PageFrame>
  );
}
