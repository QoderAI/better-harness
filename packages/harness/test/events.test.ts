import { describe, expect, it } from "vitest";
import { compileHarness } from "../src/compiler/compile.js";
import type { HarnessIrBundle, HarnessRevision } from "../src/ir/index.js";
import { resolveHarness } from "../src/resolver/resolve.js";
import {
  HarnessRunEmitter,
  MAX_RETAINED_TOOL_RESULT_BYTES,
  type HarnessRunEvent,
} from "../src/exec/events.js";
import {
  applyQoderSdkMessage,
  createQoderSdkMessageMappingState,
  QoderSdkAdapter,
  QoderSdkExecutor,
  type QoderSdkLike,
} from "../src/exec/qoder-sdk.js";
import { PiSdkAdapter, PiSdkExecutor, type PiSdkLike } from "../src/exec/pi-sdk.js";

const SOURCE = `
  language 0.3
  skill require-tests {
    description "Do not report the task complete until tests prove it."
  }
  workflow single-pass {
    session coder
  }
  harness assembly {
    workflow single-pass
    agent coder {
      use skill require-tests
    }
  }
  runtime qoder { adapter "@harness/adapter-qoder" }
  runtime pi { adapter "@harness/adapter-pi" }
  deployment assembly-qoder { harness assembly runtime qoder }
  deployment assembly-pi { harness assembly runtime pi }
`;

async function resolveFor(runtimeId: string): Promise<{ bundle: HarnessIrBundle; revision: HarnessRevision }> {
  const { bundle } = await compileHarness(SOURCE);
  const adapter = runtimeId === "qoder" ? new QoderSdkAdapter() : new PiSdkAdapter();
  const { revision } = resolveHarness(bundle!, "assembly", runtimeId, { adapter: adapter.describe() });
  return { bundle: bundle!, revision: revision! };
}

function collect(): { events: HarnessRunEvent[]; emitter: HarnessRunEmitter } {
  const events: HarnessRunEvent[] = [];
  return { events, emitter: new HarnessRunEmitter((event) => events.push(event)) };
}

describe("HarnessRunEmitter lifecycle", () => {
  it("frames text into message boundaries and seals the run once", () => {
    const { events, emitter } = collect();

    emitter.start({ revisionId: "hr_1", host: "qoder" });
    emitter.text("Hello ");
    emitter.text("world");
    emitter.finish(0, { turns: 1 });
    emitter.text("after the end");
    emitter.finish(1);

    expect(events).toEqual([
      { type: "run-started", revisionId: "hr_1", host: "qoder" },
      { type: "message-started", messageId: "msg_1" },
      { type: "text-delta", messageId: "msg_1", text: "Hello " },
      { type: "text-delta", messageId: "msg_1", text: "world" },
      { type: "message-finished", messageId: "msg_1" },
      { type: "run-finished", exitCode: 0, metrics: { turns: 1 } },
    ]);
  });

  it("closes the open message before a tool call and pairs tool events", () => {
    const { events, emitter } = collect();

    emitter.start({ revisionId: "hr_1", host: "qoder" });
    emitter.text("Looking at the file.");
    emitter.toolCall("Read", { toolUseId: "tu_9", input: { path: "README.md" } });
    emitter.toolResult("tu_9", '{"bytes":42}', { messageId: "result_9" });
    emitter.toolCall("Bash");
    emitter.text("Done.");
    emitter.finish(0);

    expect(events.map((event) => event.type)).toEqual([
      "run-started",
      "message-started",
      "text-delta",
      "message-finished",
      "tool-call-started",
      "tool-call-finished",
      "tool-call-result",
      "tool-call-started",
      "tool-call-finished",
      "message-started",
      "text-delta",
      "message-finished",
      "run-finished",
    ]);
    expect(events[4]).toEqual({
      type: "tool-call-started",
      toolCallId: "tu_9",
      toolName: "Read",
      input: { path: "README.md" },
    });
    expect(events[6]).toEqual({
      type: "tool-call-result",
      toolCallId: "tu_9",
      messageId: "result_9",
      content: '{"bytes":42}',
    });
    expect(events[7]).toMatchObject({ type: "tool-call-started", toolCallId: "call_1", toolName: "Bash" });
    // The second message opens a fresh frame.
    expect(events[9]).toEqual({ type: "message-started", messageId: "msg_2" });
  });

  it("keeps run-error inside the running phase and drops pre-start activity", () => {
    const { events, emitter } = collect();

    emitter.text("ignored before start");
    emitter.error("ignored before start");
    emitter.start({ revisionId: "hr_1", host: "pi" });
    emitter.start({ revisionId: "hr_other", host: "pi" });
    emitter.text("partial");
    emitter.error("provider failed");
    emitter.finish(1);
    emitter.error("ignored after finish");

    expect(events).toEqual([
      { type: "run-started", revisionId: "hr_1", host: "pi" },
      { type: "message-started", messageId: "msg_1" },
      { type: "text-delta", messageId: "msg_1", text: "partial" },
      { type: "message-finished", messageId: "msg_1" },
      { type: "run-error", message: "provider failed" },
      { type: "run-finished", exitCode: 1 },
    ]);
  });

  it("never lets a throwing listener break the execution", () => {
    const emitter = new HarnessRunEmitter(() => {
      throw new Error("observer bug");
    });

    emitter.start({ revisionId: "hr_1", host: "qoder" });
    emitter.text("still fine");
    emitter.finish(0);

    expect(emitter.phase).toBe("finished");
  });

  it("bounds retained tool results and preserves failure metadata", () => {
    const { events, emitter } = collect();
    const result = "é".repeat(MAX_RETAINED_TOOL_RESULT_BYTES);
    emitter.start({ revisionId: "hr_1", host: "qoder" });
    emitter.toolCall("Bash", { toolUseId: "tu_1", input: { command: "exit 1" } });
    emitter.toolResult("tu_1", result, { messageId: "result_1", isError: true });
    emitter.finish(0);

    const retained = events.find((event) => event.type === "tool-call-result");
    expect(retained).toMatchObject({
      type: "tool-call-result",
      toolCallId: "tu_1",
      messageId: "result_1",
      isError: true,
      truncated: true,
      originalBytes: MAX_RETAINED_TOOL_RESULT_BYTES * 2,
    });
    expect(new TextEncoder().encode(retained?.content).byteLength).toBeLessThanOrEqual(
      MAX_RETAINED_TOOL_RESULT_BYTES + 2,
    );
  });
});

describe("applyQoderSdkMessage", () => {
  it("maps assistant text and tool_use blocks and ignores other messages", () => {
    const { events, emitter } = collect();
    emitter.start({ revisionId: "hr_1", host: "qoder" });

    applyQoderSdkMessage(emitter, { type: "system", subtype: "init" });
    applyQoderSdkMessage(emitter, {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Reading the repo." },
          { type: "tool_use", id: "tu_1", name: "Read", input: { path: "package.json" } },
        ],
      },
    });
    applyQoderSdkMessage(emitter, { type: "result", subtype: "success" });

    expect(events.slice(1)).toEqual([
      { type: "message-started", messageId: "msg_1" },
      { type: "text-delta", messageId: "msg_1", text: "Reading the repo." },
      { type: "message-finished", messageId: "msg_1" },
      { type: "tool-call-started", toolCallId: "tu_1", toolName: "Read", input: { path: "package.json" } },
      { type: "tool-call-finished", toolCallId: "tu_1" },
    ]);
  });

  it("emits partial text deltas in real time without replaying the final assistant text", () => {
    const { events, emitter } = collect();
    const state = createQoderSdkMessageMappingState();
    emitter.start({ revisionId: "hr_1", host: "qoder" });

    applyQoderSdkMessage(emitter, {
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "Read" } },
    }, state);
    applyQoderSdkMessage(emitter, {
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "ing." } },
    }, state);
    applyQoderSdkMessage(emitter, {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Reading." },
          { type: "tool_use", id: "tu_1", name: "Read", input: { path: "README.md" } },
        ],
      },
    }, state);

    expect(events.slice(1)).toEqual([
      { type: "message-started", messageId: "msg_1" },
      { type: "text-delta", messageId: "msg_1", text: "Read" },
      { type: "text-delta", messageId: "msg_1", text: "ing." },
      { type: "message-finished", messageId: "msg_1" },
      { type: "tool-call-started", toolCallId: "tu_1", toolName: "Read", input: { path: "README.md" } },
      { type: "tool-call-finished", toolCallId: "tu_1" },
    ]);
  });

  it("maps Qoder user tool_result blocks onto retained neutral results", () => {
    const { events, emitter } = collect();
    emitter.start({ revisionId: "hr_1", host: "qoder" });

    applyQoderSdkMessage(emitter, {
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "tu_1", name: "Read", input: { path: "README.md" } }],
      },
    });
    applyQoderSdkMessage(emitter, {
      type: "user",
      uuid: "result_1",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tu_1", content: { error: "not found" }, is_error: true }],
      },
    });

    expect(events.slice(1)).toEqual([
      { type: "tool-call-started", toolCallId: "tu_1", toolName: "Read", input: { path: "README.md" } },
      { type: "tool-call-finished", toolCallId: "tu_1" },
      {
        type: "tool-call-result",
        toolCallId: "tu_1",
        messageId: "result_1",
        content: '{"error":"not found"}',
        isError: true,
      },
    ]);
  });
});

describe("QoderSdkExecutor run events", () => {
  it("emits a well-formed lifecycle for a successful run", async () => {
    const { bundle, revision } = await resolveFor("qoder");
    const events: HarnessRunEvent[] = [];
    const sdk: QoderSdkLike = {
      qodercliAuth: () => ({}),
      query: async function* () {
        yield {
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "Inspecting." },
              { type: "tool_use", id: "tu_1", name: "Read", input: { path: "README.md" } },
            ],
          },
        };
        yield { type: "assistant", message: { content: [{ type: "text", text: "All good." }] } };
        yield { type: "result", subtype: "success", num_turns: 2 };
      },
    };

    const result = await new QoderSdkExecutor({
      loadSdk: async () => sdk,
      onRunEvent: (event) => events.push(event),
    }).execute(revision, bundle, { prompt: "Explain the repo" });

    expect(result.exitCode).toBe(0);
    expect(events[0]).toEqual({ type: "run-started", revisionId: revision.revisionId, host: "qoder" });
    expect(events.at(-1)).toEqual({ type: "run-finished", exitCode: 0, metrics: { turns: 2 } });
    expect(events.map((event) => event.type)).toEqual([
      "run-started",
      "message-started",
      "text-delta",
      "message-finished",
      "tool-call-started",
      "tool-call-finished",
      "message-started",
      "text-delta",
      "message-finished",
      "run-finished",
    ]);
  });

  it("redacts credential-shaped tool input before it reaches observers", async () => {
    const { bundle, revision } = await resolveFor("qoder");
    const events: HarnessRunEvent[] = [];
    const sdk: QoderSdkLike = {
      qodercliAuth: () => ({}),
      query: async function* () {
        yield {
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", id: "tu_1", name: "Fetch", input: { api_key: "must-not-leak" } },
            ],
          },
        };
        yield { type: "result", subtype: "success" };
      },
    };

    await new QoderSdkExecutor({
      loadSdk: async () => sdk,
      onRunEvent: (event) => events.push(event),
    }).execute(revision, bundle, { prompt: "Fetch" });

    expect(JSON.stringify(events)).not.toContain("must-not-leak");
    expect(events).toContainEqual({
      type: "tool-call-started",
      toolCallId: "tu_1",
      toolName: "Fetch",
      input: { api_key: "[REDACTED]" },
    });
  });

  it("reports run-error before run-finished on a failed run", async () => {
    const { bundle, revision } = await resolveFor("qoder");
    const events: HarnessRunEvent[] = [];
    const sdk: QoderSdkLike = {
      qodercliAuth: () => ({}),
      query: async function* () {
        yield { type: "assistant", message: { content: [{ type: "text", text: "partial" }] } };
        yield { type: "result", subtype: "error_during_execution", is_error: true, errors: ["auth failed"] };
      },
    };

    const result = await new QoderSdkExecutor({
      loadSdk: async () => sdk,
      onRunEvent: (event) => events.push(event),
    }).execute(revision, bundle, { prompt: "Fix" });

    expect(result.exitCode).toBe(1);
    expect(events.slice(-2)).toEqual([
      { type: "run-error", message: "auth failed" },
      { type: "run-finished", exitCode: 1, metrics: {} },
    ]);
  });

  it("still seals the lifecycle when the executor throws", async () => {
    const { bundle, revision } = await resolveFor("qoder");
    const events: HarnessRunEvent[] = [];
    const executor = new QoderSdkExecutor({
      loadSdk: async () => {
        throw new Error("simulated SDK load failure");
      },
      onRunEvent: (event) => events.push(event),
    });

    await expect(executor.execute(revision, bundle, { prompt: "Fix" })).rejects.toThrow();

    expect(events[0]).toMatchObject({ type: "run-started" });
    expect(events.at(-2)).toMatchObject({ type: "run-error" });
    expect(events.at(-1)).toEqual({ type: "run-finished", exitCode: 1 });
  });
});

describe("PiSdkExecutor run events", () => {
  it("frames streamed text deltas into one message", async () => {
    const { bundle, revision } = await resolveFor("pi");
    const events: HarnessRunEvent[] = [];
    let listener: ((event: { type?: string; assistantMessageEvent?: { type?: string; delta?: string } }) => void) | undefined;
    const stubSdk: PiSdkLike = {
      createAgentSession: async () => ({
        session: {
          prompt: async () => {
            listener?.({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "pi-" } });
            listener?.({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "response" } });
          },
          subscribe: (nextListener) => {
            listener = nextListener;
            return () => {
              listener = undefined;
            };
          },
        },
      }),
      SessionManager: { inMemory: () => ({}) },
      ModelRuntime: { create: async () => ({}) },
    };

    await new PiSdkExecutor({
      loadSdk: async () => stubSdk,
      onRunEvent: (event) => events.push(event),
    }).execute(revision, bundle, { prompt: "Fix" });

    expect(events).toEqual([
      { type: "run-started", revisionId: revision.revisionId, host: "pi" },
      { type: "message-started", messageId: "msg_1" },
      { type: "text-delta", messageId: "msg_1", text: "pi-" },
      { type: "text-delta", messageId: "msg_1", text: "response" },
      { type: "message-finished", messageId: "msg_1" },
      { type: "run-finished", exitCode: 0 },
    ]);
  });
});
