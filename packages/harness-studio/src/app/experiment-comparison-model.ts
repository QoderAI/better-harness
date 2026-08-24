import { foldCanonicalToolEvent, type ExperimentToolCall } from "../experiment-stream-contract.js";
import {
  alignToolCalls,
  normalizeToolCall,
  projectActivities,
  relatedCallFor,
  type ActivityPhase,
  type ActivityProjection,
  type RelatedToolCall,
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
): Comparability {
  if (baseline === undefined || candidate === undefined || baseline.id === candidate.id) {
    return { level: "Incomparable", detail: "Select two distinct fresh runs." };
  }
  if (baseline.origin === "observed" || candidate.origin === "observed") {
    return { level: "Observational", detail: "A recorded reference can provide context but is not a controlled baseline." };
  }
  const contrast = preview.contrasts.find((item) => sameLaneSet(item.lanes, [baseline.id, candidate.id]));
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
      || normalizeToolCall(call).resource?.toLowerCase().includes(query) === true));
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
    const resource = normalizeToolCall(call).resource;
    if (resource === null) continue;
    const tools = result.get(resource) ?? new Set<string>();
    tools.add(call.name);
    result.set(resource, tools);
  }
  return result;
}

export function emptyLane(): LaneTrace {
  return { status: "idle", calls: [], eventCount: 0 };
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
        ? "finished"
        : wrapper.type === "lane-failed"
          ? "failed"
          : lane.status;
  if (wrapper.type !== "lane-event" || wrapper.event === undefined || wrapper.laneId === null) {
    return {
      ...lane,
      status,
      ...(wrapper.type === "lane-failed" && wrapper.detail !== undefined ? { detail: wrapper.detail } : {}),
    };
  }
  return {
    ...lane,
    status,
    eventCount: lane.eventCount + 1,
    calls: foldCanonicalToolEvent(lane.calls, wrapper.laneId, wrapper.runId ?? "run", wrapper.event),
  };
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
