import assert from "node:assert/strict";
import { test } from "vitest";

import {
  LEARNING_LOOP_CHECK_IDS,
  assertValidLearningLoopStateTuple,
  learningCaptureScoreCeiling,
  learningLoopStateErrors,
  projectLaterValidationState,
  projectLearningLoopState,
} from "../../scripts/harness-analysis/learning-loop-contract.mjs";

function tuple(detection, engineering, later, extras = {}) {
  return [
    { id: "lifecycle-repeat-detection", state: detection, ...extras.detection },
    { id: "loop-engineering", state: engineering, ...extras.engineering },
    { id: "later-validation", state: later, ...extras.later },
  ];
}

test("Learning Capture publishes the exact v4 supporting-check ids", () => {
  assert.deepEqual(LEARNING_LOOP_CHECK_IDS, [
    "lifecycle-repeat-detection",
    "loop-engineering",
    "later-validation",
  ]);
});

test("Learning Capture score ceilings follow durable-owner and later-outcome evidence", () => {
  assert.equal(learningCaptureScoreCeiling(tuple("Unobserved", "Unobserved", "Unobserved")), 59);
  assert.equal(learningCaptureScoreCeiling(tuple("Present", "Missing", "Unobserved")), 74);
  assert.equal(learningCaptureScoreCeiling(tuple("Wired", "Missing", "Unobserved")), 84);
  assert.equal(learningCaptureScoreCeiling(tuple("Exercised", "Missing", "Unobserved")), 59);
  assert.equal(learningCaptureScoreCeiling(tuple("Exercised", "Not applicable", "Not applicable")), 94);
  assert.equal(learningCaptureScoreCeiling(tuple("Exercised", "Present", "Missing")), 74);
  assert.equal(learningCaptureScoreCeiling(tuple("Exercised", "Wired", "Unobserved")), 84);
  assert.equal(learningCaptureScoreCeiling(tuple("Exercised", "Exercised", "Unobserved")), 74);
  assert.equal(learningCaptureScoreCeiling(tuple("Exercised", "Exercised", "Wired")), 84);
  assert.equal(learningCaptureScoreCeiling(tuple("Exercised", "Exercised", "Exercised")), 94);
  assert.equal(learningCaptureScoreCeiling(tuple("Exercised", "Exercised", "Outcome-supported")), 100);
});

test("Learning Capture accepts every supported dependency branch", () => {
  const valid = [
    tuple("Missing", "Missing", "Missing"),
    tuple("Unobserved", "Unobserved", "Unobserved"),
    tuple("Present", "Missing", "Unobserved"),
    tuple("Wired", "Missing", "Unobserved"),
    tuple("Exercised", "Missing", "Unobserved"),
    tuple("Exercised", "Unobserved", "Missing"),
    tuple("Exercised", "Not applicable", "Not applicable"),
    tuple("Exercised", "Not applicable", "Unobserved"),
    tuple("Exercised", "Present", "Missing"),
    tuple("Exercised", "Wired", "Unobserved"),
    tuple("Exercised", "Exercised", "Missing"),
    tuple("Exercised", "Exercised", "Unobserved"),
    tuple("Exercised", "Exercised", "Present"),
    tuple("Exercised", "Exercised", "Wired"),
    tuple("Exercised", "Exercised", "Exercised"),
    tuple("Exercised", "Exercised", "Outcome-supported"),
  ];
  for (const rows of valid) assert.deepEqual(learningLoopStateErrors(rows), []);
});

test("Learning Capture rejects unsupported states and incomplete check sets", () => {
  assert.ok(learningLoopStateErrors(tuple("Outcome-supported", "Missing", "Missing"))
    .some((error) => error.includes("lifecycle-repeat-detection.state is invalid")));
  assert.ok(learningLoopStateErrors(tuple("Exercised", "Outcome-supported", "Missing"))
    .some((error) => error.includes("loop-engineering.state is invalid")));
  assert.ok(learningLoopStateErrors(tuple("Exercised", "Exercised", "Retired"))
    .some((error) => error.includes("later-validation.state is invalid")));
  assert.ok(learningLoopStateErrors(tuple("Missing", "Missing", "Missing").slice(0, 2))
    .some((error) => error.includes("missing check: later-validation")));
  assert.ok(learningLoopStateErrors([
    ...tuple("Missing", "Missing", "Missing"),
    { id: "recurring-issue", state: "Exercised" },
  ]).some((error) => error.includes("unsupported check: recurring-issue")));
  assert.ok(learningLoopStateErrors([
    ...tuple("Missing", "Missing", "Missing"),
    { id: "loop-engineering", state: "Missing" },
  ]).some((error) => error.includes("duplicate check: loop-engineering")));
});

test("Learning Capture enforces supporting-check dependencies and the explicit no-candidate pair", () => {
  const invalid = [
    [tuple("Present", "Present", "Missing"), "loop-engineering requires lifecycle-repeat-detection"],
    [tuple("Wired", "Wired", "Missing"), "loop-engineering requires lifecycle-repeat-detection"],
    [tuple("Present", "Not applicable", "Not applicable"), "may be Not applicable only after lifecycle-repeat-detection"],
    [tuple("Exercised", "Present", "Present"), "later-validation requires loop-engineering"],
    [tuple("Exercised", "Wired", "Outcome-supported"), "later-validation requires loop-engineering"],
    [tuple("Exercised", "Exercised", "Not applicable"), "later-validation may be Not applicable only"],
    [tuple("Exercised", "Not applicable", "Missing"), "Not applicable without a ledger or Unobserved"],
  ];
  for (const [rows, message] of invalid) {
    const errors = learningLoopStateErrors(rows);
    assert.ok(errors.some((error) => error.includes(message)), `${JSON.stringify(rows)}: ${errors.join("; ")}`);
    assert.throws(
      () => assertValidLearningLoopStateTuple(rows),
      (error) => error?.code === "INVALID_LEARNING_LOOP_STATE_TUPLE",
    );
  }
});

test("Learning Capture keeps ledgers dormant until current Loop Engineering is Exercised", () => {
  const pending = [{ result: { state: "pending" }, comparisonWindow: { taskMix: "comparable" } }];
  assert.equal(projectLaterValidationState(pending, { loopEngineeringState: "Missing" }), "Unobserved");
  assert.deepEqual(learningLoopStateErrors(tuple("Exercised", "Missing", "Unobserved"), {
    interventionLedger: pending,
  }), []);
  assert.ok(learningLoopStateErrors(tuple("Exercised", "Missing", "Wired"), {
    interventionLedger: pending,
  }).some((error) => error.includes("must be Unobserved")));

  assert.deepEqual(learningLoopStateErrors(tuple("Exercised", "Not applicable", "Not applicable"), {
    interventionLedger: [],
  }), []);
  assert.ok(learningLoopStateErrors(tuple("Exercised", "Not applicable", "Unobserved"), {
    interventionLedger: [],
  }).some((error) => error.includes("must be Not applicable")));
  assert.deepEqual(learningLoopStateErrors(tuple("Exercised", "Not applicable", "Unobserved"), {
    interventionLedger: pending,
  }), []);
});

test("Learning Capture activates deterministic later-validation states after Loop Engineering is Exercised", () => {
  const pending = (taskMix) => ({ result: { state: "pending" }, comparisonWindow: { taskMix } });
  assert.equal(projectLaterValidationState([pending("unverified")], { loopEngineeringState: "Exercised" }), "Present");
  assert.equal(projectLaterValidationState([pending("not-comparable")], { loopEngineeringState: "Exercised" }), "Present");
  assert.equal(projectLaterValidationState([pending("comparable")], { loopEngineeringState: "Exercised" }), "Wired");
  assert.equal(projectLaterValidationState([{ result: { state: "improving" } }], { loopEngineeringState: "Exercised" }), "Exercised");
  assert.equal(projectLaterValidationState([{ result: { state: "unchanged" } }], { loopEngineeringState: "Exercised" }), "Exercised");
  assert.equal(projectLaterValidationState([{ result: { state: "outcome-supported" } }], { loopEngineeringState: "Exercised" }), "Outcome-supported");
  assert.equal(projectLaterValidationState([
    { result: { state: "outcome-supported" } },
    { result: { state: "regressing" } },
  ], { loopEngineeringState: "Exercised" }), "Exercised");

  assert.deepEqual(learningLoopStateErrors(tuple("Exercised", "Exercised", "Wired"), {
    interventionLedger: [pending("comparable")],
  }), []);
  assert.ok(learningLoopStateErrors(tuple("Exercised", "Exercised", "Present"), {
    interventionLedger: [pending("comparable")],
  }).some((error) => error.includes("must be Wired")));
  assert.ok(learningLoopStateErrors(tuple("Exercised", "Exercised", "Present"), {
    interventionLedger: [],
  }).some((error) => error.includes("requires a retained intervention ledger")));
});

test("Learning Capture projection reports the aggregate evidence state", () => {
  assert.deepEqual(projectLearningLoopState(tuple("Unobserved", "Unobserved", "Unobserved")), {
    state: "Unobserved",
    level: null,
  });
  assert.deepEqual(projectLearningLoopState(tuple("Exercised", "Not applicable", "Not applicable")), {
    state: "Exercised",
    level: "Exercised",
  });
  assert.deepEqual(projectLearningLoopState(tuple("Exercised", "Missing", "Unobserved")), {
    state: "Exercised",
    level: "Exercised",
  });
  assert.deepEqual(projectLearningLoopState(tuple("Exercised", "Exercised", "Wired")), {
    state: "Exercised",
    level: "Exercised",
  });
  assert.deepEqual(projectLearningLoopState(tuple("Exercised", "Exercised", "Outcome-supported")), {
    state: "Outcome-supported",
    level: "Outcome-supported",
  });
});

test("Learning Capture state validation is independent of the first four scores", () => {
  const states = {
    "lifecycle-repeat-detection": { state: "Exercised" },
    "loop-engineering": { state: "Exercised" },
    "later-validation": { state: "Present" },
    currentTaskScores: [0, 0, 0, 0],
  };
  assert.deepEqual(learningLoopStateErrors(states), []);
  assert.deepEqual(projectLearningLoopState(states), {
    state: "Exercised",
    level: "Exercised",
  });
  states.currentTaskScores = [100, 100, 100, 100];
  assert.deepEqual(learningLoopStateErrors(states), []);
  assert.equal(projectLearningLoopState(states).state, "Exercised");
});
