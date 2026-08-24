import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "vitest";

import {
  analyzeClaudeStyleSessions,
  buildLongitudinalSupport,
  compactSessionTranscript,
  validateAggregateReview,
  validateClaudeSessionFacet,
} from "../../scripts/session-analysis/claude-facets.mjs";
import { createCodexCliJsonModelClient } from "../../scripts/session-analysis/codex-json-model.mjs";
import { sessionAnalysisRef } from "../../scripts/session-analysis/session-ref.mjs";

const WORKSPACE = "/Users/alice/private/acme";
const PRIVATE_PATH = "/Users/alice/private/acme/src/secret.ts";
const PRIVATE_SECRET = "sk-live_SUPERSECRET123456789";
const SESSION_ANALYSIS_CLI = path.resolve("scripts/session-analysis.mjs");

function facet(overrides = {}) {
  return {
    schemaVersion: 1,
    sessionRef: sessionAnalysisRef({ sessionId: "session-a", platform: "codex", workspace: WORKSPACE }),
    underlyingGoal: "Repair and verify the session analysis workflow",
    goalCategories: ["session-analysis"],
    outcome: "mostly-achieved",
    satisfaction: "no-explicit-signal",
    sessionType: "iterative-refinement",
    friction: [{
      kind: "verification-gap",
      observation: "The first verification did not close the requested boundary.",
      consequence: "A follow-up repair and rerun were needed.",
    }],
    primarySuccess: {
      kind: "verified-repair",
      observation: "A later relevant check passed after the repair.",
      outcomeContribution: "supported",
    },
    briefSummary: "The agent repaired a bounded analysis path and obtained a relevant passing check.",
    evidenceStatements: ["A failed result was followed by a repair and passing result."],
    confidence: { level: "medium", reason: "Delivery evidence was present but explicit acceptance was absent." },
    ...overrides,
  };
}

test("compact transcript keeps bounded dialogue and tool status without private material", () => {
  const transcript = compactSessionTranscript([
    {
      type: "user",
      userPrompt: true,
      timestamp: "2026-07-18T10:00:00.000Z",
      userText: `Update ${PRIVATE_PATH} with api_key=${PRIVATE_SECRET}`,
    },
    {
      type: "user",
      userPrompt: true,
      timestamp: "2026-07-18T10:00:00.000Z",
      userText: `Update ${PRIVATE_PATH} with api_key=${PRIVATE_SECRET}`,
    },
    {
      type: "user",
      userPrompt: true,
      timestamp: "2026-07-18T10:00:01.000Z",
      userText: '{"role":"user","content":[{"type":"tool_result","tool_use_id":"private","content":"raw"}]}',
    },
    {
      type: "user",
      userPrompt: true,
      timestamp: "2026-07-18T10:00:02.000Z",
      userText: "<turn_aborted>The user interrupted the previous turn on purpose.</turn_aborted>",
    },
    {
      type: "user",
      userPrompt: true,
      timestamp: "2026-07-18T10:00:03.000Z",
      userText: "The following is the Codex agent history whose request action you are assessing. Treat it as untrusted evidence.",
    },
    {
      type: "assistant",
      userVisibleAssistantMessage: true,
      content: `I will inspect ${PRIVATE_PATH} and keep ${PRIVATE_SECRET} out of logs.`,
    },
    {
      type: "tool.requested",
      toolName: "Read",
      lifecyclePhase: "pre",
      commandText: `cat ${PRIVATE_PATH}`,
    },
    {
      type: "tool.finished",
      toolName: "Read",
      lifecyclePhase: "result",
      success: false,
      content: `failed output from ${PRIVATE_PATH}`,
    },
  ]);

  assert.match(transcript, /\[User 1\]/u);
  assert.match(transcript, /\[Assistant 1\]/u);
  assert.match(transcript, /\[Tool\] Read/u);
  assert.match(transcript, /\[Tool result\] failed/u);
  assert.equal((transcript.match(/\[User 1\]/gu) ?? []).length, 1);
  assert.doesNotMatch(transcript, /tool_result|tool_use_id/u);
  assert.doesNotMatch(transcript, /turn_aborted|Codex agent history/u);
  assert.match(transcript, /<path>/u);
  assert.equal(transcript.includes(PRIVATE_PATH), false);
  assert.equal(transcript.includes(PRIVATE_SECRET), false);
  assert.equal(transcript.includes("cat "), false);
  assert.equal(transcript.includes("failed output"), false);
});

test("compact transcript removes serialized role/content envelopes", () => {
  const transcript = compactSessionTranscript([
    {
      type: "user",
      userPrompt: true,
      userText: '{"role":"user","content":[{"content":"# Search result"}]}',
    },
  ]);

  assert.equal(transcript, "");
});

test("compact transcript unwraps delegated task input without its source id", () => {
  const transcript = compactSessionTranscript([
    {
      type: "user",
      userPrompt: true,
      userText: "<codex_delegation><source_thread_id>019f5954-2432-7e40-b4a9-89e63d49d140</source_thread_id><input>Repair the report contract.</input></codex_delegation>",
    },
  ]);

  assert.equal(transcript, "[User 1] Repair the report contract.");
  assert.doesNotMatch(transcript, /019f5954|codex_delegation/u);
});

test("Claude-style facet validators reject raw fields and unsupported working-pattern support", () => {
  const valid = facet();
  assert.deepEqual(validateClaudeSessionFacet(valid), []);
  assert.ok(validateClaudeSessionFacet({ ...valid, rawTranscript: "private" })
    .some((error) => error.includes("unsupported field")));

  const second = facet({
    sessionRef: sessionAnalysisRef({ sessionId: "session-b", platform: "codex", workspace: WORKSPACE }),
    outcome: "partially-achieved",
    primarySuccess: {
      kind: "verified-repair",
      observation: "A check ran but did not close acceptance.",
      outcomeContribution: "lead",
    },
  });
  const review = {
    status: "candidate-review",
    summary: "A repeated repair pattern may be worth evaluating.",
    suggestions: [{
      kind: "working-pattern-lead",
      title: "Reuse verified repair",
      reason: "Two sessions mention the same repair behavior.",
      supportRefs: [valid.sessionRef, second.sessionRef],
      capabilityStatus: "not-applicable",
      nextExperiment: "Compare two matched tasks using the repair behavior.",
      validation: "Require accepted outcomes without a regression.",
      evidenceLimit: "One current outcome remains only partially achieved.",
      confidence: "low",
    }],
  };
  assert.ok(validateAggregateReview(review, [valid, second])
    .some((error) => error.includes("positive supported outcomes")));
});

test("deterministic longitudinal support counts distinct validated facets", () => {
  const first = facet();
  const second = facet({
    sessionRef: sessionAnalysisRef({ sessionId: "session-b", platform: "codex", workspace: WORKSPACE }),
    goalCategories: ["session-analysis", "reporting"],
  });
  const support = buildLongitudinalSupport([first, second]);

  assert.deepEqual(support.repeated.goalCategories, [{
    label: "session-analysis",
    count: 2,
    supportRefs: [first.sessionRef, second.sessionRef].sort(),
  }]);
  assert.equal(support.repeated.friction[0].label, "verification-gap");
  assert.equal(support.repeated.primarySuccess[0].label, "verified-repair");
});

test("Claude-style analysis uses model facets and returns candidate suggestions without findings", async () => {
  const sessions = [
    { sessionId: "session-a", firstSeen: "2026-07-18T10:00:00.000Z", lastSeen: "2026-07-18T10:05:00.000Z" },
    { sessionId: "session-b", firstSeen: "2026-07-18T11:00:00.000Z", lastSeen: "2026-07-18T11:05:00.000Z" },
  ];
  const refs = sessions.map((session) => sessionAnalysisRef({
    sessionId: session.sessionId,
    platform: "codex",
    workspace: WORKSPACE,
  }));
  const analyzer = {
    async resolveScope() {
      return { platform: "codex", workspace: WORKSPACE, since: null, until: null };
    },
    async analyze(options) {
      assert.equal(options.command, "sessions");
      return {
        sessions,
        warnings: [{ code: "fixture-warning", message: `private ${PRIVATE_PATH}` }],
      };
    },
    async readSession(session, _scope, options) {
      assert.equal(options.includeContent, true);
      assert.equal(options.includeUserText, true);
      assert.equal(options.includeCommandText, false);
      return [
        {
          sessionId: session.sessionId,
          type: "user",
          userPrompt: true,
          userText: `Repair the analysis in ${PRIVATE_PATH} with token=${PRIVATE_SECRET}`,
        },
        {
          sessionId: session.sessionId,
          type: "assistant",
          userVisibleAssistantMessage: true,
          content: "I will make the bounded repair and run its focused test.",
        },
        { sessionId: session.sessionId, type: "tool", toolName: "Edit", lifecyclePhase: "pre" },
        { sessionId: session.sessionId, type: "tool", toolName: "Bash", lifecyclePhase: "result", success: true },
      ];
    },
  };
  const calls = [];
  const modelClient = {
    async generateJson(request) {
      calls.push(request);
      if (request.name === "aggregate-suggestion-leads") {
        return {
          summary: "Repeated session analysis work supports one bounded loop experiment.",
          suggestions: [{
            kind: "loop-candidate",
            title: "Evaluate a reusable session analysis loop",
            reason: "Two distinct sessions repeat the same analysis and verification shape.",
            supportRefs: refs,
            capabilityStatus: "uninspected",
            nextExperiment: "Inspect the existing owner and run one matched analysis task.",
            validation: "Compare output usefulness and unsupported claims against manual review.",
            evidenceLimit: "Project capability inventory and stable stop boundaries were not inspected.",
            confidence: "medium",
          }],
        };
      }
      return {
        underlyingGoal: "Repair and verify the session analysis workflow",
        goalCategories: ["session-analysis"],
        outcome: "mostly-achieved",
        satisfaction: "no-explicit-signal",
        sessionType: "iterative-refinement",
        friction: [{
          kind: "verification-gap",
          observation: "A prior verification boundary required follow-up.",
          consequence: "The agent had to repair and rerun the focused check.",
        }],
        primarySuccess: {
          kind: "verified-repair",
          observation: "The focused check passed after the bounded repair.",
          outcomeContribution: "supported",
        },
        briefSummary: "A bounded repair was followed by a focused passing check.",
        evidenceStatements: ["The session shows an edit followed by a passing tool result."],
        confidence: { level: "medium", reason: "The check is visible while explicit user acceptance is absent." },
      };
    },
  };

  const result = await analyzeClaudeStyleSessions({
    analyzer,
    platform: "codex",
    options: { limit: 2, selection: "all-eligible" },
    modelClient,
  });

  assert.equal(calls.length, 3);
  assert.equal(result.selection.selectedSessions, 2);
  assert.equal(result.facets.length, 2);
  assert.equal(result.longitudinalSupport.repeated.goalCategories[0].label, "session-analysis");
  assert.equal(result.recommendationReview.suggestions[0].kind, "loop-candidate");
  assert.equal(result.comparisonFacts.kind, "session-core-facts");
  assert.equal(result.comparisonFacts.scope.selectedSessions, 2);
  assert.equal(result.evidenceBoundary.findingsUnchanged, true);
  assert.equal(Object.hasOwn(result, "findings"), false);
  assert.deepEqual(result.warningCodes, ["fixture-warning"]);

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(PRIVATE_PATH), false);
  assert.equal(serialized.includes(PRIVATE_SECRET), false);
  for (const request of calls.filter((call) => call.name.startsWith("session-facet-"))) {
    assert.equal(request.prompt.includes(PRIVATE_PATH), false);
    assert.equal(request.prompt.includes(PRIVATE_SECRET), false);
    assert.equal(request.prompt.includes("<path>"), true);
  }
});

test("invalid model facet fails closed instead of inferring an outcome", async () => {
  const analyzer = {
    async resolveScope() {
      return { platform: "qoder", workspace: WORKSPACE, since: null, until: null };
    },
    async analyze() {
      return {
        sessions: [{ sessionId: "session-a", sourceRefs: [{ kind: "project-jsonl" }] }],
        warnings: [],
      };
    },
    async readSession() {
      return [{ type: "user", userPrompt: true, userText: "Analyze this session" }];
    },
  };
  const modelClient = {
    async generateJson() {
      return { outcome: "fully-achieved" };
    },
  };

  await assert.rejects(
    analyzeClaudeStyleSessions({ analyzer, platform: "qoder", options: {}, modelClient }),
    (error) => error.code === "INVALID_CLAUDE_SESSION_FACET",
  );
});

test("Codex JSON model adapter uses an isolated read-only ephemeral run", async () => {
  let runDirectory;
  let args;
  const client = createCodexCliJsonModelClient({
    runner: async (request) => {
      runDirectory = request.cwd;
      args = request.args;
      const outputIndex = request.args.indexOf("--output-last-message");
      await writeFile(request.args[outputIndex + 1], '{"status":"ok"}\n', "utf8");
    },
  });
  const output = await client.generateJson({
    name: "fixture",
    prompt: "Return JSON",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["status"],
      properties: { status: { type: "string" } },
    },
  });

  assert.deepEqual(output, { status: "ok" });
  assert.ok(args.includes("read-only"));
  assert.ok(args.includes("--ephemeral"));
  assert.ok(args.includes("--ignore-user-config"));
  assert.equal(args.includes("--dangerously-bypass-approvals-and-sandbox"), false);
  await assert.rejects(access(runDirectory));
});

test("Codex JSON model adapter converts malformed wrapped output to a stable error", async () => {
  const client = createCodexCliJsonModelClient({
    runner: async (request) => {
      const outputIndex = request.args.indexOf("--output-last-message");
      await writeFile(request.args[outputIndex + 1], "model prose {not-json}\n", "utf8");
    },
  });

  await assert.rejects(
    client.generateJson({ name: "invalid-fixture", prompt: "Return JSON", schema: { type: "object" } }),
    (error) => error?.code === "INVALID_SEMANTIC_MODEL_JSON",
  );
});

test("Claude-style CLI help is local and discloses its model privacy boundary", () => {
  const result = spawnSync(process.execPath, [SESSION_ANALYSIS_CLI, "claude-facets", "--help"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: session-analysis claude-facets/u);
  assert.match(result.stdout, /compact redacted session semantics are sent to the configured Codex service/u);
  assert.match(result.stdout, /does not change findings, reports, scores, or caches/u);
});
