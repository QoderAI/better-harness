import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { runAgentLint } from "../../../scripts/agent-lint/index.mjs";
import { buildInsightPack } from "../../../scripts/session-analysis/insights.mjs";
import { createUploadPlan } from "../../../scripts/task-evidence-upload/index.mjs";
import { aggregateDeliverySignals, projectDeliverySignals } from "../scripts/delivery-signals.mjs";
import {
  MAX_ATTRIBUTED_COMMIT_REFS,
  projectCommitAttribution,
  projectTopology,
} from "../scripts/repository-signals.mjs";
import { providerBreakdown } from "../scripts/collect-local-data.mjs";
import { readUploadDeliveries, storeUploadPlan } from "../scripts/upload-store.mjs";

function evidenceRef(line) {
  return { kind: "fixture-jsonl", path: "/Users/private/.host/projects/session.jsonl", line, seq: 0, type: "tool.call" };
}

function insightEvents() {
  return [
    { sessionId: "s1", type: "tool.call", toolName: "Edit", operation: "edit", timestamp: "2026-09-01T10:00:00.000Z", evidenceRef: evidenceRef(1) },
    { sessionId: "s1", type: "tool.call", toolName: "Bash", commandText: "npm test", timestamp: "2026-09-01T10:01:00.000Z", evidenceRef: evidenceRef(2) },
    { sessionId: "s1", type: "tool.result", success: false, summary: "command failed", timestamp: "2026-09-01T10:02:00.000Z", evidenceRef: evidenceRef(3) },
  ];
}

test("delivery signals project the analyzer's own behavior fields without evidence paths", () => {
  const insights = buildInsightPack({
    scope: { platform: "fixture", workspace: "/work" },
    sources: [],
    sessions: [{ sessionId: "s1" }],
    facets: { sessionCount: 1, analyzedSessionCount: 1, topTools: [{ name: "Edit", count: 1 }] },
    events: insightEvents(),
    warnings: [],
  });
  const signals = projectDeliverySignals(insights);

  assert.equal(signals.validationAfterEdit.editCount >= 1, true);
  assert.deepEqual(signals.validationCommands.map((row) => row.name), ["npm test"]);
  assert.equal(signals.episodes.episodeCount >= 1, true);
  assert.equal(signals.friction.some((row) => row.name === "failed-event"), true);
  // Evidence refs carry absolute session-file paths and must not travel.
  assert.equal(JSON.stringify(signals).includes("/Users/private"), false);
  assert.equal(JSON.stringify(signals).includes("evidenceRef"), false);
});

test("a host without an insight pack stays absent instead of reading as zeros", () => {
  assert.equal(projectDeliverySignals(undefined), null);
  assert.equal(aggregateDeliverySignals([null, null]), null);
});

test("aggregated delivery status reports the strongest observation across hosts", () => {
  const validated = {
    validationAfterEdit: { status: "validated-after-edit", editCount: 3, validationAfterEditCount: 2, relevantValidationCount: 1 },
    validationCommands: [{ name: "vitest", count: 4 }],
    episodes: { episodeCount: 2, eligibleEpisodeCount: 2, closedEpisodeCount: 1, unobservedClosureCount: 1 },
    friction: [{ name: "failed-event", count: 1 }],
    topTools: [{ name: "Bash", count: 5 }],
    observedHooks: [],
  };
  const unvalidated = {
    validationAfterEdit: { status: "edit-without-validation", editCount: 7, validationAfterEditCount: 0, relevantValidationCount: 0 },
    validationCommands: [{ name: "vitest", count: 1 }],
    episodes: { episodeCount: 5, eligibleEpisodeCount: 3, closedEpisodeCount: 0, unobservedClosureCount: 3 },
    friction: [{ name: "failed-event", count: 2 }],
    topTools: [{ name: "Bash", count: 2 }, { name: "Read", count: 9 }],
    observedHooks: [],
  };
  const combined = aggregateDeliverySignals([validated, unvalidated, null]);

  assert.equal(combined.validationAfterEdit.status, "validated-after-edit");
  assert.equal(combined.validationAfterEdit.editCount, 10);
  assert.equal(combined.validationAfterEdit.validationAfterEditCount, 2);
  assert.deepEqual(combined.validationCommands, [{ name: "vitest", count: 5 }]);
  assert.deepEqual(combined.topTools, [{ name: "Read", count: 9 }, { name: "Bash", count: 7 }]);
  assert.equal(combined.episodes.closedEpisodeCount, 1);
});

test("commit attribution counts only matches strong enough to attribute", () => {
  const projection = projectCommitAttribution({
    graceMinutes: 45,
    sessionCount: 4,
    commits: [
      { hash: "aaa1", linesAdded: 100, linesRemoved: 10, matches: [{ sessionId: "s-1", platform: "codex", confidence: "high" }] },
      { hash: "bbb2", linesAdded: 40, linesRemoved: 4, matches: [{ sessionId: "s-2", platform: "claude", confidence: "medium" }] },
      // A `low` match is a bare time overlap that every concurrent session
      // satisfies, so it attributes nothing.
      { hash: "ccc3", linesAdded: 60, linesRemoved: 6, matches: [{ sessionId: "s-3", platform: "codex", confidence: "low" }] },
      { hash: "ddd4", linesAdded: 20, linesRemoved: 2, matches: [] },
    ],
  });

  assert.equal(projection.commitCount, 4);
  assert.equal(projection.attributedCommits, 2);
  assert.equal(projection.linesAdded, 220);
  assert.equal(projection.attributedLinesAdded, 140);
  assert.deepEqual(projection.byConfidence, { explicit: 0, high: 1, medium: 1, low: 0 });
  assert.deepEqual(projection.byPlatform, [
    { platform: "claude", commitCount: 1 },
    { platform: "codex", commitCount: 1 },
  ]);
  // Only the attributing commits carry a reference, and each one names the
  // session that earned the attribution.
  assert.deepEqual(projection.attributedCommitRefs, [
    { commit: "aaa1", sessionId: "s-1", platform: "codex", confidence: "high" },
    { commit: "bbb2", sessionId: "s-2", platform: "claude", confidence: "medium" },
  ]);
});

test("commit references stay bounded while the counts remain complete", () => {
  const commits = Array.from({ length: MAX_ATTRIBUTED_COMMIT_REFS + 25 }, (_, index) => ({
    hash: `hash-${index}`,
    linesAdded: 1,
    linesRemoved: 0,
    matches: [{ sessionId: `s-${index}`, platform: "codex", confidence: "high" }],
  }));
  const projection = projectCommitAttribution({ graceMinutes: 45, sessionCount: 1, commits });

  assert.equal(projection.attributedCommits, MAX_ATTRIBUTED_COMMIT_REFS + 25);
  assert.equal(projection.attributedCommitRefs.length, MAX_ATTRIBUTED_COMMIT_REFS);
});

test("an attributed commit missing either half of the key contributes no reference", () => {
  // A blank commit or session id is a join key that matches nothing, so it is
  // left out entirely rather than emitted empty. The attribution still counts.
  const projection = projectCommitAttribution({
    graceMinutes: 45,
    sessionCount: 2,
    commits: [
      { linesAdded: 5, linesRemoved: 1, matches: [{ sessionId: "s-1", platform: "codex", confidence: "high" }] },
      { hash: "aaa1", linesAdded: 5, linesRemoved: 1, matches: [{ platform: "codex", confidence: "high" }] },
      { hash: "   ", linesAdded: 5, linesRemoved: 1, matches: [{ sessionId: "s-3", platform: "codex", confidence: "high" }] },
      { hash: "ddd4", linesAdded: 5, linesRemoved: 1, matches: [{ sessionId: "s-4", platform: "codex", confidence: "high" }] },
    ],
  });

  assert.equal(projection.attributedCommits, 4);
  assert.deepEqual(projection.attributedCommitRefs, [
    { commit: "ddd4", sessionId: "s-4", platform: "codex", confidence: "high" },
  ]);
});

test("a commit identified only by its short hash still yields a reference", () => {
  const projection = projectCommitAttribution({
    graceMinutes: 45,
    sessionCount: 1,
    commits: [
      { shortHash: "eee5", linesAdded: 1, linesRemoved: 0, matches: [{ sessionId: "s-5", platform: "qoder", confidence: "explicit" }] },
    ],
  });

  assert.deepEqual(projection.attributedCommitRefs, [
    { commit: "eee5", sessionId: "s-5", platform: "qoder", confidence: "explicit" },
  ]);
});

test("topology projection keeps member routes and instruction activation", () => {
  const projection = projectTopology({
    target: { kind: "repo-root" },
    members: { items: [{ route: "packages/app", kind: "manifest" }], total: 1 },
    instructionScopes: {
      items: [
        { route: "AGENTS.md", provider: "codex", activation: "effective" },
        { route: "nested/AGENTS.md", provider: "codex", activation: "candidate" },
      ],
      total: 2,
    },
    discovery: { tracked: 42 },
  });

  assert.equal(projection.target, "repo-root");
  assert.deepEqual(projection.members, [{ route: "packages/app", kind: "manifest" }]);
  assert.deepEqual(projection.instructionScopes, { total: 2, effective: 1, candidate: 1 });
  assert.equal(projection.trackedFiles, 42);
});

test("per-host rows keep each host's own coverage and cache relationship", () => {
  const rows = providerBreakdown([
    {
      provider: "codex",
      summary: {
        selection: { analyzedCount: 3, eligibleCount: 3 },
        usageEfficiency: {
          accountingMode: "host-estimated",
          coverage: { responseCount: 30, modelAttributedResponseCount: 0, cacheAccountingModes: ["included-in-input"] },
          tokenTotals: null,
        },
      },
      activity: { sessions: { activeMinutes: [1.5, 2.5] } },
      delivery: {
        validationAfterEdit: { editCount: 4 },
        episodes: { episodeCount: 6 },
      },
    },
  ]);

  assert.deepEqual(rows, [{
    provider: "codex",
    analyzedSessions: 3,
    eligibleSessions: 3,
    responseCount: 30,
    modelAttributedResponseCount: 0,
    activeMinutes: 4,
    accountingMode: "host-estimated",
    cacheAccountingModes: ["included-in-input"],
    tokenTotals: null,
    editCount: 4,
    episodeCount: 6,
  }]);
});

test("agent-lint reports host-stable asset identities beside its per-host counts", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "harness-ui-assets-"));
  try {
    const skillPath = path.join(workspace, ".agents", "skills", "review", "SKILL.md");
    await mkdir(path.dirname(skillPath), { recursive: true });
    await writeFile(skillPath, "---\nname: review\ndescription: Review a change.\n---\n\n# Review\n", "utf8");
    const inventory = {
      provider: "qoder",
      plugins: [],
      manage: {
        skills: [{
          id: "project:skill:review",
          kind: "skill",
          name: "review",
          scope: "project",
          enabled: true,
          filePath: skillPath,
        }],
        mcps: [{ id: "project:mcp:docs", kind: "mcp", name: "docs", scope: "project", enabled: true, command: "node", args: ["server.mjs"] }],
        hooks: [], commands: [], rules: [], subagents: [], plugins: [],
      },
    };
    const report = await runAgentLint({ workspace, profile: "agent-assets-review", provider: "qoder", inventory });

    assert.equal(report.assetInventory.summary.skills, 1);
    assert.equal(report.assetInventory.assetsTruncated, false);
    const skill = report.assetInventory.assets.find((asset) => asset.kind === "skill");
    // A workspace file is identified by its relative path, so a second host
    // reading the same file produces the same identity.
    assert.equal(skill.id, ".agents/skills/review/SKILL.md");
    // An entry without a file keeps a scope-qualified name, never a private path.
    const mcp = report.assetInventory.assets.find((asset) => asset.kind === "mcp");
    assert.equal(mcp.id, "project:mcp:docs");
    assert.equal(JSON.stringify(report.assetInventory.assets).includes(workspace), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("stored deliveries carry the acceptance facts a packet cannot hold", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harness-ui-deliveries-"));
  try {
    const plan = createUploadPlan({
      input: {
        kind: "better-harness.task-evidence-input",
        schemaVersion: 1,
        task: {
          id: "TASK-9",
          title: "Record a delivery",
          intent: "Keep organization identity with the packet.",
          acceptance: [{ id: "AC-1", status: "passed", summary: "Stored." }],
        },
        assets: [],
        observations: [],
      },
      destination: "https://harness.example.test/evidence",
      organization: "acme-engineering",
      workspace: directory,
      workspaceLabel: "fixture",
      now: new Date("2026-09-01T10:00:00.000Z"),
    });
    await storeUploadPlan(plan, { directory, now: new Date("2026-09-01T10:05:00.000Z") });

    const { deliveries, total, truncated } = await readUploadDeliveries({ directory });
    assert.equal(total, 1);
    assert.equal(truncated, false);
    assert.equal(deliveries[0].organization, "acme-engineering");
    assert.equal(deliveries[0].receiptState, "accepted");
    assert.equal(deliveries[0].acceptedAt, "2026-09-01T10:05:00.000Z");
    assert.equal(deliveries[0].packetDigest, plan.packetDigest);
    assert.equal(deliveries[0].packet.task.id, "TASK-9");

    // A bounded read still reports how many records exist.
    const bounded = await readUploadDeliveries({ directory, limit: 0 });
    assert.deepEqual(bounded.deliveries, []);
    assert.equal(bounded.total, 1);
    assert.equal(bounded.truncated, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
