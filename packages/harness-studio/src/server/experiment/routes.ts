import { ResolvedHistoryDraftPreview, canLockCompare, countLaneMaterializations, isExperimentRunnable, type ExperimentSetupPreview } from "../../contracts/experiment-setup.js";
import { canonicalToolEvents } from "../experiment/events.js";
import { lockHistoryExperiment } from "../experiment/lock.js";
import { ResolvedCheckpointHistory } from "../query/checkpoint-history.js";
import { buildExperimentPreview, readObservedCallsPage } from "../query/experiment-query.js";
import { ObservedCallIndex } from "../query/observed-call-index.js";
import { assertSourceSelection, describeSources } from "../workspace/source-catalog.js";
import { ExperimentRunEvent, loadHarnessExperimentManifest, runHarnessExperiment } from "@qoder-ai/harness/experiment";
import { IncomingMessage, ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { readJsonBody, respondJson, sameOriginRequest } from "../http-utils.js";
import { HarnessStudioServerOptions, HarnessStudioState } from "../studio-types.js";
import { acpExperimentExecutorFactory } from "../acp-runs.js";
import {
  effectiveAcpAgentProfiles,
  publicAcpAgentProfiles,
  resolveAcpAgent,
} from "../acp-agent-catalog.js";
import type { StudioAcpAgentOptions } from "../studio-types.js";

export async function serveExperiment(
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
    const preview = await buildExperimentPreview({
      manifestPath,
      trajectoryOverrides: state.trajectoryOverrides,
      checkpointSourcePreview: state.lockReceipt === undefined ? options.checkpointSourcePreview : undefined,
      lockReceipt: state.lockReceipt,
      observedIndexes: state.observedIndexes,
    });
    respondJson(response, 200, experimentPreviewResponse(preview, options));
  } catch (error) {
    respondJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

export async function isActiveExperimentRunnable(
  options: HarnessStudioServerOptions,
  state: HarnessStudioState,
): Promise<boolean> {
  const manifestPath = state.activeManifestPath;
  if (manifestPath === undefined) return false;
  try {
    const preview = await buildExperimentPreview({
      manifestPath,
      trajectoryOverrides: state.trajectoryOverrides,
      checkpointSourcePreview: state.lockReceipt === undefined ? options.checkpointSourcePreview : undefined,
      lockReceipt: state.lockReceipt,
      observedIndexes: state.observedIndexes,
    });
    return isExperimentRunnable(experimentSetupForReadiness(preview));
  } catch {
    return false;
  }
}
export async function serveCheckpointHistory(response: ServerResponse, state: HarnessStudioState): Promise<void> {
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
export async function resolveCheckpointHistory(
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
export async function lockCheckpointHistory(
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
    respondJson(response, 200, experimentPreviewResponse(preview, options));
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
export async function streamExperiment(
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
  const body = await readJsonBody(request).catch(() => ({})) as {
    experimentId?: unknown;
    prompt?: unknown;
    agentIds?: unknown;
  };
  const experimentId = typeof body.experimentId === "string" && /^exp_[A-Za-z0-9_-]+$/.test(body.experimentId)
    ? body.experimentId
    : `exp_${Date.now().toString(36)}`;
  let promptOverride: string | undefined;
  if (body.prompt !== undefined) {
    if (typeof body.prompt !== "string" || body.prompt.trim() === "") {
      respondJson(response, 400, { error: "prompt must be a non-empty string." });
      return;
    }
    if (Buffer.byteLength(body.prompt, "utf8") > 100_000) {
      respondJson(response, 400, { error: "prompt must be at most 100000 UTF-8 bytes." });
      return;
    }
    promptOverride = body.prompt;
  }
  if (experimentRuns.has(experimentId)) {
    respondJson(response, 409, { error: `Experiment '${experimentId}' is already running.` });
    return;
  }
  let loadedManifest: Awaited<ReturnType<typeof loadHarnessExperimentManifest>>;
  try {
    loadedManifest = await loadHarnessExperimentManifest(manifestPath);
  } catch (error) {
    respondJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    return;
  }
  const experimentHost = loadedManifest.value.runtime.host;
  try {
    const preview = await buildExperimentPreview({
      manifestPath,
      trajectoryOverrides: state.trajectoryOverrides,
      checkpointSourcePreview: state.lockReceipt === undefined ? options.checkpointSourcePreview : undefined,
      lockReceipt: state.lockReceipt,
      observedIndexes: state.observedIndexes,
    });
    const setup = experimentSetupForReadiness(preview);
    if (!isExperimentRunnable(setup)) {
      respondJson(response, 409, {
        error: setup.checkpointSource.limitation ?? "The checkpoint source cannot create isolated fresh runs.",
      });
      return;
    }
  } catch (error) {
    respondJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    return;
  }
  let agentSelections: Map<string, StudioAcpAgentOptions> | undefined;
  let agentSelectionEvidence: Record<string, {
    agentId: string;
    agentLabel: string;
    protocol: "acp-v1-stdio";
    modelPolicy: "lane" | "agent-default";
  }> | undefined;
  if (experimentHost !== "acp" && body.agentIds !== undefined) {
    respondJson(response, 400, { error: "agentIds is available only for ACP-hosted experiments." });
    return;
  }
  if (experimentHost === "acp") {
    try {
      const selected = selectExperimentAcpAgents(
        body.agentIds,
        loadedManifest.value.lanes.filter((lane) => lane.origin === "execute").map((lane) => lane.id),
        options,
      );
      agentSelections = selected.agents;
      agentSelectionEvidence = selected.evidence;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      respondJson(response, message.includes("unavailable") || message.includes("no available") ? 409 : 400, { error: message });
      return;
    }
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
  const disconnect = (): void => {
    if (!response.writableEnded) controller.abort(new Error("Experiment stream disconnected."));
  };
  response.once("close", disconnect);
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
      ...(promptOverride === undefined ? {} : { promptOverride }),
      ...(agentSelectionEvidence === undefined ? {} : { runtimeSelection: agentSelectionEvidence }),
      signal: controller.signal,
      ...(experimentHost === "acp"
        ? { executorFactory: acpExperimentExecutorFactory((laneId) => agentSelections!.get(laneId)!, state) }
        : {}),
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
    response.removeListener("close", disconnect);
    experimentRuns.delete(experimentId);
    response.end();
  }
}

function experimentPreviewResponse(
  preview: Record<string, unknown>,
  options: HarnessStudioServerOptions,
): Record<string, unknown> {
  const manifest = preview.manifest;
  const runtime = manifest !== null && typeof manifest === "object" ? (manifest as { runtime?: unknown }).runtime : undefined;
  const host = runtime !== null && typeof runtime === "object" ? (runtime as { host?: unknown }).host : undefined;
  return host === "acp"
    ? { ...preview, acpAgents: publicAcpAgentProfiles(options) }
    : preview;
}

function experimentSetupForReadiness(preview: Record<string, unknown>): ExperimentSetupPreview {
  const setup = preview.setup;
  const checkpointSource = setup !== null && typeof setup === "object"
    ? (setup as { checkpointSource?: unknown }).checkpointSource
    : undefined;
  const materialization = checkpointSource !== null && typeof checkpointSource === "object"
    ? (checkpointSource as { materialization?: unknown }).materialization
    : undefined;
  const status = checkpointSource !== null && typeof checkpointSource === "object"
    ? (checkpointSource as { status?: unknown }).status
    : undefined;
  const count = materialization !== null && typeof materialization === "object"
    ? (materialization as { count?: unknown }).count
    : undefined;
  if (!(["ready", "unavailable"] as unknown[]).includes(status) || !Number.isInteger(count) || Number(count) < 0) {
    throw new Error("Experiment preview does not contain a valid checkpoint readiness contract.");
  }
  return setup as ExperimentSetupPreview;
}

export function selectExperimentAcpAgents(
  value: unknown,
  laneIds: readonly string[],
  options: HarnessStudioServerOptions,
): {
  agents: Map<string, StudioAcpAgentOptions>;
  evidence: Record<string, {
    agentId: string;
    agentLabel: string;
    protocol: "acp-v1-stdio";
    modelPolicy: "lane" | "agent-default";
  }>;
} {
  if (value !== undefined && (value === null || typeof value !== "object" || Array.isArray(value))) {
    throw new Error("agentIds must be an object keyed by execute lane id.");
  }
  const requested = value as Record<string, unknown> | undefined;
  const unknownLane = requested === undefined ? undefined : Object.keys(requested).find((id) => !laneIds.includes(id));
  if (unknownLane !== undefined) throw new Error(`agentIds contains unknown execute lane '${unknownLane}'.`);
  const catalog = publicAcpAgentProfiles(options);
  if (catalog.defaultAgentId === undefined) {
    throw new Error("This ACP experiment has no available server-registered ACP Agent.");
  }
  const agents = new Map<string, StudioAcpAgentOptions>();
  const evidence: Record<string, {
    agentId: string;
    agentLabel: string;
    protocol: "acp-v1-stdio";
    modelPolicy: "lane" | "agent-default";
  }> = {};
  for (const laneId of laneIds) {
    const requestedId = requested?.[laneId] ?? catalog.defaultAgentId;
    if (typeof requestedId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(requestedId)) {
      throw new Error(`agentIds.${laneId} must be a portable registered Agent id.`);
    }
    const profile = effectiveAcpAgentProfiles(options).find((candidate) => candidate.id === requestedId);
    if (profile === undefined) throw new Error(`ACP Agent '${requestedId}' is not registered on this Studio server.`);
    const agent = resolveAcpAgent(options, requestedId);
    if (agent === undefined) {
      throw new Error(`ACP Agent '${profile.label}' is unavailable: ${profile.unavailableReason ?? "no executable is registered"}`);
    }
    agents.set(laneId, agent);
    evidence[laneId] = {
      agentId: profile.id,
      agentLabel: profile.label,
      protocol: "acp-v1-stdio",
      modelPolicy: agent.modelPolicy ?? "lane",
    };
  }
  return { agents, evidence };
}
export async function serveObservedCalls(response: ServerResponse, url: URL, state: HarnessStudioState): Promise<void> {
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
export async function selectSource(
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
