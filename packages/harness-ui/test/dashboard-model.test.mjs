import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { runAgentLint } from "../../../scripts/agent-lint/index.mjs";
import { buildUsageSummary } from "../../../scripts/session-analysis/usage-summary.mjs";
import { buildDailyUsageActivity } from "../../../scripts/session-analysis/daily-usage.mjs";
import { createTaskEvidencePacket } from "../../../scripts/task-evidence-upload/index.mjs";
import { dashboardProjectOptions, selectDashboardProject } from "../components/usage-dashboard.tsx";
import { buildDashboardModel } from "../lib/dashboard-model.ts";

function usageResult() {
  return {
    selection: { strategy: "all-eligible", eligibleCount: 2, analyzedCount: 2 },
    warnings: [{ code: "fixture-warning" }],
    insights: {
      keySignals: {
        usageEfficiency: {
          accountingMode: "effort-proxy",
          coverage: {
            analyzedSessionCount: 2,
            responseCount: 3,
            usageFieldObservedCount: 2,
            nonZeroUsageCount: 2,
            modelAttributedResponseCount: 3,
            unattributedResponseCount: 0,
            exactCreditsAvailable: false,
          },
          longSessions: { longActiveCount: 1, longWallCount: 1, wallOnlyCount: 0 },
          tokenTotals: { inputTokens: 120, outputTokens: 30, cacheReadInputTokens: 10, cacheCreationInputTokens: 0 },
          modelUsage: [{
            model: "example-model",
            responseCount: 3,
            usageFieldObservedCount: 2,
            nonZeroUsageCount: 2,
            tokenTotals: { inputTokens: 120, outputTokens: 30, cacheReadInputTokens: 10, cacheCreationInputTokens: 0 },
          }],
          candidates: [{ id: "private" }],
          opportunities: [],
          outcomeReview: {
            status: "required",
            reviewedCandidateCount: 0,
            reviewedActiveLongCount: 0,
            comparableModelOutcomeEvidence: false,
            reason: "semantic-review-required",
          },
        },
      },
    },
  };
}

function packetInput() {
  return {
    kind: "better-harness.task-evidence-input",
    schemaVersion: 1,
    task: {
      id: "TASK-1",
      title: "Verify the Dashboard contract",
      intent: "Keep UI fields aligned with existing scripts.",
      acceptance: [
        { id: "AC-1", status: "passed", summary: "The projection test passes." },
        { id: "AC-2", status: "unobserved", summary: "Remote upload is unavailable." },
      ],
    },
    assets: [{ kind: "skill", id: "better-harness", match: "exact", stage: "validated", outcome: "succeeded" }],
    observations: [{ kind: "validation", status: "passed", summary: "Focused tests passed." }],
  };
}

test("project selection resolves one Dashboard input without aggregating projects", () => {
  const first = { workspace: { id: "local-workspace:first", label: "first" } };
  const second = { workspace: { id: "local-workspace:second", label: "second" } };
  const projects = dashboardProjectOptions([first, second]);

  assert.deepEqual(projects.map(({ id, label }) => ({ id, label })), [
    { id: "local-workspace:first", label: "first" },
    { id: "local-workspace:second", label: "second" },
  ]);
  assert.equal(selectDashboardProject(projects, "local-workspace:second").input, second);
  assert.equal(selectDashboardProject(projects, "missing").input, first);
});

test("dashboard projects values built by the real scripts", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "harness-ui-contract-"));
  try {
    const usageSummary = buildUsageSummary(usageResult());
    const usageActivity = buildDailyUsageActivity(
      [
        { sessionId: "a", firstSeen: "2026-08-30T10:00:00.000Z" },
        { sessionId: "b", firstSeen: "2026-09-01T10:00:00.000Z" },
      ],
      [
        { id: "a", firstSeen: "2026-08-30T10:00:00.000Z", activeMs: 120_000 },
        { id: "b", firstSeen: "2026-09-01T10:00:00.000Z", activeMs: 30_000 },
      ],
      [{
        sessionId: "a",
        timestamp: "2026-08-30T10:01:00.000Z",
        model: "example-model",
        modelUsage: { inputTokens: 120, outputTokens: 30, cacheReadInputTokens: 10, cacheCreationInputTokens: 0 },
      }],
      [
        { sessionId: "a", timestamp: "2026-08-30T10:00:30.000Z", skillName: "better-harness" },
        { sessionId: "b", timestamp: "2026-09-01T10:00:30.000Z", skillName: "better-harness" },
        { sessionId: "a", timestamp: "2026-08-30T10:00:40.000Z", toolName: "mcp__docs__search", toolInvocationId: "mcp-1" },
      ],
    );
    const assetInventory = await runAgentLint({
      workspace,
      profile: "agent-assets-review",
      provider: "qoder",
      inventory: {
        provider: "qoder",
        plugins: [],
        manage: {
          skills: [{ id: "project:skill:one", kind: "skill", name: "one", scope: "project", enabled: true }],
          mcps: [{ id: "project:mcp:docs", kind: "mcp", name: "docs", scope: "project", enabled: true, command: "node", args: ["server.mjs"] }],
          hooks: [{ id: "project:hook:done", kind: "hook", name: "done", label: "done", scope: "project", enabled: true }],
          commands: [], rules: [], subagents: [], plugins: [],
        },
      },
    });
    const packet = createTaskEvidencePacket(packetInput(), {
      workspace,
      workspaceLabel: "fixture",
      now: new Date("2026-09-01T12:00:00.000Z"),
    });

    const model = buildDashboardModel({
      generatedAt: "2026-09-01T12:10:00.000Z",
      sources: { sessionProviders: ["qoder"], assetProviders: ["qoder"], tokenProviders: ["qoder"], errors: [] },
      usageSummary,
      usageActivity,
      assetInventories: [assetInventory],
      evidenceDeliveries: {
        items: [{
          organization: "acme-engineering",
          endpoint: "https://harness.example.test/evidence",
          acceptedAt: "2026-09-01T12:05:00.000Z",
          receiptState: "accepted",
          packetDigest: "a".repeat(64),
          packetBytes: 512,
          packet,
        }],
        total: 1,
        truncated: false,
      },
    });

    assert.deepEqual(model.overview, {
      analyzedSessions: 2,
      eligibleSessions: 2,
      selectionStrategy: "all-eligible",
      selectionNote: "all-eligible selection",
      activeMinutes: 2.5,
      modelResponses: 3,
      skillInvocations: 2,
    });
    assert.equal(model.assets.totals.skills, 1);
    assert.equal(model.assets.totals.mcps, 1);
    assert.equal(model.assets.totals.hooks, 1);
    assert.deepEqual(model.mcps, [{ name: "docs", total: 1, daily: [1, 0, 0] }]);
    assert.equal(model.assets.observed, true);
    assert.equal(model.evidenceDeliveries.items[0].acceptance.unobserved, 1);
    assert.equal(model.evidenceDeliveries.items[0].organization, "acme-engineering");
    assert.equal(model.evidence.accountingMode, "effort-proxy");
    assert.equal(model.modelCoverage.attributed, 3);
    assert.equal(model.modelCoverage.unattributed, 0);
    assert.deepEqual(model.tokenActivity?.totals, {
      inputTokens: 120,
      outputTokens: 30,
      cacheReadInputTokens: 10,
      cacheCreationInputTokens: 0,
    });
    assert.equal(Object.hasOwn(model.overview, "cost"), false);
    assert.equal(Object.hasOwn(model.overview, "autonomy"), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

function inventoryReport(provider, summary, assets) {
  return {
    kind: "agent-lint",
    profile: "agent-assets-review",
    assetInventory: { provider, summary, ...(assets ? { assets, assetsTruncated: false } : {}) },
    findings: [],
  };
}

function baseInput(assetInventories) {
  return {
    generatedAt: "2026-09-01T12:10:00.000Z",
    sources: {
      sessionProviders: ["qoder"],
      assetProviders: assetInventories.map((report) => report.assetInventory.provider),
      tokenProviders: ["qoder"],
      errors: [],
    },
    usageSummary: buildUsageSummary(usageResult()),
    usageActivity: buildDailyUsageActivity(
      [{ sessionId: "a", firstSeen: "2026-09-01T10:00:00.000Z" }],
      [{ id: "a", firstSeen: "2026-09-01T10:00:00.000Z", activeMs: 0 }],
      [],
      [],
    ),
    assetInventories,
  };
}

test("one project file discovered by several hosts counts once", () => {
  // Both hosts read the same two project files, so their summaries add to four
  // configured instances over two distinct assets.
  const shared = [
    { kind: "skill", id: ".agents/skills/review/SKILL.md", name: "review", scope: "project" },
    { kind: "rule", id: "AGENTS.md", name: "AGENTS.md", scope: "project" },
  ];
  const model = buildDashboardModel(baseInput([
    inventoryReport("qoder", { skills: 1, mcps: 0, hooks: 0, commands: 0, rules: 1, agents: 0, plugins: 0 }, shared),
    inventoryReport("codex", { skills: 1, mcps: 0, hooks: 0, commands: 0, rules: 1, agents: 0, plugins: 0 }, shared),
  ]));

  assert.deepEqual(
    { skills: model.assets.totals.skills, rules: model.assets.totals.rules },
    { skills: 1, rules: 1 },
  );
  assert.deepEqual(
    { skills: model.assets.configuredInstances.skills, rules: model.assets.configuredInstances.rules },
    { skills: 2, rules: 2 },
  );
  assert.equal(model.assets.distinctComplete, true);
  assert.equal(model.assets.hostMultiplier, 2);
  assert.equal(model.assets.inventoryReports, 2);
  assert.deepEqual(model.assets.providers, ["qoder", "codex"]);
});

test("distinct asset totals stay incomplete when a host reports no identities", () => {
  const model = buildDashboardModel(baseInput([
    inventoryReport("qoder", { skills: 2, mcps: 1, hooks: 3, commands: 0, rules: 0, agents: 0, plugins: 0 }),
    inventoryReport("codex", { skills: 4, mcps: 2, hooks: 1, commands: 0, rules: 0, agents: 0, plugins: 0 }),
  ]));

  assert.equal(model.assets.distinctComplete, false);
  assert.equal(model.assets.hostMultiplier, null);
  assert.deepEqual(
    {
      skills: model.assets.configuredInstances.skills,
      mcps: model.assets.configuredInstances.mcps,
      hooks: model.assets.configuredInstances.hooks,
    },
    { skills: 6, mcps: 3, hooks: 4 },
  );
});

test("token lanes report whether hosts share one cache relationship", () => {
  const mixed = usageResult();
  mixed.insights.keySignals.usageEfficiency.coverage.cacheAccountingModes = ["included-in-input", "separate-input-lane"];
  const model = buildDashboardModel({ ...baseInput([]), usageSummary: buildUsageSummary(mixed) });

  assert.deepEqual(model.tokenUsage.cacheAccountingModes, ["included-in-input", "separate-input-lane"]);
  assert.equal(model.tokenUsage.cacheLanesComparable, false);
  assert.equal(model.tokenUsage.cacheLanesOverlap, true);
});

test("the model chart keeps its unattributed remainder visible", () => {
  const partial = usageResult();
  partial.insights.keySignals.usageEfficiency.coverage.responseCount = 100;
  partial.insights.keySignals.usageEfficiency.coverage.modelAttributedResponseCount = 9;
  partial.insights.keySignals.usageEfficiency.coverage.unattributedResponseCount = 91;
  const model = buildDashboardModel({ ...baseInput([]), usageSummary: buildUsageSummary(partial) });

  assert.equal(model.modelCoverage.attributed, 9);
  assert.equal(model.modelCoverage.unattributed, 91);
  assert.equal(Number(model.modelCoverage.attributionRate.toFixed(2)), 0.09);
});

test("delivery, commit, and host rows project without evidence paths", () => {
  const model = buildDashboardModel({
    ...baseInput([]),
    providerBreakdown: [
      { provider: "codex", analyzedSessions: 3, eligibleSessions: 3, responseCount: 30, modelAttributedResponseCount: 0, activeMinutes: 12, accountingMode: "host-estimated", cacheAccountingModes: ["included-in-input"], tokenTotals: null, editCount: 4, episodeCount: 6 },
      { provider: "claude", analyzedSessions: 9, eligibleSessions: 9, responseCount: 10, modelAttributedResponseCount: 10, activeMinutes: 30, accountingMode: "host-estimated", cacheAccountingModes: ["separate-input-lane"], tokenTotals: null, editCount: 2, episodeCount: 3 },
    ],
    deliverySignals: {
      validationAfterEdit: { status: "edit-without-validation", editCount: 6, validationAfterEditCount: 0, relevantValidationCount: 0 },
      validationCommands: [{ name: "vitest", count: 5 }],
      episodes: { episodeCount: 9, eligibleEpisodeCount: 4, closedEpisodeCount: 1, unobservedClosureCount: 3 },
      friction: [{ name: "failed-event", count: 2 }],
      topTools: [{ name: "Bash", count: 40 }],
      observedHooks: [],
    },
    commitAttribution: {
      graceMinutes: 45,
      correlatedSessionCount: 12,
      commitCount: 20,
      attributedCommits: 5,
      linesAdded: 400,
      linesRemoved: 100,
      attributedLinesAdded: 100,
      attributedLinesRemoved: 20,
      byConfidence: { explicit: 0, high: 2, medium: 3, low: 0 },
      byPlatform: [{ platform: "codex", commitCount: 5 }],
    },
    topology: {
      target: "repo-root",
      memberCount: 2,
      members: [{ route: "packages/app", kind: "manifest" }],
      instructionScopes: { total: 3, effective: 2, candidate: 1 },
      trackedFiles: 120,
    },
  });

  // Hosts are ordered by analyzed sessions, not by the collection order.
  assert.deepEqual(model.providerBreakdown.map((row) => row.provider), ["claude", "codex"]);
  assert.equal(model.delivery.validationAfterEdit.status, "edit-without-validation");
  assert.equal(model.delivery.episodeClosureRate, 0.25);
  assert.equal(model.commitAttribution.attributionRate, 0.25);
  assert.equal(model.commitAttribution.lineAttributionRate, 0.25);
  assert.equal(model.topology.memberCount, 2);
  assert.equal(JSON.stringify(model.delivery).includes("evidenceRef"), false);
});

test("a bounded session selection stays visible in the Dashboard model", () => {
  const bounded = usageResult();
  bounded.selection = { strategy: "latest-n", eligibleCount: 20, analyzedCount: 5 };
  const model = buildDashboardModel({
    generatedAt: "2026-09-01T12:10:00.000Z",
    sources: { sessionProviders: ["qoder"], assetProviders: [], tokenProviders: [], errors: [] },
    usageSummary: buildUsageSummary(bounded),
    usageActivity: buildDailyUsageActivity(
      [{ sessionId: "bounded", firstSeen: "2026-09-01T10:00:00.000Z" }],
      [{ id: "bounded", firstSeen: "2026-09-01T10:00:00.000Z", activeMs: 0 }],
      [],
      [],
    ),
    assetInventories: [],
  });

  assert.equal(model.overview.selectionStrategy, "latest-n");
  assert.equal(model.overview.selectionNote, "latest-n bounded selection");
});

test("aggregated Other activity buckets stay after named assets", () => {
  const usageActivity = buildDailyUsageActivity(
    [{ sessionId: "a", firstSeen: "2026-09-01T10:00:00.000Z" }],
    [{ id: "a", firstSeen: "2026-09-01T10:00:00.000Z", activeMs: 0 }],
    [],
    [
      { timestamp: "2026-09-01T10:01:00.000Z", skillName: "named-skill" },
      { timestamp: "2026-09-01T10:02:00.000Z", skillName: "named-skill" },
      { timestamp: "2026-09-01T10:03:00.000Z", skillName: "tail-one" },
      { timestamp: "2026-09-01T10:04:00.000Z", skillName: "tail-two" },
      { timestamp: "2026-09-01T10:05:00.000Z", toolName: "mcp__docs__search", toolInvocationId: "mcp-a" },
      { timestamp: "2026-09-01T10:06:00.000Z", toolName: "mcp__docs__open", toolInvocationId: "mcp-b" },
      { timestamp: "2026-09-01T10:07:00.000Z", toolName: "mcp__browser__open", toolInvocationId: "mcp-c" },
      { timestamp: "2026-09-01T10:08:00.000Z", toolName: "mcp__codex_app__list_threads", toolInvocationId: "mcp-d" },
    ],
    { skillLimit: 1, mcpLimit: 1 },
  );
  const model = buildDashboardModel({
    generatedAt: "2026-09-01T12:10:00.000Z",
    sources: { sessionProviders: ["qoder"], assetProviders: [], tokenProviders: [], errors: [] },
    usageSummary: buildUsageSummary({}),
    usageActivity,
    assetInventories: [],
  });

  assert.deepEqual(model.skills.map((skill) => skill.name), ["named-skill", "Other"]);
  assert.deepEqual(model.mcps.map((mcp) => mcp.name), ["docs", "Other"]);
  assert.equal(model.assets.observed, false);
});
