import assert from "node:assert/strict";
import { describe, test } from "vitest";

import {
  aggregateCustomizationUsage,
  collectSessionCustomizationUsage,
  normalizeCustomizationUsageName,
} from "../../scripts/session-analysis/customization-usage.mjs";

describe("customization usage matching vocabulary", () => {
  test("reduces a Host's own invocation name to the definition's last segment", () => {
    // Codex reports a plugin Skill as `<plugin>:<skill>`; the catalog knows the tail.
    assert.equal(normalizeCustomizationUsageName("better-harness:ui-ux-pro-max"), "ui-ux-pro-max");
    assert.equal(normalizeCustomizationUsageName("Claude_Browser"), "claude_browser");
    assert.equal(normalizeCustomizationUsageName(".agents/skills/review"), "review");
    assert.equal(normalizeCustomizationUsageName("  Review  "), "review");
    assert.equal(normalizeCustomizationUsageName(""), null);
    assert.equal(normalizeCustomizationUsageName(undefined), null);
  });
});

describe("collectSessionCustomizationUsage", () => {
  test("counts Skill invocations and MCP servers from one Session's events", () => {
    const events = [
      { sessionId: "s1", timestamp: "2026-09-01T10:00:00.000Z", skillInvocations: [{ id: "i1", name: "better-harness:ui-ux-pro-max" }] },
      { sessionId: "s1", timestamp: "2026-09-02T10:00:00.000Z", skillName: "ui-ux-pro-max" },
      { sessionId: "s1", timestamp: "2026-09-02T11:00:00.000Z", toolName: "mcp__Claude_Browser__browser_batch", toolInvocationId: "t1" },
      { sessionId: "s1", timestamp: "2026-09-02T12:00:00.000Z", toolName: "mcp__Claude_Browser__browser_navigate", toolInvocationId: "t2" },
      { sessionId: "s1", timestamp: "2026-09-02T13:00:00.000Z", toolName: "Read", toolInvocationId: "t3" },
    ];
    assert.deepEqual(collectSessionCustomizationUsage(events), {
      entries: [
        { kind: "mcp-server", name: "claude_browser", count: 2, lastObservedAt: "2026-09-02T00:00:00.000Z" },
        { kind: "skill", name: "ui-ux-pro-max", count: 2, lastObservedAt: "2026-09-02T00:00:00.000Z" },
      ],
    });
  });

  test("returns nothing when a Session invoked no Skill and no MCP server", () => {
    assert.equal(collectSessionCustomizationUsage([{ sessionId: "s1", timestamp: "2026-09-01T10:00:00.000Z", toolName: "Bash" }]), null);
    assert.equal(collectSessionCustomizationUsage([]), null);
  });
});

describe("aggregateCustomizationUsage", () => {
  const sessions = [
    {
      platform: "codex",
      firstSeen: "2026-09-01T09:00:00.000Z",
      lastSeen: "2026-09-01T12:00:00.000Z",
      customizationUsage: { entries: [{ kind: "skill", name: "ui-ux-pro-max", count: 2, lastObservedAt: "2026-09-01T00:00:00.000Z" }] },
    },
    {
      platform: "qoder",
      firstSeen: "2026-09-03T09:00:00.000Z",
      lastSeen: "2026-09-03T12:00:00.000Z",
      customizationUsage: { entries: [{ kind: "skill", name: "ui-ux-pro-max", count: 1, lastObservedAt: "2026-09-03T00:00:00.000Z" }] },
    },
    { platform: "qoder", firstSeen: "2026-09-04T09:00:00.000Z", lastSeen: "2026-09-04T10:00:00.000Z" },
  ];

  test("keeps one count per Host and reports the observed window", () => {
    const usage = aggregateCustomizationUsage(sessions);
    assert.equal(usage.kind, "BetterHarnessCustomizationUsageV1");
    // A Session that invoked nothing still widens the window it was read from.
    assert.equal(usage.observedSessions, 3);
    assert.deepEqual(usage.window, { from: "2026-09-01T09:00:00.000Z", to: "2026-09-04T10:00:00.000Z" });
    assert.deepEqual(usage.entries, [
      { kind: "skill", hostId: "codex", name: "ui-ux-pro-max", count: 2, lastObservedAt: "2026-09-01T00:00:00.000Z" },
      { kind: "skill", hostId: "qoder", name: "ui-ux-pro-max", count: 1, lastObservedAt: "2026-09-03T00:00:00.000Z" },
    ]);
  });

  test("drops observations without a Host, an entry kind, or a name", () => {
    const usage = aggregateCustomizationUsage([
      { firstSeen: "2026-09-01T09:00:00.000Z", customizationUsage: { entries: [{ kind: "skill", name: "orphan", count: 4 }] } },
      { platform: "qoder", customizationUsage: { entries: [{ kind: "hook", name: "pre-commit", count: 4 }, { kind: "skill", name: "  ", count: 4 }] } },
    ]);
    assert.equal(usage.observedSessions, 1);
    assert.deepEqual(usage.entries, []);
  });

  test("merges repeated Sessions of one Host into a single entry with the latest date", () => {
    const usage = aggregateCustomizationUsage([
      { platform: "qoder", customizationUsage: { entries: [{ kind: "mcp-server", name: "schedule", count: 1, lastObservedAt: "2026-09-01T00:00:00.000Z" }] } },
      { platform: "qoder", customizationUsage: { entries: [{ kind: "mcp-server", name: "Schedule", count: 3, lastObservedAt: "2026-09-05T00:00:00.000Z" }] } },
    ]);
    assert.deepEqual(usage.entries, [
      { kind: "mcp-server", hostId: "qoder", name: "schedule", count: 4, lastObservedAt: "2026-09-05T00:00:00.000Z" },
    ]);
  });

  test("an unread history is an empty aggregate, not a missing one", () => {
    const usage = aggregateCustomizationUsage([]);
    assert.equal(usage.observedSessions, 0);
    assert.deepEqual(usage.window, { from: null, to: null });
    assert.deepEqual(usage.entries, []);
  });
});
