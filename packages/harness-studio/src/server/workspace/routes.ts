import { GitCommitDetail } from "../../contracts/git-history.js";
import { isUserInputTrace, projectUserInputTrace } from "../../contracts/input-trace.js";
import { IntentCorrelationAnalysisV1, IntentCorrelationContractError, validateIntentCorrelationAnalysis } from "../../contracts/intent-correlation.js";
import { MAX_STUDIO_PROJECTS, STUDIO_PROJECT_CATALOG_KIND, type StudioProjectDescriptor } from "../../contracts/studio-project.js";
import { validateStudioCustomizationAnalysis } from "../customization-collector.js";
import { sessionFromRetainedRun } from "../debugger-session-transform.js";
import { resolveGitRepositoryRoot } from "../git-history.js";
import { buildIntentCorrelationPacket } from "../intent-correlation.js";
import { parseSavedRunRecord } from "../run-log.js";
import { DirectoryPickerUnavailableError, pickLocalWorkspaceDirectory } from "../workspace/native-directory-picker.js";
import { collectWorkspaceArtifactObservations } from "../workspace/workspace-artifacts.js";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join, normalize, posix, resolve, win32 } from "node:path";
import { IMPORT_SESSION_TTL_MS, MAX_IMPORT_BYTES, MAX_IMPORT_SESSIONS, respondJson, sameOriginRequest } from "../http-utils.js";
import { HarnessStudioServerOptions, HarnessStudioState, StoredStudioProject, StoredWorkspaceSession, StudioWorkspace, StudioWorkspaceSession, WorkspaceImportSession } from "../studio-types.js";

export const MAX_WORKSPACE_FILES = 512;
export const MAX_WORKSPACE_SESSIONS = 200;
const MAX_PROJECT_REVISION_CONTEXTS = 128;

export async function createWorkspaceImport(
  request: IncomingMessage,
  response: ServerResponse,
  state: HarnessStudioState,
  requestedLabel: string | null,
): Promise<void> {
  if (!sameOriginRequest(request)) {
    respondJson(response, 403, { error: "Cross-origin workspace imports are not allowed." });
    return;
  }
  if (state.workspaceImports.size >= MAX_IMPORT_SESSIONS) {
    respondJson(response, 429, { error: "Too many workspace import sessions are open." });
    return;
  }
  const sessionId = randomUUID();
  const directory = await mkdtemp(join(tmpdir(), "harness-studio-workspace-"));
  const expiry = setTimeout(() => {
    const session = state.workspaceImports.get(sessionId);
    if (session === undefined) return;
    if (session.busy) {
      session.expired = true;
      return;
    }
    void removeWorkspaceImport(state, sessionId);
  }, IMPORT_SESSION_TTL_MS);
  expiry.unref();
  state.workspaceImports.set(sessionId, {
    directory,
    fileCount: 0,
    totalBytes: 0,
    paths: new Set(),
    label: portableProjectLabel(requestedLabel),
    expiry,
    busy: false,
    expired: false,
  });
  respondJson(response, 201, { sessionId, maxFiles: MAX_WORKSPACE_FILES, maxBytes: MAX_IMPORT_BYTES });
}
export async function openWorkspace(
  request: IncomingMessage,
  response: ServerResponse,
  options: HarnessStudioServerOptions,
  state: HarnessStudioState,
): Promise<void> {
  if (!sameOriginRequest(request)) {
    respondJson(response, 403, { error: "Cross-origin workspace changes are not allowed." });
    return;
  }
  if (options.workspaceSessionProvider === undefined) {
    respondJson(response, 501, { error: "This Studio launcher does not provide workspace Session discovery." });
    return;
  }
  if (state.workspaceOpenStage !== "idle") {
    respondJson(response, 409, { error: "A workspace directory chooser is already open." });
    return;
  }
  state.workspaceOpenStage = "choosing";
  try {
    const selected = await (options.workspaceDirectoryPicker ?? pickLocalWorkspaceDirectory)();
    if (selected === undefined) {
      respondJson(response, 200, { opened: false, cancelled: true });
      return;
    }
    state.workspaceOpenStage = "discovering";
    const workspacePath = await realpath(selected);
    if (!(await stat(workspacePath)).isDirectory()) {
      respondJson(response, 422, { error: "The selected workspace is not a directory." });
      return;
    }
    const existing = [...state.projects.entries()].find(([, project]) => project.localDirectory !== undefined && sameNativePath(project.localDirectory, workspacePath));
    if (existing === undefined && state.projects.size >= MAX_STUDIO_PROJECTS) {
      respondJson(response, 429, { error: `Studio remembers at most ${MAX_STUDIO_PROJECTS} Projects. Remove one before opening another.` });
      return;
    }
    const workspace = await discoverWorkspace(options, workspacePath);
    const projectId = existing?.[0] ?? `project_${randomUUID().replaceAll("-", "")}`;
    const project: StoredStudioProject = {
      descriptor: descriptorForWorkspace(projectId, "local", workspace),
      kind: "local",
      localDirectory: workspacePath,
    };
    state.projects.set(projectId, project);
    activateWorkspace(state, options, projectId, workspace);
    respondJson(response, 200, {
      opened: true,
      project: project.descriptor,
      revision: state.projectRevision,
      label: workspace.label,
      sessionCount: workspace.sessionCount,
      providers: workspace.providers,
    });
  } catch (error) {
    if (error instanceof DirectoryPickerUnavailableError) {
      respondJson(response, 501, { error: error.message });
      return;
    }
    respondJson(response, 422, { error: "Studio could not discover Sessions for the selected workspace." });
  } finally {
    state.workspaceOpenStage = "idle";
  }
}

async function discoverWorkspace(options: HarnessStudioServerOptions, workspacePath: string): Promise<StudioWorkspace> {
  if (options.workspaceSessionProvider === undefined) throw new Error("Workspace discovery is unavailable.");
  const discovered = await options.workspaceSessionProvider.discover(workspacePath);
  const sessions = new Map<string, StoredWorkspaceSession>();
  for (const candidate of discovered.sessions.slice(0, MAX_WORKSPACE_SESSIONS)) {
    const normalized = normalizeDiscoveredWorkspaceSession(candidate);
    if (!sessions.has(normalized.summary.id)) sessions.set(normalized.summary.id, normalized);
  }
  const providers = (discovered.providers ?? []).map((provider) => ({
    provider: portableWorkspaceLabel(provider.provider),
    status: provider.status,
    discovered: boundedNonNegativeInteger(provider.discovered),
    included: boundedNonNegativeInteger(provider.included),
    ...(provider.status === "error" ? { message: "Provider discovery failed." } : {}),
  }));
  const inspectorReport = discovered.inspectorReport === undefined
    ? undefined
    : validWorkspaceInspectorReport(discovered.inspectorReport)
      ? discovered.inspectorReport
      : (() => { throw new Error("Workspace Inspector report is malformed."); })();
  const inputTrace = inspectorReport === undefined ? undefined : projectUserInputTrace(inspectorReport);
  const gitRoot = await resolveGitRepositoryRoot(workspacePath);
  const artifactObservations = await collectWorkspaceArtifactObservations(workspacePath, [...sessions.values()]);
  return {
    label: portableProjectLabel(discovered.label),
    sessionCount: sessions.size,
    omittedCount: Math.max(0, discovered.sessions.length - sessions.size),
    sessions,
    providers,
    ...(inspectorReport === undefined ? {} : { inspectorReport, inputTrace }),
    localDirectory: workspacePath,
    artifactObservations,
    ...(gitRoot === undefined ? {} : { gitRoot, gitCommitCache: new Map<string, GitCommitDetail>() }),
  };
}

function activateWorkspace(
  state: HarnessStudioState,
  options: HarnessStudioServerOptions,
  projectId: string,
  workspace: StudioWorkspace,
): void {
  state.workspace = workspace;
  state.activeProjectId = projectId;
  state.projectRevision += 1;
  if (workspace.localDirectory !== undefined) {
    state.projectRevisionContexts.delete(state.projectRevision);
    state.projectRevisionContexts.set(state.projectRevision, { projectId, localDirectory: workspace.localDirectory });
    if (state.projectRevisionContexts.size > MAX_PROJECT_REVISION_CONTEXTS) {
      const oldestRevision = state.projectRevisionContexts.keys().next().value as number | undefined;
      if (oldestRevision !== undefined) state.projectRevisionContexts.delete(oldestRevision);
    }
  }
  state.artifactDirectory = workspace.localDirectory ?? options.artifactDirectory;
  state.artifactPaths = workspace.localDirectory === undefined
    ? options.artifactPaths
    : [...new Set((workspace.artifactObservations ?? []).map((observation) => observation.relativePath))];
  state.customizationAnalysis = undefined;
  const project = state.projects.get(projectId);
  if (project !== undefined) {
    project.descriptor = descriptorForWorkspace(projectId, project.kind, workspace);
  }
}

function descriptorForWorkspace(
  id: string,
  kind: "local" | "imported",
  workspace: StudioWorkspace,
  lastOpenedAt = new Date().toISOString(),
): StudioProjectDescriptor {
  return {
    id,
    label: workspace.label,
    kind,
    availability: "ready",
    lastOpenedAt,
    sessionCount: workspace.sessionCount,
    inputCount: workspace.inputTrace?.summary.inputCount ?? 0,
    artifactCount: new Set((workspace.artifactObservations ?? []).map((observation) => observation.relativePath)).size,
    gitEnabled: workspace.gitRoot !== undefined,
    workspaceWorkbenchEnabled: workspace.inspectorReport !== undefined,
  };
}

function sameNativePath(left: string, right: string): boolean {
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

export function serveProjectCatalog(response: ServerResponse, state: HarnessStudioState): void {
  respondJson(response, 200, {
    kind: STUDIO_PROJECT_CATALOG_KIND,
    revision: state.projectRevision,
    ...(state.activeProjectId === undefined ? {} : { activeProjectId: state.activeProjectId }),
    projects: [...state.projects.values()].map((project) => project.descriptor)
      .sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt)),
    stage: state.workspaceOpenStage,
  }, { "Cache-Control": "no-store" });
}

export async function activateProject(
  request: IncomingMessage,
  response: ServerResponse,
  options: HarnessStudioServerOptions,
  state: HarnessStudioState,
  projectId: string,
): Promise<void> {
  if (!sameOriginRequest(request)) {
    respondJson(response, 403, { error: "Cross-origin Project changes are not allowed." });
    return;
  }
  const project = projectForId(state, projectId);
  if (project === undefined) {
    respondJson(response, 404, { error: "The requested Project is not registered." });
    return;
  }
  if (state.workspaceOpenStage !== "idle") {
    respondJson(response, 409, { error: "Another Project is already being opened." });
    return;
  }
  state.workspaceOpenStage = "discovering";
  try {
    let workspace: StudioWorkspace | undefined;
    if (project.kind === "local") {
      const workspacePath = await realpath(project.localDirectory!);
      if (!sameNativePath(workspacePath, project.localDirectory!)) throw new Error("The Project directory identity changed.");
      if (!(await stat(workspacePath)).isDirectory()) throw new Error("The Project directory is unavailable.");
      workspace = await discoverWorkspace(options, workspacePath);
    } else {
      workspace = project.importedWorkspace;
    }
    if (workspace === undefined) throw new Error("The Project workspace is no longer available.");
    activateWorkspace(state, options, projectId, workspace);
    respondJson(response, 200, { activated: true, project: project.descriptor, revision: state.projectRevision });
  } catch {
    project.descriptor = { ...project.descriptor, availability: "unavailable" };
    respondJson(response, 422, { error: "Studio could not refresh the requested Project. The previous Project remains active." });
  } finally {
    state.workspaceOpenStage = "idle";
  }
}

export async function removeProject(
  request: IncomingMessage,
  response: ServerResponse,
  options: HarnessStudioServerOptions,
  state: HarnessStudioState,
  projectId: string,
): Promise<void> {
  if (!sameOriginRequest(request)) {
    respondJson(response, 403, { error: "Cross-origin Project changes are not allowed." });
    return;
  }
  const project = projectForId(state, projectId);
  if (project === undefined) {
    respondJson(response, 404, { error: "The requested Project is not registered." });
    return;
  }
  if (state.workspaceOpenStage !== "idle") {
    respondJson(response, 409, { error: "Another Project change is already in progress." });
    return;
  }
  state.workspaceOpenStage = "removing";
  try {
    if (project.importedWorkspace?.ownedDirectory !== undefined) {
      await rm(project.importedWorkspace.ownedDirectory, { recursive: true, force: true });
    }
    state.projects.delete(projectId);
    if (state.activeProjectId === projectId) {
      state.activeProjectId = undefined;
      state.workspace = undefined;
      state.projectRevision += 1;
      state.artifactDirectory = options.artifactDirectory;
      state.artifactPaths = options.artifactPaths;
      state.customizationAnalysis = undefined;
    }
    respondJson(response, 200, { removed: true, revision: state.projectRevision });
  } catch {
    respondJson(response, 500, { error: "Studio could not remove the imported Project materialization." });
  } finally {
    state.workspaceOpenStage = "idle";
  }
}

function projectForId(state: HarnessStudioState, projectId: string): StoredStudioProject | undefined {
  return /^project_[a-f0-9]{32}$/u.test(projectId) ? state.projects.get(projectId) : undefined;
}
function validWorkspaceInspectorReport(report: Record<string, unknown> | undefined): report is Record<string, unknown> {
  return report !== undefined
    && report.kind === "HarnessInspectorReportV1"
    && Array.isArray(report.sessions)
    && Array.isArray(report.days)
    && report.featureTree !== null
    && typeof report.featureTree === "object";
}
function normalizeDiscoveredWorkspaceSession(candidate: StudioWorkspaceSession): StudioWorkspaceSession {
  const id = String(candidate?.summary?.id ?? "").normalize("NFKC").trim();
  if (id === "" || id.length > 240 || /[\u0000-\u001f\u007f/\\]/u.test(id)) {
    throw new Error("Discovered Session id is not a bounded opaque identifier.");
  }
  const savedAt = new Date(candidate.summary.savedAt);
  if (Number.isNaN(savedAt.valueOf())) throw new Error("Discovered Session requires an observed timestamp.");
  if (candidate.debugger === null || typeof candidate.debugger !== "object" || !Array.isArray(candidate.debugger.events)) {
    throw new Error("Discovered Session requires a debugger projection.");
  }
  return {
    summary: {
      id,
      savedAt: savedAt.toISOString(),
      prompt: String(candidate.summary.prompt || "Untitled Session").slice(0, 500),
      status: ["finished", "error", "observed"].includes(candidate.summary.status) ? candidate.summary.status : "observed",
      toolCallCount: boundedNonNegativeInteger(candidate.summary.toolCallCount),
      ...(candidate.summary.provider === undefined ? {} : { provider: portableWorkspaceLabel(candidate.summary.provider) }),
      ...(candidate.summary.messageCount === undefined ? {} : { messageCount: boundedNonNegativeInteger(candidate.summary.messageCount) }),
      ...(candidate.summary.warningCount === undefined ? {} : { warningCount: boundedNonNegativeInteger(candidate.summary.warningCount) }),
    },
    debugger: candidate.debugger,
  };
}
function boundedNonNegativeInteger(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.trunc(numeric))) : 0;
}
export async function importWorkspaceFile(
  request: IncomingMessage,
  response: ServerResponse,
  state: HarnessStudioState,
  sessionId: string,
  requestedPath: string | null,
): Promise<void> {
  if (!sameOriginRequest(request)) {
    respondJson(response, 403, { error: "Cross-origin workspace imports are not allowed." });
    return;
  }
  const session = workspaceImportSession(state, sessionId);
  if (session === undefined) {
    respondJson(response, 404, { error: "Workspace import session is unavailable." });
    return;
  }
  if (session.busy || session.expired) {
    respondJson(response, 409, { error: "Another operation is already using this workspace import session." });
    return;
  }
  session.busy = true;
  try {
    if (session.fileCount >= MAX_WORKSPACE_FILES) {
      respondJson(response, 413, { error: `Workspace imports are limited to ${MAX_WORKSPACE_FILES} files.` });
      return;
    }
    let relativePath: string;
    try {
      relativePath = portableWorkspacePath(requestedPath);
      if ([...session.paths].some((candidate) => candidate.toLowerCase() === relativePath.toLowerCase())) {
        throw new Error("Workspace file paths must be unique on every supported platform.");
      }
    } catch (error) {
      respondJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
      return;
    }
    const declaredBytes = Number(request.headers["content-length"]);
    if (Number.isFinite(declaredBytes) && declaredBytes >= 0 && session.totalBytes + declaredBytes > MAX_IMPORT_BYTES) {
      request.resume();
      respondJson(response, 413, { error: "Workspace import exceeds the 128 MiB aggregate limit." });
      return;
    }
    const chunks: Buffer[] = [];
    let fileBytes = 0;
    const destination = resolve(session.directory, ...relativePath.split("/"));
    try {
      for await (const chunk of request) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        fileBytes += bytes.length;
        if (session.totalBytes + fileBytes > MAX_IMPORT_BYTES) throw new Error("Workspace import exceeds the 128 MiB aggregate limit.");
        chunks.push(bytes);
      }
      await mkdir(dirname(destination), { recursive: true });
      const handle = await open(destination, "wx");
      try {
        await handle.writeFile(Buffer.concat(chunks));
      } finally {
        await handle.close();
      }
      session.fileCount += 1;
      session.totalBytes += fileBytes;
      session.paths.add(relativePath);
      respondJson(response, 201, { path: relativePath, size: fileBytes });
    } catch (error) {
      await rm(destination, { force: true });
      respondJson(response, 413, { error: error instanceof Error ? error.message : String(error) });
    }
  } finally {
    await releaseWorkspaceImportSession(state, sessionId, session);
  }
}
export async function commitWorkspaceImport(
  request: IncomingMessage,
  response: ServerResponse,
  options: HarnessStudioServerOptions,
  state: HarnessStudioState,
  sessionId: string,
): Promise<void> {
  if (!sameOriginRequest(request)) {
    respondJson(response, 403, { error: "Cross-origin workspace imports are not allowed." });
    return;
  }
  const session = workspaceImportSession(state, sessionId);
  if (session === undefined) {
    respondJson(response, 404, { error: "Workspace import session is unavailable." });
    return;
  }
  if (session.busy || session.expired) {
    respondJson(response, 409, { error: "Another operation is already using this workspace import session." });
    return;
  }
  if (state.workspaceOpenStage !== "idle") {
    respondJson(response, 409, { error: "Another Project change is already in progress." });
    return;
  }
  if (state.projects.size >= MAX_STUDIO_PROJECTS) {
    respondJson(response, 429, { error: `Studio remembers at most ${MAX_STUDIO_PROJECTS} Projects. Remove one before importing another.` });
    return;
  }
  session.busy = true;
  state.workspaceOpenStage = "discovering";
  try {
    await commitWorkspaceImportSession(response, options, state, sessionId, session);
  } finally {
    state.workspaceOpenStage = "idle";
    await releaseWorkspaceImportSession(state, sessionId, session);
  }
}

async function commitWorkspaceImportSession(
  response: ServerResponse,
  options: HarnessStudioServerOptions,
  state: HarnessStudioState,
  sessionId: string,
  session: WorkspaceImportSession,
): Promise<void> {
  const accepted = new Map<string, StoredWorkspaceSession>();
  let omittedCount = 0;
  for (const relativePath of session.paths) {
    if (!/^run_[A-Za-z0-9_-]+\.json$/u.test(basename(relativePath)) || accepted.size >= MAX_WORKSPACE_SESSIONS) {
      omittedCount += 1;
      continue;
    }
    try {
      const sourcePath = resolve(session.directory, ...relativePath.split("/"));
      const record = parseSavedRunRecord(JSON.parse(await readFile(sourcePath, "utf8")));
      if (accepted.has(record.id)) {
        omittedCount += 1;
        continue;
      }
      accepted.set(record.id, {
        summary: {
          id: record.id,
          savedAt: record.savedAt,
          prompt: record.prompt,
          status: record.status,
          toolCallCount: record.toolCallCount,
          provider: "Harness Studio",
          messageCount: record.timeline.filter((item) => item.kind === "message").length,
          warningCount: record.warnings.length,
        },
        debugger: sessionFromRetainedRun(record),
        retainedRun: record,
      });
    } catch {
      omittedCount += 1;
    }
  }
  if (accepted.size === 0) {
    respondJson(response, 422, { error: "No supported retained run records were found in this folder." });
    return;
  }
  clearTimeout(session.expiry);
  state.workspaceImports.delete(sessionId);
  const workspace: StudioWorkspace = {
    label: session.label,
    sessionCount: accepted.size,
    omittedCount,
    sessions: accepted,
    providers: [{ provider: "Harness Studio", status: "ok", discovered: accepted.size, included: accepted.size }],
    ownedDirectory: session.directory,
  };
  const projectId = `project_${randomUUID().replaceAll("-", "")}`;
  const project: StoredStudioProject = {
    descriptor: descriptorForWorkspace(projectId, "imported", workspace),
    kind: "imported",
    importedWorkspace: workspace,
  };
  state.projects.set(projectId, project);
  activateWorkspace(state, options, projectId, workspace);
  respondJson(response, 200, { label: session.label, sessionCount: accepted.size, omittedCount });
}
export async function abortWorkspaceImport(
  request: IncomingMessage,
  response: ServerResponse,
  state: HarnessStudioState,
  sessionId: string,
): Promise<void> {
  if (!sameOriginRequest(request)) {
    respondJson(response, 403, { error: "Cross-origin workspace imports are not allowed." });
    return;
  }
  const session = workspaceImportSession(state, sessionId);
  if (session === undefined) {
    respondJson(response, 404, { error: "Workspace import session is unavailable." });
    return;
  }
  if (session.busy) {
    respondJson(response, 409, { error: "Another operation is already using this workspace import session." });
    return;
  }
  session.busy = true;
  await removeWorkspaceImport(state, sessionId);
  respondJson(response, 200, { aborted: true });
}
export async function disconnectWorkspace(
  request: IncomingMessage,
  response: ServerResponse,
  options: HarnessStudioServerOptions,
  state: HarnessStudioState,
): Promise<void> {
  if (!sameOriginRequest(request)) {
    respondJson(response, 403, { error: "Cross-origin workspace changes are not allowed." });
    return;
  }
  if (state.workspaceOpenStage !== "idle") {
    respondJson(response, 409, { error: "Another Project change is already in progress." });
    return;
  }
  const workspace = state.workspace;
  state.workspace = undefined;
  state.activeProjectId = undefined;
  if (workspace !== undefined) state.projectRevision += 1;
  state.artifactDirectory = options.artifactDirectory;
  state.artifactPaths = options.artifactPaths;
  state.customizationAnalysis = undefined;
  respondJson(response, 200, { disconnected: workspace !== undefined });
}
function workspaceImportSession(state: HarnessStudioState, sessionId: string): WorkspaceImportSession | undefined {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(sessionId)
    ? state.workspaceImports.get(sessionId)
    : undefined;
}
function portableWorkspaceLabel(value: string | null): string {
  const label = (value ?? "Selected workspace").trim().replace(/[\u0000-\u001f]/gu, " ").slice(0, 80);
  return label || "Selected workspace";
}
function portableProjectLabel(value: string | null): string {
  const label = portableWorkspaceLabel(value);
  if (win32.isAbsolute(label)) return portableWorkspaceLabel(win32.basename(label));
  if (posix.isAbsolute(label)) return portableWorkspaceLabel(posix.basename(label));
  return label;
}
function portableWorkspacePath(value: string | null): string {
  if (value === null || value.trim() === "") throw new Error("Workspace file path is required.");
  if (/^(?:\/|[A-Za-z]:[\\/])/u.test(value)) throw new Error("Workspace file path must be relative.");
  const segments = value.replaceAll("\\", "/").split("/").filter(Boolean);
  if (segments.length === 0 || segments.length > 12 || segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Workspace file path must be a bounded relative path.");
  }
  const portable = segments.map((segment) => {
    const cleaned = segment.replace(/[<>:"|?*\u0000-\u001f]/gu, "-").replace(/[. ]+$/u, "");
    if (cleaned === "") throw new Error("Workspace file path contains an empty portable segment.");
    return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(cleaned) ? `_${cleaned}` : cleaned;
  }).join("/");
  if (portable.length > 320) throw new Error("Workspace file path exceeds the portable length limit.");
  return portable;
}
async function removeWorkspaceImport(state: HarnessStudioState, sessionId: string): Promise<void> {
  const session = state.workspaceImports.get(sessionId);
  if (session === undefined) return;
  clearTimeout(session.expiry);
  state.workspaceImports.delete(sessionId);
  await rm(session.directory, { recursive: true, force: true });
}
async function releaseWorkspaceImportSession(
  state: HarnessStudioState,
  sessionId: string,
  session: WorkspaceImportSession,
): Promise<void> {
  session.busy = false;
  if (session.expired && state.workspaceImports.get(sessionId) === session) {
    await removeWorkspaceImport(state, sessionId);
  }
}
export async function cleanupWorkspaceImports(state: HarnessStudioState): Promise<void> {
  await Promise.all([...state.workspaceImports.keys()].map((sessionId) => removeWorkspaceImport(state, sessionId)));
  const ownedDirectories = new Set([...state.projects.values()]
    .map((project) => project.importedWorkspace?.ownedDirectory)
    .filter((directory): directory is string => directory !== undefined));
  await Promise.all([...ownedDirectories].map((directory) => rm(directory, { recursive: true, force: true }).catch(() => undefined)));
  state.projects.clear();
  state.projectRevisionContexts.clear();
  state.activeProjectId = undefined;
  state.workspace = undefined;
  state.customizationAnalysis = undefined;
}
export async function serveWorkspaceSessions(response: ServerResponse, state: HarnessStudioState): Promise<void> {
  if (state.workspace === undefined) {
    respondJson(response, 404, { error: "No project workspace is open." });
    return;
  }
  respondJson(response, 200, {
    workspace: { id: state.activeProjectId, revision: state.projectRevision, label: state.workspace.label, omittedCount: state.workspace.omittedCount, providers: state.workspace.providers },
    sessions: [...state.workspace.sessions.values()].map((session) => session.summary)
      .sort((left, right) => right.savedAt.localeCompare(left.savedAt)),
  });
}
export function serveWorkspaceInputs(response: ServerResponse, state: HarnessStudioState): void {
  if (state.workspace === undefined) {
    respondJson(response, 404, { error: "No project workspace is open." });
    return;
  }
  if (state.workspace.inputTrace === undefined) {
    respondJson(response, 404, { error: "The current workspace has no retained user input trace." });
    return;
  }
  if (!isUserInputTrace(state.workspace.inputTrace)) {
    respondJson(response, 500, { error: "The current workspace input trace failed contract validation." });
    return;
  }
  respondJson(response, 200, state.workspace.inputTrace, { "Cache-Control": "no-store" });
}
export function serveWorkspaceCustomizations(response: ServerResponse, state: HarnessStudioState): void {
  if (state.customizationAnalysis === undefined) {
    respondJson(response, 404, { error: "Customizations have not been analyzed for this workspace." });
    return;
  }
  respondJson(response, 200, state.customizationAnalysis, { "Cache-Control": "no-store" });
}
export async function analyzeWorkspaceCustomizations(
  request: IncomingMessage,
  response: ServerResponse,
  options: HarnessStudioServerOptions,
  state: HarnessStudioState,
): Promise<void> {
  if (!sameOriginRequest(request)) {
    respondJson(response, 403, { error: "Cross-origin customization analysis is not allowed." });
    return;
  }
  if (options.customizationCollector === undefined) {
    respondJson(response, 501, { error: "This Studio launcher does not provide customization analysis." });
    return;
  }
  const workspacePath = state.workspace === undefined
    ? resolve(options.cwd ?? process.cwd())
    : state.workspace.localDirectory;
  if (workspacePath === undefined) {
    respondJson(response, 422, { error: "An imported run folder cannot be used as a local customization workspace." });
    return;
  }
  if (state.customizationAnalysisRunning) {
    respondJson(response, 409, { error: "Customization analysis is already running." });
    return;
  }
  const projectBinding = { id: state.activeProjectId, revision: state.projectRevision };
  state.customizationAnalysisRunning = true;
  try {
    const analysis = validateStudioCustomizationAnalysis(
      await options.customizationCollector.analyze(workspacePath),
      [workspacePath],
    );
    if (!isCurrentProjectBinding(state, projectBinding)) {
      respondJson(response, 409, { error: "The active Project changed before customization analysis completed. Run the analysis again for the current Project." });
      return;
    }
    state.customizationAnalysis = analysis;
    respondJson(response, 200, analysis, { "Cache-Control": "no-store" });
  } catch {
    respondJson(response, 503, { error: "Customization analysis could not complete for this workspace." }, { "Cache-Control": "no-store" });
  } finally {
    state.customizationAnalysisRunning = false;
  }
}
export async function analyzeWorkspaceIntent(
  request: IncomingMessage,
  response: ServerResponse,
  options: HarnessStudioServerOptions,
  state: HarnessStudioState,
): Promise<void> {
  if (!sameOriginRequest(request)) {
    respondJson(response, 403, { error: "Cross-origin Intent analysis is not allowed." });
    return;
  }
  if (options.intentAnalyzer === undefined) {
    respondJson(response, 501, { error: "This Studio launcher does not provide online Intent analysis." });
    return;
  }
  if (state.workspace?.inputTrace === undefined) {
    respondJson(response, 404, { error: "The current workspace has no retained user input trace." });
    return;
  }
  if (state.intentAnalysisRunning) {
    respondJson(response, 409, { error: "An Intent analysis is already running." });
    return;
  }
  const projectBinding = { id: state.activeProjectId, revision: state.projectRevision };
  state.intentAnalysisRunning = true;
  try {
    const packet = buildIntentCorrelationPacket(state.workspace.inputTrace);
    const proposed = await options.intentAnalyzer.analyze(packet);
    const analysis: IntentCorrelationAnalysisV1 = validateIntentCorrelationAnalysis(packet, proposed);
    if (!isCurrentProjectBinding(state, projectBinding)) {
      respondJson(response, 409, { error: "The active Project changed before Intent analysis completed. Run the analysis again for the current Project." }, { "Cache-Control": "no-store" });
      return;
    }
    respondJson(response, 200, analysis, { "Cache-Control": "no-store" });
  } catch (error) {
    respondJson(response, error instanceof IntentCorrelationContractError ? 502 : 503, {
      error: error instanceof IntentCorrelationContractError
        ? "The Intent analyzer returned claims that failed local evidence validation."
        : "The Intent analyzer could not complete this request.",
    }, { "Cache-Control": "no-store" });
  } finally {
    state.intentAnalysisRunning = false;
  }
}
function isCurrentProjectBinding(
  state: HarnessStudioState,
  binding: { id: string | undefined; revision: number },
): boolean {
  return state.activeProjectId === binding.id && state.projectRevision === binding.revision;
}
export async function serveWorkspaceSession(
  response: ServerResponse,
  state: HarnessStudioState,
  sessionId: string,
  debuggerProjection: boolean,
): Promise<void> {
  if (state.workspace === undefined) {
    respondJson(response, 404, { error: "No project workspace is open." });
    return;
  }
  const session = state.workspace.sessions.get(sessionId);
  if (session === undefined) {
    respondJson(response, 404, { error: `Session '${sessionId}' is not available in the current workspace.` });
    return;
  }
  respondJson(response, 200, debuggerProjection ? session.debugger : session.retainedRun ?? session.summary);
}
export async function serveSessionComparison(
  response: ServerResponse,
  state: HarnessStudioState,
  leftId: string | null,
  rightId: string | null,
): Promise<void> {
  if (state.workspace === undefined) {
    respondJson(response, 404, { error: "No project workspace is open." });
    return;
  }
  if (leftId === null || rightId === null || leftId === rightId) {
    respondJson(response, 400, { error: "Choose two different sessions to compare." });
    return;
  }
  const left = state.workspace.sessions.get(leftId);
  const right = state.workspace.sessions.get(rightId);
  if (left === undefined || right === undefined) {
    respondJson(response, 404, { error: "One or both sessions are unavailable in the current workspace." });
    return;
  }
  respondJson(response, 200, {
    kind: "observational-session-compare.v1",
    boundary: "Observed retained evidence only; no winner is inferred.",
    left: sessionComparisonSide(left),
    right: sessionComparisonSide(right),
  });
}
function sessionComparisonSide(session: StoredWorkspaceSession): Record<string, unknown> {
  const tools = session.debugger.events.flatMap((event) => event.toolCalls ?? []);
  const messages = session.summary.messageCount
    ?? session.debugger.events.filter((event) => event.kind === "prompt" || event.kind === "response").length;
  return {
    id: session.summary.id,
    prompt: session.summary.prompt,
    savedAt: session.summary.savedAt,
    status: session.summary.status,
    retainedEventCount: session.debugger.events.length,
    toolCallCount: session.summary.toolCallCount,
    messageCount: messages,
    warningCount: session.summary.warningCount ?? 0,
    toolSequence: tools.map((tool) => tool.name),
  };
}
