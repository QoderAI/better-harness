import { deduplicateLifecycleEvents } from "./episode-contract.mjs";

export const TOOL_CALL_TRACE_SCHEMA_VERSION = 2;
export const DEFAULT_TOOL_CALL_TRACE_LIMIT = Number.MAX_SAFE_INTEGER;
export const DEFAULT_TOOL_CALL_LANE_LIMIT = 8;
export const MAX_TOOL_CALL_DURATION_MS = 24 * 60 * 60 * 1000;

const FAILURE_STATUS = "failed";
const OBSERVED_STATUS = "observed";

export function buildToolCallTrace(events = [], options = {}) {
  const limit = positiveInteger(options.limit, DEFAULT_TOOL_CALL_TRACE_LIMIT);
  const laneLimit = Math.min(
    positiveInteger(options.laneLimit, DEFAULT_TOOL_CALL_LANE_LIMIT),
    DEFAULT_TOOL_CALL_LANE_LIMIT,
  );
  const canonicalCalls = deduplicateLifecycleEvents(events)
    .filter(isToolEvent)
    .map((event, index) => ({
      step: index + 1,
      toolName: privacySafeToolName(event?.toolName ?? event?.functionCallName),
      status: isFailure(event) ? FAILURE_STATUS : OBSERVED_STATUS,
      ...(options.includeTransientInvocationKey ? { transientInvocationKey: lifecycleInvocationKey(event) } : {}),
      ...observedStartFact(event),
      ...durationFact(event),
    }));
  const laneNames = boundedLaneNames(canonicalCalls, laneLimit);
  const boundedCalls = canonicalCalls.map((call) => ({
    ...call,
    toolName: laneNames.has(call.toolName) ? call.toolName : "Other tools",
  }));
  const selectedCalls = selectCalls(boundedCalls, limit).map((call) => ({
    id: `T${call.step}`,
    step: call.step,
    toolName: call.toolName,
    status: call.status,
    durationStatus: call.durationStatus,
    ...(call.transientInvocationKey ? { transientInvocationKey: call.transientInvocationKey } : {}),
    ...(Number.isFinite(call.startedAt) ? { startedAt: call.startedAt } : {}),
    ...(call.durationStatus === OBSERVED_STATUS ? {
      durationMs: call.durationMs,
      timingSource: call.timingSource,
    } : {}),
  }));

  return {
    schemaVersion: TOOL_CALL_TRACE_SCHEMA_VERSION,
    totalCalls: boundedCalls.length,
    shownCalls: selectedCalls.length,
    truncated: selectedCalls.length < boundedCalls.length,
    calls: selectedCalls,
  };
}

function lifecycleInvocationKey(event) {
  const value = event?.toolInvocationId ?? event?.requestId ?? event?.callId ?? null;
  return value ? String(value) : null;
}

// A wall-clock start lets the Inspector place a call on a real time axis
// instead of a call ordinal. Deduplicated lifecycles are canonically the result
// event, so the paired request stamp wins over the merged event's own timestamp;
// otherwise the call's single observation is the best start evidence. Absent or
// unparsable stamps stay absent so the renderer falls back to sequence order
// rather than inventing a time.
function observedStartFact(event) {
  const paired = Number(event?.startedAt);
  if (Number.isFinite(paired)) return { startedAt: paired };
  const observed = Date.parse(String(event?.timestamp ?? ""));
  return Number.isFinite(observed) ? { startedAt: observed } : {};
}

function durationFact(event) {
  const durationMs = Number(event?.durationMs);
  const timingSource = event?.durationSource === "transcript-pair" ? "transcript-pair"
    : event?.durationSource === "lifecycle-pair" ? "lifecycle-pair"
      : null;
  if (!Number.isFinite(durationMs)
    || durationMs < 0
    || durationMs > MAX_TOOL_CALL_DURATION_MS
    || !timingSource) {
    return { durationStatus: "unobserved" };
  }
  return {
    durationStatus: OBSERVED_STATUS,
    durationMs: Math.round(durationMs),
    timingSource,
  };
}

export function privacySafeToolName(value) {
  const label = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!label || label.length > 64 || !/^[\p{L}\p{N}_.: -]+$/u.test(label)) return "Unknown tool";
  return label;
}

function isToolEvent(event) {
  return Boolean(event?.toolName
    || event?.functionCallName
    || String(event?.type ?? "").toLowerCase().includes("tool"));
}

function isFailure(event) {
  return event?.success === false
    || event?.hasError === true
    || event?.level === "error"
    || event?.type === "PostToolUseFailure";
}

function boundedLaneNames(calls, laneLimit) {
  const counts = new Map();
  const firstStep = new Map();
  for (const call of calls) {
    counts.set(call.toolName, (counts.get(call.toolName) ?? 0) + 1);
    if (!firstStep.has(call.toolName)) firstStep.set(call.toolName, call.step);
  }
  const ranked = [...counts.keys()].sort((left, right) =>
    counts.get(right) - counts.get(left)
      || firstStep.get(left) - firstStep.get(right)
      || left.localeCompare(right));
  const visibleLaneCount = ranked.length > laneLimit ? Math.max(0, laneLimit - 1) : laneLimit;
  return new Set(ranked.slice(0, visibleLaneCount));
}

function selectCalls(calls, limit) {
  if (calls.length <= limit) return calls;
  const allIndexes = calls.map((_, index) => index);
  const failureIndexes = allIndexes.filter((index) => calls[index].status === FAILURE_STATUS);
  const failureBudget = Math.min(failureIndexes.length, Math.max(1, Math.floor(limit / 4)));
  const selected = new Set(evenlySample(failureIndexes, failureBudget));
  const remaining = allIndexes.filter((index) => !selected.has(index));
  for (const index of evenlySample(remaining, limit - selected.size)) selected.add(index);
  return [...selected].sort((left, right) => left - right).map((index) => calls[index]);
}

function evenlySample(values, limit) {
  if (limit <= 0 || values.length === 0) return [];
  if (values.length <= limit) return values.slice();
  if (limit === 1) return [values[Math.floor((values.length - 1) / 2)]];
  const selected = new Set();
  for (let index = 0; index < limit; index += 1) {
    selected.add(values[Math.round(index * (values.length - 1) / (limit - 1))]);
  }
  if (selected.size < limit) {
    for (const value of values) {
      selected.add(value);
      if (selected.size === limit) break;
    }
  }
  return [...selected];
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}
