import { createHash } from "node:crypto";
import type { ArtifactProviderStatus } from "../artifact-model.js";
import type { ExternalArtifactProvider, VerifiedExternalProviderReceipt } from "./artifact-adapter-contract.js";
import {
  defaultWalnutCacheRoot,
  verifyActiveWalnutProvider,
  type WalnutProviderReceipt,
} from "./walnut-bootstrap.js";

const WALNUT_PROVIDER_ID = "chatgpt-walnut";

export async function discoverWalnutArtifactProvider(
  cacheRoot = defaultWalnutCacheRoot(),
): Promise<{ provider?: ExternalArtifactProvider; status: ArtifactProviderStatus }> {
  const verification = await verifyActiveWalnutProvider(cacheRoot);
  if (!verification.ok || verification.receipt === undefined) {
    return {
      status: {
        id: WALNUT_PROVIDER_ID,
        label: "ChatGPT Walnut",
        acquisition: "local-derived-experimental",
        status: "unavailable",
        receiptVerified: false,
        contributions: [],
        reason: "Walnut is not installed or its active receipt failed verification.",
      },
    };
  }
  const provider = projectWalnutArtifactProvider(verification.receipt);
  return {
    provider,
    status: {
      id: provider.id,
      label: provider.label,
      version: provider.version,
      acquisition: provider.acquisition,
      status: "ready",
      receiptVerified: true,
      fingerprint: provider.fingerprint,
      contributions: [],
    },
  };
}

export function projectWalnutArtifactProvider(source: WalnutProviderReceipt): ExternalArtifactProvider {
  const canonicalSource = {
    kind: source.kind,
    support: source.support,
    formats: [...source.formats].sort(),
    app: {
      version: source.app.version,
      bundleIdentifier: source.app.bundleIdentifier,
      signingIdentifier: source.app.signingIdentifier,
      teamIdentifier: source.app.teamIdentifier,
    },
    archive: { size: source.archive.size, digest: source.archive.digest },
    assets: source.assets.map((asset) => ({
      relativePath: asset.relativePath,
      role: asset.role,
      size: asset.size,
      digest: asset.digest,
    })).sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
  };
  const sourceDigest = digestJson(canonicalSource);
  const providerVersion = source.app.version;
  const receipt: VerifiedExternalProviderReceipt = {
    kind: "HarnessStudioExternalArtifactProviderReceiptV1",
    providerId: WALNUT_PROVIDER_ID,
    providerVersion,
    providerDescriptorDigest: digestJson({
      id: WALNUT_PROVIDER_ID,
      formats: canonicalSource.formats,
      sourceDigest,
    }),
    assets: canonicalSource.assets,
    driverVersions: { "walnut-bootstrap": "1" },
    sourceReceipt: { kind: source.kind, digest: sourceDigest },
  };
  return Object.freeze({
    id: WALNUT_PROVIDER_ID,
    label: "ChatGPT Walnut",
    version: providerVersion,
    acquisition: "local-derived-experimental",
    fingerprint: digestJson(receipt),
    receipt: Object.freeze(receipt),
    contributions: Object.freeze([]),
  });
}

function digestJson(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
