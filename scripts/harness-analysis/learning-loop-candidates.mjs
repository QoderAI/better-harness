import { createHash } from "node:crypto";
import {
  buildNativeLearningReviewPacket,
  NATIVE_LEARNING_ABSTAIN_REASON_CODES,
  NATIVE_LEARNING_MATCH_REASON_CODES,
  NATIVE_LEARNING_PATTERN_IDS,
  NATIVE_LEARNING_REVIEW_PACKET_SCHEMA_VERSION,
  validateNativeLearningReviewPacket,
} from "./learning-loop-review-packet.mjs";

export {
  buildNativeLearningReviewPacket,
  nativeLearningReviewPacketDigest,
  NATIVE_LEARNING_ABSTAIN_REASON_CODES,
  NATIVE_LEARNING_MATCH_REASON_CODES,
  NATIVE_LEARNING_PATTERN_IDS,
  NATIVE_LEARNING_REVIEW_DECISIONS,
  NATIVE_LEARNING_REVIEW_KIND,
  NATIVE_LEARNING_REVIEW_PACKET_SCHEMA_VERSION,
  validateNativeLearningReviewPacket,
} from "./learning-loop-review-packet.mjs";

export const LEARNING_LOOP_REVIEW_SCHEMA_VERSION = 1;
export const NATIVE_LEARNING_APPLIED_REVIEW_SCHEMA_VERSION = 1;

export const LEARNING_LOOP_PATTERN_IDS = Object.freeze([
  "repeated-rediscovery",
  "recurring-correction",
  "successful-procedure-not-reused",
  "present-but-not-routed",
  "routed-but-not-applied",
  "stale-or-conflicting-asset",
  "stale-or-conflicting-memory",
  "cross-asset-duplication-or-contradiction",
  "correction-not-promoted",
  "asset-updated-not-reexercised",
  "unvalidated-intervention",
  "local-gain-without-transfer",
  "context-or-skill-regression",
  "unsafe-mutable-memory",
  "wrong-durable-owner",
  "memory-skill-duplication",
]);

export const LEARNING_LOOP_CLAIM_TYPES = Object.freeze(["opportunity", "readiness", "effectiveness"]);
export const LEARNING_LOOP_STAGES = Object.freeze([
  "capture", "generalize", "codify", "route", "exercise", "evaluate", "maintain",
]);
export const LEARNING_LOOP_OWNERS = Object.freeze([
  "Memory", "Rule", "Skill", "Hook", "Gate", "Workflow", "Agent", "Eval",
]);

export const LEARNING_LOOP_ASSET_KINDS = Object.freeze([
  "Memory", "Rule", "Skill", "Hook", "Gate", "Command", "MCP", "Agent", "Workflow", "Eval",
]);

const PATTERN_SET = new Set(LEARNING_LOOP_PATTERN_IDS);
const CLAIM_SET = new Set(LEARNING_LOOP_CLAIM_TYPES);
const STAGE_SET = new Set(LEARNING_LOOP_STAGES);
const OWNER_SET = new Set(LEARNING_LOOP_OWNERS);
const ASSET_KIND_SET = new Set(LEARNING_LOOP_ASSET_KINDS);
const CONFIDENCE_SET = new Set(["low", "medium", "high"]);
const FIELD_PROVENANCE = new Set(["host-observed", "deterministic-derived", "ai-reviewed"]);
const FIELD_COVERAGE = new Set(["observed", "partial", "unavailable"]);
const NORMALIZATION_VERSION = "learning-loop-normalization-v1";
const COVERAGE_FIELDS = Object.freeze([
  "assetCoverage", "capture", "patternDetection", "routing", "freshness", "application", "evolution", "effectiveness", "memoryGovernance",
]);
const COVERAGE_CODES = new Set([
  "checked-clean",
  "candidate-found",
  "not-evaluable-missing-asset-inventory",
  "insufficient-episodes",
  "insufficient-recurrence",
  "not-evaluable-missing-normalized-events",
  "not-evaluable-missing-invocation-events",
  "not-evaluable-missing-freshness-evidence",
  "not-evaluable-missing-application-events",
  "not-evaluable-missing-update-evidence",
  "pending-no-later-window",
  "comparable-result-observed",
  "not-evaluable-missing-memory-policy",
]);
const ASSET_SPECIFIC_PATTERN_IDS = new Set([
  "present-but-not-routed",
  "routed-but-not-applied",
  "stale-or-conflicting-asset",
  "stale-or-conflicting-memory",
  "cross-asset-duplication-or-contradiction",
  "memory-skill-duplication",
  "asset-updated-not-reexercised",
  "wrong-durable-owner",
]);
const CURRENT_TRUTH_ASSET_PATTERN_IDS = new Set([
  "stale-or-conflicting-asset",
  "stale-or-conflicting-memory",
  "cross-asset-duplication-or-contradiction",
  "memory-skill-duplication",
]);

function rows(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value, fallback = "") {
  const normalized = String(value ?? "").replace(/\s+/gu, " ").trim();
  return normalized || fallback;
}

function slug(value, fallback = "unclassified") {
  const normalized = text(value).toLowerCase().replace(/[^a-z0-9._/-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return normalized.slice(0, 80) || fallback;
}

function identifier(value, fallback) {
  const normalized = text(value).replace(/[^A-Za-z0-9._:/-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return normalized.slice(0, 160) || fallback;
}

function fingerprint(value, length = 20) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, length);
}

function integer(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function tokenCount(value) {
  if (Number.isFinite(Number(value))) return integer(value);
  if (!isObject(value)) return 0;
  return Object.values(value).reduce((sum, item) => sum + integer(item), 0);
}

function publicEvidenceRefs(value) {
  return rows(value).map((reference, index) => ({
    kind: slug(reference?.kind, "learning-signal"),
    id: slug(reference?.id, `evidence-${index + 1}`),
  }));
}

function assetKind(value, fallback = "") {
  const normalized = text(value).toLowerCase();
  const aliases = {
    memory: "Memory", memories: "Memory",
    rule: "Rule", rules: "Rule",
    skill: "Skill", skills: "Skill",
    hook: "Hook", hooks: "Hook",
    gate: "Gate", gates: "Gate",
    command: "Command", commands: "Command",
    mcp: "MCP", mcps: "MCP",
    agent: "Agent", agents: "Agent", subagent: "Agent", subagents: "Agent",
    workflow: "Workflow", workflows: "Workflow",
    eval: "Eval", evaluation: "Eval", evaluations: "Eval",
  };
  return aliases[normalized] ?? (ASSET_KIND_SET.has(value) ? value : fallback);
}

function normalizedAsset(signal = {}) {
  const supplied = isObject(signal.asset) ? signal.asset : {};
  const ref = identifier(supplied.ref ?? signal.assetRef, "");
  if (!ref) return null;
  return {
    kind: assetKind(supplied.kind ?? signal.assetKind, "Unknown"),
    ref,
    scope: slug(supplied.scope ?? signal.assetScope, "unspecified"),
    currentTruthRefs: publicEvidenceRefs(supplied.currentTruthRefs ?? signal.currentTruthRefs),
    requiredStepRefs: publicEvidenceRefs(supplied.requiredStepRefs ?? signal.requiredStepRefs),
    updateEvidenceRefs: publicEvidenceRefs(supplied.updateEvidenceRefs ?? signal.updateEvidenceRefs),
    outcomeEvidenceRefs: publicEvidenceRefs(supplied.outcomeEvidenceRefs ?? signal.outcomeEvidenceRefs),
  };
}

function assetOwner(signal, fallback) {
  const kind = signal?.asset?.kind ?? assetKind(signal?.assetKind);
  return {
    Memory: "Memory",
    Rule: "Rule",
    Skill: "Skill",
    Hook: "Hook",
    Gate: "Gate",
    Agent: "Agent",
    Workflow: "Workflow",
    Eval: "Eval",
  }[kind] ?? fallback;
}

function fieldState(value, provenance, observed = true) {
  return {
    provenance,
    coverage: observed ? "observed" : "unavailable",
  };
}

function booleanFieldObservation(signal, field) {
  const value = signal?.[field];
  const coverage = signal?.fieldEvidence?.[field]?.coverage;
  if (coverage === "unavailable") return { value: false, observed: false };
  if (coverage === "observed" && typeof value === "boolean") return { value, observed: true };
  const provenance = signal?.fieldProvenance?.[field];
  if (typeof value === "boolean" && (value === true || FIELD_PROVENANCE.has(provenance))) {
    return { value, observed: true };
  }
  return { value: false, observed: false };
}

function defaultOwner(patternId, signal = {}) {
  if (signal.mandatory === true || patternId === "unsafe-mutable-memory") return "Gate";
  if (patternId === "recurring-correction") return signal.procedural === true ? "Skill" : "Rule";
  if (patternId === "repeated-rediscovery") return signal.procedural === true ? "Skill" : "Memory";
  if (patternId === "successful-procedure-not-reused" || patternId === "present-but-not-routed" || patternId === "routed-but-not-applied") return assetOwner(signal, "Skill");
  if (["stale-or-conflicting-asset", "stale-or-conflicting-memory", "cross-asset-duplication-or-contradiction", "memory-skill-duplication"].includes(patternId)) return assetOwner(signal, "Memory");
  if (patternId === "correction-not-promoted") return assetOwner(signal, signal.procedural === true ? "Skill" : "Rule");
  if (["asset-updated-not-reexercised", "unvalidated-intervention", "local-gain-without-transfer", "context-or-skill-regression"].includes(patternId)) return "Eval";
  if (patternId === "wrong-durable-owner") return signal.requiredOwner && OWNER_SET.has(signal.requiredOwner) ? signal.requiredOwner : "Gate";
  return "Skill";
}

function brokenStage(patternId) {
  if (["repeated-rediscovery", "recurring-correction"].includes(patternId)) return "generalize";
  if (["successful-procedure-not-reused", "correction-not-promoted"].includes(patternId)) return "codify";
  if (patternId === "present-but-not-routed") return "route";
  if (patternId === "routed-but-not-applied") return "exercise";
  if (patternId === "asset-updated-not-reexercised") return "exercise";
  if (["unvalidated-intervention", "local-gain-without-transfer", "context-or-skill-regression"].includes(patternId)) return "evaluate";
  return "maintain";
}

function claimType(patternId) {
  return ["stale-or-conflicting-asset", "stale-or-conflicting-memory", "cross-asset-duplication-or-contradiction", "asset-updated-not-reexercised", "unvalidated-intervention", "unsafe-mutable-memory", "wrong-durable-owner", "memory-skill-duplication"].includes(patternId)
    ? "readiness"
    : "opportunity";
}

function candidateCopy(patternId, count) {
  const copies = {
    "repeated-rediscovery": ["Comparable episodes repeated the same discovery route.", "Make the route retrievable before comparable work starts."],
    "recurring-correction": ["Comparable episodes repeated the same explicit correction or exact repair route.", "Move the correction into the smallest durable owner and exercise it on later work."],
    "successful-procedure-not-reused": ["A successful procedure was available but comparable work repeated the earlier exploration.", "Codify and route the successful procedure for later tasks."],
    "present-but-not-routed": ["A relevant durable asset existed but was not selected for the matching task.", "Repair its trigger, namespace, or index and test positive and negative routing."],
    "routed-but-not-applied": ["A relevant asset was loaded but its required step was not applied.", "Tighten the procedure or promote mandatory behavior to a gate."],
    "stale-or-conflicting-asset": ["A durable asset conflicts with current repository truth or a newer governed record.", "Consolidate, supersede, or expire the stale asset."],
    "stale-or-conflicting-memory": ["Durable memory conflicts with current repository evidence or a newer record.", "Consolidate, supersede, or expire the stale memory."],
    "cross-asset-duplication-or-contradiction": ["Multiple durable assets overlap or contradict one another on the same task route.", "Choose one governed owner, split scopes where needed, and deprecate the losing route."],
    "correction-not-promoted": ["Comparable tasks repeated a correction but no discoverable durable asset was updated.", "Promote the correction into the smallest reviewed owner and exercise it later."],
    "asset-updated-not-reexercised": ["A durable asset changed, but no later comparable task re-exercised the change.", "Run a bounded later task before retaining the update."],
    "unvalidated-intervention": ["A durable intervention is pending without a comparable later result.", "Add a held-out or comparable evaluation and a retain, revise, or revert decision."],
    "local-gain-without-transfer": ["The intervention improved replay evidence without proving transfer.", "Test related held-out tasks before retaining the change."],
    "context-or-skill-regression": ["A primary result improved while a cost, safety, or unrelated-task guardrail regressed.", "Narrow or revert the intervention using the declared guardrail."],
    "unsafe-mutable-memory": ["Shared durable memory can be changed without reviewed provenance or isolation.", "Add a reviewed write path, isolation, expiry, and audit."],
    "wrong-durable-owner": ["A mandatory invariant depends on optional guidance.", "Move the invariant to a Hook or Gate and keep explanatory guidance optional."],
    "memory-skill-duplication": ["Overlapping durable assets compete for the same task route.", "Consolidate or split by scope, then deprecate the losing route."],
  };
  const [observed, intervention] = copies[patternId] ?? ["A learning-loop gap was observed.", "Repair the smallest broken lifecycle stage."];
  return { observedBehavior: `${observed} (${count} evidence-linked episode${count === 1 ? "" : "s"}).`, intervention };
}

export function normalizeLearningLoopEpisodes(episodes = []) {
  return rows(episodes).map((episode) => {
    const signals = rows(episode?.learningSignals).map((signal) => {
      const userCorrection = booleanFieldObservation(signal, "userCorrection");
      const patternId = PATTERN_SET.has(signal?.patternId) ? signal.patternId : null;
      const taskFamily = slug(signal?.taskFamily ?? episode?.taskFamily);
      const repoArea = slug(signal?.repoArea ?? rows(episode?.targetKeys)[0], "unobserved");
      const frictionType = slug(signal?.frictionType ?? patternId, "unobserved");
      const suppliedSignature = text(signal?.normalizedSignature);
      const normalizedSignature = slug(suppliedSignature, fingerprint({ taskFamily, repoArea, frictionType }));
      const suppliedProvenance = isObject(signal?.fieldProvenance) ? signal.fieldProvenance : {};
      const provenance = (field, fallback) => FIELD_PROVENANCE.has(suppliedProvenance[field])
        ? suppliedProvenance[field]
        : fallback;
      const asset = normalizedAsset(signal);
      return {
        ...(patternId ? { patternId } : {}),
        normalizedSignature,
        taskFamily,
        repoArea,
        changeType: slug(signal?.changeType, rows(episode?.changeSets).length > 0 ? "edit" : "unobserved"),
        frictionType,
        userCorrection: userCorrection.value,
        ...(asset ? { asset } : {}),
        assetLoaded: signal?.assetLoaded === true,
        assetChanged: signal?.assetChanged === true,
        assetRelevant: signal?.assetRelevant === true,
        requiredStepApplied: signal?.requiredStepApplied === true,
        mandatory: signal?.mandatory === true,
        procedural: signal?.procedural === true,
        validationResult: slug(signal?.validationResult ?? episode?.closure?.status, "unobserved"),
        deliveryResult: slug(signal?.deliveryResult, "unobserved"),
        elapsedMs: integer(signal?.elapsedMs ?? episode?.elapsedMs),
        toolCalls: integer(signal?.toolCalls ?? episode?.toolCalls),
        tokens: tokenCount(signal?.tokens ?? episode?.tokens),
        harnessVersion: slug(signal?.harnessVersion, "unobserved"),
        fieldEvidence: {
          taskFamily: fieldState(taskFamily, provenance("taskFamily", signal?.taskFamily ? "ai-reviewed" : "deterministic-derived"), taskFamily !== "unclassified"),
          repoArea: fieldState(repoArea, provenance("repoArea", signal?.repoArea ? "ai-reviewed" : "deterministic-derived"), repoArea !== "unobserved"),
          changeType: fieldState(signal?.changeType, provenance("changeType", signal?.changeType ? "ai-reviewed" : "deterministic-derived"), Boolean(signal?.changeType) || rows(episode?.changeSets).length > 0),
          frictionType: fieldState(signal?.frictionType, provenance("frictionType", "ai-reviewed"), Boolean(signal?.frictionType)),
          normalizedSignature: fieldState(normalizedSignature, provenance("normalizedSignature", suppliedSignature ? "ai-reviewed" : "deterministic-derived")),
          userCorrection: fieldState(signal?.userCorrection, provenance("userCorrection", "ai-reviewed"), userCorrection.observed),
          asset: fieldState(asset, provenance("asset", asset ? "ai-reviewed" : "host-observed"), Boolean(asset)),
          assetLoaded: fieldState(signal?.assetLoaded, provenance("assetLoaded", "host-observed"), signal?.assetLoaded !== undefined),
          assetRelevant: fieldState(signal?.assetRelevant, provenance("assetRelevant", "ai-reviewed"), signal?.assetRelevant !== undefined),
          requiredStepApplied: fieldState(signal?.requiredStepApplied, provenance("requiredStepApplied", "ai-reviewed"), signal?.requiredStepApplied !== undefined),
          assetChanged: fieldState(signal?.assetChanged, provenance("assetChanged", "host-observed"), signal?.assetChanged !== undefined),
          validationResult: fieldState(signal?.validationResult ?? episode?.closure?.status, provenance("validationResult", "deterministic-derived"), Boolean(signal?.validationResult ?? episode?.closure?.status)),
          deliveryResult: fieldState(signal?.deliveryResult, provenance("deliveryResult", "host-observed"), Boolean(signal?.deliveryResult)),
          elapsedMs: fieldState(signal?.elapsedMs ?? episode?.elapsedMs, provenance("elapsedMs", "deterministic-derived"), Number.isFinite(Number(signal?.elapsedMs ?? episode?.elapsedMs))),
          toolCalls: fieldState(signal?.toolCalls ?? episode?.toolCalls, provenance("toolCalls", "deterministic-derived"), Number.isFinite(Number(signal?.toolCalls ?? episode?.toolCalls))),
          tokens: fieldState(signal?.tokens ?? episode?.tokens, provenance("tokens", "host-observed"), tokenCount(signal?.tokens ?? episode?.tokens) > 0),
          harnessVersion: fieldState(signal?.harnessVersion, provenance("harnessVersion", "host-observed"), Boolean(signal?.harnessVersion)),
        },
        normalizationVersion: NORMALIZATION_VERSION,
        evidenceRefs: publicEvidenceRefs(signal?.evidenceRefs),
      };
    });
    return {
      episodeId: identifier(episode?.id, `episode-${fingerprint(episode)}`),
      targetKeys: rows(episode?.targetKeys).map((value) => slug(value)).slice(0, 12),
      signals,
    };
  });
}

function createCandidate(patternId, signature, members, overrides = {}) {
  const episodeIds = overrides.sourceEpisodes ?? [...new Set(members.map((member) => member.episodeId))];
  const signal = members[0]?.signal ?? {};
  const owner = overrides.recommendedOwner ?? defaultOwner(patternId, signal);
  const copy = candidateCopy(patternId, episodeIds.length);
  const recurrence = Math.min(5, episodeIds.length);
  const cost = Math.min(5, Math.max(1, Math.ceil(members.reduce((sum, member) => sum + member.signal.toolCalls, 0) / Math.max(1, episodeIds.length * 4))));
  const confidence = episodeIds.length >= 3 || (episodeIds.length >= 2 && members.every((member) => member.signal.userCorrection)) ? "high" : episodeIds.length >= 2 ? "medium" : "low";
  const leverage = ["Gate", "Eval"].includes(owner) ? 4 : 3;
  return {
    id: `learning-loop:${patternId}:${fingerprint(signature, 12)}`,
    patternId,
    claimType: overrides.claimType ?? claimType(patternId),
    provenance: overrides.provenance ?? "deterministic-derived",
    sourceEpisodes: episodeIds,
    taskFingerprint: {
      family: signal.taskFamily ?? "unclassified",
      repoArea: signal.repoArea ?? "unobserved",
    },
    normalizedSignature: signature,
    ...(signal.asset ? { asset: signal.asset } : {}),
    observedBehavior: overrides.observedBehavior ?? copy.observedBehavior,
    currentCost: {
      episodeCount: episodeIds.length,
      toolCalls: members.reduce((sum, member) => sum + member.signal.toolCalls, 0),
      elapsedMs: members.reduce((sum, member) => sum + member.signal.elapsedMs, 0),
      tokens: members.reduce((sum, member) => sum + member.signal.tokens, 0),
      userCorrections: members.filter((member) => member.signal.userCorrection).length,
    },
    candidateCauses: overrides.candidateCauses ?? ["The evidence was not converted into a governed reusable capability."],
    brokenStage: overrides.brokenStage ?? brokenStage(patternId),
    recommendedOwner: owner,
    intervention: overrides.intervention ?? copy.intervention,
    primaryMetric: overrides.primaryMetric ?? "recurrence cost on comparable tasks",
    guardrails: overrides.guardrails ?? ["false trigger rate", "unrelated-task token overhead"],
    stopOrRevert: overrides.stopOrRevert ?? "Revert or narrow the intervention when the primary metric is unchanged and any guardrail worsens.",
    confidence,
    priorityScore: recurrence * cost * leverage,
    evidenceRefs: members.flatMap((member) => member.signal.evidenceRefs),
  };
}

function patternCandidates(episodeRecords) {
  const groups = new Map();
  for (const episode of episodeRecords) {
    for (const signal of episode.signals) {
      if (!signal.patternId) continue;
      if (signal.frictionType === "protective-intervention") continue;
      if (["present-but-not-routed", "routed-but-not-applied"].includes(signal.patternId) && !signal.assetRelevant) continue;
      const key = `${signal.patternId}:${signal.normalizedSignature}`;
      const group = groups.get(key) ?? [];
      group.push({ episodeId: episode.episodeId, signal });
      groups.set(key, group);
    }
  }
  const candidates = [];
  for (const members of groups.values()) {
    const patternId = members[0].signal.patternId;
    const episodeCount = new Set(members.map((member) => member.episodeId)).size;
    const singleEpisodeReadiness = [
      "stale-or-conflicting-asset", "stale-or-conflicting-memory", "cross-asset-duplication-or-contradiction",
      "asset-updated-not-reexercised", "unsafe-mutable-memory", "wrong-durable-owner", "memory-skill-duplication",
    ].includes(patternId);
    const explicitRouting = patternId === "present-but-not-routed" && members.some((member) => !member.signal.assetLoaded);
    const explicitApplication = patternId === "routed-but-not-applied"
      && members.some((member) => member.signal.assetLoaded && !member.signal.requiredStepApplied);
    if (episodeCount < 2 && !singleEpisodeReadiness && !explicitRouting && !explicitApplication) continue;
    candidates.push(createCandidate(patternId, members[0].signal.normalizedSignature, members));
  }
  return candidates;
}

function interventionCandidates(interventions) {
  return rows(interventions)
    .filter((entry) => entry?.result?.state === "pending")
    .map((entry) => createCandidate(
      "unvalidated-intervention",
      slug(entry?.id, fingerprint(entry)),
      [{
        episodeId: identifier(entry?.episodeRef, `intervention-${fingerprint(entry)}`),
        signal: {
          taskFamily: "intervention-evaluation",
          repoArea: "harness",
          toolCalls: 0,
          elapsedMs: 0,
          tokens: 0,
          userCorrection: false,
          evidenceRefs: publicEvidenceRefs(entry?.frictionRefs),
        },
      }],
      {
        claimType: "readiness",
        sourceEpisodes: entry?.episodeRef ? [identifier(entry.episodeRef)] : [],
        recommendedOwner: "Eval",
        primaryMetric: text(entry?.primaryMetric?.id, "declared intervention primary metric"),
        guardrails: [text(entry?.guardrailMetric?.id, "declared intervention guardrail")],
        stopOrRevert: text(entry?.stopOrRevertCondition, "Stop or revert when a declared guardrail worsens."),
      },
    ));
}

function assetCoverageRows(value) {
  return rows(value).map((row) => ({
    surface: text(row?.surface),
    count: integer(row?.count),
  })).filter((row) => row.surface && row.count > 0);
}

function coverageFor(episodeRecords, candidates, signals, interventions, assetCoverage) {
  const episodeCount = episodeRecords.length;
  const normalizedSignalCount = episodeRecords.reduce((sum, episode) => sum + episode.signals.length, 0);
  const inventoryRows = assetCoverageRows(assetCoverage);
  const configuredCount = inventoryRows.reduce((sum, row) => sum + row.count, 0)
    + rows(signals?.configuredSkills).length + rows(signals?.memories).length;
  const apparentReadCount = rows(signals?.apparentSkillReads).length;
  const routedEvents = rows(signals?.observedSkills).length + episodeRecords.flatMap((episode) => episode.signals)
    .filter((signal) => signal.assetLoaded).length;
  const applicationEvents = episodeRecords.flatMap((episode) => episode.signals)
    .filter((signal) => signal.requiredStepApplied).length;
  const comparableResults = rows(interventions).filter((entry) => entry?.result?.state && entry.result.state !== "pending").length;
  const hasMemoryInventory = rows(signals?.memories).length > 0;
  const freshnessCandidate = candidates.some((candidate) => [
    "stale-or-conflicting-asset", "stale-or-conflicting-memory", "cross-asset-duplication-or-contradiction", "memory-skill-duplication",
  ].includes(candidate.patternId));
  const evolutionCandidate = candidates.some((candidate) => [
    "correction-not-promoted", "asset-updated-not-reexercised", "unvalidated-intervention",
  ].includes(candidate.patternId));
  const updateEvents = episodeRecords.flatMap((episode) => episode.signals).filter((signal) => signal.assetChanged).length;
  return {
    assetCoverage: inventoryRows.length > 0 ? "checked-clean" : "not-evaluable-missing-asset-inventory",
    capture: normalizedSignalCount > 0 ? "checked-clean" : "not-evaluable-missing-normalized-events",
    patternDetection: candidates.some((candidate) => candidate.patternId !== "unvalidated-intervention")
      ? "candidate-found"
      : episodeCount < 2 ? "insufficient-episodes" : "insufficient-recurrence",
    routing: routedEvents > 0 ? "checked-clean" : configuredCount > 0 || apparentReadCount > 0 ? "not-evaluable-missing-invocation-events" : "checked-clean",
    freshness: freshnessCandidate ? "candidate-found" : configuredCount > 0 ? "not-evaluable-missing-freshness-evidence" : "checked-clean",
    application: applicationEvents > 0 ? "checked-clean" : "not-evaluable-missing-application-events",
    evolution: comparableResults > 0 ? "comparable-result-observed" : evolutionCandidate ? "candidate-found" : updateEvents > 0 ? "pending-no-later-window" : "not-evaluable-missing-update-evidence",
    effectiveness: comparableResults > 0 ? "comparable-result-observed" : "pending-no-later-window",
    memoryGovernance: hasMemoryInventory ? "not-evaluable-missing-memory-policy" : "checked-clean",
  };
}

export function buildLearningLoopReview({ episodes = [], signals = {}, interventions = [], assetCoverage = [] } = {}) {
  const episodeRecords = normalizeLearningLoopEpisodes(episodes);
  const candidates = [...patternCandidates(episodeRecords), ...interventionCandidates(interventions)]
    .sort((left, right) => right.priorityScore - left.priorityScore || left.id.localeCompare(right.id));
  return {
    schemaVersion: LEARNING_LOOP_REVIEW_SCHEMA_VERSION,
    status: "candidate",
    episodeRecords,
    candidates,
    coverage: coverageFor(episodeRecords, candidates, signals, interventions, assetCoverage),
  };
}

function nativeReviewAllowedFields(value, allowed, location, errors) {
  if (!isObject(value)) {
    errors.push(location + " must be an object");
    return;
  }
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) errors.push(location + " has unsupported field: " + field);
  }
}

function exactSortedStrings(value) {
  return rows(value).map((item) => String(item ?? "")).sort();
}

function sameStringSet(left, right) {
  return JSON.stringify(exactSortedStrings(left)) === JSON.stringify(exactSortedStrings(right));
}

function validateNativeDecision(decision, index, group, errors) {
  const location = "native learning review decisions[" + index + "]";
  nativeReviewAllowedFields(
    decision,
    new Set(["groupRef", "decision", "patternId", "episodeRefs", "evidenceRefs", "reasonCodes"]),
    location,
    errors,
  );
  if (!["match", "abstain"].includes(decision?.decision)) {
    errors.push(location + ".decision must be match or abstain");
    return;
  }
  const reasonCodes = rows(decision?.reasonCodes);
  for (const field of ["episodeRefs", "evidenceRefs"]) {
    if (decision?.[field] !== undefined && !Array.isArray(decision[field])) {
      errors.push(location + "." + field + " must be an array when present");
    }
  }
  if (reasonCodes.length === 0 || new Set(reasonCodes).size !== reasonCodes.length) {
    errors.push(location + ".reasonCodes must contain distinct reason codes");
  }
  if (decision.decision === "abstain") {
    if (decision.patternId !== undefined) errors.push(location + ".patternId must be omitted for abstain");
    if (rows(decision.episodeRefs).length > 0) errors.push(location + ".episodeRefs must be empty for abstain");
    if (rows(decision.evidenceRefs).length > 0) errors.push(location + ".evidenceRefs must be empty for abstain");
    if (reasonCodes.some((code) => !NATIVE_LEARNING_ABSTAIN_REASON_CODES.includes(code))) {
      errors.push(location + ".reasonCodes contains an unsupported abstain reason");
    }
    return;
  }
  if (!NATIVE_LEARNING_PATTERN_IDS.includes(decision.patternId)
    || !group.allowedPatternIds.includes(decision.patternId)) {
    errors.push(location + ".patternId is not allowed for this group");
  }
  if (!sameStringSet(decision.episodeRefs, group.episodeRefs)
    || new Set(rows(decision.episodeRefs)).size !== rows(decision.episodeRefs).length) {
    errors.push(location + ".episodeRefs must match the group distinct Episode allowlist");
  }
  const allowedEvidence = new Set(group.evidenceRefs);
  const suppliedEvidence = rows(decision.evidenceRefs);
  if (suppliedEvidence.length === 0 || new Set(suppliedEvidence).size !== suppliedEvidence.length) {
    errors.push(location + ".evidenceRefs must contain distinct packet evidence refs");
  }
  if (suppliedEvidence.some((reference) => !allowedEvidence.has(reference))) {
    errors.push(location + ".evidenceRefs contains a ref outside the packet allowlist");
  }
  for (const episodeRef of group.episodeRefs) {
    const owned = new Set(rows(group.evidenceOwnership?.[episodeRef]));
    if (!suppliedEvidence.some((reference) => owned.has(reference))) {
      errors.push(location + ".evidenceRefs requires evidence owned by " + episodeRef);
    }
  }
  if (reasonCodes.some((code) => !NATIVE_LEARNING_MATCH_REASON_CODES.includes(code)
    || !group.reasonCodes.includes(code))) {
    errors.push(location + ".reasonCodes contains a reason not supported by the packet group");
  }
  const identityReasons = new Set(["same-task-route", "same-target", "same-check"]);
  if (!reasonCodes.some((code) => identityReasons.has(code))) {
    errors.push(location + ".reasonCodes requires one shared identity reason");
  }
  const hasCorrectionReason = reasonCodes.includes("explicit-user-correction")
    || reasonCodes.includes("same-check-repair");
  if (!hasCorrectionReason) errors.push(location + ".reasonCodes requires a supported recurring correction reason");
}

export function validateNativeLearningCandidateReview({ episodes = [], packet, review } = {}) {
  const errors = [...validateNativeLearningReviewPacket({ episodes, packet })];
  nativeReviewAllowedFields(
    review,
    new Set(["schemaVersion", "sourceDigest", "packetDigest", "decisions"]),
    "native learning review",
    errors,
  );
  if (review?.schemaVersion !== NATIVE_LEARNING_REVIEW_PACKET_SCHEMA_VERSION) {
    errors.push("native learning review schemaVersion must be " + NATIVE_LEARNING_REVIEW_PACKET_SCHEMA_VERSION);
  }
  if (review?.sourceDigest !== packet?.sourceDigest) {
    errors.push("native learning review sourceDigest does not match the review packet");
  }
  if (review?.packetDigest !== packet?.packetDigest) {
    errors.push("native learning review packetDigest does not match the review packet");
  }
  if (!Array.isArray(review?.decisions)) errors.push("native learning review decisions must be an array");
  const groups = rows(packet?.groups);
  const groupMap = new Map(groups.map((group) => [group.groupRef, group]));
  const counts = new Map();
  for (const [index, decision] of rows(review?.decisions).entries()) {
    const groupRef = String(decision?.groupRef ?? "");
    counts.set(groupRef, (counts.get(groupRef) ?? 0) + 1);
    const group = groupMap.get(groupRef);
    if (!group) {
      errors.push("native learning review decisions[" + index + "].groupRef is not present in the review packet");
      continue;
    }
    validateNativeDecision(decision, index, group, errors);
  }
  for (const group of groups) {
    if ((counts.get(group.groupRef) ?? 0) !== 1) {
      errors.push("native learning review requires exactly one decision for group " + group.groupRef);
    }
  }
  for (const [groupRef, count] of counts) {
    if (count > 1 && groupMap.has(groupRef)) {
      errors.push("native learning review duplicates decision for group " + groupRef);
    }
  }
  return [...new Set(errors)].sort();
}

function nativeSignalSignature(group) {
  return String(group?.patternSignature ?? "");
}

function orderedByGroupRef(decisions) {
  return [...rows(decisions)]
    .sort((left, right) => String(left?.groupRef ?? "").localeCompare(String(right?.groupRef ?? "")));
}

function commonProviderSignature(episodes, patternId) {
  const signatureSets = episodes.map((episode) => new Set(rows(episode?.learningSignals)
    .filter((signal) => signal?.patternId === patternId
      && !signal?.nativeReview
      && text(signal?.normalizedSignature))
    .map((signal) => text(signal.normalizedSignature))));
  if (signatureSets.length === 0) return "";
  return [...signatureSets[0]]
    .filter((signature) => signatureSets.every((set) => set.has(signature)))
    .sort()[0] ?? "";
}

function dedupeLearningSignals(signals) {
  const seen = new Set();
  return rows(signals).filter((signal, index) => {
    const patternId = text(signal?.patternId);
    const normalizedSignature = text(signal?.normalizedSignature);
    const key = patternId && normalizedSignature
      ? patternId + "\u0000" + normalizedSignature
      : "unkeyed\u0000" + index;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function reviewedNativeSignal({ decision, group, signature, episodeFact }) {
  const explicitUserCorrection = decision.reasonCodes.includes("explicit-user-correction")
    && episodeFact?.facts?.userCorrection === "true";
  const exactRepair = decision.reasonCodes.includes("same-check-repair")
    && episodeFact?.facts?.sameCheckRepair === "true";
  const taskFamily = rows(group?.sharedIdentity?.taskRoutes)[0];
  const repoArea = rows(group?.sharedIdentity?.targetRefs)[0];
  const ownedEvidence = new Set(rows(group?.evidenceOwnership?.[episodeFact?.episodeRef]));
  const signal = {
    patternId: decision.patternId,
    normalizedSignature: signature,
    frictionType: explicitUserCorrection ? "user-correction" : exactRepair ? "same-check-repair" : "unobserved",
    procedural: false,
    fieldProvenance: {
      frictionType: "ai-reviewed",
      normalizedSignature: "deterministic-derived",
    },
    evidenceRefs: rows(decision.evidenceRefs).filter((reference) => ownedEvidence.has(reference)).map((reference) => ({
      kind: "native-learning-evidence",
      id: reference,
    })),
    nativeReview: {
      groupRef: group.groupRef,
      reasonCodes: [...decision.reasonCodes],
    },
  };
  if (taskFamily) {
    signal.taskFamily = taskFamily;
    signal.fieldProvenance.taskFamily = "deterministic-derived";
  }
  if (repoArea) {
    signal.repoArea = repoArea;
    signal.fieldProvenance.repoArea = "deterministic-derived";
  }
  if (explicitUserCorrection) {
    signal.userCorrection = true;
    signal.fieldProvenance.userCorrection = "deterministic-derived";
  }
  return signal;
}

function appliedNativeCoverage(packet, decisions) {
  const matchedGroupCount = decisions.filter((decision) => decision.decision === "match").length;
  const abstainedGroupCount = decisions.filter((decision) => decision.decision === "abstain").length;
  return {
    status: packet?.coverage?.truncated === true ? "reviewed-partial" : "reviewed",
    candidateGroupCount: rows(packet?.groups).length,
    matchedGroupCount,
    abstainedGroupCount,
    coverageReasonCodes: rows(packet?.coverage?.reasonCodes),
  };
}

export function applyNativeLearningCandidateReview({
  episodes = [],
  packet,
  review,
  signals = {},
  interventions = [],
  assetCoverage = [],
} = {}) {
  const errors = validateNativeLearningCandidateReview({ episodes, packet, review });
  if (errors.length > 0) return { result: null, errors };

  const reviewedEpisodes = structuredClone(rows(episodes));
  const episodesById = new Map(rows(reviewedEpisodes).map((episode) => [String(episode?.id ?? ""), episode]));
  const episodeFactsById = new Map(rows(packet?.episodeFacts).map((episode) => [episode.episodeRef, episode]));
  const groupsById = new Map(rows(packet?.groups).map((group) => [group.groupRef, group]));
  const matchDecisions = rows(review?.decisions).filter((decision) => decision.decision === "match");
  const signatureByGroupRef = new Map(matchDecisions.map((decision) => {
    const group = groupsById.get(decision.groupRef);
    const sourceEpisodes = group.episodeRefs.map((episodeRef) => episodesById.get(episodeRef));
    return [
      decision.groupRef,
      commonProviderSignature(sourceEpisodes, decision.patternId) || nativeSignalSignature(group),
    ];
  }));
  const matches = [];
  const abstentions = [];
  for (const decision of orderedByGroupRef(review?.decisions)) {
    const group = groupsById.get(decision.groupRef);
    if (decision.decision === "abstain") {
      abstentions.push({ groupRef: decision.groupRef, reasonCodes: [...decision.reasonCodes] });
      continue;
    }
    const sourceEpisodes = group.episodeRefs.map((episodeRef) => episodesById.get(episodeRef));
    const signature = signatureByGroupRef.get(decision.groupRef);
    for (const episode of sourceEpisodes) {
      episode.learningSignals = dedupeLearningSignals(episode.learningSignals);
      const exists = episode.learningSignals.some((signal) => signal?.patternId === decision.patternId
        && text(signal?.normalizedSignature) === signature);
      if (!exists) episode.learningSignals.push(reviewedNativeSignal({
        decision,
        group,
        signature,
        episodeFact: episodeFactsById.get(episode.id),
      }));
    }
    matches.push({
      groupRef: decision.groupRef,
      patternId: decision.patternId,
      sourceEpisodes: [...group.episodeRefs],
      normalizedSignature: signature,
      evidenceRefs: decision.evidenceRefs.map((reference) => ({
        kind: "native-learning-evidence",
        id: reference,
      })),
      reasonCodes: [...decision.reasonCodes],
      claimType: "opportunity",
    });
  }

  const learningLoop = buildLearningLoopReview({ episodes: reviewedEpisodes, signals, interventions, assetCoverage });
  return {
    result: {
      schemaVersion: NATIVE_LEARNING_APPLIED_REVIEW_SCHEMA_VERSION,
      kind: "native-learning-candidate-review",
      status: "reviewed",
      sourceDigest: packet.sourceDigest,
      packetDigest: packet.packetDigest,
      matches,
      abstentions,
      coverage: appliedNativeCoverage(packet, review.decisions),
      learningLoop,
    },
    errors: [],
  };
}

export function validateLearningLoopReview(value, { episodeIds = [] } = {}) {
  if (!isObject(value)) return ["learning loop review must be an object"];
  const errors = [];
  const allowedFields = new Set(["schemaVersion", "status", "episodeRecords", "candidates", "coverage"]);
  for (const field of Object.keys(value)) if (!allowedFields.has(field)) errors.push(`learning loop review has unsupported field: ${field}`);
  if (value.schemaVersion !== LEARNING_LOOP_REVIEW_SCHEMA_VERSION) errors.push(`learning loop review schemaVersion must be ${LEARNING_LOOP_REVIEW_SCHEMA_VERSION}`);
  if (!['candidate', 'reviewed'].includes(value.status)) errors.push("learning loop review status must be candidate or reviewed");
  if (!Array.isArray(value.episodeRecords)) errors.push("learning loop review episodeRecords must be an array");
  if (!Array.isArray(value.candidates)) errors.push("learning loop review candidates must be an array");
  if (!isObject(value.coverage)) errors.push("learning loop review coverage must be an object");
  const knownEpisodes = new Set(episodeIds);
  for (const [index, candidate] of rows(value.candidates).entries()) {
    const at = `learning loop review candidates[${index}]`;
    if (!PATTERN_SET.has(candidate?.patternId)) errors.push(`${at}.patternId is invalid`);
    if (!CLAIM_SET.has(candidate?.claimType)) errors.push(`${at}.claimType is invalid`);
    if (!FIELD_PROVENANCE.has(candidate?.provenance)) errors.push(`${at}.provenance is invalid`);
    if (!STAGE_SET.has(candidate?.brokenStage)) errors.push(`${at}.brokenStage is invalid`);
    if (!OWNER_SET.has(candidate?.recommendedOwner)) errors.push(`${at}.recommendedOwner is invalid`);
    if (!CONFIDENCE_SET.has(candidate?.confidence)) errors.push(`${at}.confidence is invalid`);
    if (!Array.isArray(candidate?.sourceEpisodes)
      || (candidate.sourceEpisodes.length === 0 && candidate?.patternId !== "unvalidated-intervention")) {
      errors.push(`${at}.sourceEpisodes must be non-empty except for an intervention without an episode link`);
    }
    if (knownEpisodes.size > 0 && rows(candidate?.sourceEpisodes).some((id) => !knownEpisodes.has(id))) errors.push(`${at}.sourceEpisodes reference an unknown task episode`);
    for (const field of ["id", "normalizedSignature", "observedBehavior", "intervention", "primaryMetric", "stopOrRevert"]) {
      if (!text(candidate?.[field])) errors.push(`${at}.${field} must be non-empty`);
    }
    if (!Array.isArray(candidate?.candidateCauses) || candidate.candidateCauses.length === 0) errors.push(`${at}.candidateCauses must be non-empty`);
    if (!Array.isArray(candidate?.guardrails) || candidate.guardrails.length === 0) errors.push(`${at}.guardrails must be non-empty`);
    if (!isObject(candidate?.taskFingerprint)
      || !text(candidate.taskFingerprint.family)
      || !text(candidate.taskFingerprint.repoArea)) errors.push(`${at}.taskFingerprint must name family and repoArea`);
    if (!isObject(candidate?.currentCost)
      || !Number.isInteger(candidate.currentCost.episodeCount)
      || candidate.currentCost.episodeCount < 0) errors.push(`${at}.currentCost must contain a non-negative episodeCount`);
    if (!Array.isArray(candidate?.evidenceRefs)) errors.push(`${at}.evidenceRefs must be an array`);
    if (candidate?.asset !== undefined) {
      if (!isObject(candidate.asset)
        || !text(candidate.asset.kind)
        || !text(candidate.asset.ref)
        || !text(candidate.asset.scope)) {
        errors.push(`${at}.asset must name kind, ref, and scope`);
      }
      for (const field of ["currentTruthRefs", "requiredStepRefs", "updateEvidenceRefs", "outcomeEvidenceRefs"]) {
        if (!Array.isArray(candidate?.asset?.[field])) errors.push(`${at}.asset.${field} must be an array`);
      }
    }
    if (value.status === "reviewed" && ASSET_SPECIFIC_PATTERN_IDS.has(candidate?.patternId) && candidate?.asset === undefined) {
      errors.push(`${at}.asset is required for a reviewed asset-specific candidate`);
    }
    if (value.status === "reviewed" && CURRENT_TRUTH_ASSET_PATTERN_IDS.has(candidate?.patternId)
      && rows(candidate?.asset?.currentTruthRefs).length === 0) {
      errors.push(`${at}.asset.currentTruthRefs is required for a reviewed freshness or conflict candidate`);
    }
    if (value.status === "reviewed" && candidate?.patternId === "routed-but-not-applied"
      && rows(candidate?.asset?.requiredStepRefs).length === 0) {
      errors.push(`${at}.asset.requiredStepRefs is required for a reviewed application candidate`);
    }
    if (value.status === "reviewed" && candidate?.patternId === "asset-updated-not-reexercised"
      && rows(candidate?.asset?.updateEvidenceRefs).length === 0) {
      errors.push(`${at}.asset.updateEvidenceRefs is required for a reviewed re-exercise candidate`);
    }
    if (!Number.isInteger(candidate?.priorityScore) || candidate.priorityScore < 0) errors.push(`${at}.priorityScore must be a non-negative integer`);
  }
  for (const [episodeIndex, episode] of rows(value.episodeRecords).entries()) {
    for (const [signalIndex, signal] of rows(episode?.signals).entries()) {
      const at = `learning loop review episodeRecords[${episodeIndex}].signals[${signalIndex}]`;
      if (signal?.normalizationVersion !== NORMALIZATION_VERSION) errors.push(`${at}.normalizationVersion is invalid`);
      if (!isObject(signal?.fieldEvidence)) errors.push(`${at}.fieldEvidence must be an object`);
      for (const [field, evidence] of Object.entries(signal?.fieldEvidence ?? {})) {
        if (!FIELD_PROVENANCE.has(evidence?.provenance)) errors.push(`${at}.fieldEvidence.${field}.provenance is invalid`);
        if (!FIELD_COVERAGE.has(evidence?.coverage)) errors.push(`${at}.fieldEvidence.${field}.coverage is invalid`);
      }
    }
  }
  for (const field of COVERAGE_FIELDS) {
    if (!COVERAGE_CODES.has(value?.coverage?.[field])) errors.push(`learning loop review coverage.${field} is invalid`);
  }
  for (const field of Object.keys(value?.coverage ?? {})) {
    if (!COVERAGE_FIELDS.includes(field)) errors.push(`learning loop review coverage has unsupported field: ${field}`);
  }
  return errors;
}
