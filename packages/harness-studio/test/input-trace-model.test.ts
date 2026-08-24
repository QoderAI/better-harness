import { describe, expect, it } from "vitest";
import {
  buildUserInputFileTree,
  isUserInputTrace,
  projectUserInputTrace,
} from "../src/input-trace-model.js";

function report(): Record<string, unknown> {
  return {
    kind: "HarnessInspectorReportV1",
    workspace: { name: "better-harness" },
    sessions: [{
      sessionId: "session-1",
      platform: "Codex",
      dialogue: {
        truncated: false,
        turns: [{
          index: 1,
          prompt: { text: "Inspect the Studio server", timestamp: "2026-08-22T01:00:00.000Z" },
          steps: [
            { kind: "tool", callId: "read-1", operation: "read-files", filePaths: ["packages/harness-studio/src/server/server.ts"] },
            { kind: "tool", callId: "read-2", operation: "read-files", filePaths: ["packages/harness-studio/src/server/server.ts", "DESIGN.md"] },
            { kind: "tool", callId: "edit-1", operation: "edit-files", filePaths: ["packages/harness-studio/src/server/server.ts"] },
            { kind: "tool", callId: "shell-1", operation: "run-command", filePaths: ["package.json"] },
          ],
        }, {
          index: 2,
          prompt: { text: "Now show all inputs", timestamp: "2026-08-22T02:00:00.000Z" },
          steps: [],
        }],
      },
    }],
  };
}

describe("UserInputTraceV1", () => {
  it("projects exact retained Turn-to-file evidence without semantic inference", () => {
    const trace = projectUserInputTrace(report());

    expect(isUserInputTrace(trace)).toBe(true);
    expect(trace.inputs.map((input) => input.text)).toEqual(["Now show all inputs", "Inspect the Studio server"]);
    expect(trace.inputs[0]?.links).toEqual([]);
    expect(trace.inputs[1]?.links).toEqual([
      { path: "DESIGN.md", activity: "read", callIds: ["read-2"], callCount: 1 },
      { path: "packages/harness-studio/src/server/server.ts", activity: "edit-targeted", callIds: ["edit-1"], callCount: 1 },
      { path: "packages/harness-studio/src/server/server.ts", activity: "read", callIds: ["read-1", "read-2"], callCount: 2 },
    ]);
    expect(trace.summary).toEqual({
      inputCount: 2,
      linkedInputCount: 1,
      unlinkedInputCount: 1,
      readCount: 3,
      editTargetCount: 1,
      fileCount: 2,
      truncatedSessionCount: 0,
    });
  });

  it("builds a deterministic repository tree with inherited input counts", () => {
    const trace = projectUserInputTrace(report());
    const tree = buildUserInputFileTree(trace.inputs);

    expect(tree.map((node) => [node.name, node.kind])).toEqual([
      ["packages", "directory"],
      ["DESIGN.md", "file"],
    ]);
    expect(tree[0]).toMatchObject({ inputCount: 1, readCount: 2, editTargetCount: 1 });
    expect(tree[0]?.children[0]?.children[0]?.children[0]?.children[0]).toMatchObject({
      path: "packages/harness-studio/src/server/server.ts",
      kind: "file",
      inputCount: 1,
      readCount: 2,
      editTargetCount: 1,
    });
  });

  it("rejects absolute or escaping file evidence instead of leaking host paths", () => {
    const malformed = report();
    const session = (malformed.sessions as Array<Record<string, unknown>>)[0]!;
    const turns = ((session.dialogue as Record<string, unknown>).turns as Array<Record<string, unknown>>);
    turns[0]!.steps = [{ kind: "tool", operation: "read-files", filePaths: ["/Users/person/private.ts"] }];

    expect(() => projectUserInputTrace(malformed)).toThrow(/repository-relative paths/u);
  });
});
