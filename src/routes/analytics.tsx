import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, TrendingUp, Clock, Tag } from "lucide-react";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics — Shark" },
      { name: "description", content: "Drawdown, rolling win rate, R-multiple, breakdowns." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AnalyticsPage,
});

const sections = [
  { title: "Equity & Drawdown", desc: "Cumulative PnL and peak-to-trough drawdown over time.", icon: TrendingUp },
  { title: "R-multiple Distribution", desc: "Histogram of R-multiples across all closed trades.", icon: BarChart3 },
  { title: "Time-of-day Performance", desc: "Win rate and PnL by session and hour.", icon: Clock },
  { title: "Breakdown by Tag / Setup", desc: "Compare win rate and profit factor per setup tag.", icon: Tag },
];

function AnalyticsPage() {
  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
        <p className="text-sm text-muted-foreground">Advanced performance breakdowns. More widgets rolling out.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {sections.map((s) => (
          <Card key={s.title} className="card-hover">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <s.icon className="h-4 w-4 text-primary" />
                {s.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{s.desc}</p>
              <div className="mt-4 grid h-40 place-items-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
                Chart coming soon
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
