/**
 * Server-authoritative Artifact plugin composition.
 *
 * Built-ins, external contributions, activation, and the terminal unavailable
 * state meet here. Callers receive the selected binding directly and never
 * re-derive vendor or format policy from ids.
 */
import { extname } from "node:path";
import {
  ARTIFACT_DATA_SNAPSHOT_KIND,
  type ArtifactDataSnapshot,
  type ArtifactRendererReference,
} from "../artifact-model.js";
import type {
  ArtifactAdaptContext,
  ArtifactAdapterImplementation,
  ArtifactExternalLane,
  ArtifactMatcher,
  ArtifactPlugin,
  ArtifactPluginBinding,
  ArtifactPluginRegistry,
  ArtifactProviderActivation,
  ExternalAdapterContribution,
  ExternalArtifactProvider,
} from "./artifact-adapter-contract.js";
import {
  PROVIDER_HOSTED_CANVAS_TSX_FORMAT,
  resolveArtifactFormatCode,
  resolveArtifactKind,
  type ArtifactEntry,
  type ArtifactKind,
} from "./artifact-catalog.js";
import {
  MERMAID_REACT_BUILD_RUNTIME,
  REACT_SOURCE_BUILD_RUNTIME,
  SVG_REACT_BUILD_RUNTIME,
} from "./artifact-build-runtimes.js";
import { DOCX_ARTIFACT_ADAPTER } from "./docx-artifact-adapter.js";
import { MARKDOWN_ARTIFACT_ADAPTER } from "./markdown-artifact-adapter.js";
import { PDF_ARTIFACT_ADAPTER } from "./pdf-artifact-adapter.js";
import { PPTX_ARTIFACT_ADAPTER } from "./pptx-artifact-adapter.js";
import { XLSX_ARTIFACT_ADAPTER } from "./xlsx-artifact-adapter.js";

export type {
  ArtifactAdaptContext,
  ArtifactAdapterExecutionProfile,
  ArtifactAdapterImplementation,
  ArtifactBuildRuntimeImplementation,
  ArtifactContributionSupport,
  ArtifactExternalLane,
  ArtifactHostedResource,
  ArtifactHostedRuntimeImplementation,
  ArtifactMatcher,
  ArtifactPlugin,
  ArtifactPluginBinding,
  ArtifactPluginRegistry,
  ArtifactPluginResolution,
  ArtifactProviderActivation,
  ArtifactProviderBinding,
  ArtifactProviderAcquisition,
  ArtifactResourceBytes,
  ArtifactSurfaceBinding,
  ExternalAdapterContribution,
  ExternalArtifactProvider,
  VerifiedExternalProviderAssetReceipt,
  VerifiedExternalProviderReceipt,
} from "./artifact-adapter-contract.js";

const RAW_ADAPTER_ID = "studio.raw";
const RAW_SCHEMA_ID = "artifact/raw-v1";

/** Passes the exact content reference through for renderers that read bytes. */
export const RAW_ARTIFACT_ADAPTER: ArtifactAdapterImplementation = {
  id: RAW_ADAPTER_ID,
  version: "1",
  schemaId: RAW_SCHEMA_ID,
  adapt: async (context) => envelopeSnapshot(context, {
    kind: "artifact/raw-v1",
    content: context.descriptor.revision.content,
  }),
};

export async function envelopeSnapshot(
  context: ArtifactAdaptContext,
  payload: ArtifactDataSnapshot["payload"],
): Promise<ArtifactDataSnapshot> {
  const descriptor = context.descriptor;
  const address = `artifact:${descriptor.id}`;
  return {
    kind: ARTIFACT_DATA_SNAPSHOT_KIND,
    artifactId: descriptor.id,
    revisionId: descriptor.revision.id,
    snapshotId: descriptor.adapter.snapshotId,
    adapter: { id: descriptor.adapter.id, version: descriptor.adapter.version },
    schemaId: descriptor.adapter.schemaId,
    summary: { label: descriptor.label, family: descriptor.family, format: descriptor.format },
    structure: [{ id: descriptor.id, label: descriptor.label, address, kind: descriptor.format }],
    semanticIndex: [{ address, label: descriptor.label, kind: descriptor.format }],
    resources: [],
    diagnostics: [],
    payload,
  };
}

function nativeResolution(kind: ArtifactKind): ArtifactPluginBinding | undefined {
  if (kind === "docx") {
    return {
      backing: "data",
      adapter: DOCX_ARTIFACT_ADAPTER,
      renderer: { id: "studio.docx-dom", label: "Studio DOCX", provider: "studio", type: "native", status: "ready" },
      surface: { kind: "native", rendererId: "studio.docx-dom" },
      capabilities: ["navigate", "outline", "select", "zoom"],
    };
  }
  if (kind === "markdown") {
    return {
      backing: "data",
      adapter: MARKDOWN_ARTIFACT_ADAPTER,
      renderer: { id: "studio.markdown", label: "Studio Markdown", provider: "studio", type: "native", status: "ready" },
      surface: { kind: "native", rendererId: "studio.markdown" },
      capabilities: ["navigate", "outline"],
    };
  }
  if (kind === "pptx") {
    return {
      backing: "data",
      adapter: PPTX_ARTIFACT_ADAPTER,
      renderer: { id: "studio.pptx-dom", label: "Studio PPTX", provider: "studio", type: "native", status: "ready" },
      surface: { kind: "native", rendererId: "studio.pptx-dom" },
      capabilities: ["navigate", "outline", "select", "zoom"],
    };
  }
  if (kind === "pdf") {
    return {
      backing: "data",
      adapter: PDF_ARTIFACT_ADAPTER,
      renderer: { id: "studio.pdf-canvas", label: "Studio PDF", provider: "studio", type: "native", status: "ready" },
      surface: { kind: "native", rendererId: "studio.pdf-canvas" },
      capabilities: ["navigate", "zoom"],
    };
  }
  if (kind === "xlsx") {
    return {
      backing: "data",
      adapter: XLSX_ARTIFACT_ADAPTER,
      renderer: { id: "studio.xlsx-grid", label: "Studio XLSX", provider: "studio", type: "native", status: "ready" },
      surface: { kind: "native", rendererId: "studio.xlsx-grid" },
      capabilities: ["navigate", "select"],
    };
  }
  if (kind === "unknown" || kind === "mermaid") return undefined;
  const rendererId = `studio.${kind}`;
  return {
    backing: "data",
    adapter: RAW_ARTIFACT_ADAPTER,
    renderer: { id: rendererId, label: nativeRendererLabel(kind), provider: "studio", type: "native", status: "ready" },
    surface: { kind: "native", rendererId },
    capabilities: [],
  };
}

function studioCodePreviewResolution(entry: ArtifactEntry): ArtifactPluginBinding | undefined {
  // An observed source file is not executable merely because it contains JSX.
  // Studio reserves its built-in React compiler for the explicit Canvas
  // container suffix; ordinary .tsx/.jsx files stay on the read-only native
  // source surface.
  if (entry.kind !== "code" || resolveArtifactFormatCode(entry.label) !== PROVIDER_HOSTED_CANVAS_TSX_FORMAT) return undefined;
  return {
    backing: "code",
    adapter: RAW_ARTIFACT_ADAPTER,
    buildRuntime: REACT_SOURCE_BUILD_RUNTIME,
    renderer: {
      id: "studio.react-preview",
      label: "Studio React Preview",
      provider: "studio",
      type: "sandboxed-web",
      status: "ready",
    },
    surface: { kind: "studio-sandbox", rendererId: "studio.react-preview", runtimeId: REACT_SOURCE_BUILD_RUNTIME.id },
    capabilities: ["execute", "live-update"],
  };
}

function studioDocumentPreviewResolution(entry: ArtifactEntry): ArtifactPluginBinding | undefined {
  const buildRuntime = entry.kind === "svg"
    ? SVG_REACT_BUILD_RUNTIME
    : entry.kind === "mermaid" ? MERMAID_REACT_BUILD_RUNTIME : undefined;
  if (buildRuntime === undefined) return undefined;
  const rendererId = entry.kind === "svg" ? "studio.svg-react-preview" : "studio.mermaid-react-preview";
  return {
    backing: "code",
    adapter: RAW_ARTIFACT_ADAPTER,
    buildRuntime,
    renderer: {
      id: rendererId,
      label: entry.kind === "svg" ? "Studio SVG Preview" : "Studio Mermaid Preview",
      provider: "studio",
      type: "sandboxed-web",
      status: "ready",
    },
    surface: { kind: "studio-sandbox", rendererId, runtimeId: buildRuntime.id },
    capabilities: ["live-update"],
  };
}

function nativeRendererLabel(kind: Exclude<ArtifactKind, "unknown" | "docx" | "pdf" | "pptx" | "xlsx" | "mermaid">): string {
  return ({
    code: "Studio code",
    diff: "Studio diff",
    image: "Studio image",
    json: "Studio JSON",
    markdown: "Studio Markdown",
    svg: "Studio SVG",
    text: "Studio text",
  })[kind];
}

const PROTECTED_PLUGINS: readonly ArtifactPlugin[] = Object.freeze([
  { id: "studio-code-preview", resolve: studioCodePreviewResolution },
]);

const NATIVE_PLUGINS: readonly ArtifactPlugin[] = Object.freeze([
  { id: "studio-document-preview", resolve: studioDocumentPreviewResolution },
  { id: "studio-native", resolve: (entry) => nativeResolution(entry.kind) },
]);

export interface CreateArtifactPluginRegistryOptions {
  externalProviders?: readonly ExternalArtifactProvider[];
  activations?: readonly ArtifactProviderActivation[];
  protectedPlugins?: readonly ArtifactPlugin[];
  nativePlugins?: readonly ArtifactPlugin[];
}

export function createArtifactPluginRegistry(
  options: CreateArtifactPluginRegistryOptions = {},
): ArtifactPluginRegistry {
  const providers = Object.freeze([...(options.externalProviders ?? [])]);
  const activations = Object.freeze([...(options.activations ?? [])]);
  const protectedPlugins = options.protectedPlugins ?? PROTECTED_PLUGINS;
  const nativePlugins = options.nativePlugins ?? NATIVE_PLUGINS;
  return Object.freeze({
    providers,
    activations,
    resolve(entry: ArtifactEntry): ArtifactPluginBinding {
      if (resolveArtifactFormatCode(entry.label) === PROVIDER_HOSTED_CANVAS_TSX_FORMAT) {
        const containerFallbacks = externalBindings(
          entry,
          "external-fallback",
          providers,
          activations,
          PROVIDER_HOSTED_CANVAS_TSX_FORMAT,
        );
        if (containerFallbacks.length === 1) return containerFallbacks[0]!;
        if (containerFallbacks.length > 1) {
          return unavailableBinding(
            "Multiple activated external Artifact contributions match the provider-hosted Canvas format; narrow or remove an activation.",
          );
        }
      }
      const protectedBinding = resolvePlugins(entry, protectedPlugins);
      if (protectedBinding !== undefined) return protectedBinding;
      const overrides = externalBindings(entry, "external-override", providers, activations);
      if (overrides.length === 1) return overrides[0]!;
      const fallbacks = externalBindings(entry, "external-fallback", providers, activations);
      // Content sniffing may safely expose an unregistered extension as text,
      // but it must not erase an explicitly activated Provider for that custom
      // format. Known native text formats keep their normal Studio priority.
      if (entry.kind === "text" && resolveArtifactKind(entry.label) === "unknown") {
        if (fallbacks.length === 1) return fallbacks[0]!;
        if (fallbacks.length > 1) {
          return unavailableBinding(
            "Multiple activated external Artifact contributions match the same lane; narrow or remove an activation.",
          );
        }
      }
      const nativeBinding = resolvePlugins(entry, nativePlugins);
      if (nativeBinding !== undefined) return nativeBinding;
      if (fallbacks.length === 1) return fallbacks[0]!;
      const conflict = overrides.length > 1 || fallbacks.length > 1;
      return unavailableBinding(conflict
        ? "Multiple activated external Artifact contributions match the same lane; narrow or remove an activation."
        : entry.kind === "unknown"
          ? "Binary artifacts do not have a text preview, and no activated Artifact contribution matches this file."
          : "No native renderer or activated external Artifact contribution matches this file.");
    },
  });
}

/** Convenience for callers that own no external providers. */
export function resolveArtifactPlugin(entry: ArtifactEntry, registry = createArtifactPluginRegistry()): ArtifactPluginBinding {
  return registry.resolve(entry);
}

function resolvePlugins(entry: ArtifactEntry, plugins: readonly ArtifactPlugin[]): ArtifactPluginBinding | undefined {
  for (const plugin of plugins) {
    const binding = plugin.resolve(entry);
    if (binding !== undefined) return binding;
  }
  return undefined;
}

function externalBindings(
  entry: ArtifactEntry,
  lane: ArtifactExternalLane,
  providers: readonly ExternalArtifactProvider[],
  activations: readonly ArtifactProviderActivation[],
  requiredFormatOnly?: string,
): ArtifactPluginBinding[] {
  const bindings: ArtifactPluginBinding[] = [];
  for (const provider of providers) {
    for (const contribution of provider.contributions) {
      const activation = activations.find((candidate) => candidate.providerId === provider.id
        && candidate.contributionId === contribution.id
        && candidate.fingerprint === provider.fingerprint
        && candidate.lane === lane
        && candidate.contributionSupport === contribution.support
        && candidate.adapterExecutionProfile === contribution.adapterExecutionProfile
        && candidate.surfaceSecurityProfile === (contribution.surface.kind === "external-hosted"
          ? contribution.surface.securityProfileId
          : undefined)
        && (requiredFormatOnly === undefined || matcherUsesFormatAxis(candidate.matcher, requiredFormatOnly))
        && matchesArtifact(entry, candidate.matcher));
      if (activation === undefined
        || !matchesArtifact(entry, contribution.matcher)
        || (requiredFormatOnly !== undefined && !matcherUsesFormatAxis(contribution.matcher, requiredFormatOnly))) continue;
      bindings.push(externalBinding(provider, contribution));
    }
  }
  return bindings;
}

function matcherUsesFormatAxis(matcher: ArtifactMatcher, format: string): boolean {
  return (matcher.formats?.some((candidate) => candidate.toLowerCase() === format) ?? false)
    && (matcher.extensions?.length ?? 0) === 0
    && (matcher.pathGlobs?.length ?? 0) === 0;
}

function externalBinding(
  provider: ExternalArtifactProvider,
  contribution: ExternalAdapterContribution,
): ArtifactPluginBinding {
  return {
    backing: "data",
    adapter: contribution.adapter,
    renderer: contribution.renderer,
    surface: contribution.surface,
    capabilities: contribution.capabilities,
    provider: {
      providerId: provider.id,
      contributionId: contribution.id,
      fingerprint: provider.fingerprint,
      contributionSupport: contribution.support,
      ...(contribution.adapterExecutionProfile === undefined
        ? {}
        : { adapterExecutionProfile: contribution.adapterExecutionProfile }),
      ...(contribution.surface.kind === "external-hosted"
        ? { surfaceSecurityProfile: contribution.surface.securityProfileId }
        : {}),
    },
  };
}

function unavailableBinding(reason: string): ArtifactPluginBinding {
  const renderer: ArtifactRendererReference = {
    id: "studio.unavailable",
    label: "Unavailable",
    provider: "studio",
    type: "unavailable",
    status: "unavailable",
    reason,
  };
  return {
    backing: "data",
    adapter: RAW_ARTIFACT_ADAPTER,
    renderer,
    surface: { kind: "unavailable", reason },
    capabilities: [],
  };
}

export function matchesArtifact(entry: ArtifactEntry, matcher: ArtifactMatcher): boolean {
  const extension = extname(entry.label).replace(/^\./u, "").toLowerCase();
  const format = resolveArtifactFormatCode(entry.label);
  const portablePath = entry.label.replaceAll("\\", "/");
  return (matcher.formats?.some((candidate) => candidate.toLowerCase() === format) ?? false)
    || (matcher.extensions?.some((candidate) => candidate.replace(/^\./u, "").toLowerCase() === extension) ?? false)
    || (matcher.pathGlobs?.some((glob) => matchesPortablePathGlob(portablePath, glob)) ?? false);
}

function matchesPortablePathGlob(path: string, glob: string): boolean {
  const normalized = glob.replaceAll("\\", "/");
  if (normalized.startsWith("**/*.")) return path.toLowerCase().endsWith(normalized.slice(4).toLowerCase());
  if (normalized.startsWith("**/")) return path === normalized.slice(3) || path.endsWith(`/${normalized.slice(3)}`);
  return path === normalized;
}
