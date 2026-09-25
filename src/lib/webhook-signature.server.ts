import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_MAX_SKEW_MS = 5 * 60 * 1000;

export function verifyWebhookSignature(input: {
  secret: string;
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
  nowMs?: number;
  maxSkewMs?: number;
}) {
  const timestampMs = Number(input.timestamp) * 1000;
  if (!input.timestamp || !Number.isFinite(timestampMs)) return { ok: false as const, reason: "missing_timestamp" };

  const maxSkewMs = input.maxSkewMs ?? DEFAULT_MAX_SKEW_MS;
  if (Math.abs((input.nowMs ?? Date.now()) - timestampMs) > maxSkewMs) {
    return { ok: false as const, reason: "stale_timestamp" };
  }

  const supplied = input.signature?.replace(/^sha256=/, "") ?? "";
  const expected = createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${input.rawBody}`)
    .digest("hex");
  const suppliedBytes = Buffer.from(supplied, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
    return { ok: false as const, reason: "invalid_signature" };
  }
  return { ok: true as const };
}
