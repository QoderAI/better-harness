import { validateHarnessReportSource } from "../harness-analysis/report-source/index.mjs";
import {
  bindingRefFromKey,
  createTraceFromProjection,
  EXPERIENCE_TRACE_BOUNDS,
} from "./contract.mjs";

const SOURCE_SCHEMA_VERSION = 3;
const MANIFEST_SCHEMA_VERSION = 2;
const MAX_SOURCE_DEPTH = EXPERIENCE_TRACE_BOUNDS.maxDepth;
const MAX_SOURCE_VALUES = EXPERIENCE_TRACE_BOUNDS.maxValues;
const MAX_SAFE_COUNT = 1_000_000;
const MAX_WARNING_CODES = 32;
const MAX_CHANGE_SETS = 16;
const MAX_VALIDATION_SETS = 32;
const MAX_TARGET_KEYS = 12;

const WARNING_CODES = new Set([
  "missing-required-root",
  "missing-optional-root",
  "disabled-source-root",
  "partial-secret-scan-coverage",
  "invalid-prior-learning-capture-report",
]);
const STRATEGIES = new Set(["stratified", "all-eligible", "latest-n"]);
const CONTINUATIONS = new Set(["explicit", "session-bounded"]);
const START_BOUNDARIES = new Set([
  "session-start",
  "explicit-task-key",
  "explicit-boundary",
  "idle-gap",
  "progress-handoff",
  "first-retained-boundary",
]);
const VALIDATION_CATEGORIES = new Set([
  "npm test",
  "pnpm test",
  "yarn test",
  "node --test",
  "vitest",
  "jest",
  "pytest",
  "go test",
  "cargo test",
  "agent-lint",
  "typecheck",
  "lint",
  "git diff --check",
]);
const VALIDATION_STATUSES = new Set(["passed", "failed", "observed"]);
const CLOSURE_STATUSES = new Set(["not-applicable", "unobserved", "closed", "observed-without-pass"]);
const REPAIR_STATUSES = new Set(["not-applicable", "unobserved", "review-required", "repaired-and-passed"]);

const EPISODE_REF_RE = /^episode:[a-f0-9]{12,64}$/u;
const SOURCE_FINGERPRINT_RE = /^[a-f0-9]{16}$/u;
const TARGET_KEY_RE = /^[a-f0-9]{20}$/u;
const CHECK_IDENTITY_RE = /^check:[a-f0-9]{24}$/u;

/**
 * A deliberately value-free error boundary for callers that map contract codes
 * onto stable CLI output.  Nothing from an untrusted report source is retained
 * in the error message.
 */
export class ExperienceTraceSourceError extends Error {
  constructor(code) {
    super(code);
    this.name = "ExperienceTraceSourceError";
    this.code = code;
  }
}

function fail(code) {
  throw new ExperienceTraceSourceError(code);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function own(record, field) {
  if (!isRecord(record) || !Object.hasOwn(record, field)) fail("INVALID_REPORT_SOURCE");
  return record[field];
}

function requiredRecord(record, field) {
  const value = own(record, field);
  if (!isRecord(value)) fail("INVALID_REPORT_SOURCE");
  return value;
}

function requiredArray(record, field) {
  const value = own(record, field);
  if (!Array.isArray(value)) fail("INVALID_REPORT_SOURCE");
  return value;
}

function requiredString(record, field) {
  const value = own(record, field);
  if (typeof value !== "string") fail("INVALID_REPORT_SOURCE");
  return value;
}

function requiredBoolean(record, field) {
  const value = own(record, field);
  if (typeof value !== "boolean") fail("INVALID_REPORT_SOURCE");
  return value;
}

function requiredCount(record, field, { minimum = 0 } = {}) {
  const value = own(record, field);
  if (!Number.isSafeInteger(value) || value < minimum || value > MAX_SAFE_COUNT) {
    fail("INVALID_REPORT_SOURCE");
  }
  return value;
}

function requiredEnum(record, field, values) {
  const value = requiredString(record, field);
  if (!values.has(value)) fail("INVALID_REPORT_SOURCE");
  return value;
}

function compareCodeUnits(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function canonicalStringSet(value, { maxLength, matcher }) {
  if (!Array.isArray(value) || value.length > maxLength) fail("INVALID_REPORT_SOURCE");
  const output = new Set();
  for (const item of value) {
    if (typeof item !== "string" || !matcher(item)) fail("INVALID_REPORT_SOURCE");
    output.add(item);
  }
  return [...output].sort(compareCodeUnits);
}

/**
 * Walk an already parsed source without recursive validators.  This models the
 * JSON tree, not JavaScript object graphs: cycles, non-JSON leaves, and holes
 * are rejected rather than risking unbounded work in a later product validator.
 */
export function preflightQoderReportSource(source) {
  try {
    const seen = new WeakSet();
    const stack = [{ value: source, depth: 0 }];
    let valueCount = 0;

    while (stack.length > 0) {
      const { value, depth } = stack.pop();
      valueCount += 1;
      if (valueCount > MAX_SOURCE_VALUES || depth > MAX_SOURCE_DEPTH) {
        fail("INVALID_REPORT_SOURCE");
      }

      if (value === null || typeof value === "string" || typeof value === "boolean") continue;
      if (typeof value === "number") {
        if (!Number.isFinite(value)) fail("INVALID_REPORT_SOURCE");
        continue;
      }
      if (typeof value !== "object") fail("INVALID_REPORT_SOURCE");
      if (seen.has(value)) fail("INVALID_REPORT_SOURCE");
      seen.add(value);

      if (Array.isArray(value)) {
        for (let index = value.length - 1; index >= 0; index -= 1) {
          if (!Object.hasOwn(value, index)) fail("INVALID_REPORT_SOURCE");
          stack.push({ value: value[index], depth: depth + 1 });
        }
        continue;
      }

      if (Object.getOwnPropertySymbols(value).length > 0) fail("INVALID_REPORT_SOURCE");
      const keys = Object.keys(value);
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        const key = keys[index];
        stack.push({ value: value[key], depth: depth + 1 });
      }
    }
  } catch (error) {
    if (error instanceof ExperienceTraceSourceError) throw error;
    fail("INVALID_REPORT_SOURCE");
  }
}

function assertMarkerCompatibility(source) {
  if (!isRecord(source) || !isRecord(source.manifest) || !isRecord(source.manifest.scope)) {
    fail("INVALID_REPORT_SOURCE");
  }

  const manifest = source.manifest;
  const scope = manifest.scope;
  if (!Number.isInteger(source.schemaVersion) || !Number.isInteger(manifest.schemaVersion)) {
    fail("INVALID_REPORT_SOURCE");
  }
  if (typeof source.kind !== "string" || source.kind !== "harness-report-source"
    || typeof manifest.kind !== "string" || manifest.kind !== "session-observation-manifest") {
    fail("INVALID_REPORT_SOURCE");
  }
  if (source.schemaVersion !== SOURCE_SCHEMA_VERSION || manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    fail("UNSUPPORTED_TRACE_SOURCE_VERSION");
  }
  if (typeof scope.platform !== "string" || typeof scope.workspaceScope !== "string") {
    fail("INVALID_REPORT_SOURCE");
  }
  if (scope.platform !== "qoder" || scope.workspaceScope !== "workspace") {
    fail("UNSUPPORTED_TRACE_PLATFORM");
  }
}

function assertBroadSourceValidity(source) {
  let errors;
  try {
    errors = validateHarnessReportSource(source);
  } catch {
    fail("INVALID_REPORT_SOURCE");
  }
  if (!Array.isArray(errors) || errors.length > 0) fail("INVALID_REPORT_SOURCE");
}

function projectSelection(source) {
  const manifest = requiredRecord(source, "manifest");
  const sources = requiredRecord(manifest, "sources");
  const selection = requiredRecord(manifest, "selection");
  const sourceFingerprint = requiredString(sources, "fingerprint");
  if (!SOURCE_FINGERPRINT_RE.test(sourceFingerprint)) fail("INVALID_REPORT_SOURCE");

  const strategy = requiredEnum(selection, "strategy", STRATEGIES);
  const eligibleCount = requiredCount(selection, "eligibleCount");
  const analyzedCount = requiredCount(selection, "analyzedCount");
  if (analyzedCount > eligibleCount) fail("INVALID_REPORT_SOURCE");
  const sampled = requiredBoolean(selection, "sampled");
  const representative = requiredBoolean(selection, "representative");
  const confidence = requiredString(selection, "confidence");
  const expectedConfidence = eligibleCount === 0 || analyzedCount === 0 || strategy === "latest-n"
    ? "Low"
    : analyzedCount < eligibleCount ? "Medium" : "High";
  if (sampled !== (analyzedCount < eligibleCount)
    || representative !== (!sampled && strategy !== "latest-n")
    || confidence !== expectedConfidence) {
    fail("INVALID_REPORT_SOURCE");
  }

  const warningCodes = canonicalStringSet(own(manifest, "warningCodes"), {
    maxLength: MAX_WARNING_CODES,
    matcher: (value) => WARNING_CODES.has(value),
  });
  return {
    sourceFingerprint,
    strategy,
    eligibleCount,
    analyzedCount,
    sampled,
    representative,
    confidence,
    warningCodes,
  };
}

function projectTargetKeys(record) {
  return canonicalStringSet(requiredArray(record, "targetKeys"), {
    maxLength: MAX_TARGET_KEYS,
    matcher: (value) => TARGET_KEY_RE.test(value),
  });
}

function projectChangeSets(episode) {
  const changeSets = requiredArray(episode, "changeSets");
  if (changeSets.length > MAX_CHANGE_SETS) fail("INVALID_REPORT_SOURCE");
  return changeSets.map((change) => {
    if (!isRecord(change)) fail("INVALID_REPORT_SOURCE");
    const eventCount = requiredCount(change, "eventCount");
    const firstOrdinal = requiredCount(change, "firstOrdinal");
    const lastOrdinal = requiredCount(change, "lastOrdinal");
    if (firstOrdinal > lastOrdinal) fail("INVALID_REPORT_SOURCE");
    return {
      eventCount,
      firstOrdinal,
      lastOrdinal,
      targetKeys: projectTargetKeys(change),
    };
  });
}

function projectValidationSets(episode) {
  const validationSets = requiredArray(episode, "validationSets");
  if (validationSets.length > MAX_VALIDATION_SETS) fail("INVALID_REPORT_SOURCE");
  const seenOrdinals = new Set();
  const projected = validationSets.map((validation) => {
    if (!isRecord(validation)) fail("INVALID_REPORT_SOURCE");
    const sourceOrdinal = requiredCount(validation, "ordinal");
    if (seenOrdinals.has(sourceOrdinal)) fail("INVALID_REPORT_SOURCE");
    seenOrdinals.add(sourceOrdinal);
    const checkIdentity = requiredString(validation, "checkIdentity");
    if (!CHECK_IDENTITY_RE.test(checkIdentity)) fail("INVALID_REPORT_SOURCE");
    return {
      category: requiredEnum(validation, "category", VALIDATION_CATEGORIES),
      status: requiredEnum(validation, "status", VALIDATION_STATUSES),
      sourceOrdinal,
      checkIdentity,
      targetKeys: projectTargetKeys(validation),
    };
  });
  return projected.sort((left, right) => left.sourceOrdinal - right.sourceOrdinal);
}

function projectPermissionBoundary(episode) {
  if (!Object.hasOwn(episode, "permissionSummary")) return null;
  const summary = requiredRecord(episode, "permissionSummary");
  const prompted = requiredCount(summary, "prompted");
  const denied = requiredCount(summary, "denied");
  const escalated = requiredCount(summary, "escalated");
  const protectedActions = requiredCount(summary, "protectedActions", { minimum: 1 });
  if (prompted > protectedActions || denied > protectedActions || escalated > protectedActions) {
    fail("INVALID_REPORT_SOURCE");
  }
  return { prompted, denied, escalated, protectedActions };
}

function projectEpisode(source, episodeRef) {
  if (!EPISODE_REF_RE.test(episodeRef)) fail("UNKNOWN_EPISODE_REF");
  const episodes = requiredArray(source, "taskEpisodes");
  const matches = episodes.filter((episode) => isRecord(episode) && episode.id === episodeRef);
  if (matches.length !== 1) fail("UNKNOWN_EPISODE_REF");
  const episode = matches[0];

  const selectedEpisodeRef = requiredString(episode, "id");
  if (!EPISODE_REF_RE.test(selectedEpisodeRef)) fail("INVALID_REPORT_SOURCE");
  const sessionCount = requiredCount(episode, "sessionCount", { minimum: 1 });
  const continuation = requiredEnum(episode, "continuation", CONTINUATIONS);
  if (sessionCount > 1 && continuation !== "explicit") fail("INVALID_REPORT_SOURCE");

  return {
    episodeRef: selectedEpisodeRef,
    sessionCount,
    continuation,
    startBoundary: requiredEnum(episode, "startBoundary", START_BOUNDARIES),
    toolCallCount: requiredCount(episode, "toolCalls"),
    changeSets: projectChangeSets(episode),
    validationSets: projectValidationSets(episode),
    permissionBoundary: projectPermissionBoundary(episode),
    closureStatus: requiredEnum(requiredRecord(episode, "closure"), "status", CLOSURE_STATUSES),
    repairStatus: requiredEnum(requiredRecord(episode, "repair"), "status", REPAIR_STATUSES),
  };
}

function normalizeSelectionOptions(options) {
  if (!isRecord(options)) fail("INVALID_USAGE");
  const noSessionEvidence = options.noSessionEvidence === true;
  if (options.noSessionEvidence !== undefined && typeof options.noSessionEvidence !== "boolean") {
    fail("INVALID_USAGE");
  }
  if (noSessionEvidence && options.episodeRef !== undefined) fail("INVALID_USAGE");
  if (noSessionEvidence) return { noSessionEvidence: true, episodeRef: null };
  if (!Object.hasOwn(options, "episodeRef") || typeof options.episodeRef !== "string") {
    fail("MISSING_EPISODE_SELECTION");
  }
  return { noSessionEvidence: false, episodeRef: options.episodeRef };
}

/**
 * Project a validated Qoder report source into the trace's closed, reader-safe
 * source shape.  This is intentionally an allowlist construction; no source
 * object, evidence locator, session identity, or unknown field is copied.
 */
export function projectQoderReportSource(source, options = {}) {
  try {
    preflightQoderReportSource(source);
    assertMarkerCompatibility(source);
    assertBroadSourceValidity(source);
    // Source compatibility and integrity are established before selection is
    // interpreted, so a malformed caller ref cannot mask a source marker.
    const selectionOptions = normalizeSelectionOptions(options);

    return {
      schemaVersion: 1,
      producer: {
        platform: "qoder",
        reportSourceSchemaVersion: SOURCE_SCHEMA_VERSION,
        manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
      },
      selection: projectSelection(source),
      episode: selectionOptions.noSessionEvidence ? null : projectEpisode(source, selectionOptions.episodeRef),
      absenceReason: selectionOptions.noSessionEvidence ? "caller-declared-no-session-evidence" : null,
    };
  } catch (error) {
    if (error instanceof ExperienceTraceSourceError) throw error;
    fail("INVALID_REPORT_SOURCE");
  }
}

export function createExperienceTrace(source, {
  taskKey,
  workspaceKey,
  runKey,
  episodeRef,
  noSessionEvidence,
} = {}) {
  // Preserve the public error precedence: caller binding syntax fails before a
  // source is traversed. The constructor re-derives these one-way references.
  bindingRefFromKey("task", taskKey);
  bindingRefFromKey("workspace", workspaceKey);
  bindingRefFromKey("run", runKey);
  const projection = projectQoderReportSource(source, { episodeRef, noSessionEvidence });
  return createTraceFromProjection({ projection, taskKey, workspaceKey, runKey });
}
