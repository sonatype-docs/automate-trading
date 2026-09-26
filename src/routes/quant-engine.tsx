import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Activity, Cpu, ShieldCheck } from "lucide-react";
import { getQuantEngineHealth, listQuantStrategies } from "@/lib/quant-engine.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/quant-engine")({
  component: QuantEnginePage,
  head: () => ({
    meta: [
      { title: "Quant Engine — QUANT-TRADER" },
      { name: "description", content: "Embedded executable quant research engine and strategy registry." },
    ],
  }),
});

function QuantEnginePage() {
  const health = useQuery({
    queryKey: ["quant-engine-health"],
    queryFn: () => getQuantEngineHealth(),
    refetchInterval: 30_000,
  });
  const strategies = useQuery({
    queryKey: ["quant-engine-strategies"],
    queryFn: () => listQuantStrategies(),
    enabled: health.isSuccess,
  });

  return (
    <main className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto">
      <div>
        <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">QUANT ENGINE</div>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">Executable Research Core</h1>
        <p className="text-sm text-muted-foreground mt-1">
          The production web cockpit now talks to the embedded Python quant engine instead of manufacturing research metrics in the UI.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" /> Engine</CardTitle></CardHeader>
          <CardContent>
            <Badge variant={health.isSuccess ? "default" : "destructive"}>{health.isSuccess ? "ONLINE" : health.isPending ? "CHECKING" : "OFFLINE"}</Badge>
            <p className="text-xs text-muted-foreground mt-2">
              {health.isSuccess ? "Sidecar API is reachable inside the ECS task." : health.error instanceof Error ? health.error.message : "Waiting for engine health."}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Cpu className="h-4 w-4" /> Strategy registry</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-mono">{Array.isArray(strategies.data) ? strategies.data.length : "—"}</div><p className="text-xs text-muted-foreground">Executable strategy contracts available to research.</p></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Execution boundary</CardTitle></CardHeader>
          <CardContent><p className="text-xs text-muted-foreground">Paper execution can pass risk limits; live execution remains explicitly gated behind a broker adapter.</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Strategies</CardTitle><CardDescription>Canonical registry from the embedded quant engine.</CardDescription></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {(strategies.data ?? []).map((s: { strategy_id: string; name: string; description: string }) => (
              <div key={s.strategy_id} className="rounded border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs">{s.strategy_id}</span>
                  <Badge variant="outline">{s.name}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-2">{s.description}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
