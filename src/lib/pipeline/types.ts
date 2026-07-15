// Pipeline — public types shared by client + server.
import type { Timeframe, Timezone } from "@/lib/market-data/types";

export type PipelineStage = "data" | "strategy" | "execution" | "intelligence";
export const PIPELINE_STAGES: PipelineStage[] = [
  "data", "strategy", "execution", "intelligence",
];

export type PipelineStatus = "pending" | "running" | "done" | "failed" | "stopped";
export type ComboStatus = "pending" | "running" | "ok" | "failed" | "skipped";

export interface PipelineMatrix {
  source: "yahoo" | "shark";
  symbols: string[];
  timeframes: Timeframe[];
  strategyPresetIds: string[];
  execPresetIds: string[];
  displayTimezone: Timezone;
  strategyTimezone: Timezone;
  mode: "historical" | "live" | "replay" | "paper";
  lookbackDays: number;
  riskUsdPerTrade: number;
}

export interface ComboSpec {
  symbol: string;
  timeframe: Timeframe;
  strategyPresetId: string;
  execPresetId: string;
}

export interface ComboResult {
  spec: ComboSpec;
  status: ComboStatus;
  stage: PipelineStage | null;
  bars: number;
  signals: number;
  trades: number;
  inserted: number;
  netPnl: number;
  error: string | null;
  elapsedMs: number;
}

export interface PipelineProgress {
  total: number;
  completed: number;
  currentCombo: ComboSpec | null;
  currentStage: PipelineStage | null;
  ok: number;
  failed: number;
  totalTrades: number;
  totalInserted: number;
}
