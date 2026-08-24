/** Node-side experiment entry: the browser-safe evidence surface plus the loader. */
export * from "./evidence.js";
export {
  loadHarnessExperimentManifest,
  type LoadedHarnessExperimentManifest,
} from "./manifest.js";
export {
  runHarnessExperiment,
  type ExperimentLaneExecutorContext,
  type ExperimentLaneExecutorFactory,
  type ExperimentRunEvent,
  type ExperimentRunEventType,
  type RunHarnessExperimentOptions,
} from "./runner.js";
