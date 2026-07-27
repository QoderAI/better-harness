import { measureLongSessionRows } from "./long-sessions.mjs";
import { calculateExactModelCost } from "./model-pricing.mjs";
import { buildDailyUsageActivity } from "./daily-usage.mjs";
import { privacySafeUserInputSummary } from "./privacy-safe-text.mjs";
import { sessionAnalysisRef } from "./session-ref.mjs";

export const SESSION_EFFICIENCY_SCHEMA_VERSION = 1;

const TOKEN_FIELDS = Object.freeze([
  "inputTokens",
  "outputTokens",
  "cacheReadInputTokens",
  "cacheCreationInputTokens",
]);
const DEFAULT_CANDIDATE_LIMIT = 12;
const RESPONSE_FALLBACK_WINDOW_MS = 250;

export function buildSessionEfficiencySignal(sessions = [], events = [], options = {}) {
  const { thresholds, rows: durationRows } = measureLongSessionRows(sessions, events, options);
  const eventsBySession = groupBy(events, (event) => event.sessionId);
  const responses = deduplicateModelRequests(events.filter(isModelRequestEvent));
  const responsesBySession = groupBy(responses, (event) => event.sessionId);
  const rows = durationRows.map((duration) => buildSessionRow(
    duration,
    sessions.find((session) => session.sessionId === duration.id),
    eventsBySession.get(duration.id) ?? [],
    responsesBySession.get(duration.id) ?? [],
    thresholds,
    options.pricingTable,
    options,
  ));
  const exactCost = calculateExactModelCost(responses, options.pricingTable);
  const coverage = buildCoverage(rows, responses, exactCost);
  const longActiveRows = rows.filter((row) => row.longActive);
  const longWallRows = rows.filter((row) => row.longWall);
  const longActiveIds = new Set(longActiveRows.map((row) => row.id));
  const candidates = selectCandidates(rows, Number(options.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT));

  return {
    schemaVersion: SESSION_EFFICIENCY_SCHEMA_VERSION,
    accountingMode: coverage.accountingMode,
    thresholds,
    coverage,
    longSessions: {
      longActiveCount: longActiveRows.length,
      longWallCount: longWallRows.length,
      wallOnlyCount: longWallRows.filter((row) => !longActiveIds.has(row.id)).length,
      longEitherCount: new Set([...longActiveRows, ...longWallRows].map((row) => row.id)).size,
      activeRatio: rows.length > 0 ? Number((longActiveRows.length / rows.length).toFixed(4)) : 0,
    },
    tokenTotals: tokenTotalsOrNull(responses),
    actualCost: exactCost.available ? exactCost : null,
    modelUsage: aggregateModels(responses),
    activity: buildDailyUsageActivity(sessions, durationRows, responses, events, options.activity),
    candidates,
    outcomeReview: {
      status: candidates.length > 0 ? "required" : "not-applicable",
      reviewedCandidateCount: 0,
      reviewedActiveLongCount: 0,
      reviewedSessionRefs: [],
      reviewedActiveLongSessionRefs: [],
      comparableModelOutcomeEvidence: false,
      reason: "semantic-outcome-review-not-run",
    },
    opportunities: buildOpportunities({ coverage, longActiveRows, longWallRows, candidates }),
  };
}

function buildSessionRow(duration, session, events, responses, thresholds, pricingTable, options) {
  const role = sessionRole(duration.id, events);
  const nonZeroUsageCount = responses.filter(hasNonZeroUsage).length;
  const usageFieldObservedCount = responses.filter((event) => event.usageFieldsObserved === true).length;
  const exactCost = calculateExactModelCost(responses, pricingTable);
  return {
    id: duration.id,
    sessionRef: sessionAnalysisRef({
      sessionId: duration.id,
      platform: options.platform,
      workspace: options.workspace,
    }),
    label: duration.label,
    role: role.name,
    roleConfidence: role.confidence,
    firstSeen: duration.firstSeen,
    lastSeen: duration.lastSeen,
    wallMs: duration.wallMs,
    activeMs: duration.activeMs,
    maxIdleGapMs: duration.maxIdleGapMs,
    resumeCount: duration.idleGapCount,
    userPromptCount: duration.userPromptCount,
    userInputSummary: duration.activeMs >= thresholds.activeMs
      ? privacySafeUserInputSummary(events)
      : null,
    toolCallCount: duration.toolCallCount,
    failureCount: events.filter(isFailure).length,
    responseCount: responses.length,
    usageFieldObservedCount,
    nonZeroUsageCount,
    usageStatus: usageStatus(responses, usageFieldObservedCount, nonZeroUsageCount),
    tokenTotals: tokenTotalsOrNull(responses),
    actualCost: exactCost.available ? exactCost : null,
    modelUsage: aggregateModels(responses),
    longActive: duration.activeMs >= thresholds.activeMs,
    longWall: duration.wallMs >= thresholds.wallMs,
    outcomeStatus: "needs-semantic-review",
    evidenceRefs: boundedEvidenceRefs([
      ...(duration.evidenceRefs ?? []),
      ...responses.map((event) => event.evidenceRef).filter(Boolean),
    ]),
    sourceKinds: Array.isArray(session?.sourceKinds) ? [...session.sourceKinds] : [],
  };
}

function buildCoverage(rows, responses, exactCost) {
  const usageFieldObservedCount = responses.filter((event) => event.usageFieldsObserved === true).length;
  const nonZeroUsageCount = responses.filter(hasNonZeroUsage).length;
  const modelAttributedResponseCount = responses.filter((event) => event.model).length;
  const unattributedResponseCount = responses.length - modelAttributedResponseCount;
  const childAgentCandidateCount = rows.filter((row) => row.role === "child-agent-candidate").length;
  const userThreadCandidateCount = rows.filter((row) => row.role === "user-thread-candidate").length;
  const accountingMode = exactCost.available ? "exact" : nonZeroUsageCount > 0 ? "host-estimated" : "effort-proxy";
  return {
    analyzedSessionCount: rows.length,
    userThreadCandidateCount,
    childAgentCandidateCount,
    responseCount: responses.length,
    usageFieldObservedCount,
    nonZeroUsageCount,
    modelAttributedResponseCount,
    unattributedResponseCount,
    usageCoverageRate: ratio(usageFieldObservedCount, responses.length),
    nonZeroUsageCoverageRate: ratio(nonZeroUsageCount, responses.length),
    accountingMode,
    exactCreditsAvailable: exactCost.available,
    pricingVersion: exactCost.available ? exactCost.pricingVersion : null,
    pricingStatus: exactCost.available ? "available" : exactCost.reason,
  };
}

function buildOpportunities({ coverage, longActiveRows, longWallRows, candidates }) {
  const opportunities = [];
  if (longActiveRows.length > 0) {
    opportunities.push({
      kind: "long-active-review",
      status: "candidate",
      priority: "Medium",
      sessionCount: longActiveRows.length,
      savingsMode: "effort-proxy",
      action: "Review task family, outcome, and friction before deciding whether any decomposition, tool, or model change is needed.",
    });
  }
  const wallOnlyCount = longWallRows.filter((row) => !row.longActive).length;
  if (wallOnlyCount > 0) {
    opportunities.push({
      kind: "wall-span-noise",
      status: "observed",
      priority: "Low",
      sessionCount: wallOnlyCount,
      savingsMode: "none",
      action: "Treat wall-only spans as idle or resume evidence, not active work or token waste.",
    });
  }
  if (coverage.nonZeroUsageCount === 0 && coverage.responseCount > 0) {
    opportunities.push({
      kind: "usage-coverage-gap",
      status: "observed",
      priority: "High",
      responseCount: coverage.responseCount,
      savingsMode: "effort-proxy",
      action: "Report active time and request proxies; do not claim exact token, credit, or currency savings.",
    });
  }
  if (candidates.some((row) => row.responseCount > 0)) {
    opportunities.push({
      kind: "model-outcome-review",
      status: "needs-semantic-review",
      priority: "Medium",
      sessionCount: candidates.filter((row) => row.responseCount > 0).length,
      savingsMode: coverage.accountingMode,
      action: "Compare task family and reviewed outcome per model; otherwise recommend only a controlled model A/B.",
    });
  }
  return opportunities;
}

function sessionRole(sessionId, events) {
  if (events.some((event) => event.isSubagent === true) || /^task[-_:]/i.test(String(sessionId ?? ""))) {
    return { name: "child-agent-candidate", confidence: events.some((event) => event.isSubagent === true) ? "High" : "Medium" };
  }
  return { name: "user-thread-candidate", confidence: "Medium" };
}

function isModelRequestEvent(event) {
  return event?.type === "model.request.started"
    || event?.type === "model.response.completed"
    || (event?.type !== "assistant" && Boolean(event?.modelUsage));
}

function deduplicateModelRequests(events) {
  const output = [];
  const identities = new Map();
  const timeBuckets = new Map();
  for (const event of events) {
    const keys = responseIdentityKeys(event);
    let index = keys.map((key) => identities.get(key)).find((value) => value !== undefined);
    if (index === undefined) {
      index = proximityCandidates(event, timeBuckets)
        .find((candidate) => canMergeResponseEvents(output[candidate], event));
    }
    if (index === undefined) {
      index = output.length;
      output.push(event);
    } else {
      output[index] = mergeResponseEvents(output[index], event);
    }
    for (const key of responseIdentityKeys(output[index])) identities.set(key, index);
    addTimeBucket(output[index], index, timeBuckets);
  }
  return output;
}

function responseIdentityKeys(event) {
  const session = event?.sessionId ?? "unknown";
  return [
    event?.responseId ? `${session}:response:${event.responseId}` : null,
    event?.requestId ? `${session}:request:${event.requestId}` : null,
  ].filter(Boolean);
}

function responseTimestamp(event) {
  const value = Date.parse(event?.timestamp ?? "");
  return Number.isNaN(value) ? null : value;
}

function responseBucketKeys(event) {
  const timestamp = responseTimestamp(event);
  if (timestamp === null) return [];
  const session = event?.sessionId ?? "unknown";
  const second = Math.floor(timestamp / 1000);
  const models = event?.model ? [event.model, "*"] : ["*"];
  return models.flatMap((model) => [-1, 0, 1].map((offset) => `${session}:${model}:${second + offset}`));
}

function proximityCandidates(event, buckets) {
  return [...new Set(responseBucketKeys(event).flatMap((key) => buckets.get(key) ?? []))].reverse();
}

function addTimeBucket(event, index, buckets) {
  const timestamp = responseTimestamp(event);
  if (timestamp === null) return;
  const session = event?.sessionId ?? "unknown";
  const second = Math.floor(timestamp / 1000);
  for (const model of event?.model ? [event.model, "*"] : ["*"]) {
    const key = `${session}:${model}:${second}`;
    const indexes = buckets.get(key) ?? [];
    if (!indexes.includes(index)) indexes.push(index);
    buckets.set(key, indexes);
  }
}

function canMergeResponseEvents(left, right) {
  if (!left || !right || left.sessionId !== right.sessionId) return false;
  if (left.model && right.model && left.model !== right.model) return false;
  const leftTime = responseTimestamp(left);
  const rightTime = responseTimestamp(right);
  if (leftTime === null || rightTime === null || Math.abs(leftTime - rightTime) > RESPONSE_FALLBACK_WINDOW_MS) return false;
  const leftRequest = left.type === "model.request.started";
  const rightRequest = right.type === "model.request.started";
  const leftCompletion = left.type === "model.response.completed" || Boolean(left.modelUsage);
  const rightCompletion = right.type === "model.response.completed" || Boolean(right.modelUsage);
  return (leftRequest && rightCompletion) || (rightRequest && leftCompletion);
}

function responseRichness(event) {
  if (event?.type === "model.response.completed") return 4;
  if (event?.modelUsage) return 3;
  if (event?.model) return 2;
  return 1;
}

function mergeResponseEvents(left, right) {
  const primary = responseRichness(right) > responseRichness(left) ? right : left;
  const secondary = primary === left ? right : left;
  const hasUsage = left?.modelUsage || right?.modelUsage;
  return {
    ...secondary,
    ...primary,
    model: primary.model ?? secondary.model,
    responseId: primary.responseId ?? secondary.responseId,
    requestId: primary.requestId ?? secondary.requestId,
    requestIndex: primary.requestIndex ?? secondary.requestIndex,
    stopReason: primary.stopReason ?? secondary.stopReason,
    usageFieldsObserved: left.usageFieldsObserved === true || right.usageFieldsObserved === true,
    ...(hasUsage ? {
      modelUsage: Object.fromEntries(TOKEN_FIELDS.map((field) => [
        field,
        Math.max(Number(left?.modelUsage?.[field] ?? 0), Number(right?.modelUsage?.[field] ?? 0)),
      ])),
    } : {}),
    evidenceRefs: boundedEvidenceRefs([
      left.evidenceRef,
      ...(left.evidenceRefs ?? []),
      right.evidenceRef,
      ...(right.evidenceRefs ?? []),
    ]),
  };
}

function aggregateModels(responses) {
  const groups = groupBy(responses.filter((event) => event.model), (event) => event.model);
  return [...groups.entries()]
    .map(([model, rows]) => ({
      model,
      responseCount: rows.length,
      usageFieldObservedCount: rows.filter((event) => event.usageFieldsObserved === true).length,
      nonZeroUsageCount: rows.filter(hasNonZeroUsage).length,
      tokenTotals: tokenTotalsOrNull(rows),
    }))
    .sort((left, right) => right.responseCount - left.responseCount || left.model.localeCompare(right.model));
}

function tokenTotalsOrNull(responses) {
  if (!responses.some(hasNonZeroUsage)) return null;
  return Object.fromEntries(TOKEN_FIELDS.map((field) => [field, responses.reduce((sum, event) => sum + Number(event?.modelUsage?.[field] ?? 0), 0)]));
}

function hasNonZeroUsage(event) {
  return TOKEN_FIELDS.some((field) => Number(event?.modelUsage?.[field] ?? 0) > 0);
}

function usageStatus(responses, observed, nonZero) {
  if (responses.length === 0 || observed === 0) return "unavailable";
  if (nonZero === 0) return "zero-filled-unavailable";
  if (nonZero < responses.length) return "partial";
  return "observed";
}

function isFailure(event) {
  return event?.success === false || event?.hasError === true || event?.level === "error" || event?.type === "PostToolUseFailure";
}

function selectCandidates(rows, limit) {
  const selected = new Map();
  const add = (reason, values, count) => {
    for (const row of values.slice(0, count)) {
      const existing = selected.get(row.id);
      if (existing) {
        existing.candidateReasons.push(reason);
      } else {
        selected.set(row.id, { ...row, candidateReasons: [reason] });
      }
    }
  };
  add("active-long", rows.filter((row) => row.longActive).sort((a, b) => b.activeMs - a.activeMs), 4);
  add("model-requests", rows.filter((row) => row.responseCount > 0).sort((a, b) => b.responseCount - a.responseCount), 3);
  add("nonzero-usage", rows.filter((row) => row.nonZeroUsageCount > 0).sort((a, b) => tokenMagnitude(b) - tokenMagnitude(a)), 3);
  add("execution-friction", rows.filter((row) => row.failureCount > 0).sort((a, b) => b.failureCount - a.failureCount), 3);
  add("wall-only", rows.filter((row) => row.longWall && !row.longActive).sort((a, b) => b.wallMs - a.wallMs), 2);
  return [...selected.values()].slice(0, limit);
}

function tokenMagnitude(row) {
  return TOKEN_FIELDS.reduce((sum, field) => sum + Number(row?.tokenTotals?.[field] ?? 0), 0);
}

function groupBy(values, keyFn) {
  const result = new Map();
  for (const value of values) {
    const key = keyFn(value);
    if (key === undefined || key === null || key === "") continue;
    const rows = result.get(key) ?? [];
    rows.push(value);
    result.set(key, rows);
  }
  return result;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(3)) : null;
}

function boundedEvidenceRefs(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    if (!value) continue;
    const key = JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
    if (output.length >= 3) break;
  }
  return output;
}
