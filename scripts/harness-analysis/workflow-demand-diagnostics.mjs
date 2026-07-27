import { createHash } from "node:crypto";

export const WORKFLOW_DEMAND_DIAGNOSTICS_SCHEMA_VERSION = 1;
export const WORKFLOW_DEMAND_DIAGNOSTICS_KIND = "workflow-demand-diagnostics-v1";
const MAX_LEAD_EPISODES = 12;
const MAX_COVERAGE_ROWS_PER_CLASS = 12;
const MAX_ROW_EVIDENCE_REFS = 8;
const MAX_LEAD_EVIDENCE_REFS = 64;

export const WORKFLOW_DEMAND_OWNER_ACTIONS = Object.freeze([
  "covered-observed",
  "try-built-in",
  "try-configured",
  "extend-existing",
  "owner-review",
  "needs-more-evidence",
]);

export const WORKFLOW_DEMAND_COVERAGE_REASON_CODES = Object.freeze([
  "lifecycle-demand-observed",
  "current-sdlc-handoff",
  "distinct-episode-recurrence",
  "matching-project-activation-observed",
  "matching-built-in-capability",
  "matching-configured-skill-complete",
  "matching-configured-skill-partial",
  "no-matching-configured-skill",
  "unscoped-activation-not-project-coverage",
  "apparent-read-not-activation",
  "not-evaluable-missing-asset-inventory",
]);

const OWNER_ACTION_SET = new Set(WORKFLOW_DEMAND_OWNER_ACTIONS);
const COVERAGE_REASON_SET = new Set(WORKFLOW_DEMAND_COVERAGE_REASON_CODES);
const CONFIDENCE_VALUES = new Set(["low", "medium", "high"]);
const DEMAND_KINDS = new Set(["current-sdlc-handoff", "observed-repeated"]);
const DEMAND_STRENGTHS = new Set(["current-bounded", "observed-repeated"]);
const WORKFLOW_DEMAND_SCOPES = new Set(["workspace", "user-global"]);
const OWNER_REVIEW_STATUSES = new Set(["covered", "candidate", "review-required", "evidence-required"]);
const CANDIDATE_OWNERS = new Set(["Skill", "Built-in", "unresolved"]);
const SKILL_COMPLETENESS = new Set(["complete", "partial", "unknown"]);
const SKILL_SHAPE_FIELDS = Object.freeze(["trigger", "procedure", "output", "validation"]);
const MISSING_PROOF_VALUES = new Set([
  "project-skill-inventory",
  "bounded-workflow-shape",
  "smallest-durable-owner",
  "task-linked-skill-activation",
  "task-linked-built-in-activation",
  ...SKILL_SHAPE_FIELDS.map((field) => `skill-${field}`),
]);
const TOP_LEVEL_FIELDS = new Set(["schemaVersion", "kind", "status", "currentHandoffs", "repeatedCandidates", "coverage"]);
const LEAD_FIELDS = new Set([
  "id", "demandKind", "demandStrength", "intent", "family", "normalizedTrigger",
  "procedureFamily", "expectedArtifact", "verifier", "primaryReview", "confidence",
  "scope", "host", "sourceEpisodes", "evidenceWindow", "coverageClasses", "ownerReview",
  "coverageTotals", "coverageReasonCodes", "evidenceRefs",
]);
const COVERAGE_CLASS_FIELDS = Object.freeze([
  "confirmedProjectActivation", "unscopedObservedActivation", "apparentReads", "builtInCapabilities", "configuredSkills",
]);
const COVERAGE_FIELDS = new Set(["demandSignals", "currentHandoff", "recurrence", "skillInventory", "skillActivation"]);
const COVERAGE_CODES = new Set([
  "checked-clean",
  "candidate-found",
  "insufficient-episodes",
  "insufficient-recurrence",
  "not-evaluable-missing-normalized-events",
  "not-evaluable-missing-asset-inventory",
  "not-evaluable-missing-invocation-events",
]);

const INTENT_PROFILES = Object.freeze({
  "spec-review": Object.freeze({
    family: "specification-planning",
    normalizedTrigger: "specification-review-request",
    procedureFamily: "specification-review",
    expectedArtifact: "reviewed-specification",
    verifier: "spec-review-evidence",
    dimensionId: "task-understanding",
    checkId: "goal-understanding",
    identityPattern: /(?:\bspec(?:ification)?\b.*\breview\b|\breview\b.*\bspec(?:ification)?\b|规格.*评审|评审.*规格)/iu,
  }),
  "specification-preparation": Object.freeze({
    family: "specification-planning",
    normalizedTrigger: "specification-preparation-request",
    procedureFamily: "specification-planning",
    expectedArtifact: "reviewable-specification",
    verifier: "acceptance-scenarios-and-scope-review",
    dimensionId: "task-understanding",
    checkId: "goal-understanding",
    identityPattern: /\b(?:spec(?:ification)?|requirements?|acceptance-criteria|adr|story)\b/iu,
  }),
  planning: Object.freeze({
    family: "specification-planning",
    normalizedTrigger: "planning-request",
    procedureFamily: "implementation-planning",
    expectedArtifact: "reviewable-plan",
    verifier: "plan-scope-review",
    dimensionId: "task-understanding",
    checkId: "scope-boundary",
    identityPattern: /\b(?:plan|planning|ultraplan)\b/iu,
  }),
  "issue-triage": Object.freeze({
    family: "specification-planning",
    normalizedTrigger: "issue-triage-request",
    procedureFamily: "issue-triage",
    expectedArtifact: "triaged-issue",
    verifier: "triage-decision-review",
    dimensionId: "task-understanding",
    checkId: "goal-understanding",
    identityPattern: /\bissue\b.*\b(?:triage|review|plan|story)\b|\b(?:triage|review|plan)\b.*\bissue\b/iu,
  }),
  "issue-workflow-planning": Object.freeze({
    family: "specification-planning",
    normalizedTrigger: "issue-workflow-planning-request",
    procedureFamily: "issue-workflow-planning",
    expectedArtifact: "bounded-issue-workflow",
    verifier: "issue-workflow-scope-review",
    dimensionId: "task-understanding",
    checkId: "scope-boundary",
    identityPattern: /\bissue\b.*\b(?:workflow|plan|patrol|schedule)\b|\b(?:workflow|plan|patrol|schedule)\b.*\bissue\b/iu,
  }),
  "setup-isolation": Object.freeze({
    family: "setup-isolation",
    normalizedTrigger: "setup-or-isolation-request",
    procedureFamily: "setup-isolation",
    expectedArtifact: "ready-isolated-workspace",
    verifier: "project-owned-setup-check",
    dimensionId: "controlled-execution",
    checkId: "instruction-led-start",
    identityPattern: /\b(?:setup|bootstrap|onboarding|environment|isolation|worktree|sandbox)\b/iu,
  }),
  debugging: Object.freeze({
    family: "debugging-testing-verification",
    normalizedTrigger: "debugging-request",
    procedureFamily: "systematic-debugging",
    expectedArtifact: "bounded-diagnosis",
    verifier: "failure-reproduction",
    dimensionId: "change-validation",
    checkId: "failure-repair",
    identityPattern: /\b(?:debug|debugging|diagnos(?:e|is|tic)|root[- ]cause)\b/iu,
  }),
  "testing-verification": Object.freeze({
    family: "debugging-testing-verification",
    normalizedTrigger: "testing-or-verification-request",
    procedureFamily: "testing-verification",
    expectedArtifact: "verification-evidence",
    verifier: "relevant-check",
    dimensionId: "change-validation",
    checkId: "relevant-check",
    identityPattern: /\b(?:test|testing|tdd|verify|verification|validation|qa)\b/iu,
  }),
  "review-acceptance": Object.freeze({
    family: "review-acceptance-completion",
    normalizedTrigger: "review-or-acceptance-request",
    procedureFamily: "review-acceptance",
    expectedArtifact: "reviewed-acceptance-result",
    verifier: "acceptance-evidence",
    dimensionId: "reliable-delivery",
    checkId: "acceptance-evidence",
    identityPattern: /\b(?:ultra[- ]review|code[- ]review|change[- ]review|pull[- ]request[- ]review|pr[- ]review|acceptance[- ]review)\b/iu,
  }),
  "release-delivery": Object.freeze({
    family: "review-acceptance-completion",
    normalizedTrigger: "release-or-delivery-request",
    procedureFamily: "release-delivery",
    expectedArtifact: "reviewed-release",
    verifier: "release-verification",
    dimensionId: "reliable-delivery",
    checkId: "acceptance-evidence",
    identityPattern: /\b(?:release|releasing|deploy|deployment|delivery|versioning|changeset)\b/iu,
  }),
  "branch-completion": Object.freeze({
    family: "review-acceptance-completion",
    normalizedTrigger: "branch-completion-request",
    procedureFamily: "branch-completion",
    expectedArtifact: "delivery-ready-branch",
    verifier: "branch-completion-check",
    dimensionId: "reliable-delivery",
    checkId: "acceptance-evidence",
    identityPattern: /\b(?:branch[- ]completion|merge[- ]readiness|ready[- ]to[- ]merge|pull[- ]request[- ]completion|pr[- ]completion)\b/iu,
  }),
  "documentation-maintenance": Object.freeze({
    family: "review-acceptance-completion",
    normalizedTrigger: "documentation-maintenance-request",
    procedureFamily: "documentation-maintenance",
    expectedArtifact: "validated-documentation",
    verifier: "documentation-build-or-link-check",
    dimensionId: "reliable-delivery",
    checkId: "acceptance-evidence",
    identityPattern: /\b(?:docs?|documentation)\b.*\b(?:maintenance|drift|review|refresh)\b|\b(?:maintenance|drift|refresh)\b.*\b(?:docs?|documentation)\b/iu,
  }),
});

export const WORKFLOW_DEMAND_BUILT_IN_CAPABILITIES = Object.freeze([
  Object.freeze({
    id: "qoder-ultra-review",
    name: "/ultra-review",
    kind: "command",
    host: "qoder",
    workflowIntents: Object.freeze(["review-acceptance"]),
    available: true,
    evidenceRefs: Object.freeze([
      Object.freeze({ kind: "built-in-capability", id: "qoder-ultra-review" }),
    ]),
  }),
]);

const INTENT_ALIASES = new Map([
  ["spec-review", "spec-review"],
  ["specification-review", "spec-review"],
  ["review-spec", "spec-review"],
  ["review-the-spec", "spec-review"],
  ["spec-reviewing", "spec-review"],
  ["spec", "specification-preparation"],
  ["specification", "specification-preparation"],
  ["specify", "specification-preparation"],
  ["spec-preparation", "specification-preparation"],
  ["specification-preparation", "specification-preparation"],
  ["specification-authoring", "specification-preparation"],
  ["spec-authoring", "specification-preparation"],
  ["story", "specification-preparation"],
  ["story-preparation", "specification-preparation"],
  ["requirements-clarification", "specification-preparation"],
  ["specification-clarification", "specification-preparation"],
  ["plan", "planning"],
  ["planning", "planning"],
  ["ultraplan", "planning"],
  ["ultra-plan", "planning"],
  ["implementation-plan", "planning"],
  ["task-planning", "planning"],
  ["plan-review", "planning"],
  ["issue-triage", "issue-triage"],
  ["issue-workflow-planning", "issue-workflow-planning"],
  ["setup", "setup-isolation"],
  ["setup-isolation", "setup-isolation"],
  ["bootstrap", "setup-isolation"],
  ["onboarding", "setup-isolation"],
  ["isolation", "setup-isolation"],
  ["worktree", "setup-isolation"],
  ["sandbox", "setup-isolation"],
  ["debug", "debugging"],
  ["debugging", "debugging"],
  ["diagnosis", "debugging"],
  ["systematic-debugging", "debugging"],
  ["test", "testing-verification"],
  ["testing", "testing-verification"],
  ["testing-verification", "testing-verification"],
  ["debug-test-verification", "testing-verification"],
  ["verification", "testing-verification"],
  ["validation", "testing-verification"],
  ["tdd", "testing-verification"],
  ["review", "review-acceptance"],
  ["code-review", "review-acceptance"],
  ["change-review", "review-acceptance"],
  ["review-acceptance", "review-acceptance"],
  ["review-acceptance-delivery", "review-acceptance"],
  ["acceptance", "review-acceptance"],
  ["acceptance-review", "review-acceptance"],
  ["release", "release-delivery"],
  ["release-delivery", "release-delivery"],
  ["delivery", "release-delivery"],
  ["deployment", "release-delivery"],
  ["branch-completion", "branch-completion"],
  ["merge-readiness", "branch-completion"],
  ["pr-completion", "branch-completion"],
  ["documentation-maintenance", "documentation-maintenance"],
  ["docs-maintenance", "documentation-maintenance"],
  ["documentation-drift", "documentation-maintenance"],
]);

function rows(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fingerprint(value, length = 20) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, length);
}

function uniqueByJson(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizedToken(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/gu, "")
    .replace(/[^a-z0-9:_/-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120);
}

function normalizedIdentity(value) {
  return normalizedToken(value).replaceAll("/", "-");
}

function normalizeWorkflowIntent(value) {
  const token = normalizedToken(value).replaceAll("/", "-");
  if (!token) return "";
  if (token === "issue-triage") return "issue-triage";
  if (/^issue(?:-|$)/u.test(token)) return "issue-workflow-planning";
  return INTENT_ALIASES.get(token) ?? (Object.hasOwn(INTENT_PROFILES, token) ? token : "");
}

function normalizeWorkflowDemandScope(value) {
  const token = normalizedToken(value).replaceAll("_", "-");
  return token === "user-global" ? "user-global" : "workspace";
}

function normalizeWorkflowDemandHost(value) {
  return normalizedIdentity(value || "unknown").slice(0, 48) || "unknown";
}

export function workflowDemandSignalKey(value) {
  const intent = normalizeWorkflowIntent(value?.intent ?? value?.normalizedIntent ?? value?.workflowIntent);
  if (!intent) return "";
  return [intent, normalizeWorkflowDemandScope(value?.scope), normalizeWorkflowDemandHost(value?.host)].join("|");
}

function normalizeConfidence(value) {
  const token = normalizedToken(value);
  if (["high", "observed", "strong"].includes(token)) return "high";
  if (["medium", "candidate", "moderate"].includes(token)) return "medium";
  return "low";
}

function safeRepositoryPath(value) {
  const candidate = String(value ?? "").trim().replaceAll("\\", "/").replace(/^\.\//u, "");
  return candidate
    && candidate.length <= 240
    && !candidate.startsWith("/")
    && !candidate.startsWith("~/")
    && !/^[A-Za-z]:\//u.test(candidate)
    && !candidate.split("/").includes("..")
    ? candidate
    : "";
}

function publicEpisodeId(value, index) {
  const candidate = String(value ?? "").trim();
  if (/^episode:[a-f0-9]{12,64}$/u.test(candidate)) return candidate;
  return `episode:${fingerprint({ episode: candidate || index + 1 })}`;
}

function safeEvidenceKind(value) {
  return normalizedIdentity(value || "workflow-demand-evidence").slice(0, 48) || "workflow-demand-evidence";
}

function safeEvidenceRef(value, fallback) {
  const source = isObject(value) ? value : {};
  const kind = safeEvidenceKind(source.kind);
  if (kind === "repository-file") {
    const id = safeRepositoryPath(source.id);
    if (id) return { kind, id };
  }
  if (kind === "git-commit" && /^[0-9a-f]{40}$/u.test(String(source.id ?? ""))) {
    return { kind, id: String(source.id) };
  }
  if (kind === "task-episode" && /^episode:[a-f0-9]{12,64}$/u.test(String(source.id ?? ""))) {
    return { kind, id: String(source.id) };
  }
  return {
    kind,
    id: `workflow-demand-ref:${fingerprint({ source, fallback })}`,
  };
}

function safeEvidenceRefs(values, fallback) {
  return uniqueByJson(rows(values).map((value, index) => safeEvidenceRef(value, `${fallback}-${index + 1}`)));
}

function taskEpisodeRef(episodeId) {
  return { kind: "task-episode", id: episodeId };
}

function signalEvidenceRefs(signal, episodeId, intent, index) {
  const supplied = [signal?.evidenceRef, ...rows(signal?.evidenceRefs)].filter(Boolean);
  if (supplied.length === 0) {
    return [safeEvidenceRef({}, `${episodeId}-${intent}-${index + 1}`)];
  }
  return safeEvidenceRefs(supplied, `${episodeId}-${intent}-${index + 1}`);
}

function normalizeLifecycleSignal(value, episodeId, index) {
  const source = isObject(value) ? value : { intent: value };
  const intent = normalizeWorkflowIntent(
    source.intent ?? source.normalizedIntent ?? source.workflowIntent ?? source.commandAlias ?? source.command,
  );
  const profile = INTENT_PROFILES[intent];
  if (!profile) return null;
  return {
    intent,
    scope: normalizeWorkflowDemandScope(source.scope),
    host: normalizeWorkflowDemandHost(source.host),
    family: profile.family,
    normalizedTrigger: profile.normalizedTrigger,
    procedureFamily: profile.procedureFamily,
    expectedArtifact: profile.expectedArtifact,
    verifier: profile.verifier,
    primaryReview: { dimensionId: profile.dimensionId, checkId: profile.checkId },
    confidence: normalizeConfidence(source.confidence),
    evidenceRefs: signalEvidenceRefs(source, episodeId, intent, index),
  };
}

function highestConfidence(left, right) {
  const rank = { low: 0, medium: 1, high: 2 };
  return rank[right] > rank[left] ? right : left;
}

function deduplicateEpisodeSignals(signals) {
  const byIntent = new Map();
  for (const signal of signals) {
    const key = workflowDemandSignalKey(signal);
    const previous = byIntent.get(key);
    if (!previous) {
      byIntent.set(key, signal);
      continue;
    }
    byIntent.set(key, {
      ...previous,
      confidence: highestConfidence(previous.confidence, signal.confidence),
      evidenceRefs: uniqueByJson([...previous.evidenceRefs, ...signal.evidenceRefs]),
    });
  }
  return [...byIntent.values()].sort((left, right) => workflowDemandSignalKey(left).localeCompare(workflowDemandSignalKey(right)));
}

function normalizeEpisodes(taskEpisodes) {
  return rows(taskEpisodes).map((episode, index) => {
    const id = publicEpisodeId(episode?.id, index);
    const signals = deduplicateEpisodeSignals(rows(episode?.lifecycleSignals)
      .map((signal, signalIndex) => normalizeLifecycleSignal(signal, id, signalIndex))
      .filter(Boolean));
    const lastSeen = Date.parse(String(episode?.lastSeen ?? ""));
    return {
      rawId: String(episode?.id ?? ""),
      id,
      index,
      lastSeen: Number.isNaN(lastSeen) ? null : lastSeen,
      current: episode?.current === true || episode?.isCurrent === true,
      startBoundary: String(episode?.startBoundary ?? "unknown"),
      targetKeys: [...new Set(rows(episode?.targetKeys).map(String).filter(Boolean))].sort(),
      signals,
    };
  });
}

function currentEpisode(episodes, requestedId) {
  const requested = String(requestedId ?? "").trim();
  if (requested) {
    const match = episodes.find((episode) => episode.rawId === requested || episode.id === requested);
    return match?.signals.length > 0 ? match : null;
  }
  const marked = episodes.filter((episode) => episode.current);
  if (marked.length > 0) return marked.at(-1)?.signals.length > 0 ? marked.at(-1) : null;
  return null;
}

function skillShape(candidate) {
  const explicit = normalizedToken(candidate?.completeness ?? candidate?.capabilityCompleteness);
  const shape = Object.fromEntries(SKILL_SHAPE_FIELDS.map((field) => {
    const nested = candidate?.capabilityShape?.[field];
    return [field, candidate?.[field] === true || nested === true];
  }));
  const completeness = explicit === "complete" || candidate?.complete === true || SKILL_SHAPE_FIELDS.every((field) => shape[field])
    ? "complete"
    : "partial";
  return {
    completeness,
    missingCapabilities: SKILL_SHAPE_FIELDS.filter((field) => !shape[field]),
  };
}

function skillId(candidate, index = 0) {
  return normalizedIdentity(candidate?.id ?? candidate?.name)
    || `skill-candidate-${fingerprint({ candidate, index }, 12)}`;
}

function boundedCapabilityText(candidate) {
  return [candidate?.id, candidate?.name, candidate?.description, candidate?.triggerText, candidate?.capabilityText]
    .map((value) => String(value ?? "").normalize("NFKC").trim().slice(0, 400).replace(/[-_:]+/gu, " "))
    .filter(Boolean)
    .join("\n");
}

function candidateIntents(candidate) {
  return [...rows(candidate?.workflowIntents), ...rows(candidate?.capabilityIntents), ...rows(candidate?.intents)]
    .map(normalizeWorkflowIntent)
    .filter(Boolean);
}

function candidateFamilies(candidate) {
  return rows(candidate?.lifecycleFamilies).map(normalizedToken).filter(Boolean);
}

function candidateMatchesSignal(candidate, signal) {
  const intents = candidateIntents(candidate);
  if (intents.length > 0) return intents.includes(signal.intent);
  const families = candidateFamilies(candidate);
  if (families.length > 0) return families.includes(signal.family);
  return INTENT_PROFILES[signal.intent].identityPattern.test(boundedCapabilityText(candidate));
}

function configuredSkillRow(candidate, index) {
  const path = safeRepositoryPath(candidate?.path);
  const shape = skillShape(candidate);
  const evidenceRefs = safeEvidenceRefs(candidate?.evidenceRefs, `configured-skill-${index + 1}`).slice(0, MAX_ROW_EVIDENCE_REFS);
  if (path && !evidenceRefs.some((ref) => ref.kind === "repository-file" && ref.id === path)) {
    evidenceRefs.unshift({ kind: "repository-file", id: path });
  }
  if (evidenceRefs.length === 0) evidenceRefs.push(safeEvidenceRef({}, `configured-skill-${index + 1}`));
  return {
    skillId: skillId(candidate, index),
    ...(path ? { path } : {}),
    completeness: shape.completeness,
    missingCapabilities: shape.missingCapabilities,
    evidenceRefs,
  };
}

function rowIdentity(row) {
  return normalizedIdentity(row?.skillId ?? row?.id ?? row?.name);
}

function coverageRowMatchesCandidate(row, candidateRow) {
  const rowPath = safeRepositoryPath(row?.path ?? row?.sourcePath ?? row?.candidatePath);
  if (rowPath && candidateRow.path) return rowPath === candidateRow.path;
  const identity = rowIdentity(row);
  return Boolean(identity) && identity === candidateRow.skillId;
}

function rowMatchesSignalIdentity(row, signal) {
  return INTENT_PROFILES[signal.intent].identityPattern.test(
    [row?.skillId, row?.id, row?.name].map((value) => String(value ?? "").replace(/[-_:]+/gu, " ")).join(" "),
  );
}

function activitySkillRow(row, candidateRow, index, kind) {
  const path = candidateRow?.path ?? safeRepositoryPath(row?.path ?? row?.sourcePath ?? row?.candidatePath);
  const count = Math.max(0, Math.trunc(Number(row?.count ?? row?.total ?? 1) || 0));
  const fallbackId = rowIdentity(row) || `${kind}-skill-${fingerprint({ row, index }, 12)}`;
  const evidenceRefs = uniqueByJson([
    ...safeEvidenceRefs(row?.evidenceRefs, `${kind}-${index + 1}`),
    ...rows(candidateRow?.evidenceRefs),
  ]).slice(0, MAX_ROW_EVIDENCE_REFS);
  if (evidenceRefs.length === 0) evidenceRefs.push(safeEvidenceRef({}, `${kind}-${index + 1}`));
  return {
    skillId: candidateRow?.skillId ?? fallbackId,
    ...(path ? { path } : {}),
    completeness: candidateRow?.completeness ?? "unknown",
    missingCapabilities: candidateRow?.missingCapabilities ?? [],
    count,
    evidenceRefs,
  };
}

function coverageRows(value, fields) {
  return fields.flatMap((field) => rows(value?.[field]));
}

export function mergeWorkflowDemandSkillEvidence({
  reusableSkillEvidence = {},
  skillActivity = {},
} = {}) {
  const mergeRows = (evidenceFields, activityFields) => uniqueByJson([
    ...coverageRows(reusableSkillEvidence, evidenceFields),
    ...coverageRows(skillActivity, activityFields),
  ]);
  return {
    ...reusableSkillEvidence,
    observedProjectSkills: mergeRows(
      ["observedProjectSkills", "confirmedProjectActivation", "confirmedProjectActivations", "projectActivations"],
      ["observedSkills", "observedProjectSkills", "confirmedProjectActivation", "confirmedProjectActivations", "projectActivations"],
    ),
    unscopedObservedSkills: mergeRows(
      ["unresolvedNameMatches", "unscopedObservedActivity", "unscopedObservedSkills", "unscopedObservedActivation", "unscopedObservedActivations"],
      ["unscopedObservedActivity", "unscopedObservedSkills", "unscopedObservedActivation", "unscopedObservedActivations"],
    ),
    apparentSkillReads: mergeRows(
      ["apparentSkillReads", "apparentReads", "inferredSkillReads"],
      ["apparentSkillReads", "apparentReads", "inferredSkillReads"],
    ),
  };
}

function normalizedBuiltInCapabilities(values = []) {
  const byKey = new Map();
  for (const [index, candidate] of [...WORKFLOW_DEMAND_BUILT_IN_CAPABILITIES, ...rows(values)].entries()) {
    if (candidate?.available === false) continue;
    const capabilityId = normalizedIdentity(candidate?.id ?? candidate?.name)
      || `built-in-capability-${fingerprint({ candidate, index }, 12)}`;
    const host = normalizeWorkflowDemandHost(candidate?.host);
    const key = `${host}:${capabilityId}`;
    if (byKey.has(key)) continue;
    const evidenceRefs = safeEvidenceRefs(candidate?.evidenceRefs, `built-in-capability-${index + 1}`);
    if (evidenceRefs.length === 0) evidenceRefs.push(safeEvidenceRef({}, `built-in-capability-${index + 1}`));
    byKey.set(key, {
      capabilityId,
      kind: normalizedIdentity(candidate?.kind || "capability").slice(0, 48) || "capability",
      host,
      workflowIntents: candidateIntents(candidate),
      lifecycleFamilies: candidateFamilies(candidate),
      capabilityText: boundedCapabilityText(candidate),
      evidenceRefs,
    });
  }
  return [...byKey.values()].sort((left, right) => `${left.host}:${left.capabilityId}`.localeCompare(`${right.host}:${right.capabilityId}`));
}

function matchingBuiltInCapabilities(signal, builtInCapabilities) {
  return builtInCapabilities.flatMap((candidate) => {
    if (candidate.host !== signal.host) return [];
    const intentMatch = candidate.workflowIntents.length > 0 && candidate.workflowIntents.includes(signal.intent);
    const familyMatch = candidate.workflowIntents.length === 0
      && candidate.lifecycleFamilies.includes(signal.family);
    const identityMatch = candidate.workflowIntents.length === 0
      && candidate.lifecycleFamilies.length === 0
      && INTENT_PROFILES[signal.intent].identityPattern.test(candidate.capabilityText);
    if (!intentMatch && !familyMatch && !identityMatch) return [];
    return [{
      capabilityId: candidate.capabilityId,
      kind: candidate.kind,
      host: candidate.host,
      evidenceRefs: candidate.evidenceRefs,
    }];
  });
}

function matchingCoverage(signal, reusableSkillEvidence, builtInCapabilities = []) {
  const candidates = rows(reusableSkillEvidence?.candidates);
  const configured = candidates
    .map((candidate, index) => ({ candidate, row: configuredSkillRow(candidate, index) }))
    .filter(({ candidate }) => candidateMatchesSignal(candidate, signal));

  const confirmedInput = coverageRows(reusableSkillEvidence, [
    "observedProjectSkills", "confirmedProjectActivation", "confirmedProjectActivations", "projectActivations",
  ]);
  const unscopedInput = coverageRows(reusableSkillEvidence, [
    "unresolvedNameMatches", "unscopedObservedActivity", "unscopedObservedSkills", "unscopedObservedActivation", "unscopedObservedActivations",
  ]);
  const apparentInput = coverageRows(reusableSkillEvidence, [
    "apparentSkillReads", "apparentReads", "inferredSkillReads",
  ]);

  const mapActivity = (input, kind) => input.flatMap((row, index) => {
    const candidate = configured.find(({ row: candidateRow }) => coverageRowMatchesCandidate(row, candidateRow));
    if (!candidate && !rowMatchesSignalIdentity(row, signal)) return [];
    return [activitySkillRow(row, candidate?.row, index, kind)];
  });
  return {
    confirmedProjectActivation: uniqueSkillRows(mapActivity(confirmedInput, "confirmed-activation")),
    unscopedObservedActivation: uniqueSkillRows(mapActivity(unscopedInput, "unscoped-activation")),
    apparentReads: uniqueSkillRows(mapActivity(apparentInput, "apparent-read")),
    builtInCapabilities: matchingBuiltInCapabilities(signal, builtInCapabilities),
    configuredSkills: uniqueSkillRows(configured.map(({ row }) => row)),
  };
}

function uniqueSkillRows(values) {
  const byKey = new Map();
  for (const row of values) {
    const key = `${row.skillId}:${row.path ?? ""}:${row.completeness}`;
    const previous = byKey.get(key);
    if (!previous) {
      byKey.set(key, row);
      continue;
    }
    byKey.set(key, {
      ...previous,
      count: Math.max(previous.count ?? 0, row.count ?? 0),
      missingCapabilities: [...new Set([...previous.missingCapabilities, ...row.missingCapabilities])].sort(),
      evidenceRefs: uniqueByJson([...previous.evidenceRefs, ...row.evidenceRefs]),
    });
  }
  return [...byKey.values()].sort((left, right) => left.skillId.localeCompare(right.skillId));
}

function inventoryInspected(reusableSkillEvidence) {
  return ["candidates-present", "scanned-empty"].includes(reusableSkillEvidence?.status);
}

function uniqueSkillIds(values) {
  return [...new Set(values.map((row) => row.skillId).filter(Boolean))].sort();
}

function ownerReviewFor(signal, coverageClasses, reusableSkillEvidence) {
  const builtIns = coverageClasses.builtInCapabilities;
  const configuredComplete = coverageClasses.configuredSkills.filter((row) => row.completeness === "complete");
  const configuredPartial = coverageClasses.configuredSkills.filter((row) => row.completeness === "partial");
  const confirmed = coverageClasses.confirmedProjectActivation;
  const confirmedPartialIds = new Set(confirmed.filter((row) => row.completeness === "partial").map((row) => row.skillId));
  const confirmedNonPartial = confirmed.filter((row) => !confirmedPartialIds.has(row.skillId) || row.completeness !== "partial");

  if (confirmed.length > 0 && confirmedNonPartial.length === 0 && configuredPartial.length > 0) {
    return {
      status: "candidate",
      action: "extend-existing",
      candidateOwner: "Skill",
      candidateSkillIds: uniqueSkillIds(configuredPartial),
      candidateCapabilityIds: [],
      missingProof: [...new Set(configuredPartial.flatMap((row) => row.missingCapabilities).map((field) => `skill-${field}`))].sort(),
    };
  }
  if (confirmed.length > 0) {
    return {
      status: "covered",
      action: "covered-observed",
      candidateOwner: "Skill",
      candidateSkillIds: uniqueSkillIds(confirmed),
      candidateCapabilityIds: [],
      missingProof: [],
    };
  }
  if (builtIns.length > 0) {
    return {
      status: "candidate",
      action: "try-built-in",
      candidateOwner: "Built-in",
      candidateSkillIds: [],
      candidateCapabilityIds: [...new Set(builtIns.map((row) => row.capabilityId))].sort(),
      missingProof: ["task-linked-built-in-activation"],
    };
  }
  if (configuredComplete.length > 0) {
    return {
      status: "candidate",
      action: "try-configured",
      candidateOwner: "Skill",
      candidateSkillIds: uniqueSkillIds(configuredComplete),
      candidateCapabilityIds: [],
      missingProof: ["task-linked-skill-activation"],
    };
  }
  if (configuredPartial.length > 0) {
    return {
      status: "candidate",
      action: "extend-existing",
      candidateOwner: "Skill",
      candidateSkillIds: uniqueSkillIds(configuredPartial),
      candidateCapabilityIds: [],
      missingProof: [...new Set(configuredPartial.flatMap((row) => row.missingCapabilities).map((field) => `skill-${field}`))].sort(),
    };
  }
  if (!inventoryInspected(reusableSkillEvidence) || signal.confidence === "low") {
    return {
      status: "evidence-required",
      action: "needs-more-evidence",
      candidateOwner: "unresolved",
      candidateSkillIds: [],
      candidateCapabilityIds: [],
      missingProof: [
        ...(!inventoryInspected(reusableSkillEvidence) ? ["project-skill-inventory"] : []),
        ...(signal.confidence === "low" ? ["bounded-workflow-shape"] : []),
        "smallest-durable-owner",
      ],
    };
  }
  return {
    status: "review-required",
    action: "owner-review",
    candidateOwner: "unresolved",
    candidateSkillIds: [],
    candidateCapabilityIds: [],
    missingProof: ["smallest-durable-owner"],
  };
}

function coverageReasons(demandKind, coverageClasses, reusableSkillEvidence) {
  const reasons = [
    "lifecycle-demand-observed",
    demandKind === "observed-repeated" ? "distinct-episode-recurrence" : "current-sdlc-handoff",
  ];
  if (coverageClasses.confirmedProjectActivation.length > 0) reasons.push("matching-project-activation-observed");
  if (coverageClasses.builtInCapabilities.length > 0) reasons.push("matching-built-in-capability");
  if (coverageClasses.configuredSkills.some((row) => row.completeness === "complete")) reasons.push("matching-configured-skill-complete");
  if (coverageClasses.configuredSkills.some((row) => row.completeness === "partial")) reasons.push("matching-configured-skill-partial");
  if (coverageClasses.configuredSkills.length === 0) {
    reasons.push(inventoryInspected(reusableSkillEvidence)
      ? "no-matching-configured-skill"
      : "not-evaluable-missing-asset-inventory");
  }
  if (coverageClasses.unscopedObservedActivation.length > 0) reasons.push("unscoped-activation-not-project-coverage");
  if (coverageClasses.apparentReads.length > 0) reasons.push("apparent-read-not-activation");
  return [...new Set(reasons)];
}

function leadEvidenceRefs(leadId, sourceEpisodes, members, coverageClasses) {
  return uniqueByJson([
    { kind: "workflow-demand", id: leadId },
    ...sourceEpisodes.map(taskEpisodeRef),
    ...members.flatMap((member) => member.signal.evidenceRefs),
    ...COVERAGE_CLASS_FIELDS.flatMap((field) => coverageClasses[field].flatMap((row) => row.evidenceRefs)),
  ]).slice(0, MAX_LEAD_EVIDENCE_REFS);
}

function buildLead({ demandKind, signal, members, reusableSkillEvidence, builtInCapabilities }) {
  const allSourceEpisodes = [...new Set(members.map((member) => member.episodeId))].sort();
  const sourceEpisodes = allSourceEpisodes.slice(0, MAX_LEAD_EPISODES);
  const allCoverageClasses = matchingCoverage(signal, reusableSkillEvidence, builtInCapabilities);
  const coverageTotals = Object.fromEntries(COVERAGE_CLASS_FIELDS.map((field) => [field, allCoverageClasses[field].length]));
  const coverageClasses = Object.fromEntries(COVERAGE_CLASS_FIELDS.map((field) => [
    field,
    allCoverageClasses[field].slice(0, MAX_COVERAGE_ROWS_PER_CLASS),
  ]));
  const confidence = members.reduce((highest, member) => highestConfidence(highest, member.signal.confidence), "low");
  const normalizedSignal = { ...signal, confidence };
  const id = `workflow-demand:${demandKind}:${signal.intent}:${fingerprint({ scope: signal.scope, host: signal.host, sourceEpisodes }, 12)}`;
  return {
    id,
    demandKind,
    demandStrength: demandKind === "observed-repeated" ? "observed-repeated" : "current-bounded",
    intent: signal.intent,
    family: signal.family,
    normalizedTrigger: signal.normalizedTrigger,
    procedureFamily: signal.procedureFamily,
    expectedArtifact: signal.expectedArtifact,
    verifier: signal.verifier,
    primaryReview: signal.primaryReview,
    confidence,
    scope: signal.scope,
    host: signal.host,
    sourceEpisodes,
    evidenceWindow: {
      distinctEpisodeCount: sourceEpisodes.length,
      totalDistinctEpisodeCount: allSourceEpisodes.length,
      truncated: allSourceEpisodes.length > sourceEpisodes.length,
      episodeRefs: sourceEpisodes,
    },
    coverageClasses,
    coverageTotals,
    ownerReview: ownerReviewFor(normalizedSignal, coverageClasses, reusableSkillEvidence),
    coverageReasonCodes: coverageReasons(demandKind, coverageClasses, reusableSkillEvidence),
    evidenceRefs: leadEvidenceRefs(id, sourceEpisodes, members, coverageClasses),
  };
}

function repeatedSignalGroups(episodes) {
  const groups = new Map();
  for (const episode of episodes) {
    for (const signal of episode.signals) {
      const key = workflowDemandSignalKey(signal);
      const members = groups.get(key) ?? new Map();
      members.set(episode.id, { episodeId: episode.id, signal, episode });
      groups.set(key, members);
    }
  }
  return [...groups.values()]
    .map((members) => {
      const values = [...members.values()];
      const strong = values.filter(({ episode }) => [
        "session-start",
        "explicit-task-key",
        "explicit-boundary",
      ].includes(episode.startBoundary));
      const accepted = [...strong];
      for (const member of values.filter((value) => !strong.includes(value))) {
        if (member.episode.targetKeys.length === 0) continue;
        const distinctTarget = accepted.some((candidate) => candidate.episode.targetKeys.length > 0
          && member.episode.targetKeys.every((key) => !candidate.episode.targetKeys.includes(key)));
        if (distinctTarget) accepted.push(member);
      }
      return accepted;
    })
    .filter((members) => members.length >= 2)
    .sort((left, right) => workflowDemandSignalKey(left[0].signal).localeCompare(workflowDemandSignalKey(right[0].signal)));
}

function diagnosticsCoverage(episodes, currentHandoffs, repeatedCandidates, reusableSkillEvidence) {
  const signalEpisodeCount = new Set(episodes.filter((episode) => episode.signals.length > 0).map((episode) => episode.id)).size;
  const leads = [...currentHandoffs, ...repeatedCandidates];
  const hasConfirmedActivation = leads.some((lead) => lead.coverageClasses.confirmedProjectActivation.length > 0);
  const hasActivationBoundary = leads.some((lead) => lead.coverageClasses.configuredSkills.length > 0
    || lead.coverageClasses.builtInCapabilities.length > 0
    || lead.coverageClasses.unscopedObservedActivation.length > 0
    || lead.coverageClasses.apparentReads.length > 0);
  return {
    demandSignals: signalEpisodeCount > 0 ? "candidate-found" : "not-evaluable-missing-normalized-events",
    currentHandoff: currentHandoffs.length > 0 ? "candidate-found" : "checked-clean",
    recurrence: repeatedCandidates.length > 0
      ? "candidate-found"
      : signalEpisodeCount < 2 ? "insufficient-episodes" : "insufficient-recurrence",
    skillInventory: inventoryInspected(reusableSkillEvidence) ? "checked-clean" : "not-evaluable-missing-asset-inventory",
    skillActivation: hasConfirmedActivation
      ? "checked-clean"
      : hasActivationBoundary ? "not-evaluable-missing-invocation-events" : "checked-clean",
  };
}

export function buildWorkflowDemandDiagnostics({
  taskEpisodes = [],
  reusableSkillEvidence = {},
  skillActivity = {},
  builtInCapabilities = [],
  currentEpisodeId,
} = {}) {
  const workflowSkillEvidence = mergeWorkflowDemandSkillEvidence({ reusableSkillEvidence, skillActivity });
  const workflowBuiltIns = normalizedBuiltInCapabilities(builtInCapabilities);
  const episodes = normalizeEpisodes(taskEpisodes);
  const current = currentEpisode(episodes, currentEpisodeId);
  const currentHandoffs = rows(current?.signals).map((signal) => buildLead({
    demandKind: "current-sdlc-handoff",
    signal,
    members: [{ episodeId: current.id, signal }],
    reusableSkillEvidence: workflowSkillEvidence,
    builtInCapabilities: workflowBuiltIns,
  }));
  const repeatedCandidates = repeatedSignalGroups(episodes).map((members) => buildLead({
    demandKind: "observed-repeated",
    signal: members[0].signal,
    members,
    reusableSkillEvidence: workflowSkillEvidence,
    builtInCapabilities: workflowBuiltIns,
  }));
  return {
    schemaVersion: WORKFLOW_DEMAND_DIAGNOSTICS_SCHEMA_VERSION,
    kind: WORKFLOW_DEMAND_DIAGNOSTICS_KIND,
    status: "candidate",
    currentHandoffs,
    repeatedCandidates,
    coverage: diagnosticsCoverage(episodes, currentHandoffs, repeatedCandidates, workflowSkillEvidence),
  };
}

function addUnsupportedFields(value, allowed, prefix, errors) {
  for (const field of Object.keys(value ?? {})) {
    if (!allowed.has(field)) errors.push(`${prefix} has unsupported field: ${field}`);
  }
}

function validateNonEmptyString(value, location, errors) {
  if (typeof value !== "string" || !value.trim()) errors.push(`${location} must be a non-empty string`);
}

function validateSafeRepositoryPath(value, location, errors) {
  if (!safeRepositoryPath(value) || safeRepositoryPath(value) !== String(value).replaceAll("\\", "/").replace(/^\.\//u, "")) {
    errors.push(`${location} must be a safe repository-relative path`);
  }
}

function validateEvidenceRefs(value, location, errors, sourceEpisodes = new Set()) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${location} must be a non-empty array`);
    return;
  }
  for (const [index, ref] of value.entries()) {
    const at = `${location}[${index}]`;
    if (!isObject(ref)) {
      errors.push(`${at} must be an object`);
      continue;
    }
    addUnsupportedFields(ref, new Set(["kind", "id"]), at, errors);
    validateNonEmptyString(ref.kind, `${at}.kind`, errors);
    validateNonEmptyString(ref.id, `${at}.id`, errors);
    if (typeof ref.kind === "string" && normalizedIdentity(ref.kind) !== ref.kind) errors.push(`${at}.kind must be normalized`);
    if (ref.kind === "repository-file") validateSafeRepositoryPath(ref.id, `${at}.id`, errors);
    if (ref.kind === "git-commit" && !/^[0-9a-f]{40}$/u.test(String(ref.id ?? ""))) errors.push(`${at}.id must be a full Git commit id`);
    if (ref.kind === "task-episode" && sourceEpisodes.size > 0 && !sourceEpisodes.has(ref.id)) {
      errors.push(`${at}.id must reference one of the lead sourceEpisodes`);
    }
    if (!["repository-file", "git-commit"].includes(ref.kind)
      && !/^[A-Za-z0-9._:-]{1,200}$/u.test(String(ref.id ?? ""))) {
      errors.push(`${at}.id must be a bounded privacy-safe identifier`);
    }
  }
}

function validateSkillRows(value, location, errors, sourceEpisodes) {
  if (!Array.isArray(value)) {
    errors.push(`${location} must be an array`);
    return;
  }
  if (value.length > MAX_COVERAGE_ROWS_PER_CLASS) errors.push(`${location} exceeds the bounded coverage sample`);
  const keys = new Set();
  for (const [index, row] of value.entries()) {
    const at = `${location}[${index}]`;
    if (!isObject(row)) {
      errors.push(`${at} must be an object`);
      continue;
    }
    addUnsupportedFields(row, new Set(["skillId", "path", "completeness", "missingCapabilities", "count", "evidenceRefs"]), at, errors);
    validateNonEmptyString(row.skillId, `${at}.skillId`, errors);
    if (typeof row.skillId === "string" && normalizedIdentity(row.skillId) !== row.skillId) errors.push(`${at}.skillId must be normalized`);
    if (!SKILL_COMPLETENESS.has(row.completeness)) errors.push(`${at}.completeness is invalid`);
    if (row.path !== undefined) validateSafeRepositoryPath(row.path, `${at}.path`, errors);
    if (!Array.isArray(row.missingCapabilities)
      || row.missingCapabilities.some((field) => !SKILL_SHAPE_FIELDS.includes(field))) {
      errors.push(`${at}.missingCapabilities must contain only Skill shape fields`);
    }
    if (row.completeness === "complete" && rows(row.missingCapabilities).length > 0) errors.push(`${at} complete Skill cannot have missingCapabilities`);
    if (row.count !== undefined && (!Number.isInteger(row.count) || row.count < 0)) errors.push(`${at}.count must be a non-negative integer`);
    validateEvidenceRefs(row.evidenceRefs, `${at}.evidenceRefs`, errors, sourceEpisodes);
    if (rows(row.evidenceRefs).length > MAX_ROW_EVIDENCE_REFS) errors.push(`${at}.evidenceRefs exceeds the bounded row evidence sample`);
    const key = `${row.skillId}:${row.path ?? ""}:${row.completeness}`;
    if (keys.has(key)) errors.push(`${location} duplicates Skill coverage: ${row.skillId}`);
    keys.add(key);
  }
}

function validateBuiltInRows(value, location, errors, sourceEpisodes) {
  if (!Array.isArray(value)) {
    errors.push(`${location} must be an array`);
    return;
  }
  if (value.length > MAX_COVERAGE_ROWS_PER_CLASS) errors.push(`${location} exceeds the bounded coverage sample`);
  const keys = new Set();
  for (const [index, row] of value.entries()) {
    const at = `${location}[${index}]`;
    if (!isObject(row)) {
      errors.push(`${at} must be an object`);
      continue;
    }
    addUnsupportedFields(row, new Set(["capabilityId", "kind", "host", "evidenceRefs"]), at, errors);
    validateNonEmptyString(row.capabilityId, `${at}.capabilityId`, errors);
    if (typeof row.capabilityId === "string" && normalizedIdentity(row.capabilityId) !== row.capabilityId) errors.push(`${at}.capabilityId must be normalized`);
    if (typeof row.kind !== "string" || normalizedIdentity(row.kind) !== row.kind) errors.push(`${at}.kind must be normalized`);
    if (typeof row.host !== "string" || normalizeWorkflowDemandHost(row.host) !== row.host) errors.push(`${at}.host must be normalized`);
    validateEvidenceRefs(row.evidenceRefs, `${at}.evidenceRefs`, errors, sourceEpisodes);
    if (rows(row.evidenceRefs).length > MAX_ROW_EVIDENCE_REFS) errors.push(`${at}.evidenceRefs exceeds the bounded row evidence sample`);
    const key = `${row.host}:${row.capabilityId}`;
    if (keys.has(key)) errors.push(`${location} duplicates built-in capability: ${row.capabilityId}`);
    keys.add(key);
  }
}

function validateCoverageClasses(value, location, errors, sourceEpisodes) {
  if (!isObject(value)) {
    errors.push(`${location} must be an object`);
    return;
  }
  addUnsupportedFields(value, new Set(COVERAGE_CLASS_FIELDS), location, errors);
  for (const field of COVERAGE_CLASS_FIELDS.filter((field) => field !== "builtInCapabilities")) {
    validateSkillRows(value[field], `${location}.${field}`, errors, sourceEpisodes);
  }
  validateBuiltInRows(value.builtInCapabilities, `${location}.builtInCapabilities`, errors, sourceEpisodes);
}

function validateOwnerReview(value, location, errors, coverageClasses) {
  if (!isObject(value)) {
    errors.push(`${location} must be an object`);
    return;
  }
  addUnsupportedFields(value, new Set(["status", "action", "candidateOwner", "candidateSkillIds", "candidateCapabilityIds", "missingProof"]), location, errors);
  if (!OWNER_REVIEW_STATUSES.has(value.status)) errors.push(`${location}.status is invalid`);
  if (!OWNER_ACTION_SET.has(value.action)) errors.push(`${location}.action is invalid and must never auto-create a durable owner`);
  if (CANDIDATE_OWNERS.has(value.candidateOwner) === false) errors.push(`${location}.candidateOwner is invalid`);
  if (!Array.isArray(value.candidateSkillIds) || value.candidateSkillIds.some((id) => typeof id !== "string" || !id.trim())) {
    errors.push(`${location}.candidateSkillIds must contain non-empty strings`);
  } else {
    if (new Set(value.candidateSkillIds).size !== value.candidateSkillIds.length) errors.push(`${location}.candidateSkillIds must be distinct`);
    if (value.candidateSkillIds.some((id) => normalizedIdentity(id) !== id)) errors.push(`${location}.candidateSkillIds must be normalized`);
  }
  if (!Array.isArray(value.candidateCapabilityIds) || value.candidateCapabilityIds.some((id) => typeof id !== "string" || !id.trim())) {
    errors.push(`${location}.candidateCapabilityIds must contain non-empty strings`);
  } else {
    if (new Set(value.candidateCapabilityIds).size !== value.candidateCapabilityIds.length) errors.push(`${location}.candidateCapabilityIds must be distinct`);
    if (value.candidateCapabilityIds.some((id) => normalizedIdentity(id) !== id)) errors.push(`${location}.candidateCapabilityIds must be normalized`);
  }
  if (!Array.isArray(value.missingProof) || value.missingProof.some((proof) => !MISSING_PROOF_VALUES.has(proof))) {
    errors.push(`${location}.missingProof contains an unsupported proof requirement`);
  }
  const configured = rows(coverageClasses?.configuredSkills);
  const confirmed = rows(coverageClasses?.confirmedProjectActivation);
  const builtIns = rows(coverageClasses?.builtInCapabilities);
  if (value.action === "covered-observed" && confirmed.length === 0) errors.push(`${location}.action covered-observed requires matching confirmed project activation`);
  if (value.action === "try-built-in" && builtIns.length === 0) errors.push(`${location}.action try-built-in requires a matching host-scoped built-in capability`);
  if (value.action === "try-configured" && !configured.some((row) => row.completeness === "complete")) errors.push(`${location}.action try-configured requires a complete configured Skill`);
  if (value.action === "extend-existing" && !configured.some((row) => row.completeness === "partial")) errors.push(`${location}.action extend-existing requires a partial configured Skill`);
  if (["try-configured", "extend-existing", "owner-review", "needs-more-evidence"].includes(value.action) && builtIns.length > 0) errors.push(`${location}.action must try matching built-in coverage before configured or owner review`);
  if (["owner-review", "needs-more-evidence"].includes(value.action) && configured.length > 0) errors.push(`${location}.action must use matching configured Skill coverage before owner review`);
  if (["owner-review", "needs-more-evidence"].includes(value.action) && value.candidateOwner !== "unresolved") errors.push(`${location}.candidateOwner must remain unresolved without matching Skill coverage`);
  if (["covered-observed", "try-configured", "extend-existing"].includes(value.action) && value.candidateOwner !== "Skill") errors.push(`${location}.candidateOwner must be Skill for a matching Skill action`);
  if (value.action === "try-built-in" && value.candidateOwner !== "Built-in") errors.push(`${location}.candidateOwner must be Built-in for a built-in trial`);
  const eligibleSkillIds = value.action === "covered-observed"
    ? new Set(confirmed.map((row) => row.skillId))
    : value.action === "try-configured"
      ? new Set(configured.filter((row) => row.completeness === "complete").map((row) => row.skillId))
      : value.action === "extend-existing"
        ? new Set(configured.filter((row) => row.completeness === "partial").map((row) => row.skillId))
        : new Set();
  if (rows(value.candidateSkillIds).some((id) => !eligibleSkillIds.has(id))) {
    errors.push(`${location}.candidateSkillIds must reference Skill coverage eligible for the selected action`);
  }
  if (eligibleSkillIds.size > 0 && rows(value.candidateSkillIds).length === 0) errors.push(`${location}.candidateSkillIds must name the selected matching Skill`);
  if (value.action === "try-built-in" && rows(value.candidateSkillIds).length > 0) errors.push(`${location}.candidateSkillIds must be empty for a built-in trial`);
  const eligibleCapabilityIds = value.action === "try-built-in"
    ? new Set(builtIns.map((row) => row.capabilityId))
    : new Set();
  if (rows(value.candidateCapabilityIds).some((id) => !eligibleCapabilityIds.has(id))) {
    errors.push(`${location}.candidateCapabilityIds must reference built-in coverage eligible for the selected action`);
  }
  if (eligibleCapabilityIds.size > 0 && rows(value.candidateCapabilityIds).length === 0) errors.push(`${location}.candidateCapabilityIds must name the selected built-in capability`);
  if (value.action !== "try-built-in" && rows(value.candidateCapabilityIds).length > 0) errors.push(`${location}.candidateCapabilityIds must be empty unless the action is try-built-in`);
}

function validateLead(value, index, expectedKind, errors, ids, intents) {
  const location = `workflow demand diagnostics ${expectedKind === "current-sdlc-handoff" ? "currentHandoffs" : "repeatedCandidates"}[${index}]`;
  if (!isObject(value)) {
    errors.push(`${location} must be an object`);
    return;
  }
  addUnsupportedFields(value, LEAD_FIELDS, location, errors);
  validateNonEmptyString(value.id, `${location}.id`, errors);
  if (ids.has(value.id)) errors.push(`${location}.id is duplicated`);
  ids.add(value.id);
  if (value.demandKind !== expectedKind || !DEMAND_KINDS.has(value.demandKind)) errors.push(`${location}.demandKind must be ${expectedKind}`);
  const expectedStrength = expectedKind === "observed-repeated" ? "observed-repeated" : "current-bounded";
  if (value.demandStrength !== expectedStrength || !DEMAND_STRENGTHS.has(value.demandStrength)) errors.push(`${location}.demandStrength must be ${expectedStrength}`);
  const profile = INTENT_PROFILES[value.intent];
  if (!profile) errors.push(`${location}.intent is unsupported`);
  else {
    const expected = {
      family: profile.family,
      normalizedTrigger: profile.normalizedTrigger,
      procedureFamily: profile.procedureFamily,
      expectedArtifact: profile.expectedArtifact,
      verifier: profile.verifier,
    };
    for (const [field, expectedValue] of Object.entries(expected)) {
      if (value[field] !== expectedValue) errors.push(`${location}.${field} must match the normalized intent profile`);
    }
    if (!isObject(value.primaryReview)
      || value.primaryReview.dimensionId !== profile.dimensionId
      || value.primaryReview.checkId !== profile.checkId) {
      errors.push(`${location}.primaryReview must match the Agent Work Loop intent mapping`);
    } else addUnsupportedFields(value.primaryReview, new Set(["dimensionId", "checkId"]), `${location}.primaryReview`, errors);
  }
  if (!CONFIDENCE_VALUES.has(value.confidence)) errors.push(`${location}.confidence is invalid`);
  if (!WORKFLOW_DEMAND_SCOPES.has(value.scope)) errors.push(`${location}.scope must be workspace or user-global`);
  if (typeof value.host !== "string" || normalizeWorkflowDemandHost(value.host) !== value.host) errors.push(`${location}.host must be a normalized privacy-safe host id`);
  if (!Array.isArray(value.sourceEpisodes)) errors.push(`${location}.sourceEpisodes must be an array`);
  const sourceEpisodes = new Set(rows(value.sourceEpisodes));
  if (rows(value.sourceEpisodes).some((id) => typeof id !== "string"
    || !/^episode:[a-f0-9]{12,64}$/u.test(id))) {
    errors.push(`${location}.sourceEpisodes must contain bounded privacy-safe episode ids`);
  }
  if (sourceEpisodes.size !== rows(value.sourceEpisodes).length) errors.push(`${location}.sourceEpisodes must contain distinct episode ids`);
  if (sourceEpisodes.size > MAX_LEAD_EPISODES) errors.push(`${location}.sourceEpisodes exceeds the bounded episode sample`);
  if (expectedKind === "current-sdlc-handoff" && sourceEpisodes.size !== 1) errors.push(`${location} must reference exactly one current episode`);
  if (expectedKind === "observed-repeated" && sourceEpisodes.size < 2) errors.push(`${location} requires at least two distinct episodes`);
  const intentKey = `${expectedKind}:${workflowDemandSignalKey(value)}`;
  if (intents.has(intentKey)) errors.push(`${location} duplicates normalized workflow intent ${value.intent}`);
  intents.add(intentKey);
  if (!isObject(value.evidenceWindow)) errors.push(`${location}.evidenceWindow must be an object`);
  else {
    addUnsupportedFields(value.evidenceWindow, new Set(["distinctEpisodeCount", "totalDistinctEpisodeCount", "truncated", "episodeRefs"]), `${location}.evidenceWindow`, errors);
    if (value.evidenceWindow.distinctEpisodeCount !== sourceEpisodes.size) errors.push(`${location}.evidenceWindow.distinctEpisodeCount must equal distinct sourceEpisodes`);
    if (!Number.isInteger(value.evidenceWindow.totalDistinctEpisodeCount)
      || value.evidenceWindow.totalDistinctEpisodeCount < sourceEpisodes.size) {
      errors.push(`${location}.evidenceWindow.totalDistinctEpisodeCount must cover the bounded source episode sample`);
    }
    if (value.evidenceWindow.truncated !== (value.evidenceWindow.totalDistinctEpisodeCount > sourceEpisodes.size)) {
      errors.push(`${location}.evidenceWindow.truncated must match the total and sampled episode counts`);
    }
    if (!Array.isArray(value.evidenceWindow.episodeRefs)
      || JSON.stringify(value.evidenceWindow.episodeRefs) !== JSON.stringify(value.sourceEpisodes)) {
      errors.push(`${location}.evidenceWindow.episodeRefs must match sourceEpisodes`);
    }
  }
  validateCoverageClasses(value.coverageClasses, `${location}.coverageClasses`, errors, sourceEpisodes);
  if (!isObject(value.coverageTotals)) errors.push(`${location}.coverageTotals must be an object`);
  else {
    addUnsupportedFields(value.coverageTotals, new Set(COVERAGE_CLASS_FIELDS), `${location}.coverageTotals`, errors);
    for (const field of COVERAGE_CLASS_FIELDS) {
      if (!Number.isInteger(value.coverageTotals[field])
        || value.coverageTotals[field] < rows(value.coverageClasses?.[field]).length) {
        errors.push(`${location}.coverageTotals.${field} must cover the bounded coverage sample`);
      }
    }
  }
  validateOwnerReview(value.ownerReview, `${location}.ownerReview`, errors, value.coverageClasses);
  if (!Array.isArray(value.coverageReasonCodes)
    || value.coverageReasonCodes.some((code) => !COVERAGE_REASON_SET.has(code))) {
    errors.push(`${location}.coverageReasonCodes contains an unsupported code`);
  }
  if (new Set(rows(value.coverageReasonCodes)).size !== rows(value.coverageReasonCodes).length) errors.push(`${location}.coverageReasonCodes must be distinct`);
  const kindReason = expectedKind === "observed-repeated" ? "distinct-episode-recurrence" : "current-sdlc-handoff";
  if (!rows(value.coverageReasonCodes).includes(kindReason)) errors.push(`${location}.coverageReasonCodes must include ${kindReason}`);
  const configured = rows(value.coverageClasses?.configuredSkills);
  const confirmed = rows(value.coverageClasses?.confirmedProjectActivation);
  const builtIns = rows(value.coverageClasses?.builtInCapabilities);
  const unscoped = rows(value.coverageClasses?.unscopedObservedActivation);
  const apparent = rows(value.coverageClasses?.apparentReads);
  const reasonRules = [
    ["matching-project-activation-observed", confirmed.length > 0],
    ["matching-built-in-capability", builtIns.length > 0],
    ["matching-configured-skill-complete", configured.some((row) => row.completeness === "complete")],
    ["matching-configured-skill-partial", configured.some((row) => row.completeness === "partial")],
    ["unscoped-activation-not-project-coverage", unscoped.length > 0],
    ["apparent-read-not-activation", apparent.length > 0],
  ];
  for (const [code, expected] of reasonRules) {
    if (rows(value.coverageReasonCodes).includes(code) !== expected) errors.push(`${location}.coverageReasonCodes ${code} conflicts with matching coverage`);
  }
  validateEvidenceRefs(value.evidenceRefs, `${location}.evidenceRefs`, errors, sourceEpisodes);
  if (rows(value.evidenceRefs).length > MAX_LEAD_EVIDENCE_REFS) errors.push(`${location}.evidenceRefs exceeds the bounded lead evidence sample`);
  const workflowDemandRefs = rows(value.evidenceRefs).filter((ref) => ref?.kind === "workflow-demand");
  if (workflowDemandRefs.length !== 1 || workflowDemandRefs[0]?.id !== value.id) {
    errors.push(`${location}.evidenceRefs must contain exactly one workflow-demand self reference matching the lead id`);
  }
}

function validateCoverage(value, errors) {
  const location = "workflow demand diagnostics coverage";
  if (!isObject(value)) {
    errors.push(`${location} must be an object`);
    return;
  }
  addUnsupportedFields(value, COVERAGE_FIELDS, location, errors);
  for (const field of COVERAGE_FIELDS) {
    if (!COVERAGE_CODES.has(value[field])) errors.push(`${location}.${field} is invalid`);
  }
}

function privacyErrors(value) {
  const serialized = JSON.stringify(value ?? {});
  const errors = [];
  if (/(?:\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)/u.test(serialized)) {
    errors.push("workflow demand diagnostics must not expose absolute home paths");
  }
  if (/"(?:rawPrompt|rawCommand|prompt|command|transcript|sessionId|sessionIds|userText|assistantText)"\s*:/iu.test(serialized)) {
    errors.push("workflow demand diagnostics must not contain raw prompts, commands, transcripts, or session ids");
  }
  return errors;
}

function workflowDemandLeads(value) {
  return [...rows(value?.currentHandoffs), ...rows(value?.repeatedCandidates)];
}

function validateWorkflowDemandEpisodeBindings(value, taskEpisodes) {
  if (!Array.isArray(taskEpisodes)) return ["workflow demand diagnostic replay taskEpisodes must be an array"];
  const episodeSignals = new Map();
  for (const episode of normalizeEpisodes(taskEpisodes)) {
    const keys = episodeSignals.get(episode.id) ?? new Set();
    for (const signal of episode.signals) keys.add(workflowDemandSignalKey(signal));
    episodeSignals.set(episode.id, keys);
  }
  const errors = [];
  for (const lead of workflowDemandLeads(value)) {
    const key = workflowDemandSignalKey(lead);
    for (const episodeId of rows(lead?.sourceEpisodes)) {
      const signals = episodeSignals.get(episodeId);
      if (!signals) {
        errors.push(`workflow demand diagnostic lead ${lead?.id ?? "(unknown)"} references unknown task episode: ${episodeId}`);
      } else if (!signals.has(key)) {
        errors.push(`workflow demand diagnostic lead ${lead?.id ?? "(unknown)"} source episode ${episodeId} does not contain exact workflow signal ${key}`);
      }
    }
  }
  return errors;
}

function validateWorkflowDemandCoverageReplay(value, {
  reusableSkillEvidence = {},
  skillActivity = {},
  builtInCapabilities = [],
} = {}) {
  const evidence = mergeWorkflowDemandSkillEvidence({ reusableSkillEvidence, skillActivity });
  const builtIns = normalizedBuiltInCapabilities(builtInCapabilities);
  const errors = [];
  for (const lead of workflowDemandLeads(value)) {
    const allExpectedCoverage = matchingCoverage(lead, evidence, builtIns);
    const expectedTotals = Object.fromEntries(COVERAGE_CLASS_FIELDS.map((field) => [field, allExpectedCoverage[field].length]));
    const expectedCoverage = Object.fromEntries(COVERAGE_CLASS_FIELDS.map((field) => [
      field,
      allExpectedCoverage[field].slice(0, MAX_COVERAGE_ROWS_PER_CLASS),
    ]));
    if (JSON.stringify(lead?.coverageClasses) !== JSON.stringify(expectedCoverage)) {
      errors.push(`workflow demand diagnostic lead ${lead?.id ?? "(unknown)"} coverageClasses do not match recomputed Skill and built-in inputs`);
    }
    if (JSON.stringify(lead?.coverageTotals) !== JSON.stringify(expectedTotals)) {
      errors.push(`workflow demand diagnostic lead ${lead?.id ?? "(unknown)"} coverageTotals do not match recomputed Skill and built-in inputs`);
    }
    const expectedOwnerReview = ownerReviewFor(lead, expectedCoverage, evidence);
    if (JSON.stringify(lead?.ownerReview) !== JSON.stringify(expectedOwnerReview)) {
      errors.push(`workflow demand diagnostic lead ${lead?.id ?? "(unknown)"} ownerReview does not match recomputed coverage ladder`);
    }
    const expectedReasons = coverageReasons(lead?.demandKind, expectedCoverage, evidence);
    if (JSON.stringify(lead?.coverageReasonCodes) !== JSON.stringify(expectedReasons)) {
      errors.push(`workflow demand diagnostic lead ${lead?.id ?? "(unknown)"} coverageReasonCodes do not match recomputed coverage`);
    }
  }
  const expectedCoverageSummary = diagnosticsCoverage(
    [],
    rows(value?.currentHandoffs),
    rows(value?.repeatedCandidates),
    evidence,
  );
  for (const field of ["skillInventory", "skillActivation"]) {
    if (value?.coverage?.[field] !== expectedCoverageSummary[field]) {
      errors.push(`workflow demand diagnostics coverage.${field} does not match recomputed coverage inputs`);
    }
  }
  return errors;
}

export function validateWorkflowDemandDiagnosticsAgainstInputs(value, {
  taskEpisodes,
  reusableSkillEvidence,
  skillActivity,
  builtInCapabilities,
  currentEpisodeId,
} = {}) {
  if (!isObject(value)) return ["workflow demand diagnostics must be an object"];
  const errors = [];
  const hasTaskEpisodes = taskEpisodes !== undefined;
  const hasCoverageInputs = reusableSkillEvidence !== undefined
    || skillActivity !== undefined
    || builtInCapabilities !== undefined;
  if (hasTaskEpisodes) errors.push(...validateWorkflowDemandEpisodeBindings(value, taskEpisodes));
  if (hasCoverageInputs) {
    errors.push(...validateWorkflowDemandCoverageReplay(value, {
      reusableSkillEvidence,
      skillActivity,
      builtInCapabilities,
    }));
  }
  if (hasTaskEpisodes && hasCoverageInputs && Array.isArray(taskEpisodes)) {
    const expected = buildWorkflowDemandDiagnostics({
      taskEpisodes,
      reusableSkillEvidence,
      skillActivity,
      builtInCapabilities,
      currentEpisodeId,
    });
    for (const field of ["currentHandoffs", "repeatedCandidates", "coverage"]) {
      if (JSON.stringify(value?.[field]) !== JSON.stringify(expected[field])) {
        errors.push(`workflow demand diagnostics ${field} do not match deterministic input recomputation`);
      }
    }
  }
  return [...new Set(errors)];
}

export function validateWorkflowDemandDiagnostics(value, inputs = {}) {
  if (!isObject(value)) return ["workflow demand diagnostics must be an object"];
  const errors = [];
  addUnsupportedFields(value, TOP_LEVEL_FIELDS, "workflow demand diagnostics", errors);
  if (value.schemaVersion !== WORKFLOW_DEMAND_DIAGNOSTICS_SCHEMA_VERSION) {
    errors.push(`workflow demand diagnostics schemaVersion must be ${WORKFLOW_DEMAND_DIAGNOSTICS_SCHEMA_VERSION}`);
  }
  if (value.kind !== WORKFLOW_DEMAND_DIAGNOSTICS_KIND) errors.push(`workflow demand diagnostics kind must be ${WORKFLOW_DEMAND_DIAGNOSTICS_KIND}`);
  if (value.status !== "candidate") errors.push("workflow demand diagnostics status must be candidate");
  if (!Array.isArray(value.currentHandoffs)) errors.push("workflow demand diagnostics currentHandoffs must be an array");
  if (!Array.isArray(value.repeatedCandidates)) errors.push("workflow demand diagnostics repeatedCandidates must be an array");
  const ids = new Set();
  const intents = new Set();
  rows(value.currentHandoffs).forEach((lead, index) => validateLead(lead, index, "current-sdlc-handoff", errors, ids, intents));
  rows(value.repeatedCandidates).forEach((lead, index) => validateLead(lead, index, "observed-repeated", errors, ids, intents));
  validateCoverage(value.coverage, errors);
  errors.push(...privacyErrors(value));
  if (isObject(inputs) && Object.keys(inputs).length > 0) {
    errors.push(...validateWorkflowDemandDiagnosticsAgainstInputs(value, inputs));
  }
  return [...new Set(errors)];
}
