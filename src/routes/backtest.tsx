import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { getStrategyState, backtestRange, sweepHoursBacktest, runEntryZoneSweep } from "@/lib/strategy.functions";
import { DEFAULT_FILTERS, type FilterConfig } from "@/lib/strategy/filters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ArrowLeft, Beaker } from "lucide-react";
import {
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";

export const Route = createFileRoute("/backtest")({
  component: BacktestLab,
  head: () => ({
    meta: [
      { title: "Backtest Lab — Shark Auto-Trader" },
      {
        name: "description",
        content:
          "Replay the fib zone strategy across custom date ranges with configurable RR, trailing SL, risk, and session filters.",
      },
    ],
  }),
});

type RangeData = Awaited<ReturnType<typeof backtestRange>>;

const WD_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

interface FormState {
  days: number;
  symbol: string;
  sessionStartIst: string;
  slRiskUsd: number;
  rr: number;
  trailEnabled: boolean;
  trailActivateR: number;
  trailStepR: number;
  skipWeekdays: number[]; // 0=Sun..6=Sat
  entryMode: "fib" | "retest" | "market" | "adaptive";
  entryDepthPct: number;
  slDepthPct: number;
  retestSlR: number;
}

function BacktestLab() {
  const getState = useServerFn(getStrategyState);
  const runRange = useServerFn(backtestRange);
  const settingsQ = useQuery({ queryKey: ["strategy-state"], queryFn: () => getState() });

  const [form, setForm] = useState<FormState | null>(null);
  const [result, setResult] = useState<RangeData | null>(null);
  const [filters, setFilters] = useState<NonNullable<FilterConfig>>(DEFAULT_FILTERS);

  // Seed the form once settings load.
  const s = settingsQ.data?.settings as
    | {
        symbol: string;
        session_start_ist: string;
        sl_risk_usd: number;
        rr: number;
        trail_enabled?: boolean;
        trail_activate_r?: number;
        trail_step_r?: number;
        skip_weekends?: boolean;
        entry_mode?: string;
        entry_depth_pct?: number;
        sl_depth_pct?: number;
        retest_sl_r?: number;
      }
    | null
    | undefined;

  if (s && !form) {
    setForm({
      days: 90,
      symbol: s.symbol,
      sessionStartIst: String(s.session_start_ist).slice(0, 5),
      slRiskUsd: Number(s.sl_risk_usd),
      rr: Number(s.rr),
      trailEnabled: !!s.trail_enabled,
      trailActivateR: Number(s.trail_activate_r ?? 2),
      trailStepR: Number(s.trail_step_r ?? 1),
      skipWeekdays: s.skip_weekends ? [0, 6] : [0, 6],
      entryMode: ((s.entry_mode ?? "fib") as FormState["entryMode"]),
      entryDepthPct: Number(s.entry_depth_pct ?? 0.15),
      slDepthPct: Number(s.sl_depth_pct ?? 0.60),
      retestSlR: Number(s.retest_sl_r ?? 0.5),
    });
  }

  const runMut = useMutation({
    mutationFn: (f: FormState) =>
      runRange({
        data: {
          days: f.days,
          symbol: f.symbol,
          session_start_ist: f.sessionStartIst,
          sl_risk_usd: f.slRiskUsd,
          rr: f.rr,
          trail_enabled: f.trailEnabled,
          trail_activate_r: f.trailActivateR,
          trail_step_r: f.trailStepR,
          skip_weekdays: f.skipWeekdays,
          filters,
          entry: {
            mode: f.entryMode,
            entry_depth_pct: f.entryDepthPct,
            sl_depth_pct: f.slDepthPct,
            retest_sl_r: f.retestSlR,
          },
        },
      }),
    onSuccess: (r) => {
      setResult(r);
      toast.success(`Backtest done — ${r.summary.tp}W / ${r.summary.sl}L · fill ${r.summary.fill_rate_pct.toFixed(0)}%`);
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    if (!form) return;
    setForm({ ...form, [k]: v });
  };

  const toggleWd = (wd: number) => {
    if (!form) return;
    const has = form.skipWeekdays.includes(wd);
    setForm({
      ...form,
      skipWeekdays: has ? form.skipWeekdays.filter((x) => x !== wd) : [...form.skipWeekdays, wd].sort(),
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Beaker className="w-5 h-5 text-primary" />
            <span className="font-mono text-sm tracking-widest">BACKTEST LAB</span>
          </div>
          <Link to="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" /> Back to dashboard
            </Button>
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-6">
        {!form ? (
          <p className="font-mono text-xs text-muted-foreground">Loading strategy defaults…</p>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-mono tracking-widest">PARAMETERS</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Live strategy settings are not modified — every run is isolated.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Field label="Symbol">
                    <select
                      value={form.symbol}
                      onChange={(e) => set("symbol", e.target.value)}
                      className="h-8 w-full rounded border border-input bg-background px-2 font-mono text-xs"
                    >
                      <option value="XAUUSDT">XAUUSDT · Gold</option>
                      <option value="BTCUSDT">BTCUSDT · Bitcoin</option>
                    </select>
                  </Field>

                  <Field label="Session start (IST)">
                    <Input
                      type="time"
                      value={form.sessionStartIst}
                      onChange={(e) => set("sessionStartIst", e.target.value)}
                      className="h-8 font-mono text-xs"
                    />
                  </Field>
                  <Field label="Days back">
                    <div className="flex gap-1">
                      <Input
                        type="number"
                        min={1}
                        max={365}
                        value={form.days}
                        onChange={(e) => set("days", Math.min(365, Math.max(1, Number(e.target.value) || 1)))}
                        className="h-8 font-mono text-xs"
                      />
                      <select
                        className="h-8 rounded-md border border-input bg-transparent px-2 text-xs font-mono"
                        value={form.days}
                        onChange={(e) => set("days", Number(e.target.value))}
                      >
                        {[7, 30, 60, 90, 180, 270, 365].map((d) => (
                          <option key={d} value={d}>
                            {d}d
                          </option>
                        ))}
                      </select>
                    </div>
                  </Field>
                  <Field label="SL risk ($ per trade)">
                    <Input
                      type="number"
                      step="1"
                      min="1"
                      value={form.slRiskUsd}
                      onChange={(e) => set("slRiskUsd", Math.max(1, Number(e.target.value) || 1))}
                      className="h-8 font-mono text-xs"
                    />
                  </Field>
                  <Field label="Initial R:R (1 : X)">
                    <Input
                      type="number"
                      step="0.1"
                      min="0.5"
                      value={form.rr}
                      onChange={(e) => set("rr", Math.max(0.5, Number(e.target.value) || 0.5))}
                      className="h-8 font-mono text-xs"
                    />
                  </Field>
                  <Field label="Trailing SL">
                    <label className="flex items-center gap-2 h-8">
                      <Switch
                        checked={form.trailEnabled}
                        onCheckedChange={(v) => set("trailEnabled", v)}
                      />
                      <span className="text-xs text-muted-foreground">
                        {form.trailEnabled ? "enabled" : "off"}
                      </span>
                    </label>
                  </Field>
                  <Field label="Trail activate (R)">
                    <Input
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={form.trailActivateR}
                      onChange={(e) => set("trailActivateR", Math.max(0.1, Number(e.target.value) || 0.1))}
                      className="h-8 font-mono text-xs"
                      disabled={!form.trailEnabled}
                    />
                  </Field>
                  <Field label="Trail step (R)">
                    <Input
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={form.trailStepR}
                      onChange={(e) => set("trailStepR", Math.max(0.1, Number(e.target.value) || 0.1))}
                      className="h-8 font-mono text-xs"
                      disabled={!form.trailEnabled}
                    />
                  </Field>
                </div>

                <div className="border-t border-border pt-3 space-y-3">
                  <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Entry mechanics
                  </Label>
                  <div className="flex flex-wrap gap-1">
                    {(["fib", "retest", "market", "adaptive"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => set("entryMode", m)}
                        className={`px-3 h-7 rounded font-mono text-[11px] border uppercase tracking-wider ${
                          form.entryMode === m
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                  {(form.entryMode === "fib" || form.entryMode === "market") && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {form.entryMode === "fib" && (
                        <Field label={`Entry depth (${(form.entryDepthPct * 100).toFixed(0)}%)`}>
                          <input
                            type="range"
                            min={0}
                            max={0.5}
                            step={0.05}
                            value={form.entryDepthPct}
                            onChange={(e) => set("entryDepthPct", Number(e.target.value))}
                            className="w-full"
                          />
                        </Field>
                      )}
                      <Field label={`SL depth (${(form.slDepthPct * 100).toFixed(0)}%)`}>
                        <input
                          type="range"
                          min={Math.max(0.15, form.entryDepthPct + 0.05)}
                          max={1}
                          step={0.05}
                          value={form.slDepthPct}
                          onChange={(e) => set("slDepthPct", Number(e.target.value))}
                          className="w-full"
                        />
                      </Field>
                    </div>
                  )}
                  {form.entryMode === "retest" && (
                    <Field label={`Retest SL distance (R × range) — ${form.retestSlR.toFixed(2)}`}>
                      <input
                        type="range"
                        min={0.1}
                        max={2}
                        step={0.1}
                        value={form.retestSlR}
                        onChange={(e) => set("retestSlR", Number(e.target.value))}
                        className="w-full"
                      />
                    </Field>
                  )}
                </div>

                <div>

                  <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Skip weekdays
                  </Label>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {WD_LABELS.map((wd, i) => {
                      const active = form.skipWeekdays.includes(i);
                      return (
                        <button
                          key={wd}
                          onClick={() => toggleWd(i)}
                          type="button"
                          className={`px-2 h-7 rounded font-mono text-[11px] border ${
                            active
                              ? "bg-destructive-soft border-destructive text-destructive"
                              : "bg-background border-border text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {wd}
                        </button>
                      );
                    })}
                    <span className="text-[10px] text-muted-foreground self-center ml-2">
                      Days highlighted are excluded from the simulation.
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    disabled={runMut.isPending}
                    onClick={() => runMut.mutate(form)}
                  >
                    {runMut.isPending ? "Replaying…" : `Run backtest — ${form.days}d`}
                  </Button>
                  <p className="text-[10px] text-muted-foreground">
                    Fetches 1H candles from SharkExchange and replays every session with the rules above.
                  </p>
                </div>
              </CardContent>
            </Card>

            <FiltersCard value={filters} onChange={setFilters} />

            {result && <ResultsView data={result} />}

            <HourSweepPanel
              defaults={{
                symbol: form.symbol,
                slRiskUsd: form.slRiskUsd,
                rr: form.rr,
                trailEnabled: form.trailEnabled,
                trailActivateR: form.trailActivateR,
                trailStepR: form.trailStepR,
                skipWeekdays: form.skipWeekdays,
              }}
              filters={filters}
            />

            <EntryZoneGridPanel
              defaults={{
                symbol: form.symbol,
                sessionStartIst: form.sessionStartIst,
                slRiskUsd: form.slRiskUsd,
                rr: form.rr,
                trailEnabled: form.trailEnabled,
                trailActivateR: form.trailActivateR,
                trailStepR: form.trailStepR,
                skipWeekdays: form.skipWeekdays,
              }}
              filters={filters}
            />
          </>
        )}

      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

type CohortDimKey = "body" | "or_size" | "break_distance" | "weekday" | "tp_target";
type CohortFilter = { dim: CohortDimKey; bucket: string } | null;

const COHORT_DIM_LABELS: Record<CohortDimKey, string> = {
  body: "Body strength",
  or_size: "Opening range",
  break_distance: "Break distance",
  weekday: "Weekday",
  tp_target: "TP target",
};

function dayMatchesCohort(d: RangeData["days"][number], f: NonNullable<CohortFilter>): boolean {
  switch (f.dim) {
    case "body":
      return d.body_bucket === f.bucket;
    case "or_size":
      return d.or_bucket === f.bucket;
    case "break_distance":
      return d.break_distance_bucket === f.bucket;
    case "weekday":
      return WD_LABELS[d.weekday] === f.bucket;
    case "tp_target":
      return d.tp_target === f.bucket;
  }
}

function ResultsView({ data }: { data: RangeData }) {
  const s = data.summary;
  const [cohort, setCohort] = useState<CohortFilter>(null);
  const fmt = (n: number | null) => (n == null ? "—" : n.toFixed(2));
  const fmtUsd = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
  const fmtTime = (ms: number | null) =>
    ms == null ? "—" : new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const outcomeCls = (o: string) =>
    o === "tp"
      ? "text-long"
      : o === "sl"
        ? "text-short"
        : o === "open"
          ? "text-warning"
          : "text-muted-foreground";
  const totalTone = s.total_pnl_usd >= 0 ? "text-long" : "text-short";
  const pf = s.profit_factor;
  const pfText = !isFinite(pf) ? "∞" : pf.toFixed(2);

  const filteredDays = useMemo(
    () => (cohort ? data.days.filter((d) => dayMatchesCohort(d, cohort)) : data.days),
    [data.days, cohort],
  );

  const equityChart = useMemo(() => {
    if (!cohort) return data.equity.map((e) => ({ date: e.ist_date, pnl: Number(e.cum_pnl_usd.toFixed(2)) }));
    let cum = 0;
    return filteredDays.map((d) => {
      cum += d.pnl_usd;
      return { date: d.ist_date, pnl: Number(cum.toFixed(2)) };
    });
  }, [data.equity, filteredDays, cohort]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-mono tracking-widest">RESULTS</CardTitle>
        <p className="text-xs text-muted-foreground">
          {data.symbol} · IST {data.session_start_ist} · SL ${data.sl_risk_usd} · RR 1:{data.rr}
          {" · "}
          {new Date(data.from_ms).toISOString().slice(0, 10)} → {new Date(data.to_ms).toISOString().slice(0, 10)}
          {data.trail.enabled
            ? ` · trail on (act ${data.trail.activate_r}R / step ${data.trail.step_r}R)`
            : " · trail off"}
        </p>
      </CardHeader>
      <CardContent className="space-y-4 font-mono text-xs">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Kv k="net p&l (after fees)" v={fmtUsd(s.net_pnl_usd)} tone={s.net_pnl_usd >= 0 ? "text-long" : "text-short"} />
          <Kv k="gross p&l" v={fmtUsd(s.total_pnl_usd)} tone={totalTone} />
          <Kv k="est. fees" v={`-$${s.est_fees_usd.toFixed(2)}`} tone="text-short" />
          <Kv k="fill rate" v={`${s.fill_rate_pct.toFixed(0)}%`} tone={s.fill_rate_pct >= 60 ? "text-long" : s.fill_rate_pct >= 30 ? "text-warning" : "text-short"} />
          <Kv k="win rate" v={`${s.win_rate_pct.toFixed(1)}%`} tone={s.win_rate_pct >= 50 ? "text-long" : "text-short"} />
          <Kv k="profit factor" v={pfText} tone={pf >= 1 ? "text-long" : "text-short"} />
          <Kv k="expectancy / trade" v={fmtUsd(s.expectancy_usd)} tone={s.expectancy_usd >= 0 ? "text-long" : "text-short"} />
          <Kv k="avg R" v={s.avg_r.toFixed(2)} tone={s.avg_r >= 0 ? "text-long" : "text-short"} />
          <Kv k="avg win / loss" v={`${fmtUsd(s.avg_win_usd)} / ${fmtUsd(-s.avg_loss_usd)}`} />
          <Kv k="max drawdown" v={`-${s.max_drawdown_usd.toFixed(2)}`} tone="text-short" />
          <Kv k="max streak W / L" v={`${s.max_consec_wins} / ${s.max_consec_losses}`} />
          <Kv k="sessions" v={`${s.days_with_session} / ${s.total_days}`} />
          <Kv k="breaks / triggered" v={`${s.breaks} / ${s.triggered}`} />
          <Kv k="missed / near-miss" v={`${s.armed_no_trigger} / ${s.near_miss_count}`} tone={s.near_miss_count > 0 ? "text-warning" : undefined} />
          <Kv k="wins / losses" v={`${s.tp} / ${s.sl}`} />
          <Kv k="open / skipped / filtered" v={`${s.open} / ${s.skipped_days} / ${s.filtered_days ?? 0}`} />
          <Kv k="best / worst day $" v={`+${s.best_pnl_usd.toFixed(0)} / ${s.worst_pnl_usd.toFixed(0)}`} />

          <Kv k="best / worst day $" v={`+${s.best_pnl_usd.toFixed(0)} / ${s.worst_pnl_usd.toFixed(0)}`} />
          <Kv
            k="best weekday"
            v={s.best_weekday ? `${s.best_weekday.label} ${fmtUsd(s.best_weekday.total_pnl_usd)}` : "—"}
            tone="text-long"
          />
          <Kv
            k="worst weekday"
            v={s.worst_weekday ? `${s.worst_weekday.label} ${fmtUsd(s.worst_weekday.total_pnl_usd)}` : "—"}
            tone="text-short"
          />
          <Kv k="bars scanned" v={String(data.bars_scanned)} />
        </div>

        {equityChart.length > 1 && (
          <div className="border border-border rounded p-2 bg-muted/30">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
              Equity curve (cumulative $ P&amp;L)
            </div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={equityChart}>
                  <XAxis dataKey="date" hide />
                  <YAxis width={40} tickFormatter={(v: number) => `${v}`} tick={{ fontSize: 10 }} />
                  <ReTooltip
                    formatter={(v: number) => [fmtUsd(Number(v)), "P&L"]}
                    labelFormatter={(l) => `Date: ${l}`}
                  />
                  <ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.2} />
                  <Line
                    type="monotone"
                    dataKey="pnl"
                    stroke={s.total_pnl_usd >= 0 ? "hsl(var(--primary))" : "hsl(var(--destructive))"}
                    dot={false}
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {cohort && (
          <div className="flex items-center gap-2 text-[11px] font-mono">
            <span className="text-muted-foreground uppercase tracking-widest">Filter:</span>
            <span className="px-2 py-0.5 rounded border border-primary/60 bg-primary/10 text-primary">
              {COHORT_DIM_LABELS[cohort.dim]}: {cohort.bucket}
            </span>
            <span className="text-muted-foreground">
              ({filteredDays.filter((d) => d.outcome === "tp" || d.outcome === "sl").length} trades)
            </span>
            <button
              type="button"
              onClick={() => setCohort(null)}
              className="text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              clear
            </button>
          </div>
        )}

        <CohortBreakdowns cohorts={s.cohorts} active={cohort} onSelect={setCohort} />

        <CalendarView data={data} />




        <div className="max-h-96 overflow-y-auto border border-border rounded">
          <table className="w-full text-[11px]">
            <thead className="text-[10px] uppercase tracking-widest text-muted-foreground bg-muted/60 sticky top-0">
              <tr>
                <th className="text-left px-2 py-1">Date</th>
                <th className="text-left px-2 py-1">Day</th>
                <th className="text-right px-2 py-1">H/L</th>
                <th className="text-right px-2 py-1">Break</th>
                <th className="text-right px-2 py-1">Entry / SL / TP</th>
                <th className="text-right px-2 py-1">Trig</th>
                <th className="text-right px-2 py-1">Peak R</th>
                <th className="text-left px-2 py-1">Outcome</th>
                <th className="text-right px-2 py-1">P&amp;L $</th>
              </tr>
            </thead>
            <tbody>
              {filteredDays
                .slice()
                .reverse()
                .map((d) => (
                  <tr key={d.ist_date} className="border-t border-border">
                    <td className="px-2 py-1">{d.ist_date}</td>
                    <td className="px-2 py-1 text-muted-foreground">{d.weekday_label}</td>
                    <td className="text-right px-2 py-1">
                      {d.zone_high != null ? `${fmt(d.zone_high)} / ${fmt(d.zone_low)}` : "—"}
                    </td>
                    <td
                      className={`text-right px-2 py-1 ${
                        d.break_side === "long" ? "text-long" : d.break_side === "short" ? "text-short" : ""
                      }`}
                    >
                      {d.break_side ? `${d.break_side.toUpperCase()} @ ${fmt(d.break_close)}` : "—"}
                    </td>
                    <td className="text-right px-2 py-1">
                      {d.entry != null ? `${fmt(d.entry)} / ${fmt(d.sl)} / ${fmt(d.tp)}` : "—"}
                    </td>
                    <td className="text-right px-2 py-1">{fmtTime(d.trigger_at)}</td>
                    <td className="text-right px-2 py-1">{d.peak_r > 0 ? d.peak_r.toFixed(2) : "—"}</td>
                    <td className={`px-2 py-1 uppercase ${outcomeCls(d.outcome)}`}>
                      {d.outcome.replace(/_/g, " ")}
                    </td>
                    <td
                      className={`text-right px-2 py-1 ${
                        d.pnl_usd > 0 ? "text-long" : d.pnl_usd < 0 ? "text-short" : ""
                      }`}
                    >
                      {d.pnl_usd === 0 ? "—" : fmtUsd(d.pnl_usd)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <p className="text-muted-foreground text-[10px]">
          Read-only replay of {data.bars_scanned} 1H bars using the parameters above. Does not touch live orders.
          Same-bar TP+SL is treated as SL (conservative).
        </p>
      </CardContent>
    </Card>
  );
}

function Kv({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="border border-border rounded px-2 py-1.5 bg-background">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{k}</div>
      <div className={`text-xs ${tone ?? ""}`}>{v}</div>
    </div>
  );
}

type CohortsPayload = RangeData["summary"]["cohorts"];

const COHORT_DIM_ORDER: { key: CohortDimKey; label: string; edgeSuffix?: string }[] = [
  { key: "body", label: "Body strength (breakout candle body / range)", edgeSuffix: "%" },
  { key: "or_size", label: "Opening range size (session $)", edgeSuffix: "$" },
  { key: "break_distance", label: "Break distance beyond level", edgeSuffix: "$" },
  { key: "weekday", label: "Weekday" },
  { key: "tp_target", label: "TP target reached (swing / opposite liquidity)" },
];

function CohortBreakdowns({
  cohorts,
  active,
  onSelect,
}: {
  cohorts: CohortsPayload;
  active: CohortFilter;
  onSelect: (f: CohortFilter) => void;
}) {
  const fmtUsd = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
  return (
    <div className="space-y-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        Cohort breakdowns — click a bucket to filter the trade table &amp; equity curve
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {COHORT_DIM_ORDER.map(({ key, label, edgeSuffix }) => {
          const dim = cohorts[key];
          const rows = dim.buckets;
          const withTrades = rows.filter((r) => r.trades > 0);
          const bestBucket = withTrades.length
            ? withTrades.reduce((a, b) => (b.total_pnl_usd > a.total_pnl_usd ? b : a)).bucket
            : null;
          return (
            <div key={key} className="border border-border rounded overflow-hidden">
              <div className="flex items-center justify-between px-2 py-1 bg-muted/60">
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
                {dim.edges && (
                  <span className="text-[9px] font-mono text-muted-foreground">
                    tertiles: {dim.edges[0].toFixed(1)}{edgeSuffix} / {dim.edges[1].toFixed(1)}{edgeSuffix}
                  </span>
                )}
              </div>
              <table className="w-full text-[11px] font-mono">
                <thead className="text-[9px] uppercase tracking-widest text-muted-foreground">
                  <tr>
                    <th className="text-left px-2 py-1">Bucket</th>
                    <th className="text-right px-2 py-1">Trades</th>
                    <th className="text-right px-2 py-1">Win %</th>
                    <th className="text-right px-2 py-1">Total $</th>
                    <th className="text-right px-2 py-1">Avg R</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const isActive = active?.dim === key && active?.bucket === r.bucket;
                    const isBest = r.bucket === bestBucket && r.trades > 0;
                    const tone =
                      r.trades === 0
                        ? "text-muted-foreground"
                        : r.total_pnl_usd > 0
                          ? "text-long"
                          : r.total_pnl_usd < 0
                            ? "text-short"
                            : "";
                    return (
                      <tr
                        key={r.bucket}
                        onClick={() => {
                          if (r.trades === 0) return;
                          onSelect(isActive ? null : { dim: key, bucket: r.bucket });
                        }}
                        className={`border-t border-border cursor-pointer hover:bg-muted/40 ${
                          isActive ? "bg-primary/10" : isBest ? "bg-emerald-500/5" : ""
                        } ${r.trades === 0 ? "opacity-60 cursor-default" : ""}`}
                      >
                        <td className="px-2 py-1 capitalize">
                          {r.bucket}
                          {isBest && <span className="ml-1 text-[9px] text-emerald-400">★</span>}
                        </td>
                        <td className="text-right px-2 py-1">{r.trades}</td>
                        <td className="text-right px-2 py-1">
                          {r.trades > 0 ? `${r.win_rate_pct.toFixed(0)}%` : "—"}
                        </td>
                        <td className={`text-right px-2 py-1 ${tone}`}>
                          {r.trades > 0 ? fmtUsd(r.total_pnl_usd) : "—"}
                        </td>
                        <td className={`text-right px-2 py-1 ${tone}`}>
                          {r.trades > 0 ? r.avg_r.toFixed(2) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}


const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

type DayRow = RangeData["days"][number];

function CalendarView({ data }: { data: RangeData }) {
  const fmtUsd = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;

  const months = useMemo(() => {
    const byMonth = new Map<string, { year: number; month: number; days: Map<number, DayRow> }>();
    for (const d of data.days) {
      const [y, m, dd] = d.ist_date.split("-").map((n) => parseInt(n, 10));
      const key = `${y}-${String(m).padStart(2, "0")}`;
      let bucket = byMonth.get(key);
      if (!bucket) {
        bucket = { year: y, month: m, days: new Map() };
        byMonth.set(key, bucket);
      }
      bucket.days.set(dd, d);
    }
    return [...byMonth.entries()]
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([, v]) => v);
  }, [data.days]);

  const monthTotals = useMemo(
    () =>
      months.map((m) => {
        const rows = [...m.days.values()];
        const total = rows.reduce((s, r) => s + r.pnl_usd, 0);
        const wins = rows.filter((r) => r.outcome === "tp").length;
        const losses = rows.filter((r) => r.outcome === "sl").length;
        return { year: m.year, month: m.month, total, wins, losses, trades: wins + losses };
      }),
    [months],
  );

  const bestMonth = monthTotals.reduce<typeof monthTotals[number] | null>(
    (b, m) => (b == null || m.total > b.total ? m : b),
    null,
  );
  const worstMonth = monthTotals.reduce<typeof monthTotals[number] | null>(
    (b, m) => (b == null || m.total < b.total ? m : b),
    null,
  );

  // Month navigation (most recent first).
  const [monthIdx, setMonthIdx] = useState(0);
  const activeIdx = Math.min(monthIdx, Math.max(0, months.length - 1));
  const active = months[activeIdx];
  const [selected, setSelected] = useState<DayRow | null>(null);

  const jumpYear = (dir: 1 | -1) => {
    if (!active) return;
    const target = active.year - dir; // dir=1 = older year (higher idx)
    const found = months.findIndex((m) => m.year === target);
    if (found >= 0) setMonthIdx(found);
    else {
      // fallback: nearest month whose year <= target (older) or >= target (newer)
      const idx = dir === 1
        ? months.findIndex((m) => m.year <= target)
        : [...months].reverse().findIndex((m) => m.year >= target);
      if (idx >= 0) setMonthIdx(dir === 1 ? idx : months.length - 1 - idx);
    }
  };

  return (
    <div className="space-y-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        Calendar — daily P&amp;L
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Kv k="months covered" v={String(monthTotals.length)} />
        <Kv
          k="best month"
          v={
            bestMonth
              ? `${MONTH_LABELS[bestMonth.month - 1].slice(0, 3)} ${bestMonth.year} ${fmtUsd(bestMonth.total)}`
              : "—"
          }
          tone="text-long"
        />
        <Kv
          k="worst month"
          v={
            worstMonth
              ? `${MONTH_LABELS[worstMonth.month - 1].slice(0, 3)} ${worstMonth.year} ${fmtUsd(worstMonth.total)}`
              : "—"
          }
          tone="text-short"
        />
        <Kv
          k="avg month"
          v={
            monthTotals.length
              ? fmtUsd(monthTotals.reduce((s, m) => s + m.total, 0) / monthTotals.length)
              : "—"
          }
        />
      </div>

      <div className="border border-border rounded overflow-hidden">
        <table className="w-full text-[11px]">
          <thead className="text-[10px] uppercase tracking-widest text-muted-foreground bg-muted/60">
            <tr>
              <th className="text-left px-2 py-1">Month</th>
              <th className="text-right px-2 py-1">Trades</th>
              <th className="text-right px-2 py-1">W / L</th>
              <th className="text-right px-2 py-1">Win %</th>
              <th className="text-right px-2 py-1">Total $</th>
            </tr>
          </thead>
          <tbody>
            {monthTotals.map((m, i) => {
              const winRate = m.trades > 0 ? (m.wins / m.trades) * 100 : 0;
              const tone =
                m.total > 0 ? "text-long" : m.total < 0 ? "text-short" : "text-muted-foreground";
              const isActive = i === activeIdx;
              return (
                <tr
                  key={`${m.year}-${m.month}`}
                  className={`border-t border-border cursor-pointer hover:bg-muted/40 ${
                    isActive ? "bg-muted/40" : ""
                  }`}
                  onClick={() => setMonthIdx(i)}
                >
                  <td className="px-2 py-1">
                    {MONTH_LABELS[m.month - 1]} {m.year}
                  </td>
                  <td className="text-right px-2 py-1">{m.trades}</td>
                  <td className="text-right px-2 py-1">
                    {m.wins} / {m.losses}
                  </td>
                  <td className="text-right px-2 py-1">
                    {m.trades > 0 ? `${winRate.toFixed(0)}%` : "—"}
                  </td>
                  <td className={`text-right px-2 py-1 ${tone}`}>
                    {m.trades > 0 ? fmtUsd(m.total) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono text-muted-foreground border border-border rounded px-3 py-2 bg-muted/20">
        <span className="uppercase tracking-widest">Legend</span>
        <div className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded border border-border" style={{ backgroundColor: "hsl(var(--primary) / 0.2)" }} />
          <span className="inline-block h-3 w-3 rounded border border-border" style={{ backgroundColor: "hsl(var(--primary) / 0.45)" }} />
          <span className="inline-block h-3 w-3 rounded border border-border" style={{ backgroundColor: "hsl(var(--primary) / 0.7)" }} />
          <span className="text-long">Win (darker = bigger $)</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded border border-border" style={{ backgroundColor: "hsl(var(--destructive) / 0.2)" }} />
          <span className="inline-block h-3 w-3 rounded border border-border" style={{ backgroundColor: "hsl(var(--destructive) / 0.45)" }} />
          <span className="inline-block h-3 w-3 rounded border border-border" style={{ backgroundColor: "hsl(var(--destructive) / 0.7)" }} />
          <span className="text-short">Loss (darker = bigger $)</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded border border-border" style={{ backgroundColor: "hsl(var(--warning, var(--primary)) / 0.15)" }} />
          <span className="text-warning">Open</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded border border-border" style={{ backgroundColor: "hsl(var(--muted) / 0.4)" }} />
          <span>Skipped</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded border border-border bg-transparent" />
          <span>No trade / no data</span>
        </div>
      </div>

      {/* Month nav */}
      {active && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => jumpYear(1)} disabled={activeIdx >= months.length - 1}>
              « Year
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMonthIdx(Math.min(months.length - 1, activeIdx + 1))}
              disabled={activeIdx >= months.length - 1}
            >
              ‹ Prev
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="h-8 rounded-md border border-input bg-transparent px-2 text-xs font-mono"
              value={activeIdx}
              onChange={(e) => setMonthIdx(Number(e.target.value))}
            >
              {months.map((m, i) => (
                <option key={`${m.year}-${m.month}`} value={i}>
                  {MONTH_LABELS[m.month - 1]} {m.year}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMonthIdx(Math.max(0, activeIdx - 1))}
              disabled={activeIdx <= 0}
            >
              Next ›
            </Button>
            <Button variant="outline" size="sm" onClick={() => jumpYear(-1)} disabled={activeIdx <= 0}>
              Year »
            </Button>
          </div>
        </div>
      )}

      {active && (
        <div className="max-w-md">
          <MonthGrid
            year={active.year}
            month={active.month}
            days={active.days}
            onDayClick={(d) => setSelected(d)}
          />
        </div>
      )}

      <DayDetailSheet
        day={selected}
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        symbol={data.symbol}
        rr={data.rr}
      />
    </div>
  );
}

function DayDetailSheet({
  day,
  open,
  onOpenChange,
  symbol,
  rr,
}: {
  day: DayRow | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  symbol: string;
  rr: number;
}) {
  const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(2));
  const fmtUsd = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
  const fmtTime = (ms: number | null | undefined) =>
    ms == null ? "—" : new Date(ms).toLocaleString([], { hour: "2-digit", minute: "2-digit", month: "short", day: "2-digit" });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-mono text-sm tracking-widest">
            {day ? `${day.ist_date} · ${day.weekday_label}` : "Trade detail"}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {symbol} · target 1:{rr}
          </SheetDescription>
        </SheetHeader>

        {day && (
          <div className="mt-4 space-y-3 font-mono text-xs">
            {day.outcome === "no_session" || day.outcome === "skipped" || day.zone_high == null ? (
              <p className="text-muted-foreground">
                {day.skipped
                  ? "Weekday excluded from the simulation — no trade taken."
                  : "No session candle available for this day."}
              </p>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Kv
                    k="outcome"
                    v={day.outcome.replace(/_/g, " ").toUpperCase()}
                    tone={
                      day.outcome === "tp"
                        ? "text-long"
                        : day.outcome === "sl"
                          ? "text-short"
                          : day.outcome === "open"
                            ? "text-warning"
                            : "text-muted-foreground"
                    }
                  />
                  <Kv
                    k="p&l"
                    v={day.pnl_usd === 0 ? "—" : fmtUsd(day.pnl_usd)}
                    tone={day.pnl_usd > 0 ? "text-long" : day.pnl_usd < 0 ? "text-short" : ""}
                  />
                  <Kv
                    k="side"
                    v={day.break_side ? day.break_side.toUpperCase() : "—"}
                    tone={day.break_side === "long" ? "text-long" : day.break_side === "short" ? "text-short" : ""}
                  />
                  <Kv k="peak R" v={day.peak_r > 0 ? day.peak_r.toFixed(2) : "—"} />
                </div>

                <div className="border border-border rounded">
                  <table className="w-full text-[11px]">
                    <tbody>
                      <Row k="Zone High / Low" v={`${fmt(day.zone_high)} / ${fmt(day.zone_low)}`} />
                      <Row k="Fib 25% / 75%" v={`${fmt(day.fib_25)} / ${fmt(day.fib_75)}`} />
                      <Row
                        k="Break"
                        v={day.break_side ? `${day.break_side.toUpperCase()} @ ${fmt(day.break_close)}` : "—"}
                      />
                      <Row k="Break time" v={fmtTime(day.break_at)} />
                      <Row k="Entry" v={fmt(day.entry)} />
                      <Row k="Initial SL" v={fmt(day.sl)} />
                      <Row k="Final SL" v={fmt(day.final_sl)} />
                      <Row k="TP" v={fmt(day.tp)} />
                      <Row k="Qty" v={day.qty != null ? day.qty.toFixed(4) : "—"} />
                      <Row k="Triggered at" v={fmtTime(day.trigger_at)} />
                      <Row k="Exit R" v={day.exit_r != null ? day.exit_r.toFixed(2) : "—"} />
                    </tbody>
                  </table>
                </div>

                {day.outcome === "no_break" && (
                  <p className="text-muted-foreground">Price never closed outside the session range — no setup armed.</p>
                )}
                {day.outcome === "armed_no_trigger" && (
                  <p className="text-muted-foreground">Setup armed but price never pulled back to the entry.</p>
                )}
                {day.outcome === "open" && (
                  <p className="text-warning">Trade is still open in this replay window.</p>
                )}
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <tr className="border-t border-border first:border-t-0">
      <td className="px-2 py-1 text-muted-foreground">{k}</td>
      <td className="px-2 py-1 text-right">{v}</td>
    </tr>
  );
}

function MonthGrid({
  year,
  month,
  days,
  onDayClick,
}: {
  year: number;
  month: number;
  days: Map<number, DayRow>;
  onDayClick?: (d: DayRow) => void;
}) {
  const fmtUsd = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(0)}`;
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0=Sun
  const rows = [...days.values()];
  const total = rows.reduce((s, r) => s + r.pnl_usd, 0);
  const wins = rows.filter((r) => r.outcome === "tp").length;
  const losses = rows.filter((r) => r.outcome === "sl").length;
  const totalTone = total > 0 ? "text-long" : total < 0 ? "text-short" : "text-muted-foreground";

  // Extremes for color intensity scaling.
  const maxAbs = rows.reduce((m, r) => Math.max(m, Math.abs(r.pnl_usd)), 0) || 1;

  const cells: (DayRow | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(days.get(d) ?? null);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="border border-border rounded p-2 bg-muted/20">
      <div className="flex items-center justify-between mb-2">
        <div className="font-mono text-[11px] tracking-widest uppercase">
          {MONTH_LABELS[month - 1]} {year}
        </div>
        <div className={`font-mono text-[11px] ${totalTone}`}>
          {fmtUsd(total)} · {wins}W/{losses}L
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {(["S", "M", "T", "W", "T", "F", "S"] as const).map((d, i) => (
          <div
            key={i}
            className="text-[9px] uppercase text-muted-foreground text-center tracking-widest"
          >
            {d}
          </div>
        ))}
        {cells.map((c, i) => {
          if (!c) return <div key={i} className="h-11 rounded bg-transparent" />;
          const dayNum = parseInt(c.ist_date.slice(8, 10), 10);
          const pnl = c.pnl_usd;
          const intensity = Math.min(1, Math.abs(pnl) / maxAbs);
          const alpha = 0.15 + intensity * 0.55;
          let bg = "transparent";
          let textCls = "text-muted-foreground";
          if (c.outcome === "tp") {
            bg = `hsl(var(--primary) / ${alpha})`;
            textCls = "text-long";
          } else if (c.outcome === "sl") {
            bg = `hsl(var(--destructive) / ${alpha})`;
            textCls = "text-short";
          } else if (c.skipped) {
            bg = "hsl(var(--muted) / 0.4)";
          } else if (c.outcome === "open") {
            bg = "hsl(var(--warning, var(--primary)) / 0.15)";
            textCls = "text-warning";
          }
          const title = `${c.ist_date} · ${c.outcome.replace(/_/g, " ")}${
            pnl !== 0 ? ` · ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}` : ""
          }`;
          const clickable = !!onDayClick;
          return (
            <button
              key={i}
              type="button"
              title={title}
              onClick={clickable ? () => onDayClick!(c) : undefined}
              className={`h-11 rounded border border-border/60 px-1 py-0.5 flex flex-col justify-between text-left transition ${
                clickable ? "hover:ring-1 hover:ring-primary/50 cursor-pointer" : "cursor-default"
              }`}
              style={{ backgroundColor: bg }}
            >
              <div className="text-[9px] font-mono text-foreground/70">{dayNum}</div>
              <div className={`text-[9px] font-mono text-right ${textCls}`}>
                {pnl !== 0 ? fmtUsd(pnl) : c.skipped ? "·" : ""}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}


type SweepData = Awaited<ReturnType<typeof sweepHoursBacktest>>;

const SWEEP_RANGE_OPTIONS = [7, 30, 60, 90, 180, 365];

function HourSweepPanel({
  defaults,
  filters,
}: {
  defaults: {
    symbol: string;
    slRiskUsd: number;
    rr: number;
    trailEnabled: boolean;
    trailActivateR: number;
    trailStepR: number;
    skipWeekdays: number[];
  };
  filters: FilterConfig;
}) {
  const runSweepFn = useServerFn(sweepHoursBacktest);
  const [symbol, setSymbol] = useState<string>(defaults.symbol);
  const [ranges, setRanges] = useState<number[]>([7, 30, 60, 90]);
  const [slRiskUsd, setSl] = useState<number>(defaults.slRiskUsd);
  const [rr, setRr] = useState<number>(defaults.rr);
  const [skipWeekdays, setSkipWeekdays] = useState<number[]>(defaults.skipWeekdays ?? [0]);
  const [data, setData] = useState<SweepData | null>(null);
  const [activeRange, setActiveRange] = useState<number>(90);
  const [sortKey, setSortKey] = useState<"pnl" | "wr" | "dd" | "hour">("pnl");
  const [cohortDim, setCohortDim] = useState<"none" | CohortDimKey>("none");

  const runMut = useMutation({
    mutationFn: () =>
      runSweepFn({
        data: {
          symbol,
          ranges,
          sl_risk_usd: slRiskUsd,
          rr,
          trail_enabled: defaults.trailEnabled,
          trail_activate_r: defaults.trailActivateR,
          trail_step_r: defaults.trailStepR,
          skip_weekdays: skipWeekdays,
          filters,
        },
      }),
    onSuccess: (r) => {
      setData(r);
      const first = r.ranges[0]?.days;
      if (first) setActiveRange(first);
      toast.success(`Sweep done — ${r.ranges.length} range(s) × 24 hours`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleRange = (d: number) => {
    setRanges((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b),
    );
  };

  const active = data?.ranges.find((r) => r.days === activeRange) ?? data?.ranges[0] ?? null;

  const sortedHours = useMemo(() => {
    if (!active) return [];
    const rows = [...active.hours];
    rows.sort((a, b) => {
      switch (sortKey) {
        case "pnl":
          return b.total_pnl_usd - a.total_pnl_usd;
        case "wr":
          return b.win_rate_pct - a.win_rate_pct;
        case "dd":
          return a.max_drawdown_usd - b.max_drawdown_usd;
        case "hour":
        default:
          return a.hour.localeCompare(b.hour);
      }
    });
    return rows;
  }, [active, sortKey]);

  const fmtUsd = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
  const tone = (n: number) => (n > 0 ? "text-long" : n < 0 ? "text-short" : "text-muted-foreground");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-mono tracking-widest">24-HOUR SWEEP</CardTitle>
        <p className="text-xs text-muted-foreground">
          Auto-run the backtest for every hourly session start (00:00 → 23:00) across selected day windows,
          then rank hours by total P&amp;L.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Symbol">
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="h-8 w-full rounded border border-input bg-background px-2 font-mono text-xs"
            >
              <option value="XAUUSDT">XAUUSDT · Gold</option>
              <option value="BTCUSDT">BTCUSDT · Bitcoin</option>
            </select>
          </Field>
          <Field label="SL risk ($/trade)">
            <Input
              type="number"
              min={1}
              step={1}
              value={slRiskUsd}
              onChange={(e) => setSl(Math.max(1, Number(e.target.value) || 1))}
              className="h-8 font-mono text-xs"
            />
          </Field>
          <Field label="R:R (1 : X)">
            <Input
              type="number"
              min={0.5}
              step={0.1}
              value={rr}
              onChange={(e) => setRr(Math.max(0.5, Number(e.target.value) || 0.5))}
              className="h-8 font-mono text-xs"
            />
          </Field>
          <Field label="Ranges (days)">
            <div className="flex flex-wrap gap-1 pt-1">
              {SWEEP_RANGE_OPTIONS.map((d) => {
                const on = ranges.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleRange(d)}
                    className={`px-2 h-7 rounded font-mono text-[11px] border ${
                      on
                        ? "bg-primary/10 border-primary text-primary"
                        : "bg-background border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {d}d
                  </button>
                );
              })}
            </div>
          </Field>
        </div>

        <Field label="Skip weekdays (IST)">
          <div className="flex flex-wrap gap-1 pt-1">
            {(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const).map((label, idx) => {
              const on = skipWeekdays.includes(idx);
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() =>
                    setSkipWeekdays((prev) =>
                      prev.includes(idx) ? prev.filter((x) => x !== idx) : [...prev, idx].sort(),
                    )
                  }
                  className={`px-2 h-7 rounded font-mono text-[11px] border ${
                    on
                      ? "bg-short/10 border-short text-short"
                      : "bg-background border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </Field>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={runMut.isPending || ranges.length === 0}
            onClick={() => runMut.mutate()}
          >
            {runMut.isPending ? "Sweeping 24 hours…" : "Run 24-hour sweep"}
          </Button>
          <p className="text-[10px] text-muted-foreground">
            Fetches candles once per symbol and reuses them across all hour/range combinations.
          </p>
        </div>

        {data && active && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-mono tracking-widest text-muted-foreground">RANGE:</span>
              {data.ranges.map((r) => (
                <button
                  key={r.days}
                  type="button"
                  onClick={() => setActiveRange(r.days)}
                  className={`px-2 h-7 rounded font-mono text-[11px] border ${
                    r.days === active.days
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {r.days}d
                </button>
              ))}
              <span className="ml-auto text-[10px] font-mono tracking-widest text-muted-foreground">SORT:</span>
              {(
                [
                  ["pnl", "P&L"],
                  ["wr", "Win rate"],
                  ["dd", "Max DD"],
                  ["hour", "Hour"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSortKey(k)}
                  className={`px-2 h-7 rounded font-mono text-[11px] border ${
                    sortKey === k
                      ? "bg-muted border-foreground/30"
                      : "bg-background border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono tracking-widest text-muted-foreground">COHORT:</span>
              <select
                value={cohortDim}
                onChange={(e) => setCohortDim(e.target.value as "none" | CohortDimKey)}
                className="h-7 rounded border border-input bg-background px-2 font-mono text-[11px]"
              >
                <option value="none">Overall</option>
                {(Object.keys(COHORT_DIM_LABELS) as CohortDimKey[]).map((k) => (
                  <option key={k} value={k}>{COHORT_DIM_LABELS[k]}</option>
                ))}
              </select>
              {cohortDim !== "none" && (
                <span className="text-[10px] text-muted-foreground">
                  Best bucket per hour (by $ P&amp;L within that hour's slice).
                </span>
              )}
            </div>

            <div className="overflow-x-auto border border-border rounded">
              <table className="w-full font-mono text-[11px]">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="text-left px-2 py-1.5">Hour (IST)</th>
                    <th className="text-right px-2 py-1.5">Trades</th>
                    <th className="text-right px-2 py-1.5">Win rate</th>
                    <th className="text-right px-2 py-1.5">Total P&amp;L</th>
                    <th className="text-right px-2 py-1.5">Max DD</th>
                    <th className="text-right px-2 py-1.5">PF</th>
                    <th className="text-right px-2 py-1.5">Avg R</th>
                    {cohortDim !== "none" && (
                      <th className="text-left px-2 py-1.5">Best {COHORT_DIM_LABELS[cohortDim]}</th>
                    )}
                    <th className="text-left px-2 py-1.5">Best day</th>
                    <th className="text-left px-2 py-1.5">Worst day</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedHours.map((h) => (
                    <tr key={h.hour} className="border-t border-border">
                      <td className="px-2 py-1.5 font-semibold">{h.hour}</td>
                      <td className="px-2 py-1.5 text-right">
                        {h.trades}
                        <span className="text-muted-foreground"> ({h.wins}W/{h.losses}L)</span>
                      </td>
                      <td className={`px-2 py-1.5 text-right ${h.win_rate_pct >= 50 ? "text-long" : "text-short"}`}>
                        {h.win_rate_pct.toFixed(1)}%
                      </td>
                      <td className={`px-2 py-1.5 text-right ${tone(h.total_pnl_usd)}`}>
                        {fmtUsd(h.total_pnl_usd)}
                      </td>
                      <td className="px-2 py-1.5 text-right text-short">
                        {h.max_drawdown_usd > 0 ? `-${h.max_drawdown_usd.toFixed(2)}` : "0.00"}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {isFinite(h.profit_factor) ? h.profit_factor.toFixed(2) : "∞"}
                      </td>
                      <td className="px-2 py-1.5 text-right">{h.avg_r.toFixed(2)}</td>
                      {cohortDim !== "none" && (
                        <td className="px-2 py-1.5 text-left">
                          {(() => {
                            const buckets = h.cohorts[cohortDim].buckets.filter((b) => b.trades > 0);
                            if (!buckets.length) return <span className="text-muted-foreground">—</span>;
                            const b = buckets.reduce((a, c) => (c.total_pnl_usd > a.total_pnl_usd ? c : a));
                            return (
                              <span className={tone(b.total_pnl_usd)}>
                                <span className="uppercase">{b.bucket}</span>{" "}
                                <span className="text-muted-foreground">
                                  · {b.trades}t · {b.win_rate_pct.toFixed(0)}% · {fmtUsd(b.total_pnl_usd)}
                                </span>
                              </span>
                            );
                          })()}
                        </td>
                      )}
                      <td className="px-2 py-1.5 text-left">
                        {h.best_day ? (
                          <span className={tone(h.best_day.pnl_usd)}>
                            {h.best_day.ist_date} · {fmtUsd(h.best_day.pnl_usd)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-left">
                        {h.worst_day ? (
                          <span className={tone(h.worst_day.pnl_usd)}>
                            {h.worst_day.ist_date} · {fmtUsd(h.worst_day.pnl_usd)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-muted-foreground font-mono">
              {data.symbol} · SL ${data.sl_risk_usd} · RR 1:{data.rr} · window {active.days}d ·
              {data.trail.enabled
                ? ` trail on (act ${data.trail.activate_r}R / step ${data.trail.step_r}R)`
                : " trail off"}
              {data.skip_weekdays.length > 0
                ? ` · skip [${data.skip_weekdays.map((w) => WD_LABELS[w]).join(", ")}]`
                : ""}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FiltersCard({
  value,
  onChange,
}: {
  value: NonNullable<FilterConfig>;
  onChange: (v: NonNullable<FilterConfig>) => void;
}) {
  const htf = value.htf ?? {};
  const q = value.quality ?? {};
  const setHtf = (patch: Partial<typeof htf>) =>
    onChange({ ...value, htf: { ...htf, ...patch } });
  const setQ = (patch: Partial<typeof q>) =>
    onChange({ ...value, quality: { ...q, ...patch } });
  const numOr = (v: string, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm font-mono tracking-widest">FILTERS</CardTitle>
            <p className="text-xs text-muted-foreground">
              Applied to the single-run backtest and the 24-hour sweep. Live rules are unchanged.
            </p>
          </div>
          <label className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Master
            </span>
            <Switch
              checked={!!value.enabled}
              onCheckedChange={(v) => onChange({ ...value, enabled: v })}
            />
          </label>
        </div>
      </CardHeader>
      <CardContent className={`space-y-5 ${value.enabled ? "" : "opacity-60"}`}>
        {/* HTF BIAS */}
        <section className="space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            HTF Bias — only take trades that agree with all enabled references
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="flex items-center gap-2">
              <Switch
                checked={!!htf.daily_ema_enabled}
                onCheckedChange={(v) => setHtf({ daily_ema_enabled: v })}
                disabled={!value.enabled}
              />
              <span className="text-xs">Daily EMA</span>
              <Input
                type="number"
                min={2}
                max={400}
                value={htf.daily_ema_len ?? 20}
                onChange={(e) => setHtf({ daily_ema_len: Math.max(2, numOr(e.target.value, 20)) })}
                className="h-7 w-16 font-mono text-xs"
                disabled={!value.enabled || !htf.daily_ema_enabled}
              />
              <span className="text-[10px] text-muted-foreground">len</span>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={!!htf.prev_day_close_enabled}
                onCheckedChange={(v) => setHtf({ prev_day_close_enabled: v })}
                disabled={!value.enabled}
              />
              <span className="text-xs">Prior-day close</span>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={!!htf.weekly_open_enabled}
                onCheckedChange={(v) => setHtf({ weekly_open_enabled: v })}
                disabled={!value.enabled}
              />
              <span className="text-xs">Weekly open</span>
            </div>
          </div>
        </section>

        {/* SETUP QUALITY */}
        <section className="space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Setup Quality
          </div>

          {/* Zone size */}
          <div className="flex flex-wrap items-center gap-2">
            <Switch
              checked={!!q.zone_size_enabled}
              onCheckedChange={(v) => setQ({ zone_size_enabled: v })}
              disabled={!value.enabled}
            />
            <span className="text-xs w-28">Zone size</span>
            <Input
              type="number"
              min={0}
              value={q.zone_size_min ?? 0}
              onChange={(e) => setQ({ zone_size_min: Math.max(0, numOr(e.target.value, 0)) })}
              className="h-7 w-20 font-mono text-xs"
              placeholder="min"
              disabled={!value.enabled || !q.zone_size_enabled}
            />
            <span className="text-[10px] text-muted-foreground">min</span>
            <Input
              type="number"
              min={0}
              value={q.zone_size_max ?? 0}
              onChange={(e) => setQ({ zone_size_max: Math.max(0, numOr(e.target.value, 0)) })}
              className="h-7 w-20 font-mono text-xs"
              placeholder="max"
              disabled={!value.enabled || !q.zone_size_enabled}
            />
            <span className="text-[10px] text-muted-foreground">max</span>
            <select
              value={q.zone_size_unit ?? "usd"}
              onChange={(e) => setQ({ zone_size_unit: e.target.value as "usd" | "pct" })}
              className="h-7 rounded border border-input bg-background px-2 text-xs font-mono"
              disabled={!value.enabled || !q.zone_size_enabled}
            >
              <option value="usd">$</option>
              <option value="pct">%</option>
            </select>
            <span className="text-[10px] text-muted-foreground">0 = off</span>
          </div>

          {/* ATR regime */}
          <div className="flex flex-wrap items-center gap-2">
            <Switch
              checked={!!q.atr_enabled}
              onCheckedChange={(v) => setQ({ atr_enabled: v })}
              disabled={!value.enabled}
            />
            <span className="text-xs w-28">Daily ATR</span>
            <Input
              type="number"
              min={2}
              max={200}
              value={q.atr_len ?? 14}
              onChange={(e) => setQ({ atr_len: Math.max(2, numOr(e.target.value, 14)) })}
              className="h-7 w-16 font-mono text-xs"
              disabled={!value.enabled || !q.atr_enabled}
            />
            <span className="text-[10px] text-muted-foreground">len</span>
            <Input
              type="number"
              min={0}
              value={q.atr_min ?? 0}
              onChange={(e) => setQ({ atr_min: Math.max(0, numOr(e.target.value, 0)) })}
              className="h-7 w-20 font-mono text-xs"
              disabled={!value.enabled || !q.atr_enabled}
            />
            <span className="text-[10px] text-muted-foreground">min $</span>
            <Input
              type="number"
              min={0}
              value={q.atr_max ?? 0}
              onChange={(e) => setQ({ atr_max: Math.max(0, numOr(e.target.value, 0)) })}
              className="h-7 w-20 font-mono text-xs"
              disabled={!value.enabled || !q.atr_enabled}
            />
            <span className="text-[10px] text-muted-foreground">max $ · 0 = off</span>
          </div>

          {/* Break strength */}
          <div className="flex flex-wrap items-center gap-2">
            <Switch
              checked={!!q.break_strength_enabled}
              onCheckedChange={(v) => setQ({ break_strength_enabled: v })}
              disabled={!value.enabled}
            />
            <span className="text-xs w-28">Break strength</span>
            <Input
              type="number"
              min={0}
              max={500}
              value={q.break_strength_pct ?? 25}
              onChange={(e) => setQ({ break_strength_pct: Math.max(0, numOr(e.target.value, 0)) })}
              className="h-7 w-20 font-mono text-xs"
              disabled={!value.enabled || !q.break_strength_enabled}
            />
            <span className="text-[10px] text-muted-foreground">% of zone range beyond level</span>
          </div>

          {/* Break body */}
          <div className="flex flex-wrap items-center gap-2">
            <Switch
              checked={!!q.break_body_enabled}
              onCheckedChange={(v) => setQ({ break_body_enabled: v })}
              disabled={!value.enabled}
            />
            <span className="text-xs w-28">Break body</span>
            <Input
              type="number"
              min={0}
              max={100}
              value={q.break_body_pct ?? 50}
              onChange={(e) => setQ({ break_body_pct: Math.max(0, Math.min(100, numOr(e.target.value, 0))) })}
              className="h-7 w-20 font-mono text-xs"
              disabled={!value.enabled || !q.break_body_enabled}
            />
            <span className="text-[10px] text-muted-foreground">% body / bar range</span>
          </div>

          {/* Break timing */}
          <div className="flex flex-wrap items-center gap-2">
            <Switch
              checked={!!q.break_timing_enabled}
              onCheckedChange={(v) => setQ({ break_timing_enabled: v })}
              disabled={!value.enabled}
            />
            <span className="text-xs w-28">Break timing</span>
            <Input
              type="number"
              min={0}
              max={24}
              step={0.5}
              value={q.break_timing_hours ?? 6}
              onChange={(e) => setQ({ break_timing_hours: Math.max(0, Math.min(24, numOr(e.target.value, 0))) })}
              className="h-7 w-20 font-mono text-xs"
              disabled={!value.enabled || !q.break_timing_enabled}
            />
            <span className="text-[10px] text-muted-foreground">within N hours after session</span>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Entry-zone grid sweep panel — scans (mode, entry_depth, sl_depth) combos.
// -----------------------------------------------------------------------------
function EntryZoneGridPanel(props: {
  defaults: {
    symbol: string;
    sessionStartIst: string;
    slRiskUsd: number;
    rr: number;
    trailEnabled: boolean;
    trailActivateR: number;
    trailStepR: number;
    skipWeekdays: number[];
  };
  filters: NonNullable<FilterConfig>;
}) {
  const run = useServerFn(runEntryZoneSweep);
  const [days, setDays] = useState(90);
  const [modes, setModes] = useState<Array<"fib" | "retest" | "market" | "adaptive">>(["fib"]);
  const [entryDepthsStr, setEntryDepthsStr] = useState("0, 0.1, 0.2, 0.25, 0.35, 0.5");
  const [slDepthsStr, setSlDepthsStr] = useState("0.5, 0.75, 1.0");
  const [result, setResult] = useState<Awaited<ReturnType<typeof runEntryZoneSweep>> | null>(null);
  const [cohortDim, setCohortDim] = useState<"none" | CohortDimKey>("none");

  const parseList = (s: string) =>
    s.split(/[,\s]+/).map((x) => Number(x.trim())).filter((n) => Number.isFinite(n));

  const mut = useMutation({
    mutationFn: () =>
      run({
        data: {
          symbol: props.defaults.symbol,
          days,
          session_start_ist: props.defaults.sessionStartIst,
          sl_risk_usd: props.defaults.slRiskUsd,
          rr: props.defaults.rr,
          entry_depths: parseList(entryDepthsStr),
          sl_depths: parseList(slDepthsStr),
          modes,
          trail_enabled: props.defaults.trailEnabled,
          trail_activate_r: props.defaults.trailActivateR,
          trail_step_r: props.defaults.trailStepR,
          skip_weekdays: props.defaults.skipWeekdays,
          filters: props.filters,
        },
      }),
    onSuccess: (r) => {
      setResult(r);
      const best = r.cells.reduce<(typeof r.cells)[number] | null>(
        (a, b) => (a == null || b.net_pnl_usd > a.net_pnl_usd ? b : a),
        null,
      );
      if (best) {
        toast.success(
          `Best: ${best.mode} depth=${(best.entry_depth * 100).toFixed(0)}%/${(best.sl_depth * 100).toFixed(0)}% net $${best.net_pnl_usd.toFixed(2)}`,
        );
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bestNet = result
    ? Math.max(...result.cells.map((c) => c.net_pnl_usd), 0)
    : 0;
  const worstNet = result
    ? Math.min(...result.cells.map((c) => c.net_pnl_usd), 0)
    : 0;
  const cellTone = (net: number) => {
    if (net >= bestNet * 0.85 && net > 0) return "bg-emerald-500/25 text-emerald-300";
    if (net > 0) return "bg-emerald-500/10 text-emerald-400";
    if (net <= worstNet * 0.85 && net < 0) return "bg-red-500/25 text-red-300";
    if (net < 0) return "bg-red-500/10 text-red-400";
    return "text-muted-foreground";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-mono tracking-widest">ENTRY / SL GRID SWEEP</CardTitle>
        <p className="text-xs text-muted-foreground">
          Backtests every combination of entry mode and depth on your history. Optimized on <b>net</b> P&L (after fees).
        </p>
      </CardHeader>
      <CardContent className="space-y-4 font-mono text-xs">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Field label={`Days — ${days}`}>
            <input type="range" min={14} max={365} step={7} value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-full" />
          </Field>
          <div className="md:col-span-3 space-y-1">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Modes</Label>
            <div className="flex flex-wrap gap-1">
              {(["fib", "retest", "market", "adaptive"] as const).map((m) => {
                const on = modes.includes(m);
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setModes(on ? modes.filter((x) => x !== m) : [...modes, m])}
                    className={`px-3 h-7 rounded font-mono text-[11px] border uppercase tracking-wider ${
                      on
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="md:col-span-2 space-y-1">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Entry depths (0–0.5)
            </Label>
            <Input value={entryDepthsStr} onChange={(e) => setEntryDepthsStr(e.target.value)} className="h-7 font-mono text-xs" />
          </div>
          <div className="md:col-span-2 space-y-1">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
              SL depths (0.1–1.0)
            </Label>
            <Input value={slDepthsStr} onChange={(e) => setSlDepthsStr(e.target.value)} className="h-7 font-mono text-xs" />
          </div>
        </div>
        <div>
          <Button size="sm" disabled={mut.isPending || modes.length === 0} onClick={() => mut.mutate()}>
            {mut.isPending ? "Sweeping…" : `Run grid — ${days}d × ${modes.length} modes`}
          </Button>
        </div>

        {result && (
          <>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] tracking-widest text-muted-foreground">COHORT:</span>
              <select
                value={cohortDim}
                onChange={(e) => setCohortDim(e.target.value as "none" | CohortDimKey)}
                className="h-7 rounded border border-input bg-background px-2 text-[11px]"
              >
                <option value="none">Overall</option>
                {(Object.keys(COHORT_DIM_LABELS) as CohortDimKey[]).map((k) => (
                  <option key={k} value={k}>{COHORT_DIM_LABELS[k]}</option>
                ))}
              </select>
              {cohortDim !== "none" && (
                <span className="text-[10px] text-muted-foreground">Shows best bucket in that dimension per cell.</span>
              )}
            </div>
            <div className="overflow-x-auto border border-border rounded">
              <table className="w-full text-[11px]">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border text-left">
                    <th className="py-1.5 px-2">Mode</th>
                    <th className="py-1.5 px-2 text-right">Entry %</th>
                    <th className="py-1.5 px-2 text-right">SL %</th>
                    <th className="py-1.5 px-2 text-right">Fills</th>
                    <th className="py-1.5 px-2 text-right">Miss</th>
                    <th className="py-1.5 px-2 text-right">Fill %</th>
                    <th className="py-1.5 px-2 text-right">Win %</th>
                    <th className="py-1.5 px-2 text-right">Trades</th>
                    <th className="py-1.5 px-2 text-right">Gross</th>
                    <th className="py-1.5 px-2 text-right">Fees</th>
                    <th className="py-1.5 px-2 text-right">Net</th>
                    <th className="py-1.5 px-2 text-right">Expect</th>
                    {cohortDim !== "none" && (
                      <th className="py-1.5 px-2 text-left">Best {COHORT_DIM_LABELS[cohortDim]}</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {[...result.cells]
                    .sort((a, b) => b.net_pnl_usd - a.net_pnl_usd)
                    .map((c, i) => (
                      <tr key={i} className="border-b border-border/40">
                        <td className="py-1 px-2 uppercase">{c.mode}</td>
                        <td className="py-1 px-2 text-right">{(c.entry_depth * 100).toFixed(0)}%</td>
                        <td className="py-1 px-2 text-right">{(c.sl_depth * 100).toFixed(0)}%</td>
                        <td className="py-1 px-2 text-right">{c.triggered}</td>
                        <td className="py-1 px-2 text-right">{c.missed}</td>
                        <td className="py-1 px-2 text-right">{c.fill_rate_pct.toFixed(0)}%</td>
                        <td className="py-1 px-2 text-right">{c.win_rate_pct.toFixed(0)}%</td>
                        <td className="py-1 px-2 text-right">{c.trades}</td>
                        <td className="py-1 px-2 text-right">{c.gross_pnl_usd >= 0 ? "+" : ""}{c.gross_pnl_usd.toFixed(1)}</td>
                        <td className="py-1 px-2 text-right text-muted-foreground">-{c.fees_usd.toFixed(1)}</td>
                        <td className={`py-1 px-2 text-right font-semibold ${cellTone(c.net_pnl_usd)}`}>
                          {c.net_pnl_usd >= 0 ? "+" : ""}{c.net_pnl_usd.toFixed(1)}
                        </td>
                        <td className="py-1 px-2 text-right">{c.expectancy_usd >= 0 ? "+" : ""}{c.expectancy_usd.toFixed(2)}</td>
                        {cohortDim !== "none" && (
                          <td className="py-1 px-2 text-left">
                            {(() => {
                              const buckets = c.cohorts[cohortDim].buckets.filter((b) => b.trades > 0);
                              if (!buckets.length) return <span className="text-muted-foreground">—</span>;
                              const b = buckets.reduce((a, x) => (x.total_pnl_usd > a.total_pnl_usd ? x : a));
                              const t = b.total_pnl_usd > 0 ? "text-emerald-400" : b.total_pnl_usd < 0 ? "text-red-400" : "text-muted-foreground";
                              return (
                                <span className={t}>
                                  <span className="uppercase">{b.bucket}</span>
                                  <span className="text-muted-foreground"> · {b.trades}t · {b.win_rate_pct.toFixed(0)}% · {b.total_pnl_usd >= 0 ? "+" : ""}{b.total_pnl_usd.toFixed(0)}</span>
                                </span>
                              );
                            })()}
                          </td>
                        )}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

