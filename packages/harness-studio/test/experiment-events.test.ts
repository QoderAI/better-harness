import { describe, expect, it } from "vitest";
import { canonicalToolEvents, projectObservedCalls } from "../src/server/experiment/events.js";

describe("server experiment event projection", () => {
  it("projects assistant message frames without forwarding provider-owned fields", () => {
    expect(canonicalToolEvents({
      type: "text-delta",
      messageId: "message-1",
      text: "Working on it.",
      privatePayload: "must-not-cross-browser-boundary",
    })).toEqual([{ type: "assistant-text-delta", messageId: "message-1", text: "Working on it." }]);
    expect(canonicalToolEvents({ type: "message-started", messageId: "message-1" }))
      .toEqual([{ type: "assistant-message-started", messageId: "message-1" }]);
    expect(canonicalToolEvents({ type: "message-finished", messageId: "message-1" }))
      .toEqual([{ type: "assistant-message-finished", messageId: "message-1" }]);
  });

  it("normalizes ACP, Harness, and Anthropic tool shapes before browser delivery", () => {
    expect(canonicalToolEvents({
      type: "tool.requested",
      toolInvocationId: "acp-1",
      toolName: "Read",
      filePath: "src/a.ts",
    })).toEqual([{
      type: "tool-call-started",
      toolCallId: "acp-1",
      toolName: "Read",
      input: { file_path: "src/a.ts" },
    }]);
    expect(canonicalToolEvents({
      type: "tool-call-result",
      toolCallId: "native-1",
      isError: true,
    })).toEqual([{ type: "tool-call-result", toolCallId: "native-1", isError: true }]);
    expect(canonicalToolEvents({
      message: {
        content: [
          { type: "tool_use", id: "anthropic-1", name: "Edit", input: { path: "src/a.ts" } },
          { type: "tool_result", tool_use_id: "anthropic-1", content: "done" },
        ],
      },
      type: "message",
    })).toEqual([
      { type: "tool-call-started", toolCallId: "anthropic-1", toolName: "Edit", input: { path: "src/a.ts" } },
      { type: "tool-call-result", toolCallId: "anthropic-1", content: "done" },
    ]);
  });

  it("returns canonical calls rather than provider events for history preview", () => {
    expect(projectObservedCalls("history", [
      { type: "tool.requested", toolInvocationId: "call-1", toolName: "Read", filePath: "src/a.ts" },
      { type: "tool.execution.finished", toolInvocationId: "call-1" },
    ])).toEqual([expect.objectContaining({
      laneId: "history",
      id: "observed:history:call-1",
      name: "Read",
      input: { file_path: "src/a.ts" },
      status: "completed",
    })]);
  });

  it("projects ACP protocol facts and permission choices without forwarding arbitrary payload", () => {
    expect(canonicalToolEvents({
      type: "protocol-event",
      protocol: "acp",
      direction: "Agent → Client",
      method: "session/request_permission",
      rpcId: "permission-7",
      sessionId: "session-2",
      payload: {
        params: {
          toolCall: { toolCallId: "tool-9", title: "Read package.json", rawInput: "private" },
          options: [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }],
        },
        secret: "must-not-cross-browser-boundary",
      },
    })).toEqual([{
      type: "permission-requested",
      protocol: "acp",
      requestId: "permission-7",
      toolCallId: "tool-9",
      title: "Read package.json",
      sessionId: "session-2",
      options: [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }],
    }]);
    expect(canonicalToolEvents({
      type: "protocol-event",
      protocol: "acp",
      direction: "Client → Agent",
      method: "session/prompt",
      rpcId: "4",
      sessionId: "session-2",
      payload: { prompt: "private" },
    })).toEqual([{
      type: "protocol-observed",
      protocol: "acp",
      direction: "Client → Agent",
      method: "session/prompt",
      rpcId: "4",
      sessionId: "session-2",
    }]);
  });
});
