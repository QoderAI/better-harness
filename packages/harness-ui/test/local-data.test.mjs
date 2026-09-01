import assert from "node:assert/strict";
import { test } from "vitest";

import { buildUsageSummary } from "../../../scripts/session-analysis/usage-summary.mjs";
import { aggregateUsageActivity, aggregateUsageSummaries } from "../scripts/collect-local-data.mjs";

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
  assert.deepEqual(activity.tokens.daily.inputTokens, [0, 50]);
  assert.deepEqual(activity.tokens.totals, {
    inputTokens: 50,
    outputTokens: 5,
    cacheReadInputTokens: 25,
    cacheCreationInputTokens: 1,
  });
});
