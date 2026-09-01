import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

export const INPUT_KIND = "better-harness.task-evidence-input";
export const PACKET_KIND = "better-harness.task-evidence-packet";
export const PLAN_KIND = "better-harness.task-evidence-upload-plan";
export const RECEIPT_KIND = "better-harness.task-evidence-upload-receipt";
export const SCHEMA_VERSION = 1;

export const RECEIPT_STATES = Object.freeze(["accepted", "duplicate"]);

export const ASSET_KINDS = Object.freeze(["skill", "mcp", "tool", "hook", "plugin", "agent"]);
export const ASSET_MATCH_STATES = Object.freeze(["exact", "ambiguous", "unresolved"]);
export const ASSET_STAGES = Object.freeze([
  "configured",
  "discovered",
  "selected",
  "invoked",
  "executed",
  "validated",
]);
export const ASSET_OUTCOMES = Object.freeze(["succeeded", "failed", "unobserved"]);
export const ATTRIBUTION_STATES = Object.freeze(["confirmed", "associated", "unknown", "not-applicable"]);
export const ACCEPTANCE_STATES = Object.freeze(["passed", "failed", "unobserved"]);
export const OBSERVATION_KINDS = Object.freeze([
  "validation",
  "human-review",
  "artifact",
  "change",
  "runtime",
]);
export const OBSERVATION_STATES = Object.freeze(["passed", "failed", "observed", "unobserved"]);

export const EXCLUDED_EVIDENCE = Object.freeze([
  "sourceBodies",
  "prompts",
  "transcripts",
  "toolInputs",
  "toolOutputs",
  "credentials",
  "absolutePaths",
]);

const MAX_INPUT_ITEMS = 200;
const MAX_SHORT_TEXT = 512;
const MAX_LONG_TEXT = 4_096;

export class TaskEvidenceUploadError extends Error {
  constructor(code, message, { exitCode = 64, hint } = {}) {
    super(message);
    this.name = "TaskEvidenceUploadError";
    this.code = code;
    this.exitCode = exitCode;
    this.hint = hint;
  }
}

function fail(code, message, options) {
  throw new TaskEvidenceUploadError(code, message, options);
}

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function objectAt(value, pointer) {
  if (!isPlainObject(value)) {
    fail("INVALID_FIELD", `${pointer} must be an object.`);
  }
  return value;
}

function exactKeys(value, pointer, { required = [], optional = [] } = {}) {
  const object = objectAt(value, pointer);
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(object).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    fail("UNKNOWN_FIELD", `${pointer} contains unsupported field: ${unknown.sort()[0]}.`);
  }
  for (const key of required) {
    if (!Object.hasOwn(object, key)) {
      fail("MISSING_FIELD", `${pointer}.${key} is required.`);
    }
  }
  return object;
}

function stringAt(value, pointer, { maximum = MAX_SHORT_TEXT, allowEmpty = false } = {}) {
  if (typeof value !== "string") {
    fail("INVALID_FIELD", `${pointer} must be a string.`);
  }
  const normalized = value.trim();
  if (!allowEmpty && normalized.length === 0) {
    fail("INVALID_FIELD", `${pointer} must not be empty.`);
  }
  if (normalized.length > maximum) {
    fail("FIELD_TOO_LARGE", `${pointer} must contain at most ${maximum} characters.`);
  }
  return normalized;
}

function integerAt(value, pointer, { minimum = 0 } = {}) {
  if (!Number.isInteger(value) || value < minimum) {
    fail("INVALID_FIELD", `${pointer} must be an integer greater than or equal to ${minimum}.`);
  }
  return value;
}

function enumAt(value, pointer, allowed) {
  if (!allowed.includes(value)) {
    fail("UNSUPPORTED_VALUE", `${pointer} must be one of: ${allowed.join(", ")}.`);
  }
  return value;
}

function arrayAt(value, pointer, { maximum = MAX_INPUT_ITEMS } = {}) {
  if (!Array.isArray(value)) {
    fail("INVALID_FIELD", `${pointer} must be an array.`);
  }
  if (value.length > maximum) {
    fail("FIELD_TOO_LARGE", `${pointer} must contain at most ${maximum} items.`);
  }
  return value;
}

function stringArrayAt(value, pointer, sanitizer) {
  return arrayAt(value, pointer).map((entry, index) => (
    sanitizer(stringAt(entry, `${pointer}[${index}]`))
  ));
}

function optionalString(object, key, pointer, sanitizer, options) {
  if (!Object.hasOwn(object, key)) return undefined;
  return sanitizer(stringAt(object[key], `${pointer}.${key}`, options));
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256Digest(value) {
  const source = typeof value === "string" || Buffer.isBuffer(value)
    ? value
    : canonicalJson(value);
  return `sha256:${createHash("sha256").update(source).digest("hex")}`;
}

function replaceAndCount(value, searchValue, replacement, state) {
  return value.replace(searchValue, (...args) => {
    state.count += 1;
    return typeof replacement === "function" ? replacement(...args) : replacement;
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function createEvidenceSanitizer({ workspace, home = os.homedir() } = {}) {
  const state = { count: 0 };
  const pathCandidates = new Set();
  for (const candidate of [workspace, home]) {
    if (typeof candidate !== "string" || candidate.length === 0) continue;
    pathCandidates.add(candidate);
    pathCandidates.add(candidate.replaceAll("\\", "/"));
    pathCandidates.add(candidate.replaceAll("/", "\\"));
  }

  const knownPaths = [...pathCandidates]
    .filter((candidate) => candidate.length > 2)
    .sort((left, right) => right.length - left.length)
    .map((candidate) => new RegExp(escapeRegExp(candidate), "gu"));

  function sanitize(value) {
    let output = value;
    for (const pattern of knownPaths) {
      output = replaceAndCount(output, pattern, "<private-path>", state);
    }

    output = replaceAndCount(
      output,
      /\bBearer\s+[A-Za-z0-9._~+/-]{8,}={0,2}\b/giu,
      "Bearer <redacted>",
      state,
    );
    output = replaceAndCount(
      output,
      /\b(?:sk|ghp|glpat|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/giu,
      "<redacted-credential>",
      state,
    );
    output = replaceAndCount(
      output,
      /\b(api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password)\s*[:=]\s*([^\s,;"']+)/giu,
      (match, key) => `${key}=<redacted>`,
      state,
    );
    output = replaceAndCount(
      output,
      /\bhttps?:\/\/[^/\s:@]+:[^@\s/]+@/giu,
      (match) => `${match.slice(0, match.indexOf("://") + 3)}<redacted>@`,
      state,
    );
    output = replaceAndCount(
      output,
      /(^|[\s("'=])(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/])(?:[^\s"'<>]|\\ )+/gmu,
      (match, prefix) => `${prefix}<absolute-path>`,
      state,
    );
    output = replaceAndCount(
      output,
      /(^|[\s("'=])\/(?!\/)(?:[^\s"'<>]|\\ )+/gmu,
      (match, prefix) => `${prefix}<absolute-path>`,
      state,
    );
    return output;
  }

  return {
    sanitize,
    get redactionCount() {
      return state.count;
    },
  };
}

function normalizeAcceptance(value, pointer, sanitizer) {
  const object = exactKeys(value, pointer, {
    required: ["id", "status", "summary"],
  });
  return {
    id: sanitizer(stringAt(object.id, `${pointer}.id`, { maximum: 128 })),
    status: enumAt(object.status, `${pointer}.status`, ACCEPTANCE_STATES),
    summary: sanitizer(stringAt(object.summary, `${pointer}.summary`, { maximum: MAX_LONG_TEXT })),
  };
}

function normalizeTask(value, pointer, sanitizer) {
  const object = exactKeys(value, pointer, {
    required: ["id", "title", "intent", "acceptance"],
    optional: ["scope", "nonGoals"],
  });
  return {
    id: sanitizer(stringAt(object.id, `${pointer}.id`, { maximum: 128 })),
    title: sanitizer(stringAt(object.title, `${pointer}.title`)),
    intent: sanitizer(stringAt(object.intent, `${pointer}.intent`, { maximum: MAX_LONG_TEXT })),
    scope: Object.hasOwn(object, "scope")
      ? stringArrayAt(object.scope, `${pointer}.scope`, sanitizer)
      : [],
    nonGoals: Object.hasOwn(object, "nonGoals")
      ? stringArrayAt(object.nonGoals, `${pointer}.nonGoals`, sanitizer)
      : [],
    acceptance: arrayAt(object.acceptance, `${pointer}.acceptance`)
      .map((entry, index) => normalizeAcceptance(entry, `${pointer}.acceptance[${index}]`, sanitizer)),
  };
}

function normalizeAsset(value, pointer, sanitizer) {
  const object = exactKeys(value, pointer, {
    required: ["kind", "id", "match", "stage", "outcome"],
    optional: ["publisher", "revision", "attribution", "summary"],
  });
  const outcome = enumAt(object.outcome, `${pointer}.outcome`, ASSET_OUTCOMES);
  const attribution = Object.hasOwn(object, "attribution")
    ? enumAt(object.attribution, `${pointer}.attribution`, ATTRIBUTION_STATES)
    : outcome === "failed" ? "unknown" : "not-applicable";
  if (outcome === "failed" && attribution === "not-applicable") {
    fail("INVALID_ATTRIBUTION", `${pointer}.attribution must preserve confirmed, associated, or unknown failure attribution.`);
  }
  if (outcome !== "failed" && attribution !== "not-applicable") {
    fail("INVALID_ATTRIBUTION", `${pointer}.attribution must be not-applicable when the asset outcome is not failed.`);
  }
  return {
    kind: enumAt(object.kind, `${pointer}.kind`, ASSET_KINDS),
    id: sanitizer(stringAt(object.id, `${pointer}.id`)),
    ...(Object.hasOwn(object, "publisher")
      ? { publisher: optionalString(object, "publisher", pointer, sanitizer) }
      : {}),
    ...(Object.hasOwn(object, "revision")
      ? { revision: optionalString(object, "revision", pointer, sanitizer) }
      : {}),
    match: enumAt(object.match, `${pointer}.match`, ASSET_MATCH_STATES),
    stage: enumAt(object.stage, `${pointer}.stage`, ASSET_STAGES),
    outcome,
    attribution,
    ...(Object.hasOwn(object, "summary")
      ? { summary: optionalString(object, "summary", pointer, sanitizer, { maximum: MAX_LONG_TEXT }) }
      : {}),
  };
}

function normalizeObservation(value, pointer, sanitizer) {
  const object = exactKeys(value, pointer, {
    required: ["kind", "status", "summary"],
    optional: ["evidenceRef"],
  });
  return {
    kind: enumAt(object.kind, `${pointer}.kind`, OBSERVATION_KINDS),
    status: enumAt(object.status, `${pointer}.status`, OBSERVATION_STATES),
    summary: sanitizer(stringAt(object.summary, `${pointer}.summary`, { maximum: MAX_LONG_TEXT })),
    ...(Object.hasOwn(object, "evidenceRef")
      ? { evidenceRef: optionalString(object, "evidenceRef", pointer, sanitizer) }
      : {}),
  };
}

function normalizeInput(input, sanitizer) {
  const object = exactKeys(input, "input", {
    required: ["kind", "schemaVersion", "task"],
    optional: ["assets", "observations"],
  });
  if (object.kind !== INPUT_KIND) {
    fail("UNSUPPORTED_INPUT_KIND", `input.kind must be ${INPUT_KIND}.`);
  }
  if (object.schemaVersion !== SCHEMA_VERSION) {
    fail("UNSUPPORTED_SCHEMA_VERSION", `input.schemaVersion must be ${SCHEMA_VERSION}.`);
  }
  return {
    task: normalizeTask(object.task, "input.task", sanitizer),
    assets: Object.hasOwn(object, "assets")
      ? arrayAt(object.assets, "input.assets")
        .map((entry, index) => normalizeAsset(entry, `input.assets[${index}]`, sanitizer))
      : [],
    observations: Object.hasOwn(object, "observations")
      ? arrayAt(object.observations, "input.observations")
        .map((entry, index) => normalizeObservation(entry, `input.observations[${index}]`, sanitizer))
      : [],
  };
}

function countBy(values, allowed) {
  const counts = Object.fromEntries(allowed.map((value) => [value, 0]));
  for (const value of values) counts[value] += 1;
  return { total: values.length, ...counts };
}

function packetCoverage({ task, assets, observations }) {
  return {
    acceptance: countBy(task.acceptance.map((entry) => entry.status), ACCEPTANCE_STATES),
    assetMatches: countBy(assets.map((entry) => entry.match), ASSET_MATCH_STATES),
    assetOutcomes: countBy(assets.map((entry) => entry.outcome), ASSET_OUTCOMES),
    observations: countBy(observations.map((entry) => entry.status), OBSERVATION_STATES),
  };
}

function normalizeTimestamp(value, pointer) {
  const timestamp = value instanceof Date ? value.toISOString() : stringAt(value, pointer, { maximum: 64 });
  if (Number.isNaN(Date.parse(timestamp)) || new Date(timestamp).toISOString() !== timestamp) {
    fail("INVALID_TIMESTAMP", `${pointer} must be an ISO 8601 UTC timestamp.`);
  }
  return timestamp;
}

function safeWorkspaceLabel(value, sanitizer) {
  return sanitizer(stringAt(value, "workspaceLabel", { maximum: 128 }));
}

export function createTaskEvidencePacket(input, {
  workspace = process.cwd(),
  workspaceLabel,
  now = new Date(),
  home = os.homedir(),
} = {}) {
  const resolvedWorkspace = path.resolve(workspace);
  const sanitizer = createEvidenceSanitizer({ workspace: resolvedWorkspace, home });
  const normalized = normalizeInput(input, sanitizer.sanitize);
  const label = safeWorkspaceLabel(
    workspaceLabel ?? (path.basename(resolvedWorkspace) || "workspace"),
    sanitizer.sanitize,
  );
  const packet = {
    kind: PACKET_KIND,
    schemaVersion: SCHEMA_VERSION,
    generatedAt: normalizeTimestamp(now, "generatedAt"),
    workspace: { label },
    task: normalized.task,
    assets: normalized.assets,
    observations: normalized.observations,
    coverage: packetCoverage(normalized),
    privacy: {
      profile: "task-evidence-minimal",
      redactions: sanitizer.redactionCount,
      excludedEvidence: [...EXCLUDED_EVIDENCE],
    },
  };
  validateTaskEvidencePacket(packet);
  return packet;
}

function sanitizedStringAt(value, pointer, options) {
  const normalized = stringAt(value, pointer, options);
  const sanitizer = createEvidenceSanitizer({ workspace: undefined, home: undefined });
  const sanitized = sanitizer.sanitize(normalized);
  if (sanitized !== normalized) {
    fail("UNSAFE_PACKET_VALUE", `${pointer} contains a credential or absolute path.`);
  }
  return normalized;
}

function validatePacketTask(value, pointer) {
  const object = exactKeys(value, pointer, {
    required: ["id", "title", "intent", "scope", "nonGoals", "acceptance"],
  });
  const identity = (entry, entryPointer, options) => sanitizedStringAt(entry, entryPointer, options);
  return normalizeTask(object, pointer, identity);
}

function validatePacketAsset(value, pointer) {
  const object = exactKeys(value, pointer, {
    required: ["kind", "id", "match", "stage", "outcome", "attribution"],
    optional: ["publisher", "revision", "summary"],
  });
  const identity = (entry, entryPointer, options) => sanitizedStringAt(entry, entryPointer, options);
  return normalizeAsset(object, pointer, identity);
}

function validatePacketObservation(value, pointer) {
  const identity = (entry, entryPointer, options) => sanitizedStringAt(entry, entryPointer, options);
  return normalizeObservation(value, pointer, identity);
}

function assertCanonicalEqual(actual, expected, pointer) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail("INVALID_PLAN", `${pointer} does not match the derived contract.`);
  }
}

export function validateTaskEvidencePacket(packet) {
  const object = exactKeys(packet, "packet", {
    required: [
      "kind",
      "schemaVersion",
      "generatedAt",
      "workspace",
      "task",
      "assets",
      "observations",
      "coverage",
      "privacy",
    ],
  });
  if (object.kind !== PACKET_KIND) fail("INVALID_PLAN", `packet.kind must be ${PACKET_KIND}.`);
  if (object.schemaVersion !== SCHEMA_VERSION) {
    fail("INVALID_PLAN", `packet.schemaVersion must be ${SCHEMA_VERSION}.`);
  }
  normalizeTimestamp(object.generatedAt, "packet.generatedAt");
  const workspace = exactKeys(object.workspace, "packet.workspace", { required: ["label"] });
  sanitizedStringAt(workspace.label, "packet.workspace.label", { maximum: 128 });
  const task = validatePacketTask(object.task, "packet.task");
  const assets = arrayAt(object.assets, "packet.assets")
    .map((entry, index) => validatePacketAsset(entry, `packet.assets[${index}]`));
  const observations = arrayAt(object.observations, "packet.observations")
    .map((entry, index) => validatePacketObservation(entry, `packet.observations[${index}]`));
  assertCanonicalEqual(object.coverage, packetCoverage({ task, assets, observations }), "packet.coverage");
  const privacy = exactKeys(object.privacy, "packet.privacy", {
    required: ["profile", "redactions", "excludedEvidence"],
  });
  if (privacy.profile !== "task-evidence-minimal") {
    fail("INVALID_PLAN", "packet.privacy.profile must be task-evidence-minimal.");
  }
  integerAt(privacy.redactions, "packet.privacy.redactions");
  assertCanonicalEqual(privacy.excludedEvidence, EXCLUDED_EVIDENCE, "packet.privacy.excludedEvidence");
  return packet;
}

export function normalizeDestination(value) {
  const source = stringAt(value, "destination", { maximum: 2_048 });
  let destination;
  try {
    destination = new URL(source);
  } catch {
    fail("INVALID_DESTINATION", "--destination must be an absolute HTTPS URL.");
  }
  if (destination.username || destination.password || destination.search || destination.hash) {
    fail("INVALID_DESTINATION", "--destination must not contain credentials, query parameters, or a fragment.");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(destination.hostname);
  if (destination.protocol !== "https:" && !(destination.protocol === "http:" && loopback)) {
    fail("INVALID_DESTINATION", "--destination must use HTTPS, except for a loopback HTTP endpoint.");
  }
  return destination.toString();
}

function normalizeOrganization(value) {
  const organization = stringAt(value, "organization", { maximum: 128 });
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(organization)) {
    fail(
      "INVALID_ORGANIZATION",
      "--organization must start with an alphanumeric character and use only letters, numbers, ., _, :, or -.",
    );
  }
  return organization;
}

export function createUploadPlan({
  input,
  destination,
  organization,
  workspace = process.cwd(),
  workspaceLabel,
  localWrite = false,
  now = new Date(),
  home = os.homedir(),
}) {
  const createdAt = normalizeTimestamp(now, "createdAt");
  const packet = createTaskEvidencePacket(input, {
    workspace,
    workspaceLabel,
    now: createdAt,
    home,
  });
  const packetJson = canonicalJson(packet);
  const body = {
    kind: PLAN_KIND,
    schemaVersion: SCHEMA_VERSION,
    createdAt,
    state: "prepared",
    effects: {
      localWrite: Boolean(localWrite),
      network: "none",
      remoteMutation: false,
    },
    destination: {
      endpoint: normalizeDestination(destination),
      organization: normalizeOrganization(organization),
    },
    packetDigest: sha256Digest(packetJson),
    packetBytes: Buffer.byteLength(packetJson, "utf8"),
    packet,
  };
  const plan = { ...body, planDigest: sha256Digest(body) };
  validateUploadPlan(plan);
  return plan;
}

export function validateUploadPlan(plan) {
  const object = exactKeys(plan, "plan", {
    required: [
      "kind",
      "schemaVersion",
      "createdAt",
      "state",
      "effects",
      "destination",
      "packetDigest",
      "packetBytes",
      "packet",
      "planDigest",
    ],
  });
  if (object.kind !== PLAN_KIND) fail("INVALID_PLAN", `plan.kind must be ${PLAN_KIND}.`);
  if (object.schemaVersion !== SCHEMA_VERSION) {
    fail("INVALID_PLAN", `plan.schemaVersion must be ${SCHEMA_VERSION}.`);
  }
  normalizeTimestamp(object.createdAt, "plan.createdAt");
  if (object.state !== "prepared") fail("INVALID_PLAN", "plan.state must be prepared.");
  const effects = exactKeys(object.effects, "plan.effects", {
    required: ["localWrite", "network", "remoteMutation"],
  });
  if (typeof effects.localWrite !== "boolean" || effects.network !== "none" || effects.remoteMutation !== false) {
    fail("INVALID_PLAN", "plan.effects must describe a local-only preparation step.");
  }
  const destination = exactKeys(object.destination, "plan.destination", {
    required: ["endpoint", "organization"],
  });
  if (normalizeDestination(destination.endpoint) !== destination.endpoint) {
    fail("INVALID_PLAN", "plan.destination.endpoint must use its normalized URL form.");
  }
  normalizeOrganization(destination.organization);
  validateTaskEvidencePacket(object.packet);
  if (object.packet.generatedAt !== object.createdAt) {
    fail("INVALID_PLAN", "plan.packet.generatedAt must equal plan.createdAt.");
  }
  const packetJson = canonicalJson(object.packet);
  const expectedPacketBytes = Buffer.byteLength(packetJson, "utf8");
  if (integerAt(object.packetBytes, "plan.packetBytes") !== expectedPacketBytes) {
    fail("PLAN_INTEGRITY_FAILED", "plan.packetBytes does not match the embedded packet.");
  }
  if (object.packetDigest !== sha256Digest(packetJson)) {
    fail("PLAN_INTEGRITY_FAILED", "plan.packetDigest does not match the embedded packet.");
  }
  const { planDigest, ...body } = object;
  if (planDigest !== sha256Digest(body)) {
    fail("PLAN_INTEGRITY_FAILED", "plan.planDigest does not match the plan body.");
  }
  return plan;
}

export function normalizeReceiptId(value) {
  const receiptId = stringAt(value, "receipt.receiptId", { maximum: 128 });
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(receiptId)) {
    fail(
      "INVALID_RECEIPT",
      "receipt.receiptId must start with an alphanumeric character and use only letters, numbers, ., _, :, or -.",
    );
  }
  return receiptId;
}

function digestAt(value, pointer) {
  const digest = stringAt(value, pointer, { maximum: 128 });
  if (!/^sha256:[0-9a-f]{64}$/u.test(digest)) {
    fail("INVALID_RECEIPT", `${pointer} must be a lowercase sha256 digest.`);
  }
  return digest;
}

export function createUploadReceipt({ plan, receiptId, state = "accepted", now = new Date() }) {
  validateUploadPlan(plan);
  const body = {
    kind: RECEIPT_KIND,
    schemaVersion: SCHEMA_VERSION,
    acceptedAt: normalizeTimestamp(now, "receipt.acceptedAt"),
    state: enumAt(state, "receipt.state", RECEIPT_STATES),
    destination: {
      endpoint: plan.destination.endpoint,
      organization: plan.destination.organization,
    },
    receiptId: normalizeReceiptId(receiptId),
    packetDigest: plan.packetDigest,
    planDigest: plan.planDigest,
  };
  return { ...body, receiptDigest: sha256Digest(body) };
}

export function validateUploadReceipt(receipt, { plan } = {}) {
  const object = exactKeys(receipt, "receipt", {
    required: [
      "kind",
      "schemaVersion",
      "acceptedAt",
      "state",
      "destination",
      "receiptId",
      "packetDigest",
      "planDigest",
      "receiptDigest",
    ],
  });
  if (object.kind !== RECEIPT_KIND) fail("INVALID_RECEIPT", `receipt.kind must be ${RECEIPT_KIND}.`);
  if (object.schemaVersion !== SCHEMA_VERSION) {
    fail("INVALID_RECEIPT", `receipt.schemaVersion must be ${SCHEMA_VERSION}.`);
  }
  normalizeTimestamp(object.acceptedAt, "receipt.acceptedAt");
  enumAt(object.state, "receipt.state", RECEIPT_STATES);
  const destination = exactKeys(object.destination, "receipt.destination", {
    required: ["endpoint", "organization"],
  });
  if (normalizeDestination(destination.endpoint) !== destination.endpoint) {
    fail("INVALID_RECEIPT", "receipt.destination.endpoint must use its normalized URL form.");
  }
  normalizeOrganization(destination.organization);
  normalizeReceiptId(object.receiptId);
  digestAt(object.packetDigest, "receipt.packetDigest");
  digestAt(object.planDigest, "receipt.planDigest");
  const { receiptDigest, ...body } = object;
  if (receiptDigest !== sha256Digest(body)) {
    fail("RECEIPT_INTEGRITY_FAILED", "receipt.receiptDigest does not match the receipt body.");
  }
  if (plan) {
    if (object.packetDigest !== plan.packetDigest) {
      fail("RECEIPT_MISMATCH", "receipt.packetDigest does not match the applied plan.");
    }
    if (object.planDigest !== plan.planDigest) {
      fail("RECEIPT_MISMATCH", "receipt.planDigest does not match the applied plan.");
    }
    if (object.destination.endpoint !== plan.destination.endpoint) {
      fail("RECEIPT_MISMATCH", "receipt.destination.endpoint does not match the applied plan.");
    }
    if (object.destination.organization !== plan.destination.organization) {
      fail("RECEIPT_MISMATCH", "receipt.destination.organization does not match the applied plan.");
    }
  }
  return receipt;
}

// A packet digest is content-addressed, so it doubles as the storage key and
// the idempotency key for a repeated apply of the same prepared plan.
export function packetStorageKey(packetDigest) {
  return digestAt(packetDigest, "plan.packetDigest").slice("sha256:".length);
}
