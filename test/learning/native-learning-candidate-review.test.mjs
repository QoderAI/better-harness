import assert from "node:assert/strict";
import { test } from "vitest";

import {
  applyNativeLearningCandidateReview,
  buildLearningLoopReview,
  buildNativeLearningReviewPacket,
  validateNativeLearningCandidateReview,
  validateLearningLoopReview,
} from "../../scripts/harness-analysis/learning-loop-candidates.mjs";
import { buildTaskEpisodes } from "../../scripts/session-analysis/episode-contract.mjs";

function event({
  sessionId,
  timestamp,
  toolName,
  filePath,
  commandText,
  targetPaths,
  success,
  evidenceId,
  ...rest
}) {
  return {
    sessionId,
    timestamp,
    type: toolName ? "tool" : "user",
    toolName,
    filePath,
    commandText,
    validationCategory: commandText ? "node --test" : undefined,
    targetPaths,
    success,
    evidenceRef: { kind: "fixture", id: evidenceId },
    ...rest,
  };
}

function repairEvents(sessionId, minute, suffix = "a") {
  const base = "2026-08-01T10:" + String(minute).padStart(2, "0");
  const commandText = "node --test test/shared.test.mjs";
  return [
    event({
      sessionId,
      timestamp: base + ":00.000Z",
      toolName: "Bash",
      commandText,
      targetPaths: ["src/shared.mjs"],
      success: false,
      evidenceId: suffix + "-failure",
    }),
    event({
      sessionId,
      timestamp: base + ":01.000Z",
      toolName: "Edit",
      filePath: "src/shared.mjs",
      evidenceId: suffix + "-edit",
    }),
    event({
      sessionId,
      timestamp: base + ":02.000Z",
      toolName: "Bash",
      commandText,
      targetPaths: ["src/shared.mjs"],
      success: true,
      evidenceId: suffix + "-rerun",
    }),
  ];
}

function ordinaryRepairEpisodes() {
  const episodes = buildTaskEpisodes([
    ...repairEvents("session-a", 0, "a"),
    ...repairEvents("session-b", 5, "b"),
  ]).episodes;
  assert.equal(episodes.length, 2);
  assert.equal(episodes.every((episode) => episode.learningSignals.length === 0), true);
  assert.equal(episodes.every((episode) => episode.repair.candidates.some((candidate) => candidate.sameCheck)), true);
  return episodes;
}

function matchingReview(packet, overrides = {}) {
  return {
    schemaVersion: 1,
    sourceDigest: packet.sourceDigest,
    packetDigest: packet.packetDigest,
    decisions: packet.groups.map((group) => ({
      groupRef: group.groupRef,
      decision: "match",
      patternId: "recurring-correction",
      episodeRefs: [...group.episodeRefs],
      evidenceRefs: [...group.evidenceRefs],
      reasonCodes: [...group.reasonCodes],
      ...overrides,
    })),
  };
}

test("ordinary failure-edit-same-check-rerun Episodes produce a reviewed recurring-correction opportunity", () => {
  const episodes = ordinaryRepairEpisodes();
  const packet = buildNativeLearningReviewPacket({ episodes });
  assert.equal(packet.groups.length, 1);
  assert.deepEqual(packet.groups[0].allowedPatternIds, ["recurring-correction"]);
  assert.ok(packet.groups[0].reasonCodes.includes("same-check"));
  assert.ok(packet.groups[0].reasonCodes.includes("same-check-repair"));

  const review = matchingReview(packet);
  const applied = applyNativeLearningCandidateReview({ episodes, packet, review });
  assert.deepEqual(applied.errors, []);
  assert.equal(applied.result.matches.length, 1);
  assert.equal(applied.result.matches[0].claimType, "opportunity");
  assert.equal(applied.result.learningLoop.candidates.length, 1);
  assert.equal(applied.result.learningLoop.candidates[0].patternId, "recurring-correction");
  assert.equal(applied.result.learningLoop.candidates[0].claimType, "opportunity");
  assert.deepEqual(
    validateLearningLoopReview(applied.result.learningLoop, { episodeIds: episodes.map((episode) => episode.id) }),
    [],
  );
  assert.deepEqual(
    applied.result.learningLoop.candidates[0].sourceEpisodes.slice().sort(),
    episodes.map((episode) => episode.id).sort(),
  );
  assert.equal(
    applied.result.learningLoop.episodeRecords.every((episode) =>
      episode.signals[0].fieldEvidence.frictionType.provenance === "ai-reviewed"),
    true,
  );
  assert.equal(
    applied.result.learningLoop.episodeRecords.every((episode) =>
      episode.signals[0].fieldEvidence.normalizedSignature.provenance === "deterministic-derived"
      && episode.signals[0].fieldEvidence.userCorrection.coverage === "unavailable"),
    true,
  );
  for (const episode of applied.result.learningLoop.episodeRecords) {
    const owned = new Set(packet.groups[0].evidenceOwnership[episode.episodeId]);
    assert.equal(episode.signals[0].evidenceRefs.every((reference) => owned.has(reference.id)), true);
  }
  assert.equal(applied.result.learningLoop.candidates.some((candidate) => candidate.claimType === "effectiveness"), false);
  assert.equal(applied.result.learningLoop.coverage.effectiveness, "pending-no-later-window");
});

test("three comparable Episodes merge into one stable pattern candidate", () => {
  const twoEpisodes = ordinaryRepairEpisodes();
  const threeEpisodes = buildTaskEpisodes([
    ...repairEvents("session-a", 0, "a"),
    ...repairEvents("session-b", 5, "b"),
    ...repairEvents("session-c", 10, "c"),
  ]).episodes;
  const twoPacket = buildNativeLearningReviewPacket({ episodes: twoEpisodes });
  const threePacket = buildNativeLearningReviewPacket({ episodes: threeEpisodes });
  assert.equal(threePacket.groups.length, 1);
  assert.equal(threePacket.groups[0].episodeRefs.length, 3);
  assert.equal(threePacket.groups[0].patternSignature, twoPacket.groups[0].patternSignature);
  assert.deepEqual(
    buildNativeLearningReviewPacket({ episodes: structuredClone(threeEpisodes).reverse() }),
    threePacket,
  );
  const applied = applyNativeLearningCandidateReview({
    episodes: threeEpisodes,
    packet: threePacket,
    review: matchingReview(threePacket),
  });
  assert.deepEqual(applied.errors, []);
  assert.equal(applied.result.learningLoop.candidates.length, 1);
  assert.equal(applied.result.learningLoop.candidates[0].sourceEpisodes.length, 3);
  assert.equal(
    applied.result.learningLoop.candidates[0].normalizedSignature,
    twoPacket.groups[0].patternSignature,
  );
});

test("same failure without a shared task, target, or check identity is a hard negative", () => {
  const left = repairEvents("session-left", 0, "left");
  const right = repairEvents("session-right", 5, "right").map((row) => ({
    ...row,
    commandText: row.commandText?.replace("shared", "other"),
    targetPaths: row.targetPaths?.map((target) => target.replace("shared", "other")),
    filePath: row.filePath?.replace("shared", "other"),
  }));
  const episodes = buildTaskEpisodes([...left, ...right]).episodes;
  const packet = buildNativeLearningReviewPacket({ episodes });
  assert.equal(packet.groups.length, 0);
  assert.equal(packet.coverage.status, "insufficient-comparability");
  assert.ok(packet.coverage.reasonCodes.includes("no-comparable-group"));
});

test("single Episodes and protective permission or Hook denials cannot form native friction groups", () => {
  const episodes = ordinaryRepairEpisodes();
  const single = buildNativeLearningReviewPacket({ episodes: [episodes[0]] });
  assert.equal(single.groups.length, 0);
  assert.equal(single.coverage.status, "insufficient-episodes");

  const protectedEpisodes = structuredClone(episodes);
  protectedEpisodes[0].permissionSummary = {
    denied: 1,
    protectedActions: 1,
    evidenceRefs: [{ kind: "permission", id: "bounded-denial" }],
  };
  const packet = buildNativeLearningReviewPacket({ episodes: protectedEpisodes });
  assert.equal(packet.groups.length, 0);
  assert.equal(packet.coverage.protectiveEpisodeCount, 1);
  assert.ok(packet.coverage.reasonCodes.includes("protective-intervention-excluded"));

  const hookEpisodes = buildTaskEpisodes([
    ...repairEvents("session-hook", 0, "hook"),
    event({
      sessionId: "session-hook",
      timestamp: "2026-08-01T10:00:03.000Z",
      toolName: "Guardrail",
      success: false,
      hookDecision: "blocked",
      protectionOutcome: "blocked",
      evidenceId: "hook-blocked",
    }),
    ...repairEvents("session-peer", 5, "peer"),
  ]).episodes;
  assert.equal(hookEpisodes.some((episode) => episode.protectiveInterventionObserved === true), true);
  const hookPacket = buildNativeLearningReviewPacket({ episodes: hookEpisodes });
  assert.equal(hookPacket.groups.length, 0);
  assert.equal(hookPacket.coverage.protectiveEpisodeCount, 1);
});

test("review binding rejects invented refs, unknown patterns, missing decisions, and unowned evidence", () => {
  const episodes = ordinaryRepairEpisodes();
  const packet = buildNativeLearningReviewPacket({ episodes });
  const valid = matchingReview(packet);
  assert.deepEqual(validateNativeLearningCandidateReview({ episodes, packet, review: valid }), []);

  const inventedEvidence = structuredClone(valid);
  inventedEvidence.decisions[0].evidenceRefs.push("evidence-ref:invented");
  assert.ok(validateNativeLearningCandidateReview({ episodes, packet, review: inventedEvidence })
    .some((error) => error.includes("outside the packet allowlist")));

  const unknownPattern = structuredClone(valid);
  unknownPattern.decisions[0].patternId = "repeated-rediscovery";
  assert.ok(validateNativeLearningCandidateReview({ episodes, packet, review: unknownPattern })
    .some((error) => error.includes("not allowed")));

  const missingDecision = { ...valid, decisions: [] };
  assert.ok(validateNativeLearningCandidateReview({ episodes, packet, review: missingDecision })
    .some((error) => error.includes("exactly one decision")));

  const oneEpisodeEvidence = structuredClone(valid);
  const group = packet.groups[0];
  oneEpisodeEvidence.decisions[0].evidenceRefs = [...group.evidenceOwnership[group.episodeRefs[0]]];
  assert.ok(validateNativeLearningCandidateReview({ episodes, packet, review: oneEpisodeEvidence })
    .some((error) => error.includes("requires evidence owned by")));
});

test("an explicit abstention remains evidence-safe and does not create a candidate", () => {
  const episodes = ordinaryRepairEpisodes();
  const packet = buildNativeLearningReviewPacket({ episodes });
  const review = {
    schemaVersion: 1,
    sourceDigest: packet.sourceDigest,
    packetDigest: packet.packetDigest,
    decisions: [{
      groupRef: packet.groups[0].groupRef,
      decision: "abstain",
      reasonCodes: ["insufficient-comparability"],
    }],
  };
  const applied = applyNativeLearningCandidateReview({ episodes, packet, review });
  assert.deepEqual(applied.errors, []);
  assert.equal(applied.result.matches.length, 0);
  assert.equal(applied.result.abstentions.length, 1);
  assert.equal(applied.result.learningLoop.candidates.length, 0);
  assert.equal(applied.result.coverage.abstainedGroupCount, 1);

  const nonArrayRefs = structuredClone(review);
  nonArrayRefs.decisions[0].episodeRefs = "";
  nonArrayRefs.decisions[0].evidenceRefs = "evidence-ref:not-an-array";
  const errors = validateNativeLearningCandidateReview({ episodes, packet, review: nonArrayRefs });
  assert.ok(errors.some((error) => error.includes("episodeRefs must be an array")));
  assert.ok(errors.some((error) => error.includes("evidenceRefs must be an array")));
});

test("evidence aliases bind safe source ids without exposing them and stale reviews fail closed", () => {
  const episodes = ordinaryRepairEpisodes();
  const packet = buildNativeLearningReviewPacket({ episodes });
  const review = matchingReview(packet);
  const changed = structuredClone(episodes);
  const replaceEvidenceId = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) replaceEvidenceId(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (value.kind === "fixture" && value.id === "a-failure") value.id = "a-failure-v2";
    for (const child of Object.values(value)) replaceEvidenceId(child);
  };
  replaceEvidenceId(changed[0]);
  const changedPacket = buildNativeLearningReviewPacket({ episodes: changed });
  assert.notEqual(changedPacket.sourceDigest, packet.sourceDigest);
  assert.notDeepEqual(changedPacket.episodeFacts, packet.episodeFacts);
  const stale = applyNativeLearningCandidateReview({ episodes: changed, packet, review });
  assert.equal(stale.result, null);
  assert.ok(stale.errors.some((error) => error.includes("privacy-safe source projection")));
  const serialized = JSON.stringify(changedPacket);
  assert.equal(serialized.includes("a-failure"), false);
  assert.equal(serialized.includes("a-failure-v2"), false);
});

test("evidence binding covers safe identities beyond the displayed evidence limit", () => {
  const episodes = ordinaryRepairEpisodes();
  episodes[0].evidenceRefs = [];
  for (const change of episodes[0].changeSets) change.evidenceRefs = [];
  for (const validation of episodes[0].validationSets) validation.evidenceRefs = [];
  episodes[0].closure.evidenceRefs = [];
  episodes[0].repair.evidenceRefs = [];
  for (const candidate of episodes[0].repair.candidates) candidate.evidenceRefs = [];
  episodes[0].learningSignals = [];
  for (let index = 1; index <= 13; index += 1) {
    episodes[0].evidenceRefs.push({
      kind: "fixture",
      id: `zz-overflow-${String(index).padStart(2, "0")}`,
    });
  }
  const packet = buildNativeLearningReviewPacket({ episodes });
  const review = matchingReview(packet);
  const changed = structuredClone(episodes);
  changed[0].evidenceRefs.find((reference) => reference.id === "zz-overflow-13").id = "zz-overflow-99";
  const changedPacket = buildNativeLearningReviewPacket({ episodes: changed });

  assert.equal(packet.episodeFacts[0].evidenceCoverage.includedCount, 12);
  assert.equal(packet.episodeFacts[0].evidenceCoverage.totalCount, 13);
  assert.equal(packet.episodeFacts[0].evidenceCoverage.status, "truncated");
  assert.deepEqual(changedPacket.episodeFacts[0].evidenceRefs, packet.episodeFacts[0].evidenceRefs);
  assert.notEqual(
    changedPacket.episodeFacts[0].evidenceCoverage.identitySetDigest,
    packet.episodeFacts[0].evidenceCoverage.identitySetDigest,
  );
  assert.notEqual(changedPacket.sourceDigest, packet.sourceDigest);
  const stale = applyNativeLearningCandidateReview({ episodes: changed, packet, review });
  assert.equal(stale.result, null);
  assert.ok(stale.errors.some((error) => error.includes("privacy-safe source projection")));
  assert.equal(JSON.stringify(changedPacket).includes("zz-overflow-99"), false);
});

test("mixed explicit and repair corrections keep separate friction bases and member observations", () => {
  const episodes = buildTaskEpisodes([
    ...repairEvents("session-a", 0, "a"),
    ...repairEvents("session-b", 5, "b"),
    ...repairEvents("session-c", 10, "c"),
  ]).episodes;
  episodes[0].repair.candidates = [];
  episodes[0].repair.evidenceRefs = [];
  for (const episode of episodes.slice(0, 2)) {
    episode.learningSignals = [{
      userCorrection: true,
      fieldProvenance: { userCorrection: "host-observed" },
      evidenceRefs: [{ kind: "fixture", id: episode.id + "-correction" }],
    }];
  }
  const packet = buildNativeLearningReviewPacket({ episodes });
  assert.equal(packet.groups.length, 2);
  assert.deepEqual(
    packet.groups.map((group) => JSON.stringify(group.correctionShape)).sort(),
    [JSON.stringify(["explicit-user-correction"]), JSON.stringify(["same-check-repair"])].sort(),
  );
  assert.notEqual(packet.groups[0].patternSignature, packet.groups[1].patternSignature);
  const applied = applyNativeLearningCandidateReview({
    episodes,
    packet,
    review: matchingReview(packet),
  });
  assert.deepEqual(applied.errors, []);
  assert.equal(applied.result.learningLoop.candidates.length, 2);
  const byEpisode = new Map(applied.result.learningLoop.episodeRecords.map((episode) => [episode.episodeId, episode]));
  const cSignals = byEpisode.get(episodes[2].id).signals.filter((signal) => signal.patternId === "recurring-correction");
  assert.equal(cSignals.length, 1);
  assert.equal(cSignals[0].frictionType, "same-check-repair");
  assert.equal(cSignals[0].fieldEvidence.userCorrection.coverage, "unavailable");
  const bSignals = byEpisode.get(episodes[1].id).signals.filter((signal) => signal.patternId === "recurring-correction");
  assert.equal(bSignals.length, 2);
  assert.equal(bSignals.some((signal) => signal.fieldEvidence.userCorrection.coverage === "observed"), true);
  assert.equal(bSignals.some((signal) => signal.fieldEvidence.userCorrection.coverage === "unavailable"), true);
});

test("Episode and evidence reorder are stable, exact duplicates dedupe, and conflicting duplicates fail closed", () => {
  const episodes = ordinaryRepairEpisodes();
  const baseline = buildNativeLearningReviewPacket({ episodes });
  const reordered = structuredClone(episodes).reverse();
  for (const episode of reordered) {
    episode.evidenceRefs = [...episode.evidenceRefs].reverse();
    episode.evidenceRefs.push(...episode.evidenceRefs);
    for (const candidate of episode.repair.candidates) candidate.evidenceRefs.reverse();
  }
  assert.deepEqual(buildNativeLearningReviewPacket({ episodes: reordered }), baseline);
  assert.deepEqual(buildNativeLearningReviewPacket({ episodes: [...episodes, structuredClone(episodes[0])] }), baseline);

  const conflicting = structuredClone(episodes[0]);
  conflicting.permissionSummary = { protectedActions: 1, denied: 1, evidenceRefs: [] };
  assert.throws(
    () => buildNativeLearningReviewPacket({ episodes: [...episodes, conflicting] }),
    /conflicting duplicate Task Episode projections/u,
  );
});

test("missing and false correction observations remain distinct tri-state facts", () => {
  const episodes = ordinaryRepairEpisodes();
  const missing = buildNativeLearningReviewPacket({ episodes });
  assert.equal(missing.episodeFacts[0].facts.userCorrection, "unavailable");

  const explicitFalse = structuredClone(episodes);
  for (const episode of explicitFalse) {
    episode.learningSignals = [{
      userCorrection: false,
      fieldProvenance: { userCorrection: "host-observed" },
    }];
  }
  const falsePacket = buildNativeLearningReviewPacket({ episodes: explicitFalse });
  assert.equal(falsePacket.episodeFacts[0].facts.userCorrection, "false");

  const legacyDefaultFalse = structuredClone(episodes);
  for (const episode of legacyDefaultFalse) episode.learningSignals = [{ userCorrection: false }];
  const legacyPacket = buildNativeLearningReviewPacket({ episodes: legacyDefaultFalse });
  assert.equal(legacyPacket.episodeFacts[0].facts.userCorrection, "unavailable");

  const explicitTrue = structuredClone(episodes);
  for (const episode of explicitTrue) episode.learningSignals = [{ userCorrection: true }];
  const truePacket = buildNativeLearningReviewPacket({ episodes: explicitTrue });
  assert.equal(truePacket.episodeFacts[0].facts.userCorrection, "true");
});

test("raw privacy sentinels do not affect or leak through packet and apply output", () => {
  const episodes = ordinaryRepairEpisodes();
  const baseline = buildNativeLearningReviewPacket({ episodes });
  const privateEpisodes = structuredClone(episodes);
  const sentinels = [
    "C:\\Users\\alice\\private\\session.jsonl",
    "/Users/alice/private/session.jsonl",
    "/home/alice/private/session.jsonl",
    "\\\\server\\alice\\private\\session.jsonl",
    "alice@example.com",
    "session-secret-123",
    "https://alice:password@example.com/private",
  ];
  privateEpisodes[0].rawPrompt = sentinels.join(" ");
  privateEpisodes[0].transcript = sentinels;
  privateEpisodes[0].sessionId = "session-secret-123";
  assert.deepEqual(buildNativeLearningReviewPacket({ episodes: privateEpisodes }), baseline);
  privateEpisodes[0].evidenceRefs = [{
    kind: "fixture",
    id: "C:\\Users\\alice\\private\\session.jsonl",
  }, ...privateEpisodes[0].evidenceRefs];
  const packet = buildNativeLearningReviewPacket({ episodes: privateEpisodes });
  assert.deepEqual(packet, baseline);
  const serializedPacket = JSON.stringify(packet);
  for (const sentinel of sentinels) assert.equal(serializedPacket.includes(sentinel), false);

  const applied = applyNativeLearningCandidateReview({
    episodes: privateEpisodes,
    packet,
    review: matchingReview(packet),
  });
  assert.deepEqual(applied.errors, []);
  const serializedResult = JSON.stringify(applied.result);
  for (const sentinel of sentinels) assert.equal(serializedResult.includes(sentinel), false);
});

test("truncated evidence remains partial instead of checked-clean", () => {
  const episodes = ordinaryRepairEpisodes();
  const packet = buildNativeLearningReviewPacket({
    episodes,
    limits: { maxEvidenceRefsPerEpisode: 1 },
  });
  assert.equal(packet.coverage.truncated, true);
  assert.equal(packet.coverage.status, "partial-truncated");
  assert.ok(packet.coverage.reasonCodes.includes("evidence-limit-reached"));
  const applied = applyNativeLearningCandidateReview({
    episodes,
    packet,
    review: matchingReview(packet),
  });
  assert.deepEqual(applied.errors, []);
  assert.equal(applied.result.coverage.status, "reviewed-partial");
});

test("provider signals remain intact and equivalent native plus legacy matches dedupe", () => {
  const episodes = ordinaryRepairEpisodes();
  for (const episode of episodes) {
    episode.learningSignals = [{
      patternId: "recurring-correction",
      normalizedSignature: "legacy-correction-route",
      taskFamily: "debugging",
      repoArea: "tests",
      frictionType: "user-correction",
      userCorrection: true,
      evidenceRefs: [{ kind: "fixture", id: episode.id + "-legacy" }],
    }];
  }
  const packet = buildNativeLearningReviewPacket({ episodes });
  const applied = applyNativeLearningCandidateReview({
    episodes,
    packet,
    review: matchingReview(packet),
  });
  assert.deepEqual(applied.errors, []);
  assert.equal(applied.result.learningLoop.candidates.length, 1);
  assert.equal(applied.result.learningLoop.candidates[0].normalizedSignature, "legacy-correction-route");
  assert.equal(applied.result.learningLoop.episodeRecords.every((episode) => episode.signals.length === 1), true);
});

test("historical flat learningPatternId events still build provider-supplied repeated-rediscovery candidates", () => {
  const events = ["flat-a", "flat-b"].map((sessionId, index) => event({
    sessionId,
    timestamp: "2026-08-01T11:0" + index + ":00.000Z",
    toolName: "Read",
    filePath: "src/shared.mjs",
    evidenceId: sessionId,
    learningPatternId: "repeated-rediscovery",
    normalizedSignature: "legacy-discovery-route",
    frictionType: "repeated-rediscovery",
  }));
  const episodes = buildTaskEpisodes(events).episodes;
  assert.equal(episodes.every((episode) => !Object.hasOwn(episode.learningSignals[0], "userCorrection")), true);
  const packet = buildNativeLearningReviewPacket({ episodes });
  assert.equal(packet.episodeFacts.every((episode) => episode.facts.userCorrection === "unavailable"), true);
  const learningLoop = buildLearningLoopReview({ episodes });
  assert.equal(learningLoop.candidates.length, 1);
  assert.equal(learningLoop.candidates[0].patternId, "repeated-rediscovery");
  assert.equal(
    learningLoop.episodeRecords.every((episode) =>
      episode.signals[0].fieldEvidence.userCorrection.coverage === "unavailable"),
    true,
  );
});

function repairEventsForCheck(sessionId, minute, suffix, slug) {
  const base = "2026-08-01T10:" + String(minute).padStart(2, "0");
  const commandText = "node --test test/" + slug + ".test.mjs";
  return [
    event({
      sessionId,
      timestamp: base + ":00.000Z",
      toolName: "Bash",
      commandText,
      targetPaths: ["src/" + slug + ".mjs"],
      success: false,
      evidenceId: suffix + "-" + slug + "-failure",
    }),
    event({
      sessionId,
      timestamp: base + ":01.000Z",
      toolName: "Edit",
      filePath: "src/" + slug + ".mjs",
      evidenceId: suffix + "-" + slug + "-edit",
    }),
    event({
      sessionId,
      timestamp: base + ":02.000Z",
      toolName: "Bash",
      commandText,
      targetPaths: ["src/" + slug + ".mjs"],
      success: true,
      evidenceId: suffix + "-" + slug + "-rerun",
    }),
  ];
}

function correctionEpisode(id, { taskRoute, targetKeys, signature }) {
  return {
    id,
    taskRoute,
    targetKeys,
    evidenceRefs: [{ kind: "fixture", id: id.replace("episode:", "evidence-") }],
    changeSets: [],
    validationSets: [],
    learningSignals: [{
      normalizedSignature: signature,
      userCorrection: true,
      fieldProvenance: { userCorrection: "host-observed" },
      evidenceRefs: [{ kind: "fixture", id: id.replace("episode:", "correction-") }],
    }],
  };
}

test("applying a native review leaves unreviewed provider candidates at candidate status", () => {
  const episodes = buildTaskEpisodes([
    ...repairEventsForCheck("session-a", 0, "a", "shared"),
    ...repairEventsForCheck("session-b", 5, "b", "shared"),
    ...repairEventsForCheck("session-c", 20, "c", "other"),
  ]).episodes;
  episodes.at(-1).learningSignals = [{
    patternId: "present-but-not-routed",
    normalizedSignature: "provider-routing-gap",
    taskFamily: "docs",
    repoArea: "docs",
    frictionType: "rediscovery",
    assetLoaded: false,
    assetRelevant: true,
  }];
  const packet = buildNativeLearningReviewPacket({ episodes });
  const applied = applyNativeLearningCandidateReview({ episodes, packet, review: matchingReview(packet) });
  assert.deepEqual(applied.errors, []);
  assert.equal(applied.result.status, "reviewed");
  assert.equal(applied.result.learningLoop.status, "candidate");
  assert.ok(applied.result.learningLoop.candidates.some((candidate) => candidate.patternId === "present-but-not-routed"));
  assert.deepEqual(
    validateLearningLoopReview(applied.result.learningLoop, { episodeIds: episodes.map((episode) => episode.id) }),
    [],
  );
});

test("reordered review decisions produce an identical applied result", () => {
  const episodes = buildTaskEpisodes([
    ...repairEventsForCheck("session-a", 0, "a", "shared"),
    ...repairEventsForCheck("session-b", 5, "b", "shared"),
    ...repairEventsForCheck("session-c", 20, "c", "other"),
    ...repairEventsForCheck("session-d", 30, "d", "other"),
  ]).episodes;
  const packet = buildNativeLearningReviewPacket({ episodes });
  assert.equal(packet.groups.length, 2);
  const review = matchingReview(packet);
  const applied = applyNativeLearningCandidateReview({ episodes, packet, review });
  const reordered = applyNativeLearningCandidateReview({
    episodes,
    packet,
    review: { ...review, decisions: [...review.decisions].reverse() },
  });
  assert.deepEqual(applied.errors, []);
  assert.deepEqual(reordered.errors, []);
  assert.deepEqual(reordered.result, applied.result);
  assert.deepEqual(
    applied.result.matches.map((match) => match.normalizedSignature).sort(),
    packet.groups.map((group) => group.patternSignature).sort(),
  );
});

test("a group whose Episodes are contained by a larger group is collapsed before review", () => {
  const episodes = buildTaskEpisodes([
    ...repairEventsForCheck("session-a", 0, "a", "shared"),
    ...repairEventsForCheck("session-a", 1, "a", "other"),
    ...repairEventsForCheck("session-b", 20, "b", "shared"),
    ...repairEventsForCheck("session-c", 40, "c", "shared"),
    ...repairEventsForCheck("session-c", 41, "c", "other"),
  ]).episodes;
  assert.equal(episodes.length, 3);
  const packet = buildNativeLearningReviewPacket({ episodes });
  assert.equal(packet.groups.length, 1);
  assert.equal(packet.groups[0].episodeRefs.length, 3);
  assert.equal(packet.coverage.subsumedGroupCount, 1);
  assert.equal(packet.coverage.truncated, false);
  assert.equal(packet.coverage.status, "candidate-groups-present");
  assert.ok(packet.coverage.reasonCodes.includes("subsumed-group-collapsed"));
  assert.equal(packet.coverage.reasonCodes.includes("group-limit-reached"), false);

  const applied = applyNativeLearningCandidateReview({ episodes, packet, review: matchingReview(packet) });
  assert.deepEqual(applied.errors, []);
  assert.equal(applied.result.learningLoop.candidates.length, 1);
  assert.equal(applied.result.learningLoop.candidates[0].sourceEpisodes.length, 3);
});

test("a blocked Hook observed on an ordinary Episode excludes it through canonical fields", () => {
  const blockedEvents = repairEventsForCheck("session-b", 5, "b", "shared");
  blockedEvents[0] = { ...blockedEvents[0], hookDecision: "blocked" };
  const episodes = buildTaskEpisodes([
    ...repairEventsForCheck("session-a", 0, "a", "shared"),
    ...blockedEvents,
  ]).episodes;
  const blocked = episodes.find((episode) => episode.protectiveInterventionObserved === true);
  assert.ok(blocked);
  const packet = buildNativeLearningReviewPacket({ episodes });
  assert.equal(packet.groups.length, 0);
  assert.equal(packet.coverage.protectiveEpisodeCount, 1);
  assert.ok(packet.coverage.reasonCodes.includes("protective-intervention-excluded"));
  assert.equal(
    packet.episodeFacts.find((fact) => fact.episodeRef === blocked.id).facts.protectiveIntervention,
    "true",
  );
});

test("a denied permission action recorded by the Episode contract excludes an Episode", () => {
  const episodes = ordinaryRepairEpisodes();
  episodes[0].permissionSummary = { prompted: 1, denied: 1, escalated: 0, protectedActions: 0, evidenceRefs: [] };
  const packet = buildNativeLearningReviewPacket({ episodes });
  assert.equal(packet.groups.length, 0);
  assert.equal(packet.coverage.protectiveEpisodeCount, 1);
});

test("report-source Episodes group on shared route and target identity", () => {
  const episodes = [
    correctionEpisode("episode:aaaaaaaaaaaa1111", {
      taskRoute: "lifecycle:fix-defect",
      targetKeys: ["a1b2c3d4e5f6a7b8"],
      signature: "provider-correction-route",
    }),
    correctionEpisode("episode:bbbbbbbbbbbb2222", {
      taskRoute: "lifecycle:fix-defect",
      targetKeys: ["a1b2c3d4e5f6a7b8"],
      signature: "provider-correction-route",
    }),
  ];
  const packet = buildNativeLearningReviewPacket({ episodes });
  assert.equal(packet.groups.length, 1);
  assert.ok(packet.groups[0].reasonCodes.includes("same-task-route"));
  assert.ok(packet.groups[0].reasonCodes.includes("same-target"));
  assert.ok(packet.groups[0].reasonCodes.includes("explicit-user-correction"));
  assert.equal(packet.episodeFacts.every((fact) => fact.facts.userCorrection === "true"), true);

  const applied = applyNativeLearningCandidateReview({ episodes, packet, review: matchingReview(packet) });
  assert.deepEqual(applied.errors, []);
  assert.equal(applied.result.learningLoop.candidates.length, 1);
  assert.equal(applied.result.learningLoop.candidates[0].taskFingerprint.family, "lifecycle-fix-defect");
});
