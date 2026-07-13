import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  getStrategyState,
  updateStrategySettings,
  runStrategyTickNow,
  applyOrbWinningPreset,
  cancelTodayArmedSetup,
  flattenSymbol,
} from "@/lib/strategy.functions";
import { getDashboard, updateSettings } from "@/lib/trading.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Play, Sparkles, XCircle, ShieldAlert, Activity, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/bot")({
  component: BotPage,
  head: () => ({
    meta: [
      { title: "ORB Bot — Shark Auto-Trader" },
      { name: "description", content: "Live cockpit for the 05:30 Tokyo Multi-Session ORB automation." },
    ],
  }),
});

type EntryMode = "fib" | "retest" | "market" | "adaptive";

function BotPage() {
  const qc = useQueryClient();
  const getState = useServerFn(getStrategyState);
  const getDash = useServerFn(getDashboard);
  const update = useServerFn(updateStrategySettings);
  const updateGlobal = useServerFn(updateSettings);
  const runTick = useServerFn(runStrategyTickNow);
  const applyPreset = useServerFn(applyOrbWinningPreset);
  const cancelToday = useServerFn(cancelTodayArmedSetup);
  const flatten = useServerFn(flattenSymbol);

  const stateQ = useQuery({
    queryKey: ["bot-state"],
    queryFn: () => getState(),
    refetchInterval: 5000,
  });
  const dashQ = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => getDash(),
    refetchInterval: 10000,
  });

  const settings = stateQ.data?.settings;
  const session = stateQ.data?.session;
  const setups = stateQ.data?.setups ?? [];
  const global = dashQ.data?.settings;
  const positions = dashQ.data?.positions ?? [];
  const logs = dashQ.data?.logs ?? [];
  const metrics = dashQ.data?.metrics;

  const [form, setForm] = useState<{
    enabled: boolean;
    symbol: string;
    session_start_ist: string;
    entry_mode: EntryMode;
    entry_depth_pct: number;
    sl_depth_pct: number;
    adaptive_strong_break_pct: number;
    adaptive_shallow_depth: number;
    adaptive_deep_depth: number;
    retest_sl_r: number;
    rr: number;
    sl_risk_usd: number;
    trail_enabled: boolean;
    trail_activate_r: number;
    trail_step_r: number;
    skip_weekdays: number[];
    fee_usd_per_order: number;
    zone_source: "range" | "breakout";
    data_source: "shark" | "yahoo";
  } | null>(null);

  useEffect(() => {
    if (!settings || form) return;
    const s = settings as unknown as Record<string, unknown>;
    const legacySkip = !!(s.skip_weekends);
    const skipArr = Array.isArray(s.skip_weekdays)
      ? (s.skip_weekdays as unknown[]).map((n) => Number(n))
      : legacySkip
        ? [0]
        : [6];
    setForm({
      enabled: !!settings.enabled,
      symbol: settings.symbol,
      session_start_ist: String(settings.session_start_ist).slice(0, 5),
      entry_mode: (settings.entry_mode as EntryMode) ?? "adaptive",
      entry_depth_pct: Number(settings.entry_depth_pct),
      sl_depth_pct: Number(settings.sl_depth_pct),
      adaptive_strong_break_pct: Number(settings.adaptive_strong_break_pct),
      adaptive_shallow_depth: Number(settings.adaptive_shallow_depth),
      adaptive_deep_depth: Number(settings.adaptive_deep_depth),
      retest_sl_r: Number(settings.retest_sl_r),
      rr: Number(settings.rr),
      sl_risk_usd: Number(settings.sl_risk_usd),
      trail_enabled: !!settings.trail_enabled,
      trail_activate_r: Number(settings.trail_activate_r ?? 2),
      trail_step_r: Number(settings.trail_step_r ?? 1),
      skip_weekdays: skipArr,
      fee_usd_per_order: Number(s.fee_usd_per_order ?? 0),
      zone_source: ((s.zone_source as string) ?? "range") === "breakout" ? "breakout" : "range",
      data_source: ((s.data_source as string) ?? "shark") === "yahoo" ? "yahoo" : "shark",
    });
  }, [settings, form]);


  const saveMut = useMutation({
    mutationFn: (patch: Record<string, unknown>) => update({ data: patch }),
    onSuccess: () => {
      toast.success("Settings saved — engine will re-price on next tick");
      qc.invalidateQueries({ queryKey: ["bot-state"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const presetMut = useMutation({
    mutationFn: () => applyPreset({}),
    onSuccess: () => {
      toast.success("Winning preset applied (05:30 Tokyo · adaptive · RR 2 · $25)");
      setForm(null);
      qc.invalidateQueries({ queryKey: ["bot-state"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const tickMut = useMutation({
    mutationFn: () => runTick({}),
    onSuccess: (r) => {
      toast.success(`Tick: ${(r as { reason?: string }).reason ?? "ok"}`);
      qc.invalidateQueries({ queryKey: ["bot-state"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const cancelMut = useMutation({
    mutationFn: () => cancelToday({}),
    onSuccess: (r) => {
      toast.success(`Cancelled ${(r as { cancelled: number }).cancelled} armed setup(s)`);
      qc.invalidateQueries({ queryKey: ["bot-state"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const flattenMut = useMutation({
    mutationFn: (symbol: string) => flatten({ data: { symbol } }),
    onSuccess: (r) => {
      toast.success((r as { message: string }).message);
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const killMut = useMutation({
    mutationFn: (kill: boolean) => updateGlobal({ data: { kill_switch: kill } }),
    onSuccess: () => {
      toast.success("Kill switch updated");
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-3 sm:p-4 md:space-y-6 md:p-6">
      {/* Header status */}
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" /> ORB Bot — 05:30 Tokyo Multi-Session
            </CardTitle>
            <CardDescription>
              Live automation on SharkExchange. Ticks every minute via cron. Winning preset baked in.
            </CardDescription>
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Badge variant={settings?.enabled ? "default" : "secondary"}>
                {settings?.enabled ? "Enabled" : "Disabled"}
              </Badge>
              <Badge variant={global?.kill_switch ? "destructive" : "outline"}>
                {global?.kill_switch ? "KILL SWITCH ON" : "Kill switch off"}
              </Badge>
              <Badge variant={global?.paper_mode ? "secondary" : "default"}>
                {global?.paper_mode ? "Paper" : "LIVE"}
              </Badge>
              <Badge variant="outline">{settings?.symbol ?? "—"}</Badge>
              <Badge variant="outline">
                Session {String(settings?.session_start_ist ?? "").slice(0, 5)} IST
              </Badge>
              <Badge variant="outline">Mode: {settings?.entry_mode ?? "—"}</Badge>
              <Badge variant="outline">
                RR 1:{Number(settings?.rr ?? 0)} · Risk ${Number(settings?.sl_risk_usd ?? 0)}
              </Badge>
            </div>
          </div>
          <div className="flex flex-row flex-wrap items-center gap-2 sm:flex-col sm:items-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => presetMut.mutate()}
              disabled={presetMut.isPending}
            >
              <Sparkles className="mr-2 h-4 w-4" /> Apply winning preset
            </Button>
            <Button
              size="sm"
              onClick={() => tickMut.mutate()}
              disabled={tickMut.isPending}
            >
              <Play className="mr-2 h-4 w-4" /> Run tick now
            </Button>
            <div className="flex items-center gap-2 pt-1">
              <Label htmlFor="kill" className="text-xs">
                Kill switch
              </Label>
              <Switch
                id="kill"
                checked={!!global?.kill_switch}
                onCheckedChange={(v) => killMut.mutate(v)}
              />
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Today's session */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Today's session zone</CardTitle>
            <CardDescription>
              1-hour candle at session start defines the ORB range.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {session ? (
              <>
                <Row k="IST date" v={session.ist_date} />
                <Row k="Zone high" v={Number(session.zone_high).toFixed(2)} />
                <Row k="Zone low" v={Number(session.zone_low).toFixed(2)} />
                <Row
                  k="Break"
                  v={
                    session.break_side
                      ? `${session.break_side.toUpperCase()} @ ${Number(session.break_close_price).toFixed(2)}`
                      : "waiting…"
                  }
                />
                <Row
                  k="Break detected"
                  v={session.break_detected_at ? new Date(session.break_detected_at).toLocaleString() : "—"}
                />
              </>
            ) : (
              <p className="text-muted-foreground">
                No session yet today. The 05:30 IST 1h candle must close first.
              </p>
            )}
            <div className="pt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => cancelMut.mutate()} disabled={cancelMut.isPending}>
                <XCircle className="mr-2 h-4 w-4" /> Cancel today's armed setup
              </Button>
              {settings?.symbol ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => flattenMut.mutate(settings.symbol)}
                  disabled={flattenMut.isPending}
                >
                  <ShieldAlert className="mr-2 h-4 w-4" /> Flatten {settings.symbol}
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Guardrails · today</CardTitle>
            <CardDescription>Global risk caps from Settings.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-2 sm:gap-x-6">
            <Row k="Max position" v={`$${Number(global?.max_position_usd ?? 0)}`} />
            <Row k="Max open" v={String(global?.max_open_positions ?? 0)} />
            <Row k="Daily loss cap" v={`$${Number(global?.max_daily_loss_usd ?? 0)}`} />
            <Row
              k="Today P&L"
              v={`$${Number(metrics?.todaysPnl ?? 0).toFixed(2)}`}
              tone={Number(metrics?.todaysPnl ?? 0) < 0 ? "danger" : "success"}
            />
            <Row k="Open positions" v={String(positions.length)} />
            <Row
              k="Total P&L"
              v={`$${Number(metrics?.totalPnl ?? 0).toFixed(2)}`}
              tone={Number(metrics?.totalPnl ?? 0) < 0 ? "danger" : "success"}
            />
          </CardContent>
        </Card>
      </div>

      {/* Setups today */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4" /> Recent setups
          </CardTitle>
          <CardDescription>Last 20 across all sessions.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {setups.length === 0 ? (
            <p className="text-sm text-muted-foreground">No setups yet.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="text-left p-1">Date</th>
                  <th className="text-left p-1">Side</th>
                  <th className="text-right p-1">Entry</th>
                  <th className="text-right p-1">SL</th>
                  <th className="text-right p-1">TP</th>
                  <th className="text-right p-1">Qty</th>
                  <th className="text-left p-1">Status</th>
                  <th className="text-right p-1">P&L</th>
                </tr>
              </thead>
              <tbody>
                {setups.map((s) => (
                  <tr key={s.id} className="border-t border-border/50">
                    <td className="p-1">{s.ist_date}</td>
                    <td className="p-1 uppercase">{s.side}</td>
                    <td className="p-1 text-right">{Number(s.entry_price).toFixed(2)}</td>
                    <td className="p-1 text-right">{Number(s.sl_price).toFixed(2)}</td>
                    <td className="p-1 text-right">{Number(s.tp_price).toFixed(2)}</td>
                    <td className="p-1 text-right">{Number(s.qty).toFixed(4)}</td>
                    <td className="p-1">
                      <Badge variant="outline" className="text-[10px]">
                        {s.status}
                      </Badge>
                    </td>
                    <td
                      className={`p-1 text-right ${
                        s.pnl_usd == null
                          ? ""
                          : Number(s.pnl_usd) >= 0
                            ? "text-emerald-500"
                            : "text-rose-500"
                      }`}
                    >
                      {s.pnl_usd == null ? "—" : `$${Number(s.pnl_usd).toFixed(2)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Config form */}
      {form ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bot configuration</CardTitle>
            <CardDescription>
              Changes take effect on the next tick — armed limit orders are re-priced automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-4">
              <Field label="Enabled">
                <Switch
                  checked={form.enabled}
                  onCheckedChange={(v) => setForm({ ...form, enabled: v })}
                />
              </Field>
              <Field label="Symbol">
                <Input
                  value={form.symbol}
                  onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })}
                />
              </Field>
              <Field label="Session start (IST)">
                <Input
                  type="time"
                  value={form.session_start_ist}
                  onChange={(e) => setForm({ ...form, session_start_ist: e.target.value })}
                />
              </Field>
              <Field label="Entry mode">
                <Select
                  value={form.entry_mode}
                  onValueChange={(v) => setForm({ ...form, entry_mode: v as EntryMode })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="adaptive">Adaptive</SelectItem>
                    <SelectItem value="fib">Fib</SelectItem>
                    <SelectItem value="retest">Retest</SelectItem>
                    <SelectItem value="market">Market</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <NumField label="Entry depth %" value={form.entry_depth_pct} step={0.01}
                onChange={(v) => setForm({ ...form, entry_depth_pct: v })} />
              <NumField label="SL depth %" value={form.sl_depth_pct} step={0.05}
                onChange={(v) => setForm({ ...form, sl_depth_pct: v })} />
              <NumField label="RR (1:R)" value={form.rr} step={0.1}
                onChange={(v) => setForm({ ...form, rr: v })} />
              <NumField label="SL risk ($)" value={form.sl_risk_usd} step={1}
                onChange={(v) => setForm({ ...form, sl_risk_usd: v })} />
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <NumField label="Adaptive strong break %" value={form.adaptive_strong_break_pct} step={1}
                onChange={(v) => setForm({ ...form, adaptive_strong_break_pct: v })} />
              <NumField label="Adaptive shallow depth" value={form.adaptive_shallow_depth} step={0.01}
                onChange={(v) => setForm({ ...form, adaptive_shallow_depth: v })} />
              <NumField label="Adaptive deep depth" value={form.adaptive_deep_depth} step={0.01}
                onChange={(v) => setForm({ ...form, adaptive_deep_depth: v })} />
              <NumField label="Retest SL (R)" value={form.retest_sl_r} step={0.1}
                onChange={(v) => setForm({ ...form, retest_sl_r: v })} />
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <Field label="Trailing SL">
                <Switch
                  checked={form.trail_enabled}
                  onCheckedChange={(v) => setForm({ ...form, trail_enabled: v })}
                />
              </Field>
              <NumField label="Trail activate (R)" value={form.trail_activate_r} step={0.1}
                onChange={(v) => setForm({ ...form, trail_activate_r: v })} />
              <NumField label="Trail step (R)" value={form.trail_step_r} step={0.1}
                onChange={(v) => setForm({ ...form, trail_step_r: v })} />
              <NumField label="Fee $ per order (entry & exit)" value={form.fee_usd_per_order} step={0.5}
                onChange={(v) => setForm({ ...form, fee_usd_per_order: v })} />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Candle data source">
                <div className="flex gap-2">
                  {(["shark", "yahoo"] as const).map((v) => (
                    <Button
                      key={v}
                      type="button"
                      size="sm"
                      variant={form.data_source === v ? "default" : "outline"}
                      onClick={() => setForm({ ...form, data_source: v })}
                    >
                      {v === "shark" ? "SHARK (XAUUSDT)" : "YAHOO (GC=F)"}
                    </Button>
                  ))}
                </div>
              </Field>
              <Field label="Fib zone source">
                <div className="flex gap-2">
                  {(["range", "breakout"] as const).map((v) => (
                    <Button
                      key={v}
                      type="button"
                      size="sm"
                      variant={form.zone_source === v ? "default" : "outline"}
                      onClick={() => setForm({ ...form, zone_source: v })}
                    >
                      {v === "range" ? "RANGE CANDLE" : "BREAKOUT CANDLE"}
                    </Button>
                  ))}
                </div>
              </Field>
            </div>

            <Field label="Skip weekdays (highlighted = excluded)">
              <div className="flex flex-wrap gap-2">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, idx) => {
                  const active = form.skip_weekdays.includes(idx);
                  return (
                    <Button
                      key={label}
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const next = active
                          ? form.skip_weekdays.filter((d) => d !== idx)
                          : [...form.skip_weekdays, idx].sort((a, b) => a - b);
                        setForm({ ...form, skip_weekdays: next });
                      }}
                      className={active ? "bg-rose-500/15 border-rose-500 text-rose-500 hover:bg-rose-500/25" : ""}
                    >
                      {label}
                    </Button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Session skipped when its IST date falls on a highlighted weekday. Default: Sat excluded, Sun tradeable.
              </p>
            </Field>


            <div className="flex gap-2 pt-2">
              <Button
                onClick={() => saveMut.mutate(form)}
                disabled={saveMut.isPending}
              >
                Save configuration
              </Button>
              <Button variant="outline" onClick={() => setForm(null)} disabled={saveMut.isPending}>
                Reset from server
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* AI Grade Sizing */}
      <AiGradingCard
        settings={settings as Record<string, unknown> | undefined}
        onSave={(patch) => saveMut.mutate(patch)}
        saving={saveMut.isPending}
      />


      {/* Activity log */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent activity</CardTitle>
          <CardDescription>Last 30 events from the engine and exchange.</CardDescription>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            <ul className="space-y-1 text-xs font-mono">
              {logs.map((l) => (
                <li key={l.id} className="flex gap-2">
                  <span className="text-muted-foreground shrink-0">
                    {new Date(l.created_at).toLocaleTimeString()}
                  </span>
                  <Badge
                    variant={
                      l.severity === "error"
                        ? "destructive"
                        : l.severity === "warn"
                          ? "secondary"
                          : "outline"
                    }
                    className="text-[10px] shrink-0"
                  >
                    {l.severity}
                  </Badge>
                  <span className="truncate">{l.message}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: "success" | "danger" }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{k}</span>
      <span
        className={
          tone === "success"
            ? "text-emerald-500 font-medium"
            : tone === "danger"
              ? "text-rose-500 font-medium"
              : "font-medium"
        }
      >
        {v}
      </span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      <div>{children}</div>
    </div>
  );
}

function NumField({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label}>
      <Input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  );
}
