import assert from "node:assert/strict";
import { describe, test } from "vitest";

import {
  collectSkillUsageObservations,
  collectMcpUsageObservations,
  buildDailyUsageActivity,
} from "../../scripts/session-analysis/daily-usage.mjs";

describe("collectSkillUsageObservations failure tracking", () => {
  test("marks observation as failed when event has success: false", () => {
    const events = [
      { sessionId: "a", timestamp: "2026-09-01T10:00:00.000Z", skillName: "harness", success: false },
    ];
    const observations = collectSkillUsageObservations(events);
    assert.equal(observations.length, 1);
    assert.equal(observations[0].failed, true);
  });

  test("marks observation as failed when event has hasError: true", () => {
    const events = [
      { sessionId: "a", timestamp: "2026-09-01T10:00:00.000Z", skillName: "harness", hasError: true },
    ];
    const observations = collectSkillUsageObservations(events);
    assert.equal(observations[0].failed, true);
  });

  test("marks observation as not failed for normal events", () => {
    const events = [
      { sessionId: "a", timestamp: "2026-09-01T10:00:00.000Z", skillName: "harness" },
    ];
    const observations = collectSkillUsageObservations(events);
    assert.equal(observations[0].failed, false);
  });
});

describe("collectMcpUsageObservations failure tracking", () => {
  test("marks observation as failed when event has success: false", () => {
    const events = [
      { sessionId: "a", timestamp: "2026-09-01T10:00:00.000Z", toolName: "mcp__docs__search", toolInvocationId: "call-1", success: false },
    ];
    const observations = collectMcpUsageObservations(events);
    assert.equal(observations.length, 1);
    assert.equal(observations[0].failed, true);
  });

  test("marks observation as not failed for normal events", () => {
    const events = [
      { sessionId: "a", timestamp: "2026-09-01T10:00:00.000Z", toolName: "mcp__docs__search", toolInvocationId: "call-1" },
    ];
    const observations = collectMcpUsageObservations(events);
    assert.equal(observations[0].failed, false);
  });
});

describe("buildDailyUsageActivity totalFailed and dailyFailed output", () => {
  test("skill series includes totalFailed and dailyFailed counts", () => {
    const activity = buildDailyUsageActivity(
      [{ sessionId: "a", firstSeen: "2026-09-01T10:00:00.000Z" }],
      [{ id: "a", firstSeen: "2026-09-01T10:00:00.000Z", activeMs: 60_000 }],
      [],
      [
        { sessionId: "a", timestamp: "2026-09-01T10:00:10.000Z", skillName: "harness" },
        { sessionId: "a", timestamp: "2026-09-01T10:00:20.000Z", skillName: "harness", success: false },
        { sessionId: "a", timestamp: "2026-09-01T10:00:30.000Z", skillName: "harness", hasError: true },
      ],
    );

    const skill = activity.skills.find((row) => row.name === "harness");
    assert.equal(skill.total, 3);
    assert.equal(skill.totalFailed, 2);
    assert.deepEqual(skill.dailyFailed, [2]);
  });

  test("MCP series includes totalFailed and dailyFailed counts", () => {
    const activity = buildDailyUsageActivity(
      [{ sessionId: "a", firstSeen: "2026-09-01T10:00:00.000Z" }],
      [{ id: "a", firstSeen: "2026-09-01T10:00:00.000Z", activeMs: 0 }],
      [],
      [
        { sessionId: "a", timestamp: "2026-09-01T10:00:10.000Z", toolName: "mcp__docs__search", toolInvocationId: "c-1" },
        { sessionId: "a", timestamp: "2026-09-01T10:00:20.000Z", toolName: "mcp__docs__open", toolInvocationId: "c-2", success: false },
      ],
    );

    const mcp = activity.mcps.find((row) => row.name === "docs");
    assert.equal(mcp.total, 2);
    assert.equal(mcp.totalFailed, 1);
    assert.deepEqual(mcp.dailyFailed, [1]);
  });

  test("zero failures produce totalFailed 0 and zero-filled dailyFailed", () => {
    const activity = buildDailyUsageActivity(
      [{ sessionId: "a", firstSeen: "2026-09-01T10:00:00.000Z" }],
      [{ id: "a", firstSeen: "2026-09-01T10:00:00.000Z", activeMs: 0 }],
      [],
      [
        { sessionId: "a", timestamp: "2026-09-01T10:00:10.000Z", skillName: "review" },
      ],
    );

    const skill = activity.skills.find((row) => row.name === "review");
    assert.equal(skill.totalFailed, 0);
    assert.deepEqual(skill.dailyFailed, [0]);
  });
});
