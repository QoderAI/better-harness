import {
  HARNESS_PROTOCOL_EVENT,
  HARNESS_TOOL_RESULT_META_EVENT,
  type AguiEvent,
  type HarnessProtocolEvidence,
  type HarnessToolResultMeta,
} from "@qoder-ai/harness-ui/protocol";

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

export interface AguiRunState {
  status: "idle" | "running" | "finished" | "error";
  threadId?: string;
  runId?: string;
  /** Stable order plus O(1) lookup; React observes revision bumps. */
  timelineKeys: string[];
  timelineByKey: Map<string, TimelineItem>;
  timelineRevision: number;
  toolCallCount: number;
  warnings: string[];
  protocolEvents: HarnessProtocolEvidence[];
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

export function initialRunState(): AguiRunState {
  return { status: "idle", timelineKeys: [], timelineByKey: new Map(), timelineRevision: 0, toolCallCount: 0, warnings: [], protocolEvents: [] };
}

export function timelineItems(state: AguiRunState): TimelineItem[] {
  return state.timelineKeys.flatMap((key) => {
    const item = state.timelineByKey.get(key);
    return item === undefined ? [] : [item];
  });
}

/**
 * Fold one AG-UI event into the keyed run store. The fold mutates the keyed
 * map in place and bumps a revision so streaming argument and text deltas
 * patch one entry in O(1) instead of reducing the full timeline. Argument and
 * text deltas are not idempotent, so each event batch must be folded exactly
 * once, outside React state updaters that StrictMode may double-invoke.
 */
export function applyAguiEvent(state: AguiRunState, event: AguiEvent): AguiRunState {
  switch (event.type) {
    case "RUN_STARTED":
      return { ...initialRunState(), status: "running", threadId: event.threadId, runId: event.runId };
    case "TEXT_MESSAGE_START":
      return appendItem(state, { kind: "message", id: event.messageId, text: "", complete: false });
    case "TEXT_MESSAGE_CONTENT":
      return patchItem(state, "message", event.messageId, (item) => ({
        ...item,
        text: item.text + event.delta,
      }));
    case "TEXT_MESSAGE_END":
      return patchItem(state, "message", event.messageId, (item) => ({ ...item, complete: true }));
    case "TOOL_CALL_START":
      return appendItem(state, {
        kind: "tool-call",
        id: event.toolCallId,
        name: event.toolCallName,
        argsText: "",
        status: "preparing",
      });
    case "TOOL_CALL_ARGS":
      return patchItem(state, "tool-call", event.toolCallId, (item) => ({
        ...item,
        argsText: item.argsText + event.delta,
      }));
    case "TOOL_CALL_END":
      return patchItem(state, "tool-call", event.toolCallId, (item) => ({ ...item, status: "running" }));
    case "TOOL_CALL_RESULT":
      return patchItem(state, "tool-call", event.toolCallId, (item) => ({
        ...item,
        status: "completed",
        resultText: event.content,
        resultMessageId: event.messageId,
      }));
    case "CUSTOM": {
      if (event.name === "harness.warning" && typeof event.value === "string") {
        return { ...state, warnings: [...state.warnings, event.value] };
      }
      const metadata = event.name === HARNESS_TOOL_RESULT_META_EVENT
        ? parseToolResultMeta(event.value)
        : undefined;
      if (metadata === undefined && event.name === HARNESS_PROTOCOL_EVENT) {
        const protocol = parseProtocolEvidence(event.value);
        if (protocol === undefined) return state;
        const pendingPermission = permissionFromProtocolEvent(protocol);
        const resolvedPermission = protocol.method === "session/request_permission:response"
          ? protocol.rpcId
          : undefined;
        return {
          ...state,
          protocolEvents: [...state.protocolEvents, protocol].slice(-2_000),
          ...(pendingPermission !== undefined ? { pendingPermission } : {}),
          ...(resolvedPermission !== undefined && state.pendingPermission?.requestId === resolvedPermission
            ? { pendingPermission: undefined }
            : {}),
        };
      }
      return metadata === undefined
        ? state
        : patchItem(state, "tool-call", metadata.toolCallId, (item) => ({
            ...item,
            ...(metadata.isError ? { status: "failed" as const } : {}),
            ...(metadata.truncated ? { resultTruncated: true } : {}),
            ...(metadata.originalBytes !== undefined ? { resultOriginalBytes: metadata.originalBytes } : {}),
          }));
    }
    case "RUN_ERROR":
      return settleTools({ ...state, status: "error", error: event.message }, "interrupted");
    case "RUN_FINISHED":
      return settleTools({
        ...state,
        status: "finished",
        ...(event.result !== undefined ? { result: event.result } : {}),
      }, "result-unavailable");
  }
}

function parseProtocolEvidence(value: unknown): HarnessProtocolEvidence | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const event = value as Record<string, unknown>;
  if (
    event.protocol !== "acp" ||
    (event.direction !== "Client → Agent" && event.direction !== "Agent → Client") ||
    typeof event.method !== "string"
  ) return undefined;
  return {
    protocol: "acp",
    direction: event.direction,
    method: event.method,
    ...(typeof event.rpcId === "string" ? { rpcId: event.rpcId } : {}),
    ...(typeof event.sessionId === "string" ? { sessionId: event.sessionId } : {}),
    payload: event.payload,
  };
}

function permissionFromProtocolEvent(event: HarnessProtocolEvidence): AcpPendingPermission | undefined {
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
  state: AguiRunState,
  terminalStatus: "result-unavailable" | "interrupted",
): AguiRunState {
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

function parseToolResultMeta(value: unknown): HarnessToolResultMeta | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const metadata = value as Record<string, unknown>;
  if (
    typeof metadata.toolCallId !== "string" ||
    typeof metadata.isError !== "boolean" ||
    typeof metadata.truncated !== "boolean"
  ) {
    return undefined;
  }
  return {
    toolCallId: metadata.toolCallId,
    isError: metadata.isError,
    truncated: metadata.truncated,
    ...(typeof metadata.originalBytes === "number" ? { originalBytes: metadata.originalBytes } : {}),
  };
}

function appendItem(state: AguiRunState, item: TimelineItem): AguiRunState {
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
  state: AguiRunState,
  kind: Kind,
  id: string,
  update: (item: Extract<TimelineItem, { kind: Kind }>) => TimelineItem,
): AguiRunState {
  const key = itemKey(kind, id);
  const item = state.timelineByKey.get(key);
  if (item?.kind !== kind) return state;
  state.timelineByKey.set(key, update(item as Extract<TimelineItem, { kind: Kind }>));
  return { ...state, timelineRevision: state.timelineRevision + 1 };
}

function itemKey(kind: TimelineItem["kind"], id: string): string {
  return `${kind}:${id}`;
}
