import {
  deepFreeze,
  HOST_SUPPORT_SCHEMA_VERSION,
  validateContractEvidence,
  validateHostProfile,
  validateHostSurface,
  validateLifecycleOperation,
  validateLifecycleStep,
} from "./profile-model.mjs";

export const BETTER_HARNESS_REPOSITORY = "https://github.com/QoderAI/better-harness.git";

export {
  HOST_DISTRIBUTION_KINDS,
  HOST_DISCOVERY_SOURCES,
  HOST_OBSERVATION_KINDS,
  HOST_SCOPE_ARTIFACT_POLICIES,
  HOST_SCOPES,
  HOST_SUPPORT_SCHEMA_VERSION,
  LIFECYCLE_DISPOSITIONS,
  LIFECYCLE_OPERATION_NAMES,
  LIFECYCLE_STEP_KINDS,
  NATIVE_HOME_BINDING_KINDS,
} from "./profile-model.mjs";

const DEFAULT_DOCS_PATH = "docs/docs/installation.mdx";
const CONTRACT_FIXTURE = "test/fixtures/plugin-lifecycle/native-help-contracts.v1.json";
const DEFAULT_OBSERVATION_KIND = Object.freeze({
  bundled: "bundled",
  "source-local": "session-only",
});

const BETTER_HARNESS_IDENTITY = Object.freeze({
  names: ["better-harness", "@qoderai/better-harness", "@qoder-ai/better-harness"],
  nativeIds: ["better-harness", "better-harness@better-harness", "better-harness/better-harness"],
  repositories: [
    "qoderai/better-harness",
    "github.com/qoderai/better-harness",
    "git:github.com/qoderai/better-harness",
    BETTER_HARNESS_REPOSITORY.toLowerCase(),
  ],
});

export function evidence(id, kind = "native-cli-help") {
  const record = {
    id,
    kind,
    observedAt: "2026-07-31",
    fixture: CONTRACT_FIXTURE,
  };
  validateContractEvidence(record);
  return deepFreeze(record);
}

function defineStep(kind, payload, expected, extra = {}) {
  const step = { ...extra, kind, ...payload, expected };
  validateLifecycleStep(step, `host ${kind} step`);
  return deepFreeze(step);
}

export function shell(argv, expected, extra = {}) {
  return defineStep("shell", { argv }, expected, extra);
}

export function manual(instruction, expected, extra = {}) {
  return defineStep("manual", { instruction }, expected, extra);
}

export function hostCommand(command, expected, extra = {}) {
  return defineStep("host-command", { command }, expected, extra);
}

export function desktopUi(instruction, expected, extra = {}) {
  return defineStep("desktop-ui", { instruction }, expected, extra);
}

export function operation(disposition, steps = [], contractEvidence = undefined) {
  const lifecycleOperation = {
    disposition,
    steps,
    ...(contractEvidence ? { contractEvidence } : {}),
  };
  validateLifecycleOperation(lifecycleOperation);
  return deepFreeze(lifecycleOperation);
}

export function defineSurface(surface) {
  const observation = Object.freeze({
    ...(surface.observation ?? {}),
    kind: surface.observation?.kind
      ?? DEFAULT_OBSERVATION_KIND[surface.distributionKind]
      ?? "inventory",
    discoverySource: surface.observation?.discoverySource
      ?? (surface.observation?.discoveryDiagnostic ? "diagnostic" : "executable"),
  });
  const defined = {
    docsPath: DEFAULT_DOCS_PATH,
    scopeArtifactPolicy: "independent",
    ...surface,
    observation,
  };
  validateHostSurface(defined);
  return deepFreeze(defined);
}

export function defineHostProfile(profile) {
  const provider = profile.provider ?? profile.hostId;
  const inventoryHomeOption = profile.inventoryHomeOption ?? `${provider}Home`;
  const defined = {
    ...profile,
    schemaVersion: HOST_SUPPORT_SCHEMA_VERSION,
    identity: BETTER_HARNESS_IDENTITY,
    provider,
    inventoryHomeOption,
    inventoryHomeRoutes: profile.inventoryHomeRoutes ?? [{
      option: inventoryHomeOption,
      relativePath: "",
      fallbackLabel: `<provider-default:${inventoryHomeOption}>`,
    }],
  };
  validateHostProfile(defined);
  return deepFreeze(defined);
}
