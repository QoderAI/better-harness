import assert from "node:assert/strict";
import test from "node:test";

import { buildTaskEpisodes } from "../scripts/session-analysis/episode-contract.mjs";
import {
  finalizeSessionCoreFacts,
  MAX_EPISODE_CHECKS,
  MAX_EPISODE_FACT_LIMIT,
  MAX_EPISODE_LIFECYCLE_SIGNALS,
  MAX_EPISODE_MECHANISMS,
  MAX_EPISODE_WORK_TRACE_STEPS,
  MAX_SESSION_CORE_FACT_BYTES,
  MAX_SESSION_CORE_FACT_TOKENS,
} from "../scripts/session-analysis/episode-facts.mjs";
import {
  createFactsRunContext,
  factsHydrationLimit,
  prepareFactsSessionInventory,
} from "../scripts/session-analysis/session-core-facts.mjs";

const BASE_TIME = Date.parse("2026-07-18T10:00:00.000Z");

function at(offsetSeconds) {
  return new Date(BASE_TIME + offsetSeconds * 1_000).toISOString();
}

function event({
  sessionId = "session-fixture",
  taskEpisodeKey = "task-fixture",
  timestamp = at(0),
  type = "tool",
  ...rest
} = {}) {
  return {
    sessionId,
    taskEpisodeKey,
    timestamp,
    type,
    evidenceRef: { kind: "fixture", line: offsetLine(timestamp) },
    ...rest,
  };
}

function offsetLine(timestamp) {
  const millis = Date.parse(timestamp);
  return Number.isNaN(millis)
    ? 1
    : Math.max(1, Math.trunc((millis - BASE_TIME) / 1_000) + 1);
}

function buildFacts(events, options = {}) {
  return buildTaskEpisodes(events, {
    includeEpisodeFacts: true,
    includeEpisodeFactDebug: options.debug === true,
    episodeFactLimit: options.limit,
    platform: "codex",
  }).episodeFacts;
}

function finalize(episodeFacts, { maxBytes } = {}) {
  return finalizeSessionCoreFacts({
    scope: {
      platform: "codex",
      workspaceSlug: "fixture-workspace",
      until: "2026-07-18T11:00:00.000Z",
    },
    selection: {
      strategy: "recent",
      eligibleCount: 7,
      selectedCount: 7,
      sampled: false,
    },
    episodeFacts,
    warnings: [{ code: "fixture-warning" }],
    ...(maxBytes ? { maxBytes } : {}),
  });
}

function collectObjectKeys(value, result = []) {
  if (!value || typeof value !== "object") return result;
  if (Array.isArray(value)) {
    for (const item of value) collectObjectKeys(item, result);
    return result;
  }
  for (const [key, nested] of Object.entries(value)) {
    result.push(key);
    collectObjectKeys(nested, result);
  }
  return result;
}

test("core facts keep a privacy-safe request summary without raw paths, ids, or secrets", () => {
  const absolutePath = "/Users/alice/private-work/acme/src/private-config.ts";
  const relativePath = "../config/private.json";
  const secretValue = "sk-live_SUPERSECRET1234567890";
  const rawId = "123e4567-e89b-42d3-a456-426614174000";
  const rawRequest = [
    "Please update",
    absolutePath,
    "and",
    relativePath,
    `with api_key=${secretValue}`,
    `for ${rawId}`,
  ].join(" ");

  const facts = buildFacts([
    event({ type: "user", userText: rawRequest }),
    event({ timestamp: at(1), toolName: "Edit", filePath: absolutePath }),
  ]);

  assert.equal(facts.schemaVersion, 2);
  assert.equal(facts.entries.length, 1);
  const summary = facts.entries[0].request.summary;
  assert.match(summary, /<path>/u);
  assert.match(summary, /<(?:redacted|secret)>/u);
  assert.match(summary, /<id>/u);
  assert.equal(summary.includes(absolutePath), false);
  assert.equal(summary.includes(relativePath), false);
  assert.equal(summary.includes(secretValue), false);
  assert.equal(summary.includes(rawId), false);

  const envelope = finalize(facts);
  assert.equal(envelope.schemaVersion, 3);
  const serialized = JSON.stringify(envelope);
  for (const privateValue of [rawRequest, absolutePath, relativePath, secretValue, rawId]) {
    assert.equal(serialized.includes(privateValue), false, privateValue);
  }
});

test("debug facts expose only explicit local session locators and keep aggregate coverage separate", () => {
  const sessionId = "session-local-debug-123";
  const facts = buildFacts([
    event({
      sessionId,
      type: "user",
      userText: "Update the parser and run the focused validation",
    }),
    event({ sessionId, timestamp: at(1), toolName: "Edit", filePath: "src/parser.js" }),
  ], { debug: true });

  const envelope = finalize(facts);
  assert.deepEqual(envelope.admission, {
    taskEpisodes: 1,
    candidateEpisodes: 1,
    distinctRequests: 1,
    emittedCandidates: 1,
  });
  assert.equal(envelope.populationCoverage.withChanges, 1);
  assert.equal(envelope.observationCoverage.withChanges, 1);
  assert.deepEqual(envelope.debug, {
    privacy: "local-operator-only",
    exposes: ["sessionIds"],
    locators: [{
      ref: "E1",
      requestKey: facts.entries[0].request.key,
      sessionIds: [sessionId],
    }],
  });
  assert.equal(envelope.excludes.includes("rawIds"), false);
});

test("core facts keep one sanitized follow-up without inventing zero read evidence", () => {
  const privatePath = "../private/follow-up.ts";
  const secretValue = "ghp_PRIVATEFOLLOWUP99887766";
  const facts = buildFacts([
    event({
      type: "user",
      userText: "Update the project lint configuration and verify the affected source file",
    }),
    event({ timestamp: at(1), toolName: "Edit", filePath: "src/app.js" }),
    event({
      timestamp: at(2),
      type: "user",
      userText: `Also check ${privatePath} with token=${secretValue}`,
    }),
    event({ timestamp: at(3), toolName: "exec_command" }),
  ]);

  assert.equal(facts.entries.length, 1);
  assert.match(facts.entries[0].request.followUp, /Also check <path> with token=<(?:redacted|secret)>/u);
  assert.equal(facts.entries[0].request.followUp.includes(privatePath), false);
  assert.equal(facts.entries[0].request.followUp.includes(secretValue), false);
  assert.equal(facts.entries[0].request.observedTurns, 2);
  assert.equal(facts.entries[0].request.omittedTurns, 0);
  assert.ok(facts.entries[0].activity.toolCalls > 0);
  assert.equal(Object.hasOwn(facts.entries[0].activity, "classifiedReads"), false);
});

test("core facts retain one informative intermediate turn and report compressed turns", () => {
  const facts = buildFacts([
    event({ type: "user", userText: "Refactor the report workflow without changing its output contract" }),
    event({ timestamp: at(1), type: "user", userText: "Keep it in English" }),
    event({
      timestamp: at(2),
      type: "user",
      userText: "Preserve the existing validator, keep the report schema backward compatible, and run the focused owner-chain tests",
    }),
    event({
      timestamp: at(3),
      type: "user",
      userText: "Preserve the existing validator, keep the report schema backward compatible, and run the focused owner-chain tests",
    }),
    event({ timestamp: at(4), type: "user", userText: "Use the smallest owner change" }),
    event({ timestamp: at(5), toolName: "Edit", filePath: "src/report.js" }),
  ]);

  assert.equal(facts.entries.length, 1);
  assert.equal(
    facts.entries[0].request.intermediate,
    "Preserve the existing validator, keep the report schema backward compatible, and run the focused owner-chain tests",
  );
  assert.equal(facts.entries[0].request.followUp, "Use the smallest owner change");
  assert.equal(facts.entries[0].request.observedTurns, 4);
  assert.equal(facts.entries[0].request.omittedTurns, 1);
});

test("core facts exclude host envelopes before choosing request evidence", () => {
  const facts = buildFacts([
    event({
      type: "user",
      userText: "<turn_aborted>The user interrupted the previous turn on purpose.</turn_aborted>",
    }),
    event({
      timestamp: at(1),
      type: "user",
      userText: "The following is the Codex agent history added since your last approval assessment. Continue the same review conversation.",
    }),
    event({ timestamp: at(2), type: "user", userText: "Repair the bounded request evidence selector" }),
    event({ timestamp: at(3), toolName: "Edit", filePath: "src/request.js" }),
  ]);

  assert.equal(facts.entries.length, 1);
  assert.equal(facts.entries[0].request.summary, "Repair the bounded request evidence selector");
  assert.equal(facts.entries[0].request.observedTurns, 1);
  assert.equal(facts.entries[0].request.omittedTurns, 0);
  assert.doesNotMatch(JSON.stringify(facts), /turn_aborted|Codex agent history/u);
});

test("core facts ignore provider meta turns and local command envelopes", () => {
  const facts = buildFacts([
    event({
      type: "user",
      userInputMeta: true,
      userText: "# Plugin Testing\n\nUse this workflow to verify a plugin.",
    }),
    event({
      timestamp: at(1),
      type: "user",
      userText: "<command-name>/model</command-name><command-message>model</command-message><command-args></command-args>",
    }),
    event({ timestamp: at(2), type: "user", userText: "Add a marketplace manifest for this plugin" }),
    event({ timestamp: at(3), type: "user", userText: "[{\"type\":\"text\",\"text\":\"[Request interrupted by user]\"}]" }),
    event({ timestamp: at(4), toolName: "Edit", filePath: ".qoder/marketplace.json" }),
  ]);

  assert.equal(facts.entries.length, 1);
  assert.equal(facts.entries[0].request.summary, "Add a marketplace manifest for this plugin");
  assert.equal(facts.entries[0].request.observedTurns, 1);
});

test("core facts preserve Markdown labels while removing private link targets", () => {
  const skillTarget = "skill://private/skill-creator/SKILL.md";
  const documentTarget = "../private/report-contract.md";
  const facts = buildFacts([
    event({
      type: "user",
      userText: `[$skill-creator](${skillTarget}) review [the report contract](${documentTarget})`,
    }),
    event({ timestamp: at(1), toolName: "Edit", filePath: "src/report.js" }),
  ]);

  assert.equal(facts.entries.length, 1);
  assert.equal(facts.entries[0].request.summary, "$skill-creator review the report contract");
  assert.equal(facts.entries[0].request.summary.includes(skillTarget), false);
  assert.equal(facts.entries[0].request.summary.includes(documentTarget), false);
});

test("core facts trim appended role transcripts and paths after Unicode punctuation", () => {
  const privatePath = "/Users/alice/private/acme/src/report.ts";
  const facts = buildFacts([
    event({
      type: "user",
      userText: `Remove the popup hint？${privatePath} [2] assistant: I will inspect it. [3] tool result: private output`,
    }),
    event({ timestamp: at(1), toolName: "Edit", filePath: "src/report.ts" }),
  ]);

  assert.equal(facts.entries.length, 1);
  assert.equal(facts.entries[0].request.summary, "Remove the popup hint？<path>");
  assert.equal(facts.entries[0].request.observedTurns, 1);
  assert.equal(facts.entries[0].request.omittedTurns, 0);
  assert.doesNotMatch(JSON.stringify(facts), /assistant:|tool result:|private output/u);
});

test("core facts compress screenshot-style tool flow into a typed work trace", () => {
  const privatePath = "/pennylane/tests/measurements/test_sample.py";
  const assistantReasoning = "I need to inspect line 509 before adding process_count tests.";
  const rawToolResult = `Contents of ${privatePath}, from line 1-509`;
  const assistantHandoff = "The private implementation and test details are complete.";
  const facts = buildFacts([
    event({ type: "user", userText: "Add process count coverage to the measurement tests" }),
    event({ timestamp: at(1), toolName: "SearchReplace", filePath: privatePath }),
    event({ timestamp: at(2), type: "assistant", content: assistantReasoning }),
    event({
      timestamp: at(3),
      toolName: "Read",
      filePath: privatePath,
      toolOutput: rawToolResult,
    }),
    event({ timestamp: at(4), toolName: "SearchReplace", filePath: privatePath }),
    event({
      timestamp: at(5),
      validationCategory: "focused-test",
      reviewedAssociation: true,
      success: true,
    }),
    event({
      timestamp: at(6),
      type: "assistant",
      userVisibleAssistantMessage: true,
      content: assistantHandoff,
    }),
  ]);

  const candidate = facts.entries[0];
  assert.deepEqual(candidate.workTrace, {
    steps: ["change", "inspect", "change", "check", "handoff"],
  });
  assert.deepEqual(candidate.changes, { edits: 2, files: 1 });
  assert.deepEqual(candidate.activity, { toolCalls: 3, classifiedReads: 1 });
  const serialized = JSON.stringify(finalize(facts));
  assert.equal(serialized.includes(privatePath), false);
  assert.equal(serialized.includes(assistantReasoning), false);
  assert.equal(serialized.includes(rawToolResult), false);
  assert.equal(serialized.includes(assistantHandoff), false);
  assert.equal(serialized.includes("SearchReplace"), false);
});

test("core work trace preserves its edges and reports omitted middle transitions", () => {
  const facts = buildFacts([
    event({ type: "user", userText: "Iterate on the parser and verify the result" }),
    event({ timestamp: at(1), toolName: "Read", filePath: "src/parser.js" }),
    event({ timestamp: at(2), toolName: "Edit", filePath: "src/parser.js" }),
    event({ timestamp: at(3), toolName: "Read", filePath: "src/parser.js" }),
    event({ timestamp: at(4), toolName: "Edit", filePath: "src/parser.js" }),
    event({ timestamp: at(5), toolName: "Bash" }),
    event({ timestamp: at(6), toolName: "Read", filePath: "test/parser.test.js" }),
    event({ timestamp: at(7), toolName: "Edit", filePath: "test/parser.test.js" }),
    event({ timestamp: at(8), validationCategory: "focused-test", success: true }),
    event({ timestamp: at(9), type: "assistant", userVisibleAssistantMessage: true }),
  ]);

  assert.deepEqual(facts.entries[0].workTrace, {
    steps: ["inspect", "change", "inspect", "change", "check", "handoff"],
    gapAfter: 3,
    omittedSteps: 3,
  });
  assert.equal(facts.entries[0].workTrace.steps.length, MAX_EPISODE_WORK_TRACE_STEPS);
});

test("core work trace classifies command-derived validation as check", () => {
  const facts = buildFacts([
    event({ type: "user", userText: "Update the parser and run its tests" }),
    event({ timestamp: at(1), toolName: "Edit", filePath: "src/parser.js" }),
    event({
      timestamp: at(2),
      toolName: "Bash",
      commandText: "npm test",
      success: true,
    }),
    event({ timestamp: at(3), type: "assistant", userVisibleAssistantMessage: true }),
  ]);

  assert.deepEqual(facts.entries[0].workTrace, {
    steps: ["change", "check", "handoff"],
  });
  assert.equal(facts.entries[0].checks[0].kind, "npm-test");
});

test("core facts recognize Better Harness agent-lint as validation", () => {
  for (const commandText of [
    "better-harness agent-lint --workspace . --profile agents-md-review --provider qoder --json",
    "node /opt/better-harness/scripts/better-harness.mjs agent-lint --workspace . --json",
  ]) {
    const facts = buildFacts([
      event({ type: "user", userText: "Repair the agent guidance and validate it" }),
      event({ timestamp: at(1), toolName: "Edit", filePath: "AGENTS.md" }),
      event({ timestamp: at(2), toolName: "Bash", commandText, success: true }),
      event({ timestamp: at(3), type: "assistant", userVisibleAssistantMessage: true }),
    ]);

    assert.equal(facts.entries[0].checks[0].kind, "agent-lint");
    assert.equal(facts.entries[0].checks[0].status, "passed");
  }
});

test("core work trace retains provider-normalized edit operations without tool names", () => {
  const facts = buildFacts([
    event({ type: "user", userText: "Update the generated parser fixture" }),
    event({ timestamp: at(1), operation: "edit", affectedPaths: ["test/parser.fixture.js"] }),
    event({ timestamp: at(2), type: "assistant", userVisibleAssistantMessage: true }),
  ]);

  assert.deepEqual(facts.entries[0].workTrace, { steps: ["change", "handoff"] });
  assert.deepEqual(facts.entries[0].changes, { edits: 1, files: 1 });
});

test("core facts preserve ordered parsed lint failure-to-pass checks", () => {
  const facts = buildFacts([
    event({ type: "user", userText: "Make the lint check pass" }),
    event({ timestamp: at(1), toolName: "Edit", filePath: "src/app.js" }),
    event({
      timestamp: at(2),
      validationCategory: "lint",
      targetPaths: ["src/app.js"],
      reviewedAssociation: true,
      success: false,
      resultFacts: { errors: 3, warnings: 2 },
    }),
    event({ timestamp: at(3), toolName: "Edit", filePath: "src/app.js" }),
    event({
      timestamp: at(4),
      validationCategory: "lint",
      targetPaths: ["src/app.js"],
      reviewedAssociation: true,
      success: true,
      resultFacts: { errors: 0, warnings: 0 },
    }),
  ]);

  assert.deepEqual(facts.entries[0].checks, [
    {
      kind: "lint",
      status: "failed",
      relation: "not-after-final-change",
      counts: { errors: 3, warnings: 2 },
      countQuality: "parsed",
    },
    {
      kind: "lint",
      status: "passed",
      relation: "reviewed-relevant-after-change",
      counts: { errors: 0, warnings: 0 },
      countQuality: "parsed",
    },
  ]);
  assert.equal(facts.entries[0].closure, "relevant-check-passed");
  assert.equal(facts.entries[0].repair, "failure-edit-rerun-candidate");
  assert.deepEqual(facts.entries[0].frictionConsequenceSignals, [
    "failed-check",
    "repair-lead",
  ]);
});

test("assistant prose and raw tool output cannot supply diagnostic counts", () => {
  const assistantClaim = "I found 97 errors and 31 warnings.";
  const rawOutput = "The linter probably reported 53 errors and 29 warnings.";
  const facts = buildFacts([
    event({ type: "user", userText: "Check the current lint failure" }),
    event({ timestamp: at(1), toolName: "Edit", filePath: "src/app.js" }),
    event({ timestamp: at(2), type: "assistant", content: assistantClaim }),
    event({
      timestamp: at(3),
      validationCategory: "lint",
      targetPaths: ["src/app.js"],
      reviewedAssociation: true,
      success: false,
      toolOutput: rawOutput,
    }),
  ]);

  assert.deepEqual(facts.entries[0].checks, [
    {
      kind: "lint",
      status: "failed",
      relation: "reviewed-relevant-after-change",
      countQuality: "unavailable",
    },
  ]);
  const serialized = JSON.stringify(finalize(facts));
  assert.equal(serialized.includes(assistantClaim), false);
  assert.equal(serialized.includes(rawOutput), false);
  assert.equal(serialized.includes("97"), false);
  assert.equal(serialized.includes("53 errors"), false);
});

test("unreviewed post-change checks remain useful leads without becoming relevant closure", () => {
  const facts = buildFacts([
    event({ type: "user", userText: "Update the parser and run the focused test" }),
    event({ timestamp: at(1), toolName: "Edit", filePath: "src/parser.js" }),
    event({
      timestamp: at(2),
      validationCategory: "test",
      targetPaths: ["src/parser.js"],
      success: true,
      resultFacts: { testsPassed: 4, testsFailed: 0 },
    }),
  ]);

  assert.equal(facts.entries[0].closure, "check-observed-relevance-unresolved");
  assert.equal(facts.entries[0].checks[0].relation, "after-final-change-unreviewed");
  assert.deepEqual(facts.entries[0].evidenceClasses, [
    "validation-repair",
    "lifecycle-demand",
  ]);
  assert.equal(facts.candidateSelection.strategy, "agent-work-loop-portfolio-v1");
  assert.deepEqual(facts.candidateSelection.emittedClasses, {
    "validation-repair": 1,
    "lifecycle-demand": 1,
  });

  const withoutCheck = buildFacts([
    event({ type: "user", userText: "Update the parser without a requested test" }),
    event({ timestamp: at(1), toolName: "Edit", filePath: "src/parser.js" }),
  ]);
  assert.equal(withoutCheck.entries[0].closure, "changed-without-check");
  assert.deepEqual(withoutCheck.entries[0].evidenceClasses, ["change-gap"]);
});

test("closure uses episode order when timestamps are missing or equal", () => {
  for (const timestamp of [null, at(1)]) {
    const beforeChange = buildFacts([
      event({ timestamp, type: "user", userText: "Run the check, then update the parser" }),
      event({ timestamp, validationCategory: "test", reviewedAssociation: true, success: true }),
      event({ timestamp, toolName: "Edit", filePath: "src/parser.js" }),
    ]);
    assert.equal(beforeChange.entries[0].checks[0].relation, "not-after-final-change");
    assert.equal(beforeChange.entries[0].closure, "check-observed-relevance-unresolved");

    const afterChange = buildFacts([
      event({ timestamp, type: "user", userText: "Update the parser, then run the check" }),
      event({ timestamp, toolName: "Edit", filePath: "src/parser.js" }),
      event({ timestamp, validationCategory: "test", reviewedAssociation: true, success: true }),
    ]);
    assert.equal(afterChange.entries[0].checks[0].relation, "reviewed-relevant-after-change");
    assert.equal(afterChange.entries[0].closure, "relevant-check-passed");
  }
});

test("closure fails closed when change and validation timestamp availability differs", () => {
  const facts = buildFacts([
    event({ type: "user", userText: "Run the check before updating the parser" }),
    event({ timestamp: null, validationCategory: "test", reviewedAssociation: true, success: true }),
    event({ timestamp: at(2), toolName: "Edit", filePath: "src/parser.js" }),
  ]);

  assert.equal(facts.entries[0].checks[0].relation, "not-after-final-change");
  assert.equal(facts.entries[0].closure, "check-observed-relevance-unresolved");
});

test("repair detection uses episode order when timestamps are missing or equal", () => {
  for (const timestamp of [null, at(1)]) {
    const facts = buildFacts([
      event({ timestamp, type: "user", userText: "Repair and rerun the focused test" }),
      event({ timestamp, validationCategory: "focused-test", success: false }),
      event({ timestamp, toolName: "Edit", filePath: "src/parser.js" }),
      event({
        timestamp,
        validationCategory: "focused-test",
        reviewedAssociation: true,
        success: true,
      }),
    ]);

    assert.equal(facts.entries[0].repair, "failure-edit-rerun-candidate");
    assert.deepEqual(facts.entries[0].checks.map(({ status, relation }) => ({ status, relation })), [
      { status: "failed", relation: "not-after-final-change" },
      { status: "passed", relation: "reviewed-relevant-after-change" },
    ]);
    assert.equal(facts.entries[0].closure, "relevant-check-passed");
  }
});

test("checks without a change keep no-change closure context", () => {
  const facts = buildFacts([
    event({ type: "user", userText: "Run the focused test without changing code" }),
    event({ timestamp: at(1), validationCategory: "test", success: true }),
  ]);

  assert.equal(facts.entries[0].checks[0].relation, "no-change-context");
  assert.equal(facts.entries[0].closure, "no-change-observed");
});

test("bounded checks preserve the observed repair failure and rerun endpoints", () => {
  const facts = buildFacts([
    event({ type: "user", userText: "Repair the focused test and verify the final change" }),
    event({ timestamp: at(1), toolName: "Edit", filePath: "src/parser.js" }),
    event({ timestamp: at(2), validationCategory: "preflight", success: true }),
    event({ timestamp: at(3), validationCategory: "focused-test", success: false }),
    event({ timestamp: at(4), toolName: "Edit", filePath: "src/parser.js" }),
    event({
      timestamp: at(5),
      validationCategory: "focused-test",
      reviewedAssociation: true,
      success: true,
    }),
    event({ timestamp: at(6), validationCategory: "lint", success: true }),
    event({ timestamp: at(7), validationCategory: "typecheck", success: true }),
    event({ timestamp: at(8), validationCategory: "docs", success: true }),
  ]);

  const candidate = facts.entries[0];
  assert.equal(candidate.repair, "failure-edit-rerun-candidate");
  assert.deepEqual(candidate.checks.map(({ kind, status }) => ({ kind, status })), [
    { kind: "preflight", status: "passed" },
    { kind: "focused-test", status: "failed" },
    { kind: "focused-test", status: "passed" },
    { kind: "docs", status: "passed" },
  ]);
  assert.equal(candidate.omittedChecks, 2);
});

test("observation coverage retains reviewed relevance hidden by check-detail budget", () => {
  const events = [
    event({ type: "user", userText: "Update the parser and verify the final behavior" }),
    event({ timestamp: at(1), toolName: "Edit", filePath: "src/parser.js" }),
  ];
  for (let index = 0; index < 6; index += 1) {
    events.push(event({
      timestamp: at(index + 2),
      validationCategory: `check-${index + 1}`,
      reviewedAssociation: index === 2,
      success: true,
    }));
  }

  const facts = buildFacts(events);
  const candidate = facts.entries[0];
  assert.equal(candidate.checks.length, MAX_EPISODE_CHECKS);
  assert.equal(candidate.checks.some((check) => check.kind === "check-3"), false);
  assert.equal(candidate.acceptanceSignals.includes("reviewed-relevant-check"), true);
  assert.equal(finalize(facts).observationCoverage.withReviewedRelevantCheck, 1);
});

test("Agent Work Loop portfolio resists validation-volume starvation and covers distinct evidence", () => {
  const events = [];
  const add = (task, offset, userText, observations) => {
    events.push(event({
      sessionId: `session-${task}`,
      taskEpisodeKey: `task-${task}`,
      timestamp: at(offset),
      type: "user",
      userText,
    }));
    observations.forEach((observation, index) => events.push(event({
      sessionId: `session-${task}`,
      taskEpisodeKey: `task-${task}`,
      timestamp: at(offset + index + 1),
      ...observation,
    })));
  };

  add("busy", 0, "Inspect the busy validation task", [
    { validationCategory: "test", success: true },
    { validationCategory: "test", success: true },
    { validationCategory: "test", success: true },
    { validationCategory: "test", success: true },
    { toolName: "Edit", filePath: "src/busy.js" },
  ]);
  add("lead-one", 20, "Update the first behavior and verify it", [
    { toolName: "Edit", filePath: "src/one.js" },
    { validationCategory: "test", success: true },
  ]);
  add("lead-two", 40, "Update the second behavior and verify it", [
    { toolName: "Edit", filePath: "src/two.js" },
    { validationCategory: "lint", success: false },
  ]);
  add("control", 60, "Inspect the protected operation", [
    {
      permissionDecision: "denied",
      permissionMode: "escalated",
      protectedAction: true,
      success: false,
    },
  ]);
  add("gap", 80, "Update the uncovered behavior", [
    { toolName: "Edit", filePath: "src/gap.js" },
  ]);
  add("read", 100, "Inspect the implementation before deciding", [
    { toolName: "Read", filePath: "src/read.js" },
  ]);

  const limited = buildFacts(events, { limit: 5 });
  const summaries = limited.entries.map((candidate) => candidate.request.summary);
  assert.equal(summaries.some((summary) => summary.includes("busy validation")), false);
  assert.equal(summaries.some((summary) => summary.includes("first behavior")), true);
  assert.equal(summaries.some((summary) => summary.includes("second behavior")), true);
  assert.equal(summaries.some((summary) => summary.includes("protected operation")), true);
  assert.equal(summaries.some((summary) => summary.includes("uncovered behavior")), true);
  assert.equal(summaries.some((summary) => summary.includes("Inspect the implementation")), true);
  assert.deepEqual(limited.candidateSelection.emittedClasses, {
    "validation-repair": 2,
    "operation-control": 1,
    "change-gap": 1,
    "read-only-work": 1,
  });
});

test("lifecycle and assistant handoff observations stay bounded navigation facts", () => {
  const assistantText = "Private delivery details that must not leave the transcript.";
  const facts = buildFacts([
    event({
      type: "user",
      userText: "Plan the implementation work before changing the project",
    }),
    event({ timestamp: at(1), toolName: "Read", filePath: "src/app.js" }),
    event({
      timestamp: at(2),
      type: "assistant",
      userVisibleAssistantMessage: true,
      content: assistantText,
    }),
  ]);

  const candidate = facts.entries[0];
  assert.equal(candidate.lifecycle.length <= MAX_EPISODE_LIFECYCLE_SIGNALS, true);
  assert.deepEqual(candidate.lifecycle[0], {
    intent: "task-planning",
    family: "planning",
    dimensionId: "task-understanding",
    checkId: "scope-boundary",
    confidence: "High",
  });
  assert.deepEqual(candidate.result, { assistantHandoffObserved: true });
  assert.deepEqual(candidate.acceptanceSignals, ["assistant-handoff"]);
  assert.equal(candidate.acceptanceEvidenceCeiling, "lead");
  assert.deepEqual(candidate.frictionConsequenceSignals, []);
  assert.equal(candidate.evidenceClasses.includes("lifecycle-demand"), true);
  assert.equal(candidate.evidenceClasses.includes("delivery-recovery"), false);
  assert.equal(candidate.closure, "no-change-observed");
  const envelope = finalize(facts);
  assert.deepEqual(envelope.observationCoverage, {
    withChanges: 0,
    withChecks: 0,
    withReviewedRelevantCheck: 0,
    withResultSignal: 1,
    withAssistantHandoff: 1,
    withStructuredCompletion: 0,
    withUserCorrection: 0,
    withExecutionFriction: 0,
    withFrictionConsequence: 0,
  });
  assert.equal(JSON.stringify(envelope).includes(assistantText), false);

  const reasoningOnly = buildFacts([
    event({ type: "user", userText: "Inspect the implementation before answering" }),
    event({ timestamp: at(1), toolName: "Read", filePath: "src/app.js" }),
    event({ timestamp: at(2), type: "assistant", content: "private reasoning" }),
  ]);
  assert.equal("result" in reasoningOnly.entries[0], false);
  assert.equal(reasoningOnly.entries[0].acceptanceEvidenceCeiling, "unobserved");
});

test("admission support requires shared consequences across distinct candidates", () => {
  const failedEpisode = (sessionId, taskEpisodeKey, offset, request) => [
    event({ sessionId, taskEpisodeKey, timestamp: at(offset), type: "user", userText: request }),
    event({
      sessionId,
      taskEpisodeKey,
      timestamp: at(offset + 1),
      validationCategory: "focused-test",
      success: false,
    }),
  ];
  const facts = buildFacts([
    ...failedEpisode("session-one", "task-one", 0, "Verify the first protected change"),
    ...failedEpisode("session-two", "task-two", 10, "Verify the second protected change"),
  ]);
  const envelope = finalize(facts);

  assert.deepEqual(envelope.admissionSupport, {
    semanticGuardrails: [
      "occurrences-not-distinct-episodes",
      "coverage-not-suggestion",
      "omitted-details-not-signal-evidence",
      "project-capability-inventory-unobserved",
    ],
    sharedFrictionConsequences: [{
      signal: "failed-check",
      episodeRefs: ["E1", "E2"],
    }],
  });
  const budgetedEnvelope = finalize(facts, { maxBytes: 1_500 });
  const retainedRefs = new Set(budgetedEnvelope.candidates.map((candidate) => candidate.ref));
  assert.equal(budgetedEnvelope.admissionSupport.sharedFrictionConsequences
    .every((row) => row.episodeRefs.every((ref) => retainedRefs.has(ref))), true);

  const duplicateFacts = buildFacts([
    ...failedEpisode("session-three", "task-three", 20, "Verify the repeated protected change"),
    ...failedEpisode("session-four", "task-four", 30, "Verify the repeated protected change"),
  ]);
  assert.equal(duplicateFacts.entries[0].request.occurrences, 2);
  assert.deepEqual(finalize(duplicateFacts).admissionSupport.sharedFrictionConsequences, []);
});

test("observation coverage reports evidence availability without semantic outcomes", () => {
  const facts = buildFacts([
    event({ type: "user", userText: "Update the parser and run its focused test" }),
    event({ timestamp: at(1), toolName: "Edit", filePath: "src/parser.js" }),
    event({
      timestamp: at(2),
      validationCategory: "focused-test",
      reviewedAssociation: true,
      success: true,
    }),
    event({ timestamp: at(3), type: "assistant", userVisibleAssistantMessage: true }),
    event({
      sessionId: "session-friction",
      taskEpisodeKey: "task-friction",
      timestamp: at(10),
      type: "user",
      userText: "Inspect the protected workflow",
    }),
    event({
      sessionId: "session-friction",
      taskEpisodeKey: "task-friction",
      timestamp: at(11),
      toolName: "Read",
      success: false,
    }),
  ]);

  assert.deepEqual(facts.entries[0].acceptanceSignals, [
    "project-change",
    "check-observed",
    "reviewed-relevant-check",
    "assistant-handoff",
  ]);
  assert.deepEqual(facts.entries[1].acceptanceSignals, []);
  assert.deepEqual(facts.entries[0].frictionConsequenceSignals, []);
  assert.deepEqual(facts.entries[1].frictionConsequenceSignals, []);
  assert.deepEqual(finalize(facts).observationCoverage, {
    withChanges: 1,
    withChecks: 1,
    withReviewedRelevantCheck: 1,
    withResultSignal: 1,
    withAssistantHandoff: 1,
    withStructuredCompletion: 0,
    withUserCorrection: 0,
    withExecutionFriction: 1,
    withFrictionConsequence: 0,
  });
});

test("explicit completion reaches delivery evidence without implying acceptance", () => {
  const facts = buildFacts([
    event({ type: "user", userText: "Inspect the implementation and complete the task" }),
    event({ timestamp: at(1), toolName: "Read", filePath: "src/app.js" }),
    event({ timestamp: at(2), type: "assistant", taskCompleted: true }),
  ]);

  assert.deepEqual(facts.entries[0].result, { structuredCompletionObserved: true });
  assert.equal(facts.entries[0].evidenceClasses.includes("delivery-recovery"), true);
  assert.equal(facts.entries[0].acceptanceEvidenceCeiling, "lead");
  assert.equal(facts.entries[0].closure, "no-change-observed");
});

test("reviewed validation plus an outcome relation permits supported evidence", () => {
  const facts = buildFacts([
    event({ type: "user", userText: "Update the parser and complete the verified change" }),
    event({ timestamp: at(1), toolName: "Edit", filePath: "src/parser.js" }),
    event({
      timestamp: at(2),
      validationCategory: "focused-test",
      reviewedAssociation: true,
      success: true,
    }),
    event({ timestamp: at(3), type: "assistant", taskCompleted: true }),
  ]);

  assert.equal(facts.entries[0].acceptanceEvidenceCeiling, "supported");
});

test("identical requests collapse to one candidate with occurrences", () => {
  const request = "Please make the formatter check pass";
  const facts = buildFacts([
    event({
      sessionId: "session-one",
      taskEpisodeKey: "task-one",
      type: "user",
      userText: request,
    }),
    event({
      sessionId: "session-one",
      taskEpisodeKey: "task-one",
      timestamp: at(1),
      toolName: "Edit",
      filePath: "src/one.js",
    }),
    event({
      sessionId: "session-two",
      taskEpisodeKey: "task-two",
      timestamp: at(10),
      type: "user",
      userText: request,
    }),
    event({
      sessionId: "session-two",
      taskEpisodeKey: "task-two",
      timestamp: at(11),
      toolName: "Edit",
      filePath: "src/two.js",
    }),
  ]);

  assert.equal(facts.candidateCount, 2);
  assert.equal(facts.distinctRequestCount, 1);
  assert.equal(facts.emittedCount, 1);
  assert.equal(facts.entries[0].request.occurrences, 2);
  assert.equal(facts.omitted.duplicateRequests, 1);
});

test("context groups expose shared provider context without session ids", () => {
  const sharedSession = "private-shared-session-id";
  const otherSession = "private-other-session-id";
  const facts = buildFacts([
    event({
      sessionId: sharedSession,
      taskEpisodeKey: "task-parent",
      type: "user",
      userText: "Warn when too many hooks are configured",
    }),
    event({
      sessionId: sharedSession,
      taskEpisodeKey: "task-parent",
      timestamp: at(1),
      toolName: "Edit",
      filePath: "src/hooks.js",
    }),
    event({
      sessionId: sharedSession,
      taskEpisodeKey: "task-refinement",
      timestamp: at(2),
      type: "user",
      userText: "Use a threshold of more than 10 hooks",
    }),
    event({
      sessionId: sharedSession,
      taskEpisodeKey: "task-refinement",
      timestamp: at(3),
      toolName: "Edit",
      filePath: "src/hooks.js",
    }),
    event({
      sessionId: otherSession,
      taskEpisodeKey: "task-unrelated",
      timestamp: at(4),
      type: "user",
      userText: "Shorten the unrelated output",
    }),
    event({
      sessionId: otherSession,
      taskEpisodeKey: "task-unrelated",
      timestamp: at(5),
      toolName: "Edit",
      filePath: "src/report.js",
    }),
  ], { limit: 5 });

  const parent = facts.entries.find((candidate) => candidate.request.summary.includes("too many hooks"));
  const refinement = facts.entries.find((candidate) => candidate.request.summary.includes("more than 10"));
  const unrelated = facts.entries.find((candidate) => candidate.request.summary.includes("unrelated output"));
  assert.equal(parent.contextGroup, refinement.contextGroup);
  assert.notEqual(parent.contextGroup, unrelated.contextGroup);
  const serialized = JSON.stringify(finalize(facts));
  assert.equal(serialized.includes(sharedSession), false);
  assert.equal(serialized.includes(otherSession), false);
});

test("requests with different numeric identities remain distinct episodes", () => {
  const facts = buildFacts([
    event({ sessionId: "session-123", taskEpisodeKey: "task-123", type: "user", userText: "Fix issue 123" }),
    event({ sessionId: "session-123", taskEpisodeKey: "task-123", timestamp: at(1), toolName: "Edit", filePath: "src/a.js" }),
    event({ sessionId: "session-456", taskEpisodeKey: "task-456", timestamp: at(10), type: "user", userText: "Fix issue 456" }),
    event({ sessionId: "session-456", taskEpisodeKey: "task-456", timestamp: at(11), toolName: "Edit", filePath: "src/b.js" }),
  ]);

  assert.equal(facts.candidateCount, 2);
  assert.equal(facts.distinctRequestCount, 2);
  assert.equal(facts.emittedCount, 2);
  assert.deepEqual(facts.entries.map((candidate) => candidate.request.occurrences), [1, 1]);
});

test("requests without material activity stay outside the facts budget", () => {
  const facts = buildFacts([
    event({ type: "user", userText: "北京天气" }),
    event({
      sessionId: "session-project-request-only",
      taskEpisodeKey: "task-project-request-only",
      timestamp: at(10),
      type: "user",
      userText: "Please review the project source code and explain the current test configuration",
    }),
  ]);

  assert.equal(facts.entries.length, 0);
  assert.equal(facts.omitted.lowSignal, 2);
});

test("generated Session Core Summary requests stay outside reusable session evidence", () => {
  const facts = buildFacts([
    event({
      type: "user",
      userText: "Before analyzing, completely read session-evidence.md. The attached JSON is the only session evidence input.",
    }),
    event({ timestamp: at(1), toolName: "Read", filePath: "skills/better-harness/references/session-evidence.md" }),
  ]);

  assert.equal(facts.entries.length, 0);
  assert.equal(facts.omitted.selfAnalysis, 1);
});

test("generated benchmark reviewer requests stay outside reusable session evidence", () => {
  const facts = buildFacts([
    event({
      type: "user",
      userText: "Benchmark second opinion for a repository. Return STRICT JSON only. Static-only benchmark mode: do not claim tests ran.",
    }),
    event({ timestamp: at(1), toolName: "Read", filePath: "README.md" }),
  ]);

  assert.equal(facts.entries.length, 0);
  assert.equal(facts.omitted.selfAnalysis, 1);
});

test("generated read-only reviewers and pass-fail judges stay outside reusable session evidence", () => {
  for (const userText of [
    "You are reviewing /tmp/spec.md as a read-only architecture reviewer. Context: proposal. Assess whether it is clear.",
    "Based only on this evidence, judge whether the Canvas change passes. Requirements: no stale title.",
  ]) {
    const facts = buildFacts([
      event({ type: "user", userText }),
      event({ timestamp: at(1), toolName: "Read", filePath: "README.md" }),
    ]);

    assert.equal(facts.entries.length, 0, userText);
    assert.equal(facts.omitted.selfAnalysis, 1, userText);
  }
});

test("generated plugin reports and exact-reply probes stay outside reusable session evidence", () => {
  for (const userText of [
    "Reply with exactly: tools-disabled-ok",
    "Reply exactly: QODER_READY",
    "第二意见 reviewer：只评这个 readiness 样例；不要声称执行测试。",
    "Use $better-harness-plugin:harness-analysis to analyze /tmp/project. Keep it bounded and read-only.",
    "Use better-harness-plugin:readiness-analysis to generate a small-sample readiness report.",
    "受控验证，不读取文件系统。目标项目的静态轮廓如下。",
    "You are validating a wording change. Use only the facts below; do not read files. Return JSON only.",
    "No tools. Based on the current style contract, output only three lines.",
    "Use better-harness:better-harness for a read-only smoke test. Do not modify files.",
    "Read-only smoke for a report template. Return PASS if the wording is correct.",
    "Inspect these files only: a.md, b.md. Do not modify files. Return JSON only with keys pass and checks. Checks: wording.",
    "No tools. Based only on this current Better Harness template excerpt: output a short verdict.",
    "Benchmark second opinion for a repo. Return STRICT JSON only, no markdown.",
    "使用 $harness-analysis 分析目标项目，并生成 Qoder Canvas 输出。",
    "You are reviewing Better Harness report style templates. Do not edit files. Check these acceptance criteria: wording.",
    "Use readiness-analysis from the installed local better-harness plugin for a minimal smoke validation. Output directory: /tmp/report. Create exactly two files.",
    "Use the better-harness:better-harness skill to analyze the target project as an AI delivery harness readiness target.",
    "使用 better-harness:better-harness 分析目标项目，并生成 Qoder Canvas 输出。",
    "# Harness Analysis\nAnalyze the target project as an AI delivery system.",
    "# Harness Default\nDefault to Agent Work Loop after a session-source probe.",
    "Use the harness-analysis skill at /tmp/harness for a read-only mini analysis of this repository.",
    "Analyze target-app as an AI Coding Harness engineering report.",
    "Run a 10-minute read-only Bavi evaluation for the current project using current Better Harness source.",
    "Use Bash only. Run a 10-minute read-only Agent Work Loop Bavi evaluation in the current project.",
    "只读验证，不要改文件。Better Harness Agent Fluency 当前规则摘要：检查 change-intake gate。",
    "Read the attached compact observability reference and project evidence only. Evaluate direct AI-debug readiness.",
    "Read the attached compact observability reference and project evidence only. Evaluate the general local runtime-debug route.",
    "# Harness `/harness` covers the outer operating system. Agent Work Loop is the evidence model.",
    "只读检查这些文件的 Exists、Routed、Applied、Used、Effective，输出 PROTOCOL_VERDICT；如果推断 Applied 或 Effective 必须失败。",
    "请执行一次只读前向验证，检查 Agent 知识资产闭环。严格区分 Exists、Routed、Applied、Used、Effective。",
    "Use better-harness:better-harness skill activation only. Reply with exactly: HARNESS_SKILL_SMOKE_OK",
    "只读取 AGENTS.md 的第一段，然后只回答 QODER_READ_OK。不要修改任何文件。",
    "Read /tmp/spec.md as a read-only architecture reviewer. Evaluate its boundaries.",
    "Read these local files only: a.md, b.md. Explain why generated findings.json should include a key concept explanation.",
    "import subprocess, pathlib, datetime, textwrap, sys, os\nprojects = [(\"one\", pathlib.Path(\"/tmp/one\"))]",
    "import subprocess, textwrap, sys, time\nprojects = ['/tmp/one', '/tmp/two']",
    "import subprocess, time, textwrap, pathlib\nout = pathlib.Path('/tmp/report')\nprompt = 'Use the better-harness:better-harness skill as a readiness target'",
    "from __future__ import annotations\nfrom pathlib import Path\nHARNESS_ROOT=Path('/tmp/better-harness')\nREPORT_ROOT=Path('/tmp/reports')",
  ]) {
    const facts = buildFacts([
      event({ type: "user", userText }),
      event({ timestamp: at(1), toolName: "Read", filePath: "README.md" }),
    ]);

    assert.equal(facts.entries.length, 0, userText);
    assert.equal(facts.omitted.selfAnalysis, 1, userText);
  }
});

test("facts freeze the time boundary and exclude active or home-only sessions before hydration", () => {
  const startedAt = Date.parse("2026-07-18T10:00:00.000Z");
  const context = createFactsRunContext({
    _factsStartedAt: startedAt,
    "exclude-session-id": "active-by-id",
  }, "qoder");
  assert.equal(context.options.until, "2026-07-18T10:00:00.000Z");
  assert.equal(factsHydrationLimit(1), 12);
  assert.equal(factsHydrationLimit(3), 24);
  assert.equal(factsHydrationLimit(5), 40);

  const prepared = prepareFactsSessionInventory([
    {
      sessionId: "active-by-id",
      lastSeen: "2026-07-18T09:00:00.000Z",
      sourceRefs: [{ kind: "project-jsonl" }],
    },
    {
      sessionId: "home-only",
      lastSeen: "2026-07-18T09:00:00.000Z",
      sourceRefs: [{ kind: "home-session" }],
    },
    {
      sessionId: "retained",
      lastSeen: "2026-07-18T09:00:00.000Z",
      sourceRefs: [{ kind: "project-jsonl" }, { kind: "home-session" }],
    },
  ], context);

  assert.deepEqual(prepared.sessions.map((session) => session.sessionId), ["retained"]);
  assert.deepEqual(prepared.sessions[0].sourceRefs, [{ kind: "project-jsonl" }]);
  assert.deepEqual(prepared.omitted, { activeSessions: 1, homeSessionOnly: 1 });
});

test("core facts enforce candidate, check, mechanism, cost, and semantic-field budgets", () => {
  const privatePath = "/Users/alice/private-work/src/budget.js";
  const rawSessionId = "session-private-99887766";
  const rawTaskId = "task-private-88776655";
  const rawSecret = "ghp_PRIVATESECRET99887766";
  const rawCommand = `private-tool --file ${privatePath} --token ${rawSecret}`;
  const rawOutput = "private raw output sentinel";
  const rawGoal = "private semantic goal sentinel";
  const rawOutcome = "private semantic outcome sentinel";
  const rawFinding = "private semantic finding sentinel";
  const rawRecommendation = "private semantic recommendation sentinel";
  const labels = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf"];
  const events = [];

  for (const [index, label] of labels.entries()) {
    const taskEpisodeKey = index === 0 ? rawTaskId : `task-${label}`;
    const sessionId = index === 0 ? rawSessionId : `session-${label}`;
    events.push(event({
      sessionId,
      taskEpisodeKey,
      timestamp: at(index * 20),
      type: "user",
      userText: `Handle ${label} ${"x".repeat(300)}`,
      goal: rawGoal,
    }));
    events.push(event({
      sessionId,
      taskEpisodeKey,
      timestamp: at(index * 20 + 1),
      toolName: "Edit",
      filePath: index === 0 ? privatePath : `src/${label}.js`,
      skillNames: index === 0 ? ["alpha-skill", "beta-skill", "gamma-skill", "delta-skill"] : [],
      hookName: index === 0 ? "preflight-hook" : undefined,
      commandText: index === 0 ? rawCommand : undefined,
      toolOutput: index === 0 ? rawOutput : undefined,
      secret: index === 0 ? rawSecret : undefined,
      outcome: index === 0 ? rawOutcome : undefined,
      finding: index === 0 ? rawFinding : undefined,
      recommendation: index === 0 ? rawRecommendation : undefined,
    }));
    if (index !== 0) continue;
    for (let checkIndex = 0; checkIndex < 6; checkIndex += 1) {
      events.push(event({
        sessionId,
        taskEpisodeKey,
        timestamp: at(index * 20 + checkIndex + 2),
        validationCategory: `check-${checkIndex + 1}`,
        reviewedAssociation: true,
        success: checkIndex === 5,
        resultFacts: checkIndex === 5
          ? { errors: 0, warnings: 0 }
          : { errors: checkIndex + 1, warnings: 0 },
      }));
    }
  }

  const facts = buildFacts(events, { limit: 99 });
  assert.equal(facts.candidateCount, 7);
  assert.equal(facts.distinctRequestCount, 7);
  assert.equal(facts.entries.length, MAX_EPISODE_FACT_LIMIT);
  assert.equal(facts.omitted.candidateBudget, 2);

  const richCandidate = facts.entries.find((candidate) => candidate.request.summary.includes("alpha"));
  assert.ok(richCandidate);
  assert.equal(richCandidate.checks.length, MAX_EPISODE_CHECKS);
  assert.deepEqual(richCandidate.checks.map((check) => check.kind), [
    "check-1",
    "check-4",
    "check-5",
    "check-6",
  ]);
  assert.equal(richCandidate.omittedChecks, 2);
  assert.equal(richCandidate.mechanisms.length, MAX_EPISODE_MECHANISMS);
  assert.deepEqual(richCandidate.mechanisms, [
    "skill:alpha-skill",
    "skill:beta-skill",
    "skill:gamma-skill",
  ]);
  assert.equal(facts.omitted.checkBudget, 2);

  const envelope = finalize(facts);
  const serialized = JSON.stringify(envelope);
  assert.equal(envelope.cost.serializedBytes, Buffer.byteLength(serialized, "utf8"));
  assert.ok(envelope.cost.serializedBytes <= MAX_SESSION_CORE_FACT_BYTES, envelope.cost.serializedBytes);
  assert.ok(envelope.cost.estimatedTokens <= MAX_SESSION_CORE_FACT_TOKENS, envelope.cost.estimatedTokens);
  assert.ok(envelope.candidates.length <= MAX_EPISODE_FACT_LIMIT);
  assert.deepEqual(envelope.admission, {
    taskEpisodes: 7,
    candidateEpisodes: 7,
    distinctRequests: 7,
    emittedCandidates: envelope.candidates.length,
  });
  assert.equal(envelope.populationCoverage.withChanges, 7);
  assert.equal(envelope.observationCoverage.withChanges, envelope.candidates.length);

  const smallerEnvelope = finalize(facts, { maxBytes: 1_500 });
  const emittedClasses = {};
  for (const candidate of smallerEnvelope.candidates) {
    for (const evidenceClass of candidate.evidenceClasses) {
      emittedClasses[evidenceClass] = (emittedClasses[evidenceClass] ?? 0) + 1;
    }
  }
  assert.ok(smallerEnvelope.cost.serializedBytes <= 1_500, smallerEnvelope.cost.serializedBytes);
  assert.deepEqual(smallerEnvelope.candidateSelection.emittedClasses, emittedClasses);

  const forbiddenField = /^(?:assistantText|rawPrompts?|prompts?|commands?|commandText|toolOutput|outputs?|paths?|ids?|rawIds?|secrets?|goals?|outcomes?|findings?|recommendations?)$/iu;
  assert.deepEqual(collectObjectKeys(envelope).filter((key) => forbiddenField.test(key)), []);

  for (const privateValue of [
    privatePath,
    rawSessionId,
    rawTaskId,
    rawSecret,
    rawCommand,
    rawOutput,
    rawGoal,
    rawOutcome,
    rawFinding,
    rawRecommendation,
  ]) {
    assert.equal(serialized.includes(privateValue), false, privateValue);
  }
});
