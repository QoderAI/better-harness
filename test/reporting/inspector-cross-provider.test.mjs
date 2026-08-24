import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import os from "node:os";
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
