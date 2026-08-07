import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { applyReportSourceReview } from "../scripts/harness-analysis/apply-source-review.mjs";
import { buildHarnessReviewPacket, compileHarnessLeadDecision } from "../scripts/harness-analysis/report-review-packet.mjs";
import { projectTaskLoopFindings } from "../scripts/harness-analysis/task-loop-report.mjs";
import { buildTaskLoopRepositoryEvidence } from "../scripts/harness-analysis/task-loop-repository-evidence.mjs";
import { buildTaskLoopSourceCandidate } from "../scripts/harness-analysis/task-loop-source.mjs";
import {
  LEARNING_CAPTURE_FINDING_POLICY,
  isAdequateLearningLoopNoCandidateWindow,
  validateHarnessReportSource,
} from "../scripts/harness-analysis/report-source.mjs";
import { buildWorkflowDemandDiagnostics } from "../scripts/harness-analysis/workflow-demand-diagnostics.mjs";
import {
  buildLearningLoopReview,
  nativeLearningReviewPacketDigest,
  nativeLearningReviewSourceDigest,
} from "../scripts/harness-analysis/learning-loop-candidates.mjs";
import {
  LEARNING_CAPTURE_REVIEWED_SCORE_FLOOR,
} from "../scripts/harness-analysis/fluency-dimensions.mjs";

function sourceCandidate() {
  const source = buildTaskLoopSourceCandidate({
    scope: { platform: "qoder", workspace: "/tmp/project" },
    selection: { strategy: "latest-n", eligibleCount: 1, analyzedCount: 1, strata: [] },
    events: [{
      sessionId: "private-session",
      timestamp: "2026-07-12T10:00:00.000Z",
      type: "tool",
      toolName: "Edit",
      filePath: "/tmp/project/src/a.ts",
      evidenceRef: { kind: "fixture", path: "/tmp/private.jsonl", line: 1 },
    }, {
      sessionId: "private-session",
      timestamp: "2026-07-12T10:00:01.000Z",
      type: "tool",
      toolName: "Bash",
      validationCategory: "node --test",
      targetPaths: ["/tmp/project/src/a.ts"],
      success: true,
      evidenceRef: { kind: "fixture", path: "/tmp/private.jsonl", line: 2 },
    }],
    repositoryEvidence: {
      diagnosticCoverageReviews: [{
        id: "core-diagnostic-coverage",
        status: "covered",
        affectedScope: "repository-wide",
        summary: "Core diagnostics were reviewed.",
        evidenceRefs: [{ kind: "review", id: "diagnostics" }],
      }],
    },
  });
  source.repositoryEvidence.findings = [...(source.repositoryEvidence.findings ?? []), {
    id: "fixture-task-observation-gap",
    kind: "evidence-gap",
    severity: "Medium",
    title: "Task closure lacks a complete review trail",
    reason: "The bounded fixture does not retain one owner-routed chain from task intent through supported operation, focused validation, and acceptance evidence.",
    expectedOutcome: "The next fixture task retains one reviewable chain from intent through acceptance.",
    expectedArtifact: "Rule",
    expectedOutput: ["Update the project Rule so each task records its goal, supported operation, focused validation, and acceptance evidence before completion."],
    dimensionRefs: ["task-understanding", "controlled-execution", "change-validation", "reliable-delivery"],
    subdimensionRefs: ["goal-understanding", "instruction-led-start", "relevant-check", "acceptance-evidence"],
    staticEvidence: [{ kind: "review", id: "diagnostics" }],
    projectionPolicy: "required",
    aiFixPrompt: "/better-harness fix this issue\n\nUpdate the project Rule so each task records its goal, supported operation, focused validation command, and acceptance evidence before completion.\n\n## Validation\n\n- Run the repository Agent Work Loop fixture\n- Regenerate the Harness report and confirm the four current-task dimensions retain the reviewed chain",
  }];
  return source;
}

function nativeCorrectionSource() {
  const repairEvents = (sessionId, minute, suffix) => {
    const base = `2026-08-02T10:${String(minute).padStart(2, "0")}`;
    return [{
      sessionId, timestamp: `${base}:00.000Z`, type: "tool", toolName: "Bash",
      commandText: "node --test test/shared.test.mjs", validationCategory: "node --test",
      targetPaths: ["src/shared.mjs"], success: false, evidenceRef: { kind: "fixture", id: `${suffix}-failure` },
    }, {
      sessionId, timestamp: `${base}:01.000Z`, type: "tool", toolName: "Edit",
      filePath: "src/shared.mjs", evidenceRef: { kind: "fixture", id: `${suffix}-edit` },
    }, {
      sessionId, timestamp: `${base}:02.000Z`, type: "tool", toolName: "Bash",
      commandText: "node --test test/shared.test.mjs", validationCategory: "node --test",
      targetPaths: ["src/shared.mjs"], success: true, evidenceRef: { kind: "fixture", id: `${suffix}-rerun` },
    }];
  };
  return buildTaskLoopSourceCandidate({
    scope: { platform: "qoder", workspace: "/tmp/project" },
    selection: { strategy: "latest-n", eligibleCount: 2, analyzedCount: 2, strata: [] },
    events: [...repairEvents("native-a", 0, "a"), ...repairEvents("native-b", 5, "b")],
  });
}

function attachRecurringWorkflowFriction(source, intent) {
  for (const episode of source.taskEpisodes) {
    episode.learningSignals = [{
      patternId: "repeated-rediscovery",
      normalizedSignature: `${intent}-workflow-rediscovery`,
      taskFamily: intent,
      repoArea: "workflow-route",
      frictionType: "repeated-rediscovery",
      procedural: true,
      fieldProvenance: {
        normalizedSignature: "ai-reviewed",
        taskFamily: "ai-reviewed",
        repoArea: "ai-reviewed",
        frictionType: "ai-reviewed",
      },
      evidenceRefs: [{ kind: "fixture-event", id: `${episode.id}-workflow-rediscovery` }],
    }];
  }
  const diagnostics = source.repositoryEvidence.learningCaptureDiagnostics;
  const review = buildLearningLoopReview({
    episodes: source.taskEpisodes,
    signals: diagnostics.signals,
    interventions: source.interventionLedger,
  });
  Object.assign(diagnostics, {
    learningCaptureSchemaVersion: review.schemaVersion,
    episodeRecords: review.episodeRecords,
    recurringIssueCandidates: review.candidates,
    coverage: review.coverage,
  });
}

function sourceWithWorkflowDemand(intent, { repeat = true, recurringFriction = repeat } = {}) {
  const source = sourceCandidate();
  source.repositoryEvidence.learningCaptureEvidence = buildTaskLoopRepositoryEvidence({
    trackedFiles: [],
    fileContents: {},
  }).learningCaptureEvidence;
  const signal = (id) => ({
    intent,
    scope: "workspace",
    host: "qoder",
    confidence: "high",
    evidenceRefs: [{ kind: "fixture-event", id: `${id}-${intent}` }],
  });
  const first = source.taskEpisodes[0];
  first.lifecycleSignals = [signal(first.id)];
  if (repeat) {
    const second = structuredClone(first);
    second.id = "episode:2222222222222222";
    second.lifecycleSignals = [signal(second.id)];
    second.evidenceRefs = [{ kind: "task-episode", id: second.id }];
    source.taskEpisodes.push(second);
    Object.assign(source.manifest.selection, {
      eligibleCount: source.taskEpisodes.length,
      analyzedCount: source.taskEpisodes.length,
    });
    source.sessionEvents.candidateEpisodeCount = source.taskEpisodes.length;
  }
  if (recurringFriction) attachRecurringWorkflowFriction(source, intent);
  source.repositoryEvidence.workflowDemandDiagnostics = buildWorkflowDemandDiagnostics({
    taskEpisodes: source.taskEpisodes,
    currentEpisodeId: source.sessionEvents.currentEpisodeRef,
    reusableSkillEvidence: source.repositoryEvidence.learningCaptureEvidence.reusableSkillEvidence,
    skillActivity: {
      observedSkills: source.repositoryEvidence.learningCaptureDiagnostics?.signals?.observedSkills ?? [],
      unscopedObservedSkills: source.repositoryEvidence.learningCaptureDiagnostics?.signals?.unscopedObservedSkills ?? [],
      apparentSkillReads: source.repositoryEvidence.learningCaptureDiagnostics?.signals?.apparentSkillReads ?? [],
    },
  });
  return source;
}

function addDistinctWorkflowDemand(source, intent) {
  const episodeIds = ["episode:3333333333333333", "episode:4444444444444444"];
  const added = source.taskEpisodes.slice(0, 2).map((episode, index) => {
    const clone = structuredClone(episode);
    clone.id = episodeIds[index];
    clone.taskRoute = `lifecycle:${intent}`;
    clone.lifecycleSignals = [{
      intent,
      scope: "workspace",
      host: "qoder",
      confidence: "high",
      evidenceRefs: [{ kind: "fixture-event", id: `${clone.id}-${intent}` }],
    }];
    clone.learningSignals = [{
      patternId: "recurring-correction",
      normalizedSignature: `${intent}-workflow-correction`,
      taskFamily: intent,
      repoArea: "workflow-route",
      frictionType: "recurring-correction",
      procedural: false,
      fieldProvenance: {
        normalizedSignature: "ai-reviewed",
        taskFamily: "ai-reviewed",
        repoArea: "ai-reviewed",
        frictionType: "ai-reviewed",
      },
      evidenceRefs: [{ kind: "fixture-event", id: `${clone.id}-${intent}-correction` }],
    }];
    clone.evidenceRefs = [{ kind: "task-episode", id: clone.id }];
    return clone;
  });
  source.taskEpisodes.push(...added);
  Object.assign(source.manifest.selection, {
    eligibleCount: source.taskEpisodes.length,
    analyzedCount: source.taskEpisodes.length,
  });
  source.sessionEvents.candidateEpisodeCount = source.taskEpisodes.length;
  const review = buildLearningLoopReview({ episodes: source.taskEpisodes });
  Object.assign(source.repositoryEvidence.learningCaptureDiagnostics, {
    learningCaptureSchemaVersion: review.schemaVersion,
    episodeRecords: review.episodeRecords,
    recurringIssueCandidates: review.candidates,
    coverage: review.coverage,
  });
  source.repositoryEvidence.workflowDemandDiagnostics = buildWorkflowDemandDiagnostics({
    taskEpisodes: source.taskEpisodes,
    currentEpisodeId: source.sessionEvents.currentEpisodeRef,
    reusableSkillEvidence: source.repositoryEvidence.learningCaptureEvidence.reusableSkillEvidence,
    skillActivity: {
      observedSkills: source.repositoryEvidence.learningCaptureDiagnostics?.signals?.observedSkills ?? [],
      unscopedObservedSkills: source.repositoryEvidence.learningCaptureDiagnostics?.signals?.unscopedObservedSkills ?? [],
      apparentSkillReads: source.repositoryEvidence.learningCaptureDiagnostics?.signals?.apparentSkillReads ?? [],
    },
  });
  return source;
}

function sourceWithAdequateNoCandidateWindow() {
  const source = sourceCandidate();
  const first = source.taskEpisodes[0];
  const second = structuredClone(first);
  second.id = "episode:2222222222222222";
  second.evidenceRefs = [{ kind: "task-episode", id: second.id }];
  const lifecycleSignal = (intent, id) => ({
    intent,
    scope: "workspace",
    host: "qoder",
    confidence: "high",
    evidenceRefs: [{ kind: "fixture-event", id: `${id}-${intent}` }],
  });
  first.lifecycleSignals = [lifecycleSignal("specification-review", first.id)];
  second.lifecycleSignals = [lifecycleSignal("release-delivery", second.id)];
  first.taskRoute = "lifecycle:spec-review";
  second.taskRoute = "lifecycle:release-delivery";
  source.taskEpisodes = [first, second];
  Object.assign(source.manifest.selection, {
    eligibleCount: 2,
    analyzedCount: 2,
    sampled: false,
    representative: false,
  });
  source.sessionEvents.candidateEpisodeCount = 2;
  const learningLoop = buildLearningLoopReview({ episodes: source.taskEpisodes });
  Object.assign(source.repositoryEvidence.learningCaptureDiagnostics, {
    learningCaptureSchemaVersion: learningLoop.schemaVersion,
    episodeRecords: learningLoop.episodeRecords,
    recurringIssueCandidates: learningLoop.candidates,
    coverage: learningLoop.coverage,
  });
  source.repositoryEvidence.workflowDemandDiagnostics = buildWorkflowDemandDiagnostics({
    taskEpisodes: source.taskEpisodes,
    currentEpisodeId: source.sessionEvents.currentEpisodeRef,
    reusableSkillEvidence: source.repositoryEvidence.learningCaptureEvidence?.reusableSkillEvidence,
  });
  return source;
}

function sourceWithBoundedMissingLearningEvents() {
  const source = sourceCandidate();
  const first = source.taskEpisodes[0];
  const second = structuredClone(first);
  second.id = "episode:2222222222222222";
  second.evidenceRefs = [{ kind: "task-episode", id: second.id }];
  source.taskEpisodes = [first, second];
  Object.assign(source.manifest.selection, {
    eligibleCount: 2,
    analyzedCount: 2,
  });
  source.sessionEvents.candidateEpisodeCount = 2;
  const learningLoop = buildLearningLoopReview({ episodes: source.taskEpisodes });
  Object.assign(source.repositoryEvidence.learningCaptureDiagnostics, {
    learningCaptureSchemaVersion: learningLoop.schemaVersion,
    episodeRecords: learningLoop.episodeRecords,
    recurringIssueCandidates: learningLoop.candidates,
    coverage: learningLoop.coverage,
  });
  source.repositoryEvidence.workflowDemandDiagnostics = buildWorkflowDemandDiagnostics({
    taskEpisodes: source.taskEpisodes,
  });
  return source;
}

function completeReview(source) {
  const repositoryDecision = source.assessmentDecisions.find((row) => row.kind === "repository-review");
  const reviewed = (id, kind) => {
    const row = {
      id,
      status: "reviewed",
      summary: `${id} was reviewed`,
      ...(new Set(["regression-protection", "spec-alignment"]).has(id)
        ? { evidenceState: "Unobserved" }
        : {}),
      evidenceRefs: [{ kind, id }],
    };
    if (!["lifecycle-repeat-detection", "loop-engineering", "later-validation"].includes(id)) return row;
    return {
      ...row,
      state: "Unobserved",
      findingRefs: [],
      ...(id === "loop-engineering" ? { mechanisms: [] } : {}),
    };
  };
  return {
    sourceCandidate: { evidenceRefs: [{ kind: "session-selection", id: "bounded-selection" }] },
    readerOverview: {
      text: "Validation is connected, but the reviewed task still lacks accepted delivery evidence.",
      evidenceRefs: [{ kind: "review", id: "overview-delivery-gap" }],
    },
    repositoryReview: {
      reviewedFrameworks: repositoryDecision.requiredFrameworks.map((id) => reviewed(id, "framework-review")),
      reviewedChecks: repositoryDecision.requiredChecks.map((id) => reviewed(id, "repository-review")),
      reviewedSoftwareFluencyCapabilities: repositoryDecision.requiredSoftwareFluencyCapabilities.map((id) => reviewed(id, "software-fluency-review")),
    },
    repositoryEvidence: {},
    episodeReviews: source.taskEpisodes.map((episode) => ({
      episodeRef: episode.id,
      taskUnderstanding: ["goal-understanding", "relevant-context", "scope-boundary"].map((id) => ({
        id,
        state: "Exercised",
        summary: `${id} was reviewed for this bounded task episode`,
        evidenceRefs: episode.evidenceRefs,
      })),
      validationAssociations: episode.changeSets.flatMap((change) => episode.validationSets
        .filter((validation) => validation.status === "passed"
          && validation.ordinal > change.lastOrdinal
          && change.targetKeys.some((target) => validation.targetKeys.includes(target)))
        .slice(0, 1)
        .map((validation) => ({
          id: `${episode.id}:reviewed-association`,
          changeSetRef: change.id,
          validationSetRef: validation.id,
          relation: "relevant-after-change",
          summary: "The retained validation directly checks the bounded change set",
          evidenceRefs: validation.evidenceRefs,
        }))),
      repairReview: { state: "Unobserved" },
    })),
    deliveryReviews: [],
    scoreReview: {
      dimensions: source.assessmentDecisions.find((row) => row.kind === "score-review").dimensions.map((row) => ({
        id: row.id,
        score: 59,
        confidence: "medium",
        reason: `${row.id} was judged from the reviewed evidence boundary.`,
        readerSummary: "Reviewed evidence supports this judgment, but stronger task outcomes are still missing.",
        evidenceRefs: [{ kind: "score-review", id: row.id }],
      })),
    },
  };
}

function completeNativeReview(source) {
  const decision = completeReview(source);
  const sourceRef = { kind: "session-selection", id: "bounded-selection" };
  decision.readerOverview.evidenceRefs = [sourceRef];
  for (const group of [
    decision.repositoryReview.reviewedFrameworks,
    decision.repositoryReview.reviewedChecks,
    decision.repositoryReview.reviewedSoftwareFluencyCapabilities,
    decision.scoreReview.dimensions,
  ]) for (const row of group) row.evidenceRefs = [sourceRef];
  const checks = new Map(decision.repositoryReview.reviewedChecks.map((row) => [row.id, row]));
  Object.assign(checks.get("lifecycle-repeat-detection"), {
    state: "Exercised",
    evidenceRefs: source.taskEpisodes.map((episode) => ({ kind: "task-episode", id: episode.id })),
  });
  Object.assign(checks.get("loop-engineering"), {
    state: "Present",
    mechanisms: ["skill"],
    candidateOwner: "skill",
    ownerSelectionEvidenceRefs: [sourceRef],
  });
  decision.repositoryEvidence.diagnosticCoverageReviews = [{
    id: "core-diagnostic-coverage",
    status: "covered",
    affectedScope: "repository-wide",
    summary: "Core diagnostics were reviewed in the bounded native fixture.",
    evidenceRefs: [sourceRef],
  }];
  const nativePacket = source.repositoryEvidence.learningCaptureDiagnostics.nativeLearningReview.packet;
  decision.nativeLearningDecisions = nativePacket.groups.map((group) => ({
    groupRef: group.groupRef,
    decision: "match",
    patternId: "recurring-correction",
    episodeRefs: group.episodeRefs,
    evidenceRefs: group.evidenceRefs,
    reasonCodes: group.reasonCodes,
  }));
  return decision;
}

function fillNativeDecisionTemplate(template, source) {
  const decision = template.decision;
  const sourceRef = { kind: "session-selection", id: "bounded-selection" };
  decision.sourceCandidate.evidenceRefs = [sourceRef];
  decision.readerOverview.text = "The bounded recurring correction was reviewed without claiming later effectiveness.";
  decision.readerOverview.evidenceRefs = [sourceRef];
  for (const group of [
    decision.repositoryReview.reviewedFrameworks,
    decision.repositoryReview.reviewedChecks,
    decision.repositoryReview.reviewedSoftwareFluencyCapabilities,
  ]) for (const row of group) {
    row.summary = `${row.id} was reviewed from the bounded decision template.`;
    row.evidenceRefs = [sourceRef];
  }
  const checks = new Map(decision.repositoryReview.reviewedChecks.map((row) => [row.id, row]));
  Object.assign(checks.get("lifecycle-repeat-detection"), {
    state: "Exercised",
    evidenceRefs: source.taskEpisodes.map((episode) => ({ kind: "task-episode", id: episode.id })),
  });
  Object.assign(checks.get("loop-engineering"), {
    state: "Present",
    mechanisms: ["skill"],
    candidateOwner: "skill",
    ownerSelectionEvidenceRefs: [sourceRef],
  });
  decision.repositoryEvidence.diagnosticCoverageReviews = [{
    id: "core-diagnostic-coverage",
    status: "covered",
    affectedScope: "repository-wide",
    summary: "Core diagnostics were reviewed from the generated decision template.",
    evidenceRefs: [sourceRef],
  }];
  for (const row of decision.scoreReview.dimensions) {
    Object.assign(row, {
      score: 59,
      confidence: "medium",
      reason: `${row.id} was judged from the reviewed evidence boundary.`,
      readerSummary: "Reviewed evidence supports this judgment without claiming later effectiveness.",
      evidenceRefs: [sourceRef],
    });
  }
  decision.episodeReviews = source.taskEpisodes.map((episode) => {
    const episodeReview = structuredClone(template.optionalShapes.episodeReviews.item);
    episodeReview.episodeRef = episode.id;
    for (const row of episodeReview.taskUnderstanding) {
      Object.assign(row, {
        state: "Exercised",
        summary: `${row.id} was reviewed for this bounded task episode`,
        evidenceRefs: episode.evidenceRefs,
      });
    }
    episodeReview.validationAssociations = episode.changeSets.flatMap((change) => episode.validationSets
      .filter((validation) => validation.status === "passed"
        && validation.ordinal > change.lastOrdinal
        && change.targetKeys.some((target) => validation.targetKeys.includes(target)))
      .slice(0, 1)
      .map((validation) => ({
        id: `${episode.id}:reviewed-association`,
        changeSetRef: change.id,
        validationSetRef: validation.id,
        relation: "relevant-after-change",
        summary: "The retained validation directly checks the bounded change set",
        evidenceRefs: validation.evidenceRefs,
      })));
    episodeReview.repairReview = { state: "Unobserved" };
    return episodeReview;
  });
  const groups = new Map(template.nativeGroups.map((group) => [group.groupRef, group]));
  for (const row of decision.nativeLearningDecisions) {
    const group = groups.get(row.groupRef);
    Object.assign(row, {
      decision: "match",
      patternId: "recurring-correction",
      episodeRefs: group.episodeRefs,
      evidenceRefs: group.evidenceRefs,
      reasonCodes: group.supportedReasonCodes,
    });
  }
  return template;
}

function pendingIntervention() {
  const ref = (id) => ({ kind: "fixture", id });
  return {
    id: "review-skill-trial",
    schemaVersion: 1,
    frictionRefs: [ref("repeated-review-friction")],
    candidateCauses: [
      { kind: "harness", state: "candidate", evidenceRefs: [ref("missing-review-skill")] },
      { kind: "requirements", state: "candidate", evidenceRefs: [ref("review-boundary")] },
    ],
    asset: { type: "skill", label: "Review handoff Skill" },
    owner: "repository-maintainer",
    baseline: { windowRef: "window-1", primaryValue: 8, guardrailValue: 0.1, evidenceRefs: [ref("window-1")] },
    primaryMetric: { id: "review-rework", direction: "lower-is-better", unit: "count" },
    guardrailMetric: { id: "false-positive-rate", direction: "lower-is-better", unit: "ratio" },
    comparisonWindow: { laterWindowRef: "window-2", scope: "same review handoff", taskMix: "unverified", selectionStrategy: "stratified" },
    validation: { method: "compare bounded task episodes", evidenceRefs: [ref("comparison-plan")] },
    stopOrRevertCondition: "Stop if review rework or false positives increase.",
    result: { state: "pending" },
  };
}

function regressingIntervention() {
  const intervention = pendingIntervention();
  intervention.comparisonWindow.taskMix = "comparable";
  intervention.result = {
    state: "regressing",
    primaryValue: 10,
    guardrailValue: 0.1,
    evidenceRefs: [{ kind: "fixture", id: "regressing-comparison" }],
  };
  return intervention;
}

function reviewedFinding(overrides = {}) {
  return {
    id: "practice-rules-quality",
    kind: "evidence-gap",
    severity: "Medium",
    title: "Root guidance hides the task route",
    reason: "AGENTS.md mixes durable task routing with conditional setup detail, so agents load unrelated context before they can identify the owning directory and next check.",
    expectedOutcome: "Agents reach the owning directory and validation command from the root guidance without loading unrelated setup detail.",
    expectedArtifact: "Rule",
    expectedOutput: ["Update the project Rule so agents reach the owning directory and validation command without loading unrelated setup detail."],
    dimensionRefs: ["task-understanding"],
    subdimensionRefs: ["clear-task", "relevant-context"],
    staticEvidence: [{ kind: "agent-lint", id: "root-guidance-length", label: "AGENTS.md" }],
    ...overrides,
  };
}

function learningCaptureSkillFinding(leadId, overrides = {}) {
  return {
    id: "lifecycle-spec-workflow-skill-gap",
    kind: "capture-gap",
    severity: "Low",
    title: "Repeated planning has no reusable Spec workflow",
    reason: "Two bounded specification-review tasks reached the same uncovered lifecycle handoff after reusable Skill coverage was inspected.",
    expectedOutcome: "Specification review follows one discoverable and validated reusable procedure.",
    expectedArtifact: "Skill",
    expectedOutput: ["Create a reusable Skill for the repeated specification-review workflow with a bounded trigger, procedure, output, validation, and stop boundary."],
    dimensionRefs: ["learning-capture"],
    subdimensionRefs: ["loop-engineering"],
    staticEvidence: [{ kind: "workflow-demand", id: leadId }],
    aiFixPrompt: "/better-harness fix this issue\n\nUse the separately authorized `/create-skill` workflow to create `skills/spec-workflow/SKILL.md` with a bounded trigger, procedure, output, validation, and stop boundary.\n\n## Validation\n\n- Run the repository Skill validator for `skills/spec-workflow/SKILL.md`\n- Exercise the repeated specification-review fixture and confirm the Skill is selected",
    ...overrides,
  };
}

function learningCaptureNoMatchFinding(leadId, overrides = {}) {
  return {
    id: "learning-capture-observation-route-gap",
    kind: "evidence-gap",
    severity: "Medium",
    title: "Repeated lifecycle demand has no reviewable learning route",
    reason: "Two bounded lifecycle episodes reach the same workflow demand, but normalized learning evidence is unavailable, so the review cannot match the demand to a supported reusable mechanism or retain a clean no-candidate result.",
    expectedOutcome: "Comparable lifecycle work produces privacy-safe normalized evidence and one explicit matched-candidate or clean-window decision.",
    expectedArtifact: "Workflow",
    expectedOutput: ["Update the Learning Capture Workflow so comparable lifecycle episodes retain normalized evidence and an explicit matched-candidate or clean-window decision."],
    dimensionRefs: ["learning-capture"],
    subdimensionRefs: ["lifecycle-repeat-detection"],
    staticEvidence: [{
      kind: leadId ? "workflow-demand" : "session-selection",
      id: leadId || "bounded-selection",
    }],
    aiFixPrompt: "/better-harness fix this issue\n\nUpdate `scripts/harness-analysis/task-loop-source.mjs` and its Learning Capture review workflow so comparable lifecycle episodes retain privacy-safe normalized evidence and an explicit matched-candidate or clean-window decision.\n\n## Validation\n\n- Run the bounded Agent Work Loop source fixture\n- Confirm Lifecycle Opportunity Detection retains a matched candidate or an adequate clean no-candidate result",
    ...overrides,
  };
}

function exerciseLearningCaptureChecks(review, findingId, sourceEpisodes) {
  const checks = new Map(review.repositoryReview.reviewedChecks.map((row) => [row.id, row]));
  Object.assign(checks.get("lifecycle-repeat-detection"), {
    state: "Exercised",
    summary: "Two bounded tasks reached the same uncovered lifecycle handoff.",
    evidenceRefs: sourceEpisodes.map((id) => ({ kind: "task-episode", id })),
  });
  Object.assign(checks.get("loop-engineering"), {
    state: "Missing",
    mechanisms: [],
    candidateOwner: "skill",
    ownerSelectionEvidenceRefs: [{ kind: "loop-discovery", id: `skill-owner-${findingId}` }],
    summary: "The repeated handoff has no reusable lifecycle procedure owner.",
    evidenceRefs: [{ kind: "repository-review", id: `owner-${findingId}` }],
    findingRefs: [findingId],
  });
}

test("source review owner merges a complete review without direct source editing", () => {
  const source = sourceCandidate();
  const reviewed = applyReportSourceReview(source, completeReview(source));

  assert.equal(source.assessmentDecisions.find((row) => row.kind === "source-candidate").status, "requires-review");
  assert.equal(reviewed.assessmentDecisions.find((row) => row.kind === "source-candidate").status, "reviewed");
  assert.equal(reviewed.assessmentDecisions.find((row) => row.kind === "repository-review").status, "reviewed");
  assert.equal(reviewed.assessmentDecisions.find((row) => row.kind === "score-review").status, "reviewed");
  assert.equal(reviewed.repositoryEvidence.readerOverview.text, completeReview(source).readerOverview.text);
});

test("native recurring-correction decisions travel through the standard review packet", () => {
  const source = nativeCorrectionSource();
  const native = source.repositoryEvidence.learningCaptureDiagnostics.nativeLearningReview;
  assert.equal(native.status, "review-required");
  assert.equal(native.packet.groups.length, 1);

  const packet = buildHarnessReviewPacket(source);
  assert.equal(packet.schemaVersion, 3);
  assert.deepEqual(packet.nativeLearningReview.packet, native.packet);
  assert.equal(packet.allowedEvidenceRefs.some((ref) => ref.id === native.packet.groups[0].evidenceRefs[0]), false);

  const missingNativeDecision = completeNativeReview(source);
  delete missingNativeDecision.nativeLearningDecisions;
  const missingCompiled = compileHarnessLeadDecision(source, packet, missingNativeDecision);
  assert.match(missingCompiled.errors.join("; "), /nativeLearningDecisions is required/u);
  assert.throws(
    () => applyReportSourceReview(source, missingCompiled.review, { packet }),
    /nativeLearningReview is required/u,
  );

  const decision = completeNativeReview(source);
  const compiled = compileHarnessLeadDecision(source, packet, decision);
  assert.deepEqual(compiled.errors, []);
  const reviewed = applyReportSourceReview(source, compiled.review, { packet });
  const applied = reviewed.repositoryEvidence.learningCaptureDiagnostics.nativeLearningReview;
  assert.equal(applied.status, "reviewed");
  assert.equal(applied.result.matches.length, 1);
  assert.equal(reviewed.repositoryEvidence.learningCaptureDiagnostics.recurringIssueCandidates[0].patternId, "recurring-correction");
  const replayPacket = buildHarnessReviewPacket(reviewed);
  assert.equal(replayPacket.allowedEvidenceRefs.some((ref) => ref.kind === "native-learning-evidence"), false);

  const stale = structuredClone(compiled.review);
  stale.nativeLearningReview.packetDigest = "0".repeat(64);
  assert.throws(() => applyReportSourceReview(source, stale, { packet }), /packetDigest|does not match/u);

  const assertStoredTamper = (mutate, pattern) => {
    const tampered = structuredClone(reviewed);
    mutate(tampered.repositoryEvidence.learningCaptureDiagnostics.nativeLearningReview);
    assert.ok(validateHarnessReportSource(tampered).some((error) => pattern.test(error)));
  };
  assertStoredTamper((stored) => {
    stored.packet.sourceDigest = "0".repeat(64);
    stored.packet.packetDigest = nativeLearningReviewPacketDigest(stored.packet);
  }, /sourceDigest/u);
  assertStoredTamper((stored) => {
    stored.packet.groups[0].reasonCodes = ["same-check"];
    stored.packet.packetDigest = nativeLearningReviewPacketDigest(stored.packet);
  }, /sourceDigest/u);
  assertStoredTamper((stored) => {
    stored.packet.groups[0].privatePath = "C:\\Users\\Alice\\token.txt";
    stored.packet.sourceDigest = nativeLearningReviewSourceDigest(stored.packet);
    stored.packet.packetDigest = nativeLearningReviewPacketDigest(stored.packet);
  }, /groups do not match/u);
  assertStoredTamper((stored) => { stored.review.decisions[0].reasonCodes = ["same-check"]; }, /correction reason/u);
  assertStoredTamper((stored) => {
    stored.review.decisions[0].reasonCodes = ["same-check", "same-check-repair"];
  }, /matches do not match/u);
  assertStoredTamper((stored) => { stored.review.decisions[0].evidenceRefs.push(stored.review.decisions[0].evidenceRefs[0]); }, /distinct packet evidence refs/u);
  assertStoredTamper((stored) => { stored.review.decisions[0].unexpected = true; }, /unsupported field/u);
  assertStoredTamper((stored) => { stored.result.matches = []; }, /matches/u);
  assertStoredTamper((stored) => { stored.result.matches[0].privatePath = "C:\\Users\\Alice\\token.txt"; }, /matches do not match/u);
  assertStoredTamper((stored) => {
    stored.result.learningLoop.candidates[0].privatePath = "C:\\Users\\Alice\\token.txt";
  }, /candidates\[0\] has unsupported field: privatePath/u);
  assertStoredTamper((stored) => {
    stored.result.learningLoop.candidates[0].priorityScore += 1;
    stored.result.learningLoop.candidates[0].currentCost.toolCalls += 1;
  }, /deterministic packet-bound reconstruction/u);
  assertStoredTamper((stored) => { stored.result.status = "effectiveness-proven"; }, /status must be reviewed/u);
});

test("public source-review CLI completes create, decision, and confirmed apply", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-source-review-"));
  const sourcePath = path.join(root, "report.source.json");
  const packetPath = path.join(root, "review.packet.json");
  const decisionPath = path.join(root, "lead.decision.json");
  const reviewPath = path.join(root, "review.json");
  const cli = path.resolve("scripts/better-harness.mjs");
  const run = (args) => spawnSync(process.execPath, [cli, "harness", "source-review", ...args, "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  try {
    const source = nativeCorrectionSource();
    await writeFile(sourcePath, `${JSON.stringify(source, null, 2)}\n`);

    const created = run([
      "create", "--source", sourcePath, "--packet", packetPath, "--decision", decisionPath,
    ]);
    assert.equal(created.status, 0, created.stderr || created.stdout);
    assert.equal(created.stderr, "");
    const createPayload = JSON.parse(created.stdout);
    assert.equal(createPayload.status, "packet-created");
    assert.equal(createPayload.decisionRequired, true);
    assert.equal(createPayload.decisionTemplateCreated, true);
    assert.equal(created.stdout.includes(root), false, "machine output must not echo local absolute paths");
    const template = JSON.parse(await readFile(decisionPath, "utf8"));
    assert.equal(template.kind, "harness-lead-decision-template");
    assert.deepEqual(template.required.dimensions, template.decision.scoreReview.dimensions.map((row) => row.id));
    assert.deepEqual(template.nativeGroups.map((group) => group.groupRef), template.decision.nativeLearningDecisions.map((row) => row.groupRef));
    assert.equal(template.decision.episodeReviews, undefined);
    assert.equal(template.decision.deliveryReviews, undefined);
    assert.ok(template.optionalShapes.episodeReviews.item);
    const duplicateCreate = run([
      "create", "--source", sourcePath, "--packet", packetPath, "--decision", decisionPath,
    ]);
    assert.equal(duplicateCreate.status, 1);
    assert.equal(JSON.parse(duplicateCreate.stdout).code, "EEXIST");
    assert.equal(duplicateCreate.stdout.includes(root), false, "machine errors must not echo local absolute paths");
    const rollbackPacketPath = path.join(root, "rollback.packet.json");
    const decisionConflict = run([
      "create", "--source", sourcePath, "--packet", rollbackPacketPath, "--decision", decisionPath,
    ]);
    assert.equal(decisionConflict.status, 1);
    await assert.rejects(readFile(rollbackPacketPath, "utf8"), { code: "ENOENT" });

    const rawDecision = completeNativeReview(source);
    rawDecision.privatePath = "E:\\private\\alice\\raw-decision.json";
    await writeFile(decisionPath, `${JSON.stringify(rawDecision, null, 2)}\n`);
    const rawDecisionResult = run([
      "decision", "--source", sourcePath, "--packet", packetPath,
      "--decision", decisionPath, "--review", reviewPath,
    ]);
    assert.equal(rawDecisionResult.status, 1);
    const rawDecisionPayload = JSON.parse(rawDecisionResult.stdout);
    assert.equal(rawDecisionPayload.code, "INVALID_LEAD_DECISION_TEMPLATE");
    assert.equal(rawDecisionPayload.errors, undefined);
    assert.equal(rawDecisionResult.stdout.includes("E:\\private\\alice"), false);
    await assert.rejects(readFile(reviewPath, "utf8"), { code: "ENOENT" });

    const privateDecision = structuredClone(template);
    privateDecision.decision.repositoryReview.reviewedChecks[0].id = "E:\\private\\alice\\invented-check";
    await writeFile(decisionPath, `${JSON.stringify(privateDecision, null, 2)}\n`);
    const privateDecisionResult = run([
      "decision", "--source", sourcePath, "--packet", packetPath,
      "--decision", decisionPath, "--review", reviewPath,
    ]);
    assert.equal(privateDecisionResult.status, 1);
    assert.equal(privateDecisionResult.stdout.includes("E:\\private\\alice"), false);
    assert.equal(JSON.parse(privateDecisionResult.stdout).errors, undefined);
    await writeFile(decisionPath, `${JSON.stringify(template, null, 2)}\n`);
    const incomplete = run([
      "decision", "--source", sourcePath, "--packet", packetPath,
      "--decision", decisionPath, "--review", reviewPath,
    ]);
    assert.equal(incomplete.status, 1);
    const incompletePayload = JSON.parse(incomplete.stdout);
    assert.equal(incompletePayload.code, "INVALID_LEAD_DECISION");
    assert.equal(incompletePayload.errors, undefined);
    await writeFile(decisionPath, `${JSON.stringify(fillNativeDecisionTemplate(template, source), null, 2)}\n`);

    const compiled = run([
      "decision", "--source", sourcePath, "--packet", packetPath,
      "--decision", decisionPath, "--review", reviewPath,
    ]);
    assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
    assert.equal(compiled.stderr, "");
    assert.equal(JSON.parse(compiled.stdout).status, "decision-compiled");
    assert.equal(compiled.stdout.includes(root), false, "machine output must not echo local absolute paths");

    const unconfirmed = run([
      "apply", "--source", sourcePath, "--packet", packetPath, "--review", reviewPath,
    ]);
    assert.equal(unconfirmed.status, 1);
    assert.equal(unconfirmed.stderr, "");
    assert.equal(JSON.parse(unconfirmed.stdout).code, "APPLY_CONFIRMATION_REQUIRED");
    assert.equal(
      JSON.parse(await readFile(sourcePath, "utf8")).repositoryEvidence.learningCaptureDiagnostics.nativeLearningReview.status,
      "review-required",
    );

    const applied = run([
      "apply", "--source", sourcePath, "--packet", packetPath, "--review", reviewPath, "--yes",
    ]);
    const applyDiagnostic = applied.status === 0 ? "" : spawnSync(process.execPath, [
      cli, "harness", "source-review", "apply", "--source", sourcePath,
      "--packet", packetPath, "--review", reviewPath, "--yes",
    ], { cwd: process.cwd(), encoding: "utf8" }).stderr;
    assert.equal(applied.status, 0, applyDiagnostic || applied.stderr || applied.stdout);
    assert.equal(applied.stderr, "");
    const applyPayload = JSON.parse(applied.stdout);
    assert.equal(applyPayload.status, "review-applied");
    assert.equal(applyPayload.nativeStatus, "reviewed");
    assert.equal(applied.stdout.includes(root), false, "machine output must not echo local absolute paths");
    assert.equal(
      JSON.parse(await readFile(sourcePath, "utf8")).repositoryEvidence.learningCaptureDiagnostics.nativeLearningReview.status,
      "reviewed",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("source-review read errors never echo selected absolute paths", () => {
  const cli = path.resolve("scripts/better-harness.mjs");
  const privatePath = "E:\\private\\alice\\missing.source.json";
  const args = [
    "harness", "source-review", "create", "--source", privatePath,
    "--packet", "E:\\private\\alice\\packet.json",
    "--decision", "E:\\private\\alice\\decision.json",
  ];
  const machine = spawnSync(process.execPath, [cli, ...args, "--json"], { encoding: "utf8" });
  assert.equal(machine.status, 1);
  assert.equal(machine.stderr, "");
  assert.equal(JSON.parse(machine.stdout).code, "INVALID_REPORT_SOURCE");
  assert.equal(`${machine.stdout}${machine.stderr}`.includes("E:\\private\\alice"), false);
  assert.equal(JSON.parse(machine.stdout).errors, undefined);

  const human = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  assert.equal(human.status, 1);
  assert.equal(human.stdout, "");
  assert.equal(`${human.stdout}${human.stderr}`.includes("E:\\private\\alice"), false);
  assert.match(human.stderr, /report source is not a readable local JSON file/u);
});

test("an adequate inspected window can retain an explicit no-candidate Learning Capture result", () => {
  const source = sourceWithAdequateNoCandidateWindow();
  assert.equal(source.repositoryEvidence.workflowDemandDiagnostics.repeatedCandidates.length, 0);
  assert.equal(source.repositoryEvidence.workflowDemandDiagnostics.coverage.demandSignals, "candidate-found");
  assert.equal(source.repositoryEvidence.workflowDemandDiagnostics.coverage.recurrence, "insufficient-recurrence");
  assert.equal(isAdequateLearningLoopNoCandidateWindow(source), true);
  assert.throws(
    () => applyReportSourceReview(source, completeReview(source)),
    /requires a lifecycle-repeat-detection finding for a bounded window without an accepted supported match or a reviewed adequate clean result/u,
  );

  const review = completeReview(source);
  const checks = new Map(review.repositoryReview.reviewedChecks.map((row) => [row.id, row]));
  Object.assign(checks.get("lifecycle-repeat-detection"), {
    state: "Exercised",
    summary: "Two eligible lifecycle episodes were inspected and no repeated candidate was found.",
    evidenceRefs: source.taskEpisodes.map((episode) => ({ kind: "task-episode", id: episode.id })),
  });
  Object.assign(checks.get("loop-engineering"), {
    state: "Not applicable",
    summary: "The adequate inspected window retained no supported candidate.",
    evidenceRefs: [{ kind: "session-selection", id: "bounded-selection" }],
  });
  Object.assign(checks.get("later-validation"), {
    state: "Not applicable",
    summary: "No intervention exists for a later comparison.",
    evidenceRefs: [{ kind: "session-selection", id: "bounded-selection" }],
  });

  const reviewed = applyReportSourceReview(source, review);
  const reviewedChecks = new Map(reviewed.assessmentDecisions
    .find((decision) => decision.kind === "repository-review").reviewedChecks
    .map((row) => [row.id, row]));
  assert.equal(reviewed.interventionLedger.length, 0);
  assert.equal(reviewedChecks.get("loop-engineering").state, "Not applicable");
  assert.equal(reviewedChecks.get("later-validation").state, "Not applicable");
  const findings = projectTaskLoopFindings(reviewed);
  const learning = findings.summary.dimensions.find((dimension) => dimension.id === "learning-capture");
  assert.equal(learning.subdimensions.find((row) => row.id === "loop-engineering").state, "Not applicable");
  assert.equal(learning.subdimensions.find((row) => row.id === "later-validation").state, "Not applicable");
  assert.equal(findings.summary.learningCapture.state, "N/A");
  assert.equal(findings.summary.learningCapture.effectiveness, undefined);
  const inadequate = structuredClone(source);
  inadequate.manifest.selection.analyzedCount = 1;
  assert.equal(isAdequateLearningLoopNoCandidateWindow(inadequate), false);
});

test("a bounded repeated-demand no-match requires an evidence-bound best-practice finding", () => {
  const source = sourceWithWorkflowDemand("specification-review", { recurringFriction: false });
  const lead = source.repositoryEvidence.workflowDemandDiagnostics.repeatedCandidates[0];
  const review = completeReview(source);

  assert.throws(
    () => applyReportSourceReview(source, review),
    /requires a lifecycle-repeat-detection finding for a bounded window without an accepted supported match or a reviewed adequate clean result/u,
  );

  const unbound = completeReview(source);
  const unboundFinding = learningCaptureNoMatchFinding(null);
  unbound.repositoryEvidence.findings = [unboundFinding];
  unbound.repositoryReview.reviewedChecks
    .find((row) => row.id === "lifecycle-repeat-detection").findingRefs = [unboundFinding.id];
  assert.throws(
    () => applyReportSourceReview(source, unbound),
    /must bind one generated repeated workflow-demand lead/u,
  );

  const bounded = completeReview(source);
  const finding = learningCaptureNoMatchFinding(lead.id);
  bounded.repositoryEvidence.findings = [finding];
  bounded.repositoryReview.reviewedChecks
    .find((row) => row.id === "lifecycle-repeat-detection").findingRefs = [finding.id];
  const reviewed = applyReportSourceReview(source, bounded);
  const projected = projectTaskLoopFindings(reviewed);
  const projectedFinding = projected.findings.find((row) => row.id === finding.id);

  assert.ok(projectedFinding);
  assert.deepEqual(projectedFinding.dimensionRefs, ["learning-capture"]);
  assert.deepEqual(projectedFinding.subdimensionRefs, ["lifecycle-repeat-detection"]);
  assert.ok(projected.summary.dimensions.find((row) => row.id === "learning-capture")
    .findingRefs.includes(finding.id));
});

test("missing normalized learning events require one bounded evidence-gap finding", () => {
  const source = sourceWithBoundedMissingLearningEvents();
  assert.equal(source.repositoryEvidence.learningCaptureDiagnostics.coverage.capture, "not-evaluable-missing-normalized-events");
  assert.equal(source.repositoryEvidence.workflowDemandDiagnostics.repeatedCandidates.length, 0);
  assert.equal(isAdequateLearningLoopNoCandidateWindow(source), false);

  assert.throws(
    () => applyReportSourceReview(source, completeReview(source)),
    /requires a lifecycle-repeat-detection finding for a bounded window without an accepted supported match or a reviewed adequate clean result/u,
  );

  const review = completeReview(source);
  const finding = learningCaptureNoMatchFinding(null);
  review.repositoryEvidence.findings = [finding];
  review.repositoryReview.reviewedChecks
    .find((row) => row.id === "lifecycle-repeat-detection").findingRefs = [finding.id];
  const projected = projectTaskLoopFindings(applyReportSourceReview(source, review));
  assert.ok(projected.findings.some((row) => row.id === finding.id));
});

test("an accepted candidate with missing Loop Engineering requires its own best-practice finding", () => {
  const source = sourceWithWorkflowDemand("specification-review");
  const lead = source.repositoryEvidence.workflowDemandDiagnostics.repeatedCandidates[0];
  const missing = completeReview(source);
  const checks = new Map(missing.repositoryReview.reviewedChecks.map((row) => [row.id, row]));
  Object.assign(checks.get("lifecycle-repeat-detection"), {
    state: "Exercised",
    summary: "Two bounded tasks support one repeated workflow opportunity.",
    evidenceRefs: lead.sourceEpisodes.map((id) => ({ kind: "task-episode", id })),
  });

  assert.throws(
    () => applyReportSourceReview(source, missing),
    /requires a loop-engineering finding when Loop Engineering is Unobserved/u,
  );

  const finding = learningCaptureNoMatchFinding(lead.id, {
    id: "learning-capture-loop-owner-gap",
    kind: "missing-mechanism",
    title: "A supported recurring opportunity has no reviewed durable owner",
    reason: "Two comparable workflow episodes support one recurring opportunity, but Loop Engineering has not selected a smallest durable owner or a verifiable operating contract.",
    expectedOutcome: "The recurring opportunity receives one evidence-bound smallest owner, verifier, state, and stop rule.",
    expectedOutput: ["Update the Learning Capture Workflow so the supported recurring opportunity has a smallest durable owner, verifier, state, and stop rule."],
    subdimensionRefs: ["loop-engineering"],
  });
  missing.repositoryEvidence.findings = [finding];
  Object.assign(checks.get("loop-engineering"), {
    state: "Missing",
    summary: "The supported recurring opportunity has no reviewed durable owner.",
    evidenceRefs: [{ kind: "workflow-demand", id: lead.id }],
    findingRefs: [finding.id],
  });
  const projected = projectTaskLoopFindings(applyReportSourceReview(source, missing));
  assert.ok(projected.findings.some((row) => row.id === finding.id
    && row.subdimensionRefs.includes("loop-engineering")));
});

test("Loop Engineering Exercised requires current validation evidence but no intervention ledger", () => {
  const source = sourceWithWorkflowDemand("specification-review");
  const lead = source.repositoryEvidence.workflowDemandDiagnostics.repeatedCandidates[0];
  const review = completeReview(source);
  const checks = new Map(review.repositoryReview.reviewedChecks.map((row) => [row.id, row]));
  Object.assign(checks.get("lifecycle-repeat-detection"), {
    state: "Exercised",
    evidenceRefs: lead.sourceEpisodes.map((id) => ({ kind: "task-episode", id })),
  });
  Object.assign(checks.get("loop-engineering"), {
    state: "Exercised",
    mechanisms: ["skill"],
    candidateOwner: "skill",
    ownerSelectionEvidenceRefs: [{ kind: "loop-discovery", id: "review-skill-owner" }],
  });

  assert.throws(
    () => applyReportSourceReview(source, review),
    /Exercised requires non-empty currentValidationEvidenceRefs/u,
  );

  checks.get("loop-engineering").currentValidationEvidenceRefs = [];
  assert.throws(
    () => applyReportSourceReview(source, review),
    /Exercised requires non-empty currentValidationEvidenceRefs/u,
  );

  checks.get("loop-engineering").currentValidationEvidenceRefs = [{
    kind: "validation",
    id: "review-skill-trial",
  }];
  const reviewed = applyReportSourceReview(source, review);
  assert.deepEqual(reviewed.interventionLedger, []);

  const forbidden = completeReview(source);
  forbidden.repositoryReview.reviewedChecks
    .find((row) => row.id === "loop-engineering").currentValidationEvidenceRefs = [{
      kind: "validation",
      id: "stale-review-skill-trial",
    }];
  assert.throws(
    () => applyReportSourceReview(source, forbidden),
    /currentValidationEvidenceRefs is supported only for Exercised/u,
  );
});

test("ordinary source finding ids fail closed for duplicates, reserved ids, and generated collisions", () => {
  const duplicate = sourceCandidate();
  duplicate.repositoryEvidence.findings.push(structuredClone(duplicate.repositoryEvidence.findings[0]));
  assert.match(
    validateHarnessReportSource(duplicate).join("; "),
    /duplicates ordinary source finding id: fixture-task-observation-gap/u,
  );

  const reserved = sourceCandidate();
  reserved.repositoryEvidence.findings[0].id = "learning-capture-follow-up";
  assert.match(
    validateHarnessReportSource(reserved).join("; "),
    /reserved for longitudinal follow-up/u,
  );

  const diagnosticCollision = sourceCandidate();
  Object.assign(diagnosticCollision.repositoryEvidence.diagnosticCoverageReviews[0], {
    status: "confirmed-gap",
    affectedScope: "src/core/request.ts",
    title: "Request failures lose their correlation id",
    missingSegment: "completion events do not retain the request id",
    impact: "operators cannot join failure events to the initiating request",
    expectedOutcome: "Every request event retains one correlation id.",
    severity: "High",
    expectedArtifact: "Code",
    expectedOutput: ["Update the owning Code so every request event carries one stable request id."],
    expectedOutput: ["Update the owning Code so every request event retains one correlation id."],
  });
  diagnosticCollision.repositoryEvidence.findings.push(reviewedFinding({
    id: "diagnostic-core-diagnostic-coverage",
  }));
  assert.match(
    validateHarnessReportSource(diagnosticCollision).join("; "),
    /collides with a generated finding id: diagnostic-core-diagnostic-coverage/u,
  );

  const checkupCollision = sourceCandidate();
  checkupCollision.repositoryEvidence.customizationCheckup = {
    kind: "harness-customization-checkup",
    schemaVersion: 1,
    phase: "report-evidence",
    coverage: { cleanupEligible: false },
    summary: { capabilityUse: [] },
    findings: [{ id: "skill-gap", kind: "skill", status: "candidate" }],
    diagnostics: { scanDigest: "a".repeat(64) },
  };
  checkupCollision.repositoryEvidence.findings.push(reviewedFinding({ id: "checkup-skill-gap" }));
  assert.match(
    validateHarnessReportSource(checkupCollision).join("; "),
    /collides with a generated finding id: checkup-skill-gap/u,
  );
});

test("Learning Capture source findings require one primary check and bidirectional links", () => {
  const source = sourceWithWorkflowDemand("specification-review");
  const lead = source.repositoryEvidence.workflowDemandDiagnostics.repeatedCandidates[0];
  const review = completeReview(source);
  review.repositoryEvidence.findings = [learningCaptureSkillFinding(lead.id)];
  exerciseLearningCaptureChecks(review, "lifecycle-spec-workflow-skill-gap", lead.sourceEpisodes);

  const twoOwners = structuredClone(review);
  twoOwners.repositoryEvidence.findings[0].subdimensionRefs.unshift("lifecycle-repeat-detection");
  assert.throws(
    () => applyReportSourceReview(source, twoOwners),
    /must name exactly one Learning Capture subdimension/u,
  );

  const unknown = structuredClone(review);
  unknown.repositoryReview.reviewedChecks
    .find((row) => row.id === "loop-engineering").findingRefs.push("unknown-learning-finding");
  assert.throws(
    () => applyReportSourceReview(source, unknown),
    /loop-engineering references unknown finding: unknown-learning-finding/u,
  );

  const mismatched = structuredClone(review);
  mismatched.repositoryEvidence.findings[0].subdimensionRefs = ["later-validation"];
  mismatched.repositoryReview.reviewedChecks
    .find((row) => row.id === "later-validation").findingRefs = ["lifecycle-spec-workflow-skill-gap"];
  assert.throws(
    () => applyReportSourceReview(source, mismatched),
    /loop-engineering finding lifecycle-spec-workflow-skill-gap must name loop-engineering in subdimensionRefs/u,
  );
});

test("source review preserves a generated actionable prompt when a matching review row omits it", () => {
  const source = sourceCandidate();
  const fixtureFinding = source.repositoryEvidence.findings[0];
  const generatedPrompt = `/better-harness fix this issue

Rewrite \`AGENTS.md\` so it keeps the project map and common commands in the root file, moves conditional setup detail to one-hop references, and names the owning directory plus next check for each task route.

## Validation

- Run the repository agent-lint command against \`AGENTS.md\`
- Start one representative task and confirm the owning route is discoverable without loading unrelated detail`;
  source.repositoryEvidence.findings = [reviewedFinding({ aiFixPrompt: generatedPrompt }), fixtureFinding];
  const review = completeReview(source);
  review.repositoryEvidence.findings = [reviewedFinding({
    reason: "The review confirmed that AGENTS.md still hides the project task route behind conditional setup detail.",
  })];

  const reviewed = applyReportSourceReview(source, review);

  assert.equal(reviewed.repositoryEvidence.findings
    .find((finding) => finding.id === "practice-rules-quality").aiFixPrompt, generatedPrompt);
});

test("source review frames missing prompts and preserves AI-authored prompts", () => {
  const source = sourceCandidate();
  const missing = completeReview(source);
  missing.repositoryEvidence.findings = [reviewedFinding({ id: "review-only-guidance-gap" })];
  const projectedMissing = projectTaskLoopFindings(applyReportSourceReview(source, missing));
  const missingFinding = projectedMissing.findings.find((finding) => finding.id === "review-only-guidance-gap");
  assert.match(missingFinding.aiFixPrompt, /^\/better-harness fix this issue/u);
  assert.match(missingFinding.aiFixPrompt, /## Validation/u);

  const generic = completeReview(source);
  generic.repositoryEvidence.findings = [reviewedFinding({
    id: "review-only-guidance-gap",
    aiFixPrompt: "/better-harness fix this issue\n\nImprove this dimension and run the smallest affected project check.\n\n## Validation\n\n- Re-run Harness",
  })];
  const projectedGeneric = projectTaskLoopFindings(applyReportSourceReview(source, generic));
  const genericFinding = projectedGeneric.findings.find((finding) => finding.id === "review-only-guidance-gap");
  assert.match(genericFinding.aiFixPrompt, /^\/better-harness fix this issue/u);
  assert.match(genericFinding.aiFixPrompt, /smallest affected project check/u);
});

test("source review preserves diagnostic prompts and lets the projector frame missing ones", () => {
  const source = sourceCandidate();
  const generatedPrompt = `/better-harness fix this issue

Update \`src/core/request.ts\` so the effective request id is attached to the logger before the downstream call and reused by the completion and failure events.

## Validation

- Run \`node --test test/request-diagnostics.test.mjs\`
- Trigger the failure fixture and confirm every event carries the same request id`;
  source.repositoryEvidence.diagnosticCoverageReviews = [{
    id: "core-diagnostic-coverage",
    status: "confirmed-gap",
    affectedScope: "src/core/request.ts",
    summary: "The request diagnostic chain was reviewed.",
    title: "Request failures lose their correlation id",
    missingSegment: "the downstream completion and failure events do not reuse the effective request id",
    impact: "operators cannot join the failed request to its initiating event",
    expectedOutcome: "Every request event carries one stable request id.",
    severity: "High",
    expectedArtifact: "Code",
    expectedOutput: ["Update the owning Code so every request event carries one stable request id."],
    evidenceRefs: [{ kind: "review", id: "request-diagnostics" }],
    aiFixPrompt: generatedPrompt,
  }];
  const preservingReview = completeReview(source);
  preservingReview.repositoryEvidence.diagnosticCoverageReviews = [{
    ...source.repositoryEvidence.diagnosticCoverageReviews[0],
  }];
  delete preservingReview.repositoryEvidence.diagnosticCoverageReviews[0].aiFixPrompt;

  const reviewed = applyReportSourceReview(source, preservingReview);
  assert.equal(reviewed.repositoryEvidence.diagnosticCoverageReviews[0].aiFixPrompt, generatedPrompt);

  const missing = completeReview(source);
  missing.repositoryEvidence.diagnosticCoverageReviews = [{
    ...source.repositoryEvidence.diagnosticCoverageReviews[0],
    id: "review-only-diagnostic-gap",
  }];
  delete missing.repositoryEvidence.diagnosticCoverageReviews[0].aiFixPrompt;
  const projectedMissing = projectTaskLoopFindings(applyReportSourceReview(source, missing));
  const diagnosticFinding = projectedMissing.findings.find((finding) => finding.id.includes("review-only-diagnostic-gap"));
  assert.match(diagnosticFinding.aiFixPrompt, /^\/better-harness fix this issue/u);
  assert.match(diagnosticFinding.aiFixPrompt, /## Validation/u);

  const jargon = completeReview(source);
  jargon.repositoryEvidence.diagnosticCoverageReviews = [{
    ...source.repositoryEvidence.diagnosticCoverageReviews[0],
    title: "Build/run loop lacks structured failure diagnostics",
  }];
  const projectedJargon = projectTaskLoopFindings(applyReportSourceReview(source, jargon));
  assert.equal(
    projectedJargon.findings.find((finding) => finding.id === "diagnostic-core-diagnostic-coverage").title,
    "Build/run loop lacks structured failure diagnostics",
  );
});

test("source review keeps optional generated learning diagnostics absent", () => {
  const source = sourceCandidate();
  delete source.repositoryEvidence.learningCaptureDiagnostics;
  const reviewed = applyReportSourceReview(source, completeReview(source));

  assert.equal("learningCaptureDiagnostics" in reviewed.repositoryEvidence, false);
  assert.equal(reviewed.assessmentDecisions.find((row) => row.kind === "repository-review")
    .reviewedChecks.find((row) => row.id === "lifecycle-repeat-detection").state, "Unobserved");
});

test("source review owner rejects incomplete review input", () => {
  const source = sourceCandidate();
  const review = completeReview(source);
  review.repositoryReview.reviewedChecks.pop();

  assert.throws(
    () => applyReportSourceReview(source, review),
    /requires a reviewed summary and evidenceRefs/,
  );
});

test("source review requires structural evidence for Software Fluency findings", () => {
  const source = sourceCandidate();
  const review = completeReview(source);
  review.repositoryReview.reviewedSoftwareFluencyCapabilities[0].finding = {
    status: "confirmed-gap",
    id: "software-fluency-context-map",
    kind: "missing-mechanism",
    title: "Task routes stop before a verifiable result",
    severity: "Low",
    reason: "The inspected task route has no concrete completion check.",
    expectedOutcome: "The task route reaches one reviewable completion result.",
    expectedArtifact: "Rule",
    expectedOutput: ["Update the project Rule so every task route names its owning directory and exact completion check."],
    aiFixPrompt: "/better-harness fix this issue\n\nUpdate `AGENTS.md` so every task route names its owning directory and the exact project check that proves completion. Keep conditional setup details in one-hop references and preserve the existing command names.\n\n## Validation\n\n- Run the repository agent-lint command against `AGENTS.md`\n- Follow one task route and confirm it reaches the named completion check",
  };

  assert.throws(
    () => applyReportSourceReview(source, review),
    /findings\[0\]\.evidenceRefs must contain concrete repository evidence/,
  );

  review.repositoryReview.reviewedSoftwareFluencyCapabilities[0].finding.evidenceRefs = [{
    kind: "repository-review",
    id: "context-map-gap",
  }];
  delete review.repositoryReview.reviewedSoftwareFluencyCapabilities[0].finding.aiFixPrompt;
  const projected = projectTaskLoopFindings(applyReportSourceReview(source, review));
  const capabilityFinding = projected.findings.find((finding) => finding.id === "software-fluency-context-map");
  assert.match(capabilityFinding.aiFixPrompt, /^\/better-harness fix this issue/u);
});

test("source review owner requires a concise evidence-backed reader overview", () => {
  const source = sourceCandidate();
  const missing = completeReview(source);
  delete missing.readerOverview;
  assert.throws(() => applyReportSourceReview(source, missing), /readerOverview is required/);

  const generic = completeReview(source);
  generic.readerOverview.text = "The project has a usable foundation: validation exists.";
  assert.throws(() => applyReportSourceReview(source, generic), /must not use the shared foundation/);
});

test("source review owner requires a reader summary for every scored dimension", () => {
  const source = sourceCandidate();
  const review = completeReview(source);
  delete review.scoreReview.dimensions[0].readerSummary;

  assert.throws(() => applyReportSourceReview(source, review), /readerSummary/);
});

test("a single-episode review uses the Learning Capture floor without triggering the no-match fallback", () => {
  const source = sourceCandidate();
  const review = completeReview(source);
  review.scoreReview.dimensions.find((row) => row.id === "learning-capture").score = LEARNING_CAPTURE_REVIEWED_SCORE_FLOOR;

  assert.equal(source.manifest.selection.analyzedCount, 1);
  assert.equal(source.taskEpisodes.length, 1);
  const reviewed = applyReportSourceReview(source, review);
  assert.equal(reviewed.assessmentDecisions.find((row) => row.kind === "score-review")
    .dimensions.find((row) => row.id === "learning-capture").score, LEARNING_CAPTURE_REVIEWED_SCORE_FLOOR);
});

test("the Learning Capture score floor and evidence ceiling bound the Agent-authored score", () => {
  for (const score of [0, LEARNING_CAPTURE_REVIEWED_SCORE_FLOOR - 1]) {
    const source = sourceCandidate();
    const review = completeReview(source);
    review.scoreReview.dimensions.find((row) => row.id === "learning-capture").score = score;
    assert.throws(
      () => applyReportSourceReview(source, review),
      /score-review learning-capture\.score must be an integer from 35 to 100/u,
    );
  }

  for (const score of [LEARNING_CAPTURE_REVIEWED_SCORE_FLOOR, 59]) {
    const source = sourceCandidate();
    const review = completeReview(source);
    review.scoreReview.dimensions.find((row) => row.id === "learning-capture").score = score;
    const reviewed = applyReportSourceReview(source, review);
    assert.equal(reviewed.assessmentDecisions.find((row) => row.kind === "score-review")
      .dimensions.find((row) => row.id === "learning-capture").score, score);
  }

  for (const score of [60, 100]) {
    const source = sourceCandidate();
    const review = completeReview(source);
    review.scoreReview.dimensions.find((row) => row.id === "learning-capture").score = score;
    assert.throws(
      () => applyReportSourceReview(source, review),
      /score-review learning-capture\.score .* exceeds the evidence ceiling 59/u,
    );
  }

});

test("the no-match policy is opt-in for new sources and rejects unknown policy markers", () => {
  const source = sourceWithBoundedMissingLearningEvents();
  const legacy = structuredClone(source);
  delete legacy.assessmentDecisions.find((row) => row.kind === "repository-review")
    .learningCaptureFindingPolicy;

  const legacyReviewed = applyReportSourceReview(legacy, completeReview(legacy));
  assert.deepEqual(validateHarnessReportSource(legacyReviewed), []);

  const unknown = structuredClone(source);
  unknown.assessmentDecisions.find((row) => row.kind === "repository-review")
    .learningCaptureFindingPolicy = `${LEARNING_CAPTURE_FINDING_POLICY}-unknown`;
  assert.match(
    validateHarnessReportSource(unknown).join("; "),
    /learningCaptureFindingPolicy must be best-practice-fallback-v1/u,
  );
});

test("source review owner rejects the retired generic post-edit finding", () => {
  const source = sourceCandidate();
  source.taskEpisodes = [];
  source.deliveryEvidence = [];
  source.repositoryEvidence.findings = [];
  const review = completeReview(source);
  review.repositoryEvidence.findings = [{
    id: "session-post-edit-validation-gap",
    kind: "evidence-gap",
    severity: "Medium",
    title: "Observed edits were not followed by validation",
    reason: "An older report recorded edits without a later validation command.",
    expectedOutcome: "Current project edits carry a relevant validation result.",
    dimensionRefs: ["change-validation"],
  }];

  assert.throws(
    () => applyReportSourceReview(source, review),
    /cannot use the retired generic post-edit validation gap.*session-evidence review lead/,
  );
});

test("source review owner keeps explicitly unverified state out of findings", () => {
  const source = sourceCandidate();
  const review = completeReview(source);
  review.repositoryEvidence.findings = [{
    id: "merge-acceptance-path-unverified",
    kind: "evidence-gap",
    severity: "Medium",
    title: "合并前的分支保护状态无法核实",
    reason: "外部 API 当前不可用，因此没有打开分支保护设置。",
    expectedOutcome: "有权限后再核实外部设置。",
    dimensionRefs: ["reliable-delivery"],
  }];

  assert.throws(
    () => applyReportSourceReview(source, review),
    /must keep unverified evidence in the review boundary/,
  );
});

test("source review preserves generated signals and required safety findings", () => {
  const source = sourceCandidate();
  const fixtureFinding = source.repositoryEvidence.findings[0];
  const generatedCoverage = structuredClone(source.repositoryEvidence.learningCaptureDiagnostics.coverage);
  const generatedWorkflowDemand = structuredClone(source.repositoryEvidence.workflowDemandDiagnostics);
  source.repositoryEvidence.learningCaptureDiagnostics.signals.observedSkills = [{ name: "harness", count: 2 }];
  source.repositoryEvidence.findings = [fixtureFinding, {
    id: "repository-embedded-credential",
    kind: "evidence-gap",
    severity: "High",
    title: "Tracked configuration contains embedded credentials",
    reason: "A redacted high-confidence scan found a reusable credential pattern in tracked automation configuration.",
    expectedOutcome: "Automation reads rotated credentials from the approved secret store.",
    expectedArtifact: "Config",
    expectedOutput: ["Update the affected automation Config so it reads rotated credentials from the approved secret store."],
    dimensionRefs: ["reliable-delivery", "controlled-execution"],
    subdimensionRefs: ["permission-boundary", "acceptance-evidence"],
    staticEvidence: [{ kind: "secret-scan", id: "redacted", label: ".aoneci/build-action.yaml:123" }],
    projectionPolicy: "required",
  }];
  const review = completeReview(source);
  review.repositoryEvidence.findings = [{
    ...source.repositoryEvidence.findings.find((finding) => finding.id === "repository-embedded-credential"),
    severity: "Low",
    reason: "A review row tried to weaken the code-owned safety finding.",
  }];
  const reviewed = applyReportSourceReview(source, review);

  assert.deepEqual(reviewed.repositoryEvidence.learningCaptureDiagnostics.signals.observedSkills, [{ name: "harness", count: 2 }]);
  assert.deepEqual(reviewed.repositoryEvidence.learningCaptureDiagnostics.coverage, generatedCoverage);
  assert.deepEqual(reviewed.repositoryEvidence.workflowDemandDiagnostics, generatedWorkflowDemand);
  assert.equal(reviewed.repositoryEvidence.findings.find((finding) => finding.id === "repository-embedded-credential").severity, "High");
  assert.doesNotMatch(JSON.stringify(reviewed), /\/Users\/private/);

  const tampered = completeReview(source);
  tampered.repositoryEvidence.learningCaptureDiagnostics = { signals: { observedSkills: [] } };
  assert.throws(
    () => applyReportSourceReview(source, tampered),
    /learningCaptureDiagnostics is generated and cannot be authored/,
  );

  const workflowTamper = completeReview(source);
  workflowTamper.repositoryEvidence.workflowDemandDiagnostics = { status: "candidate" };
  assert.throws(
    () => applyReportSourceReview(source, workflowTamper),
    /workflowDemandDiagnostics is generated and cannot be authored/,
  );
});

test("source review preserves and projects the required planning workflow finding", () => {
  const source = sourceCandidate();
  const fixtureFinding = source.repositoryEvidence.findings[0];
  const planning = buildTaskLoopRepositoryEvidence({
    trackedFiles: ["docs/specs/change.md"],
    insights: {
      sample: { analyzedSessionCount: 2 },
      keySignals: { planningSignals: [{ name: "/plan", kind: "plan-command", scope: "workspace" }] },
    },
  }).findings.find((finding) => finding.id === "planning-workflow-spec-use-gap");
  source.repositoryEvidence.findings = [fixtureFinding, planning];
  const review = completeReview(source);
  review.repositoryEvidence.findings = [];

  const reviewed = applyReportSourceReview(source, review);
  const projected = projectTaskLoopFindings(reviewed);

  assert.ok(reviewed.repositoryEvidence.findings.some((finding) => finding.id === planning.id));
  assert.ok(projected.findings.some((finding) => finding.id === planning.id));
});

test("source review rejects reviewer-authored learning candidates", () => {
  const source = sourceCandidate();
  const review = completeReview(source);
  const episodeId = source.taskEpisodes[0].id;
  review.repositoryEvidence.learningCaptureDiagnostics = {
    recurringIssueCandidates: [{
    id: "learning-loop:present-but-not-routed:reviewed-route",
    patternId: "present-but-not-routed",
    claimType: "opportunity",
    provenance: "ai-reviewed",
    sourceEpisodes: [episodeId],
    taskFingerprint: { family: "repository-review", repoArea: "review-route" },
    normalizedSignature: "repository-review-route",
    asset: {
      kind: "Skill",
      ref: "skill:review-route",
      scope: "project",
      currentTruthRefs: [{ kind: "asset-inventory", id: "review-route" }],
      requiredStepRefs: [],
      updateEvidenceRefs: [],
      outcomeEvidenceRefs: [],
    },
    observedBehavior: "The reviewed task matched an inspected Skill, but invocation evidence showed that it was not selected.",
    currentCost: { episodeCount: 1, toolCalls: 3, elapsedMs: 1000, tokens: 0, userCorrections: 0 },
    candidateCauses: ["The Skill trigger does not match realistic task language."],
    brokenStage: "route",
    recommendedOwner: "Skill",
    intervention: "Tighten the trigger and add positive and negative routing fixtures.",
    primaryMetric: "should-trigger hit rate",
    guardrails: ["should-not-trigger false positive rate"],
    stopOrRevert: "Revert when false positives increase without a routing gain.",
    confidence: "medium",
    priorityScore: 12,
    evidenceRefs: [{ kind: "task-episode", id: episodeId }],
    }],
  };

  assert.throws(
    () => applyReportSourceReview(source, review),
    /learningCaptureDiagnostics is generated and cannot be authored/,
  );
});

test("source and review validation reject the retired learning capture envelope", () => {
  const source = sourceCandidate();
  source.repositoryEvidence.learningCaptureReview = {};
  assert.ok(validateHarnessReportSource(source).some((error) => error.includes("learningCaptureReview is retired")));

  const cleanSource = sourceCandidate();
  const review = completeReview(cleanSource);
  review.repositoryEvidence.learningCaptureReview = {};
  assert.throws(
    () => applyReportSourceReview(cleanSource, review),
    /learningCaptureReview is retired/,
  );
});

test("source review can declare a validated intervention for later comparison", () => {
  const source = sourceCandidate();
  const review = completeReview(source);
  review.interventionLedger = [pendingIntervention()];

  const reviewed = applyReportSourceReview(source, review);

  assert.deepEqual(reviewed.interventionLedger, review.interventionLedger);
});

test("source review retains a dormant ledger while requiring later validation to stay Unobserved", () => {
  const source = sourceCandidate();
  const review = completeReview(source);
  review.interventionLedger = [pendingIntervention()];

  const reviewed = applyReportSourceReview(source, review);
  const checks = new Map(reviewed.assessmentDecisions
    .find((decision) => decision.kind === "repository-review").reviewedChecks
    .map((row) => [row.id, row]));
  assert.equal(reviewed.interventionLedger.length, 1);
  assert.notEqual(checks.get("loop-engineering").state, "Exercised");
  assert.equal(checks.get("later-validation").state, "Unobserved");

  const invalidReview = completeReview(source);
  invalidReview.interventionLedger = [pendingIntervention()];
  invalidReview.repositoryReview.reviewedChecks
    .find((row) => row.id === "later-validation").state = "Present";
  assert.throws(
    () => applyReportSourceReview(source, invalidReview),
    /later-validation must be Unobserved for the current Loop Engineering state and retained intervention ledger/,
  );
});

test("later validation distinguishes an unverified plan from a fair bound comparison", () => {
  const source = sourceWithWorkflowDemand("specification-review");
  const lead = source.repositoryEvidence.workflowDemandDiagnostics.repeatedCandidates[0];
  const review = completeReview(source);
  review.interventionLedger = [{ ...pendingIntervention(), episodeRef: lead.sourceEpisodes[0] }];
  const checks = new Map(review.repositoryReview.reviewedChecks.map((row) => [row.id, row]));
  Object.assign(checks.get("lifecycle-repeat-detection"), {
    state: "Exercised",
    evidenceRefs: lead.sourceEpisodes.map((id) => ({ kind: "task-episode", id })),
  });
  Object.assign(checks.get("loop-engineering"), {
    state: "Exercised",
    mechanisms: ["skill"],
    candidateOwner: "skill",
    ownerSelectionEvidenceRefs: [{ kind: "loop-discovery", id: "review-skill-owner" }],
    currentValidationEvidenceRefs: [{ kind: "validation", id: "review-skill-trial" }],
  });
  Object.assign(checks.get("later-validation"), { state: "Present" });
  assert.doesNotThrow(() => applyReportSourceReview(source, review));

  review.interventionLedger[0].comparisonWindow.taskMix = "comparable";
  checks.get("later-validation").state = "Wired";
  assert.doesNotThrow(() => applyReportSourceReview(source, review));
});

test("an inspected missing comparison plan requires a later-validation finding", () => {
  const source = sourceWithWorkflowDemand("specification-review");
  const lead = source.repositoryEvidence.workflowDemandDiagnostics.repeatedCandidates[0];
  const review = completeReview(source);
  const checks = new Map(review.repositoryReview.reviewedChecks.map((row) => [row.id, row]));
  Object.assign(checks.get("lifecycle-repeat-detection"), {
    state: "Exercised",
    evidenceRefs: lead.sourceEpisodes.map((id) => ({ kind: "task-episode", id })),
  });
  Object.assign(checks.get("loop-engineering"), {
    state: "Exercised",
    mechanisms: ["skill"],
    candidateOwner: "skill",
    ownerSelectionEvidenceRefs: [{ kind: "loop-discovery", id: "review-skill-owner" }],
    currentValidationEvidenceRefs: [{ kind: "validation", id: "review-skill-trial" }],
  });
  Object.assign(checks.get("later-validation"), {
    state: "Missing",
    summary: "The exercised route has no complete later-comparison plan.",
    evidenceRefs: [{ kind: "comparison-review", id: "missing-comparison-plan" }],
  });

  assert.throws(
    () => applyReportSourceReview(source, review),
    /later-validation Missing requires an ordinary finding for the incomplete comparison plan/u,
  );

  const findingId = "learning-capture-comparison-plan-gap";
  review.repositoryEvidence.findings = [{
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
    staticEvidence: [{ kind: "comparison-review", id: "missing-comparison-plan" }],
    aiFixPrompt: "/better-harness fix this issue\n\nUpdate the `AGENTS.md` intervention owner Rule with a baseline, primary metric, guardrail, comparable scope, selection rule, validation method, and stop or revert condition.\n\n## Validation\n\n- Validate the completed comparison plan against the Learning Capture source contract\n- Confirm later-validation is Present only after the complete plan is retained",
  }];
  checks.get("later-validation").findingRefs = [findingId];
  assert.doesNotThrow(() => applyReportSourceReview(source, review));
});

test("a regressing comparison requires a later-validation finding", () => {
  const source = sourceWithWorkflowDemand("specification-review");
  const lead = source.repositoryEvidence.workflowDemandDiagnostics.repeatedCandidates[0];
  const review = completeReview(source);
  review.interventionLedger = [{
    ...regressingIntervention(),
    episodeRef: lead.sourceEpisodes[0],
  }];
  const checks = new Map(review.repositoryReview.reviewedChecks.map((row) => [row.id, row]));
  Object.assign(checks.get("lifecycle-repeat-detection"), {
    state: "Exercised",
    evidenceRefs: lead.sourceEpisodes.map((id) => ({ kind: "task-episode", id })),
  });
  Object.assign(checks.get("loop-engineering"), {
    state: "Exercised",
    mechanisms: ["skill"],
    candidateOwner: "skill",
    ownerSelectionEvidenceRefs: [{ kind: "loop-discovery", id: "review-skill-owner" }],
    currentValidationEvidenceRefs: [{ kind: "validation", id: "review-skill-trial" }],
  });
  Object.assign(checks.get("later-validation"), {
    state: "Exercised",
    summary: "The comparable window regressed and the declared stop condition remains actionable.",
    evidenceRefs: [{ kind: "comparison", id: "regressing-comparison" }],
  });

  assert.throws(
    () => applyReportSourceReview(source, review),
    /regressing intervention requires an ordinary finding owned by later-validation/u,
  );

  const findingId = "learning-capture-regression-action";
  review.repositoryEvidence.findings = [{
    id: findingId,
    kind: "outcome-gap",
    severity: "High",
    title: "The regressing intervention still needs its stop action",
    reason: "The comparable review window regressed on the primary metric, but the declared stop or revert action has not been closed.",
    expectedOutcome: "The intervention is stopped or reverted before it expands to another task window.",
    expectedArtifact: "Rule",
    expectedOutput: ["Update the intervention owner Rule to apply and retain the declared stop or revert decision."],
    dimensionRefs: ["learning-capture"],
    subdimensionRefs: ["later-validation"],
    staticEvidence: [{ kind: "comparison", id: "regressing-comparison" }],
    aiFixPrompt: "/better-harness fix this issue\n\nUpdate the `interventionLedger` owner record by applying its declared stop or revert condition, recording the owner decision, and blocking further rollout until the regression is resolved.\n\n## Validation\n\n- Run the bounded intervention comparison check\n- Confirm `interventionLedger` retains the stop or revert decision before another intervention window",
  }];
  checks.get("later-validation").findingRefs = [findingId];
  assert.doesNotThrow(() => applyReportSourceReview(source, review));
});

test("source review projects recurring Spec and Git workflow capture gaps", () => {
  const cases = [{
    id: "lifecycle-spec-workflow-skill-gap",
    intent: "specification-review",
    family: "specification/planning",
    summary: "The observed planning handoff has no reusable specification and acceptance-traceability procedure.",
    title: "Planning has no reusable Spec workflow",
    reason: "A non-trivial planning handoff was observed, but opened Skill inventory contains no built-in, configured, or observed procedure for creating a canonical Spec and linking acceptance evidence.",
    expectedOutcome: "Non-trivial planning consistently creates or opens the canonical Spec and carries its acceptance ids into validation.",
    prompt: "/better-harness fix this issue\n\nUse the separately authorized `/create-skill` workflow to create `skills/spec-workflow/SKILL.md` for non-trivial planning. Define its trigger, canonical Spec selection or creation steps, acceptance-id handoff, validation, and one stop boundary; do not create a whole-SDLC Skill.\n\n## Validation\n\n- Run the repository Skill validator for `skills/spec-workflow/SKILL.md`\n- Exercise one non-trivial planning task and confirm it opens or creates the canonical Spec before implementation",
  }, {
    id: "lifecycle-git-branch-completion-skill-gap",
    intent: "branch-completion",
    family: "review/acceptance/branch completion",
    summary: "Observed multi-step branch completion has no reusable Git lifecycle procedure.",
    title: "Branch completion has no reusable Skill procedure",
    reason: "The bounded task used branch inspection, conflict-safe integration, validation, and completion steps, but opened Skill inventory contains no built-in, configured, or observed Git lifecycle procedure.",
    expectedOutcome: "Branch completion follows a discoverable procedure with validation, safe recovery, and an explicit acceptance result.",
    prompt: "/better-harness fix this issue\n\nUse the separately authorized `/create-skill` workflow to create `skills/git-branch-completion/SKILL.md` for multi-step branch completion. Define its trigger, branch and worktree checks, conflict recovery, validation, acceptance output, and stop boundary; do not create a generic Git command Skill.\n\n## Validation\n\n- Run the repository Skill validator for `skills/git-branch-completion/SKILL.md`\n- Exercise one bounded branch-completion task and confirm validation and recovery checks run before acceptance",
  }];

  for (const candidate of cases) {
    const source = sourceWithWorkflowDemand(candidate.intent);
    const lead = source.repositoryEvidence.workflowDemandDiagnostics.repeatedCandidates[0];
    const review = completeReview(source);
    const checks = new Map(review.repositoryReview.reviewedChecks.map((row) => [row.id, row]));
    Object.assign(checks.get("lifecycle-repeat-detection"), {
      state: "Exercised",
      summary: "Two bounded tasks reached the same uncovered lifecycle handoff.",
      evidenceRefs: lead.sourceEpisodes.map((id) => ({ kind: "task-episode", id })),
    });
    Object.assign(checks.get("loop-engineering"), {
      state: "Missing",
      mechanisms: [],
      candidateOwner: "skill",
      ownerSelectionEvidenceRefs: [{ kind: "loop-discovery", id: `skill-owner-${candidate.id}` }],
      summary: "The reviewed handoff has no reusable lifecycle procedure owner.",
      evidenceRefs: [{ kind: "repository-review", id: `owner-${candidate.id}` }],
      findingRefs: [candidate.id],
    });
    Object.assign(checks.get("later-validation"), {
      state: "Unobserved",
      summary: "No reusable capture exists yet for a later comparison.",
      evidenceRefs: [{ kind: "session-selection", id: "bounded-selection" }],
      findingRefs: [],
    });
    review.repositoryEvidence.findings = [{
      id: candidate.id,
      kind: "capture-gap",
      severity: "Low",
      title: candidate.title,
      reason: candidate.reason,
      expectedOutcome: candidate.expectedOutcome,
      expectedArtifact: "Skill",
      expectedOutput: ["Create a reusable Skill so the repeated workflow has a bounded trigger, procedure, validation, and stop boundary."],
      dimensionRefs: ["learning-capture"],
      subdimensionRefs: ["loop-engineering"],
      staticEvidence: [{ kind: "workflow-demand", id: lead.id }],
      aiFixPrompt: candidate.prompt,
    }];

    const missingPrompt = structuredClone(review);
    delete missingPrompt.repositoryEvidence.findings[0].aiFixPrompt;
    const projectedMissing = projectTaskLoopFindings(applyReportSourceReview(source, missingPrompt));
    assert.match(
      projectedMissing.findings.find((finding) => finding.id === candidate.id).aiFixPrompt,
      /^\/better-harness fix this issue/u,
    );

    const reviewed = applyReportSourceReview(source, review);
    const findings = projectTaskLoopFindings(reviewed);
    const row = findings.findings.find((finding) => finding.id === candidate.id);

    assert.ok(row);
    assert.equal(row.severity, "Low");
    assert.equal(row.expectedArtifact, "Skill");
    assert.match(row.aiFixPrompt, /\/create-skill/u);
  }
});

test("Learning Capture Skill creation requires generated repeated workflow demand", () => {
  const missingDiagnostics = sourceCandidate();
  delete missingDiagnostics.repositoryEvidence.workflowDemandDiagnostics;
  missingDiagnostics.repositoryEvidence.findings = [learningCaptureSkillFinding("workflow-demand:invented")];
  assert.ok(validateHarnessReportSource(missingDiagnostics).some((error) =>
    /requires generated workflowDemandDiagnostics/u.test(error)));

  const currentOnly = sourceWithWorkflowDemand("specification-review", { repeat: false });
  const currentReview = completeReview(currentOnly);
  currentReview.repositoryEvidence.findings = [learningCaptureSkillFinding(
    currentOnly.repositoryEvidence.workflowDemandDiagnostics.currentHandoffs[0].id,
  )];
  assert.throws(
    () => applyReportSourceReview(currentOnly, currentReview),
    /cannot promote a current workflow handoff into Learning Capture Skill creation/u,
  );

  const repeated = sourceWithWorkflowDemand("specification-review");
  const inventedReview = completeReview(repeated);
  inventedReview.repositoryEvidence.findings = [learningCaptureSkillFinding("workflow-demand:invented")];
  assert.throws(
    () => applyReportSourceReview(repeated, inventedReview),
    /references an unknown repeated workflow-demand lead/u,
  );
});

test("repeated lifecycle demand alone cannot become a Learning Capture Skill finding", () => {
  const source = sourceWithWorkflowDemand("specification-review", { recurringFriction: false });
  const lead = source.repositoryEvidence.workflowDemandDiagnostics.repeatedCandidates[0];
  const review = completeReview(source);
  review.repositoryEvidence.findings = [learningCaptureSkillFinding(lead.id)];
  exerciseLearningCaptureChecks(review, "lifecycle-spec-workflow-skill-gap", lead.sourceEpisodes);

  assert.throws(
    () => applyReportSourceReview(source, review),
    /requires repeated friction or a repeated successful procedure with result evidence/u,
  );
});

test("a repeated successful procedure needs retained result evidence before it supports Loop Engineering", () => {
  const source = sourceWithWorkflowDemand("specification-review", { recurringFriction: false });
  for (const episode of source.taskEpisodes) {
    episode.learningSignals = [{
      patternId: "successful-procedure-not-reused",
      normalizedSignature: "successful-spec-review-procedure",
      taskFamily: "spec-review",
      repoArea: "review-route",
      frictionType: "successful-procedure-not-reused",
      procedural: true,
      validationResult: "passed",
      evidenceRefs: [{ kind: "fixture-event", id: `${episode.id}-successful-procedure` }],
    }];
  }
  const rebuild = () => buildLearningLoopReview({ episodes: source.taskEpisodes });
  let diagnostics = rebuild();
  Object.assign(source.repositoryEvidence.learningCaptureDiagnostics, {
    learningCaptureSchemaVersion: diagnostics.schemaVersion,
    episodeRecords: diagnostics.episodeRecords,
    recurringIssueCandidates: diagnostics.candidates,
    coverage: diagnostics.coverage,
  });
  const review = completeReview(source);
  const checks = new Map(review.repositoryReview.reviewedChecks.map((row) => [row.id, row]));
  Object.assign(checks.get("lifecycle-repeat-detection"), {
    state: "Exercised",
    evidenceRefs: source.taskEpisodes.map((episode) => ({ kind: "task-episode", id: episode.id })),
  });
  Object.assign(checks.get("loop-engineering"), {
    state: "Present",
    mechanisms: ["skill"],
    candidateOwner: "skill",
    ownerSelectionEvidenceRefs: [{ kind: "loop-discovery", id: "successful-procedure-owner" }],
    summary: "The repeated successful procedure has a reviewed Skill owner hypothesis.",
    evidenceRefs: [{ kind: "repository-review", id: "successful-procedure-owner" }],
  });
  assert.doesNotThrow(() => applyReportSourceReview(source, review));

  for (const episode of source.taskEpisodes) episode.learningSignals[0].validationResult = "unobserved";
  diagnostics = rebuild();
  Object.assign(source.repositoryEvidence.learningCaptureDiagnostics, {
    episodeRecords: diagnostics.episodeRecords,
    recurringIssueCandidates: diagnostics.candidates,
    coverage: diagnostics.coverage,
  });
  assert.throws(
    () => applyReportSourceReview(source, review),
    /supported repeated friction or successful-procedure candidate/u,
  );
});

test("Learning Capture Skill creation binds the finding only to its primary Loop Engineering check", () => {
  const source = sourceWithWorkflowDemand("specification-review");
  const lead = source.repositoryEvidence.workflowDemandDiagnostics.repeatedCandidates[0];

  const unexercised = completeReview(source);
  unexercised.repositoryEvidence.findings = [learningCaptureSkillFinding(lead.id)];
  assert.throws(
    () => applyReportSourceReview(source, unexercised),
    /requires lifecycle-repeat-detection state Exercised/u,
  );

  const engineeringOwned = completeReview(source);
  engineeringOwned.repositoryEvidence.findings = [learningCaptureSkillFinding(lead.id)];
  exerciseLearningCaptureChecks(engineeringOwned, "lifecycle-spec-workflow-skill-gap", lead.sourceEpisodes);
  const reviewed = applyReportSourceReview(source, engineeringOwned);
  const recurring = reviewed.assessmentDecisions.find((row) => row.kind === "repository-review")
    .reviewedChecks.find((row) => row.id === "lifecycle-repeat-detection");
  assert.deepEqual(recurring.findingRefs, []);

  const missingReusableLink = completeReview(source);
  missingReusableLink.repositoryEvidence.findings = [learningCaptureSkillFinding(lead.id)];
  exerciseLearningCaptureChecks(missingReusableLink, "lifecycle-spec-workflow-skill-gap", lead.sourceEpisodes);
  missingReusableLink.repositoryReview.reviewedChecks
    .find((row) => row.id === "loop-engineering").findingRefs = [];
  assert.throws(
    () => applyReportSourceReview(source, missingReusableLink),
    /must be linked from loop-engineering\.findingRefs/u,
  );
});

test("source review preserves multiple Loop Engineering findings across distinct leads and owners", () => {
  const source = addDistinctWorkflowDemand(
    sourceWithWorkflowDemand("specification-review"),
    "release-delivery",
  );
  const leads = source.repositoryEvidence.workflowDemandDiagnostics.repeatedCandidates;
  const skillLead = leads.find((lead) => lead.procedureFamily === "specification-review");
  const ruleLead = leads.find((lead) => lead.procedureFamily === "release-delivery");
  assert.equal(leads.length, 2);
  assert.ok(skillLead);
  assert.ok(ruleLead);
  const review = completeReview(source);
  const first = learningCaptureSkillFinding(skillLead.id);
  const second = learningCaptureSkillFinding(ruleLead.id, {
    id: "lifecycle-release-decision-rule-gap",
    title: "Repeated releases do not retain the stop decision",
    reason: "Two bounded release-delivery tasks repeated the same correction because the durable release decision was not retained by its smallest Rule owner.",
    expectedOutcome: "Release delivery retains one discoverable stop decision that later tasks can apply and validate.",
    expectedArtifact: "Rule",
    expectedOutput: ["Update the release owner Rule so it retains the reviewed stop decision and routes it into the next release task."],
    aiFixPrompt: "/better-harness fix this issue\n\nUpdate the release owner Rule so it retains the reviewed stop decision and routes it into the next release task.\n\n## Validation\n\n- Run the repository Rule validation\n- Exercise the repeated release-delivery fixture and confirm the stop decision is applied",
  });
  review.repositoryEvidence.findings = [first, second];
  const checks = new Map(review.repositoryReview.reviewedChecks.map((row) => [row.id, row]));
  Object.assign(checks.get("lifecycle-repeat-detection"), {
    state: "Exercised",
    summary: "Two distinct repeated workflow leads were retained from four bounded tasks.",
    evidenceRefs: source.taskEpisodes.map((episode) => ({ kind: "task-episode", id: episode.id })),
  });
  Object.assign(checks.get("loop-engineering"), {
    state: "Present",
    mechanisms: ["rule"],
    candidateOwner: "rule",
    ownerSelectionEvidenceRefs: [{ kind: "loop-discovery", id: "selected-rule-owner" }],
    summary: "One Rule route is selected while another supported Skill repair remains visible.",
    evidenceRefs: [{ kind: "repository-review", id: "multi-owner-review" }],
    findingRefs: [first.id, second.id],
  });

  const reviewed = applyReportSourceReview(source, review);
  const reviewedChecks = new Map(reviewed.assessmentDecisions
    .find((row) => row.kind === "repository-review").reviewedChecks
    .map((row) => [row.id, row]));
  assert.deepEqual(reviewedChecks.get("lifecycle-repeat-detection").findingRefs, []);
  assert.deepEqual(reviewedChecks.get("loop-engineering").findingRefs, [first.id, second.id]);
  assert.equal(reviewedChecks.get("loop-engineering").candidateOwner, "rule");
  assert.deepEqual(reviewed.repositoryEvidence.findings
    .filter((finding) => finding.dimensionRefs?.includes("learning-capture"))
    .map((finding) => finding.id), [first.id, second.id]);
  assert.deepEqual(reviewed.repositoryEvidence.findings
    .filter((finding) => finding.dimensionRefs?.includes("learning-capture"))
    .map((finding) => finding.expectedArtifact), ["Skill", "Rule"]);
});

test("Learning Capture Skill creation cannot bypass an earlier coverage-ladder action", () => {
  const source = sourceWithWorkflowDemand("specification-review");
  const skillPath = ".agents/skills/spec-review/SKILL.md";
  source.repositoryEvidence.learningCaptureEvidence = buildTaskLoopRepositoryEvidence({
    trackedFiles: ["AGENTS.md", skillPath],
    fileContents: {
      "AGENTS.md": `Use [Spec Review](${skillPath}) before implementation.`,
      [skillPath]: `---
name: spec-review
description: Use when reviewing a specification before implementation.
---
# Spec Review
## When to use
Review the specification before implementation.
## Workflow
Inspect scope and acceptance criteria.
## Output
Produce a reviewed specification.
## Validation
Verify every finding has bounded evidence.
`,
    },
  }).learningCaptureEvidence;
  source.repositoryEvidence.workflowDemandDiagnostics = buildWorkflowDemandDiagnostics({
    taskEpisodes: source.taskEpisodes,
    currentEpisodeId: source.sessionEvents.currentEpisodeRef,
    reusableSkillEvidence: source.repositoryEvidence.learningCaptureEvidence.reusableSkillEvidence,
  });
  const lead = source.repositoryEvidence.workflowDemandDiagnostics.repeatedCandidates[0];
  assert.equal(lead.ownerReview.action, "try-configured");

  const review = completeReview(source);
  review.repositoryEvidence.findings = [learningCaptureSkillFinding(lead.id)];
  exerciseLearningCaptureChecks(review, "lifecycle-spec-workflow-skill-gap", lead.sourceEpisodes);
  assert.throws(
    () => applyReportSourceReview(source, review),
    /cannot create a Skill while the coverage ladder action is try-configured/u,
  );
});

test("a bounded current-dimension Skill handoff is not promoted into Learning Capture", () => {
  const source = sourceWithWorkflowDemand("specification-review", { repeat: false });
  const currentLead = source.repositoryEvidence.workflowDemandDiagnostics.currentHandoffs[0];
  const review = completeReview(source);
  review.repositoryEvidence.findings = [learningCaptureSkillFinding(currentLead.id, {
    id: "current-spec-skill-handoff",
    title: "Current specification review needs an explicit Skill handoff",
    reason: "The bounded current task has enough reviewed workflow evidence for an owner handoff without claiming recurrence.",
    dimensionRefs: ["task-understanding"],
    subdimensionRefs: ["goal-understanding"],
  })];

  const wrongDimension = structuredClone(review);
  wrongDimension.repositoryEvidence.findings[0].dimensionRefs = ["controlled-execution"];
  wrongDimension.repositoryEvidence.findings[0].subdimensionRefs = ["supported-operation"];
  assert.throws(
    () => applyReportSourceReview(source, wrongDimension),
    /current workflow-demand ref requires dimensionRefs to include task-understanding/u,
  );

  const reviewed = applyReportSourceReview(source, review);
  assert.ok(reviewed.repositoryEvidence.findings.some((finding) => finding.id === "current-spec-skill-handoff"));
  assert.equal(reviewed.assessmentDecisions.find((row) => row.kind === "repository-review")
    .reviewedChecks.find((row) => row.id === "lifecycle-repeat-detection").state, "Unobserved");
});

test("a current workflow finding cannot bypass built-in or configured Skill coverage", () => {
  const source = sourceWithWorkflowDemand("review-acceptance-delivery", { repeat: false });
  const lead = source.repositoryEvidence.workflowDemandDiagnostics.currentHandoffs[0];
  assert.equal(lead.ownerReview.action, "try-built-in");
  const review = completeReview(source);
  review.repositoryEvidence.findings = [learningCaptureSkillFinding(lead.id, {
    id: "current-review-skill-bypass",
    title: "Current review proposes a redundant Skill",
    reason: "The current review request already has a bounded host capability that must be tried before a new owner is considered.",
    dimensionRefs: ["reliable-delivery"],
    subdimensionRefs: ["acceptance-evidence"],
  })];

  assert.throws(
    () => applyReportSourceReview(source, review),
    /cannot create a Skill while the current workflow coverage ladder action is try-built-in/u,
  );
});
