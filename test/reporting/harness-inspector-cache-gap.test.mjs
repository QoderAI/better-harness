import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildPromptCacheGapCue,
  PROMPT_CACHE_POLICY_NOTICE,
  PROMPT_CACHE_PROFILES,
  resolvePromptCacheProfile,
} from "../../scripts/harness-inspector/index.mjs";

const minute = 60_000;
const profile = (id) => PROMPT_CACHE_PROFILES.find((candidate) => candidate.id === id);

test("prompt-cache profiles own model matching, policy labels, and official sources", () => {
  assert.equal(PROMPT_CACHE_PROFILES.length, 7);
  assert.match(PROMPT_CACHE_POLICY_NOTICE, /latest official documentation/u);
  for (const candidate of PROMPT_CACHE_PROFILES) {
    assert.ok(candidate.id);
    assert.ok(candidate.provider);
    assert.ok(candidate.modelLabel);
    assert.ok(candidate.cacheModeLabel);
    assert.ok(candidate.ttlLabel);
    assert.ok(candidate.priceBasis);
    assert.match(candidate.officialUrl, /^https:\/\//u);
  }
});

test("profile resolution prefers observed model matches over host aliases", () => {
  assert.equal(resolvePromptCacheProfile(PROMPT_CACHE_PROFILES, {
    provider: "codex",
    models: ["gpt-5.6"],
  })?.id, "openai-gpt-5.6");
  assert.equal(resolvePromptCacheProfile(PROMPT_CACHE_PROFILES, {
    provider: "qoder",
    models: ["qwen3-coder-flash"],
  })?.id, "alibaba-qwen");
  assert.equal(resolvePromptCacheProfile(PROMPT_CACHE_PROFILES, {
    provider: "custom-gateway",
    models: ["glm-5.1"],
  })?.id, "zai-glm");
  assert.equal(resolvePromptCacheProfile(PROMPT_CACHE_PROFILES, {
    provider: "custom-gateway",
    models: ["private-model"],
  }), null);
  assert.equal(resolvePromptCacheProfile(PROMPT_CACHE_PROFILES, {
    provider: "custom-gateway",
    models: ["gpt-5.6", "claude-sonnet"],
  }), null);
});

test("OpenAI idle cues start at the GPT-5.6 30 minute reference", () => {
  assert.equal(buildPromptCacheGapCue({
    profile: profile("openai-gpt-5.6"),
    gapStartMs: 0,
    gapEndMs: 29 * minute,
  }), null);

  const cue = buildPromptCacheGapCue({
    profile: profile("openai-gpt-5.6"),
    gapStartMs: 0,
    gapEndMs: 37 * minute,
  });
  assert.equal(cue.profileId, "openai-gpt-5.6");
  assert.equal(cue.providerLabel, "OpenAI");
  assert.equal(cue.thresholdLabel, "30m");
  assert.equal(cue.silenceMs, 37 * minute);
  assert.match(cue.detail, /not observed cache expiry/u);
});

test("Anthropic idle cues preserve both 5 minute and 1 hour references", () => {
  const short = buildPromptCacheGapCue({
    profile: profile("anthropic-claude"),
    gapStartMs: 0,
    gapEndMs: 10 * minute,
  });
  assert.deepEqual(short.crossedThresholdLabels, ["5m"]);
  assert.equal(short.nextThresholdLabel, "1h");

  const long = buildPromptCacheGapCue({
    profile: profile("anthropic-claude"),
    gapStartMs: 0,
    gapEndMs: 75 * minute,
  });
  assert.deepEqual(long.crossedThresholdLabels, ["5m", "1h"]);
  assert.equal(long.thresholdLabel, "1h");
});

test("observed model responses split a no-call window before cache comparison", () => {
  const cue = buildPromptCacheGapCue({
    profile: profile("openai-gpt-5.6"),
    gapStartMs: 0,
    gapEndMs: 50 * minute,
    responsePositions: [25 * minute],
  });
  assert.equal(cue, null);

  const crossed = buildPromptCacheGapCue({
    profile: profile("openai-gpt-5.6"),
    gapStartMs: 0,
    gapEndMs: 70 * minute,
    responsePositions: [20 * minute, 35 * minute],
  });
  assert.equal(crossed.silenceStartMs, 35 * minute);
  assert.equal(crossed.silenceEndMs, 70 * minute);
  assert.equal(crossed.silenceMs, 35 * minute);
  assert.deepEqual(buildPromptCacheGapCue({
    profile: profile("openai-gpt-5.6"),
    gapStartMs: 0,
    gapEndMs: 70 * minute,
    responsePositions: [20 * minute, 35 * minute],
    responsePositionsSorted: true,
  }), crossed);
});

test("provider-managed and unpublished TTL profiles do not create timeline cues", () => {
  for (const id of ["deepseek", "zai-glm", "moonshot-kimi"]) {
    assert.equal(buildPromptCacheGapCue({
      profile: profile(id),
      gapStartMs: 0,
      gapEndMs: 24 * 60 * minute,
    }), null);
  }
  assert.equal(buildPromptCacheGapCue({
    profile: null,
    gapStartMs: 0,
    gapEndMs: 24 * 60 * minute,
  }), null);
});
