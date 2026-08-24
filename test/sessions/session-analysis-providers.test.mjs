import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  createAnalyzer,
  main as rootMain,
  SessionAnalyzer,
} from "../../scripts/session-analysis.mjs";
import {
  createAnalyzer as createCapabilityAnalyzer,
  main as capabilityMain,
  SessionAnalyzer as CapabilitySessionAnalyzer,
  SESSION_ANALYSIS_HELP,
} from "../../scripts/session-analysis/index.mjs";
import {
  ClaudeSessionAnalyzer,
  workspaceToClaudeSlugVariants,
} from "../../scripts/session-analysis/platforms/claude.mjs";
import {
  CursorSessionAnalyzer,
  workspaceToCursorSlugVariants,
} from "../../scripts/session-analysis/platforms/cursor.mjs";
import {
  PiSessionAnalyzer,
  workspaceToPiSessionDirVariants,
} from "../../scripts/session-analysis/platforms/pi.mjs";
import {
  QwenSessionAnalyzer,
  workspaceToQwenSlugVariants,
} from "../../scripts/session-analysis/platforms/qwen.mjs";
import {
  WorkbuddySessionAnalyzer,
  workspaceToWorkbuddySlugVariants,
} from "../../scripts/session-analysis/platforms/workbuddy.mjs";
import {
  GrokSessionAnalyzer,
  workspaceToGrokSessionDirName,
} from "../../scripts/session-analysis/platforms/grok.mjs";
import {
  CopilotSessionAnalyzer,
  parseWorkspaceDescriptor,
} from "../../scripts/session-analysis/platforms/copilot.mjs";
import { KimiSessionAnalyzer } from "../../scripts/session-analysis/platforms/kimi.mjs";
import { DshSessionAnalyzer } from "../../scripts/session-analysis/platforms/dsh.mjs";
import { measureLongSessionRows } from "../../scripts/session-analysis/long-sessions.mjs";

async function fixtureRoot(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeJsonl(filePath, rows) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

test("root dispatcher creates Claude and Cursor provider analyzers", async () => {
  assert.strictEqual(createAnalyzer, createCapabilityAnalyzer);
  assert.strictEqual(rootMain, capabilityMain);
  assert.strictEqual(SessionAnalyzer, CapabilitySessionAnalyzer);
  assert.ok(await createAnalyzer("claude") instanceof ClaudeSessionAnalyzer);
  assert.ok(await createAnalyzer("cursor") instanceof CursorSessionAnalyzer);
  assert.ok(await createAnalyzer("qwen") instanceof QwenSessionAnalyzer);
  assert.ok(await createAnalyzer("copilot") instanceof CopilotSessionAnalyzer);
  assert.ok(await createAnalyzer("pi") instanceof PiSessionAnalyzer);
  assert.ok(await createAnalyzer("workbuddy") instanceof WorkbuddySessionAnalyzer);
  assert.ok(await createAnalyzer("grok") instanceof GrokSessionAnalyzer);
  assert.ok(await createAnalyzer("dsh") instanceof DshSessionAnalyzer);
  assert.ok(await createCapabilityAnalyzer("claude") instanceof ClaudeSessionAnalyzer);
  assert.ok(await createCapabilityAnalyzer("cursor") instanceof CursorSessionAnalyzer);
  assert.ok(await createCapabilityAnalyzer("qwen") instanceof QwenSessionAnalyzer);
  assert.ok(await createCapabilityAnalyzer("copilot") instanceof CopilotSessionAnalyzer);
  assert.ok(await createCapabilityAnalyzer("pi") instanceof PiSessionAnalyzer);
  assert.ok(await createCapabilityAnalyzer("workbuddy") instanceof WorkbuddySessionAnalyzer);
  assert.ok(await createCapabilityAnalyzer("grok") instanceof GrokSessionAnalyzer);
  assert.ok(await createCapabilityAnalyzer("dsh") instanceof DshSessionAnalyzer);
  await assert.rejects(() => createAnalyzer("unknown-host"), /Unsupported session provider: unknown-host/u);
});

test("public session-analysis main preserves the bare help alias", async () => {
  let output = "";
  const result = await capabilityMain(["help"], {
    stdout: {
      write(value) {
        output += value;
      },
    },
  });

  assert.equal(result, 0);
  assert.equal(output, SESSION_ANALYSIS_HELP);
  assert.match(output, /\|dsh>/u);
  assert.match(output, /--dsh-home <dir>\s+DeepSeek Harness data root \(default: ~\/\.dsh or \$DSH_HOME\)/u);
});

test("Claude, Cursor, and Qwen workspace slugs cover Unix and Windows layouts", () => {
  assert.ok(workspaceToClaudeSlugVariants("/workspace/project").includes("-workspace-project"));
  assert.ok(workspaceToCursorSlugVariants("/workspace/project").includes("workspace-project"));
  assert.ok(workspaceToQwenSlugVariants("/workspace/project").includes("-workspace-project"));
  assert.equal(workspaceToPiSessionDirVariants("/workspace/project").exact, "--workspace-project--");
  assert.equal(workspaceToWorkbuddySlugVariants("/workspace/project").exact, "workspace-project");
  // Grok encodes path.resolve()'d absolute paths; keep the assertion host-portable.
  assert.equal(
    workspaceToGrokSessionDirName("/workspace/project"),
    encodeURIComponent(path.resolve("/workspace/project")),
  );
  assert.ok(workspaceToClaudeSlugVariants("C:\\workspace\\project").some((value) => value.includes("C--workspace-project")));
  assert.ok(workspaceToCursorSlugVariants("C:\\workspace\\project").some((value) => value.includes("C--workspace-project")));
  assert.ok(workspaceToQwenSlugVariants("C:\\workspace\\project").some((value) => value.includes("C--workspace-project")));
  assert.ok(workspaceToPiSessionDirVariants("C:\\workspace\\project").exact.includes("C--workspace-project"));
  assert.ok(workspaceToWorkbuddySlugVariants("C:\\workspace\\project").exact.includes("C--workspace-project"));
  assert.equal(
    workspaceToGrokSessionDirName("C:\\workspace\\project"),
    encodeURIComponent(path.resolve("C:\\workspace\\project")),
  );
});

test("Claude workspace slug folds dots the way Claude Code names project directories", () => {
  assert.equal(workspaceToClaudeSlugVariants("/Users/twurm/.claude")[0], "-Users-twurm--claude");
  assert.deepEqual(workspaceToClaudeSlugVariants("/work/my.project"), [
    "-work-my-project",
    "-work-my.project",
  ]);
  assert.deepEqual(workspaceToClaudeSlugVariants("/workspace/project"), ["-workspace-project"]);
});

test("Claude workspace slug folds underscores the way Claude Code names project directories", () => {
  const windowsVariants = workspaceToClaudeSlugVariants("c:\\work\\my_project");
  assert.equal(windowsVariants[0], "c--work-my-project");
  assert.ok(windowsVariants.includes("c--work-my_project"));
  assert.deepEqual(workspaceToClaudeSlugVariants("/home/me/my_project"), [
    "-home-me-my-project",
    "-home-me-my_project",
  ]);
});

test("Claude provider discovers transcripts for underscore workspace paths", async () => {
  const root = await fixtureRoot("session-claude-underscore-");
  const home = path.join(root, ".claude");
  const workspace = path.join(root, "work", "my_project");
  const sessionId = "44444444-4444-4444-8444-444444444444";
  const foldedSlug = workspaceToClaudeSlugVariants(workspace)[0];
  assert.ok(foldedSlug.endsWith("-work-my-project"));
  await writeJsonl(path.join(home, "projects", foldedSlug, `${sessionId}.jsonl`), [{
    type: "user",
    sessionId,
    cwd: workspace,
    timestamp: "2026-08-07T01:00:00.000Z",
    message: { role: "user", content: [{ type: "text", text: "hello from an underscore workspace" }] },
  }]);
  const result = await new ClaudeSessionAnalyzer().analyze({ command: "sources", workspace, home });
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].sessionId, sessionId);
  assert.equal(result.sources.find((source) => source.kind === "claude-project-jsonl")?.exists, true);
});

test("Claude provider recovers transcripts from the recorded cwd when no slug variant matches", async () => {
  const root = await fixtureRoot("session-claude-cwd-recovery-");
  const home = path.join(root, ".claude");
  const workspace = path.join(root, "work", "my project");
  const sessionId = "55555555-5555-4555-8555-555555555555";
  const otherSessionId = "66666666-6666-4666-8666-666666666666";
  const unmodelledSlug = "claude-owned-project-dir-name";
  assert.ok(!workspaceToClaudeSlugVariants(workspace).includes(unmodelledSlug));
  await writeJsonl(path.join(home, "projects", unmodelledSlug, `${sessionId}.jsonl`), [{
    type: "user",
    sessionId,
    cwd: workspace,
    timestamp: "2026-08-07T02:00:00.000Z",
    message: { role: "user", content: [{ type: "text", text: "hello from an unmodelled slug" }] },
  }]);
  await writeJsonl(path.join(home, "projects", "-unrelated-project", `${otherSessionId}.jsonl`), [{
    type: "user",
    sessionId: otherSessionId,
    cwd: path.join(root, "work", "unrelated"),
    timestamp: "2026-08-07T03:00:00.000Z",
    message: { role: "user", content: [{ type: "text", text: "another workspace" }] },
  }]);

  const result = await new ClaudeSessionAnalyzer().analyze({ command: "sources", workspace, home });
  const transcriptSource = result.sources.find((source) => source.kind === "claude-project-jsonl");
  assert.equal(transcriptSource?.exists, true);
  assert.equal(transcriptSource.path, path.join(home, "projects", unmodelledSlug));
  assert.deepEqual(result.sessions.map((session) => session.sessionId), [sessionId]);
});

test("Claude provider still reports a missing transcript root when no cwd matches", async () => {
  const root = await fixtureRoot("session-claude-no-evidence-");
  const home = path.join(root, ".claude");
  const workspace = path.join(root, "work", "empty_project");
  await writeJsonl(path.join(home, "projects", "-unrelated-project", "77777777-7777-4777-8777-777777777777.jsonl"), [{
    type: "user",
    sessionId: "77777777-7777-4777-8777-777777777777",
    cwd: path.join(root, "work", "unrelated"),
    timestamp: "2026-08-07T04:00:00.000Z",
    message: { role: "user", content: [{ type: "text", text: "another workspace" }] },
  }]);

  const result = await new ClaudeSessionAnalyzer().analyze({ command: "sources", workspace, home });
  const transcriptSource = result.sources.find((source) => source.kind === "claude-project-jsonl");
  assert.equal(transcriptSource?.exists, false);
  assert.equal(transcriptSource.path, path.join(home, "projects", workspaceToClaudeSlugVariants(workspace)[0]));
  assert.equal(result.sessions.length, 0);
  assert.ok(result.warnings.some((warning) => warning.code === "missing-required-root"));
});

test("Claude provider discovers transcripts for dotted workspace paths", async () => {
  const root = await fixtureRoot("session-claude-dotted-");
  const home = path.join(root, ".claude");
  const workspace = path.join(root, "work", "my.project");
  const sessionId = "33333333-3333-4333-8333-333333333333";
  const dottedSlug = workspaceToClaudeSlugVariants(workspace)[0];
  assert.ok(dottedSlug.endsWith("-work-my-project"));
  await writeJsonl(path.join(home, "projects", dottedSlug, `${sessionId}.jsonl`), [{
    type: "user",
    sessionId,
    cwd: workspace,
    timestamp: "2026-07-20T01:00:00.000Z",
    message: { role: "user", content: [{ type: "text", text: "hello from a dotted workspace" }] },
  }]);
  const result = await new ClaudeSessionAnalyzer().analyze({ command: "sources", workspace, home });
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].sessionId, sessionId);
  assert.equal(result.sources.find((source) => source.kind === "claude-project-jsonl")?.exists, true);
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

test("Kimi provider resolves wd_* dirs through workspaces.json and normalizes wire events", async () => {
  const root = await fixtureRoot("session-kimi-provider-");
  const home = path.join(root, ".kimi-code");
  const workspace = path.join(root, "workspace", "project");
  const foreign = path.join(root, "workspace", "other");
  const sessionId = "session_77777777-7777-4777-8777-777777777777";
  const sessionDir = path.join(home, "sessions", "wd_project_ab12cd34ef56", sessionId);
  const foreignDir = path.join(home, "sessions", "wd_other_ab12cd34ef56", "session_88888888-8888-4888-8888-888888888888");
  await mkdir(workspace, { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(path.join(home, "workspaces.json"), JSON.stringify({
    version: 1,
    workspaces: {
      wd_project_ab12cd34ef56: { root: workspace, name: "project" },
      wd_other_ab12cd34ef56: { root: foreign, name: "other" },
    },
  }));
  await mkdir(sessionDir, { recursive: true });
  await writeFile(path.join(sessionDir, "state.json"), JSON.stringify({
    title: "Fixture session",
    createdAt: "2026-07-20T01:00:00.000Z",
    updatedAt: "2026-07-20T01:05:00.000Z",
  }));
  await writeJsonl(path.join(sessionDir, "agents", "main", "wire.jsonl"), [
    { type: "metadata", protocol_version: "1.4", created_at: Date.parse("2026-07-20T01:00:00.000Z") },
    {
      type: "turn.prompt",
      input: [{ type: "text", text: "Implement the kimi adapter" }],
      origin: { kind: "user" },
      time: Date.parse("2026-07-20T01:00:01.000Z"),
    },
    {
      type: "context.append_loop_event",
      event: { type: "step.begin", uuid: "step-1", turnId: "0", step: 1 },
      time: Date.parse("2026-07-20T01:00:02.000Z"),
    },
    {
      type: "context.append_loop_event",
      event: {
        type: "tool.call",
        uuid: "tool-1",
        turnId: "0",
        step: 1,
        toolCallId: "tool-1",
        name: "Bash",
        args: { command: "npm test" },
      },
      time: Date.parse("2026-07-20T01:01:00.000Z"),
    },
    {
      type: "context.append_loop_event",
      event: {
        type: "tool.result",
        parentUuid: "tool-1",
        toolCallId: "tool-1",
        result: { output: "3 tests passed", isError: false },
      },
      time: Date.parse("2026-07-20T01:02:00.000Z"),
    },
    {
      type: "usage.record",
      model: "kimi-code/kimi-fixture",
      usage: { inputOther: 10, output: 4, inputCacheRead: 6, inputCacheCreation: 0 },
      usageScope: "turn",
      time: Date.parse("2026-07-20T01:03:00.000Z"),
    },
  ]);
  await writeJsonl(path.join(foreignDir, "agents", "main", "wire.jsonl"), [
    { type: "metadata", protocol_version: "1.4", created_at: Date.parse("2026-07-20T01:00:00.000Z") },
  ]);
  await writeFile(path.join(foreignDir, "state.json"), JSON.stringify({
    title: "Foreign session",
    createdAt: "2026-07-20T01:00:00.000Z",
    updatedAt: "2026-07-20T01:05:00.000Z",
  }));

  const analyzer = new KimiSessionAnalyzer();
  const discovery = await analyzer.analyze({ command: "sources", workspace, home });
  assert.equal(discovery.sessions.length, 1);
  assert.equal(discovery.sessions[0].sessionId, sessionId);
  assert.equal(discovery.sessions[0].title, "Fixture session");
  assert.deepEqual(
    discovery.sources.map((source) => source.kind),
    ["kimi-wire-jsonl", "kimi-session-index-jsonl", "kimi-workspaces-json"],
  );
  const scope = await analyzer.resolveScope({ workspace, home });
  const events = await analyzer.readSession(discovery.sessions[0], scope, {
    includeCommandText: true,
    includeUserText: true,
  });
  assert.equal(events.filter((event) => event.type === "tool.call").length, 1);
  assert.equal(events.filter((event) => event.type === "tool.result").length, 1);
  assert.equal(events.find((event) => event.type === "tool.result")?.success, true);
  const usage = events.find((event) => event.model === "kimi-code/kimi-fixture");
  assert.equal(usage?.modelUsage.inputTokens, 16);
  assert.equal(usage?.modelUsage.outputTokens, 4);
  const facts = await analyzer.analyze({ command: "facts", workspace, home, limit: 1 });
  assert.equal(facts.kind, "session-core-facts");
  assert.equal(facts.scope.platform, "kimi");
  assert.doesNotMatch(JSON.stringify(facts), new RegExp(sessionId, "u"));
});

test("Kimi keeps partial and malformed usage explicit instead of zero-filling", async () => {
  const root = await fixtureRoot("session-kimi-usage-");
  const home = path.join(root, ".kimi-code");
  const workspace = path.join(root, "workspace", "project");
  const sessionId = "session_66666666-6666-4666-8666-666666666666";
  const sessionDir = path.join(home, "sessions", "wd_project_ab12cd34ef56", sessionId);
  await mkdir(workspace, { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(path.join(home, "workspaces.json"), JSON.stringify({
    version: 1,
    workspaces: { wd_project_ab12cd34ef56: { root: workspace, name: "project" } },
  }));
  await writeJsonl(path.join(sessionDir, "agents", "main", "wire.jsonl"), [
    { type: "metadata", protocol_version: "1.4", created_at: Date.parse("2026-07-20T01:00:00.000Z") },
    {
      type: "usage.record",
      model: "kimi-partial",
      usage: { output: 4 },
      time: Date.parse("2026-07-20T01:01:00.000Z"),
    },
    {
      type: "usage.record",
      model: "kimi-malformed",
      usage: { inputOther: "10", inputCacheRead: null },
      time: Date.parse("2026-07-20T01:02:00.000Z"),
    },
    {
      type: "usage.record",
      model: "kimi-missing",
      time: Date.parse("2026-07-20T01:03:00.000Z"),
    },
  ]);

  const analyzer = new KimiSessionAnalyzer();
  const discovery = await analyzer.analyze({ command: "sources", workspace, home });
  const scope = await analyzer.resolveScope({ workspace, home });
  const events = await analyzer.readSession(discovery.sessions[0], scope, {});
  const usageEvents = events.filter((event) => event.type === "model.response.completed");
  // Partial usage carries only the observed fields; malformed or missing
  // usage never becomes zero-filled, and without one finite field there is no
  // usage event at all.
  assert.equal(usageEvents.length, 1);
  assert.equal(usageEvents[0].model, "kimi-partial");
  assert.deepEqual(usageEvents[0].modelUsage, { outputTokens: 4 });
  assert.equal(Object.hasOwn(usageEvents[0].modelUsage, "inputTokens"), false);
  assert.equal(Object.hasOwn(usageEvents[0].modelUsage, "cacheReadInputTokens"), false);
});

test("Kimi currentSessionId reads KIMI_SESSION_ID and falls back to null", () => {
  const analyzer = new KimiSessionAnalyzer();
  const previous = process.env.KIMI_SESSION_ID;
  try {
    delete process.env.KIMI_SESSION_ID;
    assert.equal(analyzer.currentSessionId(), null);
    process.env.KIMI_SESSION_ID = "session_fixture-current";
    assert.equal(analyzer.currentSessionId(), "session_fixture-current");
  } finally {
    if (previous === undefined) {
      delete process.env.KIMI_SESSION_ID;
    } else {
      process.env.KIMI_SESSION_ID = previous;
    }
  }
});

test("Kimi dedupe keeps a shared tool call id per agent but drops repeats within one agent", async () => {
  const root = await fixtureRoot("session-kimi-dedupe-agents-");
  const home = path.join(root, ".kimi-code");
  const workspace = path.join(root, "workspace", "project");
  const sessionId = "session_77777777-7777-4777-8777-777777777777";
  const sessionDir = path.join(home, "sessions", "wd_project_ab12cd34ef56", sessionId);
  await mkdir(workspace, { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(path.join(home, "workspaces.json"), JSON.stringify({
    version: 1,
    workspaces: { wd_project_ab12cd34ef56: { root: workspace, name: "project" } },
  }));
  const toolCall = (uuid, time) => ({
    type: "context.append_loop_event",
    event: {
      type: "tool.call",
      uuid,
      toolCallId: "tool-1",
      name: "Bash",
      args: { command: "npm test" },
    },
    time,
  });
  await writeJsonl(path.join(sessionDir, "agents", "main", "wire.jsonl"), [
    { type: "metadata", protocol_version: "1.4", created_at: Date.parse("2026-07-20T01:00:00.000Z") },
    toolCall("main-1", Date.parse("2026-07-20T01:01:00.000Z")),
    // A repeated record of the same tool call within one agent wire is a
    // duplicate and must still be deduped.
    toolCall("main-2", Date.parse("2026-07-20T01:01:01.000Z")),
  ]);
  // A subagent wire reusing the same toolCallId is a distinct event.
  await writeJsonl(path.join(sessionDir, "agents", "helper-1", "wire.jsonl"), [
    { type: "metadata", protocol_version: "1.4", created_at: Date.parse("2026-07-20T01:00:00.000Z") },
    toolCall("helper-1", Date.parse("2026-07-20T01:02:00.000Z")),
  ]);

  const analyzer = new KimiSessionAnalyzer();
  const discovery = await analyzer.analyze({ command: "sources", workspace, home });
  const scope = await analyzer.resolveScope({ workspace, home });
  const events = await analyzer.readSession(discovery.sessions[0], scope, {});
  const calls = events.filter((event) => event.type === "tool.call");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((event) => event.agentId).sort(), ["helper-1", "main"]);
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

test("Pi malformed first records and unknown header versions remain partial evidence", async () => {
  const root = await fixtureRoot("session-pi-schema-diagnostics-");
  const home = path.join(root, ".pi", "agent");
  const workspace = path.join(root, "workspace", "target");
  const dirName = workspaceToPiSessionDirVariants(workspace).exact;
  await mkdir(path.join(home, "sessions", dirName), { recursive: true });
  await writeFile(path.join(home, "sessions", dirName, "malformed.jsonl"), [
    "not-json",
    JSON.stringify({ type: "session", version: 3, id: "late-header", timestamp: "2026-07-20T01:00:00.000Z", cwd: workspace }),
  ].join("\n") + "\n");
  await writeJsonl(path.join(home, "sessions", dirName, "unknown-version.jsonl"), [
    { type: "session", version: 4, id: "unknown-version", timestamp: "2026-07-20T01:00:00.000Z", cwd: workspace },
    { type: "message", id: "v4-message", timestamp: "2026-07-20T01:00:01.000Z", message: { role: "user", content: "not admitted" } },
  ]);

  const result = await new PiSessionAnalyzer().analyze({ command: "sources", workspace, home });
  assert.equal(result.sessions.length, 0);
  assert.equal(result.providerCoverage.status, "unsupported");
  assert.ok(result.providerCoverage.unsupported.includes("pi-session-schema-version"));
  assert.equal(result.providerCoverage.schemaDiagnostics.unknownVersionCount, 1);
  assert.equal(result.providerCoverage.schemaDiagnostics.invalidHeaderCount, 2);
  assert.equal(result.providerCoverage.schemaDiagnostics.invalidRecordCount, 1);
  assert.equal(result.providerCoverage.schemaDiagnostics.status, "partial");
});

test("Kimi provider falls back to session_index.jsonl when workspaces.json has no entry", async () => {
  const root = await fixtureRoot("session-kimi-index-");
  const home = path.join(root, ".kimi-code");
  const workspace = path.join(root, "workspace", "project");
  const sessionId = "ses_99999999-9999-4999-8999-999999999999";
  const sessionDir = path.join(home, "sessions", "wd_project_ff00ff00ff00", sessionId);
  await mkdir(workspace, { recursive: true });
  await writeJsonl(path.join(home, "session_index.jsonl"), [
    { sessionId, sessionDir, workDir: workspace },
  ]);
  await writeJsonl(path.join(sessionDir, "agents", "main", "wire.jsonl"), [
    {
      type: "context.append_message",
      message: { role: "user", content: [{ type: "text", text: "legacy protocol" }], toolCalls: [] },
      time: Date.parse("2026-07-20T01:00:00.000Z"),
    },
  ]);
  const discovery = await new KimiSessionAnalyzer().analyze({ command: "sources", workspace, home });
  assert.equal(discovery.sessions.length, 1);
  assert.equal(discovery.sessions[0].sessionId, sessionId);
});

test("Kimi provider falls back to wd_<name>_* prefixes when both workspace indexes are absent", async () => {
  const root = await fixtureRoot("session-kimi-prefix-");
  const home = path.join(root, ".kimi-code");
  const workspace = path.join(root, "workspace", "project");
  const sessionId = "ses_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const wire = [
    { type: "metadata", protocol_version: "1.4", created_at: Date.parse("2026-07-20T01:00:00.000Z") },
  ];
  await mkdir(workspace, { recursive: true });
  await writeJsonl(
    path.join(home, "sessions", "wd_project_ab12cd34ef56", sessionId, "agents", "main", "wire.jsonl"),
    wire,
  );
  await writeFile(
    path.join(home, "sessions", "wd_project_ab12cd34ef56", sessionId, "state.json"),
    JSON.stringify({
      title: "Fallback session",
      createdAt: "2026-07-20T01:00:00.000Z",
      updatedAt: "2026-07-20T01:05:00.000Z",
    }),
  );
  // wd_projectextra_* does not start with the wd_project_ prefix and must be excluded.
  await writeJsonl(
    path.join(home, "sessions", "wd_projectextra_ab12cd34ef56", "ses_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "agents", "main", "wire.jsonl"),
    wire,
  );
  // A different project name must be excluded too.
  await writeJsonl(
    path.join(home, "sessions", "wd_other_ab12cd34ef56", "ses_cccccccc-cccc-4ccc-8ccc-cccccccccccc", "agents", "main", "wire.jsonl"),
    wire,
  );

  const analyzer = new KimiSessionAnalyzer();
  const discovery = await analyzer.analyze({ command: "sources", workspace, home });
  assert.deepEqual(discovery.sessions.map((session) => session.sessionId), [sessionId]);
  assert.ok(discovery.warnings.some((warning) => warning.code === "kimi-workspace-index-absent"));

  const facts = await analyzer.analyze({ command: "facts", workspace, home, limit: 1 });
  assert.ok(facts.warningCodes.includes("kimi-workspace-index-absent"));
});

test("Kimi prefix fallback lowercases the workspace basename and keeps raw directory characters", async () => {
  const root = await fixtureRoot("session-kimi-prefix-case-");
  const home = path.join(root, ".kimi-code");
  const workspace = path.join(root, "workspace", "My Project");
  const sessionId = "ses_dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  await mkdir(workspace, { recursive: true });
  // Actual behavior: the fallback lowercases both sides but applies no other
  // sanitization, so an uppercase dir with a space and uppercase hex suffix still
  // matches the wd_my project_ prefix.
  await writeJsonl(
    path.join(home, "sessions", "wd_MY PROJECT_AB12CD34EF56", sessionId, "agents", "main", "wire.jsonl"),
    [{ type: "metadata", protocol_version: "1.4", created_at: Date.parse("2026-07-20T01:00:00.000Z") }],
  );

  const discovery = await new KimiSessionAnalyzer().analyze({ command: "sources", workspace, home });
  assert.deepEqual(discovery.sessions.map((session) => session.sessionId), [sessionId]);
  assert.ok(discovery.warnings.some((warning) => warning.code === "kimi-workspace-index-absent"));
});

test("Kimi provider emits kimi-workspace-index-absent only when both indexes are missing", async () => {
  const root = await fixtureRoot("session-kimi-index-warning-");
  const home = path.join(root, ".kimi-code");
  const workspace = path.join(root, "workspace", "project");
  const sessionId = "ses_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  await mkdir(workspace, { recursive: true });
  await writeJsonl(
    path.join(home, "sessions", "wd_project_ab12cd34ef56", sessionId, "agents", "main", "wire.jsonl"),
    [{ type: "metadata", protocol_version: "1.4", created_at: Date.parse("2026-07-20T01:00:00.000Z") }],
  );

  const analyzer = new KimiSessionAnalyzer();
  const missing = await analyzer.analyze({ command: "sources", workspace, home });
  assert.equal(missing.sessions.length, 1);
  assert.ok(missing.warnings.some((warning) => warning.code === "kimi-workspace-index-absent"));

  // An existing (even empty) workspaces.json marks the index as present, so the
  // warning disappears. The prefix fallback itself keys off the empty index maps,
  // not file existence, so the session is still attributed.
  await writeFile(
    path.join(home, "workspaces.json"),
    JSON.stringify({ version: 1, workspaces: {} }),
  );
  const indexed = await analyzer.analyze({ command: "sources", workspace, home });
  assert.equal(indexed.sessions.length, 1);
  assert.equal(
    indexed.warnings.some((warning) => warning.code === "kimi-workspace-index-absent"),
    false,
  );
});

test("Kimi provider merges main and subagent wire files and dedupes repeated tool events", async () => {
  const root = await fixtureRoot("session-kimi-subagent-");
  const home = path.join(root, ".kimi-code");
  const workspace = path.join(root, "workspace", "project");
  const sessionId = "ses_ffffffff-ffff-4fff-8fff-ffffffffffff";
  const sessionDir = path.join(home, "sessions", "wd_project_ab12cd34ef56", sessionId);
  await mkdir(workspace, { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(path.join(home, "workspaces.json"), JSON.stringify({
    version: 1,
    workspaces: { wd_project_ab12cd34ef56: { root: workspace, name: "project" } },
  }));
  await mkdir(sessionDir, { recursive: true });
  await writeFile(path.join(sessionDir, "state.json"), JSON.stringify({
    title: "Subagent session",
    createdAt: "2026-07-20T01:00:00.000Z",
    updatedAt: "2026-07-20T01:10:00.000Z",
  }));
  await writeJsonl(path.join(sessionDir, "agents", "main", "wire.jsonl"), [
    { type: "metadata", protocol_version: "1.4", created_at: Date.parse("2026-07-20T01:00:00.000Z") },
    {
      type: "context.append_loop_event",
      event: { type: "tool.call", uuid: "tool-1", toolCallId: "tool-1", name: "Bash", args: { command: "npm test" } },
      time: Date.parse("2026-07-20T01:01:00.000Z"),
    },
    {
      type: "context.append_loop_event",
      event: { type: "tool.result", toolCallId: "tool-1", result: { output: "ok", isError: false } },
      time: Date.parse("2026-07-20T01:02:00.000Z"),
    },
  ]);
  await writeJsonl(path.join(sessionDir, "agents", "researcher", "wire.jsonl"), [
    { type: "metadata", protocol_version: "1.4", created_at: Date.parse("2026-07-20T01:00:00.000Z") },
    // Same toolInvocationId + lifecyclePhase as the main wire record, but from
    // another agent's file: tool call ids are only unique per agent, so
    // dedupeEvents must keep this distinct subagent event.
    {
      type: "context.append_loop_event",
      event: { type: "tool.call", uuid: "tool-1", toolCallId: "tool-1", name: "Bash", args: { command: "npm test" } },
      time: Date.parse("2026-07-20T01:03:00.000Z"),
    },
    {
      type: "context.append_loop_event",
      event: {
        type: "tool.call",
        uuid: "tool-2",
        toolCallId: "tool-2",
        name: "Read",
        args: { file_path: path.join(workspace, "notes.md") },
      },
      time: Date.parse("2026-07-20T01:04:00.000Z"),
    },
  ]);

  const analyzer = new KimiSessionAnalyzer();
  const discovery = await analyzer.analyze({ command: "sources", workspace, home });
  assert.equal(discovery.sessions.length, 1);
  assert.deepEqual(
    discovery.sessions[0].sourceRefs.map((ref) => `${ref.agentId}:${ref.role}`),
    ["main:session-transcript", "researcher:subagent-transcript"],
  );

  const scope = await analyzer.resolveScope({ workspace, home });
  const events = await analyzer.readSession(discovery.sessions[0], scope, { includeCommandText: true });
  const toolCalls = events.filter((event) => event.type === "tool.call");
  // The subagent copy of tool-1 survives: dedupe keys include the agent id.
  assert.deepEqual(toolCalls.map((event) => event.toolInvocationId), ["tool-1", "tool-1", "tool-2"]);
  assert.deepEqual(toolCalls.map((event) => event.agentId), ["main", "researcher", "researcher"]);
  assert.equal(toolCalls[0].isSubagent, false);
  assert.equal(toolCalls[1].isSubagent, true);
  assert.equal(toolCalls[2].isSubagent, true);
  assert.equal(events.filter((event) => event.type === "tool.result").length, 1);
  assert.equal(events.filter((event) => event.type === "metadata.wire").length, 2);
});

test("WorkBuddy provider expands tool calls, tool results, and usage from JSONL transcripts", async () => {
  const root = await fixtureRoot("session-workbuddy-provider-");
  const home = path.join(root, ".workbuddy");
  const workspace = path.join(root, "workspace", "project");
  const sessionId = "66666666-6666-4666-8666-666666666666";
  const dirName = workspaceToWorkbuddySlugVariants(workspace).exact;
  await writeJsonl(path.join(home, "projects", dirName, `${sessionId}.jsonl`), [
    { id: "u1", type: "message", role: "user", timestamp: "1784509200000", sessionId, cwd: workspace, content: [{ type: "input_text", text: "Implement the provider and run tests" }] },
    { id: "r1", type: "reasoning", parentId: "u1", timestamp: "1784509205000", sessionId, cwd: workspace, content: [], rawContent: [{ type: "reasoning_text", text: "inspect first" }] },
    {
      id: "01aa",
      parentId: "r1",
      type: "function_call",
      timestamp: "1784509210000",
      callId: "call_one",
      name: "Bash",
      arguments: JSON.stringify({ command: "npm test", description: "run tests" }),
      sessionId,
      cwd: workspace,
      providerData: { model: "glm-5.2", messageId: "01aa", usage: { requests: 1, inputTokens: 10, outputTokens: 4, totalTokens: 14, inputTokensDetails: [{ cached_tokens: 2 }] } },
    },
    {
      id: "res1",
      parentId: "01aa",
      type: "function_call_result",
      timestamp: "1784509220000",
      callId: "call_one",
      name: "Bash",
      status: "completed",
      output: { type: "text", text: "3 tests passed" },
      sessionId,
      cwd: workspace,
    },
    {
      id: "01bb",
      parentId: "res1",
      type: "function_call",
      timestamp: "1784509230000",
      callId: "call_two",
      name: "Read",
      arguments: JSON.stringify({ path: path.join(workspace, "package.json") }),
      sessionId,
      cwd: workspace,
      providerData: { model: "glm-5.2", messageId: "01bb" },
    },
    {
      id: "res2",
      parentId: "01bb",
      type: "function_call_result",
      timestamp: "1784509240000",
      callId: "call_two",
      name: "Read",
      status: "failed",
      output: { type: "text", text: "not found" },
      sessionId,
      cwd: workspace,
    },
    { id: "a1", type: "message", role: "assistant", timestamp: "1784509250000", sessionId, cwd: workspace, providerData: { model: "glm-5.2", messageId: "a1" }, content: [{ type: "output_text", text: "Done: tests pass." }] },
    { type: "ai-title", timestamp: "1784509260000", sessionId, cwd: workspace, aiTitle: "Implement provider" },
  ]);

  const analyzer = new WorkbuddySessionAnalyzer();
  const discovery = await analyzer.analyze({ command: "sources", workspace, home });
  assert.equal(discovery.sessions.length, 1);
  assert.equal(discovery.sessions[0].sessionId, sessionId);
  assert.deepEqual(discovery.sources.map((source) => source.kind), ["workbuddy-session-jsonl"]);
  const scope = await analyzer.resolveScope({ workspace, home });
  const events = await analyzer.readSession(discovery.sessions[0], scope, {
    includeCommandText: true,
    includeUserText: true,
    includeContent: true,
  });
  assert.equal(events.filter((event) => event.type === "tool.call").length, 2);
  assert.equal(events.filter((event) => event.type === "tool.result").length, 2);
  assert.equal(events.find((event) => event.type === "user")?.userText, "Implement the provider and run tests");
  assert.equal(events.find((event) => event.model === "glm-5.2" && event.type === "model.response.completed")?.modelUsage.inputTokens, 10);
  assert.equal(events.find((event) => event.model === "glm-5.2" && event.type === "model.response.completed")?.modelUsage.cacheReadInputTokens, 2);
  assert.equal(events.find((event) => event.toolInvocationId === "call_one" && event.type === "tool.call")?.commandText, "npm test");
  assert.equal(events.find((event) => event.toolInvocationId === "call_two" && event.type === "tool.call")?.filePath, path.join(workspace, "package.json"));
  assert.equal(events.find((event) => event.toolInvocationId === "call_two" && event.type === "tool.result")?.success, false);
  assert.ok(events.some((event) => event.type === "metadata.reasoning"));
  assert.ok(events.some((event) => event.type === "metadata.ai-title"));
  const facts = await analyzer.analyze({ command: "facts", workspace, home, limit: 1 });
  assert.equal(facts.kind, "session-core-facts");
  assert.equal(facts.scope.platform, "workbuddy");
  assert.doesNotMatch(JSON.stringify(facts), new RegExp(sessionId, "u"));
  assert.doesNotMatch(JSON.stringify(facts), new RegExp(home.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
});

test("WorkBuddy 5.x accepts cwd-less exact directories and preserves sparse snake-case usage", async () => {
  const root = await fixtureRoot("session-workbuddy-current-provider-");
  const home = path.join(root, ".workbuddy");
  const workspace = path.join(root, "workspace", "project");
  const sessionId = "88888888-8888-4888-8888-888888888888";
  const dirName = workspaceToWorkbuddySlugVariants(workspace).exact;
  await writeJsonl(path.join(home, "projects", dirName, `${sessionId}.jsonl`), [
    {
      id: "u1",
      type: "message",
      role: "user",
      timestamp: "1784509200000",
      sessionId,
      content: [{ type: "input_text", text: "Inspect the current WorkBuddy format" }],
    },
    {
      id: "r1",
      type: "reasoning",
      timestamp: "1784509205000",
      sessionId,
      providerData: {
        model: "glm-5.2",
        messageId: "reasoning-response",
        usage: { input_tokens: 24453 },
      },
    },
    {
      id: "a1",
      type: "message",
      role: "assistant",
      timestamp: "1784509210000",
      sessionId,
      providerData: {
        model: "glm-5.2",
        messageId: "assistant-response",
        usage: { output_tokens: 289 },
      },
      content: [{ type: "output_text", text: "Current format confirmed." }],
    },
    { id: "title1", type: "custom-title", timestamp: "1784509215000", sessionId, title: "Current host" },
  ]);

  const analyzer = new WorkbuddySessionAnalyzer();
  const discovery = await analyzer.analyze({ command: "sources", workspace, home });
  assert.equal(discovery.sources[0].exists, true);
  assert.equal(discovery.sessions.length, 1);
  const scope = await analyzer.resolveScope({ workspace, home });
  const events = await analyzer.readSession(discovery.sessions[0], scope, {});
  const usageEvents = events.filter((event) => event.type === "model.response.completed");
  assert.deepEqual(usageEvents.map((event) => event.modelUsage), [
    { inputTokens: 24453 },
    { outputTokens: 289 },
  ]);
  assert.ok(events.some((event) => event.type === "metadata.reasoning"));
  assert.ok(events.some((event) => event.type === "metadata.custom-title"));
  assert.ok(events.every((event) => event.cwd === workspace));
});

test("WorkBuddy provider rejects a transcript whose records belong to another workspace", async () => {
  const root = await fixtureRoot("session-workbuddy-isolation-");
  const home = path.join(root, ".workbuddy");
  const workspace = path.join(root, "workspace", "target");
  const other = path.join(root, "workspace", "other");
  const dirName = workspaceToWorkbuddySlugVariants(workspace).exact;
  await writeJsonl(path.join(home, "projects", dirName, "foreign.jsonl"), [
    { id: "u1", type: "message", role: "user", timestamp: "1784509200000", sessionId: "foreign", cwd: other, content: [{ type: "input_text", text: "foreign" }] },
  ]);
  const result = await new WorkbuddySessionAnalyzer().analyze({ command: "sources", workspace, home });
  assert.equal(result.sessions.length, 0);
});

test("WorkBuddy provider discovers subdirectory session dirs that share the workspace prefix", async () => {
  const root = await fixtureRoot("session-workbuddy-subdir-");
  const home = path.join(root, ".workbuddy");
  const workspace = path.join(root, "workspace", "target");
  const subdir = path.join(workspace, "packages", "app");
  const dirName = workspaceToWorkbuddySlugVariants(subdir).exact;
  await writeJsonl(path.join(home, "projects", dirName, "child.jsonl"), [
    { id: "u1", type: "message", role: "user", timestamp: "1784509200000", sessionId: "77777777-7777-4777-8777-777777777777", cwd: subdir, content: [{ type: "input_text", text: "child session" }] },
  ]);
  const result = await new WorkbuddySessionAnalyzer().analyze({ command: "sources", workspace, home });
  assert.equal(result.sessions.length, 1);
});

test("WorkBuddy provider rejects cwd-less transcripts from prefix-only directories", async () => {
  const root = await fixtureRoot("session-workbuddy-prefix-isolation-");
  const home = path.join(root, ".workbuddy");
  const workspace = path.join(root, "workspace", "target");
  const subdir = path.join(workspace, "packages", "app");
  const dirName = workspaceToWorkbuddySlugVariants(subdir).exact;
  await writeJsonl(path.join(home, "projects", dirName, "ambiguous.jsonl"), [
    {
      id: "u1",
      type: "message",
      role: "user",
      timestamp: "1784509200000",
      sessionId: "ambiguous",
      content: [{ type: "input_text", text: "cwd unavailable" }],
    },
  ]);

  const result = await new WorkbuddySessionAnalyzer().analyze({ command: "sources", workspace, home });
  assert.equal(result.sessions.length, 0);
});

test("WorkBuddy source roots stay absent without workspace-matching project directories", async () => {
  const root = await fixtureRoot("session-workbuddy-absent-root-");
  const home = path.join(root, ".workbuddy");
  const workspace = path.join(root, "workspace", "target");
  const foreign = path.join(root, "workspace", "other");
  const foreignDir = workspaceToWorkbuddySlugVariants(foreign).exact;
  await writeJsonl(path.join(home, "projects", foreignDir, "foreign.jsonl"), [
    { id: "u1", type: "message", role: "user", timestamp: "1784509200000", sessionId: "foreign" },
  ]);

  const result = await new WorkbuddySessionAnalyzer().analyze({ command: "sources", workspace, home });
  assert.equal(result.sources[0].exists, false);
  assert.equal(result.sessions.length, 0);
});

test("Grok provider expands user/assistant/tool events and turn_completed usage", async () => {
  const root = await fixtureRoot("session-grok-provider-");
  const home = path.join(root, ".grok");
  const workspace = path.join(root, "workspace", "project");
  const sessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const group = workspaceToGrokSessionDirName(workspace);
  const sessionDir = path.join(home, "sessions", group, sessionId);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(path.join(sessionDir, "summary.json"), JSON.stringify({
    info: { id: sessionId, cwd: workspace },
    created_at: "2026-08-01T10:00:00.000Z",
    updated_at: "2026-08-01T10:05:00.000Z",
    current_model_id: "grok-4",
  }, null, 2));
  await writeJsonl(path.join(sessionDir, "updates.jsonl"), [
    {
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "user_message_chunk",
          content: { text: "Implement the Grok provider" },
          _meta: { isoTimestamp: "2026-08-01T10:00:01.000Z" },
        },
      },
    },
    {
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "tool_call",
          toolName: "run_terminal_command",
          toolCallId: "call_1",
          status: "pending",
          _meta: { isoTimestamp: "2026-08-01T10:00:02.000Z" },
        },
      },
    },
    {
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "tool_call_update",
          toolName: "run_terminal_command",
          toolCallId: "call_1",
          status: null,
          _meta: { isoTimestamp: "2026-08-01T10:00:02.500Z" },
        },
      },
    },
    {
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "tool_call_update",
          toolName: "run_terminal_command",
          toolCallId: "call_1",
          status: "in_progress",
          _meta: { isoTimestamp: "2026-08-01T10:00:02.750Z" },
        },
      },
    },
    {
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "tool_call_update",
          toolName: "run_terminal_command",
          toolCallId: "call_1",
          status: "completed",
          content: "ok",
          _meta: { isoTimestamp: "2026-08-01T10:00:03.000Z" },
        },
      },
    },
    {
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { text: "Done." },
          _meta: { isoTimestamp: "2026-08-01T10:00:04.000Z", modelId: "grok-4" },
        },
      },
    },
    {
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "thought_chunk",
          content: { text: "thinking" },
          _meta: { isoTimestamp: "2026-08-01T10:00:05.000Z" },
        },
      },
    },
    {
      method: "_x.ai/session/update",
      params: {
        update: {
          sessionUpdate: "turn_completed",
          stop_reason: "end_turn",
          usage: {
            inputTokens: 120,
            outputTokens: 40,
            totalTokens: 160,
            cachedReadTokens: 10,
          },
        },
      },
    },
    {
      method: "_x.ai/session/update",
      params: {
        update: {
          sessionUpdate: "turn_completed",
          stop_reason: "end_turn",
          // Nested-only shape must still produce model usage (Grok 0.2.x).
          usage: {
            modelUsage: {
              "grok-4": {
                inputTokens: 1000,
                outputTokens: 200,
                totalTokens: 1200,
                cachedReadTokens: 50,
              },
            },
          },
        },
      },
    },
  ]);
  // contextTokensUsed must not be treated as total token spend
  await writeFile(path.join(sessionDir, "signals.json"), JSON.stringify({
    contextTokensUsed: 44532,
    contextWindowTokens: 500000,
  }, null, 2));
  // chat_history must not double-count when updates.jsonl exists
  await writeJsonl(path.join(sessionDir, "chat_history.jsonl"), [
    { role: "user", content: "duplicate user", timestamp: "2026-08-01T10:00:01.000Z" },
    { role: "assistant", content: "duplicate assistant", timestamp: "2026-08-01T10:00:04.000Z" },
  ]);

  const analyzer = new GrokSessionAnalyzer();
  const discovery = await analyzer.analyze({ command: "sources", workspace, home });
  assert.equal(discovery.sessions.length, 1);
  assert.equal(discovery.sessions[0].sessionId, sessionId);
  assert.deepEqual(discovery.sources.map((source) => source.kind), ["grok-session-dir"]);
  const scope = await analyzer.resolveScope({ workspace, home });
  const events = await analyzer.readSession(discovery.sessions[0], scope, {
    includeUserText: true,
    includeContent: true,
  });
  assert.equal(events.filter((event) => event.type === "user").length, 1);
  assert.equal(events.find((event) => event.type === "user")?.userText, "Implement the Grok provider");
  assert.equal(events.filter((event) => event.type === "tool.call").length, 1);
  assert.equal(events.filter((event) => event.type === "tool.result").length, 1);
  assert.equal(events.filter((event) => event.type === "metadata.tool_call_update").length, 2);
  assert.equal(events.filter((event) => event.type === "assistant").length, 1);
  assert.ok(events.some((event) => event.type === "metadata.thought_chunk"));
  const usageEvents = events.filter((event) => event.type === "model.response.completed");
  assert.equal(usageEvents.length, 2);
  assert.equal(usageEvents[0]?.modelUsage?.inputTokens, 120);
  assert.equal(usageEvents[0]?.modelUsage?.outputTokens, 40);
  assert.equal(usageEvents[0]?.modelUsage?.totalTokens, 160);
  assert.equal(usageEvents[1]?.modelUsage?.inputTokens, 1000);
  assert.equal(usageEvents[1]?.modelUsage?.outputTokens, 200);
  assert.equal(usageEvents[1]?.modelUsage?.totalTokens, 1200);
  assert.equal(usageEvents[1]?.model, "grok-4");
  assert.ok(!events.some((event) => event.modelUsage?.totalTokens === 44532));
  assert.ok(events.some((event) => event.type === "metadata.context_window"));
  const facts = await analyzer.analyze({ command: "facts", workspace, home, limit: 1 });
  assert.equal(facts.kind, "session-core-facts");
  assert.equal(facts.scope.platform, "grok");
  assert.doesNotMatch(JSON.stringify(facts), new RegExp(sessionId, "u"));
});

test("Grok provider discovers long-path session groups via .cwd marker", async () => {
  const root = await fixtureRoot("session-grok-long-path-");
  const home = path.join(root, ".grok");
  const workspace = path.join(root, "workspace", "deeply", "nested", "project");
  const sessionId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  // Simulate Grok long-path form: slug+hash group with .cwd (not encodeURIComponent name).
  const group = "workspace-deeply-nested-project-a1b2c3d4";
  const groupPath = path.join(home, "sessions", group);
  const sessionDir = path.join(groupPath, sessionId);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(path.join(groupPath, ".cwd"), `${workspace}\n`);
  await writeFile(path.join(sessionDir, "summary.json"), JSON.stringify({
    info: { id: sessionId, cwd: workspace },
    created_at: "2026-08-01T10:00:00.000Z",
    updated_at: "2026-08-01T10:05:00.000Z",
  }, null, 2));
  await writeJsonl(path.join(sessionDir, "updates.jsonl"), [
    {
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "user_message_chunk",
          content: { text: "long path" },
          _meta: { isoTimestamp: "2026-08-01T10:00:01.000Z" },
        },
      },
    },
  ]);
  const result = await new GrokSessionAnalyzer().analyze({ command: "sources", workspace, home });
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].sessionId, sessionId);
  assert.equal(result.sources[0].exists, true);
});

test("Grok turn usage completes partial flat records from nested modelUsage", async () => {
  const root = await fixtureRoot("session-grok-partial-usage-");
  const home = path.join(root, ".grok");
  const workspace = path.join(root, "workspace", "project");
  const sessionId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const sessionDir = path.join(home, "sessions", encodeURIComponent(workspace), sessionId);
  await mkdir(sessionDir, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(sessionDir, "summary.json"), JSON.stringify({
    info: { id: sessionId, cwd: workspace },
    created_at: "2026-08-01T10:00:00.000Z",
    updated_at: "2026-08-01T10:05:00.000Z",
  }, null, 2));
  await writeJsonl(path.join(sessionDir, "updates.jsonl"), [
    {
      method: "_x.ai/session/update",
      params: {
        update: {
          sessionUpdate: "turn_completed",
          // Flat record reports input only; output/total live in nested modelUsage.
          usage: {
            inputTokens: 300,
            modelUsage: {
              "grok-4": { outputTokens: 80, totalTokens: 380 },
            },
          },
        },
      },
    },
  ]);

  const analyzer = new GrokSessionAnalyzer();
  const discovery = await analyzer.analyze({ command: "sources", workspace, home });
  assert.equal(discovery.sessions.length, 1);
  const scope = await analyzer.resolveScope({ workspace, home });
  const events = await analyzer.readSession(discovery.sessions[0], scope, {});
  const usage = events.find((event) => event.type === "model.response.completed")?.modelUsage;
  assert.equal(usage?.inputTokens, 300);
  assert.equal(usage?.outputTokens, 80);
  assert.equal(usage?.totalTokens, 380);
});

test("Grok provider excludes foreign workspace session groups", async () => {
  const root = await fixtureRoot("session-grok-isolation-");
  const home = path.join(root, ".grok");
  const workspace = path.join(root, "workspace", "target");
  const foreign = path.join(root, "workspace", "other");
  const sessionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const foreignGroup = workspaceToGrokSessionDirName(foreign);
  const sessionDir = path.join(home, "sessions", foreignGroup, sessionId);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(path.join(sessionDir, "summary.json"), JSON.stringify({
    info: { id: sessionId, cwd: foreign },
    created_at: "2026-08-01T10:00:00.000Z",
    updated_at: "2026-08-01T10:05:00.000Z",
  }, null, 2));
  await writeJsonl(path.join(sessionDir, "updates.jsonl"), [
    {
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "user_message_chunk",
          content: { text: "foreign" },
          _meta: { isoTimestamp: "2026-08-01T10:00:01.000Z" },
        },
      },
    },
  ]);
  const result = await new GrokSessionAnalyzer().analyze({ command: "sources", workspace, home });
  assert.equal(result.sessions.length, 0);
  assert.equal(result.sources[0].exists, false);
});

test("Grok provider leaves usage unobserved when signals.json is missing", async () => {
  const root = await fixtureRoot("session-grok-no-signals-");
  const home = path.join(root, ".grok");
  const workspace = path.join(root, "workspace", "project");
  const sessionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const group = workspaceToGrokSessionDirName(workspace);
  const sessionDir = path.join(home, "sessions", group, sessionId);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(path.join(sessionDir, "summary.json"), JSON.stringify({
    info: { id: sessionId, cwd: workspace },
    created_at: "2026-08-01T10:00:00.000Z",
    updated_at: "2026-08-01T10:05:00.000Z",
  }, null, 2));
  await writeJsonl(path.join(sessionDir, "updates.jsonl"), [
    {
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "user_message_chunk",
          content: { text: "no signals" },
          _meta: { isoTimestamp: "2026-08-01T10:00:01.000Z" },
        },
      },
    },
  ]);
  const analyzer = new GrokSessionAnalyzer();
  const discovery = await analyzer.analyze({ command: "sources", workspace, home });
  const scope = await analyzer.resolveScope({ workspace, home });
  const events = await analyzer.readSession(discovery.sessions[0], scope, {});
  assert.equal(events.filter((event) => event.type === "model.response.completed").length, 0);
  assert.ok(!events.some((event) => event.modelUsage && Object.values(event.modelUsage).every((value) => value === 0)));
});
