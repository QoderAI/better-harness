import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildTaskEpisodes,
  classifyExecutionSignal,
  countEpisodeClosure,
  deduplicateLifecycleEvents,
} from "../../scripts/session-analysis/episode-contract.mjs";
import { buildInsightPack } from "../../scripts/session-analysis/insights.mjs";
import { buildObservationManifest } from "../../scripts/session-analysis/observation-manifest.mjs";
import { buildToolCallTrace } from "../../scripts/session-analysis/tool-call-trace.mjs";

function event({
  sessionId = "session-a",
  timestamp,
  type = "tool",
  toolName,
  filePath,
  validationCategory,
  targetPaths,
  success,
  taskEpisodeKey,
  ...rest
} = {}) {
  return {
    sessionId,
    timestamp,
    type,
    toolName,
    filePath,
    validationCategory,
    targetPaths,
    success,
    taskEpisodeKey,
    evidenceRef: { kind: "fixture", line: rest.line ?? 1, type },
    ...rest,
  };
}

test("episode contract does not turn an unrelated same-session test into closure", () => {
  const { episodes } = buildTaskEpisodes([
    event({ timestamp: "2026-07-10T10:00:00.000Z", type: "user" }),
    event({ timestamp: "2026-07-10T10:00:01.000Z", toolName: "Edit", filePath: "src/a.ts" }),
    event({ timestamp: "2026-07-10T10:02:00.000Z", type: "user" }),
    event({
      timestamp: "2026-07-10T10:02:01.000Z",
      toolName: "Bash",
      validationCategory: "node --test",
      targetPaths: ["src/b.ts"],
      success: true,
    }),
  ]);

  assert.equal(episodes.length, 2);
  assert.equal(episodes[0].closure.status, "unobserved");
  assert.equal(episodes[1].closure.status, "not-applicable");
  assert.equal(countEpisodeClosure(episodes).closedEpisodeCount, 0);
});

test("episode contract excludes Harness-owned report writes from project edits", () => {
  const { episodes } = buildTaskEpisodes([
    event({
      timestamp: "2026-07-10T10:00:00.000Z",
      toolName: "Write",
      filePath: "/workspace/project/.qoder/better-harness/2026-07-10/run/findings.json",
    }),
    event({
      timestamp: "2026-07-10T10:00:01.000Z",
      toolName: "Write",
      filePath: "C:\\workspace\\project\\.Qoder\\better-harness\\2026-07-10\\run\\report.canvas.tsx",
    }),
    event({
      timestamp: "2026-07-10T10:00:02.000Z",
      toolName: "Write",
      filePath: "/workspace/project/tmp-findings.json",
    }),
    event({
      timestamp: "2026-07-10T10:00:03.000Z",
      toolName: "Write",
      filePath: "/workspace/project/.Qoder/test-write.json",
    }),
    event({
      timestamp: "2026-07-10T10:00:04.000Z",
      toolName: "Write",
      filePath: "/tmp/harness-report-source.json",
      cwd: "/workspace/project",
    }),
  ]);

  assert.equal(episodes.length, 1);
  assert.deepEqual(episodes[0].changeSets, []);
  assert.equal(episodes[0].closure.status, "not-applicable");

  const insights = buildInsightPack({
    scope: { platform: "qoder", workspace: "/workspace/project" },
    sessions: [{ id: "session-a" }],
    facets: { sessionCount: 1, analyzedSessionCount: 1 },
    events: episodes.flatMap(() => [
      event({
        timestamp: "2026-07-10T10:00:00.000Z",
        toolName: "Write",
        filePath: "/workspace/project/.qoder/better-harness/run/findings.json",
      }),
    ]),
  });
  assert.equal(insights.keySignals.validationAfterEdit.status, "no-edit-observed");
  assert.equal(insights.keySignals.validationAfterEdit.editCount, 0);
  assert.equal(insights.actionCandidates.some((item) => item.kind === "post-edit-validation-review"), false);
});

test("episode contract keeps ordinary project writes as edits", () => {
  const { episodes } = buildTaskEpisodes([
    event({ timestamp: "2026-07-10T10:00:00.000Z", toolName: "Write", filePath: "/workspace/project/src/main.go" }),
  ]);

  assert.equal(episodes[0].changeSets.length, 1);
  assert.deepEqual(episodes[0].changeSets[0].paths, ["/workspace/project/src/main.go"]);
});

test("Codex patch completion is an edit event even when the host omits paths", () => {
  const { episodes } = buildTaskEpisodes([
    event({ type: "event.patch_apply_end", timestamp: "2026-07-10T10:00:00.000Z" }),
  ]);
  assert.equal(episodes[0].changeSets.length, 1);
});

test("episode contract only joins cross-session work through an explicit task key", () => {
  const withoutContinuation = buildTaskEpisodes([
    event({ sessionId: "session-a", timestamp: "2026-07-10T10:00:00.000Z", toolName: "Edit", filePath: "src/a.ts" }),
    event({
      sessionId: "session-b",
      timestamp: "2026-07-10T10:10:00.000Z",
      validationCategory: "node --test",
      targetPaths: ["src/a.ts"],
      success: true,
    }),
  ]);
  assert.equal(withoutContinuation.episodes.length, 2);
  assert.equal(withoutContinuation.episodes[0].closure.status, "unobserved");

  const withContinuation = buildTaskEpisodes([
    event({ sessionId: "session-a", timestamp: "2026-07-10T10:00:00.000Z", toolName: "Edit", filePath: "src/a.ts", taskEpisodeKey: "HD-42" }),
    event({
      sessionId: "session-b",
      timestamp: "2026-07-10T10:10:00.000Z",
      validationCategory: "node --test",
      targetPaths: ["src/a.ts"],
      success: true,
      taskEpisodeKey: "HD-42",
    }),
  ]);
  assert.equal(withContinuation.episodes.length, 1);
  assert.equal(withContinuation.episodes[0].sessionCount, 2);
  assert.equal(withContinuation.episodes[0].continuation, "explicit");
  assert.equal(withContinuation.episodes[0].closure.status, "unobserved");
});

test("lifecycle pre/post records deduplicate only with a stable invocation id", () => {
  const events = deduplicateLifecycleEvents([
    event({ timestamp: "2026-07-10T10:00:00.000Z", toolName: "Bash", toolInvocationId: "tool-1", lifecyclePhase: "pre", commandText: "node --test test/a.test.mjs", permissionDecision: "allowed" }),
    event({ timestamp: "2026-07-10T10:00:01.000Z", toolName: "Bash", toolInvocationId: "tool-1", lifecyclePhase: "post", success: true }),
    event({ timestamp: "2026-07-10T10:00:02.000Z", toolName: "Bash", lifecyclePhase: "pre" }),
    event({ timestamp: "2026-07-10T10:00:03.000Z", toolName: "Bash", lifecyclePhase: "post" }),
  ]);

  assert.equal(events.length, 3);
  assert.equal(events[0].lifecycle.deduplicated, true);
  assert.equal(events[0].success, true);
  assert.equal(events[0].commandText, "node --test test/a.test.mjs");
  assert.equal(events[0].permissionDecision, "allowed");
});

test("lifecycle deduplication retains sequential occurrences that reuse an invocation id", () => {
  const events = deduplicateLifecycleEvents([
    event({ timestamp: "2026-07-10T10:00:00.000Z", toolName: "Read", toolInvocationId: "reused",
      lifecyclePhase: "request" }),
    event({ timestamp: "2026-07-10T10:00:01.000Z", toolName: "Read", toolInvocationId: "reused",
      lifecyclePhase: "result", success: true }),
    event({ timestamp: "2026-07-10T10:00:02.000Z", toolName: "Read", toolInvocationId: "reused",
      lifecyclePhase: "request" }),
    event({ timestamp: "2026-07-10T10:00:03.000Z", toolName: "Read", toolInvocationId: "reused",
      lifecyclePhase: "result", success: false }),
  ]);

  assert.equal(events.length, 2);
  assert.deepEqual(events.map((item) => item.success), [true, false]);
  assert.ok(events.every((item) => item.lifecycle.deduplicated));
});

test("lifecycle deduplication retains reused invocation occurrences across timestamp drift", () => {
  const input = [
    event({ timestamp: "2026-07-10T10:00:00.000Z", toolName: "Read A", toolInvocationId: "reused",
      lifecyclePhase: "request" }),
    event({ timestamp: "2026-07-10T10:00:03.000Z", toolName: "Read A", toolInvocationId: "reused",
      lifecyclePhase: "result", success: true }),
    event({ timestamp: "2026-07-10T10:00:01.000Z", toolName: "Read B", toolInvocationId: "reused",
      lifecyclePhase: "request" }),
    event({ timestamp: "2026-07-10T10:00:02.000Z", toolName: "Read B", toolInvocationId: "reused",
      lifecyclePhase: "result", success: false }),
  ];

  const occurrences = deduplicateLifecycleEvents(input);

  assert.equal(occurrences.length, 2);
  assert.deepEqual(occurrences.map((item) => [item.toolName, item.success]), [
    ["Read B", false],
    ["Read A", true],
  ]);
  assert.equal(buildToolCallTrace(input).totalCalls, 2);
});

test("lifecycle occurrence boundaries preserve duplicate and incomplete telemetry controls", () => {
  const occurrenceCount = (phases, timestamps) => deduplicateLifecycleEvents(phases.map((lifecyclePhase, index) =>
    event({
      timestamp: timestamps[index],
      toolName: "Read",
      toolInvocationId: "reused",
      lifecyclePhase,
      success: lifecyclePhase === "result",
    }))).length;
  const equalTimestampEvents = ["request", "result", "request", "result"].map((lifecyclePhase) => event({
    timestamp: "2026-07-10T10:00:00.000Z",
    toolName: "Read",
    toolInvocationId: "reused",
    lifecyclePhase,
    success: lifecyclePhase === "result",
  }));

  assert.deepEqual({
    duplicateRequestTelemetry: occurrenceCount(
      ["request", "request", "result"],
      ["2026-07-10T10:00:00.000Z", "2026-07-10T10:00:01.000Z", "2026-07-10T10:00:02.000Z"],
    ),
    incompletePriorOccurrence: occurrenceCount(
      ["request", "request", "result"],
      ["2026-07-10T10:00:02.000Z", "2026-07-10T10:00:00.000Z", "2026-07-10T10:00:01.000Z"],
    ),
    equalTimestamps: deduplicateLifecycleEvents(equalTimestampEvents).length,
    equalTimestampIdsPreserved: deduplicateLifecycleEvents(equalTimestampEvents)
      .every((item) => item.toolInvocationId === "reused"),
    threeCompletedOccurrences: occurrenceCount(
      ["request", "result", "request", "result", "request", "result"],
      Array.from({ length: 6 }, (_, index) => `2026-07-10T10:00:0${index}.000Z`),
    ),
    duplicateSecondRequest: occurrenceCount(
      ["request", "result", "request", "request", "result"],
      Array.from({ length: 5 }, (_, index) => `2026-07-10T10:00:0${index}.000Z`),
    ),
  }, {
    duplicateRequestTelemetry: 1,
    incompletePriorOccurrence: 1,
    equalTimestamps: 2,
    equalTimestampIdsPreserved: true,
    threeCompletedOccurrences: 3,
    duplicateSecondRequest: 2,
  });
});

test("permission observations keep routine allows aggregate and bound real boundary evidence", () => {
  const { episodes, permissionSummary } = buildTaskEpisodes([
    event({ timestamp: "2026-07-10T10:00:00.000Z", toolName: "Bash", permissionDecision: "allowed", permissionMode: "unknown", line: 1 }),
    event({ timestamp: "2026-07-10T10:00:01.000Z", toolName: "Bash", permissionDecision: "allowed", permissionMode: "default", line: 2 }),
    event({ timestamp: "2026-07-10T10:00:02.000Z", toolName: "Bash", permissionDecision: "asked", line: 3 }),
    event({ timestamp: "2026-07-10T10:00:03.000Z", toolName: "Bash", permissionDecision: "blocked", line: 4 }),
    event({ timestamp: "2026-07-10T10:00:04.000Z", toolName: "Bash", permissionDecision: "allowed", permissionMode: "bypass_permissions", line: 5 }),
    event({ timestamp: "2026-07-10T10:00:05.000Z", toolName: "Bash", externalSideEffect: true, line: 6 }),
  ]);

  assert.deepEqual(permissionSummary, {
    observed: 6,
    routineAllowed: 2,
    prompted: 1,
    denied: 1,
    escalated: 1,
    protectedActions: 4,
  });
  assert.deepEqual(episodes[0].permissionSummary, {
    prompted: 1,
    denied: 1,
    escalated: 1,
    protectedActions: 4,
    evidenceRefs: [
      { kind: "fixture", line: 3, type: "tool" },
      { kind: "fixture", line: 4, type: "tool" },
      { kind: "fixture", line: 5, type: "tool" },
    ],
  });
  assert.equal("permissionDecisions" in episodes[0], false);
});

test("idle gaps split implicit episodes while explicit continuation remains stable", () => {
  const { episodes } = buildTaskEpisodes([
    event({ timestamp: "2026-07-10T10:00:00.000Z", toolName: "Read" }),
    event({ timestamp: "2026-07-10T11:00:01.000Z", toolName: "Read" }),
  ]);
  assert.equal(episodes.length, 2);
  assert.ok(episodes.every((episode) => episode.continuation === "session-bounded"));
});

test("episode contract retains an ordered repair candidate without claiming reviewed recovery", () => {
  const { episodes } = buildTaskEpisodes([
    event({ timestamp: "2026-07-10T10:00:00.000Z", toolName: "Edit", filePath: "src/a.ts", taskEpisodeKey: "HD-43" }),
    event({ timestamp: "2026-07-10T10:00:01.000Z", validationCategory: "node --test", targetPaths: ["src/a.ts"], success: false, taskEpisodeKey: "HD-43" }),
    event({ timestamp: "2026-07-10T10:00:02.000Z", toolName: "Edit", filePath: "src/a.ts", taskEpisodeKey: "HD-43" }),
    event({ timestamp: "2026-07-10T10:00:03.000Z", validationCategory: "node --test", targetPaths: ["src/a.ts"], success: true, taskEpisodeKey: "HD-43" }),
  ]);

  assert.equal(episodes[0].repair.status, "review-required");
  assert.equal(episodes[0].repair.candidates.length, 1);
  assert.equal(episodes[0].repair.candidates[0].sameCheck, true);
  assert.equal(episodes[0].closure.status, "unobserved");
});

test("protective Hook blocks are not classified as execution friction", () => {
  assert.deepEqual(
    classifyExecutionSignal({ hookDecision: "blocked", success: false }),
    { kind: "protective-intervention", confidence: "Medium" },
  );
  assert.deepEqual(
    classifyExecutionSignal({ hookDecision: "blocked", policyOutcome: "false-positive", success: false }),
    { kind: "protective-false-positive", confidence: "High" },
  );
  assert.deepEqual(
    classifyExecutionSignal({ success: false }),
    { kind: "execution-friction", confidence: "Observed" },
  );
});

test("observation manifests are replayable, omit private paths, and label latest-N as low confidence", () => {
  const options = {
    scope: {
      platform: "qoder",
      workspace: "/Users/example/private-project",
      since: "2026-07-01",
      until: "2026-07-10",
    },
    sources: [{
      id: "qoder-projects",
      kind: "project-jsonl",
      path: "/Users/example/.qoder/projects/private-project",
      enabled: true,
      exists: true,
      optional: true,
      workspaceScoped: true,
    }],
    warnings: [{ code: "missing-optional-root" }],
    eligibleCount: 80,
    analyzedCount: 20,
    selectionStrategy: "latest-n",
    adapterVersion: "fixture-adapter-v2",
    generatedAt: "2026-07-10T12:00:00.000Z",
  };
  const first = buildObservationManifest(options);
  const second = buildObservationManifest(options);

  assert.deepEqual(first, second);
  assert.equal(first.selection.confidence, "Low");
  assert.equal(first.selection.representative, false);
  assert.equal(JSON.stringify(first).includes("/Users/example"), false);
  assert.equal(first.sources.fingerprint.length, 16);
});

test("insights report temporal validation separately from episode-relevant closure", () => {
  const pack = buildInsightPack({
    scope: { platform: "qoder", workspace: "/workspace/project" },
    sources: [],
    facets: { sessionCount: 1, analyzedSessionCount: 1 },
    events: [
      event({ timestamp: "2026-07-10T10:00:00.000Z", type: "user" }),
      event({ timestamp: "2026-07-10T10:00:01.000Z", toolName: "Edit", filePath: "src/a.ts" }),
      event({ timestamp: "2026-07-10T10:00:02.000Z", validationCategory: "node --test", success: true }),
    ],
  });

  assert.equal(pack.keySignals.validationAfterEdit.status, "validated-after-edit");
  assert.equal(pack.keySignals.validationAfterEdit.relevanceStatus, "unobserved");
  assert.equal(pack.episodeSummary.closure.closedEpisodeCount, 0);
  assert.equal(pack.manifest.selection.confidence, "High");
});

test("post-edit action candidates require at least five project edit events", () => {
  const packFor = (editCount) => buildInsightPack({
    scope: { platform: "qoder", workspace: "/workspace/project" },
    sources: [],
    facets: { sessionCount: 1, analyzedSessionCount: 1 },
    events: [
      event({ timestamp: "2026-07-10T10:00:00.000Z", type: "user" }),
      ...Array.from({ length: editCount }, (_, index) => event({
        timestamp: `2026-07-10T10:00:${String(index + 1).padStart(2, "0")}.000Z`,
        toolName: "Edit",
        filePath: `src/file-${index + 1}.ts`,
      })),
    ],
  });

  const small = packFor(4);
  const reviewable = packFor(5);
  assert.equal(small.keySignals.validationAfterEdit.editCount, 4);
  assert.equal(small.actionCandidates.some((item) => item.kind === "post-edit-validation-review"), false);
  assert.match(
    small.cards.find((card) => card.id === "post-edit-validation").behaviorChange,
    /fewer than five project edit events is too small/,
  );
  assert.equal(reviewable.keySignals.validationAfterEdit.editCount, 5);
  assert.equal(reviewable.actionCandidates.some((item) => item.kind === "post-edit-validation-review"), true);
  assert.match(
    reviewable.actionCandidates.find((item) => item.kind === "post-edit-validation-review").action,
    /Harness session-evidence review.*affected Task Episodes.*later relevant validation/,
  );
});

test("review-trigger Stop hook is recorded as a validation event", () => {
  const { episodes } = buildTaskEpisodes([
    event({ timestamp: "2026-07-10T10:00:00.000Z", toolName: "Edit", filePath: "src/a.ts" }),
    event({
      timestamp: "2026-07-10T10:00:01.000Z",
      toolName: "Bash",
      commandText: "node scripts/review-trigger/cli.mjs --mode=stop --json",
      success: true,
    }),
  ]);

  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].validationSets.length, 1);
  assert.equal(episodes[0].validationSets[0].category, "review-trigger");
  assert.equal(episodes[0].validationSets[0].status, "passed");
});
