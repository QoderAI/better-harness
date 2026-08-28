import { foldCanonicalToolEvent, type ExperimentToolCall } from "../../contracts/experiment-stream-contract.js";
import {
  alignToolCalls,
  normalizeToolCall,
  projectActivities,
  projectToolOperations,
  relatedCallFor,
  type ActivityPhase,
  type ActivityProjection,
  type RelatedToolCall,
  type ToolOperation,
  type ToolRelation,
} from "./experiment-trace-model.js";
import type {
  Comparability,
  ContrastResult,
  EvidenceRole,
  ExperimentPreview,
  LaneDefinition,
  LaneTrace,
  Selection,
  StreamEvent,
} from "./experiment-view-types.js";

export interface TreatmentSummary {
  label: string;
  value: string;
  detail: string;
  controlled: boolean;
}

export interface SimpleAgentIdentity {
  id: string;
  label: string;
  modelPolicy: "lane" | "agent-default";
}

export interface SimpleComparisonScope {
  kind: "single-variable" | "descriptive" | "repeatability";
  title: string;
  detail: string;
  axes: Array<"agent" | "model" | "model-policy" | "runtime-profile" | "harness">;
}

export interface SimpleLaneFacts {
  status: LaneTrace["status"];
  resources: number;
  editedResources: string[];
  verificationCalls: number;
}

export interface SimpleResultFacts {
  sharedResources: number;
  baselineOnlyResources: number;
  candidateOnlyResources: number;
  baseline: SimpleLaneFacts;
  candidate: SimpleLaneFacts;
}

export function deriveSimpleComparisonScope(
  baseline: LaneDefinition | undefined,
  candidate: LaneDefinition | undefined,
  baselineAgent?: SimpleAgentIdentity,
  candidateAgent?: SimpleAgentIdentity,
): SimpleComparisonScope {
  const axes: SimpleComparisonScope["axes"] = [];
  if (baselineAgent !== undefined && candidateAgent !== undefined && baselineAgent.id !== candidateAgent.id) {
    axes.push("agent");
  }
  if (baselineAgent?.modelPolicy !== candidateAgent?.modelPolicy
    && baselineAgent?.modelPolicy !== undefined
    && candidateAgent?.modelPolicy !== undefined) {
    axes.push("model-policy");
  }
  const baselineModel = effectiveModel(baseline, baselineAgent);
  const candidateModel = effectiveModel(candidate, candidateAgent);
  if (baselineModel !== undefined && candidateModel !== undefined && baselineModel !== candidateModel) axes.push("model");
  if (baseline?.runtime?.profile !== candidate?.runtime?.profile
    && baseline?.runtime?.profile !== undefined
    && candidate?.runtime?.profile !== undefined) {
    axes.push("runtime-profile");
  }
  if (baseline?.harnessId !== candidate?.harnessId
    && baseline?.harnessId !== undefined
    && candidate?.harnessId !== undefined) {
    axes.push("harness");
  }
  const labels = axes.map(simpleAxisLabel);
  if (axes.length === 0) {
    const agent = baselineAgent?.label ?? "the same Agent configuration";
    return {
      kind: "repeatability",
      title: "Repeatability comparison",
      detail: `Both lanes use ${agent} with ${displayEffectiveModel(baselineModel)}; observed differences are run-to-run variation.`,
      axes,
    };
  }
  if (axes.length === 1) {
    return {
      kind: "single-variable",
      title: `Configured difference: ${labels[0]}`,
      detail: "The checkpoint and other visible settings are held constant. One trial is still insufficient for a general quality claim.",
      axes,
    };
  }
  return {
    kind: "descriptive",
    title: `Descriptive comparison: ${labels.join(" + ")}`,
    detail: "Several configured variables change together, so observed differences cannot be attributed to one cause.",
    axes,
  };
}

export function deriveSimpleResultFacts(
  baseline: LaneTrace,
  candidate: LaneTrace,
): SimpleResultFacts {
  const rows = resourceComparisonRows(baseline.calls, candidate.calls);
  return {
    sharedResources: rows.filter((row) => row.baseline.length > 0 && row.candidate.length > 0).length,
    baselineOnlyResources: rows.filter((row) => row.baseline.length > 0 && row.candidate.length === 0).length,
    candidateOnlyResources: rows.filter((row) => row.baseline.length === 0 && row.candidate.length > 0).length,
    baseline: laneFacts(baseline),
    candidate: laneFacts(candidate),
  };
}

export function deriveTreatmentSummary(preview: ExperimentPreview): TreatmentSummary {
  const executeIds = new Set(preview.manifest.lanes.filter((lane) => lane.origin === "execute").map((lane) => lane.id));
  const contrast = preview.contrasts.find((item) => item.lanes.length === 2
    && item.lanes.every((laneId) => executeIds.has(laneId))
    && item.attribution.mode === "attributable");
  if (contrast?.attribution.axis === undefined) {
    return {
      label: "Treatment",
      value: "No single axis isolated",
      detail: contrast?.attribution.detail ?? "The fresh runs do not have an attributable two-run contrast.",
      controlled: false,
    };
  }
  const lanes = contrast.lanes.map((laneId) => preview.manifest.lanes.find((lane) => lane.id === laneId));
  const values = lanes.map((lane) => treatmentValue(lane, contrast.attribution.axis!));
  return {
    label: treatmentLabel(contrast.attribution.axis),
    value: values.join(" vs "),
    detail: contrast.attribution.detail,
    controlled: true,
  };
}

export function selectedCallForPair(
  selection: Selection | null,
  baseline: LaneTrace,
  candidate: LaneTrace,
): ExperimentToolCall | undefined {
  if (selection !== null) {
    const found = [...baseline.calls, ...candidate.calls]
      .find((call) => call.laneId === selection.laneId && call.id === selection.callId);
    if (found !== undefined) return found;
  }
  return baseline.calls[0] ?? candidate.calls[0];
}

export function focusedRelations(
  selected: ExperimentToolCall | undefined,
  baselineId: string,
  baseline: LaneTrace,
  candidateId: string,
  candidate: LaneTrace,
): Map<string, RelatedToolCall> {
  const result = new Map<string, RelatedToolCall>();
  if (selected === undefined) return result;
  const source = selected.laneId === baselineId ? baseline.calls : candidate.calls;
  result.set(baselineId, selected.laneId === baselineId
    ? exactSelected(selected)
    : relatedCallFor(selected, source, baseline.calls));
  result.set(candidateId, selected.laneId === candidateId
    ? exactSelected(selected)
    : relatedCallFor(selected, source, candidate.calls));
  return result;
}

export function exactSelected(call: ExperimentToolCall): RelatedToolCall {
  return { relation: "exact", score: 100, call, basis: "selected call" };
}

export function deriveComparability(
  preview: ExperimentPreview,
  baseline: LaneDefinition | undefined,
  candidate: LaneDefinition | undefined,
  baselineTrace: LaneTrace,
  candidateTrace: LaneTrace,
  agentIds?: Readonly<Record<string, string>>,
): Comparability {
  if (baseline === undefined || candidate === undefined || baseline.id === candidate.id) {
    return { level: "Incomparable", detail: "Select two distinct fresh runs." };
  }
  if (baseline.origin === "observed" || candidate.origin === "observed") {
    return { level: "Observational", detail: "A recorded reference can provide context but is not a controlled baseline." };
  }
  const contrast = preview.contrasts.find((item) => sameLaneSet(item.lanes, [baseline.id, candidate.id]));
  const baselineAgent = agentIds?.[baseline.id];
  const candidateAgent = agentIds?.[candidate.id];
  const agentChanged = baselineAgent !== undefined && candidateAgent !== undefined && baselineAgent !== candidateAgent;
  if (agentChanged) {
    if (contrast?.attribution.mode === "attributable") {
      return {
        level: "Partial",
        detail: "Agent identity and the manifest treatment both changed; this pair does not isolate one cause.",
        axis: `${contrast.attribution.axis ?? "manifest"}+agent`,
      };
    }
    if ([baselineTrace.status, candidateTrace.status].some((status) => status === "failed" || status === "cancelled")) {
      return { level: "Partial", detail: "Agent identity changed, but at least one run did not finish.", axis: "agent" };
    }
    if (Math.min(baseline.trials ?? 1, candidate.trials ?? 1) < 2) {
      return { level: "Partial", detail: "Agent identity changed, but one trial per Agent cannot satisfy the evidence floor.", axis: "agent" };
    }
    return { level: "Controlled", detail: "The fresh runs share a checkpoint and isolate Agent identity.", axis: "agent" };
  }
  if (contrast === undefined || contrast.attribution.mode !== "attributable") {
    return { level: "Incomparable", detail: contrast?.attribution.detail ?? "No declared two-run contrast isolates this pair." };
  }
  const axis = contrast.attribution.axis === undefined ? {} : { axis: contrast.attribution.axis };
  if ([baselineTrace.status, candidateTrace.status].some((status) => status === "failed" || status === "cancelled")) {
    return { level: "Partial", detail: "The pair isolates one axis, but at least one run did not finish.", ...axis };
  }
  if (Math.min(baseline.trials ?? 1, candidate.trials ?? 1) < 2) {
    return { level: "Partial", detail: "One trial per run can inspect traces but cannot satisfy the evidence floor.", ...axis };
  }
  return { level: "Controlled", detail: "The fresh runs share a checkpoint and isolate one treatment axis.", ...axis };
}

export function resultForPair(
  results: readonly ContrastResult[],
  left: string,
  right: string,
): ContrastResult | undefined {
  return results.find((result) => sameLaneSet(result.lanes, [left, right]));
}

export function sameLaneSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((lane) => right.includes(lane));
}

export function roleFor(
  definition: LaneDefinition,
  baselineId: string,
  candidateId: string,
): EvidenceRole {
  if (definition.origin === "observed") return "Reference";
  return definition.id === baselineId ? "Baseline" : definition.id === candidateId ? "Candidate" : "Candidate";
}

export function laneIdentityLabel(definition: LaneDefinition): string {
  const identity = definition.origin === "observed"
    ? definition.identity
    : { harnessId: definition.harnessId, profile: definition.runtime?.profile, model: definition.runtime?.model };
  const parts = [identity?.profile, identity?.model, identity?.harnessId]
    .filter((item): item is string => typeof item === "string" && item !== "");
  if (definition.origin === "observed" && definition.startCheckpointDigest === undefined) {
    parts.unshift("checkpoint unknown");
  }
  return parts.length > 0 ? parts.join(" · ") : "identity incomplete";
}

export function filterCalls(
  calls: ExperimentToolCall[],
  filter: string,
  excluded?: Set<string>,
): ExperimentToolCall[] {
  const query = filter.trim().toLowerCase();
  return calls.filter((call) => !excluded?.has(call.id)
    && (query === ""
      || call.name.toLowerCase().includes(query)
      || normalizeToolCall(call).resource?.toLowerCase().includes(query) === true
      || projectToolOperations(call).some((operation) => operation.resource.toLowerCase().includes(query))));
}

export function groupActivities(
  activities: ActivityProjection[],
): Array<{ phase: ActivityPhase; items: ActivityProjection[] }> {
  const groups: Array<{ phase: ActivityPhase; items: ActivityProjection[] }> = [];
  for (const activity of activities) {
    const current = groups.at(-1);
    if (current?.phase === activity.phase) current.items.push(activity);
    else groups.push({ phase: activity.phase, items: [activity] });
  }
  return groups;
}

export function aggregateToolCalls(
  calls: readonly ExperimentToolCall[],
): Array<{ id: string; name: string; calls: ExperimentToolCall[] }> {
  const groups: Array<{ id: string; name: string; calls: ExperimentToolCall[] }> = [];
  for (const call of calls) {
    const current = groups.at(-1);
    if (current?.name === call.name) current.calls.push(call);
    else groups.push({ id: call.id, name: call.name, calls: [call] });
  }
  return groups;
}

export function firstPhaseDivergence(
  left: ActivityPhase[],
  right: ActivityPhase[],
): { label: string; detail: string } {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) {
      return { label: `Phase ${index + 1}`, detail: `${left[index] ?? "ended"} ↔ ${right[index] ?? "ended"}` };
    }
  }
  return left.length === 0
    ? { label: "Waiting", detail: "No fresh call sequence has been recorded." }
    : { label: "Aligned", detail: "No phase-order divergence is observable." };
}

export function relationCounts(
  baseline: ExperimentToolCall[],
  candidate: ExperimentToolCall[],
): Record<ToolRelation, number> {
  const counts: Record<ToolRelation, number> = { exact: 0, "same-resource": 0, "same-tool": 0, none: 0 };
  const alignment = alignToolCalls(baseline, candidate);
  for (const call of baseline) counts[alignment.get(call.id)?.relation ?? "none"] += 1;
  return counts;
}

export function resourceLedger(calls: ExperimentToolCall[]): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const call of calls) {
    for (const operation of projectToolOperations(call)) {
      const tools = result.get(operation.resource) ?? new Set<string>();
      tools.add(operationLabel(operation.kind));
      result.set(operation.resource, tools);
    }
  }
  return result;
}

export interface ResourceComparisonRow {
  resource: string;
  baseline: ToolOperation[];
  candidate: ToolOperation[];
}

export function resourceComparisonRows(
  baseline: readonly ExperimentToolCall[],
  candidate: readonly ExperimentToolCall[],
): ResourceComparisonRow[] {
  const left = resourceOperationLedger(baseline);
  const right = resourceOperationLedger(candidate);
  const resources = [...new Set([...left.keys(), ...right.keys()])];
  return resources
    .map((resource) => ({
      resource,
      baseline: left.get(resource) ?? [],
      candidate: right.get(resource) ?? [],
    }))
    .sort((a, b) => firstOperationSequence(a) - firstOperationSequence(b)
      || a.resource.localeCompare(b.resource));
}

export function resourceOperationLedger(
  calls: readonly ExperimentToolCall[],
): Map<string, ToolOperation[]> {
  const result = new Map<string, ToolOperation[]>();
  for (const call of calls) {
    for (const operation of projectToolOperations(call)) {
      const operations = result.get(operation.resource) ?? [];
      operations.push(operation);
      result.set(operation.resource, operations);
    }
  }
  return result;
}

function firstOperationSequence(row: ResourceComparisonRow): number {
  return Math.min(
    row.baseline[0]?.callSequence ?? Number.POSITIVE_INFINITY,
    row.candidate[0]?.callSequence ?? Number.POSITIVE_INFINITY,
  );
}

function operationLabel(kind: ToolOperation["kind"]): string {
  return kind === "read" ? "Read"
    : kind === "edit" ? "Edit"
      : kind === "search" ? "Search"
        : kind === "list" ? "List"
          : kind === "verify" ? "Verify"
            : "Run";
}

function effectiveModel(
  lane: LaneDefinition | undefined,
  agent: SimpleAgentIdentity | undefined,
): string | undefined {
  return agent?.modelPolicy === "agent-default" ? "agent-default" : lane?.runtime?.model;
}

function displayEffectiveModel(model: string | undefined): string {
  return model === "agent-default" ? "the Agent default model" : model ?? "the same model policy";
}

function simpleAxisLabel(axis: SimpleComparisonScope["axes"][number]): string {
  return axis === "agent" ? "Agent"
    : axis === "model" ? "model"
      : axis === "model-policy" ? "model policy"
        : axis === "runtime-profile" ? "runtime profile"
          : "harness";
}

function laneFacts(lane: LaneTrace): SimpleLaneFacts {
  const operations = lane.calls.flatMap(projectToolOperations);
  const resources = new Set(operations.map((operation) => operation.resource));
  const editedResources = [...new Set(operations
    .filter((operation) => operation.kind === "edit")
    .map((operation) => operation.resource))];
  return {
    status: lane.status,
    resources: resources.size,
    editedResources,
    verificationCalls: operations.filter((operation) => operation.kind === "verify").length,
  };
}

export function emptyLane(): LaneTrace {
  return {
    status: "idle",
    calls: [],
    eventCount: 0,
    protocolFrameCount: 0,
    acpSessionIds: [],
    pendingPermissions: [],
    activities: [],
  };
}

/** Merge a server page by stable call id while preserving the canonical order. */
export function mergeCallPage(
  current: readonly ExperimentToolCall[],
  page: readonly ExperimentToolCall[],
): ExperimentToolCall[] {
  const keyed = new Map(current.map((call) => [call.id, call]));
  for (const call of page) keyed.set(call.id, call);
  return [...keyed.values()].sort((left, right) => left.sequence - right.sequence);
}

export function applyLaneEvent(lane: LaneTrace, wrapper: StreamEvent): LaneTrace {
  const status = wrapper.type === "lane-preparing" || wrapper.type === "lane-ready"
    ? "preparing"
    : wrapper.type === "lane-started"
      ? "running"
      : wrapper.type === "lane-finished"
        ? wrapper.result?.classification === "failed" ? "failed" : "finished"
        : wrapper.type === "lane-failed"
          ? "failed"
          : lane.status;
  if (wrapper.type !== "lane-event" || wrapper.event === undefined || wrapper.laneId === null) {
    return {
      ...lane,
      status,
      ...((wrapper.type === "lane-finished" || wrapper.type === "lane-failed")
        ? { pendingPermissions: [] }
        : {}),
      ...(wrapper.type === "lane-failed" && wrapper.detail !== undefined ? { detail: wrapper.detail } : {}),
      ...(wrapper.type === "lane-finished" && wrapper.result?.classification === "failed"
        ? { detail: wrapper.result.executorError || "The trial finished with failed evidence." }
        : {}),
    };
  }
  const protocolEvent = wrapper.event.type === "protocol-observed" || wrapper.event.type === "permission-requested"
    ? wrapper.event
    : undefined;
  const sessionId = protocolEvent?.sessionId;
  const acpSessionIds = sessionId !== undefined && !lane.acpSessionIds.includes(sessionId)
    ? [...lane.acpSessionIds, sessionId]
    : lane.acpSessionIds;
  const permissionEvent = wrapper.event.type === "permission-requested" ? wrapper.event : undefined;
  const pendingPermissions = permissionEvent !== undefined
    ? [...lane.pendingPermissions.filter((item) => item.requestId !== permissionEvent.requestId), {
        runId: wrapper.runId ?? "run",
        requestId: permissionEvent.requestId,
        toolCallId: permissionEvent.toolCallId,
        title: permissionEvent.title,
        options: permissionEvent.options,
      }]
    : lane.pendingPermissions;
  const activities = foldLaneActivities(lane.activities, wrapper.event, wrapper.runId ?? "run");
  return {
    ...lane,
    status,
    eventCount: lane.eventCount + 1,
    protocolFrameCount: lane.protocolFrameCount + (protocolEvent === undefined ? 0 : 1),
    acpSessionIds,
    pendingPermissions,
    activities,
    calls: foldCanonicalToolEvent(lane.calls, wrapper.laneId, wrapper.runId ?? "run", wrapper.event),
  };
}

export function globalStreamFailure(
  wrapper: StreamEvent,
): { status: "failed" | "cancelled"; detail: string } | undefined {
  if (wrapper.laneId !== null) return undefined;
  if (wrapper.type === "lane-failed") {
    return { status: "failed", detail: wrapper.detail ?? "The comparison failed before any lane started." };
  }
  if (wrapper.type === "experiment-cancelled") {
    return { status: "cancelled", detail: wrapper.detail ?? "The comparison was cancelled." };
  }
  return undefined;
}

function foldLaneActivities(
  activities: LaneTrace["activities"],
  event: NonNullable<StreamEvent["event"]>,
  runId: string,
): LaneTrace["activities"] {
  const messageActivityId = "messageId" in event ? `${runId}:${event.messageId}` : undefined;
  if (event.type === "assistant-message-started") {
    return activities.some((item) => item.kind === "assistant" && item.id === messageActivityId)
      ? activities
      : [...activities, { kind: "assistant", id: messageActivityId!, text: "", complete: false }];
  }
  if (event.type === "assistant-text-delta") {
    const exists = activities.some((item) => item.kind === "assistant" && item.id === messageActivityId);
    const seeded = exists
      ? activities
      : [...activities, { kind: "assistant" as const, id: messageActivityId!, text: "", complete: false }];
    return seeded.map((item) => item.kind === "assistant" && item.id === messageActivityId
      ? { ...item, text: item.text + event.text }
      : item);
  }
  if (event.type === "assistant-message-finished") {
    return activities.map((item) => item.kind === "assistant" && item.id === messageActivityId
      ? { ...item, complete: true }
      : item);
  }
  if (event.type === "tool-call-started") {
    const id = `tool:${runId}:${event.toolCallId}`;
    return activities.some((item) => item.id === id)
      ? activities
      : [...activities, { kind: "tool", id, runId, toolCallId: event.toolCallId }];
  }
  return activities;
}

export function relationLabel(relation: ToolRelation): string {
  return relation === "exact"
    ? "Exact match"
    : relation === "same-resource"
      ? "Same resource"
      : relation === "same-tool"
        ? "Same tool"
        : "No match";
}

export function shortDigest(digest: string): string {
  return digest.length > 22 ? `${digest.slice(0, 17)}…${digest.slice(-4)}` : digest;
}

function treatmentLabel(axis: string): string {
  return axis === "runtime-profile" ? "Profile" : axis === "harness" ? "Harness" : axis === "model" ? "Model" : axis;
}

function treatmentValue(lane: LaneDefinition | undefined, axis: string): string {
  if (lane === undefined) return "unknown";
  if (axis === "runtime-profile") return lane.runtime?.profile ?? lane.identity?.profile ?? "unknown";
  if (axis === "model") return lane.runtime?.model ?? lane.identity?.model ?? "unknown";
  if (axis === "harness") return lane.harnessId ?? lane.identity?.harnessId ?? "unknown";
  return "unknown";
}
