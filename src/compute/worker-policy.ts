export const MAX_ATTEMPTS = 3;
export const ABANDONED_AFTER_MS = 2 * 60 * 60 * 1000;

export function shouldRequeue(attempts: number) {
  return Number.isInteger(attempts) && attempts < MAX_ATTEMPTS;
}

export function isAbandoned(startedAt: Date | null, now = new Date()) {
  return startedAt !== null && now.getTime() - startedAt.getTime() >= ABANDONED_AFTER_MS;
}

export function failureStatus(attempts: number): "queued" | "failed" {
  return shouldRequeue(attempts) ? "queued" : "failed";
}
