import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLearningLoopReview,
  validateLearningLoopReview,
} from "../scripts/harness-analysis/learning-loop-candidates.mjs";

function episode(id, signal) {
  return {
    id,
    targetKeys: ["target-a"],
    changeSets: [{ id: `${id}:change-1` }],
    closure: { status: "closed" },
    elapsedMs: 60_000,
    toolCalls: 4,
    learningSignals: [{
      taskFamily: "repository-review",
      repoArea: "review-route",
      normalizedSignature: "review-route-generated-files",
      validationResult: "closed",
      fieldProvenance: {
        taskFamily: "ai-reviewed",
        repoArea: "ai-reviewed",
        normalizedSignature: "ai-reviewed",
      },
      evidenceRefs: [{ kind: "fixture", id: `${id}-signal` }],
      ...signal,
    }],
  };
}

test("recurring corrections become an opportunity only after two independent episodes", () => {
  const one = buildLearningLoopReview({
    episodes: [episode("episode:one", {
      patternId: "recurring-correction",
      frictionType: "user-correction",
      userCorrection: true,
    })],
  });
  assert.equal(one.candidates.length, 0);
  assert.equal(one.coverage.patternDetection, "insufficient-episodes");

  const two = buildLearningLoopReview({
    episodes: [
      episode("episode:one", { patternId: "recurring-correction", frictionType: "user-correction", userCorrection: true }),
      episode("episode:two", { patternId: "recurring-correction", frictionType: "user-correction", userCorrection: true }),
    ],
  });
  assert.equal(two.candidates.length, 1);
  assert.equal(two.candidates[0].claimType, "opportunity");
  assert.equal(two.candidates[0].brokenStage, "generalize");
  assert.equal(two.candidates[0].recommendedOwner, "Rule");
  assert.equal(two.candidates[0].confidence, "high");
  assert.deepEqual(two.candidates[0].sourceEpisodes, ["episode:one", "episode:two"]);
  assert.equal(two.coverage.patternDetection, "candidate-found");
  assert.deepEqual(validateLearningLoopReview(two, { episodeIds: ["episode:one", "episode:two"] }), []);
});

test("repeated rediscovery routes procedural work to Skill and semantic knowledge to Memory", () => {
  const procedural = buildLearningLoopReview({
    episodes: [
      episode("episode:a", { patternId: "repeated-rediscovery", frictionType: "repeated-rediscovery", procedural: true }),
      episode("episode:b", { patternId: "repeated-rediscovery", frictionType: "repeated-rediscovery", procedural: true }),
    ],
  });
  assert.equal(procedural.candidates[0].recommendedOwner, "Skill");

  const semantic = buildLearningLoopReview({
    episodes: [
      episode("episode:a", { patternId: "repeated-rediscovery", frictionType: "repeated-rediscovery" }),
      episode("episode:b", { patternId: "repeated-rediscovery", frictionType: "repeated-rediscovery" }),
    ],
  });
  assert.equal(semantic.candidates[0].recommendedOwner, "Memory");
});

test("inventory without invocation evidence stays not evaluable instead of becoming a routing gap", () => {
  const review = buildLearningLoopReview({
    episodes: [episode("episode:one", {})],
    signals: { configuredSkills: ["skills/review/SKILL.md"], memories: [] },
  });
  assert.equal(review.candidates.some((candidate) => candidate.patternId === "present-but-not-routed"), false);
  assert.equal(review.coverage.routing, "not-evaluable-missing-invocation-events");
});

test("apparent reads and asset loads do not overclaim routed application", () => {
  const apparentRead = buildLearningLoopReview({
    episodes: [episode("episode:read", {})],
    signals: { apparentSkillReads: [{ name: "review", count: 1 }] },
  });
  assert.equal(apparentRead.coverage.routing, "not-evaluable-missing-invocation-events");

  const loadedOnly = buildLearningLoopReview({
    episodes: [episode("episode:loaded", {
      assetLoaded: true,
      assetRelevant: true,
      requiredStepApplied: false,
    })],
  });
  assert.equal(loadedOnly.coverage.routing, "checked-clean");
  assert.equal(loadedOnly.coverage.application, "not-evaluable-missing-application-events");
});

test("explicit routing and application evidence produce separate candidates", () => {
  const routing = buildLearningLoopReview({
    episodes: [episode("episode:route", {
      patternId: "present-but-not-routed",
      frictionType: "routing-miss",
      assetRelevant: true,
      assetLoaded: false,
    })],
  });
  assert.equal(routing.candidates[0].patternId, "present-but-not-routed");
  assert.equal(routing.candidates[0].brokenStage, "route");

  const application = buildLearningLoopReview({
    episodes: [episode("episode:apply", {
      patternId: "routed-but-not-applied",
      frictionType: "application-miss",
      assetRelevant: true,
      assetLoaded: true,
      requiredStepApplied: false,
    })],
  });
  assert.equal(application.candidates[0].patternId, "routed-but-not-applied");
  assert.equal(application.candidates[0].brokenStage, "exercise");
});

test("memory staleness and mandatory optional guidance are readiness gaps", () => {
  const review = buildLearningLoopReview({
    episodes: [
      episode("episode:memory", {
        patternId: "stale-or-conflicting-memory",
        frictionType: "memory-conflict",
      }),
      episode("episode:owner", {
        patternId: "wrong-durable-owner",
        frictionType: "optional-invariant",
        mandatory: true,
      }),
    ],
  });
  const stale = review.candidates.find((candidate) => candidate.patternId === "stale-or-conflicting-memory");
  const owner = review.candidates.find((candidate) => candidate.patternId === "wrong-durable-owner");
  assert.equal(stale.claimType, "readiness");
  assert.equal(stale.recommendedOwner, "Memory");
  assert.equal(owner.claimType, "readiness");
  assert.equal(owner.recommendedOwner, "Gate");
});

test("cross-asset freshness keeps a redacted asset reference and does not infer coverage from a scan", () => {
  const review = buildLearningLoopReview({
    episodes: [episode("episode:asset", {
      patternId: "stale-or-conflicting-asset",
      frictionType: "stale-rule",
      asset: {
        kind: "Rule",
        ref: "rule:deployment-boundary",
        scope: "project",
        currentTruthRefs: [{ kind: "spec", id: "deployment-boundary" }],
      },
    })],
    assetCoverage: [{ surface: "Rules", count: 1 }],
  });
  assert.equal(review.coverage.assetCoverage, "checked-clean");
  assert.equal(review.coverage.freshness, "candidate-found");
  assert.equal(review.candidates[0].patternId, "stale-or-conflicting-asset");
  assert.deepEqual(review.candidates[0].asset, {
    kind: "Rule",
    ref: "rule:deployment-boundary",
    scope: "project",
    currentTruthRefs: [{ kind: "spec", id: "deployment-boundary" }],
    requiredStepRefs: [],
    updateEvidenceRefs: [],
    outcomeEvidenceRefs: [],
  });
});

test("pending interventions create Eval readiness without claiming effectiveness", () => {
  const review = buildLearningLoopReview({
    interventions: [{
      id: "review-skill-trial",
      frictionRefs: [{ kind: "fixture", id: "review-friction" }],
      primaryMetric: { id: "review-rework" },
      guardrailMetric: { id: "false-trigger-rate" },
      stopOrRevertCondition: "Revert when false triggers increase.",
      result: { state: "pending" },
    }],
  });
  assert.equal(review.candidates[0].patternId, "unvalidated-intervention");
  assert.equal(review.candidates[0].claimType, "readiness");
  assert.equal(review.candidates[0].recommendedOwner, "Eval");
  assert.equal(review.coverage.effectiveness, "pending-no-later-window");
});

test("protective blocks are a negative control and field provenance remains explicit", () => {
  const review = buildLearningLoopReview({
    episodes: [episode("episode:block", {
      patternId: "recurring-correction",
      frictionType: "protective-intervention",
      userCorrection: true,
    })],
  });
  assert.equal(review.candidates.length, 0);
  const fieldEvidence = review.episodeRecords[0].signals[0].fieldEvidence;
  assert.equal(fieldEvidence.taskFamily.provenance, "ai-reviewed");
  assert.equal(fieldEvidence.validationResult.provenance, "deterministic-derived");
  assert.equal(fieldEvidence.tokens.coverage, "unavailable");
});
