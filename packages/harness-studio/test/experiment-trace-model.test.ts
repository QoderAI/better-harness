import { describe, expect, it } from "vitest";
import {
  activityPhaseSequence,
  alignToolCalls,
  compareToolCalls,
  localToolChain,
  projectActivities,
  relatedCallFor,
  type ExperimentToolCall,
} from "../src/app/experiment-trace-model.js";

const call = (
  id: string,
  name: string,
  input: unknown,
  sequence: number,
  laneId = "a",
): ExperimentToolCall => ({
  laneId,
  runId: `${laneId}:1`,
  id,
  sequence,
  name,
  input,
  status: "completed",
});

describe("experiment tool trace correlation", () => {
  it("distinguishes exact arguments, a shared file, and a shared tool", () => {
    const read = call("a1", "Read", { path: "./README.md" }, 0);
    expect(compareToolCalls(read, call("b1", "Read", { path: "README.md" }, 0, "b")).relation)
      .toBe("same-resource");
    expect(compareToolCalls(read, call("b2", "Read", { path: "./README.md" }, 1, "b")).relation)
      .toBe("exact");
    expect(compareToolCalls(read, call("b3", "Read", { path: "package.json" }, 2, "b")).relation)
      .toBe("same-tool");
    expect(compareToolCalls(read, call("b4", "Bash", { command: "npm test" }, 3, "b")).relation)
      .toBe("none");
  });

  it("matches an imported absolute project path to a fresh lane relative path", () => {
    const history = call(
      "history-read",
      "Read",
      { file_path: "/Users/example/workspace/better-harness/packages/harness/src/compare/runner.ts" },
      0,
    );
    const fresh = call(
      "fresh-read",
      "Read",
      { path: "<trial-root>/packages/harness/src/compare/runner.ts" },
      0,
      "fresh",
    );

    expect(compareToolCalls(history, fresh)).toMatchObject({ relation: "same-resource" });
  });

  it("keeps repeated calls one-to-one and in sequence", () => {
    const source = [
      call("a1", "Read", { path: "README.md" }, 0),
      call("a2", "Read", { path: "README.md" }, 1),
    ];
    const target = [call("b1", "Read", { path: "README.md" }, 0, "b")];

    const aligned = alignToolCalls(source, target);

    expect(aligned.size).toBe(1);
    expect([...aligned.values()][0]?.call?.id).toBe("b1");
  });

  it("returns none rather than forcing an unrelated counterpart", () => {
    const source = [call("a1", "Read", { path: "README.md" }, 0)];
    const target = [call("b1", "Bash", { command: "npm test" }, 0, "b")];

    expect(relatedCallFor(source[0]!, source, target)).toMatchObject({ relation: "none", call: null });
  });

  it("shows one call of local context on either side", () => {
    const calls = [
      call("a1", "Read", { path: "README.md" }, 0),
      call("a2", "Edit", { path: "README.md" }, 1),
      call("a3", "Bash", { command: "npm test" }, 2),
      call("a4", "Read", { path: "package.json" }, 3),
    ];

    expect(localToolChain(calls, "a2").map((item) => item.id)).toEqual(["a1", "a2", "a3"]);
  });

  it("projects observable tool facts into compact engineering phases", () => {
    const calls = [
      call("a1", "Read", { path: "README.md" }, 0),
      call("a2", "Edit", { path: "README.md" }, 1),
      call("a3", "Bash", { command: "npm test" }, 2),
      call("a4", "Bash", { command: "git commit -m test" }, 3),
    ];

    expect(projectActivities(calls).map((item) => [item.phase, item.basis])).toEqual([
      ["Discover", "tool Read"],
      ["Change", "tool Edit"],
      ["Verify", "recorded verification command"],
      ["Deliver", "recorded delivery command"],
    ]);
    expect(activityPhaseSequence(calls)).toEqual(["Discover", "Change", "Verify", "Deliver"]);
  });

  it("labels a recorded failure and the next call without claiming intent", () => {
    const failed = { ...call("a1", "Bash", { command: "npm test" }, 0), status: "failed" as const };
    const retry = call("a2", "Bash", { command: "npm test" }, 1);

    expect(projectActivities([failed, retry])).toMatchObject([
      { phase: "Diagnose", basis: "recorded failed tool result" },
      { phase: "Recover", basis: "first recorded call after a failure" },
    ]);
  });
});
