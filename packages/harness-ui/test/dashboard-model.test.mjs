import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { runAgentLint } from "../../../scripts/agent-lint/index.mjs";
import { buildUsageSummary } from "../../../scripts/session-analysis/usage-summary.mjs";
import { buildDailyUsageActivity } from "../../../scripts/session-analysis/daily-usage.mjs";
import { createTaskEvidencePacket } from "../../../scripts/task-evidence-upload/index.mjs";
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
      evidencePackets: [packet],
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
    assert.equal(model.assets.observed, true);
    assert.equal(model.evidencePackets[0].acceptance.unobserved, 1);
    assert.equal(model.evidence.accountingMode, "effort-proxy");
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

test("asset totals remain configured instances across inventory reports", () => {
  const input = {
    generatedAt: "2026-09-01T12:10:00.000Z",
    sources: { sessionProviders: ["qoder"], assetProviders: ["qoder", "codex"], tokenProviders: ["qoder"], errors: [] },
    usageSummary: buildUsageSummary(usageResult()),
    usageActivity: buildDailyUsageActivity(
      [{ sessionId: "a", firstSeen: "2026-09-01T10:00:00.000Z" }],
      [{ id: "a", firstSeen: "2026-09-01T10:00:00.000Z", activeMs: 0 }],
      [],
      [],
    ),
    assetInventories: [
      { kind: "agent-lint", profile: "agent-assets-review", assetInventory: { provider: "qoder", summary: { skills: 2, mcps: 1, hooks: 3, commands: 0, rules: 0, agents: 0, plugins: 0 } }, findings: [] },
      { kind: "agent-lint", profile: "agent-assets-review", assetInventory: { provider: "codex", summary: { skills: 4, mcps: 2, hooks: 1, commands: 0, rules: 0, agents: 0, plugins: 0 } }, findings: [] },
    ],
    evidencePackets: [],
  };
  const model = buildDashboardModel(input);

  assert.deepEqual(
    { skills: model.assets.totals.skills, mcps: model.assets.totals.mcps, hooks: model.assets.totals.hooks },
    { skills: 6, mcps: 3, hooks: 4 },
  );
  assert.equal(model.assets.inventoryReports, 2);
  assert.deepEqual(model.assets.providers, ["qoder", "codex"]);
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
    evidencePackets: [],
  });

  assert.equal(model.overview.selectionStrategy, "latest-n");
  assert.equal(model.overview.selectionNote, "latest-n bounded selection");
});

test("the aggregated Other Skill bucket stays after named Skills", () => {
  const usageActivity = buildDailyUsageActivity(
    [{ sessionId: "a", firstSeen: "2026-09-01T10:00:00.000Z" }],
    [{ id: "a", firstSeen: "2026-09-01T10:00:00.000Z", activeMs: 0 }],
    [],
    [
      { timestamp: "2026-09-01T10:01:00.000Z", skillName: "named-skill" },
      { timestamp: "2026-09-01T10:02:00.000Z", skillName: "named-skill" },
      { timestamp: "2026-09-01T10:03:00.000Z", skillName: "tail-one" },
      { timestamp: "2026-09-01T10:04:00.000Z", skillName: "tail-two" },
    ],
    { skillLimit: 1 },
  );
  const model = buildDashboardModel({
    generatedAt: "2026-09-01T12:10:00.000Z",
    sources: { sessionProviders: ["qoder"], assetProviders: [], tokenProviders: [], errors: [] },
    usageSummary: buildUsageSummary({}),
    usageActivity,
    assetInventories: [],
    evidencePackets: [],
  });

  assert.deepEqual(model.skills.map((skill) => skill.name), ["named-skill", "Other"]);
  assert.equal(model.assets.observed, false);
});
