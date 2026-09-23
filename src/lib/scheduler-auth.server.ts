import { timingSafeEqual } from "node:crypto";

function safeEqual(value: string, expected: string) {
  const valueBytes = Buffer.from(value);
  const expectedBytes = Buffer.from(expected);
  return valueBytes.length === expectedBytes.length && timingSafeEqual(valueBytes, expectedBytes);
}

export function authorizeScheduledRequest(request: Request) {
  const expected = process.env.SCHEDULER_SECRET;
  if (!expected) {
    return new Response("Scheduler authentication is not configured", { status: 503 });
  }

  const supplied = request.headers.get("x-scheduler-secret");
  if (!supplied || !safeEqual(supplied, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }

  return null;
}