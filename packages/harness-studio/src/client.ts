/**
 * Browser-safe re-exports only. Node entry points (server, CLI, artifact
 * Provider activation) live in the package root `.` export instead, so a
 * browser bundle importing `./client` never pulls in Node-only code.
 */
export {
  applyAguiEvent,
  initialRunState,
  type AguiRunState,
  type TimelineItem,
} from "./app/run/agui-store.js";
export {
  CompareVerdictError,
  parseVerdict,
  summarizeVerdict,
  type CompareRow,
  type CompareSummary,
  type CompareTrialRow,
} from "./app/compare-model.js";
export { createSseParser, type SseParser } from "./app/sse-client.js";
export {
  isStudioProjectCatalog,
  STUDIO_PROJECT_CATALOG_KIND,
  type ActiveStudioProject,
  type StudioProjectCatalog,
  type StudioProjectDescriptor,
  type StudioProjectKind,
} from "./contracts/studio-project.js";
export {
  alignToolCalls,
  compareToolCalls,
  localToolChain,
  normalizeToolCall,
  relatedCallFor,
  type ExperimentToolCall,
  type NormalizedToolCall,
  type RelatedToolCall,
  type ToolRelation,
} from "./app/experiment/experiment-trace-model.js";
