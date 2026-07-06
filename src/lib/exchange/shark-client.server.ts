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

export interface ExchangeClient {
  placeOrder(p: PlaceOrderParams): Promise<OrderResult>;
  testConnection(): Promise<TestConnectionResult>;
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
  const apiKey = process.env.SHARKEXCHANGE_API_KEY;
  const apiSecret = process.env.SHARKEXCHANGE_API_SECRET;
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
      const body: Record<string, unknown> = {
        placeType: "ORDER_FORM",
        quantity: p.qty,
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
        body.price = p.price;
      }

      const res = await signedJson(apiKey, apiSecret, "POST", "/v1/order/place-order", body);
      if (!res.ok) {
        throw new Error(`SharkExchange placeOrder failed [${res.status}]: ${res.body}`);
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

    async testConnection() {
      const { apiKey, apiSecret } = requireCreds();
      // Read-only, auth-required endpoint — safe way to prove the key + signature work.
      const res = await signedGet(apiKey, apiSecret, "/v1/user-data/trade-history", {
        pageSize: 1,
        sortOrder: "desc",
      });
      if (res.ok) {
        const count = Array.isArray(res.json) ? res.json.length : 0;
        return {
          ok: true,
          status: res.status,
          message: `Authenticated with SharkExchange. Trade-history probe returned ${count} row(s).`,
          sample: res.json,
        };
      }
      return {
        ok: false,
        status: res.status,
        message: `SharkExchange rejected the request [${res.status}]: ${res.body.slice(0, 300)}`,
      };
    },
  };
}
