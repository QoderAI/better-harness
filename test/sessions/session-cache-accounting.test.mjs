import assert from "node:assert/strict";
import { test } from "vitest";

import { ClaudeSessionAnalyzer } from "../../scripts/session-analysis/platforms/claude.mjs";
import { CodexSessionAnalyzer } from "../../scripts/session-analysis/platforms/codex.mjs";

test("Codex declares cache reads as included in provider input", () => {
  const event = new CodexSessionAnalyzer().normalizeEvent({
    type: "event_msg",
    timestamp: "2026-08-29T01:00:00.000Z",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: { input_tokens: 120, cached_input_tokens: 80, output_tokens: 10, total_tokens: 130 },
        last_token_usage: { input_tokens: 120, cached_input_tokens: 80, output_tokens: 10, total_tokens: 130 },
        model_context_window: 1_000,
      },
    },
  }, { sessionId: "codex-cache", kind: "codex-rollout-jsonl", path: "rollout.jsonl" });

  assert.equal(event.cacheAccountingMode, "included-in-input");
  assert.equal(event.modelInvocationUsage.inputTokens, 120);
  assert.equal(event.modelInvocationUsage.cacheReadInputTokens, 80);
});

test("Claude declares cache reads and creation as separate provider input lanes", () => {
  const events = new ClaudeSessionAnalyzer().normalizeEvents({
    type: "assistant",
    sessionId: "claude-cache",
    timestamp: "2026-08-29T01:00:00.000Z",
    message: {
      role: "assistant",
      model: "claude-fixture",
      usage: {
        input_tokens: 20,
        output_tokens: 5,
        cache_read_input_tokens: 70,
        cache_creation_input_tokens: 10,
      },
      content: [{ type: "text", text: "Observed." }],
    },
  }, { sessionId: "claude-cache", kind: "claude-project-jsonl", path: "session.jsonl" });
  const response = events.find((event) => event.type === "model.response.completed");

  assert.equal(response.cacheAccountingMode, "separate-input-lane");
  assert.deepEqual(response.modelInvocationUsage, {
    inputTokens: 20,
    outputTokens: 5,
    cacheReadInputTokens: 70,
    cacheCreationInputTokens: 10,
  });
});
