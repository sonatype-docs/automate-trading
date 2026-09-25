export type SmokeTestPayload = {
  operation: "sum";
  values: number[];
};

export function executeSmokeTest(payload: unknown) {
  if (!payload || typeof payload !== "object") throw new Error("Smoke-test payload must be an object");
  const candidate = payload as Partial<SmokeTestPayload>;
  if (candidate.operation !== "sum") throw new Error("Unsupported smoke-test operation");
  if (!Array.isArray(candidate.values) || candidate.values.length === 0 || candidate.values.length > 100) {
    throw new Error("Smoke-test values must contain 1 to 100 numbers");
  }
  if (!candidate.values.every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new Error("Smoke-test values must be finite numbers");
  }
  return {
    operation: candidate.operation,
    values: candidate.values,
    result: candidate.values.reduce((total, value) => total + value, 0),
  };
}
