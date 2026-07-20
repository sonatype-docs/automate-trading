import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { StrategyPageShell, ResultCard } from "@/components/backtest-strategy-shell";
import {
  BREAKOUT_RULES, CONFIRMATION_METHODS, ENTRY_MODELS, SESSIONS,
  STOP_MODELS, SWING_ALGOS, TP_KINDS, ZONE_KINDS,
  defaultLabConfig, pdhPdlPreset,
  type LiquiditySweepConfig,
} from "@/lib/liquidity-lab/config";
import {
  runLiquidityLab, listLabPresets, saveLabPreset,
  deleteLabPreset, duplicateLabPreset, runLiquidityLabMatrix,
  type MatrixRow,
} from "@/lib/liquidity-lab.functions";
import { LAB_SYMBOLS } from "@/lib/liquidity-lab/simulator";
import { TIMEFRAMES, TIMEZONES } from "@/lib/market-data/types";
import { Beaker, Download, Upload, Save, Copy, Trash2, Play, Grid3x3 } from "lucide-react";


type PresetKey = "pdh-pdl" | undefined;

export const Route = createFileRoute("/backtest/liquidity-lab")({
  validateSearch: (s: Record<string, unknown>) => ({
    preset: (s.preset as PresetKey) ?? undefined,
  }),
  component: LabPage,
  head: () => ({
    meta: [
      { title: "Liquidity Sweep Research Lab — Institutional Backtester" },
      { name: "description", content: "Fully configurable liquidity-sweep research lab. Multi-zone, multi-confirmation, multi-leg TP, filters, sessions, presets & optimization." },
      { property: "og:title", content: "Liquidity Sweep Research Lab" },
      { property: "og:description", content: "Discover statistically superior liquidity-sweep variants with a fully-configurable research lab." },
    ],
  }),
});

function LabPage() {
  const search = Route.useSearch();
  const [config, setConfig] = useState<LiquiditySweepConfig>(() =>
    search.preset === "pdh-pdl" ? pdhPdlPreset() : defaultLabConfig(),
  );
  const [presetName, setPresetName] = useState("");
  const qc = useQueryClient();

  const run = useServerFn(runLiquidityLab);
  const list = useServerFn(listLabPresets);
  const save = useServerFn(saveLabPreset);
  const del = useServerFn(deleteLabPreset);
  const dup = useServerFn(duplicateLabPreset);

  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuthed(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setAuthed(!!s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const presets = useQuery({
    queryKey: ["lab-presets"],
    queryFn: () => list(),
    staleTime: 30_000,
    enabled: authed,
  });

  const runMut = useMutation({
    mutationFn: () => run({ data: { config } }),
    onSuccess: (r) => {
      const s = r.labStats;
      toast.success(`${s.trades} trades · WR ${s.winRate.toFixed(1)}% · PF ${s.profitFactor.toFixed(2)} · P&L $${s.totalPnlUsd.toFixed(0)}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveMut = useMutation({
    mutationFn: (name: string) => save({ data: { name, config } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["lab-presets"] }); toast.success("Preset saved"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["lab-presets"] }); toast.success("Preset deleted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const dupMut = useMutation({
    mutationFn: (id: string) => dup({ data: { id, newName: `${config.name} copy` } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["lab-presets"] }); toast.success("Preset duplicated"); },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Matrix sweep state ──
  const runMatrix = useServerFn(runLiquidityLabMatrix);
  const [mxSymbols, setMxSymbols] = useState<string[]>(["XAUUSDT", "BTCUSDT", "ETHUSDT"]);
  const [mxTfs, setMxTfs] = useState<string[]>(["5m", "15m", "1h"]);
  const [mxZoneMode, setMxZoneMode] = useState<"each" | "combined">("each");
  const [mxZones, setMxZones] = useState<string[]>(["PDH", "PDL", "PWH", "PWL"]);
  const [mxSort, setMxSort] = useState<"pnl" | "pf" | "wr" | "trades" | "expectancy">("pf");

  const matrixMut = useMutation({
    mutationFn: () => {
      const zoneSets = mxZoneMode === "each"
        ? mxZones.map((z) => [z])
        : [mxZones];
      const total = mxSymbols.length * mxTfs.length * zoneSets.length;
      if (total > 300) throw new Error(`Too many combos (${total}). Cap is 300 — narrow selection.`);
      return runMatrix({ data: {
        baseConfig: config,
        symbols: mxSymbols,
        timeframes: mxTfs as never,
        zoneSets: zoneSets as never,
      }});
    },
    onSuccess: (r) => toast.success(`Matrix: ${r.rows.length} runs in ${(r.totalMs/1000).toFixed(1)}s`),
    onError: (e: Error) => toast.error(e.message),
  });

  const sortedMatrix: MatrixRow[] = useMemo(() => {
    if (!matrixMut.data) return [];
    const rows = [...matrixMut.data.rows];
    rows.sort((a, b) => {
      const av = a.stats, bv = b.stats;
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      switch (mxSort) {
        case "pnl": return bv.totalPnlUsd - av.totalPnlUsd;
        case "pf": return bv.profitFactor - av.profitFactor;
        case "wr": return bv.winRate - av.winRate;
        case "trades": return bv.trades - av.trades;
        case "expectancy": return bv.expectancyR - av.expectancyR;
      }
    });
    return rows;
  }, [matrixMut.data, mxSort]);


  const update = <K extends keyof LiquiditySweepConfig>(k: K, v: LiquiditySweepConfig[K]) =>
    setConfig((c) => ({ ...c, [k]: v }));

  const updateNested = <K extends keyof LiquiditySweepConfig>(
    k: K, patch: Partial<LiquiditySweepConfig[K]>,
  ) => setConfig((c) => ({ ...c, [k]: { ...(c[k] as object), ...patch } as LiquiditySweepConfig[K] }));

  const exportPreset = () => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${config.name.replace(/\s+/g, "_")}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const importPreset = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(String(e.target?.result ?? "{}"));
        setConfig({ ...defaultLabConfig(), ...parsed });
        toast.success("Preset imported");
      } catch { toast.error("Invalid JSON"); }
    };
    reader.readAsText(file);
  };

  const data = runMut.data;
  const rejects = useMemo(
    () => data ? Object.entries(data.result.stats.filterRejects).sort((a, b) => b[1] - a[1]) : [],
    [data],
  );

  return (
    <StrategyPageShell
      title="Liquidity Sweep Research Lab"
      subtitle="Institutional liquidity-sweep research · multi-zone, multi-confirmation, multi-leg targets · fully configurable"
    >
      {/* Toolbar */}
      <ResultCard title="Preset & Actions">
        <div className="flex flex-wrap items-center gap-2">
          <Input value={config.name}
            onChange={(e) => update("name", e.target.value)}
            className="h-8 max-w-xs font-mono text-xs" placeholder="Preset name" />
          <Button size="sm" onClick={() => saveMut.mutate(config.name)} disabled={saveMut.isPending}>
            <Save className="w-3.5 h-3.5 mr-1" /> Save
          </Button>
          <Button size="sm" variant="outline" onClick={exportPreset}>
            <Download className="w-3.5 h-3.5 mr-1" /> Export
          </Button>
          <label className="inline-flex">
            <Button size="sm" variant="outline" asChild>
              <span><Upload className="w-3.5 h-3.5 mr-1" /> Import</span>
            </Button>
            <input type="file" accept="application/json" className="hidden"
              onChange={(e) => e.target.files?.[0] && importPreset(e.target.files[0])} />
          </label>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" onClick={() => runMut.mutate()} disabled={runMut.isPending}>
              <Play className="w-3.5 h-3.5 mr-1" /> {runMut.isPending ? "Running…" : "Run backtest"}
            </Button>
          </div>
        </div>

        {presets.data && presets.data.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {presets.data.map((p) => (
              <div key={p.id} className="flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[11px]">
                <button className="font-mono hover:underline"
                  onClick={() => { setConfig({ ...defaultLabConfig(), ...(p.config as object) }); toast.success(`Loaded "${p.name}"`); }}>
                  {p.name}
                </button>
                <button className="text-muted-foreground hover:text-foreground" onClick={() => dupMut.mutate(p.id)} title="Duplicate">
                  <Copy className="w-3 h-3" />
                </button>
                <button className="text-muted-foreground hover:text-red-500" onClick={() => delMut.mutate(p.id)} title="Delete">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </ResultCard>

      {/* Matrix sweep */}
      <ResultCard title={<><Grid3x3 className="w-4 h-4 inline mr-1" /> Matrix Sweep — Symbols × Timeframes × Zones</>}>
        <div className="space-y-3">
          <ChipsMultiLabeled title="Symbols" values={mxSymbols} options={LAB_SYMBOLS as unknown as string[]} onChange={setMxSymbols} />
          <ChipsMultiLabeled title="Timeframes" values={mxTfs} options={TIMEFRAMES as unknown as string[]} onChange={setMxTfs} />
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Zones</div>
              <div className="flex items-center gap-2 text-[10px] font-mono">
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="radio" checked={mxZoneMode === "each"} onChange={() => setMxZoneMode("each")} />
                  Each zone alone
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="radio" checked={mxZoneMode === "combined"} onChange={() => setMxZoneMode("combined")} />
                  Combined (one run, all zones)
                </label>
              </div>
            </div>
            <ChipsMulti values={mxZones} options={ZONE_KINDS as unknown as string[]} onChange={setMxZones} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">
              {mxSymbols.length} × {mxTfs.length} × {mxZoneMode === "each" ? mxZones.length : 1} = {mxSymbols.length * mxTfs.length * (mxZoneMode === "each" ? mxZones.length : 1)} combos
            </Badge>
            <Button size="sm" onClick={() => matrixMut.mutate()} disabled={matrixMut.isPending || !mxSymbols.length || !mxTfs.length || !mxZones.length}>
              <Play className="w-3.5 h-3.5 mr-1" /> {matrixMut.isPending ? "Running matrix…" : "Run matrix"}
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Sort</Label>
              <select value={mxSort} onChange={(e) => setMxSort(e.target.value as typeof mxSort)} className={selCls + " max-w-[140px]"}>
                <option value="pf">Profit factor</option>
                <option value="pnl">Total P&L</option>
                <option value="wr">Win rate</option>
                <option value="trades">Trades</option>
                <option value="expectancy">Expectancy (R)</option>
              </select>
            </div>
          </div>

          {matrixMut.data && (
            <div className="overflow-x-auto max-h-[420px] border border-border/50 rounded-md">
              <table className="w-full text-[11px] font-mono">
                <thead className="sticky top-0 bg-background">
                  <tr className="text-left border-b text-muted-foreground">
                    <th className="py-1 px-2">#</th>
                    <th className="py-1 px-2">Symbol</th>
                    <th className="py-1 px-2">TF</th>
                    <th className="py-1 px-2">Zones</th>
                    <th className="py-1 px-2 text-right">Trades</th>
                    <th className="py-1 px-2 text-right">Win %</th>
                    <th className="py-1 px-2 text-right">PF</th>
                    <th className="py-1 px-2 text-right">Exp (R)</th>
                    <th className="py-1 px-2 text-right">P&L $</th>
                    <th className="py-1 px-2 text-right">Max DD</th>
                    <th className="py-1 px-2 text-right">Signals</th>
                    <th className="py-1 px-2">Load</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedMatrix.map((r, i) => (
                    <tr key={i} className={`border-b border-border/30 ${r.ok ? "" : "opacity-50"}`}>
                      <td className="py-1 px-2 text-muted-foreground">{i + 1}</td>
                      <td className="py-1 px-2">{r.symbol}</td>
                      <td className="py-1 px-2">{r.timeframe}</td>
                      <td className="py-1 px-2 text-[10px]">{r.zones.join("+")}</td>
                      <td className="py-1 px-2 text-right">{r.stats?.trades ?? 0}</td>
                      <td className="py-1 px-2 text-right">{r.stats ? r.stats.winRate.toFixed(1) : "—"}</td>
                      <td className="py-1 px-2 text-right">{r.stats ? (r.stats.profitFactor === 999 ? "∞" : r.stats.profitFactor.toFixed(2)) : "—"}</td>
                      <td className="py-1 px-2 text-right">{r.stats ? r.stats.expectancyR.toFixed(2) : "—"}</td>
                      <td className={`py-1 px-2 text-right ${r.stats && r.stats.totalPnlUsd > 0 ? "text-emerald-500" : r.stats && r.stats.totalPnlUsd < 0 ? "text-red-500" : ""}`}>
                        {r.stats ? r.stats.totalPnlUsd.toFixed(0) : (r.error ?? "—")}
                      </td>
                      <td className="py-1 px-2 text-right">{r.stats ? r.stats.maxDrawdownUsd.toFixed(0) : "—"}</td>
                      <td className="py-1 px-2 text-right text-muted-foreground">{r.signals}</td>
                      <td className="py-1 px-2">
                        {r.ok && (
                          <button className="text-primary hover:underline text-[10px]"
                            onClick={() => {
                              setConfig((c) => ({ ...c, symbol: r.symbol, entryTimeframe: r.timeframe as never, zones: r.zones as never }));
                              toast.success(`Loaded ${r.symbol} ${r.timeframe} ${r.zones.join("+")} into config`);
                            }}>Load</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </ResultCard>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">

        {/* Left: config */}
        <ResultCard title="Configuration">
          <Accordion type="multiple" defaultValue={["data", "zones", "breakout", "entry"]} className="w-full">
            {/* Data */}
            <Section id="data" title="Data & Direction">
              <Grid>
                <Field label="Symbol">
                  <select value={config.symbol} onChange={(e) => update("symbol", e.target.value)} className={selCls}>
                    {LAB_SYMBOLS.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </Field>

                <Field label="Source">
                  <select value={config.source} onChange={(e) => update("source", e.target.value as typeof config.source)} className={selCls}>
                    <option value="yahoo">Yahoo</option><option value="shark">Shark</option>
                  </select>
                </Field>
                <Field label="Entry timeframe">
                  <select value={config.entryTimeframe} onChange={(e) => update("entryTimeframe", e.target.value)} className={selCls}>
                    {TIMEFRAMES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label="Days back">
                  <Input type="number" value={config.daysBack}
                    onChange={(e) => update("daysBack", Math.max(7, Math.min(720, Number(e.target.value) || 60)))}
                    className={inpCls} />
                </Field>
                <Field label="Strategy TZ">
                  <select value={config.strategyTimezone} onChange={(e) => update("strategyTimezone", e.target.value)} className={selCls}>
                    {TIMEZONES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label="Direction">
                  <select value={config.direction} onChange={(e) => update("direction", e.target.value as typeof config.direction)} className={selCls}>
                    <option value="both">Both</option><option value="long">Long only</option><option value="short">Short only</option>
                  </select>
                </Field>
              </Grid>
            </Section>

            {/* Zones */}
            <Section id="zones" title="Liquidity Zones (multi-select)">
              <ChipsMulti values={config.zones as string[]} options={ZONE_KINDS as unknown as string[]}
                onChange={(v) => update("zones", v as LiquiditySweepConfig["zones"])} />
              <p className="mt-2 text-[10px] text-muted-foreground">Engine currently anchors on PDH/PDL; other zones are preserved for optimization sweeps and future engine extensions.</p>
            </Section>

            {/* Breakout */}
            <Section id="breakout" title="Breakout Rule">
              <Grid>
                <Field label="Rule">
                  <select value={config.breakout.rule}
                    onChange={(e) => updateNested("breakout", { rule: e.target.value as typeof config.breakout.rule })}
                    className={selCls}>
                    {BREAKOUT_RULES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </Field>
                <Field label="Min distance %">
                  <Input type="number" step="0.01" value={config.breakout.minDistancePct}
                    onChange={(e) => updateNested("breakout", { minDistancePct: Number(e.target.value) || 0 })} className={inpCls} />
                </Field>
                <Field label="Body %">
                  <Input type="number" value={config.breakout.bodyPct}
                    onChange={(e) => updateNested("breakout", { bodyPct: Number(e.target.value) || 0 })} className={inpCls} />
                </Field>
                <Field label="ATR mult">
                  <Input type="number" step="0.1" value={config.breakout.atrMult}
                    onChange={(e) => updateNested("breakout", { atrMult: Number(e.target.value) || 0 })} className={inpCls} />
                </Field>
                <Field label="Ticks">
                  <Input type="number" value={config.breakout.ticks}
                    onChange={(e) => updateNested("breakout", { ticks: Number(e.target.value) || 0 })} className={inpCls} />
                </Field>
              </Grid>
            </Section>

            {/* Confirmation */}
            <Section id="confirmation" title="Confirmation Stack">
              <ChipsMulti values={config.confirmation.methods as string[]} options={CONFIRMATION_METHODS as unknown as string[]}
                onChange={(v) => updateNested("confirmation", { methods: v as LiquiditySweepConfig["confirmation"]["methods"] })} />
              <Grid>
                <Field label="Lookback (bars)">
                  <Input type="number" value={config.confirmation.lookback}
                    onChange={(e) => updateNested("confirmation", { lookback: Math.max(1, Number(e.target.value) || 1) })} className={inpCls} />
                </Field>
                <Field label="Require close">
                  <select value={config.confirmation.requireClose ? "y" : "n"}
                    onChange={(e) => updateNested("confirmation", { requireClose: e.target.value === "y" })} className={selCls}>
                    <option value="y">Yes</option><option value="n">No</option>
                  </select>
                </Field>
                <Field label="Min body %">
                  <Input type="number" value={config.confirmation.minBodyPct}
                    onChange={(e) => updateNested("confirmation", { minBodyPct: Number(e.target.value) || 0 })} className={inpCls} />
                </Field>
              </Grid>
            </Section>

            {/* Entry */}
            <Section id="entry" title="Entry Model">
              <Grid>
                <Field label="Model">
                  <select value={config.entry.kind}
                    onChange={(e) => updateNested("entry", { kind: e.target.value as typeof config.entry.kind })} className={selCls}>
                    {ENTRY_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </Field>
                <Field label="Pullback %">
                  <Input type="number" step="0.01" value={config.entry.pullbackPct}
                    onChange={(e) => updateNested("entry", { pullbackPct: Number(e.target.value) || 0 })} className={inpCls} />
                </Field>
                <Field label="Offset pts">
                  <Input type="number" value={config.entry.offsetPts}
                    onChange={(e) => updateNested("entry", { offsetPts: Number(e.target.value) || 0 })} className={inpCls} />
                </Field>
                <Field label="Offset %">
                  <Input type="number" step="0.01" value={config.entry.offsetPct}
                    onChange={(e) => updateNested("entry", { offsetPct: Number(e.target.value) || 0 })} className={inpCls} />
                </Field>
                <Field label="Expiry (bars)">
                  <Input type="number" value={config.entry.expiryBars}
                    onChange={(e) => updateNested("entry", { expiryBars: Math.max(1, Number(e.target.value) || 3) })} className={inpCls} />
                </Field>
                <Field label="Delay (bars)">
                  <Input type="number" value={config.entry.delayBars}
                    onChange={(e) => updateNested("entry", { delayBars: Math.max(0, Number(e.target.value) || 0) })} className={inpCls} />
                </Field>
              </Grid>
            </Section>

            {/* Stop */}
            <Section id="stop" title="Stop Loss">
              <Grid>
                <Field label="Model">
                  <select value={config.stop.kind}
                    onChange={(e) => updateNested("stop", { kind: e.target.value as typeof config.stop.kind })} className={selCls}>
                    {STOP_MODELS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="ATR mult">
                  <Input type="number" step="0.1" value={config.stop.atrMult}
                    onChange={(e) => updateNested("stop", { atrMult: Number(e.target.value) || 0 })} className={inpCls} />
                </Field>
                <Field label="Fixed pts">
                  <Input type="number" value={config.stop.fixedPts}
                    onChange={(e) => updateNested("stop", { fixedPts: Number(e.target.value) || 0 })} className={inpCls} />
                </Field>
                <Field label="Fixed %">
                  <Input type="number" step="0.01" value={config.stop.fixedPct}
                    onChange={(e) => updateNested("stop", { fixedPct: Number(e.target.value) || 0 })} className={inpCls} />
                </Field>
                <Field label="Buffer %">
                  <Input type="number" step="0.01" value={config.stop.bufferPct}
                    onChange={(e) => updateNested("stop", { bufferPct: Number(e.target.value) || 0 })} className={inpCls} />
                </Field>
              </Grid>
            </Section>

            {/* Targets */}
            <Section id="targets" title="Take Profit Legs">
              <div className="space-y-2">
                {config.targets.legs.map((leg, i) => (
                  <div key={i} className="flex flex-wrap items-end gap-2 rounded border border-border/60 p-2">
                    <Field label={`Leg ${i + 1} kind`}>
                      <select value={leg.kind} onChange={(e) => {
                        const legs = [...config.targets.legs]; legs[i] = { ...leg, kind: e.target.value as typeof leg.kind };
                        updateNested("targets", { legs });
                      }} className={selCls}>{TP_KINDS.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                    </Field>
                    <Field label="Value / RR">
                      <Input type="number" step="0.1" value={leg.value} onChange={(e) => {
                        const legs = [...config.targets.legs]; legs[i] = { ...leg, value: Number(e.target.value) || 0 };
                        updateNested("targets", { legs });
                      }} className={inpCls} />
                    </Field>
                    <Field label="Size %">
                      <Input type="number" value={leg.sizePct} onChange={(e) => {
                        const legs = [...config.targets.legs]; legs[i] = { ...leg, sizePct: Number(e.target.value) || 0 };
                        updateNested("targets", { legs });
                      }} className={inpCls} />
                    </Field>
                    <Button size="sm" variant="ghost" onClick={() => {
                      updateNested("targets", { legs: config.targets.legs.filter((_, j) => j !== i) });
                    }}>Remove</Button>
                  </div>
                ))}
                <Button size="sm" variant="outline" onClick={() =>
                  updateNested("targets", { legs: [...config.targets.legs, { kind: "rr", value: 2, sizePct: 25 }] })}>
                  Add leg
                </Button>
                <Grid>
                  <Field label="BE @ R">
                    <Input type="number" step="0.1" value={config.targets.moveToBreakEvenAtR ?? 0}
                      onChange={(e) => updateNested("targets", { moveToBreakEvenAtR: Number(e.target.value) || null })} className={inpCls} />
                  </Field>
                  <Field label="Trail after R">
                    <Input type="number" step="0.1" value={config.targets.trailAfterR ?? 0}
                      onChange={(e) => updateNested("targets", { trailAfterR: Number(e.target.value) || null })} className={inpCls} />
                  </Field>
                  <Field label="Trail step R">
                    <Input type="number" step="0.1" value={config.targets.trailStepR}
                      onChange={(e) => updateNested("targets", { trailStepR: Number(e.target.value) || 0 })} className={inpCls} />
                  </Field>
                </Grid>
              </div>
            </Section>

            {/* Swing */}
            <Section id="swing" title="Swing Detection">
              <Grid>
                <Field label="Algorithm">
                  <select value={config.swing.algorithm}
                    onChange={(e) => updateNested("swing", { algorithm: e.target.value as typeof config.swing.algorithm })} className={selCls}>
                    {SWING_ALGOS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </Field>
                <Field label="Pivot length">
                  <Input type="number" value={config.swing.pivotLen}
                    onChange={(e) => updateNested("swing", { pivotLen: Math.max(2, Number(e.target.value) || 5) })} className={inpCls} />
                </Field>
                <Field label="Swing length">
                  <Input type="number" value={config.swing.swingLen}
                    onChange={(e) => updateNested("swing", { swingLen: Math.max(2, Number(e.target.value) || 10) })} className={inpCls} />
                </Field>
                <Field label="Internal swings">
                  <select value={config.swing.internalSwings ? "y" : "n"}
                    onChange={(e) => updateNested("swing", { internalSwings: e.target.value === "y" })} className={selCls}>
                    <option value="y">On</option><option value="n">Off</option>
                  </select>
                </Field>
              </Grid>
            </Section>

            {/* Attempts */}
            <Section id="attempts" title="Attempts per Setup">
              <Grid>
                <Field label="Max attempts">
                  <select value={String(config.attempts.max)}
                    onChange={(e) => updateNested("attempts", { max: Number(e.target.value) as 1 | 2 | 3 | -1 })} className={selCls}>
                    <option value="1">1</option><option value="2">2</option>
                    <option value="3">3</option><option value="-1">Unlimited</option>
                  </select>
                </Field>
                <Field label="Mode">
                  <select value={config.attempts.mode}
                    onChange={(e) => updateNested("attempts", { mode: e.target.value as typeof config.attempts.mode })} className={selCls}>
                    <option value="fresh_breakout">Fresh breakout only</option>
                    <option value="new_confirmation">New confirmation candle</option>
                  </select>
                </Field>
              </Grid>
            </Section>

            {/* Filters */}
            <Section id="filters" title="Filters">
              <div className="space-y-2">
                <FilterToggle label="EMA" enabled={config.filters.ema.enabled}
                  onToggle={(v) => updateNested("filters", { ema: { ...config.filters.ema, enabled: v } })}>
                  <Input className={inpCls} value={config.filters.ema.periods.join(",")}
                    onChange={(e) => updateNested("filters", { ema: { ...config.filters.ema, periods: e.target.value.split(",").map(n => Number(n.trim())).filter(Boolean) } })} />
                  <select value={config.filters.ema.side}
                    onChange={(e) => updateNested("filters", { ema: { ...config.filters.ema, side: e.target.value as "above" | "below" } })} className={selCls}>
                    <option>above</option><option>below</option>
                  </select>
                </FilterToggle>
                <FilterToggle label="VWAP" enabled={config.filters.vwap.enabled}
                  onToggle={(v) => updateNested("filters", { vwap: { ...config.filters.vwap, enabled: v } })}>
                  <select value={config.filters.vwap.side}
                    onChange={(e) => updateNested("filters", { vwap: { ...config.filters.vwap, side: e.target.value as "above" | "below" } })} className={selCls}>
                    <option>above</option><option>below</option>
                  </select>
                </FilterToggle>
                <FilterToggle label="ADX" enabled={config.filters.adx.enabled}
                  onToggle={(v) => updateNested("filters", { adx: { ...config.filters.adx, enabled: v } })}>
                  <Input type="number" className={inpCls} value={config.filters.adx.min}
                    onChange={(e) => updateNested("filters", { adx: { ...config.filters.adx, min: Number(e.target.value) || 0 } })} />
                  <Input type="number" className={inpCls} value={config.filters.adx.max}
                    onChange={(e) => updateNested("filters", { adx: { ...config.filters.adx, max: Number(e.target.value) || 0 } })} />
                </FilterToggle>
                <FilterToggle label="ATR percentile" enabled={config.filters.atr.enabled}
                  onToggle={(v) => updateNested("filters", { atr: { ...config.filters.atr, enabled: v } })}>
                  <Input type="number" className={inpCls} value={config.filters.atr.minPercentile}
                    onChange={(e) => updateNested("filters", { atr: { ...config.filters.atr, minPercentile: Number(e.target.value) || 0 } })} />
                  <Input type="number" className={inpCls} value={config.filters.atr.maxPercentile}
                    onChange={(e) => updateNested("filters", { atr: { ...config.filters.atr, maxPercentile: Number(e.target.value) || 0 } })} />
                </FilterToggle>
                <FilterToggle label="Volume mult" enabled={config.filters.volume.enabled}
                  onToggle={(v) => updateNested("filters", { volume: { ...config.filters.volume, enabled: v } })}>
                  <Input type="number" step="0.1" className={inpCls} value={config.filters.volume.minMult}
                    onChange={(e) => updateNested("filters", { volume: { ...config.filters.volume, minMult: Number(e.target.value) || 0 } })} />
                </FilterToggle>
                <FilterToggle label="HTF trend" enabled={config.filters.htfTrend.enabled}
                  onToggle={(v) => updateNested("filters", { htfTrend: { ...config.filters.htfTrend, enabled: v } })}>
                  <select value={config.filters.htfTrend.bias}
                    onChange={(e) => updateNested("filters", { htfTrend: { ...config.filters.htfTrend, bias: e.target.value as "bull" | "bear" } })} className={selCls}>
                    <option>bull</option><option>bear</option>
                  </select>
                </FilterToggle>
              </div>
            </Section>

            {/* Sessions */}
            <Section id="sessions" title="Sessions">
              <ChipsMulti values={config.session.allowed as string[]} options={SESSIONS as unknown as string[]}
                onChange={(v) => updateNested("session", { allowed: v as LiquiditySweepConfig["session"]["allowed"] })} />
              <Grid>
                <Field label="Block weekend">
                  <select value={config.session.blockWeekend ? "y" : "n"}
                    onChange={(e) => updateNested("session", { blockWeekend: e.target.value === "y" })} className={selCls}>
                    <option value="y">Yes</option><option value="n">No</option>
                  </select>
                </Field>
                <Field label="Weekdays (0=Sun)">
                  <Input className={inpCls} value={config.session.weekdays.join(",")}
                    onChange={(e) => updateNested("session", { weekdays: e.target.value.split(",").map((n) => Number(n.trim())).filter((n) => n >= 0 && n <= 6) })} />
                </Field>
                <Field label="Hours of day">
                  <Input className={inpCls} placeholder="e.g. 8,9,10,13,14" value={config.session.hoursOfDay.join(",")}
                    onChange={(e) => updateNested("session", { hoursOfDay: e.target.value.split(",").map((n) => Number(n.trim())).filter((n) => n >= 0 && n <= 23) })} />
                </Field>
              </Grid>
            </Section>

            {/* Risk */}
            <Section id="risk" title="Risk">
              <Grid>
                <Field label="Risk $ / trade">
                  <Input type="number" value={config.riskUsd}
                    onChange={(e) => update("riskUsd", Math.max(1, Number(e.target.value) || 10))} className={inpCls} />
                </Field>
                <Field label="Max daily trades">
                  <Input type="number" value={config.maxDailyTrades}
                    onChange={(e) => update("maxDailyTrades", Math.max(1, Number(e.target.value) || 2))} className={inpCls} />
                </Field>
              </Grid>
            </Section>
          </Accordion>
        </ResultCard>

        {/* Right: results */}
        <div className="space-y-4">
          <ResultCard title="Results">
            {!data ? (
              <div className="p-8 text-center text-xs text-muted-foreground font-mono">
                <Beaker className="w-8 h-8 mx-auto mb-2 opacity-40" />
                Configure and click <strong>Run backtest</strong>.
              </div>
            ) : (
              <Tabs defaultValue="stats" className="w-full">
                <TabsList>
                  <TabsTrigger value="stats">Stats</TabsTrigger>
                  <TabsTrigger value="trades">Trades ({data.trades.length})</TabsTrigger>
                  <TabsTrigger value="signals">Signals ({data.result.signals.length})</TabsTrigger>
                  <TabsTrigger value="rejects">Filter rejects</TabsTrigger>
                  <TabsTrigger value="config">Effective config</TabsTrigger>
                </TabsList>
                <TabsContent value="stats">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Stat label="Trades" value={data.labStats.trades.toLocaleString()} />
                    <Stat label="Win rate" value={`${data.labStats.winRate.toFixed(1)}%`} />
                    <Stat label="Profit factor" value={data.labStats.profitFactor === 999 ? "∞" : data.labStats.profitFactor.toFixed(2)} />
                    <Stat label="Total P&L" value={`$${data.labStats.totalPnlUsd.toFixed(2)}`} />
                    <Stat label="Wins" value={data.labStats.wins.toLocaleString()} />
                    <Stat label="Losses" value={data.labStats.losses.toLocaleString()} />
                    <Stat label="Open" value={data.labStats.open.toLocaleString()} />
                    <Stat label="Expectancy (R)" value={data.labStats.expectancyR.toFixed(3)} />
                    <Stat label="Avg planned R:R" value={data.labStats.avgRR.toFixed(2)} />
                    <Stat label="Avg win (R)" value={data.labStats.avgWinR.toFixed(2)} />
                    <Stat label="Avg loss (R)" value={data.labStats.avgLossR.toFixed(2)} />
                    <Stat label="Max drawdown" value={`$${data.labStats.maxDrawdownUsd.toFixed(2)}`} />
                    <Stat label="Gross win" value={`$${data.labStats.grossWinUsd.toFixed(2)}`} />
                    <Stat label="Gross loss" value={`$${data.labStats.grossLossUsd.toFixed(2)}`} />
                    <Stat label={`Longs (${data.labStats.longs})`} value={`${data.labStats.longWinRate.toFixed(1)}% WR`} />
                    <Stat label={`Shorts (${data.labStats.shorts})`} value={`${data.labStats.shortWinRate.toFixed(1)}% WR`} />
                    <Stat label="Setups detected" value={data.result.stats.setupsDetected.toLocaleString()} />
                    <Stat label="Signals" value={data.result.stats.signalsCreated.toLocaleString()} />
                    <Stat label="Invalidated" value={data.result.stats.signalsInvalidated.toLocaleString()} />
                    <Stat label="Bars processed" value={data.barsIn.toLocaleString()} />
                  </div>
                </TabsContent>
                <TabsContent value="trades">
                  <div className="overflow-x-auto max-h-[500px]">
                    <table className="w-full text-[11px] font-mono">
                      <thead className="sticky top-0 bg-background">
                        <tr className="text-left border-b text-muted-foreground">
                          <th className="py-1 pr-3">Entry time</th>
                          <th className="py-1 pr-3">Dir</th>
                          <th className="py-1 pr-3">Entry</th>
                          <th className="py-1 pr-3">SL</th>
                          <th className="py-1 pr-3">TP</th>
                          <th className="py-1 pr-3">Outcome</th>
                          <th className="py-1 pr-3">R</th>
                          <th className="py-1 pr-3">P&L $</th>
                          <th className="py-1 pr-3">Bars</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...data.trades].reverse().slice(0, 500).map((t, i) => (
                          <tr key={i} className="border-b border-border/30">
                            <td className="py-1 pr-3">{new Date(t.ts).toISOString().replace("T", " ").slice(0, 16)}</td>
                            <td className={`py-1 pr-3 ${t.direction === "long" ? "text-emerald-500" : "text-red-500"}`}>{t.direction}</td>
                            <td className="py-1 pr-3">{t.entry.toFixed(2)}</td>
                            <td className="py-1 pr-3">{t.stop.toFixed(2)}</td>
                            <td className="py-1 pr-3">{t.target.toFixed(2)}</td>
                            <td className={`py-1 pr-3 ${t.outcome === "win" ? "text-emerald-500" : t.outcome === "loss" ? "text-red-500" : "text-muted-foreground"}`}>{t.outcome}</td>
                            <td className="py-1 pr-3">{t.rMultiple.toFixed(2)}</td>
                            <td className={`py-1 pr-3 ${t.pnlUsd > 0 ? "text-emerald-500" : t.pnlUsd < 0 ? "text-red-500" : ""}`}>{t.pnlUsd.toFixed(2)}</td>
                            <td className="py-1 pr-3">{t.barsHeld}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </TabsContent>
                <TabsContent value="signals">
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px] font-mono">
                      <thead>
                        <tr className="text-left border-b text-muted-foreground">
                          <th className="py-1 pr-3">Time</th><th className="py-1 pr-3">Dir</th>
                          <th className="py-1 pr-3">Entry</th><th className="py-1 pr-3">SL</th>
                          <th className="py-1 pr-3">TP</th><th className="py-1 pr-3">RR</th>
                          <th className="py-1 pr-3">Strength</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.result.signals.slice(-200).reverse().map((s, i) => (
                          <tr key={i} className="border-b border-border/30">
                            <td className="py-1 pr-3">{new Date(s.timestamp).toISOString().replace("T", " ").slice(0, 16)}</td>
                            <td className={`py-1 pr-3 ${s.direction === "long" ? "text-emerald-500" : "text-red-500"}`}>{s.direction}</td>
                            <td className="py-1 pr-3">{s.entryPrice.toFixed(2)}</td>
                            <td className="py-1 pr-3">{s.stopLoss.toFixed(2)}</td>
                            <td className="py-1 pr-3">{s.takeProfit.toFixed(2)}</td>
                            <td className="py-1 pr-3">{s.rr.toFixed(2)}</td>
                            <td className="py-1 pr-3">{s.signalStrength.toFixed(0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </TabsContent>
                <TabsContent value="rejects">
                  {rejects.length === 0 ? <div className="text-xs text-muted-foreground">No rejects.</div> : (
                    <div className="flex flex-wrap gap-2">
                      {rejects.map(([k, v]) => (
                        <Badge key={k} variant="outline" className="font-mono text-[10px]">{k}: {v}</Badge>
                      ))}
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="config">
                  <pre className="text-[10px] font-mono bg-muted/40 rounded-md p-3 overflow-x-auto max-h-[400px]">{data.effectiveConfigJson}</pre>
                </TabsContent>
              </Tabs>
            )}
          </ResultCard>

          <ResultCard title="Optimizer & Heatmaps">
            <p className="text-xs text-muted-foreground">
              Use the dedicated Optimizer for parameter sweeps on this dataset:
              {" "}<Link to="/optimizer" className="underline">Open Optimizer</Link>.
              Time Edge heatmaps and robustness scoring are under the same page.
            </p>
          </ResultCard>
        </div>
      </div>
    </StrategyPageShell>
  );
}

// ── UI helpers ──────────────────────────────────────────────────────────
const inpCls = "h-8 font-mono text-xs";
const selCls = "h-8 w-full rounded border border-input bg-background px-2 font-mono text-xs";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-2">{children}</div>;
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/50 bg-muted/20 p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-sm">{value}</div>
    </div>
  );
}
function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <AccordionItem value={id}>
      <AccordionTrigger className="text-xs font-mono uppercase tracking-widest">{title}</AccordionTrigger>
      <AccordionContent>{children}</AccordionContent>
    </AccordionItem>
  );
}
function ChipsMulti({ values, options, onChange }: { values: string[]; options: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => {
        const on = values.includes(o);
        return (
          <button key={o} type="button"
            onClick={() => onChange(on ? values.filter((x) => x !== o) : [...values, o])}
            className={`rounded border px-2 py-1 text-[10px] font-mono uppercase tracking-wider ${on ? "border-primary bg-primary/15 text-primary" : "border-border/60 text-muted-foreground hover:border-border"}`}>
            {o}
          </button>
        );
      })}
    </div>
  );
}
function FilterToggle({ label, enabled, onToggle, children }: {
  label: string; enabled: boolean; onToggle: (v: boolean) => void; children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-border/60 p-2">
      <label className="flex items-center gap-2 text-xs font-mono min-w-[140px]">
        <Checkbox checked={enabled} onCheckedChange={(v) => onToggle(v === true)} />
        {label}
      </label>
      {enabled && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
