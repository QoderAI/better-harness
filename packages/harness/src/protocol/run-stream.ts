import type { HarnessRunEvent } from "../exec/events.js";

export const HARNESS_RUN_REQUEST_KIND = "HarnessRunRequestV1" as const;
export const HARNESS_RUN_STREAM_EVENT_KIND = "HarnessRunStreamEventV1" as const;

export interface HarnessRunRequestV1 {
  kind: typeof HARNESS_RUN_REQUEST_KIND;
  threadId: string;
  runId: string;
  prompt: string;
}

export interface HarnessRunStreamEventV1 {
  kind: typeof HARNESS_RUN_STREAM_EVENT_KIND;
  threadId: string;
  runId: string;
  sequence: number;
  event: HarnessRunEvent;
}

export function parseHarnessRunRequestV1(value: unknown): HarnessRunRequestV1 {
  const input = objectValue(value, "Harness run request");
  if (input.kind !== HARNESS_RUN_REQUEST_KIND) {
    throw new Error(`Harness run request kind must be '${HARNESS_RUN_REQUEST_KIND}'.`);
  }
  return {
    kind: HARNESS_RUN_REQUEST_KIND,
    threadId: boundedString(input.threadId, "threadId", 256),
    runId: boundedString(input.runId, "runId", 256),
    prompt: boundedString(input.prompt, "prompt", 65_536),
  };
}

export function parseHarnessRunStreamEventV1(value: unknown): HarnessRunStreamEventV1 {
  const envelope = objectValue(value, "Harness run stream event");
  if (envelope.kind !== HARNESS_RUN_STREAM_EVENT_KIND) {
    throw new Error(`Harness run stream event kind must be '${HARNESS_RUN_STREAM_EVENT_KIND}'.`);
  }
  if (!Number.isSafeInteger(envelope.sequence) || (envelope.sequence as number) < 1) {
    throw new Error("Harness run stream event sequence must be a positive safe integer.");
  }
  return {
    kind: HARNESS_RUN_STREAM_EVENT_KIND,
    threadId: boundedString(envelope.threadId, "threadId", 256),
    runId: boundedString(envelope.runId, "runId", 256),
    sequence: envelope.sequence as number,
    event: parseHarnessRunEvent(envelope.event),
  };
}

function parseHarnessRunEvent(value: unknown): HarnessRunEvent {
  const event = objectValue(value, "Harness run event");
  if (typeof event.type !== "string") throw new Error("Harness run event requires a string type.");
  switch (event.type) {
    case "run-started":
      return { type: event.type, revisionId: stringValue(event.revisionId, "revisionId"), host: stringValue(event.host, "host") };
    case "run-warning":
    case "run-error":
      return { type: event.type, message: stringValue(event.message, "message") };
    case "message-started":
    case "message-finished":
      return { type: event.type, messageId: stringValue(event.messageId, "messageId") };
    case "text-delta":
      return { type: event.type, messageId: stringValue(event.messageId, "messageId"), text: stringValue(event.text, "text") };
    case "tool-call-started":
      return {
        type: event.type,
        toolCallId: stringValue(event.toolCallId, "toolCallId"),
        toolName: stringValue(event.toolName, "toolName"),
        ...(event.input === undefined ? {} : { input: event.input }),
      };
    case "tool-call-finished":
      return { type: event.type, toolCallId: stringValue(event.toolCallId, "toolCallId") };
    case "tool-call-result":
      return {
        type: event.type,
        toolCallId: stringValue(event.toolCallId, "toolCallId"),
        content: stringValue(event.content, "content"),
        ...(typeof event.messageId === "string" ? { messageId: event.messageId } : {}),
        ...(event.isError === true ? { isError: true } : {}),
        ...(event.truncated === true ? { truncated: true } : {}),
        ...(typeof event.originalBytes === "number" ? { originalBytes: event.originalBytes } : {}),
      };
    case "protocol-event":
      if (event.protocol !== "acp" || (event.direction !== "Client → Agent" && event.direction !== "Agent → Client")) {
        throw new Error("Harness protocol event has an unsupported protocol or direction.");
      }
      return {
        type: event.type,
        protocol: event.protocol,
        direction: event.direction,
        method: stringValue(event.method, "method"),
        ...(typeof event.rpcId === "string" ? { rpcId: event.rpcId } : {}),
        ...(typeof event.sessionId === "string" ? { sessionId: event.sessionId } : {}),
        payload: event.payload,
      };
    case "run-finished":
      if (!Number.isSafeInteger(event.exitCode)) throw new Error("Harness run-finished exitCode must be an integer.");
      return {
        type: event.type,
        exitCode: event.exitCode as number,
        ...(event.metrics !== undefined ? { metrics: event.metrics as Extract<HarnessRunEvent, { type: "run-finished" }>["metrics"] } : {}),
      };
    default:
      throw new Error(`Unsupported Harness run event type '${event.type}'.`);
  }
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`Harness run event ${label} must be a string.`);
  return value;
}

function boundedString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new Error(`Harness run request ${label} must be a non-empty string of at most ${maxLength} characters.`);
  }
  return value;
}
