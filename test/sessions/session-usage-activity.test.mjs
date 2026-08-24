import assert from "node:assert/strict";
import { test } from "vitest";

import { buildTaskLoopSourceCandidate } from "../../scripts/harness-analysis/task-loop-source.mjs";
import { buildDailyUsageActivity } from "../../scripts/session-analysis/daily-usage.mjs";

test("daily usage aggregates session, model, and Skill observations without ids", () => {
  const activity = buildDailyUsageActivity(
    [
      { sessionId: "private-a", firstSeen: "2026-07-09T10:00:00.000Z" },
      { sessionId: "private-b", firstSeen: "2026-07-11T10:00:00.000Z" },
    ],
    [
      { id: "private-a", firstSeen: "2026-07-09T10:00:00.000Z", activeMs: 120_000 },
      { id: "private-b", firstSeen: "2026-07-11T10:00:00.000Z", activeMs: 30_000 },
    ],
    [
      { sessionId: "private-a", timestamp: "2026-07-09T10:01:00.000Z", model: "ultimate" },
      { sessionId: "private-b", timestamp: "2026-07-11T10:01:00.000Z", model: "ultimate" },
      { sessionId: "private-b", timestamp: "2026-07-11T10:01:01.000Z", model: "ultimate" },
      { sessionId: "private-b", timestamp: "2026-07-11T10:02:00.000Z", model: "performance" },
    ],
    [
      { timestamp: "2026-07-09T10:00:30.000Z", skillName: "skill-creator" },
      { timestamp: "2026-07-11T10:00:30.000Z", skillNames: ["skill-creator", "browser"] },
      { timestamp: "2026-07-11T10:00:40.000Z", skillReadName: "browser" },
    ],
  );

  assert.deepEqual(activity.dates, ["2026-07-09", "2026-07-10", "2026-07-11"]);
  assert.equal(activity.schemaVersion, 2);
  assert.equal(activity.measurementBasis, "session-starts-active-estimate-model-active-session-days-skill-invocations-and-loads");
  assert.deepEqual(activity.sessions, { total: 2, starts: [1, 0, 1], activeMinutes: [2, 0, 0.5] });
  assert.deepEqual(activity.models.find((row) => row.name === "ultimate")?.daily, [1, 0, 1]);
  assert.equal(activity.models.find((row) => row.name === "performance")?.total, 1);
  assert.equal(activity.skills.find((row) => row.name === "browser")?.total, 1);
  assert.equal(JSON.stringify(activity).includes("private-a"), false);
});

test("Skill reads stay apparent without entering activation usage", () => {
  const activity = buildDailyUsageActivity(
    [{ sessionId: "private-a", firstSeen: "2026-07-15T10:00:00.000Z" }],
    [{ id: "private-a", firstSeen: "2026-07-15T10:00:00.000Z", activeMs: 60_000 }],
    [],
    [
      { sessionId: "private-a", timestamp: "2026-07-15T10:00:10.000Z", skillReadName: "spec-review" },
      { sessionId: "private-a", timestamp: "2026-07-15T10:00:20.000Z", skillNames: ["loaded-review"] },
      {
        sessionId: "private-a",
        timestamp: "2026-07-15T10:00:30.000Z",
        skillInvocations: [{ id: "call-a", name: "invoked-review" }],
      },
    ],
  );

  assert.equal(activity.skills.some((row) => row.name === "spec-review"), false);
  assert.equal(activity.skills.find((row) => row.name === "loaded-review")?.total, 1);
  assert.equal(activity.skills.find((row) => row.name === "invoked-review")?.total, 1);

  const source = buildTaskLoopSourceCandidate({
    events: [{
      sessionId: "private-a",
      type: "user",
      timestamp: "2026-07-15T10:01:00.000Z",
      userText: "review the spec",
    }],
    insights: {
      keySignals: {
        usageEfficiency: { activity },
        inferredSkillReads: [{ name: "spec-review", count: 1 }],
      },
    },
  });
  const handoff = source.repositoryEvidence.workflowDemandDiagnostics.currentHandoffs[0];

  assert.deepEqual(handoff.coverageClasses.unscopedObservedActivation, []);
  assert.deepEqual(handoff.coverageClasses.apparentReads.map((row) => row.skillId), ["spec-review"]);
});

test("daily usage bounds the visible date window and returns null without dated evidence", () => {
  assert.equal(buildDailyUsageActivity([], [], [], []), null);
  const activity = buildDailyUsageActivity(
    [{ sessionId: "a", firstSeen: "2026-01-01T00:00:00Z" }, { sessionId: "b", firstSeen: "2026-02-01T00:00:00Z" }],
    [{ id: "a", firstSeen: "2026-01-01T00:00:00Z", activeMs: 0 }, { id: "b", firstSeen: "2026-02-01T00:00:00Z", activeMs: 0 }],
    [],
    [],
    { maxDays: 7 },
  );
  assert.equal(activity.truncated, true);
  assert.equal(activity.dates.length, 7);
  assert.equal(activity.dates.at(-1), "2026-02-01");
});

test("daily usage keeps undated provider sessions in the analyzed population", () => {
  const activity = buildDailyUsageActivity(
    [
      { sessionId: "dated", firstSeen: "2026-07-15T10:00:00.000Z" },
      { sessionId: "undated", firstSeen: null },
    ],
    [
      { id: "dated", firstSeen: "2026-07-15T10:00:00.000Z", activeMs: 0 },
      { id: "undated", firstSeen: null, activeMs: 0 },
    ],
    [],
    [],
  );

  assert.equal(activity.sessions.total, 2);
  assert.deepEqual(activity.sessions.starts, [1]);
});

test("daily usage keeps full totals while deduplicating cross-source Skill invocations", () => {
  const activity = buildDailyUsageActivity(
    [{ sessionId: "a", firstSeen: "2026-01-01T00:00:00Z" }, { sessionId: "b", firstSeen: "2026-02-01T00:00:00Z" }],
    [{ id: "a", firstSeen: "2026-01-01T00:00:00Z", activeMs: 0 }, { id: "b", firstSeen: "2026-02-01T00:00:00Z", activeMs: 0 }],
    [
      { sessionId: "a", timestamp: "2026-01-01T00:01:00Z", model: "ultimate" },
      { sessionId: "b", timestamp: "2026-02-01T00:01:00Z" },
    ],
    [
      { sessionId: "a", timestamp: "2026-01-01T00:01:00Z", skillInvocations: [{ id: "call-a", name: "harness" }] },
      { sessionId: "a", timestamp: "2026-01-01T00:01:00.010Z", skillInvocations: [{ id: "call-a", name: "harness" }] },
      { sessionId: "b", timestamp: "2026-02-01T00:01:00Z", skillInvocations: [{ id: "call-b", name: "create-skill" }] },
    ],
    { maxDays: 7 },
  );

  assert.equal(activity.truncated, true);
  assert.equal(activity.models.find((row) => row.name === "ultimate")?.total, 1);
  assert.equal(activity.models.find((row) => row.name === "Unknown model")?.total, 1);
  assert.equal(activity.skills.find((row) => row.name === "harness")?.total, 1);
  assert.equal(activity.skills.find((row) => row.name === "create-skill")?.total, 1);
  assert.deepEqual(activity.skills.find((row) => row.name === "harness")?.daily, Array(7).fill(0));
});
