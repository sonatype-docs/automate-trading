// Compact "All runners · live status" card for the Live Trading dashboard.
// The former in-page candlestick chart (LiveChartCard + getLiveChartData polls)
// was removed to cut background load — this file now only exports the status
// grid used on the live-trading page.
import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { Button } from "@/components/ui/button";
import {
  RefreshCw, Activity, TrendingUp, TrendingDown,
  Clock, Zap, AlertTriangle, Pause, Radar, Bitcoin, Coins,
  Circle, Target, Shield,
} from "lucide-react";
import {
  listLiveRunners, listLiveTrades, getRunnersStatusSummary,
  type LiveTradeDTO, type LiveRunnerDTO, type RunnerStatusDTO,
} from "@/lib/live-trading.functions";
import { isTodayAllowedForRunner, istTodayName } from "@/lib/session-windows";

export function AllRunnersStatusCard() {
  const runnersFn = useServerFn(listLiveRunners);
  const tradesFn = useServerFn(listLiveTrades);
  const statusFn = useServerFn(getRunnersStatusSummary);
  const runnersQ = useQuery({
    queryKey: ["live-runners"], queryFn: () => runnersFn(),
    refetchInterval: 15_000, staleTime: 10_000, placeholderData: keepPreviousData,
  });
  const anyRunning = (runnersQ.data ?? []).some((r) => r.running);
  const tradesQ = useQuery({
    queryKey: ["live-trades"], queryFn: () => tradesFn({ data: { limit: 500 } }),
    refetchInterval: anyRunning ? 10_000 : false, staleTime: 8_000, placeholderData: keepPreviousData,
  });
  const statusQ = useQuery({
    queryKey: ["live-runners-status"], queryFn: () => statusFn(),
    refetchInterval: anyRunning ? 60_000 : false, staleTime: 45_000, placeholderData: keepPreviousData,
  });
  const isFetching = runnersQ.isFetching || tradesQ.isFetching || statusQ.isFetching;
  const onRefresh = () => {
    runnersQ.refetch();
    tradesQ.refetch();
    statusQ.refetch();
  };
  return (
    <AllRunnersStatusPanel
      runners={runnersQ.data ?? []}
      trades={tradesQ.data ?? []}
      statuses={statusQ.data ?? []}
      onRefresh={onRefresh}
      isFetching={isFetching}
    />
  );
}

function AllRunnersStatusPanel({
  runners, trades, statuses, onRefresh, isFetching,
}: { runners: LiveRunnerDTO[]; trades: LiveTradeDTO[]; statuses: RunnerStatusDTO[]; onRefresh?: () => void; isFetching?: boolean }) {
  const [showAll, setShowAll] = useState(false);

  if (!runners.length) {
    return (
      <div className="rounded-md border p-3 text-sm text-muted-foreground">
        No runners configured yet.
      </div>
    );
  }

  const openByRunner = new Map<string, LiveTradeDTO>();
  for (const t of trades) {
    if ((t.status === "open" || t.status === "pending") && !openByRunner.has(t.runner_id)) {
      openByRunner.set(t.runner_id, t);
    }
  }
  const statusByRunner = new Map<string, RunnerStatusDTO>();
  for (const st of statuses) statusByRunner.set(st.runner_id, st);

  const runningCount = runners.filter((r) => r.running).length;
  const openCount = openByRunner.size;
  const errorCount = runners.filter((r) => !!r.last_tick_error).length
    + statuses.filter((s) => s.state === "error" && !runners.find((r) => r.id === s.runner_id)?.last_tick_error).length;
  const readyCount = statuses.filter((s) => s.state === "setup_ready").length;
  const stoppedCount = runners.length - runningCount;
  const closedCount = statuses.filter((s) => s.state === "session_closed").length;

  return (
    <div className="rounded-lg border border-gradient-sunset bg-gradient-sunset-soft p-3 sm:p-4 space-y-3 shadow-lg">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-sunset-vivid shadow-md glow-sunset">
            <Radar className="h-4 w-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight">All runners · live status</div>
            <div className="text-[10px] text-muted-foreground font-mono uppercase">{runners.some((r) => r.running) ? "Realtime · auto-refresh 60s" : "Paused · all runners stopped"}</div>
          </div>
          {onRefresh && (
            <Button variant="ghost" size="icon" className="h-7 w-7 ml-1" onClick={onRefresh} disabled={isFetching} title="Refresh now">
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin text-primary" : ""}`} />
            </Button>
          )}
          {closedCount > 0 && (
            <Button
              variant={showAll ? "default" : "outline"}
              size="sm"
              className="h-7 px-2 text-[10px] font-semibold uppercase tracking-wider ml-1"
              onClick={() => setShowAll((v) => !v)}
              title={showAll ? "Hide session-closed runners" : "Show session-closed runners"}
            >
              All {showAll ? `(${runners.length})` : `(+${closedCount})`}
            </Button>
          )}
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 text-[10px]">
          <StatPill icon={<Circle className="h-3 w-3" />} label="Total" value={runners.length} tone="neutral" />
          <StatPill icon={<Zap className="h-3 w-3" />} label="Running" value={runningCount} tone="success" />
          <StatPill icon={<Pause className="h-3 w-3" />} label="Stopped" value={stoppedCount} tone="muted" />
          <StatPill icon={<Target className="h-3 w-3" />} label="Ready" value={readyCount} tone={readyCount ? "success" : "muted"} />
          <StatPill icon={<Activity className="h-3 w-3" />} label="Open" value={openCount} tone={openCount ? "primary" : "muted"} />
          <StatPill icon={<AlertTriangle className="h-3 w-3" />} label="Errors" value={errorCount} tone={errorCount ? "destructive" : "muted"} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
        {runners
          .map((r) => {
            const open = openByRunner.get(r.id);
            const st = statusByRunner.get(r.id);

            let statusText: string;
            let tone: "success" | "warning" | "destructive" | "muted" | "primary" | "dim";
            let StatusIcon = Activity;
            let subDetail: string | null = null;
            let sortKey = 99;

            if (r.last_tick_error) {
              statusText = "Error"; tone = "destructive"; StatusIcon = AlertTriangle; sortKey = 4;
            } else if (open) {
              statusText = `Trade ${open.status} · ${open.direction.toUpperCase()}`;
              tone = "primary";
              StatusIcon = open.direction === "long" ? TrendingUp : TrendingDown;
              sortKey = 0;
            } else if (!r.running) {
              statusText = "Stopped"; tone = "muted"; StatusIcon = Pause; sortKey = 5;
            } else if (!isTodayAllowedForRunner(r.weekdays_ist ?? null)) {
              statusText = `Off today · ${istTodayName()}`; tone = "dim"; StatusIcon = Pause; sortKey = 6;
            } else if (st?.state === "setup_ready") {
              statusText = `Ready · ${(st.direction ?? "").toUpperCase()}`; tone = "success"; StatusIcon = Target;
              subDetail = st.detail; sortKey = 1;
            } else if (st?.state === "blocked") {
              const labels = (st.detail ?? "").split(" · ").map((s) => s.split(" (")[0]).filter(Boolean);
              statusText = labels.length ? `Blocked: ${labels.join(", ")}` : "Filters blocking";
              tone = "warning"; StatusIcon = Shield;
              subDetail = st.detail; sortKey = 2;
            } else if (st?.state === "session_closed") {
              statusText = "Session closed"; tone = "dim"; StatusIcon = Clock; sortKey = 6;
            } else if (st?.state === "error") {
              statusText = "Error"; tone = "destructive"; StatusIcon = AlertTriangle;
              subDetail = st.detail; sortKey = 4;
            } else if (!st) {
              statusText = "Scanning"; tone = "warning"; StatusIcon = Radar; sortKey = 3;
            } else {
              statusText = "Scanning"; tone = "warning"; StatusIcon = Radar; sortKey = 3;
            }

            return { r, open, statusText, tone, StatusIcon, subDetail, sortKey };
          })
          .filter(({ tone }) => showAll || tone !== "dim")
          .sort((a, b) => a.sortKey - b.sortKey || a.r.label.localeCompare(b.r.label))
          .map(({ r, open, statusText, tone, StatusIcon, subDetail }) => {
          const isDim = tone === "dim";
          const toneWrap =
            tone === "success" ? "border-l-[3px] border-l-success bg-success/10 ring-1 ring-success/20"
            : tone === "primary" ? "border-l-[3px] border-l-primary bg-primary/5 ring-1 ring-primary/20"
            : tone === "warning" ? "border-l-[3px] border-l-warning bg-warning/10 ring-1 ring-warning/20"
            : tone === "destructive" ? "border-l-[3px] border-l-destructive bg-destructive/10"
            : isDim ? "border-l-[3px] border-l-muted-foreground/20 bg-muted/40 opacity-55 grayscale"
            : "border-l-[3px] border-l-muted-foreground/30 bg-muted/20";

          const toneBadge =
            tone === "success" ? "bg-success/20 text-success border-success/40"
            : tone === "primary" ? "bg-primary/15 text-primary border-primary/30"
            : tone === "warning" ? "bg-warning/20 text-warning border-warning/40"
            : tone === "destructive" ? "bg-destructive/15 text-destructive border-destructive/30"
            : isDim ? "bg-muted/60 text-muted-foreground/70 border-border/50"
            : "bg-muted text-muted-foreground border-border";

          const isBtc = r.symbol.toUpperCase().startsWith("BTC");
          const SymbolIcon = isBtc ? Bitcoin : Coins;
          const symbolColor = isDim ? "text-muted-foreground/60" : isBtc ? "text-brand-ember" : "text-brand-copper";

          return (
            <div key={r.id} className={`rounded-md border p-2.5 flex flex-col gap-1.5 text-xs card-hover ${toneWrap} ${isDim ? "text-muted-foreground" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <SymbolIcon className={`h-4 w-4 shrink-0 ${symbolColor}`} />
                  <span className={`font-semibold truncate ${isDim ? "text-muted-foreground" : ""}`}>{r.label}</span>
                </div>
                <div className="shrink-0 flex items-center gap-1">
                  {(() => {
                    const on = isTodayAllowedForRunner(r.weekdays_ist ?? null);
                    return (
                      <span
                        title={r.weekdays_ist && r.weekdays_ist.length > 0
                          ? `Scheduled days (IST): ${r.weekdays_ist.slice().sort().join(", ")}`
                          : "Runs every day"}
                        className={`text-[9px] px-1.5 py-0.5 rounded-full border font-mono font-bold tracking-wider ${
                          on
                            ? "bg-success/20 text-success border-success/40"
                            : "bg-muted/60 text-muted-foreground/80 border-border/60"
                        }`}
                      >
                        {on ? `ON · ${istTodayName()}` : `OFF · ${istTodayName()}`}
                      </span>
                    );
                  })()}
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-mono font-bold tracking-wider ${
                    isDim ? "bg-muted/60 text-muted-foreground/70 border-border/50"
                    : r.leverage >= 100 ? "bg-gradient-sunset-vivid text-white border-transparent shadow"
                    : "bg-accent/40 text-accent-foreground border-accent"
                  }`}>
                    {r.leverage}×
                  </span>
                </div>
              </div>

              <div className={`inline-flex items-center gap-1 self-start text-[10px] px-1.5 py-0.5 rounded-md border font-medium ${toneBadge}`}>
                <StatusIcon className="h-3 w-3" />
                <span>{statusText}</span>
              </div>

              <div className={`flex items-center justify-between gap-2 font-mono text-[10.5px] ${isDim ? "text-muted-foreground/70" : "text-muted-foreground"}`}>
                <span className="truncate">{r.symbol} · {r.timeframe} · {r.strategy_preset}</span>
                <span className="shrink-0 flex items-center gap-1">
                  <Clock className="h-2.5 w-2.5" />
                  {r.last_tick_at ? new Date(r.last_tick_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                </span>
              </div>

              {open && (
                <div className="mt-0.5 grid grid-cols-3 gap-1 rounded-sm bg-background/50 p-1.5 font-mono text-[10px]">
                  <div><div className="text-muted-foreground">Entry</div><div className="font-semibold">{Number(open.entry_price).toFixed(2)}</div></div>
                  {open.stop_price != null && <div><div className="text-muted-foreground">SL</div><div className="text-destructive font-semibold">{Number(open.stop_price).toFixed(2)}</div></div>}
                  {open.target_price != null && <div><div className="text-muted-foreground">TP</div><div className="text-success font-semibold">{Number(open.target_price).toFixed(2)}</div></div>}
                </div>
              )}
              {!open && subDetail && (
                <div className="text-muted-foreground truncate text-[10.5px]" title={subDetail}>· {subDetail}</div>
              )}
              {r.last_tick_error && (
                <div className="text-destructive truncate text-[10.5px]" title={r.last_tick_error}>
                  ⚠ {r.last_tick_error}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatPill({ icon, label, value, tone }: {
  icon: React.ReactNode; label: string; value: number;
  tone: "success" | "destructive" | "primary" | "warning" | "muted" | "neutral";
}) {
  const cls =
    tone === "success" ? "bg-success/15 text-success border-success/30"
    : tone === "destructive" ? "bg-destructive/15 text-destructive border-destructive/30"
    : tone === "primary" ? "bg-primary/15 text-primary border-primary/30"
    : tone === "warning" ? "bg-warning/15 text-warning border-warning/30"
    : tone === "neutral" ? "bg-gradient-sunset-vivid text-white border-transparent"
    : "bg-muted/50 text-muted-foreground border-border";
  return (
    <div className={`flex items-center justify-between gap-1 rounded-md border px-1.5 py-1 ${cls}`}>
      <div className="flex items-center gap-1 min-w-0">
        {icon}
        <span className="uppercase font-mono tracking-wider truncate">{label}</span>
      </div>
      <span className="font-bold tabular-nums">{value}</span>
    </div>
  );
}
