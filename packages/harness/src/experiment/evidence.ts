/**
 * Browser-safe experiment evidence semantics.
 *
 * Studio's app bundle needs the contract, the derived attribution rules, and the
 * compare-set model, but not the filesystem manifest loader. This entry is the
 * boundary that keeps a `node:fs` import out of the browser graph, mirroring the
 * split `compare/verdict` already draws for compare evidence.
 */
export {
  describeCheckpointCompleteness,
  reproducesObservedStart,
  type CheckpointCompleteness,
} from "./checkpoint.js";
export {
  HarnessExperimentManifestSchema,
  findLane,
  isExecuteLane,
  isObservedLane,
  type ExecuteLane,
  type ExperimentContrast,
  type ExperimentLane,
  type HarnessExperimentManifest,
  type ObservedLane,
} from "./contract.js";
export {
  deriveContrastAttribution,
  evaluateObservedLane,
  type ContrastAttribution,
  type DescriptiveReason,
  type ExperimentAttributionContext,
  type ExperimentTreatmentAxis,
  type ObservedIdentityGap,
  type ObservedLaneEligibility,
} from "./axis.js";
export {
  buildExperimentCompareSet,
  decideContrast,
  type BuildExperimentCompareSetOptions,
  type ContrastResult,
  type ContrastStatus,
  type ExperimentLaneAggregate,
  type ExperimentTrialResult,
  type HarnessExperimentCompareSet,
} from "./compare-set.js";
