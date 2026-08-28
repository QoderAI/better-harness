/**
 * Layer 4 — Artifact Host.
 *
 * Owns everything the Artifact code is not trusted to own: the Revision, the
 * persistent state and its schemas, the capability grant, action execution, frame
 * staging and atomic commit, and the observation record.
 *
 * This is the only layer that orchestrates the others, so it is the only one
 * permitted to import the kernel, the linker, and the runtime.
 */

export { digestArtifactRevision, digestParts, sha256Hex } from "./digest.js";
export { AgentStreamAssembler, isNormalizedRevisionPath, type ModulePatch } from "./stream-assembler.js";
export {
  createBuildCoordinator,
  type AgentReactBuildCoordinator,
  type BuildCoordinatorOptions,
} from "./build-coordinator.js";
export {
  createWorkerOxcCompiler,
  DEFAULT_OXC_WORKER_TIMEOUT_MS,
  type WorkerOxcCompiler,
  type WorkerOxcCompilerOptions,
} from "./worker-oxc-compiler.js";
export {
  loadAgentReactProject,
  type AgentReactSourceStamp,
  type LoadedAgentReactProject,
  type LoadAgentReactProjectOptions,
} from "./project-loader.js";
export {
  createArtifactStateStore,
  type ArtifactStateStore,
  type ArtifactStateStoreOptions,
  type StateSchema,
  type StateValidator,
} from "./state-store.js";
export {
  createCapabilityBroker,
  createCapabilityPolicy,
  type CapabilityBroker,
  type CapabilityPolicy,
  type CapabilityPolicyOptions,
} from "./capability.js";
export { createActionGateway, type ActionGateway, type ActionHandler } from "./action-gateway.js";
export {
  createObservationBridge,
  HARNESS_ARTIFACT_OBSERVATION_EVENT,
  type ArtifactObservationPayload,
  type ObservationBridge,
} from "./observation-bridge.js";
export {
  createSandboxFrameController,
  type SandboxFrameController,
  type SandboxFrameControllerOptions,
  type StageOutcome,
} from "./frames/frame-controller.js";
export {
  createFrameInitMessage,
  FRAME_INIT_MESSAGE,
  FRAME_PROTOCOL_VERSION,
  isMatchingInit,
  isReportFor,
  renderCompletedReport,
  renderFailedReport,
  type FrameInitMessage,
  type FrameReport,
} from "./frames/frame-protocol.js";
export {
  createLocalFrameFactory,
  type ArtifactBundleModule,
  type BundleLoader,
  type LocalFrameFactory,
  type LocalFrameHandle,
} from "./frames/local-frame-factory.js";
