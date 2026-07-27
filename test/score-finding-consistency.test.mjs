import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_WORK_LOOP_CURRENT_TASK_DIMENSION_IDS,
} from "../scripts/harness-analysis/fluency-dimensions.mjs";
import {
  AGENT_WORK_LOOP_LOW_SCORE_FINDING_THRESHOLD,
  lowScoreFindingConsistencyErrors,
} from "../scripts/harness-analysis/score-finding-consistency.mjs";

function dimension({ id = "task-understanding", score = 70, findingRefs = [] } = {}) {
  return { id, score, findingRefs };
}

function finding({ id = "task-gap", dimensionRefs = ["task-understanding"] } = {}) {
  return { id, dimensionRefs };
}

function currentTaskConsistencyErrors(dimensions, findings) {
  return lowScoreFindingConsistencyErrors(dimensions, findings, {
    applicableDimensionIds: AGENT_WORK_LOOP_CURRENT_TASK_DIMENSION_IDS,
  });
}

test("derives current-task ids from dimension metadata", () => {
  assert.deepEqual(AGENT_WORK_LOOP_CURRENT_TASK_DIMENSION_IDS, [
    "task-understanding",
    "controlled-execution",
    "change-validation",
    "reliable-delivery",
  ]);
});

test("uses the existing Canvas threshold and accepts 70 without findings", () => {
  assert.equal(AGENT_WORK_LOOP_LOW_SCORE_FINDING_THRESHOLD, 70);
  assert.deepEqual(lowScoreFindingConsistencyErrors([dimension()], []), []);
});

test("accepts 69 only with a bidirectional finding link", () => {
  assert.deepEqual(lowScoreFindingConsistencyErrors([
    dimension({ score: 69, findingRefs: ["task-gap"] }),
  ], [finding()]), []);
});

test("rejects a low score without a finding link", () => {
  const errors = lowScoreFindingConsistencyErrors([dimension({ score: 64 })], []);
  assert.ok(errors.some((error) => /task-understanding score 64 is below 70/.test(error)));
});

test("allows an explicit owner policy to retain an unlinked low-confidence score", () => {
  const lowConfidence = { ...dimension({ score: 64 }), scoreConfidence: "low" };
  assert.deepEqual(lowScoreFindingConsistencyErrors([lowConfidence], [], {
    allowUnlinkedLowScore: (row) => row.scoreConfidence === "low",
  }), []);
  assert.equal(lowScoreFindingConsistencyErrors([dimension({ score: 64 })], [], {
    allowUnlinkedLowScore: () => false,
  }).length, 1);
});

test("rejects unknown and one-way finding links", () => {
  const unknown = lowScoreFindingConsistencyErrors([
    dimension({ score: 69, findingRefs: ["missing-gap"] }),
  ], [finding()]);
  assert.ok(unknown.some((error) => /requires at least one linked finding/.test(error)));

  const oneWay = lowScoreFindingConsistencyErrors([
    dimension({ score: 69, findingRefs: ["task-gap"] }),
  ], [finding({ dimensionRefs: ["controlled-execution"] })]);
  assert.ok(oneWay.some((error) => /links back to task-understanding/.test(error)));
});

test("exempts cross-window Learning Capture scores from the current-task gate", () => {
  const errors = currentTaskConsistencyErrors([
    dimension({ id: "learning-capture", score: 0 }),
  ], []);
  assert.deepEqual(errors, []);
});

test("keeps current-task dimensions gated when Learning Capture is exempt", () => {
  const errors = currentTaskConsistencyErrors([
    dimension({ id: "task-understanding", score: 64 }),
    dimension({ id: "learning-capture", score: 0 }),
  ], []);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /task-understanding score 64 is below 70/);
});

test("omitted or invalid applicability remains fail-closed", () => {
  const dimensions = [dimension({ id: "learning-capture", score: 0 })];
  assert.equal(lowScoreFindingConsistencyErrors(dimensions, []).length, 1);
  assert.equal(lowScoreFindingConsistencyErrors(dimensions, [], {
    applicableDimensionIds: "learning-capture",
  }).length, 1);
});
