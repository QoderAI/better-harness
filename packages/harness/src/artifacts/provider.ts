/**
 * Interfaces every Artifact View plugin implements.
 *
 * They live apart from the registry so an adapter can be written against them
 * without importing the registry that selects it, and so the catalog can type
 * a resolution without depending on the providers that produce one.
 */
import type {
  ArtifactBacking,
  ArtifactCapability,
  ArtifactDataSnapshot,
  ArtifactDescriptor,
  ArtifactDigest,
  ArtifactRendererReference,
} from "./model.js";
import type { ArtifactEntry } from "./source.js";

export interface ArtifactAdaptContext {
  entry: ArtifactEntry;
  descriptor: ArtifactDescriptor;
}

export interface ArtifactResourceBytes {
  bytes: Uint8Array;
  mediaType: string;
  label: string;
}

/**
 * Turns one artifact revision into an immutable data snapshot.
 *
 * The registry hands the selected implementation to the caller directly. A
 * caller that re-derived it from `descriptor.adapter.id` would be re-deciding
 * a decision the registry already made, and the two would drift apart into a
 * silent fallback the first time an id changed.
 */
export interface ArtifactAdapterImplementation {
  id: string;
  version: string;
  schemaId: string;
  adapt(context: ArtifactAdaptContext): Promise<ArtifactDataSnapshot>;
  readResource?(context: ArtifactAdaptContext, resourceId: string): Promise<ArtifactResourceBytes | undefined>;
}

/**
 * Trusted compile contribution selected by the Artifact plugin registry.
 *
 * A source module compiles the artifact as authored. A virtual module is
 * Studio-owned React code that consumes the artifact's exact bytes through the
 * `artifact-source` import. Artifact bytes never provide module source,
 * package permissions, or build options.
 */
export interface ArtifactBuildRuntimeImplementation {
  id: string;
  version: string;
  module:
    | { kind: "source" }
    | { kind: "agent-react" }
    | {
      kind: "virtual";
      source: string;
      sourceLoader: "text";
      runtimePackages: readonly string[];
      minify?: boolean;
    };
}

export type ArtifactContributionSupport = "reviewed" | "experimental-local";
export type ArtifactProviderAcquisition = "operator-provisioned" | "local-derived-experimental";
export type ArtifactAdapterExecutionProfile = "trusted-local-process" | "confined-wasm";
export type ArtifactExternalLane = "external-override" | "external-fallback";

export interface ArtifactMatcher {
  formats?: readonly string[];
  extensions?: readonly string[];
  pathGlobs?: readonly string[];
}

export interface VerifiedExternalProviderAssetReceipt {
  relativePath: string;
  role: string;
  size: number;
  digest: ArtifactDigest;
}

export interface VerifiedExternalProviderReceipt {
  kind: "HarnessStudioExternalArtifactProviderReceiptV1";
  providerId: string;
  providerVersion: string;
  providerDescriptorDigest: ArtifactDigest;
  assets: readonly VerifiedExternalProviderAssetReceipt[];
  driverVersions: Readonly<Record<string, string>>;
  sourceReceipt?: { kind: string; digest: ArtifactDigest };
}

export type ArtifactHostedRuntimeContext = ArtifactAdaptContext;

export interface ArtifactHostedResource {
  bytes: Uint8Array;
  mediaType: string;
}

/**
 * Server-private implementation of one externally hosted Artifact surface.
 *
 * Route handling and security headers stay in the common server. Providers
 * return content only; they cannot choose CSP, origin, or cache policy.
 */
export interface ArtifactHostedRuntimeImplementation {
  id: string;
  version: string;
  prepareDocument(context: ArtifactHostedRuntimeContext, moduleUrl: string): Promise<string>;
  readModule(context: ArtifactHostedRuntimeContext, map: boolean): Promise<string>;
  readResource(context: ArtifactHostedRuntimeContext, relativePath: string): Promise<ArtifactHostedResource | undefined>;
}

export const ARTIFACT_INTERACTION_PROTOCOL_VERSION = "1" as const;
export const ARTIFACT_HOSTED_EVENT_PROTOCOL_VERSION = "1" as const;
export const ARTIFACT_HOSTED_INTENT_PROTOCOL_VERSION = "1" as const;

/** Host-normalized selection shared by direct Artifact interaction and controls. */
export interface ArtifactSurfaceSelectionV1 {
  artifactId: string;
  revision: ArtifactDigest;
  bindingId: ArtifactDigest;
  address: string;
}

/**
 * Browser-safe selection emitted by a hosted surface. It is an observation,
 * never mutation authority; the Host must bind it to the current frame,
 * Artifact revision, surface binding, and interaction workspace.
 */
export interface ArtifactHostedSelectionEventV1 extends ArtifactSurfaceSelectionV1 {
  kind: "HarnessStudioArtifactHostedSelectionV1";
  protocolVersion: typeof ARTIFACT_HOSTED_EVENT_PROTOCOL_VERSION;
}

export type ArtifactHostedIntentJsonV1 = null | boolean | number | string
  | readonly ArtifactHostedIntentJsonV1[]
  | { readonly [key: string]: ArtifactHostedIntentJsonV1 };

/**
 * Untrusted browser envelope forwarded from the currently mounted hosted
 * surface. It carries no actor, clock, selection, or steering identity: those
 * fields are minted only after the Host admits the intent.
 */
export interface ArtifactHostedIntentEnvelopeV1 {
  kind: "HarnessStudioArtifactHostedIntentV1";
  protocolVersion: typeof ARTIFACT_HOSTED_INTENT_PROTOCOL_VERSION;
  artifactId: string;
  revision: ArtifactDigest;
  bindingId: ArtifactDigest;
  intentId: string;
  intent: { readonly [key: string]: ArtifactHostedIntentJsonV1 };
}

export interface ArtifactInteractionActorV1 {
  id: string;
  kind: "human" | "agent" | "system";
  label: string;
}

export interface ArtifactInteractionTargetV1 {
  address: string;
  kind: string;
  label: string;
  description?: string;
}

/**
 * Provider-owned claim that an admitted projection target is bound to one
 * exact Artifact revision. The Host resolves the label through its current
 * catalog and never accepts an Artifact id or interaction binding from the
 * hosted frame.
 */
export interface ArtifactHostedIntentDestinationClaimV1 {
  artifactLabel: string;
  revision: ArtifactDigest;
}

/** Host-normalized destination after current catalog and interaction checks. */
export interface ArtifactHostedIntentDestinationV1 {
  artifactId: string;
  artifactLabel: string;
  revision: ArtifactDigest;
  bindingId: ArtifactDigest;
}

export type ArtifactHostedIntentEffectV1 =
  | {
    kind: "selection";
    target: ArtifactInteractionTargetV1;
  }
  | {
    kind: "steering";
    target: ArtifactInteractionTargetV1;
    steering: { kind: string; message: string };
  };

interface ArtifactHostedIntentAdmissionBaseV1 {
  intentId: string;
  effect: ArtifactHostedIntentEffectV1;
}

export type ArtifactHostedIntentAdmissionV1 =
  | ArtifactHostedIntentAdmissionBaseV1 & {
    sourceTarget?: never;
    destination?: never;
  }
  | ArtifactHostedIntentAdmissionBaseV1 & {
    /** Projection-local target that produced a domain-native target effect. */
    sourceTarget: ArtifactInteractionTargetV1;
    /** Provider claim only; the Host must resolve and normalize it before use. */
    destination: ArtifactHostedIntentDestinationClaimV1;
  };

export interface ArtifactHostedIntentAdmissionInputV1 extends Readonly<Pick<ArtifactHostedIntentEnvelopeV1, "intentId" | "intent">> {
  /** Host deadline; conforming Providers stop admission work when aborted. */
  signal: AbortSignal;
}

/**
 * Optional, intent-only Provider seam for a hosted surface.
 *
 * `admit` may fresh-resolve a Provider-native address into a bounded Host
 * selection or steering draft. It must not mutate the Artifact, prepare an
 * interaction proposal, make a decision, or start an Agent run.
 */
export interface ArtifactHostedIntentRuntimeImplementation {
  id: string;
  version: string;
  protocolVersion: typeof ARTIFACT_HOSTED_INTENT_PROTOCOL_VERSION;
  admit(
    context: ArtifactAdaptContext,
    input: ArtifactHostedIntentAdmissionInputV1,
  ): Promise<ArtifactHostedIntentAdmissionV1>;
}

export type ArtifactHostedIntentRecordedEffectV1 =
  | {
    kind: "selection";
    selectionId: string;
    target: ArtifactInteractionTargetV1;
  }
  | {
    kind: "steering";
    selectionId: string;
    steeringId: string;
    target: ArtifactInteractionTargetV1;
    steering: { kind: string; message: string };
  };

/** Host-minted lookup identity for one retained intent outcome; never execution authority. */
export interface ArtifactHostedIntentOriginRefV1 {
  kind: "HarnessStudioArtifactHostedIntentOriginRefV1";
  originId: string;
}

interface ArtifactHostedIntentOutcomeBaseV1 {
  kind: "HarnessStudioArtifactHostedIntentOutcomeV1";
  protocolVersion: typeof ARTIFACT_HOSTED_INTENT_PROTOCOL_VERSION;
  artifactId: string;
  revision: ArtifactDigest;
  bindingId: ArtifactDigest;
  intentId: string;
  actor: ArtifactInteractionActorV1;
  recordedAt: string;
  status: "recorded";
  execution: "not-executed";
  effect: ArtifactHostedIntentRecordedEffectV1;
  replayed: boolean;
}

/** Host-recorded admission outcome for a selection or steering draft, never execution. */
export type ArtifactHostedIntentOutcomeV1 =
  | ArtifactHostedIntentOutcomeBaseV1 & {
    sourceTarget?: never;
    destination?: never;
    originRef?: never;
  }
  | ArtifactHostedIntentOutcomeBaseV1 & {
    /** Projection-local target that produced a domain-native target effect. */
    sourceTarget: ArtifactInteractionTargetV1;
    /** Host-minted exact interaction binding for the native target Artifact. */
    destination: ArtifactHostedIntentDestinationV1;
    /** Correlates an explicit later adoption with this retained Host outcome. */
    originRef: ArtifactHostedIntentOriginRefV1;
  };

/**
 * Host-owned evidence that one trusted Collaboration request adopted a retained
 * hosted-surface steering draft. It is deliberately outside Provider proposal
 * content and digests, preserving native Provider IR and authority boundaries.
 */
export interface ArtifactInteractionProvenanceV1 {
  kind: "HarnessStudioArtifactInteractionProvenanceV1";
  protocolVersion: typeof ARTIFACT_INTERACTION_PROTOCOL_VERSION;
  originId: string;
  adoptionId: string;
  source: {
    artifactId: string;
    revision: ArtifactDigest;
    bindingId: ArtifactDigest;
    intentId: string;
    target: ArtifactInteractionTargetV1;
  };
  destination: ArtifactHostedIntentDestinationV1;
  draft: {
    selectionId: string;
    steeringId: string;
    target: ArtifactInteractionTargetV1;
    steering: { kind: string; message: string };
  };
  recordedBy: ArtifactInteractionActorV1;
  recordedAt: string;
  adoptedBy: ArtifactInteractionActorV1;
  adoptedAt: string;
  provenanceDigest: ArtifactDigest;
}

export interface ArtifactInteractionSteeringControlV1 {
  kind: string;
  label: string;
  placeholder: string;
  maxLength: number;
  /** Provider-owned instruction for compiling natural language into this bounded steering grammar. */
  agentInstruction?: string;
}

/** Browser-safe observation of one exact, Provider-addressable work revision. */
export interface ArtifactInteractionWorkspaceV1 {
  kind: "HarnessStudioArtifactInteractionWorkspaceV1";
  protocolVersion: typeof ARTIFACT_INTERACTION_PROTOCOL_VERSION;
  artifactId: string;
  revision: ArtifactDigest;
  summary: string;
  targets: readonly ArtifactInteractionTargetV1[];
  steering: ArtifactInteractionSteeringControlV1;
}

export interface ArtifactInteractionActionV1 {
  kind: string;
  summary: string;
  target?: ArtifactInteractionTargetV1;
}

export interface ArtifactInteractionProposalV1 {
  kind: "HarnessStudioArtifactInteractionProposalV1";
  proposalId: string;
  proposalDigest: ArtifactDigest;
  artifactId: string;
  expectedRevision: ArtifactDigest;
  target: ArtifactInteractionTargetV1;
  steering: { kind: string; message: string };
  summary: string;
  actions: readonly ArtifactInteractionActionV1[];
  verificationClaims: readonly string[];
  proposedBy: ArtifactInteractionActorV1;
  preparedAt: string;
}

/** Server-private preview bytes retained by the Host until proposal settlement. */
export interface ArtifactInteractionPreviewResourceV1 {
  bytes: Uint8Array;
  mediaType: string;
  label: string;
  digest: ArtifactDigest;
}

export interface ArtifactInteractionPreparedProposalV1 {
  proposal: ArtifactInteractionProposalV1;
  preview: ArtifactInteractionPreviewResourceV1;
  /** Opaque Provider state. It is never serialized or accepted from a browser. */
  continuation: unknown;
}

export interface ArtifactInteractionEvidenceV1 {
  kind: string;
  label: string;
  digest?: ArtifactDigest;
  revision?: ArtifactDigest;
}

export interface ArtifactInteractionDiagnosticV1 {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
}

export type ArtifactInteractionTransitionStatusV1 = "applied" | "rejected" | "stale" | "failed";

export interface ArtifactInteractionTransitionReceiptV1 {
  kind: "HarnessStudioArtifactInteractionTransitionReceiptV1";
  transitionId: string;
  proposalId: string;
  proposalDigest: ArtifactDigest;
  decisionId: string;
  decision: "approve" | "reject";
  status: ArtifactInteractionTransitionStatusV1;
  beforeRevision: ArtifactDigest;
  afterRevision: ArtifactDigest;
  verification: { status: "passed" | "failed" | "not-run"; summary: string };
  affectedTargets: readonly ArtifactInteractionTargetV1[];
  evidence: readonly ArtifactInteractionEvidenceV1[];
  diagnostics: readonly ArtifactInteractionDiagnosticV1[];
  settledAt: string;
}

export interface ArtifactInteractionPrepareInputV1 {
  targetAddress: string;
  steering: { kind: string; message: string };
  /** Actor asking the Provider to prepare the proposal. */
  requestedBy: ArtifactInteractionActorV1;
  /** Human whose shared-surface selection and steering the proposal is based on. */
  selectedBy?: ArtifactInteractionActorV1;
  requestId: string;
}

export interface ArtifactInteractionDecisionInputV1 {
  prepared: ArtifactInteractionPreparedProposalV1;
  decision: "approve" | "reject";
  decisionId: string;
  decidedBy: ArtifactInteractionActorV1;
  decidedAt: string;
  signal?: AbortSignal;
}

/**
 * Server-private interaction implementation selected with the Artifact plugin.
 *
 * `prepare` is read-only. Only a Host call to `decide` may authorize mutation;
 * the Provider remains responsible for format-specific CAS and readback.
 */
export interface ArtifactInteractionRuntimeImplementation {
  id: string;
  version: string;
  protocolVersion: typeof ARTIFACT_INTERACTION_PROTOCOL_VERSION;
  inspect(context: ArtifactAdaptContext): Promise<ArtifactInteractionWorkspaceV1>;
  prepare(context: ArtifactAdaptContext, input: ArtifactInteractionPrepareInputV1): Promise<ArtifactInteractionPreparedProposalV1>;
  decide(context: ArtifactAdaptContext, input: ArtifactInteractionDecisionInputV1): Promise<ArtifactInteractionTransitionReceiptV1>;
}

export type ArtifactSurfaceBinding =
  | { kind: "native"; rendererId: string }
  | { kind: "studio-sandbox"; rendererId: string; runtimeId: string }
  | {
    kind: "external-hosted";
    rendererId: string;
    runtimeId: string;
    securityProfileId: "opaque-web-v1";
    runtime: ArtifactHostedRuntimeImplementation;
  }
  | { kind: "unavailable"; reason: string };

export interface ArtifactProviderBinding {
  providerId: string;
  contributionId: string;
  fingerprint: ArtifactDigest;
  contributionSupport: ArtifactContributionSupport;
  adapterExecutionProfile?: ArtifactAdapterExecutionProfile;
  surfaceSecurityProfile?: "opaque-web-v1";
}

export interface ArtifactPluginBinding {
  backing: ArtifactBacking;
  adapter: ArtifactAdapterImplementation;
  /** Present only when the selected plugin owns a code-backed build lifecycle. */
  buildRuntime?: ArtifactBuildRuntimeImplementation;
  renderer: ArtifactRendererReference;
  surface: ArtifactSurfaceBinding;
  capabilities: readonly ArtifactCapability[];
  intent?: ArtifactHostedIntentRuntimeImplementation;
  interaction?: ArtifactInteractionRuntimeImplementation;
  provider?: ArtifactProviderBinding;
}

export interface ExternalAdapterContribution {
  id: string;
  label: string;
  matcher: ArtifactMatcher;
  adapter: ArtifactAdapterImplementation;
  surface: ArtifactSurfaceBinding;
  renderer: ArtifactRendererReference;
  capabilities: readonly ArtifactCapability[];
  /** Optional admission-only bridge from a hosted surface into Host state. */
  intent?: ArtifactHostedIntentRuntimeImplementation;
  /** Optional Host-gated shared-work interaction; absent means review-only. */
  interaction?: ArtifactInteractionRuntimeImplementation;
  support: ArtifactContributionSupport;
  adapterExecutionProfile?: ArtifactAdapterExecutionProfile;
  /** Import-only hint; runtime precedence always comes from Studio activation. */
  legacyOverrideRequested?: boolean;
}

export interface ExternalArtifactProvider {
  id: string;
  label: string;
  version: string;
  acquisition: ArtifactProviderAcquisition;
  fingerprint: ArtifactDigest;
  receipt: VerifiedExternalProviderReceipt;
  contributions: readonly ExternalAdapterContribution[];
}

export interface ArtifactProviderActivation {
  providerId: string;
  contributionId: string;
  fingerprint: ArtifactDigest;
  lane: ArtifactExternalLane;
  matcher: ArtifactMatcher;
  contributionSupport: ArtifactContributionSupport;
  adapterExecutionProfile?: ArtifactAdapterExecutionProfile;
  surfaceSecurityProfile?: "opaque-web-v1";
  consent: "explicit" | "legacy-import";
  activatedAt: string;
}

/**
 * One ordered step of plugin resolution. Returning `undefined` means "not my
 * artifact"; the registry then tries the next provider.
 */
export interface ArtifactPlugin {
  id: string;
  resolve(entry: ArtifactEntry): ArtifactPluginBinding | undefined;
}

export interface ArtifactPluginRegistry {
  providers: readonly ExternalArtifactProvider[];
  activations: readonly ArtifactProviderActivation[];
  resolve(entry: ArtifactEntry): ArtifactPluginBinding;
}

/** Compatibility alias while internal callers migrate with the V2 wire intact. */
export type ArtifactPluginResolution = ArtifactPluginBinding;
/** Public contract version for external Artifact provider implementations. */
export const ARTIFACT_PROVIDER_API_VERSION = "1" as const;

/**
 * Preserve literal contribution ids, matcher values, and capabilities while
 * checking an implementation against the public Provider contract.
 *
 * Receipt and asset verification remains a Studio host responsibility; this
 * helper intentionally performs no trust upgrade at runtime.
 */
export function defineArtifactProvider<const Provider extends ExternalArtifactProvider>(provider: Provider): Provider {
  return provider;
}

/** Stable JSON used when a Provider binds an interaction proposal digest. */
export function canonicalArtifactInteractionJson(value: unknown): string {
  return JSON.stringify(canonicalArtifactInteractionValue(value));
}

function canonicalArtifactInteractionValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalArtifactInteractionValue);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) sorted[key] = canonicalArtifactInteractionValue(entry);
    }
    return sorted;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new TypeError("Artifact interaction JSON must contain only finite JSON values.");
}
