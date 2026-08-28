import { createHash } from "node:crypto";
import type { ArtifactProviderStatus } from "../../../contracts/artifact.js";
import type { ArtifactPluginRegistry, ExternalArtifactProvider } from "../../../contracts/artifact.js";
import {
  activationSourceFingerprint,
  importLegacyQoderActivationsOnce,
  readArtifactProviderActivationState,
  type ArtifactProviderActivationStoreOptions,
} from "./artifact-provider-activation.js";
import { createArtifactPluginRegistry } from "./artifact-plugin-registry.js";
import { defaultCanvasViewerRoot } from "./artifact-viewers.js";
import { discoverQoderArtifactProviders } from "../../providers/qoder/artifact-provider.js";
import { resolveQoderCanvasRuntime } from "../../providers/qoder/canvas-viewer-bridge.js";
import { discoverWalnutArtifactProvider } from "../../providers/walnut/artifact-provider.js";

export interface DiscoverArtifactProviderRuntimeOptions {
  canvasViewerRoot?: string;
  canvasSdkRoot?: string;
  canvasSdkMedia?: string;
  cwd?: string;
  artifactProviderStateRoot?: string;
  walnutCacheRoot?: string;
  /** Providers supplied explicitly by an embedding application. */
  artifactProviders?: readonly ExternalArtifactProvider[];
}

export interface ArtifactProviderRuntime {
  providers: readonly ExternalArtifactProvider[];
  registry: ArtifactPluginRegistry;
  statuses: readonly ArtifactProviderStatus[];
}

export async function discoverArtifactProviderRuntime(
  options: DiscoverArtifactProviderRuntimeOptions = {},
): Promise<ArtifactProviderRuntime> {
  const providers: ExternalArtifactProvider[] = [];
  const statuses: ArtifactProviderStatus[] = [];
  const runtime = resolveQoderCanvasRuntime({
    sdkRoot: options.canvasSdkRoot,
    sdkMedia: options.canvasSdkMedia,
    cwd: options.cwd,
  });
  let qoderProviders: ExternalArtifactProvider[] = [];
  if (runtime === undefined) {
    statuses.push(unavailableQoderStatus("The Canvas SDK runtime is unavailable."));
  } else {
    qoderProviders = await discoverQoderArtifactProviders({ viewerRoot: options.canvasViewerRoot, runtime });
    providers.push(...qoderProviders);
    if (qoderProviders.length === 0) statuses.push(unavailableQoderStatus("No receipt-verified Canvas viewer is available."));
  }
  const storeOptions: ArtifactProviderActivationStoreOptions = {
    ...(options.artifactProviderStateRoot === undefined ? {} : { root: options.artifactProviderStateRoot }),
  };
  let activationFailure = false;
  let activations: ArtifactPluginRegistry["activations"] = [];
  try {
    if (qoderProviders.length > 0) {
      const root = options.canvasViewerRoot ?? defaultCanvasViewerRoot();
      await importLegacyQoderActivationsOnce(qoderProviders, activationSourceFingerprint(root), storeOptions);
    }
    activations = (await readArtifactProviderActivationState(storeOptions)).activations;
  } catch {
    activationFailure = true;
  }
  for (const provider of qoderProviders) statuses.push(providerStatus(provider, activations, activationFailure));

  const walnut = await discoverWalnutArtifactProvider(options.walnutCacheRoot);
  if (walnut.provider !== undefined) providers.push(walnut.provider);
  statuses.push(walnut.status);
  const discoveredIds = new Set(providers.map((provider) => provider.id));
  for (const provider of options.artifactProviders ?? []) {
    const invalidReason = validateInjectedProvider(provider);
    if (invalidReason !== undefined) {
      statuses.push(unavailableInjectedStatus(provider, invalidReason));
      continue;
    }
    if (discoveredIds.has(provider.id)) {
      statuses.push(unavailableInjectedStatus(provider, "Another discovered Artifact provider already uses this id."));
      continue;
    }
    discoveredIds.add(provider.id);
    providers.push(provider);
    statuses.push(providerStatus(provider, activations, activationFailure));
  }
  return {
    providers: Object.freeze(providers),
    statuses: Object.freeze(statuses),
    registry: createArtifactPluginRegistry({ externalProviders: providers, activations }),
  };
}

function validateInjectedProvider(provider: ExternalArtifactProvider): string | undefined {
  if (provider.id.trim() === "" || provider.version.trim() === "" || provider.label.trim() === "") {
    return "The injected Artifact provider identity is incomplete.";
  }
  if (provider.receipt.kind !== "HarnessStudioExternalArtifactProviderReceiptV1"
    || provider.receipt.providerId !== provider.id
    || provider.receipt.providerVersion !== provider.version
    || digestJson(provider.receipt) !== provider.fingerprint) {
    return "The injected Artifact provider receipt does not match its identity and fingerprint.";
  }
  const contributionIds = new Set<string>();
  for (const contribution of provider.contributions) {
    if (contribution.id.trim() === "" || contributionIds.has(contribution.id)) {
      return "The injected Artifact provider has an empty or duplicate contribution id.";
    }
    contributionIds.add(contribution.id);
    if ((contribution.matcher.formats?.length ?? 0)
      + (contribution.matcher.extensions?.length ?? 0)
      + (contribution.matcher.pathGlobs?.length ?? 0) === 0) {
      return `Artifact provider contribution '${contribution.id}' has no matcher.`;
    }
    if (contribution.surface.kind === "external-hosted"
      && (contribution.surface.rendererId !== contribution.renderer.id
        || contribution.surface.runtimeId !== contribution.surface.runtime.id)) {
      return `Artifact provider contribution '${contribution.id}' has inconsistent hosted surface identity.`;
    }
    if (contribution.interaction !== undefined
      && (contribution.interaction.id.trim() === ""
        || contribution.interaction.version.trim() === ""
        || contribution.interaction.protocolVersion !== "1")) {
      return `Artifact provider contribution '${contribution.id}' has an unsupported interaction runtime.`;
    }
  }
  return undefined;
}

function unavailableInjectedStatus(
  provider: ExternalArtifactProvider,
  reason: string,
): ArtifactProviderStatus {
  return {
    id: provider.id,
    label: provider.label,
    version: provider.version,
    acquisition: provider.acquisition,
    status: "unavailable",
    receiptVerified: false,
    contributions: [],
    reason,
  };
}

function digestJson(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function providerStatus(
  provider: ExternalArtifactProvider,
  activations: ArtifactPluginRegistry["activations"],
  activationFailure: boolean,
): ArtifactProviderStatus {
  return {
    id: provider.id,
    label: provider.label,
    version: provider.version,
    acquisition: provider.acquisition,
    status: "ready",
    receiptVerified: true,
    fingerprint: provider.fingerprint,
    contributions: provider.contributions.map((contribution) => {
      const activation = activations.find((candidate) => candidate.providerId === provider.id
        && candidate.contributionId === contribution.id && candidate.fingerprint === provider.fingerprint);
      return {
        id: contribution.id,
        label: contribution.label,
        support: contribution.support,
        active: activation !== undefined,
        ...(activation === undefined ? {} : { lane: activation.lane }),
      };
    }),
    ...(activationFailure ? { reason: "Artifact provider activation state is unavailable; external contributions are inactive." } : {}),
  };
}

function unavailableQoderStatus(reason: string): ArtifactProviderStatus {
  return {
    id: "qoder-canvas",
    label: "Qoder Canvas",
    acquisition: "operator-provisioned",
    status: "unavailable",
    receiptVerified: false,
    contributions: [],
    reason,
  };
}
