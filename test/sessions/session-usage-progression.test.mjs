import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildUsageReport,
  EMPTY_USAGE_REPORT,
  projectUsageReport,
  usageObservationFromEvent,
} from "../../scripts/session-analysis/usage-progression.mjs";
import {
  additiveUsageAccounting,
  CACHE_ACCOUNTING_MODE,
  collapseDuplicateResponseRecords,
  deriveCacheReuse,
  usageDeduplicationDiagnostics,
} from "../../scripts/session-analysis/usage-records.mjs";

function observation(model, contextTokens, processedTokens, outputTokens) {
  return {
    model,
    contextTokens,
    processedTokens,
    processedTokensBasis: "derived-accounted-usage",
    outputTokens,
  };
}

function responseRecord(responseId, usage, overrides = {}) {
  return {
    type: "model.response.completed",
    sessionId: "session-1",
    responseId,
    model: "model-a",
    modelInvocationUsage: usage,
    modelUsage: usage,
    timestamp: "2026-08-28T01:00:00.000Z",
    ...overrides,
  };
}

test("buildUsageReport labels every context boundary from one derivation", () => {
  const report = buildUsageReport([
    observation("model-a", 100, 112, 12),
    observation("model-a", 125, 132, 7),
    observation("model-a", 120, 126, 6),
    observation("model-b", 80, 90, 10),
    observation("model-b", 80, 85, 5),
  ]);

  assert.deepEqual(report.progression.map((point) => point.boundary), [
    "baseline",
    "growth",
    "shrink",
    "model-change",
    "steady",
  ]);
  assert.equal(report.actualModelCalls, 5);
  assert.equal(report.contextResetCount, 1);
  assert.equal(report.modelBoundaryCount, 1);
  assert.equal(report.baselineContextTokens, 100);
  assert.equal(report.currentContextTokens, 80);
  assert.equal(report.processedTokens, 545);
  assert.equal(report.processedCoverage, "observed");
  // A model change moves the prompt to another accounting basis, so the
  // endpoints are not comparable and no net growth is claimed.
  assert.equal(Object.hasOwn(report, "netContextDeltaTokens"), false);
  assert.equal(report.progression[3].contextDeltaTokens, undefined);
});

test("buildUsageReport quotes net growth only while one model spans the Session", () => {
  const report = buildUsageReport([
    observation("model-a", 100, 110, 10),
    observation("model-a", 180, 190, 10),
  ]);

  assert.equal(report.netContextDeltaTokens, 80);
  assert.equal(report.modelBoundaryCount, 0);
});

test("buildUsageReport marks partial processing coverage instead of assuming zero", () => {
  const report = buildUsageReport([
    observation("model-a", 100, 110, 10),
    { model: "model-a", contextTokens: 140, outputTokens: 4 },
  ]);

  assert.equal(report.processedTokens, 110);
  assert.equal(report.processedCoverage, "partial");
});

test("buildUsageReport keeps Session totals complete while bounding the retained progression", () => {
  const observations = Array.from({ length: 1_100 }, (_unused, index) => (
    observation("model-a", 1_000 + index, 1_001 + index, 1)
  ));
  const report = buildUsageReport(observations);

  assert.equal(report.actualModelCalls, 1_100);
  assert.equal(report.progressionTotalCount, 1_100);
  assert.equal(report.progression.length, 1_000);
  assert.equal(report.progressionTruncated, true);
  assert.equal(report.progression[0].index, 1);
  assert.equal(report.progression.at(-1).index, 1_100);
  assert.equal(report.netContextDeltaTokens, 1_099);
});

test("buildUsageReport reports nothing observed as null rather than a zeroed Session", () => {
  assert.equal(buildUsageReport([]), null);
});

test("projectUsageReport bounds a report without recounting it", () => {
  const report = projectUsageReport({
    actualModelCalls: 3,
    currentContextTokens: 900.4,
    netContextDeltaTokens: -12.2,
    processedTokens: 40,
    processedTokensBasis: "a".repeat(80),
    processedCoverage: "nonsense",
    progressionTotalCount: 3,
    progression: [
      { index: 1, model: "b".repeat(200), contextTokens: 400, boundary: "baseline" },
      { index: 2, contextTokens: 900, contextDeltaTokens: 500, boundary: "not-a-boundary" },
    ],
  }, { providerTotalTokens: 4_096 });

  assert.equal(report.actualModelCalls, 3);
  assert.equal(report.currentContextTokens, 900);
  assert.equal(report.netContextDeltaTokens, -12);
  assert.equal(report.processedTokensBasis.length, 40);
  assert.equal(report.processedCoverage, "observed");
  assert.equal(report.providerTotalTokens, 4_096);
  assert.equal(report.progression[0].model.length, 80);
  assert.equal(report.progression[1].boundary, "unobserved");
  assert.deepEqual(report.progression.map((point) => point.id), ["R1", "R2"]);
});

test("projectUsageReport answers a missing report with the shared empty shape", () => {
  assert.deepEqual(projectUsageReport(null), EMPTY_USAGE_REPORT);
  assert.deepEqual(projectUsageReport(undefined), EMPTY_USAGE_REPORT);
});

test("usageObservationFromEvent ignores an event with no usage evidence", () => {
  assert.equal(usageObservationFromEvent({ type: "model.response.completed", model: "model-a" }), null);
  assert.deepEqual(
    usageObservationFromEvent({
      type: "token_count",
      timestamp: "2026-08-28T01:02:03.000Z",
      model: "model-a",
      modelInvocationUsage: { inputTokens: 4, outputTokens: 6 },
      currentContextUsage: { usedTokens: 40, windowTokens: 100 },
      processedTokens: 10,
      processedTokensBasis: "derived-accounted-usage",
    }),
    {
      timestamp: "2026-08-28T01:02:03.000Z",
      model: "model-a",
      contextTokens: 40,
      windowTokens: 100,
      percentFull: 40,
      processedTokens: 10,
      processedTokensBasis: "derived-accounted-usage",
      outputTokens: 6,
    },
  );
  assert.equal(usageObservationFromEvent({
    type: "turn.finished",
    usageProgressionExcluded: true,
    modelInvocationUsage: { inputTokens: 4, outputTokens: 6 },
    currentContextUsage: { usedTokens: 40, windowTokens: 100 },
  }), null);
});

test("Usage progression preserves observed response time through derivation and projection (AC-30)", () => {
  const report = buildUsageReport([
    { ...observation("model-a", 100, 110, 10), timestamp: "2026-08-28T01:02:03.456Z" },
    { ...observation("model-a", 120, 130, 10), timestamp: "not-a-time" },
  ]);
  const projected = projectUsageReport(report);

  assert.equal(report.progression[0].timestamp, "2026-08-28T01:02:03.456Z");
  assert.equal(projected.progression[0].timestamp, "2026-08-28T01:02:03.456Z");
  assert.equal(Object.hasOwn(report.progression[1], "timestamp"), false);
  assert.equal(Object.hasOwn(projected.progression[1], "timestamp"), false);
});

test("usageObservationFromEvent never reads a cumulative Session total as one invocation", () => {
  assert.equal(usageObservationFromEvent({
    modelUsage: { inputTokens: 900, outputTokens: 40 },
    usageCumulative: true,
  }), null);
});

test("additiveUsageAccounting stays opt-in for hosts whose counters do not overlap", () => {
  assert.deepEqual(
    additiveUsageAccounting({ inputTokens: 10, cacheReadInputTokens: 5, cacheCreationInputTokens: 3, outputTokens: 4 }),
    { processedTokens: 22, processedTokensBasis: "derived-accounted-usage" },
  );
  assert.deepEqual(additiveUsageAccounting(null), {});
  assert.deepEqual(additiveUsageAccounting({ totalTokens: 40 }), {});
});

test("deriveCacheReuse respects included and separate provider input relationships", () => {
  assert.deepEqual(
    deriveCacheReuse(
      { inputTokens: 800, cacheReadInputTokens: 600 },
      CACHE_ACCOUNTING_MODE.INCLUDED_IN_INPUT,
    ),
    {
      status: "observed",
      accountingMode: "included-in-input",
      cacheReadTokens: 600,
      promptInputTokens: 800,
      uncachedInputTokens: 200,
      reusePercent: 75,
    },
  );
  assert.deepEqual(
    deriveCacheReuse(
      { inputTokens: 200, cacheReadInputTokens: 600, cacheCreationInputTokens: 50 },
      CACHE_ACCOUNTING_MODE.SEPARATE_INPUT_LANE,
    ),
    {
      status: "observed",
      accountingMode: "separate-input-lane",
      cacheReadTokens: 600,
      cacheCreationTokens: 50,
      promptInputTokens: 850,
      uncachedInputTokens: 250,
      reusePercent: 70.6,
    },
  );
});

test("deriveCacheReuse keeps absolute evidence when a trustworthy rate is unavailable", () => {
  assert.deepEqual(deriveCacheReuse({ inputTokens: 100, cacheReadInputTokens: 40 }), {
    status: "partial",
    accountingMode: "relationship-unknown",
    cacheReadTokens: 40,
  });
  assert.deepEqual(
    deriveCacheReuse(
      { inputTokens: 100, cacheReadInputTokens: 140 },
      CACHE_ACCOUNTING_MODE.INCLUDED_IN_INPUT,
    ),
    {
      status: "inconsistent",
      accountingMode: "included-in-input",
      cacheReadTokens: 140,
    },
  );
  assert.equal(deriveCacheReuse({ inputTokens: 100 }), null);
  assert.equal(deriveCacheReuse({ inputTokens: 100, cacheReadInputTokens: 0 }, CACHE_ACCOUNTING_MODE.INCLUDED_IN_INPUT).reusePercent, 0);
});

test("usage progression carries per-response cache reuse through the bounded report", () => {
  const observation = usageObservationFromEvent(responseRecord("cached", {
    inputTokens: 100,
    outputTokens: 5,
    cacheReadInputTokens: 80,
  }, { cacheAccountingMode: CACHE_ACCOUNTING_MODE.INCLUDED_IN_INPUT }));
  const report = projectUsageReport(buildUsageReport([observation]));

  assert.deepEqual(report.progression[0].cacheReuse, {
    status: "observed",
    accountingMode: "included-in-input",
    cacheReadTokens: 80,
    promptInputTokens: 100,
    uncachedInputTokens: 20,
    reusePercent: 80,
  });
});

test("collapseDuplicateResponseRecords keeps the latest payload and the first chronology", () => {
  const collapsed = collapseDuplicateResponseRecords([
    responseRecord("r1", { inputTokens: 10, outputTokens: 2 }, { timestamp: "2026-08-28T01:00:01.000Z", evidenceRef: { line: 1 } }),
    responseRecord("r1", { inputTokens: 10, outputTokens: 2 }, { timestamp: "2026-08-28T01:00:02.000Z", evidenceRef: { line: 2 } }),
    responseRecord("r1", { inputTokens: 10, outputTokens: 4 }, { timestamp: "2026-08-28T01:00:03.000Z", evidenceRef: { line: 3 } }),
    responseRecord("<synthetic>", { inputTokens: 1, outputTokens: 1 }),
    responseRecord("r-zero", { inputTokens: 0, outputTokens: 0 }),
    responseRecord("r2", { inputTokens: 1, outputTokens: 2 }),
  ], { canonical: "latest", dropSyntheticRecords: true, countDiagnostics: true });

  assert.deepEqual(collapsed.map((event) => event.responseId), ["r1", "r2"]);
  assert.equal(collapsed[0].modelUsage.outputTokens, 4);
  assert.equal(collapsed[0].timestamp, "2026-08-28T01:00:01.000Z");
  assert.deepEqual(collapsed[0].evidenceRef, { line: 1 });
  assert.deepEqual(usageDeduplicationDiagnostics(collapsed), {
    duplicateRecordsCollapsed: 2,
    conflictingDuplicateRecords: 1,
  });
});

test("collapseDuplicateResponseRecords keeps the first observation for repeat-snapshot hosts", () => {
  const collapsed = collapseDuplicateResponseRecords([
    responseRecord("r1", { inputTokens: 10, outputTokens: 2 }, { evidenceRef: { line: 1 } }),
    responseRecord("r1", { inputTokens: 10, outputTokens: 2 }, { evidenceRef: { line: 2 } }),
    { type: "tool.call", sessionId: "session-1", toolName: "Read" },
    responseRecord(null, { inputTokens: 3, outputTokens: 1 }),
  ]);

  assert.equal(collapsed.length, 3);
  assert.deepEqual(collapsed[0].evidenceRef, { line: 1 });
  assert.equal(collapsed[0].usageDeduplication, undefined);
  assert.equal(usageDeduplicationDiagnostics(collapsed), null);
});
