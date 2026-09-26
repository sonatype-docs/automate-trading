import { useEffect, useRef, useState } from "react";
import { Activity, Radio, Wifi, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type StreamState = "idle" | "connecting" | "connected" | "reconnecting" | "error";
type Tick = { event: string; ts: number; price: number | null; close: number | null; volume: number | null };

function decodeSocketIoPacket(raw: string): { event: string; data: unknown } | null {
  if (!raw.startsWith("42")) return null;
  try {
    const parsed = JSON.parse(raw.slice(2)) as [string, unknown];
    return { event: parsed[0], data: parsed[1] };
  } catch {
    return null;
  }
}
function numberFrom(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function SharkMarketStreamCard() {
  const [symbol, setSymbol] = useState("XAUUSDT");
  const [state, setState] = useState<StreamState>("idle");
  const [tick, setTick] = useState<Tick | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const retryRef = useRef(0);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      setState(retryRef.current ? "reconnecting" : "connecting");
      const ws = new WebSocket("wss://fawss.sharkexchange.in/socket.io/?EIO=4&transport=websocket");
      socket = ws;
      ws.onopen = () => {
        retryRef.current = 0;
        setLastError(null);
        setState("connected");
        ws.send("40");
      };
      ws.onmessage = (message) => {
        const raw = typeof message.data === "string" ? message.data : "";
        if (raw === "2") { ws.send("3"); return; }
        if (raw.startsWith("40")) {
          ws.send(JSON.stringify(["subscribe", { params: [
            symbol.toLowerCase() + "@kline_1m",
            symbol.toLowerCase() + "@markPrice",
          ]}]));
          return;
        }
        const packet = decodeSocketIoPacket(raw);
        if (!packet) return;
        const data = (packet.data ?? {}) as Record<string, unknown>;
        const k = (data.k ?? data) as Record<string, unknown>;
        setTick({
          event: packet.event,
          ts: Date.now(),
          price: numberFrom(data.p ?? data.price ?? k.c ?? k.close),
          close: numberFrom(k.c ?? k.close),
          volume: numberFrom(k.v ?? k.volume),
        });
      };
      ws.onerror = () => { setLastError("WebSocket connection error"); setState("error"); };
      ws.onclose = () => {
        if (stopped) return;
        retryRef.current += 1;
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(retryRef.current - 1, 5));
        timer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      socket?.close();
    };
  }, [symbol]);

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm flex items-center gap-2"><Radio className="h-4 w-4" /> Shark live market stream</CardTitle>
            <div className="text-[11px] text-muted-foreground">Native Socket.IO transport · 1m kline + mark price · reconnects automatically</div>
          </div>
          <Badge variant={state === "connected" ? "default" : state === "error" ? "destructive" : "secondary"}>
            {state === "connected" ? <Wifi className="h-3 w-3 mr-1" /> : <WifiOff className="h-3 w-3 mr-1" />}
            {state}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <Input className="w-32" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
        <div className="rounded border border-border px-3 py-2 min-w-32"><div className="text-[10px] uppercase tracking-widest text-muted-foreground">Last price</div><div className="font-mono text-sm">{tick?.price?.toLocaleString() ?? "—"}</div></div>
        <div className="rounded border border-border px-3 py-2 min-w-32"><div className="text-[10px] uppercase tracking-widest text-muted-foreground">1m close</div><div className="font-mono text-sm">{tick?.close?.toLocaleString() ?? "—"}</div></div>
        <div className="rounded border border-border px-3 py-2 min-w-32"><div className="text-[10px] uppercase tracking-widest text-muted-foreground">Volume</div><div className="font-mono text-sm">{tick?.volume?.toLocaleString() ?? "—"}</div></div>
        <div className="text-[10px] text-muted-foreground flex items-center gap-1"><Activity className="h-3 w-3" />{tick ? tick.event + " · " + new Date(tick.ts).toLocaleTimeString() : "Waiting for stream…"}</div>
        {lastError && <div className="basis-full text-xs text-destructive">{lastError}</div>}
      </CardContent>
    </Card>
  );
}
