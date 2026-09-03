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
  wrongActivity.usageActivity = { ...wrongActivity.usageActivity, schemaVersion: 6 };
  assert.throws(() => validateDashboardInputV1(wrongActivity), /usageActivity uses an unsupported/u);
});

test("Dashboard input V1 accepts schema version 5 data with totalFailed and dailyFailed fields", () => {
  const input = dashboardInputFixture();
  input.usageActivity = {
    ...input.usageActivity,
    schemaVersion: 5,
    dates: ["2026-09-02"],
    sessions: { total: 1, starts: [1], activeMinutes: [2] },
    skills: [{ name: "harness", total: 3, daily: [3], totalFailed: 1, dailyFailed: [1] }],
    mcps: [{ name: "docs", total: 2, daily: [2], totalFailed: 0, dailyFailed: [0] }],
  };
  input.window = { firstDate: "2026-09-02", lastDate: "2026-09-02", dayCount: 1, truncated: false };
  assert.equal(validateDashboardInputV1(input), input);
});

test("Dashboard input V1 still accepts schema version 4 data without totalFailed fields", () => {
  const input = dashboardInputFixture();
  input.usageActivity = {
    ...input.usageActivity,
    schemaVersion: 4,
    dates: ["2026-09-02"],
    sessions: { total: 1, starts: [1], activeMinutes: [2] },
    skills: [{ name: "harness", total: 3, daily: [3] }],
    mcps: [{ name: "docs", total: 2, daily: [2] }],
  };
  input.window = { firstDate: "2026-09-02", lastDate: "2026-09-02", dayCount: 1, truncated: false };
  assert.equal(validateDashboardInputV1(input), input);
});

test("Dashboard input V1 rejects dailyFailed with wrong length", () => {
  const input = dashboardInputFixture();
  input.usageActivity = {
    ...input.usageActivity,
    schemaVersion: 5,
    dates: ["2026-09-02"],
    sessions: { total: 1, starts: [1], activeMinutes: [2] },
    skills: [{ name: "harness", total: 3, daily: [3], totalFailed: 1, dailyFailed: [1, 0] }],
  };
  input.window = { firstDate: "2026-09-02", lastDate: "2026-09-02", dayCount: 1, truncated: false };
  assert.throws(() => validateDashboardInputV1(input), /dailyFailed must contain 1 entries/u);
});

test("Dashboard input V1 rejects negative totalFailed", () => {
  const input = dashboardInputFixture();
  input.usageActivity = {
    ...input.usageActivity,
    schemaVersion: 5,
    dates: ["2026-09-02"],
    sessions: { total: 1, starts: [1], activeMinutes: [2] },
    skills: [{ name: "harness", total: 3, daily: [3], totalFailed: -1, dailyFailed: [0] }],
  };
  input.window = { firstDate: "2026-09-02", lastDate: "2026-09-02", dayCount: 1, truncated: false };
  assert.throws(() => validateDashboardInputV1(input), /totalFailed must be a finite non-negative number/u);
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

test("aggregateUsageActivity sums dailyFailed from two v5 activities", () => {
  const a = {
    schemaVersion: 5,
    dateBasis: "UTC",
    measurementBasis: "session-starts-active-estimate-model-active-session-days-skill-invocations-loads-mcp-tool-calls-and-observed-token-usage",
    truncated: false,
    dates: ["2026-09-01", "2026-09-02"],
    sessions: { total: 1, starts: [1, 0], activeMinutes: [1, 0] },
    models: [],
    skills: [{ name: "harness", total: 3, daily: [2, 1], totalFailed: 1, dailyFailed: [1, 0] }],
    mcps: [],
  };
  const b = {
    schemaVersion: 5,
    dateBasis: "UTC",
    measurementBasis: "session-starts-active-estimate-model-active-session-days-skill-invocations-loads-mcp-tool-calls-and-observed-token-usage",
    truncated: false,
    dates: ["2026-09-01", "2026-09-02"],
    sessions: { total: 1, starts: [0, 1], activeMinutes: [0, 2] },
    models: [],
    skills: [{ name: "harness", total: 2, daily: [0, 2], totalFailed: 2, dailyFailed: [0, 2] }],
    mcps: [],
  };
  const result = aggregateUsageActivity([a, b]);
  const skill = result.skills.find((row) => row.name === "harness");
  assert.equal(skill.total, 5);
  assert.equal(skill.totalFailed, 3);
  assert.deepEqual(skill.dailyFailed, [1, 2]);
});

test("aggregateUsageActivity mixes v4 activity without dailyFailed and v5 activity", () => {
  const v4 = {
    schemaVersion: 4,
    dateBasis: "UTC",
    measurementBasis: "session-starts-active-estimate-model-active-session-days-skill-invocations-loads-mcp-tool-calls-and-observed-token-usage",
    truncated: false,
    dates: ["2026-09-01"],
    sessions: { total: 1, starts: [1], activeMinutes: [1] },
    models: [],
    skills: [{ name: "harness", total: 2, daily: [2] }],
    mcps: [],
  };
  const v5 = {
    schemaVersion: 5,
    dateBasis: "UTC",
    measurementBasis: "session-starts-active-estimate-model-active-session-days-skill-invocations-loads-mcp-tool-calls-and-observed-token-usage",
    truncated: false,
    dates: ["2026-09-01"],
    sessions: { total: 1, starts: [1], activeMinutes: [2] },
    models: [],
    skills: [{ name: "harness", total: 1, daily: [1], totalFailed: 1, dailyFailed: [1] }],
    mcps: [],
  };
  const result = aggregateUsageActivity([v4, v5]);
  const skill = result.skills.find((row) => row.name === "harness");
  assert.equal(skill.total, 3);
  assert.equal(skill.totalFailed, 1);
  assert.deepEqual(skill.dailyFailed, [1]);
});
