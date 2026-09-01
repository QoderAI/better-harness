import { describe, expect, it } from "vitest";
import { HARNESS_RUN_STREAM_EVENT_KIND, type HarnessRunStreamEventV1 } from "@qoder-ai/harness/protocol";
import type { HarnessRunEvent } from "@qoder-ai/harness/exec";
import {
  applyHarnessRunEvent,
  initialRunState,
  timelineItems,
  type HarnessRunState,
} from "../src/app/run/run-store.js";

function stream(events: HarnessRunEvent[], start = 1): HarnessRunStreamEventV1[] {
  return events.map((event, index) => ({
    kind: HARNESS_RUN_STREAM_EVENT_KIND,
    threadId: "thread-1",
    runId: "run-1",
    sequence: start + index,
    event,
  }));
}

function reduce(events: HarnessRunEvent[]): HarnessRunState {
  return stream(events).reduce(applyHarnessRunEvent, initialRunState());
}

describe("applyHarnessRunEvent", () => {
  it("folds messages and tool results without a protocol translation", () => {
    const state = reduce([
      { type: "run-started", revisionId: "sha256:one", host: "qoder" },
      { type: "message-started", messageId: "message-1" },
      { type: "text-delta", messageId: "message-1", text: "done" },
      { type: "message-finished", messageId: "message-1" },
      { type: "tool-call-started", toolCallId: "tool-1", toolName: "Read", input: { path: "a.ts" } },
      { type: "tool-call-finished", toolCallId: "tool-1" },
      { type: "tool-call-result", toolCallId: "tool-1", content: "ok", truncated: true, originalBytes: 70_000 },
      { type: "run-finished", exitCode: 0, metrics: { durationMs: 12 } },
    ]);

    expect(state.status).toBe("finished");
    expect(state.result).toEqual({ exitCode: 0, metrics: { durationMs: 12 } });
    expect(timelineItems(state)).toEqual([
      { kind: "message", id: "message-1", text: "done", complete: true },
      expect.objectContaining({
        kind: "tool-call",
        id: "tool-1",
        name: "Read",
        argsText: '{"path":"a.ts"}',
        status: "completed",
        resultText: "ok",
        resultTruncated: true,
        resultOriginalBytes: 70_000,
      }),
    ]);
  });

  it("preserves failure while retaining the final exit receipt", () => {
    const state = reduce([
      { type: "run-started", revisionId: "sha256:one", host: "qoder" },
      { type: "run-error", message: "failed" },
      { type: "run-finished", exitCode: 1, metrics: { durationMs: 8 } },
    ]);
    expect(state).toMatchObject({ status: "error", error: "failed", result: { exitCode: 1, metrics: { durationMs: 8 } } });
  });

  it("ignores replayed sequence numbers so deltas are idempotent", () => {
    const [started, message, delta] = stream([
      { type: "run-started", revisionId: "sha256:one", host: "qoder" },
      { type: "message-started", messageId: "message-1" },
      { type: "text-delta", messageId: "message-1", text: "once" },
    ]);
    let state = [started!, message!, delta!].reduce(applyHarnessRunEvent, initialRunState());
    state = applyHarnessRunEvent(state, delta!);
    expect(timelineItems(state)[0]).toMatchObject({ text: "once" });
  });

  it("projects ACP permission requests and resolutions from neutral protocol evidence", () => {
    const request: HarnessRunEvent = {
      type: "protocol-event",
      protocol: "acp",
      direction: "Agent → Client",
      method: "session/request_permission",
      rpcId: "permission-1",
      sessionId: "session-1",
      payload: { params: { sessionId: "session-1", toolCall: { toolCallId: "tool-1", title: "Read file" }, options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }] } },
    };
    let state = reduce([{ type: "run-started", revisionId: "sha256:one", host: "acp" }, request]);
    expect(state.pendingPermission).toMatchObject({ requestId: "permission-1", toolCallId: "tool-1" });
    state = applyHarnessRunEvent(state, stream([{
      type: "protocol-event",
      protocol: "acp",
      direction: "Client → Agent",
      method: "session/request_permission:response",
      rpcId: "permission-1",
      payload: {},
    }], 3)[0]!);
    expect(state.pendingPermission).toBeUndefined();
  });
});
