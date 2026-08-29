import { ArtifactDescriptor } from "../../contracts/artifact.js";
import { WORKSPACE_ARTIFACT_NAVIGATION_KIND } from "../../contracts/workspace-artifact.js";
import { ArtifactCatalogContractError, ArtifactEntry, ArtifactIndex, IndexArtifactDirectoryOptions, artifactIdForLabel, artifactRevisionBase, assertArtifactId, describeArtifactCatalog, digestHex, findArtifact, indexArtifactDirectory, isActiveArtifactContent, resolveArtifactMediaType } from "../artifacts/registry/artifact-catalog.js";
import { artifactPreviewHtml, compileArtifactPreview, findCompiledArtifactPreview } from "../artifacts/registry/artifact-compile-runtime.js";
import { ArtifactBuildRuntimeImplementation, ArtifactPluginResolution } from "../artifacts/registry/artifact-plugin-registry.js";
import { discoverArtifactProviderRuntime } from "../artifacts/registry/artifact-provider-discovery.js";
import { formatTrustedRendererCompileError } from "../artifacts/registry/trusted-renderer-compiler.js";
import { resolveQoderCanvasRuntime, serveQoderCanvasRuntimeFile } from "../providers/qoder/canvas-viewer-bridge.js";
import { randomUUID } from "node:crypto";
import { createReadStream, watch as watchDirectory } from "node:fs";
import { mkdtemp, open, rm, stat, writeFile } from "node:fs/promises";
import { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { IMPORT_SESSION_TTL_MS, MAX_IMPORT_BYTES, MAX_IMPORT_SESSIONS, respondJson, sameOriginRequest, STATIC_CONTENT_TYPES } from "../http-utils.js";
import { ArtifactImportSession, HarnessStudioServerOptions, HarnessStudioState, StudioWorkspace } from "../studio-types.js";

export const MAX_IMPORT_FILES = 256;
/** Each artifact event stream owns a recursive filesystem watcher. */
export const MAX_ARTIFACT_EVENT_STREAMS = 8;

export async function createArtifactImport(
  request: IncomingMessage,
  response: ServerResponse,
  state: HarnessStudioState,
): Promise<void> {
  if (!sameOriginRequest(request)) {
    respondJson(response, 403, { error: "Cross-origin artifact imports are not allowed." });
    return;
  }
  if (state.artifactImports.size >= MAX_IMPORT_SESSIONS) {
    respondJson(response, 429, { error: "Too many artifact import sessions are open." });
    return;
  }
  const sessionId = randomUUID();
  const directory = await mkdtemp(join(tmpdir(), "harness-studio-import-"));
  const expiry = setTimeout(() => { void removeArtifactImport(state, sessionId); }, IMPORT_SESSION_TTL_MS);
  expiry.unref();
  state.artifactImports.set(sessionId, { directory, fileCount: 0, totalBytes: 0, labels: new Set(), expiry });
  respondJson(response, 201, { sessionId, maxFiles: MAX_IMPORT_FILES, maxBytes: MAX_IMPORT_BYTES });
}
export async function importArtifactFile(
  request: IncomingMessage,
  response: ServerResponse,
  state: HarnessStudioState,
  sessionId: string,
  requestedName: string | null,
): Promise<void> {
  if (!sameOriginRequest(request)) {
    respondJson(response, 403, { error: "Cross-origin artifact imports are not allowed." });
    return;
  }
  const session = artifactImportSession(state, sessionId);
  if (session === undefined) {
    respondJson(response, 404, { error: "Artifact import session is unavailable." });
    return;
  }
  if (session.fileCount >= MAX_IMPORT_FILES) {
    respondJson(response, 413, { error: `Artifact imports are limited to ${MAX_IMPORT_FILES} files.` });
    return;
  }
  const declaredBytes = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredBytes) && declaredBytes >= 0 && session.totalBytes + declaredBytes > MAX_IMPORT_BYTES) {
    request.resume();
    respondJson(response, 413, { error: "Artifact import exceeds the 128 MiB aggregate limit." });
    return;
  }
  let label: string;
  try {
    label = uniqueImportLabel(portableImportLabel(requestedName), session.labels);
  } catch (error) {
    respondJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    return;
  }
  const chunks: Buffer[] = [];
  let fileBytes = 0;
  let destination: string | undefined;
  try {
    for await (const chunk of request) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      fileBytes += bytes.length;
      if (session.totalBytes + fileBytes > MAX_IMPORT_BYTES) throw new Error("Artifact import exceeds the 128 MiB aggregate limit.");
      chunks.push(bytes);
    }
    destination = join(session.directory, label);
    const handle = await open(destination, "wx");
    try {
      await handle.writeFile(Buffer.concat(chunks));
    } finally {
      await handle.close();
    }
    session.fileCount += 1;
    session.totalBytes += fileBytes;
    session.labels.add(label.toLowerCase());
    respondJson(response, 201, { label, size: fileBytes });
  } catch (error) {
    if (destination !== undefined) await rm(destination, { force: true });
    respondJson(response, 413, { error: error instanceof Error ? error.message : String(error) });
  }
}
export async function commitArtifactImport(
  request: IncomingMessage,
  response: ServerResponse,
  state: HarnessStudioState,
  sessionId: string,
): Promise<void> {
  if (!sameOriginRequest(request)) {
    respondJson(response, 403, { error: "Cross-origin artifact imports are not allowed." });
    return;
  }
  const session = artifactImportSession(state, sessionId);
  if (session === undefined) {
    respondJson(response, 404, { error: "Artifact import session is unavailable." });
    return;
  }
  if (session.fileCount === 0) {
    respondJson(response, 400, { error: "Select at least one artifact before committing the import." });
    return;
  }
  clearTimeout(session.expiry);
  state.artifactImports.delete(sessionId);
  const previous = state.ownedArtifactDirectory;
  state.artifactDirectory = session.directory;
  state.artifactPaths = undefined;
  if (state.workspace !== undefined) delete state.workspace.artifactObservations;
  state.ownedArtifactDirectory = session.directory;
  if (previous !== undefined && previous !== session.directory) {
    await rm(previous, { recursive: true, force: true }).catch(() => undefined);
  }
  respondJson(response, 200, { imported: session.fileCount, totalBytes: session.totalBytes });
}
export async function abortArtifactImport(
  request: IncomingMessage,
  response: ServerResponse,
  state: HarnessStudioState,
  sessionId: string,
): Promise<void> {
  if (!sameOriginRequest(request)) {
    respondJson(response, 403, { error: "Cross-origin artifact imports are not allowed." });
    return;
  }
  if (artifactImportSession(state, sessionId) === undefined) {
    respondJson(response, 404, { error: "Artifact import session is unavailable." });
    return;
  }
  await removeArtifactImport(state, sessionId);
  respondJson(response, 200, { aborted: true });
}
function artifactImportSession(state: HarnessStudioState, sessionId: string): ArtifactImportSession | undefined {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(sessionId)
    ? state.artifactImports.get(sessionId)
    : undefined;
}
function portableImportLabel(value: string | null): string {
  if (value === null || value.trim() === "") throw new Error("Artifact file name is required.");
  const segments = value.replaceAll("\\", "/").split("/").filter((segment) => segment !== "");
  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Artifact file name must not contain traversal segments.");
  }
  const flattened = segments.join("--")
    .replace(/[<>:"|?*\u0000-\u001f]/gu, "-")
    .replace(/[. ]+$/u, "")
    .slice(0, 180);
  if (flattened === "") throw new Error("Artifact file name has no portable characters.");
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(flattened) ? `_${flattened}` : flattened;
}
function uniqueImportLabel(label: string, used: ReadonlySet<string>): string {
  if (!used.has(label.toLowerCase())) return label;
  const extension = extname(label);
  const stem = label.slice(0, label.length - extension.length);
  for (let suffix = 2; suffix <= MAX_IMPORT_FILES; suffix += 1) {
    const candidate = `${stem}-${suffix}${extension}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  throw new Error("Artifact file name cannot be made unique.");
}
async function removeArtifactImport(state: HarnessStudioState, sessionId: string): Promise<void> {
  const session = state.artifactImports.get(sessionId);
  if (session === undefined) return;
  clearTimeout(session.expiry);
  state.artifactImports.delete(sessionId);
  await rm(session.directory, { recursive: true, force: true });
}
export async function cleanupArtifactImports(state: HarnessStudioState): Promise<void> {
  await Promise.all([...state.artifactImports.keys()].map((sessionId) => removeArtifactImport(state, sessionId)));
  if (state.ownedArtifactDirectory !== undefined) {
    await rm(state.ownedArtifactDirectory, { recursive: true, force: true });
    state.ownedArtifactDirectory = undefined;
  }
}
/**
 * Resolve an artifact through the catalog. The client only ever names an opaque
 * id, so no request can turn into a filesystem path of its own choosing.
 */
async function resolveArtifactIndex(
  directory: string | undefined,
  options: IndexArtifactDirectoryOptions = {},
): Promise<ArtifactIndex | { error: string; status: number }> {
  if (directory === undefined) {
    return { error: "No artifact set loaded; choose files or a folder in Artifacts.", status: 404 };
  }
  try {
    return await indexArtifactDirectory(directory, options);
  } catch {
    // A directory that vanished or turned unreadable after startup must answer
    // with a status, not reject out of the route handler and take the server
    // down. The message stays generic so no filesystem path reaches the client.
    return { error: "Cannot read the configured artifact directory.", status: 404 };
  }
}
async function resolveArtifactRevision(
  directory: string | undefined,
  id: string,
  revision: string,
  includePaths?: readonly string[],
): Promise<{ entry: ArtifactEntry; index: ArtifactIndex } | { error: string; status: number }> {
  try {
    assertArtifactId(id);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), status: 400 };
  }
  const index = await resolveArtifactIndex(directory, { includeDigests: true, includePaths });
  if ("error" in index) return index;
  const entry = findArtifact(index.entries, id);
  if (entry === undefined) {
    return { error: `No artifact '${id}'.`, status: 404 };
  }
  // The catalog handed out this exact revision. Answering the same URL with
  // different bytes is the failure the digest exists to prevent, so a file that
  // moved on is a conflict the client refetches, not a body it cannot verify.
  if (digestHex(entry.digest!) !== revision) {
    return { error: `Artifact '${id}' has moved past the requested revision.`, status: 409 };
  }
  return { entry, index };
}
export async function resolveArtifactRevisionPlugin(
  options: HarnessStudioServerOptions,
  id: string,
  revision: string,
): Promise<{ entry: ArtifactEntry; descriptor: ArtifactDescriptor; resolution: ArtifactPluginResolution } | { error: string; status: number }> {
  const resolved = await resolveArtifactRevision(options.artifactDirectory, id, revision, options.artifactPaths);
  if ("error" in resolved) return resolved;
  const runtime = await discoverArtifactProviderRuntime(options);
  const resolution = runtime.registry.resolve(resolved.entry);
  // Project through the same function the catalog uses so a single artifact and
  // the listing can never describe the same revision differently.
  const descriptor = describeArtifactCatalog({ ...resolved.index, entries: [resolved.entry] }, () => resolution).artifacts[0];
  if (descriptor === undefined) return { error: `No artifact '${id}'.`, status: 404 };
  return { entry: resolved.entry, descriptor, resolution };
}
export async function serveArtifactCatalog(
  response: ServerResponse,
  options: HarnessStudioServerOptions,
  workspace?: StudioWorkspace,
): Promise<void> {
  const index = await resolveArtifactIndex(options.artifactDirectory, { includeDigests: true, includePaths: options.artifactPaths });
  if ("error" in index) {
    respondJson(response, index.status, { error: index.error });
    return;
  }
  const runtime = await discoverArtifactProviderRuntime(options);
  try {
    const catalog = describeArtifactCatalog(
      index,
      (entry) => runtime.registry.resolve(entry),
    );
    const navigation = workspace?.artifactObservations === undefined
      ? undefined
      : {
        kind: WORKSPACE_ARTIFACT_NAVIGATION_KIND,
        workspaceLabel: workspace.label,
        observations: workspace.artifactObservations.map((observation) => ({
          artifactId: artifactIdForLabel(observation.relativePath),
          sessionId: observation.sessionId,
          savedAt: observation.savedAt,
          prompt: observation.prompt,
          ...(observation.provider === undefined ? {} : { provider: observation.provider }),
        })),
      };
    respondJson(response, 200, navigation === undefined ? catalog : { ...catalog, navigation });
  } catch (error) {
    const message = error instanceof ArtifactCatalogContractError
      ? "Artifact catalog contract validation failed."
      : "Cannot build the artifact catalog response.";
    respondJson(response, 500, { error: message });
  }
}
/** Advisory invalidation stream; catalog and revision routes remain authoritative. */
export function serveArtifactEvents(
  request: IncomingMessage,
  response: ServerResponse,
  state: HarnessStudioState,
  options: HarnessStudioServerOptions,
): void {
  const watched = options.artifactDirectory;
  if (watched === undefined) {
    respondJson(response, 404, { error: "No artifact directory configured." });
    return;
  }
  // Each stream holds an open recursive watcher, so the count is a real
  // resource, not just a connection tally.
  if (state.artifactEventStreams >= MAX_ARTIFACT_EVENT_STREAMS) {
    respondJson(response, 503, { error: "Too many artifact event streams are open." });
    return;
  }
  let watcher: ReturnType<typeof watchDirectory>;
  try {
    watcher = watchDirectory(watched, { recursive: true });
  } catch {
    respondJson(response, 404, { error: "Cannot observe the configured artifact directory." });
    return;
  }
  state.artifactEventStreams += 1;
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.write("retry: 1000\n\n");
  let sequence = 0;
  let closed = false;
  let debounce: NodeJS.Timeout | undefined;
  const emitInvalidation = (): void => {
    sequence += 1;
    response.write(`id: ${sequence}\nevent: artifacts.invalidated\ndata: ${JSON.stringify({ type: "artifacts.invalidated", sequence })}\n\n`);
  };
  watcher.on("change", () => {
    if (debounce !== undefined) clearTimeout(debounce);
    debounce = setTimeout(emitInvalidation, 75);
  });
  const heartbeat = setInterval(() => {
    // A stream watches the directory it was opened against. Importing a new
    // artifact set replaces that directory, and a watcher left on the old one
    // reports changes nobody is looking at while missing every change to the
    // set now on screen. Ending the response lets the client's own reconnect
    // re-open the stream against the active directory.
    if (state.artifactDirectory !== watched) {
      cleanup();
      response.end();
      return;
    }
    response.write(": keepalive\n\n");
  }, 15_000);
  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    state.artifactEventStreams -= 1;
    if (debounce !== undefined) clearTimeout(debounce);
    clearInterval(heartbeat);
    watcher.close();
  };
  request.once("close", cleanup);
  watcher.once("error", () => {
    cleanup();
    response.end();
  });
}
/**
 * Artifact reads are same-origin only.
 *
 * Studio binds to the loopback interface, which stops another machine from
 * reaching it but does nothing about a page the operator is already browsing:
 * that page runs inside the same browser and can address `127.0.0.1` freely.
 * Without this check — and with the permissive CORS header these routes used to
 * send — any site the operator visited could read a run's entire output set.
 */
export function allowArtifactRead(request: IncomingMessage, response: ServerResponse): boolean {
  if (sameOriginRequest(request)) return true;
  respondArtifactJson(response, 403, { error: "Cross-origin artifact reads are not allowed." });
  return false;
}
export function respondArtifactJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(`${JSON.stringify(payload)}\n`);
}
/** Revision-scoped URLs name exact bytes, so their responses never go stale. */
const IMMUTABLE_REVISION_CACHE = "private, max-age=31536000, immutable";
export async function serveArtifactContent(
  response: ServerResponse,
  options: HarnessStudioServerOptions,
  id: string,
  revision: string,
  ifNoneMatch: string | undefined,
): Promise<void> {
  const resolved = await resolveArtifactRevision(options.artifactDirectory, id, revision, options.artifactPaths);
  if ("error" in resolved) {
    respondArtifactJson(response, resolved.status, { error: resolved.error });
    return;
  }
  const entry = resolved.entry;
  const etag = `"${digestHex(entry.digest!)}"`;
  if (ifNoneMatch !== undefined && ifNoneMatch.split(",").some((value) => value.trim() === etag)) {
    response.writeHead(304, { ETag: etag, "Cache-Control": IMMUTABLE_REVISION_CACHE });
    response.end();
    return;
  }
  try {
    const stats = await stat(entry.path);
    if (stats.size !== entry.size) {
      respondArtifactJson(response, 409, { error: `Artifact '${id}' has moved past the requested revision.` });
      return;
    }
    const headers: Record<string, string | number> = {
      "Content-Type": resolveArtifactMediaType(entry.label, entry.kind),
      "Content-Length": stats.size,
      ETag: etag,
      "Cache-Control": IMMUTABLE_REVISION_CACHE,
      "X-Content-Type-Options": "nosniff",
    };
    if (isActiveArtifactContent(entry.label)) {
      headers["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(entry.label)}`;
      headers["Content-Security-Policy"] = "default-src 'none'; sandbox";
    }
    response.writeHead(200, headers);
    createReadStream(entry.path).pipe(response);
  } catch {
    respondArtifactJson(response, 404, { error: `Artifact '${id}' is no longer readable.` });
  }
}
export async function serveArtifactSnapshot(
  response: ServerResponse,
  options: HarnessStudioServerOptions,
  id: string,
  revision: string,
): Promise<void> {
  const resolved = await resolveArtifactRevisionPlugin(options, id, revision);
  if ("error" in resolved) {
    respondArtifactJson(response, resolved.status, { error: resolved.error });
    return;
  }
  try {
    // The registry already chose this adapter; calling it directly is what keeps
    // selection and execution from drifting into two separate decisions.
    const snapshot = await resolved.resolution.adapter.adapt({ entry: resolved.entry, descriptor: resolved.descriptor });
    respondArtifactJson(response, 200, snapshot);
  } catch (error) {
    respondArtifactJson(response, 422, { error: safeArtifactError(error) });
  }
}
async function resolveArtifactBuildPreview(
  options: HarnessStudioServerOptions,
  id: string,
  revision: string,
): Promise<
  | { entry: ArtifactEntry; descriptor: ArtifactDescriptor; resolution: ArtifactPluginResolution; artifactRoot: string; buildRuntime: ArtifactBuildRuntimeImplementation }
  | { error: string; status: number }
> {
  const resolved = await resolveArtifactRevisionPlugin(options, id, revision);
  if ("error" in resolved) return resolved;
  if (options.artifactDirectory === undefined
    || resolved.resolution.backing !== "code"
    || resolved.resolution.buildRuntime === undefined) {
    return { error: `Artifact '${id}' has no Studio build preview.`, status: 415 } as const;
  }
  return { ...resolved, artifactRoot: options.artifactDirectory, buildRuntime: resolved.resolution.buildRuntime };
}
export async function serveArtifactBuild(
  response: ServerResponse,
  options: HarnessStudioServerOptions,
  id: string,
  revision: string,
): Promise<void> {
  const resolved = await resolveArtifactBuildPreview(options, id, revision);
  if ("error" in resolved) {
    respondArtifactJson(response, resolved.status, { error: resolved.error });
    return;
  }
  try {
    const compiled = await compileArtifactPreview({
      artifactRoot: resolved.artifactRoot,
      entry: resolved.entry,
      descriptor: resolved.descriptor,
      buildRuntime: resolved.buildRuntime,
      limits: options.artifactCompileLimits,
    });
    respondArtifactJson(response, 200, compiled.snapshot);
  } catch (error) {
    respondArtifactJson(response, 422, { error: safeArtifactError(error) });
  }
}
export async function serveArtifactBuildPreview(
  response: ServerResponse,
  options: HarnessStudioServerOptions,
  id: string,
  revision: string,
  buildId: string,
): Promise<void> {
  const resolved = await resolveArtifactBuildPreview(options, id, revision);
  if ("error" in resolved) {
    respondArtifactJson(response, resolved.status, { error: resolved.error });
    return;
  }
  try {
    const revisionId = resolved.descriptor.revision.id;
    let compiled = findCompiledArtifactPreview(buildId, id, revisionId);
    if (compiled === undefined) {
      const current = await compileArtifactPreview({
        artifactRoot: resolved.artifactRoot,
        entry: resolved.entry,
        descriptor: resolved.descriptor,
        buildRuntime: resolved.buildRuntime,
        limits: options.artifactCompileLimits,
      });
      if (digestHex(current.snapshot.buildId) === buildId) compiled = current;
    }
    if (compiled === undefined) {
      respondArtifactJson(response, 410, { error: "The requested Artifact build is no longer retained." });
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": IMMUTABLE_REVISION_CACHE,
      "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; media-src data: blob:; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(artifactPreviewHtml(compiled));
  } catch (error) {
    respondArtifactJson(response, 422, { error: safeArtifactError(error) });
  }
}
export async function serveArtifactSnapshotResource(
  response: ServerResponse,
  options: HarnessStudioServerOptions,
  id: string,
  revision: string,
  resourceId: string,
): Promise<void> {
  const resolved = await resolveArtifactRevisionPlugin(options, id, revision);
  if ("error" in resolved) {
    respondArtifactJson(response, resolved.status, { error: resolved.error });
    return;
  }
  try {
    const readResource = resolved.resolution.adapter.readResource;
    const resource = readResource === undefined
      ? undefined
      : await readResource({ entry: resolved.entry, descriptor: resolved.descriptor }, resourceId);
    if (resource === undefined) {
      respondArtifactJson(response, 404, { error: `No artifact resource '${resourceId}'.` });
      return;
    }
    response.writeHead(200, {
      "Content-Type": resource.mediaType,
      "Content-Length": resource.bytes.byteLength,
      "Cache-Control": IMMUTABLE_REVISION_CACHE,
      "X-Content-Type-Options": "nosniff",
    });
    response.end(resource.bytes);
  } catch (error) {
    respondArtifactJson(response, 422, { error: safeArtifactError(error) });
  }
}
export function safeArtifactError(error: unknown): string {
  const message = error instanceof Error && error.message !== "" ? error.message : "Artifact adaptation failed.";
  return message.replaceAll(process.cwd(), "<workspace>").slice(0, 1_000);
}
async function resolveArtifactHostedSurface(
  options: HarnessStudioServerOptions,
  id: string,
  revision: string,
): Promise<{
  entry: ArtifactEntry;
  descriptor: ArtifactDescriptor;
  resolution: ArtifactPluginResolution & { surface: Extract<ArtifactPluginResolution["surface"], { kind: "external-hosted" }> };
} | { error: string; status: number }> {
  const resolved = await resolveArtifactRevisionPlugin(options, id, revision);
  if ("error" in resolved) return resolved;
  if (resolved.resolution.surface.kind !== "external-hosted" || resolved.resolution.renderer.status !== "ready") {
    return { error: `Artifact '${id}' has no external hosted surface.`, status: 415 };
  }
  return {
    entry: resolved.entry,
    descriptor: resolved.descriptor,
    resolution: resolved.resolution as ArtifactPluginResolution & {
      surface: Extract<ArtifactPluginResolution["surface"], { kind: "external-hosted" }>;
    },
  };
}
export async function serveArtifactHostedDocument(
  response: ServerResponse,
  options: HarnessStudioServerOptions,
  id: string,
  revision: string,
): Promise<void> {
  const resolved = await resolveArtifactHostedSurface(options, id, revision);
  if ("error" in resolved) {
    respondArtifactJson(response, resolved.status, { error: resolved.error });
    return;
  }
  try {
    const html = await resolved.resolution.surface.runtime.prepareDocument(
      { entry: resolved.entry, descriptor: resolved.descriptor },
      `${artifactRevisionBase(id, resolved.entry.digest!)}/viewer/runtime-module.js?v=1`,
    );
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'self'; worker-src blob:;",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(html);
  } catch (error) {
    respondArtifactJson(response, 422, { error: formatTrustedRendererCompileError(error) });
  }
}
export async function serveArtifactHostedModule(
  response: ServerResponse,
  options: HarnessStudioServerOptions,
  id: string,
  revision: string,
  map: boolean,
): Promise<void> {
  const resolved = await resolveArtifactHostedSurface(options, id, revision);
  if ("error" in resolved) {
    respondArtifactJson(response, resolved.status, { error: resolved.error });
    return;
  }
  try {
    const compiled = await resolved.resolution.surface.runtime.readModule(
      { entry: resolved.entry, descriptor: resolved.descriptor },
      map,
    );
    if (map) {
      respondArtifactJson(response, 200, JSON.parse(compiled));
      return;
    }
    response.writeHead(200, {
      "Content-Type": STATIC_CONTENT_TYPES[".js"]!,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Origin": "*",
    });
    response.end(compiled);
  } catch (error) {
    respondArtifactJson(response, 422, { error: formatTrustedRendererCompileError(error) });
  }
}
export async function serveCanvasSdk(response: ServerResponse, options: HarnessStudioServerOptions, map: boolean): Promise<void> {
  const runtime = resolveQoderCanvasRuntime({ sdkRoot: options.canvasSdkRoot, sdkMedia: options.canvasSdkMedia, cwd: options.cwd });
  const path = map ? runtime?.sdkMapPath : runtime?.sdkPath;
  if (path === undefined) {
    respondArtifactJson(response, 404, { error: "Canvas SDK runtime asset is unavailable." });
    return;
  }
  await serveQoderCanvasRuntimeFile(response, path, map ? "application/json" : STATIC_CONTENT_TYPES[".js"]!);
}
export async function serveArtifactHostedResource(
  response: ServerResponse,
  options: HarnessStudioServerOptions,
  id: string,
  revision: string,
  resource: string,
): Promise<void> {
  const resolved = await resolveArtifactHostedSurface(options, id, revision);
  if ("error" in resolved) {
    respondArtifactJson(response, resolved.status, { error: resolved.error });
    return;
  }
  try {
    const hosted = await resolved.resolution.surface.runtime.readResource(
      { entry: resolved.entry, descriptor: resolved.descriptor },
      resource,
    );
    if (hosted === undefined) throw new Error("unavailable");
    response.writeHead(200, {
      "Content-Type": hosted.mediaType,
      "Content-Length": hosted.bytes.byteLength,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Origin": "*",
    });
    response.end(hosted.bytes);
  } catch {
    respondArtifactJson(response, 404, { error: "Hosted Artifact resource is unavailable." });
  }
}
