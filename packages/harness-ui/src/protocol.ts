/**
 * AG-UI wire-format types.
 *
 * This package implements the AG-UI protocol (https://docs.ag-ui.com/) as a
 * wire contract rather than depending on `@ag-ui/core` (still 0.0.x). The
 * shapes below mirror the documented event payloads; conformance is asserted
 * by tests on the emitted JSON.
 */

export const AGUI_EVENT_TYPES = [
  "RUN_STARTED",
  "RUN_FINISHED",
  "RUN_ERROR",
  "TEXT_MESSAGE_START",
  "TEXT_MESSAGE_CONTENT",
  "TEXT_MESSAGE_END",
  "TOOL_CALL_START",
  "TOOL_CALL_ARGS",
  "TOOL_CALL_END",
  "TOOL_CALL_RESULT",
  "CUSTOM",
] as const;

/** Namespaced metadata for retained Tool Call results beyond the AG-UI core shape. */
export const HARNESS_TOOL_RESULT_META_EVENT = "harness.tool-result-meta";
export const HARNESS_PROTOCOL_EVENT = "harness.protocol-event";

export interface HarnessProtocolEvidence {
  protocol: "acp";
  direction: "Client → Agent" | "Agent → Client";
  method: string;
  rpcId?: string;
  sessionId?: string;
  payload: unknown;
}

export interface HarnessToolResultMeta {
  toolCallId: string;
  isError: boolean;
  truncated: boolean;
  originalBytes?: number;
}

export type AguiEventType = (typeof AGUI_EVENT_TYPES)[number];

export interface AguiRunStartedEvent {
  type: "RUN_STARTED";
  threadId: string;
  runId: string;
}

export interface AguiRunFinishedEvent {
  type: "RUN_FINISHED";
  threadId: string;
  runId: string;
  result?: unknown;
}

export interface AguiRunErrorEvent {
  type: "RUN_ERROR";
  message: string;
  code?: string;
}

export interface AguiTextMessageStartEvent {
  type: "TEXT_MESSAGE_START";
  messageId: string;
  role: "assistant";
}

export interface AguiTextMessageContentEvent {
  type: "TEXT_MESSAGE_CONTENT";
  messageId: string;
  delta: string;
}

export interface AguiTextMessageEndEvent {
  type: "TEXT_MESSAGE_END";
  messageId: string;
}

export interface AguiToolCallStartEvent {
  type: "TOOL_CALL_START";
  toolCallId: string;
  toolCallName: string;
  parentMessageId?: string;
}

export interface AguiToolCallArgsEvent {
  type: "TOOL_CALL_ARGS";
  toolCallId: string;
  delta: string;
}

export interface AguiToolCallEndEvent {
  type: "TOOL_CALL_END";
  toolCallId: string;
}

export interface AguiToolCallResultEvent {
  type: "TOOL_CALL_RESULT";
  messageId: string;
  toolCallId: string;
  content: string;
  role?: "tool";
}

export interface AguiCustomEvent {
  type: "CUSTOM";
  name: string;
  value: unknown;
}

export type AguiEvent =
  | AguiRunStartedEvent
  | AguiRunFinishedEvent
  | AguiRunErrorEvent
  | AguiTextMessageStartEvent
  | AguiTextMessageContentEvent
  | AguiTextMessageEndEvent
  | AguiToolCallStartEvent
  | AguiToolCallArgsEvent
  | AguiToolCallEndEvent
  | AguiToolCallResultEvent
  | AguiCustomEvent;

/** One AG-UI conversation message inside `RunAgentInput`. */
export interface AguiMessage {
  id?: string;
  role: string;
  content?: string;
}

/** The AG-UI run request body (`POST` payload). Unknown fields pass through. */
export interface RunAgentInput {
  threadId: string;
  runId: string;
  messages?: AguiMessage[];
  tools?: unknown[];
  context?: unknown[];
  state?: unknown;
  forwardedProps?: unknown;
}

export class RunAgentInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunAgentInputError";
  }
}

/** Validate the minimum RunAgentInput surface this adapter relies on. */
export function parseRunAgentInput(value: unknown): RunAgentInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RunAgentInputError("RunAgentInput must be a JSON object.");
  }
  const input = value as Record<string, unknown>;
  if (typeof input.threadId !== "string" || input.threadId.length === 0) {
    throw new RunAgentInputError("RunAgentInput.threadId must be a non-empty string.");
  }
  if (typeof input.runId !== "string" || input.runId.length === 0) {
    throw new RunAgentInputError("RunAgentInput.runId must be a non-empty string.");
  }
  if (input.messages !== undefined && !Array.isArray(input.messages)) {
    throw new RunAgentInputError("RunAgentInput.messages must be an array when present.");
  }
  const messages: AguiMessage[] = [];
  for (const entry of (input.messages as unknown[] | undefined) ?? []) {
    if (entry === null || typeof entry !== "object") {
      throw new RunAgentInputError("Every RunAgentInput message must be an object.");
    }
    const message = entry as Record<string, unknown>;
    if (typeof message.role !== "string") {
      throw new RunAgentInputError("Every RunAgentInput message needs a string role.");
    }
    messages.push({
      role: message.role,
      ...(typeof message.id === "string" ? { id: message.id } : {}),
      ...(typeof message.content === "string" ? { content: message.content } : {}),
    });
  }
  return {
    threadId: input.threadId,
    runId: input.runId,
    messages,
    ...(Array.isArray(input.tools) ? { tools: input.tools } : {}),
    ...(Array.isArray(input.context) ? { context: input.context } : {}),
    ...(input.state !== undefined ? { state: input.state } : {}),
    ...(input.forwardedProps !== undefined ? { forwardedProps: input.forwardedProps } : {}),
  };
}

/** The task prompt is the most recent user message with text content. */
export function latestUserPrompt(input: RunAgentInput): string | undefined {
  for (let index = (input.messages?.length ?? 0) - 1; index >= 0; index -= 1) {
    const message = input.messages![index];
    if (message.role === "user" && typeof message.content === "string" && message.content.length > 0) {
      return message.content;
    }
  }
  return undefined;
}
