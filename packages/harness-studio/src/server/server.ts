import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  assertBindAddressAllowed,
  handleAguiRun,
  type HarnessUiExecutorFactory,
} from "@qoder-ai/harness-ui";
import { PiSdkExecutor, QoderSdkExecutor } from "@qoder-ai/harness/exec";
import { ARTIFACT_PROVIDER_STATUS_RESPONSE_KIND } from "../contracts/artifact.js";
import {
  DEFAULT_LOCAL_ACP_HARNESS_SOURCE,
  DEFAULT_LOCAL_ACP_RUNTIME_ID,
  DEFAULT_LOCAL_HARNESS_ID,
  DEFAULT_LOCAL_HARNESS_SOURCE,
  DEFAULT_LOCAL_RUNTIME_ID,
} from "./default-local-harness.js";
import {
  activeSourcePath,
  describeSources,
  initialActiveSources,
  mergeSourceCatalog,
  startupSource,
} from "./workspace/source-catalog.js";
import { createCheckpointHistoryCatalogAdapter } from "./query/checkpoint-history.js";
import { discoverArtifactProviderRuntime } from "./artifacts/registry/artifact-provider-discovery.js";
import type { HarnessStudioServerOptions, HarnessStudioState } from "./studio-types.js";
import { decodeRouteComponent, respondJson, sameOriginRequest } from "./http-utils.js";
import {
  acpAgentEnabled,
  acpExecutorFactory,
  abortAcpRun,
  cancelAcpRun,
  cancelAllAcpRuns,
  decideAcpPermission,
  ensureAcpRun,
} from "./acp-runs.js";
import { effectiveAcpAgentProfiles } from "./acp-agent-catalog.js";
import {
  abortWorkspaceImport,
  activateProject,
  analyzeWorkspaceCustomizations,
  analyzeWorkspaceIntent,
  cleanupWorkspaceImports,
  commitWorkspaceImport,
  createWorkspaceImport,
  disconnectWorkspace,
  importWorkspaceFile,
  openWorkspace,
  removeProject,
  serveProjectCatalog,
  serveSessionComparison,
  serveWorkspaceCustomizations,
  serveWorkspaceInputs,
  serveWorkspaceSession,
  serveWorkspaceSessions,
} from "./workspace/routes.js";
import { serveGitCommit, serveGitFilePatch, serveGitLog, serveGitRefs } from "./git/routes.js";
import {
  abortArtifactImport,
  allowArtifactRead,
  cleanupArtifactImports,
  commitArtifactImport,
  createArtifactImport,
  importArtifactFile,
  respondArtifactJson,
  serveArtifactBuild,
  serveArtifactBuildPreview,
  serveArtifactCatalog,
  serveArtifactContent,
  serveArtifactEvents,
  serveArtifactHostedDocument,
  serveArtifactHostedModule,
  serveArtifactHostedResource,
  serveArtifactSnapshot,
  serveArtifactSnapshotResource,
  serveCanvasSdk,
} from "./artifacts/routes.js";
import {
  decideArtifactInteractionProposal,
  prepareArtifactInteractionProposal,
  serveArtifactInteraction,
  serveArtifactInteractionPreview,
} from "./artifacts/interaction-routes.js";
import { admitArtifactHostedIntent } from "./artifacts/intent-routes.js";
import {
  cancelAllArtifactAgentRuns,
  cancelArtifactAgentRun,
  streamArtifactAgentRun,
} from "./artifacts/agent-run-routes.js";
import {
  lockCheckpointHistory,
  isActiveExperimentRunnable,
  resolveCheckpointHistory,
  selectSource,
  serveCheckpointHistory,
  serveExperiment,
  serveObservedCalls,
  streamExperiment,
} from "./experiment/routes.js";
import {
  routeRuns,
  serveEvidence,
  serveInspectorReport,
  serveInspectorReportJson,
  serveStatic,
} from "./content-routes.js";

const builtInExecutorFactory: HarnessUiExecutorFactory = (context) => {
  if (context.runtimeId === "qoder") {
    return new QoderSdkExecutor({ onRunEvent: context.onRunEvent });
  }
  if (context.runtimeId === "pi") {
    return new PiSdkExecutor({ onRunEvent: context.onRunEvent });
  }
  throw new Error(`No built-in executor for runtime '${context.runtimeId}'.`);
};

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
    artifactAgentRuns: new Map(),
    artifactIntentAdmissions: new Map(),
    artifactInteractionProposals: new Map(),
    projects: new Map(),
    projectRevision: 0,
    projectRevisionContexts: new Map(),
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
    cancelAllArtifactAgentRuns(state);
    state.artifactIntentAdmissions.clear();
    state.artifactInteractionProposals.clear();
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
    const defaultAcpAgent = options.acpAgent
      ?? effectiveAcpAgentProfiles(options).find((profile) => profile.agent !== undefined)?.agent;
    respondJson(response, 200, {
      aguiEnabled: options.harnessSource !== undefined,
      acpEnabled: acpAgentEnabled(options),
      acpAgentLabel: defaultAcpAgent?.label ?? "ACP Agent",
      artifactsEnabled: state.artifactDirectory !== undefined,
      artifactCount: state.artifactPaths?.length,
      evidenceEnabled: activeSourcePath(state.sourceCatalog, state.activeSources, "evidence") !== undefined,
      experimentEnabled: state.activeManifestPath !== undefined,
      experimentRunnable: await isActiveExperimentRunnable(options, state),
      harnessMode: options.harnessSource === undefined ? "none" : options.harnessMode ?? "configured",
      historyEnabled: state.historyAdapter !== undefined,
      inspectorEnabled: activeSourcePath(state.sourceCatalog, state.activeSources, "inspector") !== undefined,
      gitEnabled: state.workspace?.gitRoot !== undefined,
      workspaceWorkbenchEnabled: state.workspace?.inspectorReport !== undefined,
      workspaceDiscoveryEnabled: options.workspaceSessionProvider !== undefined,
      workspaceConnected: state.workspace !== undefined,
      projectExecutionEnabled: state.workspace?.localDirectory !== undefined,
      activeProjectId: state.activeProjectId,
      projectRevision: state.projectRevision,
      sessionCount: state.workspace?.sessionCount ?? 0,
      inputCount: state.workspace?.inputTrace?.summary.inputCount ?? 0,
      intentAnalysisEnabled: options.intentAnalyzer !== undefined,
      customizationAnalysisEnabled: options.customizationCollector !== undefined,
      customizationAnalyzed: state.customizationAnalysis !== undefined,
      customizationDefinitionCount: state.customizationAnalysis?.summary.definitionCount ?? 0,
    }, { "Cache-Control": "no-store" });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/workspace") {
    respondJson(response, 200, state.workspace === undefined
      ? { connected: false, revision: state.projectRevision, sessionCount: 0, omittedCount: 0 }
      : { connected: true, id: state.activeProjectId, revision: state.projectRevision, label: state.workspace.label, sessionCount: state.workspace.sessionCount, omittedCount: state.workspace.omittedCount, providers: state.workspace.providers }, { "Cache-Control": "no-store" });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/projects") {
    serveProjectCatalog(response, state);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/projects/open") {
    await openWorkspace(request, response, options, state);
    return;
  }
  const projectActivation = url.pathname.match(/^\/api\/projects\/([^/]+)\/(?:activate|refresh)$/);
  if (request.method === "POST" && projectActivation !== null) {
    const projectId = decodeRouteComponent(response, projectActivation[1]!);
    if (projectId !== undefined) await activateProject(request, response, options, state, projectId);
    return;
  }
  const projectRemoval = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (request.method === "DELETE" && projectRemoval !== null) {
    const projectId = decodeRouteComponent(response, projectRemoval[1]!);
    if (projectId !== undefined) await removeProject(request, response, options, state, projectId);
    return;
  }
  if (request.method === "DELETE" && url.pathname === "/api/workspace") {
    await disconnectWorkspace(request, response, options, state);
    return;
  }
  if (request.method === "GET" && (url.pathname === "/api/projects/open/status" || url.pathname === "/api/workspace/open/status")) {
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
    if (sessionId !== undefined) await commitWorkspaceImport(request, response, options, state, sessionId);
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
    }, { "Cache-Control": "no-store" });
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
    if (runRead === null || runId !== undefined) {
      const scopedOptions = request.method === "POST" && options.harnessMode === "workspace-default"
        ? retainedRunWorkspaceOptions(request, response, options, state)
        : activeWorkspaceOptions(options, state);
      if (scopedOptions !== undefined) await routeRuns(request, response, scopedOptions, url, runId, runRead?.[2] === "session");
    }
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
  if (artifactRevision !== null) {
    const id = decodeRouteComponent(response, artifactRevision[1]!);
    const revision = artifactRevision[2]!;
    const tail = artifactRevision[3]!;
    if (id === undefined) return;
    // Viewer documents run at an opaque origin and must fetch their own module,
    // so they are the one artifact surface that stays cross-origin readable.
    // Everything below carries artifact bytes and answers same-origin only.
    if ((request.method !== "GET" || !tail.startsWith("viewer/")) && !allowArtifactRead(request, response)) return;
    const scoped = artifactOptions(options, state);
    if (request.method === "GET" && tail === "content") {
      await serveArtifactContent(response, scoped, id, revision, request.headers["if-none-match"]);
      return;
    }
    if (request.method === "GET" && tail === "snapshot") {
      await serveArtifactSnapshot(response, scoped, id, revision);
      return;
    }
    if (request.method === "GET" && tail === "build") {
      await serveArtifactBuild(response, scoped, id, revision);
      return;
    }
    const previewBuildMatch = tail.match(/^builds\/([0-9a-f]{64})\/preview$/);
    if (request.method === "GET" && previewBuildMatch !== null) {
      await serveArtifactBuildPreview(response, scoped, id, revision, previewBuildMatch[1]!);
      return;
    }
    const resourceMatch = tail.match(/^resources\/([^/]+)$/);
    if (request.method === "GET" && resourceMatch !== null) {
      const resourceId = decodeRouteComponent(response, resourceMatch[1]!);
      if (resourceId !== undefined) await serveArtifactSnapshotResource(response, scoped, id, revision, resourceId);
      return;
    }
    if (request.method === "GET" && (tail === "viewer/" || tail === "viewer/index.html")) {
      await serveArtifactHostedDocument(response, scoped, id, revision);
      return;
    }
    if (request.method === "GET" && (tail === "viewer/runtime-module.js" || tail === "viewer/runtime-module.js.map"
      || tail === "viewer/canvas-module.js" || tail === "viewer/canvas-module.js.map")) {
      await serveArtifactHostedModule(response, scoped, id, revision, tail.endsWith(".map"));
      return;
    }
    const viewerResourceMatch = tail.match(/^viewer\/(.+)$/);
    if (request.method === "GET" && viewerResourceMatch !== null) {
      const resource = decodeRouteComponent(response, viewerResourceMatch[1]!);
      if (resource !== undefined) await serveArtifactHostedResource(response, scoped, id, revision, resource);
      return;
    }
    if (request.method === "GET" && tail === "interaction") {
      await serveArtifactInteraction(response, scoped, id, revision);
      return;
    }
    if (request.method === "POST" && tail === "intents") {
      await admitArtifactHostedIntent(request, response, state, scoped, id, revision);
      return;
    }
    if (request.method === "POST" && tail === "interaction/agent-runs") {
      await streamArtifactAgentRun(request, response, state, scoped, id, revision);
      return;
    }
    const artifactAgentCancelMatch = tail.match(/^interaction\/agent-runs\/([^/]+)\/cancel$/);
    if (request.method === "POST" && artifactAgentCancelMatch !== null) {
      const runId = decodeRouteComponent(response, artifactAgentCancelMatch[1]!);
      if (runId !== undefined) cancelArtifactAgentRun(request, response, state, id, revision, runId);
      return;
    }
    if (request.method === "POST" && tail === "interaction/proposals") {
      await prepareArtifactInteractionProposal(request, response, state, scoped, id, revision);
      return;
    }
    const interactionPreviewMatch = tail.match(/^interaction\/proposals\/([^/]+)\/preview$/);
    if (request.method === "GET" && interactionPreviewMatch !== null) {
      const proposalId = decodeRouteComponent(response, interactionPreviewMatch[1]!);
      if (proposalId !== undefined) serveArtifactInteractionPreview(response, state, id, revision, proposalId);
      return;
    }
    const interactionDecisionMatch = tail.match(/^interaction\/proposals\/([^/]+)\/decisions$/);
    if (request.method === "POST" && interactionDecisionMatch !== null) {
      const proposalId = decodeRouteComponent(response, interactionDecisionMatch[1]!);
      if (proposalId !== undefined) await decideArtifactInteractionProposal(request, response, state, scoped, id, revision, proposalId);
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
    if (!acceptProjectBinding(request, response, state, options.harnessMode === "workspace-default")) return;
    const runtimeOptions = activeWorkspaceOptions(options, state);
    const acpAgent = options.acpAgent
      ?? effectiveAcpAgentProfiles(options).find((profile) => profile.agent !== undefined)!.agent!;
    await handleAguiRun(request, response, {
      source: acpAgent.harnessSource ?? DEFAULT_LOCAL_ACP_HARNESS_SOURCE,
      harnessId: acpAgent.harnessId ?? DEFAULT_LOCAL_HARNESS_ID,
      runtimeId: acpAgent.runtimeId ?? DEFAULT_LOCAL_ACP_RUNTIME_ID,
      ...(runtimeOptions.cwd !== undefined ? { cwd: runtimeOptions.cwd } : {}),
      ...(runtimeOptions.sourceRoot !== undefined ? { sourceRoot: runtimeOptions.sourceRoot } : {}),
      executorFactory: acpExecutorFactory(acpAgent, state),
      runAbortSignal: (runId) => ensureAcpRun(state, runId).abortController.signal,
      onClientDisconnect: (runId) => { abortAcpRun(state, runId); },
    });
    return;
  }
  if (url.pathname === "/agui" || url.pathname === "/healthz") {
    if (options.harnessSource === undefined) {
      respondJson(response, 404, { error: "No harness loaded; start with --harness <file.harness>." });
      return;
    }
    if (request.method === "POST" && url.pathname === "/agui") {
      if (!acceptProjectBinding(request, response, state, options.harnessMode === "workspace-default")) return;
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

function acceptProjectBinding(
  request: IncomingMessage,
  response: ServerResponse,
  state: HarnessStudioState,
  required: boolean,
): boolean {
  const requestedProjectId = request.headers["x-harness-project-id"];
  const requestedRevision = request.headers["x-harness-project-revision"];
  if (requestedProjectId === undefined && requestedRevision === undefined) {
    if (!required) return true;
    respondJson(response, 409, { error: state.activeProjectId === undefined
      ? "Open a Project before starting a Project-scoped run."
      : "A Project id and revision are required to start a Project-scoped run." });
    return false;
  }
  if (typeof requestedProjectId !== "string" || typeof requestedRevision !== "string") {
    respondJson(response, 409, { error: "The requested Project binding is incomplete." });
    return false;
  }
  const parsedRevision = Number(requestedRevision);
  if (requestedProjectId !== state.activeProjectId || !Number.isSafeInteger(parsedRevision) || parsedRevision !== state.projectRevision) {
    respondJson(response, 409, { error: "The selected Project changed before the run started. Review the current Project and retry." });
    return false;
  }
  if (required && state.workspace?.localDirectory === undefined) {
    respondJson(response, 422, { error: "The selected Project is read-only evidence and cannot host a live run." });
    return false;
  }
  return true;
}

function retainedRunWorkspaceOptions(
  request: IncomingMessage,
  response: ServerResponse,
  options: HarnessStudioServerOptions,
  state: HarnessStudioState,
): HarnessStudioServerOptions | undefined {
  if (!sameOriginRequest(request)) {
    respondJson(response, 403, { error: "Cross-origin run saving is not allowed." });
    return undefined;
  }
  const requestedProjectId = request.headers["x-harness-project-id"];
  const requestedRevision = request.headers["x-harness-project-revision"];
  const parsedRevision = typeof requestedRevision === "string" ? Number(requestedRevision) : Number.NaN;
  const context = Number.isSafeInteger(parsedRevision) ? state.projectRevisionContexts.get(parsedRevision) : undefined;
  if (typeof requestedProjectId !== "string" || context === undefined || context.projectId !== requestedProjectId) {
    respondJson(response, 409, { error: "The starting Project binding is required to retain this run safely." });
    return undefined;
  }
  return {
    ...options,
    cwd: context.localDirectory,
    sourceRoot: options.sourceRoot ?? context.localDirectory,
  };
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
