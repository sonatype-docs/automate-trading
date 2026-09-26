import { describe, expect, it } from "vitest";
import { createBrokerAdapter } from "./broker-adapter.server";

describe("broker adapter", () => {
  it("rejects unsupported brokers before credentials are touched", () => {
    expect(() => createBrokerAdapter("future-broker")).toThrow(
      "Unsupported live broker adapter: future-broker",
    );
  });
});
