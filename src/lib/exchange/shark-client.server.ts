/**
 * SharkExchange REST client (server-only).
 * Docs: https://docs.sharkexchange.in/
 *
 * Auth: `api-key` header + `signature` header.
 * Signature = HMAC-SHA256(secret, dataToSign) hex.
 *   - GET:                dataToSign = querystring (must include `timestamp`)
 *   - POST/PATCH/PUT/DEL: dataToSign = JSON.stringify(body) with body.timestamp set,
 *                                     using JSON.stringify default separators
 *                                     (matches the SDK's `JSON.stringify(params)`).
 */

import { createHmac } from "node:crypto";

export interface PlaceOrderParams {
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  type?: "market" | "limit";
  price?: number;
  reduceOnly?: boolean;
  marginAsset?: string;
  stopLossPrice?: number;
  takeProfitPrice?: number;
}

export interface OrderResult {
  exchangeOrderId: string;
  status: "filled" | "pending" | "rejected";
  filledPrice?: number;
  raw?: unknown;
}

export interface TestConnectionResult {
  ok: boolean;
  status: number;
  message: string;
  sample?: unknown;
}

export interface AccountSnapshot {
  futuresWallet: unknown;
  fundingWallet: unknown;
  openPositions: unknown;
  openOrders: unknown;
  tradeHistory: unknown;
  transactionHistory: unknown;
  errors: Record<string, string>;
}

export interface Kline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

export interface ExchangeClient {
  placeOrder(p: PlaceOrderParams): Promise<OrderResult>;
  cancelOrder(clientOrderId: string, symbol?: string): Promise<{ ok: boolean; status: number; body: string }>;
  getOpenOrderIds(symbol?: string): Promise<string[]>;
  getFillForClientOrderId(clientOrderId: string): Promise<{ price: number; qty: number } | null>;
  testConnection(): Promise<TestConnectionResult>;
  getAccountSnapshot(): Promise<AccountSnapshot>;
  getKlines(
    symbol: string,
    interval?: string,
    limit?: number,
    opts?: { startTime?: number; endTime?: number },
  ): Promise<Kline[]>;
  getKlinesRange(
    symbol: string,
    interval: string,
    fromMs: number,
    toMs: number,
  ): Promise<Kline[]>;
  getLastPrice(symbol: string): Promise<number>;
}


const BASE_URL = "https://api.sharkexchange.in";

function sign(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

function inferMarginAsset(symbol: string): string {
  const s = symbol.toUpperCase();
  if (s.endsWith("USDT")) return "USDT";
  if (s.endsWith("INR")) return "INR";
  return "INR";
}

async function signedGet(
  apiKey: string,
  apiSecret: string,
  path: string,
  params: Record<string, string | number> = {},
): Promise<{ ok: boolean; status: number; body: string; json: unknown }> {
  const withTs = { ...params, timestamp: Date.now().toString() };
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(withTs).map(([k, v]) => [k, String(v)])),
  ).toString();
  const signature = sign(apiSecret, qs);
  const res = await fetch(`${BASE_URL}${path}?${qs}`, {
    method: "GET",
    headers: {
      "api-key": apiKey,
      signature,
      accept: "*/*",
    },
  });
  const body = await res.text();
  let json: unknown = null;
  try {
    json = body ? JSON.parse(body) : null;
  } catch {
    /* keep body as text */
  }
  return { ok: res.ok, status: res.status, body, json };
}

async function signedJson(
  apiKey: string,
  apiSecret: string,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  params: Record<string, unknown> = {},
): Promise<{ ok: boolean; status: number; body: string; json: unknown }> {
  const withTs = { ...params, timestamp: Date.now().toString() };
  const dataToSign = JSON.stringify(withTs);
  const signature = sign(apiSecret, dataToSign);
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      signature,
    },
    body: dataToSign,
  });
  const body = await res.text();
  let json: unknown = null;
  try {
    json = body ? JSON.parse(body) : null;
  } catch {
    /* keep body as text */
  }
  return { ok: res.ok, status: res.status, body, json };
}

function requireCreds(): { apiKey: string; apiSecret: string } {
  const apiKey = process.env.SHARKEXCHANGE_API_KEY?.trim();
  const apiSecret = process.env.SHARKEXCHANGE_API_SECRET?.trim();
  if (!apiKey || !apiSecret) {
    throw new Error(
      "SharkExchange API credentials are not configured. Add SHARKEXCHANGE_API_KEY and SHARKEXCHANGE_API_SECRET.",
    );
  }
  return { apiKey, apiSecret };
}


export function createSharkClient(): ExchangeClient {
  return {
    async placeOrder(p) {
      const { apiKey, apiSecret } = requireCreds();
      const type = (p.type ?? "market").toUpperCase() as "MARKET" | "LIMIT";
      // Round to sensible precision (XAUUSDT-style): qty 3dp, price 2dp.
      const qtyRounded = Math.round(p.qty * 1000) / 1000;
      const body: Record<string, unknown> = {
        placeType: "ORDER_FORM",
        quantity: qtyRounded,
        side: p.side.toUpperCase(),
        symbol: p.symbol.toUpperCase(),
        reduceOnly: p.reduceOnly ?? false,
        marginAsset: p.marginAsset ?? inferMarginAsset(p.symbol),
        type,
      };
      if (type === "LIMIT") {
        if (!p.price || p.price <= 0) {
          throw new Error("LIMIT orders require a positive price.");
        }
        body.price = Math.round(p.price * 100) / 100;
      }

      const res = await signedJson(apiKey, apiSecret, "POST", "/v1/order/place-order", body);
      if (!res.ok) {
        throw new Error(
          `SharkExchange placeOrder failed [${res.status}] body=${JSON.stringify(body)} resp=${res.body}`,
        );
      }
      const data = (res.json ?? {}) as {
        clientOrderId?: string;
        price?: number;
        filledAmount?: number;
        orderAmount?: number;
      };
      const filled = (data.filledAmount ?? 0) > 0;
      return {
        exchangeOrderId: data.clientOrderId ?? "",
        status: filled ? "filled" : "pending",
        filledPrice: data.price,
        raw: data,
      };
    },

    async cancelOrder(clientOrderId, symbol) {
      const { apiKey, apiSecret } = requireCreds();
      const body: Record<string, unknown> = { clientOrderId };
      if (symbol) body.symbol = symbol.toUpperCase();
      const res = await signedJson(apiKey, apiSecret, "POST", "/v1/order/cancel-order", body);
      return { ok: res.ok, status: res.status, body: res.body };
    },

    async getOpenOrderIds(symbol) {
      const { apiKey, apiSecret } = requireCreds();
      const params: Record<string, string | number> = { sortOrder: "desc", pageSize: "100" };
      if (symbol) params.symbol = symbol.toUpperCase();
      const res = await signedGet(apiKey, apiSecret, "/v1/order/open-orders", params);
      if (!res.ok) throw new Error(`open-orders failed [${res.status}]: ${res.body.slice(0, 200)}`);
      const rows =
        (res.json as { data?: unknown[] } | null)?.data ??
        (Array.isArray(res.json) ? (res.json as unknown[]) : []);
      const ids: string[] = [];
      for (const r of rows) {
        const o = r as Record<string, unknown>;
        const id =
          (o.clientOrderId as string | undefined) ??
          (o.orderId as string | undefined) ??
          (o.id as string | undefined);
        if (typeof id === "string" && id.length > 0) ids.push(id);
      }
      return ids;
    },

    async getFillForClientOrderId(clientOrderId) {
      const { apiKey, apiSecret } = requireCreds();
      const res = await signedGet(apiKey, apiSecret, "/v1/user-data/trade-history", {
        sortOrder: "desc",
        pageSize: "200",
      });
      if (!res.ok) return null;
      const rows =
        (res.json as { data?: unknown[] } | null)?.data ??
        (Array.isArray(res.json) ? (res.json as unknown[]) : []);
      for (const r of rows) {
        const o = r as Record<string, unknown>;
        const id =
          (o.clientOrderId as string | undefined) ??
          (o.orderId as string | undefined);
        if (id === clientOrderId) {
          const price = Number(o.price ?? o.fillPrice ?? o.avgPrice);
          const qty = Number(o.qty ?? o.quantity ?? o.filledAmount ?? 0);
          if (Number.isFinite(price) && price > 0) return { price, qty };
        }
      }
      return null;
    },

    async testConnection() {
      const { apiKey, apiSecret } = requireCreds();
      // Matches the Python example in SharkExchange docs and rules out
      // any URLSearchParams encoding differences.
      const res = await signedGet(apiKey, apiSecret, "/v1/user-data/trade-history", {});
      if (res.ok) {
        const rows = Array.isArray(res.json)
          ? res.json.length
          : Array.isArray((res.json as { data?: unknown[] } | null)?.data)
            ? (res.json as { data: unknown[] }).data.length
            : 0;
        return {
          ok: true,
          status: res.status,
          message: `Authenticated with SharkExchange. Trade-history probe returned ${rows} row(s).`,
          sample: res.json,
        };
      }
      return {
        ok: false,
        status: res.status,
        message: `SharkExchange rejected the request [${res.status}]: ${res.body.slice(0, 300)}`,
      };
    },

    async getAccountSnapshot() {
      const { apiKey, apiSecret } = requireCreds();
      const endpoints: Array<{ key: keyof AccountSnapshot; path: string; params: Record<string, string> }> = [
        { key: "futuresWallet", path: "/v1/wallet/futures-wallet/details", params: {} },
        { key: "fundingWallet", path: "/v1/wallet/funding-wallet/details", params: {} },
        { key: "openPositions", path: "/v1/positions/OPEN", params: { sortOrder: "desc", pageSize: "50" } },
        { key: "openOrders", path: "/v1/order/open-orders", params: { sortOrder: "desc", pageSize: "50" } },
        { key: "tradeHistory", path: "/v1/user-data/trade-history", params: { sortOrder: "desc", pageSize: "200" } },
        { key: "transactionHistory", path: "/v1/user-data/transaction-history", params: { sortOrder: "desc", pageSize: "200" } },
      ];
      const snap: AccountSnapshot = {
        futuresWallet: null,
        fundingWallet: null,
        openPositions: null,
        openOrders: null,
        tradeHistory: null,
        transactionHistory: null,
        errors: {},
      };
      await Promise.all(
        endpoints.map(async ({ key, path, params }) => {
          try {
            const res = await signedGet(apiKey, apiSecret, path, params);
            if (res.ok) {
              (snap as unknown as Record<string, unknown>)[key] = res.json ?? res.body;
            } else {
              snap.errors[key] = `[${res.status}] ${res.body.slice(0, 200)}`;
            }
          } catch (e) {
            snap.errors[key] = e instanceof Error ? e.message : String(e);
          }
        }),
      );
      return snap;
    },

    async getKlines(symbol, interval = "1h", limit = 100, opts) {
      const url = `${BASE_URL}/v1/market/klines`;
      const body: Record<string, unknown> = {
        pair: symbol.toUpperCase(),
        interval,
        limit: Math.min(Math.max(1, limit), 1500),
      };
      if (opts?.startTime) body.startTime = opts.startTime;
      if (opts?.endTime) body.endTime = opts.endTime;
      const res = await fetch(url, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`Klines failed [${res.status}]: ${text.slice(0, 300)}`);
      }
      let parsed: unknown = null;
      try { parsed = JSON.parse(text); } catch { throw new Error(`Klines not JSON: ${text.slice(0, 200)}`); }
      const rows =
        (parsed as { data?: unknown[] } | null)?.data ??
        (parsed as unknown[]);
      if (!Array.isArray(rows)) throw new Error(`Klines: unexpected shape`);
      const toNum = (v: unknown) => Number(v);
      return rows.map((r) => {
        if (Array.isArray(r)) {
          return {
            openTime: Number(r[0]),
            open: toNum(r[1]),
            high: toNum(r[2]),
            low: toNum(r[3]),
            close: toNum(r[4]),
            volume: toNum(r[5]),
            closeTime: Number(r[6] ?? r[0]),
          } as Kline;
        }
        const o = r as Record<string, unknown>;
        return {
          openTime: Number(o.openTime ?? o.startTime ?? o.t ?? o.open_time ?? 0),
          open: toNum(o.open ?? o.o),
          high: toNum(o.high ?? o.h),
          low: toNum(o.low ?? o.l),
          close: toNum(o.close ?? o.c),
          volume: toNum(o.volume ?? o.v ?? 0),
          closeTime: Number(o.closeTime ?? o.endTime ?? o.T ?? o.close_time ?? 0),
        } as Kline;
      });
    },

    async getKlinesRange(symbol, interval, fromMs, toMs) {
      // SharkExchange returns at most 1500 bars per call and, when startTime is far
      // in the past, silently returns only the most-recent bars anchored to endTime.
      // So we must page BACKWARD by walking endTime toward fromMs.
      const intervalMs =
        interval === "1m" ? 60_000 :
        interval === "5m" ? 5 * 60_000 :
        interval === "15m" ? 15 * 60_000 :
        interval === "30m" ? 30 * 60_000 :
        interval === "1h" ? 3_600_000 :
        interval === "4h" ? 4 * 3_600_000 :
        interval === "1d" ? 86_400_000 : 3_600_000;
      const PAGE = 1500;
      const out: Kline[] = [];
      const seen = new Set<number>();
      let endCursor = toMs;
      let guard = 0;
      while (endCursor > fromMs && guard < 50) {
        guard++;
        const startWindow = Math.max(fromMs, endCursor - PAGE * intervalMs);
        const chunk = await this.getKlines(symbol, interval, PAGE, {
          startTime: startWindow,
          endTime: endCursor,
        });
        if (chunk.length === 0) break;
        let earliest = Infinity;
        let added = 0;
        for (const k of chunk) {
          if (k.openTime < fromMs || k.openTime > toMs) continue;
          if (!seen.has(k.openTime)) {
            seen.add(k.openTime);
            out.push(k);
            added++;
          }
          if (k.openTime < earliest) earliest = k.openTime;
        }
        if (added === 0 || earliest === Infinity) break;
        const nextEnd = earliest - 1;
        if (nextEnd >= endCursor) break; // no backward progress
        endCursor = nextEnd;
      }
      out.sort((a, b) => a.openTime - b.openTime);
      return out;
    },

    async getLastPrice(symbol) {
      const url = `${BASE_URL}/v1/market/ticker24Hr/${encodeURIComponent(symbol.toUpperCase())}`;
      const res = await fetch(url, { headers: { accept: "application/json" } });
      const text = await res.text();
      if (!res.ok) throw new Error(`Ticker failed [${res.status}]: ${text.slice(0, 200)}`);
      const parsed = JSON.parse(text) as { data?: Record<string, unknown> };
      const t = parsed?.data ?? (JSON.parse(text) as Record<string, unknown>);
      const price = Number((t as Record<string, unknown>)?.c);
      if (!Number.isFinite(price)) throw new Error("No last price in ticker");
      return price;
    },
  };
}


