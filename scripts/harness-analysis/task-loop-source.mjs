#!/usr/bin/env node

import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createAnalyzer } from "../session-analysis.mjs";
import { runAgentLint } from "../agent-lint/index.mjs";
import { scanPaths } from "../agent-guardrails/secret-scan.mjs";
import {
  listTrackedFiles,
  resolveAnalysisScopeForOptions,
  toAnalysisRelativePath,
} from "../core-change-watch/common.mjs";
import {
  collectProviderInventory,
  collectQoderInventory,
} from "../coding-agent-practices/inventory.mjs";
import { reviewAssetIntegrity } from "../coding-agent-practices/asset-integrity.mjs";
import { projectCheckupReportEvidence } from "../coding-agent-practices/checkup/contract.mjs";
import { buildTaskEpisodes, stableFingerprint } from "../session-analysis/episode-contract.mjs";
import { buildObservationManifest } from "../session-analysis/observation-manifest.mjs";
import { sanitizePrivateReviewText } from "../session-analysis/privacy-safe-text.mjs";
import { sessionAnalysisRef } from "../session-analysis/session-ref.mjs";
import { selectSessions } from "../session-analysis/selection.mjs";
import {
  assertSessionSelectionBinding,
  readSessionSelectionPlan,
  readSessionSelectionProfile,
  readSessionSelectionSnapshot,
  restoreSessionSelectionEntries,
} from "../session-analysis/selection-plan.mjs";
import {
  createHarnessReportSource,
  LEARNING_CAPTURE_FINDING_POLICY,
} from "./report-source.mjs";
import {
  AGENT_WORK_LOOP_DIMENSIONS,
  AGENT_WORK_LOOP_MODEL_ID,
} from "./fluency-dimensions.mjs";
import { projectAgentLintPracticeEvidence } from "./practice-findings.mjs";
import { loadPriorLearningCaptureState } from "./learning-capture-state.mjs";
import { scanTaskLoopRepositoryEvidence } from "./task-loop-repository-evidence.mjs";
import { buildLearningLoopReview } from "./learning-loop-candidates.mjs";
import { buildWorkflowDemandDiagnostics } from "./workflow-demand-diagnostics.mjs";
import { findingTargetFromTopology } from "../workspace-topology/index.mjs";

export const TASK_LOOP_SOURCE_ADAPTER_VERSION = "task-loop-source-v2";
const DEFAULT_LIMIT = 40;
const DEFAULT_USAGE_CENSUS_LIMIT = 1000;
const REQUIRED_REVIEW_FRAMEWORKS = Object.freeze(["coding-agent-practices", "software-fluency"]);
const REQUIRED_REPOSITORY_CHECKS = Object.freeze([
  "scoped-instructions-and-task-routes",
  "setup-run-and-debug-route",
  "core-diagnostic-coverage",
  "tests-and-post-edit-validation",
  "hooks-permissions-and-safety-controls",
  "acceptance-recovery-and-release-path",
  "lifecycle-repeat-detection",
  "loop-engineering",
  "later-validation",
]);
const REQUIRED_SOFTWARE_FLUENCY_CAPABILITIES = Object.freeze([
  "context-map",
  "environment-readiness",
  "fast-feedback",
  "quality-gates",
  "safe-change",
]);

const HELP = `Usage: node scripts/harness-analysis/task-loop-source.mjs --workspace <target> --source <report.source.json> [options]

Create a conservative Agent Work Loop report-source candidate from normalized
Qoder, Codex, Claude, Cursor, Qwen, Copilot, or Pi sessions. It retains privacy-safe episode, change, validation,
repair-candidate, and explicit host-decision identities. Task understanding,
validation relevance, repair, delivery, recovery, and Learning Capture remain
unobserved until the prepared source-bound review resolves them.

Options:
  --platform <qoder|codex|claude|cursor|qwen|copilot|pi>
                                  Session platform (default: qoder)
  --workspace <path>            Target workspace (required)
  --source <path>               Candidate report.source.json path (required)
  --until <ISO timestamp>       Exclude later sessions
  --since <ISO timestamp>       Exclude earlier sessions
  --limit <n>                   Maximum selected sessions (default: ${DEFAULT_LIMIT})
  --selection <strategy>        stratified, all-eligible, or latest-n (default: stratified)
  --selection-profile <path>    Frozen population profile used to author the AI plan
  --selection-snapshot <path>   Private numeric-fact snapshot from selection-profile.mjs
  --selection-plan <path>       AI-authored declarative plan from selection-profile.mjs
  --selection-concurrency <n>   Full-population fact-read concurrency from 1 to 16 (default: 4)
  --language <en|zh-CN>         Reader locale carried into the candidate (default: en)
  --include-usage               Include the reader-safe all-eligible usage census (opt-in)
  --include-global-capabilities Include the full user-home/global capability inventory
  --checkup-scan <path>         Explicit Checkup scan JSON to validate and include
  --previous-findings <path>    Explicit prior findings.json for learning-capture continuity
  --json                        Emit a compact JSON summary (default)
`;

function rows(value) {
  return Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];
}

export function projectPracticeCoverageRows(practiceInventory, includeGlobalCapabilities = false) {
  const coverageRows = rows(practiceInventory?.summary?.practiceCoverageRows);
  const projectRows = includeGlobalCapabilities ? [...coverageRows] : coverageRows.filter((row) => {
    const scopes = rows(row?.scopes);
    return scopes.includes("Project")
      || scopes.includes("Inherited")
      || scopes.includes("Plugin")
      || (row?.surface === "Hooks" && scopes.includes("Global"));
  });
  if (!projectRows.some((row) => row?.surface === "Custom Agents")) {
    projectRows.push({ surface: "Custom Agents", scopes: ["Project"], count: 0, paths: [] });
  }
  return projectRows;
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

function publicEvidenceRefs(values, prefix) {
  return uniqueByJson(rows(values).map((value, index) => {
    const reference = {
      kind: String(value?.kind ?? "session-event"),
      id: `${prefix}-${index + 1}`,
    };
    if (value?.type) reference.type = String(value.type);
    if (Number.isInteger(Number(value?.line))) reference.line = Number(value.line);
    if (value?.status) reference.status = String(value.status);
    return reference;
  }));
}

function safeReaderLabel(value, fallback) {
  const label = String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, 80);
  return label || fallback;
}

function safeSignalRows(value) {
  const counts = new Map();
  for (const row of rows(value)) {
    const name = safeReaderLabel(row?.name, "unknown");
    if (name === "unknown") continue;
    counts.set(name, (counts.get(name) ?? 0) + nonNegativeInteger(row?.count));
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, 12);
}

function coveragePaths(repositoryEvidence, surface) {
  return rows(repositoryEvidence?.aiAgentPractice?.coverageRows)
    .filter((row) => {
      if (String(row?.surface ?? "").toLowerCase() !== surface.toLowerCase()) return false;
      const scopes = rows(row?.scopes).map((scope) => String(scope));
      return scopes.length === 0 || scopes.includes("Project") || scopes.includes("Inherited");
    })
    .flatMap((row) => rows(row?.paths).map((item) => String(item ?? "").trim()).filter(Boolean))
    .filter((item, index, all) => all.indexOf(item) === index)
    .slice(0, 24);
}

function observedSkillSignals(insights) {
  const census = rows(insights?.keySignals?.usageEfficiency?.activity?.skills);
  return census.length > 0
    ? safeSignalRows(census.map((row) => ({ name: row?.name, count: row?.total })))
    : safeSignalRows(insights?.keySignals?.topSkills);
}

function memoryActivityKind(value) {
  const name = String(value ?? "").toLowerCase().replace(/[^a-z0-9]/gu, "");
  if (name.endsWith("searchmemory")) return "retrieve";
  if (["creatememory", "updatememory", "writememory", "deletememory"].some((suffix) => name.endsWith(suffix))) return "write";
  return null;
}

export function projectMemorySessionActivity(insights) {
  const project = (values) => safeSignalRows(rows(values)
    .map((row) => ({ name: memoryActivityKind(row?.name), count: row?.count }))
    .filter((row) => row.name));
  const toolActivity = project(insights?.keySignals?.topTools);
  return toolActivity.length > 0 ? toolActivity : project(insights?.keySignals?.topFunctionCalls);
}

export function projectMemoryScan(memoryInventory, provider = "unknown") {
  if (memoryInventory === undefined) return null;
  const candidateCount = rows(memoryInventory?.categories)
    .reduce((total, row) => total + nonNegativeInteger(row?.count), 0);
  return {
    status: memoryInventory?.included === true
      ? (candidateCount > 0 ? "scanned-present" : "scanned-empty")
      : "not-scanned",
    provider: safeReaderLabel(provider, "unknown"),
    candidateCount,
    contentPolicy: "metadata-only",
  };
}

const SENSITIVE_CONFIG_FILE_RE = /(^|\/)(?:\.aoneci\/|\.github\/workflows\/|\.circleci\/|\.gitlab-ci\.ya?ml$|Jenkinsfile$|azure-pipelines\.ya?ml$)|(?:^|\/)(?:\.env(?:\.[^/]+)?|\.npmrc|\.pypirc)$|(?:^|\/)[^/]+\.(?:ya?ml|json|toml|properties|env|sh|ps1|gradle|kts)$/i;
const SECRET_SCAN_IGNORE_FILE_RE = /(^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|poetry\.lock|Pipfile\.lock|Cargo\.lock|Gemfile\.lock)$/i;
const MAX_SECRET_SCAN_FILES = 2_000;

function isWithinRoot(root, target) {
  const relative = path.relative(root, target);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

export async function collectTrackedSensitiveConfigFiles(
  workspace,
  trackedFiles,
  fsApi = { lstat, realpath },
  analysisScope,
  topology,
) {
  let resolvedScope = null;
  if (analysisScope || trackedFiles === undefined) {
    try {
      resolvedScope = resolveAnalysisScopeForOptions({ cwd: workspace, analysisScope });
    } catch (error) {
      if ((analysisScope && topology?.gitRoot !== null) || error?.code !== "GIT_COMMAND_FAILED") throw error;
      return {
        files: [],
        candidateCount: 0,
        truncated: false,
        skippedCount: 0,
        errorCount: 1,
      };
    }
  }
  const root = await fsApi.realpath(resolvedScope?.targetRoot ?? path.resolve(workspace));
  const inventory = trackedFiles ?? listTrackedFiles(resolvedScope.repoRoot, resolvedScope);
  const candidates = inventory
    .map((file) => resolvedScope?.kind === "path" ? toAnalysisRelativePath(file, resolvedScope) : file)
    .map((file) => String(file ?? "").replaceAll("\\", "/"))
    .filter((file) => SENSITIVE_CONFIG_FILE_RE.test(file) && !SECRET_SCAN_IGNORE_FILE_RE.test(file))
    .sort();
  const inspected = await Promise.all(candidates.map(async (file) => {
    try {
      const absolute = path.resolve(root, file);
      const metadata = await fsApi.lstat(absolute);
      if (metadata.isSymbolicLink() || !metadata.isFile()) return { status: "skipped" };
      const canonical = await fsApi.realpath(absolute);
      return isWithinRoot(root, canonical) ? { status: "included", file } : { status: "skipped" };
    } catch {
      return { status: "error" };
    }
  }));
  const included = inspected.filter((row) => row.status === "included").map((row) => row.file);
  return {
    files: included.slice(0, MAX_SECRET_SCAN_FILES),
    candidateCount: candidates.length,
    truncated: included.length > MAX_SECRET_SCAN_FILES,
    skippedCount: inspected.filter((row) => row.status === "skipped").length,
    errorCount: inspected.filter((row) => row.status === "error").length,
  };
}

function learningCaptureDiagnosticsCandidate(insights, repositoryEvidence, interventions, taskEpisodes, memoryInventory, provider) {
  const memoryActivity = projectMemorySessionActivity(insights);
  const memoryScan = projectMemoryScan(memoryInventory, provider);
  const projectSkillProfile = repositoryEvidence?.learningCaptureEvidence?.reusableSkillEvidence;
  const hasProjectSkillProfile = projectSkillProfile?.status === "candidates-present"
    || projectSkillProfile?.status === "scanned-empty";
  const observedProjectSkills = safeSignalRows(rows(projectSkillProfile?.observedProjectSkills)
    .map((row) => ({ name: row?.name, count: row?.count })));
  const confirmedNames = new Set(observedProjectSkills.map((row) => row.name.toLowerCase()));
  const unscopedObservedSkills = observedSkillSignals(insights)
    .filter((row) => !confirmedNames.has(row.name.toLowerCase()));
  const configuredProjectSkills = rows(projectSkillProfile?.candidates)
    .map((row) => String(row?.path ?? "").trim())
    .filter(Boolean);
  const signals = {
    observedSkills: hasProjectSkillProfile ? observedProjectSkills : [],
    unscopedObservedSkills,
    apparentSkillReads: safeSignalRows(insights?.keySignals?.inferredSkillReads),
    configuredSkills: hasProjectSkillProfile ? configuredProjectSkills : coveragePaths(repositoryEvidence, "Skills"),
    memories: coveragePaths(repositoryEvidence, "Memories"),
    ...(memoryActivity.length > 0 ? { memoryActivity } : {}),
    ...(memoryScan ? { memoryScan } : {}),
    frictionSignals: safeSignalRows(insights?.keySignals?.friction),
    priorInterventionCount: rows(interventions).length,
  };
  const learningLoop = buildLearningLoopReview({
    episodes: taskEpisodes,
    signals,
    interventions,
    assetCoverage: repositoryEvidence?.aiAgentPractice?.coverageRows,
  });
  return {
    signals,
    learningCaptureSchemaVersion: learningLoop.schemaVersion,
    episodeRecords: learningLoop.episodeRecords,
    recurringIssueCandidates: learningLoop.candidates,
    coverage: learningLoop.coverage,
  };
}

function readerMinutes(value, locale) {
  const minutes = Number(value ?? 0) / 60_000;
  const rounded = minutes >= 10 ? Math.round(minutes) : Number(minutes.toFixed(1));
  return locale === "zh-CN" ? `${rounded} 分钟` : `${rounded} minutes`;
}

export function normalizeReaderLocale(value) {
  const locale = String(value ?? "en").trim().replaceAll("_", "-").toLowerCase();
  return locale === "zh" || locale === "zh-cn" ? "zh-CN" : "en";
}

function nonNegativeInteger(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function safeUsageModelRows(value) {
  return rows(value)
    .map((row) => ({
      model: safeReaderLabel(row?.model, "unknown model"),
      responseCount: nonNegativeInteger(row?.responseCount),
      usageFieldObservedCount: nonNegativeInteger(row?.usageFieldObservedCount),
      nonZeroUsageCount: nonNegativeInteger(row?.nonZeroUsageCount),
    }))
    .sort((left, right) => right.responseCount - left.responseCount || left.model.localeCompare(right.model))
    .slice(0, 8);
}

function safeUsageSummary(value) {
  return sanitizePrivateReviewText(value, { limit: 160 })
    ?? "unavailable-after-privacy-filtering";
}

function projectLongSessionSamples(candidates, scope = {}) {
  return candidates
    .slice()
    .sort((left, right) => Number(right?.activeMs ?? 0) - Number(left?.activeMs ?? 0))
    .slice(0, 4)
    .map((row, index) => ({
      alias: `S${index + 1}`,
      rawSessionId: String(row?.id ?? ""),
      sessionRef: row?.sessionRef ?? sessionAnalysisRef({
        sessionId: row?.id,
        platform: scope.platform,
        workspace: scope.workspace,
      }),
      role: ["user-thread-candidate", "child-agent-candidate"].includes(row?.role)
        ? row.role
        : "unknown-candidate",
      activeMinutes: Number((Number(row?.activeMs ?? 0) / 60_000).toFixed(1)),
      failureCount: nonNegativeInteger(row?.failureCount),
      userInputSummary: safeUsageSummary(row?.userInputSummary),
    }));
}

export function projectSessionUsageSummary(usage, eligibleSessionCount = 0, scope = {}) {
  const coverage = usage?.coverage ?? {};
  const analyzedSessionCount = nonNegativeInteger(coverage.analyzedSessionCount);
  if (!usage || analyzedSessionCount === 0) return null;
  const eligible = nonNegativeInteger(eligibleSessionCount) || analyzedSessionCount;
  const outcomeReview = usage.outcomeReview ?? {};
  const activeCandidates = rows(usage.candidates)
    .filter((row) => rows(row?.candidateReasons).includes("active-long"));
  const activeCount = nonNegativeInteger(usage.longSessions?.longActiveCount);
  const reviewedActiveRefs = new Set(rows(outcomeReview.reviewedActiveLongSessionRefs)
    .map((value) => String(value ?? "").trim())
    .filter(Boolean));
  const reviewedActiveLongCount = Math.min(activeCount, Math.max(
    nonNegativeInteger(outcomeReview.reviewedActiveLongCount),
    reviewedActiveRefs.size,
  ));
  const sortedActiveCandidates = activeCandidates.slice()
    .sort((left, right) => Number(right?.activeMs ?? 0) - Number(left?.activeMs ?? 0));
  const unreviewedActiveCandidates = reviewedActiveRefs.size > 0
    ? sortedActiveCandidates.filter((row) => !reviewedActiveRefs.has(String(row?.sessionRef ?? "")))
    : sortedActiveCandidates.slice(reviewedActiveLongCount);
  const longestActiveMs = activeCandidates.reduce((maximum, row) => Math.max(maximum, Number(row?.activeMs ?? 0)), 0);
  const accountingMode = ["exact", "host-estimated", "effort-proxy"].includes(usage.accountingMode)
    ? usage.accountingMode
    : "effort-proxy";
  const responseCount = nonNegativeInteger(coverage.responseCount);
  const modelAttributedResponseCount = Math.min(responseCount, nonNegativeInteger(
    coverage.modelAttributedResponseCount
      ?? rows(usage.modelUsage).reduce((sum, row) => sum + nonNegativeInteger(row?.responseCount), 0),
  ));
  const unattributedResponseCount = nonNegativeInteger(
    coverage.unattributedResponseCount ?? Math.max(0, responseCount - modelAttributedResponseCount),
  );
  const projected = {
    schemaVersion: 2,
    selection: {
      strategy: "all-eligible",
      eligibleSessionCount: eligible,
      analyzedSessionCount,
      complete: analyzedSessionCount === eligible,
    },
    roles: {
      userThreadCandidateCount: nonNegativeInteger(coverage.userThreadCandidateCount),
      childAgentCandidateCount: nonNegativeInteger(coverage.childAgentCandidateCount),
    },
    longSessions: {
      activeCount,
      wallOnlyCount: nonNegativeInteger(usage.longSessions?.wallOnlyCount),
      longestActiveMinutes: Number((longestActiveMs / 60_000).toFixed(1)),
      activeRatio: analyzedSessionCount > 0
        ? Number((nonNegativeInteger(usage.longSessions?.longActiveCount) / analyzedSessionCount).toFixed(4))
        : 0,
      estimate: {
        method: "capped-event-gap",
        activeThresholdMinutes: Number((Number(usage.thresholds?.activeMs ?? 45 * 60_000) / 60_000).toFixed(1)),
        gapCapMinutes: Number((Number(usage.thresholds?.activeGapCapMs ?? 5 * 60_000) / 60_000).toFixed(1)),
        idleGapMinutes: Number((Number(usage.thresholds?.idleGapMs ?? 30 * 60_000) / 60_000).toFixed(1)),
      },
      samples: projectLongSessionSamples(unreviewedActiveCandidates, scope),
    },
    accounting: {
      mode: accountingMode,
      responseCount,
      modelAttributedResponseCount,
      unattributedResponseCount,
      usageFieldObservedCount: nonNegativeInteger(coverage.usageFieldObservedCount),
      nonZeroUsageCount: nonNegativeInteger(coverage.nonZeroUsageCount),
      exactCreditsAvailable: coverage.exactCreditsAvailable === true,
      pricingVersion: coverage.pricingVersion ? safeReaderLabel(coverage.pricingVersion, "") : null,
    },
    modelUsage: safeUsageModelRows(usage.modelUsage),
    outcomeReview: {
      status: safeReaderLabel(outcomeReview.status, "required"),
      reviewedCandidateCount: nonNegativeInteger(outcomeReview.reviewedCandidateCount),
      reviewedActiveLongCount,
      comparableModelOutcomeEvidence: outcomeReview.comparableModelOutcomeEvidence === true,
      recommendation: outcomeReview.comparableModelOutcomeEvidence === true
        ? "reviewed-comparison-available"
        : "controlled-a-b-required",
    },
  };
  if (usage.tokenTotals && typeof usage.tokenTotals === "object") {
    projected.tokenTotals = {
      inputTokens: nonNegativeInteger(usage.tokenTotals.inputTokens),
      outputTokens: nonNegativeInteger(usage.tokenTotals.outputTokens),
      cacheReadInputTokens: nonNegativeInteger(usage.tokenTotals.cacheReadInputTokens),
      cacheCreationInputTokens: nonNegativeInteger(usage.tokenTotals.cacheCreationInputTokens),
    };
  }
  if (accountingMode === "exact" && usage.actualCost?.available === true) {
    projected.actualCost = {
      amount: Number(usage.actualCost.amount),
      currency: safeReaderLabel(usage.actualCost.currency, ""),
      pricingVersion: safeReaderLabel(usage.actualCost.pricingVersion, ""),
    };
  }
  return projected;
}

export function mergeUsageCensusInsights(sampleInsights = {}, censusInsights = {}) {
  const usageEfficiency = censusInsights?.keySignals?.usageEfficiency;
  if (!usageEfficiency) return sampleInsights;
  return {
    ...sampleInsights,
    keySignals: {
      ...(sampleInsights.keySignals ?? {}),
      usageEfficiency,
    },
  };
}

function sessionUsageOverview(usage, locale) {
  const coverage = usage?.coverage ?? {};
  const analyzed = Number(coverage.analyzedSessionCount ?? 0);
  if (!usage || analyzed <= 0) return "";
  const long = usage.longSessions ?? {};
  const activeLong = Number(long.longActiveCount ?? 0);
  const wallOnly = Number(long.wallOnlyCount ?? 0);
  const topActive = rows(usage.candidates)
    .filter((row) => rows(row?.candidateReasons).includes("active-long"))
    .sort((left, right) => Number(right?.activeMs ?? 0) - Number(left?.activeMs ?? 0))[0];
  const effortProxy = usage.accountingMode === "effort-proxy";

  if (locale === "zh-CN") {
    const duration = activeLong > 0
      ? `其中 ${activeLong} 个达到活跃长会话阈值${topActive ? `，最长约 ${readerMinutes(topActive.activeMs, locale)}` : ""}`
      : "未发现达到阈值的活跃长会话";
    const idle = wallOnly > 0 ? `；另有 ${wallOnly} 个长跨度主要来自暂停或恢复` : "";
    const boundary = effortProxy
      ? "这些活动证据只描述投入；当前 token 或 credit 证据不足，不能据此推断模型偏好、质量或节省。"
      : "这些活动证据不代表模型偏好或质量；模型效果仍需结合相同任务类型的结果比较。";
    return `本次分析覆盖 ${analyzed} 个会话，${duration}${idle}。 ${boundary}`;
  }

  const duration = activeLong > 0
    ? `${activeLong} met the active-long threshold${topActive ? `, with the longest estimated at ${readerMinutes(topActive.activeMs, locale)}` : ""}`
    : "none met the active-long threshold";
  const idle = wallOnly > 0 ? `; ${wallOnly} additional long spans were mainly idle or resumed work` : "";
  const boundary = effortProxy
    ? "This activity describes effort only; token or credit evidence is incomplete and does not establish model preference, quality, or savings."
    : "This activity does not establish model preference or quality; effectiveness still requires outcome comparison within the same task family.";
  return `The analysis covered ${analyzed} sessions: ${duration}${idle}. ${boundary}`;
}

function boundedEpisodeEvidenceRefs(values, prefix) {
  const references = publicEvidenceRefs(values, prefix);
  if (references.length <= 2) return { references, count: references.length };
  return {
    references: [references[0], references.at(-1)],
    count: references.length,
  };
}

function sourcePermissionCoverageSummary(value) {
  const observed = Number(value?.observed ?? 0);
  if (observed <= 0) return null;
  return {
    observed,
    routineAllowed: Number(value?.routineAllowed ?? 0),
    prompted: Number(value?.prompted ?? 0),
    denied: Number(value?.denied ?? 0),
    escalated: Number(value?.escalated ?? 0),
    protectedActions: Number(value?.protectedActions ?? 0),
  };
}

function sourcePermissionBoundarySummary(value, episodeId) {
  const protectedActions = Number(value?.protectedActions ?? 0);
  if (protectedActions <= 0) return null;
  return {
    prompted: Number(value?.prompted ?? 0),
    denied: Number(value?.denied ?? 0),
    escalated: Number(value?.escalated ?? 0),
    protectedActions,
    evidenceRefs: publicEvidenceRefs(value?.evidenceRefs, `${episodeId}-permission-summary`).slice(0, 3),
  };
}

const INSIGHT_FACET_KIND = new Map([
  ["planning-workflow", "goal-workflow"],
  ["execution-friction", "friction-taxonomy"],
  ["post-edit-validation", "rework-correction"],
]);

function insightSemanticFacets(insights = {}, locale = "en", { includeUsage = false } = {}) {
  const cards = rows(insights?.cards).filter((card) => includeUsage || card?.id !== "session-usage-efficiency");
  const facets = cards.map((card, index) => ({
    id: `session-insight:${String(card?.id ?? index + 1)}`,
    schemaVersion: 1,
    kind: INSIGHT_FACET_KIND.get(card?.id) ?? "redacted-summary",
    status: "candidate",
    labels: [String(card?.id ?? "session-insight"), String(card?.confidence ?? "Unknown")],
    summary: [card?.finding, card?.behaviorChange].filter(Boolean).join(" "),
    evidenceRefs: publicEvidenceRefs(card?.evidenceRefs, `session-insight-${index + 1}`),
    modelVersion: "session-insights-v1",
  }));
  if (!includeUsage) return facets;
  const usage = insights?.keySignals?.usageEfficiency;
  const summary = sessionUsageOverview(usage, locale);
  if (!summary) return facets;
  const id = "session-insight:session-usage-efficiency";
  const existing = facets.find((facet) => facet.id === id);
  if (existing) {
    existing.summary = summary;
    return facets;
  }
  facets.push({
    id,
    schemaVersion: 1,
    kind: "redacted-summary",
    status: "candidate",
    labels: ["session-usage-efficiency", String(insights?.sample?.confidence ?? "Low")],
    summary,
    evidenceRefs: publicEvidenceRefs(usage?.candidates?.[0]?.evidenceRefs, `session-insight-${facets.length + 1}`),
    modelVersion: "session-insights-v1",
  });
  return facets;
}

function sourceEpisode(episode) {
  const id = String(episode?.id ?? "episode-unobserved");
  const closure = episode?.closure ?? { status: "unobserved" };
  const repair = episode?.repair ?? { status: "unobserved" };
  const episodeEvidence = boundedEpisodeEvidenceRefs(episode?.evidenceRefs, `${id}-episode`);
  const targetKeyFor = (value) => stableFingerprint({ target: String(value ?? "").replaceAll("\\", "/").trim() }, 20);
  const targetKeys = [...new Set(rows(episode?.changeSets)
    .flatMap((change) => rows(change?.paths))
    .map((value) => String(value ?? "").replaceAll("\\", "/").trim())
    .filter(Boolean)
    .map(targetKeyFor))].slice(0, 12);
  const lifecycleSignals = rows(episode?.lifecycleSignals).flatMap((signal, index) => {
    const intent = String(signal?.intent ?? "").toLowerCase().replace(/[^a-z0-9-]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 80);
    if (!intent) return [];
    const token = (value, fallback = "unknown") => String(value ?? fallback)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 80) || fallback;
    return [{
      schemaVersion: Number(signal?.schemaVersion ?? 1),
      intent,
      family: token(signal?.family),
      dimensionId: token(signal?.dimensionId),
      checkId: token(signal?.checkId),
      confidence: token(signal?.confidence, "medium"),
      scope: token(signal?.scope, "workspace"),
      ...(signal?.host ? { host: token(signal.host) } : {}),
      evidenceRefs: publicEvidenceRefs(signal?.evidenceRefs, `${id}-lifecycle-${index + 1}`),
    }];
  });
  const lifecycleIntents = [...new Set(lifecycleSignals.map((signal) => signal.intent))];
  const permissionSummary = sourcePermissionBoundarySummary(episode?.permissionSummary, id);
  return {
    id,
    sessionCount: Number(episode?.sessionCount ?? 1),
    continuation: episode?.continuation ?? "session-bounded",
    startBoundary: episode?.startBoundary ?? "unknown",
    changeSets: rows(episode?.changeSets).map((change, index) => ({
      id: String(change?.id ?? `${id}:change-${index + 1}`),
      eventCount: Number(change?.eventCount ?? 0),
      firstOrdinal: Number(change?.firstOrdinal ?? 0),
      lastOrdinal: Number(change?.lastOrdinal ?? 0),
      targetKeys: [...new Set(rows(change?.paths).filter(Boolean).map(targetKeyFor))].slice(0, 12),
      evidenceRefs: publicEvidenceRefs(change?.evidenceRefs, `${id}-change-${index + 1}`),
    })),
    validationSets: rows(episode?.validationSets).map((validation, index) => ({
      id: String(validation?.id ?? `${id}:validation-${index + 1}`),
      category: String(validation?.category ?? "unknown").slice(0, 80),
      status: validation?.status ?? "observed",
      ordinal: Number(validation?.ordinal ?? index),
      checkIdentity: String(validation?.checkIdentity ?? `check:${stableFingerprint({ id, index }, 24)}`),
      targetKeys: [...new Set(rows(validation?.targetPaths).filter(Boolean).map(targetKeyFor))].slice(0, 12),
      evidenceRefs: publicEvidenceRefs(validation?.evidenceRefs, `${id}-validation-${index + 1}`),
    })),
    closure: {
      status: closure.status ?? "unobserved",
      evidenceRefs: publicEvidenceRefs(closure.evidenceRefs, `${id}-closure`),
    },
    repair: {
      status: repair.status ?? "unobserved",
      evidenceRefs: publicEvidenceRefs(repair.evidenceRefs, `${id}-repair`),
      candidates: rows(repair?.candidates).map((candidate, index) => ({
        id: String(candidate?.id ?? `${id}:repair-${index + 1}`),
        failureValidationRef: String(candidate?.failureValidationRef ?? ""),
        rerunValidationRef: String(candidate?.rerunValidationRef ?? ""),
        failureCheckIdentity: String(candidate?.failureCheckIdentity ?? ""),
        rerunCheckIdentity: String(candidate?.rerunCheckIdentity ?? ""),
        sameCheck: candidate?.sameCheck === true,
        repairOrdinal: Number(candidate?.repairOrdinal ?? 0),
        evidenceRefs: publicEvidenceRefs(candidate?.evidenceRefs, `${id}-repair-candidate-${index + 1}`),
      })),
    },
    elapsedMs: Number(episode?.elapsedMs ?? 0),
    toolCalls: Number(episode?.toolCalls ?? 0),
    ...(lifecycleIntents.length === 1 ? { taskRoute: `lifecycle:${lifecycleIntents[0]}` } : {}),
    lifecycleSignals,
    ...(permissionSummary ? { permissionSummary } : {}),
    learningSignals: rows(episode?.learningSignals).map((signal, index) => ({
      ...signal,
      evidenceRefs: publicEvidenceRefs(signal?.evidenceRefs, `${id}-learning-${index + 1}`),
    })),
    targetKeys,
    eventEvidenceCount: episodeEvidence.count,
    evidenceRefs: uniqueByJson([
      { kind: "task-episode", id },
      ...episodeEvidence.references,
    ]),
  };
}

function episodeHasReportSignal(episode) {
  const meaningfulStatus = (status) => Boolean(status) && !["unobserved", "not-applicable"].includes(status);
  return rows(episode?.changeSets).length > 0
    || rows(episode?.validationSets).length > 0
    || Number(episode?.permissionSummary?.protectedActions ?? 0) > 0
    || meaningfulStatus(episode?.closure?.status)
    || meaningfulStatus(episode?.repair?.status)
    || rows(episode?.lifecycleSignals).length > 0
    || rows(episode?.closure?.evidenceRefs).length > 0
    || rows(episode?.repair?.evidenceRefs).length > 0;
}

function latestEpisodeId(episodes) {
  return String(rows(episodes).at(-1)?.id ?? "") || null;
}

function focusedCheckEvidence(episodes) {
  return episodes
    .filter((episode) => episode?.closure?.status === "closed")
    .map((episode) => ({
      id: `${episode.id}:relevant-check`,
      episodeRef: episode.id,
      level: "relevant-focused-checks-passed",
      status: "passed",
      evidenceRefs: episode.closure.evidenceRefs,
    }));
}

export function buildTaskLoopSourceCandidate({
  scope = {},
  sources = [],
  warnings = [],
  selection = {},
  events = [],
  projectName = "Harness task-loop report",
  locale = "en",
  adapterVersion = TASK_LOOP_SOURCE_ADAPTER_VERSION,
  insights = {},
  repositoryEvidence = {},
  interventionLedger = [],
  priorLearningCaptureEvidenceRef = null,
  includeUsage = false,
  memoryInventory,
} = {}) {
  const readerLocale = normalizeReaderLocale(locale);
  const episodeAnalysis = buildTaskEpisodes(
    rows(events),
    { platform: scope.platform },
  );
  const currentEpisodeId = latestEpisodeId(episodeAnalysis.episodes);
  const taskEpisodes = episodeAnalysis.episodes
    .filter(episodeHasReportSignal)
    .map((episode) => sourceEpisode(episode));
  const retainedCurrentEpisodeId = taskEpisodes.some((episode) => episode.id === currentEpisodeId)
    ? currentEpisodeId
    : null;
  const discardedEpisodeCount = episodeAnalysis.episodes.length - taskEpisodes.length;
  const permissionSummary = sourcePermissionCoverageSummary(episodeAnalysis.permissionSummary);
  const manifest = buildObservationManifest({
    scope,
    sources,
    warnings,
    eligibleCount: Number(selection.eligibleCount ?? 0),
    analyzedCount: Number(selection.analyzedCount ?? 0),
    selectionStrategy: selection.strategy ?? "stratified",
    selectionStrata: selection.strata ?? [],
    selectionPlan: selection.plan ?? null,
    adapterVersion,
  });

  const semanticFacets = insightSemanticFacets(insights, readerLocale, { includeUsage });
  const usageSummary = includeUsage
    ? projectSessionUsageSummary(insights?.keySignals?.usageEfficiency, selection.eligibleCount, scope)
    : null;
  const learningCaptureDiagnostics = repositoryEvidence?.learningCaptureDiagnostics
    ?? learningCaptureDiagnosticsCandidate(insights, repositoryEvidence, interventionLedger, taskEpisodes, memoryInventory, scope.platform);
  const workflowDemandDiagnostics = buildWorkflowDemandDiagnostics({
    taskEpisodes,
    currentEpisodeId: retainedCurrentEpisodeId,
    reusableSkillEvidence: repositoryEvidence?.learningCaptureEvidence?.reusableSkillEvidence,
    skillActivity: {
      observedSkills: learningCaptureDiagnostics?.signals?.observedSkills ?? [],
      unscopedObservedSkills: learningCaptureDiagnostics?.signals?.unscopedObservedSkills ?? [],
      apparentSkillReads: learningCaptureDiagnostics?.signals?.apparentSkillReads ?? [],
    },
  });
  return createHarnessReportSource({
    manifest,
    repositoryEvidence: {
      projectName,
      locale: readerLocale,
      ...repositoryEvidence,
      diagnosticCoverageReviews: rows(repositoryEvidence?.diagnosticCoverageReviews).length > 0
        ? rows(repositoryEvidence.diagnosticCoverageReviews)
        : [{
            id: "core-diagnostic-coverage",
            status: "review-required",
            affectedScope: "repository-wide",
            summary: "Review affected core or high-impact chains for readable logging and stable correlation before projection.",
            evidenceRefs: [],
          }],
      learningCaptureDiagnostics,
      workflowDemandDiagnostics,
    },
    sessionEvents: {
      sourceAdapter: TASK_LOOP_SOURCE_ADAPTER_VERSION,
      ...(retainedCurrentEpisodeId ? { currentEpisodeRef: retainedCurrentEpisodeId } : {}),
      selectedSessionCount: Number(selection.analyzedCount ?? 0),
      candidateEpisodeCount: taskEpisodes.length,
      discardedEpisodeCount,
      ...(permissionSummary ? { permissionSummary } : {}),
      ...(includeUsage && insights?.keySignals?.usageEfficiency?.activity
        ? { usageActivity: insights.keySignals.usageEfficiency.activity }
        : {}),
      ...(usageSummary ? { usageEfficiency: usageSummary } : {}),
    },
    taskEpisodes,
    deliveryEvidence: focusedCheckEvidence(taskEpisodes),
    semanticFacets,
    interventionLedger: rows(interventionLedger),
    evidenceRefs: [
      { kind: "session-selection", id: "bounded-selection" },
      ...(priorLearningCaptureEvidenceRef ? [priorLearningCaptureEvidenceRef] : []),
    ],
    assessmentDecisions: [{
      kind: "source-candidate",
      status: "requires-review",
      adapter: TASK_LOOP_SOURCE_ADAPTER_VERSION,
      evidenceRefs: [],
    }, {
      kind: "repository-review",
      status: "requires-review",
      owner: "agent-work-loop-combined-walkthrough",
      learningCaptureFindingPolicy: LEARNING_CAPTURE_FINDING_POLICY,
      requiredFrameworks: [...REQUIRED_REVIEW_FRAMEWORKS],
      reviewedFrameworks: REQUIRED_REVIEW_FRAMEWORKS.map((id) => ({ id, status: "requires-review", summary: "", evidenceRefs: [] })),
      requiredChecks: [...REQUIRED_REPOSITORY_CHECKS],
      reviewedChecks: REQUIRED_REPOSITORY_CHECKS.map((id) => ({
        id,
        status: "requires-review",
        summary: "",
        evidenceRefs: [],
      })),
      requiredSoftwareFluencyCapabilities: [...REQUIRED_SOFTWARE_FLUENCY_CAPABILITIES],
      reviewedSoftwareFluencyCapabilities: REQUIRED_SOFTWARE_FLUENCY_CAPABILITIES.map((id) => ({ id, status: "requires-review", summary: "", evidenceRefs: [] })),
    }, {
      kind: "score-review",
      status: "requires-review",
      modelId: AGENT_WORK_LOOP_MODEL_ID,
      calibration: "agent-work-loop-ai-v2",
      dimensions: AGENT_WORK_LOOP_DIMENSIONS.map((dimension) => ({
        id: dimension.id,
        score: null,
        confidence: "",
        reason: "",
        readerSummary: "",
        evidenceRefs: [],
      })),
    }, {
      kind: "session-insights",
      status: semanticFacets.length > 0 ? "candidate" : "unavailable",
      analyzedSessionCount: Number(insights?.sample?.analyzedSessionCount ?? selection.analyzedCount ?? 0),
      cardCount: semanticFacets.length,
    }],
  });
}

export async function collectAgentLintPracticeEvidence(options = {}) {
  const provider = options.platform ?? "qoder";
  const assetReviewSupported = ["qoder", "codex", "claude", "cursor", "qwen", "copilot", "pi"].includes(provider);
  const common = {
    workspace: options.workspace,
    provider,
    qoderHome: options.qoderHome ?? options["qoder-home"],
    codexHome: options.codexHome ?? options["codex-home"],
    claudeHome: options.claudeHome ?? options["claude-home"],
    cursorHome: options.cursorHome ?? options["cursor-home"],
    qwenHome: options.qwenHome ?? options["qwen-home"],
    copilotHome: options.copilotHome ?? options["copilot-home"],
    piHome: options.piHome ?? options["pi-home"],
    topology: options.topology,
    analysisScope: options.analysisScope,
  };
  const [instructionReview, assetReview, practiceInventory] = await Promise.all([
    runAgentLint({ ...common, profile: "agents-md-review" }),
    assetReviewSupported
      ? runAgentLint({ ...common, profile: "agent-assets-review" })
      : Promise.resolve({
          kind: "agent-lint",
          profile: "agent-assets-review",
          summary: {},
          findings: [],
        }),
    options.practiceInventory ? Promise.resolve(options.practiceInventory) : Promise.resolve(null),
  ]);
  const integrityReview = practiceInventory
    ? reviewAssetIntegrity(practiceInventory, { locale: normalizeReaderLocale(options.language) })
    : undefined;
  const projected = projectAgentLintPracticeEvidence({
    instructionReview,
    assetReview,
    integrityReview,
    locale: normalizeReaderLocale(options.language),
    provider,
    topology: options.topology,
  });
  if (!assetReviewSupported) {
    const assetReviewProjection = projected.reviews.find((review) => review.profile === "agent-assets-review");
    if (assetReviewProjection) {
      assetReviewProjection.status = "unavailable";
      assetReviewProjection.summary = `Agent asset inventory is not available for ${provider}.`;
      assetReviewProjection.evidenceRefs = [];
    }
  }
  Object.defineProperty(projected, "evaluationInput", {
    value: { instructionReview, assetReview, integrityReview },
    enumerable: false,
  });
  return projected;
}

export function collectTaskLoopPracticeInventory(options = {}, platform = options.platform ?? "qoder") {
  if (options.practiceInventory) return Promise.resolve(options.practiceInventory);
  const includeGlobalCapabilities = options.includeGlobalCapabilities === true
    || options["include-global-capabilities"] === true;
  if (platform === "qoder") {
    return collectQoderInventory({
      workspace: options.workspace,
      includeUserHome: includeGlobalCapabilities,
      includeGlobalHooks: true,
      // Project-scoped Memory is part of the normal repository packet. The
      // explicit global-capability route only widens this inventory to global
      // Memory/config metadata; it must not disable current-project Memory.
      includeMemories: true,
      qoderHome: options.qoderHome ?? options["qoder-home"],
      sharedCache: options.sharedCache ?? options["shared-cache"],
    });
  }
  if (platform === "codex") {
    return collectProviderInventory({
      platform,
      workspace: options.workspace,
      includeUserHome: includeGlobalCapabilities,
      includeGlobalHooks: true,
      includeMemories: includeGlobalCapabilities,
      codexHome: options.codexHome ?? options["codex-home"],
      codexAppPath: options.codexAppPath ?? options["codex-app-path"],
    });
  }
  if (platform === "cursor") {
    return collectProviderInventory({
      platform,
      workspace: options.workspace,
      includeUserHome: includeGlobalCapabilities,
      includeGlobalHooks: true,
      includeMemories: false,
      cursorHome: options.cursorHome ?? options["cursor-home"],
    });
  }
  if (platform === "claude") {
    return collectProviderInventory({
      platform,
      workspace: options.workspace,
      includeUserHome: includeGlobalCapabilities,
      includeGlobalHooks: true,
      includeMemories: false,
      claudeHome: options.claudeHome ?? options["claude-home"],
      claudeStatePath: options.claudeStatePath ?? options["claude-state"],
    });
  }
  if (platform === "qwen") {
    return collectProviderInventory({
      platform,
      workspace: options.workspace,
      includeUserHome: includeGlobalCapabilities,
      includeGlobalHooks: true,
      includeMemories: false,
      qwenHome: options.qwenHome ?? options["qwen-home"],
    });
  }
  if (platform === "pi") {
    return collectProviderInventory({
      platform,
      workspace: options.workspace,
      includeUserHome: includeGlobalCapabilities,
      includeGlobalHooks: true,
      includeMemories: false,
      piHome: options.piHome ?? options["pi-home"],
    });
  }
  return Promise.resolve(null);
}

function parseArgs(argv) {
  const options = {
    platform: "qoder",
    limit: DEFAULT_LIMIT,
    selection: "stratified",
    language: "en",
    json: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "-h") {
      options.help = true;
      continue;
    }
    if (value === "--no-include-usage") {
      options["include-usage"] = false;
      continue;
    }
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    if (["json", "include-usage", "include-global-capabilities"].includes(key)) {
      options.json = true;
      if (key !== "json") options[key] = true;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`${value} requires a value`);
    options[key] = next;
    index += 1;
  }
  options.language = normalizeReaderLocale(options.language);
  return options;
}

export function standardUsageEnabled(options = {}) {
  return options["include-usage"] === true || options.includeUsage === true;
}

export async function loadCustomizationCheckupScan(filePath, { provider, workspace } = {}) {
  if (!filePath) return null;
  const scan = JSON.parse(await readFile(path.resolve(filePath), "utf8"));
  const evidence = projectCheckupReportEvidence(scan);
  if (provider && evidence.provider !== provider) {
    throw new Error(`--checkup-scan provider ${evidence.provider} does not match report platform ${provider}`);
  }
  const workspaceLabel = workspace ? path.basename(path.resolve(workspace)) : null;
  if (workspaceLabel && evidence.workspace !== workspaceLabel) {
    throw new Error(`--checkup-scan workspace ${evidence.workspace} does not match report workspace ${workspaceLabel}`);
  }
  return evidence;
}

export function assertStandardUsageComplete(source, selection, includeUsage = true) {
  if (!includeUsage || Number(selection?.eligibleCount ?? 0) === 0) return;
  const missing = ["usageActivity", "usageEfficiency"].filter((field) => !source?.sessionEvents?.[field]);
  if (missing.length > 0) {
    throw new Error(`standard usage census is incomplete: missing ${missing.join(" and ")}`);
  }
  const eligibleCount = Number(selection.eligibleCount);
  const activitySessionCount = Number(source.sessionEvents.usageActivity?.sessions?.total);
  const usageSelection = source.sessionEvents.usageEfficiency?.selection;
  if (activitySessionCount !== eligibleCount
    || usageSelection?.strategy !== "all-eligible"
    || usageSelection?.eligibleSessionCount !== eligibleCount
    || usageSelection?.analyzedSessionCount !== eligibleCount
    || usageSelection?.complete !== true) {
    throw new Error(
      `standard usage census population mismatch: expected ${eligibleCount}/${eligibleCount} all-eligible sessions, activity=${activitySessionCount}, usage=${usageSelection?.analyzedSessionCount ?? "missing"}/${usageSelection?.eligibleSessionCount ?? "missing"}`,
    );
  }
}

export async function createTaskLoopSourceFromSessions(options = {}) {
  const language = normalizeReaderLocale(options.language);
  const includeUsage = standardUsageEnabled(options);
  const selectionProfile = options["selection-profile"]
    ? await readSessionSelectionProfile(path.resolve(options["selection-profile"]))
    : null;
  const selectionPlan = options["selection-plan"]
    ? await readSessionSelectionPlan(path.resolve(options["selection-plan"]))
    : null;
  const selectionSnapshot = options["selection-snapshot"]
    ? await readSessionSelectionSnapshot(path.resolve(options["selection-snapshot"]))
    : null;
  if (Boolean(selectionProfile) !== Boolean(selectionPlan)) {
    throw new Error("--selection-profile and --selection-plan must be provided together");
  }
  if (selectionSnapshot && !selectionProfile) {
    throw new Error("--selection-snapshot requires --selection-profile and --selection-plan");
  }
  const platform = selectionProfile?.scope?.platform ?? options.platform ?? "qoder";
  if (options.platform && selectionProfile?.scope?.platform && options.platform !== selectionProfile.scope.platform) {
    throw new Error("--platform does not match the supplied session selection profile");
  }
  const analyzer = options.analyzer ?? await createAnalyzer(platform);
  const snapshotUntil = selectionProfile?.scope?.until
    ?? options.until
    ?? options.snapshotUntil
    ?? new Date().toISOString();
  const analyzerOptions = {
    platform,
    workspace: options.workspace,
    home: options.home,
    since: selectionProfile?.scope?.since ?? options.since,
    until: snapshotUntil,
    qoderHome: options.qoderHome ?? options["qoder-home"],
    codexHome: options.codexHome ?? options["codex-home"],
    claudeHome: options.claudeHome ?? options["claude-home"],
    cursorHome: options.cursorHome ?? options["cursor-home"],
    qwenHome: options.qwenHome ?? options["qwen-home"],
    copilotHome: options.copilotHome ?? options["copilot-home"],
    piHome: options.piHome ?? options["pi-home"],
    includeGlobalCapabilities: options.includeGlobalCapabilities
      ?? options["include-global-capabilities"]
      ?? false,
    topology: options.topology,
    analysisScope: options.analysisScope,
  };
  const discovery = await analyzer.analyze({ ...analyzerOptions, command: "sources" });
  const sessionInventory = Object.freeze(discovery.sessions.map((session) => Object.freeze(structuredClone(session))));
  if (selectionProfile) {
    assertSessionSelectionBinding(selectionProfile, selectionPlan, { eligibleCount: sessionInventory.length });
  }
  const selectionEntries = selectionSnapshot
    ? restoreSessionSelectionEntries(selectionProfile, selectionSnapshot, sessionInventory)
    : null;
  const scope = await analyzer.resolveScope(analyzerOptions);
  const insightResult = await analyzer.analyze({
    ...analyzerOptions,
    command: "insights",
    limit: selectionPlan?.limit ?? options.limit ?? DEFAULT_LIMIT,
    selection: options.selection ?? "stratified",
    selectionPlan,
    selectionEntries,
    sessionInventory,
    selectionConcurrency: options["selection-concurrency"] ?? 4,
  });
  const selected = selectionPlan
    ? {
        ...insightResult.selection,
        sessions: sessionInventory.filter((session) =>
          insightResult.sessions.some((selectedSession) => selectedSession.sessionId === session.sessionId)),
      }
    : selectSessions(sessionInventory, {
        limit: options.limit ?? DEFAULT_LIMIT,
        strategy: options.selection ?? "stratified",
        defaultLimit: DEFAULT_LIMIT,
      });
  const batches = await Promise.all(selected.sessions.map((session) => analyzer.readSession(session, scope, {
    includeCommandText: true,
    includeUserText: true,
  })));
  const reportInsights = includeUsage
    ? mergeUsageCensusInsights(
        insightResult.insights,
        (await analyzer.analyze({
          ...analyzerOptions,
          command: "insights",
          limit: DEFAULT_USAGE_CENSUS_LIMIT,
          selection: "all-eligible",
          sessionInventory,
        })).insights,
      )
    : insightResult.insights;
  const sensitiveConfigFiles = await collectTrackedSensitiveConfigFiles(
    options.workspace,
    undefined,
    undefined,
    options.analysisScope,
    options.topology,
  );
  const secretScan = sensitiveConfigFiles.files.length > 0
    ? await scanPaths(sensitiveConfigFiles.files, {
        cwd: options.workspace,
        containmentRoot: options.workspace,
        failOn: "high",
        redact: true,
      })
    : { findings: [], summary: { totalFindings: 0 } };
  const repositoryEvidence = scanTaskLoopRepositoryEvidence({
    workspace: options.workspace,
    analysisScope: options.analysisScope,
    topology: options.topology,
    locale: language,
    insights: insightResult.insights,
    secretScan,
  });
  if (options.topology) {
    repositoryEvidence.findingTarget = findingTargetFromTopology(options.topology);
  }
  const scanReadErrorCount = rows(secretScan?.stats?.errors).length;
  const scanSkippedCount = Number(secretScan?.stats?.skippedFiles ?? 0);
  repositoryEvidence.secretScanCoverage = {
    status: sensitiveConfigFiles.truncated || sensitiveConfigFiles.skippedCount > 0 || sensitiveConfigFiles.errorCount > 0 || scanSkippedCount > 0 || scanReadErrorCount > 0
      ? "partial"
      : "complete",
    candidateCount: sensitiveConfigFiles.candidateCount,
    scannedFileCount: Number(secretScan?.stats?.scannedFiles ?? 0),
    skippedFileCount: sensitiveConfigFiles.skippedCount + scanSkippedCount,
    errorCount: sensitiveConfigFiles.errorCount + scanReadErrorCount,
    truncated: sensitiveConfigFiles.truncated,
  };
  const includeGlobalCapabilities = options.includeGlobalCapabilities === true
    || options["include-global-capabilities"] === true;
  const practiceInventoryPromise = collectTaskLoopPracticeInventory(options, platform);
  const practiceEvidence = await collectAgentLintPracticeEvidence({
    ...options,
    language,
    practiceInventory: practiceInventoryPromise,
  });
  const existingFindingIds = new Set(rows(repositoryEvidence.findings).map((finding) => String(finding?.id ?? "")));
  repositoryEvidence.findings = [
    ...practiceEvidence.findings.filter((finding) => !existingFindingIds.has(finding.id)),
    ...rows(repositoryEvidence.findings),
  ];
  repositoryEvidence.codingAgentPracticeReviews = practiceEvidence.reviews;
  if (options["checkup-scan"]) {
    repositoryEvidence.customizationCheckup = await loadCustomizationCheckupScan(options["checkup-scan"], {
      provider: platform,
      workspace: options.workspace,
    });
  }
  const practiceInventory = await practiceInventoryPromise;
  if (practiceInventory) {
    const practiceCoverageRows = projectPracticeCoverageRows(
      practiceInventory,
      includeGlobalCapabilities,
    );
    if (practiceCoverageRows.length > 0) {
      repositoryEvidence.aiAgentPractice = {
        ...(repositoryEvidence.aiAgentPractice ?? {}),
        coverageRows: practiceCoverageRows,
      };
    }
  }
  const priorLearningCaptureState = await loadPriorLearningCaptureState({
    workspace: options.workspace,
    previousFindings: options["previous-findings"],
  });
  const source = buildTaskLoopSourceCandidate({
    scope: discovery.scope,
    sources: discovery.sources,
    warnings: [
      ...rows(discovery.warnings),
      ...(repositoryEvidence.secretScanCoverage.status === "partial" ? [{ code: "partial-secret-scan-coverage" }] : []),
      ...(priorLearningCaptureState.warning ? [priorLearningCaptureState.warning] : []),
    ],
    selection: selected,
    events: batches.flat(),
    projectName: path.basename(path.resolve(options.workspace)),
    locale: language,
    adapterVersion: `${platform}-${TASK_LOOP_SOURCE_ADAPTER_VERSION}`,
    insights: reportInsights,
    repositoryEvidence,
    interventionLedger: priorLearningCaptureState.interventionLedger,
    priorLearningCaptureEvidenceRef: priorLearningCaptureState.evidenceRef,
    includeUsage,
    memoryInventory: practiceInventory?.memories ?? { included: false, categories: [] },
  });
  assertStandardUsageComplete(source, selected, includeUsage);
  return { source, selection: selected };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  if (!options.workspace) throw new Error("--workspace is required");
  if (!options.source) throw new Error("--source is required");
  const { source, selection } = await createTaskLoopSourceFromSessions(options);
  const sourcePath = path.resolve(options.source);
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, `${JSON.stringify(source, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    status: "candidate",
    source: sourcePath,
    selection: {
      strategy: selection.strategy,
      eligibleCount: selection.eligibleCount,
      analyzedCount: selection.analyzedCount,
      strata: selection.strata,
      ...(selection.plan ? { plan: selection.plan } : {}),
    },
    taskEpisodeCount: source.taskEpisodes.length,
    focusedCheckCount: source.deliveryEvidence.length,
    semanticFacetCount: source.semanticFacets.length,
  })}\n`);
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    process.stderr.write(`task-loop source failed: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
