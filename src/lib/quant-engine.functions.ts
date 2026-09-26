import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "./auth-middleware";

const engineBaseUrl = () => (process.env.QUANT_ENGINE_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");

async function engineFetch(path: string, init?: RequestInit) {
  const response = await fetch(engineBaseUrl() + path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
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
