import { AcpConnectionPreparation } from "./acp-connection-preparation.js";
import type { AcpConnectionControl } from "@qoder-ai/harness/exec";
import { AcpEchoFilter } from "./acp-echo-filter.js";
import { AcpConversation, type AcpPromptContent, type AcpOptionalAction, type AcpSessionRecovery } from "@qoder-ai/harness/exec";
import { saveAcpConversation } from "./acp-conversation-log.js";
import { parseAcpConfig, recordValue, acceptsAcpConfig } from "../contracts/acp-session-config.js";
import type { HarnessRunEvent, AcpSessionControl } from "@qoder-ai/harness/exec";
import {
  AcpPermissionHandler,
  AcpRustExecutor,
  AcpRustPermissionHandler,
  AcpSdkExecutor,
  HarnessExecutorFactory,
} from "@qoder-ai/harness/exec";
import { ExperimentLaneExecutorFactory } from "@qoder-ai/harness/experiment";
import { existsSync } from "node:fs";
import { IncomingMessage, ServerResponse } from "node:http";
import { readJsonBody, respondJson, sameOriginRequest } from "./http-utils.js";
import { AcpRunControl, HarnessStudioServerOptions, HarnessStudioState, StudioAcpAgentOptions } from "./studio-types.js";
import { effectiveAcpAgentProfiles } from "./acp-agent-catalog.js";

export function acpRuntimeProfile(
  options: HarnessStudioServerOptions,
): "acp-v1-nsxpc" | "acp-v1-rust" | "acp-v1-stdio" {
  if (options.acpHostExecutable === undefined || !existsSync(options.acpHostExecutable)) {
    return "acp-v1-stdio";
  }
  return options.acpHostTransport === "nsxpc" ? "acp-v1-nsxpc" : "acp-v1-rust";
}

export function acpAgentEnabled(options: HarnessStudioServerOptions): boolean {
  const agent = options.acpAgent ?? effectiveAcpAgentProfiles(options).find((profile) => profile.agent !== undefined)?.agent;
  return agent !== undefined
    && (options.harnessMode === "workspace-default" || agent.harnessSource !== undefined);
}
export function ensureAcpRun(state: HarnessStudioState, runId: string): AcpRunControl {
  const existing = state.acpRuns.get(runId);
  if (existing !== undefined) return existing;
  const control: AcpRunControl = {
    abortController: new AbortController(),
    pendingPermissions: new Map(),
  };
  state.acpRuns.set(runId, control);
  return control;
}
export function acpExecutorFactory(
  agent: StudioAcpAgentOptions,
  state: HarnessStudioState,
  host: { executable?: string; transport?: "stdio" | "nsxpc"; allowRoots?: readonly string[]; prepare?: boolean; connect?: boolean; conversation?: boolean; runDirectory?: string; agentId?: string; cwd?: string; recovery?: AcpSessionRecovery; turnOffset?: number; initialPrompt?: () => string } = {},
): HarnessExecutorFactory {
  return (context) => {
    const control = ensureAcpRun(state, context.runId);
    const observed: Array<{ event: HarnessRunEvent; observedAt: string }> = [];
    let truncated = false;
    let retainedBytes = 0;
    const echoes = new AcpEchoFilter();
    const observe = (event: HarnessRunEvent): void => {
      for (const accepted of echoes.accept(event)) retain(accepted);
    };
    const retain = (event: HarnessRunEvent): void => {
      if (event.type !== "acp-conversation-state") {
        if (observed.length < 20_000 && retainedBytes < 32 * 1024 * 1024) {
          retainedBytes += Buffer.byteLength(JSON.stringify(event));
          observed.push({ event, observedAt: new Date().toISOString() });
        }
        else truncated = true;
      }
      if (event.type === "protocol-event" && event.direction === "Agent → Client") {
        const payload = recordValue(event.payload);
        const result = recordValue(payload?.result);
        const update = recordValue(recordValue(payload?.params)?.update);
        const config = parseAcpConfig(result?.configOptions ?? update?.configOptions);
        if (config !== undefined) control.config = config;
        const modes = recordValue(result?.modes);
        if (Array.isArray(modes?.availableModes)) control.modes = modes.availableModes.flatMap((raw) => {
          const mode = recordValue(raw); return typeof mode?.id === "string" ? [mode.id] : [];
        });
      }
      context.onRunEvent?.(event);
    };
    const conversation = host.conversation ? new AcpConversation({
      turnOffset: host.turnOffset,
      onChange: snapshot => observe({ type: "acp-conversation-state", snapshot }),
      onPrompt: (prompt) => {
        echoes.expect(prompt.content);
        const messageId = `user:${prompt.id}`;
        retain({ type: "message-started", messageId, role: "user" });
        for (const content of prompt.content) retain({ type: "message-content", messageId, content });
        retain({ type: "message-finished", messageId });
      },
      onTurnComplete: async () => {
        for (const pending of control.pendingPermissions.values()) pending.settle({ outcome: { outcome: "cancelled" } });
        if (host.runDirectory) await saveAcpConversation(host.runDirectory, {
          version: 1, agentId: host.agentId, cwd: host.cwd, runId: context.runId, updatedAt: new Date().toISOString(),
          snapshot: conversation!.snapshot(), events: observed, truncated,
        });
      },
    }) : undefined;
    control.conversation = conversation;
    const onConnectionReady = async (connection: AcpConnectionControl | undefined, context?: { error: string }): Promise<AcpSessionRecovery | null | undefined> => {
      if (!connection || (!host.connect && (!context?.error || connection.authMethods.length === 0))) return undefined;
      const preparation = new AcpConnectionPreparation(connection, host.cwd ?? process.cwd(), control.abortController.signal);
      control.preparation = preparation;
      const pending = preparation.wait();
      observe({ type: "acp-connection-ready", connection: { ...(context?.error ? { error: context.error } : {}), canListSessions: connection.canListSessions, recovery: connection.recovery, authMethods: connection.authMethods.map(method => ({ id: method.id, name: method.name, ...(method.description ? { description: method.description } : {}), ...(method.type ? { type: method.type } : {}) })) } });
      try { return await pending ?? null; }
      finally { control.preparation = undefined; observe({ type: "acp-connection-ready", connection: null }); }
    };
    const onSessionReady = async (session: AcpSessionControl | undefined): Promise<void> => {
      control.session = session;
      if (session === undefined) return;
      let resume: Promise<void> | undefined;
      if (host.prepare && !control.abortController.signal.aborted) {
        resume = new Promise<void>((resolve) => {
          const release = (): void => { control.startPrompt = undefined; control.abortController.signal.removeEventListener("abort", release); resolve(); };
          control.startPrompt = release;
          control.abortController.signal.addEventListener("abort", release, { once: true });
        });
      }
      observe({ type: "acp-session-ready", sessionId: session.sessionId, prepared: resume !== undefined });
      await resume;
      if (resume && !control.abortController.signal.aborted) observe({ type: "acp-session-ready", sessionId: session.sessionId, prepared: false });
    };
    const rustHost = host.executable !== undefined && existsSync(host.executable)
      ? host.executable
      : undefined;
    const executor = rustHost === undefined
      ? new AcpSdkExecutor({
          command: agent.command,
          args: agent.args,
          env: agent.env,
          onRunEvent: observe,
          onSessionReady,
          initialPrompt: host.initialPrompt,
          onConnectionReady,
          conversation,
          recovery: host.recovery,
          abortSignal: control.abortController.signal,
          requestPermission: (requestId, request, signal) => waitForAcpPermission(
            control,
            requestId,
            request,
            signal,
          ),
        })
      : new AcpRustExecutor({
          hostExecutable: rustHost,
          command: agent.command,
          args: agent.args,
          env: agent.env,
          ...(host.transport === undefined ? {} : { transport: host.transport }),
          ...(host.allowRoots === undefined ? {} : { allowRoots: host.allowRoots }),
          onRunEvent: observe,
          onSessionReady,
          initialPrompt: host.initialPrompt,
          onConnectionReady,
          conversation,
          recovery: host.recovery,
          abortSignal: control.abortController.signal,
          requestPermission: (request, signal) => waitForAcpRustPermission(
            control,
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
export function acpExperimentExecutorFactory(
  agentForLane: (laneId: string) => StudioAcpAgentOptions,
  state: HarnessStudioState,
  host: { executable?: string; transport?: "stdio" | "nsxpc"; allowRoots?: readonly string[] } = {},
): ExperimentLaneExecutorFactory {
  return (context) => {
    const agent = agentForLane(context.lane.id);
    const control = ensureAcpRun(state, context.runId);
    const abortLane = (): void => control.abortController.abort(context.abortController.signal.reason);
    if (context.abortController.signal.aborted) abortLane();
    else context.abortController.signal.addEventListener("abort", abortLane, { once: true });
    const rustHost = host.executable !== undefined && existsSync(host.executable)
      ? host.executable
      : undefined;
    const executor = rustHost === undefined
      ? new AcpSdkExecutor({
          command: agent.command,
          args: agent.args,
          env: agent.env,
          ...(agent.modelPolicy === "agent-default" ? {} : { sessionConfig: { model: context.lane.runtime.model } }),
          onRunEvent: context.onRunEvent,
          abortSignal: control.abortController.signal,
          requestPermission: (requestId, request, signal) => waitForAcpPermission(
            control,
            requestId,
            request,
            signal,
          ),
        })
      : new AcpRustExecutor({
          hostExecutable: rustHost,
          command: agent.command,
          args: agent.args,
          env: agent.env,
          ...(host.transport === undefined ? {} : { transport: host.transport }),
          ...(host.allowRoots === undefined ? {} : { allowRoots: host.allowRoots }),
          ...(agent.modelPolicy === "agent-default" ? {} : { sessionConfig: { model: context.lane.runtime.model } }),
          onRunEvent: context.onRunEvent,
          abortSignal: control.abortController.signal,
          requestPermission: (request, signal) => waitForAcpRustPermission(
            control,
            request,
            signal,
          ),
        });
    return {
      host: executor.host,
      execute: async (revision, bundle, task) => {
        try {
          return await executor.execute(revision, bundle, {
            ...task,
            abortSignal: control.abortController.signal,
          });
        } finally {
          context.abortController.signal.removeEventListener("abort", abortLane);
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
  return waitForPermission(
    control,
    requestId,
    new Set(request.options.map((option) => option.optionId)),
    signal,
  );
}

function waitForAcpRustPermission(
  control: AcpRunControl,
  request: Parameters<AcpRustPermissionHandler>[0],
  signal: AbortSignal,
): ReturnType<AcpRustPermissionHandler> {
  return waitForPermission(
    control,
    request.requestId,
    new Set(request.options.map((option) => option.optionId)),
    signal,
  ).then((response) => response.outcome.outcome === "selected"
    ? response.outcome.optionId
    : undefined);
}

/** One permission store shared by the Node and Rust ACP clients. */
function waitForPermission(
  control: AcpRunControl,
  requestId: string,
  optionIds: Set<string>,
  signal: AbortSignal,
): ReturnType<AcpPermissionHandler> {
  if (control.abortController.signal.aborted || signal.aborted) {
    return Promise.resolve({ outcome: { outcome: "cancelled" } });
  }
  return new Promise((resolvePromise) => {
    let settled = false;
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
export async function decideAcpPermission(
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
export function cancelAcpRun(
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
  if (!abortAcpRun(state, runId)) {
    respondJson(response, 404, { error: "No matching ACP run is active." });
    return;
  }
  respondJson(response, 202, { status: "cancelling" });
}
export function abortAcpRun(state: HarnessStudioState, runId: string): boolean {
  const control = state.acpRuns.get(runId);
  if (control === undefined) return false;
  control.abortController.abort();
  return true;
}
function finishAcpRun(state: HarnessStudioState, runId: string): void {
  const control = state.acpRuns.get(runId);
  if (control === undefined) return;
  for (const pending of control.pendingPermissions.values()) {
    pending.settle({ outcome: { outcome: "cancelled" } });
  }
  state.acpRuns.delete(runId);
}
export function cancelAllAcpRuns(state: HarnessStudioState): void {
  for (const [runId, control] of state.acpRuns) {
    control.abortController.abort();
    finishAcpRun(state, runId);
  }
}

/** Controls stay bound to a live run; arbitrary RPC methods never cross HTTP. */
export async function configureAcpRun(request: IncomingMessage, response: ServerResponse, state: HarnessStudioState, encodedRunId: string): Promise<void> {
  if (!sameOriginRequest(request)) { respondJson(response, 403, { error: "Cross-origin ACP actions are not allowed." }); return; }
  const control = state.acpRuns.get(decodeURIComponent(encodedRunId));
  if ((!control?.session && !control?.preparation) || control.abortController.signal.aborted || control.conversation?.snapshot().status === "closed") { respondJson(response, 409, { error: "This ACP session is no longer available." }); return; }
  const body = recordValue(await readJsonBody(request, 4 * 1024 * 1024 + 4096).catch(() => undefined));
  const act = async (): Promise<unknown> => {
    if (control.preparation) {
      if (body?.action === "close") { control.abortController.abort(); return { closed: true }; }
      if (!body) throw new Error("An ACP connection action is required.");
      return control.preparation.act(body);
    }
    const session = control.session;
    if (!session || control.abortController.signal.aborted) throw new Error("This ACP session is no longer available.");
    const conversation = control.conversation;
    if (conversation && ["send", "queue-edit", "queue-remove", "queue-resume", "stop", "close", "optional"].includes(String(body?.action))) {
      const settlePermissions = (): void => {
        for (const pending of control.pendingPermissions.values()) pending.settle({ outcome: { outcome: "cancelled" } });
      };
      switch (body!.action) {
        case "send":
        case "queue-edit": {
          if (typeof body!.id !== "string" || !Array.isArray(body!.content)) throw new Error("A message id and content are required.");
          const prompt = { id: body!.id, content: body!.content as AcpPromptContent };
          if (body!.action === "queue-edit") conversation.editQueued(prompt);
          else {
            if (body!.immediately === true) settlePermissions();
            await conversation.submit(prompt, body!.immediately === true);
          }
          break;
        }
        case "queue-remove":
          if (typeof body!.id !== "string") throw new Error("A queued message id is required.");
          conversation.removeQueued(body!.id); break;
        case "queue-resume": conversation.resumeQueue(); break;
        case "stop": settlePermissions(); await conversation.stop(); break;
        case "close":
          settlePermissions();
          if (control.startPrompt) control.abortController.abort();
          await conversation.close(); break;
        case "optional": return { result: await conversation.perform(body!.name as AcpOptionalAction, body!.input) };
      }
      return { snapshot: conversation.snapshot() };
    }
    if (body?.action === "start") {
      if (!control.startPrompt) throw new Error("This session has already started.");
      if (body.prompt !== undefined) {
        if (!control.setInitialPrompt) throw new Error("This session does not accept an edited initial prompt.");
        control.setInitialPrompt(body.prompt);
      }
      control.startPrompt();
      return { started: true };
    }
    if (body?.action === "mode" && typeof body.modeId === "string" && control.config === undefined && control.modes?.includes(body.modeId)) {
      await session.setMode(body.modeId);
      return { modeId: body.modeId };
    }
    if (body?.action === "config" && typeof body.configId === "string") {
      const option = control.config?.find((option) => option.id === body.configId);
      if (!option || !acceptsAcpConfig(option, body.value)) throw new Error("Select a value offered by this Agent.");
      const result = recordValue(await session.setConfigOption(body.configId, body.value));
      const config = parseAcpConfig(result?.configOptions);
      if (!config || config.find((item) => item.id === body.configId)?.value !== body.value) throw new Error("The Agent did not acknowledge this setting; retry after refreshing its options.");
      control.config = config;
      return { configOptions: result!.configOptions };
    }
    throw new Error("Unsupported ACP session action.");
  };
  const urgent = body?.action === "stop" || body?.action === "close";
  const result = urgent ? act() : (control.actionTail ?? Promise.resolve()).catch(() => undefined).then(act);
  if (!urgent) control.actionTail = result;
  try { respondJson(response, 200, await result); }
  catch (error) { respondJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}
