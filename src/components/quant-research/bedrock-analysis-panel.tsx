import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BrainCircuit, Loader2, Play, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  getQuantResearchJob,
  getQuantResearchJobResult,
  submitQuantAnalysis,
} from "@/lib/quant-engine.functions";

type Job = {
  job_id: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  result_run_id?: string | null;
  error?: string | null;
};

type Analysis = {
  pipeline_id: string;
  created_at: string;
  symbol: string;
  model_id: string;
  analysts: Record<string, {
    stance: string;
    confidence: number;
    thesis: string[];
    risks: string[];
    invalidation: string[];
    evidence: string[];
  }>;
  risk_synthesis: {
    risk_level: string;
    key_risks: string[];
    invalidation: string[];
    conflicts: string[];
  };
  trade_plan: {
    action: string;
    rationale: string[];
    entry_conditions: string[];
    exit_conditions: string[];
    no_trade_conditions: string[];
  };
};

const bullets = (items: string[]) => (
  items.length ? <ul className="list-disc pl-5 space-y-1">{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <span className="text-muted-foreground">None reported.</span>
);

export function BedrockAnalysisPanel({ quantContext = "" }: { quantContext?: string }) {
  const submit = useServerFn(submitQuantAnalysis);
  const statusFn = useServerFn(getQuantResearchJob);
  const resultFn = useServerFn(getQuantResearchJobResult);
  const [symbol, setSymbol] = useState("XAUUSDT");
  const [marketContext, setMarketContext] = useState("");
  const [sentimentContext, setSentimentContext] = useState("");
  const [technicalContext, setTechnicalContext] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => submit({
      data: {
        symbol,
        market_context: marketContext,
        sentiment_context: sentimentContext,
        technical_context: technicalContext,
        quant_context: quantContext,
      },
    }),
    onSuccess: (job) => setJobId((job as Job).job_id),
  });

  const job = useQuery({
    queryKey: ["quant-analysis-job", jobId],
    queryFn: () => statusFn({ data: { job_id: jobId! } }) as Promise<Job>,
    enabled: !!jobId,
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      return status === "SUCCEEDED" || status === "FAILED" ? false : 2000;
    },
  });

  const analysis = useQuery({
    queryKey: ["quant-analysis-result", jobId],
    queryFn: () => resultFn({ data: { job_id: jobId! } }) as Promise<Analysis>,
    enabled: !!jobId && job.data?.status === "SUCCEEDED",
    staleTime: Infinity,
  });

  const running = mutation.isPending || (jobId != null && !["SUCCEEDED", "FAILED"].includes(job.data?.status ?? ""));
  const status = job.data?.status ?? (mutation.isPending ? "SUBMITTING" : "IDLE");
  const analystEntries = useMemo(() => Object.entries(analysis.data?.analysts ?? {}), [analysis.data]);

  return (
    <Card className="border-primary/20">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm flex items-center gap-2"><BrainCircuit className="h-4 w-4" /> Bedrock Scenario Analysis</CardTitle>
            <CardDescription>Queued through the isolated quant worker. The model only receives the context supplied here and the optional computed quant report.</CardDescription>
          </div>
          <Badge variant={status === "SUCCEEDED" ? "default" : status === "FAILED" ? "destructive" : "secondary"}>{status}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 md:grid-cols-4">
          <div><label className="text-xs text-muted-foreground">Symbol</label><Input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} /></div>
          <div className="md:col-span-3"><label className="text-xs text-muted-foreground">Market / macro context</label><Textarea value={marketContext} onChange={(e) => setMarketContext(e.target.value)} placeholder="Observed market context, events, liquidity conditions…" className="min-h-20" /></div>
          <div className="md:col-span-2"><label className="text-xs text-muted-foreground">Sentiment / news context</label><Textarea value={sentimentContext} onChange={(e) => setSentimentContext(e.target.value)} placeholder="Only paste observed headlines/sentiment; the model must not invent evidence." className="min-h-20" /></div>
          <div className="md:col-span-2"><label className="text-xs text-muted-foreground">Technical context</label><Textarea value={technicalContext} onChange={(e) => setTechnicalContext(e.target.value)} placeholder="Trend, volatility, levels, regime and indicator observations…" className="min-h-20" /></div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => mutation.mutate()} disabled={running || !symbol.trim()}><Play className="h-4 w-4 mr-2" />{running ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Analyzing…</> : "Run Bedrock analysis"}</Button>
          {jobId && <span className="text-[10px] font-mono text-muted-foreground">job {jobId}</span>}
        </div>
        {(mutation.error || job.data?.error) && <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{mutation.error instanceof Error ? mutation.error.message : job.data?.error}</div>}

        {analysis.data && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-[10px] font-mono text-muted-foreground">
              <span>pipeline={analysis.data.pipeline_id}</span>
              <span>model={analysis.data.model_id}</span>
              <span>created={new Date(analysis.data.created_at).toLocaleString()}</span>
            </div>
            <div className="grid gap-3 lg:grid-cols-3">
              {analystEntries.map(([name, packet]) => (
                <Card key={name}><CardHeader className="pb-2"><CardTitle className="text-sm capitalize">{name.replace(/_/g, " ")}</CardTitle><Badge variant="outline">{packet.stance} · {(packet.confidence * 100).toFixed(0)}%</Badge></CardHeader><CardContent className="text-xs space-y-3"><div><div className="font-medium mb-1">Thesis</div>{bullets(packet.thesis)}</div><div><div className="font-medium mb-1">Risks</div>{bullets(packet.risks)}</div><div><div className="font-medium mb-1">Evidence</div>{bullets(packet.evidence)}</div></CardContent></Card>
              ))}
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><ShieldAlert className="h-4 w-4" /> Risk synthesis · {analysis.data.risk_synthesis.risk_level}</CardTitle></CardHeader><CardContent className="text-xs space-y-3"><div><div className="font-medium mb-1">Key risks</div>{bullets(analysis.data.risk_synthesis.key_risks)}</div><div><div className="font-medium mb-1">Conflicts</div>{bullets(analysis.data.risk_synthesis.conflicts)}</div><div><div className="font-medium mb-1">Invalidation</div>{bullets(analysis.data.risk_synthesis.invalidation)}</div></CardContent></Card>
              <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Scenario trade plan · {analysis.data.trade_plan.action}</CardTitle></CardHeader><CardContent className="text-xs space-y-3"><div><div className="font-medium mb-1">Rationale</div>{bullets(analysis.data.trade_plan.rationale)}</div><div><div className="font-medium mb-1">Entry conditions</div>{bullets(analysis.data.trade_plan.entry_conditions)}</div><div><div className="font-medium mb-1">Exit conditions</div>{bullets(analysis.data.trade_plan.exit_conditions)}</div><div><div className="font-medium mb-1">No-trade conditions</div>{bullets(analysis.data.trade_plan.no_trade_conditions)}</div></CardContent></Card>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
