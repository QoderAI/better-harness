/**
 * What a contrast is allowed to conclude, derived from the lanes themselves.
 *
 * Attribution is a property of the configuration, not a claim an author makes.
 * A comparison that moved both the harness and the model cannot say which one
 * caused a difference, so this module computes the moved axes and downgrades the
 * contrast to descriptive whenever the single-variable condition fails:
 *
 * - exactly two lanes, differing on exactly one axis, is attributable
 * - zero moved axes measures repeatability, not a treatment
 * - two or more moved axes is confounded
 * - an observed lane joins as a baseline only under full identity
 */
import { reproducesObservedStart, type CheckpointCompleteness } from "./checkpoint.js";
import {
  findLane,
  isObservedLane,
  type ExperimentContrast,
  type ExperimentLane,
  type HarnessExperimentManifest,
  type ObservedLane,
} from "./contract.js";

/** The variables a contrast may isolate. Host is shared, so it is never an axis. */
export type ExperimentTreatmentAxis = "harness" | "runtime-profile" | "model";

export type DescriptiveReason =
  /** Lanes are configured identically; the contrast measures run-to-run noise. */
  | "no-axis-moved"
  /** More than one variable moved, so no difference can be attributed. */
  | "multi-axis"
  /** Attribution needs exactly two lanes; three columns is a display, not a test. */
  | "lane-count"
  /** A historical trajectory lacks the identity to stand in as a baseline. */
  | "observed-lane-not-matched";

export type ContrastAttribution =
  | {
    mode: "attributable";
    axis: ExperimentTreatmentAxis;
    movedAxes: ExperimentTreatmentAxis[];
    detail: string;
  }
  | {
    mode: "descriptive";
    reason: DescriptiveReason;
    movedAxes: ExperimentTreatmentAxis[];
    detail: string;
  };

/** A missing or mismatched fact that keeps an observed lane out of a verdict. */
export type ObservedIdentityGap =
  | "startCheckpointDigest"
  | "harnessId"
  | "revisionId"
  | "profile"
  | "model"
  | "environmentReceipt"
  | "promptHash"
  | "promptHash-mismatch"
  | "checkpoint-completeness";

export interface ObservedLaneEligibility {
  laneId: string;
  /** True only when every identity fact is present and the task prompt matches. */
  matched: boolean;
  missing: ObservedIdentityGap[];
}

export interface ExperimentAttributionContext {
  /** SHA-256 of the experiment's task prompt, as `sha256:<hex>`. */
  taskPromptHash: string;
  /** What materialization could prove about the shared starting state. */
  completeness: CheckpointCompleteness;
}

/** The three fields a contrast diffs. `null` marks a lane that cannot be compared. */
interface LaneConfiguration {
  harnessId: string;
  profile: string;
  model: string;
}

/**
 * Name every reason this trajectory cannot be a matched baseline.
 *
 * All gaps are collected rather than returned on first failure: a reader fixing
 * an experiment needs the whole list, and "prompt differs" is far more useful
 * alongside "no recorded model" than instead of it.
 */
export function evaluateObservedLane(
  lane: ObservedLane,
  context: ExperimentAttributionContext,
): ObservedLaneEligibility {
  const identity = lane.identity ?? {};
  const missing: ObservedIdentityGap[] = [];
  if (lane.startCheckpointDigest === undefined) missing.push("startCheckpointDigest");
  if (identity.harnessId === undefined) missing.push("harnessId");
  if (identity.revisionId === undefined) missing.push("revisionId");
  if (identity.profile === undefined) missing.push("profile");
  if (identity.model === undefined) missing.push("model");
  if (identity.environmentReceipt === undefined) missing.push("environmentReceipt");
  if (identity.promptHash === undefined) {
    missing.push("promptHash");
  } else if (identity.promptHash !== context.taskPromptHash) {
    // The usual case. A historical session answered its own prompt inside its own
    // prior context, so it is a different task even when the intent looks alike.
    missing.push("promptHash-mismatch");
  }
  if (!reproducesObservedStart(context.completeness)) {
    missing.push("checkpoint-completeness");
  }
  return { laneId: lane.id, matched: missing.length === 0, missing };
}

/**
 * Decide what a contrast may conclude.
 *
 * The order of checks is deliberate: an unmatched observed lane is reported as
 * such even when the configuration would otherwise be single-axis, because
 * "history is not a baseline" is the more informative reason.
 */
export function deriveContrastAttribution(
  manifest: HarnessExperimentManifest,
  contrast: ExperimentContrast,
  context: ExperimentAttributionContext,
): ContrastAttribution {
  const lanes = contrast.lanes.map((laneId) => {
    const lane = findLane(manifest, laneId);
    if (lane === undefined) {
      throw new Error(`Contrast '${contrast.id}' references unknown lane '${laneId}'.`);
    }
    return lane;
  });
  const unmatchedObserved = lanes
    .filter(isObservedLane)
    .map((lane) => evaluateObservedLane(lane, context))
    .filter((eligibility) => !eligibility.matched);
  const configurations = lanes.map((lane) => laneConfiguration(lane));
  const movedAxes = movedAxesOf(configurations);
  if (unmatchedObserved.length > 0) {
    const detail = unmatchedObserved
      .map((eligibility) => `${eligibility.laneId} (missing ${eligibility.missing.join(", ")})`)
      .join("; ");
    return {
      mode: "descriptive",
      reason: "observed-lane-not-matched",
      movedAxes,
      detail: `Observed lane cannot stand in as a baseline: ${detail}.`,
    };
  }
  if (lanes.length !== 2) {
    return {
      mode: "descriptive",
      reason: "lane-count",
      movedAxes,
      detail:
        `Attribution requires exactly two lanes; this contrast holds ${lanes.length} ` +
        "and is a side-by-side display.",
    };
  }
  if (movedAxes.length === 0) {
    return {
      mode: "descriptive",
      reason: "no-axis-moved",
      movedAxes,
      detail: "Both lanes are configured identically; the contrast measures run-to-run variance.",
    };
  }
  if (movedAxes.length > 1) {
    return {
      mode: "descriptive",
      reason: "multi-axis",
      movedAxes,
      detail:
        `Lanes differ on ${movedAxes.join(" and ")}; a difference in outcome cannot be ` +
        "attributed to either.",
    };
  }
  const axis = movedAxes[0]!;
  return {
    mode: "attributable",
    axis,
    movedAxes,
    detail: `Lanes differ only on ${axis}.`,
  };
}

/**
 * Read a lane's comparable configuration.
 *
 * A matched observed lane is read exactly like an execute lane: once its identity
 * is complete, whether the run happened live or was recorded no longer changes
 * what is being compared. Callers only reach this for matched observed lanes.
 */
function laneConfiguration(lane: ExperimentLane): LaneConfiguration {
  if (isObservedLane(lane)) {
    const identity = lane.identity ?? {};
    return {
      harnessId: identity.harnessId ?? "",
      profile: identity.profile ?? "",
      model: identity.model ?? "",
    };
  }
  return { harnessId: lane.harnessId, profile: lane.runtime.profile, model: lane.runtime.model };
}

function movedAxesOf(configurations: readonly LaneConfiguration[]): ExperimentTreatmentAxis[] {
  const moved: ExperimentTreatmentAxis[] = [];
  const fields: Array<[ExperimentTreatmentAxis, keyof LaneConfiguration]> = [
    ["harness", "harnessId"],
    ["runtime-profile", "profile"],
    ["model", "model"],
  ];
  for (const [axis, field] of fields) {
    const values = new Set(configurations.map((configuration) => configuration[field]));
    if (values.size > 1) moved.push(axis);
  }
  return moved;
}
