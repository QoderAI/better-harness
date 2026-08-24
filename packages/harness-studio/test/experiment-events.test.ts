import { describe, expect, it } from "vitest";
import { canonicalToolEvents, projectObservedCalls } from "../src/server/experiment-events.js";

describe("server experiment event projection", () => {
  it("normalizes ACP, AG-UI, and Anthropic tool shapes before browser delivery", () => {
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
      toolCallId: "agui-1",
      isError: true,
    })).toEqual([{ type: "tool-call-result", toolCallId: "agui-1", isError: true }]);
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
});
