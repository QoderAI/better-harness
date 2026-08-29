import { createHash } from "node:crypto";
import { createReadStream, type Stats } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { basename, extname, normalize, resolve, sep } from "node:path";
import type {
  ArtifactCatalogResponse,
  ArtifactDigest,
  ArtifactEntry,
  ArtifactFamily,
  ArtifactKind,
  ArtifactOmission,
} from "../../../contracts/artifact.js";
import { ARTIFACT_CATALOG_RESPONSE_KIND } from "../../../contracts/artifact.js";
import type { ArtifactPluginResolution } from "../../../contracts/artifact.js";

export type { ArtifactEntry, ArtifactKind } from "@qoder-ai/harness/artifacts";

/**
 * Server-internal format classification. It selects a native adapter/renderer
 * inside the plugin registry and never reaches the browser: the wire contract
 * exposes `family` for grouping, `format` for identity, and `renderer` for what
 * Studio actually decided to do. Keeping one classification axis on the wire is
 * what stops `kind` from drifting into a second, competing renderer name.
 */
export interface ArtifactIndex {
  catalogId: string;
  entries: ArtifactEntry[];
  omitted: ArtifactOmission[];
}

export interface IndexArtifactDirectoryOptions {
  /** Exact-byte SHA-256 digests are required for public revision snapshots. */
  includeDigests?: boolean;
  /**
   * Optional, already-confined portable paths below the root. Workspace mode
   * uses this to index observed outputs without recursively publishing the
   * project tree. Omit it for the legacy one-directory catalog.
   */
  includePaths?: readonly string[];
  /**
   * Multiply-linked files are omitted by default. A hard link inside a
   * run-output directory is indistinguishable from an alias to arbitrary bytes
   * elsewhere on the same filesystem, so the read-only catalog declines it
   * rather than weaken its directory boundary. Populate the option when the
   * directory is known to be filled by a build that links its outputs.
   */
  allowLinkedFiles?: boolean;
}

const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_ID_STEM_LENGTH = 48;
const MAX_DIGEST_CACHE_ENTRIES = 1_024;
const TEXT_SNIFF_BYTES = 64 * 1_024;

interface ArtifactFormat {
  kind: ArtifactKind;
  mediaType: string;
  active?: true;
}

const UNKNOWN_FORMAT: ArtifactFormat = { kind: "unknown", mediaType: "application/octet-stream" };

/** One registry owns both internal classification and advertised content type. */
const FORMAT_BY_EXTENSION = new Map<string, ArtifactFormat>([
  [".css", { kind: "code", mediaType: "text/css; charset=utf-8" }],
  [".diff", { kind: "diff", mediaType: "text/plain; charset=utf-8" }],
  [".docx", { kind: "docx", mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }],
  [".gif", { kind: "image", mediaType: "image/gif" }],
  [".html", { kind: "code", mediaType: "text/html; charset=utf-8", active: true }],
  [".jpeg", { kind: "image", mediaType: "image/jpeg" }],
  [".jpg", { kind: "image", mediaType: "image/jpeg" }],
  [".js", { kind: "code", mediaType: "text/javascript; charset=utf-8" }],
  [".json", { kind: "json", mediaType: "application/json" }],
  [".jsx", { kind: "code", mediaType: "text/plain; charset=utf-8" }],
  [".lottie", { kind: "unknown", mediaType: "application/zip" }],
  [".mjs", { kind: "code", mediaType: "text/javascript; charset=utf-8" }],
  [".markdown", { kind: "markdown", mediaType: "text/markdown; charset=utf-8" }],
  [".md", { kind: "markdown", mediaType: "text/markdown; charset=utf-8" }],
  [".mermaid", { kind: "mermaid", mediaType: "text/plain; charset=utf-8" }],
  [".mmd", { kind: "mermaid", mediaType: "text/plain; charset=utf-8" }],
  [".patch", { kind: "diff", mediaType: "text/plain; charset=utf-8" }],
  [".pdf", { kind: "pdf", mediaType: "application/pdf" }],
  [".png", { kind: "image", mediaType: "image/png" }],
  [".pptx", { kind: "pptx", mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }],
  [".sh", { kind: "code", mediaType: "text/plain; charset=utf-8" }],
  [".svg", { kind: "svg", mediaType: "image/svg+xml", active: true }],
  [".ts", { kind: "code", mediaType: "text/plain; charset=utf-8" }],
  [".tsx", { kind: "code", mediaType: "text/plain; charset=utf-8" }],
  [".txt", { kind: "text", mediaType: "text/plain; charset=utf-8" }],
  [".webp", { kind: "image", mediaType: "image/webp" }],
  [".xlsx", { kind: "xlsx", mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }],
]);

const DOCUMENT_EXTENSIONS = new Set([".pptx", ".xlsx", ".docx", ".pdf"]);

/**
 * Format lane for provider-owned Canvas container source. This remains a
 * server-side format selector: the browser consumes only the selected Surface.
 */
export const PROVIDER_HOSTED_CANVAS_TSX_FORMAT = "cursor-canvas-tsx";
export const AGENT_REACT_TSX_FORMAT = "agent-react-tsx";

export class ArtifactCatalogContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactCatalogContractError";
  }
}

/**
 * Versioned, server-owned identity of one selected Artifact Surface binding.
 *
 * This is deliberately narrower than either an artifact revision or the full
 * plugin implementation. It contains only the axes that decide whether a
 * mounted surface can safely survive a content revision. Keep presentation
 * labels, snapshot ids, content URIs, and build ids out of this projection.
 */
export interface ArtifactSurfaceBindingIdentityV1 {
  kind: "ArtifactSurfaceBindingIdentityV1";
  backing: ArtifactPluginResolution["backing"];
  adapter: { id: string; version: string; schemaId: string };
  buildRuntime?: { id: string; version: string };
  renderer: { id: string; provider: string; type: string };
  surface:
    | { kind: "native"; rendererId: string }
    | { kind: "studio-sandbox"; rendererId: string; runtimeId: string }
    | {
      kind: "external-hosted";
      rendererId: string;
      runtimeId: string;
      hostedRuntime: { id: string; version: string };
      securityProfileId: string;
    }
    | { kind: "unavailable"; reason: string };
  capabilities: string[];
  intent?: { id: string; version: string; protocolVersion: string };
  interaction?: { id: string; version: string; protocolVersion: string };
  provider?: {
    providerId: string;
    contributionId: string;
    fingerprint: ArtifactDigest;
    contributionSupport: string;
    adapterExecutionProfile?: string;
    surfaceSecurityProfile?: string;
  };
}

export function artifactSurfaceBindingIdentity(
  binding: ArtifactPluginResolution,
): ArtifactSurfaceBindingIdentityV1 {
  const surface = (() => {
    if (binding.surface.kind === "native") {
      return { kind: binding.surface.kind, rendererId: binding.surface.rendererId } as const;
    }
    if (binding.surface.kind === "studio-sandbox") {
      return {
        kind: binding.surface.kind,
        rendererId: binding.surface.rendererId,
        runtimeId: binding.surface.runtimeId,
      } as const;
    }
    if (binding.surface.kind === "external-hosted") {
      return {
        kind: binding.surface.kind,
        rendererId: binding.surface.rendererId,
        runtimeId: binding.surface.runtimeId,
        hostedRuntime: {
          id: binding.surface.runtime.id,
          version: binding.surface.runtime.version,
        },
        securityProfileId: binding.surface.securityProfileId,
      } as const;
    }
    return { kind: binding.surface.kind, reason: binding.surface.reason } as const;
  })();

  return {
    kind: "ArtifactSurfaceBindingIdentityV1",
    backing: binding.backing,
    adapter: {
      id: binding.adapter.id,
      version: binding.adapter.version,
      schemaId: binding.adapter.schemaId,
    },
    ...(binding.buildRuntime === undefined ? {} : {
      buildRuntime: { id: binding.buildRuntime.id, version: binding.buildRuntime.version },
    }),
    renderer: {
      id: binding.renderer.id,
      provider: binding.renderer.provider,
      type: binding.renderer.type,
    },
    surface,
    capabilities: [...new Set(binding.capabilities)].sort(),
    ...(binding.intent === undefined ? {} : {
      intent: {
        id: binding.intent.id,
        version: binding.intent.version,
        protocolVersion: binding.intent.protocolVersion,
      },
    }),
    ...(binding.interaction === undefined ? {} : {
      interaction: {
        id: binding.interaction.id,
        version: binding.interaction.version,
        protocolVersion: binding.interaction.protocolVersion,
      },
    }),
    ...(binding.provider === undefined ? {} : {
      provider: {
        providerId: binding.provider.providerId,
        contributionId: binding.provider.contributionId,
        fingerprint: binding.provider.fingerprint,
        contributionSupport: binding.provider.contributionSupport,
        ...(binding.provider.adapterExecutionProfile === undefined ? {} : {
          adapterExecutionProfile: binding.provider.adapterExecutionProfile,
        }),
        ...(binding.provider.surfaceSecurityProfile === undefined ? {} : {
          surfaceSecurityProfile: binding.provider.surfaceSecurityProfile,
        }),
      },
    }),
  };
}

export function artifactSurfaceBindingId(binding: ArtifactPluginResolution): ArtifactDigest {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(artifactSurfaceBindingIdentity(binding)))
    .digest("hex")}`;
}

/**
 * Resolve an artifact kind from its path. Unrecognized extensions resolve to
 * `unknown` so the registry offers an honest unavailable renderer rather than
 * guessing one.
 */
export function resolveArtifactKind(path: string): ArtifactKind {
  return resolveArtifactFormat(path).kind;
}

/** Reject anything that is not an opaque catalog id. */
export function assertArtifactId(value: unknown): string {
  if (typeof value !== "string" || !ARTIFACT_ID_PATTERN.test(value)) {
    throw new Error("Artifact id must match /^[A-Za-z0-9_-]+$/.");
  }
  return value;
}

/**
 * Derive a catalog id from the artifact's own name.
 *
 * The id must not depend on what else the directory happens to contain: an id
 * handed out in one catalog response is dereferenced by a later, independent
 * request, so a counter assigned by listing order would silently re-point an
 * id at a different file as soon as a sibling appeared. Hashing the full label
 * keeps the id stable and collision-free — a directory cannot hold two entries
 * with the same name — while the readable stem keeps logs debuggable.
 */
export function artifactIdForLabel(label: string): string {
  const stem = basename(label, extname(label))
    .replace(/[^A-Za-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, MAX_ID_STEM_LENGTH);
  const fingerprint = createHash("sha256").update(label).digest("hex").slice(0, 8);
  return `${stem === "" ? "artifact" : stem}-${fingerprint}`;
}

/**
 * Identity of the logical artifact across revisions. It is derived from the
 * catalog path only, so editing the file produces a new revision under the same
 * thread and an unrelated sibling can never move it.
 */
export function artifactThreadIdForLabel(label: string): string {
  return `thread-${createHash("sha256").update(`artifact-thread\u0000${label}`).digest("hex").slice(0, 32)}`;
}

/** Base path every revision-scoped reference for one artifact hangs from. */
export function artifactRevisionBase(id: string, digest: ArtifactDigest): string {
  return `/api/artifacts/${encodeURIComponent(id)}/revisions/${digestHex(digest)}`;
}

export function digestHex(digest: ArtifactDigest): string {
  return digest.slice("sha256:".length);
}

/**
 * Index a directory of run-produced artifacts.
 *
 * Ids are stable, opaque handles: the only supported way back to a path is
 * through this catalog, so a client can never name a path. Entries the catalog
 * declines are reported in `omitted` rather than disappearing, because a file
 * that is silently absent from a run's outputs is indistinguishable from a file
 * the run never produced.
 */
export async function indexArtifactDirectory(
  directory: string,
  options: IndexArtifactDirectoryOptions = {},
): Promise<ArtifactIndex> {
  const root = resolve(directory);
  const physicalRoot = await realpath(root);
  const entries: ArtifactEntry[] = [];
  const omitted: ArtifactOmission[] = [];
  const names = options.includePaths === undefined
    ? (await readdir(root)).sort()
    : [...new Set(options.includePaths)].sort();
  for (const name of names) {
    if (name === "" || name.includes("\u0000") || name.includes("\\") || name.startsWith("/") || /^[A-Za-z]:\//u.test(name) || name.split("/").some((part) => part === "" || part === "." || part === "..")) {
      throw new ArtifactCatalogContractError("Artifact include paths must be bounded portable relative paths.");
    }
    const path = confineToRoot(root, name);
    // lstat never follows the final component, so a symlink reports as a link
    // rather than as the file it points at. Artifact directories are data
    // boundaries and following one would let an otherwise harmless catalog id
    // read bytes outside that boundary.
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      omitted.push({ label: name, reason: "symlink" });
      continue;
    }
    // A directory is not a declined artifact. Code-backed artifacts import
    // their own subdirectories, so reporting one as an omission tells an
    // operator a normal part of the project was refused. `not-a-file` stays for
    // entries that really did present themselves as candidate files — sockets,
    // FIFOs, device nodes.
    if (stats.isDirectory()) continue;
    if (!stats.isFile()) {
      omitted.push({ label: name, reason: "not-a-file" });
      continue;
    }
    if (stats.nlink > 1 && options.allowLinkedFiles !== true) {
      omitted.push({ label: name, reason: "hard-link" });
      continue;
    }
    // Guards a symlinked ancestor and any future nested indexing; a regular
    // file directly under an already-resolved root cannot escape on its own.
    if (!isWithinRoot(physicalRoot, await realpath(path))) {
      omitted.push({ label: name, reason: "outside-root" });
      continue;
    }
    const digest = options.includeDigests === true ? await digestArtifactFile(path, stats) : undefined;
    const kind = resolveArtifactKind(name) === "unknown" && !FORMAT_BY_EXTENSION.has(extname(name).toLowerCase())
      ? await isProbablyTextFile(path, stats)
        ? "text"
        : "unknown"
      : resolveArtifactKind(name);
    entries.push({
      id: artifactIdForLabel(name),
      threadId: artifactThreadIdForLabel(name),
      kind,
      label: name,
      path,
      size: stats.size,
      ...(digest === undefined ? {} : { digest }),
    });
  }
  return { catalogId: catalogIdForRoot(physicalRoot), entries, omitted };
}

function catalogIdForRoot(physicalRoot: string): string {
  // Identifies which artifact set a response describes without publishing the
  // operator's filesystem layout. Switching directories switches the id.
  return `artifacts-${createHash("sha256").update(physicalRoot).digest("hex").slice(0, 16)}`;
}

function isWithinRoot(root: string, target: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + sep);
}

export function describeArtifactCatalog(
  index: ArtifactIndex,
  resolutionFor: (entry: ArtifactEntry) => ArtifactPluginResolution,
): ArtifactCatalogResponse {
  if (index.entries.some((entry) => entry.digest === undefined)) {
    throw new ArtifactCatalogContractError("Artifact catalog snapshots require exact-byte digests.");
  }
  const artifacts = index.entries.map((entry) => {
    const selected = resolutionFor(entry);
    const renderer = { ...selected.renderer };
    // The public binding identity is minted by this server-owned projection;
    // a provider contribution cannot supply or retain its own value.
    delete renderer.bindingId;
    const digest = entry.digest!;
    const base = artifactRevisionBase(entry.id, digest);
    const intentEnabled = selected.intent !== undefined
      && selected.surface.kind === "external-hosted"
      && selected.renderer.status === "ready"
      && selected.capabilities.includes("select");
    const snapshotId = `sha256:${createHash("sha256")
      .update(JSON.stringify([
        digest,
        selected.adapter.id,
        selected.adapter.version,
        selected.adapter.schemaId,
        selected.provider?.fingerprint,
        selected.provider?.contributionSupport,
        selected.provider?.adapterExecutionProfile,
        selected.provider?.surfaceSecurityProfile,
      ]))
      .digest("hex")}` as ArtifactDigest;
    return {
      id: entry.id,
      threadId: entry.threadId,
      family: resolveArtifactFamily(entry.label, entry.kind),
      format: resolveArtifactFormatCode(entry.label),
      backing: selected.backing,
      label: entry.label,
      size: entry.size,
      revision: {
        id: digest,
        digest,
        content: {
          mediaType: resolveArtifactMediaType(entry.label, entry.kind),
          uri: `${base}/content`,
          digest,
        },
      },
      adapter: {
        id: selected.adapter.id,
        version: selected.adapter.version,
        schemaId: selected.adapter.schemaId,
        snapshotId,
        snapshotUri: `${base}/snapshot`,
      },
      ...(selected.backing === "code" ? { build: { snapshotUri: `${base}/build` } } : {}),
      ...(intentEnabled ? { intent: { intentUri: `${base}/intents` } } : {}),
      ...(selected.interaction === undefined ? {} : { interaction: { workspaceUri: `${base}/interaction` } }),
      renderer: {
        ...renderer,
        ...(selected.renderer.status === "ready" ? { bindingId: artifactSurfaceBindingId(selected) } : {}),
        ...(selected.surface.kind === "external-hosted" ? { viewUri: `${base}/viewer/` } : {}),
      },
      capabilities: [...selected.capabilities],
    };
  });
  return {
    kind: ARTIFACT_CATALOG_RESPONSE_KIND,
    snapshot: {
      catalogId: index.catalogId,
      revision: catalogRevision(index, artifacts),
    },
    artifacts,
    omitted: index.omitted,
  };
}

/**
 * A revision must change whenever any part of the response it stamps changes.
 * Content digests alone are not enough: provisioning a renderer rewrites which
 * adapter and surface a client should use while every byte on disk stays put,
 * and a revision that cannot see that is useless as a cache or refetch key.
 */
function catalogRevision(
  index: ArtifactIndex,
  artifacts: ArtifactCatalogResponse["artifacts"],
): ArtifactDigest {
  const rows = artifacts
    .map((artifact) => [
      artifact.id,
      artifact.threadId,
      artifact.label,
      artifact.size,
      artifact.family,
      artifact.format,
      artifact.backing,
      artifact.revision.digest,
      artifact.revision.content.mediaType,
      artifact.adapter.id,
      artifact.adapter.version,
      artifact.adapter.schemaId,
      artifact.adapter.snapshotId,
      artifact.adapter.snapshotUri,
      artifact.build?.snapshotUri,
      artifact.renderer.id,
      artifact.renderer.label,
      artifact.renderer.provider,
      artifact.renderer.type,
      artifact.renderer.status,
      artifact.renderer.bindingId,
      artifact.renderer.viewUri,
      artifact.renderer.reason,
      [...artifact.capabilities].sort(),
    ] as const)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const omissions = index.omitted
    .map((omission) => [omission.label, omission.reason] as const)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `sha256:${createHash("sha256")
    .update(JSON.stringify([index.catalogId, rows, omissions]))
    .digest("hex")}`;
}

export function resolveArtifactFamily(path: string, kind = resolveArtifactKind(path)): ArtifactFamily {
  if (DOCUMENT_EXTENSIONS.has(extname(path).toLowerCase())) return "documents";
  if (kind === "image" || kind === "svg" || kind === "mermaid") return "images-diagrams";
  if (kind === "json" || extname(path).toLowerCase() === ".lottie") return "data";
  if (["code", "diff", "markdown", "text"].includes(kind)) return "source-text";
  return "other";
}

/**
 * Stable machine-readable format code. Display names belong to the client:
 * shipping "PowerPoint" in a versioned contract freezes an English label into
 * the wire and gives translators nothing to work with.
 */
export function resolveArtifactFormatCode(path: string): string {
  if (path.toLowerCase().endsWith(".agent.canvas.tsx")) return AGENT_REACT_TSX_FORMAT;
  if (path.toLowerCase().endsWith(".canvas.tsx")) return PROVIDER_HOSTED_CANVAS_TSX_FORMAT;
  const extension = extname(path).toLowerCase();
  return extension === "" ? "file" : extension.slice(1);
}

export function resolveArtifactMediaType(path: string, kind = resolveArtifactKind(path)): string {
  const format = resolveArtifactFormat(path);
  return format === UNKNOWN_FORMAT && kind === "text"
    ? "text/plain; charset=utf-8"
    : format.mediaType;
}

export function isActiveArtifactContent(path: string): boolean {
  return resolveArtifactFormat(path).active === true;
}

export function findArtifact(entries: readonly ArtifactEntry[], id: string): ArtifactEntry | undefined {
  return entries.find((entry) => entry.id === id);
}

/**
 * Resolve a name under `root` and reject anything that escapes it. The Studio's
 * static handler is rooted at the app directory, so artifacts need their own
 * confinement rather than reusing it.
 */
export function confineToRoot(root: string, name: string): string {
  const resolvedRoot = resolve(root);
  const target = normalize(resolve(resolvedRoot, name));
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + sep)) {
    throw new Error("Artifact path escapes the artifact directory.");
  }
  return target;
}

/**
 * Exact-byte digest of one artifact, memoised on filesystem identity.
 *
 * Invalidation contract: a cached digest is reused only while the inode, byte
 * size, mtime, and ctime all match the stat that produced it. ctime moves on
 * every write, including in-place rewrites that keep the size and mtime, so a
 * modified file cannot reuse a stale digest without the filesystem also failing
 * to record the write.
 */
const digestCache = new Map<string, ArtifactDigest>();

export async function digestArtifactFile(path: string, stats: Stats): Promise<ArtifactDigest> {
  const key = `${path}\u0000${stats.dev}\u0000${stats.ino}\u0000${stats.size}\u0000${stats.mtimeMs}\u0000${stats.ctimeMs}`;
  const cached = digestCache.get(key);
  if (cached !== undefined) {
    digestCache.delete(key);
    digestCache.set(key, cached);
    return cached;
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Uint8Array);
  const digest: ArtifactDigest = `sha256:${hash.digest("hex")}`;
  digestCache.set(key, digest);
  while (digestCache.size > MAX_DIGEST_CACHE_ENTRIES) digestCache.delete(digestCache.keys().next().value!);
  return digest;
}

export function resetArtifactDigestCache(): void {
  digestCache.clear();
}

async function isProbablyTextFile(path: string, stats: Stats): Promise<boolean> {
  if (stats.size === 0) return true;
  const length = Math.min(stats.size, TEXT_SNIFF_BYTES);
  const bytes = Buffer.allocUnsafe(length);
  const handle = await open(path, "r");
  try {
    const { bytesRead } = await handle.read(bytes, 0, length, 0);
    const sample = bytes.subarray(0, bytesRead);
    if (sample.includes(0)) return false;
    let decoded: string | undefined;
    // A bounded sample can end halfway through one UTF-8 sequence. Trimming at
    // most three bytes distinguishes that boundary from genuinely invalid
    // bytes without reading an unbounded artifact into memory.
    for (let trim = 0; trim <= 3 && trim < sample.length; trim += 1) {
      try {
        decoded = new TextDecoder("utf-8", { fatal: true }).decode(sample.subarray(0, sample.length - trim));
        break;
      } catch {
        // Try the next possible UTF-8 boundary.
      }
    }
    if (decoded === undefined) return false;
    let controls = 0;
    for (const character of decoded) {
      const code = character.codePointAt(0)!;
      if (code < 32 && character !== "\n" && character !== "\r" && character !== "\t" && character !== "\f") controls += 1;
    }
    return controls / Math.max(decoded.length, 1) < 0.01;
  } finally {
    await handle.close();
  }
}

function resolveArtifactFormat(path: string): ArtifactFormat {
  return FORMAT_BY_EXTENSION.get(extname(path).toLowerCase()) ?? UNKNOWN_FORMAT;
}
