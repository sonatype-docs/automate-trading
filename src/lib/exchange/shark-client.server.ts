/**
 * SharkExchange REST client (server-only).
 *
 * ⚠️  Endpoints, auth scheme, and signing are placeholders.
 * Fill in from the official SharkExchange API docs before enabling live mode:
 *   - Base URL
 *   - Auth header format (API key + HMAC? passphrase?)
 *   - Place / cancel / status / balance endpoint paths & payloads
 */

export interface PlaceOrderParams {
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  type?: "market" | "limit";
  price?: number;
}

export interface OrderResult {
  exchangeOrderId: string;
  status: "filled" | "pending" | "rejected";
  filledPrice?: number;
  raw?: unknown;
}

export interface ExchangeClient {
  placeOrder(p: PlaceOrderParams): Promise<OrderResult>;
  getBalance(asset: string): Promise<number>;
}

const BASE_URL = "https://api.sharkexchange.example/v1"; // TODO: replace

export function createSharkClient(): ExchangeClient {
  const apiKey = process.env.SHARKEXCHANGE_API_KEY;
  const apiSecret = process.env.SHARKEXCHANGE_API_SECRET;

  return {
    async placeOrder(p) {
      if (!apiKey || !apiSecret) {
        throw new Error(
          "SharkExchange API credentials are not configured. Add SHARKEXCHANGE_API_KEY and SHARKEXCHANGE_API_SECRET before switching off paper mode.",
        );
      }
      // TODO: implement signed request per SharkExchange docs.
      // Placeholder so the code compiles; live mode will throw until wired.
      const res = await fetch(`${BASE_URL}/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": apiKey,
          // "X-SIGNATURE": hmacSha256(apiSecret, body),
        },
        body: JSON.stringify(p),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`SharkExchange placeOrder failed [${res.status}]: ${text}`);
      }
      const data = (await res.json()) as {
        id: string;
        status: string;
        filled_price?: number;
      };
      return {
        exchangeOrderId: data.id,
        status:
          data.status === "filled"
            ? "filled"
            : data.status === "rejected"
              ? "rejected"
              : "pending",
        filledPrice: data.filled_price,
        raw: data,
      };
    },
    async getBalance() {
      throw new Error("Not implemented — awaiting SharkExchange API docs.");
    },
  };
}
