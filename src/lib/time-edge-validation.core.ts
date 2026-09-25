import { TimeEdgeValidationJobSchema } from "@/compute/job-schemas";
import type { TradeRecord } from "@/lib/trade-intelligence/types";
import { bucketMonteCarlo, bootstrapNetPerTrade, walkForward } from "@/lib/time-edge/validation";

export type TimeEdgeValidationInput = typeof TimeEdgeValidationJobSchema._output;

export function runTimeEdgeValidationCore(input: TimeEdgeValidationInput) {
  const bucketRows = input.bucketRows as unknown as TradeRecord[];
  const population = input.population as unknown as TradeRecord[];
  return {
    mc: bucketMonteCarlo(bucketRows, population, input.iterations),
    boot: bootstrapNetPerTrade(bucketRows, input.bootstrapIterations),
    wf: walkForward(bucketRows, input.folds),
    rows: bucketRows.length,
  };
}
