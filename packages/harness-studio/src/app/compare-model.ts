import { parseHarnessCompareVerdict } from "@qoder-ai/harness/compare/verdict";
import type { HarnessCompareVerdict, VariantAggregate } from "@qoder-ai/harness/compare";

export interface CompareRow {
  variant: "baseline" | "candidate";
  label: string;
  passedTrials: number;
  completedTrials: number;
  passRate: number;
  meanScore: number;
  infrastructureErrors: number;
  totalCostUsd: number;
  /** The only cost figure comparable across variants with unequal completions. */
  costPerCompletedTrialUsd: number;
  totalCredits: number;
}

export interface CompareTrialRow {
  variant: "baseline" | "candidate";
  trial: number;
  harnessId: string;
  runtimeProfile: string;
  classification: string;
  durationMs: number;
  changedFiles: string[];
}

export interface CompareSummary {
  status: HarnessCompareVerdict["status"];
  reason: string;
  manifestHash: string;
  /** The single variable the comparison moved. */
  treatmentAxis: HarnessCompareVerdict["treatmentAxis"];
  /**
   * Paired evidence and the thresholds it was judged against, so a reader can
   * see why a status was withheld instead of trusting the word.
   */
  evidence: {
    pairs: number;
    candidateWins: number;
    baselineWins: number;
    ties: number;
    meanScoreDelta: number;
    minimumMatchedPairs: number;
    /** Null when a zero-cost baseline makes a ratio undefined. */
    costRatio: number | null;
    costWithinGuardrail: boolean;
    maxCostRatio: number;
  };
  rows: CompareRow[];
  trials: CompareTrialRow[];
}

export class CompareVerdictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompareVerdictError";
  }
}

/** Accept only the frozen `harness-compare-result.v1` evidence schema. */
export function parseVerdict(value: unknown): HarnessCompareVerdict {
  try {
    return parseHarnessCompareVerdict(value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CompareVerdictError(detail);
  }
}

/** Derive the table model the Compare view renders. */
export function summarizeVerdict(verdict: HarnessCompareVerdict): CompareSummary {
  const row = (variant: "baseline" | "candidate", label: string, aggregate: VariantAggregate): CompareRow => ({
    variant,
    label,
    passedTrials: aggregate.passedTrials,
    completedTrials: aggregate.completedTrials,
    passRate: aggregate.passRate,
    meanScore: aggregate.meanScore,
    infrastructureErrors: aggregate.infrastructureErrors,
    totalCostUsd: aggregate.totalCostUsd,
    costPerCompletedTrialUsd: aggregate.costPerCompletedTrialUsd,
    totalCredits: aggregate.totalCredits,
  });
  return {
    status: verdict.status,
    reason: verdict.reason,
    manifestHash: verdict.manifestHash,
    treatmentAxis: verdict.treatmentAxis,
    evidence: {
      pairs: verdict.matchedPairs.pairs,
      candidateWins: verdict.matchedPairs.candidateWins,
      baselineWins: verdict.matchedPairs.baselineWins,
      ties: verdict.matchedPairs.ties,
      meanScoreDelta: verdict.matchedPairs.meanScoreDelta,
      minimumMatchedPairs: verdict.policy.minimumMatchedPairs,
      costRatio: verdict.baseline.costPerCompletedTrialUsd === 0
        ? null
        : verdict.candidate.costPerCompletedTrialUsd / verdict.baseline.costPerCompletedTrialUsd,
      costWithinGuardrail: verdict.candidate.costPerCompletedTrialUsd
        <= verdict.baseline.costPerCompletedTrialUsd * verdict.policy.maxCostRatio,
      maxCostRatio: verdict.policy.maxCostRatio,
    },
    rows: [
      row("baseline", "Baseline", verdict.baseline),
      row("candidate", "Candidate", verdict.candidate),
    ],
    trials: verdict.trials.map((trial) => ({
      variant: trial.variant,
      trial: trial.trial,
      harnessId: trial.harnessId,
      runtimeProfile: trial.runtimeProfile,
      classification: trial.classification,
      durationMs: trial.durationMs,
      changedFiles: trial.changedFiles,
    })),
  };
}
