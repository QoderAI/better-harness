import { parseSavedRunRecord } from "../src/server/run-log.js";
import { describe, expect, it } from "vitest";
import { sessionFromRetainedRun } from "../src/server/debugger-session-transform.js";
import { defaultCursorForSession } from "../src/app/run/debugger-cursor.js";

describe("debugger session transform", () => {
  it("projects a saved run record into a real retained Evidence Cursor session", () => {
    const session = sessionFromRetainedRun({
      id: "run_fixture",
      savedAt: "2026-08-19T10:00:00.000Z",
      prompt: "Run the retained fixture",
      status: "finished",
      runId: "run_real",
      threadId: "thread_real",
      warnings: [],
      timeline: [
        { kind: "message", id: "m1", text: "I will inspect and test.", complete: true },
        { kind: "tool-call", id: "read-1", name: "Read", argsText: '{"path":"README.md"}', status: "completed", resultText: "# fixture" },
        { kind: "tool-call", id: "bash-1", name: "Bash", argsText: '{"command":"npm test"}', status: "failed", resultText: "1 failed" },
      ],
    });

    expect(session).toMatchObject({ id: "run_real", name: "Run the retained fixture", mode: "Retained run" });
    expect(session.events.map((event) => event.kind)).toEqual(["prompt", "response", "explore", "verify"]);
    expect(defaultCursorForSession(session)).toEqual({ eventId: "tool_bash-1" });
    expect(session.events[2]).toMatchObject({ title: "Read tool call", toolCalls: [expect.objectContaining({ resource: "README.md" })] });
    expect(session.events[3]).toMatchObject({
      title: "Bash tool call",
      validation: { command: "npm test", status: "failed" },
      stopConditions: ["tests", "failures"],
    });
  });
});


it("retains thought identity in saved records without treating it as a response stop", () => {
  const record = parseSavedRunRecord({
    id: "run_thought", savedAt: "2026-09-08T00:00:00Z", prompt: "Inspect", status: "finished", warnings: [],
    timeline: [{ kind: "message", id: "m1", role: "thought", text: "Inspecting", complete: true }],
  });
  expect(record.timeline[0]).toMatchObject({ role: "thought", text: "Inspecting" });
  const session = sessionFromRetainedRun(record);
  expect(session.events[1]).toMatchObject({ phase: "Thinking", title: "Agent thought", stopConditions: [] });
});
