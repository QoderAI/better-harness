import type { HarnessProtocolEvent } from "@qoder-ai/harness/exec";
import type { HarnessRunStreamEventV1 } from "@qoder-ai/harness/protocol";

export type TimelineItem =
  | { kind: "message"; id: string; text: string; complete: boolean }
  | {
      kind: "tool-call";
      id: string;
      name: string;
      argsText: string;
      status: "preparing" | "running" | "completed" | "failed" | "result-unavailable" | "interrupted";
      resultText?: string;
      resultMessageId?: string;
      resultTruncated?: boolean;
      resultOriginalBytes?: number;
    };

export interface HarnessRunState {
  status: "idle" | "running" | "finished" | "error";
  threadId?: string;
  runId?: string;
  lastSequence: number;
  timelineKeys: string[];
  timelineByKey: Map<string, TimelineItem>;
  timelineRevision: number;
  toolCallCount: number;
  warnings: string[];
  protocolEvents: HarnessProtocolEvent[];
  pendingPermission?: AcpPendingPermission;
  error?: string;
  result?: unknown;
}

export interface AcpPendingPermission {
  requestId: string;
  sessionId: string;
  title: string;
  toolCallId: string;
  options: Array<{ optionId: string; name: string; kind: string }>;
}

export function initialRunState(): HarnessRunState {
  return {
    status: "idle",
    lastSequence: 0,
    timelineKeys: [],
    timelineByKey: new Map(),
    timelineRevision: 0,
    toolCallCount: 0,
    warnings: [],
    protocolEvents: [],
  };
}

export function timelineItems(state: HarnessRunState): TimelineItem[] {
  return state.timelineKeys.flatMap((key) => {
    const item = state.timelineByKey.get(key);
    return item === undefined ? [] : [item];
  });
}

/** Fold one sequenced neutral Harness event into the Studio run projection. */
export function applyHarnessRunEvent(
  state: HarnessRunState,
  envelope: HarnessRunStreamEventV1,
): HarnessRunState {
  if (envelope.sequence <= state.lastSequence) return state;
  const sequenced = { ...state, lastSequence: envelope.sequence };
  const event = envelope.event;
  switch (event.type) {
    case "run-started":
      return {
        ...initialRunState(),
        status: "running",
        threadId: envelope.threadId,
        runId: envelope.runId,
        lastSequence: envelope.sequence,
      };
    case "run-warning":
      return { ...sequenced, warnings: [...state.warnings, event.message] };
    case "message-started":
      return appendItem(sequenced, { kind: "message", id: event.messageId, text: "", complete: false });
    case "text-delta":
      return patchItem(sequenced, "message", event.messageId, (item) => ({ ...item, text: item.text + event.text }));
    case "message-finished":
      return patchItem(sequenced, "message", event.messageId, (item) => ({ ...item, complete: true }));
    case "tool-call-started":
      return appendItem(sequenced, {
        kind: "tool-call",
        id: event.toolCallId,
        name: event.toolName,
        argsText: event.input === undefined ? "" : JSON.stringify(event.input),
        status: "preparing",
      });
    case "tool-call-finished":
      return patchItem(sequenced, "tool-call", event.toolCallId, (item) => ({ ...item, status: "running" }));
    case "tool-call-result":
      return patchItem(sequenced, "tool-call", event.toolCallId, (item) => ({
        ...item,
        status: event.isError === true ? "failed" : "completed",
        resultText: event.content,
        ...(event.messageId === undefined ? {} : { resultMessageId: event.messageId }),
        ...(event.truncated === true ? { resultTruncated: true } : {}),
        ...(event.originalBytes === undefined ? {} : { resultOriginalBytes: event.originalBytes }),
      }));
    case "protocol-event": {
      const pendingPermission = permissionFromProtocolEvent(event);
      const resolvedPermission = event.method === "session/request_permission:response" ? event.rpcId : undefined;
      return {
        ...sequenced,
        protocolEvents: [...state.protocolEvents, event].slice(-2_000),
        ...(pendingPermission === undefined ? {} : { pendingPermission }),
        ...(resolvedPermission !== undefined && state.pendingPermission?.requestId === resolvedPermission
          ? { pendingPermission: undefined }
          : {}),
      };
    }
    case "run-error":
      return settleTools({ ...sequenced, status: "error", error: event.message }, "interrupted");
    case "run-finished": {
      const failed = state.status === "error" || event.exitCode !== 0;
      return settleTools({
        ...sequenced,
        status: failed ? "error" : "finished",
        result: {
          exitCode: event.exitCode,
          ...(event.metrics === undefined ? {} : { metrics: event.metrics }),
        },
        ...(failed && state.error === undefined
          ? { error: `Harness run failed with exit code ${event.exitCode}.` }
          : {}),
      }, failed ? "interrupted" : "result-unavailable");
    }
  }
}

function permissionFromProtocolEvent(event: HarnessProtocolEvent): AcpPendingPermission | undefined {
  if (event.method !== "session/request_permission" || event.direction !== "Agent → Client" || event.rpcId === undefined) return undefined;
  const envelope = recordValue(event.payload);
  const params = recordValue(envelope?.params);
  const toolCall = recordValue(params?.toolCall);
  if (typeof params?.sessionId !== "string" || typeof toolCall?.toolCallId !== "string" || !Array.isArray(params.options)) return undefined;
  const options = params.options.flatMap((value) => {
    const option = recordValue(value);
    return typeof option?.optionId === "string" && typeof option.name === "string" && typeof option.kind === "string"
      ? [{ optionId: option.optionId, name: option.name, kind: option.kind }]
      : [];
  });
  if (options.length === 0) return undefined;
  return {
    requestId: event.rpcId,
    sessionId: params.sessionId,
    title: typeof toolCall.title === "string" ? toolCall.title : "ACP Agent action",
    toolCallId: toolCall.toolCallId,
    options,
  };
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function settleTools(
  state: HarnessRunState,
  terminalStatus: "result-unavailable" | "interrupted",
): HarnessRunState {
  return {
    ...state,
    timelineRevision: state.timelineRevision + 1,
    timelineByKey: settleTimeline(state.timelineByKey, terminalStatus),
  };
}

function settleTimeline(
  current: Map<string, TimelineItem>,
  terminalStatus: "result-unavailable" | "interrupted",
): Map<string, TimelineItem> {
  const next = new Map(current);
  for (const [key, item] of current) {
    if (item.kind === "tool-call" && (item.status === "preparing" || item.status === "running")) {
      next.set(key, { ...item, status: terminalStatus });
    }
  }
  return next;
}

function appendItem(state: HarnessRunState, item: TimelineItem): HarnessRunState {
  const key = itemKey(item.kind, item.id);
  if (state.timelineByKey.has(key)) return state;
  state.timelineByKey.set(key, item);
  return {
    ...state,
    timelineKeys: [...state.timelineKeys, key],
    timelineRevision: state.timelineRevision + 1,
    toolCallCount: state.toolCallCount + (item.kind === "tool-call" ? 1 : 0),
  };
}

function patchItem<Kind extends TimelineItem["kind"]>(
  state: HarnessRunState,
  kind: Kind,
  id: string,
  update: (item: Extract<TimelineItem, { kind: Kind }>) => TimelineItem,
): HarnessRunState {
  const key = itemKey(kind, id);
  const item = state.timelineByKey.get(key);
  if (item?.kind !== kind) return state;
  state.timelineByKey.set(key, update(item as Extract<TimelineItem, { kind: Kind }>));
  return { ...state, timelineRevision: state.timelineRevision + 1 };
}

function itemKey(kind: TimelineItem["kind"], id: string): string {
  return `${kind}:${id}`;
}
