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
