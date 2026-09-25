import { OptimizerSearchJobSchema } from "@/compute/job-schemas";
import type { TradeRecord } from "@/lib/trade-intelligence/types";
import type { ObjectiveSpec, ParamDim, SearchMethod } from "@/lib/optimizer/types";
import { runOptimization } from "@/lib/optimizer/engine";

export type OptimizerSearchInput = typeof OptimizerSearchJobSchema._output;

export function runOptimizerSearchCore(input: OptimizerSearchInput) {
  return runOptimization(input.rows as unknown as TradeRecord[], {
    method: input.method as SearchMethod,
    dims: input.dims as unknown as ParamDim[],
    objective: input.objective as ObjectiveSpec,
    budget: input.budget,
  });
}
