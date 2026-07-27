import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  buildTaskEpisodes,
  classifyExecutionSignal,
  isHarnessArtifactPath,
} from "./episode-contract.mjs";

export const SESSION_SELECTION_PLAN_SCHEMA_VERSION = 2;
export const SESSION_SELECTION_PROFILE_SCHEMA_VERSION = 1;
export const SESSION_SELECTION_SNAPSHOT_SCHEMA_VERSION = 1;

const PLAN_KIND = "session-selection-plan";
const PROFILE_KIND = "session-selection-profile";
const SNAPSHOT_KIND = "session-selection-fact-snapshot";
const PLAN_OPERATORS = Object.freeze(["eq", "gt", "gte", "lt", "lte"]);
const PLAN_FALLBACKS = Object.freeze(["time-spread", "latest-n"]);
const MAX_PLAN_LIMIT = 200;
const MAX_STRATA = 8;
const MAX_CONDITIONS = 6;
const MAX_STRATUM_MATCH_RATIO = 0.6;
const PROFILE_DIGEST_RE = /^[a-f0-9]{16}$/u;

const FIELD_DEFINITIONS = Object.freeze([
  ["durationMinutes", "Observed wall-clock span in minutes."],
  ["eventCount", "Canonical normalized event count."],
  ["episodeCount", "Deterministic Task Episode count."],
  ["userPromptCount", "User-authored prompt event count."],
  ["toolCallCount", "Canonical tool or function-call count."],
  ["toolKindCount", "Distinct observed tool or function names."],
  ["targetPathCount", "Distinct non-Harness target paths, exposed only as a count."],
  ["attemptedRadius", "Tool-kind plus target-path count used as an attempted-radius proxy."],
  ["changeCount", "Observed non-Harness edit count."],
  ["validationCount", "Observed validation command count."],
  ["failedValidationCount", "Observed failed validation count."],
  ["unvalidatedChangeCount", "Task Episodes with a change and no relevant later validation."],
  ["closedEpisodeCount", "Changed Task Episodes closed by relevant passing validation."],
  ["repairCandidateCount", "Ordered fail -> edit -> later pass candidates awaiting evidence review."],
  ["repairedEpisodeCount", "Evidence-reviewed failure, diagnosis, repair, and rerun episodes."],
  ["frictionCount", "Observed execution error or warning count."],
  ["sourceKindCount", "Distinct indexed source kinds."],
  ["coverageCount", "Available deterministic source-coverage surfaces."],
]);

const FAMILY_FIELDS = Object.freeze({
  "result-bearing": Object.freeze(["validationCount", "closedEpisodeCount", "repairCandidateCount", "repairedEpisodeCount"]),
  "review-gap": Object.freeze(["failedValidationCount", "unvalidatedChangeCount"]),
  "execution-friction": Object.freeze(["frictionCount"]),
  "work-shape": Object.freeze([
    "durationMinutes",
    "eventCount",
    "episodeCount",
    "userPromptCount",
    "toolCallCount",
    "toolKindCount",
    "targetPathCount",
    "attemptedRadius",
    "changeCount",
    "sourceKindCount",
    "coverageCount",
  ]),
});

export const SESSION_SELECTION_PLAN_FAMILIES = Object.freeze(Object.keys(FAMILY_FIELDS));
const PLAN_FAMILY_SET = new Set(SESSION_SELECTION_PLAN_FAMILIES);

export const SESSION_SELECTION_PLAN_FIELDS = Object.freeze(FIELD_DEFINITIONS.map(([name]) => name));
const PLAN_FIELD_SET = new Set(SESSION_SELECTION_PLAN_FIELDS);

function rows(value) {
  return Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nonNegativeInteger(value) {
  return Math.max(0, Math.floor(finiteNumber(value)));
}

function timestampMillis(value) {
  if (!value) return null;
  const millis = Date.parse(value);
  return Number.isNaN(millis) ? null : millis;
}

function entryTimestamp(entry) {
  return timestampMillis(entry?.session?.lastSeen ?? entry?.session?.firstSeen) ?? 0;
}

function eventTargetPaths(event) {
  return [event?.filePath, ...rows(event?.targetPaths), ...rows(event?.affectedPaths)]
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.replace(/\\/g, "/"))
    .filter((value) => !isHarnessArtifactPath(value));
}

function roundMinutes(value) {
  return Math.round(Math.max(0, value) * 10) / 10;
}

export function buildSessionSelectionFacts(session = {}, events = []) {
  const episodeAnalysis = buildTaskEpisodes(events);
  const canonicalEvents = episodeAnalysis.canonicalEvents;
  const episodes = episodeAnalysis.episodes;
  let firstSeen = null;
  let lastSeen = null;
  for (const event of canonicalEvents) {
    const eventTime = timestampMillis(event?.timestamp);
    if (!Number.isFinite(eventTime)) continue;
    firstSeen = Number.isFinite(firstSeen) ? Math.min(firstSeen, eventTime) : eventTime;
    lastSeen = Number.isFinite(lastSeen) ? Math.max(lastSeen, eventTime) : eventTime;
  }
  if (!Number.isFinite(firstSeen)) firstSeen = timestampMillis(session.firstSeen);
  if (!Number.isFinite(lastSeen)) lastSeen = timestampMillis(session.lastSeen);
  const tools = new Set(
    canonicalEvents
      .map((event) => event?.toolName ?? event?.functionCallName)
      .filter((value) => typeof value === "string" && value.trim()),
  );
  const targetPaths = new Set(canonicalEvents.flatMap(eventTargetPaths));
  const validationSets = episodes.flatMap((episode) => rows(episode?.validationSets));
  const changeCount = episodes.reduce(
    (total, episode) => total + rows(episode?.changeSets).reduce((count, change) => count + nonNegativeInteger(change?.eventCount), 0),
    0,
  );
  const sourceKinds = new Set([
    ...rows(session?.sourceKinds),
    ...canonicalEvents.map((event) => event?.sourceKind).filter(Boolean),
  ]);
  const coverageCount = Object.values(session?.coverage ?? {}).filter(Boolean).length;

  return {
    durationMinutes: firstSeen !== null && lastSeen !== null ? roundMinutes((lastSeen - firstSeen) / 60_000) : 0,
    eventCount: canonicalEvents.length,
    episodeCount: episodes.length,
    userPromptCount: canonicalEvents.filter((event) => event?.type === "user" || event?.type === "last-prompt").length,
    toolCallCount: canonicalEvents.filter((event) => event?.toolName || event?.functionCallName).length,
    toolKindCount: tools.size,
    targetPathCount: targetPaths.size,
    attemptedRadius: tools.size + targetPaths.size,
    changeCount,
    validationCount: validationSets.length,
    failedValidationCount: validationSets.filter((validation) => validation?.status === "failed").length,
    unvalidatedChangeCount: episodes.filter(
      (episode) => rows(episode?.changeSets).length > 0 && episode?.closure?.status === "unobserved",
    ).length,
    closedEpisodeCount: episodes.filter((episode) => episode?.closure?.status === "closed").length,
    repairCandidateCount: episodes.reduce((total, episode) => total + rows(episode?.repair?.candidates).length, 0),
    repairedEpisodeCount: episodes.filter((episode) => episode?.repair?.status === "repaired-and-passed").length,
    frictionCount: canonicalEvents.filter((event) => classifyExecutionSignal(event).kind === "execution-friction").length,
    sourceKindCount: sourceKinds.size,
    coverageCount,
  };
}

export function buildSessionSelectionEntry(session, events = []) {
  return {
    session,
    facts: buildSessionSelectionFacts(session, events),
  };
}

export async function collectSessionSelectionEntries({
  analyzer,
  sessions = [],
  scope,
  concurrency = 4,
} = {}) {
  if (!analyzer || typeof analyzer.readSession !== "function") {
    throw new Error("selection profile requires an analyzer with readSession()");
  }
  const limit = Math.max(1, Math.min(16, nonNegativeInteger(concurrency) || 4));
  const entries = new Array(sessions.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < sessions.length) {
      const index = nextIndex;
      nextIndex += 1;
      const session = sessions[index];
      const events = await analyzer.readSession(session, scope, {
        includeCommandText: true,
        includeUserText: false,
        includeContent: false,
      });
      entries[index] = buildSessionSelectionEntry(session, events);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, sessions.length)) }, () => worker()));
  return entries.filter(Boolean);
}

function percentile(sorted, ratio) {
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function fieldDistribution(entries, field) {
  const values = entries
    .map((entry) => finiteNumber(entry?.facts?.[field], Number.NaN))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  return {
    observedCount: values.length,
    nonzeroCount: values.filter((value) => value > 0).length,
    min: values[0] ?? 0,
    p50: percentile(values, 0.5),
    p75: percentile(values, 0.75),
    p90: percentile(values, 0.9),
    max: values.at(-1) ?? 0,
  };
}

function digestValue(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function profileDigestPayload(profile) {
  return {
    schemaVersion: profile?.schemaVersion,
    kind: profile?.kind,
    scope: profile?.scope,
    eligibleCount: profile?.eligibleCount,
    limit: profile?.limit,
    fields: profile?.fields,
    families: profile?.families,
  };
}

function familyAvailability(entries, family) {
  const fields = FAMILY_FIELDS[family] ?? [];
  return entries.filter((entry) => fields.some((field) => finiteNumber(entry?.facts?.[field]) > 0)).length;
}

export function sessionSelectionProfileDigest(profile) {
  return digestValue(profileDigestPayload(profile));
}

export function buildSessionSelectionProfile(entries = [], {
  platform = "unknown",
  limit = 40,
  since = null,
  until = null,
} = {}) {
  const resolvedLimit = Math.max(2, Math.min(MAX_PLAN_LIMIT, nonNegativeInteger(limit) || 40));
  const fieldDescriptions = new Map(FIELD_DEFINITIONS);
  const families = Object.fromEntries(SESSION_SELECTION_PLAN_FAMILIES.map((family) => [family, {
    fields: [...FAMILY_FIELDS[family]],
    availableCount: familyAvailability(entries, family),
  }]));
  const profile = {
    schemaVersion: SESSION_SELECTION_PROFILE_SCHEMA_VERSION,
    kind: PROFILE_KIND,
    scope: {
      platform,
      since,
      until,
    },
    eligibleCount: entries.length,
    limit: resolvedLimit,
    sampleRequired: entries.length > resolvedLimit,
    fields: Object.fromEntries(SESSION_SELECTION_PLAN_FIELDS.map((field) => [field, {
      description: fieldDescriptions.get(field),
      ...fieldDistribution(entries, field),
    }])),
    families,
    planContract: {
      schemaVersion: SESSION_SELECTION_PLAN_SCHEMA_VERSION,
      kind: PLAN_KIND,
      planner: "ai",
      operators: [...PLAN_OPERATORS],
      fallbacks: [...PLAN_FALLBACKS],
      families,
      requiredFamilies: ["result-bearing", "review-gap"].filter((family) => families[family].availableCount > 0),
      minimumStrata: 2,
      maximumStrata: MAX_STRATA,
      maximumConditionsPerStratum: MAX_CONDITIONS,
      maximumMatchRatio: MAX_STRATUM_MATCH_RATIO,
      profileDigest: null,
    },
    planningGuidance: [
      "Use two to six complementary evidence strata when sampling is required.",
      "Declare one evidence family per stratum and use only fields listed for that family.",
      "Cover result-bearing and review-gap families whenever their availableCount is non-zero.",
      `Keep every stratum at or below ${MAX_STRATUM_MATCH_RATIO} of the eligible population.`,
      "Prefer result-bearing and rare failure, repair, closure, or unvalidated-change evidence over volume alone.",
      "Use duration and attemptedRadius only to preserve work-shape coverage, not as outcome evidence.",
      "Keep time-spread as the default fallback unless recent work is explicitly the review scope.",
      "Never identify sessions or write executable predicates.",
    ],
    planTemplate: {
      schemaVersion: SESSION_SELECTION_PLAN_SCHEMA_VERSION,
      kind: PLAN_KIND,
      planner: "ai",
      profileDigest: null,
      rationale: "Represent result-bearing and contrasting work shapes from this workspace.",
      limit: resolvedLimit,
      fallback: "time-spread",
      strata: [
        {
          id: "result-bearing",
          family: "result-bearing",
          purpose: "Preserve sessions with validation results or ordered repair candidates.",
          target: Math.max(1, Math.min(8, Math.floor(resolvedLimit / 4))),
          match: "any",
          conditions: [
            { field: "validationCount", operator: "gte", value: 1 },
            { field: "repairCandidateCount", operator: "gte", value: 1 },
          ],
        },
        {
          id: "review-gaps",
          family: "review-gap",
          purpose: "Preserve failed validation or changes without later validation.",
          target: Math.max(1, Math.min(8, Math.floor(resolvedLimit / 4))),
          match: "any",
          conditions: [
            { field: "failedValidationCount", operator: "gte", value: 1 },
            { field: "unvalidatedChangeCount", operator: "gte", value: 1 },
          ],
        },
      ],
    },
    privacy: {
      sessionIdsIncluded: false,
      rawPromptsIncluded: false,
      assistantTextIncluded: false,
      commandsIncluded: false,
      sourcePathsIncluded: false,
      targetPathsIncluded: false,
    },
  };
  profile.profileDigest = sessionSelectionProfileDigest(profile);
  profile.planContract.profileDigest = profile.profileDigest;
  profile.planTemplate.profileDigest = profile.profileDigest;
  return profile;
}

function snapshotDigestPayload(snapshot) {
  return {
    schemaVersion: snapshot?.schemaVersion,
    kind: snapshot?.kind,
    profileDigest: snapshot?.profileDigest,
    scope: snapshot?.scope,
    eligibleCount: snapshot?.eligibleCount,
    rows: snapshot?.rows,
  };
}

export function sessionSelectionSnapshotDigest(snapshot) {
  return digestValue(snapshotDigestPayload(snapshot));
}

function numericFacts(facts = {}) {
  return Object.fromEntries(SESSION_SELECTION_PLAN_FIELDS.map((field) => [field, finiteNumber(facts?.[field])]));
}

export function buildSessionSelectionSnapshot(entries = [], profile) {
  const profileErrors = validateSessionSelectionProfile(profile);
  if (profileErrors.length > 0) {
    throw new Error(`invalid session selection profile: ${profileErrors.join("; ")}`);
  }
  const snapshot = {
    schemaVersion: SESSION_SELECTION_SNAPSHOT_SCHEMA_VERSION,
    kind: SNAPSHOT_KIND,
    profileDigest: profile.profileDigest,
    scope: profile.scope,
    eligibleCount: entries.length,
    rows: entries.map((entry) => ({
      sessionId: String(entry?.session?.sessionId ?? ""),
      facts: numericFacts(entry?.facts),
    })),
  };
  snapshot.snapshotDigest = sessionSelectionSnapshotDigest(snapshot);
  const errors = validateSessionSelectionSnapshot(snapshot);
  if (errors.length > 0) throw new Error(`invalid session selection snapshot: ${errors.join("; ")}`);
  return snapshot;
}

function unknownKeys(value, allowed) {
  return Object.keys(value ?? {}).filter((key) => !allowed.has(key));
}

function validText(value, minimum, maximum) {
  const length = typeof value === "string" ? value.trim().length : 0;
  return length >= minimum && length <= maximum;
}

export function validateSessionSelectionPlan(plan, { eligibleCount = null } = {}) {
  const errors = [];
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return ["plan must be an object"];
  const topKeys = new Set(["schemaVersion", "kind", "planner", "profileDigest", "rationale", "limit", "fallback", "strata"]);
  for (const key of unknownKeys(plan, topKeys)) errors.push(`plan.${key} is not supported`);
  if (plan.schemaVersion !== SESSION_SELECTION_PLAN_SCHEMA_VERSION) errors.push(`plan.schemaVersion must be ${SESSION_SELECTION_PLAN_SCHEMA_VERSION}`);
  if (plan.kind !== PLAN_KIND) errors.push(`plan.kind must be ${PLAN_KIND}`);
  if (plan.planner !== "ai") errors.push("plan.planner must be ai");
  if (!PROFILE_DIGEST_RE.test(String(plan.profileDigest ?? ""))) errors.push("plan.profileDigest must be a 16-character lowercase hex digest");
  if (!validText(plan.rationale, 12, 500)) errors.push("plan.rationale must be 12-500 characters");
  if (!Number.isInteger(plan.limit) || plan.limit < 2 || plan.limit > MAX_PLAN_LIMIT) errors.push(`plan.limit must be an integer from 2 to ${MAX_PLAN_LIMIT}`);
  if (!PLAN_FALLBACKS.includes(plan.fallback)) errors.push(`plan.fallback must be one of ${PLAN_FALLBACKS.join(", ")}`);
  if (!Array.isArray(plan.strata) || plan.strata.length < 2 || plan.strata.length > MAX_STRATA) {
    errors.push(`plan.strata must contain 2-${MAX_STRATA} rows`);
  }

  const ids = new Set();
  let targetTotal = 0;
  for (const [index, stratum] of (Array.isArray(plan.strata) ? plan.strata : []).entries()) {
    const location = `plan.strata[${index}]`;
    if (!stratum || typeof stratum !== "object" || Array.isArray(stratum)) {
      errors.push(`${location} must be an object`);
      continue;
    }
    const stratumKeys = new Set(["id", "family", "purpose", "target", "match", "conditions"]);
    for (const key of unknownKeys(stratum, stratumKeys)) errors.push(`${location}.${key} is not supported`);
    if (!/^[a-z][a-z0-9-]{0,47}$/u.test(String(stratum.id ?? ""))) errors.push(`${location}.id must be lower kebab-case`);
    if (ids.has(stratum.id)) errors.push(`${location}.id must be unique`);
    ids.add(stratum.id);
    if (!PLAN_FAMILY_SET.has(stratum.family)) errors.push(`${location}.family is not supported`);
    if (!validText(stratum.purpose, 5, 240)) errors.push(`${location}.purpose must be 5-240 characters`);
    if (!Number.isInteger(stratum.target) || stratum.target < 1) errors.push(`${location}.target must be a positive integer`);
    else targetTotal += stratum.target;
    if (!['all', 'any'].includes(stratum.match)) errors.push(`${location}.match must be all or any`);
    if (!Array.isArray(stratum.conditions) || stratum.conditions.length < 1 || stratum.conditions.length > MAX_CONDITIONS) {
      errors.push(`${location}.conditions must contain 1-${MAX_CONDITIONS} rows`);
    }
    for (const [conditionIndex, condition] of (Array.isArray(stratum.conditions) ? stratum.conditions : []).entries()) {
      const conditionLocation = `${location}.conditions[${conditionIndex}]`;
      if (!condition || typeof condition !== "object" || Array.isArray(condition)) {
        errors.push(`${conditionLocation} must be an object`);
        continue;
      }
      const conditionKeys = new Set(["field", "operator", "value"]);
      for (const key of unknownKeys(condition, conditionKeys)) errors.push(`${conditionLocation}.${key} is not supported`);
      if (!PLAN_FIELD_SET.has(condition?.field)) errors.push(`${conditionLocation}.field is not supported`);
      else if (PLAN_FAMILY_SET.has(stratum.family) && !FAMILY_FIELDS[stratum.family].includes(condition.field)) {
        errors.push(`${conditionLocation}.field does not belong to ${stratum.family}`);
      }
      if (!PLAN_OPERATORS.includes(condition?.operator)) errors.push(`${conditionLocation}.operator is not supported`);
      if (!Number.isFinite(condition?.value) || condition.value < 0) errors.push(`${conditionLocation}.value must be a non-negative number`);
    }
  }
  if (Number.isInteger(plan.limit) && targetTotal > plan.limit) errors.push("sum of stratum targets must not exceed plan.limit");
  if (Number.isFinite(eligibleCount) && eligibleCount < 0) errors.push("eligibleCount must be non-negative");
  return errors;
}

function normalizedPlan(plan) {
  return {
    schemaVersion: plan.schemaVersion,
    kind: plan.kind,
    planner: plan.planner,
    profileDigest: plan.profileDigest,
    rationale: plan.rationale.trim(),
    limit: plan.limit,
    fallback: plan.fallback,
    strata: plan.strata.map((stratum) => ({
      id: stratum.id,
      family: stratum.family,
      purpose: stratum.purpose.trim(),
      target: stratum.target,
      match: stratum.match,
      conditions: stratum.conditions.map((condition) => ({
        field: condition.field,
        operator: condition.operator,
        value: condition.value,
      })),
    })),
  };
}

export function assertSessionSelectionPlan(plan, options = {}) {
  const errors = validateSessionSelectionPlan(plan, options);
  if (errors.length > 0) throw new Error(`invalid session selection plan: ${errors.join("; ")}`);
  return normalizedPlan(plan);
}

export function parseSessionSelectionPlanDocument(text, options = {}) {
  const trimmed = String(text ?? "").trim();
  const fenced = trimmed.match(/^```json[\t ]*\r?\n([\s\S]*?)\r?\n```$/u);
  const document = fenced ? fenced[1] : trimmed;
  let value;
  try {
    value = JSON.parse(document);
  } catch (error) {
    throw new Error(`invalid session selection plan JSON: ${error.message}`);
  }
  return assertSessionSelectionPlan(value, options);
}

export async function readSessionSelectionPlan(filePath) {
  try {
    return parseSessionSelectionPlanDocument(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`unable to read session selection plan: ${error.message}`);
  }
}

export function validateSessionSelectionProfile(profile) {
  const errors = [];
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return ["profile must be an object"];
  if (profile.schemaVersion !== SESSION_SELECTION_PROFILE_SCHEMA_VERSION) {
    errors.push(`profile.schemaVersion must be ${SESSION_SELECTION_PROFILE_SCHEMA_VERSION}`);
  }
  if (profile.kind !== PROFILE_KIND) errors.push(`profile.kind must be ${PROFILE_KIND}`);
  if (!PROFILE_DIGEST_RE.test(String(profile.profileDigest ?? ""))) {
    errors.push("profile.profileDigest must be a 16-character lowercase hex digest");
  } else if (profile.profileDigest !== sessionSelectionProfileDigest(profile)) {
    errors.push("profile.profileDigest does not match the profile population facts");
  }
  if (!Number.isInteger(profile.eligibleCount) || profile.eligibleCount < 0) {
    errors.push("profile.eligibleCount must be a non-negative integer");
  }
  if (!profile.scope?.until) errors.push("profile.scope.until is required to freeze the eligible population");
  return errors;
}

export async function readSessionSelectionProfile(filePath) {
  let value;
  try {
    value = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`unable to read session selection profile: ${error.message}`);
  }
  const errors = validateSessionSelectionProfile(value);
  if (errors.length > 0) throw new Error(`invalid session selection profile: ${errors.join("; ")}`);
  return value;
}

export function validateSessionSelectionSnapshot(snapshot) {
  const errors = [];
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return ["snapshot must be an object"];
  const topKeys = new Set(["schemaVersion", "kind", "profileDigest", "snapshotDigest", "scope", "eligibleCount", "rows"]);
  for (const key of unknownKeys(snapshot, topKeys)) errors.push(`snapshot.${key} is not supported`);
  if (snapshot.schemaVersion !== SESSION_SELECTION_SNAPSHOT_SCHEMA_VERSION) {
    errors.push(`snapshot.schemaVersion must be ${SESSION_SELECTION_SNAPSHOT_SCHEMA_VERSION}`);
  }
  if (snapshot.kind !== SNAPSHOT_KIND) errors.push(`snapshot.kind must be ${SNAPSHOT_KIND}`);
  if (!PROFILE_DIGEST_RE.test(String(snapshot.profileDigest ?? ""))) {
    errors.push("snapshot.profileDigest must be a 16-character lowercase hex digest");
  }
  if (!PROFILE_DIGEST_RE.test(String(snapshot.snapshotDigest ?? ""))) {
    errors.push("snapshot.snapshotDigest must be a 16-character lowercase hex digest");
  } else if (snapshot.snapshotDigest !== sessionSelectionSnapshotDigest(snapshot)) {
    errors.push("snapshot.snapshotDigest does not match the snapshot facts");
  }
  if (!Number.isInteger(snapshot.eligibleCount) || snapshot.eligibleCount < 0) {
    errors.push("snapshot.eligibleCount must be a non-negative integer");
  }
  if (!Array.isArray(snapshot.rows) || snapshot.rows.length !== snapshot.eligibleCount) {
    errors.push("snapshot.rows length must equal snapshot.eligibleCount");
  }
  const sessionIds = new Set();
  for (const [index, row] of (Array.isArray(snapshot.rows) ? snapshot.rows : []).entries()) {
    const location = `snapshot.rows[${index}]`;
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      errors.push(`${location} must be an object`);
      continue;
    }
    for (const key of unknownKeys(row, new Set(["sessionId", "facts"]))) errors.push(`${location}.${key} is not supported`);
    if (!validText(row.sessionId, 1, 512)) errors.push(`${location}.sessionId must be 1-512 characters`);
    if (sessionIds.has(row.sessionId)) errors.push(`${location}.sessionId must be unique`);
    sessionIds.add(row.sessionId);
    if (!row.facts || typeof row.facts !== "object" || Array.isArray(row.facts)) {
      errors.push(`${location}.facts must be an object`);
      continue;
    }
    for (const key of unknownKeys(row.facts, PLAN_FIELD_SET)) errors.push(`${location}.facts.${key} is not supported`);
    for (const field of SESSION_SELECTION_PLAN_FIELDS) {
      if (!Number.isFinite(row.facts[field]) || row.facts[field] < 0) {
        errors.push(`${location}.facts.${field} must be a non-negative number`);
      }
    }
  }
  return errors;
}

export async function readSessionSelectionSnapshot(filePath) {
  let value;
  try {
    value = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`unable to read session selection snapshot: ${error.message}`);
  }
  const errors = validateSessionSelectionSnapshot(value);
  if (errors.length > 0) throw new Error(`invalid session selection snapshot: ${errors.join("; ")}`);
  return value;
}

export function restoreSessionSelectionEntries(profile, snapshot, sessions = []) {
  const profileErrors = validateSessionSelectionProfile(profile);
  const snapshotErrors = validateSessionSelectionSnapshot(snapshot);
  if (profileErrors.length > 0) throw new Error(`invalid session selection profile: ${profileErrors.join("; ")}`);
  if (snapshotErrors.length > 0) throw new Error(`invalid session selection snapshot: ${snapshotErrors.join("; ")}`);
  if (snapshot.profileDigest !== profile.profileDigest) {
    throw new Error("session selection snapshot does not match the supplied population profile digest");
  }
  if (JSON.stringify(snapshot.scope) !== JSON.stringify(profile.scope)) {
    throw new Error("session selection snapshot scope does not match the supplied population profile");
  }
  if (snapshot.eligibleCount !== profile.eligibleCount || sessions.length !== profile.eligibleCount) {
    throw new Error(
      `session selection snapshot population drifted: profile=${profile.eligibleCount} snapshot=${snapshot.eligibleCount} current=${sessions.length}`,
    );
  }
  const factsBySession = new Map(snapshot.rows.map((row) => [row.sessionId, row.facts]));
  const restored = sessions.map((session) => ({ session, facts: factsBySession.get(session.sessionId) }));
  const missing = restored.filter((entry) => !entry.facts).map((entry) => entry.session.sessionId);
  if (missing.length > 0 || factsBySession.size !== sessions.length) {
    throw new Error(`session selection snapshot mapping drifted: missing ${missing.length} current session(s)`);
  }
  return restored;
}

export function assertSessionSelectionBinding(profile, plan, { eligibleCount = null } = {}) {
  const profileErrors = validateSessionSelectionProfile(profile);
  const normalizedPlanValue = assertSessionSelectionPlan(plan, { eligibleCount });
  if (profileErrors.length > 0) {
    throw new Error(`invalid session selection profile: ${profileErrors.join("; ")}`);
  }
  if (normalizedPlanValue.profileDigest !== profile.profileDigest) {
    throw new Error("session selection plan does not match the supplied population profile digest");
  }
  if (Number.isInteger(eligibleCount) && eligibleCount !== profile.eligibleCount) {
    throw new Error(
      `session selection population drifted: profile has ${profile.eligibleCount}, current snapshot has ${eligibleCount}`,
    );
  }
  return normalizedPlanValue;
}

function matchesCondition(facts, condition) {
  const actual = finiteNumber(facts?.[condition.field], 0);
  if (condition.operator === "eq") return actual === condition.value;
  if (condition.operator === "gt") return actual > condition.value;
  if (condition.operator === "gte") return actual >= condition.value;
  if (condition.operator === "lt") return actual < condition.value;
  if (condition.operator === "lte") return actual <= condition.value;
  return false;
}

function matchesStratum(entry, stratum) {
  const matches = stratum.conditions.map((condition) => matchesCondition(entry.facts, condition));
  return stratum.match === "any" ? matches.some(Boolean) : matches.every(Boolean);
}

function timeSpreadIndexes(entries, count) {
  if (count <= 0 || entries.length === 0) return [];
  const ordered = entries
    .map((entry, index) => ({ entry, index, timestamp: entryTimestamp(entry) }))
    .sort((left, right) => left.timestamp - right.timestamp || left.index - right.index);
  if (count >= ordered.length) return ordered.map((row) => row.index);
  if (count === 1) return [ordered.at(-1).index];
  const indexes = new Set();
  for (let index = 0; index < count; index += 1) {
    indexes.add(ordered[Math.round((index * (ordered.length - 1)) / (count - 1))].index);
  }
  return [...indexes];
}

function chooseIndexes(entries, count, fallback) {
  if (fallback === "latest-n") {
    return entries
      .map((entry, index) => ({ entry, index, timestamp: entryTimestamp(entry) }))
      .sort((left, right) => right.timestamp - left.timestamp || left.index - right.index)
      .slice(0, count)
      .map((row) => row.index);
  }
  return timeSpreadIndexes(entries, count);
}

function digestPlan(plan) {
  return digestValue(plan);
}

function stratumMatchRows(entries, stratum) {
  const indexes = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => matchesStratum(entry, stratum))
    .map(({ index }) => index);
  return { stratum, indexes };
}

function planQualityErrors(entries, normalized, matchRows) {
  const errors = [];
  for (const family of ["result-bearing", "review-gap"]) {
    if (familyAvailability(entries, family) > 0 && !normalized.strata.some((stratum) => stratum.family === family)) {
      errors.push(`plan must include the available ${family} family`);
    }
  }
  const signatures = new Map();
  for (const row of matchRows) {
    if (row.indexes.length === 0) {
      errors.push(`stratum ${row.stratum.id} matches no sessions`);
      continue;
    }
    if (entries.length > normalized.limit && row.indexes.length / entries.length > MAX_STRATUM_MATCH_RATIO) {
      errors.push(`stratum ${row.stratum.id} is overly broad (${row.indexes.length}/${entries.length}, max ${MAX_STRATUM_MATCH_RATIO})`);
    }
    const signature = row.indexes.join(",");
    const duplicate = signatures.get(signature);
    if (duplicate) errors.push(`strata ${duplicate} and ${row.stratum.id} match the same sessions`);
    else signatures.set(signature, row.stratum.id);
  }
  return errors;
}

export function selectSessionEntriesWithPlan(entries = [], plan) {
  const normalized = assertSessionSelectionPlan(plan, { eligibleCount: entries.length });
  const selected = new Set();
  const accounting = [];
  const matchRows = normalized.strata.map((stratum) => stratumMatchRows(entries, stratum));
  const qualityErrors = planQualityErrors(entries, normalized, matchRows);
  if (qualityErrors.length > 0) {
    throw new Error(`invalid session selection plan: ${qualityErrors.join("; ")}`);
  }

  for (const { stratum, indexes } of matchRows) {
    const matched = indexes.map((index) => ({ entry: entries[index], index }));
    const available = matched.filter(({ index }) => !selected.has(index));
    const target = Math.min(stratum.target, Math.max(0, normalized.limit - selected.size));
    const chosenLocalIndexes = timeSpreadIndexes(available.map(({ entry }) => entry), target);
    for (const localIndex of chosenLocalIndexes) selected.add(available[localIndex].index);
    accounting.push({
      id: stratum.id,
      family: stratum.family,
      target: stratum.target,
      matchedCount: matched.length,
      overlapCount: matched.length - available.length,
      selectedCount: chosenLocalIndexes.length,
      shortfall: Math.max(0, stratum.target - chosenLocalIndexes.length),
    });
  }

  const shortfalls = accounting.filter((stratum) => stratum.shortfall > 0);
  if (shortfalls.length > 0) {
    throw new Error(`invalid session selection plan: quota shortfall: ${shortfalls
      .map((stratum) => `${stratum.id} target=${stratum.target} selected=${stratum.selectedCount} overlap=${stratum.overlapCount}`)
      .join(", ")}`);
  }

  const fallbackCapacity = Math.max(0, normalized.limit - selected.size);
  const remaining = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ index }) => !selected.has(index));
  const fallbackLocalIndexes = chooseIndexes(remaining.map(({ entry }) => entry), fallbackCapacity, normalized.fallback);
  for (const localIndex of fallbackLocalIndexes) selected.add(remaining[localIndex].index);
  const selectedEntries = entries.filter((_entry, index) => selected.has(index));

  return {
    sessions: selectedEntries.map((entry) => entry.session),
    strategy: selectedEntries.length === entries.length ? "all-eligible" : "stratified",
    requestedStrategy: "ai-plan",
    eligibleCount: entries.length,
    analyzedCount: selectedEntries.length,
    strata: normalized.strata.map((stratum) => stratum.id),
    plan: {
      schemaVersion: normalized.schemaVersion,
      digest: digestPlan(normalized),
      planner: normalized.planner,
      profileDigest: normalized.profileDigest,
      fallback: normalized.fallback,
      fallbackSelectedCount: fallbackLocalIndexes.length,
      strata: accounting,
    },
  };
}
