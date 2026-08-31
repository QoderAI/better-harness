import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { createAnalyzer } from "../../scripts/session-analysis.mjs";
import {
  mergeQoderAssistantContextIntoResponses,
  QoderSessionAnalyzer,
  workspaceToQoderSlug,
  workspaceToQoderSlugVariants,
} from "../../scripts/session-analysis/platforms/qoder.mjs";
import { buildSessionEfficiencySignal } from "../../scripts/session-analysis/session-efficiency.mjs";
import { buildUsageReviewPacket } from "../../scripts/session-analysis/usage-review-packet.mjs";
import { calculateExactModelCost } from "../../scripts/session-analysis/model-pricing.mjs";
import { detectPlanningSignals } from "../../scripts/session-analysis/planning-signals.mjs";
import { privacySafeUserInputSummary } from "../../scripts/session-analysis/privacy-safe-text.mjs";
import { isSessionAnalysisRef, sessionAnalysisRef } from "../../scripts/session-analysis/session-ref.mjs";
import { buildToolCallTrace } from "../../scripts/session-analysis/tool-call-trace.mjs";
import { summarizeSessionEvents } from "../../scripts/commit-session-link/index.mjs";

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeJsonl(filePath, rows) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

async function appendJsonl(filePath, rows) {
  const existing = await readFile(filePath, "utf8");
  await writeFile(filePath, `${existing}${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

test("session analysis refs are versioned, scoped, and non-reversible", () => {
  const first = sessionAnalysisRef({ sessionId: "private-session-id", platform: "qoder", workspace: "/workspace/a" });
  const repeated = sessionAnalysisRef({ sessionId: "private-session-id", platform: "qoder", workspace: "/workspace/a" });
  const otherWorkspace = sessionAnalysisRef({ sessionId: "private-session-id", platform: "qoder", workspace: "/workspace/b" });
  assert.equal(first, repeated);
  assert.notEqual(first, otherWorkspace);
  assert.equal(isSessionAnalysisRef(first), true);
  assert.equal(first.includes("private-session-id"), false);
  assert.equal(isSessionAnalysisRef("private-session-id"), false);
});

test("tool-call traces deduplicate lifecycles and keep only bounded privacy-safe chart facts", () => {
  const trace = buildToolCallTrace([
    { sessionId: "private-session", type: "PreToolUse", lifecyclePhase: "pre", toolInvocationId: "call-1", toolName: "Read", timestamp: "2026-08-10T10:00:00.000Z", filePath: "/Users/private/repo/secret.ts" },
    { sessionId: "private-session", type: "PostToolUse", lifecyclePhase: "post", toolInvocationId: "call-1", toolName: "Read", timestamp: "2026-08-10T10:00:01.000Z", success: true },
    { sessionId: "private-session", type: "PostToolUseFailure", lifecyclePhase: "post", toolInvocationId: "call-2", toolName: "Bash", timestamp: "2026-08-10T10:00:02.000Z", success: false, commandText: "token=private" },
    { sessionId: "private-session", type: "PostToolUse", lifecyclePhase: "post", toolInvocationId: "call-3", toolName: "mcp__github_issue", timestamp: "2026-08-10T10:00:03.000Z", success: true },
    { sessionId: "private-session", type: "PostToolUse", lifecyclePhase: "post", toolInvocationId: "call-4", toolName: "secret/path", timestamp: "2026-08-10T10:00:04.000Z", success: true },
    { sessionId: "private-session", type: "PostToolUse", lifecyclePhase: "post", toolInvocationId: "call-5", toolName: "Grep", timestamp: "2026-08-10T10:00:05.000Z", success: true },
  ], { limit: 4, laneLimit: 3 });

  assert.equal(trace.schemaVersion, 2);
  assert.equal(trace.totalCalls, 5);
  assert.equal(trace.shownCalls, 4);
  assert.equal(trace.truncated, true);
  assert.deepEqual(trace.calls.map((call) => call.step), [1, 2, 4, 5]);
  assert.equal(trace.calls.find((call) => call.step === 2)?.status, "failed");
  assert.deepEqual(trace.calls.find((call) => call.step === 1), {
    id: "T1",
    step: 1,
    toolName: "Read",
    status: "observed",
    // A wall-clock start lets the Inspector plot a call on a real time axis.
    startedAt: Date.parse("2026-08-10T10:00:00.000Z"),
    durationStatus: "observed",
    durationMs: 1000,
    timingSource: "lifecycle-pair",
  });
  assert.equal(trace.calls.find((call) => call.step === 2)?.durationStatus, "unobserved");
  assert.ok(trace.calls.every((call) => ["Read", "Bash", "Other tools"].includes(call.toolName)));
  assert.doesNotMatch(JSON.stringify(trace), /private-session|Users|secret|token/u);

  const singleLane = buildToolCallTrace([
    { toolName: "Read", timestamp: "2026-08-10T10:00:00.000Z" },
    { toolName: "Bash", timestamp: "2026-08-10T10:00:01.000Z" },
  ], { laneLimit: 1, limit: 200 });
  assert.deepEqual([...new Set(singleLane.calls.map((call) => call.toolName))], ["Other tools"]);
  assert.equal(singleLane.shownCalls, 2);
});

test("tool-call traces retain every call by default for horizontally scrollable charts", () => {
  const trace = buildToolCallTrace(Array.from({ length: 125 }, (_, index) => ({
    toolName: index % 2 === 0 ? "Read" : "Bash",
    timestamp: `2026-08-10T10:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
  })));

  assert.equal(trace.totalCalls, 125);
  assert.equal(trace.shownCalls, 125);
  assert.equal(trace.truncated, false);
  assert.equal(trace.calls.at(-1)?.step, 125);
});

test("Qoder transcript tool_use and tool_result items retain paired observed latency", () => {
  const analyzer = new QoderSessionAnalyzer();
  const sourceRef = {
    kind: "execution-transcript",
    path: "/private/session.jsonl",
    line: 1,
    planningScope: "workspace",
    sessionId: "private-session",
  };
  const requests = analyzer.normalizeEvents({
    type: "assistant",
    timestamp: "2026-08-10T10:00:00.000Z",
    cwd: "/workspace/project",
    message: {
      role: "assistant",
      content: [
        { type: "tool_use", id: "call-1", name: "Bash", input: { command: "private command" } },
        { type: "tool_use", id: "call-2", name: "Write", input: { file_path: "/workspace/project/private.ts" } },
      ],
    },
  }, sourceRef, { includeCommandText: true });
  const results = analyzer.normalizeEvents({
    type: "user",
    timestamp: "2026-08-10T10:00:04.250Z",
    cwd: "/workspace/project",
    message: {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "call-1", is_error: false, content: "private output" },
        { type: "tool_result", tool_use_id: "call-2", is_error: true, content: "private error" },
      ],
    },
  }, { ...sourceRef, line: 2 });

  assert.deepEqual(requests.filter((event) => event.lifecyclePhase === "request").map((event) => event.toolInvocationId), ["call-1", "call-2"]);
  assert.deepEqual(results.filter((event) => event.lifecyclePhase === "result").map((event) => event.toolInvocationId), ["call-1", "call-2"]);
  assert.equal(requests[0].toolName, undefined);
  assert.equal(results[0].toolInvocationId, undefined);

  const trace = buildToolCallTrace([...requests, ...results]);
  assert.deepEqual(trace.calls, [
    { id: "T1", step: 1, toolName: "Bash", status: "observed", startedAt: trace.calls[0].startedAt, durationStatus: "observed", durationMs: 4250, timingSource: "transcript-pair" },
    { id: "T2", step: 2, toolName: "Write", status: "failed", startedAt: trace.calls[1].startedAt, durationStatus: "observed", durationMs: 4250, timingSource: "transcript-pair" },
  ]);
  assert.doesNotMatch(JSON.stringify(trace), /private|workspace/u);
});

test("Qoder assistant content becomes dialogue text without transport JSON", () => {
  const analyzer = new QoderSessionAnalyzer();
  const sourceRef = {
    kind: "execution-transcript",
    path: "/private/session.jsonl",
    line: 1,
    planningScope: "workspace",
    sessionId: "private-session",
  };
  const mixed = analyzer.normalizeEvents({
    type: "assistant",
    timestamp: "2026-08-10T10:00:00.000Z",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Inspect the command owner first." },
        { type: "tool_use", id: "call-1", name: "Read", input: { file_path: "/private/package.json" } },
        { type: "text", text: "I found the public entry point." },
      ],
    },
  }, sourceRef, { includeContent: true, includeCommandText: true });

  assert.equal(mixed[0].content, "Inspect the command owner first.\nI found the public entry point.");
  assert.equal(mixed[0].content.includes("\"role\""), false);
  assert.equal(mixed[0].content.includes("tool_use"), false);
  assert.equal(mixed[1].lifecyclePhase, "request");
  assert.equal(mixed[1].toolName, "Read");

  const toolOnly = analyzer.normalizeEvents({
    type: "assistant",
    timestamp: "2026-08-10T10:01:00.000Z",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id: "call-2", name: "Bash", input: { command: "private command" } }],
    },
  }, { ...sourceRef, line: 2 }, { includeContent: true, includeCommandText: true });
  assert.equal(Object.hasOwn(toolOnly[0], "content"), false);
  assert.equal(toolOnly[1].toolName, "Bash");

  const unknown = analyzer.normalizeEvent({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "future_transport_item", payload: { private: true } }] },
  }, { ...sourceRef, line: 3 }, { includeContent: true });
  assert.equal(Object.hasOwn(unknown, "content"), false);
});

test("Codex function_call and function_call_output retain paired observed latency", async () => {
  const { CodexSessionAnalyzer } = await import("../../scripts/session-analysis/platforms/codex.mjs");
  const analyzer = new CodexSessionAnalyzer();
  const sourceRef = {
    kind: "codex-session-jsonl",
    path: "/private/session.jsonl",
    line: 1,
    planningScope: "workspace",
    sessionId: "private-codex-session",
  };
  const request = analyzer.normalizeEvent({
    type: "response_item",
    timestamp: "2026-08-11T00:00:00.000Z",
    payload: {
      type: "function_call",
      call_id: "call-private-1",
      name: "exec_command",
      arguments: JSON.stringify({ cmd: "private command" }),
    },
  }, sourceRef, { includeCommandText: true });
  const result = analyzer.normalizeEvent({
    type: "response_item",
    timestamp: "2026-08-11T00:00:02.500Z",
    payload: {
      type: "function_call_output",
      call_id: "call-private-1",
      output: "Script completed\nWall time 2.5 seconds\nOutput:\nprivate output",
    },
  }, { ...sourceRef, line: 2 });

  const trace = buildToolCallTrace([request, result]);

  assert.deepEqual(trace.calls, [{
    id: "T1",
    step: 1,
    toolName: "exec_command",
    status: "observed",
    startedAt: trace.calls[0].startedAt,
    durationStatus: "observed",
    durationMs: 2500,
    timingSource: "transcript-pair",
  }]);
  assert.doesNotMatch(JSON.stringify(trace), /private command|private output|private-codex-session/u);
});

test("planning signals detect user-issued spec commands without counting prose", () => {
  const invoked = detectPlanningSignals({
    type: "user",
    userText: "/spec draft the acceptance scenarios",
    evidenceRef: { kind: "session-event", id: "spec-command" },
  }, { platform: "qoder" });
  const prose = detectPlanningSignals({
    type: "user",
    userText: "This prose mentions /spec but does not invoke it.",
  }, { platform: "qoder" });
  const hostSpec = detectPlanningSignals({
    type: "user",
    userText: "Review .codex/specs/change.md before implementation.",
  }, { platform: "codex" });
  const bareSpecReview = detectPlanningSignals({
    type: "user",
    userText: "review the spec",
  }, { platform: "codex" });
  const chineseSpecReview = detectPlanningSignals({
    type: "user",
    userText: "规格评审",
  }, { platform: "qoder" });
  const story = detectPlanningSignals({
    type: "user",
    userText: "/story refine the acceptance criteria",
  }, { platform: "qoder" });
  const issue = detectPlanningSignals({
    type: "user",
    userText: "/issue-triage --label agent-ready",
  }, { platform: "qoder" });
  const assistantAlias = detectPlanningSignals({
    type: "assistant",
    userText: "/issue-triage --label agent-ready",
  }, { platform: "qoder" });
  const missingType = detectPlanningSignals({
    userText: "/spec-review the contract",
  }, { platform: "qoder" });
  const nearAliases = [
    ["/planning split the work", "/plan", "plan-command"],
    ["/spec-review the contract", "/spec", "spec-command"],
    ["/user-story refine checkout", "/story", "spec-command"],
  ].map(([userText, name, kind]) => ({
    signals: detectPlanningSignals({ type: "user", userText }, { platform: "qoder" }),
    name,
    kind,
  }));

  assert.ok(invoked.some((item) => item.kind === "spec-command" && item.name === "/spec"));
  assert.equal(prose.some((item) => item.kind === "spec-command"), false);
  assert.ok(hostSpec.some((item) => item.kind === "spec-reference"));
  assert.ok(bareSpecReview.some((item) => item.kind === "spec-reference"));
  assert.ok(chineseSpecReview.some((item) => item.kind === "spec-reference"));
  assert.ok(story.some((item) => item.kind === "spec-command" && item.name === "/story"));
  assert.ok(issue.some((item) => item.kind === "plan-command" && item.name === "/issue-*"));
  assert.equal(assistantAlias.length, 0);
  assert.equal(missingType.length, 0);
  assert.ok(nearAliases.every(({ signals, name, kind }) =>
    signals.some((item) => item.name === name && item.kind === kind)));
});

test("Qoder and Codex UserPromptSubmit adapters extract prompt fields as user demand", async () => {
  const sourceRef = {
    kind: "fixture-hook",
    path: "/private/hooks.jsonl",
    line: 1,
    planningScope: "workspace",
    sessionId: "private-session",
  };
  const qoder = new QoderSessionAnalyzer().normalizeEvent({
    type: "UserPromptSubmit",
    user_prompt: "/spec-review the contract",
    timestamp: "2026-07-15T08:00:00.000Z",
  }, sourceRef, { includeUserText: true });
  const { CodexSessionAnalyzer } = await import("../../scripts/session-analysis/platforms/codex.mjs");
  const codex = new CodexSessionAnalyzer().normalizeEvent({
    type: "UserPromptSubmit",
    payload: { prompt: "/story refine checkout" },
    timestamp: "2026-07-15T08:00:00.000Z",
  }, sourceRef, { includeUserText: true });

  assert.equal(qoder.userText, "/spec-review the contract");
  assert.equal(qoder.userPrompt, true);
  assert.equal(codex.userText, "/story refine checkout");
  assert.equal(codex.userPrompt, true);
  assert.ok(detectPlanningSignals(qoder, { platform: "qoder" })
    .some((item) => item.name === "/spec" && item.kind === "spec-command"));
  assert.ok(detectPlanningSignals(codex, { platform: "codex" })
    .some((item) => item.name === "/story" && item.kind === "spec-command"));
});

test("Qoder marks provider meta user records so request evidence can ignore them", () => {
  const sourceRef = {
    kind: "execution-transcript",
    path: "/private/session.jsonl",
    line: 1,
    planningScope: "workspace",
    sessionId: "private-session",
  };
  const event = new QoderSessionAnalyzer().normalizeEvent({
    type: "user",
    isMeta: true,
    message: { role: "user", content: "# Plugin Testing\n\nUse this workflow to verify a plugin." },
  }, sourceRef, { includeUserText: true });

  assert.equal(event.userPrompt, true);
  assert.equal(event.userInputMeta, true);
});

test("Qoder audit normalization maps post-tool action outcomes", () => {
  const analyzer = new QoderSessionAnalyzer();
  const sourceRef = {
    kind: "audit-jsonl",
    path: "/private/audit.jsonl",
    line: 1,
    planningScope: "workspace",
    sessionId: "private-session",
  };
  const passed = analyzer.normalizeEvent({
    _event: "PostToolUse",
    _action: "SUCCESS",
    tool_name: "Bash",
    tool_response: "agent-lint completed",
  }, sourceRef);
  const failed = analyzer.normalizeEvent({
    _event: "PostToolUse",
    _action: "FAILURE",
    tool_name: "Bash",
    tool_response: "agent-lint failed",
  }, { ...sourceRef, line: 2 });

  assert.equal(passed.lifecyclePhase, "post");
  assert.equal(passed.success, true);
  assert.equal(failed.lifecyclePhase, "post");
  assert.equal(failed.success, false);
});

test("Codex audit normalization preserves invocation, permission, and result facts", async () => {
  const { CodexSessionAnalyzer } = await import("../../scripts/session-analysis/platforms/codex.mjs");
  const analyzer = new CodexSessionAnalyzer();
  const sourceRef = {
    kind: "audit-jsonl",
    path: "/private/audit.jsonl",
    line: 1,
    planningScope: "workspace",
    sessionId: "private-session",
  };
  const before = analyzer.normalizeEvent({
    _event: "PreToolUse",
    _action: "ALLOWED",
    tool_name: "Bash",
    tool_use_id: "call-private-1",
    permission_mode: "bypassPermissions",
    protected_action: true,
    external_side_effect: true,
    permission_escalated: true,
    permission_boundary: "external-side-effect",
    cwd: "/workspace/project",
    timestamp: "2026-07-15T08:00:00.000Z",
  }, sourceRef);
  const after = analyzer.normalizeEvent({
    _event: "PostToolUse",
    _action: "SUCCESS",
    tool_name: "Bash",
    tool_use_id: "call-private-1",
    permission_mode: "bypassPermissions",
    payload: { protected_action: true, external_side_effect: true, permission_escalated: true },
    cwd: "/workspace/project",
    timestamp: "2026-07-15T08:00:01.000Z",
  }, { ...sourceRef, line: 2 });

  assert.equal(before.lifecyclePhase, "pre");
  assert.equal(before.toolInvocationId, "call-private-1");
  assert.equal(before.permissionDecision, "allowed");
  assert.equal(before.permissionMode, "bypassPermissions");
  assert.equal(before.protectedAction, true);
  assert.equal(before.externalSideEffect, true);
  assert.equal(before.permissionEscalated, true);
  assert.equal(before.permissionBoundary, "external-side-effect");
  assert.equal(after.lifecyclePhase, "post");
  assert.equal(after.toolInvocationId, "call-private-1");
  assert.equal(after.success, true);
  assert.equal(after.protectedAction, undefined);
  assert.equal(after.externalSideEffect, undefined);
  assert.equal(after.permissionEscalated, undefined);

  const request = analyzer.normalizeEvent({
    type: "response_item",
    payload: {
      type: "custom_tool_call",
      call_id: "call-private-2",
      name: "exec_command",
      input: JSON.stringify({ cmd: "node --test test/example.test.mjs" }),
    },
    timestamp: "2026-07-15T08:00:02.000Z",
  }, { ...sourceRef, kind: "codex-session-jsonl", line: 3 }, { includeCommandText: true });
  const result = analyzer.normalizeEvent({
    type: "response_item",
    payload: {
      type: "custom_tool_call_output",
      call_id: "call-private-2",
      output: [{ type: "text", text: "Script failed\nWall time 0.1 seconds\nOutput:\nTests: 2 failed, 5 passed, 7 total" }],
    },
    timestamp: "2026-07-15T08:00:03.000Z",
  }, { ...sourceRef, kind: "codex-session-jsonl", line: 4 });
  assert.equal(request.commandText, "node --test test/example.test.mjs");
  assert.equal(result.success, false);
  assert.deepEqual(result.resultFacts, { testsPassed: 5, testsFailed: 2 });
});

test("Qoder audit normalization preserves explicit permission boundary facts", () => {
  const analyzer = new QoderSessionAnalyzer();
  const event = analyzer.normalizeEvent({
    _event: "PreToolUse",
    _action: "ASKED",
    tool_name: "Bash",
    permission_mode: "default",
    data: {
      protectedAction: true,
      externalSideEffect: true,
      permissionEscalated: true,
      permissionBoundary: "protected-action",
    },
    timestamp: "2026-07-15T08:00:00.000Z",
  }, {
    kind: "audit-jsonl",
    path: "/private/audit.jsonl",
    line: 1,
    planningScope: "workspace",
    sessionId: "private-session",
  });

  assert.equal(event.permissionDecision, "asked");
  assert.equal(event.protectedAction, true);
  assert.equal(event.externalSideEffect, true);
  assert.equal(event.permissionEscalated, true);
  assert.equal(event.permissionBoundary, "protected-action");
});

test("Qoder and Codex normalize strong result summaries to the same numeric facts", async () => {
  const sourceRef = {
    kind: "fixture-session",
    path: "/private/session.jsonl",
    line: 1,
    planningScope: "workspace",
    sessionId: "private-session",
  };
  const qoder = new QoderSessionAnalyzer().normalizeEvent({
    type: "tool.execution.finished",
    timestamp: "2026-07-15T08:00:00.000Z",
    data: {
      tool_name: "Bash",
      tool_call_id: "private-call",
      status: "failed",
      output: "3 problems (3 errors, 0 warnings)",
    },
  }, sourceRef);
  const { CodexSessionAnalyzer } = await import("../../scripts/session-analysis/platforms/codex.mjs");
  const codex = new CodexSessionAnalyzer().normalizeEvent({
    type: "response_item",
    timestamp: "2026-07-15T08:00:00.000Z",
    payload: {
      type: "custom_tool_call_output",
      call_id: "private-call",
      output: "3 problems (3 errors, 0 warnings)",
      status: "failed",
    },
  }, sourceRef);

  assert.deepEqual(qoder.resultFacts, { errors: 3, warnings: 0 });
  assert.deepEqual(codex.resultFacts, qoder.resultFacts);
  assert.equal(qoder.success, false);
  assert.equal(codex.success, false);
});

test("Qoder and Codex preserve only explicit user-visible handoff and delivery facts", async () => {
  const sourceRef = {
    kind: "fixture-session",
    path: "/private/session.jsonl",
    line: 1,
    planningScope: "workspace",
    sessionId: "private-session",
  };
  const qoderAnalyzer = new QoderSessionAnalyzer();
  const { CodexSessionAnalyzer } = await import("../../scripts/session-analysis/platforms/codex.mjs");
  const codexAnalyzer = new CodexSessionAnalyzer();

  const qoderAssistant = qoderAnalyzer.normalizeEvent({
    type: "assistant",
    data: { taskCompleted: true, userCorrection: true },
    message: "done",
  }, sourceRef);
  const codexAssistant = codexAnalyzer.normalizeEvent({
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "done" }],
      taskCompleted: true,
      userCorrection: true,
    },
  }, sourceRef);
  const codexReasoning = codexAnalyzer.normalizeEvent({
    type: "event_msg",
    payload: { type: "agent_reasoning", text: "private reasoning" },
  }, sourceRef);
  const codexAgentMessage = codexAnalyzer.normalizeEvent({
    type: "event_msg",
    payload: { type: "agent_message", message: "done" },
  }, sourceRef);
  const codexDeveloper = codexAnalyzer.normalizeEvent({
    type: "response_item",
    payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "private developer context" }] },
  }, sourceRef, { includeContent: true });
  const codexUsage = codexAnalyzer.normalizeEvent({
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: 120,
          cached_input_tokens: 80,
          cache_write_input_tokens: 4,
          output_tokens: 30,
          reasoning_output_tokens: 8,
          total_tokens: 150,
        },
        last_token_usage: { input_tokens: 40, output_tokens: 10, total_tokens: 50 },
        model_context_window: 200,
      },
    },
  }, sourceRef);
  const qoderToolUseOnly = qoderAnalyzer.normalizeEvent({
    type: "assistant",
    stop_reason: "tool_use",
    content: [{ type: "tool_use", name: "Read", input: { file_path: "private" } }],
  }, sourceRef);

  for (const normalized of [qoderAssistant, codexAssistant]) {
    assert.equal(normalized.userVisibleAssistantMessage, true);
    assert.equal(normalized.taskCompleted, true);
    assert.equal(normalized.userCorrection, true);
  }
  assert.equal(codexReasoning.type, "reasoning");
  assert.equal(codexReasoning.userVisibleAssistantMessage, undefined);
  assert.equal(codexReasoning.content, undefined);
  assert.equal(codexReasoning.taskCompleted, undefined);
  assert.equal(codexReasoning.userCorrection, undefined);
  assert.equal(codexAgentMessage.userVisibleAssistantMessage, true);
  assert.equal(codexDeveloper.type, "context.developer");
  assert.equal(codexDeveloper.content, undefined);
  assert.deepEqual(codexDeveloper.contextLayers, [{ kind: "developer-message", itemCount: 1, aggregation: "sum" }]);
  assert.equal(codexUsage.usageCumulative, true);
  assert.equal(codexUsage.modelUsage.totalTokens, 150);
  assert.equal(codexUsage.modelUsage.cacheReadInputTokens, 80);
  assert.deepEqual(codexUsage.modelInvocationUsage, { inputTokens: 40, outputTokens: 10, totalTokens: 50 });
  assert.deepEqual(codexUsage.currentContextUsage, {
    usedTokens: 40,
    windowTokens: 200,
    basis: "prompt-tokens",
    source: "codex-rollout-token-count",
    rawTextOmitted: true,
  });
  assert.equal(qoderToolUseOnly.userVisibleAssistantMessage, undefined);
});

test("privacy-safe user input summaries skip injected context and redact private values", () => {
  const summary = privacySafeUserInputSummary([
    { type: "user", userText: "# AGENTS.md instructions for /Users/private/repo\n<environment_context>hidden</environment_context>" },
    {
      type: "user",
      userText: "# Files mentioned by the user:\n- /Users/private/repo/a.ts\n\n## My request for Codex:\nDiagnose /Users/private/repo and inspect @../private/repo/a.ts with api_key=super-secret and session:abc1234567\n\n--- Content from referenced files ---\nprivate attachment body",
    },
  ]);

  assert.equal(summary, "Diagnose <path> and inspect @<path> with api_key=<redacted> and <id>");

  const hostContextSummary = privacySafeUserInputSummary([
    {
      type: "user",
      userText: [
        "<recommended_plugins>",
        "- Private Plugin (private-plugin@internal)",
        "</recommended_plugins>",
        "<codex_internal_context source=\"goal\">hidden continuation state</codex_internal_context>",
        "Review the final parser change and explain the validation gap",
      ].join("\n"),
    },
  ]);
  assert.equal(hostContextSummary, "Review the final parser change and explain the validation gap");
  assert.equal(hostContextSummary.includes("Private Plugin"), false);
  assert.equal(hostContextSummary.includes("continuation state"), false);

  const desktopRequestSummary = privacySafeUserInputSummary([{
    type: "user",
    userText: "## Referenced chats with Codex:\n- hidden task metadata\n\n## My request:\nInspect the real Codex session data",
  }]);
  assert.equal(desktopRequestSummary, "Inspect the real Codex session data");
});

test("privacy-safe user input summaries redact GitLab tokens and hierarchical URL userinfo", () => {
  // secret-scan: allow synthetic provider-shaped regression fixture
  const gitlabToken = ["glpat", "AbCdEfGhIjKlMnOpQrStUvWx"].join("-");
  const tokenSummary = privacySafeUserInputSummary([{
    type: "user",
    userText: `Use ${gitlabToken}`,
  }]);

  assert.ok(tokenSummary);
  assert.doesNotMatch(tokenSummary, new RegExp(gitlabToken));

  const cases = [
    ["https://build-user:url-password-value@git.example.test/repo.git", ["build-user", "url-password-value"]],
    ["postgresql://db-user:db-password@db.example.test/database", ["db-user", "db-password"]],
    ["ssh://ssh-user:ssh-password@git.example.test/repo", ["ssh-user", "ssh-password"]],
    ["postgresql://db%2Duser:db%40password@db.example.test/database", ["db%2Duser", "db%40password"]],
    ["https://token-only-value@git.example.test/repo", ["token-only-value"]],
  ];
  for (const [url, credentials] of cases) {
    const summary = privacySafeUserInputSummary([{ type: "user", userText: `Fetch ${url}` }]);
    assert.ok(summary);
    assert.match(summary, /<redacted>@/u);
    for (const credential of credentials) assert.equal(summary.includes(credential), false);
  }
});

async function makeQoderFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-session-analysis-"));
  const workspace = path.join(root, "workspace", "better-harness");
  const home = path.join(root, ".qoder");
  const slug = workspaceToQoderSlug(workspace);
  const sessionId = "session-a";

  await writeJsonl(path.join(home, "audit", "audit.jsonl"), [
    {
      _event: "tool_use",
      _timestamp: "2026-06-18T10:00:00.000Z",
      cwd: workspace,
      session_id: sessionId,
      tool_name: "Bash",
      permission_mode: "default",
    },
  ]);

  await writeJson(path.join(home, "logs", "runs", "run-a", "manifest.json"), {
    run_id: "run-a",
    cwd: workspace,
    cli_version: "1.0.0",
    started_at: "2026-06-18T10:00:00.000Z",
  });

  await writeJsonl(
    path.join(
      home,
      "logs",
      "sessions",
      slug,
      sessionId,
      "segments",
      "2026-06-18T18-00-00-000+08-00-test-p1.jsonl",
    ),
    [
      {
        type: "tool.requested",
        ts: "2026-06-18T10:00:01.000Z",
        seq: 1,
        level: "info",
        data: { tool_name: "Bash", args: { command: "echo hidden" } },
      },
      {
        type: "hook.started",
        ts: "2026-06-18T10:00:02.000Z",
        seq: 2,
        level: "info",
        data: { hookEventName: "PostToolUse", command: "node hooks/post-tool.mjs --json --token hidden" },
      },
    ],
  );

  await writeJsonl(path.join(home, "projects", slug, `${sessionId}.jsonl`), [
    {
      type: "runtime-config",
      sessionId,
      timestamp: "2026-06-18T10:00:00.000Z",
      model: "qmodel_latest",
    },
    {
      type: "user",
      sessionId,
      timestamp: "2026-06-18T10:00:03.000Z",
      message: "please inspect this session",
    },
    {
      type: "assistant",
      sessionId,
      timestamp: "2026-06-18T10:00:04.000Z",
      message: "done",
    },
  ]);

  await writeJson(path.join(home, "projects", slug, sessionId, "state.json"), {
    sessionId,
    createdAt: "2026-06-18T10:00:00.000Z",
    updatedAt: "2026-06-18T10:00:05.000Z",
    items: [],
  });

  await writeJsonl(path.join(home, "projects", slug, "transcript", "session-a.execution.jsonl"), [
    {
      type: "user",
      sessionId,
      timestamp: "2026-06-18T10:00:06.000Z",
      cwd: workspace,
      message: "transcript message",
    },
  ]);

  return { root, home, workspace, slug, sessionId };
}

async function writeQoderConversation(home, slug, sessionId, rows) {
  await writeJsonl(path.join(home, "projects", slug, `${sessionId}.jsonl`), rows);
}

function timedConversation(sessionId, start, count, stepMinutes, messagePrefix) {
  const startMs = Date.parse(start);
  return Array.from({ length: count }, (_, index) => ({
    type: index % 2 === 0 ? "user" : "assistant",
    sessionId,
    timestamp: new Date(startMs + index * stepMinutes * 60_000).toISOString(),
    message: `${messagePrefix} ${index}`,
  }));
}

test("workspaceToQoderSlug matches Qoder workspace directory names", () => {
  assert.equal(
    workspaceToQoderSlug("/Users/example/workspace/better-harness"),
    "-Users-example-workspace-better-harness",
  );
});

test("Qoder workspace slugs cover both Windows directory conventions", () => {
  assert.deepEqual(
    workspaceToQoderSlugVariants(String.raw`e:\projects\xp-gate`),
    ["e--projects-xp-gate", "e-projects-xp-gate"],
  );
  assert.equal(workspaceToQoderSlug(String.raw`e:\projects\xp-gate`), "e--projects-xp-gate");
});

test("Qoder analyzer scans every existing Windows workspace slug variant", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-qoder-windows-slug-"));
  const home = path.join(root, ".qoder");
  const workspace = String.raw`e:\projects\xp-gate`;
  const workspaceSlugVariants = workspaceToQoderSlugVariants(workspace);
  const sessionId = "windows-session";
  const analyzer = new QoderSessionAnalyzer();

  try {
    for (const [index, slug] of workspaceSlugVariants.entries()) {
      await writeJsonl(
        path.join(
          home,
          "logs",
          "sessions",
          slug,
          sessionId,
          "segments",
          `2026-06-18T18-00-0${index}-000+08-00-test-p1.jsonl`,
        ),
        [{ type: "user", sessionId, timestamp: `2026-06-18T10:00:0${index}.000Z`, message: `log ${index}` }],
      );
      await writeJsonl(path.join(home, "projects", slug, `${sessionId}.jsonl`), [
        { type: "user", sessionId, timestamp: `2026-06-18T10:00:1${index}.000Z`, message: `project ${index}` },
      ]);
    }

    const scope = {
      platform: "qoder",
      workspace,
      workspaceSlug: workspaceSlugVariants[0],
      _workspaceSlugVariants: workspaceSlugVariants,
      home,
      since: null,
      sinceTime: null,
      until: null,
      untilTime: null,
      sessionId: null,
      includeCache: false,
      includeGlobalCapabilities: false,
    };
    const roots = await analyzer.discoverSourceRoots(scope);
    const sessions = await analyzer.discoverSessions(scope, roots);
    const session = sessions.find((candidate) => candidate.sessionId === sessionId);

    assert.equal(roots.find((candidate) => candidate.id === "qoder-log-sessions").exists, true);
    assert.equal(roots.find((candidate) => candidate.id === "qoder-projects").exists, true);
    assert.ok(session);
    assert.equal(session.sourceRefs.filter((ref) => ref.kind === "logs-session").length, 2);
    assert.equal(session.sourceRefs.filter((ref) => ref.kind === "project-jsonl").length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("root dispatcher keeps platform analyzers classified by adapter", async () => {
  assert.equal((await createAnalyzer("qoder")).constructor.name, "QoderSessionAnalyzer");
  assert.equal((await createAnalyzer("codex")).constructor.name, "CodexSessionAnalyzer");
});

test("Qoder analyzer discovers source roots and merges source coverage by session id", async () => {
  const fixture = await makeQoderFixture();
  const analyzer = new QoderSessionAnalyzer();

  try {
    const result = await analyzer.analyze({
      home: fixture.home,
      workspace: fixture.workspace,
      command: "sessions",
    });

    assert.equal(result.scope.workspaceSlug, fixture.slug);
    assert.equal(result.sources.find((source) => source.id === "qoder-home-sessions").exists, false);
    assert.equal(result.warnings.some((warning) => warning.source === "qoder-home-sessions"), true);

    const session = result.sessions.find((item) => item.sessionId === fixture.sessionId);
    assert.ok(session);
    assert.deepEqual(session.sourceKinds, [
      "audit-jsonl",
      "execution-transcript",
      "logs-session",
      "project-jsonl",
      "project-state",
    ]);
    assert.equal(session.coverage.audit, true);
    assert.equal(session.coverage.executionEvents, true);
    assert.equal(session.coverage.conversation, true);
    assert.equal(session.coverage.state, true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Qoder preserves host context ratio, real session window, and compaction boundaries", async () => {
  const fixture = await makeQoderFixture();
  const analyzer = new QoderSessionAnalyzer();
  await writeQoderConversation(fixture.home, fixture.slug, fixture.sessionId, [
    {
      type: "runtime-config",
      sessionId: fixture.sessionId,
      timestamp: "2026-06-18T10:00:00.000Z",
      contextWindow: 1_000_000,
    },
    {
      type: "assistant",
      sessionId: fixture.sessionId,
      timestamp: "2026-06-18T10:00:04.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          context_usage_ratio: 0.060373,
        },
      },
    },
    {
      type: "system",
      sessionId: fixture.sessionId,
      timestamp: "2026-06-18T10:00:05.000Z",
      compactMetadata: { preTokens: 147_770, postTokens: 2_431 },
    },
  ]);

  try {
    const scope = await analyzer.resolveScope({ home: fixture.home, workspace: fixture.workspace });
    const roots = await analyzer.discoverSourceRoots(scope);
    const sessions = await analyzer.discoverSessions(scope, roots);
    const session = sessions.find((candidate) => candidate.sessionId === fixture.sessionId);
    assert.ok(session);
    const events = await analyzer.readSession(session, scope);
    const response = events.find((event) => event.currentContextUsage?.percentFull !== undefined);
    assert.deepEqual(response?.currentContextUsage, {
      percentFull: 6.0373,
      basis: "host-context-ratio",
      source: "qoder-project-context-ratio",
      rawTextOmitted: true,
      usedTokens: 60_373,
      windowTokens: 1_000_000,
    });
    assert.equal(events.filter((event) => event.compactionBoundary === true).length, 1);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Qoder merges assistant context into one canonical model response (AC-23)", () => {
  const events = [
    {
      sessionId: "qoder-multi-lane",
      type: "model.response.completed",
      sourceKind: "logs-session",
      timestamp: "2026-08-28T06:30:23.930Z",
      model: "performance",
      stopReason: "tool_use",
      requestId: "request-1",
      modelInvocationUsage: { inputTokens: 0, outputTokens: 0 },
    },
    {
      sessionId: "qoder-multi-lane",
      type: "assistant",
      sourceKind: "project-jsonl",
      timestamp: "2026-08-28T06:30:23.933Z",
      model: "performance",
      stopReason: "tool_use",
      responseId: "response-1",
      currentContextUsage: {
        percentFull: 11.6,
        basis: "host-context-ratio",
        source: "qoder-project-context-ratio",
      },
    },
    {
      sessionId: "qoder-multi-lane",
      type: "model.response.completed",
      sourceKind: "logs-session",
      timestamp: "2026-08-28T06:30:24.000Z",
      model: "performance",
      stopReason: "end_turn",
      requestId: "request-2",
      modelInvocationUsage: { inputTokens: 0, outputTokens: 0 },
    },
    {
      sessionId: "qoder-multi-lane",
      type: "assistant",
      sourceKind: "project-jsonl",
      timestamp: "2026-08-28T06:30:24.001Z",
      model: "performance",
      stopReason: "tool_use",
      responseId: "unmatched-response",
      currentContextUsage: {
        percentFull: 12.5,
        basis: "host-context-ratio",
        source: "qoder-project-context-ratio",
      },
    },
  ];

  const merged = mergeQoderAssistantContextIntoResponses(events);
  const responses = merged.filter((event) => event.type === "model.response.completed");
  assert.equal(responses.length, 2);
  assert.equal(responses[0].currentContextUsage.percentFull, 11.6);
  assert.equal(Object.hasOwn(responses[1], "currentContextUsage"), false);
  assert.equal(merged[3].currentContextUsage.percentFull, 12.5);
  assert.equal(merged[1].responseId, "response-1");
  assert.equal(merged[1].usageProgressionExcluded, true);
  assert.equal(merged[3].usageProgressionExcluded, true);
});

test("Qoder workspace analysis excludes unrelated home-only sessions", async () => {
  const fixture = await makeQoderFixture();
  const analyzer = new QoderSessionAnalyzer();
  const unrelatedSessionId = "unrelated-home-only";
  const retainedHomePath = path.join(fixture.home, "sessions", `${fixture.sessionId}.jsonl`);
  const unrelatedHomePath = path.join(fixture.home, "sessions", `${unrelatedSessionId}.jsonl`);

  await writeJsonl(retainedHomePath, [
    {
      type: "tool.requested",
      sessionId: fixture.sessionId,
      timestamp: "2026-06-18T10:00:11.000Z",
      cwd: fixture.workspace,
      data: { tool_name: "Read", args: { file_path: "src/retained.ts" } },
    },
    {
      type: "model.response.completed",
      sessionId: fixture.sessionId,
      timestamp: "2026-06-18T10:00:12.000Z",
      cwd: fixture.workspace,
      model: "workspace-model",
      usage: { input_tokens: 10, output_tokens: 5 },
    },
    {
      type: "tool.requested",
      sessionId: fixture.sessionId,
      timestamp: "2026-06-18T10:00:13.000Z",
      data: { tool_name: "Read", args: { file_path: "src/linked-without-cwd.ts" } },
    },
  ]);
  await writeJsonl(unrelatedHomePath, [
    {
      type: "user",
      sessionId: unrelatedSessionId,
      timestamp: "2026-06-18T10:00:12.000Z",
      cwd: path.join(fixture.root, "other-workspace"),
      message: "/plan unrelated private project",
    },
    {
      type: "tool.requested",
      sessionId: unrelatedSessionId,
      timestamp: "2026-06-18T10:00:13.000Z",
      cwd: path.join(fixture.root, "other-workspace"),
      data: { tool_name: "Read", args: { file_path: "src/unrelated-secret.ts" } },
    },
    {
      type: "model.response.completed",
      sessionId: unrelatedSessionId,
      timestamp: "2026-06-18T10:00:14.000Z",
      cwd: path.join(fixture.root, "other-workspace"),
      model: "unrelated-model",
      usage: { input_tokens: 10, output_tokens: 5 },
    },
  ]);

  try {
    const sessions = await analyzer.analyze({
      home: fixture.home,
      workspace: fixture.workspace,
      command: "sessions",
    });
    assert.deepEqual(sessions.sessions.map((item) => item.sessionId), [fixture.sessionId]);
    assert.equal(
      sessions.sessions[0].sourceRefs.some((ref) => ref.kind === "home-session" && ref.path === retainedHomePath),
      true,
    );
    assert.equal(JSON.stringify(sessions).includes(unrelatedSessionId), false);

    const show = await analyzer.analyze({
      home: fixture.home,
      workspace: fixture.workspace,
      command: "show",
      "session-id": unrelatedSessionId,
      "include-events": true,
    });
    assert.equal(show.sessions.length, 0);

    const facets = await analyzer.analyze({
      home: fixture.home,
      workspace: fixture.workspace,
      command: "facets",
      limit: 10,
    });
    assert.equal(facets.sessions.some((session) => session.sessionId === unrelatedSessionId), false);
    assert.equal(facets.facets.sourceCoverage["home-session"], 1);
    assert.equal(facets.facets.topTools.some((item) => item.name === "Read"), true);
    assert.equal(facets.facets.planningSignals.some((item) => item.name === "/plan"), false);

    const insights = await analyzer.analyze({
      home: fixture.home,
      workspace: fixture.workspace,
      command: "insights",
      selection: "all-eligible",
      limit: 10,
    });
    assert.equal(JSON.stringify(insights).includes(unrelatedSessionId), false);
    assert.equal(insights.facets.topModels.some((item) => item.name === "unrelated-model"), false);
    assert.equal(insights.insights.keySignals.usageEfficiency.coverage.responseCount, 1);

    const fileReads = await analyzer.analyze({
      home: fixture.home,
      workspace: fixture.workspace,
      command: "file-reads",
      limit: 10,
    });
    assert.equal(JSON.stringify(fileReads.fileReads).includes("src/retained.ts"), true);
    assert.equal(JSON.stringify(fileReads.fileReads).includes("src/linked-without-cwd.ts"), true);
    assert.equal(JSON.stringify(fileReads.fileReads).includes("src/unrelated-secret.ts"), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Qoder home-session hydration filters foreign and unverified cwd-less records", async () => {
  const fixture = await makeQoderFixture();
  const analyzer = new QoderSessionAnalyzer();
  const sessionId = "mixed-home-session";
  const otherWorkspace = path.join(fixture.root, "other-workspace");

  await writeJsonl(path.join(fixture.home, "sessions", `${sessionId}.jsonl`), [
    {
      type: "user",
      sessionId,
      timestamp: "2026-06-18T10:00:00.000Z",
      cwd: fixture.workspace,
      message: "workspace request",
    },
    {
      type: "user",
      sessionId,
      timestamp: "2026-06-18T10:00:01.000Z",
      cwd: otherWorkspace,
      message: "foreign private request",
    },
    {
      type: "user",
      sessionId,
      timestamp: "2026-06-18T10:00:02.000Z",
      message: "unverified private request",
    },
  ]);

  try {
    const scope = await analyzer.resolveScope({
      home: fixture.home,
      workspace: fixture.workspace,
      command: "events",
      "session-id": sessionId,
    });
    const roots = await analyzer.discoverSourceRoots(scope);
    const sessions = await analyzer.discoverSessions(scope, roots);
    const session = sessions.find((candidate) => candidate.sessionId === sessionId);
    assert.ok(session);

    const events = await analyzer.readSession(session, scope, {
      includeContent: true,
      includeUserText: true,
    });
    assert.deepEqual(events.map((event) => event.userText), ["workspace request"]);
    assert.deepEqual(events.map((event) => event.cwd), [fixture.workspace]);
    assert.equal(JSON.stringify(events).includes("foreign private request"), false);
    assert.equal(JSON.stringify(events).includes("unverified private request"), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Qoder explicit global analysis retains home-only sessions as user-global", async () => {
  const fixture = await makeQoderFixture();
  const analyzer = new QoderSessionAnalyzer();
  const sessionId = "global-home-only";
  const otherWorkspace = path.join(fixture.root, "other-workspace");

  await writeJsonl(path.join(fixture.home, "sessions", `${sessionId}.jsonl`), [
    {
      type: "user",
      sessionId,
      timestamp: "2026-06-18T10:00:00.000Z",
      cwd: otherWorkspace,
      message: "explicit global request",
    },
    {
      type: "user",
      sessionId,
      timestamp: "2026-06-18T10:00:01.000Z",
      message: "global request without cwd",
    },
  ]);

  try {
    const defaultResult = await analyzer.analyze({
      home: fixture.home,
      workspace: fixture.workspace,
      command: "sessions",
    });
    assert.equal(defaultResult.sessions.some((session) => session.sessionId === sessionId), false);

    const scope = await analyzer.resolveScope({
      home: fixture.home,
      workspace: fixture.workspace,
      command: "events",
      "session-id": sessionId,
      includeGlobalCapabilities: true,
    });
    const roots = await analyzer.discoverSourceRoots(scope);
    const sessions = await analyzer.discoverSessions(scope, roots);
    const session = sessions.find((candidate) => candidate.sessionId === sessionId);
    assert.ok(session);
    assert.equal(session.sourceRefs.find((ref) => ref.kind === "home-session")?.planningScope, "user-global");

    const events = await analyzer.readSession(session, scope, {
      includeContent: true,
      includeUserText: true,
    });
    assert.deepEqual(events.map((event) => event.userText), [
      "explicit global request",
      "global request without cwd",
    ]);
    assert.equal(events.every((event) => event.planningScope === "user-global"), true);
    assert.equal(events[0].cwd, otherWorkspace);
    assert.equal(Object.hasOwn(events[1], "cwd"), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Qoder facts route returns only a compact privacy-safe envelope", async () => {
  const fixture = await makeQoderFixture();
  const analyzer = new QoderSessionAnalyzer();

  await writeJsonl(path.join(fixture.home, "sessions", "foreign-session.jsonl"), [
    {
      type: "user",
      sessionId: "foreign-session",
      timestamp: "2026-06-18T10:00:00.000Z",
      message: "foreign private request",
    },
  ]);
  await writeJsonl(path.join(
    fixture.home,
    "logs",
    "sessions",
    fixture.slug,
    fixture.sessionId,
    "segments",
    "2026-06-18T18-00-30-000+08-00-core-facts.jsonl",
  ), [
    {
      type: "tool.requested",
      ts: "2026-06-18T10:00:07.000Z",
      data: {
        tool_name: "Write",
        tool_call_id: "edit-private",
        args: { file_path: "src/private-file.ts", content: "private source" },
      },
    },
    {
      type: "tool.execution.finished",
      ts: "2026-06-18T10:00:08.000Z",
      data: { tool_name: "Write", tool_call_id: "edit-private", success: true, output: "ok" },
    },
    {
      type: "tool.requested",
      ts: "2026-06-18T10:00:09.000Z",
      data: {
        tool_name: "Bash",
        tool_call_id: "lint-private",
        args: { command: "npm run lint -- --secret private-value" },
      },
    },
    {
      type: "tool.execution.finished",
      ts: "2026-06-18T10:00:10.000Z",
      data: {
        tool_name: "Bash",
        tool_call_id: "lint-private",
        status: "failed",
        output: "3 problems (3 errors, 0 warnings)",
      },
    },
  ]);

  try {
    const result = await analyzer.analyze({
      home: fixture.home,
      workspace: fixture.workspace,
      command: "facts",
      limit: 3,
      "exclude-active-window-ms": 0,
    });

    assert.equal(result.kind, "session-core-facts");
    assert.equal(result.schemaVersion, 3);
    assert.equal(result.scope.platform, "qoder");
    assert.equal(result.candidateSelection.strategy, "agent-work-loop-portfolio-v1");
    assert.equal(result.candidateSelection.emittedClasses["validation-repair"], 1);
    assert.equal(result.candidates.length <= 3, true);
    assert.equal(result.omitted.homeSessionOnly, 0);
    assert.equal(result.cost.serializedBytes <= 8_192, true);
    assert.equal(result.cost.estimatedTokens <= 2_000, true);
    assert.deepEqual(result.candidates[0].changes, { edits: 1, files: 1 });
    assert.deepEqual(result.candidates[0].checks, [{
      kind: "lint",
      status: "failed",
      relation: "after-final-change-unreviewed",
      counts: { errors: 3, warnings: 0 },
      countQuality: "parsed",
    }]);
    assert.equal(result.candidates[0].closure, "check-observed-relevance-unresolved");
    assert.equal("sessions" in result, false);
    assert.equal("facets" in result, false);
    assert.equal("insights" in result, false);
    assert.equal("cards" in result, false);
    assert.equal(JSON.stringify(result).includes("foreign private request"), false);
    assert.equal(JSON.stringify(result).includes(fixture.workspace), false);

    const debugResult = await analyzer.analyze({
      home: fixture.home,
      workspace: fixture.workspace,
      command: "facts",
      limit: 3,
      debug: true,
      "exclude-active-window-ms": 0,
    });
    assert.equal(debugResult.debug.privacy, "local-operator-only");
    assert.deepEqual(debugResult.debug.locators[0].sessionIds, [fixture.sessionId]);
    assert.equal(debugResult.excludes.includes("rawIds"), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Qoder sessions command honors explicit limit", async () => {
  const fixture = await makeQoderFixture();
  const analyzer = new QoderSessionAnalyzer();

  try {
    const result = await analyzer.analyze({
      home: fixture.home,
      workspace: fixture.workspace,
      command: "sessions",
      limit: 0,
    });

    assert.equal(result.sessions.length, 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Qoder analyzer reads normalized events with traceable evidence refs", async () => {
  const fixture = await makeQoderFixture();
  const analyzer = new QoderSessionAnalyzer();

  try {
    const index = await analyzer.analyze({
      home: fixture.home,
      workspace: fixture.workspace,
      command: "sessions",
    });
    const scope = await analyzer.resolveScope({ home: fixture.home, workspace: fixture.workspace });
    const session = index.sessions.find((item) => item.sessionId === fixture.sessionId);
    const events = await analyzer.readSession(session, scope);
    const merged = analyzer.mergeSession(events, session);

    assert.equal(merged.eventCounts["tool.requested"], 1);
    assert.equal(merged.eventCounts["hook.started"], 1);
    assert.equal(merged.messageCounts.user, 2);

    const toolEvent = events.find((event) => event.type === "tool.requested");
    assert.equal(toolEvent.toolName, "Bash");
    assert.equal(toolEvent.evidenceRef.kind, "logs-session");
    assert.ok(toolEvent.evidenceRef.path.endsWith(".jsonl"));
    assert.equal("content" in toolEvent, false);

    const hookEvent = events.find((event) => event.type === "hook.started");
    assert.equal(hookEvent.hookName, "PostToolUse");
    assert.equal(hookEvent.hookCommand, "node hooks/post-tool.mjs");
    assert.equal("commandText" in hookEvent, false);

    const diagnosticEvents = await analyzer.readSession(session, scope, {
      "include-command-text": true,
      "include-user-text": true,
    });
    assert.ok(diagnosticEvents.some((event) => event.commandText === "echo hidden"));
    assert.ok(diagnosticEvents.some((event) => event.userText === "please inspect this session"));

    const contentEvents = await analyzer.readSession(session, scope, { includeContent: true });
    assert.equal(contentEvents.some((event) => event.content === "please inspect this session"), true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Qoder hook runtime counts finishes once and keeps parallel latency at group level", async () => {
  const fixture = await makeQoderFixture();
  const analyzer = new QoderSessionAnalyzer();
  const segmentPath = path.join(
    fixture.home,
    "logs",
    "sessions",
    fixture.slug,
    fixture.sessionId,
    "segments",
    "2026-06-18T18-00-20-000+08-00-hooks.jsonl",
  );
  const rows = [];
  for (let index = 0; index < 5; index += 1) {
    rows.push({
      type: "hook.started",
      ts: `2026-06-18T10:01:0${index}.000Z`,
      seq: 10 + index,
      data: {
        hookEventName: "PreToolUse",
        source: ".qoder/settings.json",
        index: 0,
        command: "node hooks/pre-tool.mjs --secret hidden",
      },
    });
    rows.push({
      type: "hook.finished",
      ts: `2026-06-18T10:01:0${index}.700Z`,
      seq: 20 + index,
      data: {
        hookEventName: "PreToolUse",
        source: ".qoder/settings.json",
        index: 0,
        duration_ms: 700,
        success: true,
      },
    });
  }
  rows.push(
    {
      type: "hook.started",
      ts: "2026-06-18T10:02:00.000Z",
      seq: 40,
      data: { hookEventName: "Stop", source: "hooks.json", index: 0, command: "node hooks/stop-a.mjs" },
    },
    {
      type: "hook.started",
      ts: "2026-06-18T10:02:00.010Z",
      seq: 41,
      data: { hookEventName: "Stop", source: "hooks.json", index: 1, command: "node hooks/stop-b.mjs" },
    },
    {
      type: "hook.finished",
      ts: "2026-06-18T10:02:03.000Z",
      seq: 42,
      data: { hookEventName: "Stop", duration_ms: 3000, success: true },
    },
    {
      type: "hook.finished",
      ts: "2026-06-18T10:02:03.500Z",
      seq: 43,
      data: { hookEventName: "Stop", duration_ms: 3500, success: false },
    },
  );
  await writeJsonl(segmentPath, rows);

  try {
    const result = await analyzer.analyze({
      home: fixture.home,
      workspace: fixture.workspace,
      command: "facets",
      limit: 10,
    });
    const runtime = result.facets.hookRuntime;
    const preGroup = runtime.groups.find((item) => item.name === "PreToolUse");
    const preCommand = runtime.commands.find((item) => item.name === "PreToolUse -> node hooks/pre-tool.mjs");
    const stopGroup = runtime.groups.find((item) => item.name === "Stop");

    assert.equal(runtime.finishedExecutions, 7);
    assert.equal(runtime.ambiguousCompletions, 2);
    assert.equal(preGroup.executions, 5);
    assert.equal(preGroup.p95Ms, 700);
    assert.equal(preCommand.executions, 5);
    assert.equal(preCommand.durationSamples, 5);
    assert.equal(stopGroup.executions, 2);
    assert.equal(stopGroup.failures, 1);
    assert.equal(runtime.commands.some((item) => item.name.includes("stop-a")), false);
    assert.equal(runtime.commands.some((item) => item.name.includes("stop-b")), false);
    assert.equal(result.facets.topHooks.find((item) => item.name === "PreToolUse")?.count, 5);
    assert.equal(result.facets.topHooks.find((item) => item.name === "Stop")?.count, 2);
    assert.equal(result.facets.topHookCommands.find((item) => item.name === "PreToolUse -> node hooks/pre-tool.mjs")?.count, 5);

    const scope = await analyzer.resolveScope({ home: fixture.home, workspace: fixture.workspace });
    const indexed = await analyzer.analyze({ home: fixture.home, workspace: fixture.workspace, command: "sessions" });
    const session = indexed.sessions.find((item) => item.sessionId === fixture.sessionId);
    const events = await analyzer.readSession(session, scope);
    const finished = events.find((event) => event.type === "hook.finished" && event.hookDurationMs === 700);
    assert.equal(finished.hookSource, ".qoder/settings.json");
    assert.equal(finished.hookIndex, 0);
    assert.equal(finished.success, true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Qoder audit lifecycle records do not masquerade as configured hook scripts", async () => {
  const fixture = await makeQoderFixture();
  const analyzer = new QoderSessionAnalyzer();
  await appendJsonl(path.join(fixture.home, "audit", "audit.jsonl"), [
    {
      _event: "PreToolUse",
      _timestamp: "2026-06-18T10:00:07.000Z",
      cwd: fixture.workspace,
      session_id: fixture.sessionId,
      tool_name: "Bash",
      request_set_id: "request-1",
      tool_input: { command: "npm test" },
    },
    {
      _event: "PostToolUse",
      _timestamp: "2026-06-18T10:00:08.000Z",
      cwd: fixture.workspace,
      session_id: fixture.sessionId,
      tool_name: "Bash",
      request_set_id: "request-1",
      tool_input: { command: "npm test" },
    },
  ]);

  try {
    const result = await analyzer.analyze({ home: fixture.home, workspace: fixture.workspace, command: "insights", limit: 10 });
    assert.equal(result.facets.topHooks.some((item) => item.name === "PreToolUse"), false);
    assert.equal(result.facets.topHookCommands.some((item) => item.name.startsWith("PreToolUse ->")), false);
    assert.equal(result.insights.keySignals.validation.commandMatches.find((item) => item.name === "npm test")?.count, 1);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Qoder insights summarize validation and friction without raw commands", async () => {
  const fixture = await makeQoderFixture();
  const analyzer = new QoderSessionAnalyzer();
  const segmentPath = path.join(
    fixture.home,
    "logs",
    "sessions",
    fixture.slug,
    fixture.sessionId,
    "segments",
    "2026-06-18T18-00-10-000+08-00-test-p2.jsonl",
  );

  await writeJsonl(segmentPath, [
    {
      type: "hook.started",
      ts: "2026-06-18T10:00:08.000Z",
      seq: 1,
      level: "info",
      data: {
        hookEventName: "PreToolUse",
        command: '"C:\\Program Files\\node.exe" hooks\\pre-tool.mjs --token hidden',
      },
    },
    {
      type: "tool.requested",
      ts: "2026-06-18T10:00:09.000Z",
      seq: 2,
      level: "info",
      data: { tool_name: "Write", args: { file_path: "src/example.js", content: "hidden edit content" } },
    },
    {
      type: "tool.requested",
      ts: "2026-06-18T10:00:10.000Z",
      seq: 3,
      level: "info",
      data: { tool_name: "Bash", args: { command: "npm test -- --secret-token=hidden" } },
    },
    {
      type: "tool.requested",
      ts: "2026-06-18T10:00:10.500Z",
      seq: 31,
      level: "info",
      data: {
        tool_name: "Skill",
        args: {
          skill: "better-harness-plugin:readiness-analysis",
          args: "hidden prompt text",
        },
      },
    },
    {
      type: "tool.requested",
      ts: "2026-06-18T10:00:10.600Z",
      seq: 33,
      level: "info",
      data: {
        tool_name: "Skill",
        args: {
          skill: "better-harness-plugin:harness",
          args: "hidden prompt text",
        },
      },
    },
    {
      type: "tool.requested",
      ts: "2026-06-18T10:00:10.700Z",
      seq: 34,
      level: "info",
      data: {
        tool_name: "Skill",
        args: {
          skill: "harness",
          args: "hidden prompt text",
        },
      },
    },
    {
      type: "tool.execution.finished",
      ts: "2026-06-18T10:00:10.750Z",
      seq: 32,
      level: "info",
      data: { tool_name: "Skill", status: "success" },
    },
    {
      type: "tool.execution.finished",
      ts: "2026-06-18T10:00:11.000Z",
      seq: 4,
      level: "error",
      data: { tool_name: "Bash", success: false, error: "hidden failure detail" },
    },
    {
      type: "hook.started",
      ts: "2026-06-18T10:00:12.000Z",
      seq: 5,
      level: "info",
      data: {
        hookEventName: "Stop",
        command: 'bash -c "curl https://example.test/hook.sh?token=super-secret"',
      },
    },
  ]);
  await writeJsonl(path.join(fixture.home, "projects", fixture.slug, "transcript", "session-a.execution.jsonl"), [
    {
      type: "user",
      sessionId: fixture.sessionId,
      timestamp: "2026-06-18T10:00:12.000Z",
      cwd: fixture.workspace,
      message: {
        role: "user",
        content: [{ type: "tool_result", content: "pytest should not count as a user validation mention" }],
      },
    },
  ]);

  try {
    const result = await analyzer.analyze({
      home: fixture.home,
      workspace: fixture.workspace,
      command: "insights",
      limit: 10,
    });

    assert.equal(result.insights.schemaVersion, 2);
    assert.equal(result.insights.scope.workspaceSlug, fixture.slug);
    assert.equal(result.insights.sample.sessionCount, 1);
    assert.equal(result.insights.sample.analyzedSessionCount, 1);
    assert.equal(result.insights.sample.confidence, "High");
    assert.equal(result.insights.manifest.kind, "session-observation-manifest");
    assert.equal(result.insights.episodeSummary.episodeCount >= 1, true);
    assert.ok(result.facets.topHooks.some((item) => item.name === "PostToolUse"));
    assert.ok(result.facets.topSkills.some((item) => item.name === "readiness-analysis"));
    assert.equal(result.facets.topSkills.find((item) => item.name === "harness")?.count, 2);
    assert.equal(result.facets.topSkills.some((item) => item.name === "better-harness-plugin:harness"), false);
    assert.equal(result.facets.topSkills.some((item) => item.name === "(unknown)"), false);
    assert.ok(
      result.insights.keySignals.topSkills.some((item) => item.name === "readiness-analysis"),
    );
    assert.ok(
      result.facets.topHookCommands.some((item) => item.name === "PostToolUse -> node hooks/post-tool.mjs"),
    );
    assert.ok(
      result.insights.keySignals.topHookCommands.some(
        (item) => item.name === "PostToolUse -> node hooks/post-tool.mjs",
      ),
    );
    assert.ok(
      result.facets.topHookCommands.some((item) => item.name === String.raw`PreToolUse -> node hooks\pre-tool.mjs`),
    );
    assert.ok(result.facets.topHookCommands.some((item) => item.name === "Stop -> curl"));
    assert.ok(
      result.insights.cards.some(
        (card) => card.id === "observed-hooks" && card.finding.includes("node hooks/post-tool.mjs"),
      ),
    );
    assert.ok(result.insights.keySignals.validation.commandMatches.some((item) => item.name === "npm test"));
    assert.equal(result.insights.keySignals.validationAfterEdit.status, "validated-after-edit");
    assert.equal(result.insights.keySignals.validationAfterEdit.relevanceStatus, "unobserved");
    assert.equal(result.insights.keySignals.validationAfterEdit.editCount, 1);
    assert.ok(result.insights.keySignals.validationAfterEdit.validationAfterEdit.some((item) => item.name === "npm test"));
    assert.ok(result.insights.cards.some((card) => card.id === "post-edit-validation"));
    assert.equal(result.insights.keySignals.validation.userMentions.some((item) => item.name === "pytest"), false);
    assert.ok(result.insights.keySignals.friction.some((item) => item.name === "failed-event"));
    assert.ok(result.insights.cards.some((card) => card.id === "validation-behavior"));
    assert.ok(result.insights.cards.every((card) => card.scope && card.confidence && Array.isArray(card.evidenceRefs)));

    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("--secret-token"), false);
    assert.equal(serialized.includes("--token"), false);
    assert.equal(serialized.includes("Program Files"), false);
    assert.equal(serialized.includes("https://example.test"), false);
    assert.equal(serialized.includes("super-secret"), false);
    assert.equal(serialized.includes("hidden edit content"), false);
    assert.equal(serialized.includes("hidden failure detail"), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Qoder insights surface long-session density as outcome-review candidates", async () => {
  const fixture = await makeQoderFixture();
  const analyzer = new QoderSessionAnalyzer();

  await writeQoderConversation(
    fixture.home,
    fixture.slug,
    "long-active-a",
    timedConversation("long-active-a", "2026-06-18T11:00:00.000Z", 12, 10, "deep private prompt a"),
  );
  await writeQoderConversation(
    fixture.home,
    fixture.slug,
    "long-active-b",
    timedConversation("long-active-b", "2026-06-18T13:00:00.000Z", 12, 10, "deep private prompt b"),
  );
  await writeQoderConversation(
    fixture.home,
    fixture.slug,
    "long-active-c",
    timedConversation("long-active-c", "2026-06-18T15:00:00.000Z", 12, 10, "deep private prompt c"),
  );
  await writeQoderConversation(fixture.home, fixture.slug, "wall-idle-only", [
    {
      type: "user",
      sessionId: "wall-idle-only",
      timestamp: "2026-06-18T17:00:00.000Z",
      message: "idle private prompt",
    },
    {
      type: "assistant",
      sessionId: "wall-idle-only",
      timestamp: "2026-06-18T20:00:00.000Z",
      message: "resumed",
    },
  ]);

  try {
    const result = await analyzer.analyze({
      home: fixture.home,
      workspace: fixture.workspace,
      command: "insights",
      limit: 10,
    });

    const signal = result.insights.keySignals.longSessions;
    assert.equal(signal.longActiveCount, 3);
    assert.equal(signal.longWallCount, 1);
    assert.equal(signal.wallOnlyCount, 1);
    assert.equal(signal.recommendation.status, "inspect-active-long-sessions");
    assert.ok(signal.topByActive[0].activeMs >= 45 * 60 * 1000);
    assert.ok(signal.topByWall.some((item) => item.id === "wall-idle-only"));

    assert.ok(result.insights.cards.some((card) => card.id === "session-complexity"));
    assert.equal(result.insights.actionCandidates.some((item) => item.kind === "specialist-delegation"), false);
    assert.ok(result.insights.actionCandidates.some((item) => item.kind === "long-active-review"));

    const activeCandidates = result.insights.keySignals.usageEfficiency.candidates
      .filter((row) => row.candidateReasons.includes("active-long"));
    assert.equal(activeCandidates.length, 3);
    assert.deepEqual(activeCandidates.map((row) => row.userInputSummary).sort(), [
      "deep private prompt a 0",
      "deep private prompt b 0",
      "deep private prompt c 0",
    ]);
    const serialized = JSON.stringify(result.insights);
    assert.equal(serialized.includes("idle private prompt"), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Qoder usage efficiency counts request lifecycles and joins completion usage", async () => {
  const fixture = await makeQoderFixture();
  const analyzer = new QoderSessionAnalyzer();
  const segmentRoot = path.join(fixture.home, "logs", "sessions", fixture.slug);

  await writeJsonl(path.join(segmentRoot, fixture.sessionId, "segments", "2026-06-18T18-01-00-000+08-00-usage-a.jsonl"), [
    {
      type: "model.request.started",
      ts: "2026-06-18T10:00:59.000Z",
      request_id: "request-a",
      data: { request_index: 1, model: "ultimate" },
    },
    {
      type: "model.response.completed",
      ts: "2026-06-18T10:01:00.000Z",
      request_id: "request-a",
      data: {
        request_index: 1,
        model: "ultimate",
        stop_reason: "tool_use",
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
    {
      type: "model.request.started",
      ts: "2026-06-18T10:01:59.000Z",
      request_id: "request-b",
      data: { request_index: 2, model: "ultimate" },
    },
    {
      type: "model.response.completed",
      ts: "2026-06-18T10:02:00.000Z",
      request_id: "request-b",
      data: {
        request_index: 2,
        model: "ultimate",
        stop_reason: "end_turn",
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 25,
        cache_creation_input_tokens: 5,
      },
    },
  ]);
  await writeJsonl(path.join(segmentRoot, fixture.sessionId, "segments", "2026-06-18T18-02-00-000+08-00-usage-duplicate.jsonl"), [
    {
      type: "model.response.completed",
      ts: "2026-06-18T10:02:00.000Z",
      request_id: "request-b",
      data: { request_index: 2, model: "ultimate", stop_reason: "end_turn", input_tokens: 100, output_tokens: 50 },
    },
  ]);

  const childSessionId = "task-child-a";
  await writeJsonl(path.join(segmentRoot, childSessionId, "segments", "2026-06-18T19-00-00-000+08-00-child.jsonl"), [
    { type: "turn.started", ts: "2026-06-18T11:00:00.000Z", data: { model: "performance", is_subagent: true } },
    {
      type: "model.request.started",
      ts: "2026-06-18T11:00:59.000Z",
      request_id: "request-child",
      data: { request_index: 1, model: "performance" },
    },
    {
      type: "model.response.completed",
      ts: "2026-06-18T11:01:00.000Z",
      request_id: "request-child",
      data: { request_index: 1, model: "performance", stop_reason: "end_turn", input_tokens: 0, output_tokens: 0 },
    },
  ]);

  try {
    const result = await analyzer.analyze({
      home: fixture.home,
      workspace: fixture.workspace,
      command: "insights",
      selection: "all-eligible",
      limit: 100,
    });
    const usage = result.insights.keySignals.usageEfficiency;
    assert.equal(usage.schemaVersion, 1);
    assert.equal(usage.coverage.responseCount, 3);
    assert.equal(usage.coverage.modelAttributedResponseCount, 3);
    assert.equal(usage.coverage.unattributedResponseCount, 0);
    assert.equal(usage.coverage.nonZeroUsageCount, 1);
    assert.equal(usage.accountingMode, "host-estimated");
    assert.deepEqual(usage.tokenTotals, {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadInputTokens: 25,
      cacheCreationInputTokens: 5,
    });
    assert.equal(usage.modelUsage.find((row) => row.model === "ultimate")?.responseCount, 2);
    assert.equal(usage.activity.schemaVersion, 2);
    assert.equal(usage.activity.models.find((row) => row.name === "ultimate")?.total, 1);
    assert.equal(usage.activity.models.find((row) => row.name === "performance")?.total, 1);
    assert.equal(usage.activity.models.reduce((sum, row) => sum + row.total, 0), 2);
    assert.equal(usage.candidates.find((row) => row.id === childSessionId)?.role, "child-agent-candidate");
    assert.match(usage.candidates.find((row) => row.id === childSessionId)?.sessionRef ?? "", /^qsr1-[a-f0-9]{24}$/u);
    assert.ok(result.insights.cards.some((card) => card.id === "session-usage-efficiency"));

    const pricingPath = path.join(fixture.root, "pricing.json");
    await writeJson(pricingPath, {
      schemaVersion: 1,
      version: "reviewed-2026-07",
      currency: "USD",
      models: {
        ultimate: { inputPerMillion: 10, outputPerMillion: 20 },
        performance: { inputPerMillion: 5, outputPerMillion: 10 },
      },
    });
    const exactResult = await analyzer.analyze({
      home: fixture.home,
      workspace: fixture.workspace,
      command: "insights",
      selection: "all-eligible",
      limit: 100,
      "pricing-table": pricingPath,
    });
    assert.equal(exactResult.insights.keySignals.usageEfficiency.accountingMode, "exact");
    assert.ok(exactResult.insights.keySignals.usageEfficiency.actualCost?.amount > 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Qoder usage excludes assistant fragments while preserving nested Skill calls", async () => {
  const fixture = await makeQoderFixture();
  const analyzer = new QoderSessionAnalyzer();
  const projectPath = path.join(fixture.home, "projects", fixture.slug, `${fixture.sessionId}.jsonl`);
  const segmentPath = path.join(
    fixture.home,
    "logs",
    "sessions",
    fixture.slug,
    fixture.sessionId,
    "segments",
    "2026-06-18T18-01-00-000+08-00-mixed-sources.jsonl",
  );
  const completionFallback = {
    type: "assistant",
    uuid: "assistant-row-a",
    sessionId: fixture.sessionId,
    timestamp: "2026-06-18T10:01:00.008Z",
    message: {
      id: "response-a",
      role: "assistant",
      model: "ultimate",
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "skill-call-a", name: "Skill", input: { skill: "better-harness:better-harness" } }],
    },
  };

  await writeJsonl(projectPath, [
    completionFallback,
    { ...completionFallback, uuid: "assistant-row-a-duplicate" },
    {
      type: "assistant",
      uuid: "assistant-row-b",
      sessionId: fixture.sessionId,
      timestamp: "2026-06-18T10:02:00.000Z",
      message: {
        id: "response-b",
        role: "assistant",
        model: "performance",
        stop_reason: "end_turn",
        content: [{ type: "tool_use", id: "skill-call-b", name: "Skill", input: { skill: "create-skill" } }],
      },
    },
  ]);
  await writeJsonl(segmentPath, [
    {
      type: "model.request.started",
      ts: "2026-06-18T10:00:59.000Z",
      request_id: "request-a",
      data: { request_index: 1, model: "ultimate" },
    },
    {
      type: "model.response.completed",
      ts: "2026-06-18T10:01:00.000Z",
      request_id: "request-a",
      data: { model: "ultimate", input_tokens: 0, output_tokens: 0 },
    },
    {
      type: "tool.requested",
      ts: "2026-06-18T10:01:00.004Z",
      tool_call_id: "skill-call-a",
      data: { tool_name: "Skill", args: { skill: "better-harness:better-harness" } },
    },
  ]);
  await writeJsonl(path.join(fixture.home, "projects", fixture.slug, "transcript", "session-a.execution.jsonl"), [
    {
      type: "user",
      uuid: "user-prompt",
      sessionId: fixture.sessionId,
      timestamp: "2026-06-18T10:02:30.000Z",
      cwd: fixture.workspace,
      message: { role: "user", content: [{ type: "text", text: "review this request" }] },
    },
    {
      type: "user",
      uuid: "tool-result",
      sessionId: fixture.sessionId,
      timestamp: "2026-06-18T10:02:40.000Z",
      cwd: fixture.workspace,
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-a", content: "result" }] },
    },
    {
      type: "assistant",
      uuid: "transcript-response",
      sessionId: fixture.sessionId,
      timestamp: "2026-06-18T10:03:00.000Z",
      cwd: fixture.workspace,
      message: { role: "assistant", content: [{ type: "text", text: "unattributed response" }] },
    },
  ]);

  try {
    const result = await analyzer.analyze({
      home: fixture.home,
      workspace: fixture.workspace,
      command: "insights",
      selection: "all-eligible",
      limit: 100,
    });
    const usage = result.insights.keySignals.usageEfficiency;
    assert.equal(usage.coverage.responseCount, 1);
    assert.equal(usage.coverage.modelAttributedResponseCount, 1);
    assert.equal(usage.coverage.unattributedResponseCount, 0);
    assert.equal(usage.modelUsage.find((row) => row.model === "ultimate")?.responseCount, 1);
    assert.equal(usage.modelUsage.find((row) => row.model === "performance"), undefined);
    assert.equal(usage.activity.models.find((row) => row.name === "Unknown model"), undefined);
    assert.equal(usage.candidates.find((row) => row.id === fixture.sessionId)?.userPromptCount, 1);
    assert.deepEqual(result.insights.keySignals.topSkills.map((row) => [row.name, row.count]), [
      ["better-harness", 1],
      ["create-skill", 1],
    ]);
    assert.deepEqual(usage.activity.skills.map((row) => [row.name, row.total]), [
      ["better-harness", 1],
      ["create-skill", 1],
    ]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("session usage efficiency treats zero-filled usage as unavailable effort proxy", () => {
  const result = buildSessionEfficiencySignal(
    [{ sessionId: "session-zero", firstSeen: "2026-06-18T10:00:00.000Z", lastSeen: "2026-06-18T10:01:00.000Z" }],
    [{
      sessionId: "session-zero",
      type: "model.response.completed",
      timestamp: "2026-06-18T10:01:00.000Z",
      requestId: "request-zero",
      model: "qmodel_latest",
      usageFieldsObserved: true,
      modelUsage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    }],
  );
  assert.equal(result.accountingMode, "effort-proxy");
  assert.equal(result.coverage.usageFieldObservedCount, 1);
  assert.equal(result.coverage.nonZeroUsageCount, 0);
  assert.equal(result.tokenTotals, null);
  assert.equal(result.candidates[0].usageStatus, "zero-filled-unavailable");
  assert.ok(result.opportunities.some((row) => row.kind === "usage-coverage-gap"));
});

test("assistant fragments never inflate canonical model request counts", () => {
  const sessions = [{ sessionId: "session-a", firstSeen: "2026-06-18T10:00:00.000Z", lastSeen: "2026-06-18T10:01:00.000Z" }];
  const assistant = {
    sessionId: "session-a",
    type: "assistant",
    timestamp: "2026-06-18T10:00:00.000Z",
    responseId: "response-a",
    model: "ultimate",
  };
  const request = {
    sessionId: "session-a",
    type: "model.request.started",
    timestamp: "2026-06-18T10:00:00.000Z",
    requestId: "request-a",
    model: "ultimate",
  };
  const completion = {
    sessionId: "session-a",
    type: "model.response.completed",
    requestId: "request-a",
    model: "ultimate",
    usageFieldsObserved: true,
    modelUsage: { inputTokens: 0, outputTokens: 0 },
  };

  const lifecycle = buildSessionEfficiencySignal(sessions, [
    assistant,
    request,
    { ...completion, timestamp: "2026-06-18T10:00:00.100Z" },
  ]);
  const fragmentsOnly = buildSessionEfficiencySignal(sessions, [assistant, { ...assistant, responseId: "response-b" }]);

  assert.equal(lifecycle.coverage.responseCount, 1);
  assert.equal(lifecycle.coverage.usageFieldObservedCount, 1);
  assert.equal(fragmentsOnly.coverage.responseCount, 0);
});

test("session usage efficiency uses exact accounting only with complete usage and versioned pricing", () => {
  const pricingTable = {
    schemaVersion: 1,
    version: "2026-07-reviewed",
    currency: "USD",
    models: { ultimate: { inputPerMillion: 10, outputPerMillion: 20, cacheReadPerMillion: 1, cacheCreationPerMillion: 2 } },
  };
  const response = {
    sessionId: "session-exact",
    type: "model.response.completed",
    timestamp: "2026-06-18T10:01:00.000Z",
    requestId: "request-exact",
    model: "ultimate",
    usageFieldsObserved: true,
    modelUsage: { inputTokens: 1000, outputTokens: 500, cacheReadInputTokens: 100, cacheCreationInputTokens: 50 },
  };
  const cost = calculateExactModelCost([response], pricingTable);
  assert.deepEqual(cost, { available: true, amount: 0.0202, currency: "USD", pricingVersion: "2026-07-reviewed" });
  const signal = buildSessionEfficiencySignal(
    [{ sessionId: "session-exact", firstSeen: "2026-06-18T10:00:00.000Z", lastSeen: "2026-06-18T10:01:00.000Z" }],
    [response],
    { pricingTable },
  );
  assert.equal(signal.accountingMode, "exact");
  assert.equal(signal.coverage.pricingVersion, "2026-07-reviewed");
  assert.equal(signal.actualCost.amount, 0.0202);

  const incomplete = buildSessionEfficiencySignal(
    [{ sessionId: "session-exact", firstSeen: "2026-06-18T10:00:00.000Z", lastSeen: "2026-06-18T10:01:00.000Z" }],
    [{ ...response, model: "unknown-model" }],
    { pricingTable },
  );
  assert.equal(incomplete.accountingMode, "host-estimated");
  assert.equal(incomplete.actualCost, null);
  assert.equal(incomplete.coverage.pricingStatus, "missing-model-rates");
});

test("usage review packet accepts scoped refs without emitting raw session ids", async () => {
  const fixture = await makeQoderFixture();
  try {
    const source = {
      selection: { strategy: "all-eligible" },
      insights: {
        keySignals: {
          usageEfficiency: {
            accountingMode: "effort-proxy",
            outcomeReview: { comparableModelOutcomeEvidence: false },
            candidates: [{
              id: fixture.sessionId,
              role: "user-thread-candidate",
              roleConfidence: "Medium",
              candidateReasons: ["model-requests"],
              activeMs: 60_000,
              wallMs: 60_000,
              resumeCount: 0,
              responseCount: 1,
              failureCount: 0,
              usageStatus: "zero-filled-unavailable",
              tokenTotals: null,
              modelUsage: [{ model: "qmodel_latest", responseCount: 1 }],
            }],
          },
        },
      },
    };
    const packet = await buildUsageReviewPacket({
      workspace: fixture.workspace,
      home: fixture.home,
      limit: 1,
      source,
    });
    assert.equal(packet.candidateCount, 1);
    assert.equal(packet.candidates[0].alias, "S1");
    assert.match(packet.candidates[0].sessionRef, /^qsr1-[a-f0-9]{24}$/u);
    assert.equal(packet.candidates[0].firstUserEvidence, "please inspect this session");
    assert.equal(packet.semanticReviewContract.finalAliasesOnly, true);
    assert.equal(JSON.stringify(packet).includes(fixture.sessionId), false);
    const selected = await buildUsageReviewPacket({
      workspace: fixture.workspace,
      home: fixture.home,
      limit: 1,
      source,
      sessionRefs: [packet.candidates[0].sessionRef],
    });
    assert.equal(selected.candidateCount, 1);
    assert.equal(selected.candidates[0].sessionRef, packet.candidates[0].sessionRef);
    await assert.rejects(
      buildUsageReviewPacket({ workspace: fixture.workspace, home: fixture.home, limit: 1, source, sessionRefs: ["qsr1-deadbeefdeadbeefdeadbeef"] }),
      /unknown --session-ref/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Qoder file-reads rank suspected wrong-file reads without raw commands", async () => {
  const fixture = await makeQoderFixture();
  const analyzer = new QoderSessionAnalyzer();

  await writeJsonl(
    path.join(
      fixture.home,
      "logs",
      "sessions",
      fixture.slug,
      fixture.sessionId,
      "segments",
      "2026-06-18T18-00-30-000+08-00-test-file-reads.jsonl",
    ),
    [
      {
        type: "tool.requested",
        ts: "2026-06-18T10:00:30.000Z",
        seq: 10,
        level: "info",
        data: { tool_name: "Bash", args: { command: "sed -n '1,80p' src/insight.ts" } },
      },
      {
        type: "tool.execution.finished",
        ts: "2026-06-18T10:00:31.000Z",
        seq: 11,
        level: "error",
        data: { tool_name: "Bash", success: false, error: "hidden failure detail" },
      },
      {
        type: "tool.requested",
        ts: "2026-06-18T10:00:33.000Z",
        seq: 12,
        level: "info",
        data: { tool_name: "Bash", args: { command: "sed -n '1,80p' src/insights.ts" } },
      },
      {
        type: "tool.requested",
        ts: "2026-06-18T10:00:34.000Z",
        seq: 13,
        level: "info",
        data: { tool_name: "Read", args: { file_path: "docs/AGENTS.md" } },
      },
      {
        type: "tool.requested",
        ts: "2026-06-18T10:00:35.000Z",
        seq: 14,
        level: "info",
        data: { tool_name: "Edit", args: { file_path: "src/example.js", old_string: "a", new_string: "b" } },
      },
      {
        type: "tool.requested",
        ts: "2026-06-18T10:00:36.000Z",
        seq: 15,
        level: "info",
        data: { tool_name: "Write", args: { file_path: "report.canvas.tsx" } },
      },
      {
        type: "tool.requested",
        ts: "2026-06-18T10:00:37.000Z",
        seq: 16,
        level: "error",
        data: { tool_name: "Read", success: false, args: { file_path: "report.canvas.tsx" } },
      },
      {
        type: "tool.requested",
        ts: "2026-06-18T10:00:38.000Z",
        seq: 17,
        level: "info",
        data: { tool_name: "Read", args: { file_path: "skills/better-harness/models/routing.md" } },
      },
      {
        type: "tool.requested",
        ts: "2026-06-18T10:00:39.000Z",
        seq: 18,
        level: "info",
        data: { tool_name: "Read", args: { file_path: "skills/better-harness/references/project-harness/review-trigger.md" } },
      },
    ],
  );
  await writeJsonl(path.join(fixture.home, "projects", fixture.slug, "transcript", "session-a.file-correction.jsonl"), [
    {
      type: "user",
      sessionId: fixture.sessionId,
      timestamp: "2026-06-18T10:00:32.000Z",
      cwd: fixture.workspace,
      message: "不是这个文件，应该读 src/insights.ts",
    },
  ]);

  try {
    const result = await analyzer.analyze({
      home: fixture.home,
      workspace: fixture.workspace,
      command: "file-reads",
      limit: 10,
    });

    assert.equal(result.fileReads.schemaVersion, 1);
    assert.equal(result.fileReads.sample.analyzedSessionCount, 1);
    assert.ok(result.fileReads.topFiles.some((item) => item.path === "docs/AGENTS.md" && item.readCount === 1));
    assert.ok(result.fileReads.topFiles.some((item) => item.path === "src/example.js" && item.editCount === 1));

    const wrong = result.fileReads.issueCandidates.find((item) => item.path === "src/insight.ts");
    assert.ok(wrong);
    assert.ok(wrong.reasons.includes("failure-after-read"));
    assert.ok(wrong.reasons.includes("user-correction-after-read"));
    assert.ok(wrong.reasons.includes("similar-alternate-read"));
    assert.equal(wrong.failureCount >= 1, true);
    assert.equal(wrong.correctionCount, 1);

    assert.equal(result.fileReads.diagnostics.readAfterWriteFailureCount, 1);
    assert.equal(result.fileReads.diagnostics.wrongRelativePathCount, 2);
    const visibility = result.fileReads.readAfterWriteFailures.find((item) => item.path === "report.canvas.tsx");
    assert.ok(visibility);
    assert.ok(visibility.reasons.includes("read-after-write-failure"));
    const wrongRelativePath = result.fileReads.wrongRelativePathCandidates.find(
      (item) => item.path === "skills/better-harness/models/routing.md",
    );
    assert.ok(wrongRelativePath);
    const reliableDeliveryWrongPath = result.fileReads.wrongRelativePathCandidates.find(
      (item) => item.path === "skills/better-harness/references/project-harness/review-trigger.md",
    );
    assert.ok(reliableDeliveryWrongPath);
    assert.ok(wrongRelativePath.reasons.includes("wrong-relative-doc-path"));
    assert.deepEqual(wrongRelativePath.wrongRelativePathRules, ["harness-skill-models-relative-path"]);

    const serialized = JSON.stringify(result.fileReads);
    assert.equal(serialized.includes("sed -n"), false);
    assert.equal(serialized.includes("hidden failure detail"), false);
    assert.equal(serialized.includes("不是这个文件"), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Codex analyzer preserves large session event counts without overflowing the stack", async () => {
  const { CodexSessionAnalyzer } = await import("../../scripts/session-analysis/platforms/codex.mjs");
  const analyzer = new CodexSessionAnalyzer();
  const eventCount = 150_000;
  const sessionId = "codex-large-session";
  const workspace = path.join(os.tmpdir(), "better-harness-codex-large-workspace");
  const session = {
    sessionId,
    workspace,
    sourceKinds: ["codex-session-jsonl"],
    sourceRefs: [],
    firstSeen: null,
    lastSeen: null,
  };
  const event = {
    sessionId,
    type: "synthetic",
    sourceKind: "codex-session-jsonl",
    timestamp: null,
  };

  analyzer.discoverSourceRoots = async () => [];
  analyzer.readSession = async () => new Array(eventCount).fill(event);

  const result = await analyzer.analyze({
    home: path.join(os.tmpdir(), "better-harness-codex-large-home"),
    workspace,
    command: "facets",
    sessionInventory: [session],
  });

  assert.equal(result.sessions[0].eventCounts.synthetic, eventCount);
  assert.equal(result.facets.topEventTypes.find((item) => item.name === "synthetic")?.count, eventCount);
});

test("Codex insights summarize function calls and inferred skill reads", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-codex-session-analysis-"));
  const workspace = path.join(root, "workspace", "better-harness");
  const home = path.join(root, ".codex");
  const sessionId = "codex-session-a";

  await writeJsonl(path.join(home, "sessions", "2026", "06", "18", `rollout-2026-06-18T10-00-00-${sessionId}.jsonl`), [
    {
      timestamp: "2026-06-18T10:00:00.000Z",
      type: "session_meta",
      session_meta: { payload: { id: sessionId, cwd: workspace } },
    },
    {
      timestamp: "2026-06-18T10:00:01.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        arguments: JSON.stringify({
          cmd: "sed -n '1,220p' /Users/example/.codex/plugins/cache/openai-curated-remote/superpowers/5.1.4/skills/test-driven-development/SKILL.md",
        }),
      },
    },
    {
      timestamp: "2026-06-18T10:00:02.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "apply_patch",
        arguments: "*** Begin Patch\n*** End Patch",
      },
    },
    {
      timestamp: "2026-06-18T10:00:02.500Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        arguments: JSON.stringify({
          cmd: String.raw`type C:\Users\example\.codex\skills\.system\plugin-creator\SKILL.md`,
        }),
      },
    },
    {
      timestamp: "2026-06-18T10:00:03.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "done" }],
      },
    },
    {
      timestamp: "2026-06-18T10:00:04.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "developer",
        content: [
          {
            type: "input_text",
            text: [
              "<skill>",
              "<name>skill-creator</name>",
              "<path>/Users/example/.codex/skills/.system/skill-creator/SKILL.md</path>",
              "</skill>",
              "<skill>",
              "<name>superpowers:test-driven-development</name>",
              "<path>/Users/example/.codex/plugins/cache/openai-curated-remote/superpowers/5.1.4/skills/test-driven-development/SKILL.md</path>",
              "</skill>",
            ].join("\n"),
          },
        ],
      },
    },
  ]);

  const { CodexSessionAnalyzer } = await import("../../scripts/session-analysis/platforms/codex.mjs");
  const analyzer = new CodexSessionAnalyzer();

  try {
    const result = await analyzer.analyze({
      home,
      workspace,
      command: "insights",
      limit: 10,
    });

    assert.ok(result.facets.topFunctionCalls.some((item) => item.name === "exec_command"));
    assert.ok(result.facets.topFunctionCalls.some((item) => item.name === "apply_patch"));
    assert.ok(result.insights.keySignals.topFunctionCalls.some((item) => item.name === "exec_command"));
    assert.ok(result.facets.topSkills.some((item) => item.name === "skill-creator"));
    assert.ok(result.facets.topSkills.some((item) => item.name === "superpowers:test-driven-development"));
    assert.ok(result.insights.keySignals.topSkills.some((item) => item.name === "skill-creator"));
    assert.ok(result.facets.inferredSkillReads.some((item) => item.name === "test-driven-development"));
    assert.ok(result.facets.inferredSkillReads.some((item) => item.name === "plugin-creator"));
    assert.ok(result.insights.keySignals.inferredSkillReads.some((item) => item.name === "test-driven-development"));
    assert.equal(result.sessions[0].messageCounts.assistant >= 1, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Codex adapter normalizes current event_msg and response_item records", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-codex-current-events-"));
  const workspace = path.join(root, "workspace", "better-harness");
  const home = path.join(root, ".codex");
  const sessionId = "codex-current-events";

  await writeJsonl(path.join(home, "sessions", "2026", "07", "10", `rollout-2026-07-10T10-00-00-${sessionId}.jsonl`), [
    { timestamp: "2026-07-10T10:00:00.000Z", type: "session_meta", payload: { id: sessionId, cwd: workspace } },
    { timestamp: "2026-07-10T10:00:01.000Z", type: "event_msg", payload: { type: "user_message", message: "inspect current format" } },
    { timestamp: "2026-07-10T10:00:02.000Z", type: "response_item", payload: { type: "custom_tool_call", id: "tool-item-1", call_id: "tool-1", name: "exec_command", input: { command: "node --test test/sessions/session-analysis.test.mjs" } } },
    { timestamp: "2026-07-10T10:00:03.000Z", type: "response_item", payload: { type: "custom_tool_call_output", id: "tool-result-1", call_id: "tool-1", output: "ok" } },
    { timestamp: "2026-07-10T10:00:04.000Z", type: "event_msg", payload: { type: "agent_message", message: "done" } },
  ]);

  const { CodexSessionAnalyzer } = await import("../../scripts/session-analysis/platforms/codex.mjs");
  const analyzer = new CodexSessionAnalyzer();
  try {
    const result = await analyzer.analyze({ home, workspace, command: "insights", limit: 10 });
    const session = result.sessions[0];
    assert.equal(session.messageCounts.user, 1);
    assert.equal(session.messageCounts.assistant, 1);
    assert.ok(result.facets.topTools.some((item) => item.name === "exec_command"));
    assert.ok(result.insights.keySignals.validation.commandMatches.some((item) => item.name === "node --test"));
    assert.equal(result.selection.strategy, "all-eligible");
    assert.equal("sessions" in result.selection, false);
    assert.equal(result.insights.manifest.adapter.version, "codex-v2");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Codex keeps child rollout usage out of the parent while retaining real parent compaction", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-codex-rollout-identity-"));
  const workspace = path.join(root, "workspace", "better-harness");
  const home = path.join(root, ".codex");
  const parentId = "codex-parent-rollout";
  const reviewOneId = "codex-auto-review-one";
  const reviewTwoId = "codex-auto-review-two";
  const sessionPath = (...parts) => path.join(home, "sessions", "2026", "08", "28", ...parts);
  const tokenCount = (timestamp, cumulativeTotal, currentInput, lastTotal = currentInput) => ({
    timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: cumulativeTotal,
          output_tokens: 0,
          total_tokens: cumulativeTotal,
        },
        last_token_usage: {
          input_tokens: currentInput,
          output_tokens: 0,
          total_tokens: lastTotal,
        },
        model_context_window: 260,
      },
    },
  });

  await writeJsonl(sessionPath(`rollout-2026-08-28T10-00-00-${parentId}.jsonl`), [
    { timestamp: "2026-08-28T10:00:00.000Z", type: "session_meta", payload: { id: parentId, session_id: parentId, cwd: workspace } },
    tokenCount("2026-08-28T10:00:01.000Z", 30, 30),
    tokenCount("2026-08-28T10:00:04.000Z", 250, 240),
    { timestamp: "2026-08-28T10:00:07.000Z", type: "compacted", payload: {} },
    tokenCount("2026-08-28T10:00:08.000Z", 260, 0, 24_661),
    tokenCount("2026-08-28T10:00:10.000Z", 400, 120),
  ]);
  await writeJsonl(sessionPath(`rollout-2026-08-28T10-00-02-${reviewOneId}.jsonl`), [
    { timestamp: "2026-08-28T10:00:02.000Z", type: "session_meta", payload: { id: reviewOneId, session_id: parentId, cwd: workspace } },
    tokenCount("2026-08-28T10:00:03.000Z", 90, 80),
    tokenCount("2026-08-28T10:00:06.000Z", 150, 140),
  ]);
  await writeJsonl(sessionPath(`rollout-2026-08-28T10-00-05-${reviewTwoId}.jsonl`), [
    { timestamp: "2026-08-28T10:00:05.000Z", type: "session_meta", payload: { id: reviewTwoId, session_id: parentId, cwd: workspace } },
    tokenCount("2026-08-28T10:00:09.000Z", 25, 20),
  ]);

  const { CodexSessionAnalyzer } = await import("../../scripts/session-analysis/platforms/codex.mjs");
  const analyzer = new CodexSessionAnalyzer();
  try {
    const scope = await analyzer.resolveScope({ home, workspace });
    const roots = await analyzer.discoverSourceRoots(scope);
    const sessions = await analyzer.discoverSessions(scope, roots);
    assert.deepEqual(
      sessions.map((session) => session.sessionId).sort(),
      [parentId, reviewOneId, reviewTwoId].sort(),
    );

    const parent = sessions.find((session) => session.sessionId === parentId);
    assert.ok(parent);
    assert.equal(parent.sourceRefs.length, 1);
    const events = await analyzer.readSession(parent, scope);
    assert.equal(events.filter((event) => event.type === "event.token_count").length, 4);
    assert.equal(events.every((event) => event.sessionId === parentId), true);
    const resetSnapshot = events.filter((event) => event.type === "event.token_count")[2];
    assert.equal(resetSnapshot.emptyInvocationSnapshot, true);
    assert.equal(resetSnapshot.usageProgressionExcluded, true);
    assert.equal(Object.hasOwn(resetSnapshot, "modelInvocationUsage"), false);
    assert.equal(Object.hasOwn(resetSnapshot, "currentContextUsage"), false);

    const summary = summarizeSessionEvents(parent, events, {
      repoRoot: workspace,
      platform: "codex",
    });
    assert.equal(summary.tokenUsage.totalTokens, 400);
    assert.equal(summary.contextManifest.usedTokens, 120);
    assert.equal(summary.contextManifest.compactionCount, 1);
    assert.deepEqual(summary.contextManifest.compactionEvents, [
      {
        timestamp: "2026-08-28T10:00:07.000Z",
        contextTokens: 240,
        contextSnapshotTimestamp: "2026-08-28T10:00:04.000Z",
      },
    ]);
    assert.equal(summary.usageReport.actualModelCalls, 3);
    assert.equal(summary.usageReport.currentContextTokens, 120);
    assert.equal(summary.usageReport.netContextDeltaTokens, 90);
    assert.equal(summary.usageReport.contextResetCount, 1);
    assert.deepEqual(summary.usageReport.progression.map((point) => point.contextTokens), [30, 240, 120]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Codex facts route exposes request, edit, and parsed lint counts without raw payloads", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-codex-core-facts-"));
  const workspace = path.join(root, "workspace", "project");
  const home = path.join(root, ".codex");
  const sessionId = "codex-core-facts-a";
  const privatePath = path.join(workspace, "src", "private-file.ts");

  await writeJsonl(path.join(home, "sessions", "2026", "07", "10", `rollout-2026-07-10T10-00-00-${sessionId}.jsonl`), [
    { timestamp: "2026-07-10T10:00:00.000Z", type: "session_meta", payload: { id: sessionId, cwd: workspace } },
    {
      timestamp: "2026-07-10T10:00:01.000Z",
      type: "event_msg",
      payload: {
        type: "user_message",
        message: `Fix lint in ${privatePath} with api_key=private-value`,
      },
    },
    {
      timestamp: "2026-07-10T10:00:02.000Z",
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        id: "edit-private",
        call_id: "edit-private",
        name: "Write",
        input: { file_path: privatePath, content: "private source" },
      },
    },
    {
      timestamp: "2026-07-10T10:00:03.000Z",
      type: "response_item",
      payload: {
        type: "custom_tool_call_output",
        id: "edit-result-private",
        call_id: "edit-private",
        output: "ok",
        success: true,
      },
    },
    {
      timestamp: "2026-07-10T10:00:04.000Z",
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        id: "lint-private",
        call_id: "lint-private",
        name: "exec_command",
        input: { command: "npm run lint -- --secret private-value" },
      },
    },
    {
      timestamp: "2026-07-10T10:00:05.000Z",
      type: "response_item",
      payload: {
        type: "custom_tool_call_output",
        id: "lint-result-private",
        call_id: "lint-private",
        output: "Script failed\nOutput:\n3 problems (3 errors, 0 warnings)",
        success: false,
      },
    },
  ]);

  const { CodexSessionAnalyzer, main: codexMain } = await import("../../scripts/session-analysis/platforms/codex.mjs");
  const analyzer = new CodexSessionAnalyzer();
  try {
    const result = await analyzer.analyze({
      home,
      workspace,
      command: "facts",
      limit: 3,
      "exclude-active-window-ms": 0,
    });

    assert.equal(result.kind, "session-core-facts");
    assert.equal(result.schemaVersion, 3);
    assert.equal(result.scope.platform, "codex");
    assert.equal(result.candidateSelection.strategy, "agent-work-loop-portfolio-v1");
    assert.deepEqual(result.candidateSelection.emittedClasses, { "validation-repair": 1 });
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].request.summary, "Fix lint in <path> with api_key=<redacted>");
    assert.deepEqual(result.candidates[0].changes, { edits: 1, files: 1 });
    assert.deepEqual(result.candidates[0].checks, [{
      kind: "lint",
      status: "failed",
      relation: "after-final-change-unreviewed",
      counts: { errors: 3, warnings: 0 },
      countQuality: "parsed",
    }]);
    assert.equal(result.candidates[0].closure, "check-observed-relevance-unresolved");
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(privatePath), false);
    assert.equal(serialized.includes("private-value"), false);
    assert.equal(serialized.includes("npm run lint"), false);
    assert.equal(serialized.includes("Script failed"), false);
    assert.equal(serialized.includes(sessionId), false);

    const debugResult = await analyzer.analyze({
      home,
      workspace,
      command: "facts",
      limit: 3,
      debug: true,
      "exclude-active-window-ms": 0,
    });
    assert.equal(debugResult.debug.privacy, "local-operator-only");
    assert.deepEqual(debugResult.debug.locators[0].sessionIds, [sessionId]);
    assert.equal(JSON.stringify(debugResult).includes(sessionId), true);

    const outputPath = path.join(root, "diagnostics", "codex-facts.json");
    let cliStdout = "";
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk) => {
      cliStdout += String(chunk);
      return true;
    };
    try {
      await codexMain([
        "facts", "--home", home, "--workspace", workspace, "--limit", "3",
        "--exclude-active-window-ms", "0", "--debug", "--output", outputPath,
      ]);
    } finally {
      process.stdout.write = originalWrite;
    }
    const written = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(written.debug.privacy, "local-operator-only");
    assert.equal(JSON.parse(cliStdout).output, outputPath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Codex file-reads use the shared diagnostics contract", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-codex-file-reads-"));
  const workspace = path.join(root, "workspace", "better-harness");
  const home = path.join(root, ".codex");
  const sessionId = "codex-file-reads-a";

  await writeJsonl(path.join(home, "sessions", "2026", "06", "18", `rollout-2026-06-18T10-10-00-${sessionId}.jsonl`), [
    {
      timestamp: "2026-06-18T10:10:00.000Z",
      type: "session_meta",
      session_meta: { payload: { id: sessionId, cwd: workspace } },
    },
    {
      timestamp: "2026-06-18T10:10:01.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        arguments: JSON.stringify({
          cmd: "cat src/component.ts",
        }),
      },
    },
    {
      timestamp: "2026-06-18T10:10:02.000Z",
      type: "response_item",
      payload: { type: "function_call_output", success: false, error: "hidden failure detail" },
    },
    {
      timestamp: "2026-06-18T10:10:03.000Z",
      type: "user",
      payload: { message: "not that file; read src/components.ts instead" },
    },
    {
      timestamp: "2026-06-18T10:10:04.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        arguments: JSON.stringify({
          cmd: "cat src/components.ts",
        }),
      },
    },
    {
      timestamp: "2026-06-18T10:10:05.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "write",
        arguments: JSON.stringify({ file_path: "report.canvas.tsx" }),
      },
    },
    {
      timestamp: "2026-06-18T10:10:06.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "read",
        success: false,
        arguments: JSON.stringify({ file_path: "report.canvas.tsx" }),
      },
    },
    {
      timestamp: "2026-06-18T10:10:07.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        arguments: JSON.stringify({ cmd: "cat templates/harness-report/style/routing.md" }),
      },
    },
  ]);

  const { CodexSessionAnalyzer } = await import("../../scripts/session-analysis/platforms/codex.mjs");
  const analyzer = new CodexSessionAnalyzer();

  try {
    const result = await analyzer.analyze({
      home,
      workspace,
      command: "file-reads",
      limit: 10,
    });

    assert.equal(result.fileReads.schemaVersion, 1);
    assert.equal(result.fileReads.sample.analyzedSessionCount, 1);
    assert.ok(result.fileReads.topFiles.some((item) => item.path === "src/components.ts" && item.readCount === 1));

    const wrong = result.fileReads.issueCandidates.find((item) => item.path === "src/component.ts");
    assert.ok(wrong);
    assert.ok(wrong.reasons.includes("failure-after-read"));
    assert.ok(wrong.reasons.includes("user-correction-after-read"));
    assert.ok(wrong.reasons.includes("similar-alternate-read"));

    assert.equal(result.fileReads.diagnostics.readAfterWriteFailureCount, 1);
    assert.equal(result.fileReads.diagnostics.wrongRelativePathCount, 1);
    const visibility = result.fileReads.readAfterWriteFailures.find((item) => item.path === "report.canvas.tsx");
    assert.ok(visibility);
    assert.ok(visibility.reasons.includes("read-after-write-failure"));
    const wrongRelativePath = result.fileReads.wrongRelativePathCandidates.find(
      (item) => item.path === "templates/harness-report/style/routing.md",
    );
    assert.ok(wrongRelativePath);
    assert.ok(wrongRelativePath.reasons.includes("wrong-relative-doc-path"));
    assert.deepEqual(wrongRelativePath.wrongRelativePathRules, ["harness-report-style-relative-path"]);

    const serialized = JSON.stringify(result.fileReads);
    assert.equal(serialized.includes("cat "), false);
    assert.equal(serialized.includes("hidden failure detail"), false);
    assert.equal(serialized.includes("not that file"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Codex insights expose session-only Goal and Plan signals", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-codex-session-planning-"));
  const workspace = path.join(root, "workspace", "better-harness");
  const otherWorkspace = path.join(root, "workspace", "other");
  const home = path.join(root, ".codex");
  const sessionId = "codex-planning-a";
  const globalSessionId = "codex-planning-global";

  await writeJsonl(path.join(home, "sessions", "2026", "06", "19", `rollout-2026-06-19T10-00-00-${sessionId}.jsonl`), [
    {
      timestamp: "2026-06-19T10:00:00.000Z",
      type: "session_meta",
      session_meta: { payload: { id: sessionId, cwd: workspace } },
    },
    {
      timestamp: "2026-06-19T10:00:01.000Z",
      type: "user",
      payload: { message: "/goal implement the planning signal detector" },
    },
    {
      timestamp: "2026-06-19T10:00:01.100Z",
      type: "user",
      payload: { message: "Review the spec before implementation." },
    },
    {
      timestamp: "2026-06-19T10:00:01.200Z",
      type: "user",
      payload: { message: "/story refine the acceptance criteria" },
    },
    {
      timestamp: "2026-06-19T10:00:01.300Z",
      type: "user",
      payload: { message: "/issue-triage --label agent-ready" },
    },
    {
      timestamp: "2026-06-19T10:00:02.000Z",
      type: "assistant",
      payload: { message: "Mentioning /goal in prose must not create a command signal." },
    },
    {
      timestamp: "2026-06-19T10:00:03.000Z",
      type: "response_item",
      payload: { type: "function_call", name: "create_goal", arguments: "{}" },
    },
    {
      timestamp: "2026-06-19T10:00:04.000Z",
      type: "response_item",
      payload: { type: "function_call", name: "update_plan", arguments: "{}" },
    },
    {
      timestamp: "2026-06-19T10:00:05.000Z",
      type: "response_item",
      payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "update_goal in prose" }] },
    },
  ]);

  await writeJsonl(
    path.join(home, "sessions", "2026", "06", "19", `rollout-2026-06-19T11-00-00-${globalSessionId}.jsonl`),
    [
      {
        timestamp: "2026-06-19T11:00:00.000Z",
        type: "session_meta",
        session_meta: { payload: { id: globalSessionId, cwd: otherWorkspace } },
      },
      {
        timestamp: "2026-06-19T11:00:01.000Z",
        type: "response_item",
        payload: { type: "function_call", name: "get_goal", arguments: "{}" },
      },
    ],
  );

  const { CodexSessionAnalyzer } = await import("../../scripts/session-analysis/platforms/codex.mjs");
  const analyzer = new CodexSessionAnalyzer();

  try {
    const workspaceResult = await analyzer.analyze({
      home,
      workspace,
      command: "insights",
      limit: 10,
    });

    assert.ok(
      workspaceResult.facets.planningSignals.some(
        (item) => item.host === "codex" && item.kind === "goal-command" && item.name === "/goal" && item.scope === "workspace",
      ),
    );
    assert.ok(
      workspaceResult.facets.planningSignals.some(
        (item) => item.host === "codex" && item.kind === "goal-tool" && item.name === "create_goal",
      ),
    );
    assert.ok(
      workspaceResult.insights.keySignals.planningSignals.some(
        (item) => item.host === "codex" && item.kind === "plan-tool" && item.name === "update_plan",
      ),
    );
    assert.ok(
      workspaceResult.facets.planningSignals.some(
        (item) => item.host === "codex" && item.kind === "spec-reference",
      ),
    );
    assert.ok(
      workspaceResult.facets.planningSignals.some(
        (item) => item.host === "codex" && item.kind === "spec-command" && item.name === "/story",
      ),
    );
    assert.ok(
      workspaceResult.insights.keySignals.lifecycleDemandSignals.some(
        (item) => item.host === "codex" && item.intent === "specification-review" && item.family === "specification",
      ),
    );
    assert.ok(
      workspaceResult.insights.keySignals.lifecycleDemandSignals.some(
        (item) => item.host === "codex" && item.intent === "issue-triage" && item.family === "planning",
      ),
    );
    assert.equal(
      workspaceResult.facets.planningSignals.some((item) => item.name === "get_goal" && item.scope === "user-global"),
      false,
    );

    const globalResult = await analyzer.analyze({
      home,
      workspace,
      command: "insights",
      limit: 10,
      includeGlobalCapabilities: true,
    });
    assert.ok(
      globalResult.facets.planningSignals.some(
        (item) => item.host === "codex" && item.name === "get_goal" && item.scope === "user-global",
      ),
    );
    assert.ok(globalResult.insights.cards.some((card) => card.id === "planning-workflow"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Qoder insights expose session-only Plan and Spec signals", async () => {
  const fixture = await makeQoderFixture();
  const analyzer = new QoderSessionAnalyzer();

  await writeJsonl(path.join(fixture.home, "projects", fixture.slug, "transcript", "session-a.planning.jsonl"), [
    {
      type: "user",
      sessionId: fixture.sessionId,
      timestamp: "2026-06-18T10:00:20.000Z",
      cwd: fixture.workspace,
      message: "Switched mode to PLAN <system_reminder>You are now in Plan mode.</system_reminder>",
    },
    {
      type: "user",
      sessionId: fixture.sessionId,
      timestamp: "2026-06-18T10:00:21.000Z",
      cwd: fixture.workspace,
      message: "/plan design the implementation",
    },
    {
      type: "user",
      sessionId: fixture.sessionId,
      timestamp: "2026-06-18T10:00:22.000Z",
      cwd: fixture.workspace,
      message: "/spec draft the acceptance scenarios",
    },
    {
      type: "user",
      sessionId: fixture.sessionId,
      timestamp: "2026-06-18T10:00:22.500Z",
      cwd: fixture.workspace,
      message: "Review docs/specs/2026-06-25-session-goal-plan-spec-signals.md before implementation.",
    },
    {
      type: "user",
      sessionId: fixture.sessionId,
      timestamp: "2026-06-18T10:00:22.600Z",
      cwd: fixture.workspace,
      message: "review the spec",
    },
    {
      type: "user",
      sessionId: fixture.sessionId,
      timestamp: "2026-06-18T10:00:22.700Z",
      cwd: fixture.workspace,
      message: "规格评审",
    },
    {
      type: "user",
      sessionId: fixture.sessionId,
      timestamp: "2026-06-18T10:00:22.800Z",
      cwd: fixture.workspace,
      message: "/issue-triage daily",
    },
    {
      type: "user",
      sessionId: fixture.sessionId,
      timestamp: "2026-06-18T10:00:23.000Z",
      cwd: fixture.workspace,
      message: "This prose mentions /goal and /ultraplan but does not invoke either command.",
    },
    {
      type: "user",
      sessionId: fixture.sessionId,
      timestamp: "2026-06-18T10:00:24.000Z",
      cwd: fixture.workspace,
      message: "<loaded_context>Write a plan or spec when introducing new agents. Save it as docs/specs/example.md.</loaded_context>",
    },
  ]);

  const globalSlug = "-Users-example-workspace-other";
  const globalSessionId = "qoder-global-plan";
  await writeJsonl(path.join(fixture.home, "projects", globalSlug, `${globalSessionId}.jsonl`), [
    {
      type: "user",
      sessionId: globalSessionId,
      timestamp: "2026-06-18T11:00:00.000Z",
      message: "Switched mode to PLAN <system_reminder>Plan mode is active.</system_reminder>",
    },
  ]);

  try {
    const workspaceResult = await analyzer.analyze({
      home: fixture.home,
      workspace: fixture.workspace,
      command: "insights",
      limit: 10,
    });

    assert.ok(
      workspaceResult.facets.planningSignals.some(
        (item) => item.host === "qoder" && item.kind === "plan-mode" && item.scope === "workspace",
      ),
    );
    assert.ok(
      workspaceResult.facets.planningSignals.some(
        (item) => item.host === "qoder" && item.kind === "plan-command" && item.name === "/plan",
      ),
    );
    assert.ok(
      workspaceResult.facets.planningSignals.some(
        (item) => item.host === "qoder" && item.kind === "spec-command" && item.name === "/spec",
      ),
    );
    assert.ok(
      workspaceResult.facets.planningSignals.some(
        (item) => item.host === "qoder" && item.kind === "spec-reference" && item.scope === "workspace",
      ),
    );
    assert.ok(
      workspaceResult.facets.planningSignals.some(
        (item) => item.host === "qoder" && item.kind === "plan-command" && item.name === "/issue-*",
      ),
    );
    assert.ok(
      workspaceResult.facets.lifecycleDemandSignals.some(
        (item) => item.host === "qoder" && item.intent === "specification-review" && item.count >= 2,
      ),
    );
    assert.ok(
      workspaceResult.insights.keySignals.lifecycleDemandSignals.some(
        (item) => item.host === "qoder" && item.intent === "issue-triage" && item.family === "planning",
      ),
    );
    assert.equal(workspaceResult.facets.planningSignals.some((item) => item.name === "/goal"), false);
    assert.equal(workspaceResult.facets.planningSignals.some((item) => item.name === "/ultraplan"), false);
    assert.equal(
      workspaceResult.facets.planningSignals.some((item) => item.scope === "user-global"),
      false,
    );

    const globalResult = await analyzer.analyze({
      home: fixture.home,
      workspace: fixture.workspace,
      command: "insights",
      limit: 10,
      includeGlobalCapabilities: true,
    });
    assert.ok(
      globalResult.facets.planningSignals.some(
        (item) => item.host === "qoder" && item.kind === "plan-mode" && item.scope === "user-global",
      ),
    );
    assert.ok(globalResult.insights.keySignals.planningSignals.some((item) => item.kind === "spec-reference"));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Qoder insights keep fewer than five unvalidated edits as sample context", async () => {
  const fixture = await makeQoderFixture();
  const analyzer = new QoderSessionAnalyzer();

  await writeJsonl(
    path.join(
      fixture.home,
      "logs",
      "sessions",
      fixture.slug,
      fixture.sessionId,
      "segments",
      "2026-06-18T18-00-20-000+08-00-test-p3.jsonl",
    ),
    [
      {
        type: "tool.requested",
        ts: "2026-06-18T10:00:19.000Z",
        seq: 4,
        level: "info",
        data: {
          tool_name: "Bash",
          args: { command: "ls docs/ 2>/dev/null && echo \"---\" && ls scripts/ 2>/dev/null" },
        },
      },
      {
        type: "tool.requested",
        ts: "2026-06-18T10:00:20.000Z",
        seq: 5,
        level: "info",
        data: { tool_name: "Edit", args: { file_path: "src/example.js", old_string: "a", new_string: "b" } },
      },
    ],
  );

  try {
    const result = await analyzer.analyze({
      home: fixture.home,
      workspace: fixture.workspace,
      command: "insights",
      limit: 10,
    });

    assert.equal(result.insights.keySignals.validationAfterEdit.status, "edit-without-validation");
    assert.equal(result.insights.keySignals.validationAfterEdit.editCount, 1);
    assert.equal(result.insights.keySignals.validationAfterEdit.validationAfterEditCount, 0);
    assert.equal(result.insights.actionCandidates.some((item) => item.kind === "post-edit-validation-review"), false);
    assert.ok(
      result.insights.cards.some(
        (card) => card.id === "post-edit-validation" && card.finding.includes("no later validation command"),
      ),
    );
    assert.match(
      result.insights.cards.find((card) => card.id === "post-edit-validation").behaviorChange,
      /fewer than five project edit events is too small/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Qoder insights exclude writes outside the selected workspace", async () => {
  const fixture = await makeQoderFixture();
  const analyzer = new QoderSessionAnalyzer();
  const outsideReport = path.join(fixture.root, "results", "report.canvas.tsx");

  await writeJsonl(
    path.join(
      fixture.home,
      "logs",
      "sessions",
      fixture.slug,
      fixture.sessionId,
      "segments",
      "2026-06-18T18-00-20-000+08-00-outside-write.jsonl",
    ),
    [{
      type: "tool.requested",
      ts: "2026-06-18T10:00:20.000Z",
      seq: 5,
      level: "info",
      data: { tool_name: "Write", args: { file_path: outsideReport } },
    }, {
      type: "tool.execution.finished",
      ts: "2026-06-18T10:00:20.500Z",
      seq: 6,
      level: "info",
      data: { tool_name: "Write", status: "success" },
    }, {
      type: "tool.requested",
      ts: "2026-06-18T10:00:21.000Z",
      seq: 7,
      level: "info",
      data: { tool_name: "Write", args: { file_path: "../../results/findings.json" } },
    }, {
      type: "tool.execution.finished",
      ts: "2026-06-18T10:00:21.500Z",
      seq: 8,
      level: "info",
      data: { tool_name: "Write", status: "success" },
    }],
  );

  try {
    const result = await analyzer.analyze({
      home: fixture.home,
      workspace: fixture.workspace,
      command: "insights",
      limit: 10,
    });

    assert.equal(result.insights.keySignals.validationAfterEdit.status, "no-edit-observed");
    assert.equal(result.insights.keySignals.validationAfterEdit.editCount, 0);
    assert.equal(result.insights.actionCandidates.some((item) => item.kind === "post-edit-validation-review"), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
