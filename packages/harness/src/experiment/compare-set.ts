/**
 * `harness-compare-set.v2`: one aggregate per lane, one decision per contrast.
 *
 * This module deliberately owns no thresholds. Every promotion decision is
 * delegated to the `harness-compare.v1` ladder in `../compare/aggregate.js` by
 * projecting a contrast's two lanes onto the baseline/candidate pair that ladder
 * already understands. That is what keeps the two-matched-pair floor from
 * drifting: an experiment cannot become a cheaper way to say `accept`.
 *
 * A three-lane view therefore has no global verdict. It has three lane
 * aggregates and as many decisions as it declared contrasts.
 */
import type { HarnessRunResult } from "../exec/executor.js";
import {
  aggregateVariant,
  decideVerdict,
  normalizeDecisionPolicy,
  summarizeMatchedPairs,
  type CompareDecisionPolicy,
  type CompareStatus,
  type CompareTrialResult,
  type MatchedPairSummary,
  type TrialClassification,
  type VariantAggregate,
} from "../compare/aggregate.js";
import type { ReadmeGrade } from "../compare/grader.js";
import type { SandboxReceipt } from "../compare/sandbox.js";
import {
  deriveContrastAttribution,
  evaluateObservedLane,
  type ContrastAttribution,
  type ExperimentAttributionContext,
  type ObservedLaneEligibility,
} from "./axis.js";
import type { CheckpointCompleteness } from "./checkpoint.js";
import {
  findLane,
  isObservedLane,
  type ExperimentLane,
  type HarnessExperimentManifest,
} from "./contract.js";

/**
 * One run of one lane.
 *
 * `grade` is optional because an observed trajectory may predate the grader
 * contract. An ungraded run is still displayable evidence; it simply cannot
 * participate in a scored comparison.
 */
export interface ExperimentTrialResult {
  laneId: string;
  harnessId: string;
  runtimeProfile: string;
  model: string;
  trial: number;
  classification: TrialClassification;
  changedFiles: string[];
  grade?: ReadmeGrade;
  executorExitCode: number;
  executorError: string;
  revisionId: string;
  durationMs: number;
  artifactDirectory: string;
  sandbox: SandboxReceipt;
  metrics?: HarnessRunResult["metrics"];
}

export interface ExperimentLaneAggregate {
  laneId: string;
  origin: "observed" | "execute";
  harnessId: string | null;
  runtimeProfile: string | null;
  model: string | null;
  /** False when no run of this lane carries a grade, so scores are not comparable. */
  graded: boolean;
  aggregate: VariantAggregate;
}

/** `descriptive` is terminal: it is never upgraded into a promotion status. */
export type ContrastStatus = CompareStatus | "descriptive";

export interface ContrastResult {
  id: string;
  /** Lane ids in declared order; for an attributable contrast, [baseline, candidate]. */
  lanes: string[];
  attribution: ContrastAttribution;
  status: ContrastStatus;
  reason: string;
  /** Paired evidence, present only when the contrast was decided on it. */
  matchedPairs: MatchedPairSummary | null;
}

export interface HarnessExperimentCompareSet {
  schemaVersion: "harness-compare-set.v2";
  manifestHash: string;
  checkpoint: {
    digest: string;
    completeness: CheckpointCompleteness;
  };
  task: {
    promptHash: string;
    graderContractHash: string;
  };
  /** The thresholds every attributable contrast was judged under. */
  policy: CompareDecisionPolicy;
  /** Why each observed lane is or is not matched baseline evidence. */
  observedLanes: ObservedLaneEligibility[];
  lanes: ExperimentLaneAggregate[];
  contrasts: ContrastResult[];
  trials: ExperimentTrialResult[];
}

export interface BuildExperimentCompareSetOptions {
  manifest: HarnessExperimentManifest;
  manifestHash: string;
  taskPromptHash: string;
  graderContractHash: string;
  completeness: CheckpointCompleteness;
  trials: readonly ExperimentTrialResult[];
  /** Raises the evidence bar; the two-matched-pair floor always applies. */
  policy?: Partial<CompareDecisionPolicy>;
}

export function buildExperimentCompareSet(
  options: BuildExperimentCompareSetOptions,
): HarnessExperimentCompareSet {
  const { manifest } = options;
  const policy = normalizeDecisionPolicy(options.policy);
  const context: ExperimentAttributionContext = {
    taskPromptHash: options.taskPromptHash,
    completeness: options.completeness,
  };
  for (const trial of options.trials) {
    if (findLane(manifest, trial.laneId) === undefined) {
      throw new Error(`Trial references unknown lane '${trial.laneId}'.`);
    }
  }
  const lanes = manifest.lanes.map((lane) => aggregateLane(lane, options.trials));
  const contrasts = manifest.contrasts.map((contrast) =>
    decideContrast({
      manifest,
      contrast,
      context,
      trials: options.trials,
      lanes,
      policy,
    }),
  );
  return {
    schemaVersion: "harness-compare-set.v2",
    manifestHash: options.manifestHash,
    checkpoint: { digest: manifest.checkpointRef.digest, completeness: options.completeness },
    task: { promptHash: options.taskPromptHash, graderContractHash: options.graderContractHash },
    policy,
    observedLanes: manifest.lanes
      .filter(isObservedLane)
      .map((lane) => evaluateObservedLane(lane, context)),
    lanes,
    contrasts,
    trials: [...options.trials].sort(
      (a, b) => a.laneId.localeCompare(b.laneId) || a.trial - b.trial,
    ),
  };
}

/**
 * Decide one contrast.
 *
 * A descriptive contrast short-circuits before any scoring: there is no threshold
 * that could turn a confounded or unmatched comparison into an attribution, so
 * running the ladder on it would only produce a number that invites misreading.
 */
export function decideContrast(input: {
  manifest: HarnessExperimentManifest;
  contrast: HarnessExperimentManifest["contrasts"][number];
  context: ExperimentAttributionContext;
  trials: readonly ExperimentTrialResult[];
  lanes: readonly ExperimentLaneAggregate[];
  policy: CompareDecisionPolicy;
}): ContrastResult {
  const { contrast, policy } = input;
  const attribution = deriveContrastAttribution(input.manifest, contrast, input.context);
  if (attribution.mode === "descriptive") {
    return {
      id: contrast.id,
      lanes: [...contrast.lanes],
      attribution,
      status: "descriptive",
      reason: attribution.detail,
      matchedPairs: null,
    };
  }
  const [baselineLaneId, candidateLaneId] = contrast.lanes as [string, string];
  const ungraded = [baselineLaneId, candidateLaneId].filter(
    (laneId) => !(input.lanes.find((lane) => lane.laneId === laneId)?.graded ?? false),
  );
  if (ungraded.length > 0) {
    return {
      id: contrast.id,
      lanes: [...contrast.lanes],
      attribution,
      status: "insufficient_evidence",
      reason:
        `Lane(s) ${ungraded.join(", ")} carry no graded run, so paired scores cannot be ` +
        "computed; the contrast is displayable but not decidable.",
      matchedPairs: null,
    };
  }
  const baselineRows = projectLaneTrials(input.trials, baselineLaneId, "baseline");
  const candidateRows = projectLaneTrials(input.trials, candidateLaneId, "candidate");
  const matchedPairs = summarizeMatchedPairs([...baselineRows, ...candidateRows]);
  const decision = decideVerdict({
    baseline: aggregateVariant(baselineRows),
    candidate: aggregateVariant(candidateRows),
    matchedPairs,
    policy,
  });
  return {
    id: contrast.id,
    lanes: [...contrast.lanes],
    attribution,
    status: decision.status,
    reason: decision.reason,
    matchedPairs,
  };
}

function aggregateLane(
  lane: ExperimentLane,
  trials: readonly ExperimentTrialResult[],
): ExperimentLaneAggregate {
  const laneTrials = trials.filter((trial) => trial.laneId === lane.id);
  const gradedRows = laneTrials.filter(
    (trial): trial is ExperimentTrialResult & { grade: ReadmeGrade } => trial.grade !== undefined,
  );
  const identity = isObservedLane(lane) ? lane.identity ?? {} : undefined;
  return {
    laneId: lane.id,
    origin: lane.origin,
    harnessId: isObservedLane(lane) ? identity?.harnessId ?? null : lane.harnessId,
    runtimeProfile: isObservedLane(lane) ? identity?.profile ?? null : lane.runtime.profile,
    model: isObservedLane(lane) ? identity?.model ?? null : lane.runtime.model,
    graded: gradedRows.length > 0,
    aggregate: aggregateVariant(
      gradedRows.map((trial) => toCompareTrial(trial, "baseline")),
    ),
  };
}

/**
 * Re-key a lane's graded runs as one side of a `harness-compare.v1` pair.
 *
 * The trial index is preserved so `summarizeMatchedPairs` can pair the two lanes
 * on the same index, which is what cancels ordering and task effects.
 */
function projectLaneTrials(
  trials: readonly ExperimentTrialResult[],
  laneId: string,
  variant: "baseline" | "candidate",
): CompareTrialResult[] {
  return trials
    .filter((trial) => trial.laneId === laneId && trial.grade !== undefined)
    .map((trial) => toCompareTrial(trial as ExperimentTrialResult & { grade: ReadmeGrade }, variant));
}

function toCompareTrial(
  trial: ExperimentTrialResult & { grade: ReadmeGrade },
  variant: "baseline" | "candidate",
): CompareTrialResult {
  return {
    variant,
    harnessId: trial.harnessId,
    runtimeProfile: trial.runtimeProfile,
    trial: trial.trial,
    classification: trial.classification,
    changedFiles: trial.changedFiles,
    grade: trial.grade,
    executorExitCode: trial.executorExitCode,
    executorError: trial.executorError,
    revisionId: trial.revisionId,
    durationMs: trial.durationMs,
    artifactDirectory: trial.artifactDirectory,
    sandbox: trial.sandbox,
    ...(trial.metrics ? { metrics: trial.metrics } : {}),
  };
}
