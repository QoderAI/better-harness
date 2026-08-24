import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { extname, posix, relative, resolve, sep } from "node:path";
import type {
  ArtifactAdapterImplementation,
  ArtifactHostedRuntimeImplementation,
  ExternalArtifactProvider,
  VerifiedExternalProviderAssetReceipt,
  VerifiedExternalProviderReceipt,
} from "./artifact-adapter-contract.js";
import { envelopeSnapshot } from "./artifact-plugin-registry.js";
import { discoverCanvasViewers, type CanvasViewer } from "./artifact-viewers.js";
import {
  adaptQoderCanvasViewerData,
  prepareQoderCanvasViewer,
  type QoderCanvasRuntime,
} from "./qoder-canvas-viewer-bridge.js";
import { compileTrustedRendererModule } from "./trusted-renderer-compiler.js";

const QODER_PROVIDER_VERSION = "1";
const MAX_PROVIDER_FILES = 512;
const MAX_PROVIDER_ASSET_BYTES = 128 * 1024 * 1024;

export interface DiscoverQoderArtifactProvidersOptions {
  viewerRoot?: string;
  runtime: QoderCanvasRuntime;
}

export async function discoverQoderArtifactProviders(
  options: DiscoverQoderArtifactProvidersOptions,
): Promise<ExternalArtifactProvider[]> {
  const viewers = await discoverCanvasViewers(options.viewerRoot);
  const providers = await Promise.all(viewers.map(async (viewer) => {
    try {
      return await createQoderArtifactProvider(viewer, options.runtime);
    } catch {
      return undefined;
    }
  }));
  return providers.filter((provider): provider is ExternalArtifactProvider => provider !== undefined);
}

export async function createQoderArtifactProvider(
  viewer: CanvasViewer,
  runtime: QoderCanvasRuntime,
): Promise<ExternalArtifactProvider> {
  const providerId = `qoder-canvas.${viewer.id}`;
  const assets = [
    ...await receiptViewerAssets(viewer),
    await receiptFile(runtime.sdkPath, "runtime/canvas-sdk.js", "canvas-sdk"),
    await receiptFile(runtime.htmlTemplatePath, "runtime/index-canvas.html", "canvas-html"),
    ...(runtime.sdkMapPath === undefined
      ? []
      : [await receiptFile(runtime.sdkMapPath, "runtime/canvas-sdk.js.map", "canvas-sdk-map")]),
  ];
  if (assets.reduce((total, asset) => total + asset.size, 0) > MAX_PROVIDER_ASSET_BYTES) {
    throw new Error("Qoder Artifact provider assets exceed the receipt limit.");
  }
  const providerDescriptorDigest = digestJson({
    id: viewer.id,
    label: viewer.label,
    extensions: [...viewer.extensions].sort(),
    pathGlobs: [...viewer.pathGlobs].sort(),
    dataKey: viewer.dataKey,
    hasSidecar: viewer.scriptPath !== undefined,
  });
  const receipt: VerifiedExternalProviderReceipt = {
    kind: "HarnessStudioExternalArtifactProviderReceiptV1",
    providerId,
    providerVersion: QODER_PROVIDER_VERSION,
    providerDescriptorDigest,
    assets,
    driverVersions: {
      "qoder-sidecar": "1",
      "trusted-renderer-compiler": "1",
      "opaque-web": "1",
    },
  };
  const adapter = qoderCanvasAdapter(viewer);
  const hostedRuntime = qoderHostedRuntime(viewer, runtime);
  const rendererId = `qoder-canvas.${viewer.id}`;
  const contributions: ExternalArtifactProvider["contributions"] = viewer.scriptPath === undefined || viewer.dataKey === undefined
    ? []
    : [{
      id: viewer.id,
      label: viewer.label,
      matcher: {
        extensions: [...viewer.extensions],
        pathGlobs: [...viewer.pathGlobs],
      },
      adapter,
      renderer: {
        id: rendererId,
        label: viewer.label,
        provider: "qoder-canvas",
        type: "qoder-canvas",
        status: "ready",
      },
      surface: {
        kind: "external-hosted",
        rendererId,
        runtimeId: hostedRuntime.id,
        securityProfileId: "opaque-web-v1",
        runtime: hostedRuntime,
      },
      capabilities: ["navigate", "select", "zoom"],
      support: "experimental-local",
      adapterExecutionProfile: "trusted-local-process",
      ...(viewer.overrideBuiltIn ? { legacyOverrideRequested: true } : {}),
    }];
  return Object.freeze({
    id: providerId,
    label: `Qoder Canvas · ${viewer.label}`,
    version: QODER_PROVIDER_VERSION,
    acquisition: "operator-provisioned",
    fingerprint: digestJson(receipt),
    receipt: Object.freeze(receipt),
    contributions: Object.freeze(contributions),
  });
}

function qoderCanvasAdapter(viewer: CanvasViewer): ArtifactAdapterImplementation {
  return {
    id: `qoder-canvas.${viewer.id}.sidecar`,
    version: "1",
    schemaId: `qoder-canvas/${viewer.id}/v1`,
    adapt: async (context) => envelopeSnapshot(context, {
      kind: "qoder-canvas/v1",
      data: await adaptQoderCanvasViewerData(context.entry, viewer),
    }),
  };
}

function qoderHostedRuntime(
  viewer: CanvasViewer,
  runtime: QoderCanvasRuntime,
): ArtifactHostedRuntimeImplementation {
  return {
    id: `qoder-canvas.${viewer.id}.hosted`,
    version: "1",
    async prepareDocument(context, moduleUrl) {
      return (await prepareQoderCanvasViewer(context.entry, viewer, runtime, moduleUrl)).html;
    },
    async readModule(_context, map) {
      const compiled = await compileTrustedRendererModule(viewer.modulePath);
      return map ? compiled.map : `${compiled.code}//# sourceMappingURL=runtime-module.js.map\n`;
    },
    async readResource(_context, relativePath) {
      const root = await realpath(viewer.rootPath);
      const candidate = resolve(root, relativePath);
      if (candidate !== root && !candidate.startsWith(root + sep)) return undefined;
      try {
        const physical = await realpath(candidate);
        if (physical !== root && !physical.startsWith(root + sep)) return undefined;
        const stats = await lstat(physical);
        if (!stats.isFile() || stats.isSymbolicLink()) return undefined;
        return { bytes: await readFile(physical), mediaType: mediaTypeFor(physical) };
      } catch {
        return undefined;
      }
    },
  };
}

async function receiptViewerAssets(viewer: CanvasViewer): Promise<VerifiedExternalProviderAssetReceipt[]> {
  const root = await realpath(viewer.rootPath);
  const paths = await walkRegularFiles(root);
  const receipts: VerifiedExternalProviderAssetReceipt[] = [];
  let total = 0;
  for (const path of paths) {
    const portable = portableRelative(root, path);
    if (/\.canvas\.data\.json$/u.test(portable) || /index\.target-.*\.canvas\.data\.json$/u.test(portable)) continue;
    const stats = await lstat(path);
    total += stats.size;
    if (total > MAX_PROVIDER_ASSET_BYTES) throw new Error("Qoder Artifact provider assets exceed the receipt limit.");
    receipts.push(await receiptFile(path, posix.join("viewer", portable), viewerAssetRole(portable, viewer)));
  }
  return receipts.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function walkRegularFiles(root: string): Promise<string[]> {
  const paths: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Qoder Artifact provider assets cannot be symbolic links.");
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) paths.push(path);
      if (paths.length > MAX_PROVIDER_FILES) throw new Error("Qoder Artifact provider contains too many files.");
    }
  };
  await visit(root);
  return paths;
}

async function receiptFile(
  path: string,
  relativePath: string,
  role: string,
): Promise<VerifiedExternalProviderAssetReceipt> {
  const stats = await lstat(path);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`External provider asset '${relativePath}' is not a regular file.`);
  return {
    relativePath,
    role,
    size: stats.size,
    digest: digestBytes(await readFile(path)),
  };
}

function viewerAssetRole(portablePath: string, viewer: CanvasViewer): string {
  if (portablePath === "manifest.json") return "manifest";
  if (portablePath === "index.canvas.tsx") return "renderer";
  if (viewer.scriptPath !== undefined && portablePath === "scripts/index.mjs") return "sidecar";
  return "resource";
}

function portableRelative(root: string, path: string): string {
  const value = relative(root, path).split(sep).join("/");
  if (value === "" || value.startsWith("../") || posix.isAbsolute(value)) throw new Error("External provider asset escapes its root.");
  return value;
}

function digestBytes(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function digestJson(value: unknown): `sha256:${string}` {
  return digestBytes(Buffer.from(JSON.stringify(value), "utf8"));
}

function mediaTypeFor(path: string): string {
  return ({
    ".css": "text/css; charset=utf-8",
    ".gif": "image/gif",
    ".html": "text/html; charset=utf-8",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
  } as Record<string, string>)[extname(path).toLowerCase()] ?? "application/octet-stream";
}
