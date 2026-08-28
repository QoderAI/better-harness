import type { IncomingMessage, ServerResponse } from "node:http";
import { encodeSseEvent, runHarnessAgui, type AguiEvent } from "@qoder-ai/harness-ui";
import { AcpSdkExecutor } from "@qoder-ai/harness/exec";
import {
  ARTIFACT_AGENT_EVIDENCE_KIND,
  ARTIFACT_AGENT_PLAN_KIND,
  type ArtifactAgentPlanV1,
  type ArtifactAgentRunEvidenceV1,
  type ArtifactAgentRunPhaseV1,
} from "../../contracts/artifact-agent-run.js";
import type {
  ArtifactInteractionActorV1,
  ArtifactInteractionWorkspaceV1,
} from "../../contracts/artifact.js";
import {
  DEFAULT_LOCAL_ACP_HARNESS_SOURCE,
  DEFAULT_LOCAL_ACP_RUNTIME_ID,
  DEFAULT_LOCAL_HARNESS_ID,
} from "../default-local-harness.js";
import { acpAgentEnabled } from "../acp-runs.js";
import { effectiveAcpAgentProfiles } from "../acp-agent-catalog.js";
import { readJsonBody, respondJson, sameOriginRequest } from "../http-utils.js";
import type { HarnessStudioServerOptions, HarnessStudioState } from "../studio-types.js";
import {
  assertArtifactInteractionWorkspace,
  prepareAndRetainArtifactInteractionProposal,
  type RetainedArtifactInteractionBinding,
} from "./interaction-routes.js";
import { discoverArtifactProviderRuntime } from "./registry/artifact-provider-discovery.js";
import { respondArtifactJson, resolveArtifactRevisionPlugin, safeArtifactError } from "./routes.js";

const MAX_ACTIVE_AGENT_RUNS = 4;
const MAX_INSTRUCTION_LENGTH = 8_192;
const MAX_PLAN_ITEMS = 8;
const MAX_PLAN_ITEM_LENGTH = 1_024;

interface ArtifactAgentRunRequest {
  targetAddress: string;
  message: string;
  requestedBy: ArtifactInteractionActorV1;
  runId: string;
}

export async function streamArtifactAgentRun(
  request: IncomingMessage,
  response: ServerResponse,
  state: HarnessStudioState,
  options: HarnessStudioServerOptions,
  artifactId: string,
  revision: string,
): Promise<void> {
  if (!sameOriginRequest(request)) {
    respondArtifactJson(response, 403, { error: "Cross-origin Artifact Agent runs are not allowed." });
    return;
  }
  if (!acpAgentEnabled(options)) {
    respondArtifactJson(response, 404, { error: "No ACP Agent is configured for Artifact planning." });
    return;
  }
  if (state.artifactAgentRuns.size >= MAX_ACTIVE_AGENT_RUNS) {
    respondArtifactJson(response, 429, { error: "Too many Artifact Agent runs are active." });
    return;
  }

  let input: ArtifactAgentRunRequest;
  try {
    input = agentRunRequest(await readJsonBody(request));
  } catch (error) {
    respondArtifactJson(response, 422, { error: safeArtifactError(error) });
    return;
  }
  if (state.artifactAgentRuns.has(input.runId)) {
    respondArtifactJson(response, 409, { error: `Artifact Agent run '${input.runId}' is already active.` });
    return;
  }

  const resolved = await resolveArtifactRevisionPlugin(options, artifactId, revision);
  if ("error" in resolved) {
    respondArtifactJson(response, resolved.status, { error: resolved.error });
    return;
  }
  const interaction = resolved.resolution.interaction;
  const provider = resolved.resolution.provider;
  if (interaction === undefined || provider === undefined) {
    respondArtifactJson(response, 404, { error: `Artifact '${artifactId}' is review-only.` });
    return;
  }

  const context = { entry: resolved.entry, descriptor: resolved.descriptor };
  let workspace: ArtifactInteractionWorkspaceV1;
  try {
    workspace = assertArtifactInteractionWorkspace(
      await interaction.inspect(context),
      artifactId,
      resolved.descriptor.revision.id,
    );
    if (!workspace.targets.some((target) => target.address === input.targetAddress)) {
      throw new Error("The selected Artifact target is not present in the exact interaction workspace.");
    }
  } catch (error) {
    respondArtifactJson(response, 422, { error: safeArtifactError(error) });
    return;
  }

  const profile = defaultAgentProfile(options);
  if (profile === undefined) {
    respondArtifactJson(response, 404, { error: "No ACP Agent is configured for Artifact planning." });
    return;
  }
  if (state.artifactAgentRuns.has(input.runId)) {
    respondArtifactJson(response, 409, { error: `Artifact Agent run '${input.runId}' is already active.` });
    return;
  }
  if (state.artifactAgentRuns.size >= MAX_ACTIVE_AGENT_RUNS) {
    respondArtifactJson(response, 429, { error: "Too many Artifact Agent runs are active." });
    return;
  }
  const abortController = new AbortController();
  state.artifactAgentRuns.set(input.runId, {
    artifactId,
    revision: resolved.descriptor.revision.id,
    abortController,
    startedAtMs: Date.now(),
  });
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-store",
    Connection: "keep-alive",
    "X-Content-Type-Options": "nosniff",
  });
  let terminal = false;
  let permissionRequestsCancelled = 0;
  let observedRunError: string | undefined;
  const emit = (event: AguiEvent): void => {
    if (!response.destroyed && !response.writableEnded) response.write(encodeSseEvent(event));
  };
  const phase = (value: ArtifactAgentRunPhaseV1, summary: string): void => {
    emit({ type: "CUSTOM", name: "artifact.agent.phase", value: { phase: value, summary } });
  };
  const disconnect = (): void => {
    if (!terminal) abortController.abort(new Error("Artifact Agent stream disconnected."));
  };
  response.once("close", disconnect);
  emit({ type: "RUN_STARTED", threadId: `artifact:${artifactId}`, runId: input.runId });
  phase("observing", "Bound the exact Artifact revision and semantic target.");

  try {
    const target = workspace.targets.find((candidate) => candidate.address === input.targetAddress)!;
    phase("planning", `${profile.label} is preparing a bounded Provider instruction.`);
    const run = await runHarnessAgui({
      source: profile.agent.harnessSource ?? DEFAULT_LOCAL_ACP_HARNESS_SOURCE,
      harnessId: profile.agent.harnessId ?? DEFAULT_LOCAL_HARNESS_ID,
      runtimeId: profile.agent.runtimeId ?? DEFAULT_LOCAL_ACP_RUNTIME_ID,
      prompt: agentPrompt(workspace, target, input.message),
      threadId: `artifact:${artifactId}`,
      runId: input.runId,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.sourceRoot === undefined ? {} : { sourceRoot: options.sourceRoot }),
      abortSignal: abortController.signal,
      onEvent: (event) => {
        if (event.type === "TOOL_CALL_START") {
          emit({
            type: "CUSTOM",
            name: "artifact.agent.action",
            value: { kind: "permission-cancelled", summary: "Denied one planning-time tool request." },
          });
        } else if (event.type === "RUN_ERROR") {
          observedRunError = publicExecutorError(event.message);
        }
      },
      executorFactory: (executorContext) => new AcpSdkExecutor({
        command: profile.agent.command,
        args: profile.agent.args,
        env: profile.agent.env,
        onRunEvent: executorContext.onRunEvent,
        abortSignal: abortController.signal,
        requestPermission: async () => {
          permissionRequestsCancelled += 1;
          return { outcome: { outcome: "cancelled" } };
        },
      }),
    });
    if (abortController.signal.aborted) throw new ArtifactAgentRunCancelledError();
    if (!run.ok || run.result === undefined) {
      throw new Error(observedRunError ?? "The configured ACP Agent did not complete the planning turn.");
    }

    const plan = parseAgentPlan(run.result.output, workspace);
    emit({ type: "CUSTOM", name: "artifact.agent.plan", value: plan });
    phase("validating", "Validating the Agent plan through the selected Artifact Provider.");
    const binding: RetainedArtifactInteractionBinding = {
      artifactId,
      revision: resolved.descriptor.revision.id,
      providerId: provider.providerId,
      contributionId: provider.contributionId,
      providerFingerprint: provider.fingerprint,
      context,
      runtime: interaction,
    };
    if (!(await providerStillAuthorized(options, binding))) {
      throw new Error("The selected Artifact Provider changed while the Agent was planning.");
    }
    const proposal = await prepareAndRetainArtifactInteractionProposal(state, binding, {
      targetAddress: input.targetAddress,
      steering: plan.providerSteering,
      requestedBy: { id: `agent:${profile.id}`, kind: "agent", label: profile.label },
      selectedBy: input.requestedBy,
      requestId: `request:${input.runId}`,
    }, { proposedByKind: "agent" });
    if (abortController.signal.aborted) {
      state.artifactInteractionProposals.delete(proposal.proposal.proposalId);
      throw new ArtifactAgentRunCancelledError();
    }
    const evidence: ArtifactAgentRunEvidenceV1 = {
      kind: ARTIFACT_AGENT_EVIDENCE_KIND,
      runId: input.runId,
      artifactId,
      revision: resolved.descriptor.revision.id,
      targetAddress: input.targetAddress,
      agent: { id: profile.id, label: profile.label },
      executor: "acp",
      harnessRevisionId: run.result.revisionId,
      permissionRequestsCancelled,
      ...(typeof run.result.metrics?.sessionId === "string" ? { sessionId: run.result.metrics.sessionId } : {}),
      ...(typeof run.result.runtimeReceipt?.model === "string" ? { model: run.result.runtimeReceipt.model } : {}),
      ...(typeof run.result.metrics?.stopReason === "string" ? { stopReason: run.result.metrics.stopReason } : {}),
    };
    emit({ type: "CUSTOM", name: "artifact.agent.evidence", value: evidence });
    phase("proposal", "The Provider prepared a read-only proposal for human review.");
    emit({ type: "CUSTOM", name: "artifact.agent.proposal", value: proposal });
    terminal = true;
    emit({ type: "RUN_FINISHED", threadId: `artifact:${artifactId}`, runId: input.runId, result: { proposalId: proposal.proposal.proposalId } });
  } catch (error) {
    const message = error instanceof ArtifactAgentRunCancelledError || abortController.signal.aborted
      ? "Artifact Agent run was interrupted before a proposal was retained."
      : safeArtifactError(error);
    terminal = true;
    emit({ type: "RUN_ERROR", message });
  } finally {
    response.removeListener("close", disconnect);
    const active = state.artifactAgentRuns.get(input.runId);
    if (active?.abortController === abortController) state.artifactAgentRuns.delete(input.runId);
    if (!response.writableEnded) response.end();
  }
}

export function cancelArtifactAgentRun(
  request: IncomingMessage,
  response: ServerResponse,
  state: HarnessStudioState,
  artifactId: string,
  revision: string,
  runId: string,
): void {
  if (!sameOriginRequest(request)) {
    respondJson(response, 403, { error: "Cross-origin Artifact Agent cancellation is not allowed." });
    return;
  }
  const active = state.artifactAgentRuns.get(runId);
  if (active === undefined || active.artifactId !== artifactId || active.revision !== `sha256:${revision}`) {
    respondArtifactJson(response, 404, { error: `Artifact Agent run '${runId}' is not active for this revision.` });
    return;
  }
  active.abortController.abort(new Error("Interrupted from Harness Studio."));
  respondArtifactJson(response, 202, { runId, status: "cancelling" });
}

export function cancelAllArtifactAgentRuns(state: HarnessStudioState): void {
  for (const active of state.artifactAgentRuns.values()) {
    active.abortController.abort(new Error("Harness Studio is shutting down."));
  }
  state.artifactAgentRuns.clear();
}

function defaultAgentProfile(options: HarnessStudioServerOptions): {
  id: string;
  label: string;
  agent: NonNullable<ReturnType<typeof effectiveAcpAgentProfiles>[number]["agent"]>;
} | undefined {
  const profiles = effectiveAcpAgentProfiles(options);
  const profile = options.acpAgent === undefined
    ? profiles.find((candidate) => candidate.agent !== undefined)
    : profiles.find((candidate) => candidate.agent === options.acpAgent)
      ?? profiles.find((candidate) => candidate.agent?.command === options.acpAgent?.command);
  return profile?.agent === undefined ? undefined : { id: profile.id, label: profile.label, agent: profile.agent };
}

async function providerStillAuthorized(
  options: HarnessStudioServerOptions,
  binding: RetainedArtifactInteractionBinding,
): Promise<boolean> {
  const runtime = await discoverArtifactProviderRuntime(options);
  const provider = runtime.providers.find((candidate) => candidate.id === binding.providerId
    && candidate.fingerprint === binding.providerFingerprint);
  return provider !== undefined && runtime.registry.activations.some((activation) => activation.providerId === binding.providerId
    && activation.contributionId === binding.contributionId
    && activation.fingerprint === binding.providerFingerprint);
}

function agentRunRequest(value: unknown): ArtifactAgentRunRequest {
  const body = exactObject(value, ["targetAddress", "message", "requestedBy", "runId"], "Artifact Agent run");
  return {
    targetAddress: boundedString(body.targetAddress, "targetAddress", 8_192),
    message: boundedString(body.message, "message", MAX_INSTRUCTION_LENGTH),
    requestedBy: actor(body.requestedBy),
    runId: boundedIdentifier(body.runId, "runId"),
  };
}

function parseAgentPlan(output: string, workspace: ArtifactInteractionWorkspaceV1): ArtifactAgentPlanV1 {
  let value: unknown;
  try {
    value = JSON.parse(output.trim());
  } catch {
    throw new Error("The Agent response was not one strict Artifact plan JSON object.");
  }
  const plan = exactObject(value, ["kind", "summary", "plan", "providerSteering"], "Agent plan");
  if (plan.kind !== ARTIFACT_AGENT_PLAN_KIND) throw new Error("The Agent plan kind is unsupported.");
  if (!Array.isArray(plan.plan) || plan.plan.length === 0 || plan.plan.length > MAX_PLAN_ITEMS) {
    throw new Error("The Agent plan must contain one to eight explicit steps.");
  }
  const providerSteering = exactObject(plan.providerSteering, ["kind", "message"], "Agent plan providerSteering");
  if (providerSteering.kind !== workspace.steering.kind) {
    throw new Error("The Agent plan does not use the current Provider steering kind.");
  }
  return {
    kind: ARTIFACT_AGENT_PLAN_KIND,
    summary: boundedString(plan.summary, "Agent plan summary", 4_096),
    plan: plan.plan.map((entry, index) => boundedString(entry, `Agent plan item ${String(index + 1)}`, MAX_PLAN_ITEM_LENGTH)),
    providerSteering: {
      kind: providerSteering.kind,
      message: boundedString(providerSteering.message, "Agent plan Provider message", workspace.steering.maxLength),
    },
  };
}

function agentPrompt(
  workspace: ArtifactInteractionWorkspaceV1,
  target: ArtifactInteractionWorkspaceV1["targets"][number],
  message: string,
): string {
  return [
    "Prepare one read-only Artifact change plan. Do not call tools, inspect files, mutate state, approve, or claim verification.",
    "Return exactly one JSON object and no Markdown, prose, or code fences.",
    `The object must be {\"kind\":\"${ARTIFACT_AGENT_PLAN_KIND}\",\"summary\":string,\"plan\":[string,...],\"providerSteering\":{\"kind\":${JSON.stringify(workspace.steering.kind)},\"message\":string}}.`,
    "The plan array must contain 1 to 8 short, user-visible action descriptions. It is an explicit plan, not hidden reasoning.",
    "providerSteering.message is a Provider-executable command, not a paraphrase of the human instruction. Follow the Provider instruction and placeholder grammar exactly, replacing only their example value.",
    `Artifact: ${JSON.stringify({ id: workspace.artifactId, revision: workspace.revision, summary: workspace.summary })}`,
    `Selected target: ${JSON.stringify(target)}`,
    `Provider steering contract: ${JSON.stringify(workspace.steering)}`,
    `Human instruction: ${JSON.stringify(message)}`,
  ].join("\n");
}

function actor(value: unknown): ArtifactInteractionActorV1 {
  const entry = exactObject(value, ["id", "kind", "label"], "requestedBy");
  if (entry.kind !== "human") throw new Error("requestedBy.kind must be 'human'.");
  return {
    id: boundedIdentifier(entry.id, "requestedBy.id"),
    kind: "human",
    label: boundedString(entry.label, "requestedBy.label", 256),
  };
}

function exactObject(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object.`);
  const record = value as Record<string, unknown>;
  const allowed = new Set(keys);
  const unknown = Object.keys(record).find((key) => !allowed.has(key));
  if (unknown !== undefined) throw new Error(`${path}.${unknown} is not supported.`);
  const missing = keys.find((key) => !(key in record));
  if (missing !== undefined) throw new Error(`${path}.${missing} is required.`);
  return record;
}

function boundedString(value: unknown, path: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > maxLength) throw new Error(`${path} is invalid.`);
  return value;
}

function boundedIdentifier(value: unknown, path: string): string {
  const result = boundedString(value, path, 256);
  if (!/^[A-Za-z0-9][A-Za-z0-9:._-]*$/u.test(result)) throw new Error(`${path} is invalid.`);
  return result;
}

function publicExecutorError(value: string): string {
  const harness = /^Harness '([^'\n]{1,128})' is not defined in the bundle\.$/u.exec(value);
  if (harness !== null) return `Configured Artifact Harness '${harness[1]}' is unavailable.`;
  const stopped = /^ACP Agent stopped with reason '([^'\n]{1,64})'\.$/u.exec(value);
  if (stopped !== null) return `The ACP Agent stopped with reason '${stopped[1]}'.`;
  return "The configured ACP Agent failed before producing a valid Artifact plan.";
}

class ArtifactAgentRunCancelledError extends Error {}
