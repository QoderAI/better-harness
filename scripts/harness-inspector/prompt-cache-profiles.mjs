const MINUTE_MS = 60_000;

export const PROMPT_CACHE_POLICY_NOTICE = "Models and pricing change. Use the latest official documentation.";

// Mutable provider policy belongs in one serializable reference model. The
// self-contained Inspector embeds this data verbatim; it never fetches policy
// data or treats it as observed Session evidence.
export const PROMPT_CACHE_PROFILES = Object.freeze([
  {
    id: "openai-gpt-5.6",
    provider: "OpenAI",
    modelLabel: "GPT-5.6",
    providerAliases: ["openai", "codex"],
    modelMatchers: ["gpt-5.6"],
    cacheModeLabel: "implicit + explicit",
    ttlPolicy: "fixed",
    ttlLabel: "30m",
    comparableTtls: [{ durationMs: 30 * MINUTE_MS, label: "30m" }],
    priceBasis: "write 1.25x · read 0.1x",
    officialUrl: "https://developers.openai.com/api/docs/guides/prompt-caching",
  },
  {
    id: "anthropic-claude",
    provider: "Anthropic",
    modelLabel: "Claude",
    providerAliases: ["anthropic", "claude"],
    modelMatchers: ["claude"],
    cacheModeLabel: "explicit",
    ttlPolicy: "selectable",
    ttlLabel: "5m / 1h",
    comparableTtls: [
      { durationMs: 5 * MINUTE_MS, label: "5m" },
      { durationMs: 60 * MINUTE_MS, label: "1h" },
    ],
    priceBasis: "write 1.25x / 2x · read 0.1x",
    officialUrl: "https://platform.claude.com/docs/en/build-with-claude/prompt-caching",
  },
  {
    id: "google-gemini",
    provider: "Google",
    modelLabel: "Gemini",
    providerAliases: ["google", "gemini"],
    modelMatchers: ["gemini"],
    cacheModeLabel: "implicit + explicit",
    ttlPolicy: "default-reference",
    ttlLabel: "custom · default 1h",
    comparableTtls: [{ durationMs: 60 * MINUTE_MS, label: "1h default" }],
    priceBasis: "cached input + storage",
    officialUrl: "https://ai.google.dev/gemini-api/docs/generate-content/caching",
  },
  {
    id: "deepseek",
    provider: "DeepSeek",
    modelLabel: "DeepSeek",
    providerAliases: ["deepseek"],
    modelMatchers: ["deepseek"],
    cacheModeLabel: "implicit",
    ttlPolicy: "provider-managed",
    ttlLabel: "hours to days · best effort",
    comparableTtls: [],
    priceBasis: "cache hit / miss input",
    officialUrl: "https://api-docs.deepseek.com/guides/kv_cache/",
  },
  {
    id: "alibaba-qwen",
    provider: "Alibaba Cloud",
    modelLabel: "Qwen",
    providerAliases: ["alibaba", "aliyun", "dashscope", "qwen"],
    modelMatchers: ["qwen"],
    cacheModeLabel: "implicit or explicit",
    ttlPolicy: "mixed",
    ttlLabel: "explicit 5m · implicit unpublished",
    comparableTtls: [{ durationMs: 5 * MINUTE_MS, label: "5m explicit" }],
    priceBasis: "explicit write 1.25x · read 0.1x",
    officialUrl: "https://help.aliyun.com/zh/model-studio/context-cache",
  },
  {
    id: "zai-glm",
    provider: "Z.AI",
    modelLabel: "GLM",
    providerAliases: ["z.ai", "zai", "glm"],
    modelMatchers: ["glm"],
    cacheModeLabel: "implicit",
    ttlPolicy: "unpublished",
    ttlLabel: "not published",
    comparableTtls: [],
    priceBasis: "cached input rate",
    officialUrl: "https://docs.z.ai/guides/capabilities/cache",
  },
  {
    id: "moonshot-kimi",
    provider: "Moonshot",
    modelLabel: "Kimi",
    providerAliases: ["moonshot", "kimi"],
    modelMatchers: ["kimi"],
    cacheModeLabel: "automatic",
    ttlPolicy: "unpublished",
    ttlLabel: "not published",
    comparableTtls: [],
    priceBasis: "cached input rate",
    officialUrl: "https://platform.kimi.ai/docs/guide/kimi-k3-quickstart",
  },
]);

// Keep this function self-contained: render-html embeds its source verbatim in
// the offline report, while unit tests import the same owner.
export function resolvePromptCacheProfile(profiles, {
  provider,
  models = [],
} = {}) {
  const normalizedProvider = String(provider ?? "").trim().toLowerCase();
  const normalizedModels = (Array.isArray(models) ? models : [models])
    .map((model) => String(model ?? "").trim().toLowerCase())
    .filter(Boolean);
  let best = null;
  let bestScore = 0;
  let tied = false;
  for (const profile of profiles ?? []) {
    const modelMatch = (profile.modelMatchers ?? []).some((matcher) =>
      normalizedModels.some((model) => model.includes(String(matcher).toLowerCase())));
    const providerMatch = (profile.providerAliases ?? []).some((alias) =>
      normalizedProvider.includes(String(alias).toLowerCase()));
    const score = (modelMatch ? 2 : 0) + (providerMatch ? 1 : 0);
    if (score > bestScore) {
      best = profile;
      bestScore = score;
      tied = false;
    } else if (score > 0 && score === bestScore) {
      tied = true;
    }
  }
  return tied ? null : best;
}
