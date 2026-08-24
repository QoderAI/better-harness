import { createReadStream, watch as watchDirectory } from "node:fs";
import { mkdir, mkdtemp, open, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, normalize, resolve, sep } from "node:path";
import {
  assertBindAddressAllowed,
  handleAguiRun,
  type HarnessUiExecutorFactory,
} from "@qoder-ai/harness-ui";
import {
  AcpSdkExecutor,
  PiSdkExecutor,
  QoderSdkExecutor,
  type AcpPermissionHandler,
} from "@qoder-ai/harness/exec";
import type { CustomizationAnalysisResponseV1 } from "@qoder-ai/harness/customization";
import {
  loadHarnessExperimentManifest,
  runHarnessExperiment,
  type ExperimentRunEvent,
  type HarnessExperimentCompareSet,
  type RunHarnessExperimentOptions,
} from "@qoder-ai/harness/experiment";
import { canLockCompare, countLaneMaterializations } from "../experiment-setup.js";
import type {
  CheckpointSourcePreview,
  ExperimentLockReceipt,
  ResolvedHistoryDraftPreview,
} from "../experiment-setup.js";
import {
  createCheckpointHistoryCatalogAdapter,
  type CheckpointHistoryAdapter,
  type ResolvedCheckpointHistory,
} from "./query/checkpoint-history.js";
import { buildExperimentPreview, readObservedCallsPage } from "./query/experiment-query.js";
import { loadEvidenceVerdict } from "./query/evidence-query.js";
import { extractInspectorReportJson, loadInspectorReport } from "./query/inspector-query.js";
import { ObservedCallIndex } from "./query/observed-call-index.js";
import { lockHistoryExperiment } from "./experiment-lock.js";
import { canonicalToolEvents } from "./experiment-events.js";
import { listRunRecords, parseRunSnapshot, parseSavedRunRecord, readRunRecord, saveRunRecord, type SavedRunRecord } from "./run-log.js";
import {
  activeSourcePath,
  assertSourceSelection,
  describeSources,
  initialActiveSources,
  mergeSourceCatalog,
  startupSource,
  type StudioSourceCandidate,
  type StudioSourceKind,
} from "./source-catalog.js";
import { sessionFromRetainedRun, type DebuggerSession } from "../app/session-debugger-model.js";
import { pickLocalWorkspaceDirectory } from "./native-directory-picker.js";
import {
  ArtifactCatalogContractError,
  artifactIdForLabel,
  artifactRevisionBase,
  assertArtifactId,
  describeArtifactCatalog,
  digestHex,
  findArtifact,
  isActiveArtifactContent,
  indexArtifactDirectory,
  resolveArtifactMediaType,
  type ArtifactEntry,
  type ArtifactIndex,
  type IndexArtifactDirectoryOptions,
} from "./artifact-catalog.js";
import { collectWorkspaceArtifactObservations, type WorkspaceArtifactSourceObservation } from "./workspace-artifacts.js";
import { formatTrustedRendererCompileError } from "./trusted-renderer-compiler.js";
import {
  type ArtifactCompileLimits,
  artifactPreviewHtml,
  compileArtifactPreview,
  findCompiledArtifactPreview,
} from "./artifact-compile-runtime.js";
import {
  type ArtifactBuildRuntimeImplementation,
  type ArtifactPluginResolution,
  type ExternalArtifactProvider,
} from "./artifact-plugin-registry.js";
import {
  resolveQoderCanvasRuntime,
  serveQoderCanvasRuntimeFile,
} from "./qoder-canvas-viewer-bridge.js";
import { ARTIFACT_PROVIDER_STATUS_RESPONSE_KIND, type ArtifactDescriptor } from "../artifact-model.js";
import { discoverArtifactProviderRuntime } from "./artifact-provider-discovery.js";
import type { GitCommitDetail, GitRefsSnapshot } from "../git-history-model.js";
import {
  DEFAULT_LOCAL_HARNESS_ID,
  DEFAULT_LOCAL_ACP_HARNESS_SOURCE,
  DEFAULT_LOCAL_ACP_RUNTIME_ID,
  DEFAULT_LOCAL_HARNESS_SOURCE,
  DEFAULT_LOCAL_RUNTIME_ID,
} from "./default-local-harness.js";
import {
  GitHistoryError,
  readGitCommitAtRoot,
  readGitFilePatchAtRoot,
  readGitLog,
  readGitRefsAtRoot,
  resolveGitRepositoryRoot,
} from "./git-history.js";
import { isUserInputTrace, projectUserInputTrace, type UserInputTraceV1 } from "../input-trace-model.js";
import {
  IntentCorrelationContractError,
  validateIntentCorrelationAnalysis,
  type IntentCorrelationAnalysisV1,
  type IntentCorrelationPacketV1,
} from "../intent-correlation-model.js";
import { buildIntentCorrelationPacket } from "./intent-correlation.js";
import { validateStudioCustomizationAnalysis, type StudioCustomizationCollector } from "./customization-collector.js";
import { WORKSPACE_ARTIFACT_NAVIGATION_KIND } from "../workspace-artifact-model.js";

const builtInExecutorFactory: HarnessUiExecutorFactory = (context) => {
  if (context.runtimeId === "qoder") {
    return new QoderSdkExecutor({ onRunEvent: context.onRunEvent });
  }
  if (context.runtimeId === "pi") {
    return new PiSdkExecutor({ onRunEvent: context.onRunEvent });
  }
  throw new Error(`No built-in executor for runtime '${context.runtimeId}'.`);
};

/** Static Studio/runtime assets only; artifact media types live in artifact-catalog.ts. */
const STATIC_CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".tsx": "text/plain; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
  ".jsx": "text/plain; charset=utf-8",
  ".patch": "text/plain; charset=utf-8",
  ".diff": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const MAX_IMPORT_FILES = 256;
const MAX_IMPORT_BYTES = 128 * 1024 * 1024;
const MAX_IMPORT_SESSIONS = 4;
/** Each artifact event stream owns a recursive filesystem watcher. */
const MAX_ARTIFACT_EVENT_STREAMS = 8;
const IMPORT_SESSION_TTL_MS = 10 * 60 * 1000;
const MAX_WORKSPACE_FILES = 512;
const MAX_WORKSPACE_SESSIONS = 200;

export interface StudioWorkspaceSessionSummary {
  id: string;
  savedAt: string;
  prompt: string;
  status: "finished" | "error" | "observed";
  toolCallCount: number;
  provider?: string;
  messageCount?: number;
  warningCount?: number;
}

export interface StudioWorkspaceSession {
  summary: StudioWorkspaceSessionSummary;
  debugger: DebuggerSession;
}

export interface StudioWorkspaceProviderDiagnostic {
  provider: string;
  status: "ok" | "no-evidence" | "error";
  discovered: number;
  included: number;
  message?: string;
}

export interface StudioWorkspaceDiscovery {
  label: string;
  sessions: StudioWorkspaceSession[];
  providers?: StudioWorkspaceProviderDiagnostic[];
  /** Privacy-filtered Inspector workbench projection for this workspace. */
  inspectorReport?: Record<string, unknown>;
}

export interface StudioWorkspaceSessionProvider {
  discover(workspacePath: string): Promise<StudioWorkspaceDiscovery>;
}

export interface StudioIntentAnalyzer {
  analyze(packet: IntentCorrelationPacketV1): Promise<unknown>;
}

export interface HarnessStudioServerOptions {
  /** Directory holding the built React app (index.html + assets/). */
  appDir: string;
  /** Self-contained Harness Inspector HTML report mounted read-only at /inspector. */
  inspectorReportPath?: string;
  /** harness-compare evidence directory containing verdict.json. */
  evidenceDir?: string;
  /** `.harness` source text; enables the embedded AG-UI endpoint. */
  harnessSource?: string;
  /** Presentation provenance for the active harness. */
  harnessMode?: "configured" | "workspace-default";
  harnessId?: string;
  runtimeId?: string;
  cwd?: string;
  /** Root a `source`-backed skill's path is locked and delivered against. */
  sourceRoot?: string;
  /** Durable directory for saved Debugger run records (default: .harness-studio-runs under cwd). */
  runDirectory?: string;
  /** Directory of run-produced artifacts exposed read-only under /api/artifacts. */
  artifactDirectory?: string;
  /** Optional portable paths below artifactDirectory; omitted for a flat compatibility catalog. */
  artifactPaths?: readonly string[];
  /** Provisioned Canvas format viewers (default: $QODER_HOME/canvas/canvases). */
  canvasViewerRoot?: string;
  /** Canvas SDK checkout used to host trusted format viewers. */
  canvasSdkRoot?: string;
  /** Prebuilt Canvas SDK media directory containing canvas-sdk.js and index-canvas.html. */
  canvasSdkMedia?: string;
  /** Studio-private external Artifact activation state root. */
  artifactProviderStateRoot?: string;
  /** Explicit local Provider implementations supplied by an embedding application. */
  artifactProviders?: readonly ExternalArtifactProvider[];
  /** Bounded numeric policy overrides for Studio-owned code compilation. */
  artifactCompileLimits?: Partial<ArtifactCompileLimits>;
  /** Studio-owned Walnut cache root; defaults to the platform cache location. */
  walnutCacheRoot?: string;
  /** Additional bounded source candidates selectable from inside Studio. */
  sourceCatalog?: StudioSourceCandidate[];
  executorFactory?: HarnessUiExecutorFactory;
  /** Explicit local ACP Agent. The browser can select it but cannot alter its command or argv. */
  acpAgent?: StudioAcpAgentOptions;
  /** `harness-experiment.v1` manifest; enables the live three-lane trace view. */
  experimentManifestPath?: string;
  /** Runtime-only trajectory sources, useful for previewing imported host history before it is copied. */
  experimentTrajectoryOverrides?: Record<string, string>;
  /** Adapter-owned browser projection; omitted to use the built-in session-plan adapter. */
  checkpointSourcePreview?: CheckpointSourcePreview;
  /** Optional source-owned history adapter; its opaque ids are the browser contract. */
  checkpointHistoryAdapter?: CheckpointHistoryAdapter;
  /** File-backed first adapter, used when no injected history adapter is supplied. */
  checkpointHistoryCatalogPath?: string;
  /** Durable root for content-addressed locked experiment definitions. */
  experimentLockDirectory?: string;
  /** Test/embedder seam; defaults to the durable content-addressed locker. */
  experimentLocker?: typeof lockHistoryExperiment;
  experimentOutputDirectory?: string;
  experimentRunner?: (options: RunHarnessExperimentOptions) => Promise<HarnessExperimentCompareSet>;
  /** In-process Inspector-style workspace-to-Session discovery capability. */
  workspaceSessionProvider?: StudioWorkspaceSessionProvider;
  /** Test/embedder seam for the server-owned native working-directory chooser. */
  workspaceDirectoryPicker?: () => Promise<string | undefined>;
  /** Optional semantic claim provider. Results are accepted only after local contract validation. */
  intentAnalyzer?: StudioIntentAnalyzer;
  /** On-demand local customization collector. Constructing the server never invokes it. */
  customizationCollector?: StudioCustomizationCollector;
}

export interface StudioAcpAgentOptions {
  command: string;
  args?: readonly string[];
  label?: string;
  env?: NodeJS.ProcessEnv;
  /** Optional ACP-specific Harness source; workspace-default Studio uses its built-in source. */
  harnessSource?: string;
  harnessId?: string;
  runtimeId?: string;
}

/**
 * The studio host: serves the React bundle, exposes the compare evidence as
 * JSON, and (when a harness is loaded) mounts the same AG-UI endpoint as
 * `@qoder-ai/harness-ui` under `/agui`.
 */
export function createHarnessStudioServer(options: HarnessStudioServerOptions): Server {
  const resolvedOptions = resolveStudioServerOptions(options);
  const experimentRuns = new Map<string, AbortController>();
  const startupSources = [
    startupSource("inspector", resolvedOptions.inspectorReportPath),
    startupSource("evidence", resolvedOptions.evidenceDir),
    startupSource("experiment", resolvedOptions.experimentManifestPath),
  ];
  const sourceCatalog = mergeSourceCatalog(startupSources, resolvedOptions.sourceCatalog);
  const activeSources = initialActiveSources(sourceCatalog, {
    inspector: resolvedOptions.inspectorReportPath === undefined ? undefined : "inspector_startup",
    evidence: resolvedOptions.evidenceDir === undefined ? undefined : "evidence_startup",
    experiment: resolvedOptions.experimentManifestPath === undefined ? undefined : "experiment_startup",
  });
  const activeManifestPath = activeSourcePath(sourceCatalog, activeSources, "experiment");
  const state: HarnessStudioState = {
    sourceCatalog,
    activeSources,
    activeManifestPath,
    templateManifestPath: activeManifestPath,
    trajectoryOverrides: options.experimentTrajectoryOverrides,
    historyAdapter: resolvedOptions.checkpointHistoryAdapter
      ?? (resolvedOptions.checkpointHistoryCatalogPath === undefined
        ? undefined
        : createCheckpointHistoryCatalogAdapter(resolvedOptions.checkpointHistoryCatalogPath)),
    observedIndexes: new Map(),
    artifactDirectory: resolvedOptions.artifactDirectory,
    artifactPaths: resolvedOptions.artifactPaths,
    artifactImports: new Map(),
    artifactEventStreams: 0,
    workspaceImports: new Map(),
    workspaceOpenStage: "idle",
    intentAnalysisRunning: false,
    customizationAnalysisRunning: false,
    acpRuns: new Map(),
  };
  const server = createServer((request, response) => {
    void route(request, response, resolvedOptions, state, experimentRuns).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      respondJson(response, 500, { error: "Harness Studio could not complete this request." });
    });
  });
  server.once("close", () => {
    cancelAllAcpRuns(state);
    void Promise.all([cleanupArtifactImports(state), cleanupWorkspaceImports(state)]);
  });
  return server;
}

function resolveStudioServerOptions(options: HarnessStudioServerOptions): HarnessStudioServerOptions {
  if (options.harnessSource !== undefined) {
    return { ...options, harnessMode: options.harnessMode ?? "configured" };
  }
  if (options.workspaceSessionProvider === undefined) return options;
  return {
    ...options,
    harnessSource: DEFAULT_LOCAL_HARNESS_SOURCE,
    harnessId: DEFAULT_LOCAL_HARNESS_ID,
    runtimeId: DEFAULT_LOCAL_RUNTIME_ID,
    harnessMode: "workspace-default",
  };
}

interface ArtifactImportSession {
  directory: string;
  fileCount: number;
  totalBytes: number;
  labels: Set<string>;
  expiry: NodeJS.Timeout;
}

interface WorkspaceImportSession {
  directory: string;
  fileCount: number;
  totalBytes: number;
  paths: Set<string>;
  label: string;
  expiry: NodeJS.Timeout;
}

interface StudioWorkspace {
  label: string;
  sessionCount: number;
  omittedCount: number;
  sessions: Map<string, StoredWorkspaceSession>;
  providers: StudioWorkspaceProviderDiagnostic[];
  inspectorReport?: Record<string, unknown>;
  inputTrace?: UserInputTraceV1;
  /** Server-only execution root for the selected local project. Never serialized. */
  localDirectory?: string;
  /** Current workspace files supported by retained change/deliver evidence. */
  artifactObservations?: WorkspaceArtifactSourceObservation[];
  /** Canonical server-only repository root. Never serialized. */
  gitRoot?: string;
  /** Ref snapshot shared by refs and log requests until the next explicit refresh. */
  gitRefs?: GitRefsSnapshot;
  /** Small immutable-detail cache used by commit and patch routes. */
  gitCommitCache?: Map<string, GitCommitDetail>;
  ownedDirectory?: string;
}

interface StoredWorkspaceSession extends StudioWorkspaceSession {
  retainedRun?: SavedRunRecord;
}

interface HarnessStudioState {
  sourceCatalog: StudioSourceCandidate[];
  activeSources: Partial<Record<StudioSourceKind, string>>;
  activeManifestPath?: string;
  templateManifestPath?: string;
  trajectoryOverrides?: Record<string, string>;
  historyAdapter?: CheckpointHistoryAdapter;
  lockReceipt?: ExperimentLockReceipt;
  observedIndexes: Map<string, ObservedCallIndex>;
  artifactDirectory?: string;
  artifactPaths?: readonly string[];
  ownedArtifactDirectory?: string;
  artifactImports: Map<string, ArtifactImportSession>;
  artifactEventStreams: number;
  workspace?: StudioWorkspace;
  workspaceImports: Map<string, WorkspaceImportSession>;
  workspaceOpenStage: "idle" | "choosing" | "discovering";
  intentAnalysisRunning: boolean;
  customizationAnalysisRunning: boolean;
  customizationAnalysis?: CustomizationAnalysisResponseV1;
  acpRuns: Map<string, AcpRunControl>;
}

interface AcpRunControl {
  abortController: AbortController;
  pendingPermissions: Map<string, AcpPendingPermission>;
}

interface AcpPendingPermission {
  optionIds: Set<string>;
  settle: (response: Awaited<ReturnType<AcpPermissionHandler>>) => void;
}

function artifactOptions(options: HarnessStudioServerOptions, state: HarnessStudioState): HarnessStudioServerOptions {
  return {
    ...options,
    artifactDirectory: state.artifactDirectory,
    ...(state.artifactPaths === undefined ? {} : { artifactPaths: state.artifactPaths }),
  };
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  options: HarnessStudioServerOptions,
  state: HarnessStudioState,
  experimentRuns: Map<string, AbortController>,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (request.method === "GET" && url.pathname === "/api/config") {
    respondJson(response, 200, {
      aguiEnabled: options.harnessSource !== undefined,
      acpEnabled: acpAgentEnabled(options),
      acpAgentLabel: options.acpAgent?.label ?? "ACP Agent",
      artifactsEnabled: state.artifactDirectory !== undefined,
      artifactCount: state.artifactPaths?.length,
      evidenceEnabled: activeSourcePath(state.sourceCatalog, state.activeSources, "evidence") !== undefined,
      experimentEnabled: state.activeManifestPath !== undefined,
      harnessMode: options.harnessSource === undefined ? "none" : options.harnessMode ?? "configured",
      historyEnabled: state.historyAdapter !== undefined,
      inspectorEnabled: activeSourcePath(state.sourceCatalog, state.activeSources, "inspector") !== undefined,
      gitEnabled: state.workspace?.gitRoot !== undefined,
      workspaceWorkbenchEnabled: state.workspace?.inspectorReport !== undefined,
      workspaceDiscoveryEnabled: options.workspaceSessionProvider !== undefined,
      workspaceConnected: state.workspace !== undefined,
      sessionCount: state.workspace?.sessionCount ?? 0,
      inputCount: state.workspace?.inputTrace?.summary.inputCount ?? 0,
      intentAnalysisEnabled: options.intentAnalyzer !== undefined,
      customizationAnalysisEnabled: options.customizationCollector !== undefined,
      customizationAnalyzed: state.customizationAnalysis !== undefined,
      customizationDefinitionCount: state.customizationAnalysis?.summary.definitionCount ?? 0,
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/workspace") {
    respondJson(response, 200, state.workspace === undefined
      ? { connected: false, sessionCount: 0, omittedCount: 0 }
      : { connected: true, label: state.workspace.label, sessionCount: state.workspace.sessionCount, omittedCount: state.workspace.omittedCount, providers: state.workspace.providers });
    return;
  }
  if (request.method === "DELETE" && url.pathname === "/api/workspace") {
    await disconnectWorkspace(request, response, options, state);
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/workspace/open/status") {
    respondJson(response, 200, { stage: state.workspaceOpenStage });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/workspace/open") {
    await openWorkspace(request, response, options, state);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/workspaces") {
    await createWorkspaceImport(request, response, state, url.searchParams.get("label"));
    return;
  }
  const workspaceImportFile = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/files$/);
  if (request.method === "PUT" && workspaceImportFile !== null) {
    const sessionId = decodeRouteComponent(response, workspaceImportFile[1]!);
    if (sessionId !== undefined) await importWorkspaceFile(request, response, state, sessionId, url.searchParams.get("path"));
    return;
  }
  const workspaceImportCommit = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/commit$/);
  if (request.method === "POST" && workspaceImportCommit !== null) {
    const sessionId = decodeRouteComponent(response, workspaceImportCommit[1]!);
    if (sessionId !== undefined) await commitWorkspaceImport(request, response, state, sessionId);
    return;
  }
  const workspaceImportAbort = url.pathname.match(/^\/api\/workspaces\/([^/]+)$/);
  if (request.method === "DELETE" && workspaceImportAbort !== null) {
    const sessionId = decodeRouteComponent(response, workspaceImportAbort[1]!);
    if (sessionId !== undefined) await abortWorkspaceImport(request, response, state, sessionId);
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/sessions") {
    await serveWorkspaceSessions(response, state);
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/inputs") {
    serveWorkspaceInputs(response, state);
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/customizations") {
    serveWorkspaceCustomizations(response, state);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/customizations/analyze") {
    await analyzeWorkspaceCustomizations(request, response, options, state);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/intent-analysis") {
    await analyzeWorkspaceIntent(request, response, options, state);
    return;
  }
  const workspaceSession = url.pathname.match(/^\/api\/sessions\/([^/]+)(?:\/(debugger))?$/);
  if (request.method === "GET" && workspaceSession !== null) {
    const sessionId = decodeRouteComponent(response, workspaceSession[1]!);
    if (sessionId !== undefined) await serveWorkspaceSession(response, state, sessionId, workspaceSession[2] === "debugger");
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/session-compare") {
    await serveSessionComparison(response, state, url.searchParams.get("left"), url.searchParams.get("right"));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/git/refs") {
    await serveGitRefs(response, state);
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/git/log") {
    await serveGitLog(response, state, url);
    return;
  }
  const gitCommitPatch = url.pathname.match(/^\/api\/git\/commits\/((?:[0-9a-f]{40}|[0-9a-f]{64}))\/patch$/u);
  if (request.method === "GET" && gitCommitPatch !== null) {
    await serveGitFilePatch(response, state, gitCommitPatch[1]!, url.searchParams.get("path"));
    return;
  }
  const gitCommit = url.pathname.match(/^\/api\/git\/commits\/((?:[0-9a-f]{40}|[0-9a-f]{64}))$/u);
  if (request.method === "GET" && gitCommit !== null) {
    await serveGitCommit(response, state, gitCommit[1]!);
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/sources") {
    respondJson(response, 200, {
      sources: describeSources(state.sourceCatalog, state.activeSources),
      active: state.activeSources,
    });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/sources/select") {
    await selectSource(request, response, state);
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/inspector-report") {
    await serveInspectorReportJson(response, activeSourcePath(state.sourceCatalog, state.activeSources, "inspector"));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/workspace-inspector-report") {
    if (state.workspace?.inspectorReport === undefined) {
      respondJson(response, 404, { error: "The current workspace has no structured Inspector workbench data." });
      return;
    }
    respondJson(response, 200, state.workspace.inspectorReport, { "Cache-Control": "no-store" });
    return;
  }
  const runRead = url.pathname.match(/^\/api\/runs\/([^/]+)(?:\/(session))?$/);
  if (url.pathname === "/api/runs" || runRead !== null) {
    const runId = runRead === null ? undefined : decodeRouteComponent(response, runRead[1]!);
    if (runRead === null || runId !== undefined) await routeRuns(request, response, activeWorkspaceOptions(options, state), url, runId, runRead?.[2] === "session");
    return;
  }
  if (request.method === "GET" && url.pathname === "/inspector") {
    await serveInspectorReport(response, activeSourcePath(state.sourceCatalog, state.activeSources, "inspector"));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/checkpoint-history") {
    await serveCheckpointHistory(response, state);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/checkpoint-history/resolve") {
    await resolveCheckpointHistory(request, response, state);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/experiment/lock") {
    await lockCheckpointHistory(request, response, options, state);
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/experiment/observed-calls") {
    await serveObservedCalls(response, url, state);
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/experiment") {
    await serveExperiment(response, options, state);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/experiment/runs") {
    await streamExperiment(request, response, options, state, experimentRuns);
    return;
  }
  const cancellation = url.pathname.match(/^\/api\/experiment\/runs\/([^/]+)$/);
  if (request.method === "DELETE" && cancellation !== null) {
    const runId = decodeRouteComponent(response, cancellation[1]!);
    if (runId === undefined) return;
    const controller = experimentRuns.get(runId);
    if (controller === undefined) {
      respondJson(response, 404, { error: `Experiment run '${runId}' is not running.` });
    } else {
      controller.abort(new Error("Cancelled from Harness Studio."));
      respondJson(response, 202, { runId, status: "cancelling" });
    }
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/evidence") {
    await serveEvidence(response, activeSourcePath(state.sourceCatalog, state.activeSources, "evidence"));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/artifacts/events") {
    if (!allowArtifactRead(request, response)) return;
    serveArtifactEvents(request, response, state, artifactOptions(options, state));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/artifacts") {
    if (!allowArtifactRead(request, response)) return;
    await serveArtifactCatalog(response, artifactOptions(options, state), state.workspace);
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/artifact-providers") {
    if (!allowArtifactRead(request, response)) return;
    const runtime = await discoverArtifactProviderRuntime(artifactOptions(options, state));
    respondJson(response, 200, { kind: ARTIFACT_PROVIDER_STATUS_RESPONSE_KIND, providers: runtime.statuses }, { "Cache-Control": "no-store" });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/artifact-imports") {
    await createArtifactImport(request, response, state);
    return;
  }
  const artifactImportFile = url.pathname.match(/^\/api\/artifact-imports\/([^/]+)\/files$/);
  if (request.method === "PUT" && artifactImportFile !== null) {
    const sessionId = decodeRouteComponent(response, artifactImportFile[1]!);
    if (sessionId !== undefined) await importArtifactFile(request, response, state, sessionId, url.searchParams.get("name"));
    return;
  }
  const artifactImportCommit = url.pathname.match(/^\/api\/artifact-imports\/([^/]+)\/commit$/);
  if (request.method === "POST" && artifactImportCommit !== null) {
    const sessionId = decodeRouteComponent(response, artifactImportCommit[1]!);
    if (sessionId !== undefined) await commitArtifactImport(request, response, state, sessionId);
    return;
  }
  const artifactImportAbort = url.pathname.match(/^\/api\/artifact-imports\/([^/]+)$/);
  if (request.method === "DELETE" && artifactImportAbort !== null) {
    const sessionId = decodeRouteComponent(response, artifactImportAbort[1]!);
    if (sessionId !== undefined) await abortArtifactImport(request, response, state, sessionId);
    return;
  }
  // Every reference the catalog publishes is revision-scoped, so a stale handle
  // fails loudly instead of quietly resolving to whatever the path holds now.
  const artifactRevision = url.pathname.match(/^\/api\/artifacts\/([^/]+)\/revisions\/([0-9a-f]{64})\/(.*)$/);
  if (request.method === "GET" && artifactRevision !== null) {
    const id = decodeRouteComponent(response, artifactRevision[1]!);
    const revision = artifactRevision[2]!;
    const tail = artifactRevision[3]!;
    if (id === undefined) return;
    // Viewer documents run at an opaque origin and must fetch their own module,
    // so they are the one artifact surface that stays cross-origin readable.
    // Everything below carries artifact bytes and answers same-origin only.
    if (!tail.startsWith("viewer/") && !allowArtifactRead(request, response)) return;
    const scoped = artifactOptions(options, state);
    if (tail === "content") {
      await serveArtifactContent(response, scoped, id, revision, request.headers["if-none-match"]);
      return;
    }
    if (tail === "snapshot") {
      await serveArtifactSnapshot(response, scoped, id, revision);
      return;
    }
    if (tail === "build") {
      await serveArtifactBuild(response, scoped, id, revision);
      return;
    }
    const previewBuildMatch = tail.match(/^builds\/([0-9a-f]{64})\/preview$/);
    if (previewBuildMatch !== null) {
      await serveArtifactBuildPreview(response, scoped, id, revision, previewBuildMatch[1]!);
      return;
    }
    const resourceMatch = tail.match(/^resources\/([^/]+)$/);
    if (resourceMatch !== null) {
      const resourceId = decodeRouteComponent(response, resourceMatch[1]!);
      if (resourceId !== undefined) await serveArtifactSnapshotResource(response, scoped, id, revision, resourceId);
      return;
    }
    if (tail === "viewer/" || tail === "viewer/index.html") {
      await serveArtifactHostedDocument(response, scoped, id, revision);
      return;
    }
    if (tail === "viewer/runtime-module.js" || tail === "viewer/runtime-module.js.map"
      || tail === "viewer/canvas-module.js" || tail === "viewer/canvas-module.js.map") {
      await serveArtifactHostedModule(response, scoped, id, revision, tail.endsWith(".map"));
      return;
    }
    const viewerResourceMatch = tail.match(/^viewer\/(.+)$/);
    if (viewerResourceMatch !== null) {
      const resource = decodeRouteComponent(response, viewerResourceMatch[1]!);
      if (resource !== undefined) await serveArtifactHostedResource(response, scoped, id, revision, resource);
      return;
    }
    respondArtifactJson(response, 404, { error: "No such artifact revision route." });
    return;
  }
  if (request.method === "GET" && (url.pathname === "/canvas-sdk.js" || url.pathname === "/canvas-sdk.js.map")) {
    await serveCanvasSdk(response, options, url.pathname.endsWith(".map"));
    return;
  }
  const acpPermissionMatch = url.pathname.match(/^\/api\/acp\/runs\/([^/]+)\/permissions\/([^/]+)$/);
  if (request.method === "POST" && acpPermissionMatch !== null) {
    await decideAcpPermission(request, response, state, acpPermissionMatch[1]!, acpPermissionMatch[2]!);
    return;
  }
  const acpCancelMatch = url.pathname.match(/^\/api\/acp\/runs\/([^/]+)\/cancel$/);
  if (request.method === "POST" && acpCancelMatch !== null) {
    cancelAcpRun(request, response, state, acpCancelMatch[1]!);
    return;
  }
  if (url.pathname === "/agui/acp") {
    if (!acpAgentEnabled(options)) {
      respondJson(response, 404, { error: "No ACP Agent is configured for Harness Studio." });
      return;
    }
    if (request.method !== "POST") {
      respondJson(response, 405, { error: "Use POST for /agui/acp." });
      return;
    }
    const runtimeOptions = activeWorkspaceOptions(options, state);
    const acpAgent = options.acpAgent!;
    await handleAguiRun(request, response, {
      source: acpAgent.harnessSource ?? DEFAULT_LOCAL_ACP_HARNESS_SOURCE,
      harnessId: acpAgent.harnessId ?? DEFAULT_LOCAL_HARNESS_ID,
      runtimeId: acpAgent.runtimeId ?? DEFAULT_LOCAL_ACP_RUNTIME_ID,
      ...(runtimeOptions.cwd !== undefined ? { cwd: runtimeOptions.cwd } : {}),
      ...(runtimeOptions.sourceRoot !== undefined ? { sourceRoot: runtimeOptions.sourceRoot } : {}),
      executorFactory: acpExecutorFactory(acpAgent, state),
      runAbortSignal: (runId) => ensureAcpRun(state, runId).abortController.signal,
    });
    return;
  }
  if (url.pathname === "/agui" || url.pathname === "/healthz") {
    if (options.harnessSource === undefined) {
      respondJson(response, 404, { error: "No harness loaded; start with --harness <file.harness>." });
      return;
    }
    if (request.method === "POST" && url.pathname === "/agui") {
      const runtimeOptions = activeWorkspaceOptions(options, state);
      await handleAguiRun(request, response, {
        source: runtimeOptions.harnessSource!,
        ...(runtimeOptions.harnessId !== undefined ? { harnessId: runtimeOptions.harnessId } : {}),
        ...(runtimeOptions.runtimeId !== undefined ? { runtimeId: runtimeOptions.runtimeId } : {}),
        ...(runtimeOptions.cwd !== undefined ? { cwd: runtimeOptions.cwd } : {}),
        ...(runtimeOptions.sourceRoot !== undefined ? { sourceRoot: runtimeOptions.sourceRoot } : {}),
        executorFactory: runtimeOptions.executorFactory ?? builtInExecutorFactory,
      });
      return;
    }
    respondJson(response, url.pathname === "/healthz" ? 200 : 405, url.pathname === "/healthz"
      ? { ok: true }
      : { error: "Use POST for /agui." });
    return;
  }
  if (request.method === "GET") {
    await serveStatic(response, options.appDir, url.pathname);
    return;
  }
  respondJson(response, 404, { error: `No route for ${request.method} ${url.pathname}` });
}

function activeWorkspaceOptions(
  options: HarnessStudioServerOptions,
  state: HarnessStudioState,
): HarnessStudioServerOptions {
  const localDirectory = state.workspace?.localDirectory;
  if (localDirectory === undefined || options.harnessMode !== "workspace-default") return options;
  return {
    ...options,
    cwd: localDirectory,
    sourceRoot: options.sourceRoot ?? localDirectory,
  };
}

function acpAgentEnabled(options: HarnessStudioServerOptions): boolean {
  return options.acpAgent !== undefined
    && (options.harnessMode === "workspace-default" || options.acpAgent.harnessSource !== undefined);
}

function ensureAcpRun(state: HarnessStudioState, runId: string): AcpRunControl {
  const existing = state.acpRuns.get(runId);
  if (existing !== undefined) return existing;
  const control: AcpRunControl = {
    abortController: new AbortController(),
    pendingPermissions: new Map(),
  };
  state.acpRuns.set(runId, control);
  return control;
}

function acpExecutorFactory(
  agent: StudioAcpAgentOptions,
  state: HarnessStudioState,
): HarnessUiExecutorFactory {
  return (context) => {
    const control = ensureAcpRun(state, context.runId);
    const executor = new AcpSdkExecutor({
      command: agent.command,
      args: agent.args,
      env: agent.env,
      onRunEvent: context.onRunEvent,
      abortSignal: control.abortController.signal,
      requestPermission: (requestId, request, signal) => waitForAcpPermission(
        control,
        requestId,
        request,
        signal,
      ),
    });
    return {
      host: executor.host,
      execute: async (revision, bundle, task) => {
        try {
          return await executor.execute(revision, bundle, task);
        } finally {
          finishAcpRun(state, context.runId);
        }
      },
    };
  };
}

function waitForAcpPermission(
  control: AcpRunControl,
  requestId: string,
  request: Parameters<AcpPermissionHandler>[1],
  signal: AbortSignal,
): ReturnType<AcpPermissionHandler> {
  if (control.abortController.signal.aborted || signal.aborted) {
    return Promise.resolve({ outcome: { outcome: "cancelled" } });
  }
  return new Promise((resolvePromise) => {
    let settled = false;
    const optionIds = new Set(request.options.map((option) => option.optionId));
    const timeout = setTimeout(() => settle({ outcome: { outcome: "cancelled" } }), 5 * 60_000);
    const abort = (): void => settle({ outcome: { outcome: "cancelled" } });
    const settle = (response: Awaited<ReturnType<AcpPermissionHandler>>): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      control.abortController.signal.removeEventListener("abort", abort);
      control.pendingPermissions.delete(requestId);
      resolvePromise(response);
    };
    control.pendingPermissions.set(requestId, { optionIds, settle });
    signal.addEventListener("abort", abort, { once: true });
    control.abortController.signal.addEventListener("abort", abort, { once: true });
  });
}

async function decideAcpPermission(
  request: IncomingMessage,
  response: ServerResponse,
  state: HarnessStudioState,
  encodedRunId: string,
  encodedRequestId: string,
): Promise<void> {
  if (!sameOriginRequest(request)) {
    respondJson(response, 403, { error: "Cross-origin ACP permission decisions are not allowed." });
    return;
  }
  const runId = decodeURIComponent(encodedRunId);
  const requestId = decodeURIComponent(encodedRequestId);
  const pending = state.acpRuns.get(runId)?.pendingPermissions.get(requestId);
  if (pending === undefined) {
    respondJson(response, 404, { error: "No matching ACP permission request is pending." });
    return;
  }
  const body = await readJsonBody(request).catch(() => ({})) as { optionId?: unknown };
  if (typeof body.optionId !== "string" || !pending.optionIds.has(body.optionId)) {
    respondJson(response, 400, { error: "optionId must select an option offered by the ACP Agent." });
    return;
  }
  pending.settle({ outcome: { outcome: "selected", optionId: body.optionId } });
  respondJson(response, 200, { status: "selected", optionId: body.optionId });
}

function cancelAcpRun(
  request: IncomingMessage,
  response: ServerResponse,
  state: HarnessStudioState,
  encodedRunId: string,
): void {
  if (!sameOriginRequest(request)) {
    respondJson(response, 403, { error: "Cross-origin ACP cancellation is not allowed." });
    return;
  }
  const runId = decodeURIComponent(encodedRunId);
  const control = state.acpRuns.get(runId);
  if (control === undefined) {
    respondJson(response, 404, { error: "No matching ACP run is active." });
    return;
  }
  control.abortController.abort();
  respondJson(response, 202, { status: "cancelling" });
}

function finishAcpRun(state: HarnessStudioState, runId: string): void {
  const control = state.acpRuns.get(runId);
  if (control === undefined) return;
  for (const pending of control.pendingPermissions.values()) {
    pending.settle({ outcome: { outcome: "cancelled" } });
  }
  state.acpRuns.delete(runId);
}

function cancelAllAcpRuns(state: HarnessStudioState): void {
  for (const [runId, control] of state.acpRuns) {
    control.abortController.abort();
    finishAcpRun(state, runId);
  }
}

async function createWorkspaceImport(
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
  const expiry = setTimeout(() => { void removeWorkspaceImport(state, sessionId); }, IMPORT_SESSION_TTL_MS);
  expiry.unref();
  state.workspaceImports.set(sessionId, {
    directory,
    fileCount: 0,
    totalBytes: 0,
    paths: new Set(),
    label: portableWorkspaceLabel(requestedLabel),
    expiry,
  });
  respondJson(response, 201, { sessionId, maxFiles: MAX_WORKSPACE_FILES, maxBytes: MAX_IMPORT_BYTES });
}

async function openWorkspace(
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
    const previous = state.workspace?.ownedDirectory;
    const gitRoot = await resolveGitRepositoryRoot(workspacePath);
    const artifactObservations = await collectWorkspaceArtifactObservations(workspacePath, [...sessions.values()]);
    const artifactPaths = [...new Set(artifactObservations.map((observation) => observation.relativePath))];
    state.workspace = {
      label: portableWorkspaceLabel(discovered.label),
      sessionCount: sessions.size,
      omittedCount: Math.max(0, discovered.sessions.length - sessions.size),
      sessions,
      providers,
      ...(inspectorReport === undefined ? {} : { inspectorReport, inputTrace }),
      localDirectory: workspacePath,
      artifactObservations,
      ...(gitRoot === undefined ? {} : { gitRoot, gitCommitCache: new Map<string, GitCommitDetail>() }),
    };
    state.artifactDirectory = workspacePath;
    state.artifactPaths = artifactPaths;
    state.customizationAnalysis = undefined;
    if (previous !== undefined) await rm(previous, { recursive: true, force: true }).catch(() => undefined);
    respondJson(response, 200, {
      opened: true,
      label: state.workspace.label,
      sessionCount: state.workspace.sessionCount,
      providers,
    });
  } catch {
    respondJson(response, 422, { error: "Studio could not discover Sessions for the selected workspace." });
  } finally {
    state.workspaceOpenStage = "idle";
  }
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

async function importWorkspaceFile(
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
}

async function commitWorkspaceImport(
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
  const previous = state.workspace?.ownedDirectory;
  state.workspace = {
    label: session.label,
    sessionCount: accepted.size,
    omittedCount,
    sessions: accepted,
    providers: [{ provider: "Harness Studio", status: "ok", discovered: accepted.size, included: accepted.size }],
    ownedDirectory: session.directory,
  };
  state.customizationAnalysis = undefined;
  if (previous !== undefined && previous !== session.directory) {
    await rm(previous, { recursive: true, force: true }).catch(() => undefined);
  }
  respondJson(response, 200, { label: session.label, sessionCount: accepted.size, omittedCount });
}

async function abortWorkspaceImport(
  request: IncomingMessage,
  response: ServerResponse,
  state: HarnessStudioState,
  sessionId: string,
): Promise<void> {
  if (!sameOriginRequest(request)) {
    respondJson(response, 403, { error: "Cross-origin workspace imports are not allowed." });
    return;
  }
  if (workspaceImportSession(state, sessionId) === undefined) {
    respondJson(response, 404, { error: "Workspace import session is unavailable." });
    return;
  }
  await removeWorkspaceImport(state, sessionId);
  respondJson(response, 200, { aborted: true });
}

async function disconnectWorkspace(
  request: IncomingMessage,
  response: ServerResponse,
  options: HarnessStudioServerOptions,
  state: HarnessStudioState,
): Promise<void> {
  if (!sameOriginRequest(request)) {
    respondJson(response, 403, { error: "Cross-origin workspace changes are not allowed." });
    return;
  }
  const workspace = state.workspace;
  state.workspace = undefined;
  state.artifactDirectory = options.artifactDirectory;
  state.artifactPaths = options.artifactPaths;
  state.customizationAnalysis = undefined;
  if (workspace?.ownedDirectory !== undefined) await rm(workspace.ownedDirectory, { recursive: true, force: true });
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

async function cleanupWorkspaceImports(state: HarnessStudioState): Promise<void> {
  await Promise.all([...state.workspaceImports.keys()].map((sessionId) => removeWorkspaceImport(state, sessionId)));
  if (state.workspace?.ownedDirectory !== undefined) await rm(state.workspace.ownedDirectory, { recursive: true, force: true });
  state.workspace = undefined;
  state.customizationAnalysis = undefined;
}

async function serveWorkspaceSessions(response: ServerResponse, state: HarnessStudioState): Promise<void> {
  if (state.workspace === undefined) {
    respondJson(response, 404, { error: "No project workspace is open." });
    return;
  }
  respondJson(response, 200, {
    workspace: { label: state.workspace.label, omittedCount: state.workspace.omittedCount, providers: state.workspace.providers },
    sessions: [...state.workspace.sessions.values()].map((session) => session.summary)
      .sort((left, right) => right.savedAt.localeCompare(left.savedAt)),
  });
}

function serveWorkspaceInputs(response: ServerResponse, state: HarnessStudioState): void {
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

function serveWorkspaceCustomizations(response: ServerResponse, state: HarnessStudioState): void {
  if (state.customizationAnalysis === undefined) {
    respondJson(response, 404, { error: "Customizations have not been analyzed for this workspace." });
    return;
  }
  respondJson(response, 200, state.customizationAnalysis, { "Cache-Control": "no-store" });
}

async function analyzeWorkspaceCustomizations(
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
  state.customizationAnalysisRunning = true;
  try {
    const analysis = validateStudioCustomizationAnalysis(
      await options.customizationCollector.analyze(workspacePath),
      [workspacePath],
    );
    state.customizationAnalysis = analysis;
    respondJson(response, 200, analysis, { "Cache-Control": "no-store" });
  } catch {
    respondJson(response, 503, { error: "Customization analysis could not complete for this workspace." }, { "Cache-Control": "no-store" });
  } finally {
    state.customizationAnalysisRunning = false;
  }
}

async function analyzeWorkspaceIntent(
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
  state.intentAnalysisRunning = true;
  try {
    const packet = buildIntentCorrelationPacket(state.workspace.inputTrace);
    const proposed = await options.intentAnalyzer.analyze(packet);
    const analysis: IntentCorrelationAnalysisV1 = validateIntentCorrelationAnalysis(packet, proposed);
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

async function serveWorkspaceSession(
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

async function serveSessionComparison(
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

function gitWorkspaceRoot(state: HarnessStudioState): string {
  const workspace = state.workspace;
  if (workspace?.gitRoot === undefined) {
    throw new GitHistoryError("The open workspace is not a Git repository.", 404, "NOT_GIT_REPOSITORY");
  }
  return workspace.gitRoot;
}

async function serveGitRefs(response: ServerResponse, state: HarnessStudioState): Promise<void> {
  try {
    const refs = await readGitRefsAtRoot(gitWorkspaceRoot(state));
    if (state.workspace !== undefined) state.workspace.gitRefs = refs;
    respondJson(response, 200, refs, { "Cache-Control": "no-store" });
  } catch (error) {
    respondGitError(response, error);
  }
}

async function serveGitLog(response: ServerResponse, state: HarnessStudioState, url: URL): Promise<void> {
  try {
    const limitText = url.searchParams.get("limit");
    const root = gitWorkspaceRoot(state);
    const refs = state.workspace?.gitRefs ?? await readGitRefsAtRoot(root);
    if (state.workspace !== undefined) state.workspace.gitRefs = refs;
    respondJson(response, 200, await readGitLog(root, {
      refs: url.searchParams.getAll("ref"),
      search: url.searchParams.get("search") ?? undefined,
      limit: limitText === null ? undefined : Number(limitText),
      cursor: url.searchParams.get("cursor") ?? undefined,
    }, refs), { "Cache-Control": "no-store" });
  } catch (error) {
    respondGitError(response, error);
  }
}

async function serveGitCommit(response: ServerResponse, state: HarnessStudioState, sha: string): Promise<void> {
  try {
    respondJson(response, 200, await cachedGitCommit(state, sha), { "Cache-Control": "no-store" });
  } catch (error) {
    respondGitError(response, error);
  }
}

async function serveGitFilePatch(
  response: ServerResponse,
  state: HarnessStudioState,
  sha: string,
  path: string | null,
): Promise<void> {
  try {
    if (path === null) throw new GitHistoryError("File path is required.", 400, "INVALID_PATH");
    const detail = await cachedGitCommit(state, sha);
    respondJson(response, 200, await readGitFilePatchAtRoot(gitWorkspaceRoot(state), sha, path, detail), { "Cache-Control": "no-store" });
  } catch (error) {
    respondGitError(response, error);
  }
}

async function cachedGitCommit(state: HarnessStudioState, sha: string): Promise<GitCommitDetail> {
  const workspace = state.workspace;
  const cached = workspace?.gitCommitCache?.get(sha);
  if (cached !== undefined) return cached;
  const detail = await readGitCommitAtRoot(gitWorkspaceRoot(state), sha);
  if (workspace?.gitCommitCache !== undefined) {
    workspace.gitCommitCache.set(sha, detail);
    if (workspace.gitCommitCache.size > 64) {
      const oldest = workspace.gitCommitCache.keys().next().value as string | undefined;
      if (oldest !== undefined) workspace.gitCommitCache.delete(oldest);
    }
  }
  return detail;
}

function respondGitError(response: ServerResponse, error: unknown): void {
  if (error instanceof GitHistoryError) {
    respondJson(response, error.status, { error: error.message, code: error.code });
    return;
  }
  respondJson(response, 500, { error: "Git history is unavailable.", code: "GIT_HISTORY_FAILED" });
}

async function createArtifactImport(
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

async function importArtifactFile(
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

async function commitArtifactImport(
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

async function abortArtifactImport(
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

async function cleanupArtifactImports(state: HarnessStudioState): Promise<void> {
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

async function resolveArtifactRevisionPlugin(
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

async function serveArtifactCatalog(
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
function serveArtifactEvents(
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
function allowArtifactRead(request: IncomingMessage, response: ServerResponse): boolean {
  if (sameOriginRequest(request)) return true;
  respondArtifactJson(response, 403, { error: "Cross-origin artifact reads are not allowed." });
  return false;
}

function respondArtifactJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

/** Revision-scoped URLs name exact bytes, so their responses never go stale. */
const IMMUTABLE_REVISION_CACHE = "private, max-age=31536000, immutable";

async function serveArtifactContent(
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

async function serveArtifactSnapshot(
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

async function serveArtifactBuild(
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

async function serveArtifactBuildPreview(
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

async function serveArtifactSnapshotResource(
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

function safeArtifactError(error: unknown): string {
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

async function serveArtifactHostedDocument(
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
      "Content-Security-Policy": "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; worker-src blob:;",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(html);
  } catch (error) {
    respondArtifactJson(response, 422, { error: formatTrustedRendererCompileError(error) });
  }
}

async function serveArtifactHostedModule(
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

async function serveCanvasSdk(response: ServerResponse, options: HarnessStudioServerOptions, map: boolean): Promise<void> {
  const runtime = resolveQoderCanvasRuntime({ sdkRoot: options.canvasSdkRoot, sdkMedia: options.canvasSdkMedia, cwd: options.cwd });
  const path = map ? runtime?.sdkMapPath : runtime?.sdkPath;
  if (path === undefined) {
    respondArtifactJson(response, 404, { error: "Canvas SDK runtime asset is unavailable." });
    return;
  }
  await serveQoderCanvasRuntimeFile(response, path, map ? "application/json" : STATIC_CONTENT_TYPES[".js"]!);
}

async function serveArtifactHostedResource(
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

function decodeRouteComponent(response: ServerResponse, value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    respondJson(response, 400, { error: "Malformed URL path segment." });
    return undefined;
  }
}

async function serveInspectorReport(response: ServerResponse, reportPath: string | undefined): Promise<void> {
  if (reportPath === undefined) {
    respondJson(response, 404, {
      error: "No Inspector report loaded; start with --inspector <report.html>.",
    });
    return;
  }
  try {
    const html = await loadInspectorReport(reportPath);
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(html);
  } catch {
    respondJson(response, 404, {
      error: "Cannot read the configured Inspector report.",
    });
  }
}

async function serveInspectorReportJson(response: ServerResponse, reportPath: string | undefined): Promise<void> {
  if (reportPath === undefined) {
    respondJson(response, 404, {
      error: "No Inspector report loaded; start with --inspector <report.html>.",
    });
    return;
  }
  try {
    const html = await loadInspectorReport(reportPath);
    let json: string;
    try {
      json = extractInspectorReportJson(html);
    } catch {
      response.writeHead(204, {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      response.end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(`${json}\n`);
  } catch {
    respondJson(response, 404, {
      error: "Cannot read the configured Inspector report.",
    });
  }
}

async function serveExperiment(
  response: ServerResponse,
  options: HarnessStudioServerOptions,
  state: HarnessStudioState,
): Promise<void> {
  const manifestPath = state.activeManifestPath;
  if (manifestPath === undefined) {
    respondJson(response, 404, { error: "No experiment loaded; start with --experiment <experiment.json>." });
    return;
  }
  try {
    respondJson(response, 200, await buildExperimentPreview({
      manifestPath,
      trajectoryOverrides: state.trajectoryOverrides,
      checkpointSourcePreview: state.lockReceipt === undefined ? options.checkpointSourcePreview : undefined,
      lockReceipt: state.lockReceipt,
      observedIndexes: state.observedIndexes,
    }));
  } catch (error) {
    respondJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function serveCheckpointHistory(response: ServerResponse, state: HarnessStudioState): Promise<void> {
  if (state.historyAdapter === undefined) {
    respondJson(response, 404, { error: "No checkpoint history adapter is configured." });
    return;
  }
  try {
    respondJson(response, 200, await state.historyAdapter.list());
  } catch (error) {
    respondJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function resolveCheckpointHistory(
  request: IncomingMessage,
  response: ServerResponse,
  state: HarnessStudioState,
): Promise<void> {
  if (!sameOriginRequest(request)) {
    respondJson(response, 403, { error: "Cross-origin checkpoint resolution is not allowed." });
    return;
  }
  if (state.historyAdapter === undefined || state.templateManifestPath === undefined) {
    respondJson(response, 404, { error: "Checkpoint history requires both an adapter and an experiment template." });
    return;
  }
  try {
    const id = historyId(await readJsonBody(request));
    const loaded = await loadHarnessExperimentManifest(state.templateManifestPath);
    const resolved = await state.historyAdapter.resolve(id, countLaneMaterializations(loaded.value.lanes));
    respondJson(response, 200, historyDraftPreview(loaded.value.lanes, resolved));
  } catch (error) {
    respondJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function lockCheckpointHistory(
  request: IncomingMessage,
  response: ServerResponse,
  options: HarnessStudioServerOptions,
  state: HarnessStudioState,
): Promise<void> {
  if (!sameOriginRequest(request)) {
    respondJson(response, 403, { error: "Cross-origin experiment locking is not allowed." });
    return;
  }
  if (state.historyAdapter === undefined || state.templateManifestPath === undefined) {
    respondJson(response, 404, { error: "Checkpoint history requires both an adapter and an experiment template." });
    return;
  }
  try {
    const id = historyId(await readJsonBody(request));
    const template = await loadHarnessExperimentManifest(state.templateManifestPath);
    const resolved = await state.historyAdapter.resolve(id, countLaneMaterializations(template.value.lanes));
    const locked = await (options.experimentLocker ?? lockHistoryExperiment)({
      templateManifestPath: state.templateManifestPath,
      history: resolved,
      outputRoot: options.experimentLockDirectory
        ?? resolve(dirname(state.templateManifestPath), ".harness-studio-locks"),
    });
    // Build the preview before committing server state so a failed preview
    // leaves the previously loaded experiment fully intact.
    const observedIndexes = new Map<string, ObservedCallIndex>();
    const preview = await buildExperimentPreview({
      manifestPath: locked.manifestPath,
      lockReceipt: locked.receipt,
      observedIndexes,
    });
    for (const index of state.observedIndexes.values()) index.close();
    state.observedIndexes = observedIndexes;
    state.activeManifestPath = locked.manifestPath;
    state.trajectoryOverrides = undefined;
    state.lockReceipt = locked.receipt;
    respondJson(response, 200, preview);
  } catch (error) {
    respondJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

function historyDraftPreview(
  lanes: Array<{ id: string; origin: "observed" | "execute"; trials?: number }>,
  resolved: ResolvedCheckpointHistory,
): ResolvedHistoryDraftPreview {
  const observed = lanes.find((lane) => lane.origin === "observed");
  const missing = [
    ...(!resolved.observed.startCheckpointVerified ? ["startCheckpointDigest"] : []),
    ...(!resolved.request.verified ? ["promptHash"] : []),
    ...(["harnessId", "revisionId", "profile", "model", "environmentReceipt"] as const)
      .filter((key) => resolved.observed.identity?.[key] === undefined),
  ];
  const setup = {
    scenario: "historical-replay" as const,
    checkpointSource: resolved.checkpointSource,
    request: {
      label: "Selected historical request",
      prompt: resolved.request.prompt,
      promptHash: resolved.request.promptHash,
      provenance: resolved.request.verified ? "verified-history" as const : "unverified-history" as const,
      ...(!resolved.request.verified
        ? { limitation: "The history source did not verify that these request bytes produced the observed trajectory." }
        : {}),
    },
    historicalGaps: observed === undefined || missing.length === 0 ? [] : [{ laneId: observed.id, missing }],
  };
  return {
    selection: resolved.item,
    checkpoint: { digest: resolved.checkpointRef.digest },
    setup,
    lockable: canLockCompare(setup),
    ...(resolved.checkpointSource.status === "ready"
      ? {}
      : { limitation: resolved.checkpointSource.limitation ?? "Checkpoint preflight failed." }),
  };
}

function historyId(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("History request body must be an object.");
  }
  const id = (value as { historyId?: unknown }).historyId;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error("historyId must be an opaque portable id.");
  }
  return id;
}

async function streamExperiment(
  request: IncomingMessage,
  response: ServerResponse,
  options: HarnessStudioServerOptions,
  state: HarnessStudioState,
  experimentRuns: Map<string, AbortController>,
): Promise<void> {
  const manifestPath = state.activeManifestPath;
  if (manifestPath === undefined) {
    respondJson(response, 404, { error: "No experiment loaded; start with --experiment <experiment.json>." });
    return;
  }
  if (!sameOriginRequest(request)) {
    respondJson(response, 403, { error: "Cross-origin experiment execution is not allowed." });
    return;
  }
  const body = await readJsonBody(request).catch(() => ({})) as { experimentId?: unknown };
  const experimentId = typeof body.experimentId === "string" && /^exp_[A-Za-z0-9_-]+$/.test(body.experimentId)
    ? body.experimentId
    : `exp_${Date.now().toString(36)}`;
  if (experimentRuns.has(experimentId)) {
    respondJson(response, 409, { error: `Experiment '${experimentId}' is already running.` });
    return;
  }
  const controller = new AbortController();
  experimentRuns.set(experimentId, controller);
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.flushHeaders();
  const sendPayload = (event: unknown): void => {
    response.write(`event: experiment\ndata: ${JSON.stringify(event)}\n\n`);
  };
  const send = (event: ExperimentRunEvent): void => {
    if (event.type !== "lane-event") {
      sendPayload(event);
      return;
    }
    for (const canonical of canonicalToolEvents(event.event)) {
      sendPayload({ ...event, event: canonical });
    }
  };
  try {
    const outputRoot = options.experimentOutputDirectory
      ?? resolve(manifestPath, "..", ".harness-experiments");
    const outputDirectory = resolve(outputRoot, experimentId);
    await (options.experimentRunner ?? runHarnessExperiment)({
      manifestPath,
      outputDirectory,
      experimentId,
      signal: controller.signal,
      onEvent: send,
    });
  } catch (error) {
    send({
      type: controller.signal.aborted ? "experiment-cancelled" : "lane-failed",
      experimentId,
      laneId: null,
      runId: null,
      at: new Date().toISOString(),
      detail: error instanceof Error ? error.message : String(error),
    });
  } finally {
    experimentRuns.delete(experimentId);
    response.end();
  }
}

async function serveObservedCalls(response: ServerResponse, url: URL, state: HarnessStudioState): Promise<void> {
  if (state.activeManifestPath === undefined) {
    respondJson(response, 404, { error: "No experiment is loaded." });
    return;
  }
  try {
    const laneId = url.searchParams.get("laneId") ?? "";
    const limit = Number(url.searchParams.get("limit") ?? "100");
    if (!/^[A-Za-z0-9_-]+$/.test(laneId)) throw new Error("laneId must be a portable opaque id.");
    if (!Number.isFinite(limit)) throw new Error("limit must be a finite number.");
    const page = await readObservedCallsPage({
      manifestPath: state.activeManifestPath,
      trajectoryOverrides: state.trajectoryOverrides,
      observedIndexes: state.observedIndexes,
      laneId,
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit,
    });
    respondJson(response, 200, page);
  } catch (error) {
    respondJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function selectSource(
  request: IncomingMessage,
  response: ServerResponse,
  state: HarnessStudioState,
): Promise<void> {
  if (!sameOriginRequest(request)) {
    respondJson(response, 403, { error: "Cross-origin source switching is not allowed." });
    return;
  }
  try {
    const selection = assertSourceSelection(await readJsonBody(request));
    const source = state.sourceCatalog.find((candidate) => candidate.kind === selection.kind && candidate.id === selection.sourceId);
    if (source === undefined) {
      respondJson(response, 404, { error: "The requested Studio source is not in the bounded source catalog." });
      return;
    }
    state.activeSources[selection.kind] = source.id;
    if (selection.kind === "experiment") {
      for (const index of state.observedIndexes.values()) index.close();
      state.observedIndexes = new Map();
      state.activeManifestPath = source.path;
      state.templateManifestPath = source.path;
      state.trajectoryOverrides = undefined;
      state.lockReceipt = undefined;
    }
    respondJson(response, 200, {
      sources: describeSources(state.sourceCatalog, state.activeSources),
      active: state.activeSources,
    });
  } catch (error) {
    respondJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function readJsonBody(request: IncomingMessage, maxBytes = 32_768): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maxBytes) throw new Error("Request body is too large.");
    chunks.push(bytes);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Saved Debugger runs: retained browser-observed AG-UI evidence, one JSON file per run. */
async function routeRuns(
  request: IncomingMessage,
  response: ServerResponse,
  options: HarnessStudioServerOptions,
  url: URL,
  runId: string | undefined,
  sessionProjection = false,
): Promise<void> {
  if (options.harnessSource === undefined) {
    respondJson(response, 404, { error: "No harness loaded; saved runs require --harness <file.harness>." });
    return;
  }
  const directory = options.runDirectory ?? resolve(options.cwd ?? process.cwd(), ".harness-studio-runs");
  try {
    if (request.method === "GET" && runId !== undefined) {
      try {
        const record = await readRunRecord(directory, runId);
        respondJson(response, 200, sessionProjection ? sessionFromRetainedRun(record) : record);
      } catch {
        respondJson(response, 404, { error: `Saved run '${runId}' is not available.` });
      }
      return;
    }
    if (request.method === "GET") {
      respondJson(response, 200, { runs: await listRunRecords(directory) });
      return;
    }
    if (request.method === "POST" && runId === undefined) {
      if (!sameOriginRequest(request)) {
        respondJson(response, 403, { error: "Cross-origin run saving is not allowed." });
        return;
      }
      const snapshot = parseRunSnapshot(await readJsonBody(request, 2_000_000));
      respondJson(response, 201, await saveRunRecord(directory, snapshot));
      return;
    }
    respondJson(response, 405, { error: `Use GET or POST for ${url.pathname}.` });
  } catch (error) {
    respondJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

function sameOriginRequest(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

async function serveEvidence(response: ServerResponse, evidenceDir: string | undefined): Promise<void> {
  if (evidenceDir === undefined) {
    respondJson(response, 404, { error: "No evidence directory loaded; start with --evidence <dir>." });
    return;
  }
  try {
    const raw = await loadEvidenceVerdict(evidenceDir);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(raw);
  } catch {
    respondJson(response, 404, { error: `No readable verdict.json in '${evidenceDir}'.` });
  }
}

async function serveStatic(response: ServerResponse, appDir: string, pathname: string): Promise<void> {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const root = resolve(appDir);
  const target = normalize(resolve(root, relative));
  if (target !== root && !target.startsWith(root + sep)) {
    respondJson(response, 403, { error: "Path escapes the app directory." });
    return;
  }
  try {
    const stats = await stat(target);
    if (!stats.isFile()) {
      throw new Error("not a file");
    }
    response.writeHead(200, {
      "Content-Type": STATIC_CONTENT_TYPES[extname(target)] ?? "application/octet-stream",
      "Content-Length": stats.size,
    });
    createReadStream(target).pipe(response);
  } catch {
    respondJson(response, 404, { error: `No static asset for '${pathname}'.` });
  }
}

export interface StartedHarnessStudioServer {
  server: Server;
  url: string;
  close(): Promise<void>;
}

export async function startHarnessStudioServer(
  options: HarnessStudioServerOptions & { port?: number; host?: string; allowRemote?: boolean },
): Promise<StartedHarnessStudioServer> {
  const server = createHarnessStudioServer(options);
  const host = options.host ?? "127.0.0.1";
  // The studio mounts the same unauthenticated AG-UI run endpoint, so it
  // inherits the same bind-address boundary rather than restating it.
  assertBindAddressAllowed(host, options.allowRemote === true);
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(options.port ?? 0, host, resolvePromise);
  });
  const address = server.address() as AddressInfo;
  return {
    server,
    url: `http://${host}:${address.port}`,
    close: () =>
      new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => (error ? rejectPromise(error) : resolvePromise()));
        server.closeAllConnections();
      }),
  };
}

function respondJson(response: ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "Content-Type": "application/json", ...headers });
  response.end(`${JSON.stringify(payload)}\n`);
}
