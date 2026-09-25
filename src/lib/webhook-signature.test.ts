import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhookSignature } from "./webhook-signature.server";

describe("webhook signatures", () => {
  it("accepts a current HMAC over timestamp and raw body", () => {
    const timestamp = "1700000000";
    const rawBody = '{"symbol":"XAUUSDT"}';
    const signature = createHmac("sha256", "secret").update(`${timestamp}.${rawBody}`).digest("hex");
    expect(verifyWebhookSignature({ secret: "secret", timestamp, signature, rawBody, nowMs: 1700000000000 })).toEqual({ ok: true });
  });

  it("rejects replayed and tampered requests", () => {
    expect(verifyWebhookSignature({ secret: "secret", timestamp: "1699999000", signature: "00", rawBody: "{}", nowMs: 1700000000000 }).ok).toBe(false);
    expect(verifyWebhookSignature({ secret: "secret", timestamp: "1700000000", signature: "00", rawBody: "{}", nowMs: 1700000000000 }).ok).toBe(false);
  });
});
