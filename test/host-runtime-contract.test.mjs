import assert from "node:assert/strict";
import { test } from "vitest";

import {
  createRunPlan,
  hashJson,
  SPECIALIST_LANES,
  verifyRunResults,
} from "../scripts/harness-analysis/host-runtime/contract.mjs";

function makeBundle(depth = "normal") {
  return {
    kind: "better-harness.evidence-bundle",
    context: {
      provider: "pi",
      depth,
      workspace: "/tmp/better-harness-fixture",
    },
    lanes: {
      sessionEvidence: { status: "available", data: { owner: "session", count: 1 } },
      projectHarness: { status: "available", data: { owner: "project", count: 2 } },
      agentCustomize: { status: "available", data: { owner: "agent", count: 3 } },
    },
    lead: { status: "available", data: { summary: "bounded" } },
    diagnostics: { coverage: { pi: "observed" } },
  };
}

function completeResults(plan, overrides = {}) {
  return SPECIALIST_LANES.map((lane, index) => ({
    lane,
    contextId: `pi-child-${index + 1}`,
    status: overrides[lane]?.status ?? "completed",
    inputHash: plan.lanes[lane].inputHash,
    output: overrides[lane]?.output ?? { lane, findingCount: index },
  }));
}

test("HRC-AC-01 creates exactly three independently hashed lanes", () => {
  const plan = createRunPlan(makeBundle());

  assert.deepEqual(plan.expected.laneNames, ["sessionEvidence", "projectHarness", "agentCustomize"]);
  assert.equal(plan.expected.laneCount, 3);
  assert.equal(Object.keys(plan.lanes).length, 3);
  assert.equal(new Set(Object.values(plan.lanes).map((lane) => lane.inputHash)).size, 3);
  for (const lane of SPECIALIST_LANES) {
    assert.equal(plan.lanes[lane].inputHash, hashJson(plan.lanes[lane].input));
  }
});

test("HRC-AC-02 accepts three distinct structured specialist results", () => {
  const plan = createRunPlan(makeBundle());
  const verified = verifyRunResults(plan, completeResults(plan));

  assert.equal(verified.ok, true);
  assert.equal(verified.results.length, 3);
  assert.equal(verified.diagnostics.observedContextCount, 3);
  assert.deepEqual(verified.diagnostics.errors, []);
});

test("HRC-AC-02 keeps valid results after an earlier malformed result", () => {
  const plan = createRunPlan(makeBundle());
  const results = completeResults(plan);
  results[0].output = "not an object";

  const verified = verifyRunResults(plan, results);

  assert.equal(verified.ok, false);
  assert.equal(verified.results.length, 2);
  assert.deepEqual(verified.results.map((result) => result.lane), ["projectHarness", "agentCustomize"]);
  assert.ok(verified.diagnostics.errors.some((error) => error.code === "INVALID_SPECIALIST_OUTPUT"));
});

test("HRC-AC-02 rejects duplicate contexts, duplicate lanes, and hash drift", () => {
  const plan = createRunPlan(makeBundle());
  const results = completeResults(plan);
  results[1].contextId = results[0].contextId;
  results[2].lane = results[1].lane;
  results[2].inputHash = "wrong";

  const verified = verifyRunResults(plan, results);
  const codes = new Set(verified.diagnostics.errors.map((error) => error.code));

  assert.equal(verified.ok, false);
  assert.ok(codes.has("DUPLICATE_SPECIALIST_CONTEXT"));
  assert.ok(codes.has("DUPLICATE_SPECIALIST_LANE"));
  assert.ok(codes.has("SPECIALIST_INPUT_HASH_MISMATCH"));
  assert.ok(codes.has("MISSING_SPECIALIST_LANE"));
});

test("HRC-AC-02 rejects raw runtime fields in lanes and specialist output", () => {
  assert.throws(
    () => createRunPlan({
      ...makeBundle(),
      lanes: {
        ...makeBundle().lanes,
        sessionEvidence: { status: "available", data: { rawSession: "secret" } },
      },
    }),
    /forbidden runtime fields/u,
  );

  const plan = createRunPlan(makeBundle());
  const results = completeResults(plan);
  results[0].output = { credential: "secret" };
  const verified = verifyRunResults(plan, results);
  assert.equal(verified.ok, false);
  assert.ok(verified.diagnostics.errors.some((error) => error.code === "FORBIDDEN_SPECIALIST_FIELDS"));
});

test("HRC-AC-03 blocks partial normal runs but preserves quick gaps", () => {
  const normalPlan = createRunPlan(makeBundle("normal"));
  const normal = verifyRunResults(normalPlan, completeResults(normalPlan, {
    projectHarness: { status: "partial" },
  }));
  assert.equal(normal.ok, false);
  assert.deepEqual(normal.diagnostics.incompleteLanes, ["projectHarness"]);
  assert.equal(normal.diagnostics.confidence, "low");

  const quickPlan = createRunPlan(makeBundle("quick"));
  const quick = verifyRunResults(quickPlan, completeResults(quickPlan, {
    projectHarness: { status: "partial" },
  }));
  assert.equal(quick.ok, true);
  assert.deepEqual(quick.diagnostics.incompleteLanes, ["projectHarness"]);
  assert.equal(quick.diagnostics.confidence, "low");
});

test("HRC-AC-03 rejects missing lanes even in quick mode", () => {
  const plan = createRunPlan(makeBundle("quick"));
  const results = completeResults(plan).slice(0, 2);
  const verified = verifyRunResults(plan, results);

  assert.equal(verified.ok, false);
  assert.ok(verified.diagnostics.errors.some((error) => error.code === "SPECIALIST_COUNT_MISMATCH"));
  assert.ok(verified.diagnostics.errors.some((error) => error.code === "MISSING_SPECIALIST_LANE"));
});
