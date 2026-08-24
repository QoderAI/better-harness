export type ToolRelation = "exact" | "same-resource" | "same-tool" | "none";

import type { ExperimentToolCall } from "../experiment-stream-contract.js";

export type { ExperimentToolCall } from "../experiment-stream-contract.js";

export interface NormalizedToolCall {
  tool: string;
  resource: string | null;
  arguments: string;
}

export interface RelatedToolCall {
  relation: ToolRelation;
  score: number;
  call: ExperimentToolCall | null;
  basis: string;
}

export type ActivityPhase =
  | "Orient"
  | "Discover"
  | "Change"
  | "Execute"
  | "Diagnose"
  | "Recover"
  | "Verify"
  | "Deliver";

export interface ActivityProjection {
  call: ExperimentToolCall;
  phase: ActivityPhase;
  basis: string;
}

export function normalizeToolCall(call: ExperimentToolCall): NormalizedToolCall {
  return {
    tool: call.name.trim().toLowerCase(),
    resource: resourceFrom(call.input),
    arguments: canonicalJson(call.input ?? null),
  };
}

export function compareToolCalls(left: ExperimentToolCall, right: ExperimentToolCall): RelatedToolCall {
  const a = normalizeToolCall(left);
  const b = normalizeToolCall(right);
  if (a.tool === b.tool && a.arguments === b.arguments) {
    return { relation: "exact", score: 100, call: right, basis: "same tool and canonical arguments" };
  }
  if (a.resource !== null && b.resource !== null && sameResource(a.resource, b.resource)) {
    return {
      relation: "same-resource",
      score: a.tool === b.tool ? 84 : 72,
      call: right,
      basis: `same resource ${a.resource}${a.tool === b.tool ? " and same tool" : ""}`,
    };
  }
  if (a.tool === b.tool) {
    return { relation: "same-tool", score: 40, call: right, basis: `same ${left.name} tool` };
  }
  return { relation: "none", score: 0, call: null, basis: "no shared tool or resource key" };
}

function sameResource(left: string, right: string): boolean {
  if (left === right) return true;
  if (left.startsWith("command:") || right.startsWith("command:") || left.startsWith("pattern:") || right.startsWith("pattern:")) {
    return false;
  }
  return left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

/**
 * Weighted sequence alignment. It keeps matches one-to-one and monotonic, so a
 * repeated Read cannot become the counterpart of several calls in another lane.
 */
export function alignToolCalls(
  reference: readonly ExperimentToolCall[],
  candidate: readonly ExperimentToolCall[],
): Map<string, RelatedToolCall> {
  const rows = reference.length + 1;
  const columns = candidate.length + 1;
  const scores = Array.from({ length: rows }, () => Array<number>(columns).fill(0));
  const moves = Array.from({ length: rows }, () => Array<"up" | "left" | "match" | null>(columns).fill(null));
  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const relation = compareToolCalls(reference[row - 1]!, candidate[column - 1]!);
      const match = relation.score >= 40 ? scores[row - 1]![column - 1]! + relation.score : -1;
      const up = scores[row - 1]![column]!;
      const left = scores[row]![column - 1]!;
      if (match >= up && match >= left) {
        scores[row]![column] = match;
        moves[row]![column] = "match";
      } else if (up >= left) {
        scores[row]![column] = up;
        moves[row]![column] = "up";
      } else {
        scores[row]![column] = left;
        moves[row]![column] = "left";
      }
    }
  }
  const aligned = new Map<string, RelatedToolCall>();
  let row = reference.length;
  let column = candidate.length;
  while (row > 0 && column > 0) {
    const move = moves[row]![column];
    if (move === "match") {
      const source = reference[row - 1]!;
      const relation = compareToolCalls(source, candidate[column - 1]!);
      if (relation.score >= 40) aligned.set(source.id, relation);
      row -= 1;
      column -= 1;
    } else if (move === "up") {
      row -= 1;
    } else {
      column -= 1;
    }
  }
  return aligned;
}

export function relatedCallFor(
  selected: ExperimentToolCall,
  sourceLane: readonly ExperimentToolCall[],
  targetLane: readonly ExperimentToolCall[],
): RelatedToolCall {
  return alignToolCalls(sourceLane, targetLane).get(selected.id) ?? {
    relation: "none",
    score: 0,
    call: null,
    basis: "no monotonic counterpart",
  };
}

export function localToolChain(
  calls: readonly ExperimentToolCall[],
  selectedId: string,
): ExperimentToolCall[] {
  const index = calls.findIndex((call) => call.id === selectedId);
  if (index < 0) return [];
  return calls.slice(Math.max(0, index - 1), Math.min(calls.length, index + 2));
}

/**
 * Projects recorded calls into engineering phases using only observable tool
 * names, command text, resources, and status. The projection is a navigation
 * aid; it is not a claim about hidden agent intent.
 */
export function projectActivities(calls: readonly ExperimentToolCall[]): ActivityProjection[] {
  return calls.map((call, index) => {
    if (call.status === "failed") {
      return { call, phase: "Diagnose", basis: "recorded failed tool result" };
    }
    if (index > 0 && calls[index - 1]?.status === "failed") {
      return { call, phase: "Recover", basis: "first recorded call after a failure" };
    }
    const tool = call.name.trim().toLowerCase();
    const normalized = normalizeToolCall(call);
    const command = normalized.resource?.startsWith("command:")
      ? normalized.resource.slice("command:".length).toLowerCase()
      : "";
    if (/todo|plan|agent|task/.test(tool)) {
      return { call, phase: "Orient", basis: `tool ${call.name}` };
    }
    if (/read|grep|glob|search|find|list|fetch/.test(tool)) {
      return { call, phase: "Discover", basis: `tool ${call.name}` };
    }
    if (/write|edit|patch|replace|notebook/.test(tool)) {
      return { call, phase: "Change", basis: `tool ${call.name}` };
    }
    if (/git\s+commit|gh\s+pr\s+create|submit|publish|deploy/.test(command) || /deliver|submit|publish/.test(tool)) {
      return { call, phase: "Deliver", basis: command === "" ? `tool ${call.name}` : "recorded delivery command" };
    }
    if (/test|lint|build|check|verify|typecheck|vitest|playwright/.test(command) || /test|verify|check/.test(tool)) {
      return { call, phase: "Verify", basis: command === "" ? `tool ${call.name}` : "recorded verification command" };
    }
    return { call, phase: "Execute", basis: `tool ${call.name}` };
  });
}

export function activityPhaseSequence(calls: readonly ExperimentToolCall[]): ActivityPhase[] {
  const result: ActivityPhase[] = [];
  for (const activity of projectActivities(calls)) {
    if (result.at(-1) !== activity.phase) result.push(activity.phase);
  }
  return result;
}

function resourceFrom(input: unknown): string | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  for (const key of ["path", "file_path", "filePath", "target", "uri"] as const) {
    if (typeof record[key] === "string" && record[key].trim() !== "") {
      return normalizeResource(record[key]);
    }
  }
  if (typeof record.command === "string" && record.command.trim() !== "") {
    return `command:${record.command.trim().replace(/\s+/g, " ")}`;
  }
  if (typeof record.pattern === "string" && record.pattern.trim() !== "") {
    return `pattern:${record.pattern.trim()}`;
  }
  return null;
}

function normalizeResource(value: string): string {
  return value
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/^<trial-root>\//, "")
    .replace(/\/+/g, "/");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
