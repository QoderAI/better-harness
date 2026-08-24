import assert from "node:assert/strict";
import { test } from "vitest";

import { buildObservationManifest } from "../../scripts/session-analysis/observation-manifest.mjs";
import { CodexSessionAnalyzer } from "../../scripts/session-analysis/platforms/codex.mjs";
import { QoderSessionAnalyzer } from "../../scripts/session-analysis/platforms/qoder.mjs";
import { selectionSummary } from "../../scripts/session-analysis/selection.mjs";
import {
  buildSessionSelectionEntry,
  buildSessionSelectionProfile,
  buildSessionSelectionSnapshot,
  collectSessionSelectionEntries,
  assertSessionSelectionBinding,
  parseSessionSelectionPlanDocument,
  restoreSessionSelectionEntries,
  sessionSelectionSnapshotDigest,
  sessionSelectionProfileDigest,
  selectSessionEntriesWithPlan,
  validateSessionSelectionPlan,
  validateSessionSelectionProfile,
  validateSessionSelectionSnapshot,
} from "../../scripts/session-analysis/selection-plan.mjs";

function event(overrides = {}) {
  return {
    sessionId: "private-session",
    timestamp: "2026-07-12T01:00:00.000Z",
    type: "tool",
    sourceKind: "test-jsonl",
    ...overrides,
  };
}

function plan(overrides = {}) {
  return {
    schemaVersion: 2,
    kind: "session-selection-plan",
    planner: "ai",
    profileDigest: "0123456789abcdef",
    rationale: "Represent result-bearing work and review gaps across the observed population.",
    limit: 5,
    fallback: "time-spread",
    strata: [
      {
        id: "result-bearing",
        family: "result-bearing",
        purpose: "Keep validation closure and repair evidence.",
        target: 2,
        match: "any",
        conditions: [
          { field: "validationCount", operator: "gte", value: 1 },
          { field: "repairCandidateCount", operator: "gte", value: 1 },
        ],
      },
      {
        id: "review-gaps",
        family: "review-gap",
        purpose: "Keep failed or unvalidated change evidence.",
        target: 2,
        match: "any",
        conditions: [
          { field: "failedValidationCount", operator: "gte", value: 1 },
          { field: "unvalidatedChangeCount", operator: "gte", value: 1 },
        ],
      },
    ],
    ...overrides,
  };
}

function entry(id, day, facts = {}) {
  return {
    session: {
      sessionId: id,
      firstSeen: `2026-07-${String(day).padStart(2, "0")}T01:00:00.000Z`,
      lastSeen: `2026-07-${String(day).padStart(2, "0")}T02:00:00.000Z`,
    },
    events: [],
    facts,
  };
}

test("selection facts derive repair, closure, and attempted-radius evidence without returning raw values", () => {
  const selectionEntry = buildSessionSelectionEntry(
    {
      sessionId: "private-session",
      sourceKinds: ["test-jsonl"],
      coverage: { conversation: true, executionEvents: true },
    },
    [
      event({ type: "user", timestamp: "2026-07-12T01:00:00.000Z", text: "private request" }),
      event({ timestamp: "2026-07-12T01:01:00.000Z", toolName: "Write", filePath: "/workspace/src/a.js" }),
      event({ timestamp: "2026-07-12T01:02:00.000Z", toolName: "Bash", commandText: "npm test", targetPaths: ["/workspace/src/a.js"], success: false }),
      event({ timestamp: "2026-07-12T01:03:00.000Z", toolName: "Write", filePath: "/workspace/src/a.js" }),
      event({ timestamp: "2026-07-12T01:04:00.000Z", toolName: "Bash", commandText: "npm test", targetPaths: ["/workspace/src/a.js"], success: true }),
    ],
  );

  assert.equal(selectionEntry.facts.changeCount, 2);
  assert.equal(selectionEntry.facts.validationCount, 2);
  assert.equal(selectionEntry.facts.failedValidationCount, 1);
  assert.equal(selectionEntry.facts.closedEpisodeCount, 0);
  assert.equal(selectionEntry.facts.repairCandidateCount, 1);
  assert.equal(selectionEntry.facts.repairedEpisodeCount, 0);
  assert.equal(selectionEntry.facts.toolKindCount, 2);
  assert.equal(selectionEntry.facts.targetPathCount, 1);
  assert.equal(selectionEntry.facts.attemptedRadius, 3);
  assert.equal("events" in selectionEntry, false);
});

test("selection profile exposes aggregate distributions but no identifiers, text, commands, or paths", () => {
  const selectionEntry = buildSessionSelectionEntry(
    { sessionId: "private-session", sourceKinds: ["test-jsonl"], coverage: { conversation: true } },
    [
      event({ type: "user", text: "private request" }),
      event({ toolName: "Write", filePath: "/workspace/private.js" }),
      event({ toolName: "Bash", commandText: "npm test -- private.js", success: true }),
    ],
  );
  const profile = buildSessionSelectionProfile([selectionEntry], {
    platform: "qoder",
    limit: 40,
    until: "2026-07-12T02:00:00.000Z",
  });
  const serialized = JSON.stringify(profile);

  assert.equal(profile.sampleRequired, false);
  assert.equal(profile.profileDigest, sessionSelectionProfileDigest(profile));
  assert.equal(profile.planTemplate.profileDigest, profile.profileDigest);
  assert.deepEqual(profile.planContract.requiredFamilies, ["result-bearing", "review-gap"]);
  assert.deepEqual(validateSessionSelectionProfile(profile), []);
  assert.equal(profile.fields.eventCount.observedCount, 1);
  assert.equal(profile.privacy.sessionIdsIncluded, false);
  assert.doesNotMatch(serialized, /private-session|private request|npm test|private\.js|\/workspace/u);

  const drifted = structuredClone(profile);
  drifted.eligibleCount += 1;
  assert.ok(validateSessionSelectionProfile(drifted).some((error) => /does not match/u.test(error)));
});

test("private fact snapshot is digest-bound, raw-event-free, and restores current session handles", () => {
  const selectionEntry = buildSessionSelectionEntry(
    { sessionId: "private-session", sourceKinds: ["fixture-jsonl"], coverage: { conversation: true } },
    [
      event({ type: "user", text: "private request" }),
      event({ toolName: "Write", filePath: "/workspace/private.js" }),
      event({ toolName: "Bash", commandText: "npm test -- private.js", success: true }),
    ],
  );
  const profile = buildSessionSelectionProfile([selectionEntry], {
    platform: "qoder",
    limit: 40,
    until: "2026-07-12T02:00:00.000Z",
  });
  const snapshot = buildSessionSelectionSnapshot([selectionEntry], profile);
  const serialized = JSON.stringify(snapshot);

  assert.equal(snapshot.snapshotDigest, sessionSelectionSnapshotDigest(snapshot));
  assert.deepEqual(validateSessionSelectionSnapshot(snapshot), []);
  assert.match(serialized, /private-session/u);
  assert.doesNotMatch(serialized, /private request|npm test|private\.js|\/workspace/u);
  assert.equal("events" in snapshot.rows[0], false);
  const currentSession = { sessionId: "private-session", lastSeen: "2026-07-12T02:00:00.000Z" };
  const restored = restoreSessionSelectionEntries(profile, snapshot, [currentSession]);
  assert.equal(restored[0].session, currentSession);
  assert.deepEqual(restored[0].facts, snapshot.rows[0].facts);

  const tampered = structuredClone(snapshot);
  tampered.rows[0].facts.eventCount += 1;
  assert.ok(validateSessionSelectionSnapshot(tampered).some((error) => /does not match the snapshot facts/u.test(error)));
  assert.throws(
    () => restoreSessionSelectionEntries(profile, snapshot, [{ sessionId: "different-session" }]),
    /mapping drifted/u,
  );
});

test("selection plan validation rejects executable, identifying, and structurally invalid conditions", () => {
  assert.deepEqual(validateSessionSelectionPlan(plan()), []);

  const invalid = plan({
    predicate: "return session.id === 'private'",
    strata: [
      {
        id: "private-session",
        family: "result-bearing",
        purpose: "Select an explicit session.",
        target: 4,
        match: "all",
        conditions: [{ field: "sessionId", operator: "regex", value: "private" }],
      },
      plan().strata[1],
    ],
  });
  const errors = validateSessionSelectionPlan(invalid);
  assert.ok(errors.some((error) => /plan\.predicate is not supported/u.test(error)));
  assert.ok(errors.some((error) => /field is not supported/u.test(error)));
  assert.ok(errors.some((error) => /operator is not supported/u.test(error)));
  assert.ok(errors.some((error) => /value must be a non-negative number/u.test(error)));
  assert.ok(errors.some((error) => /sum of stratum targets/u.test(error)));

  const incoherent = plan({
    strata: [
      { ...plan().strata[0], family: "work-shape" },
      plan().strata[1],
    ],
  });
  assert.ok(validateSessionSelectionPlan(incoherent).some((error) => /does not belong to work-shape/u.test(error)));
});

test("plan document parsing accepts one bounded JSON fence and rejects surrounding prose", () => {
  const raw = JSON.stringify(plan());
  assert.deepEqual(parseSessionSelectionPlanDocument(raw), parseSessionSelectionPlanDocument(`\`\`\`json\n${raw}\n\`\`\``));
  assert.throws(
    () => parseSessionSelectionPlanDocument(`Here is the plan:\n\`\`\`json\n${raw}\n\`\`\``),
    /invalid session selection plan JSON/u,
  );
  assert.throws(
    () => parseSessionSelectionPlanDocument(`\`\`\`json\n${raw}\n\`\`\`\n\`\`\`json\n${raw}\n\`\`\``),
    /invalid session selection plan JSON/u,
  );
});

test("AI plan selection is deterministic, deduplicates overlapping strata, and records fallback accounting", () => {
  const entries = [
    entry("old-gap", 1, { failedValidationCount: 1, unvalidatedChangeCount: 1 }),
    entry("closed", 2, { validationCount: 1 }),
    entry("overlap", 3, { repairCandidateCount: 1, failedValidationCount: 1 }),
    entry("unvalidated", 4, { unvalidatedChangeCount: 1 }),
    entry("long", 5, { durationMinutes: 90 }),
    entry("recent", 6, {}),
  ];
  const first = selectSessionEntriesWithPlan(entries, plan());
  const second = selectSessionEntriesWithPlan(entries, plan());

  assert.equal(first.analyzedCount, 5);
  assert.equal(new Set(first.sessions.map((session) => session.sessionId)).size, 5);
  assert.deepEqual(first.sessions.map((session) => session.sessionId), second.sessions.map((session) => session.sessionId));
  assert.equal(first.plan.digest, second.plan.digest);
  assert.deepEqual(first.plan.strata, [
    { id: "result-bearing", family: "result-bearing", target: 2, matchedCount: 2, overlapCount: 0, selectedCount: 2, shortfall: 0 },
    { id: "review-gaps", family: "review-gap", target: 2, matchedCount: 3, overlapCount: 1, selectedCount: 2, shortfall: 0 },
  ]);
  assert.equal(first.plan.fallbackSelectedCount, 1);
});

test("plan quality rejects missing evidence families, population-wide strata, and quota shortfall", () => {
  const familyEntries = [
    entry("closed", 1, { closedEpisodeCount: 1 }),
    entry("gap", 2, { unvalidatedChangeCount: 1 }),
    entry("long", 3, { durationMinutes: 45 }),
  ];
  const missingGap = plan({
    limit: 2,
    strata: [
      { ...plan().strata[0], target: 1 },
      {
        id: "long-work",
        family: "work-shape",
        purpose: "Keep the longer observed work shape.",
        target: 1,
        match: "all",
        conditions: [{ field: "durationMinutes", operator: "gte", value: 30 }],
      },
    ],
  });
  assert.throws(() => selectSessionEntriesWithPlan(familyEntries, missingGap), /must include the available review-gap family/u);

  const broadEntries = Array.from({ length: 10 }, (_, index) => entry(`broad-${index}`, index + 1, {
    eventCount: index + 1,
    ...(index === 0 ? { closedEpisodeCount: 1 } : {}),
    ...(index === 1 ? { unvalidatedChangeCount: 1 } : {}),
  }));
  const broadPlan = plan({
    limit: 3,
    strata: [
      { ...plan().strata[0], target: 1 },
      { ...plan().strata[1], target: 1 },
      {
        id: "all-work",
        family: "work-shape",
        purpose: "Keep a contrasting work-shape baseline.",
        target: 1,
        match: "all",
        conditions: [{ field: "eventCount", operator: "gte", value: 0 }],
      },
    ],
  });
  assert.throws(() => selectSessionEntriesWithPlan(broadEntries, broadPlan), /overly broad/u);

  const shortfallEntries = [
    entry("a", 1, { closedEpisodeCount: 1 }),
    entry("b", 2, { closedEpisodeCount: 1, validationCount: 1 }),
    entry("c", 3, { closedEpisodeCount: 1, validationCount: 1 }),
    entry("d", 4, { validationCount: 1 }),
    entry("e", 5, { unvalidatedChangeCount: 1 }),
    entry("f", 6, {}),
    entry("g", 7, {}),
    entry("h", 8, {}),
  ];
  const shortfallPlan = plan({
    limit: 7,
    strata: [
      { ...plan().strata[0], target: 3, match: "all", conditions: [{ field: "closedEpisodeCount", operator: "gte", value: 1 }] },
      {
        id: "validated-result",
        family: "result-bearing",
        purpose: "Keep sessions with direct validation evidence.",
        target: 3,
        match: "all",
        conditions: [{ field: "validationCount", operator: "gte", value: 1 }],
      },
      { ...plan().strata[1], target: 1, match: "all", conditions: [{ field: "unvalidatedChangeCount", operator: "gte", value: 1 }] },
    ],
  });
  assert.throws(() => selectSessionEntriesWithPlan(shortfallEntries, shortfallPlan), /quota shortfall: validated-result/u);
});

test("profile binding rejects digest mismatch, population drift, and empty AI strata", () => {
  const entries = [
    entry("closed", 1, { closedEpisodeCount: 1 }),
    entry("gap", 2, { unvalidatedChangeCount: 1 }),
    entry("baseline", 3, {}),
  ];
  const profile = buildSessionSelectionProfile(entries, {
    platform: "qoder",
    limit: 2,
    until: "2026-07-12T02:00:00.000Z",
  });
  const boundPlan = plan({
    profileDigest: profile.profileDigest,
    limit: 2,
    strata: [
      { ...plan().strata[0], target: 1 },
      { ...plan().strata[1], target: 1 },
    ],
  });

  assert.doesNotThrow(() => assertSessionSelectionBinding(profile, boundPlan, { eligibleCount: 3 }));
  assert.throws(
    () => assertSessionSelectionBinding(profile, { ...boundPlan, profileDigest: "fedcba9876543210" }, { eligibleCount: 3 }),
    /does not match the supplied population profile digest/u,
  );
  assert.throws(
    () => assertSessionSelectionBinding(profile, boundPlan, { eligibleCount: 4 }),
    /population drifted/u,
  );
  const emptyPlan = {
    ...boundPlan,
    strata: [
      {
        ...boundPlan.strata[0],
        conditions: [{ field: "closedEpisodeCount", operator: "gte", value: 99 }],
      },
      boundPlan.strata[1],
    ],
  };
  assert.throws(() => selectSessionEntriesWithPlan(entries, emptyPlan), /stratum result-bearing matches no sessions/u);
});

test("selection summaries and manifests retain only reader-safe plan accounting", () => {
  const selected = selectSessionEntriesWithPlan([
    entry("one", 1, { validationCount: 1 }),
    entry("two", 2, { repairCandidateCount: 1 }),
    entry("three", 3, { failedValidationCount: 1 }),
    entry("four", 4, { unvalidatedChangeCount: 1 }),
    entry("five", 5, {}),
    entry("six", 6, {}),
  ], plan());
  const summary = selectionSummary(selected);
  const manifest = buildObservationManifest({
    eligibleCount: summary.eligibleCount,
    analyzedCount: summary.analyzedCount,
    selectionStrategy: summary.strategy,
    selectionStrata: summary.strata,
    selectionPlan: summary.plan,
  });
  const serialized = JSON.stringify({ summary, manifest });

  assert.equal(summary.requestedStrategy, "ai-plan");
  assert.equal(manifest.selection.plan.digest, summary.plan.digest);
  assert.equal("sessions" in summary, false);
  assert.doesNotMatch(serialized, /rationale|purpose|conditions|sessionId|private/u);
});

test("selection entry collection bounds concurrency and never asks adapters for user text", async () => {
  let active = 0;
  let maximumActive = 0;
  const optionsSeen = [];
  const analyzer = {
    async readSession(session, _scope, options) {
      optionsSeen.push(options);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return [event({ sessionId: session.sessionId })];
    },
  };
  const sessions = Array.from({ length: 8 }, (_, index) => ({ sessionId: `session-${index}` }));
  const entries = await collectSessionSelectionEntries({ analyzer, sessions, scope: {}, concurrency: 3 });

  assert.equal(entries.length, 8);
  assert.ok(entries.every((selectionEntry) => !("events" in selectionEntry)));
  assert.ok(maximumActive <= 3);
  assert.ok(optionsSeen.every((options) => options.includeCommandText === true));
  assert.ok(optionsSeen.every((options) => options.includeUserText === false));
  assert.ok(optionsSeen.every((options) => options.includeContent === false));
});

test.each([
  { label: "Qoder", platform: "qoder", Analyzer: QoderSessionAnalyzer },
  { label: "Codex", platform: "codex", Analyzer: CodexSessionAnalyzer },
])("$label insight adapter applies the same validated AI plan", async ({ platform, Analyzer }) => {
  const sessions = Array.from({ length: 6 }, (_, index) => ({
    sessionId: `session-${index}`,
    workspace: "/workspace/project",
    sourceKinds: ["fixture-jsonl"],
    coverage: { conversation: true, executionEvents: true },
    firstSeen: `2026-07-0${index + 1}T01:00:00.000Z`,
    lastSeen: `2026-07-0${index + 1}T02:00:00.000Z`,
    indexedEventCounts: {},
    sourceRefs: [],
  }));
  const eventsBySession = new Map(sessions.map((session) => [session.sessionId, [
    event({ sessionId: session.sessionId, type: "user", timestamp: session.firstSeen }),
  ]]));
  eventsBySession.set("session-0", [
    event({ sessionId: "session-0", type: "user", timestamp: "2026-07-01T01:00:00.000Z" }),
    event({ sessionId: "session-0", timestamp: "2026-07-01T01:01:00.000Z", toolName: "Write", filePath: "/workspace/project/a.js" }),
    event({ sessionId: "session-0", timestamp: "2026-07-01T01:02:00.000Z", toolName: "Bash", commandText: "npm test", targetPaths: ["/workspace/project/a.js"], success: true }),
  ]);
  eventsBySession.set("session-1", [
    event({ sessionId: "session-1", type: "user", timestamp: "2026-07-02T01:00:00.000Z" }),
    event({ sessionId: "session-1", timestamp: "2026-07-02T01:01:00.000Z", toolName: "Write", filePath: "/workspace/project/b.js" }),
  ]);
  const adapterPlan = plan({
    limit: 2,
    strata: [
      {
        id: "closed",
        family: "result-bearing",
        purpose: "Keep relevant passing validation evidence.",
        target: 1,
        match: "all",
        conditions: [{ field: "validationCount", operator: "gte", value: 1 }],
      },
      {
        id: "unvalidated",
        family: "review-gap",
        purpose: "Keep changed work without later validation.",
        target: 1,
        match: "all",
        conditions: [{ field: "unvalidatedChangeCount", operator: "gte", value: 1 }],
      },
    ],
  });
  const precomputedEntries = sessions.map((session) =>
    buildSessionSelectionEntry(session, eventsBySession.get(session.sessionId) ?? []));

  const analyzer = new Analyzer();
  let readCount = 0;
  analyzer.resolveScope = async () => ({
    platform,
    workspace: "/workspace/project",
    since: null,
    until: null,
    sinceTime: null,
    untilTime: null,
    includeGlobalCapabilities: false,
  });
  analyzer.discoverSourceRoots = async () => [];
  analyzer.discoverSessions = async () => sessions;
  analyzer.readSession = async (session) => {
    readCount += 1;
    return eventsBySession.get(session.sessionId) ?? [];
  };

  const result = await analyzer.analyze({
    command: "insights",
    selectionPlan: adapterPlan,
    selectionEntries: precomputedEntries,
  });

  assert.equal(result.selection.requestedStrategy, "ai-plan");
  assert.equal(result.selection.analyzedCount, 2);
  assert.deepEqual(result.sessions.map((session) => session.sessionId), ["session-0", "session-1"]);
  assert.deepEqual(result.selection.strata, ["closed", "unvalidated"]);
  assert.equal(result.selection.plan.planner, "ai");
  assert.equal(readCount, 2);
});
