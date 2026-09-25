import { createServerFn } from "@tanstack/react-start";
import { PipelineBatchJobSchema } from "@/compute/job-schemas";
import {
  runComboBatchCore,
  type BatchComboResult,
  type BatchResult,
} from "./pipeline-batch.core";

export { PipelineBatchJobSchema, runComboBatchCore };
export type { BatchComboResult, BatchResult };

export const runComboBatch = createServerFn({ method: "POST" })
  .inputValidator((raw) => PipelineBatchJobSchema.parse(raw))
  .handler(async ({ data }) => runComboBatchCore(data));
