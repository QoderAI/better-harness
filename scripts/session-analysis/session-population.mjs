import { stableFingerprint } from "./episode-contract.mjs";
import {
  createFactsRunContext,
  prepareFactsSessionInventory,
} from "./session-core-facts.mjs";
import {
  bindSessionWorkspaceCwds,
  cloneSessionWithWorkspaceCwds,
  sessionWorkspaceCwds,
} from "./provider-runner.mjs";

export const SESSION_POPULATION_BINDING_SCHEMA_VERSION = 1;
export const SESSION_SELECTION_BINDING_SCHEMA_VERSION = 1;
export const SESSION_ADMISSION_BINDING_SCHEMA_VERSION = 1;

const PRIVATE_POPULATION_IDS = new WeakMap();
const PRIVATE_POPULATION_DISCOVERY = new WeakMap();

function rows(value) {
  return Array.isArray(value) ? value : [];
}

function count(value) {
  const numeric = Number(value ?? 0);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : 0;
}

function sessionIds(sessions) {
  return [...new Set(rows(sessions).map((session) => String(session?.sessionId ?? "").trim()).filter(Boolean))].sort();
}

function samePopulation(left, right) {
  return left?.schemaVersion === right?.schemaVersion
    && left?.kind === right?.kind
    && left?.scopeFingerprint === right?.scopeFingerprint
    && left?.policyFingerprint === right?.policyFingerprint
    && left?.eligible?.count === right?.eligible?.count
    && left?.eligible?.fingerprint === right?.eligible?.fingerprint
    && left?.omission?.exactIdentityAvailable === right?.omission?.exactIdentityAvailable
    && left?.omission?.activeSessions === right?.omission?.activeSessions
    && left?.omission?.homeSessionOnly === right?.omission?.homeSessionOnly
    && left?.omission?.recencyInference === right?.omission?.recencyInference;
}

function bindingError(code, message) {
  return Object.assign(new Error(message), { code });
}

function freezeSession(session, inheritedWorkspaceCwds = []) {
  const frozenCandidate = cloneSessionWithWorkspaceCwds(session);
  if (sessionWorkspaceCwds(frozenCandidate).length === 0) {
    bindSessionWorkspaceCwds(frozenCandidate, inheritedWorkspaceCwds);
  }
  return Object.freeze(frozenCandidate);
}

export function freezeSessionPopulation({
  scope = {},
  sessions = [],
  discovery = null,
  excludedSessionId = null,
  providerSessionId = null,
  suppliedUntil = scope.until !== undefined && scope.until !== null && scope.until !== "",
  startedAt = Date.now(),
} = {}) {
  const platform = String(scope.platform ?? "unknown");
  const factsContext = createFactsRunContext({
    workspace: scope.workspace,
    since: scope.since,
    ...(suppliedUntil ? { until: scope.until } : {}),
    ...(excludedSessionId ? { "exclude-session-id": excludedSessionId } : {}),
    _factsStartedAt: startedAt,
  }, platform, providerSessionId);
  const sourceSessions = rows(sessions);
  const workspaceCwdsBySessionId = new Map(sourceSessions.flatMap((session) => {
    const sessionId = String(session?.sessionId ?? "").trim();
    return sessionId ? [[sessionId, sessionWorkspaceCwds(session)]] : [];
  }));
  const prepared = prepareFactsSessionInventory(sourceSessions, factsContext);
  const frozenSessions = Object.freeze(prepared.sessions.map((session) => {
    const sessionId = String(session?.sessionId ?? "").trim();
    return freezeSession(session, sessionId ? workspaceCwdsBySessionId.get(sessionId) : []);
  }));
  const ids = sessionIds(frozenSessions);
  const population = {
    sessions: frozenSessions,
    binding: Object.freeze({
      schemaVersion: SESSION_POPULATION_BINDING_SCHEMA_VERSION,
      kind: "session-population-binding",
      scopeFingerprint: stableFingerprint({
        platform,
        workspace: scope.workspace ?? null,
        since: scope.since ?? null,
        until: scope.until ?? null,
      }),
      policyFingerprint: stableFingerprint({
        platform,
        qoderHomeOnlyExcluded: platform === "qoder",
        exactIdentityAvailable: Boolean(factsContext.excludedSessionId),
        recencyInference: suppliedUntil ? "disabled-frozen-until" : "enabled-unfrozen-until",
      }),
      omission: Object.freeze({
        exactIdentityAvailable: Boolean(factsContext.excludedSessionId),
        activeSessions: count(prepared.omitted.activeSessions),
        homeSessionOnly: count(prepared.omitted.homeSessionOnly),
        recencyInference: suppliedUntil ? "disabled-frozen-until" : "enabled-unfrozen-until",
      }),
      eligible: Object.freeze({
        count: ids.length,
        fingerprint: stableFingerprint(ids),
      }),
    }),
  };
  PRIVATE_POPULATION_IDS.set(population, new Set(ids));
  PRIVATE_POPULATION_DISCOVERY.set(population, Object.freeze({
    scope: Object.freeze(structuredClone(discovery?.scope ?? scope)),
    sources: Object.freeze(rows(discovery?.sources).map((source) => Object.freeze(structuredClone(source)))),
    warnings: Object.freeze(rows(discovery?.warnings).map((warning) => Object.freeze(structuredClone(warning)))),
  }));
  return Object.freeze(population);
}

export function sessionPopulationDiscovery(population) {
  const discovery = PRIVATE_POPULATION_DISCOVERY.get(population);
  if (!discovery) {
    throw bindingError("INVALID_SESSION_POPULATION", "discovery requires a private frozen Session population");
  }
  return discovery;
}

export function bindSessionSelection(population, selectedSessions = [], {
  strategy = "stratified",
  projectionPolicy = "session-projection-v1",
} = {}) {
  const eligibleIds = PRIVATE_POPULATION_IDS.get(population);
  if (!eligibleIds) {
    throw bindingError("INVALID_SESSION_POPULATION", "selection requires a private frozen Session population");
  }
  const selectedIds = sessionIds(selectedSessions);
  if (selectedIds.some((id) => !eligibleIds.has(id))) {
    throw bindingError(
      "SESSION_SELECTION_OUTSIDE_POPULATION",
      "selected Session population is not a subset of the frozen eligible population",
    );
  }
  return Object.freeze({
    schemaVersion: SESSION_SELECTION_BINDING_SCHEMA_VERSION,
    kind: "session-selection-binding",
    parentPopulationFingerprint: population.binding.eligible.fingerprint,
    strategy: String(strategy),
    selected: Object.freeze({
      count: selectedIds.length,
      fingerprint: stableFingerprint(selectedIds),
    }),
    projectionPolicyFingerprint: stableFingerprint(String(projectionPolicy)),
  });
}

export function sessionAdmissionBinding(data = {}, selection = {}) {
  const admission = data.admission ?? {};
  const omitted = data.omitted ?? {};
  return Object.freeze({
    schemaVersion: SESSION_ADMISSION_BINDING_SCHEMA_VERSION,
    kind: "session-admission-binding",
    projectionPolicyFingerprint: selection.projectionPolicyFingerprint,
    taskEpisodes: count(admission.taskEpisodes),
    candidateEpisodes: count(admission.candidateEpisodes),
    distinctRequests: count(admission.distinctRequests),
    emittedCandidates: count(admission.emittedCandidates),
    noRequest: count(omitted.noRequest),
    selfAnalysis: count(omitted.selfAnalysis),
    lowSignal: count(omitted.lowSignal),
    duplicateRequests: count(omitted.duplicateRequests),
    candidateBudget: count(omitted.candidateBudget),
  });
}

export function leadAdmissionBinding(data = {}, selection = {}) {
  return Object.freeze({
    schemaVersion: SESSION_ADMISSION_BINDING_SCHEMA_VERSION,
    kind: "lead-admission-binding",
    projectionPolicyFingerprint: selection.projectionPolicyFingerprint,
    projectedEpisodes: count(data.projectedEpisodes),
    admittedEpisodes: count(data.admittedEpisodes),
    zeroSignalDiscardedEpisodes: count(data.zeroSignalDiscardedEpisodes),
    retainedTaskEpisodes: count(data.retainedTaskEpisodes),
  });
}

function populationErrors(expected, owner, binding) {
  if (!binding || binding.kind !== "session-population-binding") {
    return [`${owner} population binding is missing`];
  }
  return samePopulation(expected, binding) ? [] : [`${owner} population binding does not match the frozen population`];
}

function selectionErrors(population, owner, selection) {
  const errors = [];
  if (!selection || selection.kind !== "session-selection-binding") {
    return [`${owner} selection binding is missing`];
  }
  if (selection.parentPopulationFingerprint !== population?.eligible?.fingerprint) {
    errors.push(`${owner} selection is not bound to the frozen eligible population`);
  }
  if (count(selection.selected?.count) > count(population?.eligible?.count)) {
    errors.push(`${owner} selected count exceeds the eligible population`);
  }
  if (selection.strategy === "all-eligible"
    && (selection.selected?.count !== population?.eligible?.count
      || selection.selected?.fingerprint !== population?.eligible?.fingerprint)) {
    errors.push(`${owner} all-eligible selection does not equal the eligible population`);
  }
  return errors;
}

function sessionAdmissionErrors(admission) {
  if (!admission || admission.kind !== "session-admission-binding") {
    return ["Session admission binding is missing"];
  }
  const errors = [];
  if (admission.taskEpisodes !== admission.candidateEpisodes
    + admission.noRequest + admission.selfAnalysis + admission.lowSignal) {
    errors.push("Session task Episode admission does not reconcile");
  }
  if (admission.candidateEpisodes !== admission.distinctRequests + admission.duplicateRequests) {
    errors.push("Session candidate Episode admission does not reconcile");
  }
  if (admission.distinctRequests !== admission.emittedCandidates + admission.candidateBudget) {
    errors.push("Session distinct-request admission does not reconcile");
  }
  return errors;
}

function leadAdmissionErrors(admission) {
  if (!admission || admission.kind !== "lead-admission-binding") {
    return ["lead admission binding is missing"];
  }
  const errors = [];
  if (admission.projectedEpisodes !== admission.admittedEpisodes + admission.zeroSignalDiscardedEpisodes) {
    errors.push("lead projected Episode admission does not reconcile");
  }
  if (admission.admittedEpisodes !== admission.retainedTaskEpisodes) {
    errors.push("lead retained Episode admission does not reconcile");
  }
  return errors;
}

export function validateSessionPopulationBundle({ population, session, lead } = {}) {
  const errors = [
    ...populationErrors(population, "Session", session?.population),
    ...populationErrors(population, "lead", lead?.population),
    ...selectionErrors(population, "Session", session?.selection),
    ...selectionErrors(population, "lead", lead?.selection),
    ...sessionAdmissionErrors(session?.admission),
    ...leadAdmissionErrors(lead?.admission),
  ];
  if (session?.admission?.projectionPolicyFingerprint !== session?.selection?.projectionPolicyFingerprint) {
    errors.push("Session admission policy does not match its selection binding");
  }
  if (lead?.admission?.projectionPolicyFingerprint !== lead?.selection?.projectionPolicyFingerprint) {
    errors.push("lead admission policy does not match its selection binding");
  }
  if (session?.selection?.selected?.fingerprint === lead?.selection?.selected?.fingerprint
    && session?.selection?.projectionPolicyFingerprint === lead?.selection?.projectionPolicyFingerprint
    && session?.admission?.taskEpisodes !== lead?.admission?.projectedEpisodes) {
    errors.push("comparable Session and lead Episode totals do not match");
  }
  return errors;
}

export function assertSessionPopulationBundle(bindings) {
  const errors = validateSessionPopulationBundle(bindings);
  if (errors.length > 0) {
    throw Object.assign(new Error(errors.join("; ")), {
      code: "SESSION_POPULATION_BINDING_MISMATCH",
      errors,
    });
  }
  return bindings;
}
