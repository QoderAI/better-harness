import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { projectCheckupReportEvidence } from "../../scripts/coding-agent-practices/checkup/contract.mjs";
import { buildCheckupScan } from "../../scripts/coding-agent-practices/checkup/scan.mjs";
import { createHarnessReportSource, validateHarnessReportSource } from "../../scripts/harness-analysis/report-source.mjs";
import { normalizeReportData } from "../../scripts/harness-analysis/report-data-schema.mjs";
import { evaluateBetterHarnessArtifacts, renderBetterHarnessReportCanvas } from "../../scripts/harness-analysis/renderers/better-harness.mjs";
import { evaluateHtmlReport, renderHtml } from "../../scripts/harness-analysis/renderers/html.mjs";
import { renderMarkdown } from "../../scripts/harness-analysis/renderers/markdown.mjs";
import {
  mergeTaskLoopCanvasData,
  projectTaskLoopReportFacts,
  projectTaskLoopFindings,
  repairProgressFromFindings,
  taskLoopCanvasFromSummaryFacts,
  reconcileTaskLoopFindingLinks,
  splitTaskLoopFindings,
  validateCompactTaskLoopFindings,
  validateTaskLoopCanvasSplit,
  validateTaskLoopFindings,
} from "../../scripts/harness-analysis/task-loop-report.mjs";
import { validateHarnessCanvasArtifacts } from "../../scripts/harness-analysis/validate-canvas.mjs";
import { recordFixOutput } from "../../scripts/harness-analysis/record-fix-output.mjs";
import { AGENT_WORK_LOOP_LOW_SCORE_FINDING_THRESHOLD } from "../../scripts/harness-analysis/score-finding-consistency.mjs";
import { buildObservationManifest } from "../../scripts/session-analysis/observation-manifest.mjs";
import { projectAgentLintPracticeEvidence } from "../../scripts/harness-analysis/practice-findings.mjs";
import { buildWorkflowDemandDiagnostics } from "../../scripts/harness-analysis/workflow-demand-diagnostics.mjs";
import { buildTaskLoopRepositoryEvidence } from "../../scripts/harness-analysis/task-loop-repository-evidence.mjs";
import { buildLearningLoopReview } from "../../scripts/harness-analysis/learning-loop-candidates.mjs";
import {
  LEARNING_CAPTURE_REVIEWED_SCORE_FLOOR,
} from "../../scripts/harness-analysis/fluency-dimensions.mjs";

function ref(id) {
  return { kind: "fixture", id };
}

function assignmentSummary(overrides = {}) {
  return {
    locale: "en",
    title: "The finding now has a verified reader result",
    body: "The finding-bound fix updated its owner and passed the focused validation, so the stored result can be displayed directly.",
    ...overrides,
  };
}

function diagnosticReview(overrides = {}) {
  const review = {
    id: "core-chain",
    status: "covered",
    affectedScope: "core/transport/**",
    summary: "The representative core transport chain has readable correlated diagnostics.",
    evidenceRefs: [ref("core-diagnostic-review")],
    ...overrides,
  };
  if (review.status === "confirmed-gap") {
    review.expectedArtifact ??= "Code";
    review.expectedOutput ??= ["Update the owning Code so the bounded diagnostic chain retains one reviewable result."];
  }
  return review;
}

function learningReview(overrides = {}) {
  const defaults = {
    recurringIssue: {
      id: "lifecycle-repeat-detection",
      status: "reviewed",
      state: "Exercised",
      summary: "Two bounded episodes show the same review omission.",
      evidenceRefs: [
        { kind: "task-episode", id: "episode:1111111111111111" },
        { kind: "task-episode", id: "episode:2222222222222222" },
      ],
      findingRefs: [],
    },
    reusableCapture: {
      id: "loop-engineering",
      status: "reviewed",
      state: "Exercised",
      mechanisms: ["hook"],
      summary: "A validated project Hook is the reusable owner.",
      evidenceRefs: [ref("review-flow-skill")],
      findingRefs: [],
    },
    laterValidation: {
      id: "later-validation",
      status: "reviewed",
      state: "Wired",
      summary: "A later comparable review task has not been observed yet.",
      evidenceRefs: [ref("bounded-selection")],
      findingRefs: [],
    },
  };
  return {
    recurringIssue: { ...defaults.recurringIssue, ...overrides.recurringIssue },
    reusableCapture: { ...defaults.reusableCapture, ...overrides.reusableCapture },
    laterValidation: { ...defaults.laterValidation, ...overrides.laterValidation },
  };
}

function learningCheck(source, id) {
  return source.assessmentDecisions.find((decision) => decision.kind === "repository-review")
    .reviewedChecks.find((row) => row.id === id);
}

function setLearningReview(source, overrides = {}) {
  if (overrides.recurringIssue) Object.assign(learningCheck(source, "lifecycle-repeat-detection"), overrides.recurringIssue);
  if (overrides.reusableCapture) Object.assign(learningCheck(source, "loop-engineering"), overrides.reusableCapture);
  if (overrides.laterValidation) Object.assign(learningCheck(source, "later-validation"), overrides.laterValidation);
  return source;
}

function attachRepeatedWorkflowDemand(source, intent = "specification-review") {
  for (const episode of source.taskEpisodes) {
    episode.lifecycleSignals = [{
      intent,
      scope: "workspace",
      host: "qoder",
      confidence: "high",
      evidenceRefs: [{ kind: "fixture-event", id: `${episode.id}-${intent}` }],
    }];
  }
  source.repositoryEvidence.learningCaptureEvidence ??= buildTaskLoopRepositoryEvidence({
    trackedFiles: [],
    fileContents: {},
  }).learningCaptureEvidence;
  source.repositoryEvidence.workflowDemandDiagnostics = buildWorkflowDemandDiagnostics({
    taskEpisodes: source.taskEpisodes,
    reusableSkillEvidence: source.repositoryEvidence.learningCaptureEvidence.reusableSkillEvidence,
  });
  return source.repositoryEvidence.workflowDemandDiagnostics.repeatedCandidates[0];
}

function intervention({
  id = "hook-block-1",
  state = "pending",
  taskMix = "unverified",
  selectionStrategy = "all-eligible",
  primaryValue,
  guardrailValue,
  effectiveness,
  outcomeEvidenceRefs,
  assetType = "hook",
  assetLabel = "Protected change hook",
} = {}) {
  return {
    id,
    schemaVersion: 1,
    episodeRef: "episode:1111111111111111",
    frictionRefs: [ref("hook-block-1")],
    candidateCauses: [
      { kind: "harness", state: "candidate", evidenceRefs: [ref("hook-policy")] },
      { kind: "repository", state: "candidate", evidenceRefs: [ref("delivery-route")] },
    ],
    asset: { type: assetType, label: assetLabel },
    owner: "delivery-owner",
    baseline: {
      windowRef: "baseline-window",
      primaryValue: 8,
      guardrailValue: 0.1,
      evidenceRefs: [ref("baseline-window")],
    },
    primaryMetric: { id: "rework-rate", direction: "lower-is-better", unit: "ratio" },
    guardrailMetric: { id: "false-positive-rate", direction: "lower-is-better", unit: "ratio" },
    comparisonWindow: {
      laterWindowRef: "later-window",
      scope: "same protected-change task type",
      taskMix,
      selectionStrategy,
    },
    validation: { method: "compare redacted task episodes", evidenceRefs: [ref("comparison-method")] },
    stopOrRevertCondition: "Revert when the false-positive guardrail worsens.",
    result: {
      state,
      ...(state === "pending" ? {} : {
        primaryValue,
        guardrailValue,
        evidenceRefs: [ref("later-window")],
        ...(outcomeEvidenceRefs ? { outcomeEvidenceRefs } : {}),
        ...(effectiveness ? { effectiveness } : {}),
      }),
    },
  };
}

async function withTempDir(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-task-loop-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function memberTopology(gitRoot, memberRoute) {
  const members = ["packages/a", "packages/b"].map((route) => ({
    route,
    kind: "manifest",
    discoveredBy: ["package.json"],
  }));
  return {
    kind: "better-harness.workspace-topology",
    schemaVersion: 1,
    status: "complete",
    requestedWorkspace: path.join(gitRoot, ...memberRoute.split("/")),
    gitRoot,
    target: {
      kind: "workspace-member",
      route: memberRoute,
      memberRoute,
      memberMatch: "exact",
    },
    members: {
      items: members,
      total: members.length,
      omitted: 0,
      truncated: false,
    },
    instructionScopes: { items: [], total: 0, omitted: 0, truncated: false },
    discovery: {
      tracked: 2,
      untracked: 0,
      scanned: 2,
      omitted: 0,
      truncated: false,
      warnings: [],
    },
  };
}

function reportSource({
  includeControlledOutcome = true,
  includeLifecycleDecision = includeControlledOutcome,
  includeRepositoryFinding = true,
  locale = "en",
  semanticFacets = [],
  interventionLedger,
  sessionEvents = {},
  checkup,
  readerOverview,
} = {}) {
  const manifest = buildObservationManifest({
    scope: { platform: "qoder", workspace: "/workspace/task-loop-fixture" },
    eligibleCount: 4,
    analyzedCount: 4,
    selectionStrategy: "all-eligible",
    adapterVersion: "fixture-v2",
  });
  const ledger = interventionLedger ?? (includeControlledOutcome ? [intervention()] : []);
  const learningOwnerTypes = [...new Set(ledger.map((entry) => entry?.asset?.type).filter(Boolean))];
  const completedComparisonStates = new Set(["improving", "unchanged", "regressing"]);
  const linkedIntervention = ledger.some((entry) => entry?.episodeRef && (entry?.validation?.evidenceRefs?.length ?? 0) > 0);
  const hasRegression = linkedIntervention && ledger.some((entry) => entry?.result?.state === "regressing");
  const laterState = hasRegression
    ? "Exercised"
    : linkedIntervention && ledger.some((entry) => entry?.result?.state === "outcome-supported")
      ? "Outcome-supported"
      : linkedIntervention && ledger.some((entry) => completedComparisonStates.has(entry?.result?.state))
      ? "Exercised"
      : linkedIntervention && ledger.some((entry) => entry?.result?.state === "pending" && entry?.comparisonWindow?.taskMix === "comparable")
        ? "Wired"
        : linkedIntervention && ledger.some((entry) => entry?.result?.state === "pending")
          ? "Present"
          : "Unobserved";
  const learning = learningReview({
    reusableCapture: {
      state: linkedIntervention ? "Exercised" : ledger.length > 0 ? "Wired" : "Unobserved",
      mechanisms: learningOwnerTypes,
      ...(learningOwnerTypes.length > 0 ? {
        candidateOwner: learningOwnerTypes[0],
        ownerSelectionEvidenceRefs: [ref("loop-discovery-owner-selection")],
      } : {}),
      ...(linkedIntervention ? {
        currentValidationEvidenceRefs: [ref("loop-engineering-current-validation")],
      } : {}),
      summary: ledger.length > 0
        ? "The reviewed intervention ledger names the reusable owner and its validation boundary."
        : "No reusable capture was exercised in the reviewed boundary.",
    },
    laterValidation: {
      state: laterState,
      findingRefs: hasRegression ? ["later-validation-regression"] : [],
      summary: ledger.length > 0
        ? "The reviewed intervention ledger records the current comparison lifecycle."
        : "No later comparable review task was observed.",
    },
  });
  const recurringSignal = (episodeId) => ({
    patternId: "recurring-correction",
    normalizedSignature: "review-omission-correction",
    taskFamily: "agent-change",
    repoArea: "review-flow",
    frictionType: "user-correction",
    userCorrection: true,
    procedural: true,
    fieldProvenance: {
      normalizedSignature: "ai-reviewed",
      taskFamily: "ai-reviewed",
      repoArea: "ai-reviewed",
      frictionType: "ai-reviewed",
      userCorrection: "ai-reviewed",
    },
    evidenceRefs: [{ kind: "fixture", id: `${episodeId}-review-correction` }],
  });
  const taskEpisodes = [{
    id: "episode:1111111111111111",
    sessionCount: 1,
    continuation: "session-bounded",
    startBoundary: "session-start",
    taskRoute: "agent-change",
    executionBoundary: "project-instructions",
    dimensionSignals: includeLifecycleDecision ? [{
      dimension: "reliable-delivery",
      subdimensionRefs: ["high-risk-approval"],
      evidenceRefs: [ref("high-risk-approval-1")],
    }] : [],
    changeSets: [{ id: "change-1" }],
    closure: { status: "closed", evidenceRefs: [ref("focused-pass-1")] },
    repair: { status: "repaired-and-passed", evidenceRefs: [ref("repair-pass-1")] },
    learningSignals: [recurringSignal("episode:1111111111111111")],
    evidenceRefs: [ref("episode:1111111111111111")],
  }, {
    id: "episode:2222222222222222",
    sessionCount: 1,
    continuation: "session-bounded",
    startBoundary: "session-start",
    taskRoute: "agent-change",
    executionBoundary: "project-instructions",
    changeSets: [{ id: "change-2" }],
    closure: { status: "closed", evidenceRefs: [ref("focused-pass-2")] },
    repair: { status: "not-applicable" },
    learningSignals: [recurringSignal("episode:2222222222222222")],
    evidenceRefs: [ref("episode:2222222222222222")],
  }];
  const learningLoop = buildLearningLoopReview({
    episodes: taskEpisodes,
    signals: {
      observedSkills: [],
      unscopedObservedSkills: [],
      apparentSkillReads: [],
      configuredSkills: [],
      memories: [],
      frictionSignals: [],
      priorInterventionCount: ledger.length,
    },
    interventions: ledger,
  });
  return createHarnessReportSource({
    manifest,
    repositoryEvidence: {
      projectName: "task-loop-fixture",
      locale,
      dimensions: {
        "task-understanding": { present: [ref("route")], wired: [ref("route-wired")] },
        "controlled-execution": { present: [ref("doctor")], wired: [ref("doctor-wired")] },
        "change-validation": { present: [ref("focused-test")], wired: [ref("affected-check") ] },
        "reliable-delivery": { present: [ref("hook")], wired: [ref("pre-tool-hook")] },
      },
      findings: [
        ...(includeRepositoryFinding ? [{
          id: "reliable-delivery-hook",
          title: locale === "zh-CN" ? "受保护变更还没有关联交付证据" : "Protected changes still need linked delivery proof",
          severity: "High",
          reason: locale === "zh-CN"
            ? "已检查 Hook 策略；真实任务中的决策与验收交付仍需保持关联。"
            : "The hook policy is inspected; its observed task decision and accepted delivery path must remain linked.",
          expectedArtifact: "Hook",
          expectedOutput: [locale === "zh-CN"
            ? "更新项目 Hook，使受保护变更把运行时决策与验收交付证据保持关联。"
            : "Update the project Hook so protected changes keep runtime decisions linked to accepted delivery evidence."],
          dimensionRefs: ["reliable-delivery"],
          subdimensionRefs: ["acceptance-evidence"],
          staticEvidence: [ref("hook")],
        }] : []),
        ...(hasRegression ? [{
          id: "later-validation-regression",
          kind: "outcome-gap",
          title: locale === "zh-CN" ? "后续对比退化后尚未执行回退" : "The regressing comparison still needs its revert action",
          severity: "Medium",
          reason: locale === "zh-CN"
            ? "可比的后续窗口已经确认退化，但声明的停止或回退动作仍需执行并验证。"
            : "A comparable later window confirms regression, but the declared stop or revert action still needs execution and validation.",
          expectedOutcome: locale === "zh-CN"
            ? "退化的改进停止扩展，并在回退后重新验证主要指标和护栏。"
            : "The regressing intervention stops expanding and revalidates its primary metric and guardrail after revert.",
          expectedArtifact: "Rule",
          expectedOutput: [locale === "zh-CN"
            ? "更新项目规则，在回退退化改进后重新验证主要指标和护栏。"
            : "Update the project Rule to revert the regressing intervention and revalidate its primary metric and guardrail."],
          dimensionRefs: ["learning-capture"],
          subdimensionRefs: ["later-validation"],
          staticEvidence: [ref("later-validation-regression")],
        }] : []),
      ],
      diagnosticCoverageReviews: [diagnosticReview()],
      learningCaptureDiagnostics: {
        signals: {
          observedSkills: [],
          unscopedObservedSkills: [],
          apparentSkillReads: [],
          configuredSkills: [],
          memories: [],
          frictionSignals: [],
          priorInterventionCount: ledger.length,
        },
        learningCaptureSchemaVersion: learningLoop.schemaVersion,
        episodeRecords: learningLoop.episodeRecords,
        recurringIssueCandidates: learningLoop.candidates,
        coverage: learningLoop.coverage,
      },
      ...(readerOverview ? { readerOverview } : {}),
      ...(checkup ? { checkup } : {}),
    },
    sessionEvents,
    taskEpisodes,
    deliveryEvidence: [
      { id: "focused-check-1", episodeRef: "episode:1111111111111111", level: "relevant-focused-checks-passed", status: "passed", evidenceRefs: [ref("focused-check-1")] },
      ...(includeControlledOutcome ? [{ id: "ci-1", episodeRef: "episode:1111111111111111", level: "ci-accepted", status: "accepted", evidenceRefs: [ref("ci-1")] }] : []),
    ],
    semanticFacets,
    interventionLedger: ledger,
    evidenceRefs: [ref("root")],
    assessmentDecisions: [{
      kind: "source-candidate",
      status: "reviewed",
      evidenceRefs: [ref("source-review")],
    }, {
      kind: "repository-review",
      status: "reviewed",
      requiredFrameworks: ["coding-agent-practices", "software-fluency"],
      reviewedFrameworks: ["coding-agent-practices", "software-fluency"].map((id) => ({ id, status: "reviewed", summary: `${id} walkthrough reviewed`, evidenceRefs: [ref(id)] })),
      requiredChecks: [
        "scoped-instructions-and-task-routes",
        "setup-run-and-debug-route",
        "core-diagnostic-coverage",
        "tests-and-post-edit-validation",
        "hooks-permissions-and-safety-controls",
        "acceptance-recovery-and-release-path",
        "lifecycle-repeat-detection",
        "loop-engineering",
        "later-validation",
      ],
      reviewedChecks: [
        "scoped-instructions-and-task-routes",
        "setup-run-and-debug-route",
        "core-diagnostic-coverage",
        "tests-and-post-edit-validation",
        "hooks-permissions-and-safety-controls",
        "acceptance-recovery-and-release-path",
        "lifecycle-repeat-detection",
        "loop-engineering",
        "later-validation",
      ].map((id) => ({
        id,
        status: "reviewed",
        summary: `${id} check reviewed`,
        evidenceRefs: [ref(id)],
        ...({
          "lifecycle-repeat-detection": learning.recurringIssue,
          "loop-engineering": learning.reusableCapture,
          "later-validation": learning.laterValidation,
        }[id] ?? {}),
      })),
      requiredSoftwareFluencyCapabilities: [
        "context-map",
        "environment-readiness",
        "fast-feedback",
        "quality-gates",
        "safe-change",
      ],
      reviewedSoftwareFluencyCapabilities: [
        "context-map",
        "environment-readiness",
        "fast-feedback",
        "quality-gates",
        "safe-change",
      ].map((id) => ({ id, status: "reviewed", summary: `${id} capability reviewed`, evidenceRefs: [ref(id)] })),
    }, {
      kind: "score-review",
      status: "reviewed",
      modelId: "agent-work-loop-v4",
      calibration: "agent-work-loop-ai-v2",
      dimensions: [
        ["task-understanding", 70],
        ["controlled-execution", 70],
        ["change-validation", 70],
        ["reliable-delivery", includeRepositoryFinding ? 55 : 70],
        ["learning-capture", ledger.length === 0 ? 59 : 70],
      ].map(([id, score]) => ({
        id,
        score,
        confidence: "medium",
        reason: `${id} score reflects the reviewed mechanisms, task evidence, and remaining blockers.`,
        readerSummary: locale === "zh-CN"
          ? "当前证据支持这一判断，但仍缺少更强的任务结果。"
          : "Reviewed evidence supports this judgment, but stronger task outcomes are still missing.",
        evidenceRefs: [ref(`${id}-score-review`)],
      })),
    }],
  });
}

function addSoftwareFluencyFindings(source, capabilityIds = [
  "context-map",
  "environment-readiness",
  "fast-feedback",
  "quality-gates",
  "safe-change",
]) {
  const dimensions = {
    "context-map": { label: "Task routes", artifact: "Rule" },
    "environment-readiness": { label: "Clean setup", artifact: "Script" },
    "fast-feedback": { label: "Focused checks", artifact: "Test" },
    "quality-gates": { label: "Required gates", artifact: "Config" },
    "safe-change": { label: "Recovery controls", artifact: "Hook" },
  };
  const review = source.assessmentDecisions.find((row) => row.kind === "repository-review");
  review.reviewedSoftwareFluencyCapabilities = review.reviewedSoftwareFluencyCapabilities.map((row) => {
    if (!capabilityIds.includes(row.id)) return row;
    const dimension = dimensions[row.id];
    return {
      ...row,
      findings: [{
        id: `software-fluency-${row.id}`,
        kind: "missing-mechanism",
        title: `${dimension.label} stop before a verifiable result`,
        severity: row.id === "quality-gates" ? "High" : "Low",
        reason: `The inspected ${dimension.label.toLowerCase()} path ends before a concrete, repeatable result, so users still need manual recovery after the analysis.`,
        expectedOutcome: `${dimension.label} reaches one concrete, repeatable, and reviewable result.`,
        expectedArtifact: dimension.artifact,
        expectedOutput: [`Update the owning ${dimension.artifact} so ${dimension.label.toLowerCase()} reaches one concrete, repeatable, and reviewable result.`],
        evidenceRefs: [ref(`software-fluency-gap-${row.id}`)],
      }],
    };
  });
  return source;
}

function normalFinding(index) {
  return {
    id: `normal-finding-${index}`,
    kind: "evidence-gap",
    title: `Reviewed workflow ${index} stops before accepted delivery`,
    severity: index === 1 ? "High" : "Medium",
    reason: `The reviewed workflow ${index} has a concrete handoff gap that leaves users without accepted delivery evidence.`,
    expectedOutcome: `Workflow ${index} reaches one accepted and reviewable delivery result.`,
    expectedArtifact: "Config",
    expectedOutput: [`Update the Workflow ${index} Config so it reaches one accepted and reviewable delivery result.`],
    dimensionRefs: [index % 2 === 0 ? "change-validation" : "reliable-delivery"],
    staticEvidence: [ref(`normal-finding-${index}`)],
  };
}

function completeUsageSessionEvents(sessionCount = 4) {
  return {
    usageActivity: {
      schemaVersion: 1,
      dateBasis: "UTC",
      measurementBasis: "session-starts-active-estimate-model-request-lifecycles-skill-invocations-and-reads",
      truncated: false,
      dates: ["2026-07-11"],
      sessions: { total: sessionCount, starts: [sessionCount], activeMinutes: [12] },
      models: [{ name: "performance", total: 2, daily: [2] }],
      skills: [{ name: "skill-creator", total: 3, daily: [3] }],
    },
    usageEfficiency: {
      schemaVersion: 1,
      selection: {
        strategy: "all-eligible",
        eligibleSessionCount: sessionCount,
        analyzedSessionCount: sessionCount,
        complete: true,
      },
      roles: { userThreadCandidateCount: sessionCount, childAgentCandidateCount: 0 },
      longSessions: { activeCount: 0, wallOnlyCount: 0, longestActiveMinutes: 0 },
      accounting: {
        mode: "effort-proxy",
        responseCount: 2,
        modelAttributedResponseCount: 2,
        unattributedResponseCount: 0,
        usageFieldObservedCount: 2,
        nonZeroUsageCount: 0,
        exactCreditsAvailable: false,
        pricingVersion: null,
      },
      modelUsage: [{ model: "performance", responseCount: 2, usageFieldObservedCount: 2, nonZeroUsageCount: 0 }],
      outcomeReview: {
        status: "not-applicable",
        reviewedCandidateCount: 0,
        comparableModelOutcomeEvidence: false,
        recommendation: "controlled-a-b-required",
      },
    },
  };
}

test("confirmed core diagnostic gaps project into final report findings", () => {
  const source = reportSource({ includeRepositoryFinding: false, interventionLedger: [] });
  source.repositoryEvidence.diagnosticCoverageReviews = [diagnosticReview({
    status: "confirmed-gap",
    affectedScope: "core/transport/handler/rpc/handler.go",
    summary: "The RPC handler correlation chain was inspected.",
    title: "RPC handler can split one request across correlation ids",
    missingSegment: "the logger keeps the generated id after traceparent replaces the local trace id",
    impact: "operators cannot reliably join upstream and downstream events for one request",
    expectedOutcome: "Bind the effective trace id to context and logger before downstream work and cover the propagated-header path.",
    severity: "High",
    expectedArtifact: "Code",
    evidenceRefs: [ref("rpc-trace-rebind-gap")],
  })];

  const findings = projectTaskLoopFindings(source);
  const row = findings.findings.find((finding) => finding.id === "diagnostic-core-chain");

  assert.ok(row);
  assert.equal(row.severity, "High");
  assert.equal(row.expectedArtifact, "Code");
  assert.deepEqual(row.dimensionRefs, ["change-validation"]);
  assert.deepEqual(row.subdimensionRefs, ["failure-repair", "validate-again"]);
  assert.match(row.reason, /core\/transport\/handler\/rpc\/handler\.go/);
  assert.match(row.reason, /upstream and downstream events/);
  assert.deepEqual(validateTaskLoopFindings(findings), []);
});

test("asset integrity candidates reach final findings without changing coverage-row fields", () => {
  const source = reportSource({ includeRepositoryFinding: false, interventionLedger: [] });
  const practice = projectAgentLintPracticeEvidence({
    locale: "en",
    provider: "qoder",
    integrityReview: {
      profile: "asset-integrity-review",
      findings: [{
        id: "memory-title-similarity",
        severity: "advisory",
        assetKind: "memory",
        assetName: "memory-pair-1",
        why: "Two Memory titles are similar and need manual owner review.",
      }, {
        id: "plugin-name-collision",
        severity: "warning",
        assetKind: "plugin",
        assetName: "plugin-group-1",
        why: "Two enabled Plugins share one canonical name.",
      }, {
        id: "hook-count-over-recommended-limit",
        severity: "warning",
        assetKind: "hook",
        assetName: "enabled-hooks",
        why: "11 enabled Hooks exceed the recommended limit of 10.",
      }],
    },
  });
  source.repositoryEvidence.findings = practice.findings;
  source.repositoryEvidence.aiAgentPractice = {
    coverageRows: [
      { surface: "Memories", scopes: ["Project"], count: 112, paths: ["~/.qoder/memories/example.md"] },
      { surface: "Plugins", scopes: ["Plugin"], count: 10, paths: [] },
      { surface: "Hooks", scopes: ["Global"], count: 11, paths: ["~/.qoder/settings.json"] },
    ],
  };

  const findings = projectTaskLoopFindings(source);
  assert.ok(findings.findings.some((finding) => finding.id === "practice-memories-quality"));
  assert.ok(findings.findings.some((finding) => finding.id === "practice-plugins-quality"));
  assert.ok(findings.findings.some((finding) => finding.id === "practice-hooks-quality"));
  const assetRows = findings.summary.aiAgentPractice.coverageRows.filter((row) =>
    ["Memories", "Plugins", "Hooks"].includes(row.surface));
  assert.equal(assetRows.length, 3);
  assert.deepEqual(Object.fromEntries(assetRows.map((row) => [row.surface, row.count])), {
    Memories: 112,
    Plugins: 10,
    Hooks: 11,
  });
  assert.ok(assetRows.every((row) => Object.keys(row).every((key) =>
    ["surface", "count", "scopes", "paths"].includes(key))));
  assert.ok(assetRows.every((row) => !Object.hasOwn(row, "status") && !Object.hasOwn(row, "reason") && !Object.hasOwn(row, "evaluation")));
  assert.deepEqual(validateTaskLoopFindings(findings), []);
});

test("Chinese diagnostic findings localize internal scope and punctuation", () => {
  const source = reportSource({ locale: "zh-CN", includeRepositoryFinding: false, interventionLedger: [] });
  source.repositoryEvidence.diagnosticCoverageReviews = [diagnosticReview({
    status: "confirmed-gap",
    affectedScope: "src/core/request.ts",
    title: "核心链路缺少结果诊断",
    missingSegment: "结果日志。",
    impact: "失败后无法关联同一次请求。",
    expectedOutcome: "同一次请求可以被端到端追踪。",
    severity: "Medium",
    expectedArtifact: "Code",
    expectedOutput: ["更新归属代码，使同一次请求可以被端到端追踪。"],
    aiFixPrompt: "/better-harness 修复这个问题\n\n补充关联日志。\n\n## Validation\n\n- 运行失败路径检查",
  })];
  const findings = projectTaskLoopFindings(source);
  const row = findings.findings.find((finding) => finding.id === "diagnostic-core-chain");

  assert.equal(row.reason, "src/core/request.ts 内缺少结果日志。失败后无法关联同一次请求。");
  assert.deepEqual(validateTaskLoopFindings(findings), []);
});

test("resolved diagnostic reviews without a confirmed gap do not create findings", () => {
  for (const status of ["covered", "unverified", "not-applicable"]) {
    const source = reportSource({ includeRepositoryFinding: false, interventionLedger: [] });
    source.repositoryEvidence.diagnosticCoverageReviews = [diagnosticReview({ status })];
    const findings = projectTaskLoopFindings(source);
    assert.equal(findings.findings.some((finding) => finding.id.startsWith("diagnostic-")), false, status);
  }
});

test("diagnostic review must be resolved and confirmed gaps must be actionable", () => {
  const unresolved = reportSource();
  unresolved.repositoryEvidence.diagnosticCoverageReviews = [diagnosticReview({
    status: "review-required",
    evidenceRefs: [],
  })];
  assert.throws(
    () => projectTaskLoopFindings(unresolved),
    (error) => error?.code === "INCOMPLETE_TASK_LOOP_REVIEW",
  );

  const malformed = reportSource();
  malformed.repositoryEvidence.diagnosticCoverageReviews = [diagnosticReview({
    status: "confirmed-gap",
    title: "Core chain lacks a result diagnostic",
    missingSegment: "result logging",
    expectedOutcome: "Emit a correlated result event.",
    severity: "High",
    expectedArtifact: "Code",
  })];
  assert.ok(validateHarnessReportSource(malformed).some((message) => message.includes("impact")));

  const genericScope = reportSource();
  genericScope.repositoryEvidence.diagnosticCoverageReviews = [diagnosticReview({
    status: "confirmed-gap",
    affectedScope: "repository-wide",
  })];
  assert.ok(validateHarnessReportSource(genericScope).some((message) => message.includes("bounded affected chain")));

  const contradictoryCovered = reportSource();
  contradictoryCovered.repositoryEvidence.diagnosticCoverageReviews = [diagnosticReview({
    status: "covered",
    summary: "Review affected core chains before projection.",
  })];
  assert.ok(validateHarnessReportSource(contradictoryCovered).some((message) => message.includes("covered status conflicts")));
});

test("checkup capability recommendations project as ordinary Low findings", () => {
  const findings = projectTaskLoopFindings(reportSource({
    includeRepositoryFinding: false,
    interventionLedger: [],
    checkup: {
      kind: "harness-customization-checkup",
      phase: "scan",
      findings: [{
        id: "finding-capability-review",
        kind: "skill",
        status: "unobserved",
        title: "review workflow: a small Skill handoff is ready for separate approval",
        whyThisMatters: "Repeated friction can justify a bounded trial or handoff, but it does not prove that a new Skill is needed.",
        capabilityRecommendation: {
          lifecycle: [],
          discipline: ["review"],
          evidenceState: "gap",
          nextStep: "create-skill-handoff",
          handoff: "/create-skill Create the smallest review workflow with trigger, context, output, validation, and one failure boundary.",
        },
      }],
    },
  }));
  const row = findings.findings.find((finding) => finding.id === "checkup-finding-capability-review");

  assert.ok(row);
  assert.equal(row.severity, "Low");
  assert.equal(row.kind, "evidence-gap");
  assert.equal(row.title, "a small Skill handoff is ready for separate approval");
  assert.deepEqual(row.dimensionRefs, ["controlled-execution"]);
  assert.deepEqual(row.subdimensionRefs, ["supported-operation"]);
  assert.match(row.expectedOutput[0], /Document/i);
  assert.match(row.expectedOutput[0], /verified capability owner/i);
  assert.match(row.aiFixPrompt, /^\/better-harness fix this issue/);
  assert.match(row.aiFixPrompt, /\/create-skill/);
  assert.doesNotMatch(row.aiFixPrompt, /\b[ES]\d+\b/u);
  assert.deepEqual(validateTaskLoopFindings(findings), []);
});

test("every supported checkup recommendation projects without a finding quota", () => {
  const findings = projectTaskLoopFindings(reportSource({
    includeRepositoryFinding: false,
    interventionLedger: [],
    checkup: {
      kind: "harness-customization-checkup",
      phase: "scan",
      findings: [
        {
          id: "review-handoff",
          kind: "skill",
          status: "unobserved",
          title: "review workflow: a scoped Skill handoff is ready for approval",
          whyThisMatters: "Repeated review friction has a bounded next step.",
          capabilityRecommendation: {
            lifecycle: [], discipline: ["review"], evidenceState: "gap", nextStep: "create-skill-handoff",
            handoff: "/create-skill Create the smallest review workflow with a trigger and validation.",
          },
        },
        {
          id: "verification-trial",
          kind: "skill",
          status: "candidate",
          title: "verification workflow: a configured Skill needs a scoped trial",
          whyThisMatters: "Configured coverage needs a focused, observable trial before it can be trusted.",
          capabilityRecommendation: {
            lifecycle: [], discipline: ["verification"], evidenceState: "gap", nextStep: "try-configured",
          },
        },
      ],
    },
  }));

  const rows = findings.findings.filter((finding) => finding.id.startsWith("checkup-"));

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((finding) => finding.id), ["checkup-review-handoff", "checkup-verification-trial"]);
  assert.ok(rows.every((finding) => finding.severity === "Low"));
  assert.deepEqual(validateTaskLoopFindings(findings), []);
});

test("weak checkup evidence does not consume a reader finding slot", () => {
  const findings = projectTaskLoopFindings(reportSource({
    includeRepositoryFinding: false,
    interventionLedger: [],
    checkup: {
      kind: "harness-customization-checkup",
      phase: "scan",
      findings: [{
        id: "finding-capability-review",
        kind: "skill",
        status: "unobserved",
        title: "review workflow needs more evidence",
        whyThisMatters: "One bounded sample does not prove a stable lifecycle gap.",
        capabilityRecommendation: {
          lifecycle: [],
          discipline: ["review"],
          evidenceState: "needs-more-evidence",
          nextStep: "needs-more-evidence",
        },
      }],
    },
  }));

  assert.equal(findings.findings.some((finding) => finding.id.startsWith("checkup-")), false);
  assert.deepEqual(validateTaskLoopFindings(findings), []);
});

test("explicit Checkup evidence keeps Hook attention and unused Skill summaries visible in ordinary findings", () => {
  const hooks = Array.from({ length: 11 }, (_, index) => ({
    kind: "hook",
    name: `guard-${index}`,
    label: `guard-${index}`,
    step: "PreToolUse",
    matcher: "*",
    commandDisplay: `node guard-${index}.mjs`,
    handlerType: "command",
    scope: "user",
    sourceLabel: "User",
    enabled: true,
  }));
  const scan = buildCheckupScan({
    inventory: {
      plugins: [],
      manage: {
        skills: [{
          kind: "skill", name: "rare-review", scope: "project", sourceLabel: "fixture",
          installedAt: "2026-01-01T00:00:00.000Z", enabled: true,
        }],
        mcps: [], hooks, rules: [], commands: [], subagents: [],
      },
    },
    sessionResult: {
      sources: [{ id: "fixture", kind: "project-jsonl", exists: true, enabled: true, workspaceScoped: true }],
      selection: { strategy: "stratified", eligibleCount: 5, analyzedCount: 3 },
      facets: { sessionCount: 5, analyzedSessionCount: 3, topSkills: [], topHooks: [], topTools: [] },
    },
    options: {
      provider: "qoder",
      workspace: "/workspace/task-loop-fixture",
      workspaceLabel: "task-loop-fixture",
      minimumSessions: 1,
      now: "2026-07-13T00:00:00.000Z",
    },
  });
  const source = reportSource({ includeRepositoryFinding: false, interventionLedger: [] });
  source.repositoryEvidence.customizationCheckup = projectCheckupReportEvidence(scan);

  const findings = projectTaskLoopFindings(source);
  const hook = findings.findings.find((finding) => finding.id.startsWith("checkup-finding-hook-count-"));
  const skills = findings.findings.find((finding) => finding.id === "checkup-capability-use-skill");

  assert.ok(hook);
  assert.ok(skills);
  assert.equal(hook.severity, "Medium");
  assert.equal(skills.severity, "Low");
  assert.match(hook.reason, /recommended limit|lifecycle guardrails/u);
  assert.match(hook.aiFixPrompt, /Do not guess and disable one Hook/u);
  assert.match(skills.reason, /Not-observed capability use is now visible/u);
  assert.match(skills.aiFixPrompt, /--selection all-eligible/u);
  assert.doesNotMatch(`${hook.aiFixPrompt}\n${skills.aiFixPrompt}`, /\b[ES]\d+\b/u);
  assert.deepEqual(validateHarnessReportSource(source), []);
  assert.deepEqual(validateTaskLoopFindings(findings), []);
});

test("Agent Work Loop findings preserve every AI-retained Software Fluency result", () => {
  const source = addSoftwareFluencyFindings(reportSource({
    includeRepositoryFinding: false,
    interventionLedger: [],
  }));
  source.repositoryEvidence.findings = [normalFinding(1), normalFinding(2), normalFinding(3)];

  const findings = projectTaskLoopFindings(source);

  assert.equal(findings.findings.length, 8);
  assert.deepEqual(
    findings.findings.slice(0, 3).map((finding) => finding.id),
    ["normal-finding-1", "normal-finding-2", "normal-finding-3"],
  );
  assert.deepEqual(
    findings.findings.slice(3).map((finding) => finding.id),
    [
      "software-fluency-context-map",
      "software-fluency-environment-readiness",
      "software-fluency-fast-feedback",
      "software-fluency-quality-gates",
      "software-fluency-safe-change",
    ],
  );
  assert.deepEqual(findings.findings[3].dimensionRefs, ["task-understanding"]);
  assert.deepEqual(findings.findings[4].dimensionRefs, ["controlled-execution"]);
  assert.equal(findings.findings.find((finding) => finding.id === "software-fluency-quality-gates").severity, "High");
  assert.match(findings.findings[3].aiFixPrompt, /^\/better-harness fix this issue/);
  assert.deepEqual(
    findings.summary.atAGlance.priorityMoves.map((move) => move.findingRef),
    ["normal-finding-1", "software-fluency-quality-gates", "normal-finding-2"],
  );
  assert.deepEqual(validateTaskLoopFindings(findings), []);
});

test("normal finding count does not suppress Software Fluency results", () => {
  const source = addSoftwareFluencyFindings(reportSource({
    includeRepositoryFinding: false,
    interventionLedger: [],
  }));
  source.repositoryEvidence.findings = [1, 2, 3, 4].map(normalFinding);

  const findings = projectTaskLoopFindings(source);

  assert.deepEqual(findings.findings.map((finding) => finding.id), [
    "normal-finding-1",
    "normal-finding-2",
    "normal-finding-3",
    "normal-finding-4",
    "software-fluency-context-map",
    "software-fluency-environment-readiness",
    "software-fluency-fast-feedback",
    "software-fluency-quality-gates",
    "software-fluency-safe-change",
  ]);
  assert.equal(findings.findings.length, 9);
  assert.deepEqual(validateTaskLoopFindings(findings), []);
});

test("one Software Fluency capability may retain multiple findings without artifact or output quotas", () => {
  const source = addSoftwareFluencyFindings(reportSource({
    includeRepositoryFinding: false,
    interventionLedger: [],
  }));
  const review = source.assessmentDecisions.find((row) => row.kind === "repository-review");
  const contextMap = review.reviewedSoftwareFluencyCapabilities.find((row) => row.id === "context-map");
  contextMap.findings.push({
    id: "software-fluency-context-map-second-result",
    kind: "evidence-gap",
    title: "A second inspected route has no usable handoff",
    severity: "High",
    reason: "The AI review found another independent task route whose owner and completion evidence are both missing.",
    expectedOutcome: "The second task route reaches its owner and completion evidence.",
    expectedArtifact: "Runbook",
    expectedOutput: ["Owner route", "Completion evidence", "Recovery note", "Review note"],
    evidenceRefs: [ref("software-fluency-context-map-second-result")],
  });

  const findings = projectTaskLoopFindings(source);
  const second = findings.findings.find((finding) => finding.id === "software-fluency-context-map-second-result");

  assert.equal(findings.findings.length, 6);
  assert.equal(second.expectedArtifact, "Runbook");
  assert.deepEqual(second.expectedOutput, ["Owner route", "Completion evidence", "Recovery note", "Review note"]);
  assert.equal(second.severity, "High");
  assert.deepEqual(validateTaskLoopFindings(findings), []);
});

test("duplicate ids fail structurally instead of silently filtering AI results", () => {
  const source = addSoftwareFluencyFindings(reportSource({
    includeRepositoryFinding: false,
    interventionLedger: [],
  }));
  source.repositoryEvidence.findings = [
    { ...normalFinding(1), id: "software-fluency-context-map" },
    normalFinding(2),
    normalFinding(3),
  ];

  assert.throws(
    () => projectTaskLoopFindings(source),
    /produced by both repository review and Software Fluency review/u,
  );
});

test("clean Software Fluency reviews do not manufacture sparse report filler", () => {
  const findings = projectTaskLoopFindings(reportSource({
    includeRepositoryFinding: false,
    interventionLedger: [],
  }));

  assert.equal(findings.findings.length, 0);
  assert.deepEqual(validateTaskLoopFindings(findings), []);
});

test("projection keeps only structural evidence requirements for Software Fluency findings", () => {
  const source = addSoftwareFluencyFindings(reportSource({
    includeRepositoryFinding: false,
    interventionLedger: [],
  }), ["context-map"]);
  const review = source.assessmentDecisions.find((row) => row.kind === "repository-review");
  delete review.reviewedSoftwareFluencyCapabilities[0].findings[0].evidenceRefs;

  assert.throws(
    () => projectTaskLoopFindings(source),
    /findings\[0\]\.evidenceRefs must contain concrete repository evidence/,
  );
});

test("direct projection rejects duplicate Software Fluency capability rows", () => {
  const source = addSoftwareFluencyFindings(reportSource({
    includeRepositoryFinding: false,
    interventionLedger: [],
  }), ["context-map"]);
  const review = source.assessmentDecisions.find((row) => row.kind === "repository-review");
  review.reviewedSoftwareFluencyCapabilities.push({
    ...review.reviewedSoftwareFluencyCapabilities[0],
    findings: [{
      ...review.reviewedSoftwareFluencyCapabilities[0].findings[0],
      id: "software-fluency-context-map-duplicate",
    }],
  });

  assert.throws(
    () => projectTaskLoopFindings(source),
    /at most one row per Software Fluency capability/,
  );
});

test("a supported reusable capture gap projects as a Low finding", () => {
  const source = reportSource({ includeRepositoryFinding: false, interventionLedger: [] });
  const workflowLead = attachRepeatedWorkflowDemand(source);
  setLearningReview(source, {
    reusableCapture: {
      state: "Missing",
      mechanisms: [],
      candidateOwner: "skill",
      ownerSelectionEvidenceRefs: [ref("loop-discovery-skill-owner")],
      summary: "Repeated review friction has no durable lifecycle procedure yet.",
      evidenceRefs: [ref("missing-review-owner")],
      findingRefs: ["reusable-capture-gap"],
    },
  });
  source.repositoryEvidence.findings = [{
    id: "reusable-capture-gap",
    kind: "capture-gap",
    severity: "Low",
    title: "Repeated review handoffs have no reusable Skill procedure",
    reason: "Two bounded task episodes reached the same review handoff friction after observed and configured Skill coverage was inspected.",
    expectedOutcome: "Planning through review uses an observed or verifiably configured procedure without requiring a generic coding Skill.",
    expectedArtifact: "Skill",
    expectedOutput: ["Create a reusable Skill so planning through review follows an observed and verifiably configured procedure."],
    dimensionRefs: ["learning-capture"],
    subdimensionRefs: ["loop-engineering"],
    staticEvidence: [{ kind: "workflow-demand", id: workflowLead.id }],
    aiFixPrompt: "/better-harness fix this issue\n\nPrepare a separate create-skill handoff for the smallest review procedure; do not create it without authorization.\n\n## Validation\n\n- Re-run the same bounded review handoff corpus",
  }];

  const findings = projectTaskLoopFindings(source);
  const rows = findings.findings.filter((finding) => finding.id === "reusable-capture-gap");

  assert.equal(rows.length, 1);
  assert.equal(rows[0].severity, "Low");
  assert.equal(rows[0].expectedArtifact, "Skill");
  assert.deepEqual(rows[0].dimensionRefs, ["learning-capture"]);
  assert.deepEqual(rows[0].subdimensionRefs, ["loop-engineering"]);
  assert.equal(findings.summary.dimensions.find((dimension) => dimension.id === "learning-capture")
    .subdimensions.find((subdimension) => subdimension.id === "loop-engineering").state, "Missing");
  assert.deepEqual(validateTaskLoopFindings(findings), []);
});

test("Learning Capture reviewed checks reject unknown finding refs", () => {
  const source = reportSource({ includeRepositoryFinding: false, interventionLedger: [] });
  setLearningReview(source, {
    recurringIssue: {
      state: "Unobserved",
      summary: "The bounded sample does not establish recurring review friction.",
      evidenceRefs: [ref("bounded-selection")],
      findingRefs: ["premature-capture-gap"],
    },
    reusableCapture: {
      state: "Missing",
      mechanisms: [],
      summary: "No reusable owner was found for the unconfirmed issue.",
      evidenceRefs: [ref("missing-review-owner")],
      findingRefs: ["premature-capture-gap"],
    },
  });

  assert.ok(validateHarnessReportSource(source).some((message) => message.includes("references unknown finding")));
});

test("Learning Capture keeps its Agent-authored score within its evidence ceiling", () => {
  const source = reportSource({ includeRepositoryFinding: false, interventionLedger: [] });
  setLearningReview(source, {
    recurringIssue: {
      state: "Unobserved",
      summary: "No repeated task friction was confirmed.",
      evidenceRefs: [ref("bounded-selection")],
    },
    reusableCapture: {
      state: "Unobserved",
      mechanisms: [],
      summary: "No supported repeated opportunity reached Loop Engineering.",
      evidenceRefs: [ref("durable-owner-review")],
    },
    laterValidation: {
      state: "Unobserved",
      summary: "No later comparable intervention was observed.",
      evidenceRefs: [ref("bounded-selection")],
    },
  });
  source.assessmentDecisions.find((decision) => decision.kind === "score-review")
    .dimensions.find((dimension) => dimension.id === "learning-capture").score = 59;
  const findings = projectTaskLoopFindings(source);
  const learningCapture = findings.summary.dimensions.find((dimension) => dimension.id === "learning-capture");
  assert.equal(learningCapture.score, 59);
  assert.equal(learningCapture.level, null);
  assert.equal(learningCapture.state, "Unobserved");
  assert.equal(findings.summary.learningCapture.state, "N/A");
  assert.deepEqual(validateTaskLoopFindings(findings), []);

  const belowFloor = JSON.parse(JSON.stringify(findings));
  belowFloor.summary.dimensions.find((dimension) => dimension.id === "learning-capture").score = 30;
  assert.ok(validateTaskLoopFindings(belowFloor).some((message) => message.includes("integer from 35 to 100")));

  const aboveCeiling = JSON.parse(JSON.stringify(findings));
  aboveCeiling.summary.dimensions.find((dimension) => dimension.id === "learning-capture").score = 100;
  assert.ok(validateTaskLoopFindings(aboveCeiling).some((message) => message.includes("Learning Capture evidence ceiling (59)")));

  const historical = JSON.parse(JSON.stringify(aboveCeiling));
  historical.summary.reportContractVersion = 24;
  assert.deepEqual(validateTaskLoopFindings(historical), []);

  const outOfRangeScore = JSON.parse(JSON.stringify(findings));
  outOfRangeScore.summary.dimensions.find((dimension) => dimension.id === "learning-capture").score = 101;
  assert.ok(validateTaskLoopFindings(outOfRangeScore).some((message) => message.includes("integer from 35 to 100")));
});

test("Learning Capture source projection does not derive its score from the first four dimensions", () => {
  const source = reportSource({ includeRepositoryFinding: false });
  const scoreReview = source.assessmentDecisions.find((decision) => decision.kind === "score-review");
  const originalScores = new Map(scoreReview.dimensions.map((dimension) => [dimension.id, dimension.score]));
  const learningCapture = scoreReview.dimensions.find((dimension) => dimension.id === "learning-capture");
  learningCapture.score = 74;

  for (const dimension of scoreReview.dimensions) {
    if (dimension.id !== "learning-capture") dimension.score = 0;
  }
  const lowFirstFour = projectTaskLoopFindings(source);
  assert.equal(lowFirstFour.summary.dimensions.find((dimension) => dimension.id === "learning-capture").score, 74);

  for (const dimension of scoreReview.dimensions) {
    if (dimension.id !== "learning-capture") dimension.score = originalScores.get(dimension.id);
  }
  const reviewedFirstFour = projectTaskLoopFindings(source);
  assert.equal(reviewedFirstFour.summary.dimensions.find((dimension) => dimension.id === "learning-capture").score, 74);
});

test("confirmed Memory and Skill findings directly hold Asset Health repair progress", () => {
  const findings = [
    { id: "memory-owner-conflict", expectedArtifact: "Memory" },
    { id: "skill-routing-gap", expectedArtifact: "Skill" },
  ];
  assert.deepEqual(repairProgressFromFindings(findings), {
    score: 0,
    status: "not-started",
    verifiedFindingCount: 0,
    partialFindingCount: 0,
    blockedFindingCount: 0,
    pendingFindingCount: 2,
    totalFindingCount: 2,
    basis: "independent-post-fix-review",
  });

  findings[0].postFixRepairReview = { status: "verified" };
  assert.equal(repairProgressFromFindings(findings).score, 50);
  findings[1].postFixRepairReview = { status: "verified" };
  assert.equal(repairProgressFromFindings(findings).score, 100);
});

test("Learning Capture reviewed checks require distinct episodes and an inspected durable owner", () => {
  const oneEpisode = reportSource({ includeRepositoryFinding: false, interventionLedger: [] });
  learningCheck(oneEpisode, "lifecycle-repeat-detection").evidenceRefs = [
    { kind: "task-episode", id: "only-one-episode" },
  ];
  assert.ok(validateHarnessReportSource(oneEpisode).some((message) => message.includes("two distinct task-episode")));

  const ownerless = reportSource({ includeRepositoryFinding: false, interventionLedger: [] });
  Object.assign(learningCheck(ownerless, "loop-engineering"), {
    state: "Present",
    mechanisms: [],
  });
  assert.ok(validateHarnessReportSource(ownerless).some((message) => message.includes("inspected durable owner")));

  const unknownEpisode = reportSource({ includeRepositoryFinding: false, interventionLedger: [] });
  learningCheck(unknownEpisode, "lifecycle-repeat-detection").evidenceRefs[1].id = "episode-missing";
  assert.ok(validateHarnessReportSource(unknownEpisode).some((message) => message.includes("unknown task episodes")));

  const unrelatedEpisodes = reportSource({ includeRepositoryFinding: false, interventionLedger: [] });
  unrelatedEpisodes.taskEpisodes[1].taskRoute = "release-change";
  assert.ok(validateHarnessReportSource(unrelatedEpisodes).some((message) => message.includes("share a reviewed task route or redacted target key")));

  const unsupportedOwner = reportSource({ includeRepositoryFinding: false, interventionLedger: [] });
  Object.assign(learningCheck(unsupportedOwner, "loop-engineering"), {
    state: "Present",
    mechanisms: ["skill"],
  });
  assert.ok(validateHarnessReportSource(unsupportedOwner).some((message) => message.includes("requires candidateOwner and ownerSelectionEvidenceRefs")));
});

test("task-loop projection carries AI-reviewed dimension scores with evidence", () => {
  const findings = projectTaskLoopFindings(reportSource());
  const reliable = findings.summary.dimensions.find((dimension) => dimension.id === "reliable-delivery");
  const verification = findings.summary.dimensions.find((dimension) => dimension.id === "change-validation");
  const learningCapture = findings.summary.dimensions.find((dimension) => dimension.id === "learning-capture");
  const acceptance = reliable.subdimensions.find((subdimension) => subdimension.id === "acceptance-evidence");
  const lifecycleDecision = reliable.subdimensions.find((subdimension) => subdimension.id === "high-risk-approval");
  const finding = findings.findings.find((item) => item.id === "reliable-delivery-hook");

  assert.equal(findings.summary.modelId, "agent-work-loop-v4");
  assert.equal(findings.summary.locale, "en");
  assert.equal(findings.summary.reportContractVersion, 26);
  assert.deepEqual(findings.summary.assignmentSummaries, []);
  assert.equal(findings.summary.evidenceMode, "session-rich");
  assert.equal(findings.summary.overview, "Protected changes still need linked delivery proof.");
  assert.equal(findings.summary.dimensions.length, 5);
  assert.ok(findings.summary.dimensions.every((dimension) => dimension.subdimensions.length === 3));
  assert.equal(findings.summary.dimensions.flatMap((dimension) => dimension.subdimensions).length, 15);
  assert.ok(findings.summary.dimensions.every((dimension) => Number.isInteger(dimension.score)));
  assert.deepEqual(findings.summary.dimensions.map((dimension) => dimension.score), [70, 70, 70, 55, 70]);
  assert.ok(findings.summary.dimensions.every((dimension) => dimension.scoreReason.length > 24));
  assert.ok(findings.summary.dimensions.every((dimension) => dimension.scoreConfidence === "medium"));
  assert.ok(findings.summary.dimensions.every((dimension) => dimension.scoreEvidenceRefs.length === 1));
  assert.ok(findings.summary.dimensions.every((dimension) => !dimension.summary.startsWith(`${dimension.label}:`)));
  assert.ok(findings.summary.dimensions.every((dimension) => !findings.findings.some((item) => dimension.summary.includes(item.title))));
  assert.equal(learningCapture.label, "Learning Capture");
  assert.equal(acceptance.findingRefs[0], "reliable-delivery-hook");
  assert.equal(reliable.level, "Outcome-supported");
  assert.equal(reliable.evidenceBridge.state, "outcome-supported");
  assert.equal(lifecycleDecision.level, "Outcome-supported");
  assert.equal(acceptance.level, "Outcome-supported");
  assert.equal(verification.level, "Outcome-supported");
  assert.ok(finding.evidenceBridge.staticEvidence.length > 0);
  assert.ok(finding.evidenceBridge.episodeEvidence.length > 0);
  assert.ok(finding.evidenceBridge.deliveryEvidence.length > 0);
  assert.match(finding.aiFixPrompt, new RegExp(finding.evidenceBridge.staticEvidence[0].id));
  assert.equal(findings.summary.atAGlance.priorityMoves.length, Math.min(3, findings.findings.length));
  assert.ok(findings.summary.atAGlance.priorityMoves.every((move) => move.dimensionRef && move.findingRef));
  assert.ok(findings.summary.atAGlance.priorityMoves.every((move) => move.expectedUnlock.length > 40));
  assert.ok(findings.summary.atAGlance.priorityMoves.every((move) => /Create or update/.test(move.move)));
  assert.ok(findings.summary.atAGlance.priorityMoves.some((move) => findings.findings.some((finding) => finding.expectedOutput[0] === move.expectedUnlock)));
  assert.equal(findings.summary.atAGlance.priorityMoves.some((move) => /^evidence-boundary-/.test(move.findingRef ?? "")), false);
  assert.ok(findings.summary.strengths.every((strength) => !findings.findings.some((item) => strength.includes(item.title))));
  assert.ok(findings.summary.strengths.length <= 3);
  assert.ok(findings.findings.every((item) => Array.isArray(item.expectedOutput) && item.expectedOutput.length >= 1));
  assert.ok(findings.findings.every((item) => item.expectedOutput.every((output) => typeof output === "string" && output.length > 20)));
  assert.ok(findings.findings.every((item) => !Object.hasOwn(item, "expectedOutcome") && !Object.hasOwn(item, "expectedFileChanges")));
  assert.ok(findings.findings.every((item) => !Object.hasOwn(item, "reader")));
  assert.ok(findings.findings.every((item) => typeof item.expectedArtifact === "string" && item.expectedArtifact.length > 0));
  assert.equal(finding.expectedArtifact, "Hook");
  assert.ok(findings.findings.every((item) => ["evidence-gap", "missing-mechanism", "outcome-gap"].includes(item.kind)));
  assert.deepEqual(findings.summary.aiAgentPractice.inspectedSurfaces, []);
  assert.equal(findings.summary.aiAgentPractice.coverageRows.length, 4);
  assert.equal(findings.summary.aiAgentPractice.coverageRows.find((row) => row.surface === "Skills")?.count, 0);
  assert.ok(findings.summary.aiAgentPractice.coverageRows.every((row) =>
    !Object.hasOwn(row, "status") && !Object.hasOwn(row, "reason") && !Object.hasOwn(row, "evaluation")));
  assert.equal(findings.summary.atAGlance.demonstratedAutonomyRadius.level, "R3");
  assert.equal(findings.summary.learningCapture.state, "pending");
  assert.equal(findings.summary.learningCapture.effectiveness, undefined);
  assert.deepEqual(validateTaskLoopFindings(findings), []);

  const inflatedScore = JSON.parse(JSON.stringify(findings));
  inflatedScore.summary.dimensions[0].score = 100;
  assert.ok(validateTaskLoopFindings(inflatedScore).some((error) => /exceeds its evidence ceiling/.test(error)));

  const missingScoreReason = JSON.parse(JSON.stringify(findings));
  delete missingScoreReason.summary.dimensions[0].scoreReason;
  assert.ok(validateTaskLoopFindings(missingScoreReason).some((error) => /scoreReason must explain the AI judgment/.test(error)));

  const missingBenefit = JSON.parse(JSON.stringify(findings));
  delete missingBenefit.summary.atAGlance.priorityMoves[0].expectedUnlock;
  assert.ok(validateTaskLoopFindings(missingBenefit).some((error) => /priorityMoves\[0\] missing expectedUnlock/.test(error)));

  const missingOutput = JSON.parse(JSON.stringify(findings));
  missingOutput.findings[0].expectedOutput = [];
  assert.ok(validateTaskLoopFindings(missingOutput).some((error) => /expectedOutput must contain concrete output strings/.test(error)));

  const missingArtifact = JSON.parse(JSON.stringify(findings));
  delete missingArtifact.findings[0].expectedArtifact;
  assert.ok(validateTaskLoopFindings(missingArtifact).some((error) => /expectedArtifact must be a non-empty string/.test(error)));

  const unsupportedArtifact = JSON.parse(JSON.stringify(findings));
  unsupportedArtifact.findings[0].expectedArtifact = "Unknown";
  unsupportedArtifact.findings[0].expectedOutput = ["Preserve the AI-authored result without forcing an artifact vocabulary."];
  assert.deepEqual(validateTaskLoopFindings(unsupportedArtifact), []);

  const normalizedArtifactSource = reportSource();
  normalizedArtifactSource.repositoryEvidence.findings[0].expectedArtifact = "Gate";
  normalizedArtifactSource.repositoryEvidence.findings[0].expectedOutput = ["Configure the delivery Gate so protected changes retain accepted delivery evidence."];
  assert.equal(projectTaskLoopFindings(normalizedArtifactSource).findings[0].expectedArtifact, "Gate");

  const ruleChangeSource = reportSource();
  ruleChangeSource.repositoryEvidence.findings[0].expectedArtifact = "Rule";
  ruleChangeSource.repositoryEvidence.findings[0].expectedOutput = ["Update the project Rule so protected changes retain accepted delivery evidence."];
  const ruleChange = projectTaskLoopFindings(ruleChangeSource).findings[0].expectedOutput[0];
  assert.equal(ruleChange, "Update the project Rule so protected changes retain accepted delivery evidence.");
  assert.doesNotMatch(ruleChange, /Locate and update|Result:/);
  assert.doesNotMatch(ruleChange, /\.(?:md|json|ya?ml)\b/i);

  const missingRuleSource = reportSource();
  missingRuleSource.repositoryEvidence.findings[0].kind = "missing-mechanism";
  missingRuleSource.repositoryEvidence.findings[0].expectedArtifact = "Rule";
  missingRuleSource.repositoryEvidence.findings[0].expectedOutput = ["Create a project Rule so unchecked evidence is verified before the agent continues."];
  assert.equal(
    projectTaskLoopFindings(missingRuleSource).findings[0].expectedOutput[0],
    "Create a project Rule so unchecked evidence is verified before the agent continues.",
  );

  const promptFileSource = reportSource();
  const explicitHookOutput = promptFileSource.repositoryEvidence.findings[0].expectedOutput[0];
  promptFileSource.repositoryEvidence.findings[0].aiFixPrompt = "/better-harness fix this issue\n\nUpdate `.github/workflows/pull-request.yml` so every pull request runs the existing test command before review can succeed, while leaving release-only jobs unchanged.\n\n## Validation\n\n- Run the workflow check and confirm a failing test blocks review";
  const projectedPromptFileOutput = projectTaskLoopFindings(promptFileSource).findings[0].expectedOutput[0];
  assert.equal(projectedPromptFileOutput, explicitHookOutput);
  assert.doesNotMatch(projectedPromptFileOutput, /pull-request\.yml|\.github/);

  const mcpConnectionSource = reportSource();
  mcpConnectionSource.repositoryEvidence.findings[0].title = "Figma MCP connection is unavailable";
  mcpConnectionSource.repositoryEvidence.findings[0].expectedArtifact = "MCP";
  mcpConnectionSource.repositoryEvidence.findings[0].expectedOutput = ["Fix the Figma MCP connection so the harness can use design evidence reliably."];
  mcpConnectionSource.repositoryEvidence.findings[0].aiFixPrompt = "/better-harness fix this issue\n\nUpdate `.qoder/mcp.json` to restore the Figma MCP connection without changing unrelated providers.\n\n## Validation\n\n- Confirm the Figma MCP connection is available to Harness analysis";
  assert.equal(
    projectTaskLoopFindings(mcpConnectionSource).findings[0].expectedOutput[0],
    "Fix the Figma MCP connection so the harness can use design evidence reliably.",
  );

  const bareArtifactAction = JSON.parse(JSON.stringify(findings));
  bareArtifactAction.findings[0].expectedOutput = ["Update the Rule."];
  assert.deepEqual(validateTaskLoopFindings(bareArtifactAction), []);

  const missingExpectedOutput = JSON.parse(JSON.stringify(findings));
  delete missingExpectedOutput.findings[0].expectedOutput;
  assert.ok(validateTaskLoopFindings(missingExpectedOutput).some((error) => /missing expectedOutput/.test(error)));

  const privateExpectedOutput = JSON.parse(JSON.stringify(findings));
  privateExpectedOutput.findings[0].expectedOutput = ["Update the Hook in `/Users/example/private/config.yml`."];
  assert.ok(validateTaskLoopFindings(privateExpectedOutput).some((error) => /must not expose an absolute private path/.test(error)));

  const missingPractice = JSON.parse(JSON.stringify(findings));
  delete missingPractice.summary.aiAgentPractice;
  assert.ok(validateTaskLoopFindings(missingPractice).some((error) => /summary missing aiAgentPractice/.test(error)));

  const currentObservation = JSON.parse(JSON.stringify(findings));
  currentObservation.summary.aiAgentPractice.coverageRows[0].status = "Present";
  currentObservation.summary.aiAgentPractice.coverageRows[0].reason = "Legacy observation";
  assert.ok(validateTaskLoopFindings(currentObservation).some((error) => /unsupported field: status/.test(error)));
  assert.ok(validateTaskLoopFindings(currentObservation).some((error) => /unsupported field: reason/.test(error)));

  const futureContract = structuredClone(findings);
  futureContract.summary.reportContractVersion = 999;
  assert.doesNotMatch(validateTaskLoopFindings(futureContract).join("; "), /reportContractVersion must be/);

  const missingSmallCheck = JSON.parse(JSON.stringify(findings));
  missingSmallCheck.summary.dimensions[0].subdimensions.pop();
  assert.ok(validateTaskLoopFindings(missingSmallCheck).some((error) => /exactly 3 canonical subdimensions/.test(error)));

  const malformedGlance = JSON.parse(JSON.stringify(findings));
  malformedGlance.summary.atAGlance.coverage = "4 task episodes";
  malformedGlance.summary.atAGlance.strongestLoop = "task-understanding";
  assert.ok(validateTaskLoopFindings(malformedGlance).some((error) => /atAGlance.coverage must be an object/.test(error)));
  assert.ok(validateTaskLoopFindings(malformedGlance).some((error) => /strongestLoop must be an object or null/.test(error)));

  const malformedBoundary = JSON.parse(JSON.stringify(findings));
  malformedBoundary.summary.evidenceBoundary.deliveryEvidenceLevels = "none";
  assert.ok(validateTaskLoopFindings(malformedBoundary).some((error) => /deliveryEvidenceLevels must be an array/.test(error)));
});

test("scores do not force JavaScript to invent findings", () => {
  const source = reportSource({ includeRepositoryFinding: false });
  const findings = projectTaskLoopFindings(source, { direct: true });
  const validation = findings.summary.dimensions.find((dimension) => dimension.id === "change-validation");
  validation.score = 30;

  assert.equal(validation.score, 30);
  assert.ok(validation.score < AGENT_WORK_LOOP_LOW_SCORE_FINDING_THRESHOLD);
  assert.equal(validation.scoreConfidence, "low");
  assert.deepEqual(validation.findingRefs, []);
  assert.deepEqual(findings.findings, []);
  assert.deepEqual(validateTaskLoopFindings(findings), []);

  const forgedReview = structuredClone(findings);
  forgedReview.summary.dimensions.find((dimension) => dimension.id === "change-validation").scoreConfidence = "medium";
  assert.deepEqual(validateTaskLoopFindings(forgedReview), []);
});

test("reviewed scores cannot claim the reserved direct-generated score marker", () => {
  const source = reportSource();
  const review = source.assessmentDecisions.find((decision) => decision.kind === "score-review");
  const validation = review.dimensions.find((dimension) => dimension.id === "change-validation");
  validation.confidence = "low";
  validation.reason = "Generated conservatively from the bounded repository and task evidence retained by this run.";

  assert.throws(
    () => projectTaskLoopFindings(source),
    /score-review change-validation\.reason cannot use the reserved direct-generated score reason/u,
  );
});

test("task-loop suggestions stay optional and do not change findings or priority moves", () => {
  const baseline = reconcileTaskLoopFindingLinks(projectTaskLoopFindings(reportSource()));
  const suggestionInput = projectTaskLoopFindings(reportSource());
  const findingRef = baseline.findings[0].id;
  suggestionInput.summary.suggestions = [
    {
      id: "try-existing-review-skill",
      kind: "try-existing",
      title: "Try the configured review Skill on the next protected change",
      reason: "The inspected Skill matches the current review need, but no retained episode exercised it.",
      confidence: "High",
      owner: "Review maintainers",
      nextStep: "Use the configured Skill once before extending or creating another workflow.",
      validation: "Confirm the Skill produces the existing focused review result.",
      findingRefs: [findingRef],
    },
    {
      id: "reuse-repair-rerun-pattern",
      kind: "working-pattern",
      title: "Reuse the observed repair and focused-rerun pattern",
      reason: "Two distinct completed task episodes retained the same bounded recovery sequence.",
      confidence: "Medium",
      owner: "Change authors",
      nextStep: "Apply the same bounded sequence to the next comparable failure.",
      validation: "Confirm the repaired check passes without widening the validation scope.",
    },
    {
      id: "evaluate-delivery-loop",
      kind: "loop-candidate",
      title: "Evaluate a bounded delivery-check loop",
      reason: "Repeated delivery work has a stable trigger, owner, output, verifier, and stop boundary.",
      confidence: "Medium",
      owner: "Delivery maintainers",
      nextStep: "Review the candidate loop without creating or activating automation.",
      validation: "Confirm the trigger and stop boundary remain stable across the next comparable task.",
    },
    {
      id: "prepare-longer-outcome-review",
      kind: "horizon",
      title: "Prepare a later outcome comparison",
      reason: "A comparison would be valuable after the current evidence boundary includes a comparable later task.",
      confidence: "Low",
      owner: "Harness reviewers",
      nextStep: "Retain a future comparable outcome before claiming an improvement.",
      validation: "Compare the same primary and guardrail measures in the later window.",
      prerequisites: ["One comparable later task with accepted outcome evidence"],
      blockedBy: ["The current window contains no comparable later outcome"],
    },
  ];
  const withSuggestions = reconcileTaskLoopFindingLinks(suggestionInput);

  assert.deepEqual(validateTaskLoopFindings(withSuggestions), []);
  assert.deepEqual(withSuggestions.findings, baseline.findings);
  assert.deepEqual(withSuggestions.summary.dimensions, baseline.summary.dimensions);
  assert.deepEqual(withSuggestions.summary.atAGlance.priorityMoves, baseline.summary.atAGlance.priorityMoves);

  const baselineSplit = splitTaskLoopFindings(baseline);
  const split = splitTaskLoopFindings(withSuggestions);
  assert.deepEqual(split.findings.summary.suggestions, withSuggestions.summary.suggestions);
  assert.equal(Object.hasOwn(split.canvas.summary, "suggestions"), false);
  assert.deepEqual(split.findings.findings, baselineSplit.findings.findings);
  assert.deepEqual(split.findings.summary.dimensions, baselineSplit.findings.summary.dimensions);
  assert.deepEqual(split.canvas.summary.atAGlance.priorityMoves, baselineSplit.canvas.summary.atAGlance.priorityMoves);
  const mergedBaseline = mergeTaskLoopCanvasData(baselineSplit.findings, baselineSplit.canvas);
  const mergedSuggestions = mergeTaskLoopCanvasData(split.findings, split.canvas);
  assert.deepEqual(mergedSuggestions, withSuggestions);
  assert.deepEqual(mergedSuggestions.findings, mergedBaseline.findings);
  assert.deepEqual(mergedSuggestions.summary.dimensions, mergedBaseline.summary.dimensions);
  assert.deepEqual(mergedSuggestions.summary.atAGlance.priorityMoves, mergedBaseline.summary.atAGlance.priorityMoves);
  assert.deepEqual(validateTaskLoopCanvasSplit(split.findings, split.canvas), []);

  const baselineMarkdown = renderMarkdown(mergedBaseline);
  const markdown = renderMarkdown(withSuggestions);
  assert.ok(withSuggestions.summary.suggestions.every((suggestion) =>
    markdown.includes(suggestion.title) && markdown.includes(suggestion.validation)));
  const baselineFindingIndexes = baseline.findings.map((finding) => baselineMarkdown.indexOf(finding.title));
  const suggestionFindingIndexes = withSuggestions.findings.map((finding) => markdown.indexOf(finding.title));
  assert.ok(baselineFindingIndexes.every((index) => index >= 0));
  assert.ok(suggestionFindingIndexes.every((index) => index >= 0));
  assert.deepEqual([...baselineFindingIndexes].sort((left, right) => left - right), baselineFindingIndexes);
  assert.deepEqual([...suggestionFindingIndexes].sort((left, right) => left - right), suggestionFindingIndexes);

  const invalidAction = structuredClone(withSuggestions);
  invalidAction.summary.suggestions[0].aiFixPrompt = "/better-harness fix this issue";
  assert.ok(validateTaskLoopFindings(invalidAction).some((error) => /suggestions\[0\] has unsupported field: aiFixPrompt/.test(error)));

  const invalidKind = structuredClone(withSuggestions);
  invalidKind.summary.suggestions[0].kind = "new-tool";
  assert.ok(validateTaskLoopFindings(invalidKind).some((error) => /unsupported kind: new-tool/.test(error)));

  const unknownFinding = structuredClone(withSuggestions);
  unknownFinding.summary.suggestions[0].findingRefs = ["not-a-finding"];
  assert.ok(validateTaskLoopFindings(unknownFinding).some((error) => /unknown finding id: not-a-finding/.test(error)));

  const privateId = structuredClone(withSuggestions);
  privateId.summary.suggestions[0].id = "019f72aa-0608-7171-bca9-ee18bda07a13";
  assert.ok(validateTaskLoopFindings(privateId).some((error) => /id must be a reader-safe lowercase slug/.test(error)));

  const unboundedHorizon = structuredClone(withSuggestions);
  delete unboundedHorizon.summary.suggestions[3].prerequisites;
  delete unboundedHorizon.summary.suggestions[3].blockedBy;
  assert.ok(validateTaskLoopFindings(unboundedHorizon).some((error) => /horizon requires prerequisites or blockedBy/.test(error)));

  const tooMany = structuredClone(withSuggestions);
  tooMany.summary.suggestions = Array.from({ length: 7 }, (_, index) => ({
    ...withSuggestions.summary.suggestions[0],
    id: `suggestion-${index}`,
  }));
  assert.ok(validateTaskLoopFindings(tooMany).some((error) => /at most six rows/.test(error)));

  assert.equal(Object.hasOwn(baseline.summary, "suggestions"), false);
  assert.deepEqual(validateTaskLoopFindings(baseline), []);
  const priorVersion = structuredClone(baseline);
  priorVersion.summary.reportContractVersion = 23;
  assert.deepEqual(validateTaskLoopFindings(priorVersion), []);
  const mislabeledSuggestionVersion = structuredClone(withSuggestions);
  mislabeledSuggestionVersion.summary.reportContractVersion = 23;
  assert.ok(validateTaskLoopFindings(mislabeledSuggestionVersion)
    .some((error) => /suggestions requires reportContractVersion 24 or newer/.test(error)));
});

test("task-loop projection preserves the reviewed project-specific overview", () => {
  const overview = "Validation is connected, but accepted delivery evidence is still the limiting step.";
  const findings = projectTaskLoopFindings(reportSource({
    readerOverview: { text: overview, evidenceRefs: [ref("overview-delivery-gap")] },
  }));

  assert.equal(findings.summary.overview, overview);
  assert.deepEqual(validateTaskLoopFindings(findings), []);
});

test("task-loop validation keeps summary shape checks without policing finding prose", () => {
  const findings = projectTaskLoopFindings(reportSource());
  const labelCopy = structuredClone(findings);
  labelCopy.summary.dimensions[0].summary = `${labelCopy.summary.dimensions[0].label}: repeated explanation.`;
  assert.ok(validateTaskLoopFindings(labelCopy).some((error) => /must not repeat the dimension label/.test(error)));

  const findingCopy = structuredClone(findings);
  const linkedDimension = findingCopy.summary.dimensions.find((dimension) => dimension.findingRefs.length > 0);
  const linkedFinding = findingCopy.findings.find((finding) => finding.id === linkedDimension.findingRefs[0]);
  linkedDimension.summary = `The dimension is limited because ${linkedFinding.title}.`;
  assert.deepEqual(validateTaskLoopFindings(findingCopy), []);

  const verboseCopy = structuredClone(findings);
  verboseCopy.summary.dimensions[0].summary = "A".repeat(161);
  assert.ok(validateTaskLoopFindings(verboseCopy).some((error) => /must stay within 160 characters/.test(error)));

  const multiSentenceCopy = structuredClone(findings);
  multiSentenceCopy.summary.dimensions[0].summary = "The first conclusion is visible. A second sentence repeats detail.";
  assert.ok(validateTaskLoopFindings(multiSentenceCopy).some((error) => /must be one sentence/.test(error)));
});

test("task-loop projection carries one optional date-aligned usage activity field", () => {
  const usageActivity = {
    schemaVersion: 1,
    dateBasis: "UTC",
    measurementBasis: "session-starts-active-estimate-model-responses-skill-invocations-and-reads",
    truncated: false,
    dates: ["2026-07-10", "2026-07-11"],
    sessions: { total: 2, starts: [1, 1], activeMinutes: [12, 18.5] },
    models: [{ name: "ultimate", total: 3, daily: [1, 2] }],
    skills: [{ name: "skill-creator", total: 2, daily: [0, 2] }],
    tokens: {
      observedResponseCount: 3,
      totals: { inputTokens: 300, outputTokens: 30, cacheReadInputTokens: 120, cacheCreationInputTokens: 0 },
      daily: {
        inputTokens: [100, 200],
        outputTokens: [10, 20],
        cacheReadInputTokens: [40, 80],
        cacheCreationInputTokens: [0, 0],
      },
    },
  };
  const findings = projectTaskLoopFindings(reportSource({ sessionEvents: { usageActivity } }));

  assert.deepEqual(findings.summary.usageActivity, usageActivity);
  assert.deepEqual(validateTaskLoopFindings(findings), []);

  findings.summary.usageActivity.models[0].daily = [3];
  assert.ok(validateTaskLoopFindings(findings).some((error) => /date-aligned daily counts/.test(error)));

  findings.summary.usageActivity.models[0].daily = [1, 2];
  findings.summary.usageActivity.tokens.daily.inputTokens = [299, 0];
  assert.ok(validateTaskLoopFindings(findings).some((error) => /non-negative total equal to its date-aligned daily values/.test(error)));
});

test("task-loop projection preserves the all-eligible usage evidence boundary", () => {
  const usageEfficiency = {
    schemaVersion: 2,
    selection: { strategy: "all-eligible", eligibleSessionCount: 9, analyzedSessionCount: 9, complete: true },
    roles: { userThreadCandidateCount: 7, childAgentCandidateCount: 2 },
    longSessions: {
      activeCount: 3,
      wallOnlyCount: 1,
      longestActiveMinutes: 60,
      activeRatio: 0.3333,
      estimate: {
        method: "capped-event-gap",
        activeThresholdMinutes: 45,
        gapCapMinutes: 5,
        idleGapMinutes: 30,
      },
      samples: [
        { alias: "S1", rawSessionId: "raw-session-1", sessionRef: "qsr1-111111111111111111111111", role: "user-thread-candidate", activeMinutes: 60, failureCount: 2, userInputSummary: "Diagnose the report generation path", toolTrace: { schemaVersion: 2, totalCalls: 4, shownCalls: 4, truncated: false, calls: [{ id: "T1", step: 1, toolName: "Read", status: "observed", durationStatus: "observed", durationMs: 1250, timingSource: "transcript-pair" }, { id: "T2", step: 2, toolName: "Bash", status: "failed", durationStatus: "observed", durationMs: 8000, timingSource: "lifecycle-pair" }, { id: "T3", step: 3, toolName: "Read", status: "observed", durationStatus: "unobserved" }, { id: "T4", step: 4, toolName: "Grep", status: "observed", durationStatus: "observed", durationMs: 500, timingSource: "transcript-pair" }] } },
        { alias: "S2", rawSessionId: "raw-session-2", sessionRef: "qsr1-222222222222222222222222", role: "user-thread-candidate", activeMinutes: 55, failureCount: 0, userInputSummary: "Implement the bounded session review", toolTrace: { schemaVersion: 1, totalCalls: 3, shownCalls: 3, truncated: false, calls: [{ id: "T1", step: 1, toolName: "Read", status: "observed" }, { id: "T2", step: 2, toolName: "SearchReplace", status: "observed" }, { id: "T3", step: 3, toolName: "Bash", status: "observed" }] } },
        { alias: "S3", rawSessionId: "raw-session-3", sessionRef: "qsr1-333333333333333333333333", role: "child-agent-candidate", activeMinutes: 48, failureCount: 1, userInputSummary: "Review the validation evidence", toolTrace: { schemaVersion: 1, totalCalls: 2, shownCalls: 2, truncated: false, calls: [{ id: "T1", step: 1, toolName: "Read", status: "observed" }, { id: "T2", step: 2, toolName: "Bash", status: "failed" }] } },
      ],
    },
    accounting: {
      mode: "effort-proxy",
      responseCount: 4,
      modelAttributedResponseCount: 4,
      unattributedResponseCount: 0,
      usageFieldObservedCount: 4,
      nonZeroUsageCount: 0,
      exactCreditsAvailable: false,
      pricingVersion: null,
    },
    modelUsage: [{ model: "ultimate", responseCount: 4, usageFieldObservedCount: 4, nonZeroUsageCount: 0 }],
    outcomeReview: {
      status: "required",
      reviewedCandidateCount: 0,
      reviewedActiveLongCount: 0,
      comparableModelOutcomeEvidence: false,
      recommendation: "controlled-a-b-required",
    },
  };
  const findings = projectTaskLoopFindings(reportSource({ sessionEvents: { usageEfficiency } }));

  assert.equal(findings.findings.some((row) => row.id === "session-usage-outcome-review-gap"), false);
  assert.equal(findings.summary.atAGlance.priorityMoves.some((row) => row.findingRef === "session-usage-outcome-review-gap"), false);
  const reviewLead = findings.summary.usageEfficiency.reviewLead;
  assert.ok(reviewLead);
  assert.equal(reviewLead.title, "3 long-session candidates still need outcome review");
  assert.match(reviewLead.reason, /3 of 9 analyzed sessions \(33\.3%\)/);
  assert.match(reviewLead.reason, /investigation lead, not a confirmed efficiency/);
  assert.doesNotMatch(reviewLead.aiFixPrompt, /raw-session|qsr1-|--session-ref|user input/i);
  assert.match(reviewLead.aiFixPrompt, /## First step/);
  assert.match(reviewLead.aiFixPrompt, /usage-review-packet\.mjs/);
  assert.match(reviewLead.aiFixPrompt, /validate-usage-report\.mjs --source <run>\/insights\.reviewed\.json/);
  assert.match(reviewLead.aiFixPrompt, /S1, S2, S3/);
  assert.match(reviewLead.aiFixPrompt, /complete 3\/3 candidate view/);
  assert.match(reviewLead.aiFixPrompt, /--platform qoder/);
  assert.doesNotMatch(reviewLead.aiFixPrompt, /\(4\/N\)|S1-S4|Rebuild Harness findings/);
  assert.equal(Object.hasOwn(findings.summary.usageEfficiency.longSessions.samples[0], "rawSessionId"), false);
  assert.equal(Object.hasOwn(findings.summary.usageEfficiency.longSessions.samples[0], "sessionRef"), false);
  assert.equal(Object.hasOwn(findings.summary.usageEfficiency.longSessions.samples[0], "userInputSummary"), false);
  assert.equal(findings.summary.usageEfficiency.longSessions.samples[0].sessionId, "raw-session-1");
  assert.equal(findings.summary.usageEfficiency.longSessions.samples[0].userRequest, "Diagnose the report generation path");
  assert.equal(findings.summary.usageEfficiency.longSessions.samples[0].toolTrace.calls.length, 4);
  assert.equal(findings.summary.usageEfficiency.longSessions.samples[0].toolTrace.calls[1].status, "failed");
  assert.equal(findings.summary.usageEfficiency.longSessions.samples[0].toolTrace.schemaVersion, 2);
  assert.deepEqual(findings.summary.usageEfficiency.longSessions.samples[0].toolTrace.calls[0], {
    id: "T1",
    step: 1,
    toolName: "Read",
    status: "observed",
    durationStatus: "observed",
    durationMs: 1250,
    timingSource: "transcript-pair",
  });
  assert.deepEqual(validateTaskLoopFindings(findings), []);

  const legacyWithoutTraces = structuredClone(findings);
  for (const sample of legacyWithoutTraces.summary.usageEfficiency.longSessions.samples) delete sample.toolTrace;
  assert.deepEqual(validateTaskLoopFindings(legacyWithoutTraces), []);

  const promotedLead = structuredClone(findings);
  const templateFinding = promotedLead.findings[0];
  promotedLead.findings.push({
    ...templateFinding,
    id: "unreviewed-long-session-gap",
    title: "Long-session candidates lack outcome review",
    reason: "All long-session candidates remain unreviewed, so their duration has not been classified as normal complexity, interruption noise, or actionable friction.",
    dimensionRefs: ["learning-capture"],
  });
  assert.ok(validateTaskLoopFindings(promotedLead).some((error) =>
    /must keep unreviewed long-session candidates in summary\.usageEfficiency\.reviewLead/u.test(error)));
  assert.doesNotMatch(JSON.stringify(findings.summary.usageEfficiency.longSessions.samples), /rawSessionId|sessionRef|candidateReasons|evidenceRefs/);

  const codexSource = reportSource({ sessionEvents: { usageEfficiency: structuredClone(usageEfficiency) } });
  codexSource.manifest.scope.platform = "codex";
  const codexReviewLead = projectTaskLoopFindings(codexSource).summary.usageEfficiency.reviewLead;
  assert.match(codexReviewLead.aiFixPrompt, /--platform codex/);
  assert.doesNotMatch(codexReviewLead.aiFixPrompt, /--platform qoder/);

  const grokSource = reportSource({ sessionEvents: { usageEfficiency: structuredClone(usageEfficiency) } });
  grokSource.manifest.scope.platform = "grok";
  const grokReviewLead = projectTaskLoopFindings(grokSource).summary.usageEfficiency.reviewLead;
  assert.match(grokReviewLead.aiFixPrompt, /--platform grok/);
  assert.doesNotMatch(grokReviewLead.aiFixPrompt, /--platform qoder/);

  findings.summary.usageEfficiency.accounting.unattributedResponseCount = 1;
  assert.ok(validateTaskLoopFindings(findings).some((error) => /response coverage/.test(error)));
  findings.summary.usageEfficiency.accounting.unattributedResponseCount = 0;

  findings.summary.usageEfficiency.selection.analyzedSessionCount = 10;
  assert.ok(validateTaskLoopFindings(findings).some((error) => /bounded all-eligible census/.test(error)));

  findings.summary.usageEfficiency.selection.analyzedSessionCount = 9;
  findings.summary.usageEfficiency.longSessions.samples[0].userInputSummary = "/Users/private/repo task";
  assert.ok(validateTaskLoopFindings(findings).some((error) => /unsupported field: userInputSummary/.test(error)));
  delete findings.summary.usageEfficiency.longSessions.samples[0].userInputSummary;

  const unsafeSessionLocator = structuredClone(findings);
  unsafeSessionLocator.summary.usageEfficiency.longSessions.samples[0].sessionId = "/Users/private/session";
  assert.ok(validateTaskLoopFindings(unsafeSessionLocator).some((error) => /bounded Canvas session locator/.test(error)));

  const unsafeUserRequest = structuredClone(findings);
  unsafeUserRequest.summary.usageEfficiency.longSessions.samples[0].userRequest = "/Users/private/repo task";
  assert.ok(validateTaskLoopFindings(unsafeUserRequest).some((error) => /privacy-safe user request/.test(error)));

  const unsafeTrace = structuredClone(findings);
  unsafeTrace.summary.usageEfficiency.longSessions.samples[0].toolTrace.calls[0].toolName = "/Users/private/tool";
  assert.ok(validateTaskLoopFindings(unsafeTrace).some((error) => /privacy-safe label/.test(error)));

  const negativeDuration = structuredClone(findings);
  negativeDuration.summary.usageEfficiency.longSessions.samples[0].toolTrace.calls[0].durationMs = -1;
  assert.ok(validateTaskLoopFindings(negativeDuration).some((error) => /bounded non-negative integer/.test(error)));

  const unobservedWithTiming = structuredClone(findings);
  const unobservedCall = unobservedWithTiming.summary.usageEfficiency.longSessions.samples[0].toolTrace.calls[2];
  unobservedCall.durationMs = 0;
  assert.ok(validateTaskLoopFindings(unobservedWithTiming).some((error) => /omit timing values when duration is unobserved/.test(error)));

  const unsupportedTimingSource = structuredClone(findings);
  unsupportedTimingSource.summary.usageEfficiency.longSessions.samples[0].toolTrace.calls[0].timingSource = "wall-clock";
  assert.ok(validateTaskLoopFindings(unsupportedTimingSource).some((error) => /supported observed lifecycle pair/.test(error)));

  const boundedUsage = structuredClone(usageEfficiency);
  boundedUsage.longSessions.activeCount = 6;
  boundedUsage.longSessions.activeRatio = 0.6667;
  boundedUsage.longSessions.samples.push({
    alias: "S4",
    rawSessionId: "raw-session-4",
    sessionRef: "qsr1-444444444444444444444444",
    role: "user-thread-candidate",
    activeMinutes: 46,
    failureCount: 0,
    userInputSummary: "Compare the model outcome evidence",
    toolTrace: { schemaVersion: 1, totalCalls: 1, shownCalls: 1, truncated: false, calls: [{ id: "T1", step: 1, toolName: "Read", status: "observed" }] },
  });
  const bounded = projectTaskLoopFindings(reportSource({ sessionEvents: { usageEfficiency: boundedUsage } }));
  const boundedPrompt = bounded.summary.usageEfficiency.reviewLead?.aiFixPrompt ?? "";
  assert.match(boundedPrompt, /Showing 4 of 6 unreviewed active-long sessions/);
  assert.match(boundedPrompt, /4\/6 bounded view \(4\/N\)/);
  assert.deepEqual(validateTaskLoopFindings(bounded), []);

  usageEfficiency.outcomeReview.reviewedActiveLongCount = 3;
  usageEfficiency.longSessions.samples = [];
  const sparse = projectTaskLoopFindings(reportSource({ sessionEvents: { usageEfficiency } }));
  assert.equal(sparse.summary.usageEfficiency.reviewLead, undefined);
  assert.deepEqual(validateTaskLoopFindings(sparse), []);
});

test("finding validation preserves AI-authored repair prompts without semantic templates", () => {
  const findings = projectTaskLoopFindings(reportSource());
  const concise = structuredClone(findings);
  concise.findings[0].aiFixPrompt = `/better-harness fix this issue

Rewrite \`AGENTS.md\` so the affected task route names its owning directory, the files agents may edit, and the exact next check. Keep the document under 120 lines and preserve the existing build commands.

## Validation

- Run \`npm run lint\`
- Start one representative task and confirm it reaches the owning directory and next check without extra guidance`;
  assert.deepEqual(validateTaskLoopFindings(concise), []);

  const incomplete = structuredClone(findings);
  incomplete.findings[0].aiFixPrompt = "/better-harness fix this issue\n\nImprove the workflow and run the smallest affected project check.";
  assert.deepEqual(validateTaskLoopFindings(incomplete), []);

  const premature = structuredClone(findings);
  premature.findings[0].title = "4 failure events have no repair action";
  premature.findings[0].reason = "Observed the failed-event friction signal 4 times without a reviewed cause.";
  premature.findings[0].aiFixPrompt = `/better-harness fix this issue

4 failure events have no repair action

## Evidence to inspect

- E1: inspect the first failed-event sample.

## First step

Create a Memory record named common_pitfalls_experience from the aggregate count.

## Scope

Limit the change to project Memory.

## Done when

The Memory record exists and can be retrieved.

## Validation

- Confirm the Memory record is returned.`;
  assert.deepEqual(validateTaskLoopFindings(premature), []);
});

test("priority moves preserve AI-authored order within the same repair priority", () => {
  const source = reportSource();
  source.repositoryEvidence.findings = [
    {
      id: "z-first-by-review",
      title: "First reviewed repair",
      severity: "High",
      reason: "The AI review placed this repair first because it unlocks the next two changes.",
      expectedArtifact: "Rule",
      expectedOutput: ["Update the project Rule so the first reviewed repair unlocks the next two changes."],
      dimensionRefs: ["task-understanding"],
    },
    {
      id: "a-second-by-review",
      title: "Second reviewed repair",
      severity: "High",
      reason: "The AI review placed this repair second even though its id sorts first.",
      expectedArtifact: "Skill",
      expectedOutput: ["Update the project Skill so the second reviewed repair retains its reviewed order."],
      dimensionRefs: ["controlled-execution"],
    },
  ];

  const findings = projectTaskLoopFindings(source);

  assert.deepEqual(
    findings.summary.atAGlance.priorityMoves.slice(0, 2).map((move) => move.findingRef),
    ["z-first-by-review", "a-second-by-review"],
  );
});

test("reader report accepts every strong finding while keeping three priority moves", () => {
  const source = reportSource({ includeRepositoryFinding: false, interventionLedger: [] });
  const dimensionRefs = ["task-understanding", "controlled-execution", "change-validation", "reliable-delivery"];
  source.repositoryEvidence.findings = Array.from({ length: 8 }, (_, index) => ({
    id: `project-specific-${index + 1}`,
    kind: "evidence-gap",
    title: `Workflow handoff ${index + 1} lacks an executable validation route`,
    severity: index < 2 ? "High" : index < 5 ? "Medium" : "Low",
    reason: `The inspected project path for workflow handoff ${index + 1} stops before a concrete validation result, so a newcomer cannot distinguish completion from an unchecked change.`,
    expectedOutcome: `Workflow handoff ${index + 1} reaches one documented, executable, and reviewable validation result.`,
    expectedArtifact: "Config",
    expectedOutput: [`Update the workflow Config so handoff ${index + 1} reaches one documented, executable, and reviewable validation result.`],
    dimensionRefs: [dimensionRefs[index % dimensionRefs.length]],
    staticEvidence: [ref(`project-specific-${index + 1}`)],
  }));

  const findings = projectTaskLoopFindings(source);

  assert.equal(findings.findings.length, 8);
  assert.equal(findings.summary.atAGlance.priorityMoves.length, 3);
  assert.deepEqual(validateTaskLoopFindings(findings), []);

  source.repositoryEvidence.findings.push({
    ...source.repositoryEvidence.findings[7],
    id: "project-specific-9",
    title: "Workflow handoff 9 lacks an executable validation route",
  });
  const overBudget = projectTaskLoopFindings(source);
  assert.equal(overBudget.findings.length, 9);
  assert.deepEqual(validateTaskLoopFindings(overBudget), []);
});

test("Chinese Bavi projection localizes all five dimensions, fifteen checks, benefits, and repair prompts", () => {
  const findings = projectTaskLoopFindings(reportSource({
    includeControlledOutcome: false,
    includeRepositoryFinding: false,
    locale: "zh-CN",
  }));
  const dimensions = findings.summary.dimensions;
  const subdimensions = dimensions.flatMap((dimension) => dimension.subdimensions);

  assert.equal(findings.summary.modelId, "agent-work-loop-v4");
  assert.equal(findings.summary.reportContractVersion, 26);
  assert.equal(findings.summary.locale, "zh-CN");
  assert.equal(findings.summary.overview, "路径在真实任务中用过，但还没有关联与该问题相符的结果。");
  assert.deepEqual(dimensions.map((dimension) => dimension.label), ["任务理解", "可控执行", "改动验证", "可靠交付", "经验沉淀"]);
  assert.deepEqual(subdimensions.map((subdimension) => subdimension.label), [
    "意图与验收",
    "相关上下文",
    "范围边界",
    "可复现启动",
    "受支持操作",
    "权限边界",
    "相关验证",
    "故障诊断与修复",
    "修复后复验",
    "交付验收",
    "高风险审批",
    "回滚或恢复",
    "生命周期机会识别",
    "闭环工程化",
    "长期验证",
  ]);
  assert.ok(dimensions.every((dimension) => /[\u3400-\u9fff]/u.test(dimension.summary)));
  assert.ok(subdimensions.every((subdimension) => /[\u3400-\u9fff]/u.test(subdimension.summary)));
  assert.match(findings.summary.atAGlance.demonstratedAutonomyRadius.reason, /任务片段|自主工作半径/);
  assert.ok(findings.summary.atAGlance.priorityMoves.every((move) => /[\u3400-\u9fff]/u.test(move.move) && /[\u3400-\u9fff]/u.test(move.expectedUnlock)));
  assert.deepEqual(findings.summary.aiAgentPractice.inspectedSurfaces, []);
  assert.ok(findings.summary.aiAgentPractice.coverageRows.every((row) =>
    !Object.hasOwn(row, "status") && !Object.hasOwn(row, "reason") && !Object.hasOwn(row, "evaluation")));
  assert.ok(findings.findings.every((item) => ["Code", "Skill", "Hook", "Test", "Rule", "Script"].includes(item.expectedArtifact)));
  assert.match(findings.summary.learningCapture.summary, /可比的观察窗口/);
  assert.equal(findings.findings.length, 0);
  assert.deepEqual(validateTaskLoopFindings(findings), []);
  const reportData = normalizeReportData(findings, { mode: "qoder-canvas" });
  assert.equal(reportData.language, "zh-CN");
  assert.equal(reportData.summary.locale, "zh-CN");
  assert.equal(reportData.summary.dimensions[0].label, "任务理解");
});


test("AI Agent practice inventory keeps only category, count, scopes, and safe paths", () => {
  const source = reportSource();
  source.repositoryEvidence.aiAgentPractice = {
    inspectedSurfaces: ["Rules"],
    coverageRows: [{
      surface: "Rules",
      scopes: ["Project", "Global"],
      count: 2,
      paths: ["AGENTS.md", ".qoder/rules/project.md"],
    }, {
      surface: "Custom Agents",
      scopes: ["Project"],
      count: 0,
      paths: [],
    }, {
      surface: "MCP",
      scopes: ["Global"],
      count: 3,
      paths: ["~/.qoder/projects/demo/mcps/browser-use", "~/.qoder/projects/demo/mcps/genui"],
    }, {
      surface: "Memories",
      scopes: ["Project"],
      count: 4,
      paths: ["~/.qoder/memories/account/projects/demo/project_introduction/memory.md"],
    }],
  };

  const findings = projectTaskLoopFindings(source);
  const rules = findings.summary.aiAgentPractice.coverageRows.find((row) => row.surface === "Rules");
  const customAgents = findings.summary.aiAgentPractice.coverageRows.find((row) => row.surface === "Custom Agents");
  const mcp = findings.summary.aiAgentPractice.coverageRows.find((row) => row.surface === "MCP");
  const memories = findings.summary.aiAgentPractice.coverageRows.find((row) => row.surface === "Memories");
  assert.equal(rules.count, 2);
  assert.deepEqual(findings.summary.aiAgentPractice.inspectedSurfaces, ["Rules"]);
  assert.deepEqual(rules.scopes, ["Project", "Global"]);
  assert.deepEqual(rules.paths, ["AGENTS.md", ".qoder/rules/project.md"]);
  assert.deepEqual(Object.keys(rules).sort(), ["count", "paths", "scopes", "surface"]);
  assert.equal(mcp.count, 3);
  assert.deepEqual(mcp.scopes, ["Global"]);
  assert.equal(Object.hasOwn(mcp, "paths"), false);
  assert.equal(memories.count, 4);
  assert.deepEqual(memories.scopes, ["Project"]);
  assert.equal(Object.hasOwn(memories, "paths"), false);
  assert.equal(customAgents.count, 0);
  assert.equal(Object.hasOwn(customAgents, "evaluation"), false);
  assert.deepEqual(validateTaskLoopFindings(findings), []);

  const unsafe = JSON.parse(JSON.stringify(findings));
  unsafe.summary.aiAgentPractice.coverageRows.find((row) => row.surface === "MCP").paths = ["/Users/example/private/mcp.json"];
  assert.ok(validateTaskLoopFindings(unsafe).some((error) => /project-relative paths/.test(error)));

  const invalidScope = JSON.parse(JSON.stringify(findings));
  invalidScope.summary.aiAgentPractice.coverageRows.find((row) => row.surface === "MCP").scopes = ["Workspace"];
  assert.ok(validateTaskLoopFindings(invalidScope).some((error) => /Project, Global, or Plugin/.test(error)));

  const invalidMemoryPath = JSON.parse(JSON.stringify(findings));
  invalidMemoryPath.summary.aiAgentPractice.coverageRows.find((row) => row.surface === "Memories").paths = [
    "~/.qoder/memories/account/projects/demo/project_introduction",
  ];
  assert.ok(validateTaskLoopFindings(invalidMemoryPath).some((error) => /project-relative paths/.test(error)));

  const detachedMemoryPath = JSON.parse(JSON.stringify(findings));
  detachedMemoryPath.summary.aiAgentPractice.coverageRows.find((row) => row.surface === "Memories").paths = [
    "project_introduction/memory.md",
  ];
  assert.ok(validateTaskLoopFindings(detachedMemoryPath).some((error) => /project-relative MEMORY\.md/.test(error)));
});

test("Bavi evidence status rows do not become findings by themselves", () => {
  const findings = projectTaskLoopFindings(reportSource({
    includeControlledOutcome: false,
    includeRepositoryFinding: false,
  }));
  const controlled = findings.summary.dimensions.find((dimension) => dimension.id === "reliable-delivery");

  assert.equal(controlled.level, "Wired");
  assert.equal(controlled.evidenceBridge.state, "wired-unobserved");
  assert.equal(findings.findings.length, 0);
  assert.equal(findings.summary.atAGlance.priorityMoves.length, 0);
  assert.deepEqual(validateTaskLoopFindings(findings), []);
});

test("Hook practice coverage does not synthesize observations at count thresholds", () => {
  const source = reportSource();
  source.repositoryEvidence.aiAgentPractice = {
    coverageRows: [{
      surface: "Hooks",
      scopes: ["Project"],
      count: 11,
      paths: [".qoder/settings.json"],
    }],
  };
  const findings = projectTaskLoopFindings(source);
  const hooks = findings.summary.aiAgentPractice.coverageRows.find((row) => row.surface === "Hooks");

  assert.equal(hooks.count, 11);
  assert.equal(Object.hasOwn(hooks, "reason"), false);
  assert.equal(Object.hasOwn(hooks, "status"), false);
  assert.equal(Object.hasOwn(hooks, "evaluation"), false);

  const chineseSource = reportSource({ locale: "zh-CN" });
  chineseSource.repositoryEvidence.aiAgentPractice = source.repositoryEvidence.aiAgentPractice;
  const chinese = projectTaskLoopFindings(chineseSource);
  const chineseHooks = chinese.summary.aiAgentPractice.coverageRows.find((row) => row.surface === "Hooks");
  assert.deepEqual(chineseHooks, hooks);

  source.repositoryEvidence.aiAgentPractice.coverageRows[0].count = 10;
  const atLimit = projectTaskLoopFindings(source);
  const atLimitHooks = atLimit.summary.aiAgentPractice.coverageRows.find((row) => row.surface === "Hooks");
  assert.equal(atLimitHooks.count, 10);
  assert.equal(Object.hasOwn(atLimitHooks, "reason"), false);
});

test("Reliable Delivery stays wired and unobserved without a linked intervention or accepted outcome", () => {
  const findings = projectTaskLoopFindings(reportSource({ includeControlledOutcome: false }));
  const controlled = findings.summary.dimensions.find((dimension) => dimension.id === "reliable-delivery");
  const finding = findings.findings.find((item) => item.id === "reliable-delivery-hook");

  assert.equal(controlled.level, "Wired");
  assert.equal(controlled.evidenceBridge.state, "wired-unobserved");
  assert.equal(finding.evidenceBridge.deliveryEvidence.length, 0);
  assert.notEqual(controlled.level, "Outcome-supported");
});

test("session-limited Bavi keeps the repository baseline at the Learning Capture floor", () => {
  const source = reportSource({ includeControlledOutcome: false });
  source.taskEpisodes = [];
  source.deliveryEvidence = [];
  source.interventionLedger = [];
  Object.assign(learningCheck(source, "lifecycle-repeat-detection"), {
    state: "Unobserved",
    summary: "No bounded task episodes remain in this source.",
    evidenceRefs: [ref("session-limited-boundary")],
    findingRefs: [],
  });
  const scoreReview = source.assessmentDecisions.find((decision) => decision.kind === "score-review");
  scoreReview.dimensions.find((dimension) => dimension.id === "learning-capture").score = LEARNING_CAPTURE_REVIEWED_SCORE_FLOOR;
  const findings = projectTaskLoopFindings(source);
  const current = findings.summary.dimensions.filter((dimension) => dimension.id !== "learning-capture");

  assert.equal(findings.summary.evidenceMode, "session-limited");
  assert.ok(current.some((dimension) => dimension.level === "Present" || dimension.level === "Wired"));
  assert.equal(current.every((dimension) => dimension.state === "Unobserved"), false);
  assert.equal(findings.summary.dimensions.find((dimension) => dimension.id === "learning-capture").score, LEARNING_CAPTURE_REVIEWED_SCORE_FLOOR);
  assert.ok(findings.summary.strengths.length > 0);
  assert.deepEqual(validateTaskLoopFindings(findings), []);
});

test("reader findings cannot claim validation or delivery without a changed Task Episode", () => {
  const findings = projectTaskLoopFindings(reportSource());
  findings.summary.evidenceBoundary.episodeCoverage = {
    episodeCount: 2,
    editedEpisodeCount: 0,
    closedEpisodeCount: 0,
    recoveredEpisodeCount: 0,
  };
  findings.findings[0].title = "Session sample has no post-edit validation";
  findings.findings[0].reason = "The sampled sessions do not contain an observed post-edit validation result.";

  assert.ok(validateTaskLoopFindings(findings).some((error) =>
    /cannot promote a session validation or delivery gap without an observed changed Task Episode/u.test(error)));
});

test("project review findings remain eligible without a changed Session Episode", () => {
  const source = reportSource();
  for (const episode of source.taskEpisodes) episode.changeSets = [];
  source.deliveryEvidence = [];
  const findings = projectTaskLoopFindings(source);

  assert.ok(findings.findings.some((finding) => finding.id === "reliable-delivery-hook"));
  assert.deepEqual(validateTaskLoopFindings(findings), []);
});

test("unobserved Learning Capture evidence gaps stay out of reader findings", () => {
  const findings = projectTaskLoopFindings(reportSource());
  findings.summary.learningCapture = {
    schemaVersion: 1,
    state: "N/A",
    summary: "No comparable intervention window is available.",
    interventions: [],
  };
  findings.findings[0].dimensionRefs = ["learning-capture"];
  findings.findings[0].title = "Learning Capture evidence boundary blocks repeat detection";
  findings.findings[0].reason = "The current evidence is not-evaluable because the review found no reusable intervention.";

  assert.ok(validateTaskLoopFindings(findings).some((error) =>
    /must keep an unobserved Learning Capture evidence gap in the evidence boundary/u.test(error)));
});

test("Bavi falls back instead of emitting an all-unobserved report", () => {
  const source = reportSource({ includeControlledOutcome: false, includeRepositoryFinding: false });
  source.repositoryEvidence.dimensions = {};
  source.taskEpisodes = [];
  source.deliveryEvidence = [];
  Object.assign(learningCheck(source, "lifecycle-repeat-detection"), {
    state: "Unobserved",
    summary: "No bounded task episodes remain in this source.",
    evidenceRefs: [ref("session-limited-boundary")],
    findingRefs: [],
  });
  source.assessmentDecisions.find((decision) => decision.kind === "score-review")
    .dimensions.find((dimension) => dimension.id === "learning-capture").score = LEARNING_CAPTURE_REVIEWED_SCORE_FLOOR;
  assert.throws(
    () => projectTaskLoopFindings(source),
    (error) => error?.code === "INSUFFICIENT_BAVI_EVIDENCE" && /Software Fluency/.test(error.message),
  );
});

test("task activity without closure is observed, not a demonstrated autonomy radius", () => {
  const source = reportSource({ includeControlledOutcome: false, includeRepositoryFinding: false });
  source.taskEpisodes = source.taskEpisodes.map((episode) => ({ ...episode, closure: { status: "open" }, repair: { status: "not-applicable" } }));
  source.deliveryEvidence = [];
  const findings = projectTaskLoopFindings(source);

  assert.equal(findings.summary.atAGlance.demonstratedAutonomyRadius.level, "R1");
  assert.equal(findings.summary.atAGlance.demonstratedAutonomyRadius.status, "observed");
  assert.match(findings.summary.atAGlance.demonstratedAutonomyRadius.reason, /no sufficient closed change evidence/i);
});

test("pending controls and unlinked session signals do not claim a delivery decision", () => {
  const pendingHook = intervention();
  delete pendingHook.episodeRef;
  const findings = projectTaskLoopFindings(reportSource({
    includeControlledOutcome: false,
    interventionLedger: [pendingHook],
    sessionEvents: {
      dimensionSignals: [{
        dimension: "reliable-delivery",
        subdimensionRefs: ["high-risk-approval"],
        evidenceRefs: [ref("unlinked-session-decision")],
      }],
    },
  }));
  const controlled = findings.summary.dimensions.find((dimension) => dimension.id === "reliable-delivery");
  const lifecycleDecision = controlled.subdimensions.find((subdimension) => subdimension.id === "high-risk-approval");

  assert.equal(controlled.level, "Wired");
  assert.equal(controlled.evidenceBridge.state, "wired-unobserved");
  assert.equal(controlled.evidenceBridge.episodeEvidence.length, 0);
  assert.equal(lifecycleDecision.level, null);
  assert.equal(lifecycleDecision.evidenceBridge.state, "unobserved");
});

test("accepted delivery must link to the observed task episode", () => {
  const source = reportSource();
  source.deliveryEvidence.find((row) => row.id === "ci-1").episodeRef = "other-episode";
  assert.throws(
    () => projectTaskLoopFindings(source),
    /must reference one retained task episode/u,
  );
});

test("provider delivery kinds project only to acceptance, approval, and recovery checks", () => {
  const source = reportSource();
  const episodeRef = source.taskEpisodes[0].id;
  const revision = "b".repeat(40);
  const acceptance = source.deliveryEvidence.find((row) => row.id === "ci-1");
  Object.assign(acceptance, { provider: "github", kind: "acceptance", revision });
  source.deliveryEvidence.push({
    id: "approval-1",
    episodeRef,
    provider: "codex-host",
    kind: "approval",
    level: "approval-decision-observed",
    status: "allowed",
    evidenceRefs: [ref("approval-1")],
  }, {
    id: "recovery-1",
    episodeRef,
    provider: "git",
    kind: "recovery",
    level: "recovery-outcome-observed",
    status: "recovered",
    evidenceRefs: [ref("recovery-1")],
  });

  const findings = projectTaskLoopFindings(source);
  const delivery = findings.summary.dimensions.find((dimension) => dimension.id === "reliable-delivery");
  assert.ok(delivery.subdimensions.find((row) => row.id === "acceptance-evidence").level);
  assert.ok(delivery.subdimensions.find((row) => row.id === "high-risk-approval").level);
  assert.ok(delivery.subdimensions.find((row) => row.id === "rollback-recovery").level);
});

test("semantic facets remain supplementary and cannot alter deterministic task-loop claims", () => {
  const baseline = projectTaskLoopFindings(reportSource());
  const enriched = projectTaskLoopFindings(reportSource({ semanticFacets: [{
    id: "workflow-1",
    schemaVersion: 1,
    kind: "goal-workflow",
    status: "candidate",
    labels: ["refactor"],
    summary: "A redacted workflow classification supplements the task episode.",
    evidenceRefs: [ref("workflow-1")],
    modelVersion: "fixture-facet-v1",
  }] }));

  assert.deepEqual(enriched.summary.dimensions, baseline.summary.dimensions);
  assert.equal(enriched.summary.semanticFacets.status, "supplementary");
  assert.equal(enriched.summary.semanticFacets.entries[0].kind, "goal-workflow");
  assert.doesNotMatch(renderMarkdown(enriched), /redacted workflow classification/i);
});

test("finding validation preserves AI-owned reader copy and rejects private values", () => {
  const heading = projectTaskLoopFindings(reportSource());
  heading.findings[0].title = "Verification: Unobserved acceptance bridge";
  assert.deepEqual(validateTaskLoopFindings(heading), []);

  const mixedLocale = projectTaskLoopFindings(reportSource({ locale: "zh-CN" }));
  mixedLocale.findings[0].title = "Change validation lacks linked delivery proof";
  mixedLocale.findings[0].reason = "repository-wide: 缺少请求关联 ID。";
  assert.deepEqual(validateTaskLoopFindings(mixedLocale), []);

  const privateCopy = projectTaskLoopFindings(reportSource());
  privateCopy.findings[0].reason = "Inspect /Users/example/private/config.json before continuing.";
  assert.ok(validateTaskLoopFindings(privateCopy).some((error) => /must not expose private paths/u.test(error)));

  privateCopy.findings[0].reason = "Inspect ~/Library/Application Support/private/config.json before continuing.";
  assert.ok(validateTaskLoopFindings(privateCopy).some((error) => /must not expose private paths/u.test(error)));
});

test("longitudinal Learning Capture diagnostics reserve Effective for an outcome-supported comparison", () => {
  const pending = projectTaskLoopFindings(reportSource());
  const effective = projectTaskLoopFindings(reportSource({
    interventionLedger: [intervention({
      state: "outcome-supported",
      taskMix: "comparable",
      selectionStrategy: "stratified",
      primaryValue: 4,
      guardrailValue: 0.08,
      outcomeEvidenceRefs: [ref("ci-accepted")],
      effectiveness: "Effective",
    })],
  }));

  assert.equal(pending.summary.learningCapture.state, "pending");
  assert.equal(pending.summary.learningCapture.effectiveness, undefined);
  assert.equal(effective.summary.learningCapture.state, "outcome-supported");
  assert.equal(effective.summary.learningCapture.effectiveness, "Effective");
  assert.equal(effective.summary.learningCapture.interventions[0].comparison.valid, true);
  assert.equal(effective.summary.learningCapture.interventions[0].comparison.effectiveness, "Effective");
  assert.deepEqual(validateTaskLoopFindings(effective), []);

  const forged = JSON.parse(JSON.stringify(effective));
  forged.summary.learningCapture.interventions[0].comparison.valid = false;
  assert.ok(validateTaskLoopFindings(forged).some((error) => /only for a valid outcome-supported comparison/i.test(error)));
});

test("a retained ledger stays dormant until current Loop Engineering is Exercised", () => {
  const source = reportSource({
    includeRepositoryFinding: false,
    interventionLedger: [intervention({
      state: "outcome-supported",
      taskMix: "comparable",
      selectionStrategy: "stratified",
      primaryValue: 4,
      guardrailValue: 0.08,
      outcomeEvidenceRefs: [ref("historical-outcome")],
      effectiveness: "Effective",
    })],
  });
  Object.assign(learningCheck(source, "loop-engineering"), {
    state: "Missing",
    mechanisms: [],
    summary: "The retained owner is not exercised in the current reviewed window.",
  });
  delete learningCheck(source, "loop-engineering").candidateOwner;
  delete learningCheck(source, "loop-engineering").ownerSelectionEvidenceRefs;
  delete learningCheck(source, "loop-engineering").currentValidationEvidenceRefs;
  Object.assign(learningCheck(source, "later-validation"), {
    state: "Unobserved",
    summary: "Historical comparison evidence is retained without activating current validation.",
  });
  source.assessmentDecisions.find((decision) => decision.kind === "score-review")
    .dimensions.find((dimension) => dimension.id === "learning-capture").score = 59;

  const findings = projectTaskLoopFindings(source);
  const learning = findings.summary.dimensions.find((dimension) => dimension.id === "learning-capture");
  assert.equal(learning.subdimensions.find((row) => row.id === "later-validation").state, "Unobserved");
  assert.equal(findings.summary.learningCapture.state, "N/A");
  assert.equal(findings.summary.learningCapture.effectiveness, undefined);
  assert.equal(findings.summary.learningCapture.interventions.length, 1);
  assert.equal(findings.summary.learningCapture.interventions[0].comparison.effectiveness, "Effective");
  assert.match(findings.summary.learningCapture.summary, /retained but dormant/i);
  assert.deepEqual(validateTaskLoopFindings(findings), []);

  const wrongState = structuredClone(findings);
  wrongState.summary.learningCapture.state = "outcome-supported";
  assert.ok(validateTaskLoopFindings(wrongState)
    .some((error) => /state must be N\/A for the current Loop Engineering state/.test(error)));

  const wrongEffectiveness = structuredClone(findings);
  wrongEffectiveness.summary.learningCapture.effectiveness = "Effective";
  assert.ok(validateTaskLoopFindings(wrongEffectiveness)
    .some((error) => /effectiveness must be omitted for the structured aggregate state/.test(error)));

  const readerCopy = structuredClone(findings);
  readerCopy.summary.learningCapture.summary = "Effective remains a reader word here, not a structured aggregate claim.";
  assert.deepEqual(validateTaskLoopFindings(readerCopy), []);
});

test("mixed regression and outcome support suppress aggregate Effective while retaining the valid item", () => {
  const findings = projectTaskLoopFindings(reportSource({
    includeRepositoryFinding: false,
    interventionLedger: [
      intervention({
        id: "historical-effective",
        state: "outcome-supported",
        taskMix: "comparable",
        selectionStrategy: "stratified",
        primaryValue: 4,
        guardrailValue: 0.08,
        outcomeEvidenceRefs: [ref("historical-outcome")],
        effectiveness: "Effective",
      }),
      intervention({
        id: "current-regression",
        state: "regressing",
        taskMix: "comparable",
        primaryValue: 10,
        guardrailValue: 0.1,
      }),
    ],
  }));
  const learning = findings.summary.dimensions.find((dimension) => dimension.id === "learning-capture");
  assert.equal(learning.subdimensions.find((row) => row.id === "later-validation").state, "Exercised");
  assert.equal(findings.summary.learningCapture.state, "regressing");
  assert.equal(findings.summary.learningCapture.effectiveness, undefined);
  assert.equal(findings.summary.learningCapture.interventions
    .find((item) => item.id === "historical-effective").comparison.effectiveness, "Effective");
  assert.deepEqual(validateTaskLoopFindings(findings), []);

  const forged = structuredClone(findings);
  forged.summary.learningCapture.effectiveness = "Effective";
  assert.ok(validateTaskLoopFindings(forged)
    .some((error) => /effectiveness must be omitted for the structured aggregate state/.test(error)));
});

test("Loop Engineering can be exercised from current validation without a later-validation ledger", () => {
  const source = reportSource({ includeRepositoryFinding: false, interventionLedger: [] });
  Object.assign(learningCheck(source, "loop-engineering"), {
    state: "Exercised",
    mechanisms: ["hook"],
    candidateOwner: "hook",
    ownerSelectionEvidenceRefs: [ref("loop-discovery-hook-owner")],
    currentValidationEvidenceRefs: [ref("hook-current-validation")],
    summary: "The reviewed Hook owner ran successfully on the supported repeated workflow.",
  });
  Object.assign(learningCheck(source, "later-validation"), {
    state: "Unobserved",
    summary: "The bounded review did not inspect whether a complete later-comparison plan exists.",
  });

  assert.deepEqual(validateHarnessReportSource(source), []);
  const findings = projectTaskLoopFindings(source);
  const learning = findings.summary.dimensions.find((dimension) => dimension.id === "learning-capture");
  const engineering = learning.subdimensions.find((subdimension) => subdimension.id === "loop-engineering");

  assert.equal(engineering.state, "Exercised");
  assert.ok(engineering.evidenceBridge.staticEvidence.some((reference) => reference.id === "hook-current-validation"));
  assert.ok(learning.evidenceBridge.staticEvidence.some((reference) => reference.id === "hook-current-validation"));
});

test("an inspected missing comparison plan projects one bidirectionally linked finding", () => {
  const source = reportSource({ includeRepositoryFinding: false, interventionLedger: [] });
  Object.assign(learningCheck(source, "loop-engineering"), {
    state: "Exercised",
    mechanisms: ["hook"],
    candidateOwner: "hook",
    ownerSelectionEvidenceRefs: [ref("loop-discovery-hook-owner")],
    currentValidationEvidenceRefs: [ref("hook-current-validation")],
    summary: "The reviewed Hook owner ran successfully on the supported repeated workflow.",
  });
  Object.assign(learningCheck(source, "later-validation"), {
    state: "Missing",
    summary: "The exercised route has no complete later-comparison plan.",
    evidenceRefs: [ref("missing-comparison-plan")],
    findingRefs: [],
  });

  assert.ok(validateHarnessReportSource(source)
    .some((error) => /later-validation Missing requires an ordinary finding/u.test(error)));

  const findingId = "later-validation-plan-gap";
  source.repositoryEvidence.findings = [{
    id: findingId,
    kind: "missing-mechanism",
    severity: "Medium",
    title: "The route lacks a later-comparison plan",
    reason: "The operating route ran with current validation, but no baseline, primary metric, guardrail, comparable scope, selection rule, validation method, and stop or revert condition were retained for a later window.",
    expectedOutcome: "The route retains a complete bounded comparison plan before making a later-effect claim.",
    expectedArtifact: "Rule",
    expectedOutput: ["Update the intervention owner Rule so it retains a complete bounded later-comparison plan before any effect claim."],
    dimensionRefs: ["learning-capture"],
    subdimensionRefs: ["later-validation"],
    staticEvidence: [ref("missing-comparison-plan")],
    aiFixPrompt: "/better-harness fix this issue\n\nUpdate the intervention owner Rule with a baseline, primary metric, guardrail, comparable scope, selection rule, validation method, and stop or revert condition.\n\n## Validation\n\n- Validate the completed comparison plan against the Learning Capture source contract\n- Confirm later-validation is Present only after the complete plan is retained",
  }];
  learningCheck(source, "later-validation").findingRefs = [findingId];

  assert.deepEqual(validateHarnessReportSource(source), []);
  const findings = projectTaskLoopFindings(source);
  assert.deepEqual(validateTaskLoopFindings(findings), []);

  const multipleOwners = structuredClone(findings);
  multipleOwners.findings.find((finding) => finding.id === findingId)
    .subdimensionRefs.push("loop-engineering");
  assert.deepEqual(validateTaskLoopFindings(multipleOwners), []);

  const missingReverseLink = structuredClone(findings);
  missingReverseLink.summary.dimensions.find((dimension) => dimension.id === "learning-capture")
    .subdimensions.find((subdimension) => subdimension.id === "later-validation").findingRefs = [];
  assert.deepEqual(validateTaskLoopFindings(missingReverseLink), []);
});

test("pending interventions remain diagnostics while regressions retain an actionable finding", () => {
  const skillOwned = projectTaskLoopFindings(reportSource({
    interventionLedger: [intervention({ assetType: "skill", assetLabel: "Review closure playbook" })],
  }));
  const regressing = projectTaskLoopFindings(reportSource({
    interventionLedger: [intervention({
      state: "regressing",
      taskMix: "comparable",
      primaryValue: 10,
      guardrailValue: 0.1,
      assetType: "skill",
    })],
  }));
  assert.equal(skillOwned.findings.some((finding) => finding.id === "learning-capture-follow-up"), false);
  assert.equal(regressing.findings.some((finding) => finding.id === "later-validation-regression"), true);
  assert.equal(skillOwned.summary.learningCapture.state, "pending");
  assert.equal(regressing.summary.learningCapture.state, "regressing");
  assert.deepEqual(validateTaskLoopFindings(regressing), []);
});

test("a regressing later comparison keeps the independent score but cannot claim an effect", () => {
  const findings = projectTaskLoopFindings(reportSource({
    includeRepositoryFinding: false,
    interventionLedger: [intervention({
      state: "regressing",
      taskMix: "comparable",
      primaryValue: 10,
      guardrailValue: 0.1,
      assetType: "skill",
    })],
  }));
  const learning = findings.summary.dimensions.find((dimension) => dimension.id === "learning-capture");
  const later = learning.subdimensions.find((subdimension) => subdimension.id === "later-validation");

  assert.equal(learning.score, 70);
  assert.equal(later.state, "Exercised");
  assert.deepEqual(later.findingRefs, ["later-validation-regression"]);
  assert.match(learning.blocker, /stop or revert/i);
  assert.equal(findings.summary.learningCapture.state, "regressing");
  assert.equal(findings.summary.learningCapture.effectiveness, undefined);
  assert.deepEqual(validateTaskLoopFindings(findings), []);

  const falseEffect = JSON.parse(JSON.stringify(findings));
  falseEffect.summary.dimensions.find((dimension) => dimension.id === "learning-capture")
    .subdimensions.find((subdimension) => subdimension.id === "later-validation").state = "Outcome-supported";
  assert.ok(validateTaskLoopFindings(falseEffect).some((error) => /later-validation Outcome-supported requires an outcome-supported learning summary/.test(error)));
});

test("ordinary findings cannot claim the reserved intervention follow-up id", () => {
  const source = reportSource({ includeRepositoryFinding: false, interventionLedger: [] });
  source.repositoryEvidence.findings = [{
    id: "learning-capture-follow-up",
    kind: "capture-gap",
    severity: "Low",
    title: "Review handoffs have no reusable Skill procedure",
    reason: "The reviewed lifecycle boundary confirms the missing procedure.",
    expectedOutcome: "Review uses one reusable procedure.",
    expectedArtifact: "Skill",
    dimensionRefs: ["learning-capture"],
    subdimensionRefs: ["loop-engineering"],
    staticEvidence: [ref("lifecycle-gap")],
  }];

  assert.throws(
    () => projectTaskLoopFindings(source),
    /learning-capture-follow-up.*reserved|reserved.*learning-capture-follow-up/u,
  );
});

test("duplicate repository finding ids fail closed", () => {
  const source = reportSource({ includeRepositoryFinding: false, interventionLedger: [] });
  source.repositoryEvidence.findings = [{
    id: "reusable-capture-gap",
    kind: "evidence-gap",
    severity: "High",
    title: "Tracked configuration contains embedded credentials",
    reason: "A redacted high-confidence scan found a reusable credential in tracked automation configuration.",
    expectedOutcome: "Automation reads a rotated credential from the approved secret store.",
    expectedArtifact: "Config",
    dimensionRefs: ["reliable-delivery"],
    subdimensionRefs: ["permission-boundary"],
    staticEvidence: [ref("credential-scan")],
    projectionPolicy: "required",
  }];
  source.repositoryEvidence.findings.push({
    id: "reusable-capture-gap",
    kind: "capture-gap",
    severity: "Low",
    title: "Repeated review handoffs have no reusable Skill procedure",
    reason: "Two bounded episodes show the same uncovered review procedure.",
    expectedOutcome: "Review uses one reusable Skill procedure.",
    expectedArtifact: "Skill",
    dimensionRefs: ["learning-capture"],
    subdimensionRefs: ["loop-engineering"],
    staticEvidence: [ref("lifecycle-gap")],
  });

  assert.throws(
    () => projectTaskLoopFindings(source),
    /duplicate.*reusable-capture-gap|reusable-capture-gap.*duplicate/u,
  );
});

test("reviewed findings cannot collide with generated diagnostic ids", () => {
  const source = reportSource({ includeRepositoryFinding: false, interventionLedger: [] });
  source.repositoryEvidence.diagnosticCoverageReviews = [diagnosticReview({
    status: "confirmed-gap",
    affectedScope: "src/core/request.ts",
    title: "Request failures lose their correlation id",
    missingSegment: "the completion event does not retain the request id",
    impact: "Failure diagnosis cannot reconnect the request chain.",
    expectedOutcome: "Every completion event retains the effective request id.",
    severity: "Medium",
    expectedArtifact: "Code",
    aiFixPrompt: "/better-harness fix this issue\n\nUpdate the request completion path so it retains the effective request id.\n\n## Validation\n\n- Run the focused request diagnostics test",
  })];
  source.repositoryEvidence.findings = [{
    id: "diagnostic-core-chain",
    kind: "evidence-gap",
    severity: "Medium",
    title: "A reviewed task also uses the diagnostic id",
    reason: "The source row intentionally collides with the generated diagnostic row.",
    expectedOutcome: "Each finding producer owns a unique id.",
    expectedArtifact: "Rule",
    dimensionRefs: ["task-understanding"],
    subdimensionRefs: ["goal-understanding"],
    staticEvidence: [ref("collision")],
  }];

  assert.throws(
    () => projectTaskLoopFindings(source),
    /collides with a generated finding id: diagnostic-core-chain/u,
  );
});

test("task-loop findings reject legacy dimensions and pass the shared Canvas validators", () => {
  const findings = projectTaskLoopFindings(reportSource());
  findings.summary.dimensions[0].id = "safe-change";
  const errors = validateTaskLoopFindings(findings);
  assert.ok(errors.some((error) => /unsupported task-loop dimension: safe-change/i.test(error)));

  const withoutUsage = projectTaskLoopFindings(reportSource());
  const withoutUsageChecks = evaluateBetterHarnessArtifacts({
    findingsText: JSON.stringify(withoutUsage),
    reportText: renderBetterHarnessReportCanvas(),
  });
  assert.equal(withoutUsageChecks.find((check) => check.id === "better-harness-findings")?.status, "pass");

  const halfUsage = projectTaskLoopFindings(reportSource());
  halfUsage.summary.usageActivity = completeUsageSessionEvents(4).usageActivity;
  assert.ok(evaluateBetterHarnessArtifacts({
    findingsText: JSON.stringify(halfUsage),
    reportText: renderBetterHarnessReportCanvas(),
  }).find((check) => check.id === "better-harness-findings")
    ?.errors.some((error) => /usageActivity and summary\.usageEfficiency must be supplied together/.test(error)));

  const mismatchedUsage = projectTaskLoopFindings(reportSource({ sessionEvents: completeUsageSessionEvents(4) }));
  mismatchedUsage.summary.usageActivity.sessions.total = 40;
  assert.ok(evaluateBetterHarnessArtifacts({
    findingsText: JSON.stringify(mismatchedUsage),
    reportText: renderBetterHarnessReportCanvas(),
  }).find((check) => check.id === "better-harness-findings")
    ?.errors.some((error) => /complete 4\/4 all-eligible session population/.test(error)));

  const valid = projectTaskLoopFindings(reportSource({ sessionEvents: completeUsageSessionEvents(4) }));
  const reportText = renderBetterHarnessReportCanvas();
  const checks = evaluateBetterHarnessArtifacts({
    findingsText: JSON.stringify(valid),
    reportText,
  });
  assert.equal(checks.find((check) => check.id === "better-harness-findings")?.status, "pass", JSON.stringify(checks, null, 2));
  assert.equal(checks.find((check) => check.id === "better-harness-report")?.status, "pass", JSON.stringify(checks, null, 2));
});

test("task-loop findings split host-consumed and Canvas-only data without duplication", () => {
  const full = projectTaskLoopFindings(reportSource({ sessionEvents: completeUsageSessionEvents(4) }));
  const { findings, canvas } = splitTaskLoopFindings(full);

  assert.deepEqual(validateTaskLoopCanvasSplit(findings, canvas), []);
  assert.equal(Object.hasOwn(findings.summary, "semanticFacets"), false);
  assert.equal(Object.hasOwn(findings.summary, "usageEfficiency"), false);
  assert.equal(Object.hasOwn(findings.summary, "learningCapture"), false);
  assert.deepEqual(canvas.summary.learningCapture, full.summary.learningCapture);
  assert.equal(Object.hasOwn(canvas.summary, "strengths"), false);
  assert.equal(Object.hasOwn(findings.summary, "atAGlance"), false);
  assert.equal(canvas.summary.atAGlance.demonstratedAutonomyRadius.reason, full.summary.atAGlance.demonstratedAutonomyRadius.reason);
  assert.deepEqual(mergeTaskLoopCanvasData(findings, canvas), full);

  const futureFindings = structuredClone(findings);
  futureFindings.summary.reportContractVersion = 999;
  const futureCanvas = structuredClone(canvas);
  futureCanvas.schemaVersion = 999;
  assert.deepEqual(validateTaskLoopCanvasSplit(futureFindings, futureCanvas), []);

});

test("analyzer-owned Canvas facts override lead summary overlap without changing legacy merge", () => {
  const source = reportSource({ sessionEvents: completeUsageSessionEvents(4) });
  source.repositoryEvidence.aiAgentPractice = {
    coverageRows: [
      {
        surface: "Memories",
        scopes: ["Project"],
        count: 60,
        paths: ["~/.qoder/memories/account/projects/example/project_introduction/memory.md"],
      },
      { surface: "MCP", scopes: ["Global"], count: 3, paths: ["~/.qoder/mcp.json"] },
      { surface: "Plugins", scopes: ["Plugin"], count: 5, paths: ["~/.qoder/plugins/example/plugin.json"] },
    ],
  };
  const full = projectTaskLoopFindings(source);
  const { findings } = splitTaskLoopFindings(full);
  const lead = structuredClone(findings);
  lead.summary.evidenceMode = "stale-lead-value";
  lead.summary.usageActivity = structuredClone(full.summary.usageActivity);
  lead.summary.usageActivity.sessions.total = 99;
  lead.summary.usageEfficiency = structuredClone(full.summary.usageEfficiency);
  lead.summary.usageEfficiency.selection.eligibleSessionCount = 99;
  lead.summary.usageEfficiency.selection.analyzedSessionCount = 99;
  lead.summary.aiAgentPractice.coverageRows.find((row) => row.surface === "Memories").paths = ["MEMORY.md"];
  lead.summary.aiAgentPractice.coverageRows = lead.summary.aiAgentPractice.coverageRows.filter((row) =>
    !["MCP", "Plugins"].includes(row.surface));
  lead.summary.aiAgentPractice.inspectedSurfaces = ["Rules"];

  const analyzerCanvas = taskLoopCanvasFromSummaryFacts(projectTaskLoopReportFacts(source));
  assert.deepEqual(analyzerCanvas.summary.aiAgentPractice.inspectedSurfaces, []);
  assert.equal(Object.hasOwn(
    analyzerCanvas.summary.aiAgentPractice.coverageRows.find((row) => row.surface === "MCP"),
    "paths",
  ), false);
  assert.equal(Object.hasOwn(
    analyzerCanvas.summary.aiAgentPractice.coverageRows.find((row) => row.surface === "Plugins"),
    "paths",
  ), false);
  const merged = mergeTaskLoopCanvasData(lead, analyzerCanvas);
  assert.equal(merged.summary.evidenceMode, full.summary.evidenceMode);
  assert.equal(merged.summary.usageActivity.sessions.total, 4);
  assert.equal(merged.summary.usageEfficiency.selection.eligibleSessionCount, 4);
  assert.deepEqual(
    merged.summary.aiAgentPractice.coverageRows.find((row) => row.surface === "Memories"),
    {
      surface: "Memories",
      scopes: ["Project"],
      count: 60,
    },
  );
  assert.equal(merged.summary.aiAgentPractice.coverageRows.find((row) => row.surface === "MCP")?.count, 3);
  assert.equal(merged.summary.aiAgentPractice.coverageRows.find((row) => row.surface === "Plugins")?.count, 5);
  assert.deepEqual(merged.summary.aiAgentPractice.inspectedSurfaces, ["Rules"]);
  assert.equal(Object.hasOwn(merged, "summaryFactsSchemaVersion"), false);

  const legacyCanvas = structuredClone(analyzerCanvas);
  delete legacyCanvas.summaryFactsSchemaVersion;
  const legacyMerged = mergeTaskLoopCanvasData(lead, legacyCanvas);
  assert.equal(legacyMerged.summary.evidenceMode, "stale-lead-value");
  assert.equal(legacyMerged.summary.usageActivity.sessions.total, 99);
  assert.deepEqual(
    legacyMerged.summary.aiAgentPractice.coverageRows.find((row) => row.surface === "Memories").paths,
    ["MEMORY.md"],
  );
});

test("analyzer-owned Canvas facts require complete usage for eligible sessions", () => {
  assert.throws(
    () => taskLoopCanvasFromSummaryFacts({
      evidenceMode: "session-rich",
      evidenceBoundary: {
        manifest: { selection: { eligibleCount: 2 } },
        deliveryEvidenceLevels: [],
        sourceGaps: [],
      },
      semanticFacets: {},
      learningCapture: {},
    }),
    /usageActivity and summary\.usageEfficiency are required for 2 eligible sessions/u,
  );
});

test("full Codex findings require usage for the frozen eligible population", () => {
  const full = projectTaskLoopFindings(reportSource({ sessionEvents: completeUsageSessionEvents(4) }));
  full.summary.evidenceBoundary.manifest.platform = "codex";
  delete full.summary.usageActivity;
  delete full.summary.usageEfficiency;

  assert.match(
    validateTaskLoopFindings(full).join("; "),
    /usageActivity and summary\.usageEfficiency are required for 4 eligible sessions/u,
  );
});

test("render merge rejects modified analyzer-owned Canvas facts", () => {
  const source = reportSource({ sessionEvents: completeUsageSessionEvents(4) });
  const full = projectTaskLoopFindings(source);
  const { findings } = splitTaskLoopFindings(full);
  const incomplete = taskLoopCanvasFromSummaryFacts(projectTaskLoopReportFacts(source));
  delete incomplete.summary.usageEfficiency;
  assert.throws(
    () => mergeTaskLoopCanvasData(findings, incomplete),
    /usageActivity and summary\.usageEfficiency must be supplied together/u,
  );

  const mismatched = taskLoopCanvasFromSummaryFacts(projectTaskLoopReportFacts(source));
  mismatched.summary.usageEfficiency.selection.eligibleSessionCount = 3;
  mismatched.summary.usageEfficiency.selection.analyzedSessionCount = 3;
  mismatched.summary.usageActivity.sessions.total = 3;
  assert.throws(
    () => mergeTaskLoopCanvasData(findings, mismatched),
    /usage census must match the 4-session evidence boundary/u,
  );
});

test("task-loop findings preserve structured package targets through split and merge", () => {
  const source = reportSource();
  const target = {
    kind: "workspace-member",
    packageRoute: "packages/app",
    ownerRoute: "packages/app",
  };
  source.repositoryEvidence.findingTarget = target;

  const full = projectTaskLoopFindings(source);
  assert.ok(full.findings.length > 0);
  assert.ok(full.findings.every((finding) => (
    finding.target.kind === target.kind
    && finding.target.packageRoute === target.packageRoute
    && finding.target.ownerRoute === target.ownerRoute
  )));
  assert.deepEqual(validateTaskLoopFindings(full), []);

  const split = splitTaskLoopFindings(full);
  assert.ok(split.findings.findings.every((finding) => finding.target.packageRoute === "packages/app"));
  assert.ok(split.canvas.findings.every((finding) => !Object.hasOwn(finding, "target")));
  const merged = mergeTaskLoopCanvasData(split.findings, split.canvas);
  assert.ok(merged.findings.every((finding) => finding.target.ownerRoute === "packages/app"));
});

test("practice findings preserve root and package owners through final projection", () => {
  const topology = memberTopology(path.resolve("/tmp/better-harness-owner-projection"), "packages/a");
  const practice = projectAgentLintPracticeEvidence({
    topology,
    instructionReview: {
      profile: "agents-md-review",
      findings: [{
        id: "missing-local-reference",
        severity: "warning",
        file: "AGENTS.md",
        packageRoute: ".",
        ownerRoute: ".",
      }, {
        id: "missing-local-reference",
        severity: "warning",
        file: "packages/a/AGENTS.md",
        packageRoute: "packages/a",
        ownerRoute: "packages/a",
      }],
    },
  });

  assert.equal(practice.findings.length, 2);
  assert.deepEqual(practice.findings.map((finding) => finding.target.ownerRoute), [".", "packages/a"]);
  assert.notEqual(practice.findings[0].id, practice.findings[1].id);

  const source = reportSource({ includeRepositoryFinding: false, interventionLedger: [] });
  source.repositoryEvidence.findingTarget = {
    kind: "workspace-member",
    packageRoute: "packages/a",
    ownerRoute: "packages/a",
  };
  source.repositoryEvidence.findings = practice.findings;
  const projected = projectTaskLoopFindings(source);

  assert.deepEqual(projected.findings.map((finding) => finding.target.ownerRoute), [".", "packages/a"]);
  assert.deepEqual(validateTaskLoopFindings(projected), []);

  source.repositoryEvidence.findings[0].target = null;
  const invalid = projectTaskLoopFindings(source);
  assert.equal(invalid.findings[0].target, null);
  assert.match(validateTaskLoopFindings(invalid).join("; "), /target must be an object/u);
});

async function htmlFixFixture(root) {
  const workspace = path.join(root, "workspace");
  const runDir = path.join(workspace, ".codex", "better-harness", "run");
  const findingsPath = path.join(runDir, "findings.json");
  const markdownPath = path.join(runDir, "report.md");
  const htmlPath = path.join(runDir, "report.html");
  const resultPath = path.join(root, "result.json");
  const targetPath = "fix-output/owner.md";
  const split = splitTaskLoopFindings(projectTaskLoopFindings(reportSource()));
  const finding = split.findings.findings[0];
  const reportData = normalizeReportData(split.findings, {
    mode: "html",
    language: split.findings.summary.locale,
    target: workspace,
    dataPath: findingsPath,
  });
  const resultPayload = {
    actualOutput: [{
      action: "updated",
      artifact: finding.expectedArtifact,
      name: `${finding.expectedArtifact} owner`,
      scope: "Project",
      path: targetPath,
      summary: "Updated the finding owner and retained its focused validation result.",
    }],
    assignmentSummary: assignmentSummary({
      title: "The portable report now shows the verified fix",
      body: "The finding owner passed focused validation, and the portable report now presents the exact recorded result.",
    }),
    postFixRepairReview: {
      modelId: split.findings.summary.modelId,
      findingId: finding.id,
      status: "verified",
      summary: "The focused repair passed its target-owned validation.",
      reason: "An independent review confirmed the actual output while reserving outcome scores for a later task window.",
      confidence: "medium",
      evidenceRefs: [
        { kind: "fix-validation", id: "portable-html-owner-check" },
        { kind: "asset-integrity", id: "portable-html-integrity-check" },
      ],
    },
  };
  await mkdir(path.join(workspace, path.dirname(targetPath)), { recursive: true });
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(workspace, targetPath), "# Owner\n");
  await writeFile(findingsPath, `${JSON.stringify(split.findings, null, 2)}\n`);
  await writeFile(markdownPath, renderMarkdown(reportData));
  await writeFile(htmlPath, renderHtml(reportData, { findingsPath }));
  await writeFile(resultPath, JSON.stringify(resultPayload));
  return {
    workspace,
    runDir,
    findingsPath,
    markdownPath,
    htmlPath,
    resultPath,
    resultPayload,
    finding,
  };
}

async function htmlArtifactSnapshot(fixture) {
  return Object.fromEntries(await Promise.all([
    ["findings.json", fixture.findingsPath],
    ["report.md", fixture.markdownPath],
    ["report.html", fixture.htmlPath],
  ].map(async ([name, filePath]) => [name, await readFile(filePath, "utf8")])));
}

test("record-fix-output records portable HTML fixes and refreshes all three artifacts", async () => {
  await withTempDir(async (root) => {
    const fixture = await htmlFixFixture(root);
    const before = await htmlArtifactSnapshot(fixture);

    const recorded = await recordFixOutput({
      workspace: fixture.workspace,
      findings: fixture.findingsPath,
      findingId: fixture.finding.id,
      expectedRevision: 0,
      result: fixture.resultPath,
      consumeResult: true,
    });

    assert.equal(recorded.status, "pass");
    assert.equal(recorded.reportFamily, "html");
    assert.equal(recorded.revision, 1);
    assert.equal(recorded.repairProgress.verifiedFindingCount, 1);
    assert.equal(recorded.resultConsumed, true);
    await assert.rejects(readFile(fixture.resultPath, "utf8"), { code: "ENOENT" });
    assert.deepEqual((await readdir(fixture.runDir)).sort(), ["findings.json", "report.html", "report.md"]);

    const after = await htmlArtifactSnapshot(fixture);
    assert.notEqual(after["findings.json"], before["findings.json"]);
    assert.notEqual(after["report.md"], before["report.md"]);
    assert.notEqual(after["report.html"], before["report.html"]);
    const updated = JSON.parse(after["findings.json"]);
    assert.deepEqual(validateCompactTaskLoopFindings(updated), []);
    assert.equal(updated.findings[0].actualOutputRevision, 1);
    assert.equal(updated.findings[0].postFixRepairReview.status, "verified");
    assert.match(after["report.md"], /Asset Health \/ Repair Progress: 100\/100 \(1 verified, 0 partial, 0 pending\)/u);
    assert.match(after["report.html"], new RegExp(`${recorded.repairProgress.score}\\s*\\/\\s*100`, "u"));

    const actionPayload = JSON.parse(after["report.html"].match(
      /<script\s+id="harness-report-actions"\s+type="application\/json">([\s\S]*?)<\/script>/iu,
    )[1]);
    assert.equal(actionPayload.findings.find((row) => row.id === fixture.finding.id).expectedRevision, 1);
    const reportData = normalizeReportData(updated, {
      mode: "html",
      language: updated.summary.locale,
      target: fixture.workspace,
      dataPath: fixture.findingsPath,
    });
    assert.equal(evaluateHtmlReport(after["report.html"], reportData, {
      findingsPath: fixture.findingsPath,
    }).status, "pass");
  });
});

test("record-fix-output leaves portable HTML artifacts unchanged on pre-publish failures", async () => {
  await withTempDir(async (root) => {
    const fixture = await htmlFixFixture(root);
    const before = await htmlArtifactSnapshot(fixture);

    await assert.rejects(recordFixOutput({
      workspace: fixture.workspace,
      findings: fixture.findingsPath,
      findingId: fixture.finding.id,
      expectedRevision: 1,
      result: fixture.resultPath,
      consumeResult: true,
    }), (error) => error?.code === "STALE_FIX_OUTPUT_REVISION");
    assert.deepEqual(await htmlArtifactSnapshot(fixture), before);
    assert.ok((await readFile(fixture.resultPath, "utf8")).length > 0);

    await assert.rejects(recordFixOutput({
      workspace: fixture.workspace,
      findings: fixture.findingsPath,
      findingId: fixture.finding.id,
      expectedRevision: 0,
      result: fixture.resultPath,
      consumeResult: true,
      prepareHtmlReport() {
        throw Object.assign(new Error("simulated HTML validation failure"), {
          code: "INVALID_UPDATED_HTML_REPORT",
        });
      },
    }), (error) => error?.code === "INVALID_UPDATED_HTML_REPORT");
    assert.deepEqual(await htmlArtifactSnapshot(fixture), before);
    assert.ok((await readFile(fixture.resultPath, "utf8")).length > 0);

    await writeFile(path.join(fixture.runDir, "canvas.json"), "{}\n");
    await assert.rejects(recordFixOutput({
      workspace: fixture.workspace,
      findings: fixture.findingsPath,
      findingId: fixture.finding.id,
      expectedRevision: 0,
      result: fixture.resultPath,
    }), (error) => error?.code === "INVALID_REPORT_CONTEXT");
    assert.deepEqual(await htmlArtifactSnapshot(fixture), before);
  });
});

test("record-fix-output keeps compact Qoder reports bound to canvas.json", async () => {
  await withTempDir(async (root) => {
    const workspace = path.join(root, "workspace");
    const runDir = path.join(workspace, ".qoder", "better-harness", "run");
    const findingsPath = path.join(runDir, "findings.json");
    const resultPath = path.join(root, "result.json");
    const targetPath = "fix-output/owner.md";
    const split = splitTaskLoopFindings(projectTaskLoopFindings(reportSource()));
    const finding = split.findings.findings[0];
    await mkdir(path.join(workspace, path.dirname(targetPath)), { recursive: true });
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(workspace, targetPath), "# Owner\n");
    await writeFile(findingsPath, `${JSON.stringify(split.findings, null, 2)}\n`);
    await writeFile(path.join(runDir, "report.canvas.tsx"), "export default function Report() { return null; }\n");
    await writeFile(resultPath, JSON.stringify({
      actualOutput: [{
        action: "updated",
        artifact: finding.expectedArtifact,
        name: `${finding.expectedArtifact} owner`,
        scope: "Project",
        path: targetPath,
        summary: "Updated the verified Qoder report owner.",
      }],
      assignmentSummary: assignmentSummary(),
    }));
    const before = await readFile(findingsPath, "utf8");

    await assert.rejects(recordFixOutput({
      workspace,
      findings: findingsPath,
      findingId: finding.id,
      expectedRevision: 0,
      result: resultPath,
    }), (error) => error?.code === "INVALID_REPORT_CONTEXT" && /requires canvas\.json/u.test(error.message));
    assert.equal(await readFile(findingsPath, "utf8"), before);

    await writeFile(path.join(runDir, "canvas.json"), "{}\n");
    await assert.rejects(recordFixOutput({
      workspace,
      findings: findingsPath,
      findingId: finding.id,
      expectedRevision: 0,
      result: resultPath,
    }), (error) => error?.code === "INVALID_TASK_LOOP_FINDINGS");
    assert.equal(await readFile(findingsPath, "utf8"), before);
  });
});

test("record-fix-output rejects a finding bound to a sibling package", async () => {
  await withTempDir(async (root) => {
    const workspace = path.join(root, "packages", "b");
    const runDir = path.join(workspace, ".qoder", "better-harness", "run");
    const findingsPath = path.join(runDir, "findings.json");
    const resultPath = path.join(root, "result.json");
    const source = reportSource();
    source.repositoryEvidence.findingTarget = {
      kind: "workspace-member",
      packageRoute: "packages/a",
      ownerRoute: "packages/a",
    };
    const split = splitTaskLoopFindings(projectTaskLoopFindings(source));
    await mkdir(runDir, { recursive: true });
    await writeFile(findingsPath, `${JSON.stringify(split.findings, null, 2)}\n`);
    await writeFile(path.join(runDir, "canvas.json"), `${JSON.stringify(split.canvas, null, 2)}\n`);
    await writeFile(resultPath, JSON.stringify({
      actualOutput: [],
      assignmentSummary: assignmentSummary(),
    }));

    await assert.rejects(recordFixOutput({
      workspace,
      findings: findingsPath,
      findingId: split.findings.findings[0].id,
      expectedRevision: 0,
      result: resultPath,
      topology: memberTopology(root, "packages/b"),
    }), (error) => error?.code === "FINDING_TARGET_MISMATCH"
      && /packageRoute does not match/u.test(error.message));
  });
});

test("record-fix-output rejects ownerless package targets and partial topology", async () => {
  await withTempDir(async (root) => {
    const workspace = path.join(root, "packages", "a");
    const runDir = path.join(workspace, ".qoder", "better-harness", "run");
    const findingsPath = path.join(runDir, "findings.json");
    const resultPath = path.join(root, "result.json");
    const source = reportSource();
    source.repositoryEvidence.findingTarget = {
      kind: "workspace-member",
      packageRoute: "packages/a",
      ownerRoute: null,
    };
    const split = splitTaskLoopFindings(projectTaskLoopFindings(source));
    await mkdir(runDir, { recursive: true });
    await writeFile(findingsPath, `${JSON.stringify(split.findings, null, 2)}\n`);
    await writeFile(path.join(runDir, "canvas.json"), `${JSON.stringify(split.canvas, null, 2)}\n`);
    await writeFile(resultPath, JSON.stringify({
      actualOutput: [],
      assignmentSummary: assignmentSummary(),
    }));

    await assert.rejects(recordFixOutput({
      workspace,
      findings: findingsPath,
      findingId: split.findings.findings[0].id,
      expectedRevision: 0,
      result: resultPath,
      topology: memberTopology(root, "packages/a"),
    }), (error) => error?.code === "FINDING_TARGET_MISMATCH"
      && /ownerRoute is required/u.test(error.message));

    for (const finding of split.findings.findings) finding.target.ownerRoute = "packages/a";
    await writeFile(findingsPath, `${JSON.stringify(split.findings, null, 2)}\n`);
    const partialTopology = {
      ...memberTopology(root, "packages/a"),
      status: "partial",
    };
    await assert.rejects(recordFixOutput({
      workspace,
      findings: findingsPath,
      findingId: split.findings.findings[0].id,
      expectedRevision: 0,
      result: resultPath,
      topology: partialTopology,
    }), (error) => error?.code === "FINDING_TARGET_TOPOLOGY_INCOMPLETE");
  });
});

test("record-fix-output records an ancestor-owned result from a package callback", async () => {
  await withTempDir(async (root) => {
    const workspace = path.join(root, "packages", "a");
    const runDir = path.join(workspace, ".qoder", "better-harness", "run");
    const findingsPath = path.join(runDir, "findings.json");
    const resultPath = path.join(root, "result.json");
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(root, "AGENTS.md"), "# Root owner\n");
    const source = reportSource();
    source.repositoryEvidence.findingTarget = {
      kind: "workspace-member",
      packageRoute: "packages/a",
      ownerRoute: ".",
    };
    const split = splitTaskLoopFindings(projectTaskLoopFindings(source));
    await writeFile(findingsPath, `${JSON.stringify(split.findings, null, 2)}\n`);
    await writeFile(path.join(runDir, "canvas.json"), `${JSON.stringify(split.canvas, null, 2)}\n`);
    const finding = split.findings.findings[0];
    await writeFile(resultPath, JSON.stringify({
      actualOutput: [{
        action: "updated",
        artifact: finding.expectedArtifact,
        name: "Root Agent guidance",
        scope: "Project",
        path: "AGENTS.md",
        summary: "Updated the inherited root guidance and verified the package workflow.",
      }],
      assignmentSummary: assignmentSummary(),
    }));

    const recorded = await recordFixOutput({
      workspace,
      findings: findingsPath,
      findingId: finding.id,
      expectedRevision: 0,
      result: resultPath,
      topology: memberTopology(root, "packages/a"),
    });

    assert.equal(recorded.status, "pass");
    const updated = JSON.parse(await readFile(findingsPath, "utf8"));
    assert.equal(updated.findings[0].actualOutput[0].path, "AGENTS.md");
  });
});

test("record-fix-output replaces one latest result and increments its revision", async () => {
  await withTempDir(async (root) => {
    const workspace = path.join(root, "workspace");
    const runDir = path.join(workspace, ".Qoder", "better-harness", "run");
    const findingsPath = path.join(runDir, "findings.json");
    const canvasPath = path.join(runDir, "canvas.json");
    const targetPath = "fix-output/owner.md";
    await mkdir(path.join(workspace, "fix-output"), { recursive: true });
    await writeFile(path.join(workspace, targetPath), "# Owner\n");
    const split = splitTaskLoopFindings(projectTaskLoopFindings(reportSource()));
    await mkdir(runDir, { recursive: true });
    await writeFile(findingsPath, `${JSON.stringify(split.findings, null, 2)}\n`);
    await writeFile(canvasPath, `${JSON.stringify(split.canvas, null, 2)}\n`);
    const finding = split.findings.findings[0];
    const firstResultPath = path.join(root, "first-result.json");
    const firstAssignmentSummary = assignmentSummary({
      title: "The first verified finding result is ready",
      body: "The repair updated the finding owner and passed its focused validation, so this exact reader copy can be displayed directly.",
    });
    await writeFile(firstResultPath, JSON.stringify({
      actualOutput: [{
        action: "updated",
        artifact: finding.expectedArtifact,
        name: `${finding.expectedArtifact} owner`,
        scope: "Project",
        path: targetPath,
        summary: "Added the verified owner behavior for this finding.",
      }],
      assignmentSummary: firstAssignmentSummary,
    }));

    const first = await recordFixOutput({
      workspace,
      findings: findingsPath,
      findingId: finding.id,
      expectedRevision: 0,
      result: firstResultPath,
      consumeResult: true,
    });
    assert.equal(first.revision, 1);
    assert.deepEqual(first.scoreRefresh, { status: "unchanged", reason: "deferred-outcome-window", dimensions: [] });
    assert.equal(first.repairProgress.status, "not-started");
    assert.equal(first.resultConsumed, true);
    await assert.rejects(readFile(firstResultPath, "utf8"), { code: "ENOENT" });
    let updated = JSON.parse(await readFile(findingsPath, "utf8"));
    assert.equal(updated.findings[0].actualOutputRevision, 1);
    assert.equal(updated.findings[0].actualOutput[0].summary, "Added the verified owner behavior for this finding.");
    assert.deepEqual(updated.findings[0].assignmentSummary, firstAssignmentSummary);
    assert.deepEqual(updated.summary.assignmentSummaries, [{
      findingId: finding.id,
      revision: 1,
      ...firstAssignmentSummary,
      outputs: updated.findings[0].actualOutput,
    }]);
    assert.deepEqual(validateTaskLoopCanvasSplit(updated, split.canvas), []);

    const secondResultPath = path.join(root, "second-result.json");
    const secondAssignmentSummary = assignmentSummary({
      title: "The latest verified finding result replaced the prior result",
      body: "The follow-up repair replaced the prior owner result and passed focused validation, so only this latest reader copy remains displayable.",
    });
    await writeFile(secondResultPath, JSON.stringify({
      actualOutput: [{
        action: "updated",
        artifact: finding.expectedArtifact,
        name: `${finding.expectedArtifact} owner`,
        scope: "Project",
        path: targetPath,
        summary: "Replaced the result with the latest verified owner behavior.",
      }],
      assignmentSummary: secondAssignmentSummary,
    }));
    const second = await recordFixOutput({
      workspace,
      findings: findingsPath,
      findingId: finding.id,
      expectedRevision: 1,
      result: secondResultPath,
    });
    assert.equal(second.revision, 2);
    updated = JSON.parse(await readFile(findingsPath, "utf8"));
    assert.equal(updated.findings[0].actualOutputRevision, 2);
    assert.equal(updated.findings[0].actualOutput.length, 1);
    assert.equal(updated.findings[0].actualOutput[0].summary, "Replaced the result with the latest verified owner behavior.");
    assert.deepEqual(updated.findings[0].assignmentSummary, secondAssignmentSummary);
    assert.equal(updated.summary.assignmentSummaries.length, 1);
    assert.deepEqual(updated.summary.assignmentSummaries[0], {
      findingId: finding.id,
      revision: 2,
      ...secondAssignmentSummary,
      outputs: updated.findings[0].actualOutput,
    });
    const rewrittenProjection = structuredClone(updated);
    rewrittenProjection.summary.assignmentSummaries[0].body = "A deterministic writer fabricated replacement reader copy.";
    assert.ok(validateTaskLoopCanvasSplit(rewrittenProjection, split.canvas)
      .some((error) => /must exactly match the latest finding assignmentSummary/.test(error)));

    const staleResultPath = path.join(root, "stale-result.json");
    await writeFile(staleResultPath, await readFile(secondResultPath, "utf8"));
    await assert.rejects(recordFixOutput({
      workspace,
      findings: findingsPath,
      findingId: finding.id,
      expectedRevision: 1,
      result: staleResultPath,
      consumeResult: true,
    }), (error) => error?.code === "STALE_FIX_OUTPUT_REVISION");
    assert.equal(JSON.parse(await readFile(findingsPath, "utf8")).findings[0].actualOutputRevision, 2);
    assert.ok((await readFile(staleResultPath, "utf8")).includes("actualOutput"));
  });
});

test("record-fix-output does not resolve Home for purely Project actualOutput", async () => {
  await withTempDir(async (root) => {
    const workspace = path.join(root, "workspace");
    const runDir = path.join(workspace, ".Qoder", "better-harness", "run");
    const findingsPath = path.join(runDir, "findings.json");
    const canvasPath = path.join(runDir, "canvas.json");
    const targetPath = "fix-output/project-owner.md";
    const split = splitTaskLoopFindings(projectTaskLoopFindings(reportSource()));
    const finding = split.findings.findings[0];
    const resultPath = path.join(root, "result.json");
    const unavailableHome = path.join(root, "unavailable-home");
    await mkdir(path.join(workspace, path.dirname(targetPath)), { recursive: true });
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(workspace, targetPath), "# Project owner\n");
    await writeFile(findingsPath, `${JSON.stringify(split.findings, null, 2)}\n`);
    await writeFile(canvasPath, `${JSON.stringify(split.canvas, null, 2)}\n`);
    await writeFile(resultPath, JSON.stringify({
      actualOutput: [{
        action: "updated",
        artifact: finding.expectedArtifact,
        name: `${finding.expectedArtifact} project owner`,
        scope: "Project",
        path: targetPath,
        summary: "Recorded the verified Project-scoped owner result.",
      }],
      assignmentSummary: assignmentSummary(),
    }));

    const invocation = spawnSync(process.execPath, [
      path.resolve("scripts/harness-analysis/record-fix-output.mjs"),
      "--workspace", workspace,
      "--findings", findingsPath,
      "--finding-id", finding.id,
      "--expected-revision", "0",
      "--result", resultPath,
      "--json",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, HOME: unavailableHome, USERPROFILE: unavailableHome },
    });

    assert.equal(invocation.status, 0, invocation.stderr);
    const result = JSON.parse(invocation.stdout);
    assert.equal(result.kind, "harness-fix-output-record");
    assert.equal(result.status, "pass");
    assert.equal(result.findingsPath, findingsPath);
    assert.equal(result.findingId, finding.id);
    assert.equal(result.revision, 1);
    assert.equal(result.actualOutputCount, 1);
  });
});

test("record-fix-output resolves Home only for Global actualOutput", async () => {
  await withTempDir(async (root) => {
    const prepareGlobalFixture = async (name) => {
      const workspace = path.join(root, name, "workspace");
      const runDir = path.join(workspace, ".Qoder", "better-harness", "run");
      const findingsPath = path.join(runDir, "findings.json");
      const resultPath = path.join(root, name, "result.json");
      const split = splitTaskLoopFindings(projectTaskLoopFindings(reportSource()));
      const finding = split.findings.findings[0];
      await mkdir(runDir, { recursive: true });
      await writeFile(findingsPath, `${JSON.stringify(split.findings, null, 2)}\n`);
      await writeFile(path.join(runDir, "canvas.json"), `${JSON.stringify(split.canvas, null, 2)}\n`);
      await writeFile(resultPath, JSON.stringify({
        actualOutput: [{
          action: "updated",
          artifact: finding.expectedArtifact,
          name: `${finding.expectedArtifact} global owner`,
          scope: "Global",
          path: "~/global-owner.md",
          summary: "Recorded the verified Global-scoped owner result.",
        }],
        assignmentSummary: assignmentSummary(),
      }));
      return { workspace, findingsPath, resultPath, finding };
    };
    const invoke = (fixture, home) => spawnSync(process.execPath, [
      path.resolve("scripts/harness-analysis/record-fix-output.mjs"),
      "--workspace", fixture.workspace,
      "--findings", fixture.findingsPath,
      "--finding-id", fixture.finding.id,
      "--expected-revision", "0",
      "--result", fixture.resultPath,
      "--json",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });

    const fakeHome = path.join(root, "fake-home");
    await mkdir(fakeHome, { recursive: true });
    await writeFile(path.join(fakeHome, "global-owner.md"), "# Global owner\n");
    const successful = await prepareGlobalFixture("success");
    const successfulInvocation = invoke(successful, fakeHome);
    assert.equal(successfulInvocation.status, 0, successfulInvocation.stderr);
    assert.equal(JSON.parse(successfulInvocation.stdout).status, "pass");
    assert.equal(JSON.parse(await readFile(successful.findingsPath, "utf8")).findings[0].actualOutputRevision, 1);

    const unavailable = await prepareGlobalFixture("unavailable");
    const before = await readFile(unavailable.findingsPath, "utf8");
    const unavailableInvocation = invoke(unavailable, path.join(root, "unavailable-home"));
    assert.equal(unavailableInvocation.status, 1);
    assert.equal(unavailableInvocation.stderr, "");
    const error = JSON.parse(unavailableInvocation.stdout);
    assert.equal(error.kind, "harness-fix-output-record");
    assert.equal(error.status, "error");
    assert.match(error.message, /ENOENT|no such file|realpath/u);
    assert.equal(await readFile(unavailable.findingsPath, "utf8"), before);
  });
});

test("record-fix-output keeps JSON failures machine-readable", () => {
  const result = spawnSync(process.execPath, [
    path.resolve("scripts/better-harness.mjs"),
    "harness",
    "record-fix-output",
    "--json",
  ], {
    cwd: path.resolve("."),
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), {
    kind: "harness-fix-output-record",
    status: "error",
    code: "FIX_OUTPUT_RECORD_FAILED",
    message: "--workspace is required",
  });
});

test("record-fix-output records independent repair progress without changing Loop Effectiveness", async () => {
  await withTempDir(async (root) => {
    const workspace = path.join(root, "workspace");
    const runDir = path.join(workspace, ".qoder", "better-harness", "run");
    const findingsPath = path.join(runDir, "findings.json");
    const targetPath = "fix-output/owner.md";
    const split = splitTaskLoopFindings(projectTaskLoopFindings(reportSource()));
    const finding = split.findings.findings[0];
    await mkdir(path.join(workspace, "fix-output"), { recursive: true });
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(workspace, targetPath), "# Owner\n");
    await writeFile(findingsPath, `${JSON.stringify(split.findings, null, 2)}\n`);
    await writeFile(path.join(runDir, "canvas.json"), `${JSON.stringify(split.canvas, null, 2)}\n`);

    const originalDimensions = structuredClone(split.findings.summary.dimensions);
    const postFixRepairReview = {
      modelId: split.findings.summary.modelId,
      findingId: finding.id,
      status: "verified",
      summary: "The focused repair passed its target-owned validation.",
      reason: "An independent review confirmed the actual output and focused validation while reserving broader effectiveness for a later task window.",
      confidence: "medium",
      evidenceRefs: [
        { kind: "fix-validation", id: "focused-owner-check" },
        { kind: "asset-integrity", id: "refreshed-metadata-review" },
      ],
    };
    const resultPath = path.join(root, "result.json");
    await writeFile(resultPath, JSON.stringify({
      actualOutput: [{
        action: "updated",
        artifact: finding.expectedArtifact,
        name: `${finding.expectedArtifact} owner`,
        scope: "Project",
        path: targetPath,
        summary: "Updated the finding owner and retained its focused validation result.",
      }],
      assignmentSummary: assignmentSummary({
        title: "The verified repair now updates repair progress",
        body: "The finding owner passed focused validation, and an independent review updated repair progress without changing later-outcome scores.",
      }),
      postFixRepairReview,
    }));

    const recorded = await recordFixOutput({
      workspace,
      findings: findingsPath,
      findingId: finding.id,
      expectedRevision: 0,
      result: resultPath,
    });
    assert.deepEqual(recorded.scoreRefresh, { status: "unchanged", reason: "deferred-outcome-window", dimensions: [] });
    assert.equal(recorded.repairProgress.verifiedFindingCount, 1);
    assert.equal(recorded.repairProgress.score, Math.round(100 / split.findings.findings.length));
    const updated = JSON.parse(await readFile(findingsPath, "utf8"));
    assert.deepEqual(updated.findings[0].postFixRepairReview, postFixRepairReview);
    assert.deepEqual(updated.summary.dimensions, originalDimensions);
    assert.deepEqual(validateTaskLoopCanvasSplit(updated, split.canvas), []);

    const legacyResultPath = path.join(root, "legacy-score-result.json");
    await writeFile(legacyResultPath, JSON.stringify({
      actualOutput: updated.findings[0].actualOutput,
      assignmentSummary: assignmentSummary({
        title: "A legacy score review is accepted but deferred",
        body: "The compatibility payload can be recorded, but its same-window score changes must not alter the current Loop Effectiveness dimensions.",
      }),
      postFixScoreReview: {
        modelId: split.findings.summary.modelId,
        dimensions: finding.dimensionRefs.map((id) => ({
          id,
          previousScore: originalDimensions.find((row) => row.id === id).score,
          score: 100,
          summary: "A legacy same-window score summary must not replace the current dimension summary.",
          reason: "This compatibility payload is retained only as input evidence and cannot prove a later task outcome for Loop Effectiveness.",
          confidence: "low",
          evidenceRefs: [{ kind: "fix-validation", id: `legacy-${id}` }],
        })),
      },
    }));
    const legacy = await recordFixOutput({
      workspace,
      findings: findingsPath,
      findingId: finding.id,
      expectedRevision: 1,
      result: legacyResultPath,
      consumeResult: true,
    });
    assert.equal(legacy.revision, 2);
    assert.deepEqual(legacy.scoreRefresh, { status: "unchanged", reason: "legacy-review-deferred", dimensions: [] });
    assert.equal(legacy.resultConsumed, true);
    await assert.rejects(readFile(legacyResultPath, "utf8"), { code: "ENOENT" });
    const afterLegacy = JSON.parse(await readFile(findingsPath, "utf8"));
    assert.equal(Object.hasOwn(afterLegacy.findings[0], "postFixScoreReview"), false);
    assert.equal(Object.hasOwn(afterLegacy.findings[0], "postFixRepairReview"), false);
    assert.deepEqual(afterLegacy.summary.dimensions, originalDimensions);
  });
});

test("record-fix-output serializes different findings and rejects same-finding races", async () => {
  await withTempDir(async (root) => {
    const workspace = path.join(root, "workspace");
    const runDir = path.join(workspace, ".Qoder", "better-harness", "run");
    const findingsPath = path.join(runDir, "findings.json");
    const split = splitTaskLoopFindings(projectTaskLoopFindings(addSoftwareFluencyFindings(reportSource({
      includeControlledOutcome: false,
      includeRepositoryFinding: false,
    }))));
    await mkdir(path.join(workspace, "fix-output"), { recursive: true });
    await mkdir(runDir, { recursive: true });
    await writeFile(findingsPath, `${JSON.stringify(split.findings, null, 2)}\n`);
    await writeFile(path.join(runDir, "canvas.json"), `${JSON.stringify(split.canvas, null, 2)}\n`);
    const selected = split.findings.findings.slice(0, 2);
    const operations = [];
    for (const [index, finding] of selected.entries()) {
      const logicalPath = `fix-output/owner-${index}.md`;
      const resultPath = path.join(root, `result-${index}.json`);
      await writeFile(path.join(workspace, logicalPath), `# Owner ${index}\n`);
      await writeFile(resultPath, JSON.stringify({
        actualOutput: [{
          action: "updated",
          artifact: finding.expectedArtifact,
          name: `${finding.expectedArtifact} ${index}`,
          scope: "Project",
          path: logicalPath,
          summary: `Recorded verified output ${index}.`,
        }],
        assignmentSummary: assignmentSummary({
          title: `Verified finding result ${index}`,
          body: `The independent repair ${index} updated its owner and passed focused validation, so its reader result is ready.`,
        }),
      }));
      operations.push(recordFixOutput({
        workspace,
        findings: findingsPath,
        findingId: finding.id,
        expectedRevision: 0,
        result: resultPath,
      }));
    }
    await Promise.all(operations);
    let updated = JSON.parse(await readFile(findingsPath, "utf8"));
    assert.deepEqual(updated.findings.slice(0, 2).map((finding) => finding.actualOutputRevision), [1, 1]);
    assert.equal(updated.summary.assignmentSummaries.length, 2);
    assert.deepEqual(updated.summary.assignmentSummaries.map((row) => row.findingId), selected.map((finding) => finding.id));

    const contested = selected[0];
    const contestedPath = updated.findings[0].actualOutput[0].path;
    const raceOperations = [];
    for (const suffix of ["a", "b"]) {
      const resultPath = path.join(root, `race-${suffix}.json`);
      await writeFile(resultPath, JSON.stringify({
        actualOutput: [{
          action: "updated",
          artifact: contested.expectedArtifact,
          name: `${contested.expectedArtifact} race ${suffix}`,
          scope: "Project",
          path: contestedPath,
          summary: `Recorded competing verified output ${suffix}.`,
        }],
        assignmentSummary: assignmentSummary({
          title: `Competing verified result ${suffix}`,
          body: `The competing repair ${suffix} updated the owner and passed focused validation before recording its reader result.`,
        }),
      }));
      raceOperations.push(recordFixOutput({
        workspace,
        findings: findingsPath,
        findingId: contested.id,
        expectedRevision: 1,
        result: resultPath,
      }));
    }
    const raceResults = await Promise.allSettled(raceOperations);
    assert.equal(raceResults.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(raceResults.filter((result) => result.status === "rejected" && result.reason?.code === "STALE_FIX_OUTPUT_REVISION").length, 1);
    updated = JSON.parse(await readFile(findingsPath, "utf8"));
    assert.equal(updated.findings[0].actualOutputRevision, 2);
    assert.equal(updated.findings[1].actualOutputRevision, 1);
    assert.deepEqual(validateTaskLoopCanvasSplit(updated, split.canvas), []);
    const reorderedProjection = structuredClone(updated);
    reorderedProjection.summary.assignmentSummaries.reverse();
    assert.ok(validateTaskLoopCanvasSplit(reorderedProjection, split.canvas)
      .some((error) => /in finding order/.test(error)));
  });
});

test("record-fix-output requires reader-safe locale-matched AI copy without changing the report", async () => {
  await withTempDir(async (root) => {
    const workspace = path.join(root, "workspace");
    const runDir = path.join(workspace, ".Qoder", "better-harness", "run");
    const findingsPath = path.join(runDir, "findings.json");
    const targetPath = "fix-output/owner.md";
    const split = splitTaskLoopFindings(projectTaskLoopFindings(reportSource()));
    const finding = split.findings.findings[0];
    await mkdir(path.join(workspace, "fix-output"), { recursive: true });
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(workspace, targetPath), "# Owner\n");
    await writeFile(findingsPath, `${JSON.stringify(split.findings, null, 2)}\n`);
    await writeFile(path.join(runDir, "canvas.json"), `${JSON.stringify(split.canvas, null, 2)}\n`);
    const actualOutput = [{
      action: "updated",
      artifact: finding.expectedArtifact,
      name: `${finding.expectedArtifact} owner`,
      scope: "Project",
      path: targetPath,
      summary: "Updated the verified owner result.",
    }];
    const before = await readFile(findingsPath, "utf8");

    for (const [name, payload, expected] of [
      ["missing", { actualOutput }, /must contain assignmentSummary/u],
      ["locale", { actualOutput, assignmentSummary: assignmentSummary({ locale: "zh-CN" }) }, /locale must exactly match/u],
      ["english-copy", { actualOutput, assignmentSummary: { locale: "en", title: "修复结果已经完成", body: "修复已经通过聚焦验证，可以直接展示。" } }, /must use engineering English/u],
      ["private-path", { actualOutput, assignmentSummary: assignmentSummary({ body: "Validation passed under /Users/example/private-project and the result is ready." }) }, /must not expose an absolute private path/u],
      ["unsupported", { actualOutput, assignmentSummary: assignmentSummary(), generatedHeadline: "writer copy" }, /unsupported field: generatedHeadline/u],
    ]) {
      const resultPath = path.join(root, `${name}.json`);
      await writeFile(resultPath, JSON.stringify(payload));
      await assert.rejects(recordFixOutput({
        workspace,
        findings: findingsPath,
        findingId: finding.id,
        expectedRevision: 0,
        result: resultPath,
        consumeResult: true,
      }), expected);
      assert.equal(await readFile(findingsPath, "utf8"), before);
      assert.ok((await readFile(resultPath, "utf8")).length > 0);
    }

    const validResultPath = path.join(root, "valid.json");
    await writeFile(validResultPath, JSON.stringify({ actualOutput, assignmentSummary: assignmentSummary() }));
    await assert.rejects(recordFixOutput({
      workspace,
      findings: findingsPath,
      findingId: "missing-finding",
      expectedRevision: 0,
      result: validResultPath,
    }), /must match exactly one row/u);
    assert.equal(await readFile(findingsPath, "utf8"), before);

    const duplicated = JSON.parse(before);
    duplicated.findings.push(structuredClone(duplicated.findings[0]));
    await writeFile(findingsPath, `${JSON.stringify(duplicated, null, 2)}\n`);
    await assert.rejects(recordFixOutput({
      workspace,
      findings: findingsPath,
      findingId: finding.id,
      expectedRevision: 0,
      result: validResultPath,
    }), /duplicate id|must match exactly one row/u);
    assert.deepEqual(JSON.parse(await readFile(findingsPath, "utf8")), duplicated);
  });
});

test("record-fix-output preserves a zh-CN Assignment Summary verbatim", async () => {
  await withTempDir(async (root) => {
    const workspace = path.join(root, "workspace");
    const runDir = path.join(workspace, ".Qoder", "better-harness", "run");
    const findingsPath = path.join(runDir, "findings.json");
    const targetPath = "fix-output/owner.md";
    const source = reportSource({ locale: "zh-CN", includeRepositoryFinding: false, interventionLedger: [] });
    source.repositoryEvidence.diagnosticCoverageReviews = [diagnosticReview({
      status: "confirmed-gap",
      affectedScope: "src/core/request.ts",
      title: "核心链路缺少结果诊断",
      missingSegment: "结果日志。",
      impact: "失败后无法关联同一次请求。",
      expectedOutcome: "同一次请求可以被端到端追踪。",
      severity: "Medium",
      expectedArtifact: "Code",
      expectedOutput: ["更新归属代码，使同一次请求可以被端到端追踪。"],
      aiFixPrompt: "/better-harness 修复这个问题\n\n补充关联日志。\n\n## Validation\n\n- 运行失败路径检查",
    })];
    const split = splitTaskLoopFindings(projectTaskLoopFindings(source));
    const finding = split.findings.findings[0];
    const chineseSummary = {
      locale: "zh-CN",
      title: "修复结果已经完成验证",
      body: "修复 AI 已更新对应 owner，并通过聚焦契约测试；Proactive Insights 可以直接展示这段结果，无需再次翻译或拼接。",
    };
    await mkdir(path.join(workspace, "fix-output"), { recursive: true });
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(workspace, targetPath), "# Owner\n");
    await writeFile(findingsPath, `${JSON.stringify(split.findings, null, 2)}\n`);
    await writeFile(path.join(runDir, "canvas.json"), `${JSON.stringify(split.canvas, null, 2)}\n`);
    const resultPath = path.join(root, "result.json");
    await writeFile(resultPath, JSON.stringify({
      actualOutput: [{
        action: "updated",
        artifact: finding.expectedArtifact,
        name: "已验证的 owner",
        scope: "Project",
        path: targetPath,
        summary: "已更新 finding 对应的 owner，并保留聚焦验证结果。",
      }],
      assignmentSummary: {
        locale: "zh-CN",
        title: "The fix result passed validation",
        body: "The finding owner passed focused validation and the result is ready for direct display.",
      },
    }));
    await assert.rejects(
      recordFixOutput({ workspace, findings: findingsPath, findingId: finding.id, expectedRevision: 0, result: resultPath }),
      /must use natural Chinese/u,
    );
    await writeFile(resultPath, JSON.stringify({
      actualOutput: [{
        action: "updated",
        artifact: finding.expectedArtifact,
        name: "已验证的 owner",
        scope: "Project",
        path: targetPath,
        summary: "已更新 finding 对应的 owner，并保留聚焦验证结果。",
      }],
      assignmentSummary: chineseSummary,
    }));

    await recordFixOutput({ workspace, findings: findingsPath, findingId: finding.id, expectedRevision: 0, result: resultPath });
    const updated = JSON.parse(await readFile(findingsPath, "utf8"));
    assert.deepEqual(updated.findings[0].assignmentSummary, chineseSummary);
    assert.deepEqual(updated.summary.assignmentSummaries[0], {
      findingId: finding.id,
      revision: 1,
      ...chineseSummary,
      outputs: updated.findings[0].actualOutput,
    });
  });
});

test("record-fix-output keeps the AI-authored actual artifact when it differs from the plan", async () => {
  await withTempDir(async (root) => {
    const workspace = path.join(root, "workspace");
    const runDir = path.join(workspace, ".Qoder", "better-harness", "run");
    const findingsPath = path.join(runDir, "findings.json");
    const split = splitTaskLoopFindings(projectTaskLoopFindings(reportSource()));
    const finding = split.findings.findings[0];
    finding.expectedArtifact = "MCP";
    finding.expectedOutput = ["Update the MCP configuration so agents get a bounded workflow owner, permission boundary, and validation path."];
    const skillPath = ".qoder/skills/uno-mcp-workflow/SKILL.md";
    await mkdir(path.join(workspace, path.dirname(skillPath)), { recursive: true });
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(workspace, skillPath), "# Uno MCP Workflow\n");
    await writeFile(findingsPath, `${JSON.stringify(split.findings, null, 2)}\n`);
    await writeFile(path.join(runDir, "canvas.json"), `${JSON.stringify(split.canvas, null, 2)}\n`);
    const resultPath = path.join(root, "result.json");
    await writeFile(resultPath, JSON.stringify({
      actualOutput: [{
        action: "created",
        artifact: "Skill",
        name: "uno-mcp-workflow Skill",
        scope: "Project",
        path: skillPath,
        summary: "Created the project Skill that owns the MCP workflow boundary.",
      }],
      assignmentSummary: assignmentSummary({
        title: "The MCP workflow now has a verified Skill owner",
        body: "The repair created the project Skill and validated its owner boundary, so the result is ready for direct display.",
      }),
    }));

    await recordFixOutput({ workspace, findings: findingsPath, findingId: finding.id, expectedRevision: 0, result: resultPath });
    const updated = JSON.parse(await readFile(findingsPath, "utf8"));
    assert.equal(updated.findings[0].expectedArtifact, "MCP");
    assert.equal(updated.findings[0].actualOutput[0].artifact, "Skill");
    assert.equal(updated.summary.assignmentSummaries[0].outputs[0].artifact, "Skill");
  });
});

test("record-fix-output accepts future version metadata and rejects missing targets", async () => {
  await withTempDir(async (root) => {
    const workspace = path.join(root, "workspace");
    const runDir = path.join(workspace, ".Qoder", "better-harness", "run");
    const findingsPath = path.join(runDir, "findings.json");
    const split = splitTaskLoopFindings(projectTaskLoopFindings(reportSource()));
    await mkdir(path.join(workspace, "fix-output"), { recursive: true });
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, "canvas.json"), `${JSON.stringify(split.canvas, null, 2)}\n`);
    const finding = split.findings.findings[0];
    const targetPath = "fix-output/owner.md";
    await writeFile(path.join(workspace, targetPath), "# Owner\n");
    const resultPath = path.join(root, "result.json");
    const resultFor = (artifact, logicalPath = targetPath) => JSON.stringify({
      actualOutput: [{
        action: "updated",
        artifact,
        name: `${artifact} owner`,
        scope: "Project",
        path: logicalPath,
        summary: "Recorded the verified owner result.",
      }],
      assignmentSummary: assignmentSummary(),
    });

    const future = structuredClone(split.findings);
    future.summary.reportContractVersion = 999;
    await writeFile(findingsPath, `${JSON.stringify(future, null, 2)}\n`);
    await writeFile(resultPath, resultFor(finding.expectedArtifact));
    await recordFixOutput({ workspace, findings: findingsPath, findingId: finding.id, expectedRevision: 0, result: resultPath });
    assert.equal(JSON.parse(await readFile(findingsPath, "utf8")).summary.reportContractVersion, 999);

    await writeFile(findingsPath, `${JSON.stringify(split.findings, null, 2)}\n`);
    const before = await readFile(findingsPath, "utf8");
    const skillPath = "fix-output/SKILL.md";
    await writeFile(path.join(workspace, skillPath), "# Actual Skill\n");
    await writeFile(resultPath, resultFor("MCP", skillPath));
    await assert.rejects(recordFixOutput({ workspace, findings: findingsPath, findingId: finding.id, expectedRevision: 0, result: resultPath }), /artifact must be Skill/u);
    assert.equal(await readFile(findingsPath, "utf8"), before);

    await writeFile(resultPath, resultFor(finding.expectedArtifact, "fix-output/missing.md"));
    await assert.rejects(recordFixOutput({ workspace, findings: findingsPath, findingId: finding.id, expectedRevision: 0, result: resultPath }), /existing file/u);
    assert.equal(await readFile(findingsPath, "utf8"), before);

    const outsideFindingsPath = path.join(root, "outside-findings.json");
    await writeFile(outsideFindingsPath, before);
    await writeFile(resultPath, resultFor(finding.expectedArtifact));
    await assert.rejects(recordFixOutput({ workspace, findings: outsideFindingsPath, findingId: finding.id, expectedRevision: 0, result: resultPath }), /inside --workspace/u);
  });
});

test("task-loop findings accept a safe non-identical composition without redundant question accordions", async () => {
  await withTempDir(async (root) => {
    const sdkDeclarationsPath = path.join(root, "sdk", "index.d.ts");
    const canvasPath = path.join(root, "insights.canvas.tsx");
    const findingsPath = path.join(root, "findings.json");
    const canvasDataPath = path.join(root, "canvas.json");
    await mkdir(path.dirname(sdkDeclarationsPath), { recursive: true });
    await writeFile(sdkDeclarationsPath, 'export { AreaChart, BarChart, Button, Callout, Card, CardBody, CardHeader, CollapsibleSection, Dialog, Divider, Fluency, Grid, H1, H2, IconButton, ImprovementKataCard, LineChart, MetricsGrid, Progress, RiskHeatmap, Row, Stack, Table, Tag, Text, SendToChatButton, useCanvasAction } from "./core.js";\n');
    const scaffold = renderBetterHarnessReportCanvas();
    const composed = scaffold.replace(
      '<Stack gap={24} style={taskLoopPageStyle}>',
      '<Stack gap={28} style={taskLoopPageStyle}>',
    );
    assert.notEqual(composed, scaffold);
    await writeFile(canvasPath, composed);
    await writeFile(findingsPath, `${JSON.stringify(projectTaskLoopFindings(reportSource()), null, 2)}\n`);
    await writeFile(canvasDataPath, '{"schemaVersion":1,"summary":{},"dimensions":[],"findings":[]}\n');

    assert.doesNotMatch(
      await readFile(canvasPath, "utf8"),
      /TaskLoopHealth|TaskLoopScoreOverview|TaskLoopDimensionDetails|<Progress/,
    );

    const result = await validateHarnessCanvasArtifacts({
      canvasPath,
      findingsPath,
      sdkDeclarationsPath,
      preview: false,
      repoRoot: root,
    });
    assert.equal(result.status, "pass", JSON.stringify(result.errors, null, 2));
    assert.equal(result.checks.find((check) => check.id === "canvas-quality")?.summary?.contract, "agent-work-loop");
  });
});
