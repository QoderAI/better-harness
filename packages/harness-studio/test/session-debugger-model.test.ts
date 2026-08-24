import { describe, expect, it } from "vitest";
import {
  cumulativeFileChanges,
  cursorForNode,
  DEFAULT_DEBUGGER_CURSOR,
  DEFAULT_STOP_CONDITIONS,
  defaultCursorForSession,
  eventForCursor,
  nextStopCursor,
  previousStateCursor,
  SAMPLE_DEBUGGER_SESSION,
  sessionFromRetainedRun,
  stepIntoCursor,
  stepOutCursor,
  stepOverCursor,
} from "../src/app/session-debugger-model.js";

describe("session debugger model", () => {
  it("projects the requested sample as semantic stages with one grouped exploration", () => {
    expect(SAMPLE_DEBUGGER_SESSION.name).toBe("优化 Replay UI");
    expect(SAMPLE_DEBUGGER_SESSION.events.map((event) => event.kind)).toEqual([
      "prompt",
      "plan",
      "explore",
      "change",
      "verify",
      "change",
      "verify",
      "response",
    ]);
    expect(SAMPLE_DEBUGGER_SESSION.events.find((event) => event.id === "explore")?.toolCalls).toHaveLength(9);
    expect(SAMPLE_DEBUGGER_SESSION.events.filter((event) => event.diff !== undefined)).toHaveLength(2);
    expect(SAMPLE_DEBUGGER_SESSION.events.filter((event) => event.validation?.status === "failed")).toHaveLength(1);
    expect(SAMPLE_DEBUGGER_SESSION.events.filter((event) => event.validation?.status === "passed")).toHaveLength(1);
  });

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

  it("continues only to events enabled by stop conditions", () => {
    expect(nextStopCursor(
      SAMPLE_DEBUGGER_SESSION,
      DEFAULT_DEBUGGER_CURSOR,
      DEFAULT_STOP_CONDITIONS,
    )).toEqual({ eventId: "test-failed" });

    expect(nextStopCursor(
      SAMPLE_DEBUGGER_SESSION,
      DEFAULT_DEBUGGER_CURSOR,
      { ...DEFAULT_STOP_CONDITIONS, failures: false, tests: false },
    )).toEqual({ eventId: "change-css" });

    expect(nextStopCursor(
      SAMPLE_DEBUGGER_SESSION,
      { eventId: "test-passed" },
      { changes: false, failures: false, permissions: false, tests: false, responses: true },
    )).toEqual({ eventId: "response" });
  });

  it("steps into, over, and out of a grouped tool-call sequence", () => {
    const into = stepIntoCursor(SAMPLE_DEBUGGER_SESSION, { eventId: "explore" });
    expect(into).toEqual({ eventId: "explore", toolCallId: "tool_read_workbench" });

    const over = stepOverCursor(SAMPLE_DEBUGGER_SESSION, into);
    expect(over).toEqual({ eventId: "explore", toolCallId: "tool_read_studio_css" });
    expect(stepOutCursor(over)).toEqual({ eventId: "explore" });
    expect(previousStateCursor(SAMPLE_DEBUGGER_SESSION, over)).toEqual(into);
  });

  it("resolves tree nodes and cumulative state without changing the workspace", () => {
    const toolCursor = cursorForNode(SAMPLE_DEBUGGER_SESSION, "tool_search_session");
    expect(toolCursor).toEqual({ eventId: "explore", toolCallId: "tool_search_session" });
    expect(eventForCursor(SAMPLE_DEBUGGER_SESSION, toolCursor!)).toMatchObject({ id: "explore", phase: "Explore" });

    expect(cumulativeFileChanges(SAMPLE_DEBUGGER_SESSION, { eventId: "test-passed" })).toEqual([
      expect.objectContaining({ path: "scripts/harness-inspector/ui/workbench.js", additions: 48, deletions: 21 }),
      expect.objectContaining({ path: "packages/harness-studio/src/app/index.html", additions: 14, deletions: 3 }),
    ]);
  });
});
