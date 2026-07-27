const TASK_UNDERSTANDING_CHECK_IDS = Object.freeze([
  "goal-understanding",
  "relevant-context",
  "scope-boundary",
]);

export const DELIVERY_PROVIDERS = Object.freeze([
  "codex-host", "qoder-host", "github", "gitlab", "npm", "vercel",
  "kubernetes", "git", "manual",
]);
export const DELIVERY_KINDS = Object.freeze([
  "validation", "acceptance", "approval", "release", "deployment", "recovery",
]);

const TASK_STATES = new Set(["Exercised", "Unobserved", "Not applicable"]);
const DELIVERY_STATUSES = new Set([
  "observed", "passed", "accepted", "approved", "allowed", "blocked", "denied",
  "succeeded", "failed", "rolled-back", "recovered",
]);
const ABSOLUTE_PATH_RE = /(?:^|\s)(?:\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)+|[A-Za-z]:[\\/][^\s]+)/u;

function rows(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeSummary(value, label, { required = true } = {}) {
  const summary = typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
  if (required && !summary) throw new Error(`${label} requires a summary`);
  if (summary.length > 280) throw new Error(`${label} summary must contain at most 280 characters`);
  if (ABSOLUTE_PATH_RE.test(summary)) throw new Error(`${label} summary must not contain an absolute path`);
  return summary;
}

function evidenceRefs(value, label, { required = true } = {}) {
  const refs = rows(value);
  if (required && refs.length === 0) throw new Error(`${label} requires evidenceRefs`);
  return clone(refs);
}

function requiredTaskChecks(review, episodeId) {
  const supplied = new Map(rows(review?.taskUnderstanding).map((row) => [row?.id, row]));
  return TASK_UNDERSTANDING_CHECK_IDS.map((id) => {
    const row = supplied.get(id) ?? { id, state: "Unobserved", summary: "", evidenceRefs: [] };
    if (!TASK_STATES.has(row.state)) throw new Error(`episodeReviews ${episodeId} ${id} has unsupported state ${row.state}`);
    if (row.state === "Exercised") {
      return {
        id,
        state: row.state,
        summary: safeSummary(row.summary, `episodeReviews ${episodeId} ${id}`),
        evidenceRefs: evidenceRefs(row.evidenceRefs, `episodeReviews ${episodeId} ${id}`),
      };
    }
    return {
      id,
      state: row.state,
      summary: safeSummary(row.summary, `episodeReviews ${episodeId} ${id}`, { required: false }),
      evidenceRefs: evidenceRefs(row.evidenceRefs, `episodeReviews ${episodeId} ${id}`, { required: false }),
    };
  });
}

function applyValidationReview(episode, review) {
  const changes = new Map(rows(episode.changeSets).map((row) => [row.id, row]));
  const validations = new Map(rows(episode.validationSets).map((row) => [row.id, row]));
  const associations = rows(review?.validationAssociations).map((association, index) => {
    const label = `episodeReviews ${episode.id} validationAssociations[${index}]`;
    const change = changes.get(association?.changeSetRef);
    const validation = validations.get(association?.validationSetRef);
    if (!change) throw new Error(`${label} references an unknown change set`);
    if (!validation) throw new Error(`${label} references an unknown validation set`);
    if (association?.relation !== "relevant-after-change") throw new Error(`${label} relation must be relevant-after-change`);
    if (Number(validation.ordinal) <= Number(change.lastOrdinal)) throw new Error(`${label} validation must occur after the retained change`);
    return {
      id: String(association?.id ?? `${episode.id}:association-${index + 1}`),
      changeSetRef: change.id,
      validationSetRef: validation.id,
      relation: "relevant-after-change",
      summary: safeSummary(association?.summary, label),
      evidenceRefs: evidenceRefs(association?.evidenceRefs, label),
    };
  });

  const linked = associations.map((association) => validations.get(association.validationSetRef));
  const passed = linked.filter((validation) => validation?.status === "passed");
  const closure = changes.size === 0
    ? { status: "not-applicable", reason: "no-edit-observed", relevantValidationCount: 0, evidenceRefs: [] }
    : associations.length === 0
      ? { status: "unobserved", reason: "no-reviewed-validation-association", relevantValidationCount: 0, evidenceRefs: [] }
      : {
          status: passed.length > 0 ? "closed" : "observed-without-pass",
          reason: passed.length > 0 ? "reviewed-relevant-validation-passed" : "reviewed-relevant-validation-not-passed",
          relevantValidationCount: linked.length,
          relevantValidationPassedCount: passed.length,
          evidenceRefs: clone(associations.flatMap((association) => association.evidenceRefs)),
        };
  return { associations, closure };
}

function applyRepairReview(episode, review) {
  const repairReview = review?.repairReview;
  if (!repairReview || repairReview.state !== "repaired-and-passed") return episode.repair;
  const candidate = rows(episode?.repair?.candidates).find((row) => row.id === repairReview.candidateRef);
  if (!candidate) throw new Error(`episodeReviews ${episode.id} repairReview references an unknown repair candidate`);
  const reproductionRefs = evidenceRefs(repairReview.reproductionEvidenceRefs, `episodeReviews ${episode.id} repairReview reproduction`);
  const diagnosisRefs = evidenceRefs(repairReview.diagnosisEvidenceRefs, `episodeReviews ${episode.id} repairReview diagnosis`);
  const diagnosis = safeSummary(repairReview.diagnosis, `episodeReviews ${episode.id} repairReview diagnosis`);
  let equivalenceReason;
  let equivalenceEvidenceRefs = [];
  if (!candidate.sameCheck) {
    equivalenceReason = safeSummary(repairReview.equivalenceReason, `episodeReviews ${episode.id} repairReview equivalence`);
    equivalenceEvidenceRefs = evidenceRefs(repairReview.equivalenceEvidenceRefs, `episodeReviews ${episode.id} repairReview equivalence`);
  }
  return {
    ...episode.repair,
    status: "repaired-and-passed",
    reason: candidate.sameCheck ? "reviewed-diagnosis-and-same-check-rerun" : "reviewed-diagnosis-and-equivalent-check-rerun",
    selectedCandidateRef: candidate.id,
    diagnosis,
    reproductionEvidenceRefs: reproductionRefs,
    diagnosisEvidenceRefs: diagnosisRefs,
    ...(equivalenceReason ? { equivalenceReason, equivalenceEvidenceRefs } : {}),
    evidenceRefs: clone([
      ...rows(candidate.evidenceRefs),
      ...reproductionRefs,
      ...diagnosisRefs,
      ...equivalenceEvidenceRefs,
    ]),
  };
}

export function applyEpisodeReviews(source, reviewRows) {
  const reviews = new Map(rows(reviewRows).map((row) => [row?.episodeRef, row]));
  for (const episodeRef of reviews.keys()) {
    if (!rows(source?.taskEpisodes).some((episode) => episode.id === episodeRef)) {
      throw new Error(`episodeReviews references an unknown task episode: ${episodeRef}`);
    }
  }
  source.taskEpisodes = rows(source?.taskEpisodes).map((episode) => {
    const review = reviews.get(episode.id);
    if (!review) return episode;
    const { associations, closure } = applyValidationReview(episode, review);
    const updated = {
      ...episode,
      taskUnderstanding: requiredTaskChecks(review, episode.id),
      validationAssociations: associations,
      closure,
    };
    updated.repair = applyRepairReview(updated, review);
    return updated;
  });
}

export function normalizeDeliveryReviews(source, reviewRows) {
  const episodeIds = new Set(rows(source?.taskEpisodes).map((episode) => episode.id));
  return rows(reviewRows).map((row, index) => {
    const label = `deliveryReviews[${index}]`;
    if (!episodeIds.has(row?.episodeRef)) throw new Error(`${label} references an unknown task episode`);
    if (!DELIVERY_PROVIDERS.includes(row?.provider)) throw new Error(`${label} has unsupported provider ${row?.provider}`);
    if (!DELIVERY_KINDS.includes(row?.kind)) throw new Error(`${label} has unsupported kind ${row?.kind}`);
    if (!DELIVERY_STATUSES.has(row?.status)) throw new Error(`${label} has unsupported status ${row?.status}`);
    if (["acceptance", "release", "deployment"].includes(row.kind)
      && !/^[a-f0-9]{40,64}$/u.test(String(row?.revision ?? ""))) {
      throw new Error(`${label} ${row.kind} requires a full revision digest`);
    }
    return {
      id: String(row?.id ?? `delivery-review-${index + 1}`),
      episodeRef: row.episodeRef,
      provider: row.provider,
      kind: row.kind,
      level: row.level,
      status: row.status,
      ...(row.revision ? { revision: String(row.revision) } : {}),
      summary: safeSummary(row.summary, label),
      evidenceRefs: evidenceRefs(row.evidenceRefs, label),
    };
  });
}
