// Live candlestick chart for the Live Trading page.
// - Candles pulled every 30s (last N bars).
// - Tick price polled every 2s and updates the last candle in place.
// - Entry / SL / TP drawn as horizontal price lines when a trade is open.
// - Setup / signal markers overlaid on the chart.
// - Right panel shows live P&L, R multiple, direction, qty, elapsed.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  createChart, CandlestickSeries, HistogramSeries, LineSeries,
  CrosshairMode, LineStyle,
  type IChartApi, type ISeriesApi, type IPriceLine, type UTCTimestamp,
  type SeriesMarker,
  createSeriesMarkers,
} from "lightweight-charts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { RefreshCw, Activity, TrendingUp, TrendingDown, CheckCircle2, XCircle, Clock } from "lucide-react";
import {
  getLiveChartData, getLastPrice, listLiveRunners, listLiveTrades,
  type LiveChartDataDTO, type LiveTradeDTO,
} from "@/lib/live-trading.functions";
import { queryTrades } from "@/lib/trade-intelligence.functions";


function useElapsed(sinceIso: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (!sinceIso) return "—";
  const ms = now - new Date(sinceIso).getTime();
  if (ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

const DISPLAY_TFS = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"] as const;
type DisplayTf = typeof DISPLAY_TFS[number];

export interface OverlayFlags {
  vwap: boolean;
  ema20: boolean;
  ema50: boolean;
  ema200: boolean;
  adx: boolean;
  atr: boolean;
}

export function LiveChartCard() {
  const runnersFn = useServerFn(listLiveRunners);
  const runners = useQuery({
    queryKey: ["live-runners"], queryFn: () => runnersFn(), refetchInterval: 10_000,
  });
  const [runnerId, setRunnerId] = useState<string | null>(null);
  const [tf, setTf] = useState<DisplayTf | null>(null);
  const [overlays, setOverlays] = useState<OverlayFlags>({
    vwap: true, ema20: false, ema50: true, ema200: true, adx: true, atr: false,
  });

  // Default to first running runner, else first runner.
  useEffect(() => {
    if (runnerId || !runners.data?.length) return;
    const running = runners.data.find((r) => r.running);
    setRunnerId((running ?? runners.data[0])?.id ?? null);
  }, [runners.data, runnerId]);

  const dataFn = useServerFn(getLiveChartData);
  const chartQ = useQuery({
    queryKey: ["live-chart", runnerId, tf],
    queryFn: () => dataFn({ data: {
      runner_id: runnerId!, bars: 200,
      ...(tf ? { timeframe: tf } : {}),
    } }),
    enabled: !!runnerId,
    refetchInterval: 30_000,
  });

  const priceFn = useServerFn(getLastPrice);
  const priceQ = useQuery({
    queryKey: ["live-price", chartQ.data?.symbol],
    queryFn: () => priceFn({ data: { symbol: chartQ.data!.symbol } }),
    enabled: !!chartQ.data?.symbol,
    refetchInterval: 2_000,
  });

  const tradesFn = useServerFn(listLiveTrades);
  const tradesQ = useQuery({
    queryKey: ["live-trades-recent"],
    queryFn: () => tradesFn({ data: { limit: 50 } }),
    refetchInterval: 15_000,
  });
  const liveRecent = useMemo(() => {
    const rows = (tradesQ.data ?? []).filter((t) => !!t.exit_ts);
    if (!runnerId) return rows.slice(0, 10);
    return rows.filter((t) => t.runner_id === runnerId).slice(0, 10);
  }, [tradesQ.data, runnerId]);

  // Fallback: no live trades yet — show last 10 backtest trades for this symbol.
  const symbol = chartQ.data?.symbol;
  const btFn = useServerFn(queryTrades);
  const btQ = useQuery({
    queryKey: ["bt-trades-recent", symbol],
    queryFn: () => btFn({ data: { symbol, limit: 10, orderBy: "exit_time", order: "desc" } }),
    enabled: !!symbol && liveRecent.length === 0 && !tradesQ.isPending,
    refetchInterval: 60_000,
  });
  const recentTrades: RecentTradeItem[] = useMemo(() => {
    if (liveRecent.length > 0) return liveRecent.map(liveToItem);
    return (btQ.data?.rows ?? []).map(recordToItem);
  }, [liveRecent, btQ.data]);
  const usingBacktest = liveRecent.length === 0 && (btQ.data?.rows.length ?? 0) > 0;
  const tradesLoading = tradesQ.isPending || (liveRecent.length === 0 && btQ.isPending);

  const livePrice = priceQ.data?.price ?? chartQ.data?.lastPrice ?? null;
  const runnerTf = chartQ.data?.runnerTimeframe;
  const activeTf = (tf ?? runnerTf ?? null) as DisplayTf | null;

  const overlayToggle = (key: keyof OverlayFlags, label: string) => (
    <Toggle
      key={key}
      size="sm"
      pressed={overlays[key]}
      onPressedChange={(v) => setOverlays((o) => ({ ...o, [key]: v }))}
      className="h-7 px-2 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
    >
      {label}
    </Toggle>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Live chart
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Candlestick view with setup markings, live price ticks, and open-trade levels overlaid.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={runnerId ?? undefined} onValueChange={setRunnerId}>
            <SelectTrigger className="h-8 w-[260px]"><SelectValue placeholder="Pick a runner" /></SelectTrigger>
            <SelectContent>
              {(runners.data ?? []).map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.label} · {r.symbol} · {r.timeframe} {r.running ? "· LIVE" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => chartQ.refetch()} disabled={chartQ.isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1 ${chartQ.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!runnerId && <p className="text-sm text-muted-foreground">Choose a runner to load its chart.</p>}
        {runnerId && chartQ.isPending && <p className="text-sm text-muted-foreground">Loading chart…</p>}
        {runnerId && chartQ.error && (
          <p className="text-sm text-destructive">
            {chartQ.error instanceof Error ? chartQ.error.message : String(chartQ.error)}
          </p>
        )}
        {chartQ.data && (
          <div className="space-y-4">
            {/* Toolbar: TF toggle + overlay toggles */}
            <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/20 px-2 py-1.5">
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-muted-foreground mr-1">TF</span>
                {DISPLAY_TFS.map((t) => (
                  <Button
                    key={t} size="sm"
                    variant={activeTf === t ? "default" : "outline"}
                    className="h-7 px-2 text-xs"
                    onClick={() => setTf(t)}
                  >
                    {t}{runnerTf === t ? "*" : ""}
                  </Button>
                ))}
                {tf && tf !== runnerTf && (
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                    onClick={() => setTf(null)}>reset</Button>
                )}
                {runnerTf && (
                  <span className="text-[10px] text-muted-foreground ml-1">
                    strategy runs on <b>{runnerTf}</b>
                  </span>
                )}
              </div>
              <div className="h-5 w-px bg-border" />
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[11px] text-muted-foreground mr-1">Overlays</span>
                {overlayToggle("vwap", "VWAP")}
                {overlayToggle("ema20", "EMA20")}
                {overlayToggle("ema50", "EMA50")}
                {overlayToggle("ema200", "EMA200")}
                {overlayToggle("adx", "ADX")}
                {overlayToggle("atr", "ATR")}
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4">
              <ChartCanvas data={chartQ.data} livePrice={livePrice} overlays={overlays} />
              <TradeSidePanel data={chartQ.data} livePrice={livePrice} />
            </div>
            <RecentTradesStrip trades={recentTrades} loading={tradesLoading} source={usingBacktest ? "backtest" : "live"} />
            <PlanPanel data={chartQ.data} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}



const OVERLAY_META: Record<keyof OverlayFlags, { color: string; pane: 0 | 1 | 2; title: string }> = {
  vwap:   { color: "#f59e0b", pane: 0, title: "VWAP" },
  ema20:  { color: "#38bdf8", pane: 0, title: "EMA20" },
  ema50:  { color: "#a78bfa", pane: 0, title: "EMA50" },
  ema200: { color: "#f472b6", pane: 0, title: "EMA200" },
  adx:    { color: "#22d3ee", pane: 1, title: "ADX" },
  atr:    { color: "#fbbf24", pane: 2, title: "ATR" },
};

function ChartCanvas({ data, livePrice, overlays }: {
  data: LiveChartDataDTO; livePrice: number | null; overlays: OverlayFlags;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const overlaySeriesRef = useRef<Partial<Record<keyof OverlayFlags, ISeriesApi<"Line">>>>({});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<any>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const lastCandleRef = useRef<{ time: UTCTimestamp; open: number; high: number; low: number; close: number } | null>(null);

  // Build chart once.
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { color: "rgba(0,0,0,0)" },
        textColor: "#94a3b8",
        panes: { separatorColor: "rgba(120,120,120,0.2)", separatorHoverColor: "rgba(120,120,120,0.35)" },
      },
      grid: {
        vertLines: { color: "rgba(120,120,120,0.1)" },
        horzLines: { color: "rgba(120,120,120,0.1)" },
      },
      rightPriceScale: { borderColor: "rgba(120,120,120,0.2)" },
      timeScale: { borderColor: "rgba(120,120,120,0.2)", timeVisible: true, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981", downColor: "#ef4444",
      borderUpColor: "#10b981", borderDownColor: "#ef4444",
      wickUpColor: "#10b981", wickDownColor: "#ef4444",
    });
    const vol = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      color: "rgba(120,120,120,0.4)",
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    chartRef.current = chart;
    candleSeriesRef.current = candles;
    volSeriesRef.current = vol;
    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volSeriesRef.current = null;
      overlaySeriesRef.current = {};
      markersRef.current = null;
      linesRef.current = [];
    };
  }, []);

  // Manage overlay line series based on flags.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const current = overlaySeriesRef.current;
    (Object.keys(OVERLAY_META) as (keyof OverlayFlags)[]).forEach((k) => {
      const want = overlays[k];
      const has = !!current[k];
      if (want && !has) {
        const meta = OVERLAY_META[k];
        const s = chart.addSeries(LineSeries, {
          color: meta.color, lineWidth: 2, priceLineVisible: false,
          lastValueVisible: true, title: meta.title,
        }, meta.pane);
        current[k] = s;
      } else if (!want && has) {
        try { chart.removeSeries(current[k]!); } catch { /* noop */ }
        delete current[k];
      }
    });
  }, [overlays]);



  // Push candles + markers + price lines whenever data changes.
  useEffect(() => {
    const candles = candleSeriesRef.current;
    const vol = volSeriesRef.current;
    if (!candles || !vol) return;

    const cData = data.candles.map((c) => ({
      time: c.t as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c,
    }));
    const vData = data.candles.map((c) => ({
      time: c.t as UTCTimestamp, value: c.v,
      color: c.c >= c.o ? "rgba(16,185,129,0.35)" : "rgba(239,68,68,0.35)",
    }));
    candles.setData(cData);
    vol.setData(vData);
    const last = cData[cData.length - 1];
    if (last) lastCandleRef.current = { ...last };

    // Overlay series data — filter out nulls (line series doesn't accept them).
    const overlayData = {
      vwap: data.series.vwap, ema20: data.series.ema20, ema50: data.series.ema50,
      ema200: data.series.ema200, adx: data.series.adx, atr: data.series.atr,
    } as const;
    (Object.keys(overlayData) as (keyof OverlayFlags)[]).forEach((k) => {
      const s = overlaySeriesRef.current[k];
      if (!s) return;
      const pts = overlayData[k]
        .filter((p) => p.v != null && Number.isFinite(p.v))
        .map((p) => ({ time: p.t as UTCTimestamp, value: p.v as number }));
      s.setData(pts);
    });


    // Markers.
    const seriesMarkers: SeriesMarker<UTCTimestamp>[] = data.markers.map((m) => {
      if (m.kind === "signal_long") return {
        time: m.time as UTCTimestamp, position: "belowBar", color: "#10b981", shape: "arrowUp", text: m.label,
      };
      if (m.kind === "signal_short") return {
        time: m.time as UTCTimestamp, position: "aboveBar", color: "#ef4444", shape: "arrowDown", text: m.label,
      };
      if (m.kind === "invalidated") return {
        time: m.time as UTCTimestamp, position: "aboveBar", color: "#f59e0b", shape: "circle", text: "×",
      };
      return {
        time: m.time as UTCTimestamp, position: "belowBar", color: "#60a5fa", shape: "circle", text: m.label,
      };
    });
    if (markersRef.current) {
      markersRef.current.setMarkers(seriesMarkers);
    } else {
      markersRef.current = createSeriesMarkers(candles, seriesMarkers);
    }

    // Clear existing price lines.
    for (const pl of linesRef.current) candles.removePriceLine(pl);
    linesRef.current = [];

    const draw = (price: number, color: string, title: string, style = LineStyle.Solid) => {
      const pl = candles.createPriceLine({
        price, color, lineWidth: 2, lineStyle: style, axisLabelVisible: true, title,
      });
      linesRef.current.push(pl);
    };

    if (data.activeTrade) {
      const t = data.activeTrade;
      draw(Number(t.fill_price ?? t.entry_price), "#60a5fa", `Entry ${t.direction.toUpperCase()}`);
      draw(Number(t.stop_price), "#ef4444", "SL");
      draw(Number(t.target_price), "#10b981", "TP");
    } else if (data.pendingSignal) {
      const p = data.pendingSignal;
      draw(p.entryPrice, "#60a5fa", `Pending ${p.direction.toUpperCase()}`, LineStyle.Dashed);
      draw(p.stop, "#ef4444", "SL", LineStyle.Dashed);
      draw(p.target, "#10b981", "TP", LineStyle.Dashed);
    }

    chartRef.current?.timeScale().fitContent();
  }, [data, overlays]);

  // Tick — update the last candle with the polled price.
  useEffect(() => {
    if (livePrice == null) return;
    const candles = candleSeriesRef.current;
    const last = lastCandleRef.current;
    if (!candles || !last) return;
    const updated = {
      time: last.time, open: last.open,
      high: Math.max(last.high, livePrice),
      low: Math.min(last.low, livePrice),
      close: livePrice,
    };
    lastCandleRef.current = updated;
    candles.update(updated);
  }, [livePrice]);

  return <div ref={containerRef} className="h-[560px] w-full rounded-md border" />;
}

function TradeSidePanel({ data, livePrice }: { data: LiveChartDataDTO; livePrice: number | null }) {
  const t = data.activeTrade;
  const elapsed = useElapsed(t?.entry_ts ?? null);

  const stats = useMemo(() => {
    if (!t || livePrice == null) return null;
    const entry = Number(t.fill_price ?? t.entry_price);
    const qty = Number(t.qty);
    const sl = Number(t.stop_price);
    const tp = Number(t.target_price);
    const long = t.direction === "long";
    const pnl = long ? (livePrice - entry) * qty : (entry - livePrice) * qty;
    const risk = Math.abs(entry - sl);
    const rNow = risk > 0 ? (long ? (livePrice - entry) / risk : (entry - livePrice) / risk) : 0;
    const distToSlPct = entry > 0 ? Math.abs(livePrice - sl) / entry * 100 : 0;
    const distToTpPct = entry > 0 ? Math.abs(tp - livePrice) / entry * 100 : 0;
    const rrPlanned = risk > 0 ? Math.abs(tp - entry) / risk : 0;
    return { entry, qty, sl, tp, long, pnl, rNow, distToSlPct, distToTpPct, rrPlanned };
  }, [t, livePrice]);

  return (
    <div className="space-y-2 text-xs">
      <div className="rounded-md border p-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Last price</span>
          <span className="font-mono text-sm font-semibold">{livePrice != null ? livePrice.toFixed(2) : "—"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Symbol · TF</span>
          <span className="font-mono">{data.symbol} · {data.timeframe}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Strategy</span>
          <span className="font-mono truncate max-w-[140px]" title={data.strategy_preset}>{data.strategy_preset}</span>
        </div>
      </div>

      {t ? (
        <div className="rounded-md border p-3 space-y-1.5">
          <div className="flex items-center justify-between mb-1">
            <span className="font-medium">Open trade</span>
            <Badge variant={t.direction === "long" ? "default" : "destructive"} className="gap-1">
              {t.direction === "long" ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {t.direction.toUpperCase()}
            </Badge>
          </div>
          <Row k="Status" v={t.status} />
          <Row k="Qty" v={Number(t.qty).toFixed(4)} />
          <Row k="Entry" v={Number(t.fill_price ?? t.entry_price).toFixed(2)} />
          <Row k="Stop" v={Number(t.stop_price).toFixed(2)} tone="loss" />
          <Row k="Target" v={Number(t.target_price).toFixed(2)} tone="gain" />
          <Row k="Elapsed" v={elapsed} />
          {stats && (
            <>
              <div className="border-t my-1" />
              <Row k="Unrealised P&L"
                v={`${stats.pnl >= 0 ? "+" : ""}$${stats.pnl.toFixed(2)}`}
                tone={stats.pnl >= 0 ? "gain" : "loss"} bold />
              <Row k="R now" v={`${stats.rNow >= 0 ? "+" : ""}${stats.rNow.toFixed(2)}R`}
                tone={stats.rNow >= 0 ? "gain" : "loss"} />
              <Row k="Planned RR" v={`${stats.rrPlanned.toFixed(2)}R`} />
              <Row k="Dist to SL" v={`${stats.distToSlPct.toFixed(2)}%`} tone="loss" />
              <Row k="Dist to TP" v={`${stats.distToTpPct.toFixed(2)}%`} tone="gain" />
            </>
          )}
        </div>
      ) : data.pendingSignal ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-1.5">
          <div className="flex items-center justify-between mb-1">
            <span className="font-medium">Pending signal (waiting to fill)</span>
            <Badge variant="outline">{data.pendingSignal.direction.toUpperCase()}</Badge>
          </div>
          <Row k="Entry" v={data.pendingSignal.entryPrice.toFixed(2)} />
          <Row k="Stop" v={data.pendingSignal.stop.toFixed(2)} tone="loss" />
          <Row k="Target" v={data.pendingSignal.target.toFixed(2)} tone="gain" />
        </div>
      ) : (
        <div className="rounded-md border p-3 text-muted-foreground">
          No open trade. Chart shows recent setup markings for context.
        </div>
      )}
    </div>
  );
}

function Row({ k, v, tone, bold }: {
  k: string; v: string; tone?: "gain" | "loss"; bold?: boolean;
}) {
  const cls = tone === "gain" ? "text-emerald-500" : tone === "loss" ? "text-destructive" : "";
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{k}</span>
      <span className={`font-mono ${cls} ${bold ? "font-semibold" : ""}`}>{v}</span>
    </div>
  );
}

function PlanPanel({ data }: { data: LiveChartDataDTO }) {
  const p = data.plan;
  const hasActive = !!data.activeTrade;
  const hasPending = !!data.pendingSignal;
  const lastSetup = p.recentSetups[p.recentSetups.length - 1] ?? null;

  let statusText = "Scanning for setup";
  let statusTone: "ok" | "warn" | "block" = "warn";
  if (hasActive) { statusText = "Trade open — managing"; statusTone = "ok"; }
  else if (hasPending) { statusText = "Setup ready — waiting for entry trigger"; statusTone = "ok"; }
  else if (!p.windowActive) { statusText = `Session closed${p.nextOpenMinutes != null ? ` · opens in ${p.nextOpenMinutes}m` : ""}`; statusTone = "block"; }
  else if (p.failCount > 0) { statusText = `${p.failCount} filter${p.failCount === 1 ? "" : "s"} blocking a new entry`; statusTone = "block"; }
  else if (p.setupsDetected === 0) { statusText = "Filters clear — no setup pattern on recent bars"; statusTone = "warn"; }
  else { statusText = "Filters clear — waiting for next setup"; statusTone = "warn"; }

  const toneCls = statusTone === "ok"
    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
    : statusTone === "block"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : "border-amber-500/40 bg-amber-500/10 text-amber-500";

  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-1 rounded border ${toneCls} font-medium`}>{statusText}</span>
          <span className="text-xs text-muted-foreground">
            Session: <span className="font-mono">{p.lastBar?.session ?? "—"}</span>
            {" · "}Window: <span className="font-mono">{p.windowActive ? "OPEN" : "CLOSED"}</span>
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>Setups: <b className="text-foreground">{p.setupsDetected}</b></span>
          <span>Signals: <b className="text-foreground">{p.signalsCreated}</b></span>
          <span>Invalidated: <b className="text-foreground">{p.signalsInvalidated}</b></span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <div className="text-xs font-medium mb-1.5">Entry filters (last bar)</div>
          {p.rules.length === 0 ? (
            <p className="text-xs text-muted-foreground">No filters configured.</p>
          ) : (
            <div className="space-y-1">
              {p.rules.map((r, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  {r.pass
                    ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
                    : <XCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{r.label}</div>
                    <div className="text-muted-foreground truncate" title={r.actual}>{r.actual}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="text-xs font-medium mb-1.5 flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" /> What we're waiting for
          </div>
          {hasActive ? (
            <p className="text-xs text-muted-foreground">Trade is live. Watching SL / TP / trail; no new entry until it closes.</p>
          ) : hasPending && data.pendingSignal ? (
            <div className="text-xs space-y-1">
              <div>Setup detected — waiting for price to reach entry.</div>
              <div className="font-mono">
                {data.pendingSignal.direction.toUpperCase()} @ {data.pendingSignal.entryPrice.toFixed(2)}
                {" · "}SL {data.pendingSignal.stop.toFixed(2)}
                {" · "}TP {data.pendingSignal.target.toFixed(2)}
              </div>
              {data.lastPrice != null && (
                <div className="text-muted-foreground">
                  Distance to entry: {(Math.abs(data.lastPrice - data.pendingSignal.entryPrice)).toFixed(2)}
                </div>
              )}
            </div>
          ) : !p.windowActive ? (
            <p className="text-xs text-muted-foreground">
              Strategy session is closed. New entries resume when the trading window opens
              {p.nextOpenMinutes != null ? ` (~${p.nextOpenMinutes} min).` : "."}
            </p>
          ) : p.blockingReasons.length ? (
            <ul className="text-xs list-disc pl-4 space-y-0.5 text-muted-foreground">
              {p.blockingReasons.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          ) : lastSetup ? (
            <div className="text-xs space-y-1">
              <div>Filters clear. Last setup detected:</div>
              <div className="font-mono">
                {lastSetup.kind} · {lastSetup.direction.toUpperCase()}
                {lastSetup.level != null ? ` @ ${lastSetup.level.toFixed(2)}` : ""}
              </div>
              <div className="text-muted-foreground">
                {new Date(lastSetup.ts).toLocaleString()}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              All filters pass, but no setup pattern has printed on the recent bars yet. Waiting for the next qualifying candle.
            </p>
          )}
        </div>
      </div>

      {p.recentSetups.length > 0 && (
        <div>
          <div className="text-xs font-medium mb-1.5">Recent setups on chart</div>
          <div className="flex flex-wrap gap-1.5">
            {p.recentSetups.slice(-8).reverse().map((s, i) => (
              <span key={i} className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-muted/40">
                {new Date(s.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                {" · "}{s.kind}
                {" · "}{s.direction}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RecentTradesStrip({ trades, loading }: { trades: LiveTradeDTO[]; loading: boolean }) {
  const totalPnl = trades.reduce((a, t) => a + (Number(t.net_pnl) || 0), 0);
  const wins = trades.filter((t) => (Number(t.net_pnl) || 0) > 0).length;
  const winRate = trades.length ? (wins / trades.length) * 100 : 0;

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs font-medium">Last {trades.length || 10} closed trades</div>
        {trades.length > 0 && (
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span>Win rate: <b className="text-foreground">{winRate.toFixed(0)}%</b> ({wins}/{trades.length})</span>
            <span>
              Net P&amp;L:{" "}
              <b className={totalPnl >= 0 ? "text-emerald-500" : "text-destructive"}>
                {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
              </b>
            </span>
          </div>
        )}
      </div>
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading trades…</p>
      ) : trades.length === 0 ? (
        <p className="text-xs text-muted-foreground">No closed trades yet.</p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {trades.map((t) => {
            const pnl = Number(t.net_pnl) || 0;
            const rr = t.rr != null ? Number(t.rr) : null;
            const win = pnl > 0;
            const long = t.direction === "long";
            return (
              <div
                key={t.id}
                className={`shrink-0 min-w-[150px] rounded-md border px-2.5 py-1.5 text-xs
                  ${win ? "border-emerald-500/40 bg-emerald-500/10" : "border-destructive/40 bg-destructive/10"}`}
                title={new Date(t.entry_ts).toLocaleString()}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className={`font-mono text-[10px] px-1 py-0.5 rounded ${long ? "bg-emerald-500/20 text-emerald-500" : "bg-destructive/20 text-destructive"}`}>
                    {long ? <TrendingUp className="inline h-3 w-3 mr-0.5" /> : <TrendingDown className="inline h-3 w-3 mr-0.5" />}
                    {t.direction.toUpperCase()}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(t.exit_ts ?? t.entry_ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <div className={`font-mono font-semibold mt-1 ${win ? "text-emerald-500" : "text-destructive"}`}>
                  {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
                </div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-0.5">
                  <span>{rr != null ? `${rr >= 0 ? "+" : ""}${rr.toFixed(2)}R` : "—"}</span>
                  <span className="truncate max-w-[80px]" title={t.exit_reason ?? ""}>
                    {t.exit_reason ?? t.status}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


