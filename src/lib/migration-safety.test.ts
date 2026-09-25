import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationScript = readFileSync(
  new URL("../../deploy/aws/migrate.sh", import.meta.url),
  "utf8",
);
const safetyBootstrap = readFileSync(
  new URL("../../deploy/aws/bootstrap-runtime-safety.sql", import.meta.url),
  "utf8",
);

describe("production migration safety", () => {
  it("never replaces populated production tables destructively", () => {
    expect(migrationScript).not.toMatch(/\bTRUNCATE\s+TABLE\b/i);
    expect(migrationScript).toContain("existing_rows");
    expect(migrationScript).toContain("refusing destructive replacement");
  });

  it("seeds the trading control fail-closed", () => {
    expect(safetyBootstrap).toContain(
      "INSERT INTO public.trading_controls (id, global_live_enabled, mode, kill_switch, reason)",
    );
    expect(safetyBootstrap).toContain("VALUES (true, false, 'DISABLED', true");
  });
});
