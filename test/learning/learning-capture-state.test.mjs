import assert from "node:assert/strict";
import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { loadPriorLearningCaptureState } from "../../scripts/harness-analysis/learning-capture-state.mjs";
import { projectInterventionLedger } from "../../scripts/harness-analysis/intervention-ledger.mjs";

function ref(id) {
  return { kind: "fixture", id };
}

function pendingIntervention() {
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
    comparisonWindow: {
      laterWindowRef: "window-2",
      scope: "same review handoff",
      taskMix: "unverified",
      selectionStrategy: "stratified",
    },
    validation: { method: "compare bounded task episodes", evidenceRefs: [ref("comparison-plan")] },
    stopOrRevertCondition: "Stop if review rework or false positives increase.",
    result: { state: "pending" },
  };
}

test("field-scoped continuity restores a complete ledger regardless of version metadata", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "better-harness-learning-capture-state-"));
  const reportDir = path.join(workspace, ".qoder", "better-harness", "2026-07-12", "120000-project");
  await mkdir(reportDir, { recursive: true });
  const intervention = pendingIntervention();
  await writeFile(path.join(reportDir, "findings.json"), JSON.stringify({
    summary: {
      projectName: path.basename(workspace),
      modelId: "future-agent-work-loop",
      reportContractVersion: 999,
      learningCapture: { interventions: projectInterventionLedger([intervention]).entries },
    },
  }), "utf8");

  const state = await loadPriorLearningCaptureState({
    workspace,
    validateReport: () => {
      throw new Error("field-scoped continuity must not call a whole-report validator");
    },
  });

  assert.deepEqual(state.interventionLedger, [intervention]);
  assert.equal(state.evidenceRef.kind, "prior-harness-report");
  assert.equal(state.warning, null);
  assert.doesNotMatch(JSON.stringify(state), new RegExp(workspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("whole-report validators do not gate the learning-capture capability", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "better-harness-learning-loop-state-v23-"));
  const reportDir = path.join(workspace, ".qoder", "better-harness", "2026-07-15", "120000-project");
  await mkdir(reportDir, { recursive: true });
  const intervention = pendingIntervention();
  await writeFile(path.join(reportDir, "findings.json"), JSON.stringify({
    summary: {
      projectName: path.basename(workspace),
      modelId: "future-agent-work-loop",
      reportContractVersion: 1000,
      learningCapture: { interventions: projectInterventionLedger([intervention]).entries },
    },
  }), "utf8");
  let validationCalls = 0;

  const state = await loadPriorLearningCaptureState({
    workspace,
    validateReport: () => {
      validationCalls += 1;
      return [];
    },
  });

  assert.equal(validationCalls, 0);
  assert.deepEqual(state.interventionLedger, [intervention]);
  assert.equal(state.evidenceRef?.kind, "prior-harness-report");
  assert.equal(state.warning, null);
});

test("continuity also works when version metadata is absent", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "better-harness-learning-loop-state-v22-"));
  const reportDir = path.join(workspace, ".qoder", "better-harness", "2026-07-15", "120000-project");
  await mkdir(reportDir, { recursive: true });
  const intervention = pendingIntervention();
  await writeFile(path.join(reportDir, "findings.json"), JSON.stringify({
    summary: {
      projectName: path.basename(workspace),
      learningCapture: { interventions: projectInterventionLedger([intervention]).entries },
    },
  }), "utf8");

  const state = await loadPriorLearningCaptureState({
    workspace,
    validateReport: () => {
      throw new Error("missing version metadata must not call a whole-report validator");
    },
  });

  assert.deepEqual(state.interventionLedger, [intervention]);
  assert.equal(state.evidenceRef?.kind, "prior-harness-report");
  assert.equal(state.warning, null);
});

test("invalid or legacy reader projections do not become prior interventions", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "better-harness-learning-capture-state-invalid-"));
  const reportDir = path.join(workspace, ".qoder", "better-harness", "2026-07-12", "120000-project");
  await mkdir(reportDir, { recursive: true });
  await writeFile(path.join(reportDir, "findings.json"), JSON.stringify({
    summary: { learningCapture: { interventions: [{ id: "legacy-row" }] } },
  }), "utf8");

  assert.deepEqual(await loadPriorLearningCaptureState({ workspace }), {
    interventionLedger: [],
    evidenceRef: null,
    warning: { code: "invalid-prior-learning-capture-report" },
  });
});

test("the newest valid empty ledger retires older interventions without version routing", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "better-harness-learning-capture-state-retired-"));
  const root = path.join(workspace, ".qoder", "better-harness", "2026-07-12");
  const older = path.join(root, "110000-project");
  const newer = path.join(root, "120000-project");
  await mkdir(older, { recursive: true });
  await mkdir(newer, { recursive: true });
  const projectName = path.basename(workspace);
  await writeFile(path.join(older, "findings.json"), JSON.stringify({
    summary: { projectName, modelId: "agent-work-loop-v4", reportContractVersion: 22, learningCapture: { interventions: projectInterventionLedger([pendingIntervention()]).entries } },
  }), "utf8");
  await writeFile(path.join(newer, "findings.json"), JSON.stringify({
    summary: { projectName, modelId: "agent-work-loop-v4", reportContractVersion: 23, learningCapture: { interventions: [] } },
  }), "utf8");

  let validationCalls = 0;
  assert.deepEqual(await loadPriorLearningCaptureState({
    workspace,
    validateReport: () => {
      validationCalls += 1;
      return [];
    },
  }), {
    interventionLedger: [],
    evidenceRef: null,
    warning: null,
  });
  assert.equal(validationCalls, 0);
});

test("automatic discovery accepts the newest structurally valid ledger despite unrelated validator results", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "better-harness-learning-loop-state-skip-invalid-"));
  const root = path.join(workspace, ".qoder", "better-harness", "2026-07-15");
  const older = path.join(root, "110000-project", "findings.json");
  const newer = path.join(root, "120000-project", "findings.json");
  await mkdir(path.dirname(older), { recursive: true });
  await mkdir(path.dirname(newer), { recursive: true });
  const projectName = path.basename(workspace);
  await writeFile(older, JSON.stringify({
    summary: { projectName, modelId: "agent-work-loop-v4", reportContractVersion: 22, learningCapture: { interventions: projectInterventionLedger([pendingIntervention()]).entries } },
  }), "utf8");
  await writeFile(newer, JSON.stringify({
    summary: { projectName, modelId: "agent-work-loop-v4", reportContractVersion: 23, learningCapture: { interventions: [] } },
  }), "utf8");
  await utimes(older, new Date("2026-07-15T10:00:00Z"), new Date("2026-07-15T10:00:00Z"));
  await utimes(newer, new Date("2026-07-15T11:00:00Z"), new Date("2026-07-15T11:00:00Z"));

  const state = await loadPriorLearningCaptureState({
    workspace,
    validateReport: () => ["invalid v23 split"],
  });

  assert.equal(state.interventionLedger.length, 0);
  assert.equal(state.warning, null);
});

test("an explicit invalid or foreign report fails instead of silently falling back", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "better-harness-learning-capture-state-explicit-"));
  const explicit = path.join(workspace, "foreign-findings.json");
  await writeFile(explicit, JSON.stringify({
    summary: { projectName: "another-project", learningCapture: { interventions: [] } },
  }), "utf8");

  await assert.rejects(
    loadPriorLearningCaptureState({ workspace, previousFindings: explicit, validateReport: () => [] }),
    (error) => error?.code === "INVALID_PRIOR_LEARNING_CAPTURE_REPORT" && /project-mismatch/.test(error.message),
  );
});

test("an explicit field-scoped ledger is not rejected by an unrelated whole-report validator", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "better-harness-learning-loop-state-explicit-v23-"));
  const explicit = path.join(workspace, "findings.json");
  await writeFile(explicit, JSON.stringify({
    summary: {
      projectName: path.basename(workspace),
      modelId: "agent-work-loop-v4",
      reportContractVersion: 23,
      learningCapture: { interventions: [] },
    },
  }), "utf8");

  assert.deepEqual(await loadPriorLearningCaptureState({
    workspace,
    previousFindings: explicit,
    validateReport: () => ["invalid split"],
  }), {
    interventionLedger: [],
    evidenceRef: null,
    warning: null,
  });
});
