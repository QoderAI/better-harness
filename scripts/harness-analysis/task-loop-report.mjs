#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HOST_CAPABILITIES, hostIdSetFor } from "../host-support/index.mjs";
import { projectSemanticFacets, validateSemanticFacets } from "../session-analysis/index.mjs";
import { findingTargetErrors } from "../workspace-topology/index.mjs";
import {
  AGENT_WORK_LOOP_DIMENSIONS,
  AGENT_WORK_LOOP_DIMENSION_IDS,
  AGENT_WORK_LOOP_MODEL_ID,
  AGENT_WORK_LOOP_REPORT_CONTRACT_VERSION,
  LEARNING_CAPTURE_REVIEWED_SCORE_FLOOR,
  TASK_LOOP_EVIDENCE_LAYERS,
  agentWorkLoopDimensionScoreCeiling,
  isAgentWorkLoopReport,
  scoreAgentWorkLoopDimension,
} from "./fluency-dimensions.mjs";
import {
  LEARNING_LOOP_CHECK_IDS,
  learningCaptureScoreCeiling,
  learningLoopStateErrors,
  projectLaterValidationState,
  projectLearningLoopState,
} from "./learning-loop-contract.mjs";
import {
  FINDING_OUTPUT_ARTIFACTS,
  findingOutputContractErrors,
  readerOverviewTextErrors,
  validateHarnessReportSource,
} from "./report-source.mjs";
import { restoreProjectedInterventionLedger, summarizeLearningCapture } from "./intervention-ledger.mjs";

const SESSION_ANALYSIS_HOST_SET = hostIdSetFor(HOST_CAPABILITIES.SESSION_ANALYSIS);

const DIMENSIONS = AGENT_WORK_LOOP_DIMENSIONS;

const DIMENSION_BY_ID = new Map(DIMENSIONS.map((dimension) => [dimension.id, dimension]));
const AI_AGENT_PRACTICE_SURFACES = Object.freeze(["Rules", "Hooks", "Skills", "Commands", "Custom Agents", "MCP", "Workflows", "Plugins", "Session Insights", "Memories"]);
const AI_AGENT_PRACTICE_SURFACE_SET = new Set(AI_AGENT_PRACTICE_SURFACES);
const AI_AGENT_PRACTICE_SCOPES = Object.freeze(["Project", "Inherited", "Global", "Plugin"]);
const AI_AGENT_PRACTICE_SCOPE_SET = new Set(AI_AGENT_PRACTICE_SCOPES);
export const TASK_LOOP_SUGGESTION_KINDS = Object.freeze([
  "try-existing",
  "working-pattern",
  "loop-candidate",
  "horizon",
]);
const TASK_LOOP_SUGGESTION_KIND_SET = new Set(TASK_LOOP_SUGGESTION_KINDS);
const TASK_LOOP_SUGGESTION_CONFIDENCE_SET = new Set(["High", "Medium", "Low"]);
const TASK_LOOP_SUGGESTIONS_CONTRACT_VERSION = 24;
const EXPECTED_ARTIFACTS = FINDING_OUTPUT_ARTIFACTS;
const EXPECTED_ARTIFACT_SET = new Set(EXPECTED_ARTIFACTS);
const TASK_LOOP_REPORT_CONTRACT_VERSION = AGENT_WORK_LOOP_REPORT_CONTRACT_VERSION;
export const TASK_LOOP_CANVAS_DATA_SCHEMA_VERSION = 1;
export const TASK_LOOP_SUMMARY_FACTS_CANVAS_SCHEMA_VERSION = 1;
const GENERATED_SCORE_REASONS = Object.freeze({
  en: "Generated conservatively from the bounded repository and task evidence retained by this run.",
  "zh-CN": "该分数由本次运行保留的有界仓库与任务证据保守生成。",
});
const TASK_LOOP_HOST_SUMMARY_FIELDS = Object.freeze([
  "projectName", "locale", "modelId", "reportContractVersion", "overview", "strengths",
  "dimensions", "aiAgentPractice", "suggestions", "assignmentSummaries",
]);
const LEGACY_TASK_LOOP_HOST_SUMMARY_FIELDS = Object.freeze(["atAGlance", "learningCapture"]);
const TASK_LOOP_HOST_DIMENSION_FIELDS = Object.freeze([
  "id", "label", "score", "scoreReason", "scoreConfidence", "scoreEvidenceRefs", "summary", "findingRefs",
]);
const LEGACY_TASK_LOOP_HOST_DIMENSION_FIELDS = Object.freeze(["state"]);
const TASK_LOOP_HOST_FINDING_FIELDS = Object.freeze([
  "id", "title", "severity", "reason", "expectedOutput", "expectedArtifact", "aiFixPrompt", "dimensionRefs",
  "target", "actualOutputRevision", "actualOutput", "assignmentSummary", "postFixRepairReview", "postFixScoreReview",
]);
const LEGACY_TASK_LOOP_HOST_FINDING_FIELDS = Object.freeze(["kind", "subdimensionRefs", "evidenceBridge"]);
const TASK_LOOP_CANVAS_SUMMARY_FIELDS = Object.freeze([
  "evidenceMode", "atAGlance", "evidenceBoundary", "semanticFacets",
  "usageActivity", "usageEfficiency", "contextUsage", "learningCapture",
]);
const TASK_LOOP_MACHINE_SUMMARY_FACT_FIELDS = Object.freeze([
  "evidenceMode", "evidenceBoundary", "semanticFacets", "learningCapture",
  "usageActivity", "usageEfficiency", "contextUsage",
]);
const TASK_LOOP_CANVAS_DIMENSION_FIELDS = Object.freeze([
  "id", "level", "state", "subdimensions", "evidenceBridge", "blocker", "scoreReason", "scoreConfidence", "scoreEvidenceRefs",
]);
const TASK_LOOP_CANVAS_FINDING_FIELDS = Object.freeze(["id", "kind", "subdimensionRefs", "evidenceBridge"]);
const REQUIRED_REPOSITORY_REVIEW_FRAMEWORKS = Object.freeze([
  "coding-agent-practices",
  "software-fluency",
]);
const REQUIRED_SOFTWARE_FLUENCY_CAPABILITIES = Object.freeze([
  "context-map",
  "environment-readiness",
  "fast-feedback",
  "quality-gates",
  "safe-change",
]);
const PRACTICE_SURFACE_BY_DIMENSION_ID = new Map([
  ["task-understanding", { surface: "Rules" }],
  ["controlled-execution", { surface: "Skills" }],
  ["change-validation", { surface: "Session Insights" }],
  ["reliable-delivery", { surface: "Hooks" }],
]);
const OUTCOME_PROFILE_BY_ID = new Map([
  ["task-understanding", {
    title: "Comparable tasks still lack a reliable starting scope",
    reason: "Closing this gap lets agents start comparable tasks in the right scope, reducing corrections and avoidable rework.",
    move: "Make the task route and change boundary explicit at the entry point, then capture route corrections from comparable tasks.",
    expectedUnlock: "Agents start comparable tasks in the right scope, with fewer corrections and less avoidable rework.",
    zhTitle: "相似任务还缺少可靠的起步范围",
    zhReason: "补上这个缺口后，Agent 能在正确范围内开始相似任务，减少纠偏和可避免的返工。",
    zhMove: "在入口明确任务路径和改动边界，再记录相似任务中的路径纠偏。",
    zhExpectedUnlock: "Agent 能在正确范围内开始相似任务，减少纠偏和可避免的返工。",
  }],
  ["controlled-execution", {
    title: "Task startup still depends on manual environment rescue",
    reason: "Closing this gap lets a clean task reach a safe first action without invented setup or permission steps.",
    move: "Make the setup, reset, or permission boundary runnable from a clean workspace and retain its task-level result.",
    expectedUnlock: "A clean task reaches a safe first action without manual environment rescue.",
    zhTitle: "任务启动仍依赖人工救火",
    zhReason: "补上这个缺口后，干净任务可以到达安全的第一步，无需编造配置或权限步骤。",
    zhMove: "让干净工作区可直接执行设置、重置或权限边界，并保留任务级结果。",
    zhExpectedUnlock: "干净任务能到达安全的第一步，不再依赖人工处理环境问题。",
  }],
  ["change-validation", {
    title: "Changed work still lacks reliable proof before review",
    reason: "Closing this gap lets changes reach review with relevant proof, catching defects earlier and reducing repeated validation work.",
    move: "Map affected changes to focused checks and retain the relevant failure, repair, and pass result.",
    expectedUnlock: "Changes reach review with relevant proof, so defects are found earlier and rework drops.",
    zhTitle: "改动在评审前仍缺少可靠证明",
    zhReason: "补上这个缺口后，改动带着相关证明进入评审，更早发现缺陷并减少重复验证。",
    zhMove: "把受影响的改动映射到聚焦检查，并保留相关失败、修复和通过结果。",
    zhExpectedUnlock: "改动带着相关证明进入评审，更早发现缺陷并减少返工。",
  }],
  ["reliable-delivery", {
    title: "Risky changes still lack a proven acceptance and recovery path",
    reason: "Closing this gap lets risky work stop or escalate before acceptance and leaves a usable recovery path when a control fires.",
    move: "Connect the protection or acceptance control to task decisions, recovery, and accepted delivery results.",
    expectedUnlock: "Risky changes are blocked or escalated before acceptance, with a usable recovery path.",
    zhTitle: "高风险改动仍缺少已证明的验收和恢复路径",
    zhReason: "补上这个缺口后，高风险工作会在验收前停止或升级，并在控制触发时留下可用恢复路径。",
    zhMove: "把保护或验收控制连接到任务决策、恢复和已接受的交付结果。",
    zhExpectedUnlock: "高风险改动会在验收前被阻止或升级，并保留可用的恢复路径。",
  }],
  ["learning-capture", {
    title: "Recurring experience is not yet captured in a reusable owner",
    reason: "Closing this gap makes lifecycle and recurring opportunities discoverable, reusable, and maintainable while reserving effect claims for comparable later outcomes.",
    move: "Capture the supported opportunity in the smallest durable owner and retain a longitudinal outcome or maintenance-validation route.",
    expectedUnlock: "Similar tasks can reuse the improvement, while later outcomes or maintenance inspections keep its claims accurate.",
    zhTitle: "反复出现的经验尚未沉淀到可复用载体",
    zhReason: "补上这个缺口后，生命周期和重复机会会变得可查找、可复用、可维护；效果结论仍由可比的长期结果验证。",
    zhMove: "把有证据支持的机会沉淀到最小持久载体，并保留长期结果或维护检查路径。",
    zhExpectedUnlock: "后续类似任务可以复用这项改进，长期结果或维护检查会持续校验其准确性。",
  }],
]);
const FALLBACK_OUTCOME_PROFILE = Object.freeze({
  title: "The next comparable task still has an unresolved reliability gap",
  reason: "Closing this gap gives users a clearer success path with less manual follow-up and avoidable rework.",
  move: "Close the named gap with the smallest owned Harness change and retain the project result.",
  expectedUnlock: "The next comparable task completes with less manual follow-up and clearer proof of success.",
  zhTitle: "下一次相似任务仍有未解决的可靠性缺口",
  zhReason: "补上这个缺口后，用户将获得更清楚的成功路径，减少人工跟进和可避免的返工。",
  zhMove: "用最小且有负责人的 Harness 改动补上已命名缺口，并保留项目结果。",
  zhExpectedUnlock: "下一次相似任务能以更少人工跟进和更清楚的成功证明完成。",
});
const READER_PROFILE_BY_ID = new Map([
  ["task-understanding", {
    capability: "similar tasks can start in the right scope",
    short: "task-starting scope",
    whyItMatters: "Without a clear starting scope, the agent can work in the wrong area and create avoidable correction work.",
    doneWhen: "A similar task records its goal, change boundary, and next check before work begins.",
    zhCapability: "相似任务能在正确范围内开始",
    zhShort: "任务起步范围",
    zhWhyItMatters: "起步范围不清楚时，Agent 可能改到错误位置，后面还要花时间纠正和返工。",
    zhDoneWhen: "下一次相似任务在动手前留下目标、改动边界和下一步检查。",
  }],
  ["controlled-execution", {
    capability: "a clean workspace can reach a safe first action",
    short: "clean-workspace startup path",
    whyItMatters: "If startup cannot be confirmed, users may need to rescue setup, permissions, or reset steps by hand.",
    doneWhen: "A clean workspace runs the intended setup or reset path and records the task-level result.",
    zhCapability: "干净工作区能走到安全的第一步",
    zhShort: "干净工作区启动路径",
    zhWhyItMatters: "无法确认启动路径时，用户可能仍要手动处理环境、权限或重置步骤。",
    zhDoneWhen: "下一次任务从干净工作区运行预期的设置或重置路径，并留下任务级结果。",
  }],
  ["change-validation", {
    capability: "changed work has relevant proof before review",
    short: "pre-review change proof",
    whyItMatters: "Reviewers cannot tell whether the change was checked, so defects and repeated validation work move later in the process.",
    doneWhen: "A changed task links its affected work to a relevant check and retains the result, including any repair and re-check.",
    zhCapability: "改动在评审前留下了相关验证证据",
    zhShort: "改动验证路径",
    zhWhyItMatters: "评审者无法判断改动是否经过相关检查，缺陷和重复验证就会被推迟到后面。",
    zhDoneWhen: "下一次有改动的任务把受影响内容关联到相关检查，并保留结果；失败时也保留修复和复查。",
  }],
  ["reliable-delivery", {
    capability: "risky changes have a clear acceptance and recovery path",
    short: "acceptance and recovery path",
    whyItMatters: "The team cannot tell whether a risky change is safe to accept or how to recover when a control stops it.",
    doneWhen: "A similar risky task leaves its decision, acceptance result, and usable recovery record together.",
    zhCapability: "高风险改动有清楚的验收和恢复路径",
    zhShort: "验收和恢复路径",
    zhWhyItMatters: "团队无法判断高风险改动能否安全验收，也不知道控制拦住它时该怎样恢复。",
    zhDoneWhen: "下一次相似的高风险任务同时留下决策、验收结果和可执行的恢复记录。",
  }],
  ["learning-capture", {
    capability: "recurring issues become discoverable, reusable, and maintainable",
    short: "reusable learning capture",
    whyItMatters: "Without a durable and discoverable owner, similar tasks repeat the same correction or rely on speculative automation.",
    doneWhen: "Reviewed evidence captures the recurring issue in a reusable owner and keeps later effect validation separate.",
    zhCapability: "反复出现的问题被沉淀为可查找、可复用、可维护的能力",
    zhShort: "可复用经验沉淀",
    zhWhyItMatters: "缺少持久且可发现的载体时，相似任务会重复同样的纠正，或过早依赖推测性自动化。",
    zhDoneWhen: "审查证据把反复问题沉淀到可复用载体，并单独保留后续效果验证。",
  }],
]);
const FALLBACK_READER_PROFILE = Object.freeze({
  capability: "the next comparable task has a reliable path",
  short: "reliable task path",
  whyItMatters: "Users need a clear and repeatable path instead of manual follow-up.",
  doneWhen: "A comparable task leaves the intended decision, result, and evidence together.",
  zhCapability: "下一次相似任务有可靠路径",
  zhShort: "可靠任务路径",
  zhWhyItMatters: "用户需要一条清楚、可重复的路径，而不是持续人工跟进。",
  zhDoneWhen: "下一次相似任务同时留下预期决策、结果和证据。",
});
const DELIVERY_LEVEL_RANK = new Map([
  ["self-reported-completion", 1],
  ["local-command-passed", 2],
  ["relevant-focused-checks-passed", 3],
  ["ci-accepted", 4],
  ["review-or-merge-accepted", 5],
  ["deployment-outcome-observed", 6],
  ["approval-decision-observed", 3],
  ["recovery-outcome-observed", 6],
]);
const OUTCOME_DELIVERY_RANK = DELIVERY_LEVEL_RANK.get("relevant-focused-checks-passed");
const RELIABLE_DELIVERY_OUTCOME_RANK = DELIVERY_LEVEL_RANK.get("ci-accepted");
const LEVEL_RANK = new Map(TASK_LOOP_EVIDENCE_LAYERS.map((layer, index) => [layer, index + 1]));
const SEVERITY_RANK = new Map([["High", 0], ["Medium", 1], ["Low", 2]]);
const RAW_FIELD_RE = /(?:^|_)(?:raw_?)?(?:prompt|command|content|transcript|user_?text|assistant_?text)$/i;
const SCORE_CONFIDENCE = new Set(["low", "medium", "high"]);
const SOFTWARE_FLUENCY_REVIEW_DIMENSION = new Map([
  ["context-map", "task-understanding"],
  ["environment-readiness", "controlled-execution"],
  ["fast-feedback", "change-validation"],
  ["quality-gates", "change-validation"],
  ["safe-change", "reliable-delivery"],
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rows(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

function softwareFluencyCapabilityFindings(capability) {
  return [
    ...rows(capability?.findings),
    ...(capability?.finding === undefined ? [] : [capability.finding]),
  ];
}

function softwareFluencyFindingErrors(finding, prefix) {
  const errors = [];
  if (!isObject(finding)) return [`${prefix} must be an object`];
  for (const field of ["id", "title", "reason", "expectedOutcome", "expectedArtifact", "kind", "severity"]) {
    if (typeof finding[field] !== "string" || finding[field].trim() === "") {
      errors.push(`${prefix}.${field} must be a non-empty string`);
    }
  }
  errors.push(...findingOutputContractErrors(finding, prefix));
  if (rows(finding.evidenceRefs).length === 0) {
    errors.push(`${prefix}.evidenceRefs must contain concrete repository evidence`);
  }
  return errors;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function readerText(locale, english, chinese) {
  return locale === "zh-CN" ? chinese : english;
}

function readerDescriptor(descriptor, locale) {
  return {
    ...descriptor,
    label: readerText(locale, descriptor.label, descriptor.zhLabel ?? descriptor.label),
    question: readerText(locale, descriptor.question, descriptor.zhQuestion ?? descriptor.question),
    subdimensions: descriptor.subdimensions.map((subdimension) => ({
      ...subdimension,
      label: readerText(locale, subdimension.label, subdimension.zhLabel ?? subdimension.label),
    })),
  };
}

function publicRef(value, fallback = {}) {
  if (typeof value === "string") return { kind: fallback.kind ?? "evidence", id: value };
  if (!isObject(value)) return { kind: fallback.kind ?? "evidence", id: String(fallback.id ?? "observed") };
  const reference = {};
  for (const key of ["kind", "id", "type", "line", "label", "adapter", "code", "status"]) {
    if (value[key] !== undefined && value[key] !== null && String(value[key]).trim() !== "") {
      reference[key] = value[key];
    }
  }
  return Object.keys(reference).length > 0 ? reference : { kind: fallback.kind ?? "evidence", id: String(fallback.id ?? "observed") };
}

function publicRefs(values, fallback = {}) {
  const seen = new Set();
  return rows(values).map((value) => publicRef(value, fallback)).filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hasRawField(value, location = "value") {
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

function staticDimension(source, id) {
  return source?.repositoryEvidence?.dimensions?.[id]
    ?? source?.repositoryEvidence?.taskLoop?.[id]
    ?? {};
}

function staticEvidence(source, id, layer) {
  const dimension = staticDimension(source, id);
  return publicRefs(dimension?.[layer] ?? [], { kind: "repository", id: `${id}:${layer}` });
}

function staticState(source, id) {
  const value = String(staticDimension(source, id)?.state ?? "").toLowerCase();
  if (value === "missing") return "Missing";
  if (value === "not-applicable" || value === "not applicable") return "Not applicable";
  return null;
}

function staticSubdimension(source, dimensionId, id) {
  return source?.repositoryEvidence?.subdimensions?.[id]
    ?? staticDimension(source, dimensionId)?.subdimensions?.[id]
    ?? {};
}

function staticSubdimensionEvidence(source, dimensionId, id, layer) {
  const subdimension = staticSubdimension(source, dimensionId, id);
  return publicRefs(subdimension?.[layer] ?? [], { kind: "repository", id: `${id}:${layer}` });
}

function staticSubdimensionState(source, dimensionId, id) {
  const value = String(staticSubdimension(source, dimensionId, id)?.state ?? "").toLowerCase();
  if (value === "missing") return "Missing";
  if (value === "not-applicable" || value === "not applicable") return "Not applicable";
  return null;
}

function signalMatches(signal, id) {
  return signal?.dimension === id || signal?.dimensionId === id || rows(signal?.dimensionRefs).includes(id);
}

function subdimensionMatches(signal, dimensionId, id) {
  return signalMatches(signal, dimensionId)
    && (signal?.subdimension === id || signal?.subdimensionId === id || rows(signal?.subdimensionRefs).includes(id));
}

function knownTaskEpisodeIds(source) {
  return new Set(rows(source?.taskEpisodes).map((episode) => episode?.id).filter(Boolean));
}

function linkedSessionSignal(signal, episodeIds) {
  const episodeRef = signal?.episodeRef ?? signal?.taskEpisodeRef;
  if (!episodeRef || !episodeIds.has(episodeRef)) return null;
  return { ...signal, episodeRef };
}

function episodeSignals(source, id) {
  const signals = [];
  const episodeIds = knownTaskEpisodeIds(source);
  for (const signal of rows(source?.sessionEvents?.dimensionSignals)) {
    const linked = linkedSessionSignal(signal, episodeIds);
    if (linked && signalMatches(linked, id)) signals.push(linked);
  }
  for (const episode of rows(source?.taskEpisodes)) {
    if (!episode?.id) continue;
    for (const signal of rows(episode?.dimensionSignals)) {
      if (signalMatches(signal, id)) {
        signals.push({ ...signal, episodeRef: episode.id, evidenceRefs: signal.evidenceRefs ?? episode.evidenceRefs });
      }
    }
    if (id === "task-understanding" && rows(episode?.taskUnderstanding).some((row) => row?.state === "Exercised")) {
      signals.push({
        episodeRef: episode.id,
        evidenceRefs: rows(episode.taskUnderstanding).flatMap((row) => rows(row?.evidenceRefs)),
      });
    }
    if (id === "controlled-execution" && episode?.executionBoundary) {
      signals.push({ episodeRef: episode.id, evidenceRefs: episode.executionBoundary?.evidenceRefs ?? episode.evidenceRefs });
    }
    if (id === "change-validation" && (episode?.closure?.status === "closed" || episode?.repair?.status === "repaired-and-passed")) {
      signals.push({ episodeRef: episode.id, evidenceRefs: episode.closure?.evidenceRefs ?? episode.repair?.evidenceRefs ?? episode.evidenceRefs });
    }
    if (id === "reliable-delivery") {
      const delivery = rows(source?.deliveryEvidence).filter((row) => row?.episodeRef === episode.id
        && ["acceptance", "approval", "release", "deployment", "recovery"].includes(row?.kind));
      if (delivery.length > 0) signals.push({ episodeRef: episode.id, evidenceRefs: delivery.flatMap((row) => rows(row?.evidenceRefs)) });
    }
  }
  return signals;
}

function subdimensionSignals(source, dimensionId, id) {
  const signals = episodeSignals(source, dimensionId).filter((signal) => subdimensionMatches(signal, dimensionId, id));
  for (const episode of rows(source?.taskEpisodes)) {
    if (!episode?.id) continue;
    const evidenceRefs = episode?.evidenceRefs;
    const reviewedTaskCheck = rows(episode?.taskUnderstanding).find((row) => row?.id === id && row?.state === "Exercised");
    if (reviewedTaskCheck) {
      signals.push({ episodeRef: episode.id, evidenceRefs: reviewedTaskCheck.evidenceRefs ?? evidenceRefs });
    }
    if (id === "supported-operation" && episode?.executionBoundary) {
      signals.push({ episodeRef: episode.id, evidenceRefs: episode.executionBoundary?.evidenceRefs ?? evidenceRefs });
    }
    if (id === "relevant-check" && episode?.closure?.status === "closed") {
      signals.push({ episodeRef: episode.id, evidenceRefs: episode.closure?.evidenceRefs ?? evidenceRefs });
    }
    if (id === "failure-repair" && episode?.repair?.status === "repaired-and-passed") {
      signals.push({ episodeRef: episode.id, evidenceRefs: episode.repair?.evidenceRefs ?? evidenceRefs });
    }
    if (id === "validate-again" && episode?.repair?.status === "repaired-and-passed") {
      signals.push({ episodeRef: episode.id, evidenceRefs: episode.repair?.evidenceRefs ?? evidenceRefs });
    }
  }
  if (id === "acceptance-evidence") {
    const episodeIds = knownTaskEpisodeIds(source);
    for (const row of rows(source?.deliveryEvidence)) {
      const compatibleKind = row?.kind === undefined || ["acceptance", "release", "deployment"].includes(row.kind);
      if (episodeIds.has(row?.episodeRef) && compatibleKind
        && (DELIVERY_LEVEL_RANK.get(row?.level) ?? 0) >= RELIABLE_DELIVERY_OUTCOME_RANK) {
        signals.push({ episodeRef: row.episodeRef, evidenceRefs: row.evidenceRefs });
      }
    }
  }
  if (id === "high-risk-approval" || id === "rollback-recovery") {
    const expectedKind = id === "high-risk-approval" ? "approval" : "recovery";
    const episodeIds = knownTaskEpisodeIds(source);
    for (const row of rows(source?.deliveryEvidence)) {
      if (episodeIds.has(row?.episodeRef) && row?.kind === expectedKind) {
        signals.push({ episodeRef: row.episodeRef, evidenceRefs: row.evidenceRefs });
      }
    }
  }
  return signals;
}

function signalRefs(signals) {
  return publicRefs(signals.flatMap((signal) => [
    ...(rows(signal?.evidenceRefs)),
    signal?.evidenceRef,
    signal?.episodeRef ? { kind: "task-episode", id: signal.episodeRef } : null,
  ]), { kind: "task-episode", id: "observed" });
}

function linkedDelivery(source, id, signals) {
  const episodeRefs = new Set(signals.map((signal) => signal?.episodeRef).filter(Boolean));
  return rows(source?.deliveryEvidence).filter((row) => {
    if (!episodeRefs.has(row?.episodeRef)) return false;
    if (row?.dimension === id || row?.dimensionId === id || rows(row?.dimensionRefs).includes(id)) return true;
    if (id === "change-validation") return true;
    if (id === "reliable-delivery") return true;
    return false;
  });
}

function deliveryRefs(delivery) {
  return publicRefs(delivery.flatMap((row) => [
    ...(rows(row?.evidenceRefs)),
    { kind: "delivery", id: row?.id ?? "observed", status: row?.status ?? "observed" },
  ]), { kind: "delivery", id: "observed" });
}

function highestDeliveryRank(delivery) {
  return delivery.reduce((highest, row) => Math.max(highest, DELIVERY_LEVEL_RANK.get(row?.level) ?? 0), 0);
}

function bridgeState({ staticRefs, wiredRefs, signals, delivery, staticStatus, id }) {
  if (staticStatus === "Missing") return { level: null, state: "missing" };
  if (staticStatus === "Not applicable") return { level: null, state: "not-applicable" };
  const hasStatic = staticRefs.length > 0;
  const hasWired = wiredRefs.length > 0;
  const hasEpisodes = signals.length > 0;
  const deliveryRank = highestDeliveryRank(delivery);
  const outcomeRank = id === "reliable-delivery" ? RELIABLE_DELIVERY_OUTCOME_RANK : OUTCOME_DELIVERY_RANK;

  if (hasEpisodes && deliveryRank >= outcomeRank) return { level: "Outcome-supported", state: "outcome-supported" };
  if (hasEpisodes) return { level: "Exercised", state: "exercised" };
  if (hasWired) return { level: "Wired", state: "wired-unobserved" };
  if (hasStatic) return { level: "Present", state: "static-only" };
  return { level: null, state: "unobserved" };
}

function dimensionSummary(dimension, locale = "en") {
  if (dimension.level === "Outcome-supported") {
    if (dimension.id === "reliable-delivery") {
      return readerText(locale,
        `${dimension.label}: users can rely on this part of the task loop; a real task and accepted delivery or reviewed recovery support it.`,
        `${dimension.label}：用户可以依赖这一环；真实任务和已接受的交付或经审阅的恢复结果支持它。`);
    }
    if (dimension.id === "change-validation") {
      return readerText(locale,
        `${dimension.label}: users can rely on this part of the task loop; a real task and a relevant checked result support it.`,
        `${dimension.label}：用户可以依赖这一环；真实任务和相关检查结果支持它。`);
    }
    return readerText(locale,
      `${dimension.label}: users can rely on this part of the task loop; a real task and a linked result support it.`,
      `${dimension.label}：用户可以依赖这一环；真实任务和已关联结果支持它。`);
  }
  if (dimension.level === "Exercised") {
    return dimension.id === "reliable-delivery"
      ? readerText(locale,
        `${dimension.label}: the path worked in a real task, but users cannot yet rely on accepted delivery or reviewed recovery.`,
        `${dimension.label}：路径在真实任务中用过，但还不能依赖已接受的交付或经审阅的恢复。`)
      : readerText(locale,
        `${dimension.label}: the path worked in a real task, but the result appropriate to this question is not linked yet.`,
        `${dimension.label}：路径在真实任务中用过，但还没有关联与该问题相符的结果。`);
  }
  if (dimension.level === "Wired") {
    return readerText(locale,
      `${dimension.label}: the project provides a connected route. This sample has not yet verified its use in a real task.`,
      `${dimension.label}：项目已经提供并接通这条路径；当前任务样本还没有验证它的实际使用。`);
  }
  if (dimension.level === "Present") {
    return readerText(locale,
      `${dimension.label}: the project provides a relevant mechanism. It still needs to be connected to the intended lifecycle.`,
      `${dimension.label}：项目已经提供相关机制；下一步是把它接入目标生命周期。`);
  }
  if (dimension.state === "Missing") return readerText(locale,
    `${dimension.label}: users do not yet have the scoped mechanism needed for this part of the task loop.`,
    `${dimension.label}：当前范围还没有这一环需要的机制。`);
  if (dimension.state === "Not applicable") return readerText(locale,
    `${dimension.label} is not applicable to the scoped task episodes.`,
    `${dimension.label}：不适用于当前任务范围。`);
  return readerText(locale,
    `${dimension.label}: this report cannot yet show what users can rely on in the current boundary.`,
    `${dimension.label}：当前证据边界还不能说明用户可依赖什么。`);
}

function dimensionBlocker(dimension, locale = "en") {
  if (dimension.state === "Missing") return readerText(locale, "Inspected engineering mechanism is absent.", "已检查的工程机制缺失。");
  if (dimension.state === "Not applicable") return readerText(locale, "No scoped task requires this mechanism.", "当前范围没有任务需要此机制。");
  if (dimension.level === "Outcome-supported") return readerText(locale, "No blocker observed in the supplied evidence boundary.", "在已提供的证据边界内没有观察到阻碍。");
  if (dimension.level === "Exercised") {
    return dimension.id === "reliable-delivery"
      ? readerText(locale, "Accepted delivery or reviewed recovery evidence is not yet linked.", "还没有关联已接受的交付或经审阅的恢复证据。")
      : readerText(locale, "A result appropriate to this question is not yet linked.", "还没有关联与该问题相符的结果。")
  }
  if (dimension.level === "Wired") return readerText(locale, "Configured route has no linked runtime episode evidence.", "已配置路径没有关联的运行时任务证据。");
  if (dimension.level === "Present") return readerText(locale, "Mechanism has not been shown wired into the intended lifecycle.", "机制尚未证明接入目标生命周期。");
  return readerText(locale, "Evidence boundary does not support a static or task-level claim.", "证据边界不足以支持静态或任务级判断。");
}

function evidenceIds(row) {
  return new Set([
    ...rows(row?.evidenceBridge?.staticEvidence),
    ...rows(row?.evidenceBridge?.episodeEvidence),
    ...rows(row?.evidenceBridge?.deliveryEvidence),
    ...rows(row?.subdimensions).flatMap((subdimension) => [
      ...rows(subdimension?.evidenceBridge?.staticEvidence),
      ...rows(subdimension?.evidenceBridge?.episodeEvidence),
      ...rows(subdimension?.evidenceBridge?.deliveryEvidence),
    ]),
  ].map((ref) => ref?.id).filter(Boolean));
}

function evidenceLabel(row, id) {
  const refs = [
    ...rows(row?.evidenceBridge?.staticEvidence),
    ...rows(row?.subdimensions).flatMap((subdimension) => rows(subdimension?.evidenceBridge?.staticEvidence)),
  ];
  return String(refs.find((ref) => ref?.id === id)?.label ?? "").trim();
}

function projectSpecificSummary(row, locale) {
  if (row?.id === "learning-capture") return row.summary;
  const ids = evidenceIds(row);
  if (locale === "zh-CN") {
    if (row.id === "task-understanding" && ids.has("agent-guidance")) {
      return `${row.label}：仓库提供 Agent 指引和分范围任务路线；当前样本未确认真实任务是否始终按这些路线开始。`;
    }
    if (row.id === "goal-understanding") return `${row.label}：仓库写明了任务入口，但项目规则里的关键事实仍需保持一致。`;
    if (row.id === "relevant-context") return `${row.label}：仓库提供 Agent 指引和分目录上下文；当前样本未确认实际使用。`;
    if (row.id === "scope-boundary") return `${row.label}：任务路线已写入项目文档；当前样本未确认任务开始时是否真的说明边界和下一步检查。`;
    if (row.id === "controlled-execution" && ids.has("runnable-work-surface")) {
      const boundary = ids.has("instruction-stop-boundary") ? "，并写明停止或人工确认边界" : "";
      const surface = evidenceLabel(row, "runnable-work-surface") || "统一项目工作入口";
      return `${row.label}：仓库提供 ${surface}${boundary}。`;
    }
    if (row.id === "instruction-led-start") return `${row.label}：仓库有工作区清单和锁文件；当前样本未确认从干净环境启动的结果。`;
    if (row.id === "supported-operation") return `${row.label}：仓库提供 ${evidenceLabel(row, "runnable-work-surface") || "统一项目工作入口"}。`;
    if (row.id === "permission-boundary") return ids.has("instruction-stop-boundary")
      ? `${row.label}：项目规则写明了停止或人工确认条件。`
      : row.summary;
    if (row.id === "change-validation" && ids.has("test-surface")) return `${row.label}：仓库有测试入口；当前样本没有可确认的改动后验证记录。`;
    if (row.id === "relevant-check") return `${row.label}：仓库有测试入口；需要让具体改动对应到具体检查。`;
    if (row.id === "failure-repair") return `${row.label}：仓库有测试入口；当前样本未确认是否借助可定位、可关联的诊断证据找到原因并完成修复。`;
    if (row.id === "validate-again") return `${row.label}：当前材料还不能确认修复后是否在最终状态重新运行同范围检查。`;
    if (row.id === "reliable-delivery" && ids.has("pre-acceptance-ci")) return `${row.label}：仓库有 CI 验收门禁和恢复路径；当前样本未确认真实任务的验收或回滚结果。`;
    if (row.id === "high-risk-approval") return `${row.label}：当前材料还不能确认 Agent Hook 是否会在关键节点阻止或请求确认。`;
    if (row.id === "acceptance-evidence") return `${row.label}：仓库有 CI 验收门禁；当前样本未确认任务结果是否进入这条门禁。`;
    if (row.id === "rollback-recovery") return `${row.label}：仓库存在恢复路径线索；还需确认它是否绑定本次影响、具备恢复后验证，并有安全演练或实际结果。`;
    if (row.id === "lifecycle-repeat-detection") return `${row.label}：需要有界任务窗口区分当前能力缺口、重复或熵驱动机会，以及明确的无候选结果。`;
    if (row.id === "loop-engineering") return `${row.label}：只有有证据支持的重复机会才能进入最小持久 owner 和可验证运行契约。`;
    if (row.id === "later-validation") return `${row.label}：需要可比的后续结果，或按周期执行并对照权威事实的维护检查；仅凭文档年龄不能判断过期。`;
  } else {
    if (row.id === "task-understanding" && ids.has("agent-guidance")) return `${row.label}: the repository provides agent guidance and scoped task routes; the sample does not confirm consistent use in real tasks.`;
    if (row.id === "goal-understanding") return `${row.label}: task entry points exist, but key facts must stay consistent across project guidance.`;
    if (row.id === "relevant-context") return `${row.label}: scoped agent guidance exists; the sample does not confirm its use.`;
    if (row.id === "scope-boundary") return `${row.label}: project routes are documented; the sample does not confirm that tasks state the boundary and next check.`;
    if (row.id === "controlled-execution" && ids.has("runnable-work-surface")) return `${row.label}: the repository provides ${evidenceLabel(row, "runnable-work-surface") || "a shared project work surface"}${ids.has("instruction-stop-boundary") ? " and a written stop boundary" : ""}.`;
    if (row.id === "instruction-led-start") return `${row.label}: workspace manifests and lockfiles exist; the sample does not confirm a clean-start result.`;
    if (row.id === "supported-operation") return `${row.label}: the repository provides ${evidenceLabel(row, "runnable-work-surface") || "a shared project work surface"}.`;
    if (row.id === "permission-boundary" && ids.has("instruction-stop-boundary")) return `${row.label}: project guidance defines a stop or human-confirmation boundary.`;
    if (row.id === "change-validation" && ids.has("test-surface")) return `${row.label}: test entry points exist; the sample has no confirmed post-edit validation record.`;
    if (row.id === "relevant-check") return `${row.label}: test entry points exist; each change still needs a matching focused check.`;
    if (row.id === "failure-repair") return `${row.label}: test entry points exist; the sample does not confirm a cause located through attributable diagnostics and a bounded repair.`;
    if (row.id === "validate-again") return `${row.label}: the current material does not confirm a same-scope check on the repaired final state.`;
    if (row.id === "reliable-delivery" && ids.has("pre-acceptance-ci")) return `${row.label}: CI acceptance gates and recovery paths exist; the sample does not confirm a real acceptance or rollback result.`;
    if (row.id === "high-risk-approval") return `${row.label}: the current material does not confirm an Agent Hook blocking or asking at a key decision point.`;
    if (row.id === "acceptance-evidence") return `${row.label}: CI acceptance gates exist; the sample does not confirm a task result entering them.`;
    if (row.id === "rollback-recovery") return `${row.label}: recovery-path leads exist; the review must bind one to the actual effect, postcondition, and a safe rehearsal or retained result.`;
    if (row.id === "lifecycle-repeat-detection") return `${row.label}: a bounded task window must distinguish a current capability gap, a repeated or entropy-backed opportunity, and an explicit no-candidate result.`;
    if (row.id === "loop-engineering") return `${row.label}: only an evidence-supported repeated opportunity can reach the smallest durable owner and verifiable operating contract.`;
    if (row.id === "later-validation") return `${row.label}: use either a comparable later outcome or an executed maintenance inspection against canonical truth; file age alone cannot prove drift.`;
  }
  return row.summary;
}

function refreshReaderSummaries(dimensions, source, locale) {
  const reviewedSummaries = new Map(rows(scoreReviewDecision(source)?.dimensions)
    .map((row) => [row?.id, String(row?.readerSummary ?? "").trim()]));
  for (const dimension of dimensions) {
    dimension.summary = reviewedSummaries.get(dimension.id) || projectSpecificSummary(dimension, locale);
    for (const subdimension of dimension.subdimensions) {
      subdimension.summary = projectSpecificSummary(subdimension, locale)
        .replace(new RegExp(`^${subdimension.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[:：]\\s*`, "u"), "");
    }
  }
}

function refreshGeneratedReaderSummaries(dimensions, locale) {
  for (const dimension of dimensions) {
    const labelPattern = new RegExp(`^${dimension.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[:：]\\s*`, "u");
    dimension.summary = projectSpecificSummary(dimension, locale)
      .replace(labelPattern, "")
      .replace(/[。！？.!?]+(?=\s|$)/gu, ";")
      .replace(/;+$/u, "");
  }
}

function projectDimension(source, descriptor) {
  const { id, label } = descriptor;
  const locale = readerLocale(source);
  const present = staticEvidence(source, id, "present");
  const wired = staticEvidence(source, id, "wired");
  const signals = episodeSignals(source, id);
  const delivery = linkedDelivery(source, id, signals);
  const claim = bridgeState({
    staticRefs: present,
    wiredRefs: wired,
    signals,
    delivery,
    staticStatus: staticState(source, id),
    id,
  });
  const dimension = {
    id,
    label,
    level: claim.level,
    state: claim.level ? claim.level : claim.state === "not-applicable" ? "Not applicable" : claim.state === "missing" ? "Missing" : "Unobserved",
    summary: "",
    findingRefs: [],
    subdimensions: [],
    evidenceBridge: {
      staticEvidence: unique([...present, ...wired].map(JSON.stringify)).map(JSON.parse),
      episodeEvidence: signalRefs(signals),
      deliveryEvidence: deliveryRefs(delivery),
      state: claim.state,
    },
    blocker: "",
  };
  dimension.summary = dimensionSummary(dimension, locale);
  dimension.blocker = dimensionBlocker(dimension, locale);
  return dimension;
}

function projectSubdimension(source, dimension, descriptor) {
  const locale = readerLocale(source);
  const present = staticSubdimensionEvidence(source, dimension.id, descriptor.id, "present");
  const wired = staticSubdimensionEvidence(source, dimension.id, descriptor.id, "wired");
  const signals = subdimensionSignals(source, dimension.id, descriptor.id);
  const delivery = linkedDelivery(source, dimension.id, signals);
  const claim = bridgeState({
    staticRefs: present,
    wiredRefs: wired,
    signals,
    delivery,
    staticStatus: staticSubdimensionState(source, dimension.id, descriptor.id),
    id: dimension.id,
  });
  const subdimension = {
    id: descriptor.id,
    label: descriptor.label,
    level: claim.level,
    state: claim.level ? claim.level : claim.state === "not-applicable" ? "Not applicable" : claim.state === "missing" ? "Missing" : "Unobserved",
    summary: "",
    findingRefs: [],
    evidenceBridge: {
      staticEvidence: unique([...present, ...wired].map(JSON.stringify)).map(JSON.parse),
      episodeEvidence: signalRefs(signals),
      deliveryEvidence: deliveryRefs(delivery),
      state: claim.state,
    },
    blocker: "",
  };

  subdimension.summary = dimensionSummary({ ...subdimension, id: dimension.id }, locale);
  subdimension.blocker = dimensionBlocker({ ...subdimension, id: dimension.id }, locale);
  return subdimension;
}

function severityFor(dimension) {
  if (dimension.state === "Missing") return "High";
  if (dimension.id === "reliable-delivery" && dimension.level !== "Outcome-supported") return "High";
  if (dimension.id === "change-validation" && dimension.level === null) return "High";
  if (dimension.level === "Present" || dimension.level === null) return "Medium";
  return "Low";
}

function outcomeProfile(dimension, locale = "en") {
  const profile = OUTCOME_PROFILE_BY_ID.get(dimension?.id) ?? FALLBACK_OUTCOME_PROFILE;
  if (locale !== "zh-CN") return profile;
  return {
    ...profile,
    title: profile.zhTitle,
    reason: profile.zhReason,
    move: profile.zhMove,
    expectedUnlock: profile.zhExpectedUnlock,
  };
}

function defaultMove(dimension, locale) {
  return outcomeProfile(dimension, locale).move;
}

function expectedUnlock(dimension, locale) {
  return outcomeProfile(dimension, locale).expectedUnlock;
}

function projectMove(dimension, locale) {
  const ids = evidenceIds(dimension);
  if (locale === "zh-CN") {
    if (dimension?.id === "task-understanding" && ids.has("agent-guidance")) return "用一个真实任务确认 Agent 指引能把人带到正确目录，并在动手前说清下一步检查。";
    if (dimension?.id === "controlled-execution" && ids.has("runnable-work-surface")) return "从干净工作区运行一次项目工作入口，记录缺失的依赖、权限或恢复步骤。";
    if (dimension?.id === "change-validation" && ids.has("test-surface")) return "选一个真实改动，确认它对应的检查命令，并保留检查结果。";
    if (dimension?.id === "reliable-delivery" && ids.has("pre-acceptance-ci")) return "用一个低风险改动确认 CI 验收和恢复路径，并把结果关联回任务。";
  } else {
    if (dimension?.id === "task-understanding" && ids.has("agent-guidance")) return "Use one real task to confirm the agent guidance reaches the right directory and names the next check before work starts.";
    if (dimension?.id === "controlled-execution" && ids.has("runnable-work-surface")) return "Run the project work entry point from a clean workspace and record any missing dependency, permission, or recovery step.";
    if (dimension?.id === "change-validation" && ids.has("test-surface")) return "Use one real change to confirm its matching check command and retain the result.";
    if (dimension?.id === "reliable-delivery" && ids.has("pre-acceptance-ci")) return "Use one low-risk change to confirm the CI acceptance and recovery path, then link the result back to the task.";
  }
  return defaultMove(dimension, locale);
}

function projectUnlock(dimension, locale) {
  const ids = evidenceIds(dimension);
  if (locale === "zh-CN") {
    if (dimension?.id === "task-understanding" && ids.has("agent-guidance")) return "新人能从一致的项目入口开始任务，减少走错目录和返工。";
    if (dimension?.id === "controlled-execution" && ids.has("runnable-work-surface")) return "新人能从干净工作区走到第一条可运行命令，并知道卡住时怎么办。";
    if (dimension?.id === "change-validation" && ids.has("test-surface")) return "新人能知道改动完成后真正需要运行哪些检查。";
    if (dimension?.id === "reliable-delivery" && ids.has("pre-acceptance-ci")) return "新人能知道改动何时可验收，以及被拦截时如何恢复。";
  } else {
    if (dimension?.id === "task-understanding" && ids.has("agent-guidance")) return "Newcomers start from one consistent project route with less wrong-scope rework.";
    if (dimension?.id === "controlled-execution" && ids.has("runnable-work-surface")) return "Newcomers can reach the first runnable command from a clean workspace and know what to do when blocked.";
    if (dimension?.id === "change-validation" && ids.has("test-surface")) return "Newcomers know which checks actually complete a change.";
    if (dimension?.id === "reliable-delivery" && ids.has("pre-acceptance-ci")) return "Newcomers know when a change is accepted and how to recover when it is blocked.";
  }
  return expectedUnlock(dimension, locale);
}

function readerProfile(dimension, locale) {
  const profile = READER_PROFILE_BY_ID.get(dimension?.id) ?? FALLBACK_READER_PROFILE;
  if (locale !== "zh-CN") return profile;
  return {
    capability: profile.zhCapability,
    short: profile.zhShort,
    whyItMatters: profile.zhWhyItMatters,
    doneWhen: profile.zhDoneWhen,
  };
}

function readerCopy(dimension, locale) {
  const profile = readerProfile(dimension, locale);
  const nextMove = defaultMove(dimension, locale);
  if (locale === "zh-CN") {
    if (dimension.state === "Missing") {
      return {
        title: `已检查的范围缺少${profile.short}`,
        whatWeSaw: `我们检查了当前项目范围，没有找到支持“${profile.capability}”所需的机制。`,
        whyItMatters: profile.whyItMatters,
        nextMove,
        doneWhen: profile.doneWhen,
        uiSummary: `当前范围缺少${profile.short}；下一步：${nextMove}`,
      };
    }
    if (dimension.level === "Exercised") {
      return {
        title: `真实任务用过${profile.short}，但还没有关联结果证明它可靠`,
        whatWeSaw: `抽样任务显示这个路径被使用过，但没有关联与“${profile.capability}”相符的结果。`,
        whyItMatters: profile.whyItMatters,
        nextMove,
        doneWhen: profile.doneWhen,
        uiSummary: `真实任务用过${profile.short}，但结果还没有关联；下一步：${nextMove}`,
      };
    }
    if (dimension.level === "Present" || dimension.level === "Wired") {
      return {
        title: `已找到${profile.short}，但还没有真实任务证明它可用`,
        whatWeSaw: `已检查的项目中存在相关机制或配置路径，但抽样任务没有把它关联到真实任务结果。`,
        whyItMatters: profile.whyItMatters,
        nextMove,
        doneWhen: profile.doneWhen,
        uiSummary: `项目已有${profile.short}，但样本还没有证明真实任务会用到它；下一步：${nextMove}`,
      };
    }
    return {
      title: `还不能确认${profile.capability}`,
      whatWeSaw: `在当前抽样会话中，没有找到能把“${profile.capability}”关联到任务级结果的记录。`,
      whyItMatters: profile.whyItMatters,
      nextMove,
      doneWhen: profile.doneWhen,
      uiSummary: `当前样本还不能确认${profile.capability}；下一步：${nextMove}`,
    };
  }
  if (dimension.state === "Missing") {
    return {
      title: `The inspected project scope is missing a ${profile.short}`,
      whatWeSaw: `We inspected the selected project scope and did not find the mechanism needed so that ${profile.capability}.`,
      whyItMatters: profile.whyItMatters,
      nextMove,
      doneWhen: profile.doneWhen,
      uiSummary: `The project is missing a ${profile.short}. Next: ${nextMove}`,
    };
  }
  if (dimension.level === "Exercised") {
    return {
      title: `A task used the ${profile.short}, but no supporting result is linked yet`,
      whatWeSaw: `The selected task evidence shows this path was used, but no result is linked to show that ${profile.capability}.`,
      whyItMatters: profile.whyItMatters,
      nextMove,
      doneWhen: profile.doneWhen,
      uiSummary: `A task used the ${profile.short}, but no supporting result is linked. Next: ${nextMove}`,
    };
  }
  if (dimension.level === "Present" || dimension.level === "Wired") {
    return {
      title: `The ${profile.short} exists, but a real task has not confirmed it`,
      whatWeSaw: "The inspected project contains a related mechanism or configured route, but the selected task evidence does not link it to a real task result.",
      whyItMatters: profile.whyItMatters,
      nextMove,
      doneWhen: profile.doneWhen,
      uiSummary: `The project has a ${profile.short}, but the sample has not confirmed it in a real task. Next: ${nextMove}`,
    };
  }
  return {
    title: `We could not confirm that ${profile.capability}`,
    whatWeSaw: `In the selected sessions, we found no task-level record linking evidence that ${profile.capability}.`,
    whyItMatters: profile.whyItMatters,
    nextMove,
    doneWhen: profile.doneWhen,
    uiSummary: `The current sample cannot yet confirm that ${profile.capability}. Next: ${nextMove}`,
  };
}

function fallbackUiSummary(reader, locale) {
  return locale === "zh-CN"
    ? `${reader.whatWeSaw} 下一步：${reader.nextMove}`
    : `${reader.whatWeSaw} Next: ${reader.nextMove}`;
}

function readerCopyFrom(value, fallback, locale) {
  const { title: _title, ...readerFallback } = fallback;
  if (!isObject(value)) return readerFallback;
  const copy = {};
  for (const field of ["whatWeSaw", "whyItMatters", "nextMove", "doneWhen"]) {
    copy[field] = typeof value[field] === "string" && value[field].trim() ? value[field].trim() : readerFallback[field];
  }
  copy.uiSummary = typeof value.uiSummary === "string" && value.uiSummary.trim()
    ? value.uiSummary.trim()
    : fallbackUiSummary(copy, locale);
  return copy;
}

function normalizedPracticeInventoryRows(source) {
  return rows(source?.repositoryEvidence?.aiAgentPractice?.coverageRows)
    .filter((row) => isObject(row) && AI_AGENT_PRACTICE_SURFACE_SET.has(String(row.surface ?? "")))
    .map((row) => {
      const safePaths = Array.isArray(row.paths)
        ? [...new Set(
          row.paths
            .map((item) => String(item ?? "").trim())
            .filter((item) => safePracticePathForSurface(row.surface, item)),
        )].slice(0, 12)
        : [];
      return {
        surface: String(row.surface),
        ...(Array.isArray(row.scopes)
          ? { scopes: [...new Set(row.scopes.map((item) => String(item ?? "").trim()).filter((item) => AI_AGENT_PRACTICE_SCOPE_SET.has(item)))] }
          : {}),
        ...(Number.isInteger(Number(row.count)) && Number(row.count) >= 0 ? { count: Number(row.count) } : {}),
        ...(safePaths.length > 0 ? { paths: safePaths } : {}),
      };
    });
}

function normalizedInspectedPracticeSurfaces(source) {
  return [...new Set(rows(source?.repositoryEvidence?.aiAgentPractice?.inspectedSurfaces)
    .map((surface) => String(surface ?? "").trim())
    .filter((surface) => AI_AGENT_PRACTICE_SURFACE_SET.has(surface)))];
}

function aiAgentPracticeSummary(source, dimensions) {
  const inventoryRows = normalizedPracticeInventoryRows(source);
  const inventoryBySurface = new Map(inventoryRows.map((row) => [row.surface, row]));
  const coverageRows = [];
  for (const dimension of dimensions) {
    const practice = PRACTICE_SURFACE_BY_DIMENSION_ID.get(dimension.id);
    if (!practice) continue;
    const inventory = inventoryBySurface.get(practice.surface);
    coverageRows.push({
      surface: practice.surface,
      ...(inventory?.scopes?.length > 0 ? { scopes: inventory.scopes } : {}),
      count: inventory?.count ?? 0,
      ...(inventory?.paths?.length > 0 ? { paths: inventory.paths } : {}),
    });
  }
  for (const inventory of inventoryRows) {
    if (coverageRows.some((row) => row.surface === inventory.surface)) continue;
    coverageRows.push({
      surface: inventory.surface,
      ...(inventory.scopes?.length > 0 ? { scopes: inventory.scopes } : {}),
      ...(inventory.count !== undefined ? { count: inventory.count } : {}),
      ...(inventory.paths?.length > 0 ? { paths: inventory.paths } : {}),
    });
  }
  return {
    inspectedSurfaces: normalizedInspectedPracticeSurfaces(source),
    coverageRows,
  };
}

function findingKind(dimension) {
  if (dimension.state === "Missing") return "missing-mechanism";
  if (dimension.level === "Exercised") return "outcome-gap";
  return "evidence-gap";
}

function expectedArtifact(value) {
  const explicit = typeof value === "string" ? value.trim() : "";
  return explicit || null;
}

function artifactReaderLabel(value, locale) {
  if (locale !== "zh-CN") return value;
  return {
    Code: "代码",
    Document: "文档",
    Rule: "项目规则",
    Memory: "受治理的 Memory",
    Skill: "可复用 Skill",
    Hook: "自动守卫 Hook",
    Gate: "强制 Gate",
    Script: "脚本",
    Test: "测试",
    Eval: "评测",
    Workflow: "工作流",
    Agent: "专用 Agent",
    Command: "命令",
    Config: "配置",
    MCP: "MCP 工具连接",
  }[value] ?? value;
}

function findingMove(finding, locale) {
  const artifact = artifactReaderLabel(expectedArtifact(finding?.expectedArtifact), locale);
  const title = String(finding?.title ?? "").trim();
  return readerText(
    locale,
    `Create or update the ${artifact} that resolves “${title}”.`,
    `围绕“${title}”创建或更新${artifact}。`,
  );
}

function findingExpectedOutput(finding) {
  if (Array.isArray(finding?.expectedOutput)) {
    const explicit = finding.expectedOutput
      .filter((item) => typeof item === "string" && item.trim())
      .map((item) => item.trim());
    if (explicit.length > 0) return explicit;
  }
  return [];
}

function outcomeReason(dimension, locale) {
  const reader = readerCopy(dimension, locale);
  return `${reader.whatWeSaw} ${reader.whyItMatters}`;
}

function repeatImprovementHandoff(source, dimension, locale) {
  if (dimension?.id !== "learning-capture") return "";
  const learning = learningCapture(source);
  const interventions = rows(learning.interventions);
  if (interventions.length === 0) return "";

  if (learning.state === "regressing") {
    return locale === "zh-CN"
      ? `\n\n## 先止损，再复查\n\n这项改进在可比窗口中变差了。先按已声明的停止或回退条件处理；在人工复核前，不要新建 Skill，也不要安排自动复查。`
      : `\n\n## Stop before repeating\n\nThis improvement regressed in a comparable window. Apply its declared stop or revert condition first; do not create a Skill or schedule another automatic follow-up before human review.`;
  }

  const hasSkillOwner = interventions.some((entry) => entry?.asset?.type === "skill");
  if (locale === "zh-CN") {
    return `\n\n## 让这次改进可以复用\n\n这是一条已经记录到的重复摩擦，不要只留下一次性建议。先检查已有的内置或已配置 Skill；${hasSkillOwner
      ? "如果没有覆盖这个稳定、可验证的工作流，请调用 /create-skill 为重复摩擦创建最小 Skill：写清触发条件、需要的上下文、输出、验证方式和一个失败边界；不要创建泛化的大而全 Skill。"
      : "当前选定的持久承载方式不是 Skill；先按已声明的最小承载方式实施，不要为了自动化而新建无关 Skill。"}\n\n如果当前 Quest 支持 /schedule，请调用 /schedule 每周执行一次 /better-harness 复查这个改进；使用已声明的验证方式，指标连续两次没有改善或触发停止/回退条件时停止。`;
  }
  return `\n\n## Make the improvement reusable\n\nThis is recorded repeated friction, not a one-off suggestion. Check existing built-in and configured Skills first; ${hasSkillOwner
    ? "if none covers this stable, verifiable workflow, call /create-skill to create the smallest Skill for this repeated friction: include its trigger, required context, output, validation, and one failure boundary. Do not create a broad catch-all Skill."
    : "the selected durable owner is not a Skill, so implement that smallest owner rather than creating an unrelated Skill."}\n\nWhen /schedule is available in this Quest, call /schedule to run a weekly /better-harness follow-up for this improvement; use the declared validation method, and stop when the metric is unchanged for two runs or the stop/revert condition fires.`;
}

const AGGREGATE_FRICTION_RE = /(?:failed-event|失败事件|friction signal|摩擦信号)/iu;
const PRIVATE_USAGE_SUMMARY_RE = /(?:~[\\/]|\/(?:Users|home|var|private|tmp)\/|[A-Za-z]:\\(?:Users\\)?|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|\b(?:sk|ghp|github_pat|xox[abprs])[-_][A-Za-z0-9_-]{8,}\b)/iu;

function findingEvidenceLines(finding, locale) {
  const refs = [
    ...rows(finding?.evidenceBridge?.episodeEvidence),
    ...rows(finding?.evidenceBridge?.staticEvidence),
    ...rows(finding?.evidenceBridge?.deliveryEvidence),
  ].slice(0, 4);
  if (refs.length === 0) {
    return locale === "zh-CN"
      ? `- 核对这个发现的已审查原因是否仍准确：${finding.reason}`
      : `- Confirm that the reviewed reason for this finding is still accurate: ${finding.reason}`;
  }
  return refs.map((ref) => {
    const kind = String(ref?.kind ?? "evidence").replace(/\s+/gu, " ").trim().slice(0, 48);
    const label = String(ref?.label ?? "").replace(/\s+/gu, " ").trim().slice(0, 100);
    const type = String(ref?.type ?? "").replace(/\s+/gu, " ").trim().slice(0, 48);
    const line = Number.isInteger(Number(ref?.line)) ? Number(ref.line) : null;
    const location = [
      kind,
      label ? `“${label}”` : "",
      type,
      line !== null ? `${locale === "zh-CN" ? "第" : "line "}${line}${locale === "zh-CN" ? " 行" : ""}` : "",
    ].filter(Boolean).join(", ");
    return locale === "zh-CN"
      ? `- 核对 ${location} 是否支持“${finding.title}”。`
      : `- Confirm that ${location} supports “${finding.title}”.`;
  }).join("\n");
}

function firstAiFixStep(finding, locale) {
  const text = `${finding?.title ?? ""} ${finding?.reason ?? ""}`;
  if (finding?.id === "session-post-edit-validation-gap") {
    return locale === "zh-CN"
      ? "逐条核对上面与改动相关的任务片段，列出改动对象、之后实际运行的检查以及缺失的最小相关检查；证据没有定位到改动对象时先补采样，不要先改 Hook、Skill 或 Memory。"
      : "Review the edited task episodes described above and list the changed target, the check that actually ran afterward, and the smallest relevant missing check. If the evidence does not identify the changed target, refresh the bounded sample before changing a Hook, Skill, or Memory.";
  }
  if (AGGREGATE_FRICTION_RE.test(text)) {
    return locale === "zh-CN"
      ? "逐条打开最多 4 个失败样本，记录失败工具或命令、错误表现、是否恢复以及候选根因；先完成归因，再决定是修代码、环境还是工作流。"
      : "Open up to four failure samples and record the failed tool or command, symptom, recovery state, and candidate cause. Classify the cause before choosing a code, environment, or workflow repair.";
  }
  return locale === "zh-CN"
    ? "先核对上面的证据，并点名受影响的文件或机制以及缺失的预期行为；证据无法定位二者时，返回诊断结果并停止修改。"
    : "Review the evidence above first and name the affected file or mechanism plus the missing expected behavior. If the evidence identifies neither, return a diagnostic result and stop before editing.";
}

function aiFixPrompt(source, finding, dimension, locale, reader = null) {
  const repeatHandoff = repeatImprovementHandoff(source, dimension, locale);
  const evidenceSamples = findingEvidenceLines(finding, locale);
  const firstStep = firstAiFixStep(finding, locale);
  const artifactValue = expectedArtifact(finding?.expectedArtifact);
  const artifact = artifactValue
    ? artifactReaderLabel(artifactValue, locale)
    : readerText(locale, "identified owner", "已定位归属");
  if (locale === "zh-CN") {
    return `/better-harness 修复这个问题

${finding.title}：${finding.reason}

${evidenceSamples}

${firstStep} 只在证据定位到具体文件或机制后，更新负责该问题的${artifact}；如果仍无法定位，返回诊断和缺失证据，不要把维度说明当作修复方案。

## 验证

- 运行该文件或机制已有的最小项目检查，记录准确命令和结果
- 确认结果中包含具体修改目标以及修改前后可观察的差异${repeatHandoff}`;
  }
  return `/better-harness fix this issue

${finding.title}: ${finding.reason}

${evidenceSamples}

${firstStep} Update the ${artifact} owner only after the evidence identifies a concrete file or mechanism. If it still does not, return the diagnosis and missing evidence instead of turning dimension prose into a repair plan.

## Validation

- Run the smallest existing project check owned by that file or mechanism and record the exact command and result
- Confirm the result names the concrete changed target and an observable before/after difference${repeatHandoff}`;
}

function actionableAiFixPrompt(source, finding, dimension, locale, reader = null) {
  const current = String(finding?.aiFixPrompt ?? "");
  return current.trim() ? current : aiFixPrompt(source, finding, dimension, locale, reader);
}

function checkupCandidates(source) {
  const repositoryEvidence = source?.repositoryEvidence ?? {};
  const findings = [
    ...rows(repositoryEvidence?.checkupFindings),
    ...rows(repositoryEvidence?.checkup?.findings),
    ...rows(repositoryEvidence?.customizationCheckup?.findings),
  ].filter((finding) => {
    const recommendation = finding?.capabilityRecommendation;
    if (recommendation) {
      return new Set(["try-built-in", "try-configured", "extend-skill", "create-skill-handoff"]).has(recommendation.nextStep)
        && !new Set(["needs-more-evidence", "unavailable"]).has(recommendation.evidenceState);
    }
    if (finding?.status === "candidate") return true;
    if (finding?.kind !== "hook") return false;
    const codes = new Set(rows(finding?.evidence).map((item) => item?.code));
    return codes.has("hook-group-p95-over-budget")
      || codes.has("hook-count-over-recommended-limit")
      || codes.has("static-hook-review");
  });
  const locale = readerLocale(source);
  const checkup = repositoryEvidence?.customizationCheckup;
  const capabilitySummaries = rows(checkup?.summary?.capabilityUse).flatMap((row) => {
    const notObserved = Number(row?.unobserved ?? 0)
      + Number(row?.configuredOnly ?? 0)
      + Number(row?.unavailable ?? 0);
    if (Number(row?.configured ?? 0) <= 0 || notObserved <= 0) return [];
    const label = row.kind === "skill"
      ? (locale === "zh-CN" ? "Skills" : "Skills")
      : row.kind === "mcp"
        ? (locale === "zh-CN" ? "MCP 服务" : "MCP servers")
        : (locale === "zh-CN" ? "插件" : "Plugins");
    const cleanup = checkup?.coverage?.cleanupEligible === true
      ? (locale === "zh-CN" ? `其中 ${Number(row.candidate ?? 0)} 个达到清理候选门槛` : `${Number(row.candidate ?? 0)} meet the cleanup-candidate threshold`)
      : (locale === "zh-CN" ? "清理仍被完整普查门槛阻止" : "cleanup remains blocked by the complete-census gate");
    return [{
      id: `capability-use-${String(row.kind ?? "unknown")}`,
      kind: row.kind,
      status: "unobserved",
      scope: "other",
      capabilityUseSummary: true,
      title: locale === "zh-CN"
        ? `${label}：已配置 ${Number(row.configured ?? 0)}，已观察 ${Number(row.observed ?? 0)}，未观察 ${notObserved}`
        : `${label}: ${Number(row.configured ?? 0)} configured, ${Number(row.observed ?? 0)} observed, ${notObserved} not observed`,
      evidence: [{ code: "capability-use-summary", state: checkup?.coverage?.cleanupReason ?? "unavailable" }],
      coverage: checkup?.coverage ?? {},
      whyThisMatters: locale === "zh-CN"
        ? `“未观察到”现在会显示在报告里，但不会被误报成“未使用”；${cleanup}。`
        : `Not-observed capability use is now visible without being mislabeled as unused; ${cleanup}.`,
    }];
  });
  return [...findings, ...capabilitySummaries];
}

function checkupDimensionRefs(finding) {
  if (finding?.kind === "hook") return ["reliable-delivery"];
  if (finding?.kind === "instruction") return ["task-understanding"];
  if (["skill", "mcp", "plugin"].includes(finding?.kind)) return ["controlled-execution"];
  return ["controlled-execution"];
}

function checkupSubdimensionRefs(finding) {
  const [dimension] = checkupDimensionRefs(finding);
  if (dimension === "reliable-delivery") return ["high-risk-approval"];
  if (dimension === "task-understanding") return ["relevant-context"];
  if (dimension === "controlled-execution") return ["supported-operation"];
  return [];
}

function checkupExpectedOutcome(finding, locale) {
  const recommendation = finding?.capabilityRecommendation;
  if (locale === "zh-CN") {
    if (finding?.capabilityUseSummary) {
      return "能力使用情况保持可见，只有完整普查和归属证据支持的项目才进入清理候选。";
    }
    if (finding?.kind === "hook") {
      return "慢 Hook、Hook 数量压力或静态风险会定位到可复核的归属证据，不会因组级信号而误删某个命令。";
    }
    if (recommendation?.nextStep === "create-skill-handoff") {
      return "重复工作会由已有能力覆盖，或形成一个经过授权、范围清楚且可验证的 Skill。";
    }
    if (recommendation?.nextStep === "try-built-in") {
      return "内置能力会通过一次有记录的试运行证明是否能稳定覆盖这个缺口。";
    }
    if (recommendation?.nextStep === "try-configured") {
      return "已配置能力会通过可验证输出证明是否已经覆盖这个缺口。";
    }
    return "这个低优先级自定义项会有清楚的归属、验证证据和最小修复边界。";
  }
  if (finding?.capabilityUseSummary) {
    return "Capability use remains visible, and only items supported by complete census and ownership evidence become cleanup candidates.";
  }
  if (finding?.kind === "hook") {
    return "Slow Hook, Hook-count pressure, or static risk is tied to reviewable ownership evidence without disabling a command from group-level signals.";
  }
  if (recommendation?.nextStep === "create-skill-handoff") {
    return "Repeated work is covered by an existing capability or a separately authorized, bounded, and verifiable Skill.";
  }
  if (recommendation?.nextStep === "try-built-in") {
    return "One recorded trial shows whether the built-in capability reliably covers this gap.";
  }
  if (recommendation?.nextStep === "try-configured") {
    return "Verifiable output shows whether the configured capability already covers this gap.";
  }
  return "This low-priority customization has clear ownership, verification evidence, and a bounded repair.";
}

function checkupFindingReason(finding, locale) {
  const recommendation = finding?.capabilityRecommendation;
  const state = recommendation?.evidenceState ?? finding?.status ?? "unavailable";
  const next = recommendation?.nextStep ?? "manual-review";
  const base = String(finding?.whyThisMatters ?? finding?.title ?? "").trim();
  if (locale === "zh-CN") {
    return `${base || "Customization Checkup 发现了一个需要普通报告链路承接的低优先级问题。"} 证据状态：${state}；下一步：${next}。`;
  }
  return `${base || "Customization Checkup found a low-priority issue that belongs in the normal report flow."} Evidence state: ${state}; next step: ${next}.`;
}

function checkupAiFixPrompt(finding, locale) {
  const title = String(finding?.title ?? "Low-priority customization checkup follow-up").trim();
  const recommendation = finding?.capabilityRecommendation;
  const handoff = String(recommendation?.handoff ?? "").trim();
  const reason = checkupFindingReason(finding, locale);
  if (finding?.kind === "hook") {
    if (locale === "zh-CN") {
      return `/better-harness 修复这个问题

${title}

## 先核对的证据

- 检查负责该问题的 Hook 配置，并打开 Checkup 扫描中的 Hook 数量、事件组 p95、命令归因和静态 Hook 检查。

## 先做什么

重新运行只读 Checkup；先定位所属配置和可归因命令。只有组级耗时或数量压力时，不要猜测并禁用某个 Hook。

## 我们看到了什么

${reason}

## 预期收益

用合并、缩小 matcher、移除重复工作或安全 async 等最小修复降低 Hook 开销，同时保留安全与阻断边界。

## 范围

只处理有明确归属和验证证据的 Hook；不要编辑插件缓存，也不要把安全或权限 Hook 为了速度改成 async。

## 怎样算完成

重新运行 Checkup 后，相关 Attention 消失、获得可归因的手工复查目标，或明确记录仍缺少的证据。

## 验证

- 重新运行 better-harness harness checkup --phase scan --provider qoder --workspace <target> --json
- 重新生成 Harness report，确认组级信号没有被描述成某个命令的确定问题`;
    }
    return `/better-harness fix this issue

${title}

## Evidence to inspect

- Inspect the owning Hook configuration, then open Hook count, event-group p95, command attribution, and static Hook review in the Checkup scan.

## First step

Re-run the read-only Checkup and identify the owning configuration and attributable command first. Do not guess and disable one Hook when only group latency or count pressure is available.

## What we saw

${reason}

## Expected benefit

Reduce Hook overhead with the smallest owned change such as consolidation, matcher narrowing, duplicate removal, or safe async execution while preserving policy boundaries.

## Scope

Change only a Hook with explicit ownership and validation evidence. Do not edit plugin caches or make security, permission, or blocking Hooks async only for speed.

## Done when

A refreshed Checkup scan clears the attention item, identifies an attributable manual-review target, or records the still-missing evidence.

## Validation

- Re-run better-harness harness checkup --phase scan --provider qoder --workspace <target> --json
- Re-run the Harness report and confirm group-level signals are not described as a proven command-specific problem`;
  }
  if (finding?.capabilityUseSummary) {
    if (locale === "zh-CN") {
      return `/better-harness 修复这个问题

${title}

## 先核对的证据

- 检查负责该类别的 Skill、MCP 或插件配置，并打开 Checkup 的能力使用汇总、观察窗口、安装宽限期、归属和 cleanupEligible 状态。

## 先做什么

用 --selection all-eligible 重新运行只读 Checkup。普查不完整时，只记录未观察项，不生成禁用方案。

## 我们看到了什么

${reason}

## 预期收益

让未观察的 Skills、MCP 和插件保持可见，同时只清理证据完整且归属明确的项目。

## 范围

只复核这个能力类别；不要根据抽样结果直接禁用或删除资产。

## 怎样算完成

完整普查把项目归类为 observed、candidate 或有明确 blocker，并且任何清理仍通过 Checkup plan 和显式确认。

## 验证

- 运行 better-harness harness checkup --phase scan --selection all-eligible --provider qoder --workspace <target> --json
- 重新生成 Harness report，确认能力汇总与 Checkup 状态一致`;
    }
    return `/better-harness fix this issue

${title}

## Evidence to inspect

- Inspect the owning Skill, MCP, or plugin configuration, then open the Checkup capability-use summary, observation window, install grace, ownership, and cleanupEligible state.

## First step

Re-run the read-only Checkup with --selection all-eligible. When the census is incomplete, record not-observed items without producing a disable plan.

## What we saw

${reason}

## Expected benefit

Keep unobserved Skills, MCP servers, and plugins visible while cleaning only items with complete evidence and unambiguous ownership.

## Scope

Review only this capability category. Do not disable or delete assets from sampled results.

## Done when

The complete census classifies items as observed, candidate, or blocked with a specific reason, and any cleanup still uses Checkup plan plus explicit confirmation.

## Validation

- Run better-harness harness checkup --phase scan --selection all-eligible --provider qoder --workspace <target> --json
- Re-run the Harness report and confirm the capability summary matches Checkup status`;
  }
  if (locale === "zh-CN") {
    return `/better-harness 修复这个问题

${title}

## 先核对的证据

- 打开这个 Checkup 候选的扫描结果、capabilityRecommendation 和现有能力覆盖。

## 先做什么

先重新运行只读 Checkup，并确认内置能力和已配置 Skill 仍不能覆盖这个缺口；证据不足时停止交接。

## 我们看到了什么

${reason}

## 预期收益

把 Checkup 发现的自定义项问题纳入普通报告修复链路，同时保持低优先级、只读扫描和显式授权边界。

## 范围

只处理这个 Checkup 候选及其已确认的能力覆盖；不要直接创建、安装或修改无关 Skill。

## 怎样算完成

重新运行 Checkup 后，这个问题变成 observed、healthy、已由内置/已配置 Skill 覆盖，或形成单独授权的 /create-skill 交接。

不要直接创建或安装 Skill。${handoff ? `如果后续已经确认 Skill ownership，可把这个交接作为输入：${handoff}` : "先复核已有内置能力和已配置 Skill。"}

## 验证

- 重新运行 better-harness harness checkup --phase scan --provider qoder --workspace <target> --json
- 重新生成 Harness report，确认该 Low finding 仍走普通 findings[] 和 aiFixPrompt 合约`;
  }
  return `/better-harness fix this issue

${title}

## Evidence to inspect

- Open this Checkup candidate's scan result, capabilityRecommendation, and existing capability coverage.

## First step

Re-run the read-only Checkup and confirm that built-in and configured Skills still do not cover the gap. Stop the handoff when the evidence is insufficient.

## What we saw

${reason}

## Expected benefit

Carry the Checkup customization issue through the normal report repair flow while preserving low priority, read-only scan behavior, and explicit authorization boundaries.

## Scope

Limit work to this Checkup candidate and its confirmed capability coverage. Do not directly create, install, or modify an unrelated Skill.

## Done when

A refreshed Checkup scan shows this issue as observed, healthy, covered by a built-in or configured Skill, or ready for a separately authorized /create-skill handoff.

Do not create or install a Skill directly. ${handoff ? `If Skill ownership is later confirmed, use this handoff as input: ${handoff}` : "Recheck built-in and configured Skill coverage first."}

## Validation

- Re-run better-harness harness checkup --phase scan --provider qoder --workspace <target> --json
- Re-run the Harness report and confirm this Low finding still uses the normal findings[] and aiFixPrompt contract`;
}

function checkupFindingTitle(finding, locale) {
  const fallback = readerText(locale, "Review the low-priority customization follow-up", "复核这个低优先级自定义项");
  const title = String(finding?.title ?? fallback).trim();
  const withoutCategory = title.replace(/^[^:：\n]{1,40}[:：]\s*/u, "").trim();
  return (withoutCategory || fallback).slice(0, locale === "zh-CN" ? 64 : 120);
}

function checkupReportFindings(source) {
  const locale = readerLocale(source);
  return checkupCandidates(source).map((finding, index) => ({
    id: `checkup-${String(finding?.id ?? index + 1).replace(/[^A-Za-z0-9._-]+/gu, "-").slice(0, 80)}`,
    kind: "evidence-gap",
    title: checkupFindingTitle(finding, locale),
    severity: finding?.kind === "hook" ? "Medium" : "Low",
    reason: checkupFindingReason(finding, locale),
    expectedOutcome: checkupExpectedOutcome(finding, locale),
    expectedArtifact: "Document",
    expectedOutput: [readerText(
      locale,
      "Update the Checkup review Document so this bounded customization candidate records its verified capability owner, evidence, and next validation result.",
      "更新 Checkup 复核文档，使这个有界自定义候选记录已确认的能力归属、证据和下一次验证结果。",
    )],
    aiFixPrompt: checkupAiFixPrompt(finding, locale),
    dimensionRefs: checkupDimensionRefs(finding),
    subdimensionRefs: checkupSubdimensionRefs(finding),
    staticEvidence: [{
      kind: "customization-checkup",
      id: String(finding?.id ?? "checkup-follow-up"),
      status: String(finding?.status ?? finding?.capabilityRecommendation?.evidenceState ?? "unavailable"),
    }],
  }));
}

function usageOutcomeReviewLead(source, locale) {
  const usage = source?.sessionEvents?.usageEfficiency;
  if (!isObject(usage) || !isObject(usage.selection) || !isObject(usage.longSessions) || !isObject(usage.outcomeReview)) return null;
  const platform = SESSION_ANALYSIS_HOST_SET.has(source?.manifest?.scope?.platform)
    ? source.manifest.scope.platform
    : "qoder";
  const activeCount = Number(usage?.longSessions?.activeCount ?? 0);
  const reviewedCount = Number(usage?.outcomeReview?.reviewedActiveLongCount ?? 0);
  const unreviewedCount = Math.max(0, activeCount - reviewedCount);
  if (usage?.selection?.complete !== true || unreviewedCount <= 0) return null;
  const samples = rows(usage?.longSessions?.samples).slice(0, 4);
  if (samples.length === 0) return null;
  const longest = Number(usage?.longSessions?.longestActiveMinutes ?? 0);
  const eligible = Number(usage?.selection?.eligibleSessionCount ?? usage?.selection?.analyzedSessionCount ?? 0);
  const activeRatio = Number(usage?.longSessions?.activeRatio ?? (eligible > 0 ? activeCount / eligible : 0));
  const ratioPercent = activeRatio > 0 && activeRatio < 0.01
    ? (activeRatio * 100).toFixed(2)
    : (activeRatio * 100).toFixed(1);
  const wallOnly = Number(usage?.longSessions?.wallOnlyCount ?? 0);
  const title = readerText(
    locale,
    `${unreviewedCount} long-session candidate${unreviewedCount === 1 ? "" : "s"} still need outcome review`,
    `${unreviewedCount} 个长会话候选仍待结果复核`,
  );
  const reason = readerText(
    locale,
    `${activeCount} of ${eligible} analyzed sessions (${ratioPercent}%) crossed the estimated active-time threshold; the longest estimate was ${longest} minutes and ${reviewedCount} have reviewed outcomes. ${wallOnly} additional long spans may be idle or resumed work. This is an investigation lead, not a confirmed efficiency, decomposition, tool, or model problem.`,
    `${eligible} 个已分析会话中有 ${activeCount} 个（${ratioPercent}%）超过估算活跃时长阈值，最长估算为 ${longest} 分钟，其中 ${reviewedCount} 个已有结果复核；另有 ${wallOnly} 个长跨度可能来自空闲或恢复。这只是调查线索，尚未确认存在效率、任务拆分、工具链或模型问题。`,
  );
  const expectedOutcome = readerText(
    locale,
    "Each displayed candidate is classified by task family, outcome, and friction so the report can decide whether any real improvement is needed.",
    "每个展示候选都完成任务族、结果和摩擦分类，让报告能够判断是否真的需要改进。",
  );
  const sampleLines = samples.map((sample) => {
    const role = sample?.role === "child-agent-candidate"
      ? readerText(locale, "child-agent candidate", "子 Agent 候选")
      : readerText(locale, "user-thread candidate", "用户会话候选");
    return locale === "zh-CN"
      ? `- ${sample.alias}：${role}，估算活跃约 ${sample.activeMinutes} 分钟，失败事件 ${sample.failureCount} 次`
      : `- ${sample.alias}: ${role}, about ${sample.activeMinutes} estimated active minutes, ${sample.failureCount} failure event(s)`;
  });
  if (unreviewedCount > samples.length) {
    sampleLines.push(readerText(
      locale,
      `- Showing ${samples.length} of ${unreviewedCount} unreviewed active-long sessions; review the remaining ${unreviewedCount - samples.length} through the same bounded packet.`,
      `- 当前展示 ${unreviewedCount} 个未复核活跃长会话中的 ${samples.length} 个；其余 ${unreviewedCount - samples.length} 个继续通过同一个有界 review packet 复核。`,
    ));
  }
  const boundedSamples = sampleLines.join("\n");
  const displayedAliases = samples.map((sample) => String(sample.alias)).join(", ")
    || readerText(locale, "the displayed aliases", "当前展示的别名");
  const coverageCopy = unreviewedCount > samples.length
    ? readerText(
        locale,
        `This is a ${samples.length}/${unreviewedCount} bounded view (4/N); conclusions apply only to displayed samples and the remainder stays unreviewed.`,
        `这是 ${samples.length}/${unreviewedCount} 的有界视图（4/N）；只对展示样本下结论，其余候选保持未复核。`,
      )
    : readerText(
        locale,
        `This is the complete ${samples.length}/${unreviewedCount} candidate view; conclusions still require semantic review.`,
        `这是完整的 ${samples.length}/${unreviewedCount} 候选视图；结论仍需经过语义复核。`,
      );
  const aiFixPrompt = locale === "zh-CN"
    ? `/better-harness 复核这些会话\n\n${title}\n\n## 先核对的会话\n\n${boundedSamples}\n\n## 先做什么\n\n在操作系统临时目录创建 <run>，从项目根运行：\n\n\`\`\`bash\nnode scripts/session-analysis.mjs insights --platform ${platform} --workspace . --selection all-eligible --limit 1000 --format json --output <run>/insights.json\nnode scripts/session-analysis/usage-review-packet.mjs --source <run>/insights.json --workspace . --limit 8 --output <run>/.review-packet.json\n\`\`\`\n\n私有 review packet 会在本地解析候选；只为 ${displayedAliases} 写入 taskFamily、outcome、friction、confidence 和 evidenceReason。先完成复核，不改业务代码，也不创建 Memory、Skill 或 Hook。\n\n## 我们看到了什么\n\n${reason}\n\n## 为什么值得复核\n\n未复核前无法区分复杂任务、工具链摩擦、暂停恢复噪音或正常的长任务。\n\n## 预期结果\n\n${expectedOutcome}\n\n## 范围\n\n只生成隐私安全的会话效率复核和 reader report，不改业务代码，不把墙钟跨度当作活跃成本。持久报告只保留匿名别名；私有 review packet 不得复制进报告。${coverageCopy}\n\n## 怎样算完成\n\n<run>/.review.json 对 ${displayedAliases} 各有一条有效复核；语义复核生成 <run>/insights.reviewed.json；<run>/report.md 以 reviewed source 校验通过。复核未确认问题时，不创建优化项。\n\n## 验证\n\n- 运行 \`node scripts/session-analysis/usage-semantic-review.mjs --source <run>/insights.json --packet <run>/.review-packet.json --review <run>/.review.json --output <run>/insights.reviewed.json\`\n- 运行 \`node scripts/session-analysis/validate-usage-report.mjs --source <run>/insights.reviewed.json --report <run>/report.md\`，必须返回 \`ok: true\`\n- 确认 reviewed source 的 \`outcomeReview.reviewedActiveLongCount\` 等于已复核的展示别名数；通过后删除两个私有临时 review 文件`
    : `/better-harness review these sessions\n\n${title}\n\n## Evidence to inspect\n\n${boundedSamples}\n\n## First step\n\nCreate <run> in the OS temporary directory, then run from the project root:\n\n\`\`\`bash\nnode scripts/session-analysis.mjs insights --platform ${platform} --workspace . --selection all-eligible --limit 1000 --format json --output <run>/insights.json\nnode scripts/session-analysis/usage-review-packet.mjs --source <run>/insights.json --workspace . --limit 8 --output <run>/.review-packet.json\n\`\`\`\n\nThe private review packet resolves candidates locally. Write taskFamily, outcome, friction, confidence, and evidenceReason only for ${displayedAliases}. Finish diagnosis before editing product code or creating a Memory, Skill, or Hook.\n\n## What we saw\n\n${reason}\n\n## Why review it\n\nWithout outcome review, complex work, tool friction, idle/resume noise, and a normal long task remain indistinguishable.\n\n## Expected result\n\n${expectedOutcome}\n\n## Scope\n\nCreate only a privacy-safe session-efficiency review and reader report. Do not edit product code or treat wall span as active cost. Durable reports keep aliases only; do not copy the private review packet into them. ${coverageCopy}\n\n## Done when\n\n<run>/.review.json has one valid row for each of ${displayedAliases}; semantic review writes <run>/insights.reviewed.json; and <run>/report.md validates against the reviewed source. If review confirms no problem, do not create an improvement.\n\n## Validation\n\n- Run \`node scripts/session-analysis/usage-semantic-review.mjs --source <run>/insights.json --packet <run>/.review-packet.json --review <run>/.review.json --output <run>/insights.reviewed.json\`\n- Run \`node scripts/session-analysis/validate-usage-report.mjs --source <run>/insights.reviewed.json --report <run>/report.md\`; it must return \`ok: true\`\n- Confirm \`outcomeReview.reviewedActiveLongCount\` in the reviewed source equals the number of reviewed displayed aliases; delete the two private review files after validation`;
  return {
    id: "session-usage-outcome-review-gap",
    title,
    reason,
    expectedOutcome,
    aiFixPrompt,
    sampleCoverage: {
      shown: samples.length,
      total: unreviewedCount,
      complete: samples.length === unreviewedCount,
    },
  };
}

function projectedUsageEfficiency(source, locale) {
  const sourceUsage = source?.sessionEvents?.usageEfficiency;
  if (!sourceUsage) return null;
  const usage = JSON.parse(JSON.stringify(sourceUsage));
  for (const sample of rows(usage?.longSessions?.samples)) {
    const sessionId = String(sample.rawSessionId ?? "").trim();
    const userRequest = String(sample.userInputSummary ?? "").trim();
    if (/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(sessionId)) sample.sessionId = sessionId;
    if (userRequest) sample.userRequest = userRequest;
    delete sample.rawSessionId;
    delete sample.sessionRef;
    delete sample.userInputSummary;
  }
  const reviewLead = usageOutcomeReviewLead(source, locale);
  if (reviewLead) usage.reviewLead = reviewLead;
  return usage;
}

export function projectTaskLoopReportFacts(source) {
  const sourceErrors = validateHarnessReportSource(source);
  if (sourceErrors.length > 0) {
    throw Object.assign(new Error(sourceErrors.join("; ")), {
      code: "INVALID_REPORT_SOURCE",
      errors: sourceErrors,
    });
  }
  const usageEfficiency = projectedUsageEfficiency(source, readerLocale(source));
  const practiceCoverageRows = normalizedPracticeInventoryRows(source);
  const summaryFacts = {
    evidenceMode: rows(source?.taskEpisodes).length > 0 ? "session-rich" : "session-limited",
    evidenceBoundary: evidenceBoundary(source),
    semanticFacets: projectSemanticFacets(source?.semanticFacets),
    learningCapture: learningCapture(source),
    ...(practiceCoverageRows.length > 0 ? {
      aiAgentPractice: {
        inspectedSurfaces: normalizedInspectedPracticeSurfaces(source),
        coverageRows: practiceCoverageRows,
      },
    } : {}),
    ...(source?.sessionEvents?.usageActivity
      ? { usageActivity: JSON.parse(JSON.stringify(source.sessionEvents.usageActivity)) }
      : {}),
    ...(usageEfficiency ? { usageEfficiency } : {}),
    ...(source?.sessionEvents?.contextUsage
      ? { contextUsage: JSON.parse(JSON.stringify(source.sessionEvents.contextUsage)) }
      : {}),
  };
  const usageErrors = validateTaskLoopUsagePair(summaryFacts);
  if (usageErrors.length > 0) {
    throw Object.assign(new Error(usageErrors.join("; ")), {
      code: "INVALID_REPORT_FACTS",
      errors: usageErrors,
    });
  }
  return summaryFacts;
}

function taskLoopSummaryFactsErrors(summaryFacts) {
  const requiredFields = ["evidenceMode", "evidenceBoundary", "semanticFacets", "learningCapture"];
  const errors = [];
  if (!isObject(summaryFacts)) {
    errors.push("summaryFacts must be an object");
  } else {
    for (const field of requiredFields) {
      if (summaryFacts[field] === undefined) errors.push(`summaryFacts missing ${field}`);
    }
    if (summaryFacts.aiAgentPractice !== undefined) {
      errors.push(...aiAgentPracticeErrors(summaryFacts.aiAgentPractice));
    }
    if (summaryFacts.contextUsage !== undefined) {
      errors.push(...contextUsageErrors(summaryFacts.contextUsage));
    }
    errors.push(...requiredTaskLoopUsageErrors(summaryFacts));
    errors.push(...validateTaskLoopUsagePair(summaryFacts));
  }
  return errors;
}

export function taskLoopCanvasFromSummaryFacts(summaryFacts) {
  const errors = taskLoopSummaryFactsErrors(summaryFacts);
  if (errors.length > 0) {
    throw Object.assign(new Error(errors.join("; ")), {
      code: "INVALID_REPORT_FACTS",
      errors,
    });
  }
  return {
    schemaVersion: TASK_LOOP_CANVAS_DATA_SCHEMA_VERSION,
    summaryFactsSchemaVersion: TASK_LOOP_SUMMARY_FACTS_CANVAS_SCHEMA_VERSION,
    summary: JSON.parse(JSON.stringify(summaryFacts)),
    dimensions: [],
    findings: [],
  };
}

function diagnosticFindingReason(review, locale) {
  const scope = String(review?.affectedScope ?? "").trim();
  const missing = String(review?.missingSegment ?? "").trim().replace(/[。.!?！？]+$/u, "");
  const impact = String(review?.impact ?? "").trim();
  if (locale === "zh-CN") {
    const readerScope = scope === "repository-wide" ? "仓库范围" : scope;
    const scopeBoundary = /[A-Za-z0-9.)\]]$/u.test(readerScope) ? " 内" : "内";
    return `${readerScope}${scopeBoundary}缺少${missing}。${impact}`;
  }
  return `${scope}: ${missing}. ${impact}`;
}

function softwareFluencyReviewFindings(source) {
  const repositoryReview = rows(source?.assessmentDecisions)
    .find((decision) => decision?.kind === "repository-review");
  const projected = [];
  for (const capability of rows(repositoryReview?.reviewedSoftwareFluencyCapabilities)) {
    const defaultDimensionRef = SOFTWARE_FLUENCY_REVIEW_DIMENSION.get(capability?.id);
    for (const finding of softwareFluencyCapabilityFindings(capability)) {
      projected.push({
        id: String(finding?.id ?? "").trim(),
        kind: String(finding?.kind ?? ""),
        title: String(finding?.title ?? ""),
        severity: String(finding?.severity ?? ""),
        reason: String(finding?.reason ?? ""),
        expectedOutcome: String(finding?.expectedOutcome ?? ""),
        expectedArtifact: String(finding?.expectedArtifact ?? ""),
        expectedOutput: rows(finding?.expectedOutput).map(String),
        aiFixPrompt: String(finding?.aiFixPrompt ?? ""),
        dimensionRefs: rows(finding?.dimensionRefs).length > 0
          ? rows(finding.dimensionRefs).map(String)
          : [defaultDimensionRef].filter(Boolean),
        subdimensionRefs: rows(finding?.subdimensionRefs).map(String),
        ...(finding && Object.hasOwn(finding, "target") ? { target: finding.target } : {}),
        staticEvidence: unique([
          ...rows(capability?.evidenceRefs),
          ...rows(finding?.evidenceRefs),
        ]),
      });
    }
  }
  return projected;
}

function assertUniqueProjectedFindingIds(producers) {
  const owners = new Map();
  const errors = [];
  for (const [producer, findings] of producers) {
    for (const finding of rows(findings)) {
      const id = String(finding?.id ?? "").trim();
      if (!id) continue;
      const previous = owners.get(id);
      if (previous) errors.push(`finding id ${id} is produced by both ${previous} and ${producer}`);
      else owners.set(id, producer);
    }
  }
  if (errors.length === 0) return;
  throw Object.assign(new Error(errors.join("; ")), {
    code: "FINDING_ID_COLLISION",
    errors,
  });
}

function sourceFindings(source, dimensions) {
  const locale = readerLocale(source);
  const byId = new Map(dimensions.map((dimension) => [dimension.id, dimension]));
  const subdimensionById = new Map(dimensions.flatMap((dimension) => dimension.subdimensions.map((subdimension) => [subdimension.id, {
    ...subdimension,
    dimensionId: dimension.id,
  }])));
  const diagnosticFindings = rows(source?.repositoryEvidence?.diagnosticCoverageReviews)
    .filter((review) => review?.status === "confirmed-gap")
    .map((review) => ({
      id: `diagnostic-${String(review.id)}`,
      kind: "missing-mechanism",
      title: String(review.title),
      severity: review.severity,
      reason: diagnosticFindingReason(review, locale),
      expectedOutcome: String(review.expectedOutcome),
      expectedArtifact: review.expectedArtifact,
      expectedOutput: rows(review.expectedOutput).map(String),
      aiFixPrompt: String(review.aiFixPrompt ?? ""),
      dimensionRefs: ["change-validation"],
      subdimensionRefs: ["failure-repair", "validate-again"],
      staticEvidence: rows(review.evidenceRefs),
    }));
  const supplied = rows(source?.repositoryEvidence?.findings);
  const checkupFindings = checkupReportFindings(source);
  const softwareFluencyFindings = softwareFluencyReviewFindings(source);
  assertUniqueProjectedFindingIds([
    ["diagnostic review", diagnosticFindings],
    ["repository review", supplied],
    ["Checkup", checkupFindings],
    ["Software Fluency review", softwareFluencyFindings],
  ]);
  const generated = [...diagnosticFindings, ...supplied, ...checkupFindings, ...softwareFluencyFindings];

  return generated.map((item, index) => {
    const subdimensionRefs = unique(rows(item?.subdimensionRefs).filter((id) => subdimensionById.has(id)));
    const dimensionRefs = unique([
      ...rows(item?.dimensionRefs).filter((id) => byId.has(id)),
      ...subdimensionRefs.map((id) => subdimensionById.get(id).dimensionId),
    ]);
    const linked = dimensionRefs.map((id) => byId.get(id));
    const linkedSubdimensions = subdimensionRefs.map((id) => subdimensionById.get(id));
    const bridge = {
      staticEvidence: publicRefs([
        ...(rows(item?.staticEvidence)),
        ...(rows(item?.evidenceRefs)),
        ...linked.flatMap((dimension) => dimension.evidenceBridge.staticEvidence),
        ...linkedSubdimensions.flatMap((subdimension) => subdimension.evidenceBridge.staticEvidence),
      ], { kind: "repository", id: `finding-${index + 1}` }),
      episodeEvidence: publicRefs([
        ...(rows(item?.episodeEvidence)),
        ...linked.flatMap((dimension) => dimension.evidenceBridge.episodeEvidence),
        ...linkedSubdimensions.flatMap((subdimension) => subdimension.evidenceBridge.episodeEvidence),
      ], { kind: "task-episode", id: "unobserved" }),
      deliveryEvidence: publicRefs([
        ...linked.flatMap((dimension) => dimension.evidenceBridge.deliveryEvidence),
        ...linkedSubdimensions.flatMap((subdimension) => subdimension.evidenceBridge.deliveryEvidence),
      ], { kind: "delivery", id: "unobserved" }),
      state: linked.some((dimension) => dimension.evidenceBridge.state === "outcome-supported")
        ? "outcome-supported"
        : linked.some((dimension) => dimension.evidenceBridge.state === "exercised")
          ? "exercised"
          : linked.some((dimension) => dimension.evidenceBridge.state === "wired-unobserved")
            ? "wired-unobserved"
            : linked.some((dimension) => dimension.evidenceBridge.state === "static-only")
              ? "static-only"
              : linked.some((dimension) => dimension.evidenceBridge.state === "missing")
                ? "missing"
                : "unobserved",
    };
    const primary = linked[0] ?? dimensions[0];
    const reader = readerCopyFrom(item?.reader, readerCopy(primary, locale), locale);
    const expectedOutcome = typeof item?.expectedOutcome === "string" && item.expectedOutcome.trim()
      ? item.expectedOutcome.trim()
      : projectUnlock(primary, locale);
    const hasItemTarget = item && Object.hasOwn(item, "target");
    const fallbackTarget = source?.repositoryEvidence?.findingTarget;
    const finding = {
      id: String(item?.id ?? `task-loop-${index + 1}`),
      kind: ["evidence-gap", "missing-mechanism", "outcome-gap"].includes(item?.kind) ? item.kind : findingKind(primary),
      title: String(item?.title ?? readerCopy(primary, locale).title),
      severity: ["High", "Medium", "Low"].includes(item?.severity) ? item.severity : severityFor(primary),
      reason: String(item?.reason ?? `${reader.whatWeSaw} ${reader.whyItMatters}`),
      expectedOutcome,
      expectedArtifact: expectedArtifact(item?.expectedArtifact),
      aiFixPrompt: String(item?.aiFixPrompt ?? ""),
      dimensionRefs,
      subdimensionRefs,
      evidenceBridge: bridge,
      ...(hasItemTarget || fallbackTarget !== undefined
        ? { target: hasItemTarget ? item.target : fallbackTarget }
        : {}),
    };
    finding.aiFixPrompt = actionableAiFixPrompt(source, finding, primary, locale, reader);
    finding.expectedOutput = findingExpectedOutput({ ...item, ...finding, aiFixPrompt: finding.aiFixPrompt });
    delete finding.expectedOutcome;
    return finding;
  }).filter((finding) => finding.dimensionRefs.length > 0);
}

function episodeCoverage(source) {
  const episodes = rows(source?.taskEpisodes);
  const edited = episodes.filter((episode) => rows(episode?.changeSets).length > 0);
  const closed = edited.filter((episode) => episode?.closure?.status === "closed");
  const recovered = episodes.filter((episode) => episode?.repair?.status === "repaired-and-passed");
  return {
    episodeCount: episodes.length,
    editedEpisodeCount: edited.length,
    closedEpisodeCount: closed.length,
    recoveredEpisodeCount: recovered.length,
  };
}

function autonomyRadius(source, dimensions, locale) {
  const coverage = episodeCoverage(source);
  const confidence = source?.manifest?.selection?.confidence ?? "Low";
  const delivery = rows(source?.deliveryEvidence);
  const hasControlledOutcome = dimensions.find((dimension) => dimension.id === "reliable-delivery")?.level === "Outcome-supported";
  const deployment = delivery.some((row) => row?.level === "deployment-outcome-observed");
  const threshold = coverage.closedEpisodeCount >= 2 && confidence !== "Low";
  let level = "R0";
  if (coverage.episodeCount >= 2) level = "R1";
  if (threshold) level = "R2";
  if (threshold && hasControlledOutcome) level = "R3";
  if (threshold && hasControlledOutcome && deployment) level = "R4";
  const observedOnce = level === "R0" && coverage.episodeCount === 1;
  const activityOnly = level === "R1" && coverage.closedEpisodeCount < 2;
  return {
    level,
    status: observedOnce ? "observed-once" : activityOnly ? "observed" : level === "R0" ? "unobserved" : "demonstrated",
    confidence,
    reason: observedOnce
      ? readerText(locale, "One eligible episode is observed; the radius is not yet demonstrated.", "只观察到一个符合条件的任务片段，还不足以证明自主工作半径。")
      : activityOnly
        ? readerText(locale, "Task activity is visible, but no sufficient closed change evidence supports a demonstrated autonomy radius yet.", "可以看到任务活动，但还没有足够的已闭环改动证据证明自主工作半径。")
      : level === "R0"
        ? readerText(locale, "No eligible task episode supports a demonstrated autonomous work radius.", "还没有符合条件的任务片段可以证明自主工作半径。")
        : readerText(locale, "The radius is bounded by linked closure, delivery, coverage, and confidence evidence.", "这个自主工作半径受到闭环、交付、覆盖范围和可信度证据的共同约束。"),
  };
}

function atAGlance(source, dimensions, findings) {
  const locale = readerLocale(source);
  const taskDimensions = dimensions.filter((dimension) => dimension.id !== "learning-capture");
  const ranked = [...taskDimensions].sort((left, right) => (LEVEL_RANK.get(right.level) ?? 0) - (LEVEL_RANK.get(left.level) ?? 0) || left.id.localeCompare(right.id));
  const weakest = [...taskDimensions].sort((left, right) => (LEVEL_RANK.get(left.level) ?? 0) - (LEVEL_RANK.get(right.level) ?? 0) || left.id.localeCompare(right.id))[0];
  const highestRank = LEVEL_RANK.get(ranked[0]?.level) ?? 0;
  const lowestRank = LEVEL_RANK.get(weakest?.level) ?? 0;
  const hasDistinctLoopLevels = highestRank !== lowestRank;
  const rankedFindings = [...findings].sort((left, right) =>
    (SEVERITY_RANK.get(left.severity) ?? 3) - (SEVERITY_RANK.get(right.severity) ?? 3));
  const moves = rankedFindings.slice(0, 3).map((finding) => {
    const dimensionRef = finding.dimensionRefs[0];
    const dimension = dimensions.find((item) => item.id === dimensionRef);
    const concreteMove = findingMove(finding, locale);
    const concreteBenefit = String(rows(finding.expectedOutput)[0] ?? "").trim() || projectUnlock(dimension, locale);
    return {
      findingRef: finding.id,
      dimensionRef,
      move: concreteMove,
      expectedUnlock: concreteBenefit,
    };
  });
  return {
    demonstratedAutonomyRadius: autonomyRadius(source, dimensions, locale),
    coverage: {
      ...episodeCoverage(source),
      selection: {
        strategy: source?.manifest?.selection?.strategy ?? "unknown",
        eligibleCount: Number(source?.manifest?.selection?.eligibleCount ?? 0),
        analyzedCount: Number(source?.manifest?.selection?.analyzedCount ?? 0),
        confidence: source?.manifest?.selection?.confidence ?? "Low",
      },
    },
    strongestLoop: hasDistinctLoopLevels ? { dimensionRef: ranked[0]?.id ?? "task-understanding", state: ranked[0]?.state ?? "Unobserved" } : null,
    largestLeak: hasDistinctLoopLevels ? { dimensionRef: weakest?.id ?? "task-understanding", blocker: weakest?.blocker ?? "No task-loop evidence observed." } : null,
    priorityMoves: moves,
  };
}

function reportOverview(source, strengths, findings, locale) {
  const reviewed = String(source?.repositoryEvidence?.readerOverview?.text ?? "").trim();
  if (reviewed) return reviewed;
  const foundation = String(rows(strengths)[0] ?? "")
    .trim()
    .replace(/^[^:：]{1,40}[:：]\s*/u, "")
    .split(/[。.!?！？]/u, 1)[0]
    .trim();
  const priority = [...rows(findings)].sort((left, right) =>
    (SEVERITY_RANK.get(left?.severity) ?? 3) - (SEVERITY_RANK.get(right?.severity) ?? 3))[0];
  const priorityTitle = String(priority?.title ?? "").trim().replace(/[。.]$/u, "");
  if (locale === "zh-CN") {
    if (priorityTitle) return `${priorityTitle}。`;
    if (foundation) return `${foundation.slice(0, 79)}${foundation.length > 79 ? "…" : "。"}`;
    return "当前证据不足以形成项目级结论，请查看证据边界。";
  }
  if (priorityTitle) return `${priorityTitle}.`;
  if (foundation) return `${foundation.slice(0, 159)}${foundation.length > 159 ? "…" : "."}`;
  return "Current evidence is too limited for a project-level conclusion; review the evidence boundary.";
}

function evidenceBoundary(source) {
  const manifest = source?.manifest ?? {};
  return {
    manifest: {
      schemaVersion: manifest.schemaVersion ?? null,
      sourceFingerprint: manifest.sources?.fingerprint ?? null,
      adapterVersion: manifest.adapter?.version ?? null,
      platform: manifest.scope?.platform ?? null,
      selection: {
        strategy: manifest.selection?.strategy ?? "unknown",
        eligibleCount: Number(manifest.selection?.eligibleCount ?? 0),
        analyzedCount: Number(manifest.selection?.analyzedCount ?? 0),
        confidence: manifest.selection?.confidence ?? "Low",
      },
    },
    episodeCoverage: episodeCoverage(source),
    deliveryEvidenceLevels: unique(rows(source?.deliveryEvidence).map((row) => row?.level)).sort(),
    sourceGaps: rows(manifest?.warnings).map((warning) => String(warning?.code ?? warning)).filter(Boolean),
  };
}

const UNREVIEWED_LONG_SESSION_FINDING_RE = /(?:long[- ]session|long session|outcome review|reviewed long|长会话|结果复核|复核结果)/iu;
const SESSION_GAP_WITHOUT_EDIT_RE = /(?:(?:session sample|sampled sessions|会话样本|采样会话)[\s\S]{0,160}(?:post[- ]edit|validation|编辑后|改动后|验证)|(?:post[- ]edit|编辑后|改动后)[\s\S]{0,100}(?:validation|验证)|(?:delivery evidence|deliveryEvidenceLevels|交付(?:验收)?证据)[\s\S]{0,100}(?:empty|unobserved|missing|为空|未被观测|缺失))/iu;
const UNOBSERVED_LEARNING_GAP_RE = /(?:learning capture|loop[- ]engineering|evidence (?:boundary|gap)|not[- ]evaluable|missing (?:mechanism|evidence)|学习沉淀|闭环工程|证据(?:边界|缺口)|不可评估|缺少(?:机制|证据))/iu;

function readerFindingEligibilityErrors(data) {
  const errors = [];
  const coverage = data?.summary?.evidenceBoundary?.episodeCoverage;
  const findings = rows(data?.findings);
  if (isObject(coverage) && coverage.editedEpisodeCount === 0) {
    for (const [index, finding] of findings.entries()) {
      const dimensionRefs = new Set(rows(finding?.dimensionRefs));
      const text = `${finding?.id ?? ""} ${finding?.title ?? ""} ${finding?.reason ?? ""}`;
      if ((dimensionRefs.has("change-validation") || dimensionRefs.has("reliable-delivery"))
        && SESSION_GAP_WITHOUT_EDIT_RE.test(text)) {
        errors.push(`findings[${index}] cannot promote a session validation or delivery gap without an observed changed Task Episode`);
      }
    }
  }

  const usage = data?.summary?.usageEfficiency;
  if (usage?.outcomeReview?.reviewedCandidateCount === 0) {
    for (const [index, finding] of findings.entries()) {
      const text = `${finding?.id ?? ""} ${finding?.title ?? ""} ${finding?.reason ?? ""}`;
      if (UNREVIEWED_LONG_SESSION_FINDING_RE.test(text)) {
        errors.push(`findings[${index}] must keep unreviewed long-session candidates in summary.usageEfficiency.reviewLead, not emit them as a finding`);
      }
    }
  }

  if (data?.summary?.learningCapture?.state === "N/A") {
    for (const [index, finding] of findings.entries()) {
      if (!rows(finding?.dimensionRefs).includes("learning-capture")) continue;
      const supportedOwnerGap = rows(finding?.subdimensionRefs).includes("loop-engineering")
        && rows(finding?.evidenceBridge?.staticEvidence)
          .some((reference) => reference?.kind === "workflow-demand");
      const text = `${finding?.id ?? ""} ${finding?.title ?? ""} ${finding?.reason ?? ""}`;
      if (!supportedOwnerGap && UNOBSERVED_LEARNING_GAP_RE.test(text)) {
        errors.push(`findings[${index}] must keep an unobserved Learning Capture evidence gap in the evidence boundary, not emit it as a finding`);
      }
    }
  }
  return errors;
}

function readerLocale(source) {
  return source?.repositoryEvidence?.locale === "zh-CN" ? "zh-CN" : "en";
}

function learningSummary(learning, locale) {
  if (locale !== "zh-CN") return learning.summary;
  const effectiveCount = rows(learning.interventions).filter((entry) => entry?.comparison?.effectiveness === "Effective").length;
  const validCount = rows(learning.interventions).filter((entry) => entry?.comparison?.valid).length;
  if (learning.state === "N/A") {
    return learning.interventions.length > 0
      ? "当前闭环工程化尚未达到“已运行”；历史改进账本已保留，但本次不激活长期验证。"
      : "暂不适用——需要两个可比的观察窗口和一次改进对比。";
  }
  if (learning.state === "pending") return "改进已经声明基线和后续对比窗口，目前还在等待结果。";
  if (learning.state === "regressing") return "可比窗口中的主要指标或护栏指标变差了；扩大改进前应先停止或回退。";
  if (learning.state === "outcome-supported") {
    return effectiveCount > 0
      ? `${effectiveCount} 项改进在可比且有结果支持的窗口中被证明为 Effective。`
      : `${validCount} 个可比改进窗口已有结果证据，但还不能声称改进有效。`;
  }
  return `${validCount} 个可比改进窗口的状态为“${learning.state}”，目前还不能证明改进有效。`;
}

function learningCapture(source) {
  const engineering = learningCaptureReviewedChecks(source).get("loop-engineering");
  const learning = summarizeLearningCapture(rows(source?.interventionLedger), {
    active: engineering?.state === "Exercised",
  });
  return { ...learning, summary: learningSummary(learning, readerLocale(source)) };
}

function learningCaptureReviewedChecks(source) {
  const review = rows(source?.assessmentDecisions)
    .find((decision) => decision?.kind === "repository-review");
  return new Map(rows(review?.reviewedChecks)
    .filter((check) => LEARNING_LOOP_CHECK_IDS.includes(check?.id))
    .map((check) => [check.id, check]));
}

function learningBridgeState(state) {
  return {
    Present: "static-only",
    Wired: "wired-unobserved",
    Exercised: "exercised",
    "Outcome-supported": "outcome-supported",
    Missing: "missing",
    "Not applicable": "not-applicable",
    Unobserved: "unobserved",
  }[state] ?? "unobserved";
}

function learningEvidenceBridge(source) {
  const checks = learningCaptureReviewedChecks(source);
  const detection = checks.get("lifecycle-repeat-detection");
  const engineering = checks.get("loop-engineering");
  const later = checks.get("later-validation");
  const entries = rows(source?.interventionLedger);
  return {
    staticEvidence: publicRefs([
      ...rows(engineering?.evidenceRefs),
      ...rows(engineering?.currentValidationEvidenceRefs),
      ...entries.map((entry) => ({
        kind: "learning-capture",
        id: entry?.id ?? "declared-capture",
        label: entry?.asset?.label ?? entry?.asset?.type,
      })),
    ], { kind: "learning-capture", id: "unobserved" }),
    episodeEvidence: publicRefs([
      ...rows(detection?.evidenceRefs),
      ...entries.flatMap((entry) => [
        ...rows(entry?.frictionRefs),
        entry?.episodeRef ? { kind: "task-episode", id: entry.episodeRef } : null,
      ]),
    ], { kind: "task-episode", id: "unobserved" }),
    deliveryEvidence: publicRefs([
      ...rows(later?.evidenceRefs),
      ...entries.flatMap((entry) => [
        ...rows(entry?.result?.evidenceRefs),
        ...rows(entry?.result?.outcomeEvidenceRefs),
      ]),
    ], { kind: "comparison", id: "unobserved" }),
  };
}

function projectLearningSubdimension(source, descriptor) {
  const locale = readerLocale(source);
  const check = learningCaptureReviewedChecks(source).get(descriptor.id) ?? {};
  const state = String(check.state ?? "Unobserved");
  const level = ["Present", "Wired", "Exercised", "Outcome-supported"].includes(state) ? state : null;
  const fallbackSummary = descriptor.id === "lifecycle-repeat-detection"
    ? readerText(locale, "No bounded lifecycle opportunity-detection result is confirmed yet.", "尚未确认有界的生命周期机会识别结果。")
    : descriptor.id === "loop-engineering"
      ? readerText(locale, "No supported repeated opportunity has reached a complete Loop Engineering contract.", "尚无证据支持的重复机会进入完整的闭环工程化契约。")
      : readerText(locale, "No comparable later outcome or completed maintenance inspection is available yet.", "尚无可比的长期结果或已完成的维护检查。");
  const summary = String(check.summary || fallbackSummary);
  const evidenceRefs = rows(check.evidenceRefs);
  return {
    id: descriptor.id,
    label: descriptor.label,
    level,
    state,
    summary,
    findingRefs: rows(check.findingRefs).map(String),
    evidenceBridge: {
      staticEvidence: descriptor.id === "loop-engineering"
        ? publicRefs([...evidenceRefs, ...rows(check.currentValidationEvidenceRefs)])
        : [],
      episodeEvidence: descriptor.id === "lifecycle-repeat-detection" ? publicRefs(evidenceRefs) : [],
      deliveryEvidence: descriptor.id === "later-validation" ? publicRefs(evidenceRefs) : [],
      state: learningBridgeState(state),
    },
    blocker: dimensionBlocker({ id: descriptor.id, state, level }, locale),
  };
}

function projectLearningDimension(source, descriptor) {
  const locale = readerLocale(source);
  const learning = learningCapture(source);
  const subdimensions = descriptor.subdimensions.map((subdimension) => projectLearningSubdimension(source, subdimension));
  const projection = projectLearningLoopState(subdimensions);
  const { state, level } = projection;
  const bridge = learningEvidenceBridge(source);
  const missingStage = subdimensions.find((subdimension) => subdimension.state === "Missing");
  const blocker = learning.state === "regressing"
    ? readerText(locale,
      "A later comparison regressed; apply the declared stop or revert condition before expanding the intervention.",
      "后续对比出现退化；扩大改进前应先执行已声明的停止或回退条件。")
    : missingStage
      ? readerText(locale,
        `${missingStage.label} is missing from the reviewed Learning Capture evidence.`,
        `经过复核的经验沉淀证据中缺少“${missingStage.label}”。`)
      : dimensionBlocker({ id: descriptor.id, state, level }, locale);
  return {
    id: descriptor.id,
    label: descriptor.label,
    level,
    state,
    summary: learning.summary,
    findingRefs: [],
    subdimensions,
    evidenceBridge: { ...bridge, state: learningBridgeState(state) },
    blocker,
  };
}

function reportEvidenceMode(dimensions) {
  const current = dimensions.filter((dimension) => dimension.id !== "learning-capture");
  if (current.some((dimension) => dimension.level === "Exercised" || dimension.level === "Outcome-supported")) return "session-rich";
  if (current.some((dimension) => dimension.level === "Present" || dimension.level === "Wired" || dimension.state === "Missing")) return "session-limited";
  return "insufficient";
}

function assertUsefulEvidenceMode(mode) {
  if (mode !== "insufficient") return;
  const errors = ["Bavi has no reviewed task evidence or repository baseline; fall back to Software Fluency"];
  throw Object.assign(new Error(errors[0]), {
    code: "INSUFFICIENT_BAVI_EVIDENCE",
    errors,
  });
}

function scoreReviewDecision(source) {
  return rows(source?.assessmentDecisions).find((decision) => decision?.kind === "score-review");
}

function dimensionReaderSummaryErrors(value, label, locale, prefix) {
  const text = typeof value === "string" ? value.trim() : "";
  const maxLength = locale === "zh-CN" ? 80 : 160;
  const errors = [];
  if (!text) return [`${prefix} must explain the dimension for readers`];
  if ([...text].length > maxLength) errors.push(`${prefix} must stay within ${maxLength} characters`);
  if (/\r|\n/u.test(text)) errors.push(`${prefix} must be one line`);
  if (/[。！？!?]|\.(?=\s|$)/u.test(text.replace(/[。！？.!?]$/u, ""))) errors.push(`${prefix} must be one sentence`);
  const normalizedText = text.toLocaleLowerCase();
  const normalizedLabel = String(label ?? "").trim().toLocaleLowerCase();
  if (normalizedLabel && (normalizedText.startsWith(`${normalizedLabel}:`) || normalizedText.startsWith(`${normalizedLabel}：`))) {
    errors.push(`${prefix} must not repeat the dimension label`);
  }
  return errors;
}

function scoreReviewErrors(source) {
  const errors = [];
  const review = scoreReviewDecision(source);
  if (!review) return ["score-review decision is required"];
  if (review.status !== "reviewed") errors.push("score-review must be reviewed");
  if (typeof review.modelId !== "string" || !review.modelId.trim()) errors.push("score-review modelId must be non-empty metadata");
  if (typeof review.calibration !== "string" || !review.calibration.trim()) errors.push("score-review calibration must be non-empty metadata");
  errors.push(...learningLoopStateErrors([...learningCaptureReviewedChecks(source).values()], {
    interventionLedger: rows(source?.interventionLedger),
  }));
  const scoreRows = rows(review.dimensions);
  const byId = new Map(scoreRows.map((row) => [row?.id, row]));
  const locale = readerLocale(source);
  if (scoreRows.length !== AGENT_WORK_LOOP_DIMENSION_IDS.length) errors.push("score-review must contain exactly five dimension rows");
  for (const id of AGENT_WORK_LOOP_DIMENSION_IDS) {
    const row = byId.get(id);
    if (!row) {
      errors.push(`score-review missing dimension: ${id}`);
      continue;
    }
    const minimumScore = id === "learning-capture"
      ? LEARNING_CAPTURE_REVIEWED_SCORE_FLOOR
      : 0;
    if (!Number.isInteger(row.score) || row.score < minimumScore || row.score > 100) {
      errors.push(`score-review ${id}.score must be an integer from ${minimumScore} to 100`);
    }
    if (!SCORE_CONFIDENCE.has(row.confidence)) errors.push(`score-review ${id}.confidence must be low, medium, or high`);
    if (typeof row.reason !== "string" || row.reason.trim().length < 24) {
      errors.push(`score-review ${id}.reason must explain the AI judgment`);
    } else if (Object.values(GENERATED_SCORE_REASONS).includes(row.reason.trim())) {
      errors.push(`score-review ${id}.reason cannot use the reserved direct-generated score reason`);
    }
    const descriptor = readerDescriptor(DIMENSION_BY_ID.get(id), locale);
    errors.push(...dimensionReaderSummaryErrors(row.readerSummary, descriptor?.label, locale, `score-review ${id}.readerSummary`));
    if (!Array.isArray(row.evidenceRefs) || row.evidenceRefs.length === 0) errors.push(`score-review ${id}.evidenceRefs must cite reviewed evidence`);
  }
  for (const row of scoreRows) {
    if (!AGENT_WORK_LOOP_DIMENSION_IDS.includes(row?.id)) errors.push(`score-review contains unsupported dimension: ${row?.id}`);
  }
  return errors;
}

function applyScoreReview(source, dimensions) {
  const review = scoreReviewDecision(source);
  const byId = new Map(rows(review?.dimensions).map((row) => [row.id, row]));
  const errors = [];
  for (const dimension of dimensions) {
    const scoreRow = byId.get(dimension.id);
    const ceiling = dimension.id === "learning-capture"
      ? learningCaptureScoreCeiling(dimension.subdimensions)
      : agentWorkLoopDimensionScoreCeiling([dimension, ...dimension.subdimensions]);
    if (scoreRow.score > ceiling) {
      errors.push(`score-review ${dimension.id}.score ${scoreRow.score} exceeds the evidence ceiling ${ceiling}`);
      continue;
    }
    dimension.score = scoreRow.score;
    dimension.scoreReason = scoreRow.reason.trim();
    dimension.scoreConfidence = scoreRow.confidence;
    dimension.scoreEvidenceRefs = publicRefs(scoreRow.evidenceRefs, { kind: "score-review", id: dimension.id });
  }
  if (errors.length > 0) {
    throw Object.assign(new Error(errors.join("; ")), { code: "INVALID_AGENT_WORK_LOOP_SCORE_REVIEW", errors });
  }
}

function applyGeneratedEvidenceScores(source, dimensions) {
  const locale = readerLocale(source);
  const retainedRefs = publicRefs(source?.evidenceRefs);
  const scoreEvidenceRefs = retainedRefs.length > 0
    ? retainedRefs
    : [{ kind: "session-selection", id: "bounded-selection" }];
  for (const dimension of dimensions) {
    const evidenceScore = dimension.id === "learning-capture"
      ? LEARNING_CAPTURE_REVIEWED_SCORE_FLOOR
      : scoreAgentWorkLoopDimension([dimension, ...dimension.subdimensions]);
    dimension.score = Number.isInteger(evidenceScore) ? evidenceScore : 0;
    dimension.scoreReason = GENERATED_SCORE_REASONS[locale] ?? GENERATED_SCORE_REASONS.en;
    dimension.scoreConfidence = "low";
    dimension.scoreEvidenceRefs = scoreEvidenceRefs;
  }
}

function assertSourceReadyForProjection(source) {
  const requiredKinds = ["source-candidate", "repository-review", "score-review"];
  const required = rows(source?.assessmentDecisions).filter((decision) =>
    requiredKinds.includes(decision?.kind));
  const presentKinds = new Set(required.map((decision) => decision.kind));
  const missing = requiredKinds.filter((kind) => !presentKinds.has(kind));
  const unresolved = required.filter((decision) => decision?.status !== "reviewed");
  if (missing.length === 0 && unresolved.length === 0) return;
  const kinds = [...missing, ...unresolved.map((decision) => decision.kind)].join(", ");
  const errors = [`task-loop source candidate requires review before projection: ${kinds}`];
  throw Object.assign(new Error(errors[0]), {
    code: "UNREVIEWED_TASK_LOOP_SOURCE",
    errors,
  });
}

function assertReviewEvidenceComplete(source) {
  const decisions = rows(source?.assessmentDecisions);
  const sourceReview = decisions.find((decision) => decision?.kind === "source-candidate");
  const repositoryReview = decisions.find((decision) => decision?.kind === "repository-review");
  const errors = [...scoreReviewErrors(source)];
  if (sourceReview && rows(sourceReview.evidenceRefs).length === 0) {
    errors.push("source-candidate review must include bounded evidenceRefs");
  }
  if (repositoryReview) {
    const requiredFrameworks = rows(repositoryReview.requiredFrameworks);
    const reviewedFrameworks = new Map(rows(repositoryReview.reviewedFrameworks).map((framework) => [framework?.id, framework]));
    for (const requiredFramework of REQUIRED_REPOSITORY_REVIEW_FRAMEWORKS) {
      if (!requiredFrameworks.includes(requiredFramework)) {
        errors.push(`repository-review must require framework: ${requiredFramework}`);
        continue;
      }
      const reviewed = reviewedFrameworks.get(requiredFramework);
      if (!reviewed || rows(reviewed.evidenceRefs).length === 0) {
        errors.push(`repository-review missing evidence for required framework: ${requiredFramework}`);
      } else if (reviewed.status !== "reviewed") {
        errors.push(`repository-review framework must be reviewed: ${requiredFramework}`);
      } else if (typeof reviewed.summary !== "string" || reviewed.summary.trim() === "") {
        errors.push(`repository-review missing summary for required framework: ${requiredFramework}`);
      }
    }
    const reviewedChecks = new Map(rows(repositoryReview.reviewedChecks).map((check) => [check?.id, check]));
    for (const requiredCheck of rows(repositoryReview.requiredChecks)) {
      const reviewed = reviewedChecks.get(requiredCheck);
      if (!reviewed || rows(reviewed.evidenceRefs).length === 0) {
        errors.push(`repository-review missing evidence for required check: ${requiredCheck}`);
      } else if (reviewed.status !== "reviewed") {
        errors.push(`repository-review check must be reviewed: ${requiredCheck}`);
      } else if (typeof reviewed.summary !== "string" || reviewed.summary.trim() === "") {
        errors.push(`repository-review missing summary for required check: ${requiredCheck}`);
      }
    }
    const requiredCapabilities = rows(repositoryReview.requiredSoftwareFluencyCapabilities);
    const reviewedCapabilityRows = rows(repositoryReview.reviewedSoftwareFluencyCapabilities);
    const reviewedCapabilities = new Map(reviewedCapabilityRows.map((capability) => [capability?.id, capability]));
    if (reviewedCapabilities.size !== reviewedCapabilityRows.length) {
      errors.push("repository-review must contain at most one row per Software Fluency capability");
    }
    for (const requiredCapability of REQUIRED_SOFTWARE_FLUENCY_CAPABILITIES) {
      if (!requiredCapabilities.includes(requiredCapability)) {
        errors.push(`repository-review must require Software Fluency capability: ${requiredCapability}`);
        continue;
      }
      const reviewed = reviewedCapabilities.get(requiredCapability);
      if (!reviewed || rows(reviewed.evidenceRefs).length === 0) {
        errors.push(`repository-review missing evidence for Software Fluency capability: ${requiredCapability}`);
      } else if (reviewed.status !== "reviewed") {
        errors.push(`repository-review Software Fluency capability must be reviewed: ${requiredCapability}`);
      } else if (typeof reviewed.summary !== "string" || reviewed.summary.trim() === "") {
        errors.push(`repository-review missing summary for Software Fluency capability: ${requiredCapability}`);
      }
      if (reviewed) {
        for (const [findingIndex, finding] of softwareFluencyCapabilityFindings(reviewed).entries()) {
          errors.push(...softwareFluencyFindingErrors(
            finding,
            `repository-review Software Fluency capability ${requiredCapability}.findings[${findingIndex}]`,
          ));
        }
      }
    }
  }
  const diagnosticReviews = rows(source?.repositoryEvidence?.diagnosticCoverageReviews);
  if (diagnosticReviews.length === 0) {
    errors.push("repository review missing diagnosticCoverageReviews");
  } else {
    for (const review of diagnosticReviews) {
      if (review?.status === "review-required") {
        errors.push(`diagnostic coverage review remains unresolved: ${review?.id ?? "(unknown)"}`);
      }
    }
  }
  if (errors.length === 0) return;
  throw Object.assign(new Error(errors.join("; ")), {
    code: "INCOMPLETE_TASK_LOOP_REVIEW",
    errors,
  });
}

export function projectTaskLoopFindings(source, { projectName = "", direct = false } = {}) {
  const sourceErrors = validateHarnessReportSource(source);
  if (sourceErrors.length > 0) {
    throw Object.assign(new Error(sourceErrors.join("; ")), { code: "INVALID_REPORT_SOURCE", errors: sourceErrors });
  }
  if (!direct) {
    assertSourceReadyForProjection(source);
    assertReviewEvidenceComplete(source);
  }
  const locale = readerLocale(source);
  const dimensions = DIMENSIONS.map((rawDescriptor) => {
    const descriptor = readerDescriptor(rawDescriptor, locale);
    if (descriptor.id === "learning-capture") return projectLearningDimension(source, descriptor);
    const dimension = projectDimension(source, descriptor);
    dimension.subdimensions = descriptor.subdimensions.map((subdimension) => projectSubdimension(source, dimension, subdimension));
    return dimension;
  });
  const evidenceMode = reportEvidenceMode(dimensions);
  assertUsefulEvidenceMode(evidenceMode);
  if (direct) applyGeneratedEvidenceScores(source, dimensions);
  else applyScoreReview(source, dimensions);
  const findings = sourceFindings(source, dimensions);
  for (const dimension of dimensions) {
    dimension.findingRefs = findings.filter((finding) => finding.dimensionRefs.includes(dimension.id)).map((finding) => finding.id);
    for (const subdimension of dimension.subdimensions) {
      subdimension.findingRefs = findings
        .filter((finding) => rows(finding.subdimensionRefs).includes(subdimension.id))
        .map((finding) => finding.id);
    }
  }
  const strengths = dimensions
    .filter((dimension) => dimension.level === "Outcome-supported" || dimension.level === "Exercised"
      || (evidenceMode === "session-limited" && (dimension.level === "Present" || dimension.level === "Wired")))
    .map((dimension) => projectSpecificSummary(dimension, locale))
    .slice(0, 3);
  const overview = reportOverview(source, strengths, findings, locale);
  const usageEfficiency = projectedUsageEfficiency(source, locale);
  refreshReaderSummaries(dimensions, source, locale);
  if (direct) refreshGeneratedReaderSummaries(dimensions, locale);
  return {
    summary: {
      projectName: projectName || source?.repositoryEvidence?.projectName || "Harness task-loop report",
      locale: readerLocale(source),
      modelId: AGENT_WORK_LOOP_MODEL_ID,
      reportContractVersion: TASK_LOOP_REPORT_CONTRACT_VERSION,
      evidenceMode,
      overview,
      strengths,
      assignmentSummaries: [],
      atAGlance: atAGlance(source, dimensions, findings),
      evidenceBoundary: evidenceBoundary(source),
      dimensions,
      aiAgentPractice: aiAgentPracticeSummary(source, dimensions),
      semanticFacets: projectSemanticFacets(source.semanticFacets),
      learningCapture: learningCapture(source),
      ...(source?.sessionEvents?.usageActivity
        ? { usageActivity: JSON.parse(JSON.stringify(source.sessionEvents.usageActivity)) }
        : {}),
      ...(usageEfficiency
        ? { usageEfficiency }
        : {}),
      ...(source?.sessionEvents?.contextUsage
        ? { contextUsage: JSON.parse(JSON.stringify(source.sessionEvents.contextUsage)) }
        : {}),
    },
    findings,
  };
}

function projectFields(value, fields) {
  const projected = {};
  for (const field of fields) {
    if (Object.hasOwn(value ?? {}, field)) projected[field] = value[field];
  }
  return projected;
}

export function assignmentSummariesFromFindings(findings) {
  return rows(findings)
    .filter((finding) => isObject(finding?.assignmentSummary)
      && Array.isArray(finding?.actualOutput)
      && finding.actualOutput.length > 0)
    .map((finding) => ({
      findingId: finding.id,
      revision: finding.actualOutputRevision,
      locale: finding.assignmentSummary.locale,
      title: finding.assignmentSummary.title,
      body: finding.assignmentSummary.body,
      outputs: finding.actualOutput.map((output) => ({ ...output })),
    }));
}

export function repairProgressFromFindings(findings) {
  const findingRows = rows(findings);
  const statuses = findingRows.map((finding) => finding?.postFixRepairReview?.status);
  const verifiedFindingCount = statuses.filter((status) => status === "verified").length;
  const partialFindingCount = statuses.filter((status) => status === "partial").length;
  const blockedFindingCount = statuses.filter((status) => status === "blocked").length;
  const totalFindingCount = findingRows.length;
  const reviewedFindingCount = verifiedFindingCount + partialFindingCount + blockedFindingCount;
  return {
    score: totalFindingCount === 0 ? 100 : Math.round((verifiedFindingCount / totalFindingCount) * 100),
    status: totalFindingCount === 0 || verifiedFindingCount === totalFindingCount
      ? "complete"
      : reviewedFindingCount === 0
        ? "not-started"
        : "in-progress",
    verifiedFindingCount,
    partialFindingCount,
    blockedFindingCount,
    pendingFindingCount: Math.max(0, totalFindingCount - reviewedFindingCount),
    totalFindingCount,
    basis: "independent-post-fix-review",
  };
}

function taskLoopHostSummaryFields() {
  return [...TASK_LOOP_HOST_SUMMARY_FIELDS, ...LEGACY_TASK_LOOP_HOST_SUMMARY_FIELDS];
}

function taskLoopHostFindingFields() {
  return [...TASK_LOOP_HOST_FINDING_FIELDS, ...LEGACY_TASK_LOOP_HOST_FINDING_FIELDS];
}

function canvasAtAGlance(summary) {
  const atAGlance = summary?.atAGlance;
  if (!isObject(atAGlance)) return undefined;
  return { ...atAGlance };
}

function mergeObjects(first, second) {
  if (!isObject(first)) return second;
  if (!isObject(second)) return first;
  const merged = { ...first };
  for (const [key, value] of Object.entries(second)) {
    merged[key] = isObject(value) && isObject(first[key])
      ? mergeObjects(first[key], value)
      : value;
  }
  return merged;
}

export function isFullTaskLoopFindings(data) {
  return isAgentWorkLoopReport(data)
    && rows(data.summary.dimensions).some((dimension) => Array.isArray(dimension?.subdimensions));
}

function splitRowsById(hostRows, canvasRows, label, errors) {
  const hostIds = new Set();
  const canvasIds = new Set();
  for (const [index, row] of rows(hostRows).entries()) {
    const id = String(row?.id ?? "");
    if (!id) errors.push(`${label} host row ${index} missing id`);
    else if (hostIds.has(id)) errors.push(`${label} host has duplicate id: ${id}`);
    else hostIds.add(id);
  }
  for (const [index, row] of rows(canvasRows).entries()) {
    const id = String(row?.id ?? "");
    if (!id) errors.push(`${label} Canvas row ${index} missing id`);
    else if (canvasIds.has(id)) errors.push(`${label} Canvas has duplicate id: ${id}`);
    else canvasIds.add(id);
  }
  for (const id of hostIds) {
    if (!canvasIds.has(id)) errors.push(`${label} Canvas data missing id: ${id}`);
  }
  for (const id of canvasIds) {
    if (!hostIds.has(id)) errors.push(`${label} Canvas data has unknown id: ${id}`);
  }
}

function joinRowsById(hostRows, canvasRows) {
  const canvasById = new Map(rows(canvasRows).map((row) => [row?.id, row]));
  return rows(hostRows).map((row) => ({ ...canvasById.get(row?.id), ...row }));
}

export function splitTaskLoopFindings(data) {
  const errors = isFullTaskLoopFindings(data)
    ? validateTaskLoopFindings(data)
    : validateCompactTaskLoopFindings(data);
  if (errors.length > 0) {
    throw Object.assign(new Error(errors.join("; ")), {
      code: "INVALID_TASK_LOOP_FINDINGS",
      errors,
    });
  }
  const summary = data.summary;
  const findingRows = rows(data.findings).map((row) => ({
    ...row,
    expectedOutput: findingExpectedOutput(row),
  }));
  const canvasAtAGlanceData = canvasAtAGlance(summary);
  return {
    findings: {
      summary: {
        ...projectFields(summary, TASK_LOOP_HOST_SUMMARY_FIELDS.filter((field) => !["dimensions", "assignmentSummaries"].includes(field))),
        assignmentSummaries: assignmentSummariesFromFindings(findingRows),
        dimensions: rows(summary.dimensions).map((row) => projectFields(row, TASK_LOOP_HOST_DIMENSION_FIELDS)),
      },
      findings: findingRows.map((row) => projectFields(row, TASK_LOOP_HOST_FINDING_FIELDS)),
    },
    canvas: {
      schemaVersion: TASK_LOOP_CANVAS_DATA_SCHEMA_VERSION,
      summary: {
        ...projectFields(summary, TASK_LOOP_CANVAS_SUMMARY_FIELDS.filter((field) => field !== "atAGlance")),
        ...(canvasAtAGlanceData ? { atAGlance: canvasAtAGlanceData } : {}),
      },
      dimensions: rows(summary.dimensions).map((row) => projectFields(row, TASK_LOOP_CANVAS_DIMENSION_FIELDS)),
      findings: findingRows.map((row) => projectFields(row, TASK_LOOP_CANVAS_FINDING_FIELDS)),
    },
  };
}

export function mergeTaskLoopCanvasData(findings, canvas) {
  if (!isObject(canvas)) return findings;
  const summaryFactsSchemaVersion = canvas.summaryFactsSchemaVersion;
  if (summaryFactsSchemaVersion !== undefined
    && summaryFactsSchemaVersion !== TASK_LOOP_SUMMARY_FACTS_CANVAS_SCHEMA_VERSION) {
    throw Object.assign(new Error(`unsupported summary facts Canvas schema: ${summaryFactsSchemaVersion}`), {
      code: "UNSUPPORTED_SUMMARY_FACTS_CANVAS_SCHEMA",
    });
  }
  if (summaryFactsSchemaVersion === TASK_LOOP_SUMMARY_FACTS_CANVAS_SCHEMA_VERSION) {
    const errors = taskLoopSummaryFactsErrors(canvas.summary);
    if (errors.length > 0) {
      throw Object.assign(new Error(errors.join("; ")), {
        code: "INVALID_REPORT_FACTS",
        errors,
      });
    }
  }
  const machineSummaryFacts = summaryFactsSchemaVersion === TASK_LOOP_SUMMARY_FACTS_CANVAS_SCHEMA_VERSION
    ? projectFields(canvas.summary, TASK_LOOP_MACHINE_SUMMARY_FACT_FIELDS)
    : {};
  const machinePractice = summaryFactsSchemaVersion === TASK_LOOP_SUMMARY_FACTS_CANVAS_SCHEMA_VERSION
    && isObject(canvas.summary?.aiAgentPractice)
    ? canvas.summary.aiAgentPractice
    : null;
  const leadPractice = findings.summary?.aiAgentPractice;
  const mergedPractice = machinePractice
    ? mergeAiAgentPracticeInventoryFacts(leadPractice, machinePractice)
    : leadPractice;
  return {
    summary: {
      ...canvas.summary,
      ...findings.summary,
      atAGlance: mergeObjects(canvas.summary?.atAGlance, findings.summary?.atAGlance),
      dimensions: joinRowsById(findings.summary?.dimensions, canvas.dimensions),
      ...(mergedPractice === undefined ? {} : { aiAgentPractice: mergedPractice }),
      ...machineSummaryFacts,
    },
    findings: joinRowsById(findings.findings, canvas.findings),
  };
}

function mergeAiAgentPracticeInventoryFacts(leadPractice, machinePractice) {
  const exactRows = rows(machinePractice?.coverageRows);
  const exactRowsBySurface = new Map(exactRows.map((row) => [row?.surface, row]));
  const mergedRows = rows(leadPractice?.coverageRows)
    .map((row) => exactRowsBySurface.get(row?.surface) ?? row);
  const mergedSurfaces = new Set(mergedRows.map((row) => row?.surface).filter(Boolean));
  for (const row of exactRows) {
    if (mergedSurfaces.has(row?.surface)) continue;
    mergedRows.push(row);
    mergedSurfaces.add(row?.surface);
  }
  const inspectedSurfaces = [...new Set([
    ...rows(leadPractice?.inspectedSurfaces),
  ].filter((surface) => AI_AGENT_PRACTICE_SURFACE_SET.has(String(surface))))];
  return {
    inspectedSurfaces,
    coverageRows: mergedRows,
  };
}

export function reconcileTaskLoopFindingLinks(data) {
  if (!isObject(data) || !isObject(data.summary) || !Array.isArray(data.findings)) return data;
  const findingIds = new Set(data.findings.map((finding) => finding?.id).filter(Boolean));
  const dimensions = rows(data.summary.dimensions).map((dimension) => ({
    ...dimension,
    findingRefs: data.findings
      .filter((finding) => rows(finding?.dimensionRefs).includes(dimension?.id))
      .map((finding) => finding.id),
    ...(Array.isArray(dimension?.subdimensions) ? {
      subdimensions: dimension.subdimensions.map((subdimension) => ({
        ...subdimension,
        findingRefs: data.findings
          .filter((finding) => rows(finding?.subdimensionRefs).includes(subdimension?.id))
          .map((finding) => finding.id),
      })),
    } : {}),
  }));
  const atAGlance = isObject(data.summary.atAGlance)
    ? {
        ...data.summary.atAGlance,
        priorityMoves: rows(data.summary.atAGlance.priorityMoves)
          .filter((move) => findingIds.has(move?.findingRef)),
      }
    : data.summary.atAGlance;
  return {
    ...data,
    summary: {
      ...data.summary,
      assignmentSummaries: assignmentSummariesFromFindings(data.findings),
      dimensions,
      ...(atAGlance === undefined ? {} : { atAGlance }),
    },
  };
}

export function validateTaskLoopUsagePair(data) {
  const summary = data?.summary ?? data ?? {};
  const hasActivity = Object.hasOwn(summary, "usageActivity");
  const hasEfficiency = Object.hasOwn(summary, "usageEfficiency");
  const boundaryEligible = Number(summary.evidenceBoundary?.manifest?.selection?.eligibleCount);
  if (!hasActivity && !hasEfficiency) return [];
  if (hasActivity !== hasEfficiency) {
    return ["summary.usageActivity and summary.usageEfficiency must be supplied together"];
  }
  const activity = summary.usageActivity;
  const usage = summary.usageEfficiency;
  if (!isObject(activity) || !isObject(usage)) return [];
  const eligible = Number(usage.selection?.eligibleSessionCount);
  const analyzed = Number(usage.selection?.analyzedSessionCount);
  const activitySessions = Number(activity.sessions?.total);
  if (!Number.isInteger(eligible) || eligible < 0) return [];
  if (Number.isInteger(boundaryEligible) && boundaryEligible >= 0 && eligible !== boundaryEligible) {
    return [`Agent Work Loop usage census must match the ${boundaryEligible}-session evidence boundary`];
  }
  if (activitySessions !== eligible
    || analyzed !== eligible
    || usage.selection?.strategy !== "all-eligible"
    || usage.selection?.complete !== true) {
    return [`Agent Work Loop usage must cover the complete ${eligible}/${eligible} all-eligible session population`];
  }
  return [];
}

function requiredTaskLoopUsageErrors(data) {
  const summary = data?.summary ?? data ?? {};
  const boundaryEligible = Number(summary.evidenceBoundary?.manifest?.selection?.eligibleCount);
  const hasActivity = Object.hasOwn(summary, "usageActivity");
  const hasEfficiency = Object.hasOwn(summary, "usageEfficiency");
  return Number.isInteger(boundaryEligible) && boundaryEligible > 0 && !hasActivity && !hasEfficiency
    ? [`summary.usageActivity and summary.usageEfficiency are required for ${boundaryEligible} eligible sessions`]
    : [];
}

export function validateCompactTaskLoopFindings(data) {
  const errors = [];
  if (!isObject(data)) return ["findings.json must be an object"];
  errors.push(...unsupportedFields(data, ["summary", "findings"], "findings.json"));
  const summary = data.summary;
  if (!isObject(summary)) return [...errors, "findings.json summary must be an object"];
  const allowedSummaryFields = [...new Set([
    ...taskLoopHostSummaryFields(),
    ...TASK_LOOP_CANVAS_SUMMARY_FIELDS,
  ])];
  errors.push(...unsupportedFields(summary, allowedSummaryFields, "findings.json summary"));
  for (const field of ["projectName", "locale", "modelId", "reportContractVersion", "overview", "dimensions"]) {
    if (summary[field] === undefined || summary[field] === null || summary[field] === "") {
      errors.push(`findings.json summary missing ${field}`);
    }
  }
  if (summary.modelId !== AGENT_WORK_LOOP_MODEL_ID) {
    errors.push(`findings.json summary.modelId must be ${AGENT_WORK_LOOP_MODEL_ID}`);
  }
  if (!new Set(["en", "zh-CN"]).has(summary.locale)) {
    errors.push("findings.json summary.locale must be en or zh-CN");
  }
  if (!Number.isInteger(summary.reportContractVersion) || summary.reportContractVersion < 1) {
    errors.push("findings.json summary.reportContractVersion must be positive integer metadata");
  }
  if (typeof summary.projectName !== "string" || !summary.projectName.trim()) {
    errors.push("findings.json summary.projectName must be a non-empty string");
  }
  if (typeof summary.overview !== "string" || !summary.overview.trim()) {
    errors.push("findings.json summary.overview must be a non-empty string");
  }
  if (summary.strengths !== undefined && (!Array.isArray(summary.strengths)
    || summary.strengths.some((value) => typeof value !== "string" || !value.trim()))) {
    errors.push("findings.json summary.strengths must be an array of non-empty strings when supplied");
  }
  if (summary.aiAgentPractice !== undefined) errors.push(...aiAgentPracticeErrors(summary.aiAgentPractice));
  if (summary.contextUsage !== undefined) errors.push(...contextUsageErrors(summary.contextUsage));
  if (summary.assignmentSummaries !== undefined && !Array.isArray(summary.assignmentSummaries)) {
    errors.push("findings.json summary.assignmentSummaries must be an array when supplied");
  }

  const expectedDimensions = AGENT_WORK_LOOP_DIMENSIONS;
  const expectedIds = expectedDimensions.map((dimension) => dimension.id);
  const dimensionIds = new Set();
  if (!Array.isArray(summary.dimensions) || summary.dimensions.length !== expectedDimensions.length) {
    errors.push(`findings.json summary.dimensions must contain exactly ${expectedDimensions.length} task-loop dimensions`);
  }
  const allowedDimensionFields = [...new Set([
    ...TASK_LOOP_HOST_DIMENSION_FIELDS,
    ...LEGACY_TASK_LOOP_HOST_DIMENSION_FIELDS,
    ...TASK_LOOP_CANVAS_DIMENSION_FIELDS,
  ])];
  for (const [index, dimension] of rows(summary.dimensions).entries()) {
    const prefix = `summary.dimensions[${index}]`;
    errors.push(...unsupportedFields(dimension, allowedDimensionFields, prefix));
    for (const field of ["id", "label", "score", "summary"]) {
      if (dimension?.[field] === undefined || dimension?.[field] === null || dimension?.[field] === "") {
        errors.push(`${prefix} missing ${field}`);
      }
    }
    const descriptor = expectedDimensions.find((candidate) => candidate.id === dimension?.id);
    if (!descriptor) errors.push(`${prefix} contains unsupported task-loop dimension: ${dimension?.id}`);
    else {
      const expectedLabel = summary.locale === "zh-CN" ? descriptor.zhLabel : descriptor.label;
      if (dimension.label !== expectedLabel) errors.push(`${prefix}.label must be ${expectedLabel}`);
    }
    if (dimensionIds.has(dimension?.id)) errors.push(`${prefix} duplicates dimension id: ${dimension?.id}`);
    dimensionIds.add(dimension?.id);
    const minimumScore = dimension?.id === "learning-capture" && summary.reportContractVersion >= 25
      ? LEARNING_CAPTURE_REVIEWED_SCORE_FLOOR
      : 0;
    if (!Number.isInteger(dimension?.score) || dimension.score < minimumScore || dimension.score > 100) {
      errors.push(`${prefix}.score must be an integer from ${minimumScore} to 100`);
    }
    if (typeof dimension?.summary !== "string" || !dimension.summary.trim()) {
      errors.push(`${prefix}.summary must be a non-empty string`);
    }
    if (dimension.findingRefs !== undefined && !Array.isArray(dimension.findingRefs)) {
      errors.push(`${prefix}.findingRefs must be an array when supplied`);
    }
  }
  for (const id of expectedIds) {
    if (!dimensionIds.has(id)) errors.push(`findings.json summary.dimensions missing task-loop dimension: ${id}`);
  }

  if (!Array.isArray(data.findings)) errors.push("findings.json must include a findings array");
  const findingIds = new Set();
  const allowedFindingFields = [...new Set([
    ...TASK_LOOP_HOST_FINDING_FIELDS,
    ...LEGACY_TASK_LOOP_HOST_FINDING_FIELDS,
    ...TASK_LOOP_CANVAS_FINDING_FIELDS,
  ])];
  for (const [index, finding] of rows(data.findings).entries()) {
    const prefix = `findings[${index}]`;
    errors.push(...unsupportedFields(finding, allowedFindingFields, prefix));
    for (const field of ["id", "title", "severity", "reason", "aiFixPrompt", "dimensionRefs"]) {
      if (finding?.[field] === undefined || finding?.[field] === null || finding?.[field] === "") {
        errors.push(`${prefix} missing ${field}`);
      }
    }
    if (typeof finding?.id !== "string" || !finding.id.trim()) errors.push(`${prefix}.id must be a non-empty string`);
    if (findingIds.has(finding?.id)) errors.push(`${prefix} duplicates finding id: ${finding?.id}`);
    findingIds.add(finding?.id);
    if (!["High", "Medium", "Low"].includes(finding?.severity)) errors.push(`${prefix} has invalid severity: ${finding?.severity}`);
    for (const field of ["title", "reason", "aiFixPrompt"]) {
      if (typeof finding?.[field] !== "string" || !finding[field].trim()) errors.push(`${prefix}.${field} must be a non-empty string`);
      if (PRIVATE_USAGE_SUMMARY_RE.test(String(finding?.[field] ?? ""))) {
        errors.push(`${prefix}.${field} must not expose private paths, stable ids, or credential-shaped values`);
      }
    }
    if (!Array.isArray(finding?.dimensionRefs) || finding.dimensionRefs.length === 0) {
      errors.push(`${prefix}.dimensionRefs must be a non-empty array`);
    } else for (const ref of finding.dimensionRefs) {
      if (!dimensionIds.has(ref)) errors.push(`${prefix}.dimensionRefs contains unknown dimension id: ${ref}`);
    }
    if (finding.expectedArtifact !== undefined
      && (typeof finding.expectedArtifact !== "string" || !finding.expectedArtifact.trim())) {
      errors.push(`${prefix}.expectedArtifact must be a non-empty string when supplied`);
    }
    errors.push(...findingTargetErrors(finding?.target, {
      prefix: `${prefix}.target`,
    }));
    if (finding.expectedOutput !== undefined
      && (!Array.isArray(finding.expectedOutput)
        || finding.expectedOutput.length === 0
        || finding.expectedOutput.some((value) => typeof value !== "string" || !value.trim()))) {
      errors.push(`${prefix}.expectedOutput must contain concrete output strings when supplied`);
    }
    if (finding.kind !== undefined && !["evidence-gap", "missing-mechanism", "outcome-gap"].includes(finding.kind)) {
      errors.push(`${prefix} has invalid kind: ${finding.kind}`);
    }
    errors.push(...actualOutputErrors(finding, prefix));
    errors.push(...assignmentSummaryErrors(finding, summary.locale, prefix));
    errors.push(...postFixRepairReviewErrors(finding, summary, prefix));
    errors.push(...postFixScoreReviewErrors(finding, summary, prefix));
  }
  errors.push(...validateHarnessSuggestions(summary.suggestions, findingIds, summary.reportContractVersion));
  for (const dimension of rows(summary.dimensions)) {
    for (const ref of rows(dimension?.findingRefs)) {
      if (!findingIds.has(ref)) errors.push(`summary dimension ${dimension.id} findingRefs contains unknown finding id: ${ref}`);
    }
  }
  errors.push(...validateTaskLoopUsagePair(data));
  if (summary.usageActivity !== undefined && summary.usageEfficiency !== undefined) {
    errors.push(...validateTaskLoopFindings(data).filter((error) => /^summary\.usage(?:Activity|Efficiency)/u.test(error)));
  }
  errors.push(...readerFindingEligibilityErrors(data));
  errors.push(...hasRawField(data));
  return [...new Set(errors)];
}

export function validateTaskLoopCanvasSplit(findings, canvas) {
  const errors = [];
  if (!isObject(findings)) return ["findings.json must be an object"];
  errors.push(...unsupportedFields(findings, ["summary", "findings"], "findings.json"));
  const summary = findings.summary;
  if (!isObject(summary)) return [...errors, "findings.json summary must be an object"];
  const hostSummaryFields = taskLoopHostSummaryFields();
  errors.push(...unsupportedFields(summary, hostSummaryFields, "findings.json summary"));
  const requiredHostSummaryFields = ["projectName", "locale", "modelId", "reportContractVersion", "overview", "dimensions", "assignmentSummaries"];
  for (const field of requiredHostSummaryFields) {
    if (summary[field] === undefined || summary[field] === null || summary[field] === "") {
      errors.push(`findings.json summary missing ${field}`);
    }
  }
  if (typeof summary.modelId !== "string" || !summary.modelId.trim()) errors.push("findings.json summary.modelId must be non-empty metadata");
  if (!Number.isInteger(summary.reportContractVersion) || summary.reportContractVersion < 1) {
    errors.push("split findings.json summary.reportContractVersion must be positive integer metadata");
  }
  for (const [index, row] of rows(summary.dimensions).entries()) {
    errors.push(...unsupportedFields(row, [...TASK_LOOP_HOST_DIMENSION_FIELDS, ...LEGACY_TASK_LOOP_HOST_DIMENSION_FIELDS], `findings.json summary.dimensions[${index}]`));
    for (const field of ["id", "label", "score", "summary", "findingRefs"]) {
      if (row?.[field] === undefined || row?.[field] === null || row?.[field] === "") {
        errors.push(`findings.json summary.dimensions[${index}] missing ${field}`);
      }
    }
  }
  const hostFindingFields = taskLoopHostFindingFields();
  const requiredHostFindingFields = ["id", "title", "severity", "reason", "aiFixPrompt", "dimensionRefs"];
  for (const [index, row] of rows(findings.findings).entries()) {
    errors.push(...unsupportedFields(row, hostFindingFields, `findings.json findings[${index}]`));
    for (const field of requiredHostFindingFields) {
      if (row?.[field] === undefined || row?.[field] === null || row?.[field] === "") {
        errors.push(`findings.json findings[${index}] missing ${field}`);
      }
    }
  }
  errors.push(...validateHarnessSuggestions(
    summary.suggestions,
    rows(findings.findings).map((row) => row?.id).filter(Boolean),
    summary.reportContractVersion,
  ));
  if (!isObject(canvas)) return [...errors, "canvas.json must be an object for Agent Work Loop findings"];
  errors.push(...unsupportedFields(canvas, ["schemaVersion", "summary", "dimensions", "findings"], "canvas.json"));
  if (!Number.isInteger(canvas.schemaVersion) || canvas.schemaVersion < 1) {
    errors.push("canvas.json schemaVersion must be positive integer metadata");
  }
  if (!isObject(canvas.summary)) {
    errors.push("canvas.json summary must be an object");
  } else {
    errors.push(...unsupportedFields(canvas.summary, TASK_LOOP_CANVAS_SUMMARY_FIELDS, "canvas.json summary"));
    if (canvas.summary.contextUsage !== undefined) errors.push(...contextUsageErrors(canvas.summary.contextUsage));
    if (Object.hasOwn(canvas.summary, "strengths")) {
      errors.push("canvas.json summary must not duplicate host-owned strengths");
    }
  }
  for (const [index, row] of rows(canvas.dimensions).entries()) {
    errors.push(...unsupportedFields(row, TASK_LOOP_CANVAS_DIMENSION_FIELDS, `canvas.json dimensions[${index}]`));
  }
  for (const [index, row] of rows(canvas.findings).entries()) {
    errors.push(...unsupportedFields(row, TASK_LOOP_CANVAS_FINDING_FIELDS, `canvas.json findings[${index}]`));
  }
  splitRowsById(summary.dimensions, canvas.dimensions, "dimension", errors);
  splitRowsById(findings.findings, canvas.findings, "finding", errors);
  if (errors.length > 0) return errors;
  const merged = mergeTaskLoopCanvasData(findings, canvas);
  return isFullTaskLoopFindings(merged)
    ? [...validateTaskLoopFindings(merged), ...validateTaskLoopUsagePair(merged)]
    : validateCompactTaskLoopFindings(merged);
}

export function validateHarnessSuggestions(suggestions, findingIds = [], reportContractVersion) {
  if (suggestions === undefined) return [];
  if (!Array.isArray(suggestions)) return ["summary.suggestions must be an array when supplied"];

  const errors = [];
  if (!Number.isInteger(reportContractVersion)
    || reportContractVersion < TASK_LOOP_SUGGESTIONS_CONTRACT_VERSION) {
    errors.push(`summary.suggestions requires reportContractVersion ${TASK_LOOP_SUGGESTIONS_CONTRACT_VERSION} or newer`);
  }
  if (suggestions.length > 6) errors.push("summary.suggestions must contain at most six rows");
  const knownFindingIds = new Set([...findingIds].map((value) => String(value)));
  const seenIds = new Set();
  const allowedFields = [
    "id", "kind", "title", "reason", "confidence", "owner", "nextStep", "validation",
    "prerequisites", "blockedBy", "findingRefs",
  ];
  const requiredFields = ["id", "kind", "title", "reason", "confidence", "owner", "nextStep", "validation"];

  for (const [index, suggestion] of suggestions.entries()) {
    const prefix = `summary.suggestions[${index}]`;
    if (!isObject(suggestion)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    errors.push(...unsupportedFields(suggestion, allowedFields, prefix));
    for (const field of requiredFields) {
      if (typeof suggestion[field] !== "string" || suggestion[field].trim() === "") {
        errors.push(`${prefix} missing ${field}`);
      }
    }
    if (typeof suggestion.id === "string" && suggestion.id.trim()) {
      if (seenIds.has(suggestion.id)) errors.push(`${prefix} duplicates suggestion id: ${suggestion.id}`);
      seenIds.add(suggestion.id);
      if (PRIVATE_USAGE_SUMMARY_RE.test(suggestion.id)
        || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(suggestion.id)) {
        errors.push(`${prefix}.id must be a reader-safe lowercase slug`);
      }
    }
    if (!TASK_LOOP_SUGGESTION_KIND_SET.has(suggestion.kind)) {
      errors.push(`${prefix} has unsupported kind: ${suggestion.kind}`);
    }
    if (!TASK_LOOP_SUGGESTION_CONFIDENCE_SET.has(suggestion.confidence)) {
      errors.push(`${prefix} has invalid confidence: ${suggestion.confidence}`);
    }
    for (const field of ["title", "reason", "owner", "nextStep", "validation"]) {
      if (PRIVATE_USAGE_SUMMARY_RE.test(String(suggestion[field] ?? ""))) {
        errors.push(`${prefix}.${field} must not expose private paths, stable ids, or credential-shaped values`);
      }
    }
    for (const field of ["prerequisites", "blockedBy", "findingRefs"]) {
      const value = suggestion[field];
      if (value === undefined) continue;
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
        errors.push(`${prefix}.${field} must be an array of non-empty strings when supplied`);
        continue;
      }
      if (field !== "findingRefs" && value.some((item) => PRIVATE_USAGE_SUMMARY_RE.test(item))) {
        errors.push(`${prefix}.${field} must not expose private paths, stable ids, or credential-shaped values`);
      }
      if (field === "findingRefs") {
        for (const findingRef of value) {
          if (!knownFindingIds.has(findingRef)) {
            errors.push(`${prefix}.findingRefs contains unknown finding id: ${findingRef}`);
          }
        }
      }
    }
    if (suggestion.kind === "horizon"
      && rows(suggestion.prerequisites).length === 0
      && rows(suggestion.blockedBy).length === 0) {
      errors.push(`${prefix} horizon requires prerequisites or blockedBy`);
    }
  }
  return errors;
}

function unsupportedFields(value, allowed, location) {
  return Object.keys(value ?? {}).filter((field) => !allowed.includes(field)).map((field) => `${location} has unsupported field: ${field}`);
}

function safePracticePath(value) {
  const candidate = String(value ?? "").trim().replaceAll("\\", "/");
  return candidate.length > 0
    && candidate.length <= 240
    && !candidate.startsWith("/")
    && !/^[A-Za-z]:\//.test(candidate)
    && !candidate.split("/").includes("..");
}

function safePracticePathForSurface(surface, value) {
  if (!safePracticePath(value)) return false;
  const candidate = String(value ?? "").trim().replaceAll("\\", "/");
  if (candidate.startsWith("~/")) return false;
  if (String(surface ?? "") !== "Memories") return true;
  return /(?:^|\/)MEMORY\.md$/u.test(candidate);
}

function contextUsageErrors(usage) {
  if (!isObject(usage)) return ["summary.contextUsage must be an object when supplied"];
  const errors = [];
  const prefix = "summary.contextUsage";
  errors.push(...unsupportedFields(usage, [
    "schemaVersion", "status", "evidence", "capturedAt", "totalTokensUsed",
    "contextWindowSize", "percentFull", "categories", "items", "coverage", "actions",
  ], prefix));
  if (!Number.isInteger(usage.schemaVersion) || usage.schemaVersion < 1) {
    errors.push(`${prefix}.schemaVersion must be a positive integer`);
  }
  if (!new Set(["observed", "unobserved"]).has(usage.status)) {
    errors.push(`${prefix}.status must be observed or unobserved`);
  }
  if (!new Set(["cursor-native-context-usage-canvas", "cursor-native-composer-state"]).has(usage.evidence)) {
    errors.push(`${prefix}.evidence must identify supported Cursor native context state`);
  }
  if (!Array.isArray(usage.categories)) errors.push(`${prefix}.categories must be an array`);
  else for (const [index, category] of usage.categories.entries()) {
    const categoryPrefix = `${prefix}.categories[${index}]`;
    if (!isObject(category)) {
      errors.push(`${categoryPrefix} must be an object`);
      continue;
    }
    errors.push(...unsupportedFields(category, ["id", "label", "estimatedTokens"], categoryPrefix));
    if (typeof category.id !== "string" || !category.id.trim() || category.id.length > 80) errors.push(`${categoryPrefix}.id must be bounded text`);
    if (typeof category.label !== "string" || !category.label.trim() || category.label.length > 120) errors.push(`${categoryPrefix}.label must be bounded text`);
    if (!Number.isInteger(category.estimatedTokens) || category.estimatedTokens < 0) errors.push(`${categoryPrefix}.estimatedTokens must be non-negative`);
  }
  if (!Array.isArray(usage.items)) errors.push(`${prefix}.items must be an array`);
  else {
    if (usage.items.length > 200) errors.push(`${prefix}.items must contain at most 200 rows`);
    for (const [index, item] of usage.items.entries()) {
      const itemPrefix = `${prefix}.items[${index}]`;
      if (!isObject(item)) {
        errors.push(`${itemPrefix} must be an object`);
        continue;
      }
      errors.push(...unsupportedFields(item, ["id", "categoryId", "label", "estimatedTokens", "characterCount", "source"], itemPrefix));
      for (const field of ["id", "categoryId", "label"]) {
        if (typeof item[field] !== "string" || !item[field].trim()) errors.push(`${itemPrefix}.${field} must be non-empty text`);
      }
      for (const field of ["estimatedTokens", "characterCount"]) {
        if (!Number.isInteger(item[field]) || item[field] < 0) errors.push(`${itemPrefix}.${field} must be non-negative`);
      }
      if (item.source !== undefined) {
        if (!isObject(item.source)) errors.push(`${itemPrefix}.source must be an object`);
        else {
          errors.push(...unsupportedFields(item.source, ["kind", "path", "label"], `${itemPrefix}.source`));
          if (item.source.kind !== "file" || !path.isAbsolute(String(item.source.path ?? ""))) {
            errors.push(`${itemPrefix}.source must identify an absolute local file`);
          }
        }
      }
    }
  }
  if (!isObject(usage.coverage)) errors.push(`${prefix}.coverage must be an object`);
  else {
    errors.push(...unsupportedFields(usage.coverage, ["snapshotCount", "itemCount", "sourceItemCount", "truncated", "rawTextOmitted"], `${prefix}.coverage`));
    if (usage.coverage.rawTextOmitted !== true) errors.push(`${prefix}.coverage.rawTextOmitted must be true`);
  }
  if (!isObject(usage.actions)) errors.push(`${prefix}.actions must be an object`);
  else {
    errors.push(...unsupportedFields(usage.actions, ["openAgentId"], `${prefix}.actions`));
    if (usage.actions.openAgentId !== null
      && (typeof usage.actions.openAgentId !== "string" || !usage.actions.openAgentId.trim() || usage.actions.openAgentId.length > 120)) {
      errors.push(`${prefix}.actions.openAgentId must be null or bounded transport text`);
    }
  }
  if (usage.status === "observed") {
    if (!Number.isInteger(usage.totalTokensUsed) || usage.totalTokensUsed <= 0) errors.push(`${prefix}.totalTokensUsed must be positive when observed`);
    if (!Number.isInteger(usage.contextWindowSize) || usage.contextWindowSize <= 0) errors.push(`${prefix}.contextWindowSize must be positive when observed`);
    if (!Number.isInteger(usage.percentFull) || usage.percentFull < 0 || usage.percentFull > 100) errors.push(`${prefix}.percentFull must be 0-100 when observed`);
  } else if (usage.categories.length > 0 || usage.items.length > 0) {
    errors.push(`${prefix} unobserved snapshots must not contain category or item claims`);
  }
  return errors;
}

function aiAgentPracticeErrors(practice) {
  if (!isObject(practice)) return ["findings.json summary.aiAgentPractice must be an object"];
  const errors = [];
  errors.push(...unsupportedFields(practice, ["inspectedSurfaces", "coverageRows"], "findings.json summary.aiAgentPractice"));
  const inspected = rows(practice.inspectedSurfaces).map((surface) => String(surface ?? "").trim()).filter(Boolean);
  if (!Array.isArray(practice.inspectedSurfaces)) {
    errors.push("findings.json summary.aiAgentPractice.inspectedSurfaces must be an array");
  }
  for (const surface of inspected) {
    if (!AI_AGENT_PRACTICE_SURFACE_SET.has(surface)) {
      errors.push(`findings.json summary.aiAgentPractice inspectedSurfaces contains unsupported surface: ${surface}`);
    }
  }
  if (!Array.isArray(practice.coverageRows) || practice.coverageRows.length === 0) {
    errors.push("findings.json summary.aiAgentPractice.coverageRows must be a non-empty array");
  }
  for (const [index, row] of rows(practice.coverageRows).entries()) {
    const prefix = `summary.aiAgentPractice.coverageRows[${index}]`;
    if (!isObject(row)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    errors.push(...unsupportedFields(row, ["surface", "scopes", "count", "paths"], prefix));
    for (const field of ["surface"]) {
      if (row[field] === undefined || row[field] === null || row[field] === "") errors.push(`${prefix} missing ${field}`);
    }
    if (row.surface && !AI_AGENT_PRACTICE_SURFACE_SET.has(String(row.surface))) {
      errors.push(`${prefix} has unsupported surface: ${row.surface}`);
    }
    if (row.count !== undefined && (!Number.isInteger(Number(row.count)) || Number(row.count) < 0)) {
      errors.push(`${prefix}.count must be a non-negative integer`);
    }
    if (row.scopes !== undefined && (
      !Array.isArray(row.scopes) ||
      row.scopes.length === 0 ||
      row.scopes.some((scope) => !AI_AGENT_PRACTICE_SCOPE_SET.has(String(scope)))
    )) {
      errors.push(`${prefix}.scopes must contain Project, Global, or Plugin`);
    }
    if (row.paths !== undefined) {
      if (!Array.isArray(row.paths) || row.paths.length > 12 || row.paths.some((item) => !safePracticePathForSurface(row.surface, item))) {
        errors.push(`${prefix}.paths must contain at most 12 project-relative paths${row.surface === "Memories" ? "; Memory rows may link only to project-relative MEMORY.md" : ""}`);
      } else if (row.count !== undefined && Number(row.count) < row.paths.length) {
        errors.push(`${prefix}.count must be at least the number of listed paths`);
      }
    }
  }
  return errors;
}

function actualOutputPathErrors(output, prefix) {
  const pathValue = output?.path;
  if (pathValue === undefined) {
    return output?.action === "deleted" ? [] : [`${prefix}.path is required for created or updated output`];
  }
  if (typeof pathValue !== "string" || pathValue.trim() === "") return [`${prefix}.path must be a non-empty string when supplied`];
  const candidate = pathValue.trim();
  const errors = [];
  if (candidate !== pathValue || candidate.includes("\\") || candidate.length > 240) {
    errors.push(`${prefix}.path must be a slash-normalized path within 240 characters`);
  }
  if (candidate.split("/").includes("..") || candidate.startsWith("/") || /^[A-Za-z]:\//u.test(candidate)) {
    errors.push(`${prefix}.path must not be absolute or traverse outside its scope`);
  }
  if (output?.scope === "Global") {
    if (!candidate.startsWith("~/") || candidate.length <= 2) errors.push(`${prefix}.path must use ~/ for Global output`);
  } else if (output?.scope === "Project" && candidate.startsWith("~/")) {
    errors.push(`${prefix}.path must be project-relative for Project output`);
  }
  if (output?.artifact === "Skill" && output?.action !== "deleted" && !/(?:^|\/)SKILL\.md$/u.test(candidate)) {
    errors.push(`${prefix}.path must point to SKILL.md for created or updated Skill output`);
  }
  if (/(?:^|\/)SKILL\.md$/u.test(candidate) && output?.artifact !== "Skill") {
    errors.push(`${prefix}.artifact must be Skill when path points to SKILL.md`);
  }
  return errors;
}

function actualOutputErrors(finding, prefix) {
  const hasRevision = Object.hasOwn(finding ?? {}, "actualOutputRevision");
  const hasOutput = Object.hasOwn(finding ?? {}, "actualOutput");
  const hasSummary = Object.hasOwn(finding ?? {}, "assignmentSummary");
  if (!hasRevision && !hasOutput && !hasSummary) return [];
  const errors = [];
  if (!hasRevision || !hasOutput || !hasSummary) {
    errors.push(`${prefix}.actualOutputRevision, actualOutput, and assignmentSummary must be supplied together`);
    return errors;
  }
  if (!Number.isInteger(finding.actualOutputRevision) || finding.actualOutputRevision < 1) {
    errors.push(`${prefix}.actualOutputRevision must be a positive integer`);
  }
  if (!Array.isArray(finding.actualOutput) || finding.actualOutput.length < 1 || finding.actualOutput.length > 12) {
    errors.push(`${prefix}.actualOutput must contain one to twelve output items`);
    return errors;
  }
  for (const [index, output] of finding.actualOutput.entries()) {
    const outputPrefix = `${prefix}.actualOutput[${index}]`;
    if (!isObject(output)) {
      errors.push(`${outputPrefix} must be an object`);
      continue;
    }
    errors.push(...unsupportedFields(output, ["action", "artifact", "name", "scope", "path", "summary"], outputPrefix));
    if (!["created", "updated", "deleted"].includes(output.action)) {
      errors.push(`${outputPrefix}.action must be created, updated, or deleted`);
    }
    if (!EXPECTED_ARTIFACT_SET.has(output.artifact)) {
      errors.push(`${outputPrefix}.artifact must be one of: ${EXPECTED_ARTIFACTS.join(", ")}`);
    }
    if (!["Project", "Global"].includes(output.scope)) {
      errors.push(`${outputPrefix}.scope must be Project or Global`);
    }
    if (typeof output.name !== "string" || output.name.trim() === "" || output.name !== output.name.trim()
      || /[\r\n]/u.test(output.name) || [...output.name].length > 120) {
      errors.push(`${outputPrefix}.name must be one trimmed reader-facing line within 120 characters`);
    }
    if (typeof output.summary !== "string" || output.summary.trim() === "" || output.summary !== output.summary.trim()
      || /[\r\n]/u.test(output.summary) || [...output.summary].length > 280) {
      errors.push(`${outputPrefix}.summary must be one trimmed reader-facing line within 280 characters`);
    } else if (/(?:`\/|\s\/(?:Users|home|var|tmp|private)\/|[A-Za-z]:[\\/])/u.test(output.summary)) {
      errors.push(`${outputPrefix}.summary must not expose an absolute private path`);
    }
    errors.push(...actualOutputPathErrors(output, outputPrefix));
  }
  return errors;
}

function assignmentSummaryErrors(finding, reportLocale, prefix) {
  if (!Object.hasOwn(finding ?? {}, "assignmentSummary")) return [];
  const summary = finding.assignmentSummary;
  const summaryPrefix = `${prefix}.assignmentSummary`;
  if (!isObject(summary)) return [`${summaryPrefix} must be an object`];
  const errors = unsupportedFields(summary, ["locale", "title", "body"], summaryPrefix);
  for (const field of ["locale", "title", "body"]) {
    if (summary[field] === undefined || summary[field] === null || summary[field] === "") {
      errors.push(`${summaryPrefix} missing ${field}`);
    }
  }
  if (summary.locale !== reportLocale) {
    errors.push(`${summaryPrefix}.locale must exactly match findings.json summary.locale`);
  }
  const titleLimit = reportLocale === "zh-CN" ? 64 : 120;
  if (typeof summary.title !== "string" || summary.title.trim() === "" || summary.title !== summary.title.trim()
    || /[\r\n]/u.test(summary.title) || [...summary.title].length > titleLimit) {
    errors.push(`${summaryPrefix}.title must be one trimmed reader-facing line within ${titleLimit} characters`);
  }
  const bodyLimit = reportLocale === "zh-CN" ? 280 : 560;
  if (typeof summary.body !== "string" || summary.body.trim() === "" || summary.body !== summary.body.trim()
    || /[\r\n]/u.test(summary.body) || [...summary.body].length > bodyLimit) {
    errors.push(`${summaryPrefix}.body must be one trimmed reader-facing line within ${bodyLimit} characters`);
  }
  for (const [field, value] of [["title", summary.title], ["body", summary.body]]) {
    if (typeof value !== "string") continue;
    if (reportLocale === "zh-CN" && !/[\u3400-\u9fff]/u.test(value)) {
      errors.push(`${summaryPrefix}.${field} must use natural Chinese for zh-CN`);
    }
    if (reportLocale === "en" && !/[A-Za-z]{2}/u.test(value)) {
      errors.push(`${summaryPrefix}.${field} must use engineering English for en`);
    }
  }
  for (const [field, value] of [["title", summary.title], ["body", summary.body]]) {
    if (typeof value === "string" && /(?:`\/|\s\/(?:Users|home|var|tmp|private)\/|[A-Za-z]:[\\/])/u.test(value)) {
      errors.push(`${summaryPrefix}.${field} must not expose an absolute private path`);
    }
  }
  return errors;
}

function postFixScoreEvidenceErrors(value, prefix) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) {
    return [`${prefix} must contain one to eight bounded evidence references`];
  }
  const errors = [];
  const allowedFields = ["kind", "id", "type", "line", "label", "adapter", "code", "status"];
  for (const [index, reference] of value.entries()) {
    const referencePrefix = `${prefix}[${index}]`;
    if (!isObject(reference)) {
      errors.push(`${referencePrefix} must be an object`);
      continue;
    }
    errors.push(...unsupportedFields(reference, allowedFields, referencePrefix));
    if (!["kind", "id"].some((field) => typeof reference[field] === "string" && reference[field].trim())) {
      errors.push(`${referencePrefix} must identify its kind or id`);
    }
    if (reference.line !== undefined && (!Number.isInteger(reference.line) || reference.line < 1)) {
      errors.push(`${referencePrefix}.line must be a positive integer when supplied`);
    }
    if (PRIVATE_USAGE_SUMMARY_RE.test(JSON.stringify(reference))) {
      errors.push(`${referencePrefix} must not expose private paths, stable ids, or credential-shaped values`);
    }
  }
  return errors;
}

function postFixScoreReviewErrors(finding, summary, prefix) {
  if (!Object.hasOwn(finding ?? {}, "postFixScoreReview")) return [];
  const review = finding.postFixScoreReview;
  const reviewPrefix = `${prefix}.postFixScoreReview`;
  if (!isObject(review)) return [`${reviewPrefix} must be an object`];
  const errors = unsupportedFields(review, ["modelId", "dimensions"], reviewPrefix);
  if (review.modelId !== summary?.modelId) {
    errors.push(`${reviewPrefix}.modelId must exactly match findings.json summary.modelId`);
  }
  if (!Array.isArray(review.dimensions) || review.dimensions.length < 1) {
    errors.push(`${reviewPrefix}.dimensions must be a non-empty array`);
    return errors;
  }
  const expectedIds = [...new Set(rows(finding.dimensionRefs).map(String))];
  const reviewIds = new Set();
  const dimensionsById = new Map(rows(summary?.dimensions).map((dimension) => [dimension?.id, dimension]));
  for (const [index, row] of review.dimensions.entries()) {
    const rowPrefix = `${reviewPrefix}.dimensions[${index}]`;
    if (!isObject(row)) {
      errors.push(`${rowPrefix} must be an object`);
      continue;
    }
    errors.push(...unsupportedFields(row, [
      "id", "previousScore", "score", "summary", "reason", "confidence", "evidenceRefs",
    ], rowPrefix));
    const id = String(row.id ?? "");
    if (!id) errors.push(`${rowPrefix}.id must be a non-empty string`);
    else if (reviewIds.has(id)) errors.push(`${rowPrefix}.id duplicates post-fix dimension: ${id}`);
    reviewIds.add(id);
    if (!expectedIds.includes(id)) errors.push(`${rowPrefix}.id is not linked from the repaired finding: ${id}`);
    if (!Number.isInteger(row.previousScore) || row.previousScore < 0 || row.previousScore > 100) {
      errors.push(`${rowPrefix}.previousScore must be an integer from 0 to 100`);
    }
    const minimumScore = id === "learning-capture" ? LEARNING_CAPTURE_REVIEWED_SCORE_FLOOR : 0;
    if (!Number.isInteger(row.score) || row.score < minimumScore || row.score > 100) {
      errors.push(`${rowPrefix}.score must be an integer from ${minimumScore} to 100`);
    }
    if (!SCORE_CONFIDENCE.has(row.confidence)) {
      errors.push(`${rowPrefix}.confidence must be low, medium, or high`);
    }
    if (typeof row.reason !== "string" || row.reason.trim().length < 24 || /[\r\n]/u.test(row.reason)) {
      errors.push(`${rowPrefix}.reason must be one line that explains the AI judgment`);
    }
    const reasonLimit = summary?.locale === "zh-CN" ? 280 : 560;
    if (typeof row.reason === "string" && [...row.reason].length > reasonLimit) {
      errors.push(`${rowPrefix}.reason must stay within ${reasonLimit} characters`);
    }
    if (summary?.locale === "zh-CN" && typeof row.reason === "string" && !/[\u3400-\u9fff]/u.test(row.reason)) {
      errors.push(`${rowPrefix}.reason must use natural Chinese for zh-CN`);
    }
    if (summary?.locale === "en" && typeof row.reason === "string" && !/[A-Za-z]{2}/u.test(row.reason)) {
      errors.push(`${rowPrefix}.reason must use engineering English for en`);
    }
    if (typeof row.reason === "string" && PRIVATE_USAGE_SUMMARY_RE.test(row.reason)) {
      errors.push(`${rowPrefix}.reason must not expose private paths, stable ids, or credential-shaped values`);
    }
    const dimension = dimensionsById.get(id);
    errors.push(...dimensionReaderSummaryErrors(
      row.summary,
      dimension?.label,
      summary?.locale,
      `${rowPrefix}.summary`,
    ));
    errors.push(...postFixScoreEvidenceErrors(row.evidenceRefs, `${rowPrefix}.evidenceRefs`));
  }
  for (const id of expectedIds) {
    if (!reviewIds.has(id)) errors.push(`${reviewPrefix}.dimensions missing linked dimension: ${id}`);
  }
  if (reviewIds.size !== expectedIds.length) {
    errors.push(`${reviewPrefix}.dimensions must contain every and only the repaired finding's linked dimensions`);
  }
  if (!Object.hasOwn(finding, "actualOutputRevision")
    || !Object.hasOwn(finding, "actualOutput")
    || !Object.hasOwn(finding, "assignmentSummary")) {
    errors.push(`${reviewPrefix} requires actualOutputRevision, actualOutput, and assignmentSummary`);
  }
  return errors;
}

function postFixRepairReviewErrors(finding, summary, prefix) {
  if (!Object.hasOwn(finding ?? {}, "postFixRepairReview")) return [];
  const review = finding.postFixRepairReview;
  const reviewPrefix = `${prefix}.postFixRepairReview`;
  if (!isObject(review)) return [`${reviewPrefix} must be an object`];
  const errors = unsupportedFields(review, [
    "modelId", "findingId", "status", "summary", "reason", "confidence", "evidenceRefs",
  ], reviewPrefix);
  if (review.modelId !== summary?.modelId) {
    errors.push(`${reviewPrefix}.modelId must exactly match findings.json summary.modelId`);
  }
  if (review.findingId !== finding?.id) {
    errors.push(`${reviewPrefix}.findingId must exactly match the repaired finding id`);
  }
  if (!["verified", "partial", "blocked"].includes(review.status)) {
    errors.push(`${reviewPrefix}.status must be verified, partial, or blocked`);
  }
  if (!SCORE_CONFIDENCE.has(review.confidence)) {
    errors.push(`${reviewPrefix}.confidence must be low, medium, or high`);
  }
  if (typeof review.summary !== "string" || !review.summary.trim() || /[\r\n]/u.test(review.summary)) {
    errors.push(`${reviewPrefix}.summary must be one non-empty line`);
  }
  if (typeof review.reason !== "string" || review.reason.trim().length < 24 || /[\r\n]/u.test(review.reason)) {
    errors.push(`${reviewPrefix}.reason must be one line that explains the independent judgment`);
  }
  if (PRIVATE_USAGE_SUMMARY_RE.test(`${review.summary ?? ""} ${review.reason ?? ""}`)) {
    errors.push(`${reviewPrefix} must not expose private paths, stable ids, or credential-shaped values`);
  }
  errors.push(...postFixScoreEvidenceErrors(review.evidenceRefs, `${reviewPrefix}.evidenceRefs`));
  const evidenceKinds = new Set(rows(review.evidenceRefs).map((reference) => reference?.kind));
  if (!evidenceKinds.has("fix-validation")) {
    errors.push(`${reviewPrefix}.evidenceRefs must include fix-validation evidence`);
  }
  if (!evidenceKinds.has("asset-integrity")) {
    errors.push(`${reviewPrefix}.evidenceRefs must include the refreshed asset-integrity result or unavailable marker`);
  }
  if (!Object.hasOwn(finding, "actualOutputRevision")
    || !Object.hasOwn(finding, "actualOutput")
    || !Object.hasOwn(finding, "assignmentSummary")) {
    errors.push(`${reviewPrefix} requires actualOutputRevision, actualOutput, and assignmentSummary`);
  }
  return errors;
}

export function validateTaskLoopFindings(data) {
  const errors = [];
  if (!isObject(data)) return ["findings.json must be an object"];
  errors.push(...unsupportedFields(data, ["summary", "findings"], "findings.json"));
  const summary = data.summary;
  if (!isObject(summary)) return [...errors, "findings.json summary must be an object"];
  const summaryFields = ["projectName", "locale", "modelId", "reportContractVersion", "strengths", "atAGlance", "evidenceBoundary", "dimensions", "aiAgentPractice", "semanticFacets", "learningCapture"];
  errors.push(...unsupportedFields(summary, [...summaryFields, "overview", "evidenceMode", "usageActivity", "usageEfficiency", "contextUsage", "suggestions", "assignmentSummaries"], "findings.json summary"));
  for (const field of summaryFields) {
    if (summary[field] === undefined || summary[field] === null || summary[field] === "") errors.push(`findings.json summary missing ${field}`);
  }
  if (!Array.isArray(summary.assignmentSummaries)) {
    errors.push("findings.json summary.assignmentSummaries must be an array");
  }
  const declaredFindingIds = new Set(rows(data.findings).map((finding) => String(finding?.id ?? "")).filter(Boolean));
  errors.push(...validateHarnessSuggestions(summary.suggestions, declaredFindingIds, summary.reportContractVersion));
  errors.push(...aiAgentPracticeErrors(summary.aiAgentPractice));
  if (!new Set(["session-rich", "session-limited"]).has(summary.evidenceMode)) {
    errors.push("findings.json summary.evidenceMode must be session-rich or session-limited");
  }
  if (typeof summary.modelId !== "string" || !summary.modelId.trim()) errors.push("findings.json summary.modelId must be non-empty metadata");
  const validationDimensions = AGENT_WORK_LOOP_DIMENSIONS;
  const validationDimensionIds = validationDimensions.map((dimension) => dimension.id);
  const validationDimensionById = new Map(validationDimensions.map((dimension) => [dimension.id, dimension]));
  if (!new Set(["en", "zh-CN"]).has(summary.locale)) errors.push("findings.json summary.locale must be en or zh-CN");
  if (summary.overview === undefined) errors.push("findings.json summary.overview is required");
  else errors.push(...readerOverviewTextErrors(summary.overview, summary.locale, "findings.json summary.overview"));
  if (!Number.isInteger(summary.reportContractVersion) || summary.reportContractVersion < 1) {
    errors.push("findings.json summary.reportContractVersion must be positive integer metadata");
  }
  if (summary.usageActivity !== undefined) {
    const activity = summary.usageActivity;
    if (!isObject(activity)) errors.push("summary.usageActivity must be an object when supplied");
    else {
      errors.push(...unsupportedFields(activity, ["schemaVersion", "dateBasis", "measurementBasis", "truncated", "dates", "sessions", "models", "skills", "mcps", "tokens"], "summary.usageActivity"));
      if (activity.schemaVersion !== undefined && (!Number.isInteger(activity.schemaVersion) || activity.schemaVersion < 1)) {
        errors.push("summary.usageActivity.schemaVersion must be positive integer metadata when supplied");
      }
      if (activity.dateBasis !== "UTC") errors.push("summary.usageActivity.dateBasis must be UTC");
      if (!Array.isArray(activity.dates) || activity.dates.length === 0 || activity.dates.length > 366
        || activity.dates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(String(date)))) {
        errors.push("summary.usageActivity.dates must contain 1-366 ISO dates");
      }
      const length = Array.isArray(activity.dates) ? activity.dates.length : 0;
      if (!isObject(activity.sessions)
        || !Number.isInteger(activity.sessions.total)
        || activity.sessions.total < 0
        || !Array.isArray(activity.sessions.starts)
        || !Array.isArray(activity.sessions.activeMinutes)
        || activity.sessions.starts.length !== length
        || activity.sessions.activeMinutes.length !== length) {
        errors.push("summary.usageActivity.sessions must align totals, starts, and activeMinutes to dates");
      }
      const seriesFields = [
        "models",
        "skills",
        ...(activity.mcps !== undefined || activity.schemaVersion >= 4 ? ["mcps"] : []),
      ];
      for (const field of seriesFields) {
        if (!Array.isArray(activity[field])) errors.push(`summary.usageActivity.${field} must be an array`);
        else for (const [index, series] of activity[field].entries()) {
          const prefix = `summary.usageActivity.${field}[${index}]`;
          if (!isObject(series) || typeof series.name !== "string" || !series.name.trim() || series.name.length > 80
            || !Number.isInteger(series.total) || series.total < 0
            || !Array.isArray(series.daily) || series.daily.length !== length
            || series.daily.some((value) => !Number.isInteger(value) || value < 0)) {
            errors.push(`${prefix} must contain a bounded name, non-negative total, and date-aligned daily counts`);
          }
        }
      }
      if (activity.tokens !== undefined) {
        const tokenFields = ["inputTokens", "outputTokens", "cacheReadInputTokens", "cacheCreationInputTokens"];
        const tokens = activity.tokens;
        if (!isObject(tokens)
          || !Number.isInteger(tokens.observedResponseCount)
          || tokens.observedResponseCount < 1
          || !isObject(tokens.totals)
          || !isObject(tokens.daily)) {
          errors.push("summary.usageActivity.tokens must describe observed responses, totals, and date-aligned daily values");
        } else {
          errors.push(...unsupportedFields(tokens, ["observedResponseCount", "totals", "daily"], "summary.usageActivity.tokens"));
          errors.push(...unsupportedFields(tokens.totals, tokenFields, "summary.usageActivity.tokens.totals"));
          errors.push(...unsupportedFields(tokens.daily, tokenFields, "summary.usageActivity.tokens.daily"));
          for (const field of tokenFields) {
            const total = tokens.totals[field];
            const daily = tokens.daily[field];
            if (!Number.isInteger(total) || total < 0
              || !Array.isArray(daily)
              || daily.length !== length
              || daily.some((value) => !Number.isInteger(value) || value < 0)
              || daily.reduce((sum, value) => sum + value, 0) !== total) {
              errors.push(`summary.usageActivity.tokens.${field} must contain a non-negative total equal to its date-aligned daily values`);
            }
          }
        }
      }
    }
  }
  if (summary.usageEfficiency !== undefined) {
    const usage = summary.usageEfficiency;
    if (!isObject(usage)) errors.push("summary.usageEfficiency must be an object when supplied");
    else {
      const activeLongCount = Number(usage.longSessions?.activeCount ?? 0);
      const reviewedActiveLongCount = Number(usage.outcomeReview?.reviewedActiveLongCount ?? 0);
      const unreviewedActiveLongCount = Math.max(0, activeLongCount - reviewedActiveLongCount);
      errors.push(...unsupportedFields(usage, ["schemaVersion", "selection", "roles", "longSessions", "accounting", "modelUsage", "outcomeReview", "tokenTotals", "actualCost", "reviewLead"], "summary.usageEfficiency"));
      if (usage.schemaVersion !== undefined && (!Number.isInteger(usage.schemaVersion) || usage.schemaVersion < 1)) {
        errors.push("summary.usageEfficiency.schemaVersion must be positive integer metadata when supplied");
      }
      if (!isObject(usage.selection)
        || usage.selection.strategy !== "all-eligible"
        || !Number.isInteger(usage.selection.eligibleSessionCount)
        || !Number.isInteger(usage.selection.analyzedSessionCount)
        || typeof usage.selection.complete !== "boolean"
        || usage.selection.analyzedSessionCount > usage.selection.eligibleSessionCount) {
        errors.push("summary.usageEfficiency.selection must describe a bounded all-eligible census");
      }
      if (!isObject(usage.longSessions)
        || !Number.isInteger(usage.longSessions.activeCount)
        || !Number.isInteger(usage.longSessions.wallOnlyCount)
        || !Number.isFinite(usage.longSessions.longestActiveMinutes)
        || usage.longSessions.activeCount < 0
        || usage.longSessions.wallOnlyCount < 0
        || usage.longSessions.longestActiveMinutes < 0) {
        errors.push("summary.usageEfficiency.longSessions must contain non-negative active, wall-only, and duration facts");
      }
      if (isObject(usage.longSessions)) {
        const supportsLongSessionReview = Object.hasOwn(usage.longSessions, "activeRatio")
          || Object.hasOwn(usage.longSessions, "estimate")
          || Object.hasOwn(usage.longSessions, "samples")
          || Object.hasOwn(usage.outcomeReview ?? {}, "reviewedActiveLongCount")
          || Object.hasOwn(usage, "reviewLead");
        errors.push(...unsupportedFields(
          usage.longSessions,
          ["activeCount", "wallOnlyCount", "longestActiveMinutes", "activeRatio", "estimate", "samples"],
          "summary.usageEfficiency.longSessions",
        ));
        if (supportsLongSessionReview) {
          if (!Number.isFinite(usage.longSessions.activeRatio)
            || usage.longSessions.activeRatio < 0
            || usage.longSessions.activeRatio > 1) {
            errors.push("summary.usageEfficiency.longSessions.activeRatio must be between 0 and 1 when long-session review is supplied");
          }
          const estimate = usage.longSessions.estimate;
          if (!isObject(estimate)) {
            errors.push("summary.usageEfficiency.longSessions.estimate must describe the supplied active-time estimate");
          } else {
            errors.push(...unsupportedFields(
              estimate,
              ["method", "activeThresholdMinutes", "gapCapMinutes", "idleGapMinutes"],
              "summary.usageEfficiency.longSessions.estimate",
            ));
            if (estimate.method !== "capped-event-gap"
              || !Number.isFinite(estimate.activeThresholdMinutes)
              || !Number.isFinite(estimate.gapCapMinutes)
              || !Number.isFinite(estimate.idleGapMinutes)
              || estimate.activeThresholdMinutes <= 0
              || estimate.gapCapMinutes <= 0
              || estimate.idleGapMinutes <= 0) {
              errors.push("summary.usageEfficiency.longSessions.estimate must preserve positive capped-event-gap parameters");
            }
          }
        }
        const samples = usage.longSessions.samples;
        if (supportsLongSessionReview
          && (!Array.isArray(samples) || samples.length !== Math.min(4, unreviewedActiveLongCount))) {
          errors.push("summary.usageEfficiency.longSessions.samples must identify bounded active-long review candidates");
        }
        if (samples !== undefined && !Array.isArray(samples)) {
          errors.push("summary.usageEfficiency.longSessions.samples must be an array when supplied");
        } else if (Array.isArray(samples)) {
          if (samples.length > 4 || samples.length > unreviewedActiveLongCount) {
            errors.push("summary.usageEfficiency.longSessions.samples must stay within four rows and the unreviewed active-long population");
          }
          for (const [index, sample] of samples.entries()) {
            const prefix = `summary.usageEfficiency.longSessions.samples[${index}]`;
            if (!isObject(sample)) {
              errors.push(`${prefix} must be an object`);
              continue;
            }
            errors.push(...unsupportedFields(sample, ["alias", "role", "activeMinutes", "failureCount", "sessionId", "userRequest", "toolTrace"], prefix));
            if (sample.alias !== `S${index + 1}`) errors.push(`${prefix}.alias must be the deterministic S${index + 1} alias`);
            if (!new Set(["user-thread-candidate", "child-agent-candidate", "unknown-candidate"]).has(sample.role)) {
              errors.push(`${prefix}.role must be a bounded candidate role`);
            }
            if (!Number.isFinite(sample.activeMinutes) || sample.activeMinutes < 0) errors.push(`${prefix}.activeMinutes must be non-negative`);
            if (!Number.isInteger(sample.failureCount) || sample.failureCount < 0) errors.push(`${prefix}.failureCount must be a non-negative integer`);
            if (sample.sessionId !== undefined
              && (typeof sample.sessionId !== "string"
                || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(sample.sessionId))) {
              errors.push(`${prefix}.sessionId must be a bounded Canvas session locator`);
            }
            if (sample.userRequest !== undefined
              && (typeof sample.userRequest !== "string"
                || !sample.userRequest.trim()
                || [...sample.userRequest].length > 161
                || PRIVATE_USAGE_SUMMARY_RE.test(sample.userRequest))) {
              errors.push(`${prefix}.userRequest must be a bounded privacy-safe user request`);
            }
            const trace = sample.toolTrace;
            const traceVersion = trace?.schemaVersion;
            if (trace !== undefined && (!isObject(trace)
              || !new Set([1, 2]).has(traceVersion)
              || !Number.isInteger(trace.totalCalls)
              || !Number.isInteger(trace.shownCalls)
              || trace.totalCalls < 0
              || trace.shownCalls < 0
              || trace.shownCalls > trace.totalCalls
              || typeof trace.truncated !== "boolean"
              || trace.truncated !== (trace.shownCalls < trace.totalCalls)
              || !Array.isArray(trace.calls)
              || trace.calls.length !== trace.shownCalls)) {
              errors.push(`${prefix}.toolTrace must contain a complete or explicitly limited v1 or v2 tool-call trace`);
            } else if (isObject(trace)) {
              errors.push(...unsupportedFields(trace, ["schemaVersion", "totalCalls", "shownCalls", "truncated", "calls"], `${prefix}.toolTrace`));
              let previousStep = 0;
              const toolNames = new Set();
              for (const [callIndex, call] of trace.calls.entries()) {
                const callPrefix = `${prefix}.toolTrace.calls[${callIndex}]`;
                if (!isObject(call)) {
                  errors.push(`${callPrefix} must be an object`);
                  continue;
                }
                const callFields = traceVersion === 2
                  ? ["id", "step", "toolName", "status", "durationStatus", "durationMs", "timingSource"]
                  : ["id", "step", "toolName", "status"];
                errors.push(...unsupportedFields(call, callFields, callPrefix));
                if (!Number.isInteger(call.step) || call.step <= previousStep || call.step > trace.totalCalls) {
                  errors.push(`${callPrefix}.step must be strictly increasing within the observed call count`);
                }
                previousStep = Number.isInteger(call.step) ? call.step : previousStep;
                if (call.id !== `T${call.step}`) errors.push(`${callPrefix}.id must match its deterministic tool-call step`);
                if (typeof call.toolName !== "string"
                  || !call.toolName.trim()
                  || call.toolName.length > 64
                  || !/^[\p{L}\p{N}_.: -]+$/u.test(call.toolName)) {
                  errors.push(`${callPrefix}.toolName must be a bounded privacy-safe label`);
                }
                toolNames.add(call.toolName);
                if (!new Set(["observed", "failed"]).has(call.status)) {
                  errors.push(`${callPrefix}.status must be observed or failed`);
                }
                if (traceVersion === 2) {
                  if (!new Set(["observed", "unobserved"]).has(call.durationStatus)) {
                    errors.push(`${callPrefix}.durationStatus must be observed or unobserved`);
                  } else if (call.durationStatus === "observed") {
                    if (!Number.isInteger(call.durationMs)
                      || call.durationMs < 0
                      || call.durationMs > 24 * 60 * 60 * 1000) {
                      errors.push(`${callPrefix}.durationMs must be a bounded non-negative integer when observed`);
                    }
                    if (!new Set(["transcript-pair", "lifecycle-pair"]).has(call.timingSource)) {
                      errors.push(`${callPrefix}.timingSource must identify a supported observed lifecycle pair`);
                    }
                  } else if (Object.hasOwn(call, "durationMs") || Object.hasOwn(call, "timingSource")) {
                    errors.push(`${callPrefix} must omit timing values when duration is unobserved`);
                  }
                }
              }
              if (toolNames.size > 8) errors.push(`${prefix}.toolTrace must stay within eight tool lanes`);
            }
          }
        }
      }
      if (!isObject(usage.accounting)
        || !new Set(["exact", "host-estimated", "effort-proxy"]).has(usage.accounting.mode)
        || !Number.isInteger(usage.accounting.responseCount)
        || !Number.isInteger(usage.accounting.modelAttributedResponseCount)
        || !Number.isInteger(usage.accounting.unattributedResponseCount)
        || usage.accounting.responseCount < 0
        || usage.accounting.modelAttributedResponseCount < 0
        || usage.accounting.unattributedResponseCount < 0
        || usage.accounting.modelAttributedResponseCount + usage.accounting.unattributedResponseCount !== usage.accounting.responseCount
        || !Number.isInteger(usage.accounting.usageFieldObservedCount)
        || !Number.isInteger(usage.accounting.nonZeroUsageCount)
        || typeof usage.accounting.exactCreditsAvailable !== "boolean") {
        errors.push("summary.usageEfficiency.accounting must preserve response coverage and accounting mode");
      }
      if (!Array.isArray(usage.modelUsage)
        || usage.modelUsage.length > 8
        || usage.modelUsage.some((row) => !isObject(row)
          || typeof row.model !== "string"
          || !row.model.trim()
          || !Number.isInteger(row.responseCount)
          || !Number.isInteger(row.usageFieldObservedCount)
          || !Number.isInteger(row.nonZeroUsageCount))) {
        errors.push("summary.usageEfficiency.modelUsage must contain at most eight bounded response rows");
      }
      if (!isObject(usage.outcomeReview)
        || typeof usage.outcomeReview.status !== "string"
        || !Number.isInteger(usage.outcomeReview.reviewedCandidateCount)
        || (Object.hasOwn(usage.outcomeReview ?? {}, "reviewedActiveLongCount") && !Number.isInteger(usage.outcomeReview.reviewedActiveLongCount))
        || typeof usage.outcomeReview.comparableModelOutcomeEvidence !== "boolean"
        || !new Set(["controlled-a-b-required", "reviewed-comparison-available"]).has(usage.outcomeReview.recommendation)) {
        errors.push("summary.usageEfficiency.outcomeReview must preserve the model-result evidence boundary");
      }
      const supportsLongSessionReview = Object.hasOwn(usage.longSessions ?? {}, "samples")
        || Object.hasOwn(usage.outcomeReview ?? {}, "reviewedActiveLongCount")
        || Object.hasOwn(usage, "reviewLead");
      if (supportsLongSessionReview && isObject(usage.outcomeReview)) {
        errors.push(...unsupportedFields(
          usage.outcomeReview,
          ["status", "reviewedCandidateCount", "reviewedActiveLongCount", "comparableModelOutcomeEvidence", "recommendation"],
          "summary.usageEfficiency.outcomeReview",
        ));
        const shouldHaveReviewLead = usage.selection?.complete === true
          && unreviewedActiveLongCount > 0;
        if (shouldHaveReviewLead && !isObject(usage.reviewLead)) {
          errors.push("summary.usageEfficiency.reviewLead is required for unreviewed long-session candidates");
        } else if (!shouldHaveReviewLead && usage.reviewLead !== undefined) {
          errors.push("summary.usageEfficiency.reviewLead must be omitted when the census is incomplete or all long-session candidates are reviewed");
        }
        if (isObject(usage.reviewLead)) {
          const lead = usage.reviewLead;
          errors.push(...unsupportedFields(
            lead,
            ["id", "title", "reason", "expectedOutcome", "aiFixPrompt", "sampleCoverage"],
            "summary.usageEfficiency.reviewLead",
          ));
          for (const field of ["id", "title", "reason", "expectedOutcome", "aiFixPrompt"]) {
            if (typeof lead[field] !== "string" || lead[field].trim() === "") {
              errors.push(`summary.usageEfficiency.reviewLead missing ${field}`);
            }
          }
          if (PRIVATE_USAGE_SUMMARY_RE.test(String(lead.aiFixPrompt ?? ""))
            || /(?:session id|sessionRef|qsr1-|user input|用户输入|原始会话)/iu.test(String(lead.aiFixPrompt ?? ""))) {
            errors.push("summary.usageEfficiency.reviewLead.aiFixPrompt must keep raw session identifiers and user input in the private review packet");
          }
          const coverage = lead.sampleCoverage;
          if (!isObject(coverage)
            || !Number.isInteger(coverage.shown)
            || !Number.isInteger(coverage.total)
            || typeof coverage.complete !== "boolean"
            || coverage.shown < 1
            || coverage.shown > 4
            || coverage.total !== unreviewedActiveLongCount
            || coverage.shown !== rows(usage.longSessions?.samples).length
            || coverage.complete !== (coverage.shown === coverage.total)) {
            errors.push("summary.usageEfficiency.reviewLead.sampleCoverage must match the bounded long-session candidates");
          }
          if (declaredFindingIds.has(String(lead.id ?? ""))) {
            errors.push("summary.usageEfficiency.reviewLead must not also be emitted as a finding");
          }
        }
      }
      if (usage.accounting?.mode !== "exact" && usage.actualCost !== undefined) {
        errors.push("summary.usageEfficiency.actualCost is allowed only for exact accounting");
      }
    }
  }
  if (summary.contextUsage !== undefined) {
    errors.push(...contextUsageErrors(summary.contextUsage));
  }
  if (!Array.isArray(summary.dimensions) || summary.dimensions.length !== validationDimensionIds.length) {
    errors.push(`findings.json summary.dimensions must contain exactly ${validationDimensionIds.length} task-loop dimensions`);
  }
  const dimensionIds = new Set();
  for (const [index, dimension] of rows(summary.dimensions).entries()) {
    const prefix = `summary.dimensions[${index}]`;
    const dimensionFields = ["id", "label", "level", "state", "score", "scoreReason", "scoreConfidence", "scoreEvidenceRefs", "summary", "findingRefs", "subdimensions", "evidenceBridge", "blocker"];
    errors.push(...unsupportedFields(dimension, dimensionFields, prefix));
    for (const field of ["id", "label", "state", "summary", "findingRefs", "subdimensions", "evidenceBridge", "blocker"]) {
      if (dimension?.[field] === undefined || dimension?.[field] === null || dimension?.[field] === "") errors.push(`${prefix} missing ${field}`);
    }
    if (!validationDimensionIds.includes(dimension?.id)) errors.push(`${prefix} contains unsupported task-loop dimension: ${dimension?.id}`);
    const rawDescriptor = validationDimensionById.get(dimension?.id);
    const descriptor = rawDescriptor ? readerDescriptor(rawDescriptor, summary.locale) : null;
    if (descriptor && dimension?.label !== descriptor.label) errors.push(`${prefix}.label must be ${descriptor.label}`);
    dimensionIds.add(dimension?.id);
    if (dimension?.level !== null && dimension?.level !== undefined && !TASK_LOOP_EVIDENCE_LAYERS.includes(dimension.level)) errors.push(`${prefix} has invalid evidence level: ${dimension.level}`);
    const minimumScore = dimension?.id === "learning-capture" && summary.reportContractVersion >= 25
      ? LEARNING_CAPTURE_REVIEWED_SCORE_FLOOR
      : 0;
    if (!Number.isInteger(dimension?.score) || dimension.score < minimumScore || dimension.score > 100) {
      errors.push(`${prefix}.score must be an integer from ${minimumScore} to 100`);
    }
    if (typeof dimension?.scoreReason !== "string" || dimension.scoreReason.trim().length < 24) errors.push(`${prefix}.scoreReason must explain the AI judgment`);
    if (!SCORE_CONFIDENCE.has(dimension?.scoreConfidence)) errors.push(`${prefix}.scoreConfidence must be low, medium, or high`);
    if (!Array.isArray(dimension?.scoreEvidenceRefs) || dimension.scoreEvidenceRefs.length === 0) errors.push(`${prefix}.scoreEvidenceRefs must cite reviewed evidence`);
    errors.push(...dimensionReaderSummaryErrors(dimension?.summary, dimension?.label, summary.locale, `${prefix}.summary`));
    if (!Array.isArray(dimension?.findingRefs)) errors.push(`${prefix} findingRefs must be an array`);
    const bridge = dimension?.evidenceBridge;
    if (!isObject(bridge)) errors.push(`${prefix} evidenceBridge must be an object`);
    else {
      errors.push(...unsupportedFields(bridge, ["staticEvidence", "episodeEvidence", "deliveryEvidence", "state"], `${prefix}.evidenceBridge`));
      for (const field of ["staticEvidence", "episodeEvidence", "deliveryEvidence"]) {
        if (!Array.isArray(bridge[field])) errors.push(`${prefix}.evidenceBridge.${field} must be an array`);
      }
      if (!new Set(["static-only", "wired-unobserved", "exercised", "outcome-supported", "missing", "not-applicable", "unobserved"]).has(bridge.state)) {
        errors.push(`${prefix}.evidenceBridge.state is invalid`);
      }
    }
    const expectedSubdimensions = descriptor?.subdimensions ?? [];
    if (!Array.isArray(dimension?.subdimensions) || dimension.subdimensions.length !== expectedSubdimensions.length) {
      errors.push(`${prefix}.subdimensions must contain exactly ${expectedSubdimensions.length} canonical subdimensions`);
    }
    const subdimensionIds = new Set();
    for (const [subindex, subdimension] of rows(dimension?.subdimensions).entries()) {
      const subprefix = `${prefix}.subdimensions[${subindex}]`;
      errors.push(...unsupportedFields(subdimension, ["id", "label", "level", "state", "score", "summary", "findingRefs", "evidenceBridge", "blocker"], subprefix));
      for (const field of ["id", "label", "state", "summary", "findingRefs", "evidenceBridge", "blocker"]) {
        if (subdimension?.[field] === undefined || subdimension?.[field] === null || subdimension?.[field] === "") errors.push(`${subprefix} missing ${field}`);
      }
      const expected = expectedSubdimensions.find((candidate) => candidate.id === subdimension?.id);
      if (!expected) errors.push(`${subprefix} contains unsupported subdimension: ${subdimension?.id}`);
      else if (subdimension?.label !== expected.label) errors.push(`${subprefix}.label must be ${expected.label}`);
      subdimensionIds.add(subdimension?.id);
      if (subdimension?.level !== null && subdimension?.level !== undefined && !TASK_LOOP_EVIDENCE_LAYERS.includes(subdimension.level)) {
        errors.push(`${subprefix} has invalid evidence level: ${subdimension.level}`);
      }
      if (!Array.isArray(subdimension?.findingRefs)) errors.push(`${subprefix} findingRefs must be an array`);
      const subBridge = subdimension?.evidenceBridge;
      if (!isObject(subBridge)) errors.push(`${subprefix} evidenceBridge must be an object`);
      else {
        errors.push(...unsupportedFields(subBridge, ["staticEvidence", "episodeEvidence", "deliveryEvidence", "state"], `${subprefix}.evidenceBridge`));
        for (const field of ["staticEvidence", "episodeEvidence", "deliveryEvidence"]) {
          if (!Array.isArray(subBridge[field])) errors.push(`${subprefix}.evidenceBridge.${field} must be an array`);
        }
        if (!new Set(["static-only", "wired-unobserved", "exercised", "outcome-supported", "missing", "not-applicable", "unobserved"]).has(subBridge.state)) {
          errors.push(`${subprefix}.evidenceBridge.state is invalid`);
        }
      }
    }
    for (const expected of expectedSubdimensions) {
      if (!subdimensionIds.has(expected.id)) errors.push(`${prefix}.subdimensions missing canonical subdimension: ${expected.id}`);
    }
    if (dimension?.id === "learning-capture") {
      errors.push(...learningLoopStateErrors(rows(dimension?.subdimensions)).map((error) => `${prefix}: ${error}`));
    }
    if (dimension?.id !== "learning-capture") {
      const ceiling = agentWorkLoopDimensionScoreCeiling([dimension, ...rows(dimension?.subdimensions)]);
      if (dimension?.score > ceiling) errors.push(`${prefix}.score exceeds its evidence ceiling (${ceiling})`);
    } else if (summary.reportContractVersion >= 25
      && learningLoopStateErrors(rows(dimension?.subdimensions)).length === 0) {
      const ceiling = learningCaptureScoreCeiling(rows(dimension?.subdimensions));
      if (dimension?.score > ceiling) errors.push(`${prefix}.score exceeds its Learning Capture evidence ceiling (${ceiling})`);
    }
  }
  for (const id of validationDimensionIds) {
    if (!dimensionIds.has(id)) errors.push(`findings.json summary.dimensions missing task-loop dimension: ${id}`);
  }
  const priorityMoveFindingRefs = [];
  const glance = summary.atAGlance;
  if (!isObject(glance)) errors.push("findings.json summary.atAGlance must be an object");
  else {
    errors.push(...unsupportedFields(glance, ["demonstratedAutonomyRadius", "coverage", "strongestLoop", "largestLeak", "priorityMoves"], "summary.atAGlance"));
    const radius = glance.demonstratedAutonomyRadius;
    if (!isObject(radius)) errors.push("summary.atAGlance.demonstratedAutonomyRadius must be an object");
    else {
      errors.push(...unsupportedFields(radius, ["level", "status", "confidence", "reason"], "summary.atAGlance.demonstratedAutonomyRadius"));
      for (const field of ["level", "status", "confidence", "reason"]) {
        if (typeof radius[field] !== "string" || radius[field].trim() === "") errors.push(`summary.atAGlance.demonstratedAutonomyRadius missing ${field}`);
      }
      if (!new Set(["R0", "R1", "R2", "R3", "R4"]).has(radius.level)) errors.push("summary.atAGlance.demonstratedAutonomyRadius.level must be R0, R1, R2, R3, or R4");
    }
    const coverage = glance.coverage;
    if (!isObject(coverage)) errors.push("summary.atAGlance.coverage must be an object");
    else {
      errors.push(...unsupportedFields(coverage, ["episodeCount", "editedEpisodeCount", "closedEpisodeCount", "recoveredEpisodeCount", "selection"], "summary.atAGlance.coverage"));
      for (const field of ["episodeCount", "editedEpisodeCount", "closedEpisodeCount", "recoveredEpisodeCount"]) {
        if (!Number.isInteger(coverage[field]) || coverage[field] < 0) errors.push(`summary.atAGlance.coverage.${field} must be a non-negative integer`);
      }
      const selection = coverage.selection;
      if (!isObject(selection)) errors.push("summary.atAGlance.coverage.selection must be an object");
      else {
        errors.push(...unsupportedFields(selection, ["strategy", "eligibleCount", "analyzedCount", "confidence"], "summary.atAGlance.coverage.selection"));
        for (const field of ["strategy", "confidence"]) {
          if (typeof selection[field] !== "string" || selection[field].trim() === "") errors.push(`summary.atAGlance.coverage.selection missing ${field}`);
        }
        for (const field of ["eligibleCount", "analyzedCount"]) {
          if (!Number.isInteger(selection[field]) || selection[field] < 0) errors.push(`summary.atAGlance.coverage.selection.${field} must be a non-negative integer`);
        }
      }
    }
    for (const field of ["strongestLoop", "largestLeak"]) {
      const row = glance[field];
      if (row !== null && !isObject(row)) errors.push(`summary.atAGlance.${field} must be an object or null`);
      else if (isObject(row)) {
        const valueField = field === "strongestLoop" ? "state" : "blocker";
        errors.push(...unsupportedFields(row, ["dimensionRef", valueField], `summary.atAGlance.${field}`));
        if (!dimensionIds.has(row.dimensionRef)) errors.push(`summary.atAGlance.${field}.dimensionRef contains unknown dimension id: ${row.dimensionRef}`);
        if (typeof row[valueField] !== "string" || row[valueField].trim() === "") errors.push(`summary.atAGlance.${field} missing ${valueField}`);
      }
    }
    if (!Array.isArray(glance.priorityMoves)) {
      errors.push("summary.atAGlance.priorityMoves must be an array");
    } else {
      for (const [index, move] of glance.priorityMoves.entries()) {
        const prefix = `summary.atAGlance.priorityMoves[${index}]`;
        if (!isObject(move)) {
          errors.push(`${prefix} must be an object`);
          continue;
        }
        errors.push(...unsupportedFields(move, ["findingRef", "dimensionRef", "move", "expectedUnlock"], prefix));
        for (const field of ["dimensionRef", "move", "expectedUnlock"]) {
          if (typeof move[field] !== "string" || move[field].trim() === "") errors.push(`${prefix} missing ${field}`);
        }
        if (typeof move.dimensionRef === "string" && !dimensionIds.has(move.dimensionRef)) {
          errors.push(`${prefix}.dimensionRef contains unknown dimension id: ${move.dimensionRef}`);
        }
        if (typeof move.findingRef !== "string" || move.findingRef.trim() === "") {
          errors.push(`${prefix}.findingRef must link a real finding`);
        } else priorityMoveFindingRefs.push({ id: move.findingRef, prefix });
      }
    }
  }
  if (!isObject(summary.evidenceBoundary)) errors.push("findings.json summary.evidenceBoundary must be an object");
  else {
    const boundary = summary.evidenceBoundary;
    errors.push(...unsupportedFields(boundary, ["manifest", "episodeCoverage", "deliveryEvidenceLevels", "sourceGaps"], "summary.evidenceBoundary"));
    if (!isObject(boundary.manifest)) errors.push("summary.evidenceBoundary.manifest must be an object");
    else {
      errors.push(...unsupportedFields(boundary.manifest, ["schemaVersion", "sourceFingerprint", "adapterVersion", "platform", "selection"], "summary.evidenceBoundary.manifest"));
      if (!isObject(boundary.manifest.selection)) errors.push("summary.evidenceBoundary.manifest.selection must be an object");
    }
    if (!Array.isArray(boundary.deliveryEvidenceLevels) || boundary.deliveryEvidenceLevels.some((value) => typeof value !== "string" || value.trim() === "")) {
      errors.push("summary.evidenceBoundary.deliveryEvidenceLevels must be an array of non-empty strings");
    }
    const coverage = boundary.episodeCoverage;
    if (!isObject(coverage)) {
      errors.push("summary.evidenceBoundary.episodeCoverage must be an object");
    } else {
      errors.push(...unsupportedFields(coverage, ["episodeCount", "editedEpisodeCount", "closedEpisodeCount", "recoveredEpisodeCount"], "summary.evidenceBoundary.episodeCoverage"));
      for (const field of ["episodeCount", "editedEpisodeCount", "closedEpisodeCount", "recoveredEpisodeCount"]) {
        if (!Number.isInteger(coverage[field]) || coverage[field] < 0) {
          errors.push(`summary.evidenceBoundary.episodeCoverage.${field} must be a non-negative integer`);
        }
      }
      if (Number.isInteger(coverage.editedEpisodeCount) && Number.isInteger(coverage.episodeCount)
        && coverage.editedEpisodeCount > coverage.episodeCount) {
        errors.push("summary.evidenceBoundary.episodeCoverage.editedEpisodeCount cannot exceed episodeCount");
      }
      if (Number.isInteger(coverage.closedEpisodeCount) && Number.isInteger(coverage.editedEpisodeCount)
        && coverage.closedEpisodeCount > coverage.editedEpisodeCount) {
        errors.push("summary.evidenceBoundary.episodeCoverage.closedEpisodeCount cannot exceed editedEpisodeCount");
      }
      if (Number.isInteger(coverage.recoveredEpisodeCount) && Number.isInteger(coverage.episodeCount)
        && coverage.recoveredEpisodeCount > coverage.episodeCount) {
        errors.push("summary.evidenceBoundary.episodeCoverage.recoveredEpisodeCount cannot exceed episodeCount");
      }
    }
    if (!Array.isArray(boundary.sourceGaps) || boundary.sourceGaps.some((value) => typeof value !== "string" || value.trim() === "")) {
      errors.push("summary.evidenceBoundary.sourceGaps must be an array of non-empty strings");
    }
  }
  errors.push(...readerFindingEligibilityErrors(data));
  if (!isObject(summary.semanticFacets)) {
    errors.push("findings.json summary.semanticFacets must be an object");
  } else {
    errors.push(...unsupportedFields(summary.semanticFacets, ["schemaVersion", "status", "entries"], "summary.semanticFacets"));
    if (!Array.isArray(summary.semanticFacets.entries)) {
      errors.push("summary.semanticFacets.entries must be an array");
    } else {
      errors.push(...validateSemanticFacets(summary.semanticFacets.entries.map((entry) => ({
        ...entry,
        schemaVersion: summary.semanticFacets.schemaVersion,
      }))));
    }
  }
  const learningDimension = rows(summary.dimensions).find((dimension) => dimension?.id === "learning-capture");
  const loopEngineeringState = rows(learningDimension?.subdimensions)
    .find((subdimension) => subdimension?.id === "loop-engineering")?.state;
  const laterValidation = rows(learningDimension?.subdimensions)
    .find((subdimension) => subdimension?.id === "later-validation");
  const laterValidationState = laterValidation?.state;
  if (!isObject(summary.learningCapture)) {
    errors.push("findings.json summary.learningCapture must be an object");
  } else {
    errors.push(...unsupportedFields(summary.learningCapture, ["schemaVersion", "state", "summary", "effectiveness", "interventions"], "summary.learningCapture"));
    for (const field of ["schemaVersion", "state", "summary", "interventions"]) {
      if (summary.learningCapture[field] === undefined || summary.learningCapture[field] === null || summary.learningCapture[field] === "") {
        errors.push(`summary.learningCapture missing ${field}`);
      }
    }
    if (!new Set(["N/A", "pending", "improving", "unchanged", "regressing", "outcome-supported"]).has(summary.learningCapture.state)) {
      errors.push("summary.learningCapture.state is invalid");
    }
    if (summary.learningCapture.effectiveness !== undefined && summary.learningCapture.effectiveness !== "Effective") {
      errors.push("summary.learningCapture.effectiveness may only be Effective when supplied");
    }
    if (!Array.isArray(summary.learningCapture.interventions)) {
      errors.push("summary.learningCapture.interventions must be an array");
    } else {
      let hasEffectiveIntervention = false;
      let hasOutcomeSupportedIntervention = false;
      for (const [index, intervention] of summary.learningCapture.interventions.entries()) {
        const prefix = `summary.learningCapture.interventions[${index}]`;
        if (!isObject(intervention)) {
          errors.push(`${prefix} must be an object`);
          continue;
        }
        errors.push(...unsupportedFields(intervention, ["id", "schemaVersion", "episodeRef", "frictionRefs", "candidateCauses", "asset", "owner", "baseline", "primaryMetric", "guardrailMetric", "comparisonWindow", "result", "comparison", "validation", "stopOrRevertCondition"], prefix));
        for (const field of ["id", "schemaVersion", "frictionRefs", "candidateCauses", "asset", "owner", "baseline", "primaryMetric", "guardrailMetric", "comparisonWindow", "result", "comparison", "validation", "stopOrRevertCondition"]) {
          if (intervention[field] === undefined || intervention[field] === null || intervention[field] === "") {
            errors.push(`${prefix} missing ${field}`);
          }
        }
        const comparison = intervention.comparison;
        if (!isObject(comparison)) {
          errors.push(`${prefix}.comparison must be an object`);
          continue;
        }
        errors.push(...unsupportedFields(comparison, ["state", "valid", "taskMix", "effectiveness"], `${prefix}.comparison`));
        if (!new Set(["pending", "improving", "unchanged", "regressing", "outcome-supported"]).has(comparison.state)) {
          errors.push(`${prefix}.comparison.state is invalid`);
        }
        if (typeof comparison.valid !== "boolean") errors.push(`${prefix}.comparison.valid must be a boolean`);
        if (comparison.effectiveness !== undefined && comparison.effectiveness !== "Effective" && comparison.effectiveness !== "Not demonstrated") {
          errors.push(`${prefix}.comparison.effectiveness is invalid`);
        }
        if (comparison.state === "outcome-supported" && comparison.valid === true) hasOutcomeSupportedIntervention = true;
        if (comparison.effectiveness === "Effective") {
          hasEffectiveIntervention = true;
          if (comparison.valid !== true || comparison.state !== "outcome-supported") {
            errors.push(`${prefix} may claim Effective only for a valid outcome-supported comparison`);
          }
        }
      }
      const restoredInterventions = restoreProjectedInterventionLedger(summary.learningCapture.interventions);
      const restorable = restoredInterventions.length === summary.learningCapture.interventions.length;
      if (summary.learningCapture.interventions.length > 0 && !restorable) {
        errors.push("summary.learningCapture.interventions must retain a restorable validated intervention ledger");
      }
      if (summary.learningCapture.effectiveness === "Effective" && !hasEffectiveIntervention) {
        errors.push("summary.learningCapture Effective requires a valid outcome-supported intervention");
      }
      if (summary.learningCapture.state === "outcome-supported" && !hasOutcomeSupportedIntervention) {
        errors.push("summary.learningCapture outcome-supported requires a valid outcome-supported intervention");
      }
      if (restorable) {
        const expectedLearning = summarizeLearningCapture(restoredInterventions, {
          active: loopEngineeringState === "Exercised",
        });
        if (summary.learningCapture.state !== expectedLearning.state) {
          errors.push(`summary.learningCapture.state must be ${expectedLearning.state} for the current Loop Engineering state and retained intervention ledger`);
        }
        if (summary.learningCapture.effectiveness !== expectedLearning.effectiveness) {
          errors.push(`summary.learningCapture.effectiveness must ${expectedLearning.effectiveness === "Effective" ? "be Effective" : "be omitted"} for the structured aggregate state`);
        }
        errors.push(...learningLoopStateErrors(rows(learningDimension?.subdimensions), {
          interventionLedger: restoredInterventions,
        }).map((error) => `summary.learningCapture: ${error}`));
        const projectedLater = projectLaterValidationState(restoredInterventions, {
          loopEngineeringState,
        });
        if (restoredInterventions.length > 0 && laterValidationState !== projectedLater) {
          errors.push(`Learning Capture later-validation must be ${projectedLater} for the current Loop Engineering state and retained intervention ledger`);
        }
      }
    }
  }
  const learningSummaryState = summary.learningCapture?.state;
  if (learningSummaryState === "outcome-supported" && laterValidationState !== "Outcome-supported") {
    errors.push("summary.learningCapture outcome-supported requires Learning Capture later-validation to be Outcome-supported");
  }
  if (summary.learningCapture?.effectiveness === "Effective" && laterValidationState !== "Outcome-supported") {
    errors.push("summary.learningCapture Effective requires Learning Capture later-validation to be Outcome-supported");
  }
  if (laterValidationState === "Outcome-supported" && learningSummaryState !== "outcome-supported") {
    errors.push("Learning Capture later-validation Outcome-supported requires an outcome-supported learning summary");
  }
  if (new Set(["improving", "unchanged", "regressing"]).has(learningSummaryState)
    && laterValidationState !== "Exercised") {
    errors.push(`summary.learningCapture ${learningSummaryState} requires Learning Capture later-validation to be Exercised`);
  }
  if (!Array.isArray(data.findings)) errors.push("findings.json must include a findings array");
  const findingIds = new Set();
  const declaredSubdimensions = new Set(rows(summary.dimensions).flatMap((dimension) => rows(dimension?.subdimensions).map((subdimension) => subdimension?.id)));
  for (const [index, finding] of rows(data.findings).entries()) {
    const prefix = `findings[${index}]`;
    const findingFields = [
      "id", "title", "severity", "reason", "aiFixPrompt", "dimensionRefs", "subdimensionRefs", "evidenceBridge", "expectedArtifact",
      "expectedOutput", "kind", "target", "actualOutputRevision", "actualOutput", "assignmentSummary", "postFixRepairReview", "postFixScoreReview",
    ];
    const requiredFindingFields = findingFields.filter((field) => ![
      "target", "actualOutputRevision", "actualOutput", "assignmentSummary", "postFixRepairReview", "postFixScoreReview",
    ].includes(field));
    errors.push(...unsupportedFields(finding, findingFields, prefix));
    for (const field of requiredFindingFields) {
      if (finding?.[field] === undefined || finding?.[field] === null || finding?.[field] === "") errors.push(`${prefix} missing ${field}`);
    }
    if (typeof finding?.expectedArtifact !== "string" || finding.expectedArtifact.trim() === "") {
      errors.push(`${prefix}.expectedArtifact must be a non-empty string`);
    }
    if (!Array.isArray(finding?.expectedOutput) || finding.expectedOutput.length < 1) {
      errors.push(`${prefix}.expectedOutput must contain concrete output strings`);
    } else {
      for (const [outputIndex, output] of finding.expectedOutput.entries()) {
        const outputPrefix = `${prefix}.expectedOutput[${outputIndex}]`;
        if (typeof output !== "string" || output.trim() === "") {
          errors.push(`${outputPrefix} must be a non-empty string`);
          continue;
        }
        if (PRIVATE_USAGE_SUMMARY_RE.test(output)) {
          errors.push(`${outputPrefix} must not expose an absolute private path`);
        }
      }
    }
    errors.push(...actualOutputErrors(finding, prefix));
    errors.push(...assignmentSummaryErrors(finding, summary.locale, prefix));
    errors.push(...postFixRepairReviewErrors(finding, summary, prefix));
    errors.push(...postFixScoreReviewErrors(finding, summary, prefix));
    errors.push(...findingTargetErrors(finding?.target, {
      prefix: `${prefix}.target`,
    }));
    if (findingIds.has(finding?.id)) errors.push(`${prefix} duplicates finding id: ${finding?.id}`);
    findingIds.add(finding?.id);
    if (!["High", "Medium", "Low"].includes(finding?.severity)) errors.push(`${prefix} has invalid severity: ${finding?.severity}`);
    if (!["evidence-gap", "missing-mechanism", "outcome-gap"].includes(finding?.kind)) errors.push(`${prefix} has invalid kind: ${finding?.kind}`);
    for (const field of ["title", "reason", "aiFixPrompt"]) {
      if (PRIVATE_USAGE_SUMMARY_RE.test(String(finding?.[field] ?? ""))) {
        errors.push(`${prefix}.${field} must not expose private paths, stable ids, or credential-shaped values`);
      }
    }
    if (!Array.isArray(finding?.dimensionRefs) || finding.dimensionRefs.length === 0) errors.push(`${prefix} dimensionRefs must be a non-empty array`);
    for (const ref of rows(finding?.dimensionRefs)) {
      if (!dimensionIds.has(ref)) errors.push(`${prefix} dimensionRefs contains unknown dimension id: ${ref}`);
    }
    if (!Array.isArray(finding?.subdimensionRefs)) errors.push(`${prefix} subdimensionRefs must be an array`);
    for (const ref of rows(finding?.subdimensionRefs)) {
      if (!declaredSubdimensions.has(ref)) errors.push(`${prefix} subdimensionRefs contains unknown subdimension id: ${ref}`);
    }
    const bridge = finding?.evidenceBridge;
    if (!isObject(bridge)) errors.push(`${prefix} evidenceBridge must be an object`);
    else for (const field of ["staticEvidence", "episodeEvidence", "deliveryEvidence", "state"]) {
      if (bridge[field] === undefined || bridge[field] === null || bridge[field] === "") errors.push(`${prefix}.evidenceBridge missing ${field}`);
    }
  }
  for (const ref of priorityMoveFindingRefs) {
    if (!findingIds.has(ref.id)) errors.push(`${ref.prefix}.findingRef contains unknown finding id: ${ref.id}`);
  }
  for (const dimension of rows(summary.dimensions)) {
    for (const ref of rows(dimension?.findingRefs)) {
      if (!findingIds.has(ref)) errors.push(`summary dimension ${dimension.id} findingRefs contains unknown finding id: ${ref}`);
    }
    for (const subdimension of rows(dimension?.subdimensions)) {
      for (const ref of rows(subdimension?.findingRefs)) {
        if (!findingIds.has(ref)) errors.push(`summary subdimension ${subdimension.id} findingRefs contains unknown finding id: ${ref}`);
      }
    }
  }
  if (Array.isArray(summary.assignmentSummaries)) {
    const expectedAssignmentSummaries = assignmentSummariesFromFindings(data.findings);
    if (JSON.stringify(summary.assignmentSummaries) !== JSON.stringify(expectedAssignmentSummaries)) {
      errors.push("summary.assignmentSummaries must exactly match the latest finding assignmentSummary and actualOutput values in finding order");
    }
  }
  if (summary.evidenceBoundary?.manifest?.platform === "codex") {
    errors.push(...requiredTaskLoopUsageErrors(data));
    errors.push(...validateTaskLoopUsagePair(data));
  }
  errors.push(...hasRawField(data));
  return errors;
}

const HELP = `Usage: node scripts/harness-analysis/task-loop-report.mjs --source <report.source.json> --findings <findings.json> [--project-name <name>] [--no-write] [--json]

Project privacy-safe task-loop findings from a reviewed combined-walkthrough evidence envelope.
`;

function parseArgs(argv) {
  const options = { write: true, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "--no-write") options.write = false;
    else if (arg === "--json") options.json = true;
    else if (["--source", "--findings", "--project-name"].includes(arg)) options[arg.slice(2)] = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (!options.source || !options.findings) throw new Error("--source and --findings are required");
  const source = JSON.parse(readFileSync(path.resolve(options.source), "utf8"));
  const findings = projectTaskLoopFindings(source, { projectName: options["project-name"] });
  const errors = validateTaskLoopFindings(findings);
  if (errors.length > 0) throw Object.assign(new Error(errors.join("; ")), { code: "INVALID_TASK_LOOP_FINDINGS", errors });
  const findingsPath = path.resolve(options.findings);
  if (options.write) {
    await mkdir(path.dirname(findingsPath), { recursive: true });
    await writeFile(findingsPath, `${JSON.stringify(findings, null, 2)}\n`);
  }
  const payload = { kind: "harness-task-loop-projection", status: "pass", findingsPath, write: options.write, findingCount: findings.findings.length };
  process.stdout.write(options.json ? `${JSON.stringify(payload, null, 2)}\n` : `${payload.kind}: ${payload.status}\n`);
  return 0;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${String(error?.stack ?? error)}\n`);
    process.exit(1);
  });
}
