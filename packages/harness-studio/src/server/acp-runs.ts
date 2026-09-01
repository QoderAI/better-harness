import { AcpPermissionHandler, AcpSdkExecutor, HarnessExecutorFactory } from "@qoder-ai/harness/exec";
import { ExperimentLaneExecutorFactory } from "@qoder-ai/harness/experiment";
import { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { readJsonBody, respondJson, sameOriginRequest } from "./http-utils.js";
import { AcpRunControl, HarnessStudioServerOptions, HarnessStudioState, StudioAcpAgentOptions } from "./studio-types.js";
import { effectiveAcpAgentProfiles } from "./acp-agent-catalog.js";

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
): HarnessExecutorFactory {
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
export function acpExperimentExecutorFactory(
  agentForLane: (laneId: string) => StudioAcpAgentOptions,
  state: HarnessStudioState,
): ExperimentLaneExecutorFactory {
  return (context) => {
    const agent = agentForLane(context.lane.id);
    const control = ensureAcpRun(state, context.runId);
    const abortLane = (): void => control.abortController.abort(context.abortController.signal.reason);
    if (context.abortController.signal.aborted) abortLane();
    else context.abortController.signal.addEventListener("abort", abortLane, { once: true });
    const executor = new AcpSdkExecutor({
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
