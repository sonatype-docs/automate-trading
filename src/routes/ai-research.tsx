import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles, Loader2, Download, Send, RefreshCw } from "lucide-react";
import { askResearch, runResearch, reviewOneTrade } from "@/lib/ai-research.functions";
import type { Insight, Recommendation } from "@/lib/ai-research/types";
import type { ResearchReport } from "@/lib/ai-research/report";

export const Route = createFileRoute("/ai-research")({
  head: () => ({
    meta: [
      { title: "AI Quantitative Research Assistant" },
      { name: "description", content: "Continuously mines the trade database for statistically significant edges, failure modes, and recommendations." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AiResearchPage,
});

type ReportPayload = { report: ResearchReport | null; markdown: string; tradeCount: number };

function severityColor(s: Insight["severity"]): string {
  switch (s) {
    case "critical": return "bg-red-500/15 text-red-400 border-red-500/40";
    case "warning":  return "bg-amber-500/15 text-amber-400 border-amber-500/40";
    case "positive": return "bg-emerald-500/15 text-emerald-400 border-emerald-500/40";
    default:         return "bg-muted text-muted-foreground border-border";
  }
}

function InsightCard({ i }: { i: Insight }) {
  return (
    <div className="rounded-lg border border-border p-3 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-medium">{i.title}</div>
        <Badge variant="outline" className={`text-[10px] ${severityColor(i.severity)}`}>{i.severity}</Badge>
      </div>
      <div className="text-xs text-muted-foreground">{i.summary}</div>
      <div className="flex flex-wrap gap-1 text-[10px] font-mono text-muted-foreground">
        <span>n={i.evidence.sampleSize}</span>
        {i.evidence.pValue != null && <span>p={i.evidence.pValue.toFixed(3)}</span>}
        {i.evidence.confidence != null && <span>conf={(i.evidence.confidence * 100).toFixed(0)}%</span>}
        {i.evidence.metricValue != null && <span>{i.evidence.metric}={i.evidence.metricValue.toFixed(2)}</span>}
      </div>
    </div>
  );
}

function InsightList({ items }: { items: Insight[] }) {
  if (!items.length) return <div className="text-xs text-muted-foreground italic p-3">No significant findings.</div>;
  return <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">{items.map((i) => <InsightCard key={i.id} i={i} />)}</div>;
}

function RecommendationCard({ r }: { r: Recommendation }) {
  return (
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-medium">{r.title}</div>
        <Badge variant="outline" className="text-[10px] bg-emerald-500/15 text-emerald-400 border-emerald-500/40">recommend</Badge>
      </div>
      <div className="text-xs text-muted-foreground">{r.summary}</div>
      <div className="text-[11px]"><span className="text-muted-foreground">Action: </span><span className="font-mono">{r.action}</span></div>
      {r.expectedImpact && <div className="text-[11px] text-emerald-400">{r.expectedImpact}</div>}
      <div className="text-[10px] font-mono text-muted-foreground">
        n={r.evidence.sampleSize} · p={r.evidence.pValue?.toFixed(3) ?? "—"} · conf={((r.evidence.confidence ?? 0) * 100).toFixed(0)}%
      </div>
    </div>
  );
}

function AiResearchPage() {
  const [strategyId, setStrategyId] = useState("");
  const [symbol, setSymbol] = useState("");
  const [report, setReport] = useState<ReportPayload | null>(null);

  const runFn = useServerFn(runResearch);
  const askFn = useServerFn(askResearch);
  const reviewFn = useServerFn(reviewOneTrade);

  const run = useMutation({
    mutationFn: () => runFn({ data: { strategyId: strategyId || undefined, symbol: symbol || undefined } }),
    onSuccess: (d) => setReport(d as ReportPayload),
  });

  const [question, setQuestion] = useState("");
  const [chat, setChat] = useState<Array<{ role: "user" | "assistant"; text: string }>>([]);
  const ask = useMutation({
    mutationFn: (q: string) => askFn({ data: { question: q, strategyId: strategyId || undefined, symbol: symbol || undefined } }),
    onSuccess: (d) => setChat((c) => [...c, { role: "assistant", text: (d as { answer: string }).answer }]),
    onError: (e) => setChat((c) => [...c, { role: "assistant", text: `Error: ${(e as Error).message}` }]),
  });

  const [tradeId, setTradeId] = useState("");
  const review = useMutation({ mutationFn: (id: string) => reviewFn({ data: { tradeId: id } }) });

  const submitQuestion = () => {
    const q = question.trim();
    if (!q) return;
    setChat((c) => [...c, { role: "user", text: q }]);
    setQuestion("");
    ask.mutate(q);
  };

  const downloadMarkdown = () => {
    if (!report?.markdown) return;
    const blob = new Blob([report.markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `research-${Date.now()}.md`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const s = report?.report?.sections;

  return (
    <div className="p-4 space-y-4 max-w-[1600px] mx-auto">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> AI Quantitative Research Assistant
          </h1>
          <p className="text-xs text-muted-foreground">Every claim is grounded in real statistics from your trade intelligence database.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input placeholder="Strategy ID (optional)" value={strategyId} onChange={(e) => setStrategyId(e.target.value)} className="h-8 w-48 text-xs" />
          <Input placeholder="Symbol (optional)" value={symbol} onChange={(e) => setSymbol(e.target.value)} className="h-8 w-32 text-xs" />
          <Button size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
            {run.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
            Run research
          </Button>
          {report?.markdown && (
            <Button size="sm" variant="outline" onClick={downloadMarkdown}>
              <Download className="h-3.5 w-3.5 mr-1" /> Report
            </Button>
          )}
        </div>
      </header>

      {run.error && <div className="rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-400">{(run.error as Error).message}</div>}

      {!report && !run.isPending && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Click <span className="font-semibold">Run research</span> to analyse every recorded trade.
        </div>
      )}

      {report && report.tradeCount === 0 && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No trades match the filter. Record trades in Trade Intelligence first.
        </div>
      )}

      {report && s && (
        <Tabs defaultValue="executive" className="w-full">
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="executive" className="text-xs">Executive</TabsTrigger>
            <TabsTrigger value="performance" className="text-xs">Performance</TabsTrigger>
            <TabsTrigger value="failure" className="text-xs">Failure</TabsTrigger>
            <TabsTrigger value="edges" className="text-xs">Edges</TabsTrigger>
            <TabsTrigger value="filters" className="text-xs">Filters</TabsTrigger>
            <TabsTrigger value="features" className="text-xs">Features</TabsTrigger>
            <TabsTrigger value="regime" className="text-xs">Regime</TabsTrigger>
            <TabsTrigger value="clusters" className="text-xs">Clusters</TabsTrigger>
            <TabsTrigger value="patterns" className="text-xs">Patterns</TabsTrigger>
            <TabsTrigger value="correlations" className="text-xs">Correlations</TabsTrigger>
            <TabsTrigger value="wf" className="text-xs">Walk-forward</TabsTrigger>
            <TabsTrigger value="mc" className="text-xs">Monte Carlo</TabsTrigger>
            <TabsTrigger value="anom" className="text-xs">Anomalies</TabsTrigger>
            <TabsTrigger value="cmp" className="text-xs">Compare</TabsTrigger>
            <TabsTrigger value="ask" className="text-xs">Ask AI</TabsTrigger>
            <TabsTrigger value="trade" className="text-xs">Trade review</TabsTrigger>
          </TabsList>

          <TabsContent value="executive" className="mt-3 space-y-2">
            <div className="text-xs text-muted-foreground">Top-ranked insights across all engines · {report.tradeCount} trades analysed.</div>
            <InsightList items={s.executive} />
          </TabsContent>
          <TabsContent value="performance" className="mt-3"><InsightList items={s.performance} /></TabsContent>
          <TabsContent value="failure" className="mt-3"><InsightList items={s.failure} /></TabsContent>
          <TabsContent value="edges" className="mt-3"><InsightList items={s.edges} /></TabsContent>
          <TabsContent value="filters" className="mt-3">
            {s.filters.length === 0
              ? <div className="text-xs text-muted-foreground italic p-3">No filter recommendations meet the confidence threshold.</div>
              : <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">{s.filters.map((r) => <RecommendationCard key={r.id} r={r} />)}</div>}
          </TabsContent>
          <TabsContent value="features" className="mt-3"><InsightList items={s.features} /></TabsContent>
          <TabsContent value="regime" className="mt-3"><InsightList items={s.regime} /></TabsContent>
          <TabsContent value="clusters" className="mt-3"><InsightList items={s.clusters} /></TabsContent>
          <TabsContent value="patterns" className="mt-3"><InsightList items={s.patterns} /></TabsContent>
          <TabsContent value="correlations" className="mt-3"><InsightList items={s.correlations} /></TabsContent>
          <TabsContent value="wf" className="mt-3"><InsightList items={s.walkForward} /></TabsContent>
          <TabsContent value="mc" className="mt-3"><InsightList items={s.monteCarlo} /></TabsContent>
          <TabsContent value="anom" className="mt-3"><InsightList items={s.anomalies} /></TabsContent>
          <TabsContent value="cmp" className="mt-3"><InsightList items={s.comparison} /></TabsContent>

          <TabsContent value="ask" className="mt-3">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Natural language research query</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="max-h-96 overflow-auto space-y-2 rounded-md border border-border p-3 bg-muted/20">
                  {chat.length === 0 && <div className="text-xs text-muted-foreground italic">Ask questions like "Why did we lose money in March?", "Which weekday is best?", "Should I remove Fridays?"</div>}
                  {chat.map((m, i) => (
                    <div key={i} className={`text-sm ${m.role === "user" ? "text-primary" : ""}`}>
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5">{m.role}</div>
                      <div className="prose prose-invert prose-sm max-w-none">
                        <ReactMarkdown>{m.text}</ReactMarkdown>
                      </div>
                    </div>
                  ))}
                  {ask.isPending && <div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Thinking…</div>}
                </div>
                <div className="flex gap-2">
                  <Textarea
                    placeholder="Ask a research question…"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitQuestion(); } }}
                    className="text-sm min-h-[60px]"
                  />
                  <Button size="sm" onClick={submitQuestion} disabled={ask.isPending || !question.trim()}>
                    <Send className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="trade" className="mt-3">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Per-trade review</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Input placeholder="Trade ID" value={tradeId} onChange={(e) => setTradeId(e.target.value)} className="h-8 text-xs font-mono" />
                  <Button size="sm" onClick={() => review.mutate(tradeId)} disabled={!tradeId.trim() || review.isPending}>
                    {review.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Review"}
                  </Button>
                </div>
                {review.error && <div className="text-xs text-red-400">{(review.error as Error).message}</div>}
                {review.data && (
                  <div className="rounded border border-border p-3 space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="text-xs text-muted-foreground">Score</div>
                      <div className="font-mono text-lg">{review.data.score.toFixed(0)}/100</div>
                      <Badge variant="outline" className="text-[10px]">{review.data.outcome}</Badge>
                    </div>
                    {(review.data.whyWon?.length ?? 0) > 0 && <div><div className="text-xs text-emerald-400 uppercase tracking-widest">Why it won</div><ul className="text-xs list-disc pl-4">{review.data.whyWon!.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
                    {(review.data.whyLost?.length ?? 0) > 0 && <div><div className="text-xs text-rose-400 uppercase tracking-widest">Why it lost</div><ul className="text-xs list-disc pl-4">{review.data.whyLost!.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
                    {review.data.filtersPassed.length > 0 && <div className="text-xs"><span className="text-muted-foreground">Filters passed: </span><span className="font-mono">{review.data.filtersPassed.join(", ")}</span></div>}
                    {review.data.filtersFailed.length > 0 && <div className="text-xs"><span className="text-muted-foreground">Filters failed: </span><span className="font-mono">{review.data.filtersFailed.join(", ")}</span></div>}
                    {review.data.suggestions.length > 0 && <div><div className="text-xs uppercase tracking-widest text-muted-foreground">Suggestions</div><ul className="text-xs list-disc pl-4">{review.data.suggestions.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
