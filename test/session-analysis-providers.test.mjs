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
  PiSessionAnalyzer,
  workspaceToPiSessionDirVariants,
} from "../scripts/session-analysis/platforms/pi.mjs";
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
  assert.ok(await createAnalyzer("pi") instanceof PiSessionAnalyzer);
  assert.ok(await createCapabilityAnalyzer("claude") instanceof ClaudeSessionAnalyzer);
  assert.ok(await createCapabilityAnalyzer("cursor") instanceof CursorSessionAnalyzer);
  assert.ok(await createCapabilityAnalyzer("qwen") instanceof QwenSessionAnalyzer);
  assert.ok(await createCapabilityAnalyzer("copilot") instanceof CopilotSessionAnalyzer);
  assert.ok(await createCapabilityAnalyzer("pi") instanceof PiSessionAnalyzer);
});

test("Claude, Cursor, and Qwen workspace slugs cover Unix and Windows layouts", () => {
  assert.ok(workspaceToClaudeSlugVariants("/workspace/project").includes("-workspace-project"));
  assert.ok(workspaceToCursorSlugVariants("/workspace/project").includes("workspace-project"));
  assert.ok(workspaceToQwenSlugVariants("/workspace/project").includes("-workspace-project"));
  assert.equal(workspaceToPiSessionDirVariants("/workspace/project").exact, "--workspace-project--");
  assert.ok(workspaceToClaudeSlugVariants("C:\\workspace\\project").some((value) => value.includes("C--workspace-project")));
  assert.ok(workspaceToCursorSlugVariants("C:\\workspace\\project").some((value) => value.includes("C--workspace-project")));
  assert.ok(workspaceToQwenSlugVariants("C:\\workspace\\project").some((value) => value.includes("C--workspace-project")));
  assert.ok(workspaceToPiSessionDirVariants("C:\\workspace\\project").exact.includes("C--workspace-project"));
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
    { type: "assistant.message", id: "e5", timestamp: "2026-07-20T01:00:04.000Z", data: { model: "test-model", content: "running", messageId: "m1", requestId: "r1", outputTokens: 128 } },
    { type: "tool.execution_start", id: "e6", timestamp: "2026-07-20T01:00:05.000Z", data: { toolCallId: "t1", toolName: "bash", arguments: { command: "npm test" } } },
    { type: "tool.execution_complete", id: "e7", timestamp: "2026-07-20T01:00:06.000Z", data: { toolCallId: "t1", success: true, result: { content: "Tests: 1 failed, 2 passed" } } },
    { type: "subagent.started", id: "e8", timestamp: "2026-07-20T01:00:07.000Z", data: { toolCallId: "s1", agentName: "research" } },
    { type: "subagent.completed", id: "e9", timestamp: "2026-07-20T01:00:08.000Z", data: { toolCallId: "s1", agentName: "research", totalTokens: 42, totalToolCalls: 3 } },
    { type: "brand.new.event", id: "e10", timestamp: "2026-07-20T01:00:09.000Z", data: {} },
    { type: "assistant.message", id: "e11", timestamp: "2026-07-20T01:00:10.000Z", data: { model: "test-model", content: "done", messageId: "m2" } },
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

  // Copilot reports output tokens per assistant message. They ride a companion
  // response event because `isModelRequestEvent` ignores plain assistant events,
  // and only the observed field is carried -- no input tokens or cost.
  const responses = events.filter((event) => event.type === "model.response.completed");
  assert.equal(responses.length, 1);
  assert.deepEqual(responses[0].modelUsage, { outputTokens: 128 });
  assert.equal(responses[0].usageFieldsObserved, true);
  assert.equal(responses[0].responseId, "m1");
  assert.equal(responses[0].requestId, "r1");
  assert.equal(responses[0].model, "test-model");
  const assistants = events.filter((event) => event.type === "assistant");
  assert.equal(assistants.length, 2);
  // Model attribution moves to the companion so one response is not counted twice.
  assert.equal(assistants[0].model, undefined);
  // An assistant message without observed usage keeps its own attribution.
  assert.equal(assistants[1].model, "test-model");

  const coverage = analyzer.factsSourceCoverage(scope);
  assert.equal(coverage.status, "observed");
  assert.equal(coverage.usage.perResponseUsageObserved, true);
  assert.deepEqual(coverage.usage.perResponseUsageFields, ["outputTokens"]);
  assert.equal(coverage.transcript.withConversation, 1);
  assert.equal(coverage.transcript.withRequest, 1);
  assert.equal(coverage.transcript.terminalOnly, 0);
  assert.equal(coverage.transcript.unreadable, 0);
});

test("Copilot provider maps the permission request and result pair without payloads", async () => {
  const root = await fixtureRoot("copilot-permission-");
  const home = path.join(root, ".copilot");
  const workspace = path.join(root, "workspace", "project");
  const sessionDir = path.join(home, "session-state", "session-p");
  await mkdir(workspace, { recursive: true });
  await mkdir(sessionDir, { recursive: true });
  await writeFile(path.join(sessionDir, "workspace.yaml"), `id: session-p\ncwd: ${workspace}\n`);
  await writeJsonl(path.join(sessionDir, "events.jsonl"), [
    { type: "user.message", id: "e1", timestamp: "2026-07-20T01:00:00.000Z", data: { content: "read it" } },
    {
      type: "permission.requested",
      id: "e2",
      timestamp: "2026-07-20T01:00:01.000Z",
      data: {
        requestId: "req-1",
        permissionRequest: { kind: "read", toolCallId: "t1", intention: "Read file: C:\\secret\\notes.md", path: "C:\\secret\\notes.md" },
        promptRequest: { kind: "path", accessKind: "read", paths: ["C:\\secret\\notes.md"], toolCallId: "t1" },
      },
    },
    { type: "permission.completed", id: "e3", timestamp: "2026-07-20T01:00:02.000Z", data: { requestId: "req-1", toolCallId: "t1", result: { kind: "approved" } } },
    {
      type: "permission.requested",
      id: "e4",
      timestamp: "2026-07-20T01:00:03.000Z",
      data: {
        requestId: "req-2",
        permissionRequest: { kind: "shell", toolCallId: "t2", intention: "Run: rm -rf /" },
        promptRequest: { kind: "commands", commands: ["rm -rf /"], toolCallId: "t2" },
      },
    },
    { type: "permission.completed", id: "e5", timestamp: "2026-07-20T01:00:04.000Z", data: { requestId: "req-2", toolCallId: "t2", result: { kind: "denied-interactively-by-user" } } },
    // A re-prompt reuses the tool call id; both requests must survive dedupe.
    {
      type: "permission.requested",
      id: "e6",
      timestamp: "2026-07-20T01:00:05.000Z",
      data: { requestId: "req-3", permissionRequest: { kind: "shell", toolCallId: "t2" } },
    },
    { type: "permission.completed", id: "e7", timestamp: "2026-07-20T01:00:06.000Z", data: { requestId: "req-3", toolCallId: "t2", result: { kind: "approved-for-location" } } },
    { type: "session.permissions_changed", id: "e8", timestamp: "2026-07-20T01:00:07.000Z", data: {} },
  ]);

  const analyzer = new CopilotSessionAnalyzer();
  const scope = await analyzer.resolveScope({ workspace, home });
  const roots = await analyzer.discoverSourceRoots(scope);
  const sessions = await analyzer.discoverSessions(scope, roots);
  const events = await analyzer.readSession(sessions[0], scope, { includeCommandText: true });

  const permissions = events.filter((event) => event.type === "control.permission");
  assert.equal(permissions.length, 6);
  assert.deepEqual(
    permissions.map((event) => [event.lifecyclePhase, event.permissionRequestId, event.permissionKind ?? null, event.permissionDecision ?? null]),
    [
      ["request", "req-1", "read", null],
      ["result", "req-1", null, "allowed"],
      ["request", "req-2", "shell", null],
      ["result", "req-2", null, "denied"],
      ["request", "req-3", "shell", null],
      ["result", "req-3", null, "allowed"],
    ],
  );
  // The lifecycle stays additive: the mode/permission change event is unaffected.
  assert.ok(events.some((event) => event.type === "control.change"));

  // No prompt payload may survive normalization, even with content opted in.
  const serialized = JSON.stringify(permissions);
  for (const payload of ["secret", "notes.md", "rm -rf", "Read file", "intention", "paths"]) {
    assert.ok(!serialized.includes(payload), `permission events leaked ${payload}`);
  }
  // Tool call ids are deliberately not carried on `toolInvocationId`: dedupe keys
  // on that field and a re-prompt would be dropped as a duplicate.
  assert.ok(permissions.every((event) => event.toolInvocationId === undefined));
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
  // The missing transcript survives inside the canonical contract instead of
  // being dropped when public facts are bounded.
  assert.equal(coverage.transcript.relevantSessions, 2);
  assert.equal(coverage.transcript.withConversation, 1);
  assert.equal(coverage.transcript.withRequest, 0);
  assert.equal(coverage.transcript.unreadable, 1);
  assert.equal(coverage.transcript.terminalOnly, 0);
  assert.equal(coverage.usage.perResponseUsageObserved, false);

  const warnings = await analyzer.analysisWarnings(scope, roots, sessions);
  assert.ok(warnings.some((warning) => warning.code === "copilot-session-transcript-partial"));
  assert.ok(warnings.some((warning) => warning.code === "copilot-per-response-usage-partial"));
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

test("Pi provider expands tool calls, tool results, and usage from v3 transcripts", async () => {
  const root = await fixtureRoot("session-pi-provider-");
  const home = path.join(root, ".pi", "agent");
  const workspace = path.join(root, "workspace", "project");
  const sessionId = "44444444-4444-4444-8444-444444444444";
  const dirName = workspaceToPiSessionDirVariants(workspace).exact;
  await writeJsonl(path.join(home, "sessions", dirName, `2026-07-20T01-00-00-000Z_${sessionId}.jsonl`), [
    { type: "session", version: 3, id: sessionId, timestamp: "2026-07-20T01:00:00.000Z", cwd: workspace },
    {
      type: "message",
      id: "aa1",
      parentId: null,
      timestamp: "2026-07-20T01:00:10.000Z",
      message: { role: "user", content: [{ type: "text", text: "Implement the provider and run tests" }], timestamp: 1784509210000 },
    },
    {
      type: "message",
      id: "aa2",
      parentId: "aa1",
      timestamp: "2026-07-20T01:01:00.000Z",
      message: {
        role: "assistant",
        model: "pi-fixture",
        provider: "anthropic",
        stopReason: "toolUse",
        usage: { input: 10, output: 4, cacheRead: 2, cacheWrite: 1, totalTokens: 14, cost: { total: 0 } },
        content: [
          { type: "thinking", thinking: "inspect first" },
          { type: "text", text: "I will inspect and validate it." },
          { type: "toolCall", id: "tool-1", name: "bash", arguments: { command: "npm test" } },
          { type: "toolCall", id: "tool-2", name: "read", arguments: { path: path.join(workspace, "package.json") } },
        ],
      },
    },
    {
      type: "message",
      id: "aa3",
      parentId: "aa2",
      timestamp: "2026-07-20T01:02:00.000Z",
      message: { role: "toolResult", toolCallId: "tool-1", toolName: "bash", isError: false, content: [{ type: "text", text: "3 tests passed" }] },
    },
    {
      type: "message",
      id: "aa4",
      parentId: "aa3",
      timestamp: "2026-07-20T01:03:00.000Z",
      message: { role: "toolResult", toolCallId: "tool-2", toolName: "read", isError: true, content: [{ type: "text", text: "not found" }] },
    },
    { type: "model_change", id: "aa5", parentId: "aa4", timestamp: "2026-07-20T01:03:30.000Z", provider: "anthropic", modelId: "pi-fixture" },
  ]);

  const analyzer = new PiSessionAnalyzer();
  const discovery = await analyzer.analyze({ command: "sources", workspace, home });
  assert.equal(discovery.sessions.length, 1);
  assert.equal(discovery.sessions[0].sessionId, sessionId);
  assert.deepEqual(discovery.sources.map((source) => source.kind), ["pi-session-jsonl"]);
  const scope = await analyzer.resolveScope({ workspace, home });
  const events = await analyzer.readSession(discovery.sessions[0], scope, {
    includeCommandText: true,
    includeUserText: true,
    includeContent: true,
  });
  assert.equal(events.filter((event) => event.type === "tool.call").length, 2);
  assert.equal(events.filter((event) => event.type === "tool.result").length, 2);
  assert.equal(events.find((event) => event.type === "user")?.userText, "Implement the provider and run tests");
  assert.equal(events.find((event) => event.model === "pi-fixture")?.modelUsage.inputTokens, 10);
  assert.equal(events.find((event) => event.model === "pi-fixture")?.modelUsage.cacheReadInputTokens, 2);
  assert.equal(events.find((event) => event.toolInvocationId === "tool-1" && event.type === "tool.call")?.commandText, "npm test");
  assert.equal(events.find((event) => event.toolInvocationId === "tool-2" && event.type === "tool.call")?.filePath, path.join(workspace, "package.json"));
  assert.equal(events.find((event) => event.toolInvocationId === "tool-2" && event.type === "tool.result")?.success, false);
  assert.ok(events.some((event) => event.type === "metadata.model_change"));
  const insights = await analyzer.analyze({ command: "insights", workspace, home, selection: "all-eligible" });
  assert.equal(insights.insights.keySignals.usageEfficiency.coverage.responseCount, 1);
  assert.equal(insights.insights.keySignals.usageEfficiency.tokenTotals.inputTokens, 10);
  const facts = await analyzer.analyze({ command: "facts", workspace, home, limit: 1 });
  assert.equal(facts.kind, "session-core-facts");
  assert.equal(facts.scope.platform, "pi");
  assert.doesNotMatch(JSON.stringify(facts), new RegExp(sessionId, "u"));
  assert.doesNotMatch(JSON.stringify(facts), new RegExp(home.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
});

test("Pi provider rejects a transcript whose header cwd belongs to another workspace", async () => {
  const root = await fixtureRoot("session-pi-isolation-");
  const home = path.join(root, ".pi", "agent");
  const workspace = path.join(root, "workspace", "target");
  const dirName = workspaceToPiSessionDirVariants(workspace).exact;
  await writeJsonl(path.join(home, "sessions", dirName, "2026-07-20T01-00-00-000Z_foreign.jsonl"), [
    { type: "session", version: 3, id: "foreign", timestamp: "2026-07-20T01:00:00.000Z", cwd: path.join(root, "workspace", "other") },
    {
      type: "message",
      id: "bb1",
      parentId: null,
      timestamp: "2026-07-20T01:00:10.000Z",
      message: { role: "user", content: [{ type: "text", text: "foreign" }] },
    },
  ]);
  const result = await new PiSessionAnalyzer().analyze({ command: "sources", workspace, home });
  assert.equal(result.sessions.length, 0);
});

test("Pi provider requires one authoritative first session header", async () => {
  const root = await fixtureRoot("session-pi-header-boundary-");
  const home = path.join(root, ".pi", "agent");
  const workspace = path.join(root, "workspace", "target");
  const dirName = workspaceToPiSessionDirVariants(workspace).exact;
  await writeJsonl(path.join(home, "sessions", dirName, "late-header.jsonl"), [
    { type: "message", id: "x1", timestamp: "2026-07-20T01:00:00.000Z", message: { role: "user", content: "foreign" } },
    { type: "session", version: 3, id: "late", timestamp: "2026-07-20T01:00:01.000Z", cwd: workspace },
  ]);
  await writeJsonl(path.join(home, "sessions", dirName, "multiple-headers.jsonl"), [
    { type: "session", version: 3, id: "spliced", timestamp: "2026-07-20T01:00:00.000Z", cwd: workspace },
    { type: "message", id: "x2", timestamp: "2026-07-20T01:00:01.000Z", message: { role: "user", content: "target" } },
    { type: "session", version: 3, id: "foreign", timestamp: "2026-07-20T01:00:02.000Z", cwd: path.join(root, "workspace", "other") },
    { type: "message", id: "x3", timestamp: "2026-07-20T01:00:03.000Z", message: { role: "user", content: "foreign" } },
  ]);

  const result = await new PiSessionAnalyzer().analyze({ command: "sources", workspace, home });
  assert.equal(result.sessions.length, 0);
});

test("Pi provider discovers subdirectory session dirs that share the workspace prefix", async () => {
  const root = await fixtureRoot("session-pi-subdir-");
  const home = path.join(root, ".pi", "agent");
  const workspace = path.join(root, "workspace", "target");
  const subdir = path.join(workspace, "packages", "app");
  const dirName = workspaceToPiSessionDirVariants(subdir).exact;
  await writeJsonl(path.join(home, "sessions", dirName, "2026-07-20T01-00-00-000Z_child.jsonl"), [
    { type: "session", version: 3, id: "55555555-5555-4555-8555-555555555555", timestamp: "2026-07-20T01:00:00.000Z", cwd: subdir },
    {
      type: "message",
      id: "cc1",
      parentId: null,
      timestamp: "2026-07-20T01:00:10.000Z",
      message: { role: "user", content: [{ type: "text", text: "child session" }] },
    },
  ]);
  const result = await new PiSessionAnalyzer().analyze({ command: "sources", workspace, home });
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sources[0].path, path.join(home, "sessions", dirName));
});

test("Pi treats a configured session directory as the exact flat JSONL directory", async () => {
  const root = await fixtureRoot("session-pi-custom-dir-");
  const home = path.join(root, ".pi", "agent");
  const workspace = path.join(root, "workspace", "target");
  const customDir = path.join(root, "shared-sessions");
  const header = (id, cwd) => ({ type: "session", version: 3, id, timestamp: "2026-07-20T01:00:00.000Z", cwd });
  const userMessage = (id, text) => ({
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-07-20T01:00:10.000Z",
    message: { role: "user", content: [{ type: "text", text }] },
  });
  await writeJsonl(path.join(customDir, "2026-07-20T01-00-00-000Z_match.jsonl"), [
    header("66666666-6666-4666-8666-666666666666", workspace),
    userMessage("dd1", "custom dir session"),
  ]);
  await writeJsonl(path.join(customDir, "2026-07-20T01-00-00-000Z_foreign.jsonl"), [
    header("foreign", path.join(root, "workspace", "other")),
    userMessage("dd2", "foreign session"),
  ]);
  // A default-tree session must not be read while a custom directory is active.
  const treeDir = workspaceToPiSessionDirVariants(workspace).exact;
  await writeJsonl(path.join(home, "sessions", treeDir, "2026-07-20T01-00-00-000Z_tree.jsonl"), [
    header("77777777-7777-4777-8777-777777777777", workspace),
    userMessage("dd3", "default tree session"),
  ]);

  const analyzer = new PiSessionAnalyzer();
  const result = await analyzer.analyze({ command: "sources", workspace, home, "session-dir": customDir });
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].sessionId, "66666666-6666-4666-8666-666666666666");
  assert.equal(result.sources[0].exists, true);
});

test("Pi resolves the session directory as CLI over environment over settings over default", async () => {
  const root = await fixtureRoot("session-pi-precedence-");
  const home = path.join(root, ".pi", "agent");
  const workspace = path.join(root, "workspace", "target");
  const cliDir = path.join(root, "cli-dir");
  const envDir = path.join(root, "env-dir");
  const settingsDir = path.join(root, "settings-dir");
  const header = (id) => ({ type: "session", version: 3, id, timestamp: "2026-07-20T01:00:00.000Z", cwd: workspace });
  const userMessage = (id) => ({
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-07-20T01:00:10.000Z",
    message: { role: "user", content: [{ type: "text", text: "hello" }] },
  });
  await writeJsonl(path.join(cliDir, "a_cli-session.jsonl"), [header("cli-session"), userMessage("p1")]);
  await writeJsonl(path.join(envDir, "a_env-session.jsonl"), [header("env-session"), userMessage("p2")]);
  await writeJsonl(path.join(settingsDir, "a_settings-session.jsonl"), [header("settings-session"), userMessage("p3")]);
  await mkdir(path.join(workspace, ".pi"), { recursive: true });
  await writeFile(path.join(workspace, ".pi", "settings.json"), JSON.stringify({ sessionDir: settingsDir }));

  const analyzer = new PiSessionAnalyzer();
  const fromSettings = await analyzer.analyze({ command: "sources", workspace, home });
  assert.deepEqual(fromSettings.sessions.map((session) => session.sessionId), ["settings-session"]);

  const previousEnv = process.env.PI_CODING_AGENT_SESSION_DIR;
  try {
    process.env.PI_CODING_AGENT_SESSION_DIR = envDir;
    const fromEnv = await analyzer.analyze({ command: "sources", workspace, home });
    assert.deepEqual(fromEnv.sessions.map((session) => session.sessionId), ["env-session"]);
    const fromCli = await analyzer.analyze({ command: "sources", workspace, home, "session-dir": cliDir });
    assert.deepEqual(fromCli.sessions.map((session) => session.sessionId), ["cli-session"]);
  } finally {
    if (previousEnv === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR;
    else process.env.PI_CODING_AGENT_SESSION_DIR = previousEnv;
  }
});

test("Pi resolves relative configured session directories from the target workspace", async () => {
  const root = await fixtureRoot("session-pi-relative-dir-");
  const home = path.join(root, ".pi", "agent");
  const workspace = path.join(root, "workspace", "target");
  const relativeDir = path.join(".pi", "custom-sessions");
  const sessionId = "relative-session";
  await writeJsonl(path.join(workspace, relativeDir, "relative.jsonl"), [
    { type: "session", version: 3, id: sessionId, timestamp: "2026-07-20T01:00:00.000Z", cwd: workspace },
  ]);
  await mkdir(path.join(workspace, ".pi"), { recursive: true });
  await writeFile(path.join(workspace, ".pi", "settings.json"), JSON.stringify({ sessionDir: relativeDir }));

  const result = await new PiSessionAnalyzer().analyze({ command: "sources", workspace, home });
  assert.equal(result.sources[0].path, path.join(workspace, relativeDir));
  assert.deepEqual(result.sessions.map((session) => session.sessionId), [sessionId]);
});

test("Pi keeps partial and malformed usage explicit instead of zero-filling", async () => {
  const root = await fixtureRoot("session-pi-usage-");
  const home = path.join(root, ".pi", "agent");
  const workspace = path.join(root, "workspace", "project");
  const dirName = workspaceToPiSessionDirVariants(workspace).exact;
  await writeJsonl(path.join(home, "sessions", dirName, "2026-07-20T01-00-00-000Z_usage.jsonl"), [
    { type: "session", version: 3, id: "88888888-8888-4888-8888-888888888888", timestamp: "2026-07-20T01:00:00.000Z", cwd: workspace },
    {
      type: "message",
      id: "u1",
      parentId: null,
      timestamp: "2026-07-20T01:00:10.000Z",
      message: { role: "assistant", model: "pi-partial", content: [{ type: "text", text: "partial" }], usage: { output: 4 } },
    },
    {
      type: "message",
      id: "u2",
      parentId: "u1",
      timestamp: "2026-07-20T01:00:20.000Z",
      message: { role: "assistant", model: "pi-malformed", content: [{ type: "text", text: "malformed" }], usage: { input: "10", cacheRead: null } },
    },
  ]);

  const analyzer = new PiSessionAnalyzer();
  const discovery = await analyzer.analyze({ command: "sources", workspace, home });
  const scope = await analyzer.resolveScope({ workspace, home });
  const events = await analyzer.readSession(discovery.sessions[0], scope, {});
  const partial = events.find((event) => event.type === "model.response.completed");
  assert.deepEqual(partial.modelUsage, { outputTokens: 4 });
  assert.equal(Object.hasOwn(partial.modelUsage, "inputTokens"), false);
  assert.equal(Object.hasOwn(partial.modelUsage, "cacheReadInputTokens"), false);
  // Malformed usage fields never become zero; without one finite field there
  // is no usage event at all.
  assert.equal(events.filter((event) => event.type === "model.response.completed").length, 1);
});

test("Pi source roots stay absent without workspace-matching session directories", async () => {
  const root = await fixtureRoot("session-pi-absent-root-");
  const home = path.join(root, ".pi", "agent");
  const workspace = path.join(root, "workspace", "target");
  const foreignDir = workspaceToPiSessionDirVariants(path.join(root, "workspace", "other")).exact;
  await writeJsonl(path.join(home, "sessions", foreignDir, "2026-07-20T01-00-00-000Z_foreign.jsonl"), [
    { type: "session", version: 3, id: "foreign", timestamp: "2026-07-20T01:00:00.000Z", cwd: path.join(root, "workspace", "other") },
  ]);

  const result = await new PiSessionAnalyzer().analyze({ command: "sources", workspace, home });
  assert.equal(result.sources[0].exists, false);
  assert.equal(result.sessions.length, 0);
});

test("Pi custom session roots require a directory", async () => {
  const root = await fixtureRoot("session-pi-custom-root-file-");
  const home = path.join(root, ".pi", "agent");
  const workspace = path.join(root, "workspace", "target");
  const customPath = path.join(root, "not-a-directory.jsonl");
  await writeFile(customPath, "{}\n");

  const result = await new PiSessionAnalyzer().analyze({
    command: "sources",
    workspace,
    home,
    "session-dir": customPath,
  });
  assert.equal(result.sources[0].exists, false);
  assert.equal(result.sessions.length, 0);
});
