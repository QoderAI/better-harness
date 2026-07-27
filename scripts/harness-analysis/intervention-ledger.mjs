import { scanText } from "../agent-guardrails/secret-scan.mjs";

export const INTERVENTION_LEDGER_SCHEMA_VERSION = 1;

export const HARNESS_INTERVENTION_ASSET_TYPES = Object.freeze([
  "memory",
  "repository-knowledge",
  "rule",
  "skill",
  "hook",
  "gate",
  "agent",
  "workflow",
  "eval",
]);

export const INTERVENTION_CAUSE_KINDS = Object.freeze([
  "harness",
  "repository",
  "model-capability",
  "requirements",
  "external-system",
  "task-complexity",
]);

export const INTERVENTION_RESULT_STATES = Object.freeze([
  "pending",
  "improving",
  "unchanged",
  "regressing",
  "outcome-supported",
]);

const METRIC_DIRECTIONS = new Set(["higher-is-better", "lower-is-better"]);
const COMPARABILITY_STATES = new Set(["comparable", "unverified", "not-comparable"]);
const COMPARABLE_SELECTION_STRATEGIES = new Set(["all-eligible", "stratified"]);
const RAW_FIELD_RE = /(?:^|_)(?:raw_?)?(?:prompt|command|content|transcript|user_?text|assistant_?text)$/i;
const PRIVATE_IDENTIFIER_FIELD_RE = /^(?:session_?id|absolute_?path)$/i;
const EMBEDDED_POSIX_PATH_RE = /(?:^|[\s"'`([{:;,=])\/(?!\/)(?:[^/\s"'`(){}\[\],;:]+\/)+[^/\s"'`(){}\[\],;:]+/u;
const EMBEDDED_WINDOWS_PATH_RE = /(?:^|[\s"'`([{:;,=])[A-Za-z]:[\\/](?:[^\\/\s"'`(){}\[\],;:]+[\\/])+[^\\/\s"'`(){}\[\],;:]+/u;
const EMBEDDED_UNC_PATH_RE = /(?:^|[\s"'`([{:;,=])\\\\[^\\/\s"'`(){}\[\],;:]+[\\/][^\s"'`(){}\[\],;:]+/u;
const TRAVERSAL_PATH_RE = /(?:^|[\\/])\.\.(?:[\\/]|$)/u;
const ROLE_IDENTIFIER_RE = /^[\p{L}\p{N}][\p{L}\p{N}._/-]{1,79}$/u;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasRawField(value, location = "interventionLedger") {
  if (Array.isArray(value)) return value.flatMap((item, index) => hasRawField(item, `${location}[${index}]`));
  if (!isObject(value)) return [];
  const errors = [];
  for (const [key, child] of Object.entries(value)) {
    if (RAW_FIELD_RE.test(key) && typeof child === "string" && child.trim()) {
      errors.push(`${location}.${key} must not contain raw transcript or command content`);
    }
    errors.push(...hasRawField(child, `${location}.${key}`));
  }
  return errors;
}

function privacyErrors(value, location = "interventionLedger", field = "") {
  if (Array.isArray(value)) return value.flatMap((item, index) => privacyErrors(item, `${location}[${index}]`, field));
  if (isObject(value)) {
    return Object.entries(value).flatMap(([key, child]) => {
      const errors = PRIVATE_IDENTIFIER_FIELD_RE.test(key)
        ? [`${location}.${key} must not contain a private session id or absolute path`]
        : [];
      return [...errors, ...privacyErrors(child, `${location}.${key}`, key)];
    });
  }
  if (typeof value !== "string") return [];
  const errors = [];
  if (
    EMBEDDED_POSIX_PATH_RE.test(value)
    || EMBEDDED_WINDOWS_PATH_RE.test(value)
    || EMBEDDED_UNC_PATH_RE.test(value)
    || TRAVERSAL_PATH_RE.test(value)
  ) {
    errors.push(`${location} must not contain an absolute or traversal path`);
  }
  if (scanText(value, { file: "<intervention-ledger>", redact: true }).length > 0) {
    errors.push(`${location} must not contain a credential-shaped value`);
  }
  if (/path$/iu.test(field) && !value.trim()) errors.push(`${location} must not contain an empty path`);
  return errors;
}

function validateMetric(metric, location) {
  if (!isObject(metric)) return [`${location} must be an object`];
  const errors = [];
  for (const field of Object.keys(metric)) {
    if (!["id", "direction", "unit"].includes(field)) errors.push(`${location} has unsupported field: ${field}`);
  }
  if (!hasText(metric.id)) errors.push(`${location}.id must be a non-empty string`);
  if (!METRIC_DIRECTIONS.has(metric.direction)) errors.push(`${location}.direction must be higher-is-better or lower-is-better`);
  if (metric.unit !== undefined && !hasText(metric.unit)) errors.push(`${location}.unit must be a non-empty string when supplied`);
  return errors;
}

function validateBaseline(baseline, location) {
  if (!isObject(baseline)) return [`${location} must be an object`];
  const errors = [];
  for (const field of Object.keys(baseline)) {
    if (!["windowRef", "primaryValue", "guardrailValue", "evidenceRefs"].includes(field)) errors.push(`${location} has unsupported field: ${field}`);
  }
  if (!hasText(baseline.windowRef)) errors.push(`${location}.windowRef must be a non-empty string`);
  for (const field of ["primaryValue", "guardrailValue"]) {
    if (!Number.isFinite(baseline[field])) errors.push(`${location}.${field} must be a finite number`);
  }
  if (!Array.isArray(baseline.evidenceRefs) || baseline.evidenceRefs.length === 0) errors.push(`${location}.evidenceRefs must be a non-empty array`);
  return errors;
}

function validateComparisonWindow(window, location) {
  if (!isObject(window)) return [`${location} must be an object`];
  const errors = [];
  for (const field of Object.keys(window)) {
    if (!["laterWindowRef", "scope", "taskMix", "selectionStrategy"].includes(field)) errors.push(`${location} has unsupported field: ${field}`);
  }
  if (!hasText(window.laterWindowRef)) errors.push(`${location}.laterWindowRef must be a non-empty string`);
  if (!hasText(window.scope)) errors.push(`${location}.scope must be a non-empty string`);
  if (!COMPARABILITY_STATES.has(window.taskMix)) errors.push(`${location}.taskMix must be comparable, unverified, or not-comparable`);
  if (!COMPARABLE_SELECTION_STRATEGIES.has(window.selectionStrategy)) {
    errors.push(`${location}.selectionStrategy must be all-eligible or stratified`);
  }
  return errors;
}

function comparisonIsComparable(entry) {
  return entry?.comparisonWindow?.taskMix === "comparable"
    && COMPARABLE_SELECTION_STRATEGIES.has(entry?.comparisonWindow?.selectionStrategy);
}

function primaryImproved(entry) {
  const before = entry?.baseline?.primaryValue;
  const after = entry?.result?.primaryValue;
  return entry?.primaryMetric?.direction === "higher-is-better" ? after > before : after < before;
}

function primaryUnchanged(entry) {
  return entry?.result?.primaryValue === entry?.baseline?.primaryValue;
}

function primaryWorsened(entry) {
  const before = entry?.baseline?.primaryValue;
  const after = entry?.result?.primaryValue;
  return entry?.primaryMetric?.direction === "higher-is-better" ? after < before : after > before;
}

function guardrailWorsened(entry) {
  const before = entry?.baseline?.guardrailValue;
  const after = entry?.result?.guardrailValue;
  return entry?.guardrailMetric?.direction === "higher-is-better" ? after < before : after > before;
}

function validComparison(entry) {
  const result = entry?.result ?? {};
  return result.state !== "pending"
    && comparisonIsComparable(entry)
    && Number.isFinite(entry?.baseline?.primaryValue)
    && Number.isFinite(entry?.baseline?.guardrailValue)
    && Number.isFinite(result.primaryValue)
    && Number.isFinite(result.guardrailValue)
    && Array.isArray(entry?.baseline?.evidenceRefs) && entry.baseline.evidenceRefs.length > 0
    && Array.isArray(result.evidenceRefs) && result.evidenceRefs.length > 0;
}

function validateResult(entry, location) {
  const result = entry?.result;
  if (!isObject(result)) return [`${location} must be an object`];
  const errors = [];
  for (const field of Object.keys(result)) {
    if (!["state", "primaryValue", "guardrailValue", "evidenceRefs", "outcomeEvidenceRefs", "effectiveness"].includes(field)) {
      errors.push(`${location} has unsupported field: ${field}`);
    }
  }
  if (!INTERVENTION_RESULT_STATES.includes(result.state)) errors.push(`${location}.state has unsupported value: ${result.state}`);
  if (result.state === "pending") {
    for (const field of ["primaryValue", "guardrailValue", "effectiveness"]) {
      if (result[field] !== undefined) errors.push(`${location}.${field} is not allowed while result is pending`);
    }
    return errors;
  }
  for (const field of ["primaryValue", "guardrailValue"]) {
    if (!Number.isFinite(result[field])) errors.push(`${location}.${field} must be a finite number for a comparison result`);
  }
  if (!Array.isArray(result.evidenceRefs) || result.evidenceRefs.length === 0) errors.push(`${location}.evidenceRefs must be a non-empty array for a comparison result`);
  if (!validComparison(entry)) errors.push(`${location} needs comparable before/after windows, all-eligible or stratified selection, and evidence before reporting a result`);
  if (result.state === "improving" && (!primaryImproved(entry) || guardrailWorsened(entry))) {
    errors.push(`${location}.state improving must improve the primary metric without worsening the guardrail`);
  }
  if (result.state === "unchanged" && (!primaryUnchanged(entry) || guardrailWorsened(entry))) {
    errors.push(`${location}.state unchanged must preserve the primary metric without worsening the guardrail`);
  }
  if (result.state === "regressing" && !guardrailWorsened(entry) && !primaryWorsened(entry)) {
    errors.push(`${location}.state regressing requires a worse primary or guardrail metric`);
  }
  if (result.state === "outcome-supported") {
    if (!primaryImproved(entry) || guardrailWorsened(entry)) {
      errors.push(`${location}.state outcome-supported must improve the primary metric without worsening the guardrail`);
    }
    if (!Array.isArray(result.outcomeEvidenceRefs) || result.outcomeEvidenceRefs.length === 0) {
      errors.push(`${location}.outcomeEvidenceRefs must be a non-empty array for outcome-supported`);
    }
  }
  if (result.effectiveness !== undefined && result.effectiveness !== "Effective") {
    errors.push(`${location}.effectiveness may only be Effective when supplied`);
  }
  if (result.effectiveness === "Effective" && result.state !== "outcome-supported") {
    errors.push(`${location}.effectiveness Effective requires outcome-supported evidence`);
  }
  return errors;
}

export function validateInterventionLedgerEntry(entry, location = "interventionLedger") {
  if (!isObject(entry)) return [`${location} must be an object`];
  const errors = [];
  const allowed = new Set([
    "id", "schemaVersion", "episodeRef", "frictionRefs", "candidateCauses", "asset", "owner",
    "baseline", "primaryMetric", "guardrailMetric", "comparisonWindow", "validation", "stopOrRevertCondition", "result",
  ]);
  for (const field of Object.keys(entry)) {
    if (!allowed.has(field)) errors.push(`${location} has unsupported field: ${field}`);
  }
  for (const field of ["id", "schemaVersion", "frictionRefs", "candidateCauses", "asset", "owner", "baseline", "primaryMetric", "guardrailMetric", "comparisonWindow", "validation", "stopOrRevertCondition", "result"]) {
    if (entry[field] === undefined || entry[field] === null || entry[field] === "") errors.push(`${location} missing ${field}`);
  }
  if (!hasText(entry.id)) errors.push(`${location}.id must be a non-empty string`);
  if (entry.schemaVersion !== INTERVENTION_LEDGER_SCHEMA_VERSION) errors.push(`${location}.schemaVersion must be ${INTERVENTION_LEDGER_SCHEMA_VERSION}`);
  if (entry.episodeRef !== undefined && !hasText(entry.episodeRef)) errors.push(`${location}.episodeRef must be a non-empty string when supplied`);
  if (!Array.isArray(entry.frictionRefs) || entry.frictionRefs.length === 0) errors.push(`${location}.frictionRefs must be a non-empty array`);
  if (!Array.isArray(entry.candidateCauses) || entry.candidateCauses.length < 2) {
    errors.push(`${location}.candidateCauses must contain at least two evidence-labelled candidate causes`);
  } else {
    for (const [index, cause] of entry.candidateCauses.entries()) {
      const prefix = `${location}.candidateCauses[${index}]`;
      if (!isObject(cause)) {
        errors.push(`${prefix} must be an object`);
        continue;
      }
      for (const field of Object.keys(cause)) {
        if (!["kind", "state", "evidenceRefs"].includes(field)) errors.push(`${prefix} has unsupported field: ${field}`);
      }
      if (!INTERVENTION_CAUSE_KINDS.includes(cause.kind)) errors.push(`${prefix}.kind has unsupported value: ${cause.kind}`);
      if (!new Set(["candidate", "supported", "unobserved"]).has(cause.state)) errors.push(`${prefix}.state has unsupported value: ${cause.state}`);
      if (!Array.isArray(cause.evidenceRefs) || cause.evidenceRefs.length === 0) errors.push(`${prefix}.evidenceRefs must be a non-empty array`);
    }
  }
  if (!isObject(entry.asset)) {
    errors.push(`${location}.asset must be an object`);
  } else {
    for (const field of Object.keys(entry.asset)) {
      if (!["type", "label"].includes(field)) errors.push(`${location}.asset has unsupported field: ${field}`);
    }
    if (!HARNESS_INTERVENTION_ASSET_TYPES.includes(entry.asset.type)) errors.push(`${location}.asset.type has unsupported value: ${entry.asset.type}`);
    if (entry.asset.label !== undefined && !hasText(entry.asset.label)) errors.push(`${location}.asset.label must be a non-empty string when supplied`);
  }
  if (!hasText(entry.owner) || !ROLE_IDENTIFIER_RE.test(entry.owner)) errors.push(`${location}.owner must be a reader-safe role identifier`);
  errors.push(...validateBaseline(entry.baseline, `${location}.baseline`));
  errors.push(...validateMetric(entry.primaryMetric, `${location}.primaryMetric`));
  errors.push(...validateMetric(entry.guardrailMetric, `${location}.guardrailMetric`));
  if (entry.primaryMetric?.id === entry.guardrailMetric?.id) errors.push(`${location} primary and guardrail metrics must be distinct`);
  errors.push(...validateComparisonWindow(entry.comparisonWindow, `${location}.comparisonWindow`));
  if (!isObject(entry.validation)) {
    errors.push(`${location}.validation must be an object`);
  } else {
    for (const field of Object.keys(entry.validation)) {
      if (!["method", "evidenceRefs"].includes(field)) errors.push(`${location}.validation has unsupported field: ${field}`);
    }
    if (!hasText(entry.validation.method)) errors.push(`${location}.validation.method must be a non-empty string`);
    if (!Array.isArray(entry.validation.evidenceRefs) || entry.validation.evidenceRefs.length === 0) errors.push(`${location}.validation.evidenceRefs must be a non-empty array`);
  }
  if (!hasText(entry.stopOrRevertCondition)) errors.push(`${location}.stopOrRevertCondition must be a non-empty string`);
  errors.push(...validateResult(entry, `${location}.result`));
  errors.push(...hasRawField(entry, location));
  errors.push(...privacyErrors(entry, location));
  return errors;
}

export function validateInterventionLedger(entries = []) {
  if (!Array.isArray(entries)) return ["interventionLedger must be an array"];
  const errors = entries.flatMap((entry, index) => validateInterventionLedgerEntry(entry, `interventionLedger[${index}]`));
  const ids = entries.map((entry) => String(entry?.id ?? "")).filter(Boolean);
  if (new Set(ids).size !== ids.length) errors.push("interventionLedger ids must be unique");
  return errors;
}

export function hasValidInterventionComparison(entry) {
  return validComparison(entry) && validateInterventionLedgerEntry(entry).length === 0;
}

function readerEntry(entry) {
  const validComparison = hasValidInterventionComparison(entry);
  const result = entry.result;
  return {
    id: entry.id,
    schemaVersion: entry.schemaVersion,
    ...(entry.episodeRef ? { episodeRef: entry.episodeRef } : {}),
    frictionRefs: entry.frictionRefs,
    candidateCauses: entry.candidateCauses.map((cause) => ({
      kind: cause.kind,
      state: cause.state,
      evidenceRefs: cause.evidenceRefs,
    })),
    asset: {
      type: entry.asset.type,
      ...(entry.asset.label ? { label: entry.asset.label } : {}),
    },
    owner: entry.owner,
    baseline: {
      ...entry.baseline,
      evidenceRefs: [...entry.baseline.evidenceRefs],
    },
    primaryMetric: { ...entry.primaryMetric },
    guardrailMetric: { ...entry.guardrailMetric },
    comparisonWindow: { ...entry.comparisonWindow },
    result: {
      ...entry.result,
      ...(entry.result.evidenceRefs ? { evidenceRefs: [...entry.result.evidenceRefs] } : {}),
      ...(entry.result.outcomeEvidenceRefs ? { outcomeEvidenceRefs: [...entry.result.outcomeEvidenceRefs] } : {}),
    },
    comparison: {
      state: result.state,
      valid: validComparison,
      taskMix: entry.comparisonWindow.taskMix,
      ...(validComparison ? { effectiveness: result.effectiveness === "Effective" ? "Effective" : "Not demonstrated" } : {}),
    },
    validation: { method: entry.validation.method, evidenceRefs: entry.validation.evidenceRefs },
    stopOrRevertCondition: entry.stopOrRevertCondition,
  };
}

export function restoreProjectedInterventionLedger(entries = []) {
  if (!Array.isArray(entries)) return [];
  const restored = entries.map((entry) => ({
    id: entry?.id,
    schemaVersion: entry?.schemaVersion,
    ...(entry?.episodeRef ? { episodeRef: entry.episodeRef } : {}),
    frictionRefs: entry?.frictionRefs,
    candidateCauses: entry?.candidateCauses,
    asset: entry?.asset,
    owner: entry?.owner,
    baseline: entry?.baseline,
    primaryMetric: entry?.primaryMetric,
    guardrailMetric: entry?.guardrailMetric,
    comparisonWindow: entry?.comparisonWindow,
    validation: entry?.validation,
    stopOrRevertCondition: entry?.stopOrRevertCondition,
    result: entry?.result,
  }));
  return validateInterventionLedger(restored).length === 0 ? restored : [];
}

export function projectInterventionLedger(entries = []) {
  const errors = validateInterventionLedger(entries);
  if (errors.length > 0) throw Object.assign(new Error(errors.join("; ")), { code: "INVALID_INTERVENTION_LEDGER", errors });
  return {
    schemaVersion: INTERVENTION_LEDGER_SCHEMA_VERSION,
    status: entries.length > 0 ? "available" : "not-supplied",
    entries: entries.map(readerEntry),
  };
}

export function summarizeLearningCapture(entries = [], { active = true } = {}) {
  const ledger = projectInterventionLedger(entries);
  if (ledger.entries.length === 0) {
    return {
      schemaVersion: INTERVENTION_LEDGER_SCHEMA_VERSION,
      state: "N/A",
      summary: "N/A — requires two comparable observation windows and an intervention comparison.",
      interventions: [],
    };
  }
  if (!active) {
    return {
      schemaVersion: INTERVENTION_LEDGER_SCHEMA_VERSION,
      state: "N/A",
      summary: "Intervention history is retained but dormant until current Loop Engineering is Exercised.",
      interventions: ledger.entries,
    };
  }
  const states = ledger.entries.map((entry) => entry.comparison.state);
  const state = states.includes("regressing") ? "regressing"
    : states.includes("outcome-supported") ? "outcome-supported"
      : states.includes("improving") ? "improving"
        : states.includes("unchanged") ? "unchanged"
          : "pending";
  const effectiveCount = ledger.entries.filter((entry) => entry.comparison.effectiveness === "Effective").length;
  const validCount = ledger.entries.filter((entry) => entry.comparison.valid).length;
  const summary = state === "pending"
    ? "Interventions are declared with a baseline and a later comparison window; results are pending."
    : state === "regressing"
      ? "A comparable intervention window regressed on a primary or guardrail metric; stop or revert before expanding it."
      : state === "outcome-supported"
        ? effectiveCount > 0
          ? `${effectiveCount} intervention${effectiveCount === 1 ? " is" : "s are"} Effective under a comparable, outcome-supported window.`
          : `${validCount} comparable intervention ${validCount === 1 ? "window has" : "windows have"} outcome-supported evidence; effectiveness is not claimed.`
        : `${validCount} comparable intervention ${validCount === 1 ? "window is" : "windows are"} ${state}; effectiveness is not yet demonstrated.`;
  return {
    schemaVersion: INTERVENTION_LEDGER_SCHEMA_VERSION,
    state,
    summary,
    ...(state === "outcome-supported" && effectiveCount > 0 ? { effectiveness: "Effective" } : {}),
    interventions: ledger.entries,
  };
}
