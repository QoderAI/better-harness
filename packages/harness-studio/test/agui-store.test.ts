import { describe, expect, it } from "vitest";
import { HARNESS_PROTOCOL_EVENT, HARNESS_TOOL_RESULT_META_EVENT, type AguiEvent } from "@qoder-ai/harness-ui";
import { applyAguiEvent, initialRunState, timelineItems, type AguiRunState } from "../src/app/agui-store.js";
import { createSseParser } from "../src/app/sse-client.js";

function reduce(events: AguiEvent[]): AguiRunState {
  return events.reduce(applyAguiEvent, initialRunState());
}

describe("applyAguiEvent", () => {
  it("folds a streamed run into messages, tool calls, and a final result", () => {
    const state = reduce([
      { type: "RUN_STARTED", threadId: "t1", runId: "r1" },
      { type: "CUSTOM", name: "harness.warning", value: "degraded to advisory" },
      { type: "TEXT_MESSAGE_START", messageId: "msg_1", role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "msg_1", delta: "Hello " },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "msg_1", delta: "world" },
      { type: "TEXT_MESSAGE_END", messageId: "msg_1" },
      { type: "TOOL_CALL_START", toolCallId: "tu_1", toolCallName: "Read" },
      { type: "TOOL_CALL_ARGS", toolCallId: "tu_1", delta: '{"path":"README.md"}' },
      { type: "TOOL_CALL_END", toolCallId: "tu_1" },
      {
        type: "TOOL_CALL_RESULT",
        messageId: "result_1",
        toolCallId: "tu_1",
        content: '{"bytes":42}',
        role: "tool",
      },
      { type: "RUN_FINISHED", threadId: "t1", runId: "r1", result: { exitCode: 0 } },
    ]);

    expect(state.status).toBe("finished");
    expect(state.runId).toBe("r1");
    expect(state.warnings).toEqual(["degraded to advisory"]);
    expect(state.result).toEqual({ exitCode: 0 });
    expect(timelineItems(state)).toEqual([
      { kind: "message", id: "msg_1", text: "Hello world", complete: true },
      {
        kind: "tool-call",
        id: "tu_1",
        name: "Read",
        argsText: '{"path":"README.md"}',
        status: "completed",
        resultText: '{"bytes":42}',
        resultMessageId: "result_1",
      },
    ]);
  });

  it("marks the run as errored on RUN_ERROR and keeps the partial timeline", () => {
    const state = reduce([
      { type: "RUN_STARTED", threadId: "t1", runId: "r1" },
      { type: "TEXT_MESSAGE_START", messageId: "msg_1", role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "msg_1", delta: "partial" },
      { type: "RUN_ERROR", message: "auth failed" },
    ]);

    expect(state.status).toBe("error");
    expect(state.error).toBe("auth failed");
    expect(timelineItems(state)).toEqual([
      { kind: "message", id: "msg_1", text: "partial", complete: false },
    ]);
  });

  it("resets stale state when a new run starts", () => {
    const previous = reduce([
      { type: "RUN_STARTED", threadId: "t1", runId: "r1" },
      { type: "RUN_ERROR", message: "boom" },
    ]);

    const next = applyAguiEvent(previous, { type: "RUN_STARTED", threadId: "t2", runId: "r2" });

    expect(next).toEqual({ ...initialRunState(), status: "running", threadId: "t2", runId: "r2" });
  });

  it("marks an in-flight tool call interrupted when the run errors", () => {
    const state = reduce([
      { type: "RUN_STARTED", threadId: "t1", runId: "r1" },
      { type: "TOOL_CALL_START", toolCallId: "tu_1", toolCallName: "Bash" },
      { type: "TOOL_CALL_ARGS", toolCallId: "tu_1", delta: '{"command":"npm test"}' },
      { type: "TOOL_CALL_END", toolCallId: "tu_1" },
      { type: "RUN_ERROR", message: "process stopped" },
    ]);

    expect(timelineItems(state)[0]).toMatchObject({ kind: "tool-call", status: "interrupted" });
  });

  it("keeps failed and truncated result metadata when the run finishes", () => {
    const state = reduce([
      { type: "RUN_STARTED", threadId: "t1", runId: "r1" },
      { type: "TOOL_CALL_START", toolCallId: "tu_1", toolCallName: "Bash" },
      { type: "TOOL_CALL_END", toolCallId: "tu_1" },
      {
        type: "TOOL_CALL_RESULT",
        messageId: "result_1",
        toolCallId: "tu_1",
        content: "command failed",
        role: "tool",
      },
      {
        type: "CUSTOM",
        name: HARNESS_TOOL_RESULT_META_EVENT,
        value: { toolCallId: "tu_1", isError: true, truncated: true, originalBytes: 90_000 },
      },
      { type: "RUN_FINISHED", threadId: "t1", runId: "r1" },
    ]);

    expect(timelineItems(state)[0]).toMatchObject({
      kind: "tool-call",
      status: "failed",
      resultText: "command failed",
      resultTruncated: true,
      resultOriginalBytes: 90_000,
    });
  });

  it("does not label a settled tool call completed when no result was retained", () => {
    const state = reduce([
      { type: "RUN_STARTED", threadId: "t1", runId: "r1" },
      { type: "TOOL_CALL_START", toolCallId: "tu_1", toolCallName: "Read" },
      { type: "TOOL_CALL_END", toolCallId: "tu_1" },
      { type: "RUN_FINISHED", threadId: "t1", runId: "r1" },
    ]);

    expect(timelineItems(state)[0]).toMatchObject({ kind: "tool-call", status: "result-unavailable" });
  });

  it("retains ACP frames and projects a real permission request until its response", () => {
    const request = {
      protocol: "acp" as const,
      direction: "Agent → Client" as const,
      method: "session/request_permission",
      rpcId: "permission-1",
      payload: {
        params: {
          sessionId: "session-1",
          toolCall: { toolCallId: "tool-1", title: "Read workspace" },
          options: [{ optionId: "allow", name: "Allow once", kind: "allow_once" }],
        },
      },
    };
    const waiting = reduce([
      { type: "RUN_STARTED", threadId: "t1", runId: "r1" },
      { type: "CUSTOM", name: HARNESS_PROTOCOL_EVENT, value: request },
    ]);

    expect(waiting.protocolEvents).toEqual([request]);
    expect(waiting.pendingPermission).toMatchObject({ requestId: "permission-1", toolCallId: "tool-1" });

    const settled = applyAguiEvent(waiting, {
      type: "CUSTOM",
      name: HARNESS_PROTOCOL_EVENT,
      value: { ...request, direction: "Client → Agent", method: "session/request_permission:response" },
    });
    expect(settled.pendingPermission).toBeUndefined();
    expect(settled.protocolEvents).toHaveLength(2);
  });
});

describe("createSseParser", () => {
  it("reassembles frames across arbitrary chunk boundaries", () => {
    const events: AguiEvent[] = [];
    const parser = createSseParser((event) => events.push(event));
    const frames =
      'data: {"type":"RUN_STARTED","threadId":"t1","runId":"r1"}\n\n' +
      'data: {"type":"TEXT_MESSAGE_START","messageId":"m1","role":"assistant"}\n\n';

    // Split mid-frame to simulate fetch chunking.
    parser.push(frames.slice(0, 25));
    parser.push(frames.slice(25, 80));
    parser.push(frames.slice(80));
    parser.end();

    expect(events).toEqual([
      { type: "RUN_STARTED", threadId: "t1", runId: "r1" },
      { type: "TEXT_MESSAGE_START", messageId: "m1", role: "assistant" },
    ]);
  });

  it("flushes an unterminated trailing frame on end()", () => {
    const events: AguiEvent[] = [];
    const parser = createSseParser((event) => events.push(event));

    parser.push('data: {"type":"RUN_ERROR","message":"cut off"}');
    parser.end();

    expect(events).toEqual([{ type: "RUN_ERROR", message: "cut off" }]);
  });
});
