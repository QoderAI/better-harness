// Public import surface for the commit-session-link capability.
// Other scripts/<capability>/ modules must import from this file instead of
// reaching into capability-private modules (see docs/ARCHITECTURE.md).

export {
  boundedGraceMinutes,
  COMMIT_SESSION_LINK_SCHEMA_VERSION,
  CONFIDENCE_LEVELS,
  correlateCommitSession,
  correlateCommitsWithSessions,
  DEFAULT_GRACE_MINUTES,
} from "./correlate.mjs";
export {
  attachCheckpointFactsToSessions,
  collectEntireCheckpointFacts,
  isEntireCheckpointId,
  readEntireCheckpointSession,
  resolveEntireCheckpoint,
} from "./entire-checkpoints.mjs";
export {
  boundedCommitLimit,
  collectCommitFacts,
  CommitSessionLinkError,
  DEFAULT_COMMIT_LIMIT,
  parseSessionTrailers,
  parseSessionLinkTrailers,
  parseNumstatZ,
  resolveRepoRoot,
} from "./git-facts.mjs";
export { changeBreakdown, classifyChangePath, renderCommitSessionHtml } from "./render-html.mjs";
export { redactTranscriptText } from "./redaction.mjs";
export { attributeSessionToolName } from "./tool-attribution.mjs";
export {
  NORMALIZED_TOOL_ACTIVITY_KIND,
  NORMALIZED_TOOL_ACTIVITY_SCHEMA_VERSION,
  normalizeToolActivity,
} from "./tool-activity.mjs";
export { miniMarkdownToHtml, renderSessionViewerHtml } from "./render-session-html.mjs";
export {
  buildSessionViewerReport,
  SESSION_VIEWER_REPORT_KIND,
  SESSION_VIEWER_REPORT_SCHEMA_VERSION,
} from "./session-report-model.mjs";
export {
  boundedMaxSessions,
  collectMultiPlatformSessionSummaries,
  collectSessionDetail,
  collectSessionSummaries,
  DEFAULT_MAX_SESSIONS,
  normalizeEntireCheckpointSession,
  summarizeSessionEvents,
} from "./session-source.mjs";
export {
  attachCommitsToTurns,
  buildSessionTurns,
  MAX_TURNS,
} from "./session-view.mjs";
export { main } from "./cli.mjs";
