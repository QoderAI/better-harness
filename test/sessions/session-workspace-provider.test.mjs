import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { CodexSessionAnalyzer } from "../../scripts/session-analysis/platforms/codex.mjs";
import {
  ClaudeSessionAnalyzer,
  workspaceToClaudeSlugVariants,
} from "../../scripts/session-analysis/platforms/claude.mjs";
import {
  CursorSessionAnalyzer,
  workspaceToCursorSlugVariants,
} from "../../scripts/session-analysis/platforms/cursor.mjs";
import {
  QoderSessionAnalyzer,
  workspaceToQoderSlug,
} from "../../scripts/session-analysis/platforms/qoder.mjs";
import {
  QwenSessionAnalyzer,
  workspaceToQwenSlugVariants,
} from "../../scripts/session-analysis/platforms/qwen.mjs";
import { CopilotSessionAnalyzer } from "../../scripts/session-analysis/platforms/copilot.mjs";
import {
  PiSessionAnalyzer,
  workspaceToPiSessionDirVariants,
} from "../../scripts/session-analysis/platforms/pi.mjs";
import {
  bindSessionWorkspaceCwds,
  hydrateWorkspaceSelection,
  markSessionReadCoverage,
  qualifyWorkspaceSessionInventory,
  runProviderCommand,
  withWorkspaceMatchDiagnostics,
  workspaceMatchScopeFromOptions,
} from "../../scripts/session-analysis/provider-runner.mjs";

async function writeJsonl(filePath, rows) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value)}\n`);
}

function memberTopology(gitRoot, requestedWorkspace) {
  const route = path.relative(gitRoot, requestedWorkspace).split(path.sep).join("/");
  return {
    kind: "better-harness.workspace-topology",
    schemaVersion: 1,
    requestedWorkspace,
    gitRoot,
    target: {
      kind: "workspace-member",
      route,
      memberRoute: route,
      memberMatch: "exact",
    },
  };
}

function codexRows(sessionId, cwd, paths = [], prompt = null) {
  const rows = [{
    timestamp: "2026-07-20T10:00:00.000Z",
    type: "session_meta",
    payload: { id: sessionId, cwd },
  }];
  if (prompt) {
    rows.push({
      timestamp: "2026-07-20T10:00:01.000Z",
      type: "event_msg",
      payload: { type: "user_message", message: prompt },
    });
  }
  for (const [index, filePath] of paths.entries()) {
    rows.push({
      timestamp: `2026-07-20T10:00:${String(index + 2).padStart(2, "0")}.000Z`,
      type: "response_item",
      payload: {
        type: "function_call",
        name: "read_file",
        arguments: JSON.stringify({ path: filePath }),
      },
    });
  }
  return rows;
}

function qoderRows(sessionId, cwd, paths = [], prompt = null) {
  const rows = [{
    sessionId,
    type: "user",
    cwd,
    timestamp: "2026-07-20T10:00:00.000Z",
    message: prompt ?? "Inspect the selected workspace",
  }];
  for (const [index, filePath] of paths.entries()) {
    rows.push({
      sessionId,
      type: "tool.requested",
      cwd,
      timestamp: `2026-07-20T10:00:${String(index + 2).padStart(2, "0")}.000Z`,
      toolName: "Read",
      args: { path: filePath },
    });
  }
  return rows;
}

function claudeRows(sessionId, cwd, paths = [], prompt = null) {
  const rows = [{
    type: "user",
    sessionId,
    cwd,
    timestamp: "2026-07-20T10:00:00.000Z",
    message: {
      role: "user",
      content: [{ type: "text", text: prompt ?? "Inspect the selected workspace" }],
    },
  }];
  for (const [index, filePath] of paths.entries()) {
    rows.push({
      type: "assistant",
      sessionId,
      cwd,
      timestamp: `2026-07-20T10:00:${String(index + 2).padStart(2, "0")}.000Z`,
      message: {
        role: "assistant",
        content: [{
          type: "tool_use",
          id: `tool-${index + 1}`,
          name: "Read",
          input: { file_path: filePath },
        }],
      },
    });
  }
  return rows;
}

function cursorRows(paths = [], prompt = null) {
  const rows = [{
    role: "user",
    message: {
      content: [{ type: "text", text: prompt ?? "Inspect the selected workspace" }],
    },
  }];
  for (const [index, filePath] of paths.entries()) {
    rows.push({
      role: "assistant",
      message: {
        content: [{
          type: "tool_use",
          id: `tool-${index + 1}`,
          name: "Read",
          input: { file_path: filePath },
        }],
      },
    });
  }
  return rows;
}

function qwenRows(sessionId, cwd, paths = [], prompt = null) {
  const rows = [{
    type: "user",
    sessionId,
    cwd,
    timestamp: "2026-07-20T10:00:00.000Z",
    message: { role: "user", parts: [{ text: prompt ?? "Inspect the selected workspace" }] },
  }];
  for (const [index, filePath] of paths.entries()) {
    rows.push({
      type: "assistant",
      sessionId,
      cwd,
      timestamp: `2026-07-20T10:00:${String(index + 2).padStart(2, "0")}.000Z`,
      message: {
        role: "model",
        parts: [{ functionCall: { id: `tool-${index + 1}`, name: "Read", args: { path: filePath } } }],
      },
    });
  }
  return rows;
}

function copilotRows(sessionId, cwd, paths = [], prompt = null) {
  const rows = [
    {
      type: "session.start",
      timestamp: "2026-07-20T10:00:00.000Z",
      data: { sessionId, context: { cwd } },
    },
    {
      type: "user.message",
      timestamp: "2026-07-20T10:00:01.000Z",
      data: { content: prompt ?? "Inspect the selected workspace" },
    },
  ];
  for (const [index, filePath] of paths.entries()) {
    rows.push({
      type: "tool.execution_start",
      timestamp: `2026-07-20T10:00:${String(index + 2).padStart(2, "0")}.000Z`,
      data: { toolCallId: `tool-${index + 1}`, toolName: "Read", arguments: { path: filePath } },
    });
  }
  return rows;
}

function piRows(sessionId, cwd, paths = [], prompt = null) {
  const rows = [
    { type: "session", version: 3, id: sessionId, cwd, timestamp: "2026-07-20T10:00:00.000Z" },
    {
      type: "message",
      id: `${sessionId}-user`,
      timestamp: "2026-07-20T10:00:01.000Z",
      message: { role: "user", content: [{ type: "text", text: prompt ?? "Inspect the selected workspace" }] },
    },
  ];
  if (paths.length > 0) {
    rows.push({
      type: "message",
      id: `${sessionId}-assistant`,
      timestamp: "2026-07-20T10:00:02.000Z",
      message: {
        role: "assistant",
        content: paths.map((filePath, index) => ({
          type: "toolCall",
          id: `tool-${index + 1}`,
          name: "read",
          arguments: { path: filePath },
        })),
      },
    });
  }
  return rows;
}

async function writeCopilotSession(home, sessionId, cwd, rows) {
  const sessionDir = path.join(home, "session-state", sessionId);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(path.join(sessionDir, "workspace.yaml"), `id: ${sessionId}\ncwd: ${cwd}\n`);
  await writeJsonl(path.join(sessionDir, "events.jsonl"), rows);
}

async function writeCursorMeta(home, sessionId, cwd) {
  await writeJson(path.join(home, "chats", "workspace-hash", sessionId, "meta.json"), {
    schemaVersion: 1,
    cwd,
    createdAtMs: Date.parse("2026-07-20T10:00:00.000Z"),
    updatedAtMs: Date.parse("2026-07-20T10:05:00.000Z"),
    hasConversation: true,
  });
}

test("shared runner qualifies before selection and drops a root session that becomes mixed after hydration", async () => {
  const topology = memberTopology("/repo", "/repo/packages/app");
  const workspaceScope = workspaceMatchScopeFromOptions({ topology });
  const direct = bindSessionWorkspaceCwds({ sessionId: "direct-private" }, ["/repo/packages/app"]);
  const root = bindSessionWorkspaceCwds({ sessionId: "root-private" }, ["/repo"]);
  let rootReads = 0;
  const analyzer = {
    async readSession(session, _scope, options) {
      if (session.sessionId === "direct-private") return markSessionReadCoverage([], { truncated: false });
      rootReads += 1;
      const events = rootReads === 1
        ? [{ cwd: "/repo", filePath: "packages/app/src/a.ts" }]
        : [
            { cwd: "/repo", filePath: "packages/app/src/a.ts" },
            { cwd: "/repo", filePath: "packages/other/src/b.ts" },
          ];
      return options.workspacePreflightMaxLines
        ? { events, truncated: false }
        : markSessionReadCoverage(events, { truncated: false });
    },
    mergeSession(events, session) {
      return { ...session, eventCount: events.length };
    },
  };
  const scope = { workspace: topology.requestedWorkspace, _workspaceMatchScope: workspaceScope };
  const workspaceRun = await qualifyWorkspaceSessionInventory({
    analyzer,
    sessions: [direct, root],
    scope,
    options: {},
  });

  assert.deepEqual(workspaceRun.sessions.map((session) => session.workspaceMatch), ["direct-cwd", "root-cwd"]);
  const hydration = await hydrateWorkspaceSelection({
    analyzer,
    selection: {
      sessions: workspaceRun.sessions,
      strategy: "all-eligible",
      requestedStrategy: "all-eligible",
      eligibleCount: 2,
      analyzedCount: 2,
      strata: [],
    },
    scope,
    workspaceRun,
  });
  assert.deepEqual(hydration.detailedSessions.map((session) => session.sessionId), ["direct-private"]);
  assert.equal(hydration.selection.analyzedCount, 1);
  assert.equal(hydration.hydrationQualifications[0].status, "mixed");

  const diagnostics = withWorkspaceMatchDiagnostics({}, workspaceRun, hydration.hydrationQualifications)
    .sessionWorkspaceMatch;
  assert.equal(diagnostics.preflight.qualified.directCwd, 1);
  assert.equal(diagnostics.preflight.qualified.rootCwd, 1);
  assert.equal(diagnostics.hydration.omitted.mixedActivity, 1);
  assert.doesNotMatch(JSON.stringify(diagnostics), /repo|packages|private|\.ts/u);
});

test("shared runner leaves an inventory untouched when topology is absent", async () => {
  const sessions = [{ sessionId: "legacy", workspace: "/repo/packages/app" }];
  let reads = 0;
  const workspaceRun = await qualifyWorkspaceSessionInventory({
    analyzer: { async readSession() { reads += 1; return []; } },
    sessions,
    scope: { workspace: "/repo/packages/app", _workspaceMatchScope: null },
  });

  assert.equal(workspaceRun.enabled, false);
  assert.equal(workspaceRun.sessions, sessions);
  assert.equal(reads, 0);
  assert.equal(withWorkspaceMatchDiagnostics({ ok: true }, workspaceRun).sessionWorkspaceMatch, undefined);
});

test("show and events recheck root sessions after full hydration", async () => {
  const topology = memberTopology("/repo", "/repo/packages/app");
  const workspaceScope = workspaceMatchScopeFromOptions({ topology });
  const session = bindSessionWorkspaceCwds({
    sessionId: "root-private",
    workspaceMatch: "root-cwd",
  }, ["/repo"]);
  const analyzer = {
    async analyze() {
      return withWorkspaceMatchDiagnostics({ sessions: [session] }, {
        enabled: true,
        qualifications: [{ qualified: true, workspaceMatch: "root-cwd" }],
      });
    },
    async resolveScope() {
      return { workspace: topology.requestedWorkspace, _workspaceMatchScope: workspaceScope };
    },
    async readSession(_session, _scope, options) {
      assert.equal(options.workspacePreflightMaxLines, undefined);
      return markSessionReadCoverage([
        { cwd: "/repo", filePath: "packages/app/src/a.ts" },
        { cwd: "/repo", filePath: "packages/other/src/b.ts" },
      ], { truncated: false });
    },
    mergeSession(events, source) {
      return { ...source, eventCount: events.length };
    },
  };

  const result = await runProviderCommand(analyzer, "events", {
    workspace: topology.requestedWorkspace,
    topology,
    workspacePreflightMaxLines: 1,
    "session-id": session.sessionId,
  });

  assert.deepEqual(result.sessions, []);
  assert.equal(result.sessionWorkspaceMatch.hydration.omitted.mixedActivity, 1);
  assert.doesNotMatch(JSON.stringify(result.sessionWorkspaceMatch), /repo|packages|private|\.ts/u);
});

test("Codex admits direct and target-only root sessions while omitting mixed and prompt-only roots", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "session-codex-root-cwd-"));
  const gitRoot = path.join(fixture, "repo");
  const workspace = path.join(gitRoot, "packages", "app");
  const sibling = path.join(gitRoot, "packages", "other");
  const home = path.join(fixture, ".codex");
  const sessionRoot = path.join(home, "sessions", "2026", "07", "20");
  const topology = memberTopology(gitRoot, workspace);
  await writeJsonl(path.join(sessionRoot, "direct-private.jsonl"), codexRows("direct-private", workspace));
  await writeJsonl(
    path.join(sessionRoot, "root-target-private.jsonl"),
    codexRows("root-target-private", gitRoot, [path.join(workspace, "src", "a.ts")]),
  );
  await writeJsonl(
    path.join(sessionRoot, "root-mixed-private.jsonl"),
    codexRows("root-mixed-private", gitRoot, [path.join(workspace, "src", "a.ts"), path.join(sibling, "b.ts")]),
  );
  await writeJsonl(
    path.join(sessionRoot, "root-prompt-private.jsonl"),
    codexRows("root-prompt-private", gitRoot, [], `Please inspect ${path.join(workspace, "src", "prompt-only.ts")}`),
  );

  const analyzer = new CodexSessionAnalyzer();
  const legacy = await analyzer.analyze({ command: "sessions", workspace, home });
  assert.deepEqual(legacy.sessions.map((session) => session.sessionId), ["direct-private"]);

  const result = await analyzer.analyze({ command: "sessions", workspace, home, topology });
  assert.deepEqual(
    Object.fromEntries(result.sessions.map((session) => [session.sessionId, session.workspaceMatch])),
    { "direct-private": "direct-cwd", "root-target-private": "root-cwd" },
  );
  assert.equal(result.sessionWorkspaceMatch.preflight.omitted.mixedActivity, 1);
  assert.equal(result.sessionWorkspaceMatch.preflight.omitted.noTargetActivity, 1);

  const bounded = await analyzer.analyze({
    command: "sessions",
    workspace,
    home,
    topology,
    workspacePreflightMaxLines: 1,
  });
  assert.deepEqual(bounded.sessions.map((session) => session.sessionId), ["direct-private"]);
  assert.equal(bounded.sessionWorkspaceMatch.preflight.omitted.truncatedPreflight, 3);

  const facts = await analyzer.analyze({
    command: "facts",
    workspace,
    home,
    topology,
    selection: "all-eligible",
    until: "2026-07-21T00:00:00.000Z",
  });
  assert.equal(facts.sessionWorkspaceMatch.preflight.qualified.rootCwd, 1);
  assert.doesNotMatch(
    JSON.stringify(facts.sessionWorkspaceMatch),
    new RegExp(`${path.basename(workspace)}|${path.basename(sibling)}|private`, "u"),
  );
});

test("Qoder scans only target and Git-root transcript identities and keeps legacy discovery unchanged", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "session-qoder-root-cwd-"));
  const gitRoot = path.join(fixture, "repo");
  const workspace = path.join(gitRoot, "packages", "app");
  const sibling = path.join(gitRoot, "packages", "other");
  const home = path.join(fixture, ".qoder");
  const topology = memberTopology(gitRoot, workspace);
  const targetRoot = path.join(home, "projects", workspaceToQoderSlug(workspace));
  const repositoryRoot = path.join(home, "projects", workspaceToQoderSlug(gitRoot));
  const siblingRoot = path.join(home, "projects", workspaceToQoderSlug(sibling));
  await writeJsonl(path.join(targetRoot, "direct-private.jsonl"), qoderRows("direct-private", workspace));
  await writeJsonl(
    path.join(repositoryRoot, "root-target-private.jsonl"),
    qoderRows("root-target-private", gitRoot, [path.join(workspace, "src", "a.ts")]),
  );
  await writeJsonl(
    path.join(repositoryRoot, "root-mixed-private.jsonl"),
    qoderRows("root-mixed-private", gitRoot, [path.join(workspace, "src", "a.ts"), path.join(sibling, "b.ts")]),
  );
  await writeJsonl(
    path.join(repositoryRoot, "root-prompt-private.jsonl"),
    qoderRows("root-prompt-private", gitRoot, [], `Read ${path.join(workspace, "prompt-only.ts")}`),
  );
  await writeJsonl(
    path.join(siblingRoot, "sibling-private.jsonl"),
    qoderRows("sibling-private", sibling, [path.join(workspace, "should-not-join.ts")]),
  );

  const analyzer = new QoderSessionAnalyzer();
  const legacy = await analyzer.analyze({ command: "sessions", workspace, home });
  assert.deepEqual(legacy.sessions.map((session) => session.sessionId), ["direct-private"]);

  const result = await analyzer.analyze({ command: "sessions", workspace, home, topology });
  assert.deepEqual(
    Object.fromEntries(result.sessions.map((session) => [session.sessionId, session.workspaceMatch])),
    { "direct-private": "direct-cwd", "root-target-private": "root-cwd" },
  );
  assert.equal(result.sessions.some((session) => session.sessionId === "sibling-private"), false);
  assert.equal(result.sessionWorkspaceMatch.preflight.omitted.mixedActivity, 1);
  assert.equal(result.sessionWorkspaceMatch.preflight.omitted.noTargetActivity, 1);

  const facts = await analyzer.analyze({
    command: "facts",
    workspace,
    home,
    topology,
    selection: "all-eligible",
    until: "2026-07-21T00:00:00.000Z",
  });
  assert.equal(facts.sessionWorkspaceMatch.preflight.qualified.rootCwd, 1);
  assert.doesNotMatch(
    JSON.stringify(facts.sessionWorkspaceMatch),
    new RegExp(`${path.basename(workspace)}|${path.basename(sibling)}|private`, "u"),
  );
});

test("Claude binds all transcript CWDs and rejects prompt-only, mixed, or conflicting root activity", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "session-claude-root-cwd-"));
  const gitRoot = path.join(fixture, "repo");
  const workspace = path.join(gitRoot, "packages", "app");
  const sibling = path.join(gitRoot, "packages", "other");
  const home = path.join(fixture, ".claude");
  const topology = memberTopology(gitRoot, workspace);
  const targetRoot = path.join(home, "projects", workspaceToClaudeSlugVariants(workspace)[0]);
  const repositoryRoot = path.join(home, "projects", workspaceToClaudeSlugVariants(gitRoot)[0]);
  const siblingRoot = path.join(home, "projects", workspaceToClaudeSlugVariants(sibling)[0]);
  await writeJsonl(path.join(targetRoot, "direct-private.jsonl"), claudeRows("direct-private", workspace));
  await writeJsonl(
    path.join(repositoryRoot, "root-target-private.jsonl"),
    claudeRows("root-target-private", gitRoot, [path.join(workspace, "src", "a.ts")]),
  );
  await writeJsonl(
    path.join(repositoryRoot, "root-mixed-private.jsonl"),
    claudeRows("root-mixed-private", gitRoot, [path.join(workspace, "src", "a.ts"), path.join(sibling, "b.ts")]),
  );
  await writeJsonl(
    path.join(repositoryRoot, "root-prompt-private.jsonl"),
    claudeRows("root-prompt-private", gitRoot, [], `Read ${path.join(workspace, "prompt-only.ts")}`),
  );
  await writeJsonl(
    path.join(repositoryRoot, "root-conflicting-cwd-private.jsonl"),
    [
      ...claudeRows("root-conflicting-cwd-private", gitRoot, [path.join(workspace, "src", "a.ts")]),
      ...claudeRows("root-conflicting-cwd-private", sibling).slice(0, 1),
    ],
  );
  await writeJsonl(
    path.join(siblingRoot, "sibling-private.jsonl"),
    claudeRows("sibling-private", sibling, [path.join(workspace, "should-not-join.ts")]),
  );

  const analyzer = new ClaudeSessionAnalyzer();
  const legacy = await analyzer.analyze({ command: "sessions", workspace, home });
  assert.deepEqual(legacy.sessions.map((session) => session.sessionId), ["direct-private"]);

  const result = await analyzer.analyze({ command: "sessions", workspace, home, topology });
  assert.deepEqual(
    Object.fromEntries(result.sessions.map((session) => [session.sessionId, session.workspaceMatch])),
    { "direct-private": "direct-cwd", "root-target-private": "root-cwd" },
  );
  assert.equal(result.sessions.some((session) => session.sessionId === "sibling-private"), false);
  assert.equal(result.sessionWorkspaceMatch.preflight.omitted.mixedActivity, 1);
  assert.equal(result.sessionWorkspaceMatch.preflight.omitted.noTargetActivity, 1);
  assert.equal(result.sessionWorkspaceMatch.preflight.omitted.unmatchedCwd, 1);

  const bounded = await analyzer.analyze({
    command: "sessions",
    workspace,
    home,
    topology,
    workspacePreflightMaxLines: 1,
  });
  assert.deepEqual(bounded.sessions.map((session) => session.sessionId), ["direct-private"]);
  assert.equal(bounded.sessionWorkspaceMatch.preflight.omitted.truncatedPreflight, 2);
  assert.equal(bounded.sessionWorkspaceMatch.preflight.omitted.noTargetActivity, 1);

  await writeJsonl(
    path.join(repositoryRoot, "root-audit-mixed-private.jsonl"),
    claudeRows("root-audit-mixed-private", gitRoot, [path.join(workspace, "src", "audit-target.ts")]),
  );
  await writeJsonl(path.join(home, "audit", "audit.jsonl"), [{
    event: "tool_input",
    session_id: "root-audit-mixed-private",
    timestamp: "2026-07-20T10:10:00.000Z",
    cwd: gitRoot,
    toolName: "Read",
    toolUseId: "audit-read-private",
    input: { file_path: path.join(sibling, "audit-sibling.ts") },
  }]);

  const facts = await analyzer.analyze({
    command: "facts",
    workspace,
    home,
    topology,
    selection: "all-eligible",
    until: "2026-07-21T00:00:00.000Z",
  });
  assert.equal(facts.sessionWorkspaceMatch.preflight.qualified.rootCwd, 2);
  assert.equal(facts.sessionWorkspaceMatch.hydration.omitted.mixedActivity, 1);
  assert.doesNotMatch(
    JSON.stringify(facts.sessionWorkspaceMatch),
    new RegExp(`${path.basename(workspace)}|${path.basename(sibling)}|private`, "u"),
  );
});

test("Cursor requires chat metadata CWD and does not scan sibling transcript identities", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "session-cursor-root-cwd-"));
  const gitRoot = path.join(fixture, "repo");
  const workspace = path.join(gitRoot, "packages", "app");
  const sibling = path.join(gitRoot, "packages", "other");
  const home = path.join(fixture, ".cursor");
  const topology = memberTopology(gitRoot, workspace);
  const transcriptPath = (identity, sessionId) => path.join(
    home,
    "projects",
    workspaceToCursorSlugVariants(identity)[0],
    "agent-transcripts",
    sessionId,
    `${sessionId}.jsonl`,
  );
  await writeJsonl(transcriptPath(workspace, "direct-private"), cursorRows());
  await writeJsonl(
    transcriptPath(gitRoot, "root-target-private"),
    cursorRows([path.join(workspace, "src", "a.ts")]),
  );
  await writeJsonl(
    transcriptPath(gitRoot, "root-mixed-private"),
    cursorRows([path.join(workspace, "src", "a.ts"), path.join(sibling, "b.ts")]),
  );
  await writeJsonl(
    transcriptPath(gitRoot, "root-prompt-private"),
    cursorRows([], `Read ${path.join(workspace, "prompt-only.ts")}`),
  );
  await writeJsonl(
    transcriptPath(gitRoot, "root-no-meta-private"),
    cursorRows([path.join(workspace, "src", "no-meta.ts")]),
  );
  await writeJsonl(
    transcriptPath(sibling, "sibling-private"),
    cursorRows([path.join(workspace, "should-not-join.ts")]),
  );
  await writeCursorMeta(home, "direct-private", workspace);
  await writeCursorMeta(home, "root-target-private", gitRoot);
  await writeCursorMeta(home, "root-mixed-private", gitRoot);
  await writeCursorMeta(home, "root-prompt-private", gitRoot);
  await writeCursorMeta(home, "sibling-private", sibling);

  const analyzer = new CursorSessionAnalyzer();
  const legacy = await analyzer.analyze({ command: "sessions", workspace, home });
  assert.deepEqual(legacy.sessions.map((session) => session.sessionId), ["direct-private"]);

  const result = await analyzer.analyze({ command: "sessions", workspace, home, topology });
  assert.deepEqual(
    Object.fromEntries(result.sessions.map((session) => [session.sessionId, session.workspaceMatch])),
    { "direct-private": "direct-cwd", "root-target-private": "root-cwd" },
  );
  assert.equal(result.sessions.some((session) => session.sessionId === "sibling-private"), false);
  assert.equal(result.sessionWorkspaceMatch.preflight.omitted.mixedActivity, 1);
  assert.equal(result.sessionWorkspaceMatch.preflight.omitted.noTargetActivity, 1);
  assert.equal(result.sessionWorkspaceMatch.preflight.omitted.unmatchedCwd, 1);

  const bounded = await analyzer.analyze({
    command: "sessions",
    workspace,
    home,
    topology,
    workspacePreflightMaxLines: 1,
  });
  assert.deepEqual(bounded.sessions.map((session) => session.sessionId), ["direct-private"]);
  assert.equal(bounded.sessionWorkspaceMatch.preflight.omitted.truncatedPreflight, 2);
  assert.equal(bounded.sessionWorkspaceMatch.preflight.omitted.noTargetActivity, 1);

  await writeJsonl(
    transcriptPath(gitRoot, "root-audit-mixed-private"),
    cursorRows([path.join(workspace, "src", "audit-target.ts")]),
  );
  await writeCursorMeta(home, "root-audit-mixed-private", gitRoot);
  await writeJsonl(path.join(home, "audit", "audit.jsonl"), [{
    _event: "preToolUse",
    session_id: "root-audit-mixed-private",
    conversation_id: "root-audit-mixed-private",
    timestamp: "2026-07-20T10:10:00.000Z",
    cwd: gitRoot,
    tool_name: "Read",
    tool_use_id: "audit-read-private",
    tool_input: { file_path: path.join(sibling, "audit-sibling.ts") },
  }]);

  const facts = await analyzer.analyze({
    command: "facts",
    workspace,
    home,
    topology,
    selection: "all-eligible",
    until: "2026-07-21T00:00:00.000Z",
  });
  assert.equal(facts.sessionWorkspaceMatch.preflight.qualified.rootCwd, 2);
  assert.equal(facts.sessionWorkspaceMatch.hydration.omitted.mixedActivity, 1);
  assert.doesNotMatch(
    JSON.stringify(facts.sessionWorkspaceMatch),
    new RegExp(`${path.basename(workspace)}|${path.basename(sibling)}|private`, "u"),
  );
});

test("Qwen scans package and Git-root transcript identities with topology qualification", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "session-qwen-root-cwd-"));
  const gitRoot = path.join(fixture, "repo");
  const workspace = path.join(gitRoot, "packages", "app");
  const sibling = path.join(gitRoot, "packages", "other");
  const home = path.join(fixture, ".qwen");
  const topology = memberTopology(gitRoot, workspace);
  const transcript = (identity, sessionId) => path.join(
    home,
    "projects",
    workspaceToQwenSlugVariants(identity)[0],
    "chats",
    `${sessionId}.jsonl`,
  );
  await writeJsonl(transcript(workspace, "direct-private"), qwenRows("direct-private", workspace));
  await writeJsonl(
    transcript(gitRoot, "root-target-private"),
    qwenRows("root-target-private", gitRoot, [path.join(workspace, "src", "a.ts")]),
  );
  await writeJsonl(
    transcript(gitRoot, "root-mixed-private"),
    qwenRows("root-mixed-private", gitRoot, [path.join(workspace, "src", "a.ts"), path.join(sibling, "b.ts")]),
  );
  await writeJsonl(
    transcript(gitRoot, "root-prompt-private"),
    qwenRows("root-prompt-private", gitRoot, [], `Read ${path.join(workspace, "prompt-only.ts")}`),
  );

  const analyzer = new QwenSessionAnalyzer();
  const legacy = await analyzer.analyze({ command: "sessions", workspace, home });
  assert.deepEqual(legacy.sessions.map((session) => session.sessionId), ["direct-private"]);

  const result = await analyzer.analyze({ command: "sessions", workspace, home, topology });
  assert.deepEqual(
    Object.fromEntries(result.sessions.map((session) => [session.sessionId, session.workspaceMatch])),
    { "direct-private": "direct-cwd", "root-target-private": "root-cwd" },
  );
  assert.equal(result.sessionWorkspaceMatch.preflight.omitted.mixedActivity, 1);
  assert.equal(result.sessionWorkspaceMatch.preflight.omitted.noTargetActivity, 1);
});

test("Copilot qualifies Git-root sessions from trusted tool paths", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "session-copilot-root-cwd-"));
  const gitRoot = path.join(fixture, "repo");
  const workspace = path.join(gitRoot, "packages", "app");
  const sibling = path.join(gitRoot, "packages", "other");
  const home = path.join(fixture, ".copilot");
  const topology = memberTopology(gitRoot, workspace);
  await writeCopilotSession(home, "direct-private", workspace, copilotRows("direct-private", workspace));
  await writeCopilotSession(
    home,
    "root-target-private",
    gitRoot,
    copilotRows("root-target-private", gitRoot, [path.join(workspace, "src", "a.ts")]),
  );
  await writeCopilotSession(
    home,
    "root-mixed-private",
    gitRoot,
    copilotRows("root-mixed-private", gitRoot, [path.join(workspace, "src", "a.ts"), path.join(sibling, "b.ts")]),
  );
  await writeCopilotSession(
    home,
    "root-prompt-private",
    gitRoot,
    copilotRows("root-prompt-private", gitRoot, [], `Read ${path.join(workspace, "prompt-only.ts")}`),
  );

  const analyzer = new CopilotSessionAnalyzer();
  const legacy = await analyzer.analyze({ command: "sessions", workspace, home });
  assert.deepEqual(legacy.sessions.map((session) => session.sessionId), ["direct-private"]);

  const result = await analyzer.analyze({ command: "sessions", workspace, home, topology });
  assert.deepEqual(
    Object.fromEntries(result.sessions.map((session) => [session.sessionId, session.workspaceMatch])),
    { "direct-private": "direct-cwd", "root-target-private": "root-cwd" },
  );
  assert.equal(result.sessionWorkspaceMatch.preflight.omitted.mixedActivity, 1);
  assert.equal(result.sessionWorkspaceMatch.preflight.omitted.noTargetActivity, 1);
});

test("Pi scans package and Git-root session directories with topology qualification", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "session-pi-root-cwd-"));
  const gitRoot = path.join(fixture, "repo");
  const workspace = path.join(gitRoot, "packages", "app");
  const sibling = path.join(gitRoot, "packages", "other");
  const home = path.join(fixture, ".pi", "agent");
  const topology = memberTopology(gitRoot, workspace);
  const transcript = (identity, sessionId) => path.join(
    home,
    "sessions",
    workspaceToPiSessionDirVariants(identity).exact,
    `2026-07-20T10-00-00-000Z_${sessionId}.jsonl`,
  );
  await writeJsonl(transcript(workspace, "direct-private"), piRows("direct-private", workspace));
  await writeJsonl(
    transcript(gitRoot, "root-target-private"),
    piRows("root-target-private", gitRoot, [path.join(workspace, "src", "a.ts")]),
  );
  await writeJsonl(
    transcript(gitRoot, "root-mixed-private"),
    piRows("root-mixed-private", gitRoot, [path.join(workspace, "src", "a.ts"), path.join(sibling, "b.ts")]),
  );
  await writeJsonl(
    transcript(gitRoot, "root-prompt-private"),
    piRows("root-prompt-private", gitRoot, [], `Read ${path.join(workspace, "prompt-only.ts")}`),
  );

  const analyzer = new PiSessionAnalyzer();
  const legacy = await analyzer.analyze({ command: "sessions", workspace, home });
  assert.deepEqual(legacy.sessions.map((session) => session.sessionId), ["direct-private"]);

  const result = await analyzer.analyze({ command: "sessions", workspace, home, topology });
  assert.deepEqual(
    Object.fromEntries(result.sessions.map((session) => [session.sessionId, session.workspaceMatch])),
    { "direct-private": "direct-cwd", "root-target-private": "root-cwd" },
  );
  assert.equal(result.sessionWorkspaceMatch.preflight.omitted.mixedActivity, 1);
  assert.equal(result.sessionWorkspaceMatch.preflight.omitted.noTargetActivity, 1);
});
