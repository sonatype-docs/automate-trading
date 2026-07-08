import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { runStrategyOptimizer } from "@/lib/strategy.functions";

type OptResult = Awaited<ReturnType<typeof runStrategyOptimizer>>;

const ALL_WINDOWS = [30, 60, 90, 180, 365];

export function OptimizerPanel(props: {
  strategy: "silver_bullet" | "asian_sweep";
  title: string;
  defaults: { symbol: string; slRiskUsd: number; skipWeekdays: number[] };
}) {
  const run = useServerFn(runStrategyOptimizer);
  const [windows, setWindows] = useState<number[]>([...ALL_WINDOWS]);
  const [population, setPopulation] = useState(40);
  const [generations, setGenerations] = useState(25);
  const [data, setData] = useState<OptResult | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      run({
        data: {
          strategy: props.strategy,
          symbol: props.defaults.symbol,
          windows: [...windows].sort((a, b) => a - b),
          sl_risk_usd: props.defaults.slRiskUsd,
          skip_weekdays: props.defaults.skipWeekdays,
          population,
          generations,
          top_n: 20,
        },
      }),
    onSuccess: (r) => {
      setData(r);
      toast.success(
        r.top.length > 0
          ? `Optimizer found ${r.top.length} profitable presets · best net $${r.top[0].total_net_pnl.toFixed(0)}`
          : "Optimizer completed — no preset passed the OOS gates.",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleWindow = (d: number) =>
    setWindows((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d].sort((a, b) => a - b)));

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="text-sm font-mono tracking-widest">
          {props.title} · OPTIMIZER
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Genetic search across thousands of parameter combos. Every candidate is scored on
          70/30 in-sample / out-of-sample splits per selected window. Only presets that stay
          profitable OOS across all windows are surfaced.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <div className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground mb-1">
              Windows (days)
            </div>
            <div className="flex flex-wrap gap-1">
              {ALL_WINDOWS.map((d) => (
                <Badge
                  key={d}
                  variant={windows.includes(d) ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => toggleWindow(d)}
                >
                  {d}d
                </Badge>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground mb-1">
              Population
            </div>
            <input
              type="number"
              className="w-24 rounded-md border bg-background px-2 py-1 text-sm"
              value={population}
              min={20}
              max={120}
              onChange={(e) => setPopulation(Number(e.target.value) || 40)}
            />
          </div>
          <div>
            <div className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground mb-1">
              Generations
            </div>
            <input
              type="number"
              className="w-24 rounded-md border bg-background px-2 py-1 text-sm"
              value={generations}
              min={5}
              max={60}
              onChange={(e) => setGenerations(Number(e.target.value) || 25)}
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            size="sm"
            disabled={mut.isPending || windows.length === 0}
            onClick={() => mut.mutate()}
          >
            {mut.isPending
              ? `Running ~${population * generations} evals…`
              : "Run optimizer"}
          </Button>
          <p className="text-[10px] text-muted-foreground">
            Symbol <span className="font-mono">{props.defaults.symbol}</span> · risk $
            {props.defaults.slRiskUsd}/trade. Runs synchronously; larger population × generations
            = deeper search but slower.
          </p>
        </div>

        {data && (
          <div className="space-y-3">
            <div className="text-[11px] text-muted-foreground font-mono">
              evaluated {data.evaluated} genomes · cache hits {data.cache_hits} · bars fetched{" "}
              {data.bars_fetched} · {(data.elapsed_ms / 1000).toFixed(1)}s
            </div>
            {data.top.length === 0 ? (
              <div className="rounded border border-dashed p-4 text-xs text-muted-foreground">
                No parameter combo passed the out-of-sample gates for every selected window.
                Try fewer / shorter windows, more generations, or relax the symbol / risk.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="py-1 pr-2">#</th>
                      <th className="py-1 pr-2">Score</th>
                      <th className="py-1 pr-2">IS $</th>
                      <th className="py-1 pr-2">OOS $</th>
                      <th className="py-1 pr-2">Passed</th>
                      <th className="py-1 pr-2">Per-window (IS → OOS)</th>
                      <th className="py-1 pr-2">Genome</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.top.map((p) => (
                      <tr key={p.rank} className="border-b align-top">
                        <td className="py-1 pr-2 font-mono">{p.rank}</td>
                        <td className="py-1 pr-2 font-mono">{p.score.toFixed(0)}</td>
                        <td className="py-1 pr-2 font-mono text-emerald-500">
                          {p.total_net_pnl.toFixed(0)}
                        </td>
                        <td
                          className={`py-1 pr-2 font-mono ${p.total_oos_pnl >= 0 ? "text-emerald-500" : "text-red-500"}`}
                        >
                          {p.total_oos_pnl.toFixed(0)}
                        </td>
                        <td className="py-1 pr-2 font-mono">
                          {p.windows_passed}/{p.windows.length}
                        </td>
                        <td className="py-1 pr-2 font-mono text-[10px] whitespace-nowrap">
                          {p.windows.map((w) => (
                            <div
                              key={w.days}
                              className={w.oos_pass ? "text-emerald-500" : "text-muted-foreground"}
                            >
                              {w.days}d: {w.is_net_pnl.toFixed(0)}→{w.oos_net_pnl.toFixed(0)} (
                              {w.oos_trades}t)
                            </div>
                          ))}
                        </td>
                        <td className="py-1 pr-2 font-mono text-[10px]">
                          <div className="flex flex-wrap gap-x-2 max-w-md">
                            {Object.entries(p.genome).map(([k, v]) => (
                              <span key={k}>
                                <span className="text-muted-foreground">{k}=</span>
                                {String(v)}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
