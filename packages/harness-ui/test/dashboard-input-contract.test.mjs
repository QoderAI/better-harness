import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  DASHBOARD_INPUT_KIND,
  DASHBOARD_INPUT_SCHEMA_VERSION,
  parseDashboardInputV1,
  validateDashboardInputV1,
} from "../scripts/dashboard-input-contract.mjs";
import {
  aggregateUsageActivity,
  aggregateUsageSummaries,
  collectLocalDashboardData,
} from "../scripts/collect-local-data.mjs";

function dashboardInputFixture() {
  return {
    kind: DASHBOARD_INPUT_KIND,
    schemaVersion: DASHBOARD_INPUT_SCHEMA_VERSION,
    generatedAt: "2026-09-02T09:00:00.000Z",
    workspace: { id: "local-workspace:fixture", label: "fixture" },
    window: { firstDate: null, lastDate: null, dayCount: 0, truncated: false },
    sources: {
      sessionProviders: [],
      assetProviders: [],
      tokenProviders: [],
      errors: [],
    },
    usageSummary: aggregateUsageSummaries([]),
    usageActivity: aggregateUsageActivity([]),
    providerBreakdown: [],
    deliverySignals: null,
    assetInventories: [],
    evidenceDeliveries: { items: [], total: 0, truncated: false },
  };
}

test("Dashboard input V1 accepts the script-shaped collector envelope", () => {
  const input = dashboardInputFixture();
  assert.equal(validateDashboardInputV1(input), input);
  assert.deepEqual(parseDashboardInputV1(JSON.stringify(input)), input);
});

test("the local collector emits a Dashboard input V1 document", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "harness-ui-contract-"));
  try {
    const input = await collectLocalDashboardData({
      workspace,
      providers: [],
      uploadsDirectory: path.join(workspace, "uploads"),
    });
    assert.equal(input.kind, DASHBOARD_INPUT_KIND);
    assert.equal(input.schemaVersion, DASHBOARD_INPUT_SCHEMA_VERSION);
    assert.equal(validateDashboardInputV1(input), input);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("Dashboard input V1 rejects collector stdout that is not one JSON document", () => {
  assert.throws(() => parseDashboardInputV1("progress\n{}"), /one valid JSON document/u);
});

test("Dashboard input V1 rejects top-level kind, version, and field drift", () => {
  const wrongVersion = dashboardInputFixture();
  wrongVersion.schemaVersion = 2;
  assert.throws(() => validateDashboardInputV1(wrongVersion), /unsupported kind or schema version/u);

  const missingKind = dashboardInputFixture();
  delete missingKind.kind;
  assert.throws(() => validateDashboardInputV1(missingKind), /dashboardInput\.kind is required/u);

  const unknownField = { ...dashboardInputFixture(), preview: true };
  assert.throws(() => validateDashboardInputV1(unknownField), /dashboardInput\.preview is not supported/u);
});

test("Dashboard input V1 rejects incompatible nested source versions", () => {
  const wrongSummary = dashboardInputFixture();
  wrongSummary.usageSummary = { ...wrongSummary.usageSummary, schemaVersion: 2 };
  assert.throws(() => validateDashboardInputV1(wrongSummary), /usageSummary uses an unsupported/u);

  const wrongActivity = dashboardInputFixture();
  wrongActivity.usageActivity = { ...wrongActivity.usageActivity, schemaVersion: 5 };
  assert.throws(() => validateDashboardInputV1(wrongActivity), /usageActivity uses an unsupported/u);
});

function commitAttributionFixture() {
  return {
    graceMinutes: 45,
    correlatedSessionCount: 2,
    commitCount: 3,
    attributedCommits: 1,
    linesAdded: 10,
    linesRemoved: 2,
    attributedLinesAdded: 6,
    attributedLinesRemoved: 1,
    byConfidence: { explicit: 0, high: 1, medium: 0, low: 0 },
    byPlatform: [{ platform: "codex", commitCount: 1 }],
    attributedCommitRefs: [
      { commit: "abc123", sessionId: "s-1", platform: "codex", confidence: "high" },
    ],
  };
}

test("Dashboard input V1 accepts commit references and versioned assets", () => {
  const input = dashboardInputFixture();
  input.commitAttribution = commitAttributionFixture();
  input.assetInventories = [{
    kind: "agent-lint",
    profile: "agent-assets-review",
    assetInventory: {
      provider: "claude",
      summary: { skills: 0, mcps: 0, commands: 0, hooks: 0, rules: 0, agents: 0, plugins: 1 },
      assets: [{
        kind: "plugin",
        id: "plugin:plugin:better-harness",
        name: "better-harness",
        scope: "plugin",
        revision: "0.6.6",
        publisher: "Qoder",
      }],
      assetsTruncated: false,
    },
    findings: [],
  }];
  assert.equal(validateDashboardInputV1(input), input);
});

test("Dashboard input V1 rejects commit references that outrun their own attribution", () => {
  const input = dashboardInputFixture();
  input.commitAttribution = commitAttributionFixture();
  input.commitAttribution.attributedCommits = 0;
  assert.throws(() => validateDashboardInputV1(input), /cannot exceed attributedCommits/u);

  const lowConfidence = dashboardInputFixture();
  lowConfidence.commitAttribution = commitAttributionFixture();
  lowConfidence.commitAttribution.attributedCommitRefs[0].confidence = "low";
  assert.throws(() => validateDashboardInputV1(lowConfidence), /must be an attributing confidence/u);
});

test("Dashboard input V1 rejects an asset revision the host never declared", () => {
  const input = dashboardInputFixture();
  input.assetInventories = [{
    kind: "agent-lint",
    profile: "agent-assets-review",
    assetInventory: {
      provider: "claude",
      summary: { skills: 1, mcps: 0, commands: 0, hooks: 0, rules: 0, agents: 0, plugins: 0 },
      assets: [{ kind: "skill", id: "skills/a/SKILL.md", name: "a", scope: "project", revision: "  " }],
      assetsTruncated: false,
    },
    findings: [],
  }];
  assert.throws(() => validateDashboardInputV1(input), /must be omitted when the host declared none/u);
});

test("Dashboard input V1 rejects dated series that do not align with the shared window", () => {
  const input = dashboardInputFixture();
  input.usageActivity = {
    ...input.usageActivity,
    dates: ["2026-09-02"],
    sessions: { total: 1, starts: [], activeMinutes: [2] },
  };
  input.window = {
    firstDate: "2026-09-02",
    lastDate: "2026-09-02",
    dayCount: 1,
    truncated: false,
  };
  assert.throws(() => validateDashboardInputV1(input), /sessions\.starts must contain 1 entries/u);
});
