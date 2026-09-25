import { describe, expect, it } from "vitest";
import { executeSmokeTest } from "./smoke";

describe("compute smoke test", () => {
  it("sums a harmless numeric payload", () => {
    expect(executeSmokeTest({ operation: "sum", values: [1, 2, 3, 4, 5] }).result).toBe(15);
  });

  it("rejects unsupported or unsafe payloads", () => {
    expect(() => executeSmokeTest({ operation: "shell", values: [1] })).toThrow();
    expect(() => executeSmokeTest({ operation: "sum", values: [Number.NaN] })).toThrow();
  });
});
