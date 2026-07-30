import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAnalyzer } from "../scripts/session-analysis.mjs";
import { createAnalyzer as createCapabilityAnalyzer } from "../scripts/session-analysis/index.mjs";
import {
  ClaudeSessionAnalyzer,
  workspaceToClaudeSlugVariants,
} from "../scripts/session-analysis/platforms/claude.mjs";
import {
  CursorSessionAnalyzer,
  workspaceToCursorSlugVariants,
} from "../scripts/session-analysis/platforms/cursor.mjs";
import {
  QwenSessionAnalyzer,
  workspaceToQwenSlugVariants,
} from "../scripts/session-analysis/platforms/qwen.mjs";
import {
  CopilotSessionAnalyzer,
  parseWorkspaceDescriptor,
} from "../scripts/session-analysis/platforms/copilot.mjs";
import { measureLongSessionRows } from "../scripts/session-analysis/long-sessions.mjs";

async function fixtureRoot(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeJsonl(filePath, rows) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

test("root dispatcher creates Claude and Cursor provider analyzers", async () => {
  assert.ok(await createAnalyzer("claude") instanceof ClaudeSessionAnalyzer);
  assert.ok(await createAnalyzer("cursor") instanceof CursorSessionAnalyzer);
  assert.ok(await createAnalyzer("qwen") instanceof QwenSessionAnalyzer);
  assert.ok(await createAnalyzer("copilot") instanceof CopilotSessionAnalyzer);
  assert.ok(await createCapabilityAnalyzer("claude") instanceof ClaudeSessionAnalyzer);
  assert.ok(await createCapabilityAnalyzer("cursor") instanceof CursorSessionAnalyzer);
  assert.ok(await createCapabilityAnalyzer("qwen") instanceof QwenSessionAnalyzer);
  assert.ok(await createCapabilityAnalyzer("copilot") instanceof CopilotSessionAnalyzer);
});

test("Claude, Cursor, and Qwen workspace slugs cover Unix and Windows layouts", () => {
  assert.ok(workspaceToClaudeSlugVariants("/workspace/project").includes("-workspace-project"));
  assert.ok(workspaceToCursorSlugVariants("/workspace/project").includes("workspace-project"));
  assert.ok(workspaceToQwenSlugVariants("/workspace/project").includes("-workspace-project"));
  assert.ok(workspaceToClaudeSlugVariants("C:\\workspace\\project").some((value) => value.includes("C--workspace-project")));
  assert.ok(workspaceToCursorSlugVariants("C:\\workspace\\project").some((value) => value.includes("C--workspace-project")));
  assert.ok(workspaceToQwenSlugVariants("C:\\workspace\\project").some((value) => value.includes("C--workspace-project")));
});

test("Claude provider expands nested tool requests and results without using generated facets", async () => {
  const root = await fixtureRoot("session-claude-provider-");
  const home = path.join(root, ".claude");
  const workspace = path.join(root, "workspace", "project");
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const slug = workspaceToClaudeSlugVariants(workspace)[0];
  await writeJsonl(path.join(home, "projects", slug, `${sessionId}.jsonl`), [
    {
      type: "user",
      sessionId,
      cwd: workspace,
      timestamp: "2026-07-20T01:00:00.000Z",
      message: { role: "user", content: [{ type: "text", text: "Implement the provider and run tests" }] },
    },
    {
      type: "assistant",
      sessionId,
      cwd: workspace,
      timestamp: "2026-07-20T01:01:00.000Z",
      message: {
        role: "assistant",
        model: "claude-fixture",
        usage: { input_tokens: 10, output_tokens: 4 },
        content: [
          { type: "text", text: "I will inspect and validate it." },
          { type: "tool_use", id: "tool-1", name: "Bash", input: { command: "npm test" } },
          { type: "tool_use", id: "tool-2", name: "Read", input: { file_path: path.join(workspace, "package.json") } },
        ],
      },
    },
    {
      type: "user",
      sessionId,
      cwd: workspace,
      timestamp: "2026-07-20T01:02:00.000Z",
      message: {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "tool-1", content: "3 tests passed" },
          { type: "tool_result", tool_use_id: "tool-2", is_error: true, content: "not found" },
        ],
      },
    },
  ]);
  await mkdir(path.join(home, "usage-data", "facets"), { recursive: true });
  await writeFile(path.join(home, "usage-data", "facets", `${sessionId}.json`), JSON.stringify({ outcome: "success" }));
  await writeJsonl(path.join(home, "audit", "audit.jsonl"), [
    {
      event: "tool_input",
      session_id: sessionId,
      timestamp: "2026-07-20T01:01:00.000Z",
      toolName: "Bash",
      toolUseId: "tool-1",
      input: { command: "npm test" },
    },
    {
      event: "tool_output",
      session_id: sessionId,
      timestamp: "2026-07-20T01:02:00.000Z",
      toolName: "Bash",
      toolUseId: "tool-1",
      output: "3 tests passed",
    },
  ]);

  const analyzer = new ClaudeSessionAnalyzer();
  const discovery = await analyzer.analyze({ command: "sources", workspace, home });
  assert.equal(discovery.sessions.length, 1);
  assert.equal(discovery.sessions[0].sourceRefs.filter((ref) => ref.kind === "claude-audit-jsonl").length, 1);
  assert.deepEqual(discovery.sources.map((source) => source.kind), [
    "claude-project-jsonl",
    "claude-audit-jsonl",
    "claude-audit-log-jsonl",
  ]);
  const scope = await analyzer.resolveScope({ workspace, home });
  const events = await analyzer.readSession(discovery.sessions[0], scope, {
    includeCommandText: true,
    includeUserText: true,
    includeContent: true,
  });
  assert.equal(events.filter((event) => event.type === "tool.call").length, 2);
  assert.equal(events.filter((event) => event.type === "tool.result").length, 2);
  assert.equal(events.find((event) => event.model === "claude-fixture")?.modelUsage.inputTokens, 10);
  assert.equal(events.find((event) => event.toolInvocationId === "tool-2")?.filePath, path.join(workspace, "package.json"));
  assert.equal(events.find((event) => event.toolInvocationId === "tool-2" && event.type === "tool.result")?.success, false);
  const insights = await analyzer.analyze({ command: "insights", workspace, home, selection: "all-eligible" });
  assert.equal(insights.insights.keySignals.usageEfficiency.coverage.responseCount, 1);
  assert.equal(insights.insights.keySignals.usageEfficiency.tokenTotals.inputTokens, 10);
  const facts = await analyzer.analyze({ command: "facts", workspace, home, limit: 1 });
  assert.equal(facts.kind, "session-core-facts");
  assert.equal(facts.scope.platform, "claude");
  assert.doesNotMatch(JSON.stringify(facts), new RegExp(sessionId, "u"));
  assert.doesNotMatch(JSON.stringify(facts), new RegExp(home.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
});

test("Claude provider rejects a transcript whose embedded cwd belongs to another workspace", async () => {
  const root = await fixtureRoot("session-claude-isolation-");
  const home = path.join(root, ".claude");
  const workspace = path.join(root, "workspace", "target");
  const slug = workspaceToClaudeSlugVariants(workspace)[0];
  await writeJsonl(path.join(home, "projects", slug, "foreign.jsonl"), [{
    type: "user",
    sessionId: "foreign",
    cwd: path.join(root, "workspace", "other"),
    timestamp: "2026-07-20T01:00:00.000Z",
    message: { role: "user", content: [{ type: "text", text: "foreign" }] },
  }]);
  const result = await new ClaudeSessionAnalyzer().analyze({ command: "sources", workspace, home });
  assert.equal(result.sessions.length, 0);
});

test("Cursor provider joins transcript, metadata, and only matching audit sessions", async () => {
  const root = await fixtureRoot("session-cursor-provider-");
  const home = path.join(root, ".cursor");
  const workspace = path.join(root, "workspace", "project");
  const sessionId = "22222222-2222-4222-8222-222222222222";
  const slug = workspaceToCursorSlugVariants(workspace)[0];
  const transcript = path.join(home, "projects", slug, "agent-transcripts", sessionId, `${sessionId}.jsonl`);
  await writeJsonl(transcript, [
    { role: "user", message: { content: [{ type: "text", text: "Fix the Cursor adapter" }] } },
    {
      role: "assistant",
      message: { content: [
        { type: "text", text: "I will edit and test it." },
        { type: "tool_use", name: "Write", input: { file_path: path.join(workspace, "adapter.mjs"), content: "x" } },
        { type: "tool_use", name: "Shell", input: { command: "node --test" } },
      ] },
    },
    { type: "turn_ended", status: "completed" },
  ]);
  const metaPath = path.join(home, "chats", "workspace-hash", sessionId, "meta.json");
  await mkdir(path.dirname(metaPath), { recursive: true });
  await writeFile(metaPath, JSON.stringify({
    schemaVersion: 1,
    cwd: workspace,
    createdAtMs: Date.parse("2026-07-20T02:00:00.000Z"),
    updatedAtMs: Date.parse("2026-07-20T02:04:00.000Z"),
    hasConversation: true,
  }));
  await writeJsonl(path.join(home, "audit", "audit.jsonl"), [
    {
      _event: "preToolUse",
      _timestamp: "2026-07-20T02:01:00.000Z",
      session_id: sessionId,
      conversation_id: sessionId,
      tool_name: "Shell",
      tool_use_id: "cursor-tool-1",
      tool_input: { command: "node --test" },
      workspace_roots: [workspace],
    },
    {
      _event: "postToolUse",
      _timestamp: "2026-07-20T02:03:00.000Z",
      session_id: sessionId,
      conversation_id: sessionId,
      tool_name: "Shell",
      tool_use_id: "cursor-tool-1",
      tool_output: "4 tests passed",
      model: "cursor-fixture",
      input_tokens: 20,
      output_tokens: 5,
      workspace_roots: [workspace],
    },
    {
      _event: "postToolUseFailure",
      _timestamp: "2026-07-20T02:03:30.000Z",
      session_id: "foreign-session",
      conversation_id: "foreign-session",
      tool_name: "Shell",
      tool_output: "private failure",
      workspace_roots: [path.join(root, "workspace", "other")],
    },
  ]);

  const analyzer = new CursorSessionAnalyzer();
  const discovery = await analyzer.analyze({ command: "sources", workspace, home });
  assert.equal(discovery.sessions.length, 1);
  assert.deepEqual(discovery.sessions[0].sourceKinds, [
    "cursor-agent-transcript",
    "cursor-audit-jsonl",
    "cursor-chat-meta",
  ]);
  const scope = await analyzer.resolveScope({ workspace, home });
  const events = await analyzer.readSession(discovery.sessions[0], scope, {
    includeCommandText: true,
    includeUserText: true,
  });
  assert.equal(events.filter((event) => event.type === "tool.call").length, 2);
  assert.equal(events.filter((event) => event.type === "tool.result").length, 1);
  assert.equal(events.some((event) => event.sessionId === "foreign-session"), false);
  assert.equal(events.find((event) => event.usageFieldsObserved)?.modelUsage.inputTokens, 20);
  const duration = measureLongSessionRows(discovery.sessions, events).rows[0];
  assert.equal(duration.activeTimeObserved, true);
  const facts = await analyzer.analyze({ command: "facts", workspace, home, limit: 1 });
  assert.equal(facts.scope.platform, "cursor");
  assert.equal(facts.schemaVersion, 3);
  assert.equal(facts.sourceCoverage.status, "observed");
  assert.deepEqual(facts.sourceCoverage.transcript, {
    workspaceSessions: 1,
    inWindowSessions: 1,
    outOfWindowSessions: 0,
    timeUnobservedSessions: 0,
    relevantSessions: 1,
    withConversation: 1,
    withRequest: 1,
    terminalOnly: 0,
    unreadable: 0,
  });
  assert.equal(facts.sourceCoverage.joins.chatMetadata.matchedRelevantSessions, 1);
  assert.equal(facts.sourceCoverage.joins.audit.matchedRelevantSessions, 1);
  assert.doesNotMatch(JSON.stringify(facts), new RegExp(sessionId, "u"));
});

test("Cursor metadata without audit keeps active time unobserved instead of zero", async () => {
  const root = await fixtureRoot("session-cursor-unobserved-");
  const home = path.join(root, ".cursor");
  const workspace = path.join(root, "workspace", "project");
  const sessionId = "33333333-3333-4333-8333-333333333333";
  const slug = workspaceToCursorSlugVariants(workspace)[0];
  await writeJsonl(path.join(home, "projects", slug, "agent-transcripts", sessionId, `${sessionId}.jsonl`), [
    { role: "user", message: { content: [{ type: "text", text: "Analyze this" }] } },
    { role: "assistant", message: { content: [{ type: "text", text: "Done" }] } },
  ]);
  const metaPath = path.join(home, "chats", "hash", sessionId, "meta.json");
  await mkdir(path.dirname(metaPath), { recursive: true });
  await writeFile(metaPath, JSON.stringify({
    schemaVersion: 1,
    cwd: workspace,
    createdAtMs: Date.parse("2026-07-20T02:00:00.000Z"),
    updatedAtMs: Date.parse("2026-07-20T05:00:00.000Z"),
    hasConversation: true,
  }));
  const result = await new CursorSessionAnalyzer().analyze({
    command: "facets",
    workspace,
    home,
    selection: "all-eligible",
  });
  assert.equal(result.facets.longSessions.longActiveCount, 0);
  assert.equal(result.facets.longSessions.topByWall[0].activeMs, null);
  assert.equal(result.facets.longSessions.topByWall[0].activeTimeObserved, false);
  assert.ok(result.warnings.some((warning) => warning.code === "cursor-audit-partial"));

  const facts = await new CursorSessionAnalyzer().analyze({
    command: "facts",
    workspace,
    home,
    selection: "all-eligible",
  });
  assert.equal(facts.sourceCoverage.status, "partial");
  assert.equal(facts.sourceCoverage.transcript.withRequest, 1);
  assert.equal(facts.sourceCoverage.joins.chatMetadata.matchedRelevantSessions, 1);
  assert.equal(facts.sourceCoverage.joins.audit.sourceAvailable, false);
  assert.ok(facts.warningCodes.includes("cursor-audit-partial"));
  assert.ok(facts.diagnosticFlags.includes("source-coverage-partial"));
});

test("Cursor facts distinguish absent, terminal-only, and unreadable transcripts", async () => {
  const root = await fixtureRoot("session-cursor-coverage-");
  const home = path.join(root, ".cursor");
  const workspace = path.join(root, "workspace", "project");
  const slug = workspaceToCursorSlugVariants(workspace)[0];
  const missing = await new CursorSessionAnalyzer().analyze({
    command: "facts",
    workspace,
    home,
    selection: "all-eligible",
  });
  assert.equal(missing.sourceCoverage.status, "absent");
  assert.equal(missing.sourceCoverage.transcript.workspaceSessions, 0);
  assert.ok(missing.warningCodes.includes("cursor-workspace-transcripts-absent"));

  const terminalId = "55555555-5555-4555-8555-555555555555";
  const invalidId = "66666666-6666-4666-8666-666666666666";
  await writeJsonl(
    path.join(home, "projects", slug, "agent-transcripts", terminalId, `${terminalId}.jsonl`),
    [{ type: "turn_ended", status: "completed", error: null }],
  );
  const invalidPath = path.join(
    home,
    "projects",
    slug,
    "agent-transcripts",
    invalidId,
    `${invalidId}.jsonl`,
  );
  await mkdir(path.dirname(invalidPath), { recursive: true });
  await writeFile(invalidPath, "not-json\n");

  const incomplete = await new CursorSessionAnalyzer().analyze({
    command: "facts",
    workspace,
    home,
    selection: "all-eligible",
  });
  assert.equal(incomplete.sourceCoverage.status, "unobserved");
  assert.equal(incomplete.sourceCoverage.transcript.workspaceSessions, 2);
  assert.equal(incomplete.sourceCoverage.transcript.timeUnobservedSessions, 2);
  assert.equal(incomplete.sourceCoverage.transcript.relevantSessions, 2);
  assert.equal(incomplete.sourceCoverage.transcript.withRequest, 0);
  assert.equal(incomplete.sourceCoverage.transcript.terminalOnly, 1);
  assert.equal(incomplete.sourceCoverage.transcript.unreadable, 1);
  assert.ok(incomplete.warningCodes.includes("cursor-transcript-content-unobserved"));
  assert.ok(incomplete.diagnosticFlags.includes("source-coverage-unobserved"));
  const serialized = JSON.stringify(incomplete);
  assert.doesNotMatch(serialized, new RegExp(`${terminalId}|${invalidId}`, "u"));
  assert.equal(serialized.includes(root), false);
});

test("Cursor time filters use metadata before excluding out-of-window transcripts", async () => {
  const root = await fixtureRoot("session-cursor-time-filter-");
  const home = path.join(root, ".cursor");
  const workspace = path.join(root, "workspace", "project");
  const sessionId = "44444444-4444-4444-8444-444444444444";
  const slug = workspaceToCursorSlugVariants(workspace)[0];
  await writeJsonl(path.join(home, "projects", slug, "agent-transcripts", sessionId, `${sessionId}.jsonl`), [
    { role: "user", message: { content: [{ type: "text", text: "Old session" }] } },
  ]);
  const metaPath = path.join(home, "chats", "hash", sessionId, "meta.json");
  await mkdir(path.dirname(metaPath), { recursive: true });
  await writeFile(metaPath, JSON.stringify({
    schemaVersion: 1,
    cwd: workspace,
    createdAtMs: Date.parse("2026-07-01T02:00:00.000Z"),
    updatedAtMs: Date.parse("2026-07-01T02:04:00.000Z"),
    hasConversation: true,
  }));

  const result = await new CursorSessionAnalyzer().analyze({
    command: "sources",
    workspace,
    home,
    since: "2026-07-20",
  });
  assert.equal(result.sessions.length, 0);

  const facts = await new CursorSessionAnalyzer().analyze({
    command: "facts",
    workspace,
    home,
    since: "2026-07-20",
    selection: "all-eligible",
  });
  assert.equal(facts.sourceCoverage.status, "out-of-window");
  assert.equal(facts.sourceCoverage.transcript.workspaceSessions, 1);
  assert.equal(facts.sourceCoverage.transcript.inWindowSessions, 0);
  assert.equal(facts.sourceCoverage.transcript.outOfWindowSessions, 1);
  assert.equal(facts.sourceCoverage.transcript.relevantSessions, 0);
});

test("Qwen provider expands function calls and tool results from parts", async () => {
  const root = await fixtureRoot("session-qwen-provider-");
  const home = path.join(root, ".qwen");
  const workspace = path.join(root, "workspace", "project");
  const sessionId = "33333333-3333-4333-8333-333333333333";
  const slug = workspaceToQwenSlugVariants(workspace)[0];
  await writeJsonl(path.join(home, "projects", slug, "chats", `${sessionId}.jsonl`), [
    {
      type: "user",
      sessionId,
      cwd: workspace,
      timestamp: "2026-07-20T01:00:00.000Z",
      message: { role: "user", parts: [{ text: "Implement the provider and run tests" }] },
    },
    {
      type: "assistant",
      sessionId,
      cwd: workspace,
      timestamp: "2026-07-20T01:01:00.000Z",
      model: "qwen-fixture",
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, totalTokenCount: 14, cachedContentTokenCount: 0 },
      contextWindowSize: 131072,
      message: {
        role: "model",
        parts: [
          { text: "I will inspect and validate it." },
          { functionCall: { id: "tool-1", name: "Bash", args: { command: "npm test" } } },
          { functionCall: { id: "tool-2", name: "Read", args: { file_path: path.join(workspace, "package.json") } } },
        ],
      },
    },
    {
      type: "tool_result",
      sessionId,
      cwd: workspace,
      timestamp: "2026-07-20T01:02:00.000Z",
      message: { role: "tool", parts: [{ functionResponse: { id: "tool-1", name: "Bash", response: { output: "3 tests passed" } } }] },
      toolCallResult: { callId: "tool-1", status: "success", resultDisplay: "3 tests passed" },
    },
    {
      type: "tool_result",
      sessionId,
      cwd: workspace,
      timestamp: "2026-07-20T01:03:00.000Z",
      message: { role: "tool", parts: [{ functionResponse: { id: "tool-2", name: "Read", response: { error: "not found" } } }] },
      toolCallResult: { callId: "tool-2", status: "error", resultDisplay: "not found", errorType: "FileNotFound" },
    },
  ]);

  const analyzer = new QwenSessionAnalyzer();
  const discovery = await analyzer.analyze({ command: "sources", workspace, home });
  assert.equal(discovery.sessions.length, 1);
  assert.deepEqual(discovery.sources.map((source) => source.kind), ["qwen-project-jsonl"]);
  const scope = await analyzer.resolveScope({ workspace, home });
  const events = await analyzer.readSession(discovery.sessions[0], scope, {
    includeCommandText: true,
    includeUserText: true,
    includeContent: true,
  });
  assert.equal(events.filter((event) => event.type === "tool.call").length, 2);
  assert.equal(events.filter((event) => event.type === "tool.result").length, 2);
  assert.equal(events.find((event) => event.model === "qwen-fixture")?.modelUsage.inputTokens, 10);
  assert.equal(events.find((event) => event.toolInvocationId === "tool-2")?.filePath, path.join(workspace, "package.json"));
  assert.equal(events.find((event) => event.toolInvocationId === "tool-2" && event.type === "tool.result")?.success, false);
  const insights = await analyzer.analyze({ command: "insights", workspace, home, selection: "all-eligible" });
  assert.equal(insights.insights.keySignals.usageEfficiency.coverage.responseCount, 1);
  assert.equal(insights.insights.keySignals.usageEfficiency.tokenTotals.inputTokens, 10);
  const facts = await analyzer.analyze({ command: "facts", workspace, home, limit: 1 });
  assert.equal(facts.kind, "session-core-facts");
  assert.equal(facts.scope.platform, "qwen");
  assert.doesNotMatch(JSON.stringify(facts), new RegExp(sessionId, "u"));
  assert.doesNotMatch(JSON.stringify(facts), new RegExp(home.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
});

test("Qwen provider rejects a transcript whose embedded cwd belongs to another workspace", async () => {
  const root = await fixtureRoot("session-qwen-isolation-");
  const home = path.join(root, ".qwen");
  const workspace = path.join(root, "workspace", "target");
  const slug = workspaceToQwenSlugVariants(workspace)[0];
  await writeJsonl(path.join(home, "projects", slug, "chats", "foreign.jsonl"), [{
    type: "user",
    sessionId: "foreign",
    cwd: path.join(root, "workspace", "other"),
    timestamp: "2026-07-20T01:00:00.000Z",
    message: { role: "user", parts: [{ text: "foreign" }] },
  }]);
  const result = await new QwenSessionAnalyzer().analyze({ command: "sources", workspace, home });
  assert.equal(result.sessions.length, 0);
});

test("Copilot workspace descriptors parse the session cwd binding", () => {
  const descriptor = parseWorkspaceDescriptor([
    "id: 831cdd03-a101-4246-8809-5d7a80dd48be",
    "cwd: C:\\workspace\\project",
    "client_name: github/autopilot",
    "summary_count: 5",
  ].join("\n"));
  assert.equal(descriptor.id, "831cdd03-a101-4246-8809-5d7a80dd48be");
  assert.equal(descriptor.cwd, "C:\\workspace\\project");
});

test("Copilot provider pairs tool lifecycle, hooks, and subagent delegation", async () => {
  const root = await fixtureRoot("copilot-provider-");
  const home = path.join(root, ".copilot");
  const workspace = path.join(root, "workspace", "project");
  const sessionDir = path.join(home, "session-state", "session-a");
  await mkdir(workspace, { recursive: true });
  await mkdir(sessionDir, { recursive: true });
  await writeFile(path.join(sessionDir, "workspace.yaml"), `id: session-a\ncwd: ${workspace}\n`);
  await writeJsonl(path.join(sessionDir, "events.jsonl"), [
    { type: "session.start", id: "e1", timestamp: "2026-07-20T01:00:00.000Z", data: { sessionId: "session-a", selectedModel: "test-model", context: { cwd: workspace } } },
    { type: "user.message", id: "e2", timestamp: "2026-07-20T01:00:01.000Z", data: { content: "run the tests" } },
    { type: "hook.start", id: "e3", timestamp: "2026-07-20T01:00:02.000Z", data: { hookInvocationId: "h1", hookType: "userPromptSubmitted" } },
    { type: "hook.end", id: "e4", timestamp: "2026-07-20T01:00:03.000Z", data: { hookInvocationId: "h1", hookType: "userPromptSubmitted", success: true } },
    { type: "assistant.message", id: "e5", timestamp: "2026-07-20T01:00:04.000Z", data: { model: "test-model", content: "running" } },
    { type: "tool.execution_start", id: "e6", timestamp: "2026-07-20T01:00:05.000Z", data: { toolCallId: "t1", toolName: "bash", arguments: { command: "npm test" } } },
    { type: "tool.execution_complete", id: "e7", timestamp: "2026-07-20T01:00:06.000Z", data: { toolCallId: "t1", success: true, result: { content: "Tests: 1 failed, 2 passed" } } },
    { type: "subagent.started", id: "e8", timestamp: "2026-07-20T01:00:07.000Z", data: { toolCallId: "s1", agentName: "research" } },
    { type: "subagent.completed", id: "e9", timestamp: "2026-07-20T01:00:08.000Z", data: { toolCallId: "s1", agentName: "research", totalTokens: 42, totalToolCalls: 3 } },
    { type: "brand.new.event", id: "e10", timestamp: "2026-07-20T01:00:09.000Z", data: {} },
  ]);

  const analyzer = new CopilotSessionAnalyzer();
  const scope = await analyzer.resolveScope({ workspace, home });
  const roots = await analyzer.discoverSourceRoots(scope);
  const sessions = await analyzer.discoverSessions(scope, roots);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].sessionId, "session-a");

  const events = await analyzer.readSession(sessions[0], scope, { includeCommandText: true });
  const byType = new Map(events.map((event) => [event.type, event]));
  assert.equal(byType.get("tool.call").toolName, "bash");
  assert.equal(byType.get("tool.call").commandText, "npm test");
  assert.equal(byType.get("tool.result").success, true);
  assert.deepEqual(byType.get("tool.result").resultFacts, { testsFailed: 1, testsPassed: 2 });
  assert.equal(byType.get("hook.call").hookEvent, "userPromptSubmitted");
  assert.equal(byType.get("hook.result").success, true);
  assert.equal(byType.get("subagent.start").subagentName, "research");
  assert.equal(byType.get("subagent.stop").subagentTotalTokens, 42);
  assert.ok(byType.has("metadata.brand.new.event"));
  assert.equal(events.some((event) => event.modelUsage), false);

  const coverage = analyzer.factsSourceCoverage(scope);
  assert.equal(coverage.status, "observed");
  assert.equal(coverage.usage.perResponseUsageObserved, false);
});

test("Copilot provider keeps transcript-less workspace sessions explicit", async () => {
  const root = await fixtureRoot("copilot-partial-");
  const home = path.join(root, ".copilot");
  const workspace = path.join(root, "workspace", "project");
  const withTranscript = path.join(home, "session-state", "session-a");
  const withoutTranscript = path.join(home, "session-state", "session-b");
  await mkdir(workspace, { recursive: true });
  await mkdir(withTranscript, { recursive: true });
  await mkdir(withoutTranscript, { recursive: true });
  await writeFile(path.join(withTranscript, "workspace.yaml"), `id: session-a\ncwd: ${workspace}\n`);
  await writeFile(path.join(withoutTranscript, "workspace.yaml"), `id: session-b\ncwd: ${workspace}\n`);
  await writeJsonl(path.join(withTranscript, "events.jsonl"), [
    { type: "user.message", id: "e1", timestamp: "2026-07-20T01:00:00.000Z", data: { content: "hello" } },
  ]);

  const analyzer = new CopilotSessionAnalyzer();
  const scope = await analyzer.resolveScope({ workspace, home });
  const roots = await analyzer.discoverSourceRoots(scope);
  const sessions = await analyzer.discoverSessions(scope, roots);
  assert.equal(sessions.length, 1);

  const coverage = analyzer.factsSourceCoverage(scope);
  assert.equal(coverage.status, "partial");
  assert.equal(coverage.transcript.workspaceSessions, 2);
  assert.equal(coverage.transcript.withoutTranscript, 1);

  const warnings = await analyzer.analysisWarnings(scope, roots, sessions);
  assert.ok(warnings.some((warning) => warning.code === "copilot-session-transcript-partial"));
  assert.ok(warnings.some((warning) => warning.code === "copilot-per-response-usage-unobserved"));
});

test("Copilot provider ignores sessions from another workspace", async () => {
  const root = await fixtureRoot("copilot-foreign-");
  const home = path.join(root, ".copilot");
  const workspace = path.join(root, "workspace", "project");
  const sessionDir = path.join(home, "session-state", "session-foreign");
  await mkdir(workspace, { recursive: true });
  await mkdir(sessionDir, { recursive: true });
  await writeFile(path.join(sessionDir, "workspace.yaml"), `id: session-foreign\ncwd: ${path.join(root, "workspace", "other")}\n`);
  await writeJsonl(path.join(sessionDir, "events.jsonl"), [
    { type: "user.message", id: "e1", timestamp: "2026-07-20T01:00:00.000Z", data: { content: "foreign" } },
  ]);

  const analyzer = new CopilotSessionAnalyzer();
  const scope = await analyzer.resolveScope({ workspace, home });
  const roots = await analyzer.discoverSourceRoots(scope);
  assert.equal((await analyzer.discoverSessions(scope, roots)).length, 0);
  assert.equal(analyzer.factsSourceCoverage(scope).status, "absent");
});
