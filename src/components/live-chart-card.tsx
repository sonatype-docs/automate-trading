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
  createChart, CandlestickSeries, HistogramSeries,
  CrosshairMode, LineStyle,
  type IChartApi, type ISeriesApi, type IPriceLine, type UTCTimestamp,
  type SeriesMarker,
  createSeriesMarkers,
  type ISeriesMarkersPluginApi,
} from "lightweight-charts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, Activity, TrendingUp, TrendingDown } from "lucide-react";
import {
  getLiveChartData, getLastPrice, listLiveRunners,
  type LiveChartDataDTO,
} from "@/lib/live-trading.functions";

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

export function LiveChartCard() {
  const runnersFn = useServerFn(listLiveRunners);
  const runners = useQuery({
    queryKey: ["live-runners"], queryFn: () => runnersFn(), refetchInterval: 10_000,
  });
  const [runnerId, setRunnerId] = useState<string | null>(null);

  // Default to first running runner, else first runner.
  useEffect(() => {
    if (runnerId || !runners.data?.length) return;
    const running = runners.data.find((r) => r.running);
    setRunnerId((running ?? runners.data[0])?.id ?? null);
  }, [runners.data, runnerId]);

  const dataFn = useServerFn(getLiveChartData);
  const chartQ = useQuery({
    queryKey: ["live-chart", runnerId],
    queryFn: () => dataFn({ data: { runner_id: runnerId!, bars: 200 } }),
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

  const livePrice = priceQ.data?.price ?? chartQ.data?.lastPrice ?? null;

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
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4">
            <ChartCanvas data={chartQ.data} livePrice={livePrice} />
            <TradeSidePanel data={chartQ.data} livePrice={livePrice} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ChartCanvas({ data, livePrice }: { data: LiveChartDataDTO; livePrice: number | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
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
        background: { color: "transparent" },
        textColor: getComputedStyle(document.documentElement).getPropertyValue("--foreground") || "#888",
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
      markersRef.current = null;
      linesRef.current = [];
    };
  }, []);

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
  }, [data]);

  // Tick — update the last candle with the polled price.
  useEffect(() => {
    if (livePrice == null) return;
    const candles = candleSeriesRef.current;
    const last = lastCandleRef.current;
    if (!candles || !last) return;
    const updated = {
      time: last.t, open: last.o,
      high: Math.max(last.h, livePrice),
      low: Math.min(last.l, livePrice),
      close: livePrice,
    };
    lastCandleRef.current = updated;
    candles.update(updated);
  }, [livePrice]);

  return <div ref={containerRef} className="h-[440px] w-full rounded-md border" />;
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
