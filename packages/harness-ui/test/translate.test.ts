import { describe, expect, it } from "vitest";
import type { HarnessRunEvent } from "@qoder-ai/harness/exec";
import { createAguiTranslator } from "../src/translate.js";
import { decodeSseStream, encodeSseEvent } from "../src/sse.js";
import {
  HARNESS_PROTOCOL_EVENT,
  HARNESS_TOOL_RESULT_META_EVENT,
  latestUserPrompt,
  parseRunAgentInput,
  RunAgentInputError,
} from "../src/protocol.js";

function translateAll(events: HarnessRunEvent[]) {
  const translator = createAguiTranslator({ threadId: "thread-1", runId: "run-1" });
  return events.flatMap((event) => translator.translate(event));
}

describe("createAguiTranslator", () => {
  it("maps a framed successful run onto the AG-UI event sequence", () => {
    const agui = translateAll([
      { type: "run-started", revisionId: "hr_1", host: "qoder" },
      { type: "run-warning", message: "degraded to advisory" },
      { type: "message-started", messageId: "msg_1" },
      { type: "text-delta", messageId: "msg_1", text: "Reading." },
      { type: "message-finished", messageId: "msg_1" },
      { type: "tool-call-started", toolCallId: "tu_1", toolName: "Read", input: { path: "README.md" } },
      { type: "tool-call-finished", toolCallId: "tu_1" },
      { type: "tool-call-result", toolCallId: "tu_1", messageId: "result_1", content: '{"bytes":42}' },
      { type: "run-finished", exitCode: 0, metrics: { turns: 1 } },
    ]);

    expect(agui).toEqual([
      { type: "RUN_STARTED", threadId: "thread-1", runId: "run-1" },
      { type: "CUSTOM", name: "harness.warning", value: "degraded to advisory" },
      { type: "TEXT_MESSAGE_START", messageId: "run-1:msg_1", role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "run-1:msg_1", delta: "Reading." },
      { type: "TEXT_MESSAGE_END", messageId: "run-1:msg_1" },
      { type: "TOOL_CALL_START", toolCallId: "run-1:tu_1", toolCallName: "Read" },
      { type: "TOOL_CALL_ARGS", toolCallId: "run-1:tu_1", delta: '{"path":"README.md"}' },
      { type: "TOOL_CALL_END", toolCallId: "run-1:tu_1" },
      {
        type: "TOOL_CALL_RESULT",
        messageId: "run-1:result_1",
        toolCallId: "run-1:tu_1",
        content: '{"bytes":42}',
        role: "tool",
      },
      {
        type: "RUN_FINISHED",
        threadId: "thread-1",
        runId: "run-1",
        result: { exitCode: 0, metrics: { turns: 1 } },
      },
    ]);
  });

  it("terminates with RUN_ERROR and suppresses the trailing run-finished", () => {
    const agui = translateAll([
      { type: "run-started", revisionId: "hr_1", host: "qoder" },
      { type: "run-error", message: "auth failed" },
      { type: "run-finished", exitCode: 1 },
    ]);

    expect(agui).toEqual([
      { type: "RUN_STARTED", threadId: "thread-1", runId: "run-1" },
      { type: "RUN_ERROR", message: "auth failed" },
    ]);
  });

  it("emits no TOOL_CALL_ARGS for a tool call without input", () => {
    const agui = translateAll([
      { type: "run-started", revisionId: "hr_1", host: "qoder" },
      { type: "tool-call-started", toolCallId: "call_1", toolName: "Bash" },
      { type: "tool-call-finished", toolCallId: "call_1" },
    ]);

    expect(agui.map((event) => event.type)).toEqual(["RUN_STARTED", "TOOL_CALL_START", "TOOL_CALL_END"]);
  });

  it("carries failed and truncated tool-result metadata through a namespaced custom event", () => {
    const agui = translateAll([
      { type: "run-started", revisionId: "hr_1", host: "qoder" },
      { type: "tool-call-started", toolCallId: "tu_1", toolName: "Bash" },
      { type: "tool-call-finished", toolCallId: "tu_1" },
      {
        type: "tool-call-result",
        toolCallId: "tu_1",
        messageId: "result_1",
        content: "failed",
        isError: true,
        truncated: true,
        originalBytes: 90_000,
      },
    ]);

    expect(agui.slice(-2)).toEqual([
      {
        type: "TOOL_CALL_RESULT",
        messageId: "run-1:result_1",
        toolCallId: "run-1:tu_1",
        content: "failed",
        role: "tool",
      },
      {
        type: "CUSTOM",
        name: HARNESS_TOOL_RESULT_META_EVENT,
        value: {
          toolCallId: "run-1:tu_1",
          isError: true,
          truncated: true,
          originalBytes: 90_000,
        },
      },
    ]);
  });

  it("projects bounded ACP protocol evidence without synthesizing a second trace", () => {
    const agui = translateAll([
      { type: "run-started", revisionId: "hr_1", host: "acp" },
      {
        type: "protocol-event",
        protocol: "acp",
        direction: "Client → Agent",
        method: "initialize",
        rpcId: "1",
        payload: { jsonrpc: "2.0", id: 1, method: "initialize" },
      },
    ]);

    expect(agui.at(-1)).toEqual({
      type: "CUSTOM",
      name: HARNESS_PROTOCOL_EVENT,
      value: {
        protocol: "acp",
        direction: "Client → Agent",
        method: "initialize",
        rpcId: "1",
        payload: { jsonrpc: "2.0", id: 1, method: "initialize" },
      },
    });
  });

  it("namespaces message and tool ids by run and maps non-zero exits to RUN_ERROR", () => {
    const first = createAguiTranslator({ threadId: "shared-thread", runId: "run-a" });
    const second = createAguiTranslator({ threadId: "shared-thread", runId: "run-b" });
    const neutral: HarnessRunEvent[] = [
      { type: "text-delta", messageId: "msg_0", text: "ignored before start" },
      { type: "run-started", revisionId: "hr_1", host: "qoder" },
      { type: "message-started", messageId: "msg_1" },
      { type: "text-delta", messageId: "msg_1", text: "hello" },
      { type: "message-finished", messageId: "msg_1" },
      { type: "run-finished", exitCode: 2 },
    ];

    const firstEvents = neutral.flatMap((event) => first.translate(event));
    const secondEvents = neutral.flatMap((event) => second.translate(event));

    expect(firstEvents).toContainEqual(
      expect.objectContaining({ type: "TEXT_MESSAGE_START", messageId: "run-a:msg_1" }),
    );
    expect(secondEvents).toContainEqual(
      expect.objectContaining({ type: "TEXT_MESSAGE_START", messageId: "run-b:msg_1" }),
    );
    expect(firstEvents.at(-1)).toEqual({
      type: "RUN_ERROR",
      message: "Harness run failed with exit code 2.",
      code: "HARNESS_RUN_FAILED",
    });
  });
});

describe("SSE framing", () => {
  it("round-trips AG-UI events through encode and decode", () => {
    const events = translateAll([
      { type: "run-started", revisionId: "hr_1", host: "qoder" },
      { type: "message-started", messageId: "msg_1" },
      { type: "text-delta", messageId: "msg_1", text: "line one\nline two" },
      { type: "message-finished", messageId: "msg_1" },
      { type: "run-finished", exitCode: 0 },
    ]);

    const body = events.map(encodeSseEvent).join("");
    expect(decodeSseStream(body)).toEqual(events);
  });
});

describe("parseRunAgentInput", () => {
  it("accepts the minimum AG-UI run input and finds the latest user prompt", () => {
    const input = parseRunAgentInput({
      threadId: "t1",
      runId: "r1",
      messages: [
        { id: "m1", role: "user", content: "first" },
        { id: "m2", role: "assistant", content: "reply" },
        { id: "m3", role: "user", content: "latest ask" },
      ],
    });

    expect(input.threadId).toBe("t1");
    expect(latestUserPrompt(input)).toBe("latest ask");
  });

  it("rejects inputs without identifiers or with malformed messages", () => {
    expect(() => parseRunAgentInput(undefined)).toThrow(RunAgentInputError);
    expect(() => parseRunAgentInput({ runId: "r1" })).toThrow(/threadId/);
    expect(() => parseRunAgentInput({ threadId: "t1" })).toThrow(/runId/);
    expect(() => parseRunAgentInput({ threadId: "t1", runId: "r1", messages: [{}] })).toThrow(/role/);
  });
});
