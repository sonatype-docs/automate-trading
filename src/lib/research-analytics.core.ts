import { ResearchAnalyticsJobSchema } from "@/compute/job-schemas";
import type { TradeFeatures } from "@/lib/research/features";
import {
  featureImportance,
  monteCarlo,
  robustnessScore,
  tradeQualityScore,
  walkForward,
} from "@/lib/research/advanced";
import { computeStats } from "@/lib/research/aggregate";

export type ResearchAnalyticsInput = typeof ResearchAnalyticsJobSchema._output;

export function runResearchAnalyticsCore(input: ResearchAnalyticsInput) {
  const features = input.features as unknown as TradeFeatures[];
  return {
    base: computeStats(features),
    monteCarlo: monteCarlo(features, input.runs),
    walkForward: walkForward(features, input.folds),
    robustness: robustnessScore(features),
    featureImportance: featureImportance(features),
    tradeQuality: tradeQualityScore(features),
  };
}
