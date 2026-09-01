import type {
  DebuggerEvent,
  DebuggerEventKind,
  DebuggerRawAcp,
  DebuggerSession,
  DebuggerValidation,
  RetainedRunRecord,
  RetainedRunTimelineItem,
  StopCondition,
} from "../contracts/debugger-session.js";

export function sessionFromRetainedRun(record: RetainedRunRecord): DebuggerSession {
  const sessionId = record.runId ?? record.id;
  const startedAt = formatRetainedTime(record.savedAt);
  const events: DebuggerEvent[] = [retainedPromptEvent(record, sessionId, startedAt)];
  record.timeline.forEach((item, index) => {
    events.push(item.kind === "message"
      ? retainedMessageEvent(record, item, sessionId, index + 1)
      : retainedToolEvent(record, item, sessionId, index + 1));
  });
  if (record.error !== undefined) {
    events.push(retainedErrorEvent(record, sessionId, events.length));
  }
  return {
    id: sessionId,
    name: record.prompt,
    agent: "local harness",
    protocol: "Harness run evidence",
    connection: record.status,
    mode: "Retained run",
    startedAt,
    finishedAt: formatRetainedTime(record.savedAt),
    events,
  };
}

function retainedPromptEvent(record: RetainedRunRecord, sessionId: string, timestamp: string): DebuggerEvent {
  return {
    id: "prompt",
    kind: "prompt",
    phase: "Prompt",
    title: "User request",
    summary: record.prompt,
    timestamp,
    relativeTime: "+0s",
    stopConditions: [],
    evidence: [{ level: "Exact", label: "Saved run prompt", detail: "Prompt text is retained in the saved Debugger run record." }],
    rawAcp: retainedRaw("Client → Agent", "run/prompt", "1", sessionId, { text: record.prompt, threadId: record.threadId }),
  };
}

function retainedMessageEvent(record: RetainedRunRecord, item: Extract<RetainedRunTimelineItem, { kind: "message" }>, sessionId: string, index: number): DebuggerEvent {
  return {
    id: `message_${safeId(item.id, index)}`,
    kind: "response",
    phase: item.complete ? "Response" : "Message",
    title: item.complete ? "Assistant response" : "Assistant message",
    summary: item.text || "No message text retained.",
    timestamp: relativeRetainedTimestamp(record.savedAt, index),
    relativeTime: `+${index}s`,
    stopConditions: item.complete ? ["responses"] : [],
    evidence: [{ level: "Exact", label: "Retained message", detail: "Message content is retained in the saved run timeline." }],
    rawAcp: retainedRaw("Agent → Client", "run/message", String(index + 1), sessionId, item),
  };
}

function retainedToolEvent(record: RetainedRunRecord, item: Extract<RetainedRunTimelineItem, { kind: "tool-call" }>, sessionId: string, index: number): DebuggerEvent {
  const kind = kindForRetainedTool(item);
  const resource = retainedToolResource(item.argsText);
  const statusFailed = item.status === "failed" || record.status === "error";
  const validation = kind === "verify" ? retainedValidation(item, statusFailed) : undefined;
  const fileChange = kind === "change" && resource !== undefined ? [{ path: resource, additions: 0, deletions: 0, status: "modified" as const }] : undefined;
  return {
    id: `tool_${safeId(item.id, index)}`,
    kind,
    phase: phaseForKind(kind),
    title: `${item.name} tool call`,
    summary: retainedToolSummary(item),
    timestamp: relativeRetainedTimestamp(record.savedAt, index),
    relativeTime: `+${index}s`,
    stopConditions: stopConditionsForRetainedTool(kind, statusFailed),
    toolCalls: [{ id: item.id, name: item.name, summary: retainedToolSummary(item), input: item.argsText, output: item.resultText ?? "No retained result payload.", duration: "retained", ...(resource === undefined ? {} : { resource }) }],
    ...(fileChange === undefined ? {} : { fileChanges: fileChange }),
    ...(validation === undefined ? {} : { validation }),
    evidence: [
      { level: "Exact", label: "Saved tool call", detail: "Tool name, arguments, status, and retained result come from the saved run timeline." },
      { level: "Correlated", label: "Semantic phase", detail: `The ${phaseForKind(kind)} phase is derived from the retained tool name and payload shape.` },
    ],
    rawAcp: retainedRaw("Agent → Client", "run/tool-call", String(index + 1), sessionId, item, item.id),
  };
}

function retainedErrorEvent(record: RetainedRunRecord, sessionId: string, index: number): DebuggerEvent {
  return {
    id: "run_error",
    kind: "verify",
    phase: "Failure",
    title: "Run ended with error",
    summary: record.error ?? "The run ended with an error.",
    timestamp: relativeRetainedTimestamp(record.savedAt, index),
    relativeTime: `+${index}s`,
    stopConditions: ["failures"],
    validation: { command: "harness run", status: "failed", duration: "retained", summary: record.error ?? "Run failed", output: record.warnings.length > 0 ? record.warnings : [record.error ?? "Run failed"] },
    evidence: [{ level: "Exact", label: "Saved run status", detail: "The error text is retained in the saved run record." }],
    rawAcp: retainedRaw("Agent → Client", "run/error", String(index + 1), sessionId, { status: record.status, error: record.error }),
  };
}

function retainedRaw(direction: DebuggerRawAcp["direction"], method: string, rpcId: string, sessionId: string, payload: Record<string, unknown>, toolCallId?: string): DebuggerRawAcp {
  return {
    direction,
    method,
    rpcId,
    sessionId,
    ...(toolCallId === undefined ? {} : { toolCallId }),
    traceContext: `retained-${sessionId}-${rpcId}`,
    payload,
  };
}

function kindForRetainedTool(item: Extract<RetainedRunTimelineItem, { kind: "tool-call" }>): DebuggerEventKind {
  const text = `${item.name} ${item.argsText}`.toLowerCase();
  if (/bash|test|vitest|npm|pnpm|yarn|command/.test(text)) return "verify";
  if (/edit|write|patch|replace|delete/.test(text)) return "change";
  return "explore";
}

function phaseForKind(kind: DebuggerEventKind): string {
  if (kind === "verify") return "Verify";
  if (kind === "change") return "Change";
  if (kind === "response") return "Response";
  if (kind === "prompt") return "Prompt";
  if (kind === "plan") return "Plan";
  return "Explore";
}

function stopConditionsForRetainedTool(kind: DebuggerEventKind, failed: boolean): StopCondition[] {
  return [
    ...(kind === "change" ? ["changes" as const] : []),
    ...(kind === "verify" ? ["tests" as const] : []),
    ...(failed ? ["failures" as const] : []),
  ];
}

function retainedValidation(item: Extract<RetainedRunTimelineItem, { kind: "tool-call" }>, failed: boolean): DebuggerValidation {
  const output = (item.resultText ?? "No retained result payload.").split(/\r?\n/).filter(Boolean).slice(0, 8);
  return {
    command: retainedCommand(item),
    status: failed ? "failed" : "passed",
    duration: "retained",
    summary: item.resultTruncated === true ? "Retained result was truncated." : `Tool status: ${item.status}`,
    output: output.length > 0 ? output : [item.status],
  };
}

function retainedCommand(item: Extract<RetainedRunTimelineItem, { kind: "tool-call" }>): string {
  const parsed = parseJsonObject(item.argsText);
  const command = parsed?.command;
  return typeof command === "string" && command.trim().length > 0 ? command : item.name;
}

function retainedToolResource(argsText: string): string | undefined {
  const parsed = parseJsonObject(argsText);
  const value = parsed?.path ?? parsed?.file_path ?? parsed?.filePath ?? parsed?.command;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function retainedToolSummary(item: Extract<RetainedRunTimelineItem, { kind: "tool-call" }>): string {
  const resource = retainedToolResource(item.argsText);
  return resource === undefined ? `${item.name} · ${item.status}` : `${item.name} ${resource}`;
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function safeId(value: string, fallback: number): string {
  const safe = value.replace(/[^A-Za-z0-9_-]/g, "_");
  return safe.length > 0 ? safe : String(fallback);
}

function formatRetainedTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toISOString().slice(11, 19);
}

function relativeRetainedTimestamp(savedAt: string, offsetSeconds: number): string {
  const date = new Date(savedAt);
  if (Number.isNaN(date.valueOf())) return `+${offsetSeconds}s`;
  return new Date(date.valueOf() + offsetSeconds * 1000).toISOString().slice(11, 19);
}
