import { createHash } from "node:crypto";

export const NATIVE_LEARNING_REVIEW_PACKET_SCHEMA_VERSION = 1;
export const NATIVE_LEARNING_REVIEW_KIND = "native-learning-candidate-review-packet";

export const NATIVE_LEARNING_PATTERN_IDS = Object.freeze([
  "recurring-correction",
]);

export const NATIVE_LEARNING_REVIEW_DECISIONS = Object.freeze(["match", "abstain"]);
export const NATIVE_LEARNING_MATCH_REASON_CODES = Object.freeze([
  "same-task-route",
  "same-target",
  "same-check",
  "explicit-user-correction",
  "same-check-repair",
]);
export const NATIVE_LEARNING_ABSTAIN_REASON_CODES = Object.freeze([
  "insufficient-comparability",
  "insufficient-evidence",
  "pattern-not-supported",
]);

const DEFAULT_LIMITS = Object.freeze({
  maxEpisodes: 24,
  maxGroups: 64,
  maxEvidenceRefsPerEpisode: 12,
});
const SAFE_EPISODE_ID_RE = /^episode:[a-f0-9]{12,64}$/u;
const SAFE_TARGET_KEY_RE = /^(?:target:)?[a-f0-9]{12,64}$/u;
const SAFE_CHECK_ID_RE = /^(?:check:)?[a-f0-9]{12,64}$/u;
const SAFE_ROUTE_RE = /^(?:lifecycle:)?[a-z0-9][a-z0-9._:/-]{0,79}$/u;
const SAFE_EVIDENCE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const SAFE_EVIDENCE_FINGERPRINT_RE = /^[a-f0-9]{16,128}$/u;
const PRIVATE_EVIDENCE_ID_RE = /(?:^session(?:[-_:]|$)|@|:\/\/|^[A-Za-z]:[\\/]|^\\\\|^\/(?:Users|home)\/)/iu;
const SAFE_EVIDENCE_ALIAS_RE = /^evidence-ref-[a-f0-9]{20}$/u;
const SAFE_DIGEST_RE = /^[a-f0-9]{64}$/u;
const FAILED_STATUS = new Set(["failed", "failure", "error", "errored"]);
const PROTECTIVE_FRICTION = "protective-intervention";
const OBSERVED_PROVENANCE = new Set(["host-observed", "deterministic-derived", "ai-reviewed"]);

function rows(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

function digest(value, length = 64) {
  return createHash("sha256").update(JSON.stringify(canonicalValue(value))).digest("hex").slice(0, length);
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function boundedInteger(value, fallback, minimum = 1, maximum = 256) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}

function normalizedLimits(value = {}) {
  return {
    maxEpisodes: boundedInteger(value.maxEpisodes, DEFAULT_LIMITS.maxEpisodes),
    maxGroups: boundedInteger(value.maxGroups, DEFAULT_LIMITS.maxGroups),
    maxEvidenceRefsPerEpisode: boundedInteger(
      value.maxEvidenceRefsPerEpisode,
      DEFAULT_LIMITS.maxEvidenceRefsPerEpisode,
    ),
  };
}

function observationState(values) {
  if (values.some((value) => value === true)) return "true";
  if (values.some((value) => value === false)) return "false";
  return "unavailable";
}

function safeEpisodeId(value) {
  const id = String(value ?? "").trim();
  if (!SAFE_EPISODE_ID_RE.test(id)) {
    throw new Error("native learning review requires privacy-safe Task Episode ids");
  }
  return id;
}

function safeRoute(value) {
  const route = String(value ?? "").trim().toLowerCase();
  return SAFE_ROUTE_RE.test(route) ? route : "";
}

function safeTarget(value) {
  const target = String(value ?? "").trim().toLowerCase();
  return SAFE_TARGET_KEY_RE.test(target) ? target : "";
}

function safeCheck(value) {
  const check = String(value ?? "").trim().toLowerCase();
  return SAFE_CHECK_ID_RE.test(check) ? check : "";
}

function safeEvidenceIdentity(reference) {
  const fingerprint = String(reference?.fingerprint ?? reference?.publicFingerprint ?? "").trim().toLowerCase();
  if (SAFE_EVIDENCE_FINGERPRINT_RE.test(fingerprint)) return "fingerprint:" + fingerprint;
  const id = String(reference?.id ?? "").trim();
  if (!SAFE_EVIDENCE_ID_RE.test(id) || PRIVATE_EVIDENCE_ID_RE.test(id)) return "";
  return "id:" + id;
}

function publicEvidenceRows(episode) {
  const references = [
    ...rows(episode?.evidenceRefs),
    ...rows(episode?.changeSets).flatMap((change) => rows(change?.evidenceRefs)),
    ...rows(episode?.validationSets).flatMap((validation) => rows(validation?.evidenceRefs)),
    ...rows(episode?.closure?.evidenceRefs),
    ...rows(episode?.repair?.evidenceRefs),
    ...rows(episode?.repair?.candidates).flatMap((candidate) => rows(candidate?.evidenceRefs)),
    ...rows(episode?.learningSignals).flatMap((signal) => rows(signal?.evidenceRefs)),
  ].map((reference) => ({
    kind: safeRoute(reference?.kind) || "evidence",
    sourceIdentity: safeEvidenceIdentity(reference),
  })).filter((reference) => reference.sourceIdentity);
  const byKey = new Map();
  for (const reference of references) {
    byKey.set(reference.kind + "\u0000" + reference.sourceIdentity, reference);
  }
  return [...byKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, reference]) => reference);
}

function evidenceAliases(episodeId, episode, maximum) {
  const all = publicEvidenceRows(episode);
  const selected = all.slice(0, maximum).map((reference) => ({
    evidenceRef: `evidence-ref-${digest({
      episodeId,
      kind: reference.kind,
      sourceIdentity: reference.sourceIdentity,
    }, 20)}`,
    kind: reference.kind,
  }));
  return {
    values: selected,
    bindingDigest: digest({ episodeId, identities: all }),
    totalCount: all.length,
    truncated: all.length > selected.length,
  };
}

function validationFailureObserved(episode) {
  return rows(episode?.validationSets).some((validation) => FAILED_STATUS.has(String(validation?.status ?? "").toLowerCase()));
}

function sameCheckRepairObserved(episode) {
  return rows(episode?.repair?.candidates).some((candidate) => candidate?.sameCheck === true
    && safeCheck(candidate?.failureCheckIdentity)
    && safeCheck(candidate?.failureCheckIdentity) === safeCheck(candidate?.rerunCheckIdentity));
}

function protectiveState(episode) {
  const signals = rows(episode?.learningSignals);
  return observationState([
    episode?.protectiveInterventionObserved,
    Number(episode?.permissionSummary?.protectedActions ?? 0) > 0 ? true : undefined,
    Number(episode?.permissionSummary?.denied ?? 0) > 0 ? true : undefined,
    ...signals.map((signal) => signal?.frictionType === PROTECTIVE_FRICTION ? true : undefined),
  ]);
}

function correctionState(episode) {
  return observationState([
    ...rows(episode?.learningSignals).map((signal) => {
      const coverage = signal?.fieldEvidence?.userCorrection?.coverage;
      if (coverage === "unavailable") return undefined;
      if (coverage === "observed" && typeof signal?.userCorrection === "boolean") return signal.userCorrection;
      const provenance = signal?.fieldProvenance?.userCorrection;
      if (typeof signal?.userCorrection === "boolean"
        && (signal.userCorrection === true || OBSERVED_PROVENANCE.has(provenance))) {
        return signal.userCorrection;
      }
      return undefined;
    }),
  ]);
}

function taskRoutes(episode) {
  return uniqueSorted([
    safeRoute(episode?.taskRoute),
    ...rows(episode?.lifecycleSignals).map((signal) => safeRoute(signal?.intent)),
  ]);
}

function targetRefs(episode) {
  return uniqueSorted([
    ...rows(episode?.targetKeys).map(safeTarget),
    ...rows(episode?.changeSets).flatMap((change) => rows(change?.targetKeys).map(safeTarget)),
    ...rows(episode?.validationSets).flatMap((validation) => rows(validation?.targetKeys).map(safeTarget)),
  ]);
}

function checkRefs(episode) {
  return uniqueSorted([
    ...rows(episode?.validationSets).map((validation) => safeCheck(validation?.checkIdentity)),
    ...rows(episode?.repair?.candidates).flatMap((candidate) => [
      safeCheck(candidate?.failureCheckIdentity),
      safeCheck(candidate?.rerunCheckIdentity),
    ]),
  ]);
}

function projectedEpisodeFact(episode, limits) {
  const episodeRef = safeEpisodeId(episode?.id);
  const evidence = evidenceAliases(episodeRef, episode, limits.maxEvidenceRefsPerEpisode);
  const userCorrection = correctionState(episode);
  const sameCheckRepair = sameCheckRepairObserved(episode);
  const validationFailure = validationFailureObserved(episode);
  const frictionKinds = uniqueSorted([
    userCorrection === "true" ? "explicit-user-correction" : "",
    sameCheckRepair ? "same-check-repair" : "",
    validationFailure ? "validation-failure" : "",
  ]);
  return {
    episodeRef,
    taskRoutes: taskRoutes(episode),
    targetRefs: targetRefs(episode),
    checkRefs: checkRefs(episode),
    facts: {
      userCorrection,
      protectiveIntervention: protectiveState(episode),
      sameCheckRepair: sameCheckRepair ? "true" : "false",
      validationFailure: validationFailure ? "true" : "false",
    },
    frictionKinds,
    evidenceRefs: evidence.values.map((row) => row.evidenceRef),
    evidenceCoverage: {
      status: evidence.totalCount === 0 ? "unavailable" : evidence.truncated ? "truncated" : "bounded",
      includedCount: evidence.values.length,
      totalCount: evidence.totalCount,
      identitySetDigest: evidence.bindingDigest,
    },
  };
}

function intersection(left, right) {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function comparableGroup(left, right) {
  if (left.facts.protectiveIntervention === "true" || right.facts.protectiveIntervention === "true") return null;
  if (left.evidenceRefs.length === 0 || right.evidenceRefs.length === 0) return null;
  const sharedTaskRoutes = intersection(left.taskRoutes, right.taskRoutes);
  const sharedTargets = intersection(left.targetRefs, right.targetRefs);
  const sharedChecks = intersection(left.checkRefs, right.checkRefs);
  if (sharedTaskRoutes.length === 0 && sharedTargets.length === 0 && sharedChecks.length === 0) return null;

  const allowedPatternIds = [];
  const correctionShape = uniqueSorted([
    left.facts.userCorrection === "true" && right.facts.userCorrection === "true" ? "explicit-user-correction" : "",
    left.facts.sameCheckRepair === "true" && right.facts.sameCheckRepair === "true" ? "same-check-repair" : "",
  ]);
  if (correctionShape.length > 0) {
    allowedPatternIds.push("recurring-correction");
  }
  if (allowedPatternIds.length === 0) return null;

  const reasonCodes = uniqueSorted([
    sharedTaskRoutes.length > 0 ? "same-task-route" : "",
    sharedTargets.length > 0 ? "same-target" : "",
    sharedChecks.length > 0 ? "same-check" : "",
    left.facts.userCorrection === "true" && right.facts.userCorrection === "true" ? "explicit-user-correction" : "",
    left.facts.sameCheckRepair === "true" && right.facts.sameCheckRepair === "true" ? "same-check-repair" : "",
  ]);
  const episodeRefs = [left.episodeRef, right.episodeRef].sort();
  const groupBasis = {
    allowedPatternIds: allowedPatternIds.sort(),
    sharedTaskRoutes,
    sharedTargets,
    sharedChecks,
    correctionShape,
  };
  return {
    groupKey: digest(groupBasis, 20),
    episodeRefs,
    allowedPatternIds: groupBasis.allowedPatternIds,
    reasonCodes,
    sharedIdentity: {
      taskRoutes: sharedTaskRoutes,
      targetRefs: sharedTargets,
      checkRefs: sharedChecks,
    },
    correctionShape,
    evidenceRefs: uniqueSorted([...left.evidenceRefs, ...right.evidenceRefs]),
    evidenceOwnership: Object.fromEntries(episodeRefs.map((episodeRef) => {
      const fact = episodeRef === left.episodeRef ? left : right;
      return [episodeRef, [...fact.evidenceRefs]];
    })),
  };
}

function screeningGroups(episodeFacts) {
  const pairGroups = [];
  for (let left = 0; left < episodeFacts.length; left += 1) {
    for (let right = left + 1; right < episodeFacts.length; right += 1) {
      const group = comparableGroup(episodeFacts[left], episodeFacts[right]);
      if (group) pairGroups.push(group);
    }
  }
  const byKey = new Map();
  for (const pair of pairGroups) {
    const merged = byKey.get(pair.groupKey) ?? {
      groupKey: pair.groupKey,
      episodeRefs: [],
      allowedPatternIds: [...pair.allowedPatternIds],
      reasonCodes: [],
      sharedIdentity: pair.sharedIdentity,
      correctionShape: [...pair.correctionShape],
      evidenceRefs: [],
      evidenceOwnership: {},
    };
    merged.episodeRefs = uniqueSorted([...merged.episodeRefs, ...pair.episodeRefs]);
    merged.reasonCodes = uniqueSorted([...merged.reasonCodes, ...pair.reasonCodes]);
    merged.evidenceRefs = uniqueSorted([...merged.evidenceRefs, ...pair.evidenceRefs]);
    for (const [episodeRef, evidenceRefs] of Object.entries(pair.evidenceOwnership)) {
      merged.evidenceOwnership[episodeRef] = uniqueSorted([
        ...rows(merged.evidenceOwnership[episodeRef]),
        ...evidenceRefs,
      ]);
    }
    byKey.set(pair.groupKey, merged);
  }
  return collapseSubsumedGroups([...byKey.values()].map(({ groupKey, ...group }) => ({
    groupRef: `learning-group:${digest({ groupKey, episodeRefs: group.episodeRefs }, 20)}`,
    patternSignature: `native-${groupKey}`,
    ...group,
    evidenceOwnership: Object.fromEntries(
      Object.entries(group.evidenceOwnership).sort(([left], [right]) => left.localeCompare(right)),
    ),
  })).sort((left, right) => left.groupRef.localeCompare(right.groupRef)));
}

function subsumes(outer, inner) {
  if (outer.groupRef === inner.groupRef) return false;
  if (outer.episodeRefs.length <= inner.episodeRefs.length) return false;
  const outerEpisodes = new Set(outer.episodeRefs);
  if (!inner.episodeRefs.every((episodeRef) => outerEpisodes.has(episodeRef))) return false;
  const outerPatternIds = new Set(outer.allowedPatternIds);
  return inner.allowedPatternIds.every((patternId) => outerPatternIds.has(patternId));
}

function collapseSubsumedGroups(groups) {
  const kept = groups.filter((group) => !groups.some((other) => subsumes(other, group)));
  return { groups: kept, subsumedCount: groups.length - kept.length };
}

function coverageFor(allEpisodeCount, episodeFacts, allGroups, selectedGroups, subsumedGroupCount = 0) {
  const episodeTruncated = allEpisodeCount > episodeFacts.length;
  const groupTruncated = allGroups.length > selectedGroups.length;
  const evidenceTruncated = episodeFacts.some((episode) => episode.evidenceCoverage.status === "truncated");
  const missingEvidenceEpisodeCount = episodeFacts.filter((episode) => episode.evidenceCoverage.status === "unavailable").length;
  const protectiveEpisodeCount = episodeFacts.filter((episode) => episode.facts.protectiveIntervention === "true").length;
  const status = episodeTruncated || groupTruncated || evidenceTruncated
    ? "partial-truncated"
    : selectedGroups.length > 0
      ? "candidate-groups-present"
      : episodeFacts.length < 2
        ? "insufficient-episodes"
        : missingEvidenceEpisodeCount > 0
          ? "insufficient-evidence"
          : "insufficient-comparability";
  return {
    status,
    inputEpisodeCount: allEpisodeCount,
    includedEpisodeCount: episodeFacts.length,
    candidateGroupCount: selectedGroups.length,
    totalCandidateGroupCount: allGroups.length,
    subsumedGroupCount,
    protectiveEpisodeCount,
    missingEvidenceEpisodeCount,
    truncated: episodeTruncated || groupTruncated || evidenceTruncated,
    reasonCodes: uniqueSorted([
      episodeTruncated ? "episode-limit-reached" : "",
      groupTruncated ? "group-limit-reached" : "",
      evidenceTruncated ? "evidence-limit-reached" : "",
      missingEvidenceEpisodeCount > 0 ? "missing-evidence" : "",
      protectiveEpisodeCount > 0 ? "protective-intervention-excluded" : "",
      subsumedGroupCount > 0 ? "subsumed-group-collapsed" : "",
      selectedGroups.length === 0 && episodeFacts.length >= 2 ? "no-comparable-group" : "",
    ]),
  };
}

function packetPayload(packet) {
  const { packetDigest: _packetDigest, ...payload } = packet ?? {};
  return payload;
}

export function nativeLearningReviewPacketDigest(packet) {
  return digest(packetPayload(packet));
}

export function nativeLearningReviewSourceDigest({ episodeFacts, groups, limits } = {}) {
  return digest({ episodeFacts, groups, limits });
}

function storedObjectFields(value, allowedFields, location, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${location} must be an object`);
    return false;
  }
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) errors.push(`${location} has unsupported field: ${field}`);
  }
  return true;
}

function storedSortedStrings(value, predicate, location, errors, { sorted = true } = {}) {
  if (!Array.isArray(value)) {
    errors.push(`${location} must be an array`);
    return [];
  }
  if (value.some((item) => typeof item !== "string" || !predicate(item))) {
    errors.push(`${location} contains an invalid value`);
  }
  const expected = sorted ? uniqueSorted(value) : [...new Set(value)];
  if (JSON.stringify(value) !== JSON.stringify(expected)) {
    errors.push(`${location} must contain distinct${sorted ? " sorted" : ""} values`);
  }
  return value;
}

function storedEpisodeFactErrors(fact, index, limits) {
  const location = `native learning review packet episodeFacts[${index}]`;
  const errors = [];
  if (!storedObjectFields(
    fact,
    new Set(["episodeRef", "taskRoutes", "targetRefs", "checkRefs", "facts", "frictionKinds", "evidenceRefs", "evidenceCoverage"]),
    location,
    errors,
  )) return errors;
  if (!SAFE_EPISODE_ID_RE.test(String(fact.episodeRef ?? ""))) errors.push(`${location}.episodeRef is invalid`);
  storedSortedStrings(fact.taskRoutes, (value) => safeRoute(value) === value, `${location}.taskRoutes`, errors);
  storedSortedStrings(fact.targetRefs, (value) => safeTarget(value) === value, `${location}.targetRefs`, errors);
  storedSortedStrings(fact.checkRefs, (value) => safeCheck(value) === value, `${location}.checkRefs`, errors);
  const factStates = fact.facts;
  if (storedObjectFields(
    factStates,
    new Set(["userCorrection", "protectiveIntervention", "sameCheckRepair", "validationFailure"]),
    `${location}.facts`,
    errors,
  )) {
    const observationStates = new Set(["true", "false", "unavailable"]);
    if (!observationStates.has(factStates.userCorrection)) errors.push(`${location}.facts.userCorrection is invalid`);
    if (!observationStates.has(factStates.protectiveIntervention)) errors.push(`${location}.facts.protectiveIntervention is invalid`);
    if (!new Set(["true", "false"]).has(factStates.sameCheckRepair)) errors.push(`${location}.facts.sameCheckRepair is invalid`);
    if (!new Set(["true", "false"]).has(factStates.validationFailure)) errors.push(`${location}.facts.validationFailure is invalid`);
  }
  const expectedFriction = uniqueSorted([
    factStates?.userCorrection === "true" ? "explicit-user-correction" : "",
    factStates?.sameCheckRepair === "true" ? "same-check-repair" : "",
    factStates?.validationFailure === "true" ? "validation-failure" : "",
  ]);
  storedSortedStrings(
    fact.frictionKinds,
    (value) => ["explicit-user-correction", "same-check-repair", "validation-failure"].includes(value),
    `${location}.frictionKinds`,
    errors,
  );
  if (JSON.stringify(fact.frictionKinds) !== JSON.stringify(expectedFriction)) {
    errors.push(`${location}.frictionKinds does not match observed facts`);
  }
  const evidenceRefs = storedSortedStrings(
    fact.evidenceRefs,
    (value) => SAFE_EVIDENCE_ALIAS_RE.test(value),
    `${location}.evidenceRefs`,
    errors,
    { sorted: false },
  );
  if (evidenceRefs.length > limits.maxEvidenceRefsPerEpisode) {
    errors.push(`${location}.evidenceRefs exceeds the packet limit`);
  }
  const coverage = fact.evidenceCoverage;
  if (storedObjectFields(
    coverage,
    new Set(["status", "includedCount", "totalCount", "identitySetDigest"]),
    `${location}.evidenceCoverage`,
    errors,
  )) {
    const includedCount = Number(coverage.includedCount);
    const totalCount = Number(coverage.totalCount);
    if (!Number.isInteger(includedCount) || includedCount !== evidenceRefs.length) {
      errors.push(`${location}.evidenceCoverage.includedCount does not match evidenceRefs`);
    }
    if (!Number.isInteger(totalCount) || totalCount < includedCount) {
      errors.push(`${location}.evidenceCoverage.totalCount is invalid`);
    }
    const expectedStatus = totalCount === 0 ? "unavailable" : totalCount > includedCount ? "truncated" : "bounded";
    if (coverage.status !== expectedStatus) errors.push(`${location}.evidenceCoverage.status is invalid`);
    if (!SAFE_DIGEST_RE.test(String(coverage.identitySetDigest ?? ""))) {
      errors.push(`${location}.evidenceCoverage.identitySetDigest is invalid`);
    }
  }
  return errors;
}

export function validateStoredNativeLearningReviewPacket(packet) {
  const errors = [];
  const allowedFields = new Set(["schemaVersion", "kind", "sourceDigest", "limits", "allowed", "episodeFacts", "groups", "coverage", "packetDigest"]);
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) return ["native learning review packet must be an object"];
  for (const field of Object.keys(packet)) if (!allowedFields.has(field)) errors.push(`native learning review packet has unsupported field: ${field}`);
  if (packet.schemaVersion !== NATIVE_LEARNING_REVIEW_PACKET_SCHEMA_VERSION) errors.push(`native learning review packet schemaVersion must be ${NATIVE_LEARNING_REVIEW_PACKET_SCHEMA_VERSION}`);
  if (packet.kind !== NATIVE_LEARNING_REVIEW_KIND) errors.push("native learning review packet kind is invalid");
  if (packet.packetDigest !== nativeLearningReviewPacketDigest(packet)) errors.push("native learning review packet digest does not match its content");
  if (packet.sourceDigest !== nativeLearningReviewSourceDigest(packet)) errors.push("native learning review packet sourceDigest does not match episode facts, groups, and limits");
  const limitsAreObject = packet.limits && typeof packet.limits === "object" && !Array.isArray(packet.limits);
  const limits = limitsAreObject ? normalizedLimits(packet.limits) : normalizedLimits();
  if (!limitsAreObject || JSON.stringify(packet.limits) !== JSON.stringify(limits)) errors.push("native learning review packet limits are invalid");
  const expectedAllowed = {
    decisions: [...NATIVE_LEARNING_REVIEW_DECISIONS],
    patternIds: [...NATIVE_LEARNING_PATTERN_IDS],
    matchReasonCodes: [...NATIVE_LEARNING_MATCH_REASON_CODES],
    abstainReasonCodes: [...NATIVE_LEARNING_ABSTAIN_REASON_CODES],
  };
  if (JSON.stringify(canonicalValue(packet.allowed)) !== JSON.stringify(canonicalValue(expectedAllowed))) errors.push("native learning review packet allowed enums are invalid");
  if (!Array.isArray(packet.episodeFacts) || !Array.isArray(packet.groups) || !packet.coverage || typeof packet.coverage !== "object" || Array.isArray(packet.coverage)) {
    errors.push("native learning review packet requires episodeFacts, groups, and coverage");
    return [...new Set(errors)].sort();
  }
  if (packet.episodeFacts.length > limits.maxEpisodes) errors.push("native learning review packet episodeFacts exceeds the packet limit");
  for (const [index, fact] of packet.episodeFacts.entries()) {
    errors.push(...storedEpisodeFactErrors(fact, index, limits));
  }
  const episodeRefs = packet.episodeFacts.map((fact) => fact?.episodeRef);
  if (JSON.stringify(episodeRefs) !== JSON.stringify(uniqueSorted(episodeRefs))) {
    errors.push("native learning review packet episodeFacts must have distinct sorted Episode refs");
  }
  if (errors.some((error) => error.includes("episodeFacts"))) return [...new Set(errors)].sort();
  const { groups: allGroups, subsumedCount } = screeningGroups(packet.episodeFacts);
  const expectedGroups = allGroups.slice(0, limits.maxGroups);
  if (JSON.stringify(canonicalValue(packet.groups)) !== JSON.stringify(canonicalValue(expectedGroups))) {
    errors.push("native learning review packet groups do not match retained Episode facts");
  }
  const inputEpisodeCount = Number(packet.coverage.inputEpisodeCount);
  if (!Number.isInteger(inputEpisodeCount) || inputEpisodeCount < packet.episodeFacts.length) {
    errors.push("native learning review packet coverage inputEpisodeCount is invalid");
  } else {
    const expectedCoverage = coverageFor(
      inputEpisodeCount,
      packet.episodeFacts,
      allGroups,
      expectedGroups,
      subsumedCount,
    );
    if (JSON.stringify(canonicalValue(packet.coverage)) !== JSON.stringify(canonicalValue(expectedCoverage))) {
      errors.push("native learning review packet coverage does not match retained groups and Episode facts");
    }
  }
  return [...new Set(errors)].sort();
}

export function buildNativeLearningReviewPacket({ episodes = [], limits: suppliedLimits = {} } = {}) {
  const limits = normalizedLimits(suppliedLimits);
  const byId = new Map();
  for (const episode of rows(episodes)) {
    const episodeId = safeEpisodeId(episode?.id);
    const candidates = byId.get(episodeId) ?? [];
    candidates.push(episode);
    byId.set(episodeId, candidates);
  }
  const allEpisodeCount = byId.size;
  const episodeFacts = [...byId.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, limits.maxEpisodes)
    .map(([, candidates]) => {
      const projections = candidates.map((candidate) => projectedEpisodeFact(candidate, limits));
      const distinct = new Map(projections.map((candidate) => [JSON.stringify(canonicalValue(candidate)), candidate]));
      if (distinct.size !== 1) {
        throw new Error("native learning review rejects conflicting duplicate Task Episode projections");
      }
      return distinct.values().next().value;
    })
    .sort((left, right) => left.episodeRef.localeCompare(right.episodeRef));
  const { groups: allGroups, subsumedCount } = screeningGroups(episodeFacts);
  const groups = allGroups.slice(0, limits.maxGroups);
  const safeSourceProjection = { episodeFacts, groups, limits };
  const packet = {
    schemaVersion: NATIVE_LEARNING_REVIEW_PACKET_SCHEMA_VERSION,
    kind: NATIVE_LEARNING_REVIEW_KIND,
    sourceDigest: nativeLearningReviewSourceDigest(safeSourceProjection),
    limits,
    allowed: {
      decisions: [...NATIVE_LEARNING_REVIEW_DECISIONS],
      patternIds: [...NATIVE_LEARNING_PATTERN_IDS],
      matchReasonCodes: [...NATIVE_LEARNING_MATCH_REASON_CODES],
      abstainReasonCodes: [...NATIVE_LEARNING_ABSTAIN_REASON_CODES],
    },
    episodeFacts,
    groups,
    coverage: coverageFor(allEpisodeCount, episodeFacts, allGroups, groups, subsumedCount),
  };
  packet.packetDigest = nativeLearningReviewPacketDigest(packet);
  return packet;
}

export function validateNativeLearningReviewPacket({ episodes = [], packet } = {}) {
  const errors = [...validateStoredNativeLearningReviewPacket(packet)];
  let expected;
  try {
    expected = buildNativeLearningReviewPacket({ episodes, limits: packet?.limits });
  } catch (error) {
    errors.push(error.message);
    return [...new Set(errors)];
  }
  for (const field of ["sourceDigest", "limits", "allowed", "episodeFacts", "groups", "coverage"]) {
    if (digest(packet?.[field]) !== digest(expected[field])) {
      errors.push(`native learning review packet ${field} does not match the current privacy-safe source projection`);
    }
  }
  return [...new Set(errors)];
}
