// Filter builder: apply predicate rules to TradeRecord[].
import type { TradeRecord } from "@/lib/trade-intelligence/types";

export type Op = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "in";
export interface Rule { field: string; op: Op; value: string }

function readPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[k];
    return undefined;
  }, obj);
}

function coerce(v: unknown): number | string | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v);
  return Number.isFinite(n) && String(v).trim() !== "" ? n : String(v);
}

export function applyRules(rows: TradeRecord[], rules: Rule[]): TradeRecord[] {
  if (!rules.length) return rows;
  return rows.filter((row) =>
    rules.every((r) => {
      const raw = coerce(readPath(row, r.field));
      const rhs = coerce(r.value);
      if (raw == null) return false;
      switch (r.op) {
        case "eq": return String(raw) === String(rhs);
        case "neq": return String(raw) !== String(rhs);
        case "gt": return typeof raw === "number" && typeof rhs === "number" && raw > rhs;
        case "gte": return typeof raw === "number" && typeof rhs === "number" && raw >= rhs;
        case "lt": return typeof raw === "number" && typeof rhs === "number" && raw < rhs;
        case "lte": return typeof raw === "number" && typeof rhs === "number" && raw <= rhs;
        case "contains": return String(raw).toLowerCase().includes(String(rhs).toLowerCase());
        case "in": return String(r.value).split(",").map((s) => s.trim()).includes(String(raw));
      }
    })
  );
}
