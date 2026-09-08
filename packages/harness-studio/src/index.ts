// Node entry point: re-exports the browser-safe surface (see `./client.js`)
// plus the server, CLI, and Provider APIs that only run under Node.
export * from "./client.js";
export {
  createHarnessStudioServer,
  startHarnessStudioServer,
  type StartedHarnessStudioServer,
} from "./server/server.js";
export type { HarnessStudioServerOptions, StudioAcpAgentOptions } from "./server/studio-types.js";
export { discoverAcpAgentProfiles } from "./server/acp-agent-catalog.js";
export type { StudioIntentAnalyzer } from "./server/intent-analyzer.js";
export { createQoderCliIntentAnalyzer, type QoderCliIntentAnalyzerOptions } from "./server/providers/qoder/intent-analyzer.js";
export {
  createAgentCustomizationCollector,
  createBundledAgentCustomizationCollector,
  validateStudioCustomizationAnalysis,
  type AgentCustomizationCollectorOptions,
  type StudioCustomizationCollector,
} from "./server/customization-collector.js";
export {
  INTENT_CORRELATION_ANALYSIS_KIND,
  INTENT_CORRELATION_PACKET_KIND,
  IntentCorrelationContractError,
  isIntentCorrelationAnalysis,
  parseIntentCorrelationAnalysis,
  validateIntentCorrelationAnalysis,
  type CorrelationClaim,
  type IntentCorrelationAnalysisV1,
  type IntentCorrelationPacketV1,
  type IntentProposal,
} from "./contracts/intent-correlation.js";
export {
  defaultAppDir,
  parseHarnessStudioArgs,
  runHarnessStudioCli,
  type HarnessStudioCliIo,
} from "./server/cli.js";
export {
  activateArtifactContribution,
  deactivateArtifactContribution,
  readArtifactProviderActivationState,
  type ArtifactProviderActivationState,
  type ArtifactProviderActivationStoreOptions,
} from "./server/artifacts/registry/artifact-provider-activation.js";
export {
  DEFAULT_ARTIFACT_COMPILE_LIMITS,
  resolveArtifactCompileLimits,
  type ArtifactCompileLimits,
} from "./server/artifacts/registry/artifact-compile-runtime.js";
export {
  loadArtifactProviderModules,
  providerModuleTarget,
} from "./server/artifacts/registry/artifact-provider-modules.js";

export { createBundledInspectorWorkspaceSessionProvider } from "./server/workspace/bundled-session-provider.js";
export {
  createRustEvidenceHost,
  createRustEvidenceWorkspaceSessionProvider,
  EVIDENCE_HOST_PROTOCOL_VERSION,
  type RustEvidenceHost,
  type RustEvidenceHostOptions,
} from "./server/workspace/rust-evidence-provider.js";
