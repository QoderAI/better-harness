// Observed usage-record vocabulary shared by every host adapter.
//
// Hosts emit the same model response more than once: parallel tool lanes repeat
// one usage snapshot, hook and transcript lanes both observe a completion, and
// streaming writers rewrite a record as counters settle. Every adapter needs the
// same response identity, synthetic exclusion, and collapsing rules, so they
// live here instead of being re-derived per platform. Adapters opt in; an
// adapter whose counters are not additive simply does not call the derivations.

export const MODEL_RESPONSE_EVENT_TYPE = "model.response.completed";

// Provider counters retained on a normalized usage record. `totalTokens` and
// `reasoningOutputTokens` are provider-reported and never re-derived here.
export const USAGE_TOKEN_FIELDS = Object.freeze([
  "inputTokens",
  "outputTokens",
  "cacheReadInputTokens",
  "cacheCreationInputTokens",
  "reasoningOutputTokens",
  "totalTokens",
]);

// Cache counters do not share one provider-wide relationship. OpenAI/Codex
// includes cache reads in its input counter; Claude reports cache reads and
// cache creation as separate input lanes. Unknown hosts keep absolute counters
// without inheriting either formula.
export const CACHE_ACCOUNTING_MODE = Object.freeze({
  INCLUDED_IN_INPUT: "included-in-input",
  SEPARATE_INPUT_LANE: "separate-input-lane",
  RELATIONSHIP_UNKNOWN: "relationship-unknown",
});
export const CACHE_ACCOUNTING_MODES = Object.freeze(Object.values(CACHE_ACCOUNTING_MODE));

// Additive input lanes that make up the prompt a host actually sent.
export const PROMPT_CONTEXT_USAGE_FIELDS = Object.freeze([
  "inputTokens",
  "cacheReadInputTokens",
  "cacheCreationInputTokens",
]);

// Every lane a host processed for one response. Only meaningful for providers
// whose counters do not overlap; see DERIVED_PROCESSED_TOKENS_BASIS.
export const ADDITIVE_PROCESSED_USAGE_FIELDS = Object.freeze([
  ...PROMPT_CONTEXT_USAGE_FIELDS,
  "outputTokens",
]);

export const DERIVED_PROCESSED_TOKENS_BASIS = "derived-accounted-usage";
export const SYNTHETIC_RECORD_MARKER = "<synthetic>";

function boundedString(value, limit) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return limit > 0 ? text.slice(0, limit) : text;
}

// `Number(null)` is 0; absence must never read as an observed zero.
function tokenValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

/**
 * The usage payload an adapter recorded for one response. `usageCumulative`
 * marks a running Session total, which is never a per-invocation observation.
 */
export function observedUsageRecord(event) {
  return event?.modelInvocationUsage
    ?? (event?.usageCumulative === true ? null : event?.modelUsage)
    ?? null;
}

/**
 * The retained, non-negative subset of provider counters. Returns `null` when a
 * record carries no usable counter, which is what makes a usage observation
 * "observed" everywhere downstream.
 */
export function observedTokenUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const retained = {};
  for (const field of USAGE_TOKEN_FIELDS) {
    if (!Object.hasOwn(usage, field)) continue;
    const value = tokenValue(usage[field]);
    if (value !== null) retained[field] = value;
  }
  return Object.keys(retained).length > 0 ? retained : null;
}

export function observedCacheAccountingMode(value) {
  return CACHE_ACCOUNTING_MODES.includes(value) ? value : null;
}

/**
 * Derive an input-reuse presentation from provider-compatible counters.
 *
 * Absolute cache observations survive unknown or inconsistent relationships;
 * percentages and uncached input exist only when the provider formula is
 * explicit and internally consistent. This is deliberately not a savings
 * estimate: cached input still occupies the model context window.
 */
export function deriveCacheReuse(usage, accountingMode = usage?.cacheAccountingMode) {
  const retainedUsage = observedTokenUsage(usage);
  if (!retainedUsage || !Object.hasOwn(retainedUsage, "cacheReadInputTokens")) return null;
  const mode = observedCacheAccountingMode(accountingMode) ?? CACHE_ACCOUNTING_MODE.RELATIONSHIP_UNKNOWN;
  const cacheReadTokens = retainedUsage.cacheReadInputTokens;
  const cacheCreationTokens = Object.hasOwn(retainedUsage, "cacheCreationInputTokens")
    ? retainedUsage.cacheCreationInputTokens
    : null;
  const absolute = {
    status: "partial",
    accountingMode: mode,
    cacheReadTokens,
    ...(cacheCreationTokens !== null ? { cacheCreationTokens } : {}),
  };
  if (!Object.hasOwn(retainedUsage, "inputTokens")) return absolute;

  let promptInputTokens;
  let uncachedInputTokens;
  if (mode === CACHE_ACCOUNTING_MODE.INCLUDED_IN_INPUT) {
    promptInputTokens = retainedUsage.inputTokens;
    if (cacheReadTokens > promptInputTokens) return { ...absolute, status: "inconsistent" };
    uncachedInputTokens = promptInputTokens - cacheReadTokens;
  } else if (mode === CACHE_ACCOUNTING_MODE.SEPARATE_INPUT_LANE) {
    uncachedInputTokens = retainedUsage.inputTokens + (cacheCreationTokens ?? 0);
    promptInputTokens = uncachedInputTokens + cacheReadTokens;
  } else {
    return absolute;
  }

  return {
    ...absolute,
    status: "observed",
    promptInputTokens,
    uncachedInputTokens,
    reusePercent: promptInputTokens > 0
      ? Math.round((cacheReadTokens / promptInputTokens) * 1_000) / 10
      : 0,
  };
}

/** Validate an already-derived cache-reuse object at a report boundary. */
export function projectCacheReuse(source) {
  if (!source || typeof source !== "object") return null;
  const cacheReadTokens = tokenValue(source.cacheReadTokens);
  if (cacheReadTokens === null) return null;
  const accountingMode = observedCacheAccountingMode(source.accountingMode)
    ?? CACHE_ACCOUNTING_MODE.RELATIONSHIP_UNKNOWN;
  const cacheCreationTokens = tokenValue(source.cacheCreationTokens);
  const status = ["observed", "partial", "inconsistent"].includes(source.status)
    ? source.status
    : "partial";
  const projected = {
    status,
    accountingMode,
    cacheReadTokens,
    ...(cacheCreationTokens !== null ? { cacheCreationTokens } : {}),
  };
  if (status !== "observed") return projected;
  const promptInputTokens = tokenValue(source.promptInputTokens);
  const uncachedInputTokens = tokenValue(source.uncachedInputTokens);
  const reusePercentValue = Number(source.reusePercent);
  if (promptInputTokens === null || uncachedInputTokens === null
    || !Number.isFinite(reusePercentValue) || reusePercentValue < 0 || reusePercentValue > 100) {
    return { ...projected, status: "inconsistent" };
  }
  return {
    ...projected,
    promptInputTokens,
    uncachedInputTokens,
    reusePercent: Math.round(reusePercentValue * 10) / 10,
  };
}

/**
 * Bounded context-window occupancy for one observation. `percentFull` is
 * derived only when both absolute sides were observed, so a host that retained
 * a ratio alone never inherits a window it never reported.
 */
export function observedContextUsage(source, { boundText = boundedString } = {}) {
  if (!source || typeof source !== "object") return null;
  const usedTokens = tokenValue(source.usedTokens);
  const windowValue = source.windowTokens === null || source.windowTokens === undefined ? Number.NaN : Number(source.windowTokens);
  const windowTokens = Number.isFinite(windowValue) && windowValue > 0 ? Math.round(windowValue) : null;
  const percentValue = source.percentFull === null || source.percentFull === undefined ? Number.NaN : Number(source.percentFull);
  const percentFull = Number.isFinite(percentValue) && percentValue >= 0 && percentValue <= 100
    ? Math.round(percentValue * 10) / 10
    : usedTokens !== null && windowTokens !== null
      ? Math.min(100, Math.round((usedTokens / windowTokens) * 1_000) / 10)
      : null;
  if (usedTokens === null && windowTokens === null && percentFull === null) return null;
  const basis = boundText(source.basis, 40);
  return {
    ...(usedTokens !== null ? { usedTokens } : {}),
    ...(windowTokens !== null ? { windowTokens } : {}),
    ...(percentFull !== null ? { percentFull } : {}),
    ...(basis ? { basis } : {}),
  };
}

function sumObservedFields(usage, fields) {
  if (!usage || typeof usage !== "object") return null;
  if (!fields.some((field) => Object.hasOwn(usage, field))) return null;
  return fields.reduce((sum, field) => sum + (Number(usage[field]) || 0), 0);
}

/** Prompt tokens a host actually sent for one response. */
export function promptContextTokens(usage) {
  const sum = sumObservedFields(usage, PROMPT_CONTEXT_USAGE_FIELDS);
  return sum === null ? null : Math.round(sum);
}

/** Every token lane a host processed for one response. */
export function additiveProcessedTokens(usage) {
  const sum = sumObservedFields(usage, ADDITIVE_PROCESSED_USAGE_FIELDS);
  return sum === null ? null : Math.round(sum);
}

/**
 * Adapter opt-in for additive processing accounting. Spread the result into a
 * `model.response.completed` event; an adapter whose provider counters overlap
 * (cumulative totals, blended cache accounting) must not call this.
 */
export function additiveUsageAccounting(usage) {
  const processedTokens = additiveProcessedTokens(usage);
  return processedTokens === null
    ? {}
    : { processedTokens, processedTokensBasis: DERIVED_PROCESSED_TOKENS_BASIS };
}

/**
 * Bounded per-response processing accounting, in the shape every usage step
 * carries. Returns an empty object when the host never derived it, so callers
 * spread the result instead of re-checking the same two fields at each layer.
 */
export function observedProcessingAccounting(source, { boundText = boundedString } = {}) {
  const processedTokens = tokenValue(source?.processedTokens);
  if (processedTokens === null) return {};
  return {
    processedTokens,
    processedTokensBasis: boundText(source?.processedTokensBasis, 40) ?? DERIVED_PROCESSED_TOKENS_BASIS,
  };
}

/**
 * Session-local identity keys for a model response. `session-efficiency` merges
 * request and completion lanes, so it needs both; collapsing needs the response
 * key alone.
 */
export function responseIdentityKeys(event) {
  const session = event?.sessionId ?? "unknown";
  return [
    event?.responseId ? `${session}:response:${event.responseId}` : null,
    event?.requestId ? `${session}:request:${event.requestId}` : null,
  ].filter(Boolean);
}

export function responseIdentityKey(event) {
  return event?.responseId ? `${event?.sessionId ?? "unknown"}:response:${event.responseId}` : null;
}

/**
 * A placeholder record that stands in for a response the host never billed:
 * an explicit synthetic marker, or an all-zero counter set.
 */
export function isSyntheticUsageRecord(event) {
  if (event?.responseId === SYNTHETIC_RECORD_MARKER || event?.model === SYNTHETIC_RECORD_MARKER) return true;
  const values = Object.values(observedUsageRecord(event) ?? {}).map(Number).filter(Number.isFinite);
  return values.length > 0 && values.every((value) => value === 0);
}

function sameObservedUsage(left, right) {
  const leftUsage = observedUsageRecord(left) ?? {};
  const rightUsage = observedUsageRecord(right) ?? {};
  const fields = new Set([...Object.keys(leftUsage), ...Object.keys(rightUsage)]);
  return [...fields].every((field) => (Number(leftUsage[field]) || 0) === (Number(rightUsage[field]) || 0));
}

/**
 * Collapse repeated records for one model response into a single observation.
 *
 * `canonical` picks which payload survives: `"first"` for hosts that repeat an
 * identical snapshot, `"latest"` for hosts that rewrite counters as a response
 * settles. Either way the first occurrence's chronology and evidence location
 * are retained, so the collapsed record still points at where it was seen.
 *
 * `countDiagnostics` attaches a bounded `usageDeduplication` count to the
 * surviving record; leave it off for hosts whose duplicates carry no evidence
 * value. Non-response events and records without a response id pass through.
 */
export function collapseDuplicateResponseRecords(events, {
  canonical = "first",
  dropSyntheticRecords = false,
  countDiagnostics = false,
} = {}) {
  const indexes = new Map();
  const collapsed = [];
  for (const event of events) {
    if (event?.type !== MODEL_RESPONSE_EVENT_TYPE) {
      collapsed.push(event);
      continue;
    }
    if (dropSyntheticRecords && isSyntheticUsageRecord(event)) continue;
    const key = responseIdentityKey(event);
    const existingIndex = key === null ? undefined : indexes.get(key);
    if (existingIndex === undefined) {
      if (key !== null) indexes.set(key, collapsed.length);
      collapsed.push(event);
      continue;
    }
    const existing = collapsed[existingIndex];
    if (canonical === "first" && !countDiagnostics) continue;
    const previous = existing.usageDeduplication ?? {};
    const usageDeduplication = {
      duplicateRecordsCollapsed: (Number(previous.duplicateRecordsCollapsed) || 0) + 1,
      conflictingDuplicateRecords: (Number(previous.conflictingDuplicateRecords) || 0)
        + (sameObservedUsage(existing, event) ? 0 : 1),
    };
    const survivor = canonical === "latest"
      ? { ...event, timestamp: existing.timestamp ?? event.timestamp, evidenceRef: existing.evidenceRef ?? event.evidenceRef }
      : { ...existing };
    collapsed[existingIndex] = countDiagnostics ? { ...survivor, usageDeduplication } : survivor;
  }
  return collapsed;
}

/** Session-wide duplicate accounting, or `null` when nothing was collapsed. */
export function usageDeduplicationDiagnostics(events) {
  let duplicateRecordsCollapsed = 0;
  let conflictingDuplicateRecords = 0;
  for (const event of events) {
    duplicateRecordsCollapsed += Math.max(0, Number(event?.usageDeduplication?.duplicateRecordsCollapsed) || 0);
    conflictingDuplicateRecords += Math.max(0, Number(event?.usageDeduplication?.conflictingDuplicateRecords) || 0);
  }
  return duplicateRecordsCollapsed > 0 || conflictingDuplicateRecords > 0
    ? { duplicateRecordsCollapsed, conflictingDuplicateRecords }
    : null;
}
