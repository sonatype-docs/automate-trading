import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { onAuthChange } from "@/lib/auth-client";
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
  deleteLabPreset, duplicateLabPreset,
  LAB_FILTER_KEYS, type LabFilterKey,
  type MatrixRow,
} from "@/lib/liquidity-lab.functions";
import { deployTimeEdgeBuckets } from "@/lib/time-edge.functions";
import { LAB_SYMBOLS } from "@/lib/liquidity-lab/simulator";
import {
  computeTotals, bySymbol, byTimeframe, byZone, byDirection, byOutcome,
  byWeekday, byHourUTC, tradesCsv, downloadCsv,
} from "@/lib/liquidity-lab/matrix-insights";
import { TIMEFRAMES, TIMEZONES } from "@/lib/market-data/types";
import { Beaker, Download, Upload, Save, Copy, Trash2, Play, Grid3x3, Rocket, X } from "lucide-react";
import { getComputeArtifactUrl, getComputeJob, submitLiquidityMatrixJob } from "@/lib/compute.functions";


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
    return onAuthChange(setAuthed);
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
  const submitMatrix = useServerFn(submitLiquidityMatrixJob);
  const getMatrixJob = useServerFn(getComputeJob);
  const getMatrixArtifact = useServerFn(getComputeArtifactUrl);
  const [mxSymbols, setMxSymbols] = useState<string[]>(["XAUUSDT", "BTCUSDT", "ETHUSDT"]);
  const [mxTfs, setMxTfs] = useState<string[]>(["5m", "15m", "1h"]);
  const [mxZoneMode, setMxZoneMode] = useState<"each" | "combined">("each");
  const [mxZones, setMxZones] = useState<string[]>(["PDH", "PDL", "PWH", "PWL"]);
  const [mxSort, setMxSort] = useState<"pnl" | "pf" | "wr" | "trades" | "expectancy">("pf");
  const [mxDaysBack, setMxDaysBack] = useState<number>(60);
  const [mxDirection, setMxDirection] = useState<"long" | "short" | "both">("both");
  const [mxSkipSat, setMxSkipSat] = useState<boolean>(true);
  const [mxSkipSun, setMxSkipSun] = useState<boolean>(true);
  const [mxSources, setMxSources] = useState<Array<"yahoo" | "shark">>(["yahoo"]);
  const [mxConfMethods, setMxConfMethods] = useState<string[]>(["opposite_candle"]);
  const [mxConfMode, setMxConfMode] = useState<"each" | "combined">("each");
  const [mxFilters, setMxFilters] = useState<LabFilterKey[]>([]);
  const [mxFilterMode, setMxFilterMode] = useState<"off" | "each" | "all">("off");

  const mxConfSets: string[][] = useMemo(() => {
    if (!mxConfMethods.length) return [["opposite_candle"]];
    return mxConfMode === "each" ? mxConfMethods.map((m) => [m]) : [mxConfMethods];
  }, [mxConfMethods, mxConfMode]);
  const mxFilterSets: LabFilterKey[][] = useMemo(() => {
    if (mxFilterMode === "off" || mxFilters.length === 0) return [[]];
    if (mxFilterMode === "all") return [mxFilters];
    return [[], ...mxFilters.map((k) => [k])];
  }, [mxFilters, mxFilterMode]);

  const totalCombos = mxSources.length * mxSymbols.length * mxTfs.length
    * (mxZoneMode === "each" ? mxZones.length : 1)
    * mxConfSets.length * mxFilterSets.length;

  const [mxProgress, setMxProgress] = useState<{ done: number; total: number } | null>(null);
  const matrixMut = useMutation({
    mutationFn: async () => {
      const zoneSets = mxZoneMode === "each"
        ? mxZones.map((z) => [z])
        : [mxZones];
      if (mxTfs.length === 0 || zoneSets.length === 0 || mxSymbols.length === 0 || mxSources.length === 0) {
        throw new Error("Select sources, symbols, timeframes and zones.");
      }
      // Chunk: one (source, symbol, timeframe) per server call — sweeps all
      // zones / confirmation stacks / filter sets inside that call.
      const tasks = mxSources.flatMap((source) =>
        mxSymbols.flatMap((symbol) => mxTfs.map((timeframe) => ({ source, symbol, timeframe }))),
      );
      setMxProgress({ done: 0, total: totalCombos });
      const startedAll = Date.now();
      const allRows: MatrixRow[] = [];
      const weekdays = [0, 1, 2, 3, 4, 5, 6].filter(
        (d) => !(mxSkipSat && d === 6) && !(mxSkipSun && d === 0),
      );
      const effectiveBase: LiquiditySweepConfig = {
        ...config,
        daysBack: mxDaysBack,
        direction: mxDirection,
        session: {
          ...config.session,
          weekdays,
          blockWeekend: mxSkipSat && mxSkipSun,
        },
      };
      for (const task of tasks) {
        try {
          const queued = await submitMatrix({ data: {
            baseConfig: effectiveBase,
            symbols: [task.symbol],
            timeframes: [task.timeframe] as never,
            zoneSets: zoneSets as never,
            confirmationSets: mxConfSets as never,
            filterSets: mxFilterSets as never,
            sources: [task.source],
            daysBack: mxDaysBack,
          }});
          let r: { rows: MatrixRow[] } | null = null;
          for (let attempt = 0; attempt < 1_200; attempt += 1) {
            const job = await getMatrixJob({ data: { job_id: queued.job_id } });
            if (job.status === "failed") throw new Error(job.error || "Liquidity matrix job failed");
            if (job.status === "succeeded") {
              let result = job.result as unknown;
              const artifact = (result as { artifact?: { s3_key?: string } } | null)?.artifact;
              if (artifact?.s3_key) {
                const signed = await getMatrixArtifact({ data: { job_id: queued.job_id } });
                const response = await fetch(signed.url);
                if (!response.ok) throw new Error(`Liquidity matrix artifact download failed: ${response.status}`);
                result = await response.json();
              }
              r = result as { rows: MatrixRow[] };
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }
          if (!r) throw new Error("Liquidity matrix job timed out");
          allRows.push(...r.rows);
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          for (const zones of zoneSets) {
            for (const conf of mxConfSets) {
              for (const filters of mxFilterSets) {
                allRows.push({
                  symbol: task.symbol,
                  timeframe: task.timeframe as MatrixRow["timeframe"],
                  zones,
                  source: task.source,
                  confirmation: conf,
                  filters,
                  ok: false,
                  error,
                  bars: 0,
                  signals: 0,
                  stats: null,
                  trades: [],
                  elapsedMs: 0,
                });
              }
            }
          }
        }
        setMxProgress({ done: allRows.length, total: totalCombos });
      }
      return { rows: allRows, totalCombos, totalMs: Date.now() - startedAll };
    },
    onSuccess: (r) => {
      setMxProgress(null);
      const failed = r.rows.filter((row) => !row.ok).length;
      toast.success(`Matrix: ${r.rows.length} runs in ${(r.totalMs/1000).toFixed(1)}s${failed ? ` · ${failed} failed rows kept` : ""}`);
    },
    onError: (e: Error) => { setMxProgress(null); toast.error(e.message); },
  });

  // ── Post-run insight filters (multi-select, research-style) ──
  // Rows can come from the last matrix run OR from an imported snapshot.
  const [importedRows, setImportedRows] = useState<MatrixRow[] | null>(null);
  const rawRows: MatrixRow[] = importedRows ?? matrixMut.data?.rows ?? [];
  const [fltSymbols, setFltSymbols] = useState<string[]>([]);
  const [fltTfs, setFltTfs] = useState<string[]>([]);
  const [fltZones, setFltZones] = useState<string[]>([]);
  const [fltSources, setFltSources] = useState<string[]>([]);
  const [fltConfs, setFltConfs] = useState<string[]>([]);
  const [fltFilterTags, setFltFilterTags] = useState<string[]>([]);
  const [fltDirs, setFltDirs] = useState<string[]>(["long", "short"]);
  const [fltOutcomes, setFltOutcomes] = useState<string[]>(["win", "loss", "open"]);
  const [fltDows, setFltDows] = useState<string[]>([]);
  const [fltHours, setFltHours] = useState<string[]>([]);
  const [fltMinTrades, setFltMinTrades] = useState<number>(0);
  const [fltMinPF, setFltMinPF] = useState<number>(0);
  const [fltMinWR, setFltMinWR] = useState<number>(0);
  const [fltMinPnL, setFltMinPnL] = useState<number>(0);

  // Reset filters whenever a new matrix run finishes or a snapshot is loaded.
  useEffect(() => { if (matrixMut.data || importedRows) {
    setFltSymbols([]); setFltTfs([]); setFltZones([]);
    setFltSources([]); setFltConfs([]); setFltFilterTags([]);
    setFltDirs(["long", "short"]); setFltOutcomes(["win", "loss", "open"]);
    setFltDows([]); setFltHours([]);
    setFltMinTrades(0); setFltMinPF(0); setFltMinWR(0); setFltMinPnL(0);
  }}, [matrixMut.data, importedRows]);

  const optSymbols = useMemo(() => Array.from(new Set(rawRows.map((r) => r.symbol))).sort(), [rawRows]);
  const optTfs = useMemo(() => Array.from(new Set(rawRows.map((r) => r.timeframe))).sort(), [rawRows]);
  const optZones = useMemo(() => Array.from(new Set(rawRows.map((r) => r.zones.join("+")))).sort(), [rawRows]);
  const optSources = useMemo(() => Array.from(new Set(rawRows.map((r) => r.source))).sort(), [rawRows]);
  const optConfs = useMemo(() => Array.from(new Set(rawRows.map((r) => r.confirmation.join("+")))).sort(), [rawRows]);
  const optFilterTags = useMemo(() => Array.from(new Set(rawRows.map((r) => r.filters.join("+") || "none"))).sort(), [rawRows]);
  const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const optHours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));

  // Row + trade filter. Recomputes per-row stats when trades are filtered so
  // best/worst combo, table cells and CSV export all reflect the current view.
  const filteredMatrixRows: MatrixRow[] = useMemo(() => {
    if (!rawRows.length) return [];
    const symOk = (s: string) => !fltSymbols.length || fltSymbols.includes(s);
    const tfOk = (t: string) => !fltTfs.length || fltTfs.includes(t);
    const zoneOk = (z: string) => !fltZones.length || fltZones.includes(z);
    const srcOk = (s: string) => !fltSources.length || fltSources.includes(s);
    const confOk = (c: string) => !fltConfs.length || fltConfs.includes(c);
    const flagOk = (f: string) => !fltFilterTags.length || fltFilterTags.includes(f);
    const dirOk = (d: string) => !fltDirs.length || fltDirs.includes(d);
    const outOk = (o: string) => !fltOutcomes.length || fltOutcomes.includes(o);
    const dowOk = (n: string) => !fltDows.length || fltDows.includes(n);
    const hrOk = (h: string) => !fltHours.length || fltHours.includes(h);

    const out: MatrixRow[] = [];
    for (const r of rawRows) {
      if (!symOk(r.symbol) || !tfOk(r.timeframe) || !zoneOk(r.zones.join("+"))) continue;
      if (!srcOk(r.source) || !confOk(r.confirmation.join("+")) || !flagOk(r.filters.join("+") || "none")) continue;
      if (!r.ok) { out.push(r); continue; }
      const kept = r.trades.filter((t) => {
        if (!dirOk(t.direction) || !outOk(t.outcome)) return false;
        const d = new Date(t.ts);
        if (!dowOk(DOW_NAMES[d.getUTCDay()])) return false;
        if (!hrOk(String(d.getUTCHours()).padStart(2, "0"))) return false;
        return true;
      });
      if (fltMinTrades && kept.length < fltMinTrades) continue;
      if (kept.length === r.trades.length) { out.push(r); continue; }
      // Recompute row-level stats over the surviving trades.
      let wins = 0, losses = 0, open = 0, gw = 0, gl = 0, rSum = 0, rrSum = 0, rrN = 0;
      let longs = 0, shorts = 0, lw = 0, sw = 0, fees = 0, netSum = 0;
      let eq = 0, peak = 0, dd = 0;
      const sorted = [...kept].sort((a, b) => a.exitTs - b.exitTs);
      for (const t of sorted) {
        if (t.outcome === "win") wins++; else if (t.outcome === "loss") losses++; else open++;
        const net = t.netPnlUsd ?? t.pnlUsd;
        if (net > 0) gw += net; else if (net < 0) gl += -net;
        netSum += net;
        fees += t.feesUsd ?? 0;
        rSum += t.rMultiple;
        const rr = Math.abs((t.target - t.entry) / (t.entry - t.stop || 1));
        if (Number.isFinite(rr) && rr > 0) { rrSum += rr; rrN++; }
        if (t.direction === "long") { longs++; if (t.outcome === "win") lw++; }
        else { shorts++; if (t.outcome === "win") sw++; }
        eq += net; if (eq > peak) peak = eq; if (peak - eq > dd) dd = peak - eq;
      }
      const closed = wins + losses;
      out.push({
        ...r,
        trades: kept,
        stats: {
          trades: kept.length, wins, losses, open,
          winRate: closed ? (wins / closed) * 100 : 0,
          avgRR: rrN ? rrSum / rrN : (r.stats?.avgRR ?? 0),
          avgWinR: wins ? sorted.filter((t) => t.outcome === "win").reduce((a, t) => a + t.rMultiple, 0) / wins : 0,
          avgLossR: losses ? sorted.filter((t) => t.outcome === "loss").reduce((a, t) => a + t.rMultiple, 0) / losses : 0,
          expectancyR: closed ? rSum / closed : 0,
          profitFactor: gl > 0 ? gw / gl : (gw > 0 ? 999 : 0),
          totalPnlUsd: sorted.reduce((a, t) => a + t.pnlUsd, 0),
          netPnlUsd: netSum,
          totalFeesUsd: fees,
          grossWinUsd: gw, grossLossUsd: gl,
          maxDrawdownUsd: dd,
          longs, shorts,
          longWinRate: longs ? (lw / longs) * 100 : 0,
          shortWinRate: shorts ? (sw / shorts) * 100 : 0,
        },
      });
    }
    // Row-level thresholds — apply after per-row stat recomputation.
    return out.filter((r) => {
      if (!r.ok || !r.stats) return true;
      if (fltMinPF > 0 && (r.stats.profitFactor === 999 ? 999 : r.stats.profitFactor) < fltMinPF) return false;
      if (fltMinWR > 0 && r.stats.winRate < fltMinWR) return false;
      if (fltMinPnL !== 0 && r.stats.totalPnlUsd < fltMinPnL) return false;
      return true;
    });
  }, [rawRows, fltSymbols, fltTfs, fltZones, fltSources, fltConfs, fltFilterTags,
      fltDirs, fltOutcomes, fltDows, fltHours, fltMinTrades, fltMinPF, fltMinWR, fltMinPnL]);

  const sortedMatrix: MatrixRow[] = useMemo(() => {
    const rows = [...filteredMatrixRows];
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
  }, [filteredMatrixRows, mxSort]);

  // Combined insights over filtered rows/trades.
  const matrixRows = filteredMatrixRows;
  const insights = useMemo(() => {
    if (!matrixRows.length) return null;
    return {
      totals: computeTotals(matrixRows),
      bySymbol: bySymbol(matrixRows),
      byTf: byTimeframe(matrixRows),
      byZone: byZone(matrixRows),
      byDir: byDirection(matrixRows),
      byOut: byOutcome(matrixRows),
      byDow: byWeekday(matrixRows),
      byHour: byHourUTC(matrixRows),
    };
  }, [matrixRows]);
  const filtersActive =
    fltSymbols.length + fltTfs.length + fltZones.length + fltSources.length + fltConfs.length
      + fltFilterTags.length + fltDows.length + fltHours.length > 0
    || fltDirs.length !== 2 || fltOutcomes.length !== 3
    || fltMinTrades > 0 || fltMinPF > 0 || fltMinWR > 0 || fltMinPnL !== 0;
  const clearFilters = () => {
    setFltSymbols([]); setFltTfs([]); setFltZones([]);
    setFltSources([]); setFltConfs([]); setFltFilterTags([]);
    setFltDirs(["long", "short"]); setFltOutcomes(["win", "loss", "open"]);
    setFltDows([]); setFltHours([]);
    setFltMinTrades(0); setFltMinPF(0); setFltMinWR(0); setFltMinPnL(0);
  };

  // ── Ship filtered combos → Live runners ──
  const deployFn = useServerFn(deployTimeEdgeBuckets);
  const [deployOpen, setDeployOpen] = useState(false);
  const [deployRisk, setDeployRisk] = useState<number>(10);
  const [deployReplace, setDeployReplace] = useState<boolean>(true);

  const plannedBuckets = useMemo(() => {
    // One bucket per (symbol, tf, zoneKey) that has trades after filters.
    // Direction/weekdays/hours pulled from the active filter chips so the
    // live runner only fires inside the same slice you're viewing.
    const okRows = filteredMatrixRows.filter((r) => r.ok && r.trades.length > 0);
    if (okRows.length === 0) return [] as Array<{
      label: string; symbol: string; timeframe: string; zones: string[];
      direction: "long" | "short" | "both";
      weekdays: number[] | undefined;
      windowStartHourIst: number | undefined;
      windowEndHourIst: number | undefined;
      trades: number; pnlUsd: number; pf: number; wr: number;
    }>;

    const direction: "long" | "short" | "both" =
      fltDirs.length === 1 && (fltDirs[0] === "long" || fltDirs[0] === "short")
        ? (fltDirs[0] as "long" | "short") : "both";

    // Weekdays: filter uses JS getUTCDay (Sun=0..Sat=6). Live gating accepts
    // both JS and ISO indices — pass JS as-is. Empty = all days.
    const weekdays = fltDows.length
      ? fltDows.map((n) => DOW_NAMES.indexOf(n)).filter((i) => i >= 0)
      : undefined;

    // Hours: convert UTC hour set → IST (UTC+5:30, hour = (h+5) mod 24 approx)
    // then compress to a single contiguous window (min..max+1). If the set is
    // non-contiguous, the window will be a widened superset (documented in UI).
    let windowStartHourIst: number | undefined;
    let windowEndHourIst: number | undefined;
    if (fltHours.length) {
      const istHours = Array.from(new Set(
        fltHours.map((h) => (parseInt(h, 10) + 5) % 24),
      )).sort((a, b) => a - b);
      windowStartHourIst = istHours[0];
      windowEndHourIst = Math.min(24, istHours[istHours.length - 1] + 1);
    }

    return okRows.map((r) => {
      const st = r.stats!;
      return {
        label: `${r.symbol} · ${r.timeframe} · ${r.zones.join("+")}`,
        symbol: r.symbol,
        timeframe: r.timeframe,
        zones: r.zones,
        direction,
        weekdays,
        windowStartHourIst,
        windowEndHourIst,
        trades: st.trades,
        pnlUsd: st.totalPnlUsd,
        pf: st.profitFactor,
        wr: st.winRate,
      };
    });
  }, [filteredMatrixRows, fltDirs, fltDows, fltHours]);

  const hourFilterNonContiguous = useMemo(() => {
    if (fltHours.length < 2) return false;
    const ist = Array.from(new Set(fltHours.map((h) => (parseInt(h, 10) + 5) % 24))).sort((a, b) => a - b);
    for (let i = 1; i < ist.length; i++) if (ist[i] !== ist[i - 1] + 1) return true;
    return false;
  }, [fltHours]);

  const deployMut = useMutation({
    mutationFn: async () => {
      if (plannedBuckets.length === 0) throw new Error("Nothing to deploy.");
      // Ship the exact Lab config with each runner so live trades use the
      // SAME tuning that produced the backtest stats above (zones, buffers,
      // entry model, stops, filters). The live engine deep-merges these onto
      // the base preset per-tick.
      const { toStrategyOverrides } = await import("@/lib/liquidity-lab/to-strategy-config");
      const buckets = plannedBuckets.map((b) => {
        const perBucketCfg: LiquiditySweepConfig = {
          ...config,
          symbol: b.symbol,
          entryTimeframe: b.timeframe as LiquiditySweepConfig["entryTimeframe"],
          zones: b.zones as LiquiditySweepConfig["zones"],
          direction: b.direction,
          riskUsd: deployRisk,
        };
        return {
          label: b.label,
          symbol: b.symbol,
          timeframe: b.timeframe,
          strategyPreset: "pdh_pdl_sweep_1m",
          execPreset: "conservative_default",
          riskUsd: deployRisk,
          lookbackDays: 30,
          direction: b.direction,
          weekdays: b.weekdays,
          windowStartHourIst: b.windowStartHourIst,
          windowEndHourIst: b.windowEndHourIst,
          configOverrides: toStrategyOverrides(perBucketCfg) as Record<string, unknown>,
        };
      });
      return await deployFn({ data: { target: "live", buckets, replaceExisting: deployReplace } });
    },
    onSuccess: (s) => {
      toast.success(`Live: +${s.live.inserted} inserted · −${s.live.removed} removed${s.skipped.length ? ` · ${s.skipped.length} skipped` : ""}`);
      setDeployOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

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

  // ── Save / load matrix snapshots (JSON) ──
  const downloadJson = (name: string, payload: unknown) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  };
  const exportMatrixOnly = () => {
    if (!rawRows.length) { toast.error("No matrix rows to save."); return; }
    downloadJson(`${config.name.replace(/\s+/g, "_")}_matrix.json`,
      { kind: "liquidity-lab-matrix", version: 1, savedAt: new Date().toISOString(), rows: rawRows });
    toast.success(`Saved ${rawRows.length} matrix rows`);
  };
  const exportCombined = () => {
    if (!rawRows.length) { toast.error("Run a matrix first."); return; }
    downloadJson(`${config.name.replace(/\s+/g, "_")}_combined.json`,
      { kind: "liquidity-lab-combined", version: 1, savedAt: new Date().toISOString(), config, rows: rawRows });
    toast.success("Saved combined config + matrix");
  };
  const importSnapshot = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(String(e.target?.result ?? "{}"));
        // Combined snapshot → restore both
        if (parsed?.kind === "liquidity-lab-combined" && Array.isArray(parsed.rows)) {
          if (parsed.config) setConfig({ ...defaultLabConfig(), ...parsed.config });
          setImportedRows(parsed.rows as MatrixRow[]);
          toast.success(`Loaded combined snapshot · ${parsed.rows.length} rows`);
          return;
        }
        // Matrix-only snapshot
        if (parsed?.kind === "liquidity-lab-matrix" && Array.isArray(parsed.rows)) {
          setImportedRows(parsed.rows as MatrixRow[]);
          toast.success(`Loaded matrix snapshot · ${parsed.rows.length} rows`);
          return;
        }
        // Fallback = plain config preset
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
          <Button
            size="sm"
            onClick={() => {
              if (!authed) { toast.error("Sign in to save presets", { action: { label: "Sign in", onClick: () => { window.location.href = "/login"; } } }); return; }
              saveMut.mutate(config.name);
            }}
            disabled={saveMut.isPending}
            title={authed ? "Save preset" : "Sign in to save presets"}
          >
            <Save className="w-3.5 h-3.5 mr-1" /> Save
          </Button>
          <Button size="sm" variant="outline" onClick={exportPreset}>
            <Download className="w-3.5 h-3.5 mr-1" /> Export
          </Button>
          <Button size="sm" variant="outline" onClick={exportMatrixOnly} disabled={!rawRows.length}
            title="Download matrix rows as JSON">
            <Download className="w-3.5 h-3.5 mr-1" /> Save matrix
          </Button>
          <Button size="sm" variant="outline" onClick={exportCombined} disabled={!rawRows.length}
            title="Download config + matrix rows as one JSON">
            <Download className="w-3.5 h-3.5 mr-1" /> Save combined
          </Button>
          <label className="inline-flex">
            <Button size="sm" variant="outline" asChild>
              <span><Upload className="w-3.5 h-3.5 mr-1" /> Import</span>
            </Button>
            <input type="file" accept="application/json" className="hidden"
              onChange={(e) => e.target.files?.[0] && importSnapshot(e.target.files[0])} />
          </label>
          {importedRows && (
            <Button size="sm" variant="ghost" onClick={() => setImportedRows(null)}
              title="Clear loaded snapshot and use last matrix run again">
              <X className="w-3.5 h-3.5 mr-1" /> Clear snapshot
            </Button>
          )}
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
      <ResultCard title={<><Grid3x3 className="w-4 h-4 inline mr-1" /> Matrix Sweep — Source × Symbol × TF × Zones × Confirmation × Filters</>}>
        <div className="space-y-3">
          <ChipsMultiLabeled title="Sources" values={mxSources} options={["yahoo", "shark"]} onChange={(v) => setMxSources(v as Array<"yahoo" | "shark">)} />
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

          {/* Confirmation stack sweep */}
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Confirmation stack</div>
              <div className="flex items-center gap-2 text-[10px] font-mono">
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="radio" checked={mxConfMode === "each"} onChange={() => setMxConfMode("each")} />
                  Each method alone
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="radio" checked={mxConfMode === "combined"} onChange={() => setMxConfMode("combined")} />
                  Combined (all together)
                </label>
              </div>
            </div>
            <ChipsMulti values={mxConfMethods} options={CONFIRMATION_METHODS as unknown as string[]} onChange={setMxConfMethods} />
          </div>

          {/* Filters sweep */}
          <div className="space-y-1">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Filters</div>
              <div className="flex items-center gap-2 text-[10px] font-mono">
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="radio" checked={mxFilterMode === "off"} onChange={() => setMxFilterMode("off")} />
                  Baseline (all off)
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="radio" checked={mxFilterMode === "each"} onChange={() => setMxFilterMode("each")} />
                  Baseline + each alone
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="radio" checked={mxFilterMode === "all"} onChange={() => setMxFilterMode("all")} />
                  All selected on
                </label>
              </div>
            </div>
            <ChipsMulti values={mxFilters as unknown as string[]}
              options={LAB_FILTER_KEYS as unknown as string[]}
              onChange={(v) => setMxFilters(v as LabFilterKey[])} />
          </div>


          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 rounded-md border border-border/60 p-3">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Days back</Label>
              <Input type="number" min={1} value={mxDaysBack}
                onChange={(e) => setMxDaysBack(Math.max(1, Number(e.target.value) || 1))}
                className="h-8 font-mono text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Direction</Label>
              <div className="flex gap-1">
                {(["long", "short", "both"] as const).map((d) => (
                  <button key={d} type="button" onClick={() => setMxDirection(d)}
                    className={`flex-1 h-8 rounded border text-[11px] font-mono uppercase transition-colors ${
                      mxDirection === d
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border/60 text-muted-foreground hover:border-border"
                    }`}>
                    {d === "long" ? "L" : d === "short" ? "S" : "L+S"}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1 col-span-2">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Skip weekends</Label>
              <div className="flex gap-1">
                {([
                  { k: "sat", label: "Skip Sat", on: mxSkipSat, toggle: () => setMxSkipSat((v) => !v) },
                  { k: "sun", label: "Skip Sun", on: mxSkipSun, toggle: () => setMxSkipSun((v) => !v) },
                  { k: "both", label: "Skip Both", on: mxSkipSat && mxSkipSun,
                    toggle: () => { const v = !(mxSkipSat && mxSkipSun); setMxSkipSat(v); setMxSkipSun(v); } },
                ] as const).map((t) => (
                  <button key={t.k} type="button" onClick={t.toggle}
                    className={`flex-1 h-8 rounded border text-[11px] font-mono transition-colors ${
                      t.on
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border/60 text-muted-foreground hover:border-border"
                    }`}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">
              {mxSources.length} src × {mxSymbols.length} sym × {mxTfs.length} tf × {mxZoneMode === "each" ? mxZones.length : 1} zn × {mxConfSets.length} conf × {mxFilterSets.length} flt = {totalCombos} combos
            </Badge>
            <Button size="sm" onClick={() => matrixMut.mutate()} disabled={matrixMut.isPending || !mxSymbols.length || !mxTfs.length || !mxZones.length || !mxSources.length}>
              <Play className="w-3.5 h-3.5 mr-1" /> {matrixMut.isPending ? (mxProgress ? `Running ${mxProgress.done}/${mxProgress.total}…` : "Running matrix…") : "Run matrix"}
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
                    <th className="py-1 px-2">Src</th>
                    <th className="py-1 px-2">Symbol</th>
                    <th className="py-1 px-2">TF</th>
                    <th className="py-1 px-2">Zones</th>
                    <th className="py-1 px-2">Conf</th>
                    <th className="py-1 px-2">Filters</th>
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
                      <td className="py-1 px-2 text-[10px] uppercase">{r.source}</td>
                      <td className="py-1 px-2">{r.symbol}</td>
                      <td className="py-1 px-2">{r.timeframe}</td>
                      <td className="py-1 px-2 text-[10px]">{r.zones.join("+")}</td>
                      <td className="py-1 px-2 text-[10px]">{r.confirmation.join("+")}</td>
                      <td className="py-1 px-2 text-[10px]">{r.filters.length ? r.filters.join("+") : "—"}</td>

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
                              setConfig((c) => ({
                                ...c,
                                source: r.source,
                                symbol: r.symbol,
                                entryTimeframe: r.timeframe as never,
                                zones: r.zones as never,
                                confirmation: { ...c.confirmation, methods: r.confirmation as never },
                                filters: Object.fromEntries(
                                  (Object.keys(c.filters) as Array<keyof typeof c.filters>).map((k) => [
                                    k,
                                    { ...c.filters[k], enabled: (r.filters as string[]).includes(k as string) },
                                  ]),
                                ) as typeof c.filters,
                              }));
                              toast.success(`Loaded ${r.source}·${r.symbol} ${r.timeframe} ${r.zones.join("+")} into config`);
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

      {/* Combined Insights */}
      {insights && (
        <ResultCard title={<><Beaker className="w-4 h-4 inline mr-1" /> Combined Insights — All Matrix Trades</>}>
          <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="font-mono text-[10px]">
                {insights.totals.okRuns}/{insights.totals.runs} runs OK · {insights.totals.failed} failed
              </Badge>
              <Badge variant="outline" className="font-mono text-[10px]">
                {insights.totals.totalTrades} trades · {insights.totals.totalSignals} signals
              </Badge>
              {filtersActive && (
                <Badge variant="outline" className="font-mono text-[10px] border-primary/60 text-primary">
                  filters active
                </Badge>
              )}
              <div className="ml-auto flex items-center gap-2">
                {filtersActive && (
                  <Button size="sm" variant="ghost" onClick={clearFilters}>Clear filters</Button>
                )}
                <Button size="sm" variant="outline"
                  onClick={() => downloadCsv(`${config.name.replace(/\s+/g, "_")}_matrix_trades.csv`, tradesCsv(matrixRows))}>
                  <Download className="w-3.5 h-3.5 mr-1" /> Export {filtersActive ? "filtered" : "all"} trades CSV
                </Button>
                <Button size="sm" onClick={() => setDeployOpen((v) => !v)}
                  disabled={plannedBuckets.length === 0}>
                  <Rocket className="w-3.5 h-3.5 mr-1" />
                  {deployOpen ? "Hide deploy" : `Ship ${plannedBuckets.length} to Live`}
                </Button>
              </div>
            </div>

            {/* Verification / deploy panel */}
            {deployOpen && (
              <div className="rounded-md border border-primary/50 bg-primary/5 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] uppercase tracking-widest font-mono text-primary">
                    Verify before shipping · {plannedBuckets.length} live runners
                  </div>
                  <button className="text-muted-foreground hover:text-foreground"
                    onClick={() => setDeployOpen(false)} aria-label="Close">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Risk $ / trade</Label>
                    <Input type="number" min={1} max={10000} value={deployRisk}
                      onChange={(e) => setDeployRisk(Math.max(1, Number(e.target.value) || 10))}
                      className="h-8 w-24 font-mono text-xs" />
                  </div>
                  <label className="flex items-center gap-2 text-[11px] font-mono">
                    <Checkbox checked={deployReplace}
                      onCheckedChange={(v) => setDeployReplace(Boolean(v))} />
                    Replace existing live runners for these symbols
                  </label>
                  <div className="ml-auto flex items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setDeployOpen(false)}>Cancel</Button>
                    <Button size="sm" onClick={() => deployMut.mutate()} disabled={deployMut.isPending}>
                      <Rocket className="w-3.5 h-3.5 mr-1" />
                      {deployMut.isPending ? "Deploying…" : `Confirm & Deploy ${plannedBuckets.length}`}
                    </Button>
                  </div>
                </div>

                <div className="text-[10px] font-mono text-muted-foreground space-y-0.5">
                  <div>
                    Strategy preset · <b>pdh_pdl_sweep_1m</b> ·
                    direction <b>{plannedBuckets[0]?.direction ?? "both"}</b>
                    {plannedBuckets[0]?.weekdays?.length
                      ? <> · weekdays <b>{plannedBuckets[0].weekdays.map((d) => DOW_NAMES[d]).join(",")}</b> (IST)</>
                      : <> · every day</>}
                    {plannedBuckets[0]?.windowStartHourIst != null
                      ? <> · IST window <b>{String(plannedBuckets[0].windowStartHourIst).padStart(2, "0")}:00→{String(plannedBuckets[0].windowEndHourIst).padStart(2, "0")}:00</b></>
                      : <> · 24h</>}
                  </div>
                  {hourFilterNonContiguous && (
                    <div className="text-amber-500">
                      ⚠ Hour filter is non-contiguous — live gating widened to the min→max IST range (live engine only supports a single window).
                    </div>
                  )}
                  <div>Weekday chips are UTC in the filter but forwarded as JS-index days; live gating uses IST, so days may shift by ±1 for late-UTC hours.</div>
                </div>

                <div className="max-h-64 overflow-auto rounded border border-border/50">
                  <table className="w-full text-[11px] font-mono">
                    <thead className="sticky top-0 bg-muted/40">
                      <tr className="text-left text-muted-foreground">
                        <th className="px-2 py-1">Symbol</th>
                        <th className="px-2 py-1">TF</th>
                        <th className="px-2 py-1">Zones</th>
                        <th className="px-2 py-1 text-right">Trades</th>
                        <th className="px-2 py-1 text-right">WR%</th>
                        <th className="px-2 py-1 text-right">PF</th>
                        <th className="px-2 py-1 text-right">P&L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plannedBuckets.map((b, i) => (
                        <tr key={i} className="border-t border-border/40">
                          <td className="px-2 py-1">{b.symbol}</td>
                          <td className="px-2 py-1">{b.timeframe}</td>
                          <td className="px-2 py-1">{b.zones.join("+")}</td>
                          <td className="px-2 py-1 text-right">{b.trades}</td>
                          <td className="px-2 py-1 text-right">{b.wr.toFixed(1)}</td>
                          <td className="px-2 py-1 text-right">{b.pf === 999 ? "∞" : b.pf.toFixed(2)}</td>
                          <td className={`px-2 py-1 text-right ${b.pnlUsd > 0 ? "text-emerald-500" : b.pnlUsd < 0 ? "text-red-500" : ""}`}>
                            ${b.pnlUsd.toFixed(0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}


            {/* Multi-select filter panel */}
            <div className="rounded-md border border-border/60 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
                  Filters — play with the report
                </div>
                <div className="text-[10px] font-mono text-muted-foreground">
                  {matrixRows.filter((r) => r.ok).length}/{rawRows.filter((r) => r.ok).length} combos shown
                </div>
              </div>
              <ChipsMultiLabeled title="Symbols" values={fltSymbols} options={optSymbols} onChange={setFltSymbols} />
              <ChipsMultiLabeled title="Timeframes" values={fltTfs} options={optTfs} onChange={setFltTfs} />
              <ChipsMultiLabeled title="Zones" values={fltZones} options={optZones} onChange={setFltZones} />
              <div className="grid md:grid-cols-3 gap-3">
                <ChipsMultiLabeled title="Sources" values={fltSources} options={optSources} onChange={setFltSources} />
                <ChipsMultiLabeled title="Confirmation" values={fltConfs} options={optConfs} onChange={setFltConfs} />
                <ChipsMultiLabeled title="Filter tags" values={fltFilterTags} options={optFilterTags} onChange={setFltFilterTags} />
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <ChipsMultiLabeled title="Direction" values={fltDirs} options={["long", "short"]} onChange={setFltDirs} />
                <ChipsMultiLabeled title="Outcome" values={fltOutcomes} options={["win", "loss", "open"]} onChange={setFltOutcomes} />
              </div>
              <ChipsMultiLabeled title="Weekday (UTC)" values={fltDows} options={DOW_NAMES} onChange={setFltDows} />
              <ChipsMultiLabeled title="Hour (UTC)" values={fltHours} options={optHours} onChange={setFltHours} />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Min trades / combo</Label>
                  <Input type="number" min={0} max={99999} value={fltMinTrades}
                    onChange={(e) => setFltMinTrades(Math.max(0, Number(e.target.value) || 0))}
                    className="h-8 font-mono text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Min PF</Label>
                  <Input type="number" min={0} step={0.1} value={fltMinPF}
                    onChange={(e) => setFltMinPF(Math.max(0, Number(e.target.value) || 0))}
                    className="h-8 font-mono text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Min WR %</Label>
                  <Input type="number" min={0} max={100} step={1} value={fltMinWR}
                    onChange={(e) => setFltMinWR(Math.max(0, Number(e.target.value) || 0))}
                    className="h-8 font-mono text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Min P&L $</Label>
                  <Input type="number" step={10} value={fltMinPnL}
                    onChange={(e) => setFltMinPnL(Number(e.target.value) || 0)}
                    className="h-8 font-mono text-xs" />
                </div>
              </div>
            </div>


            {filtersActive && insights.totals.totalTrades === 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-[11px] font-mono text-amber-600 dark:text-amber-400">
                No trades match the current filters ({insights.totals.totalSignals} raw signals in view).
                Common cause: Direction is set to only <b>{fltDirs.join(" / ") || "—"}</b>, or Outcome / Weekday / Hour are too narrow.
                Try <button type="button" className="underline" onClick={clearFilters}>Clear filters</button> and re-narrow one facet at a time.
              </div>
            )}

            {/* Headline KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">

              <KPI label="Total P&L" value={`$${insights.totals.totalPnlUsd.toFixed(0)}`}
                   tone={insights.totals.totalPnlUsd > 0 ? "pos" : insights.totals.totalPnlUsd < 0 ? "neg" : undefined} />
              <KPI label="Profit Factor" value={insights.totals.profitFactor === 999 ? "∞" : insights.totals.profitFactor.toFixed(2)} />
              <KPI label="Win Rate" value={`${insights.totals.winRate.toFixed(1)}%`} />
              <KPI label="Expectancy" value={`${insights.totals.expectancyR.toFixed(2)}R`} />
              <KPI label="Avg R:R" value={insights.totals.avgRR.toFixed(2)} />
              <KPI label="Max DD" value={`$${insights.totals.maxDrawdownUsd.toFixed(0)}`} tone="neg" />
              <KPI label="Wins" value={String(insights.totals.wins)} tone="pos" />
              <KPI label="Losses" value={String(insights.totals.losses)} tone="neg" />
              <KPI label="Open" value={String(insights.totals.open)} />
              <KPI label="Longs WR" value={`${insights.totals.longWinRate.toFixed(1)}%`} sub={`${insights.totals.longs} trades`} />
              <KPI label="Shorts WR" value={`${insights.totals.shortWinRate.toFixed(1)}%`} sub={`${insights.totals.shorts} trades`} />
              <KPI label="Gross W / L" value={`$${insights.totals.grossWinUsd.toFixed(0)} / $${insights.totals.grossLossUsd.toFixed(0)}`} />
            </div>

            {/* Best / worst combo */}
            {insights.totals.bestCombo && insights.totals.worstCombo && (
              <div className="grid md:grid-cols-2 gap-2">
                <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-2 text-[11px] font-mono">
                  <div className="text-emerald-500 uppercase text-[10px] tracking-widest">Best combo</div>
                  <div>{insights.totals.bestCombo.key} · ${insights.totals.bestCombo.pnl.toFixed(0)}</div>
                </div>
                <div className="rounded border border-red-500/30 bg-red-500/5 p-2 text-[11px] font-mono">
                  <div className="text-red-500 uppercase text-[10px] tracking-widest">Worst combo</div>
                  <div>{insights.totals.worstCombo.key} · ${insights.totals.worstCombo.pnl.toFixed(0)}</div>
                </div>
              </div>
            )}

            {/* Breakdown tables */}
            <Tabs defaultValue="symbol">
              <TabsList className="flex-wrap h-auto">
                <TabsTrigger value="symbol">By Symbol</TabsTrigger>
                <TabsTrigger value="tf">By Timeframe</TabsTrigger>
                <TabsTrigger value="zone">By Zone</TabsTrigger>
                <TabsTrigger value="dir">By Direction</TabsTrigger>
                <TabsTrigger value="out">By Outcome</TabsTrigger>
                <TabsTrigger value="dow">By Weekday (UTC)</TabsTrigger>
                <TabsTrigger value="hour">By Hour (UTC)</TabsTrigger>
              </TabsList>
              <TabsContent value="symbol"><BucketTable rows={insights.bySymbol} keyLabel="Symbol" /></TabsContent>
              <TabsContent value="tf"><BucketTable rows={insights.byTf} keyLabel="Timeframe" /></TabsContent>
              <TabsContent value="zone"><BucketTable rows={insights.byZone} keyLabel="Zone(s)" /></TabsContent>
              <TabsContent value="dir"><BucketTable rows={insights.byDir} keyLabel="Direction" /></TabsContent>
              <TabsContent value="out"><BucketTable rows={insights.byOut} keyLabel="Outcome" /></TabsContent>
              <TabsContent value="dow"><BucketTable rows={insights.byDow} keyLabel="Weekday" /></TabsContent>
              <TabsContent value="hour"><BucketTable rows={insights.byHour} keyLabel="Hour" /></TabsContent>
            </Tabs>
          </div>
        </ResultCard>
      )}

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
                  <Input type="number" min={1} value={config.daysBack}
                    onChange={(e) => update("daysBack", Math.max(1, Number(e.target.value) || 1))}
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
              {(() => {
                const tf = config.entryTimeframe;
                const isIntradaySub1h = ["1m", "2m", "3m", "5m", "15m", "30m"].includes(tf);
                const isYahoo = config.source === "yahoo";
                if (!isYahoo) return null;
                const cap = tf === "1m" ? 7 : isIntradaySub1h ? 60 : tf === "1h" || tf === "60m" ? 730 : 3650;
                const over = config.daysBack > cap;
                return (
                  <div className={`mt-2 rounded border px-2 py-1.5 text-[11px] ${over ? "border-amber-500/40 bg-amber-500/10 text-amber-200" : "border-border/40 bg-muted/20 text-muted-foreground"}`}>
                    <b>Yahoo cap for {tf}:</b> ~{cap} days of history. {over ? (
                      <>You requested {config.daysBack}d — only the last ~{cap}d will actually come back (rest is silently empty). For 2 years of XAU history, switch <b>Entry timeframe → 1h</b> (Yahoo allows 730d there), then resample if needed. Sub-hour intraday depth is a hard Yahoo API limit.</>
                    ) : (
                      <>Within the vendor cap. To get 2 years of intraday history you'd need a paid data source — Yahoo doesn't serve sub-1h history beyond 60 days.</>
                    )}
                  </div>
                );
              })()}
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

            {/* Realism: fees, slippage, intrabar SL/TP model */}
            <Section id="realism" title="Realism (fees · slippage · intrabar)">
              <Grid>
                <Field label="Intrabar SL/TP model">
                  <select value={config.realism.intrabar}
                    onChange={(e) => updateNested("realism", { intrabar: e.target.value as "conservative" | "optimistic" | "proximity" })}
                    className={selCls}>
                    <option value="conservative">Conservative — SL first when both hit</option>
                    <option value="optimistic">Optimistic — TP first when both hit</option>
                    <option value="proximity">Proximity — closer-to-open wins</option>
                  </select>
                </Field>
                <Field label="Slippage model">
                  <select value={config.realism.slippage.model}
                    onChange={(e) => updateNested("realism", { slippage: { ...config.realism.slippage, model: e.target.value as "none" | "fixed_pts" | "pct" | "atr_mult" } })}
                    className={selCls}>
                    <option value="none">None</option>
                    <option value="fixed_pts">Fixed points</option>
                    <option value="pct">% of price</option>
                    <option value="atr_mult">ATR × mult</option>
                  </select>
                </Field>
                <Field label="Slippage value">
                  <Input type="number" step="0.01" value={config.realism.slippage.value}
                    disabled={config.realism.slippage.model === "none"}
                    onChange={(e) => updateNested("realism", { slippage: { ...config.realism.slippage, value: Math.max(0, Number(e.target.value) || 0) } })}
                    className={inpCls} />
                </Field>
                <Field label="Include fees">
                  <select value={config.realism.fees.enabled ? "y" : "n"}
                    onChange={(e) => updateNested("realism", { fees: { ...config.realism.fees, enabled: e.target.value === "y" } })}
                    className={selCls}>
                    <option value="y">Yes (maker/taker)</option>
                    <option value="n">No</option>
                  </select>
                </Field>
                <Field label="Maker rate (fraction)">
                  <Input type="number" step="0.0001" value={config.realism.fees.makerRate}
                    onChange={(e) => updateNested("realism", { fees: { ...config.realism.fees, makerRate: Math.max(0, Number(e.target.value) || 0) } })}
                    className={inpCls} />
                </Field>
                <Field label="Taker rate (fraction)">
                  <Input type="number" step="0.0001" value={config.realism.fees.takerRate}
                    onChange={(e) => updateNested("realism", { fees: { ...config.realism.fees, takerRate: Math.max(0, Number(e.target.value) || 0) } })}
                    className={inpCls} />
                </Field>
                <Field label="Taker threshold (min)">
                  <Input type="number" value={Math.round(config.realism.fees.takerThresholdMs / 60_000)}
                    onChange={(e) => updateNested("realism", { fees: { ...config.realism.fees, takerThresholdMs: Math.max(0, Number(e.target.value) || 0) * 60_000 } })}
                    className={inpCls} />
                </Field>
              </Grid>
              <p className="text-[10px] text-muted-foreground mt-2 font-mono">
                Exit &lt; taker threshold → market/taker (higher fee). Longer holds → limit/maker. Slippage applied against you on entry & exit.
              </p>
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
                    <Stat label="Gross P&L" value={`$${data.labStats.totalPnlUsd.toFixed(2)}`} />
                    <Stat label="Fees" value={`$${data.labStats.totalFeesUsd.toFixed(2)}`} />
                    <Stat label="Net P&L" value={`$${data.labStats.netPnlUsd.toFixed(2)}`} />
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
                          <th className="py-1 pr-3">Gross $</th>
                          <th className="py-1 pr-3">Fees $</th>
                          <th className="py-1 pr-3">Net $</th>
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
                            <td className="py-1 pr-3 text-muted-foreground">{t.feesUsd.toFixed(2)}</td>
                            <td className={`py-1 pr-3 ${t.netPnlUsd > 0 ? "text-emerald-500" : t.netPnlUsd < 0 ? "text-red-500" : ""}`}>{t.netPnlUsd.toFixed(2)}</td>
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
function ChipsMultiLabeled({ title, values, options, onChange }: { title: string; values: string[]; options: string[]; onChange: (v: string[]) => void }) {
  const allOn = values.length === options.length;
  const noneOn = values.length === 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">{title}</div>
        <div className="text-[10px] font-mono text-muted-foreground">
          {noneOn ? "no filter" : allOn ? "all" : `${values.length}/${options.length}`}
        </div>
        <button type="button" className="text-[10px] font-mono text-primary hover:underline"
          onClick={() => onChange(options)}>select all</button>
        <button type="button" className="text-[10px] font-mono text-muted-foreground hover:text-foreground"
          onClick={() => onChange([])}>clear</button>
      </div>
      <ChipsMulti values={values} options={options} onChange={onChange} />
    </div>
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

function KPI({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "pos" | "neg" }) {
  const color = tone === "pos" ? "text-emerald-500" : tone === "neg" ? "text-red-500" : "";
  return (
    <div className="rounded border border-border/60 p-2">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-mono">{label}</div>
      <div className={`text-sm font-mono font-semibold ${color}`}>{value}</div>
      {sub && <div className="text-[9px] text-muted-foreground font-mono">{sub}</div>}
    </div>
  );
}

function BucketTable({ rows, keyLabel }: { rows: Array<{ key: string; trades: number; wins: number; losses: number; winRate: number; pnlUsd: number; profitFactor: number; expectancyR: number }>; keyLabel: string }) {
  if (!rows.length) return <div className="text-xs text-muted-foreground p-2">No trades.</div>;
  return (
    <div className="overflow-x-auto max-h-[360px] border border-border/50 rounded-md mt-2">
      <table className="w-full text-[11px] font-mono">
        <thead className="sticky top-0 bg-background">
          <tr className="text-left border-b text-muted-foreground">
            <th className="py-1 px-2">{keyLabel}</th>
            <th className="py-1 px-2 text-right">Trades</th>
            <th className="py-1 px-2 text-right">Wins</th>
            <th className="py-1 px-2 text-right">Losses</th>
            <th className="py-1 px-2 text-right">Win %</th>
            <th className="py-1 px-2 text-right">PF</th>
            <th className="py-1 px-2 text-right">Exp (R)</th>
            <th className="py-1 px-2 text-right">P&L $</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-border/30">
              <td className="py-1 px-2">{r.key}</td>
              <td className="py-1 px-2 text-right">{r.trades}</td>
              <td className="py-1 px-2 text-right text-emerald-500">{r.wins}</td>
              <td className="py-1 px-2 text-right text-red-500">{r.losses}</td>
              <td className="py-1 px-2 text-right">{r.winRate.toFixed(1)}</td>
              <td className="py-1 px-2 text-right">{r.profitFactor === 999 ? "∞" : r.profitFactor.toFixed(2)}</td>
              <td className="py-1 px-2 text-right">{r.expectancyR.toFixed(2)}</td>
              <td className={`py-1 px-2 text-right ${r.pnlUsd > 0 ? "text-emerald-500" : r.pnlUsd < 0 ? "text-red-500" : ""}`}>{r.pnlUsd.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

