import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { getStrategyState, backtestRange } from "@/lib/strategy.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
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
}

function BacktestLab() {
  const getState = useServerFn(getStrategyState);
  const runRange = useServerFn(backtestRange);
  const settingsQ = useQuery({ queryKey: ["strategy-state"], queryFn: () => getState() });

  const [form, setForm] = useState<FormState | null>(null);
  const [result, setResult] = useState<RangeData | null>(null);

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
        },
      }),
    onSuccess: (r) => {
      setResult(r);
      toast.success(`Backtest done — ${r.summary.tp}W / ${r.summary.sl}L`);
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
                    <Input
                      value={form.symbol}
                      onChange={(e) => set("symbol", e.target.value.toUpperCase())}
                      className="h-8 font-mono text-xs"
                    />
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

            {result && <ResultsView data={result} />}
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

function ResultsView({ data }: { data: RangeData }) {
  const s = data.summary;
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

  const equityChart = useMemo(
    () => data.equity.map((e) => ({ date: e.ist_date, pnl: Number(e.cum_pnl_usd.toFixed(2)) })),
    [data.equity],
  );

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
          <Kv k="total p&l" v={fmtUsd(s.total_pnl_usd)} tone={totalTone} />
          <Kv k="win rate" v={`${s.win_rate_pct.toFixed(1)}%`} tone={s.win_rate_pct >= 50 ? "text-long" : "text-short"} />
          <Kv k="profit factor" v={pfText} tone={pf >= 1 ? "text-long" : "text-short"} />
          <Kv k="expectancy / trade" v={fmtUsd(s.expectancy_usd)} tone={s.expectancy_usd >= 0 ? "text-long" : "text-short"} />
          <Kv k="avg R" v={s.avg_r.toFixed(2)} tone={s.avg_r >= 0 ? "text-long" : "text-short"} />
          <Kv k="avg win / loss" v={`${fmtUsd(s.avg_win_usd)} / ${fmtUsd(-s.avg_loss_usd)}`} />
          <Kv k="max drawdown" v={`-${s.max_drawdown_usd.toFixed(2)}`} tone="text-short" />
          <Kv k="max streak W / L" v={`${s.max_consec_wins} / ${s.max_consec_losses}`} />
          <Kv k="sessions" v={`${s.days_with_session} / ${s.total_days}`} />
          <Kv k="breaks / triggered" v={`${s.breaks} / ${s.triggered}`} />
          <Kv k="wins / losses" v={`${s.tp} / ${s.sl}`} />
          <Kv k="open / skipped" v={`${s.open} / ${s.skipped_days}`} />
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
                    stroke={s.total_pnl_usd >= 0 ? "hsl(var(--long))" : "hsl(var(--short))"}
                    dot={false}
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">By weekday</div>
          <div className="border border-border rounded overflow-hidden">
            <table className="w-full text-[11px]">
              <thead className="text-[10px] uppercase tracking-widest text-muted-foreground bg-muted/60">
                <tr>
                  <th className="text-left px-2 py-1">Day</th>
                  <th className="text-right px-2 py-1">Trades</th>
                  <th className="text-right px-2 py-1">W / L</th>
                  <th className="text-right px-2 py-1">Win %</th>
                  <th className="text-right px-2 py-1">Total $</th>
                  <th className="text-right px-2 py-1">Avg $</th>
                </tr>
              </thead>
              <tbody>
                {data.weekdays.map((w) => {
                  const skipped = data.skip_weekdays.includes(w.weekday);
                  const tone =
                    w.trades === 0
                      ? "text-muted-foreground"
                      : w.total_pnl_usd > 0
                        ? "text-long"
                        : w.total_pnl_usd < 0
                          ? "text-short"
                          : "";
                  return (
                    <tr key={w.weekday} className="border-t border-border">
                      <td className="px-2 py-1">
                        {w.label}
                        {skipped && (
                          <span className="ml-1 text-[9px] uppercase tracking-widest text-muted-foreground">
                            (skipped)
                          </span>
                        )}
                      </td>
                      <td className="text-right px-2 py-1">{w.trades}</td>
                      <td className="text-right px-2 py-1">
                        {w.wins} / {w.losses}
                      </td>
                      <td className="text-right px-2 py-1">
                        {w.trades > 0 ? `${w.win_rate_pct.toFixed(0)}%` : "—"}
                      </td>
                      <td className={`text-right px-2 py-1 ${tone}`}>
                        {w.trades > 0 ? fmtUsd(w.total_pnl_usd) : "—"}
                      </td>
                      <td className={`text-right px-2 py-1 ${tone}`}>
                        {w.trades > 0 ? fmtUsd(w.avg_pnl_usd) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

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
              {data.days
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
