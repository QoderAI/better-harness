import { describe, expect, it } from "vitest";
import { HarnessRunEmitter, runHarness, type HarnessRunEvent } from "../src/exec/index.js";

const SOURCE = `
  language 0.3
  skill answer { description "Answer the task." }
  workflow single-pass { session coder }
  harness sample {
    workflow single-pass
    agent coder { use skill answer }
  }
  runtime qoder { adapter "@harness/adapter-qoder" }
  deployment sample-qoder { harness sample runtime qoder }
`;

describe("runHarness", () => {
  it("owns one complete neutral lifecycle around an injected executor", async () => {
    const events: HarnessRunEvent[] = [];
    const result = await runHarness({
      source: SOURCE,
      prompt: "hello",
      threadId: "thread-1",
      runId: "run-1",
      onRunEvent: (event) => events.push(event),
      executorFactory: (context) => ({
        host: "qoder",
        async execute(revision, _bundle, task) {
          const emitter = new HarnessRunEmitter(context.onRunEvent);
          emitter.start({ revisionId: revision.revisionId, host: "qoder" });
          emitter.text(`echo: ${task.prompt}`);
          emitter.finish(0, { durationMs: 4 });
          return {
            host: "qoder",
            revisionId: revision.revisionId,
            exitCode: 0,
            output: "echo: hello",
            errorOutput: "",
            warnings: [],
            metrics: { durationMs: 4 },
          };
        },
      }),
    });

    expect(result.ok).toBe(true);
    expect(events.map((event) => event.type)).toEqual([
      "run-started",
      "message-started",
      "text-delta",
      "message-finished",
      "run-finished",
    ]);
  });

  it("emits a complete failure lifecycle before an executor exists", async () => {
    const events: HarnessRunEvent[] = [];
    const result = await runHarness({
      source: "not a Harness",
      prompt: "hello",
      threadId: "thread-1",
      runId: "run-1",
      onRunEvent: (event) => events.push(event),
      executorFactory: () => { throw new Error("must not construct"); },
    });

    expect(result.ok).toBe(false);
    expect(events.map((event) => event.type)).toEqual(["run-started", "run-error", "run-finished"]);
    expect(events.at(-1)).toEqual({ type: "run-finished", exitCode: 1 });
  });

  it("turns executor construction failures into a terminal run lifecycle", async () => {
    const events: HarnessRunEvent[] = [];
    const result = await runHarness({
      source: SOURCE,
      prompt: "hello",
      threadId: "thread-1",
      runId: "run-1",
      onRunEvent: (event) => events.push(event),
      executorFactory: () => { throw new Error("executor unavailable"); },
    });

    expect(result.ok).toBe(false);
    expect(events).toEqual([
      expect.objectContaining({ type: "run-started", host: "qoder" }),
      { type: "run-error", message: "executor unavailable" },
      { type: "run-finished", exitCode: 1 },
    ]);
  });

  it("reports a run as failed when an executor emits an error before a zero exit", async () => {
    const events: HarnessRunEvent[] = [];
    const result = await runHarness({
      source: SOURCE,
      prompt: "hello",
      threadId: "thread-1",
      runId: "run-1",
      onRunEvent: (event) => events.push(event),
      executorFactory: (context) => ({
        host: "qoder",
        async execute(revision) {
          context.onRunEvent({ type: "run-error", message: "protocol failed" });
          return {
            host: "qoder",
            revisionId: revision.revisionId,
            exitCode: 0,
            output: "",
            errorOutput: "",
            warnings: [],
          };
        },
      }),
    });

    expect(result.ok).toBe(false);
    expect(events.map((event) => event.type)).toEqual(["run-started", "run-error", "run-finished"]);
  });
});
