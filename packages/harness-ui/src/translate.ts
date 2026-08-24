import type { HarnessRunEvent } from "@qoder-ai/harness/exec";
import {
  HARNESS_PROTOCOL_EVENT,
  HARNESS_TOOL_RESULT_META_EVENT,
  type AguiEvent,
  type HarnessToolResultMeta,
} from "./protocol.js";

export interface AguiTranslatorOptions {
  threadId: string;
  runId: string;
}

export interface AguiTranslator {
  /** Translate one neutral run event into zero or more AG-UI events. */
  translate(event: HarnessRunEvent): AguiEvent[];
  /** True once the run's first RUN_STARTED event was produced. */
  readonly started: boolean;
  /** True once a terminal AG-UI event (RUN_FINISHED or RUN_ERROR) was produced. */
  readonly terminated: boolean;
}

/**
 * Translate the neutral harness run-event lifecycle into AG-UI events.
 *
 * The `HarnessRunEmitter` already guarantees framing (single started/finished,
 * message boundaries, paired tool calls), so the mapping is nearly 1:1. The
 * only state kept here honours the AG-UI run state machine: a run terminates
 * with either `RUN_FINISHED` or `RUN_ERROR`, never both, and nothing follows
 * the terminal event.
 */
export function createAguiTranslator(options: AguiTranslatorOptions): AguiTranslator {
  const { threadId, runId } = options;
  let started = false;
  let terminated = false;
  const entityId = (id: string): string => `${runId}:${id}`;
  return {
    get started(): boolean {
      return started;
    },
    get terminated(): boolean {
      return terminated;
    },
    translate(event: HarnessRunEvent): AguiEvent[] {
      if (terminated) {
        return [];
      }
      if (event.type !== "run-started" && !started) {
        return [];
      }
      switch (event.type) {
        case "run-started": {
          if (started) {
            return [];
          }
          started = true;
          return [{ type: "RUN_STARTED", threadId, runId }];
        }
        case "run-warning":
          return [{ type: "CUSTOM", name: "harness.warning", value: event.message }];
        case "message-started":
          return [{ type: "TEXT_MESSAGE_START", messageId: entityId(event.messageId), role: "assistant" }];
        case "text-delta":
          return [{ type: "TEXT_MESSAGE_CONTENT", messageId: entityId(event.messageId), delta: event.text }];
        case "message-finished":
          return [{ type: "TEXT_MESSAGE_END", messageId: entityId(event.messageId) }];
        case "tool-call-started":
          return [
            {
              type: "TOOL_CALL_START",
              toolCallId: entityId(event.toolCallId),
              toolCallName: event.toolName,
            },
            ...(event.input !== undefined
              ? [{
                  type: "TOOL_CALL_ARGS",
                  toolCallId: entityId(event.toolCallId),
                  delta: JSON.stringify(event.input),
                } as const]
              : []),
          ];
        case "tool-call-finished":
          return [{ type: "TOOL_CALL_END", toolCallId: entityId(event.toolCallId) }];
        case "tool-call-result": {
          const toolCallId = entityId(event.toolCallId);
          const result: AguiEvent = {
            type: "TOOL_CALL_RESULT",
            messageId: entityId(event.messageId ?? `result:${event.toolCallId}`),
            toolCallId,
            content: event.content,
            role: "tool",
          };
          if (event.isError !== true && event.truncated !== true) {
            return [result];
          }
          const metadata: HarnessToolResultMeta = {
            toolCallId,
            isError: event.isError === true,
            truncated: event.truncated === true,
            ...(event.originalBytes !== undefined ? { originalBytes: event.originalBytes } : {}),
          };
          return [
            result,
            { type: "CUSTOM", name: HARNESS_TOOL_RESULT_META_EVENT, value: metadata },
          ];
        }
        case "protocol-event":
          return [{
            type: "CUSTOM",
            name: HARNESS_PROTOCOL_EVENT,
            value: {
              protocol: event.protocol,
              direction: event.direction,
              method: event.method,
              ...(event.rpcId !== undefined ? { rpcId: event.rpcId } : {}),
              ...(event.sessionId !== undefined ? { sessionId: event.sessionId } : {}),
              payload: event.payload,
            },
          }];
        case "run-error":
          terminated = true;
          return [{ type: "RUN_ERROR", message: event.message }];
        case "run-finished": {
          terminated = true;
          if (event.exitCode !== 0) {
            return [{
              type: "RUN_ERROR",
              message: `Harness run failed with exit code ${event.exitCode}.`,
              code: "HARNESS_RUN_FAILED",
            }];
          }
          return [
            {
              type: "RUN_FINISHED",
              threadId,
              runId,
              result: {
                exitCode: event.exitCode,
                ...(event.metrics !== undefined ? { metrics: event.metrics } : {}),
              },
            },
          ];
        }
      }
    },
  };
}
