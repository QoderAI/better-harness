export * from "./ir/index.js";
export { canonicalJson, contentHash, sha256Hex } from "./ir/canonical.js";
export {
  assertRevisionAdapter,
  assertRevisionIntegrity,
  computeRevisionId,
  deepFreeze,
  HarnessAdapterMismatchError,
  HarnessRevisionBundleMismatchError,
  HarnessRevisionTamperedError,
  HarnessSourceLockError,
  validateRevisionAgainstBundle,
  type HarnessRevisionBody,
} from "./ir/revision.js";
export {
  compileHarness,
  type CompileDiagnostic,
  type CompileResult,
  type HarnessSource,
} from "./compiler/compile.js";
export {
  resolveDeployment,
  resolveHarness,
  type ResolveOptions,
  type ResolveResult,
} from "./resolver/resolve.js";
export {
  describeAdapter,
  PROMPT_ONLY_DESCRIPTOR,
  realizationFactFor,
  workflowFactFor,
  type AdapterMcpSupport,
  type AdapterRealizationDescriptor,
  type AdapterSkillDelivery,
  type AdapterToolExposure,
  type CapabilityRealizationFact,
  type WorkflowRealizationFact,
} from "./resolver/adapter-descriptor.js";
export {
  ACP_ADAPTER_DESCRIPTOR,
  ADAPTER_DESCRIPTOR_REGISTRY,
  PI_ADAPTER_DESCRIPTOR,
  QODER_ADAPTER_DESCRIPTOR,
  describeBuiltInAdapter,
} from "./resolver/adapter-registry.js";
export { createHarnessServices, type HarnessServices } from "./language/harness-module.js";
export * from "./customization/index.js";
