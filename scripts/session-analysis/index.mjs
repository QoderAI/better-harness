// Public import surface for the session-analysis capability.
// Other scripts/<capability>/ modules must import from this file instead of
// reaching into capability-private modules (see docs/ARCHITECTURE.md).

export { createAnalyzer, main, SessionAnalyzer, SESSION_ANALYSIS_HELP } from "./analyzer.mjs";
export { parseArgs, parseBooleanFlag } from "./cli.mjs";
export { buildTaskEpisodes, stableFingerprint } from "./episode-contract.mjs";
export { isDirectory, pathExists, walkFiles } from "./fs.mjs";
export { buildObservationManifest } from "./observation-manifest.mjs";
export { expandHome, normalizeWorkspace } from "./paths.mjs";
export { sanitizePrivateReviewText } from "./privacy-safe-text.mjs";
export { selectSessions } from "./selection.mjs";
export {
  assertSessionSelectionBinding,
  readSessionSelectionPlan,
  readSessionSelectionProfile,
  readSessionSelectionSnapshot,
  restoreSessionSelectionEntries,
} from "./selection-plan.mjs";
export { projectSemanticFacets, validateSemanticFacets } from "./semantic-facets.mjs";
export { sessionAnalysisRef } from "./session-ref.mjs";
