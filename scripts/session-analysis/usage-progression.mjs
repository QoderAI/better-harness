// Session usage progression: one owner for the numbers every usage surface
// quotes.
//
// The metrics here are derived once, from the complete normalized event stream,
// and are then only projected — never recomputed — by report and UI layers.
// Deriving them a second time from a display-bounded structure (a capped
// dialogue, a sampled progression) would silently answer a different question
// while reusing the same field names, so `buildUsageReport` is the only place
// that counts and `projectUsageReport` is the only place that bounds.

import {
  observedContextUsage,
  observedProcessingAccounting,
  observedTokenUsage,
  observedUsageRecord,
} from "./usage-records.mjs";

export const USAGE_BOUNDARY_KINDS = Object.freeze([
  "baseline",
  "growth",
  "steady",
  "shrink",
  "model-change",
  "unobserved",
]);

export const DEFAULT_USAGE_PROGRESSION_LIMIT = 1_000;
export const MIXED_PROCESSED_TOKENS_BASIS = "mixed-derived-usage";

const MODEL_TEXT_LIMIT = 80;
const BASIS_TEXT_LIMIT = 40;

/**
 * The shape every usage surface can rely on when a Session carries no observed
 * inference evidence. Renderers read this instead of inventing their own empty
 * defaults, so no two surfaces disagree about what "nothing observed" looks
 * like.
 */
export const EMPTY_USAGE_REPORT = Object.freeze({
  actualModelCalls: 0,
  duplicateRecordsCollapsed: 0,
  conflictingDuplicateRecords: 0,
  contextResetCount: 0,
  modelBoundaryCount: 0,
  progressionTotalCount: 0,
  progressionTruncated: false,
  progression: Object.freeze([]),
});

function truncateText(value, limit) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return limit > 0 ? text.slice(0, limit) : text;
}

// One absent convention for the whole contract: a field that was not observed
// is `null` here and is dropped by `retained` rather than coerced to zero.
// `Number(null)` is 0, which would turn "never reported" into "reported zero",
// so absence is rejected before any numeric read.
function numeric(value) {
  return value === null || value === undefined || value === "" ? Number.NaN : Number(value);
}

function tokenCount(value) {
  const number = numeric(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

function positiveTokenCount(value) {
  const number = numeric(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function deltaCount(value) {
  const number = numeric(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function percentValue(value) {
  const number = numeric(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number * 10) / 10)) : null;
}

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function retained(record) {
  return Object.fromEntries(Object.entries(record).filter(([_field, value]) => value !== null && value !== undefined));
}

/**
 * Normalize one `model.response.completed` event into a neutral usage
 * observation. Adapters keep their own event vocabulary; this is the single
 * translation into the progression contract.
 */
export function usageObservationFromEvent(event) {
  if (event?.usageProgressionExcluded === true) return null;
  const usage = observedUsageRecord(event);
  const tokenUsage = observedTokenUsage(usage);
  const contextUsage = observedContextUsage(event?.currentContextUsage, { boundText: truncateText });
  const processing = observedProcessingAccounting(event, { boundText: truncateText });
  if (!tokenUsage && !contextUsage && processing.processedTokens === undefined) return null;
  return {
    model: truncateText(event?.model, MODEL_TEXT_LIMIT),
    contextTokens: contextUsage?.usedTokens ?? null,
    windowTokens: contextUsage?.windowTokens ?? null,
    percentFull: contextUsage?.percentFull ?? null,
    processedTokens: processing.processedTokens ?? null,
    processedTokensBasis: processing.processedTokensBasis ?? null,
    outputTokens: tokenCount(tokenUsage?.outputTokens),
  };
}

/**
 * Keep a bounded, evidence-preserving subset of a long progression: both
 * endpoints, every shrink/reset and model boundary, then an even spread across
 * the rest. Point `index` stays the original response number, so a sampled
 * chart never implies responses that were not observed.
 */
function sampleProgression(points, limit) {
  if (points.length <= limit) return points;
  const boundaries = new Set([0, points.length - 1]);
  for (const [index, point] of points.entries()) {
    if (point.boundary === "shrink" || point.boundary === "model-change") boundaries.add(index);
  }

  const ordered = [...boundaries].sort((left, right) => left - right);
  if (ordered.length >= limit) {
    return Array.from({ length: limit }, (_unused, slot) => (
      points[ordered[Math.round((slot / (limit - 1)) * (ordered.length - 1))]]
    ));
  }

  const selected = new Set(ordered);
  for (let slot = 0; slot < limit && selected.size < limit; slot += 1) {
    selected.add(Math.round((slot / (limit - 1)) * (points.length - 1)));
  }
  for (let index = 0; index < points.length && selected.size < limit; index += 1) selected.add(index);
  return [...selected].sort((left, right) => left - right).map((index) => points[index]);
}

/**
 * Derive the Session usage report from complete usage observations.
 *
 * Callers must pass every retained inference, in order — not a display-bounded
 * subset. `diagnostics` carries adapter-side duplicate accounting so the report
 * is the single place a reviewer reads both the numbers and their caveats.
 * Returns `null` when a Session has no usage evidence at all.
 */
export function buildUsageReport(observations = [], {
  diagnostics = null,
  limit = DEFAULT_USAGE_PROGRESSION_LIMIT,
} = {}) {
  const points = [];
  let previous = null;
  let contextResetCount = 0;
  let modelBoundaryCount = 0;
  let processedTokens = 0;
  let processedObservationCount = 0;
  const processedBases = new Set();

  for (const [offset, observation] of observations.entries()) {
    const index = offset + 1;
    const contextTokens = tokenCount(observation?.contextTokens);
    const model = truncateText(observation?.model, MODEL_TEXT_LIMIT);
    let boundary = contextTokens === null ? "unobserved" : "baseline";
    let contextDeltaTokens = null;
    if (contextTokens !== null && previous) {
      // A model change moves the prompt to a different accounting basis, so the
      // two snapshots are not comparable and no delta is claimed.
      if (previous.model && model && previous.model !== model) {
        boundary = "model-change";
        modelBoundaryCount += 1;
      } else {
        contextDeltaTokens = contextTokens - previous.contextTokens;
        boundary = contextDeltaTokens < 0 ? "shrink" : contextDeltaTokens === 0 ? "steady" : "growth";
        if (contextDeltaTokens < 0) contextResetCount += 1;
      }
    }
    if (contextTokens !== null) previous = { contextTokens, model };

    const observationProcessedTokens = tokenCount(observation?.processedTokens);
    if (observationProcessedTokens !== null) {
      processedTokens += observationProcessedTokens;
      processedObservationCount += 1;
      const basis = truncateText(observation?.processedTokensBasis, BASIS_TEXT_LIMIT);
      if (basis) processedBases.add(basis);
    }

    points.push(retained({
      id: `R${index}`,
      index,
      model,
      contextTokens,
      windowTokens: positiveTokenCount(observation?.windowTokens),
      percentFull: percentValue(observation?.percentFull),
      contextDeltaTokens,
      processedTokens: observationProcessedTokens,
      outputTokens: tokenCount(observation?.outputTokens),
      boundary,
    }));
  }

  if (points.length === 0 && !diagnostics) return null;

  const contextPoints = points.filter((point) => Number.isFinite(point.contextTokens));
  const baselineContextTokens = contextPoints[0]?.contextTokens ?? null;
  const currentContextTokens = contextPoints.at(-1)?.contextTokens ?? null;
  // Net growth is only quotable while every snapshot shares one accounting
  // basis; a model boundary makes the endpoints incomparable.
  const netContextDeltaTokens = modelBoundaryCount === 0 && baselineContextTokens !== null && currentContextTokens !== null
    ? currentContextTokens - baselineContextTokens
    : null;
  const progression = sampleProgression(points, limit);
  const hasProcessedTokens = processedObservationCount > 0;

  return retained({
    actualModelCalls: points.length,
    duplicateRecordsCollapsed: count(diagnostics?.duplicateRecordsCollapsed),
    conflictingDuplicateRecords: count(diagnostics?.conflictingDuplicateRecords),
    currentContextTokens,
    baselineContextTokens,
    netContextDeltaTokens,
    contextResetCount,
    modelBoundaryCount,
    processedTokens: hasProcessedTokens ? processedTokens : null,
    processedTokensBasis: hasProcessedTokens
      ? (processedBases.size === 1 ? [...processedBases][0] : MIXED_PROCESSED_TOKENS_BASIS)
      : null,
    processedCoverage: hasProcessedTokens
      ? (processedObservationCount === points.length ? "observed" : "partial")
      : null,
    progressionTotalCount: points.length,
    progressionTruncated: progression.length < points.length,
    progression,
  });
}

function projectProgressionPoint(point, offset, boundText) {
  const index = count(point?.index) || offset + 1;
  return retained({
    id: `R${index}`,
    index,
    model: boundText(point?.model, MODEL_TEXT_LIMIT),
    contextTokens: tokenCount(point?.contextTokens),
    windowTokens: positiveTokenCount(point?.windowTokens),
    percentFull: percentValue(point?.percentFull),
    contextDeltaTokens: deltaCount(point?.contextDeltaTokens),
    processedTokens: tokenCount(point?.processedTokens),
    outputTokens: tokenCount(point?.outputTokens),
    boundary: USAGE_BOUNDARY_KINDS.includes(point?.boundary) ? point.boundary : "unobserved",
  });
}

/**
 * Bound a derived usage report for a portable, read-only surface.
 *
 * This validates and truncates; it never counts. `boundText` is injected so the
 * privacy owner of a given surface keeps its own redaction rules. A missing or
 * malformed report projects to the shared empty shape rather than to `null`, so
 * consumers never need a local default.
 */
export function projectUsageReport(report, {
  providerTotalTokens = null,
  limit = DEFAULT_USAGE_PROGRESSION_LIMIT,
  boundText = truncateText,
} = {}) {
  const source = report && typeof report === "object" ? report : {};
  const progression = (Array.isArray(source.progression) ? source.progression : [])
    .slice(0, limit)
    .map((point, offset) => projectProgressionPoint(point, offset, boundText));
  const actualModelCalls = count(source.actualModelCalls);
  const processedTokens = tokenCount(source.processedTokens);
  const hasProcessedTokens = processedTokens !== null;

  return retained({
    actualModelCalls,
    duplicateRecordsCollapsed: count(source.duplicateRecordsCollapsed),
    conflictingDuplicateRecords: count(source.conflictingDuplicateRecords),
    currentContextTokens: tokenCount(source.currentContextTokens),
    baselineContextTokens: tokenCount(source.baselineContextTokens),
    netContextDeltaTokens: deltaCount(source.netContextDeltaTokens),
    contextResetCount: count(source.contextResetCount),
    modelBoundaryCount: count(source.modelBoundaryCount),
    processedTokens,
    processedTokensBasis: hasProcessedTokens
      ? boundText(source.processedTokensBasis, BASIS_TEXT_LIMIT) ?? MIXED_PROCESSED_TOKENS_BASIS
      : null,
    processedCoverage: hasProcessedTokens
      ? (source.processedCoverage === "partial" ? "partial" : "observed")
      : null,
    providerTotalTokens: tokenCount(providerTotalTokens),
    progressionTotalCount: count(source.progressionTotalCount) || actualModelCalls,
    progressionTruncated: source.progressionTruncated === true,
    progression,
  });
}
