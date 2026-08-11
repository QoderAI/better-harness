import { createHash } from "node:crypto";

export const EXPERIENCE_TRACE_SCHEMA_VERSION = 1;

export const EXPERIENCE_TRACE_BOUNDS = Object.freeze({
  maxSourceBytes: 16 * 1024 * 1024,
  maxTraceBytes: 1024 * 1024,
  maxLineBytes: 64 * 1024,
  maxRecords: 256,
  maxEvents: 64,
  maxDepth: 64,
  maxValues: 100_000,
});

export const CAPABILITY_ORDER = Object.freeze([
  "task-binding",
  "workspace-binding",
  "run-binding",
  "task-episode",
  "tool-observation",
  "validation-observation",
  "permission-boundary",
  "human-approval",
  "subagent-lineage",
  "worktree-lineage",
  "interruption-resume",
  "runtime-stop",
  "component-snapshot",
]);

export const FIXED_GAP_REASON_BY_CAPABILITY = Object.freeze({
  "human-approval": "human-approval-not-observed",
  "subagent-lineage": "subagent-parent-edge-not-observed",
  "worktree-lineage": "worktree-lineage-not-observed",
  "interruption-resume": "interruption-resume-not-observed",
  "runtime-stop": "runtime-stop-not-observed",
  "component-snapshot": "component-snapshot-not-bound",
});

const HEADER_KIND = "better-harness.experience-trace.header";
const EVENT_KIND = "better-harness.experience-trace.event";
const TERMINAL_KIND = "better-harness.experience-trace.terminal";
const VALIDATION_KIND = "better-harness.experience-trace.validation";
const BINDING_PREFIX = "better-harness:experience-trace:binding:v1\0";
const PROJECTION_PREFIX = "better-harness:experience-trace:source-projection:v1\0";
const TRACE_ID_PREFIX = "better-harness:experience-trace:identity:v1\0";
const TRACE_DIGEST_PREFIX = "better-harness:experience-trace:stream:v1\0";
const CALLER_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{15,95}$/;
const HEX_16_PATTERN = /^[a-f0-9]{16}$/;
const HEX_20_PATTERN = /^[a-f0-9]{20}$/;
const HEX_24_PATTERN = /^[a-f0-9]{24}$/;
const EPISODE_REF_PATTERN = /^episode:[a-f0-9]{12,64}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const TRACE_ID_PATTERN = /^trace:sha256:[a-f0-9]{64}$/;
const SOURCE_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const BINDING_KINDS = new Set(["task", "workspace", "run"]);
const WARNING_CODES = new Set([
  "missing-required-root",
  "missing-optional-root",
  "disabled-source-root",
  "partial-secret-scan-coverage",
  "invalid-prior-learning-capture-report",
]);
const STRATEGIES = new Set(["stratified", "all-eligible", "latest-n"]);
const CONFIDENCES = new Set(["Low", "Medium", "High"]);
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
const CLOSURE_STATUSES = new Set([
  "not-applicable",
  "unobserved",
  "closed",
  "observed-without-pass",
]);
const REPAIR_STATUSES = new Set([
  "not-applicable",
  "unobserved",
  "review-required",
  "repaired-and-passed",
]);
const GAP_REASON_CODES = new Set([
  "explicit-caller-binding",
  "explicit-episode-selection",
  "source-aggregate",
  "source-observation",
  "source-permission-summary",
  "caller-declared-no-session-evidence",
  "not-retained-by-source",
  ...Object.values(FIXED_GAP_REASON_BY_CAPABILITY),
]);

export class ExperienceTraceError extends Error {
  constructor(code = "INVALID_EXPERIENCE_TRACE", message = "experience trace is invalid") {
    super(message);
    this.name = "ExperienceTraceError";
    this.code = code;
  }
}

export function failExperienceTrace(code = "INVALID_EXPERIENCE_TRACE", message = "experience trace is invalid") {
  throw new ExperienceTraceError(code, message);
}

function invalid() {
  return failExperienceTrace("INVALID_EXPERIENCE_TRACE", "experience trace is invalid");
}

function invalidBinding() {
  return failExperienceTrace("INVALID_TRACE_BINDING", "trace binding key is invalid");
}

function traceBoundsExceeded() {
  return failExperienceTrace("TRACE_BOUNDS_EXCEEDED", "experience trace bounds exceeded");
}

export function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertNoLoneSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) invalid();
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      invalid();
    }
  }
}

function assertJsonPrimitive(value) {
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    assertNoLoneSurrogate(value);
    return;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0)) return;
  invalid();
}

/**
 * Performs the depth and value-count preflight before any recursive serializer
 * walks the supplied JSON value. The returned number is the number of JSON
 * values, excluding object property names.
 */
export function assertIterativeJsonStructure(value, options = {}) {
  const maxDepth = options.maxDepth ?? EXPERIENCE_TRACE_BOUNDS.maxDepth;
  const maxValues = options.maxValues ?? EXPERIENCE_TRACE_BOUNDS.maxValues;
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0 || !Number.isSafeInteger(maxValues) || maxValues < 1) {
    invalid();
  }

  const stack = [{ value, depth: 0 }];
  const seen = new WeakSet();
  let count = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    count += 1;
    if (count > maxValues || current.depth > maxDepth) invalid();
    const currentValue = current.value;
    if (currentValue === null || typeof currentValue !== "object") {
      assertJsonPrimitive(currentValue);
      continue;
    }
    if (!Array.isArray(currentValue) && !isPlainObject(currentValue)) invalid();
    if (seen.has(currentValue)) invalid();
    seen.add(currentValue);
    if (Array.isArray(currentValue)) {
      for (let index = currentValue.length - 1; index >= 0; index -= 1) {
        stack.push({ value: currentValue[index], depth: current.depth + 1 });
      }
      continue;
    }
    if (Object.getOwnPropertySymbols(currentValue).length > 0) invalid();
    const keys = Object.keys(currentValue);
    for (const key of keys) assertNoLoneSurrogate(key);
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      stack.push({ value: currentValue[keys[index]], depth: current.depth + 1 });
    }
  }
  return count;
}

function canonicalString(value) {
  assertNoLoneSurrogate(value);
  return value.normalize("NFC");
}

function canonicalJsonValue(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(canonicalString(value));
  if (Array.isArray(value)) return `[${value.map(canonicalJsonValue).join(",")}]`;

  const entries = [];
  const normalizedKeys = new Set();
  for (const key of Object.keys(value)) {
    const normalizedKey = canonicalString(key);
    if (normalizedKeys.has(normalizedKey)) invalid();
    normalizedKeys.add(normalizedKey);
    entries.push([normalizedKey, value[key]]);
  }
  entries.sort((left, right) => compareCodeUnits(left[0], right[0]));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJsonValue(item)}`).join(",")}}`;
}

export function canonicalJson(value) {
  assertIterativeJsonStructure(value);
  return canonicalJsonValue(value);
}

export function sha256Hex(value) {
  if (typeof value !== "string" && !Buffer.isBuffer(value) && !(value instanceof Uint8Array)) invalid();
  return createHash("sha256").update(value).digest("hex");
}

function assertExactKeys(value, keys) {
  if (!isPlainObject(value)) invalid();
  const actual = Object.keys(value).sort(compareCodeUnits);
  const expected = [...keys].sort(compareCodeUnits);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid();
}

function assertString(value, pattern) {
  if (typeof value !== "string") invalid();
  assertNoLoneSurrogate(value);
  if (pattern && !pattern.test(value)) invalid();
}

function assertEnum(value, allowed) {
  assertString(value);
  if (!allowed.has(value)) invalid();
}

function assertSafeCount(value, minimum = 0, maximum = 1_000_000) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) invalid();
}

function assertSortedUniqueStrings(values, allowed, maxLength) {
  if (!Array.isArray(values) || values.length > maxLength) invalid();
  let previous = null;
  for (const value of values) {
    assertString(value);
    if (allowed && !allowed.has(value)) invalid();
    if (previous !== null && compareCodeUnits(previous, value) >= 0) invalid();
    previous = value;
  }
}

function assertSortedUniqueTargetKeys(values) {
  if (!Array.isArray(values) || values.length > 12) invalid();
  let previous = null;
  for (const value of values) {
    assertString(value, HEX_20_PATTERN);
    if (previous !== null && compareCodeUnits(previous, value) >= 0) invalid();
    previous = value;
  }
}

function assertSelection(selection) {
  assertExactKeys(selection, [
    "sourceFingerprint", "strategy", "eligibleCount", "analyzedCount", "sampled",
    "representative", "confidence", "warningCodes",
  ]);
  assertString(selection.sourceFingerprint, HEX_16_PATTERN);
  assertEnum(selection.strategy, STRATEGIES);
  assertSafeCount(selection.eligibleCount);
  assertSafeCount(selection.analyzedCount);
  if (selection.analyzedCount > selection.eligibleCount || typeof selection.sampled !== "boolean" ||
      typeof selection.representative !== "boolean") invalid();
  if (selection.sampled !== (selection.analyzedCount < selection.eligibleCount)) invalid();
  if (selection.representative !== (!selection.sampled && selection.strategy !== "latest-n")) invalid();
  const expectedConfidence = selection.eligibleCount === 0 || selection.analyzedCount === 0 || selection.strategy === "latest-n"
    ? "Low"
    : selection.sampled ? "Medium" : "High";
  if (selection.confidence !== expectedConfidence || !CONFIDENCES.has(selection.confidence)) invalid();
  assertSortedUniqueStrings(selection.warningCodes, WARNING_CODES, 32);
}

function assertChangeSets(changeSets) {
  if (!Array.isArray(changeSets) || changeSets.length > 16) invalid();
  for (const changeSet of changeSets) {
    assertExactKeys(changeSet, ["eventCount", "firstOrdinal", "lastOrdinal", "targetKeys"]);
    assertSafeCount(changeSet.eventCount);
    assertSafeCount(changeSet.firstOrdinal);
    assertSafeCount(changeSet.lastOrdinal);
    if (changeSet.firstOrdinal > changeSet.lastOrdinal) invalid();
    assertSortedUniqueTargetKeys(changeSet.targetKeys);
  }
}

function assertValidationSets(validationSets) {
  if (!Array.isArray(validationSets) || validationSets.length > 32) invalid();
  let previousOrdinal = -1;
  for (const validation of validationSets) {
    assertExactKeys(validation, ["category", "status", "sourceOrdinal", "checkIdentity", "targetKeys"]);
    assertEnum(validation.category, VALIDATION_CATEGORIES);
    assertEnum(validation.status, VALIDATION_STATUSES);
    assertSafeCount(validation.sourceOrdinal);
    if (validation.sourceOrdinal <= previousOrdinal) invalid();
    previousOrdinal = validation.sourceOrdinal;
    assertString(validation.checkIdentity, /^check:[a-f0-9]{24}$/);
    assertSortedUniqueTargetKeys(validation.targetKeys);
  }
}

function assertPermissionBoundary(boundary) {
  if (boundary === null) return;
  assertExactKeys(boundary, ["prompted", "denied", "escalated", "protectedActions"]);
  assertSafeCount(boundary.prompted);
  assertSafeCount(boundary.denied);
  assertSafeCount(boundary.escalated);
  assertSafeCount(boundary.protectedActions);
  if (boundary.protectedActions === 0 || boundary.prompted > boundary.protectedActions ||
      boundary.denied > boundary.protectedActions || boundary.escalated > boundary.protectedActions) invalid();
}

function assertProjection(projection) {
  assertExactKeys(projection, ["schemaVersion", "producer", "selection", "episode", "absenceReason"]);
  if (projection.schemaVersion !== EXPERIENCE_TRACE_SCHEMA_VERSION) invalid();
  assertExactKeys(projection.producer, ["platform", "reportSourceSchemaVersion", "manifestSchemaVersion"]);
  if (projection.producer.platform !== "qoder" || projection.producer.reportSourceSchemaVersion !== 3 ||
      projection.producer.manifestSchemaVersion !== 2) invalid();
  assertSelection(projection.selection);
  if (projection.episode === null) {
    if (projection.absenceReason !== "caller-declared-no-session-evidence") invalid();
    return;
  }
  if (projection.absenceReason !== null) invalid();
  assertExactKeys(projection.episode, [
    "episodeRef", "sessionCount", "continuation", "startBoundary", "toolCallCount", "changeSets",
    "validationSets", "permissionBoundary", "closureStatus", "repairStatus",
  ]);
  assertString(projection.episode.episodeRef, EPISODE_REF_PATTERN);
  assertSafeCount(projection.episode.sessionCount, 1);
  assertEnum(projection.episode.continuation, CONTINUATIONS);
  if (projection.episode.sessionCount > 1 && projection.episode.continuation !== "explicit") invalid();
  assertEnum(projection.episode.startBoundary, START_BOUNDARIES);
  assertSafeCount(projection.episode.toolCallCount);
  assertChangeSets(projection.episode.changeSets);
  assertValidationSets(projection.episode.validationSets);
  assertPermissionBoundary(projection.episode.permissionBoundary);
  assertEnum(projection.episode.closureStatus, CLOSURE_STATUSES);
  assertEnum(projection.episode.repairStatus, REPAIR_STATUSES);
}

export function bindingRefFromKey(kind, key) {
  if (!BINDING_KINDS.has(kind) || typeof key !== "string" || !CALLER_KEY_PATTERN.test(key)) invalidBinding();
  return `${kind}:sha256:${sha256Hex(Buffer.from(`${BINDING_PREFIX}${kind}\0${key}`, "utf8"))}`;
}

export function sourceProjectionDigestFor(projection) {
  assertProjection(projection);
  return `sha256:${sha256Hex(Buffer.from(`${PROJECTION_PREFIX}${canonicalJson(projection)}`, "utf8"))}`;
}

function assertBindingRef(kind, value) {
  assertString(value, new RegExp(`^${kind}:sha256:[a-f0-9]{64}$`));
}

export function traceIdFor(input) {
  assertExactKeys(input, ["taskRef", "workspaceRef", "runRef", "sourceProjectionDigest", "episodeRef", "absenceReason"]);
  assertBindingRef("task", input.taskRef);
  assertBindingRef("workspace", input.workspaceRef);
  assertBindingRef("run", input.runRef);
  assertString(input.sourceProjectionDigest, SOURCE_DIGEST_PATTERN);
  if (input.episodeRef === null) {
    if (input.absenceReason !== "caller-declared-no-session-evidence") invalid();
  } else {
    assertString(input.episodeRef, EPISODE_REF_PATTERN);
    if (input.absenceReason !== null) invalid();
  }
  const preimage = {
    schemaVersion: EXPERIENCE_TRACE_SCHEMA_VERSION,
    producerPlatform: "qoder",
    taskRef: input.taskRef,
    workspaceRef: input.workspaceRef,
    runRef: input.runRef,
    sourceProjectionDigest: input.sourceProjectionDigest,
    episodeRef: input.episodeRef,
    absenceReason: input.absenceReason,
  };
  return `trace:sha256:${sha256Hex(Buffer.from(`${TRACE_ID_PREFIX}${canonicalJson(preimage)}`, "utf8"))}`;
}

export function traceDigestFor(recordsWithoutTerminal) {
  if (!Array.isArray(recordsWithoutTerminal) || recordsWithoutTerminal.length < 1) invalid();
  const lines = recordsWithoutTerminal.map((record) => {
    if (!isPlainObject(record) || (record.kind !== HEADER_KIND && record.kind !== EVENT_KIND)) invalid();
    return canonicalJson(record);
  });
  return `sha256:${sha256Hex(Buffer.from(`${TRACE_DIGEST_PREFIX}${lines.map((line) => `${line}\n`).join("")}`, "utf8"))}`;
}

function equalJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function sourceProjectionFromHeaderAndEvents(header, events) {
  const noSession = header.binding.episode.ref === null;
  if (noSession) {
    return {
      schemaVersion: EXPERIENCE_TRACE_SCHEMA_VERSION,
      producer: { platform: "qoder", reportSourceSchemaVersion: 3, manifestSchemaVersion: 2 },
      selection: header.selection,
      episode: null,
      absenceReason: "caller-declared-no-session-evidence",
    };
  }
  if (events.length < 3 || events[0].eventType !== "task-episode" || events[1].eventType !== "tool-observation") invalid();
  const task = events[0];
  const tool = events[1];
  const validationSets = [];
  let index = 2;
  while (index < events.length && events[index].eventType === "validation-observation") {
    const event = events[index];
    validationSets.push({
      category: event.payload.category,
      status: event.payload.status,
      sourceOrdinal: event.payload.sourceOrdinal,
      checkIdentity: event.payload.checkIdentity,
      targetKeys: event.payload.targetKeys,
    });
    index += 1;
  }
  let permissionBoundary = null;
  if (index < events.length && events[index].eventType === "permission-boundary") {
    permissionBoundary = events[index].payload;
    index += 1;
  }
  if (index >= events.length || events[index].eventType !== "episode-observation-ended") invalid();
  const end = events[index];
  return {
    schemaVersion: EXPERIENCE_TRACE_SCHEMA_VERSION,
    producer: { platform: "qoder", reportSourceSchemaVersion: 3, manifestSchemaVersion: 2 },
    selection: header.selection,
    episode: {
      episodeRef: task.payload.episodeRef,
      sessionCount: task.payload.sessionCount,
      continuation: task.payload.continuation,
      startBoundary: task.payload.startBoundary,
      toolCallCount: tool.payload.toolCallCount,
      changeSets: tool.payload.changeSets.map(({ changeRef, ...changeSet }) => changeSet),
      validationSets,
      permissionBoundary,
      closureStatus: end.payload.closureStatus,
      repairStatus: end.payload.repairStatus,
    },
    absenceReason: null,
  };
}

function coverageFor(projection) {
  const coverage = [
    { capability: "task-binding", availability: "derived", provenance: "caller-asserted", reasonCode: "explicit-caller-binding" },
    { capability: "workspace-binding", availability: "derived", provenance: "caller-asserted", reasonCode: "explicit-caller-binding" },
    { capability: "run-binding", availability: "derived", provenance: "caller-asserted", reasonCode: "explicit-caller-binding" },
  ];
  if (projection.episode === null) {
    for (const capability of ["task-episode", "tool-observation", "validation-observation", "permission-boundary"]) {
      coverage.push({ capability, availability: "unavailable", provenance: "unavailable", reasonCode: "caller-declared-no-session-evidence" });
    }
  } else {
    coverage.push(
      { capability: "task-episode", availability: "observed", provenance: "source-projected", reasonCode: "explicit-episode-selection" },
      { capability: "tool-observation", availability: "derived", provenance: "source-projected", reasonCode: "source-aggregate" },
      projection.episode.validationSets.length > 0
        ? { capability: "validation-observation", availability: "observed", provenance: "source-projected", reasonCode: "source-observation" }
        : { capability: "validation-observation", availability: "unavailable", provenance: "unavailable", reasonCode: "not-retained-by-source" },
      projection.episode.permissionBoundary !== null
        ? { capability: "permission-boundary", availability: "derived", provenance: "source-projected", reasonCode: "source-permission-summary" }
        : { capability: "permission-boundary", availability: "unavailable", provenance: "unavailable", reasonCode: "not-retained-by-source" },
    );
  }
  for (const capability of Object.keys(FIXED_GAP_REASON_BY_CAPABILITY)) {
    coverage.push({ capability, availability: "unavailable", provenance: "unavailable", reasonCode: FIXED_GAP_REASON_BY_CAPABILITY[capability] });
  }
  if (!equalJson(coverage.map((row) => row.capability), CAPABILITY_ORDER)) invalid();
  return coverage;
}

function expectedEvents(projection, traceId, coverage) {
  const events = [];
  const append = (eventType, availability, evidenceRef, payload) => {
    events.push({
      kind: EVENT_KIND,
      schemaVersion: EXPERIENCE_TRACE_SCHEMA_VERSION,
      recordOrdinal: events.length + 1,
      traceId,
      eventType,
      availability,
      evidenceRef,
      payload,
    });
  };
  if (projection.episode !== null) {
    const episode = projection.episode;
    append("task-episode", "observed", "source:episode", {
      episodeRef: episode.episodeRef,
      sessionCount: episode.sessionCount,
      continuation: episode.continuation,
      startBoundary: episode.startBoundary,
    });
    append("tool-observation", "derived", "source:tool-summary", {
      toolCallCount: episode.toolCallCount,
      changeSets: episode.changeSets.map((changeSet, index) => ({ changeRef: `source:change:${index + 1}`, ...changeSet })),
    });
    for (let index = 0; index < episode.validationSets.length; index += 1) {
      const validation = episode.validationSets[index];
      const validationRef = `source:validation:${index + 1}`;
      append("validation-observation", "observed", validationRef, { validationRef, ...validation });
    }
    if (episode.permissionBoundary !== null) {
      append("permission-boundary", "derived", "source:permission-boundary", episode.permissionBoundary);
    }
    append("episode-observation-ended", "derived", "source:episode-end", {
      closureStatus: episode.closureStatus,
      repairStatus: episode.repairStatus,
    });
  }
  for (const row of coverage) {
    if (row.availability === "unavailable") {
      append("capability-gap", "unavailable", `source:gap:${row.capability}`, {
        capability: row.capability,
        reasonCode: row.reasonCode,
      });
    }
  }
  return events;
}

/**
 * Builds the complete immutable wire stream from a source projection.  Raw
 * caller keys are consumed only for one-way binding references and never
 * appear in a record or in the returned JSONL.
 */
export function createTraceFromProjection(input) {
  try {
    assertExactKeys(input, ["projection", "taskKey", "workspaceKey", "runKey"]);
    const { projection, taskKey, workspaceKey, runKey } = input;
    assertProjection(projection);
    const taskRef = bindingRefFromKey("task", taskKey);
    const workspaceRef = bindingRefFromKey("workspace", workspaceKey);
    const runRef = bindingRefFromKey("run", runKey);
    const sourceProjectionDigest = sourceProjectionDigestFor(projection);
    const episodeRef = projection.episode === null ? null : projection.episode.episodeRef;
    const traceId = traceIdFor({
      taskRef,
      workspaceRef,
      runRef,
      sourceProjectionDigest,
      episodeRef,
      absenceReason: projection.absenceReason,
    });
    const header = {
    kind: HEADER_KIND,
    schemaVersion: EXPERIENCE_TRACE_SCHEMA_VERSION,
    recordOrdinal: 0,
    traceId,
    binding: {
      task: { ref: taskRef, provenance: "caller-asserted" },
      workspace: { ref: workspaceRef, provenance: "caller-asserted" },
      run: { ref: runRef, provenance: "caller-asserted" },
      episode: projection.episode === null
        ? { ref: null, provenance: "unavailable", reasonCode: "caller-declared-no-session-evidence" }
        : { ref: episodeRef, provenance: "source-projected", reasonCode: "explicit-episode-selection" },
    },
    source: {
      projectionDigest: sourceProjectionDigest,
      reportSourceSchemaVersion: 3,
      manifestSchemaVersion: 2,
    },
    producer: { kind: "qoder-report-source-projection", platform: "qoder" },
    selection: projection.selection,
    };
    const coverage = coverageFor(projection);
    const events = expectedEvents(projection, traceId, coverage);
    const withoutTerminal = [header, ...events];
    const terminal = {
    kind: TERMINAL_KIND,
    schemaVersion: EXPERIENCE_TRACE_SCHEMA_VERSION,
    recordOrdinal: withoutTerminal.length,
    traceId,
    streamStatus: "complete",
    evidenceStatus: projection.episode === null ? "unavailable" : "partial",
    coverage,
    eventCount: events.length,
    recordCount: withoutTerminal.length + 1,
    policyUse: "advisory-only",
    traceDigest: traceDigestFor(withoutTerminal),
    };
    const records = [...withoutTerminal, terminal];
    const jsonl = serializeExperienceTrace(records);
    // Create must prove that its bounded canonical output is accepted by the
    // exact byte-level validator used by the validate command.
    parseAndValidateExperienceTraceJsonl(Buffer.from(jsonl, "utf8"));
    return { records, jsonl };
  } catch (error) {
    if (error instanceof ExperienceTraceError) throw error;
    invalid();
  }
}

function assertHeader(header) {
  assertExactKeys(header, ["kind", "schemaVersion", "recordOrdinal", "traceId", "binding", "source", "producer", "selection"]);
  if (header.kind !== HEADER_KIND || header.schemaVersion !== EXPERIENCE_TRACE_SCHEMA_VERSION || header.recordOrdinal !== 0) invalid();
  assertString(header.traceId, TRACE_ID_PATTERN);
  assertExactKeys(header.binding, ["task", "workspace", "run", "episode"]);
  for (const kind of ["task", "workspace", "run"]) {
    assertExactKeys(header.binding[kind], ["ref", "provenance"]);
    assertBindingRef(kind, header.binding[kind].ref);
    if (header.binding[kind].provenance !== "caller-asserted") invalid();
  }
  assertExactKeys(header.binding.episode, ["ref", "provenance", "reasonCode"]);
  if (header.binding.episode.ref === null) {
    if (header.binding.episode.provenance !== "unavailable" || header.binding.episode.reasonCode !== "caller-declared-no-session-evidence") invalid();
  } else {
    assertString(header.binding.episode.ref, EPISODE_REF_PATTERN);
    if (header.binding.episode.provenance !== "source-projected" || header.binding.episode.reasonCode !== "explicit-episode-selection") invalid();
  }
  assertExactKeys(header.source, ["projectionDigest", "reportSourceSchemaVersion", "manifestSchemaVersion"]);
  assertString(header.source.projectionDigest, SOURCE_DIGEST_PATTERN);
  if (header.source.reportSourceSchemaVersion !== 3 || header.source.manifestSchemaVersion !== 2) invalid();
  assertExactKeys(header.producer, ["kind", "platform"]);
  if (header.producer.kind !== "qoder-report-source-projection" || header.producer.platform !== "qoder") invalid();
  assertSelection(header.selection);
}

function assertTerminalShape(terminal) {
  assertExactKeys(terminal, [
    "kind", "schemaVersion", "recordOrdinal", "traceId", "streamStatus", "evidenceStatus", "coverage",
    "eventCount", "recordCount", "policyUse", "traceDigest",
  ]);
  if (terminal.kind !== TERMINAL_KIND || terminal.schemaVersion !== EXPERIENCE_TRACE_SCHEMA_VERSION ||
      terminal.streamStatus !== "complete" || terminal.policyUse !== "advisory-only") invalid();
  assertString(terminal.traceId, TRACE_ID_PATTERN);
  assertEnum(terminal.evidenceStatus, new Set(["partial", "unavailable"]));
  assertString(terminal.traceDigest, SOURCE_DIGEST_PATTERN);
}

function assertRecordShapes(records) {
  if (!Array.isArray(records)) invalid();
  if (records.length > EXPERIENCE_TRACE_BOUNDS.maxRecords) traceBoundsExceeded();
  if (records.length < 3) invalid();
  if (records.length - 2 > EXPERIENCE_TRACE_BOUNDS.maxEvents) traceBoundsExceeded();
  let values = 0;
  for (const record of records) {
    values += assertIterativeJsonStructure(record, { maxDepth: EXPERIENCE_TRACE_BOUNDS.maxDepth, maxValues: EXPERIENCE_TRACE_BOUNDS.maxValues });
    if (values > EXPERIENCE_TRACE_BOUNDS.maxValues) invalid();
  }
  if (records[0]?.kind !== HEADER_KIND || records.at(-1)?.kind !== TERMINAL_KIND) invalid();
  for (let index = 0; index < records.length; index += 1) {
    if (!isPlainObject(records[index]) || records[index].recordOrdinal !== index) invalid();
  }
}

function validateExperienceTraceRecordsInternal(records) {
  assertRecordShapes(records);
  const header = records[0];
  const terminal = records.at(-1);
  const events = records.slice(1, -1);
  assertHeader(header);
  assertTerminalShape(terminal);
  for (const event of events) {
    assertExactKeys(event, ["kind", "schemaVersion", "recordOrdinal", "traceId", "eventType", "availability", "evidenceRef", "payload"]);
    if (event.kind !== EVENT_KIND || event.schemaVersion !== EXPERIENCE_TRACE_SCHEMA_VERSION || event.traceId !== header.traceId) invalid();
    assertEnum(event.availability, new Set(["observed", "derived", "unavailable"]));
    assertString(event.evidenceRef, /^source:(episode|tool-summary|validation:[1-9][0-9]*|permission-boundary|episode-end|gap:[a-z-]+)$/);
  }
  if (terminal.traceId !== header.traceId || terminal.recordOrdinal !== records.length - 1 || terminal.eventCount !== events.length ||
      terminal.recordCount !== records.length) invalid();
  const projection = sourceProjectionFromHeaderAndEvents(header, events);
  assertProjection(projection);
  const projectedEpisodeRef = projection.episode === null ? null : projection.episode.episodeRef;
  if (header.binding.episode.ref !== projectedEpisodeRef) invalid();
  const coverage = coverageFor(projection);
  const expected = expectedEvents(projection, header.traceId, coverage);
  if (!equalJson(events, expected)) invalid();
  const sourceDigest = sourceProjectionDigestFor(projection);
  if (header.source.projectionDigest !== sourceDigest) invalid();
  const expectedTraceId = traceIdFor({
    taskRef: header.binding.task.ref,
    workspaceRef: header.binding.workspace.ref,
    runRef: header.binding.run.ref,
    sourceProjectionDigest: sourceDigest,
    episodeRef: projection.episode === null ? null : projection.episode.episodeRef,
    absenceReason: projection.absenceReason,
  });
  if (header.traceId !== expectedTraceId) invalid();
  const expectedEvidenceStatus = projection.episode === null ? "unavailable" : "partial";
  if (terminal.evidenceStatus !== expectedEvidenceStatus || !equalJson(terminal.coverage, coverage)) invalid();
  const digest = traceDigestFor(records.slice(0, -1));
  if (terminal.traceDigest !== digest) invalid();
  return records;
}

export function validateExperienceTraceRecords(records) {
  try {
    return validateExperienceTraceRecordsInternal(records);
  } catch (error) {
    if (error instanceof ExperienceTraceError) throw error;
    invalid();
  }
}

function assertNoDuplicateJsonObjectKeys(text) {
  let index = 0;
  const skipWhitespace = () => {
    while (/[ \t\n\r]/u.test(text[index] ?? "")) index += 1;
  };
  const parseString = () => {
    const start = index;
    index += 1;
    while (index < text.length) {
      const character = text[index];
      if (character === "\\") {
        index += 1;
        if (text[index] === "u") index += 4;
        index += 1;
      } else if (character === "\"") {
        index += 1;
        return JSON.parse(text.slice(start, index));
      } else {
        index += 1;
      }
    }
    invalid();
  };
  const parseValue = () => {
    skipWhitespace();
    if (text[index] === "\"") {
      parseString();
      return;
    }
    if (text[index] === "{") {
      index += 1;
      skipWhitespace();
      const keys = new Set();
      if (text[index] === "}") {
        index += 1;
        return;
      }
      while (true) {
        skipWhitespace();
        if (text[index] !== "\"") invalid();
        const key = parseString();
        if (keys.has(key)) invalid();
        keys.add(key);
        skipWhitespace();
        if (text[index] !== ":") invalid();
        index += 1;
        parseValue();
        skipWhitespace();
        if (text[index] === "}") {
          index += 1;
          return;
        }
        if (text[index] !== ",") invalid();
        index += 1;
      }
    }
    if (text[index] === "[") {
      index += 1;
      skipWhitespace();
      if (text[index] === "]") {
        index += 1;
        return;
      }
      while (true) {
        parseValue();
        skipWhitespace();
        if (text[index] === "]") {
          index += 1;
          return;
        }
        if (text[index] !== ",") invalid();
        index += 1;
      }
    }
    const number = text.slice(index).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u);
    if (number) {
      index += number[0].length;
      return;
    }
    for (const literal of ["true", "false", "null"]) {
      if (text.startsWith(literal, index)) {
        index += literal.length;
        return;
      }
    }
    invalid();
  };
  parseValue();
  skipWhitespace();
  if (index !== text.length) invalid();
}

function experienceTraceInputBytes(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (typeof input !== "string") invalid();
  // A JavaScript string has no raw UTF-8 representation to scan. Preserve the
  // string contract by rejecting lone surrogates before Buffer would replace
  // them with U+FFFD, then apply the same byte bounds to its exact UTF-8 bytes.
  assertNoLoneSurrogate(input);
  return Buffer.from(input, "utf8");
}

function preflightExperienceTraceBytes(bytes) {
  if (bytes.length > EXPERIENCE_TRACE_BOUNDS.maxTraceBytes) traceBoundsExceeded();
  const lineRanges = [];
  let lineStart = 0;
  let lineBytes = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    lineBytes += 1;
    if (lineBytes > EXPERIENCE_TRACE_BOUNDS.maxLineBytes) traceBoundsExceeded();
    if (bytes[index] !== 0x0a) continue;
    lineRanges.push([lineStart, index]);
    if (lineRanges.length > EXPERIENCE_TRACE_BOUNDS.maxRecords ||
        lineRanges.length - 2 > EXPERIENCE_TRACE_BOUNDS.maxEvents) {
      traceBoundsExceeded();
    }
    lineStart = index + 1;
    lineBytes = 0;
  }
  const hasFinalLf = lineStart === bytes.length;
  const physicalLineCount = lineRanges.length + (hasFinalLf ? 0 : 1);
  if (physicalLineCount > EXPERIENCE_TRACE_BOUNDS.maxRecords ||
      physicalLineCount - 2 > EXPERIENCE_TRACE_BOUNDS.maxEvents) {
    traceBoundsExceeded();
  }
  return { lineRanges, hasFinalLf };
}

function assertValidUtf8(bytes) {
  const decoded = bytes.toString("utf8");
  if (!Buffer.from(decoded, "utf8").equals(bytes)) invalid();
}

export function parseAndValidateExperienceTraceJsonl(input) {
  const bytes = experienceTraceInputBytes(input);
  const preflight = preflightExperienceTraceBytes(bytes);
  // Bounds deliberately win over malformed UTF-8 for raw byte inputs. Decode
  // and round-trip only after the complete single-pass byte preflight.
  assertValidUtf8(bytes);
  if (bytes.length === 0 || bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) || bytes.includes(0x0d) ||
      !preflight.hasFinalLf || preflight.lineRanges.length < 2) invalid();
  const records = [];
  for (const [lineStart, lineEnd] of preflight.lineRanges) {
    if (lineStart === lineEnd) invalid();
    const line = bytes.toString("utf8", lineStart, lineEnd);
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      invalid();
    }
    assertIterativeJsonStructure(record);
    assertNoDuplicateJsonObjectKeys(line);
    if (!Buffer.from(`${canonicalJson(record)}\n`, "utf8").equals(bytes.subarray(lineStart, lineEnd + 1))) invalid();
    records.push(record);
  }
  validateExperienceTraceRecords(records);
  return records;
}

export function serializeExperienceTrace(records) {
  validateExperienceTraceRecords(records);
  const lines = records.map((record) => `${canonicalJson(record)}\n`);
  const bytes = Buffer.from(lines.join(""), "utf8");
  if (bytes.length > EXPERIENCE_TRACE_BOUNDS.maxTraceBytes || lines.some((line) => Buffer.byteLength(line, "utf8") > EXPERIENCE_TRACE_BOUNDS.maxLineBytes)) {
    traceBoundsExceeded();
  }
  return bytes.toString("utf8");
}

export function experienceTraceValidationDocument(records) {
  validateExperienceTraceRecords(records);
  const terminal = records.at(-1);
  return {
    kind: VALIDATION_KIND,
    schemaVersion: EXPERIENCE_TRACE_SCHEMA_VERSION,
    valid: true,
    traceId: terminal.traceId,
    streamStatus: terminal.streamStatus,
    evidenceStatus: terminal.evidenceStatus,
    recordCount: terminal.recordCount,
    eventCount: terminal.eventCount,
    traceDigest: terminal.traceDigest,
  };
}
