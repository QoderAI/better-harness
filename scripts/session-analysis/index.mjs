// Public import surface for the session-analysis capability.
// Other scripts/<capability>/ modules must import from this file instead of
// reaching into capability-private modules (see docs/ARCHITECTURE.md).

export {
  createAnalyzer,
  main,
  SessionAnalyzer,
  SESSION_ANALYSIS_HELP,
  SUPPORTED_SESSION_PLATFORMS,
  SUPPORTED_SESSION_PROVIDERS,
} from "./analyzer.mjs";
export { parseArgs, parseBooleanFlag } from "./cli.mjs";
export { buildTaskEpisodes, stableFingerprint } from "./episode-contract.mjs";
export { isDirectory, pathExists, pathStat, readJson, walkFiles } from "./fs.mjs";
export { buildObservationManifest } from "./observation-manifest.mjs";
export { expandHome, normalizeWorkspace } from "./paths.mjs";
export { privacySafeUserInputText, sanitizePrivateReviewText } from "./privacy-safe-text.mjs";
export { cloneSessionWithWorkspaceCwds } from "./provider-runner.mjs";
export { selectSessions } from "./selection.mjs";
export {
  assertSessionSelectionBinding,
  readSessionSelectionPlan,
  readSessionSelectionProfile,
  readSessionSelectionSnapshot,
  restoreSessionSelectionEntries,
} from "./selection-plan.mjs";
export {
  bindSessionSelection,
  freezeSessionPopulation,
  leadAdmissionBinding,
  sessionAdmissionBinding,
  sessionPopulationDiscovery,
  validateSessionPopulationBundle,
} from "./session-population.mjs";
export { projectSemanticFacets, validateSemanticFacets } from "./semantic-facets.mjs";
export { sessionAnalysisRef } from "./session-ref.mjs";
export {
  appendUnsupportedCapabilities,
  buildProviderCoverage,
  providerCoverageStates,
  sanitizeProviderCoverage,
} from "./provider-coverage.mjs";
export { buildToolCallTrace, TOOL_CALL_TRACE_SCHEMA_VERSION } from "./tool-call-trace.mjs";
