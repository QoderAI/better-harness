import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "vitest";

import activate, {
  buildRpcArgs,
  executeBetterHarness,
  parseReviewRequest,
  PI_RPC_FLAGS,
  runPiRpcLane,
} from "../extensions/pi/better-harness.ts";

function fakeChild({ result, malformed = false, pid = 7001 } = {}) {
  const child = new EventEmitter();
  child.pid = pid;
  child.killed = false;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    child.killed = true;
    queueMicrotask(() => child.emit("close", 0));
    return true;
  };
  child.stdin.on("data", () => {
    queueMicrotask(() => {
      const event = malformed
        ? "not-json\n"
        : [
            JSON.stringify({ type: "response", command: "prompt", success: true }),
            JSON.stringify({ type: "message_end", message: { content: [{ type: "text", text: JSON.stringify(result) }] } }),
            JSON.stringify({ type: "agent_end" }),
          ].join("\n") + "\n";
      child.stdout.write(event);
    });
  });
  return child;
}

test("Pi extension parses only bounded review flags", () => {
  assert.deepEqual(parseReviewRequest("--quick --language zh-CN inspect delivery"), {
    depth: "quick",
    language: "zh-CN",
    request: "inspect delivery",
  });
  assert.throws(() => parseReviewRequest("--shell rm -rf"), /unsupported \/better-harness option/u);
  assert.throws(() => parseReviewRequest("--language"), /requires a locale/u);
});

test("Pi RPC child receives safety flags and lane evidence only through stdin", async () => {
  const input = { bounded: true };
  const result = await runPiRpcLane({
    lane: "sessionEvidence",
    inputHash: "hash-session",
    input,
    cwd: process.cwd(),
    model: "openai/gpt-test",
    spawn: (file, args, options) => {
      assert.equal(file, "fake-pi");
      assert.deepEqual(args, [...PI_RPC_FLAGS, "--model", "openai/gpt-test"]);
      assert.equal(options.cwd, process.cwd());
      assert.equal(args.includes(JSON.stringify(input)), false);
      return fakeChild({
        pid: 7101,
        result: {
          lane: "sessionEvidence",
          contextId: "child-context-1",
          status: "completed",
          inputHash: "hash-session",
          output: { findingCount: 0 },
        },
      });
    },
    executable: "fake-pi",
  });

  assert.equal(result.lane, "sessionEvidence");
  assert.equal(result.pid, 7101);
  assert.equal(result.inputHash, "hash-session");
});

test("Pi RPC malformed JSON fails closed", async () => {
  await assert.rejects(
    runPiRpcLane({
      lane: "projectHarness",
      inputHash: "hash-project",
      input: {},
      cwd: process.cwd(),
      spawn: () => fakeChild({ malformed: true, pid: 7102 }),
    }),
    (error) => error.code === "RPC_MALFORMED_JSON",
  );
});

test("Pi command executes doctor, one prepare, three lanes, verify, and lead injection", async () => {
  const calls = [];
  const plan = {
    runId: "run-fixture",
    provider: "pi",
    depth: "quick",
    lead: { data: { summary: "lead" } },
    lanes: {
      sessionEvidence: { input: { lane: "session" }, inputHash: "h1" },
      projectHarness: { input: { lane: "project" }, inputHash: "h2" },
      agentCustomize: { input: { lane: "customize" }, inputHash: "h3" },
    },
  };
  const ctx = {
    cwd: process.cwd(),
    model: { provider: "openai", id: "gpt-test" },
    thinkingLevel: "high",
    signal: undefined,
    sessionManager: { getSessionId: () => "current-session" },
    ui: { notify: () => {} },
  };
  const result = await executeBetterHarness(ctx, "--quick review", {
    hostDoctor: async (options) => {
      calls.push(["doctor", options]);
      return { status: "pass", checks: [] };
    },
    prepareHostRun: async (options) => {
      calls.push(["prepare", options]);
      return { status: "partial", plan };
    },
    runPiSpecialists: async (receivedPlan, options) => {
      calls.push(["specialists", receivedPlan, options]);
      return ["sessionEvidence", "projectHarness", "agentCustomize"].map((lane, index) => ({
        lane,
        contextId: `ctx-${index}`,
        status: "completed",
        inputHash: `h${index + 1}`,
        output: { lane },
      }));
    },
    verifyHostRun: (receivedPlan, results) => {
      calls.push(["verify", receivedPlan, results]);
      return { ok: true, results, diagnostics: { confidence: "normal", errors: [] } };
    },
    sendMessage: async (message) => calls.push(["send", message]),
  });

  assert.equal(result.runId, "run-fixture");
  assert.deepEqual(calls.map(([kind]) => kind), ["doctor", "prepare", "specialists", "verify", "send"]);
  assert.match(calls.at(-1)[1], /three isolated lanes/u);
  assert.match(calls.at(-1)[1], /gpt-test/u);
  assert.equal(calls[0][1]["exclude-session-id"], "current-session");
});

test("Pi activation registers exactly one canonical command", () => {
  const registrations = [];
  activate({ registerCommand: (name, options) => registrations.push({ name, options }) });
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].name, "better-harness");
});
