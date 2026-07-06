import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getDashboard, updateSettings, getWebhookInfo } from "@/lib/trading.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
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

  const dashQ = useQuery({ queryKey: ["dashboard"], queryFn: () => getDash() });
  const infoQ = useQuery({ queryKey: ["webhook-info"], queryFn: () => getInfo() });

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

        <Card>
          <CardHeader>
            <CardTitle>Integration status</CardTitle>
            <CardDescription>Secrets are stored server-side and never shown.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 font-mono text-sm">
            <StatusRow label="TradingView webhook secret" ok={!!infoQ.data?.hasSecret} />
            <StatusRow label="SharkExchange API key + secret" ok={!!infoQ.data?.hasExchangeKey} />
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
