/**
 * Comparison evidence semantics: aggregation, matched pairs, and the verdict.
 *
 * A controlled comparison only supports a promotion decision when the evidence
 * is strong enough to carry it, so this module states the thresholds explicitly:
 *
 * - trials are compared as matched pairs (same trial index, both variants
 *   completed), not as two independent aggregates
 * - infrastructure errors are counted, not silently dropped from a denominator
 *   where they would make a lucky single completion look perfect
 * - cost is reported per attempted, per completed, and per passed trial, because
 *   a total cost comparison across unequal completions means nothing
 * - a single matched pair is a smoke test and can never be an `accept`
 */
import type { HarnessRunResult } from "../exec/executor.js";
import type { ReadmeGrade } from "./grader.js";
import type { SandboxReceipt } from "./sandbox.js";

export type CompareVariant = "baseline" | "candidate";
export type TrialClassification = "passed" | "failed" | "infrastructure_error";

/**
 * `insufficient_evidence` is the status the old ladder was missing: the run
 * completed, nothing regressed, and there is simply not enough of it to accept.
 */
export type CompareStatus =
  | "accept"
  | "need_more_work"
  | "reject"
  | "insufficient_evidence"
  | "infrastructure_error";

/** The one variable a comparison is allowed to move. */
export type CompareTreatmentAxis = "harness" | "runtime-profile";

export interface CompareTrialResult {
  variant: CompareVariant;
  harnessId: string;
  runtimeProfile: string;
  trial: number;
  classification: TrialClassification;
  changedFiles: string[];
  grade: ReadmeGrade;
  executorExitCode: number;
  executorError: string;
  revisionId: string;
  durationMs: number;
  artifactDirectory: string;
  sandbox: SandboxReceipt;
  metrics?: HarnessRunResult["metrics"];
}

export interface VariantAggregate {
  trials: number;
  completedTrials: number;
  infrastructureErrors: number;
  passedTrials: number;
  passRate: number;
  meanScore: number;
  totalCostUsd: number;
  totalCredits: number;
  /** Cost per attempted trial: what the variant cost to observe at all. */
  costPerAttemptedTrialUsd: number;
  /** Cost per completed trial: the only cost figure comparable across variants. */
  costPerCompletedTrialUsd: number;
  /** Cost per passed trial: what one usable outcome cost. */
  costPerPassedTrialUsd: number;
}

export interface MatchedPairSummary {
  /** Trial indexes where both variants completed. */
  pairs: number;
  candidateWins: number;
  baselineWins: number;
  ties: number;
  /** Mean of candidate score minus baseline score across matched pairs. */
  meanScoreDelta: number;
}

export interface CompareDecisionPolicy {
  /** Matched pairs required before any promotion decision. Never below 2. */
  minimumMatchedPairs: number;
  /** Fraction of attempted trials that may fail for infrastructure reasons. */
  maxInfrastructureErrorRatio: number;
  /** Candidate cost per completed trial, relative to baseline. */
  maxCostRatio: number;
  /** Deterministic score gain that counts as an improvement. */
  minimumMeanScoreGain: number;
}

export const MINIMUM_MATCHED_PAIRS_FLOOR = 2;

export const DEFAULT_COMPARE_DECISION_POLICY: CompareDecisionPolicy = Object.freeze({
  minimumMatchedPairs: 5,
  maxInfrastructureErrorRatio: 0.2,
  maxCostRatio: 1.25,
  minimumMeanScoreGain: 5,
});

export interface HarnessCompareVerdict {
  schemaVersion: "harness-compare-result.v1";
  status: CompareStatus;
  reason: string;
  /** The single variable this comparison moved. */
  treatmentAxis: CompareTreatmentAxis;
  /** The thresholds this verdict was decided under, so it stays falsifiable. */
  policy: CompareDecisionPolicy;
  manifestHash: string;
  fixtureHash: string;
  harnessHash: string;
  sandbox: SandboxReceipt;
  baseline: VariantAggregate;
  candidate: VariantAggregate;
  matchedPairs: MatchedPairSummary;
  trials: CompareTrialResult[];
}

/**
 * Raise a caller's policy onto the hard floors.
 *
 * A caller may demand more evidence than the default; it may not lower the
 * two-pair floor, because a one-pair "win" is indistinguishable from noise.
 */
export function normalizeDecisionPolicy(
  policy: Partial<CompareDecisionPolicy> = {},
): CompareDecisionPolicy {
  const requested = { ...DEFAULT_COMPARE_DECISION_POLICY, ...policy };
  return {
    minimumMatchedPairs: Math.max(
      MINIMUM_MATCHED_PAIRS_FLOOR,
      Math.trunc(requested.minimumMatchedPairs),
    ),
    maxInfrastructureErrorRatio: clamp(requested.maxInfrastructureErrorRatio, 0, 0.5),
    maxCostRatio: Math.max(1, requested.maxCostRatio),
    minimumMeanScoreGain: Math.max(0, requested.minimumMeanScoreGain),
  };
}

export function aggregateVariant(results: readonly CompareTrialResult[]): VariantAggregate {
  const completed = results.filter((result) => result.classification !== "infrastructure_error");
  const passed = completed.filter((result) => result.classification === "passed");
  const totalCostUsd = round6(results.reduce((sum, result) => sum + (result.metrics?.costUsd ?? 0), 0));
  return {
    trials: results.length,
    completedTrials: completed.length,
    infrastructureErrors: results.length - completed.length,
    passedTrials: passed.length,
    passRate: completed.length === 0 ? 0 : passed.length / completed.length,
    meanScore: completed.length === 0
      ? 0
      : round2(completed.reduce((sum, result) => sum + result.grade.score, 0) / completed.length),
    totalCostUsd,
    totalCredits: round6(results.reduce((sum, result) => sum + (result.metrics?.credits ?? 0), 0)),
    costPerAttemptedTrialUsd: ratio(totalCostUsd, results.length),
    costPerCompletedTrialUsd: ratio(totalCostUsd, completed.length),
    costPerPassedTrialUsd: ratio(totalCostUsd, passed.length),
  };
}

/**
 * Compare trials as pairs sharing a trial index.
 *
 * The randomized execution order already runs each index once per variant on the
 * same frozen fixture, so the pair is the natural unit: it cancels fixture and
 * ordering effects that two separate aggregates leave in.
 */
export function summarizeMatchedPairs(
  results: readonly CompareTrialResult[],
): MatchedPairSummary {
  const byIndex = new Map<number, Partial<Record<CompareVariant, CompareTrialResult>>>();
  for (const result of results) {
    if (result.classification === "infrastructure_error") {
      continue;
    }
    const entry = byIndex.get(result.trial) ?? {};
    entry[result.variant] = result;
    byIndex.set(result.trial, entry);
  }
  let candidateWins = 0;
  let baselineWins = 0;
  let ties = 0;
  let scoreDelta = 0;
  let pairs = 0;
  for (const entry of byIndex.values()) {
    const baseline = entry.baseline;
    const candidate = entry.candidate;
    if (baseline === undefined || candidate === undefined) {
      continue;
    }
    pairs += 1;
    scoreDelta += candidate.grade.score - baseline.grade.score;
    if (candidate.grade.passed === baseline.grade.passed) {
      ties += 1;
    } else if (candidate.grade.passed) {
      candidateWins += 1;
    } else {
      baselineWins += 1;
    }
  }
  return {
    pairs,
    candidateWins,
    baselineWins,
    ties,
    meanScoreDelta: pairs === 0 ? 0 : round2(scoreDelta / pairs),
  };
}

/**
 * Decide a verdict from paired evidence.
 *
 * The order matters: infrastructure health first (a broken run measures
 * nothing), then evidence volume, then regression, and only then promotion.
 */
export function decideVerdict(context: {
  baseline: VariantAggregate;
  candidate: VariantAggregate;
  matchedPairs: MatchedPairSummary;
  policy: CompareDecisionPolicy;
}): Pick<HarnessCompareVerdict, "status" | "reason"> {
  const { baseline, candidate, matchedPairs, policy } = context;
  const attempted = baseline.trials + candidate.trials;
  const infrastructureErrors = baseline.infrastructureErrors + candidate.infrastructureErrors;
  const infrastructureRatio = attempted === 0 ? 1 : infrastructureErrors / attempted;
  if (baseline.completedTrials === 0 || candidate.completedTrials === 0) {
    return { status: "infrastructure_error", reason: "At least one variant has no completed trial." };
  }
  if (infrastructureRatio > policy.maxInfrastructureErrorRatio) {
    return {
      status: "infrastructure_error",
      reason:
        `${infrastructureErrors}/${attempted} trials failed for infrastructure reasons, above the ` +
        `${(policy.maxInfrastructureErrorRatio * 100).toFixed(0)}% threshold; the run measures the ` +
        "harness setup, not the harnesses.",
    };
  }
  if (matchedPairs.pairs < policy.minimumMatchedPairs) {
    return {
      status: "insufficient_evidence",
      reason:
        `${matchedPairs.pairs} matched pair(s) completed, below the ${policy.minimumMatchedPairs} ` +
        "this comparison requires; the outcome is a smoke test, not evidence of improvement.",
    };
  }
  if (
    candidate.passRate < baseline.passRate ||
    matchedPairs.baselineWins > matchedPairs.candidateWins ||
    matchedPairs.meanScoreDelta <= -policy.minimumMeanScoreGain
  ) {
    return { status: "reject", reason: "Candidate regressed paired outcomes or deterministic score." };
  }
  const costWithinLimit =
    baseline.costPerCompletedTrialUsd === 0 ||
    candidate.costPerCompletedTrialUsd <= baseline.costPerCompletedTrialUsd * policy.maxCostRatio;
  const creditsWithinLimit =
    baseline.totalCredits === 0 ||
    ratio(candidate.totalCredits, candidate.completedTrials) <=
      ratio(baseline.totalCredits, baseline.completedTrials) * policy.maxCostRatio;
  const improved =
    matchedPairs.candidateWins > matchedPairs.baselineWins ||
    matchedPairs.meanScoreDelta >= policy.minimumMeanScoreGain;
  if (improved && costWithinLimit && creditsWithinLimit) {
    return {
      status: "accept",
      reason:
        `Candidate won ${matchedPairs.candidateWins}/${matchedPairs.pairs} matched pairs ` +
        `(mean score delta ${matchedPairs.meanScoreDelta}) within the ` +
        `${policy.maxCostRatio}x cost-per-completed-trial guardrail.`,
    };
  }
  if (improved) {
    return {
      status: "need_more_work",
      reason: "Candidate improved outcomes but exceeded the cost-per-completed-trial guardrail.",
    };
  }
  return {
    status: "need_more_work",
    reason: "No regression, but the candidate did not clear the paired improvement threshold.",
  };
}

function ratio(total: number, count: number): number {
  return count === 0 ? 0 : round6(total / count);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
