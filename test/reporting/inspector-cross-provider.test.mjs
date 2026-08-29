import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { fileURLToPath } from "node:url";

import { collectMultiPlatformSessionSummaries } from "../../scripts/commit-session-link/index.mjs";
import {
  buildHarnessInspectorReport,
  parseFeatureTreeMarkdown,
  renderHarnessInspectorHtml,
} from "../../scripts/harness-inspector/index.mjs";

const CLI_PATH = fileURLToPath(new URL("../../scripts/harness-inspector/cli.mjs", import.meta.url));

function fakeAnalyzer({ sessions = [], rootsExist = true, failAt = null } = {}) {
  return {
    async resolveScope(options) {
      if (failAt === "resolveScope") throw new Error("scope failure");
      return { workspace: options.workspace };
    },
    async discoverSourceRoots() {
      if (failAt === "discoverSourceRoots") throw new Error("roots failure");
      return [{ id: "root", kind: "fixture", exists: rootsExist, enabled: true }];
    },
    async discoverSessions() {
      if (failAt === "discoverSessions") throw new Error("discovery failure");
      return sessions;
    },
    async readSession(session) {
      if (failAt === "readSession") throw new Error("hydration failure");
      return [{
        type: "tool.requested",
        category: "tool",
        lifecyclePhase: "request",
        toolName: "Read",
        toolInvocationId: `${session.sessionId}-call-1`,
        timestamp: session.lastSeen,
      }];
    },
  };
}

function candidateSession(sessionId, lastSeen) {
  return { sessionId, firstSeen: lastSeen, lastSeen };
}

test("multi-platform collector merges providers by recency under one bound (AC-1, AC-3)", async () => {
  const analyzers = {
    qoder: fakeAnalyzer({
      sessions: [
        candidateSession("qoder-new", "2026-08-12T10:00:00.000Z"),
        candidateSession("qoder-old", "2026-08-10T10:00:00.000Z"),
      ],
    }),
    claude: fakeAnalyzer({ sessions: [candidateSession("claude-mid", "2026-08-11T10:00:00.000Z")] }),
    codex: fakeAnalyzer({ rootsExist: false }),
  };
  const { sessions, providers } = await collectMultiPlatformSessionSummaries({
    workspace: "/workspace/repo",
    repoRoot: "/workspace/repo",
    platforms: ["qoder", "claude", "codex"],
    maxSessions: 2,
    createAnalyzer: async (platform) => analyzers[platform],
  });
  assert.deepEqual(sessions.map((session) => `${session.platform}/${session.sessionId}`), [
    "qoder/qoder-new",
    "claude/claude-mid",
  ]);
  assert.deepEqual(providers, [
    { platform: "qoder", status: "ok", discovered: 2, included: 1 },
    { platform: "claude", status: "ok", discovered: 1, included: 1 },
    { platform: "codex", status: "no-evidence", discovered: 0, included: 0 },
  ]);
});

test("one failing provider degrades to a status instead of failing the collection (AC-2)", async () => {
  for (const failAt of ["resolveScope", "discoverSourceRoots", "discoverSessions", "readSession"]) {
    const analyzers = {
      qoder: fakeAnalyzer({ sessions: [candidateSession("qoder-a", "2026-08-12T10:00:00.000Z")] }),
      claude: fakeAnalyzer({ sessions: [candidateSession("claude-a", "2026-08-11T10:00:00.000Z")], failAt }),
    };
    const { sessions, providers } = await collectMultiPlatformSessionSummaries({
      workspace: "/workspace/repo",
      repoRoot: "/workspace/repo",
      platforms: ["qoder", "claude"],
      createAnalyzer: async (platform) => analyzers[platform],
    });
    assert.deepEqual(sessions.map((session) => session.sessionId), ["qoder-a"], failAt);
    const claude = providers.find((provider) => provider.platform === "claude");
    assert.equal(claude.status, "error", failAt);
    assert.match(claude.message, /failure/u);
  }
});

test("unknown platform errors propagate per provider through the injected factory", async () => {
  const { sessions, providers } = await collectMultiPlatformSessionSummaries({
    workspace: "/workspace/repo",
    repoRoot: "/workspace/repo",
    platforms: ["bogus"],
    createAnalyzer: async () => { throw new Error("Unsupported platform: bogus"); },
  });
  assert.deepEqual(sessions, []);
  assert.equal(providers[0].status, "error");
});

test("report model projects providers with recomputed session counts (AC-6)", () => {
  const report = buildHarnessInspectorReport({
    repoRoot: "/workspace/repo",
    featureTree: parseFeatureTreeMarkdown("- [ ] Root\n  - [ ] Story\n"),
    sessions: [
      { sessionId: "session-a", platform: "qoder", firstSeen: "2026-08-12T08:00:00.000Z", lastSeen: "2026-08-12T09:00:00.000Z" },
      { sessionId: "session-b", platform: "claude", firstSeen: "2026-08-12T08:00:00.000Z", lastSeen: "2026-08-12T09:00:00.000Z" },
    ],
    correlation: { schemaVersion: 1, commits: [] },
    providers: [
      { platform: "qoder", status: "ok", discovered: 4, included: 1 },
      { platform: "claude", status: "ok", discovered: 1, included: 1 },
      { platform: "codex", status: "no-evidence", discovered: 0, included: 0 },
      { platform: "cursor", status: "invented-status", discovered: -3.7, message: "/Users/private/leak" },
    ],
    filters: { platform: "all" },
  });
  assert.equal(report.filters.platform, "all");
  assert.deepEqual(report.providers, [
    { platform: "qoder", status: "ok", discovered: 4, sessionCount: 1 },
    { platform: "claude", status: "ok", discovered: 1, sessionCount: 1 },
    { platform: "codex", status: "no-evidence", discovered: 0, sessionCount: 0 },
    { platform: "cursor", status: "ok", discovered: 0, sessionCount: 0 },
  ]);
  assert.doesNotMatch(JSON.stringify(report), /\/Users\/private/u);
});

test("HTML header badge names contributing providers and falls back to the filter (AC-6)", () => {
  const base = {
    repoRoot: "/workspace/repo",
    featureTree: parseFeatureTreeMarkdown("- [ ] Root\n  - [ ] Story\n"),
    correlation: { schemaVersion: 1, commits: [] },
    filters: { platform: "all" },
  };
  const contributing = buildHarnessInspectorReport({
    ...base,
    sessions: [
      { sessionId: "session-a", platform: "qoder", firstSeen: "2026-08-12T08:00:00.000Z", lastSeen: "2026-08-12T09:00:00.000Z" },
      { sessionId: "session-b", platform: "claude", firstSeen: "2026-08-12T08:00:00.000Z", lastSeen: "2026-08-12T09:00:00.000Z" },
    ],
    providers: [
      { platform: "qoder", status: "ok", discovered: 1 },
      { platform: "claude", status: "ok", discovered: 1 },
      { platform: "codex", status: "no-evidence", discovered: 0 },
    ],
  });
  assert.match(renderHarnessInspectorHtml(contributing), /qoder · claude · 2 sessions/u);

  const empty = buildHarnessInspectorReport({ ...base, sessions: [], providers: [] });
  assert.match(renderHarnessInspectorHtml(empty), /all · 0 sessions/u);
});

test("CLI rejects unsupported platforms before reading any workspace state (AC-4)", () => {
  const result = spawnSync(process.execPath, [CLI_PATH, "render", "--platform", "bogus-host"], {
    cwd: os.tmpdir(),
    encoding: "utf8",
  });
  assert.equal(result.status, 64);
  assert.match(result.stderr, /--platform expects all or a comma list of/u);
  assert.match(result.stderr, /qoder/u);
  assert.equal(result.stderr.includes("bogus-host"), false);
});

test("a leading option flag implies the render command (AC-5)", () => {
  const implicit = spawnSync(process.execPath, [CLI_PATH, "--platform", "bogus-host"], {
    cwd: os.tmpdir(),
    encoding: "utf8",
  });
  assert.equal(implicit.status, 64);
  assert.match(implicit.stderr, /--platform expects all or a comma list of/u);

  const unknown = spawnSync(process.execPath, [CLI_PATH, "inspect"], { cwd: os.tmpdir(), encoding: "utf8" });
  assert.equal(unknown.status, 64);
  assert.match(unknown.stderr, /Unknown command; expected render/u);
});

test("Inspector renders workspace-qualified Augment usage and dialogue from the default local home", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "augment-inspector-"));
  try {
    const workspace = path.join(fixture, "workspace");
    const sessionsDir = path.join(fixture, ".augment", "sessions");
    const output = path.join(fixture, "augment-inspector.html");
    await mkdir(workspace, { recursive: true });
    await mkdir(sessionsDir, { recursive: true });
    const git = (...args) => spawnSync("git", args, { cwd: workspace, encoding: "utf8" });
    git("init", "--initial-branch=main");
    git("config", "commit.gpgsign", "false");
    git("config", "user.email", "inspector@example.com");
    git("config", "user.name", "Inspector Test");
    await writeFile(path.join(workspace, "README.md"), "# fixture\n", "utf8");
    git("add", "README.md");
    git("commit", "-m", "chore: seed fixture");

    const startedAt = Date.parse("2026-08-29T02:00:00.000Z");
    await writeFile(path.join(sessionsDir, "augment-inspector-session.json"), `${JSON.stringify({
      sessionId: "augment-inspector-session",
      created: "2026-08-29T02:00:00.000Z",
      modified: "2026-08-29T02:00:05.000Z",
      chatHistory: [{
        finishedAt: "2026-08-29T02:00:05.000Z",
        exchange: {
          request_id: "request-1",
          request_nodes: [
            { id: 1, type: 0, text_node: { content: "Inspect the Augment context window" } },
            {
              id: 2,
              type: 4,
              ide_state_node: {
                current_terminal: { current_working_directory: workspace },
                workspace_folders: [{ folder_root: workspace, repository_root: workspace }],
              },
            },
          ],
          response_nodes: [
            { id: 1, type: 0, content: "The observed context is healthy.", timestamp_ms: startedAt + 1_000 },
            {
              id: 2,
              type: 10,
              timestamp_ms: startedAt + 2_000,
              token_usage: {
                input_tokens: 1_000,
                output_tokens: 100,
                cache_read_input_tokens: 19_000,
                cache_creation_input_tokens: 0,
                max_context_tokens: 200_000,
              },
            },
          ],
        },
      }],
    }, null, 2)}\n`, "utf8");

    const result = spawnSync(process.execPath, [
      CLI_PATH,
      "render",
      "--workspace", workspace,
      "--platform", "augment",
      "--since", "2026-08-29",
      "--until", "2026-08-29",
      "--out", output,
    ], {
      cwd: workspace,
      encoding: "utf8",
      env: { ...process.env, HOME: fixture },
    });
    assert.equal(result.status, 0, result.stderr);
    const html = await readFile(output, "utf8");
    assert.match(html, /augment · 1 session/u);
    assert.match(html, /Inspect the Augment context window/u);
    assert.match(html, /"currentContextTokens":20000/u);
    assert.match(html, /"windowTokens":200000/u);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
