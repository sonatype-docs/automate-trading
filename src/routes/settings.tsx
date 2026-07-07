import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getDashboard, updateSettings, getWebhookInfo, testExchangeConnection } from "@/lib/trading.functions";
import { getStrategyState, updateStrategySettings } from "@/lib/strategy.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, XCircle } from "lucide-react";


export const Route = createFileRoute("/settings")({
  component: SettingsPage,
  head: () => ({
    meta: [
      { title: "Settings — Shark Auto-Trader" },
      { name: "description", content: "Risk parameters and integration secrets." },
    ],
  }),
});

function SettingsPage() {
  const qc = useQueryClient();
  const getDash = useServerFn(getDashboard);
  const getInfo = useServerFn(getWebhookInfo);
  const update = useServerFn(updateSettings);
  const testConn = useServerFn(testExchangeConnection);

  const dashQ = useQuery({ queryKey: ["dashboard"], queryFn: () => getDash() });
  const infoQ = useQuery({ queryKey: ["webhook-info"], queryFn: () => getInfo() });
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [form, setForm] = useState({
    max_position_usd: 100,
    max_open_positions: 3,
    max_daily_loss_usd: 50,
    paper_starting_equity: 10000,
    allowed_symbols: "",
  });

  useEffect(() => {
    if (dashQ.data?.settings) {
      const s = dashQ.data.settings;
      setForm({
        max_position_usd: Number(s.max_position_usd),
        max_open_positions: Number(s.max_open_positions),
        max_daily_loss_usd: Number(s.max_daily_loss_usd),
        paper_starting_equity: Number(s.paper_starting_equity),
        allowed_symbols: (s.allowed_symbols ?? []).join(", "),
      });
    }
  }, [dashQ.data]);

  const mut = useMutation({
    mutationFn: () =>
      update({
        data: {
          max_position_usd: form.max_position_usd,
          max_open_positions: form.max_open_positions,
          max_daily_loss_usd: form.max_daily_loss_usd,
          paper_starting_equity: form.paper_starting_equity,
          allowed_symbols: form.allowed_symbols
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        },
      }),
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const testMut = useMutation({
    mutationFn: () => testConn(),
    onSuccess: (r) => setTestResult({ ok: r.ok, message: r.message }),
    onError: (e) => setTestResult({ ok: false, message: e.message }),
  });

  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="max-w-4xl mx-auto px-4 md:px-6 h-14 flex items-center">
          <Link to="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" /> Back
            </Button>
          </Link>
          <span className="ml-4 font-mono text-sm tracking-widest">SETTINGS</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 md:px-6 py-6 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Risk parameters</CardTitle>
            <CardDescription>Applied to every incoming signal before it's placed.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Max position size (USD)" value={form.max_position_usd} onChange={(v) => setForm({ ...form, max_position_usd: v })} />
            <Field label="Max open positions" value={form.max_open_positions} onChange={(v) => setForm({ ...form, max_open_positions: v })} />
            <Field label="Max daily loss (USD)" value={form.max_daily_loss_usd} onChange={(v) => setForm({ ...form, max_daily_loss_usd: v })} />
            <Field label="Paper starting equity (USD)" value={form.paper_starting_equity} onChange={(v) => setForm({ ...form, paper_starting_equity: v })} />
            <div className="md:col-span-2 space-y-2">
              <Label className="text-xs">Allowed symbols (comma-separated, empty = all)</Label>
              <Input value={form.allowed_symbols} onChange={(e) => setForm({ ...form, allowed_symbols: e.target.value })} placeholder="BTCUSDT, ETHUSDT" />
            </div>
            <div className="md:col-span-2">
              <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
                {mut.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <StrategySettingsCard />

        <Card>

          <CardHeader>
            <CardTitle>Integration status</CardTitle>
            <CardDescription>Secrets are stored server-side and never shown.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 font-mono text-sm">
            <StatusRow label="TradingView webhook secret" ok={!!infoQ.data?.hasSecret} />
            <StatusRow label="SharkExchange API key + secret" ok={!!infoQ.data?.hasExchangeKey} />
            <div className="pt-3 flex items-center gap-3">
              <Button
                size="sm"
                variant="outline"
                disabled={testMut.isPending}
                onClick={() => {
                  setTestResult(null);
                  testMut.mutate();
                }}
              >
                {testMut.isPending ? "Testing…" : "Test SharkExchange connection"}
              </Button>
              {testResult && (
                <span
                  className={`flex items-center gap-1 text-xs ${testResult.ok ? "text-long" : "text-short"}`}
                >
                  {testResult.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  {testResult.message}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground pt-2">
              Missing SharkExchange keys? Ask the assistant in chat to add them; live mode won't work until they're configured.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs">{label}</Label>
      <Input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-2">
      <span>{label}</span>
      {ok ? (
        <span className="flex items-center gap-1 text-long"><CheckCircle2 className="w-4 h-4" /> configured</span>
      ) : (
        <span className="flex items-center gap-1 text-short"><XCircle className="w-4 h-4" /> missing</span>
      )}
    </div>
  );
}

function StrategySettingsCard() {
  const qc = useQueryClient();
  const getState = useServerFn(getStrategyState);
  const updateStrat = useServerFn(updateStrategySettings);
  const q = useQuery({ queryKey: ["strategy-state"], queryFn: () => getState() });
  const [form, setForm] = useState({
    enabled: false,
    symbol: "XAUUSDT",
    sl_risk_usd: 25,
    rr: 2,
    session_start_ist: "06:00",
  });
  useEffect(() => {
    if (q.data?.settings) {
      const s = q.data.settings;
      setForm({
        enabled: !!s.enabled,
        symbol: s.symbol,
        sl_risk_usd: Number(s.sl_risk_usd),
        rr: Number(s.rr),
        session_start_ist: String(s.session_start_ist).slice(0, 5),
      });
    }
  }, [q.data]);

  const mut = useMutation({
    mutationFn: (patch: Partial<typeof form>) => updateStrat({ data: patch }),
    onSuccess: () => {
      toast.success("Strategy settings saved");
      qc.invalidateQueries({ queryKey: ["strategy-state"] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>XAUUSDT strategy engine</CardTitle>
        <CardDescription>
          IST 5:30 session zone → fib break → auto long @0.25 / short @0.75 with 1:2 TP (customizable).
          Runs on a 5-minute cron. Respects the kill switch.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2 flex items-center justify-between border-b border-border pb-3">
          <div>
            <Label className="text-xs">Engine enabled</Label>
            <p className="text-xs text-muted-foreground mt-1">
              {form.enabled ? "Engine will fire signals on the next tick." : "Engine is idle."}
            </p>
          </div>
          <Switch
            checked={form.enabled}
            onCheckedChange={(v) => {
              setForm({ ...form, enabled: v });
              mut.mutate({ enabled: v });
            }}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Symbol</Label>
          <Input
            value={form.symbol}
            onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Session start (IST, HH:MM)</Label>
          <Input
            value={form.session_start_ist}
            onChange={(e) => setForm({ ...form, session_start_ist: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs">SL risk per trade (USD)</Label>
          <Input
            type="number"
            value={form.sl_risk_usd}
            onChange={(e) => setForm({ ...form, sl_risk_usd: Number(e.target.value) })}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs">R:R multiple (TP)</Label>
          <Input
            type="number"
            step="0.1"
            value={form.rr}
            onChange={(e) => setForm({ ...form, rr: Number(e.target.value) })}
          />
        </div>
        <div className="md:col-span-2">
          <Button
            onClick={() =>
              mut.mutate({
                symbol: form.symbol,
                sl_risk_usd: form.sl_risk_usd,
                rr: form.rr,
                session_start_ist: form.session_start_ist,
              })
            }
            disabled={mut.isPending}
          >
            {mut.isPending ? "Saving…" : "Save strategy settings"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
