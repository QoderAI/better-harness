import assert from "node:assert/strict";
import test from "node:test";

import { buildTaskEpisodes } from "../scripts/session-analysis/episode-contract.mjs";
import {
  detectLifecycleDemandSignals,
  topLifecycleDemandSignals,
} from "../scripts/session-analysis/lifecycle-demand-signals.mjs";

function userEvent(userText, overrides = {}) {
  return {
    type: "user",
    sessionId: "private-session-a",
    timestamp: "2026-07-15T08:00:00.000Z",
    userText,
    evidenceRef: {
      kind: "session-jsonl",
      path: "/Users/private/.codex/sessions/private-session-a.jsonl",
      line: 7,
      type: "user",
    },
    ...overrides,
  };
}

function intents(text, overrides) {
  return detectLifecycleDemandSignals(userEvent(text, overrides), { platform: "codex" })
    .map((signal) => signal.intent);
}

test("lifecycle demand detects bare English and Chinese specification review", () => {
  assert.deepEqual(intents("spec review"), ["specification-review"]);
  assert.deepEqual(intents("Review the spec before implementation."), ["specification-review"]);
  assert.deepEqual(intents("Review the requirements before implementation."), ["specification-review"]);
  assert.deepEqual(intents("Review the ADR before implementation."), ["specification-review"]);
  assert.deepEqual(intents("Review the RFC before implementation."), ["specification-review"]);
  assert.deepEqual(intents("spec-review"), ["specification-review"]);
  assert.deepEqual(intents("requirements-review"), ["specification-review"]);
  assert.deepEqual(intents("ADR-review"), ["specification-review"]);
  assert.deepEqual(intents("规格评审"), ["specification-review"]);
  assert.deepEqual(intents("请先评审这份需求规格。"), ["specification-review"]);
  assert.deepEqual(intents("需求评审"), ["specification-review"]);
  assert.deepEqual(intents("评审用户故事"), ["specification-review"]);
  assert.deepEqual(intents("Review the acceptance criteria."), ["specification-review"]);
  assert.deepEqual(intents("review the spec", { type: "UserPromptSubmit" }), ["specification-review"]);
  assert.deepEqual(intents("Review docs/specs/checkout.md before implementation."), ["specification-review"]);
  assert.deepEqual(intents("Review .codex/specs/checkout.md before implementation."), ["specification-review"]);
  assert.deepEqual(intents("Review C:\\repo\\docs\\specs\\checkout.md before implementation."), ["specification-review"]);
  assert.deepEqual(intents("Review docs/specs/payments/checkout.md before implementation."), ["specification-review"]);
  assert.deepEqual(intents("Review C:\\repo\\docs\\specs\\payments\\checkout.md before implementation."), ["specification-review"]);
  assert.deepEqual(intents("Review `docs/specs/checkout.md` before implementation."), ["specification-review"]);
  assert.deepEqual(intents("Review \"docs/specs/checkout.md\" before implementation."), ["specification-review"]);
  assert.deepEqual(intents("Review [checkout](docs/specs/checkout.md) before implementation."), ["specification-review"]);
  assert.deepEqual(intents("Review specs/checkout.md before implementation."), ["specification-review"]);
  assert.deepEqual(intents("Review docs/adrs/adr-017.md before implementation."), ["specification-review"]);
  assert.deepEqual(intents("Review .agents/rfcs/platform/rfc-42.md before implementation."), ["specification-review"]);

  assert.deepEqual(intents("Draft the requirements."), ["specification-authoring"]);
  assert.deepEqual(intents("Draft a PRD."), ["specification-authoring"]);
  assert.deepEqual(intents("Clarify the acceptance criteria."), ["specification-authoring"]);
  assert.deepEqual(intents("澄清需求"), ["specification-authoring"]);

  const signal = detectLifecycleDemandSignals(userEvent("review the spec"), { platform: "codex" })[0];
  assert.equal(signal.family, "specification");
  assert.equal(signal.dimensionId, "task-understanding");
  assert.equal(signal.checkId, "goal-understanding");
  assert.equal(signal.confidence, "High");
});

test("command-like lifecycle aliases normalize without copying arguments", () => {
  const cases = [
    ["/plan split the implementation", "task-planning", "planning"],
    ["/ultraplan migrate the package", "task-planning", "planning"],
    ["/spec draft acceptance scenarios", "specification-authoring", "specification"],
    ["/spec review before implementation", "specification-review", "specification"],
    ["/spec 评审当前规格", "specification-review", "specification"],
    ["/story refine the acceptance boundary", "specification-authoring", "specification"],
    ["/issue-triage --label agent-ready", "issue-triage", "planning"],
    ["/issue-fix 12345", "issue-workflow-planning", "planning"],
    ["/issue-巡检 每日", "issue-triage", "planning"],
    ["/planning split the release", "task-planning", "planning"],
    ["/spec-review before implementation", "specification-review", "specification"],
    ["/specification draft the contract", "specification-authoring", "specification"],
    ["/requirements-review the acceptance boundary", "specification-review", "specification"],
    ["/prd draft the product contract", "specification-authoring", "specification"],
    ["/adr review the decision", "specification-review", "specification"],
    ["/acceptance-criteria draft the scenarios", "specification-authoring", "specification"],
    ["/user-story refine checkout", "specification-authoring", "specification"],
    ["/story-review checkout", "specification-review", "specification"],
    ["/计划 拆解实现", "task-planning", "planning"],
  ];

  for (const [text, intent, family] of cases) {
    const signals = detectLifecycleDemandSignals(userEvent(text), { platform: "qoder" });
    assert.equal(signals.length, 1, text);
    assert.equal(signals[0].intent, intent, text);
    assert.equal(signals[0].family, family, text);
    assert.equal(JSON.stringify(signals).includes(text), false, text);
  }

  assert.deepEqual(intents("Draft a user story for the change."), ["specification-authoring"]);
  assert.deepEqual(intents("Plan this issue before implementation."), ["task-planning"]);
});

test("explicit bounded Skill invocations enter the lifecycle route", () => {
  for (const text of [
    "$spec-review",
    "Use $spec-review",
    "[$spec-review](skill://spec-review)",
  ]) {
    assert.deepEqual(intents(text), ["specification-review"], text);
  }
  assert.deepEqual(intents("$database-review"), []);
  assert.deepEqual(intents("Use $generic-helper"), []);
});

test("lifecycle demand keeps workflow vocabulary compact and action-oriented", () => {
  const cases = [
    ["Draft a specification for the migration.", "specification-authoring", "task-understanding"],
    ["Create an implementation plan.", "task-planning", "task-understanding"],
    ["Set up the development environment.", "setup-isolation", "controlled-execution"],
    ["Create an isolated worktree.", "setup-isolation", "controlled-execution"],
    ["Debug the failing test.", "debugging", "change-validation"],
    ["自动修复 Bug", "debugging", "change-validation"],
    ["Run the focused tests.", "testing-verification", "change-validation"],
    ["Run failing tests.", "testing-verification", "change-validation"],
    ["Review this PR.", "review-acceptance", "reliable-delivery"],
    ["Release the change.", "release-delivery", "reliable-delivery"],
    ["Complete this branch.", "branch-completion", "reliable-delivery"],
    ["完成这个分支的验收。", "review-acceptance", "reliable-delivery"],
    ["Triage the open issues.", "issue-triage", "task-understanding"],
    ["每日 Issue 巡检", "issue-triage", "task-understanding"],
    ["Maintain the project docs.", "documentation-maintenance", "reliable-delivery"],
    ["主动维护文档", "documentation-maintenance", "reliable-delivery"],
  ];

  for (const [text, intent, dimensionId] of cases) {
    const signals = detectLifecycleDemandSignals(userEvent(text), { platform: "qoder" });
    assert.ok(signals.some((signal) => signal.intent === intent && signal.dimensionId === dimensionId), text);
  }
});

test("lifecycle demand rejects non-user, injected, quoted, negated, and generic keyword evidence", () => {
  const rejected = [
    userEvent("review the spec", { type: "assistant" }),
    userEvent("review the spec", { type: "tool.result" }),
    userEvent("<loaded_context>Review the spec before implementation.</loaded_context>"),
    userEvent("# AGENTS.md instructions\nReview every spec before implementation."),
    userEvent("The spec describes the feature."),
    userEvent("The requirements describe the feature."),
    userEvent("The ADR records the decision."),
    userEvent("The PRD exists."),
    userEvent("The user story has three fields."),
    userEvent("The implementation plan describes the migration."),
    userEvent("The spec-reviewer field names a role."),
    userEvent("The plan-reviewer field is optional."),
    userEvent("The phrase \"review the spec\" is an example."),
    userEvent("Do not review the spec."),
    userEvent("Never review the spec."),
    userEvent("You should not review the spec."),
    userEvent("We cannot review the spec."),
    userEvent("无需进行规格评审。"),
    userEvent("The document is missing."),
    userEvent("git status"),
    userEvent("Commit the change."),
    userEvent("A log line mentioned /plan with some arguments."),
    userEvent("Read /tmp/spec review/output.log"),
    userEvent("Read C:\\tmp\\spec review\\output.log"),
    userEvent("Read docs/spec review/output.log"),
    userEvent("/explain why planning matters"),
    userEvent("/planet migration notes"),
    userEvent("review the spec", { type: undefined }),
    userEvent("<loaded_context source=\"history\">## My request for Codex:\nReview the spec.</loaded_context>"),
    userEvent("<loaded_context>Review the spec."),
    userEvent("<loaded_context><loaded_context>Review the spec.</loaded_context></loaded_context>"),
    userEvent("```markdown\n## My request for Codex:\nReview the spec.\n```"),
    userEvent("> ## My request for Codex:\n> Review the spec."),
  ];

  for (const event of rejected) {
    assert.deepEqual(detectLifecycleDemandSignals(event, { platform: "codex" }), [], event.userText);
  }

  assert.deepEqual(
    intents("# Files mentioned by the user:\n- /private/spec.md\n\n## My request for Codex:\nReview the spec."),
    ["specification-review"],
  );
  assert.deepEqual(
    intents("<loaded_context source=\"history\">Review the spec.</loaded_context>\n## My request for Codex:\nReview the spec."),
    ["specification-review"],
  );
});

test("planning review equivalents stay in the specification-planning route", () => {
  assert.deepEqual(intents("Review the implementation plan."), ["task-planning"]);
  assert.deepEqual(intents("Assess the plan before coding."), ["task-planning"]);
  assert.deepEqual(intents("Plan review before coding."), ["task-planning"]);
  assert.deepEqual(intents("plan-review"), ["task-planning"]);
  assert.deepEqual(intents("Implementation plan review."), ["task-planning"]);
  assert.deepEqual(intents("评审实施计划"), ["task-planning"]);
  assert.deepEqual(intents("计划评审"), ["task-planning"]);
  assert.deepEqual(intents("issue-triage"), ["issue-triage"]);
});

test("lifecycle outputs retain only normalized fields and bounded evidence refs", () => {
  const prompt = "Review the spec for secret-project before implementation.";
  const signal = detectLifecycleDemandSignals(userEvent(prompt), { platform: "codex" })[0];
  const serialized = JSON.stringify(signal);

  assert.equal(serialized.includes(prompt), false);
  assert.equal(serialized.includes("/Users/private"), false);
  assert.equal(serialized.includes("private-session-a"), false);
  assert.match(signal.evidenceRefs[0].id, /^event-[a-f0-9]{16}$/u);
  assert.deepEqual(Object.keys(signal).sort(), [
    "checkId",
    "confidence",
    "dimensionId",
    "evidenceRefs",
    "family",
    "host",
    "intent",
    "schemaVersion",
    "scope",
  ]);

  const top = topLifecycleDemandSignals([
    userEvent(prompt),
    userEvent("spec review", { timestamp: "2026-07-15T08:01:00.000Z", evidenceRef: { kind: "fixture", line: 8 } }),
  ], { platform: "codex" });
  assert.equal(top[0].count, 2);
  assert.equal(JSON.stringify(top).includes("/Users/private"), false);

  const hostileReference = detectLifecycleDemandSignals(userEvent("spec review", {
    evidenceRef: { kind: "/Users/alice/private", type: "secret prompt text", id: "private-session-id" },
  }), { platform: "codex" })[0];
  assert.deepEqual(hostileReference.evidenceRefs[0].kind, "session-event");
  assert.deepEqual(hostileReference.evidenceRefs[0].type, "event");
  assert.doesNotMatch(JSON.stringify(hostileReference), /Users|alice|secret|private-session/u);
});

test("Task Episodes deduplicate same-episode lifecycle demand and retain read-only repeats", () => {
  const { episodes } = buildTaskEpisodes([
    userEvent("Review the spec.", { timestamp: "2026-07-15T08:00:00.000Z", taskEpisodeKey: "review-a" }),
    userEvent("spec review", {
      timestamp: "2026-07-15T08:01:00.000Z",
      taskEpisodeKey: "review-a",
      evidenceRef: { kind: "fixture", line: 8, type: "user" },
    }),
    userEvent("规格评审", {
      sessionId: "private-session-b",
      timestamp: "2026-07-15T09:00:00.000Z",
      evidenceRef: { kind: "fixture", line: 9, type: "user" },
    }),
  ]);

  assert.equal(episodes.length, 2);
  assert.ok(episodes.every((episode) => episode.changeSets.length === 0));
  assert.deepEqual(episodes.map((episode) => episode.lifecycleSignals.length), [1, 1]);
  assert.deepEqual(episodes.map((episode) => episode.lifecycleSignals[0].intent), [
    "specification-review",
    "specification-review",
  ]);
  assert.equal(episodes[0].lifecycleSignals[0].evidenceRefs.length, 2);
});

test("read-only lifecycle prompts need progress or another boundary before recurrence", () => {
  const clarification = buildTaskEpisodes([
    userEvent("Review the spec.", { timestamp: "2026-07-15T08:00:00.000Z" }),
    userEvent("", {
      type: "tool",
      toolName: "Read",
      timestamp: "2026-07-15T08:00:03.000Z",
    }),
    userEvent("Which specification should I review?", {
      type: "assistant",
      timestamp: "2026-07-15T08:00:05.000Z",
    }),
    userEvent("Review docs/specs/checkout.md.", { timestamp: "2026-07-15T08:00:10.000Z" }),
  ], { platform: "qoder" }).episodes;
  assert.equal(clarification.length, 1);
  assert.deepEqual(clarification[0].lifecycleSignals.map((signal) => signal.intent), ["specification-review"]);

  const { episodes } = buildTaskEpisodes([
    userEvent("Review the spec.", { timestamp: "2026-07-15T08:00:00.000Z" }),
    userEvent("Triage the open issues.", {
      type: "UserPromptSubmit",
      timestamp: "2026-07-15T08:05:00.000Z",
      episodeBoundary: true,
    }),
  ], { platform: "qoder" });
  assert.equal(episodes.length, 2);
  assert.deepEqual(episodes.map((episode) => episode.lifecycleSignals[0].intent), [
    "specification-review",
    "issue-triage",
  ]);
  assert.ok(episodes.every((episode) => episode.changeSets.length === 0));
  assert.ok(episodes.every((episode) => episode.lifecycleSignals[0].host === "qoder"));
});

test("hook and conversation copies of one prompt remain one Task Episode", () => {
  const prompt = "/spec review checkout";
  const { canonicalEvents, episodes } = buildTaskEpisodes([
    userEvent(prompt, {
      type: "UserPromptSubmit",
      timestamp: "2026-07-15T08:00:00.000Z",
      evidenceRef: { kind: "hook-audit", line: 4, type: "UserPromptSubmit" },
    }),
    userEvent(prompt, {
      type: "user",
      timestamp: "2026-07-15T08:00:00.100Z",
      evidenceRef: { kind: "conversation", line: 8, type: "user" },
    }),
  ], { platform: "qoder" });

  assert.equal(canonicalEvents.length, 1);
  assert.equal(canonicalEvents[0].promptLifecycle.deduplicated, true);
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].lifecycleSignals.length, 1);
  assert.equal(episodes[0].lifecycleSignals[0].evidenceRefs.length, 2);
});

test("pre-authored lifecycle signals on non-user events are ignored", () => {
  const { episodes } = buildTaskEpisodes([{
    type: "assistant",
    sessionId: "private-session-a",
    timestamp: "2026-07-15T08:00:00.000Z",
    lifecycleSignals: [{
      intent: "specification-review",
      family: "specification",
      dimensionId: "task-understanding",
      checkId: "goal-understanding",
      confidence: "High",
      scope: "workspace",
      evidenceRefs: [],
    }],
  }]);

  assert.deepEqual(episodes[0].lifecycleSignals, []);
});
