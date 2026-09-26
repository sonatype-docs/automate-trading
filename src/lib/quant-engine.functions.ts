import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "./auth-middleware";

const engineBaseUrl = () => (process.env.QUANT_ENGINE_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function engineFetch(path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(engineBaseUrl() + path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(process.env.QUANT_ENGINE_API_KEY ? { "x-api-key": process.env.QUANT_ENGINE_API_KEY } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const detail = typeof body === "object" && body && "detail" in body ? String((body as { detail?: unknown }).detail) : text;
    throw new Error("Quant engine " + response.status + ": " + detail);
  }
  return body;
}

export const getQuantEngineHealth = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async () => engineFetch("/health"));

export const listQuantStrategies = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async () => engineFetch("/v1/research/strategies"));

const Bar = z.object({
  timestamp: z.string(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().nonnegative(),
});

const BacktestInput = z.object({
  symbol: z.string().min(1).max(32),
  strategy_id: z.string().min(1).max(128),
  bars: z.array(Bar).min(2),
  initial_capital: z.number().positive().optional(),
  risk_per_trade: z.number().positive().lt(1).optional(),
  fee_bps: z.number().nonnegative().optional(),
  slippage_bps: z.number().nonnegative().optional(),
});

export const runQuantBacktest = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((input: unknown) => BacktestInput.parse(input))
  .handler(async ({ data }) => engineFetch("/v1/research/backtests", {
    method: "POST",
    body: JSON.stringify(data),
  }));

const dataSchema = z.object({
  request: BacktestInput,
  train_bars: z.number().int().positive(),
  test_bars: z.number().int().positive(),
  step_bars: z.number().int().positive().optional(),
});

const SweepInput = z.object({
  request: BacktestInput,
  parameter_grid: z.record(z.array(z.number())),
});

export const runQuantSweep = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((input: unknown) => SweepInput.parse(input))
  .handler(async ({ data }) => engineFetch("/v1/research/sweeps", {
    method: "POST",
    body: JSON.stringify(data),
  }));

export const runQuantWalkForward = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((input: unknown) => dataSchema.parse(input))
  .handler(async ({ data }) => engineFetch("/v1/research/walk-forward?" + new URLSearchParams({
    train_bars: String(data.train_bars),
    test_bars: String(data.test_bars),
    ...(data.step_bars ? { step_bars: String(data.step_bars) } : {}),
  }), {
    method: "POST",
    body: JSON.stringify(data.request),
  }));



const AnalysisInput = z.object({
  symbol: z.string().min(1).max(32),
  market_context: z.string().max(12000).default(""),
  sentiment_context: z.string().max(12000).default(""),
  technical_context: z.string().max(12000).default(""),
  quant_context: z.string().max(12000).default(""),
});

export const submitQuantAnalysis = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((input: unknown) => AnalysisInput.parse(input))
  .handler(async ({ data }) => engineFetch("/v1/analysis/jobs", {
    method: "POST",
    body: JSON.stringify(data),
  }));

const QuantJobInput = z.object({ job_id: z.string().min(1).max(128) });

export const getQuantResearchJob = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((input: unknown) => QuantJobInput.parse(input))
  .handler(async ({ data }) => engineFetch("/v1/research/jobs/" + encodeURIComponent(data.job_id)));

export const getQuantResearchJobResult = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((input: unknown) => QuantJobInput.parse(input))
  .handler(async ({ data }) => engineFetch("/v1/research/jobs/" + encodeURIComponent(data.job_id) + "/result"));


export const submitQuantResearchJob = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((input: unknown) => BacktestInput.parse(input))
  .handler(async ({ data }) => engineFetch("/v1/research/jobs", {
    method: "POST",
    body: JSON.stringify(data),
  }));


const PairInput = z.object({
  x_symbol: z.string().min(1).max(32),
  y_symbol: z.string().min(1).max(32),
  x_bars: z.array(Bar).min(30),
  y_bars: z.array(Bar).min(30),
  initial_capital: z.number().positive().optional(),
  risk_per_trade: z.number().positive().lt(1).optional(),
  fee_bps: z.number().nonnegative().optional(),
  slippage_bps: z.number().nonnegative().optional(),
  window: z.number().int().min(20).max(1000).optional(),
  entry_z: z.number().positive().max(10).optional(),
  exit_z: z.number().min(0).max(10).optional(),
});

export const runQuantPairBacktest = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((input: unknown) => PairInput.parse(input))
  .handler(async ({ data }) => engineFetch("/v1/research/pairs/backtests", {
    method: "POST",
    body: JSON.stringify(data),
  }));

const OrderFlowLevel = z.object({ price: z.number().positive(), quantity: z.number().nonnegative() });
const OrderFlowTrade = z.object({
  timestamp_ms: z.number().int(),
  price: z.number().positive(),
  quantity: z.number().positive(),
  aggressor: z.enum(["BUY", "SELL", "UNKNOWN"]).default("UNKNOWN"),
});
const OrderFlowSnapshot = z.object({
  timestamp_ms: z.number().int(),
  bids: z.array(OrderFlowLevel).default([]),
  asks: z.array(OrderFlowLevel).default([]),
});
const OrderFlowDelta = z.object({
  timestamp_ms: z.number().int(),
  side: z.string(),
  price: z.number().positive(),
  quantity: z.number().nonnegative(),
});
const OrderFlowReplayInput = z.object({
  snapshots: z.array(OrderFlowSnapshot).default([]),
  trades: z.array(OrderFlowTrade).default([]),
  deltas: z.array(OrderFlowDelta).default([]),
  imbalance_threshold: z.number().gt(-1).lt(1).default(0.20),
});

export const runQuantOrderFlowReplay = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((input: unknown) => OrderFlowReplayInput.parse(input))
  .handler(async ({ data }) => engineFetch("/v1/research/orderflow/replay", {
    method: "POST",
    body: JSON.stringify(data),
  }));
