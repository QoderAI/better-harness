import assert from "node:assert/strict";
import { test } from "vitest";

import {
  applyEpisodeReviews,
  normalizeDeliveryReviews,
} from "../../scripts/harness-analysis/episode-evidence-review.mjs";

const ref = (id) => ({ kind: "fixture", id });

function source({ sameCheck = true } = {}) {
  return {
    taskEpisodes: [{
      id: "episode:1111111111111111",
      evidenceRefs: [ref("episode")],
      changeSets: [{
        id: "episode:1111111111111111:change-1",
        firstOrdinal: 1,
        lastOrdinal: 1,
        evidenceRefs: [ref("edit")],
      }],
      validationSets: [{
        id: "episode:1111111111111111:validation-1",
        ordinal: 0,
        status: "failed",
        checkIdentity: "check:failed",
        evidenceRefs: [ref("failure")],
      }, {
        id: "episode:1111111111111111:validation-2",
        ordinal: 2,
        status: "passed",
        checkIdentity: sameCheck ? "check:failed" : "check:equivalent",
        evidenceRefs: [ref("rerun")],
      }],
      closure: { status: "unobserved", evidenceRefs: [] },
      repair: {
        status: "review-required",
        candidates: [{
          id: "episode:1111111111111111:repair-1",
          failureValidationRef: "episode:1111111111111111:validation-1",
          rerunValidationRef: "episode:1111111111111111:validation-2",
          sameCheck,
          evidenceRefs: [ref("failure"), ref("edit"), ref("rerun")],
        }],
        evidenceRefs: [],
      },
    }],
  };
}

function episodeReview(overrides = {}) {
  return {
    episodeRef: "episode:1111111111111111",
    taskUnderstanding: ["goal-understanding", "relevant-context", "scope-boundary"].map((id) => ({
      id,
      state: "Exercised",
      summary: `${id} is bounded by the retained episode evidence`,
      evidenceRefs: [ref("episode")],
    })),
    validationAssociations: [{
      changeSetRef: "episode:1111111111111111:change-1",
      validationSetRef: "episode:1111111111111111:validation-2",
      relation: "relevant-after-change",
      summary: "The rerun validates the bounded change",
      evidenceRefs: [ref("rerun")],
    }],
    repairReview: {
      state: "repaired-and-passed",
      candidateRef: "episode:1111111111111111:repair-1",
      diagnosis: "The reviewed failure was reproduced and isolated before the bounded edit",
      reproductionEvidenceRefs: [ref("failure")],
      diagnosisEvidenceRefs: [ref("edit")],
    },
    ...overrides,
  };
}

test("episode review closes an associated validation and requires diagnosis before repair", () => {
  const input = source();
  applyEpisodeReviews(input, [episodeReview()]);
  const episode = input.taskEpisodes[0];

  assert.equal(episode.closure.status, "closed");
  assert.equal(episode.validationAssociations.length, 1);
  assert.equal(episode.repair.status, "repaired-and-passed");
  assert.equal(episode.repair.reason, "reviewed-diagnosis-and-same-check-rerun");
});

test("equivalent-check repair requires an explicit evidence-bound equivalence reason", () => {
  const input = source({ sameCheck: false });
  assert.throws(
    () => applyEpisodeReviews(input, [episodeReview()]),
    /equivalence requires a summary/u,
  );

  const reviewed = source({ sameCheck: false });
  applyEpisodeReviews(reviewed, [episodeReview({
    repairReview: {
      ...episodeReview().repairReview,
      equivalenceReason: "The focused rerun covers the same affected behavior with a narrower selector",
      equivalenceEvidenceRefs: [ref("rerun")],
    },
  })]);
  assert.equal(reviewed.taskEpisodes[0].repair.reason, "reviewed-diagnosis-and-equivalent-check-rerun");
});

test("delivery reviews are provider, episode, revision, and evidence bound", () => {
  const input = source();
  const revision = "a".repeat(40);
  const rows = normalizeDeliveryReviews(input, [{
    id: "ci-accepted",
    episodeRef: input.taskEpisodes[0].id,
    provider: "github",
    kind: "acceptance",
    level: "ci-accepted",
    status: "accepted",
    revision,
    summary: "The provider accepted the exact reviewed revision",
    evidenceRefs: [ref("ci")],
  }]);
  assert.equal(rows[0].revision, revision);
  assert.equal(rows[0].provider, "github");
  assert.throws(
    () => normalizeDeliveryReviews(input, [{ ...rows[0], revision: "short" }]),
    /requires a full revision digest/u,
  );
});
