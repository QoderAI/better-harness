import { createHash } from "node:crypto";

import { privacySafeUserInputEvidence } from "./privacy-safe-text.mjs";

export const SESSION_CORE_FACTS_SCHEMA_VERSION = 3;
export const EPISODE_FACTS_SCHEMA_VERSION = 2;
export const DEFAULT_EPISODE_FACT_LIMIT = 5;
export const MAX_EPISODE_FACT_LIMIT = 5;
export const MAX_REQUEST_SUMMARY_CHARS = 240;
export const MAX_EPISODE_CHECKS = 4;
export const MAX_EPISODE_MECHANISMS = 3;
export const MAX_EPISODE_LIFECYCLE_SIGNALS = 2;
export const MAX_EPISODE_WORK_TRACE_STEPS = 6;
export const MAX_SESSION_CORE_FACT_BYTES = 8_192;
export const MAX_SESSION_CORE_FACT_TOKENS = 2_000;

const AGENT_WORK_LOOP_EVIDENCE_CLASSES = Object.freeze([
  "validation-repair",
  "boundary-change",
  "lifecycle-demand",
  "operation-control",
  "delivery-recovery",
  "change-gap",
  "read-only-work",
  "activity-only",
]);

const SESSION_CORE_SEMANTIC_GUARDRAILS = Object.freeze([
  "occurrences-not-distinct-episodes",
  "coverage-not-suggestion",
  "omitted-details-not-signal-evidence",
  "project-capability-inventory-unobserved",
]);

export function buildEpisodeFactsPack(records = [], options = {}) {
  const limit = boundedLimit(options.limit);
  const candidates = [];
  let noRequest = 0;
  let selfAnalysis = 0;
  let lowSignal = 0;
  for (const record of records) {
    const candidate = buildCandidate(record);
    if (!candidate) {
      noRequest += 1;
    } else if (candidate._omitReason === "self-analysis") {
      selfAnalysis += 1;
    } else if (candidate._omitReason === "low-signal") {
      lowSignal += 1;
    } else {
      candidates.push(candidate);
    }
  }
  const groups = groupByRequestKey(candidates);
  const representatives = [];
  let duplicateRequests = 0;

  for (const group of groups.values()) {
    const ordered = group.slice().sort(compareCandidatePriority);
    const representative = ordered[0];
    duplicateRequests += Math.max(0, ordered.length - 1);
    representatives.push({
      ...representative,
      _sessionKeys: [...new Set(ordered.flatMap((candidate) => candidate._sessionKeys))],
      request: {
        ...representative.request,
        occurrences: ordered.length,
      },
    });
  }

  representatives.sort(compareCandidatePriority);
  const retained = selectCandidatePortfolio(representatives, limit);
  const contextGroups = candidateContextGroups(retained);
  const entries = retained.map((candidate, index) =>
    publicCandidate(candidate, index, contextGroups.get(candidate)));
  const omitted = {
    noRequest,
    selfAnalysis,
    lowSignal,
    duplicateRequests,
    candidateBudget: Math.max(0, representatives.length - retained.length),
    checkBudget: candidates.reduce((total, candidate) => total + candidate._omittedChecks, 0),
  };

  return {
    schemaVersion: EPISODE_FACTS_SCHEMA_VERSION,
    kind: "episode-fact-candidates",
    recordCount: records.length,
    candidateCount: candidates.length,
    distinctRequestCount: representatives.length,
    emittedCount: entries.length,
    candidateSelection: {
      strategy: "agent-work-loop-portfolio-v1",
      availableClasses: evidenceClassCounts(representatives),
      emittedClasses: evidenceClassCounts(retained),
    },
    populationCoverage: candidateObservationCoverage(representatives),
    entries,
    omitted,
    ...(options.includeDebugLocators === true
      ? {
          debugLocators: retained.map((candidate, index) => ({
            ref: `E${index + 1}`,
            requestKey: candidate.request.key,
            sessionIds: [...new Set(candidate._sessionKeys ?? [])],
          })),
        }
      : {}),
  };
}

export function finalizeSessionCoreFacts({
  scope = {},
  selection = {},
  episodeFacts,
  warnings = [],
  omitted = {},
  sourceCoverage = null,
  maxBytes = MAX_SESSION_CORE_FACT_BYTES,
} = {}) {
  const entries = (episodeFacts?.entries ?? []).map((entry) => structuredClone(entry));
  const boundedSourceCoverage = safeSourceCoverage(sourceCoverage);
  const envelope = {
    schemaVersion: SESSION_CORE_FACTS_SCHEMA_VERSION,
    kind: "session-core-facts",
    scope: {
      platform: safeLabel(scope.platform, 24) ?? "unknown",
      workspace: safeLabel(scope.workspaceLabel, 80) ?? "workspace",
      until: safeBoundary(scope.until),
      selection: safeLabel(selection.strategy, 32) ?? "bounded",
      eligibleSessions: nonNegativeInteger(selection.eligibleCount),
      selectedSessions: nonNegativeInteger(selection.selectedCount),
      sampled: selection.sampled === true,
    },
    candidateSelection: {
      strategy: safeLabel(episodeFacts?.candidateSelection?.strategy, 48)
        ?? "agent-work-loop-portfolio-v1",
      availableClasses: safeEvidenceClassCounts(
        episodeFacts?.candidateSelection?.availableClasses,
      ),
      emittedClasses: evidenceClassCounts(entries),
    },
    admission: {
      taskEpisodes: nonNegativeInteger(episodeFacts?.recordCount),
      candidateEpisodes: nonNegativeInteger(episodeFacts?.candidateCount),
      distinctRequests: nonNegativeInteger(episodeFacts?.distinctRequestCount),
      emittedCandidates: entries.length,
    },
    populationCoverage: safeObservationCoverage(episodeFacts?.populationCoverage),
    observationCoverage: candidateObservationCoverage(entries),
    admissionSupport: candidateAdmissionSupport(entries),
    candidates: entries,
    omitted: {
      noRequest: nonNegativeInteger(episodeFacts?.omitted?.noRequest),
      selfAnalysis: nonNegativeInteger(episodeFacts?.omitted?.selfAnalysis),
      lowSignal: nonNegativeInteger(episodeFacts?.omitted?.lowSignal),
      duplicateRequests: nonNegativeInteger(episodeFacts?.omitted?.duplicateRequests),
      candidateBudget: nonNegativeInteger(episodeFacts?.omitted?.candidateBudget),
      checkBudget: nonNegativeInteger(episodeFacts?.omitted?.checkBudget),
      activeSessions: nonNegativeInteger(omitted.activeSessions),
      homeSessionOnly: nonNegativeInteger(omitted.homeSessionOnly),
    },
    warningCodes: [...new Set(warnings.map((warning) => safeLabel(warning?.code, 64)).filter(Boolean))].slice(0, 5),
    ...(boundedSourceCoverage ? { sourceCoverage: boundedSourceCoverage } : {}),
    excludes: [
      "assistantText",
      "rawPrompts",
      "commands",
      "toolOutput",
      "paths",
      ...(Array.isArray(episodeFacts?.debugLocators) ? [] : ["rawIds"]),
      "secrets",
    ],
    ...(Array.isArray(episodeFacts?.debugLocators)
      ? {
          debug: {
            privacy: "local-operator-only",
            exposes: ["sessionIds"],
            locators: episodeFacts.debugLocators.map((locator) => ({
              ref: safeLabel(locator?.ref, 16),
              requestKey: safeLabel(locator?.requestKey, 32),
              sessionIds: [...new Set((locator?.sessionIds ?? []).map(String).filter(Boolean))],
            })),
          },
        }
      : {}),
  };

  envelope.diagnosticFlags = diagnosticFlags(envelope);

  const initialCandidateBudget = envelope.omitted.candidateBudget;
  let budgetOmitted = 0;
  while (exceedsCostBudget(envelope, maxBytes) && envelope.candidates.length > 0) {
    envelope.candidates.pop();
    budgetOmitted += 1;
    envelope.omitted.candidateBudget = initialCandidateBudget + budgetOmitted;
    envelope.candidateSelection.emittedClasses = evidenceClassCounts(envelope.candidates);
    envelope.observationCoverage = candidateObservationCoverage(envelope.candidates);
    envelope.admissionSupport = candidateAdmissionSupport(envelope.candidates);
    envelope.admission.emittedCandidates = envelope.candidates.length;
    if (envelope.debug) {
      const emittedRefs = new Set(envelope.candidates.map((candidate) => candidate.ref));
      envelope.debug.locators = envelope.debug.locators.filter((locator) => emittedRefs.has(locator.ref));
    }
  }
  if (exceedsCostBudget(envelope, maxBytes) && envelope.diagnosticFlags.length > 0) {
    delete envelope.diagnosticFlags;
  }
  if (exceedsCostBudget(envelope, maxBytes)) {
    delete envelope.populationCoverage;
  }
  return withCost(envelope);
}

function safeObservationCoverage(value = {}) {
  return Object.fromEntries(
    Object.keys(candidateObservationCoverage([])).map((key) => [key, nonNegativeInteger(value?.[key])]),
  );
}

function safeSourceCoverage(value) {
  const statuses = new Set(["absent", "out-of-window", "unobserved", "partial", "observed"]);
  if (!value || typeof value !== "object" || !statuses.has(value.status)) return null;
  const count = (input) => nonNegativeInteger(input);
  const join = (input = {}) => ({
    sourceAvailable: input.sourceAvailable === true,
    matchedWorkspaceSessions: count(input.matchedWorkspaceSessions),
    matchedRelevantSessions: count(input.matchedRelevantSessions),
  });
  return {
    status: value.status,
    transcript: {
      workspaceSessions: count(value.transcript?.workspaceSessions),
      inWindowSessions: count(value.transcript?.inWindowSessions),
      outOfWindowSessions: count(value.transcript?.outOfWindowSessions),
      timeUnobservedSessions: count(value.transcript?.timeUnobservedSessions),
      relevantSessions: count(value.transcript?.relevantSessions),
      withConversation: count(value.transcript?.withConversation),
      withRequest: count(value.transcript?.withRequest),
      terminalOnly: count(value.transcript?.terminalOnly),
      unreadable: count(value.transcript?.unreadable),
    },
    joins: {
      chatMetadata: join(value.joins?.chatMetadata),
      audit: join(value.joins?.audit),
    },
  };
}

function diagnosticFlags(envelope) {
  const flags = [];
  if (["unobserved", "partial"].includes(envelope.sourceCoverage?.status)) {
    flags.push(`source-coverage-${envelope.sourceCoverage.status}`);
  }
  if (envelope.scope.sampled) flags.push("sampled-selection");
  const taskEpisodes = envelope.admission.taskEpisodes;
  const candidateEpisodes = envelope.admission.candidateEpisodes;
  if (taskEpisodes > 0 && candidateEpisodes / taskEpisodes < 0.05) {
    flags.push("candidate-admission-sparse");
  }
  if (taskEpisodes > 0 && (envelope.omitted.selfAnalysis / taskEpisodes >= 0.3
    || envelope.omitted.selfAnalysis >= Math.max(5, candidateEpisodes * 2))) {
    flags.push("self-analysis-heavy");
  }
  if (envelope.admission.distinctRequests > envelope.admission.emittedCandidates) {
    flags.push("portfolio-truncated");
  }
  if (Object.keys(envelope.populationCoverage).some(
    (key) => envelope.populationCoverage[key] !== envelope.observationCoverage[key],
  )) {
    flags.push("population-portfolio-divergence");
  }
  if (envelope.populationCoverage.withChanges === 0) flags.push("no-change-evidence");
  if (envelope.populationCoverage.withReviewedRelevantCheck === 0) {
    flags.push("no-reviewed-relevant-check-evidence");
  }
  if (envelope.populationCoverage.withResultSignal === 0) flags.push("no-result-evidence");
  return flags;
}

function buildCandidate(record) {
  const episode = record?.episode;
  const events = Array.isArray(record?.events) ? record.events : [];
  if (!episode) return null;
  const input = privacySafeUserInputEvidence(events, {
    requestLimit: MAX_REQUEST_SUMMARY_CHARS,
    intermediateLimit: 120,
    followUpLimit: 160,
  });
  if (!input?.request) return null;
  if (isGeneratedHarnessAnalysisRequest(input.request)) {
    return { _omitReason: "self-analysis" };
  }

  const requestKey = requestFingerprint(input.request);
  const editCount = (episode.changeSets ?? []).reduce(
    (total, change) => total + nonNegativeInteger(change?.eventCount),
    0,
  );
  const fileCount = new Set((episode.changeSets ?? []).flatMap((change) => change?.paths ?? [])).size;
  const finalChange = finalChangeSet(episode.changeSets);
  const checkRecords = (episode.validationSets ?? []).map((validation, index) => ({
    ref: validation?.id ?? null,
    value: compactCheck(
      validation,
      record?.validationResults?.[index],
      validationRelation(validation, finalChange),
    ),
  }));
  const allChecks = checkRecords.map((record) => record.value);
  const checks = boundedChecks(checkRecords, episode.repair);
  const failedChecks = (episode.validationSets ?? []).filter((validation) => validation?.status === "failed").length;
  const failureEvents = events.filter(isFailureEvent).length;
  const otherFailures = Math.max(0, failureEvents - failedChecks);
  const permissionDenials = nonNegativeInteger(episode.permissionSummary?.denied);
  const mechanisms = observedMechanisms(events, episode).slice(0, MAX_EPISODE_MECHANISMS);
  const activity = observedProjectActivity(events);
  const lifecycle = compactLifecycleSignals(episode.lifecycleSignals)
    .slice(0, MAX_EPISODE_LIFECYCLE_SIGNALS);
  const result = observedResultFacts(events, episode, {
    editCount,
    checkCount: allChecks.length,
    activity,
  });
  const workTrace = observedWorkTrace(events, result);
  if (editCount === 0
    && allChecks.length === 0
    && otherFailures === 0
    && permissionDenials === 0
    && activity.toolCalls === 0
    && mechanisms.length === 0
    && result.structuredCompletionObserved !== true
    && result.userCorrectionObserved !== true) {
    return { _omitReason: "low-signal" };
  }

  const closure = closureLabel(episode.closure, {
    editCount,
    checkCount: allChecks.length,
    checks: allChecks,
  });
  const repair = repairLabel(episode.repair);
  const acceptanceSignals = observedAcceptanceSignals({
    editCount,
    checks: allChecks,
    result,
    repair,
  });
  const frictionConsequenceSignals = observedFrictionConsequenceSignals({
    checks: allChecks,
    permissionDenials,
    result,
    repair,
  });
  const evidenceClasses = candidateEvidenceClasses({
    input,
    lifecycle,
    editCount,
    checks: allChecks,
    otherFailures,
    permissionDenials,
    mechanisms,
    activity,
    result,
    repair,
  });

  return {
    request: {
      summary: input.request,
      key: requestKey,
      occurrences: 1,
      ...(input.intermediate ? { intermediate: input.intermediate } : {}),
      ...(input.followUp ? { followUp: input.followUp } : {}),
      observedTurns: nonNegativeInteger(input.observedTurns),
      omittedTurns: nonNegativeInteger(input.omittedTurns),
    },
    changes: {
      edits: editCount,
      files: fileCount,
    },
    evidenceClasses,
    acceptanceSignals,
    acceptanceEvidenceCeiling: acceptanceEvidenceCeiling(acceptanceSignals),
    frictionConsequenceSignals,
    ...(activity.toolCalls > 0 ? { activity } : {}),
    ...(workTrace ? { workTrace } : {}),
    checks,
    ...(otherFailures > 0 || permissionDenials > 0
      ? { friction: { executionFailures: otherFailures, permissionDenials } }
      : {}),
    closure,
    ...(repair ? { repair } : {}),
    ...(mechanisms.length > 0 ? { mechanisms } : {}),
    ...(lifecycle.length > 0 ? { lifecycle } : {}),
    ...(Object.keys(result).length > 0 ? { result } : {}),
    _omittedChecks: Math.max(0, allChecks.length - checks.length),
    _evidenceClasses: evidenceClasses,
    _outcomeLead: isOutcomeLead({
      editCount,
      checks: allChecks,
      closure,
      repair,
    }),
    _priority: candidatePriority({
      editCount,
      checks: allChecks,
      otherFailures,
      permissionDenials,
      mechanisms,
      activity,
      result,
      closure,
      repair,
      input,
    }),
    _time: Date.parse(episode.lastSeen ?? "") || 0,
    _sessionKeys: [...new Set(episode.sessionIds ?? [])].map(String).filter(Boolean),
  };
}

function publicCandidate(candidate, index, contextGroup) {
  const {
    _evidenceClasses,
    _omittedChecks,
    _outcomeLead,
    _priority,
    _sessionKeys,
    _time,
    ...value
  } = candidate;
  return {
    ref: `E${index + 1}`,
    contextGroup,
    ...value,
    ...(candidate._omittedChecks > 0 ? { omittedChecks: candidate._omittedChecks } : {}),
  };
}

function candidateContextGroups(candidates = []) {
  const parent = candidates.map((_, index) => index);
  const find = (index) => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  const firstCandidateBySession = new Map();
  for (const [index, candidate] of candidates.entries()) {
    for (const sessionKey of candidate._sessionKeys ?? []) {
      const prior = firstCandidateBySession.get(sessionKey);
      if (prior === undefined) firstCandidateBySession.set(sessionKey, index);
      else union(prior, index);
    }
  }
  const labelByRoot = new Map();
  const result = new Map();
  for (const [index, candidate] of candidates.entries()) {
    const root = find(index);
    if (!labelByRoot.has(root)) labelByRoot.set(root, `G${labelByRoot.size + 1}`);
    result.set(candidate, labelByRoot.get(root));
  }
  return result;
}

function compactCheck(validation, resultFacts, relation) {
  const counts = resultFacts && typeof resultFacts === "object"
    ? Object.fromEntries(
        ["errors", "warnings", "testsPassed", "testsFailed"]
          .flatMap((key) => Number.isSafeInteger(resultFacts[key]) && resultFacts[key] >= 0
            ? [[key, resultFacts[key]]]
            : []),
      )
    : null;
  return {
    kind: safeLabel(validation?.category, 40) ?? "validation",
    status: ["passed", "failed", "observed"].includes(validation?.status)
      ? validation.status
      : "observed",
    relation,
    ...(counts && Object.keys(counts).length > 0
      ? { counts, countQuality: "parsed" }
      : validation?.status === "failed"
        ? { countQuality: "unavailable" }
        : {}),
  };
}

function finalChangeSet(changeSets = []) {
  return changeSets.reduce((latest, change) => {
    if (!latest) return change;
    const latestOrdinal = Number(latest?.lastOrdinal);
    const changeOrdinal = Number(change?.lastOrdinal);
    if (!Number.isFinite(latestOrdinal)) return change;
    if (!Number.isFinite(changeOrdinal)) return latest;
    return changeOrdinal > latestOrdinal ? change : latest;
  }, null);
}

function validationOccursAfterFinalChange(validation, finalChange) {
  const changeOrdinal = Number(finalChange?.lastOrdinal);
  const validationOrdinal = Number(validation?.ordinal);
  const hasChangeOrdinal = finalChange?.lastOrdinal !== null
    && finalChange?.lastOrdinal !== undefined
    && Number.isFinite(changeOrdinal);
  const hasValidationOrdinal = validation?.ordinal !== null
    && validation?.ordinal !== undefined
    && Number.isFinite(validationOrdinal);
  const changeMs = Date.parse(finalChange?.lastSeen ?? "");
  const validationMs = Date.parse(validation?.timestamp ?? "");
  const hasChangeTime = !Number.isNaN(changeMs);
  const hasValidationTime = !Number.isNaN(validationMs);
  if (hasChangeTime && hasValidationTime && changeMs !== validationMs) {
    return validationMs > changeMs;
  }
  if (hasChangeTime !== hasValidationTime) return false;
  return hasChangeOrdinal
    && hasValidationOrdinal
    && validationOrdinal > changeOrdinal;
}

function validationRelation(validation, finalChange) {
  if (!finalChange) return "no-change-context";
  if (!validationOccursAfterFinalChange(validation, finalChange)) return "not-after-final-change";
  return validation?.reviewedAssociation === true || validation?.relevance === "relevant"
    ? "reviewed-relevant-after-change"
    : "after-final-change-unreviewed";
}

function boundedChecks(checkRecords = [], repair = {}) {
  if (checkRecords.length <= MAX_EPISODE_CHECKS) {
    return checkRecords.map((record) => record.value);
  }

  const retainedIndexes = new Set();
  const indexByRef = new Map(checkRecords.flatMap((record, index) =>
    record.ref ? [[record.ref, index]] : []));
  for (const candidate of repair?.candidates ?? []) {
    const failureIndex = indexByRef.get(candidate?.failureValidationRef);
    const rerunIndex = indexByRef.get(candidate?.rerunValidationRef);
    if (failureIndex === undefined || rerunIndex === undefined) continue;
    retainedIndexes.add(failureIndex);
    retainedIndexes.add(rerunIndex);
    break;
  }

  if (retainedIndexes.size === 0) {
    const firstFailedIndex = checkRecords.findIndex((record) => record.value.status === "failed");
    retainedIndexes.add(firstFailedIndex >= 0 ? firstFailedIndex : 0);
  } else if (retainedIndexes.size < MAX_EPISODE_CHECKS) {
    retainedIndexes.add(0);
  }

  for (let index = checkRecords.length - 1;
    index >= 0 && retainedIndexes.size < MAX_EPISODE_CHECKS;
    index -= 1) {
    retainedIndexes.add(index);
  }
  return [...retainedIndexes]
    .sort((left, right) => left - right)
    .map((index) => checkRecords[index].value);
}

function compactLifecycleSignals(signals = []) {
  const values = [];
  const seen = new Set();
  for (const signal of Array.isArray(signals) ? signals : []) {
    const value = {
      intent: safeLabel(signal?.intent, 48),
      family: safeLabel(signal?.family, 40),
      dimensionId: safeLabel(signal?.dimensionId, 40),
      checkId: safeLabel(signal?.checkId, 40),
      confidence: ["High", "Medium", "Low"].includes(signal?.confidence)
        ? signal.confidence
        : "Medium",
    };
    if (!value.intent || !value.family || !value.dimensionId || !value.checkId) continue;
    const key = JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(value);
  }
  return values;
}

function observedResultFacts(events, episode, { editCount, checkCount, activity }) {
  const structuredCompletionObserved = events.some((event) => event?.taskCompleted === true);
  const userCorrectionObserved = events.some((event) => event?.userCorrection === true)
    || (episode?.learningSignals ?? []).some((signal) => signal?.userCorrection === true);
  const hasMaterialAction = editCount > 0
    || checkCount > 0
    || nonNegativeInteger(activity?.toolCalls) > 0;
  let assistantHandoffObserved = false;
  if (hasMaterialAction) {
    let lastMaterialOrdinal = -1;
    for (const [index, event] of events.entries()) {
      if (isMaterialActionEvent(event)) lastMaterialOrdinal = index;
    }
    assistantHandoffObserved = lastMaterialOrdinal >= 0
      && events.some((event, index) =>
        index > lastMaterialOrdinal && event?.userVisibleAssistantMessage === true);
  }
  return {
    ...(assistantHandoffObserved ? { assistantHandoffObserved: true } : {}),
    ...(structuredCompletionObserved ? { structuredCompletionObserved: true } : {}),
    ...(userCorrectionObserved ? { userCorrectionObserved: true } : {}),
  };
}

function observedAcceptanceSignals({ editCount, checks = [], result = {}, repair = null } = {}) {
  const signals = [];
  if (editCount > 0) signals.push("project-change");
  if (checks.length > 0) signals.push("check-observed");
  if (checks.some((check) => check?.relation === "reviewed-relevant-after-change")) {
    signals.push("reviewed-relevant-check");
  }
  if (result.assistantHandoffObserved === true) signals.push("assistant-handoff");
  if (result.structuredCompletionObserved === true) signals.push("structured-completion");
  if (result.userCorrectionObserved === true) signals.push("user-correction");
  if (repair === "failure-edit-rerun-candidate") signals.push("repair-lead");
  return signals;
}

function acceptanceEvidenceCeiling(signals = []) {
  if (signals.length === 0) return "unobserved";
  const hasReviewedValidation = signals.includes("reviewed-relevant-check");
  const hasOutcomeRelation = signals.includes("structured-completion")
    || signals.includes("user-correction");
  return hasReviewedValidation && hasOutcomeRelation ? "supported" : "lead";
}

function observedFrictionConsequenceSignals({
  checks = [],
  permissionDenials = 0,
  result = {},
  repair = null,
} = {}) {
  const signals = [];
  if (checks.some((check) => check?.status === "failed")) signals.push("failed-check");
  if (nonNegativeInteger(permissionDenials) > 0) signals.push("permission-denial");
  if (result.userCorrectionObserved === true) signals.push("user-correction");
  if (repair === "failure-edit-rerun-candidate") signals.push("repair-lead");
  return signals;
}

function isMaterialActionEvent(event) {
  return Boolean(event?.toolName
    || event?.functionCallName
    || event?.validationCategory
    || event?.episodeProgress === true
    || event?.operation === "edit"
    || event?.kind === "edit"
    || event?.type === "event.patch_apply_end");
}

function candidateEvidenceClasses({
  input,
  lifecycle,
  editCount,
  checks,
  otherFailures,
  permissionDenials,
  mechanisms,
  activity,
  result,
  repair,
}) {
  const classes = [];
  if (checks.length > 0 || repair) classes.push("validation-repair");
  if (input.followUp || result.userCorrectionObserved === true) classes.push("boundary-change");
  if (lifecycle.length > 0) classes.push("lifecycle-demand");
  if (otherFailures > 0 || permissionDenials > 0 || mechanisms.length > 0) {
    classes.push("operation-control");
  }
  if (result.structuredCompletionObserved === true || result.userCorrectionObserved === true) {
    classes.push("delivery-recovery");
  }
  if (editCount > 0 && checks.length === 0) classes.push("change-gap");
  if (editCount === 0 && nonNegativeInteger(activity?.toolCalls) > 0) {
    classes.push("read-only-work");
  }
  if (classes.length === 0) classes.push("activity-only");
  return classes;
}

function isOutcomeLead({ editCount, checks, closure, repair }) {
  if (["relevant-check-passed", "relevant-check-not-passed"].includes(closure)) return true;
  if (repair === "failure-edit-rerun-candidate") return true;
  if (checks.some((check) => check.relation === "after-final-change-unreviewed")) return true;
  return editCount === 0 && checks.length > 0;
}

function evidenceClassCounts(candidates = []) {
  const counts = Object.fromEntries(AGENT_WORK_LOOP_EVIDENCE_CLASSES.map((key) => [key, 0]));
  for (const candidate of candidates) {
    for (const evidenceClass of candidate?._evidenceClasses ?? candidate?.evidenceClasses ?? []) {
      if (Object.hasOwn(counts, evidenceClass)) counts[evidenceClass] += 1;
    }
  }
  return Object.fromEntries(Object.entries(counts).filter(([, count]) => count > 0));
}

function candidateObservationCoverage(candidates = []) {
  const count = (predicate) => candidates.filter(predicate).length;
  const hasResultSignal = (candidate) => Object.keys(candidate?.result ?? {}).length > 0;
  const hasAcceptanceSignal = (candidate, signal) =>
    (candidate?.acceptanceSignals ?? []).includes(signal);
  return {
    withChanges: count((candidate) => hasAcceptanceSignal(candidate, "project-change")),
    withChecks: count((candidate) => hasAcceptanceSignal(candidate, "check-observed")),
    withReviewedRelevantCheck: count((candidate) =>
      hasAcceptanceSignal(candidate, "reviewed-relevant-check")),
    withResultSignal: count(hasResultSignal),
    withAssistantHandoff: count((candidate) => candidate?.result?.assistantHandoffObserved === true),
    withStructuredCompletion: count((candidate) => candidate?.result?.structuredCompletionObserved === true),
    withUserCorrection: count((candidate) => candidate?.result?.userCorrectionObserved === true),
    withExecutionFriction: count((candidate) =>
      nonNegativeInteger(candidate?.friction?.executionFailures) > 0
      || nonNegativeInteger(candidate?.friction?.permissionDenials) > 0),
    withFrictionConsequence: count((candidate) =>
      (candidate?.frictionConsequenceSignals ?? []).length > 0),
  };
}

function candidateAdmissionSupport(candidates = []) {
  const refsBySignal = new Map();
  for (const candidate of candidates) {
    for (const signal of new Set(candidate?.frictionConsequenceSignals ?? [])) {
      const refs = refsBySignal.get(signal) ?? [];
      refs.push(candidate.ref);
      refsBySignal.set(signal, refs);
    }
  }
  const sharedFrictionConsequences = [...refsBySignal.entries()]
    .filter(([, episodeRefs]) => episodeRefs.length >= 2)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([signal, episodeRefs]) => ({ signal, episodeRefs }));
  return {
    semanticGuardrails: [...SESSION_CORE_SEMANTIC_GUARDRAILS],
    sharedFrictionConsequences,
  };
}

function safeEvidenceClassCounts(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(AGENT_WORK_LOOP_EVIDENCE_CLASSES.flatMap((key) =>
    Object.hasOwn(source, key) ? [[key, nonNegativeInteger(source[key])]] : []));
}

function groupByRequestKey(candidates) {
  const groups = new Map();
  for (const candidate of candidates) {
    const group = groups.get(candidate.request.key) ?? [];
    group.push(candidate);
    groups.set(candidate.request.key, group);
  }
  return groups;
}

function selectCandidatePortfolio(candidates, limit) {
  const ordered = candidates.slice().sort(compareCandidatePriority);
  const retained = [];
  const selected = new Set();
  const coveredClasses = new Set();

  const retain = (candidate) => {
    if (!candidate || selected.has(candidate) || retained.length >= limit) return false;
    retained.push(candidate);
    selected.add(candidate);
    for (const evidenceClass of candidate._evidenceClasses ?? []) {
      coveredClasses.add(evidenceClass);
    }
    return true;
  };

  const outcomeReservation = Math.min(2, limit);
  for (const candidate of ordered.filter((entry) => entry._outcomeLead)) {
    if (retained.filter((entry) => entry._outcomeLead).length >= outcomeReservation) break;
    retain(candidate);
  }

  for (const evidenceClass of AGENT_WORK_LOOP_EVIDENCE_CLASSES) {
    if (retained.length >= limit) break;
    if (coveredClasses.has(evidenceClass)) continue;
    retain(ordered.find((candidate) =>
      !selected.has(candidate) && candidate._evidenceClasses?.includes(evidenceClass)));
  }

  for (const candidate of ordered) {
    if (retained.length >= limit) break;
    retain(candidate);
  }

  return retained;
}

function compareCandidatePriority(left, right) {
  const leftPriority = left._priority ?? [];
  const rightPriority = right._priority ?? [];
  const width = Math.max(leftPriority.length, rightPriority.length);
  for (let index = 0; index < width; index += 1) {
    const difference = nonNegativeInteger(rightPriority[index])
      - nonNegativeInteger(leftPriority[index]);
    if (difference !== 0) return difference;
  }
  if (left._time !== right._time) return right._time - left._time;
  return String(left.request?.key ?? "").localeCompare(String(right.request?.key ?? ""));
}

function candidatePriority({
  editCount,
  checks,
  otherFailures,
  permissionDenials,
  mechanisms,
  activity,
  result,
  closure,
  repair,
  input,
}) {
  const closureStrength = closure === "relevant-check-passed"
    ? 5
    : closure === "relevant-check-not-passed"
      ? 4
      : repair === "failure-edit-rerun-candidate"
        ? 3
        : checks.some((check) => check.relation === "after-final-change-unreviewed")
          ? 2
          : checks.length > 0
            ? 1
            : 0;
  const riskStrength = permissionDenials > 0
    ? 3
    : otherFailures > 0
      ? 2
      : checks.some((check) => check.status === "failed")
        ? 1
        : 0;
  const deliveryStrength = result.userCorrectionObserved === true
    ? 3
    : result.structuredCompletionObserved === true
      ? 2
      : result.assistantHandoffObserved === true
        ? 1
        : 0;
  return [
    closureStrength,
    riskStrength,
    deliveryStrength,
    mechanisms.length > 0 ? 1 : 0,
    input.followUp ? 1 : 0,
    editCount > 0 ? 1 : 0,
    nonNegativeInteger(activity?.classifiedReads) > 0 ? 1 : 0,
    nonNegativeInteger(activity?.toolCalls) > 0 ? 1 : 0,
  ];
}

function normalizedToolName(event) {
  return String(event?.toolName ?? event?.functionCallName ?? "")
    .replace(/[^A-Za-z0-9_]/gu, "")
    .toLowerCase();
}

function observedWorkPhase(event) {
  if (event?.validationCategory) return "check";
  if (event?.operation === "edit"
    || event?.kind === "edit"
    || event?.type === "event.patch_apply_end") return "change";
  const name = normalizedToolName(event);
  if (!name) return null;
  const postOnly = ["post", "result"].includes(event?.lifecyclePhase)
    && event?.lifecycle?.preObserved !== true;
  if (postOnly) return null;
  if (/^(?:read|readfile|grep|glob|search|find|listfiles)$/u.test(name)) return "inspect";
  if (/^(?:edit|multiedit|write|notebookedit|notebookwrite|apply_patch|searchreplace)$/u.test(name)) return "change";
  if (/^(?:bash|exec_command|shell|terminal|runcommand)$/u.test(name)) return "execute";
  return null;
}

function observedWorkTrace(events, result) {
  const steps = [];
  for (const event of events) {
    const phase = observedWorkPhase(event);
    if (phase && steps.at(-1) !== phase) steps.push(phase);
  }
  if (result?.assistantHandoffObserved === true && steps.at(-1) !== "handoff") {
    steps.push("handoff");
  }
  if (steps.length === 0) return null;
  if (steps.length <= MAX_EPISODE_WORK_TRACE_STEPS) return { steps };
  const edgeWidth = Math.floor(MAX_EPISODE_WORK_TRACE_STEPS / 2);
  return {
    steps: [
      ...steps.slice(0, edgeWidth),
      ...steps.slice(-edgeWidth),
    ],
    gapAfter: edgeWidth,
    omittedSteps: steps.length - MAX_EPISODE_WORK_TRACE_STEPS,
  };
}

function observedProjectActivity(events) {
  let toolCalls = 0;
  let reads = 0;
  for (const event of events) {
    const name = normalizedToolName(event);
    if (!name) continue;
    if (/^(?:read|readfile|grep|glob|search|find|listfiles)$/u.test(name)) reads += 1;
    if (/^(?:read|readfile|grep|glob|search|find|listfiles|edit|multiedit|write|notebookedit|notebookwrite|apply_patch|searchreplace|bash|exec_command|skill)$/u.test(name)) {
      toolCalls += 1;
    }
  }
  return {
    toolCalls,
    ...(reads > 0 ? { classifiedReads: reads } : {}),
  };
}

function observedMechanisms(events, episode) {
  const mechanisms = [];
  for (const event of events) {
    const skills = [
      ...(Array.isArray(event?.skillNames) ? event.skillNames : []),
      ...(Array.isArray(event?.skillInvocations)
        ? event.skillInvocations.map((invocation) => invocation?.name)
        : []),
      event?.skillName,
    ];
    for (const skill of skills) {
      const label = safeLabel(skill, 48);
      if (label) mechanisms.push(`skill:${label}`);
    }
    const hook = safeLabel(event?.hookName, 48);
    if (hook) mechanisms.push(`hook:${hook}`);
  }
  if (nonNegativeInteger(episode?.permissionSummary?.protectedActions) > 0) {
    mechanisms.push("permission-boundary");
  }
  return [...new Set(mechanisms)];
}

function closureLabel(_closure = {}, { editCount = 0, checkCount = 0, checks = [] } = {}) {
  if (editCount === 0) return "no-change-observed";
  const relevant = checks.filter((check) => check.relation === "reviewed-relevant-after-change");
  if (relevant.some((check) => check.status === "passed")) return "relevant-check-passed";
  if (relevant.length > 0) return "relevant-check-not-passed";
  if (checkCount > 0) return "check-observed-relevance-unresolved";
  if (editCount > 0) return "changed-without-check";
  return "no-change-observed";
}

function repairLabel(repair = {}) {
  if ((repair.candidates ?? []).length > 0) return "failure-edit-rerun-candidate";
  if (repair.status === "unobserved") return "failure-without-confirmed-repair";
  return null;
}

function requestFingerprint(summary) {
  const normalized = String(summary)
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/<(?:path|id|secret|redacted)>/gu, " <private> ")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/^(?:please|can you|could you|would you|请|麻烦|帮我|你先|行啊)\s*/iu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return `req:${createHash("sha256").update(normalized).digest("hex").slice(0, 12)}`;
}

export function isGeneratedHarnessAnalysisRequest(summary) {
  const value = String(summary ?? "");
  return /^\/better-harness(?:\s|$)/iu.test(value)
    || /^#\s*Harness\s+Review the operating system around coding-agent work/iu.test(value)
    || /Analyze the selected project(?:'s)?[\s\S]{0,120}Harness\s+(?:practi\w*|report)/iu.test(value)
    || /(?:扫描所选项目的 Harness 工程实践|使用 \/better-harness 扫描|生成 Better Harness 报告)/iu.test(value)
    || /(?:installed Better Harness|Better Harness[^.]{0,80}model files)[\s\S]{0,120}(?:behavior probe|classify|Loop Engineering)/iu.test(value)
    || /^You are reviewing\s+.+?\s+as a read-only\s+.+?\s+reviewer\.[\s\S]{0,500}\bAssess whether\b/iu.test(value)
    || /^Based only on this evidence,\s*judge whether\b[\s\S]{0,500}\bRequirements?:/iu.test(value)
    || /(?:\.qoder\/better-harness|findings\.json[\s\S]{0,160}report\.canvas\.tsx)/iu.test(value)
    || /Create or overwrite only findings\.json, canvas\.json, and report\.canvas\.tsx/iu.test(value)
    || /attached JSON is the only session evidence input[\s\S]{0,800}(?:session-core-summary|session-evidence)\.md/iu.test(value)
    || /Before analyzing, completely read[\s\S]{0,800}(?:session-core-summary|session-evidence)\.md/iu.test(value)
    || /^Use readiness-analysis from the installed local [A-Za-z0-9._-]+-plugin\b[\s\S]{0,320}\b(?:smoke validation|output directory|create exactly two files)\b/iu.test(value)
    || /^#\s*Readiness Analysis\s+Analyze the target project as an AI delivery system/iu.test(value)
    || /better-harness-(?:skill-validation|outlier-retune)/iu.test(value)
    || /generate a [^\n]{0,120}session-usage efficiency report/iu.test(value)
    || /Benchmark second opinion[\s\S]{0,240}(?:Static-only benchmark mode|Return STRICT JSON only)/iu.test(value)
    || /(?:second opinion|第二意见)[\s\S]{0,80}reviewer[\s\S]{0,240}(?:static-only|不要声称执行测试)/iu.test(value)
    || /^Reply (?:with )?exactly:\s*[A-Za-z0-9_-]+\s*$/iu.test(value)
    || /\bbetter-harness(?::better-harness)?\b[\s\S]{0,160}\b(?:read-only\s+)?smoke test\b/iu.test(value)
    || /^Read-only smoke\b/iu.test(value)
    || /^Inspect these files only:[\s\S]{0,600}\bReturn JSON only\b[\s\S]{0,240}\bChecks?:/iu.test(value)
    || /^No tools\.\s*Based only on this current Better Harness\b/iu.test(value)
    || /受控验证[，,]?\s*不读取文件系统/iu.test(value)
    || /^You are validating\b[\s\S]{0,240}\bUse only the facts below\b[\s\S]{0,160}\bReturn JSON only\b/iu.test(value)
    || /^No tools\.[\s\S]{0,240}\boutput only\b/iu.test(value)
    || /Tools are disabled[\s\S]{0,240}Return concise JSON only/iu.test(value)
    || /blast radius check recommends AI review/iu.test(value)
    || /^#\s*Harness\s+Produce evidence-backed AI delivery readiness artifacts/iu.test(value)
    || /^#\s*Harness(?:\s+Analysis|\s+Default\b)/iu.test(value)
    || /^#\s*Harness\b[\s\S]{0,320}\bAgent Work Loop\b/iu.test(value)
    || /^Use (?:the\s+)?\$?[A-Za-z0-9._-]+-plugin:(?:harness-analysis|readiness-analysis)\b/iu.test(value)
    || /^(?:Use|使用)\s+(?:the\s+)?(?:\$?[A-Za-z0-9._-]+-plugin:)?(?:harness-analysis|readiness-analysis)\b/iu.test(value)
    || /^(?:Use|使用)\s+(?:the\s+)?better-harness:better-harness(?:\s+skill)?\b/iu.test(value)
    || /^Use the harness-analysis skill\b/iu.test(value)
    || /^Analyze\s+.{1,120}\s+as an AI Coding Harness\b/iu.test(value)
    || /^Read\s+.{1,160}\s+as a read-only\s+.{1,100}\s+reviewer\b/iu.test(value)
    || /^Read these local files only:[\s\S]{0,320}\bgenerated findings\.json\b/iu.test(value)
    || /\bread-only\s+(?:Agent Work Loop\s+)?Bavi evaluation\b/iu.test(value)
    || /只读验证[\s\S]{0,220}\bBetter Harness Agent Fluency\b/iu.test(value)
    || /Read the attached compact observability reference[\s\S]{0,420}Evaluate (?:direct AI-debug readiness|the (?:current|general) local runtime-debug route)/iu.test(value)
    || /\bExists\b[\s\S]{0,240}\bApplied\b[\s\S]{0,240}\bEffective\b[\s\S]{0,240}PROTOCOL_VERDICT/iu.test(value)
    || /(?:只读前向验证|Agent 知识资产闭环)[\s\S]{0,360}\bExists\b[\s\S]{0,180}\bEffective\b/iu.test(value)
    || /^import subprocess,\s*pathlib,[\s\S]{0,320}\bprojects\s*=\s*\[/iu.test(value)
    || /^import subprocess,\s*(?:textwrap|time|sys|pathlib)[\s\S]{0,360}\bprojects\s*=\s*\[/iu.test(value)
    || /^import subprocess,\s*(?:textwrap|time|sys|pathlib)[\s\S]{0,640}\b(?:harness-analysis|readiness target|report\.canvas\.tsx)\b/iu.test(value)
    || /只读取[\s\S]{0,160}然后只回答\s*[A-Z0-9_-]+[。.]?[\s\S]{0,80}不要修改/iu.test(value)
    || /^(?:from __future__ import annotations\s+)?[\s\S]{0,640}\bREPORT_ROOT\s*=\s*Path\(/iu.test(value)
    || /^使用\s+\$?harness-analysis\b/iu.test(value)
    || /^You are reviewing Better Harness\b[\s\S]{0,160}\btemplates?\b[\s\S]{0,160}\bDo not edit files\b[\s\S]{0,160}\bacceptance criteria\b/iu.test(value);
}

function isFailureEvent(event) {
  return event?.success === false
    || event?.hasError === true
    || event?.type === "PostToolUseFailure";
}

function boundedLimit(value) {
  const parsed = Number(value ?? DEFAULT_EPISODE_FACT_LIMIT);
  if (!Number.isFinite(parsed)) return DEFAULT_EPISODE_FACT_LIMIT;
  return Math.max(1, Math.min(MAX_EPISODE_FACT_LIMIT, Math.trunc(parsed)));
}

function safeBoundary(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function safeLabel(value, limit) {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._:@+-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, limit);
  return normalized || null;
}

function nonNegativeInteger(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
}

function withCost(envelope) {
  let value = { ...envelope, cost: { serializedBytes: 0, estimatedTokens: 0 } };
  for (let index = 0; index < 3; index += 1) {
    const serialized = JSON.stringify(value);
    const cost = {
      serializedBytes: Buffer.byteLength(serialized, "utf8"),
      estimatedTokens: estimateInputTokens(serialized),
    };
    if (cost.serializedBytes === value.cost.serializedBytes
      && cost.estimatedTokens === value.cost.estimatedTokens) return value;
    value = { ...envelope, cost };
  }
  return value;
}

function estimateInputTokens(value) {
  let ascii = 0;
  let nonAscii = 0;
  for (const character of String(value ?? "")) {
    if (character.codePointAt(0) <= 0x7f) ascii += 1;
    else nonAscii += 1;
  }
  return Math.ceil(ascii / 4) + nonAscii;
}

function serializedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function exceedsCostBudget(envelope, maxBytes) {
  const value = withCost(envelope);
  return serializedBytes(value) > maxBytes
    || value.cost.estimatedTokens > MAX_SESSION_CORE_FACT_TOKENS;
}
