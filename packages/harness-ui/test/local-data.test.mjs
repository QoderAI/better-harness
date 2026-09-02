import assert from "node:assert/strict";
import path from "node:path";
import { test } from "vitest";

import { buildUsageSummary } from "../../../scripts/session-analysis/usage-summary.mjs";
import { collectorArgs, createTimedCache, refreshMs } from "../lib/local-data.server.ts";
import { aggregateUsageActivity, aggregateUsageSummaries, normalizeSessionLimit } from "../scripts/collect-local-data.mjs";
import { resolveWorkspace } from "../scripts/workspace.mjs";

function sourceResult({ eligible, analyzed, inputTokens, model }) {
  return buildUsageSummary({
    selection: { strategy: "all-eligible", eligibleCount: eligible, analyzedCount: analyzed },
    warnings: [],
    insights: {
      keySignals: {
        usageEfficiency: {
          accountingMode: inputTokens === null ? "effort-proxy" : "host-estimated",
          coverage: {
            analyzedSessionCount: analyzed,
            responseCount: analyzed * 2,
            usageFieldObservedCount: analyzed,
            nonZeroUsageCount: inputTokens === null ? 0 : analyzed,
            modelAttributedResponseCount: analyzed * 2,
            unattributedResponseCount: 0,
            exactCreditsAvailable: false,
          },
          longSessions: { longActiveCount: 1, longWallCount: 1, wallOnlyCount: 0 },
          tokenTotals: inputTokens === null ? null : {
            inputTokens,
            outputTokens: 10,
            cacheReadInputTokens: 5,
            cacheCreationInputTokens: 0,
          },
          modelUsage: [{
            model,
            responseCount: analyzed * 2,
            usageFieldObservedCount: analyzed,
            nonZeroUsageCount: inputTokens === null ? 0 : analyzed,
            tokenTotals: inputTokens === null ? null : {
              inputTokens,
              outputTokens: 10,
              cacheReadInputTokens: 5,
              cacheCreationInputTokens: 0,
            },
          }],
          candidates: [],
          opportunities: [],
          outcomeReview: { status: "not-applicable" },
        },
      },
    },
  });
}

test("local source aggregation keeps observed-provider boundaries", () => {
  const rows = [
    { provider: "codex", summary: sourceResult({ eligible: 3, analyzed: 3, inputTokens: 100, model: "codex-model" }) },
    { provider: "qoder", summary: sourceResult({ eligible: 4, analyzed: 2, inputTokens: null, model: "qoder-model" }) },
  ];
  const summary = aggregateUsageSummaries(rows);

  assert.deepEqual(summary.selection, { strategy: "all-eligible", eligibleCount: 7, analyzedCount: 5, complete: false });
  assert.equal(summary.usageEfficiency.accountingMode, "mixed");
  assert.equal(summary.usageEfficiency.tokenTotals.inputTokens, 100);
  assert.deepEqual(summary.usageEfficiency.modelUsage.map((row) => row.model), ["codex-model", "qoder-model"]);
});

test("local activity aggregation aligns provider dates before summing", () => {
  const activity = aggregateUsageActivity([
    {
      schemaVersion: 3,
      dateBasis: "UTC",
      measurementBasis: "fixture",
      truncated: false,
      dates: ["2026-08-31", "2026-09-01"],
      sessions: { total: 2, starts: [1, 1], activeMinutes: [2, 3] },
      models: [],
      skills: [{ name: "review", total: 1, daily: [0, 1] }],
      mcps: [{ name: "docs", total: 1, daily: [0, 1] }],
      tokens: {
        observedResponseCount: 1,
        totals: { inputTokens: 20, outputTokens: 2, cacheReadInputTokens: 10, cacheCreationInputTokens: 0 },
        daily: {
          inputTokens: [0, 20], outputTokens: [0, 2], cacheReadInputTokens: [0, 10], cacheCreationInputTokens: [0, 0],
        },
      },
    },
    {
      schemaVersion: 3,
      dateBasis: "UTC",
      measurementBasis: "fixture",
      truncated: false,
      dates: ["2026-09-01"],
      sessions: { total: 1, starts: [1], activeMinutes: [4] },
      models: [],
      skills: [{ name: "review", total: 2, daily: [2] }],
      mcps: [{ name: "docs", total: 2, daily: [2] }],
      tokens: {
        observedResponseCount: 1,
        totals: { inputTokens: 30, outputTokens: 3, cacheReadInputTokens: 15, cacheCreationInputTokens: 1 },
        daily: {
          inputTokens: [30], outputTokens: [3], cacheReadInputTokens: [15], cacheCreationInputTokens: [1],
        },
      },
    },
  ]);

  assert.deepEqual(activity.dates, ["2026-08-31", "2026-09-01"]);
  assert.deepEqual(activity.sessions.starts, [1, 2]);
  assert.deepEqual(activity.sessions.activeMinutes, [2, 7]);
  assert.deepEqual(activity.skills[0], { name: "review", total: 3, daily: [0, 3] });
  assert.equal(activity.schemaVersion, 4);
  assert.deepEqual(activity.mcps[0], { name: "docs", total: 3, daily: [0, 3] });
  assert.deepEqual(activity.tokens.daily.inputTokens, [0, 50]);
  assert.deepEqual(activity.tokens.totals, {
    inputTokens: 50,
    outputTokens: 5,
    cacheReadInputTokens: 25,
    cacheCreationInputTokens: 1,
  });
});

test("collected data is reused inside the refresh window and recollected after it", async () => {
  let clock = 1_000;
  let calls = 0;
  const cache = createTimedCache({
    load: async () => {
      calls += 1;
      return { generatedAt: `run-${calls}` };
    },
    ttlMs: () => 30_000,
    now: () => clock,
  });

  assert.deepEqual(await cache.read(), { generatedAt: "run-1" });
  clock += 29_000;
  assert.deepEqual(await cache.read(), { generatedAt: "run-1" });
  assert.equal(calls, 1);

  // The window is measured from the end of a collection, not its start.
  clock += 31_000;
  assert.deepEqual(await cache.read(), { generatedAt: "run-2" });
  assert.equal(calls, 2);

  cache.clear();
  assert.deepEqual(await cache.read(), { generatedAt: "run-3" });
});

test("a failed collection is not cached so the next request retries", async () => {
  let calls = 0;
  const cache = createTimedCache({
    load: async () => {
      calls += 1;
      if (calls === 1) throw new Error("collector exited");
      return { generatedAt: "recovered" };
    },
    ttlMs: () => 30_000,
    now: () => 5_000,
  });

  await assert.rejects(cache.read(), /collector exited/u);
  assert.deepEqual(await cache.read(), { generatedAt: "recovered" });
  assert.equal(calls, 2);
});

test("collector arguments carry the configured providers and session limit", () => {
  const collector = path.join("scripts", "collect-local-data.mjs");
  const workspace = path.join(path.sep, "work", "repo");

  assert.deepEqual(
    collectorArgs(collector, { BETTER_HARNESS_WORKSPACE: workspace }),
    [collector, "--workspace", path.resolve(workspace)],
  );
  assert.deepEqual(
    collectorArgs(collector, {
      BETTER_HARNESS_WORKSPACE: workspace,
      BETTER_HARNESS_PROVIDERS: " claude,codex ",
      BETTER_HARNESS_SESSION_LIMIT: "25",
    }),
    [collector, "--workspace", path.resolve(workspace), "--providers", "claude,codex", "--limit", "25"],
  );
  assert.equal(normalizeSessionLimit("25"), 25);
  assert.throws(
    () => collectorArgs(collector, {
      BETTER_HARNESS_WORKSPACE: workspace,
      BETTER_HARNESS_SESSION_LIMIT: "0",
    }),
    /positive safe integer/u,
  );
  assert.throws(() => normalizeSessionLimit("later"), /positive safe integer/u);
});

test("the refresh window falls back to its default for an unusable value", () => {
  assert.equal(refreshMs({ BETTER_HARNESS_REFRESH_MS: "0" }), 0);
  assert.equal(refreshMs({ BETTER_HARNESS_REFRESH_MS: "1500" }), 1500);
  assert.equal(refreshMs({ BETTER_HARNESS_REFRESH_MS: "later" }), 30_000);
  assert.equal(refreshMs({}), 30_000);
});

test("the workspace is the repository that contains this package unless configured", () => {
  const repository = path.resolve(import.meta.dirname, "..", "..", "..");
  assert.equal(resolveWorkspace({}, repository), repository);
  assert.equal(resolveWorkspace({}, path.join(repository, "packages", "harness-ui")), repository);
  assert.equal(
    resolveWorkspace({ BETTER_HARNESS_WORKSPACE: path.join(path.sep, "elsewhere") }, repository),
    path.resolve(path.join(path.sep, "elsewhere")),
  );
});

test("a single bounded host reports its own selection strategy rather than a mix", () => {
  const bounded = sourceResult({ eligible: 135, analyzed: 5, inputTokens: 100, model: "codex-model" });
  bounded.selection.strategy = "latest-n";
  bounded.selection.complete = false;

  const summary = aggregateUsageSummaries([{ provider: "codex", summary: bounded }]);
  assert.equal(summary.selection.strategy, "latest-n");
  assert.equal(summary.selection.complete, false);

  const mixed = aggregateUsageSummaries([
    { provider: "codex", summary: bounded },
    { provider: "qoder", summary: sourceResult({ eligible: 2, analyzed: 2, inputTokens: null, model: "qoder-model" }) },
  ]);
  assert.equal(mixed.selection.strategy, "mixed");
  assert.equal(aggregateUsageSummaries([]).selection.strategy, "all-eligible");
});
