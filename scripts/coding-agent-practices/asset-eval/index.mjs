import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const SURFACES = Object.freeze(["Rules", "Skills", "Custom Agents", "Hooks", "MCP"]);
const SURFACE_TYPES = Object.freeze({
  Rules: new Set(["rules"]),
  Skills: new Set(["skills"]),
  "Custom Agents": new Set(["agents"]),
  Hooks: new Set(["hooks"]),
  MCP: new Set(["mcps"]),
});
const SEVERITY_WEIGHT = Object.freeze({ error: 14, warning: 6, info: 1 });
const STATUS_MULTIPLIER = Object.freeze({ fail: 1, warn: 0.75, info: 0.25, pass: 0 });
const RISK_RANK = Object.freeze({ unknown: 0, low: 1, medium: 2, high: 3 });
const PROFILE_BY_SURFACE = Object.freeze({
  Rules: "rules-quality-v1",
  Skills: "skill-quality-v1",
  "Custom Agents": "custom-agent-quality-v1",
  Hooks: "hook-quality-v1",
  MCP: "mcp-quality-v1",
});
const EVALUATION_FIELDS = Object.freeze([
  "schemaVersion", "profile", "status", "score", "grade", "riskLevel", "confidence",
  "evidenceState", "evaluatedCount", "observedSampleCount", "summary", "checkCounts", "metrics", "findingRefs",
]);
const CHECK_COUNT_FIELDS = Object.freeze(["total", "pass", "warn", "fail", "info", "failedErrors"]);
const METRIC_FIELDS = Object.freeze(["id", "value", "unit", "band", "source"]);
const EVALUATION_STATUSES = new Set(["scored", "unavailable", "not-applicable"]);
const EVALUATION_RISKS = new Set(["low", "medium", "high", "unknown"]);
const EVALUATION_CONFIDENCE = new Set(["low", "medium", "high"]);
const EVALUATION_EVIDENCE = new Set(["static", "observed", "simulated", "fixture-observed", "mixed", "unavailable"]);
const EVALUATION_PROFILES = new Set(Object.values(PROFILE_BY_SURFACE));
export const HOOK_RECOMMENDED_LIMIT = 10;

export function hookOverLimitSummary(assetCount, { locale = "en", maximumP95 = null } = {}) {
  const observed = maximumP95 !== null && maximumP95 !== undefined && Number.isFinite(Number(maximumP95))
    ? locale === "zh-CN" ? `（观察到的最高 p95：${Number(maximumP95)} ms）` : ` (observed max p95: ${Number(maximumP95)} ms)`
    : "";
  return locale === "zh-CN"
    ? `你的生命周期守卫覆盖得很完善，但 ${assetCount} 个 Hooks 已超过建议上限 ${HOOK_RECOMMENDED_LIMIT} 个。过多同步或宽 matcher Hook 可能拖慢 Agent${observed}；建议合并、缩小 matcher 或改用 async。`
    : `Your lifecycle guardrails are well covered, but ${assetCount} Hooks exceed the recommended limit of ${HOOK_RECOMMENDED_LIMIT}. Too many synchronous or broad-matcher Hooks can slow the Agent${observed}; consolidate, narrow matchers, or use async.`;
}

function rows(value) {
  return Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];
}

function text(value) {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function riskMax(...values) {
  return values.reduce((current, value) =>
    (RISK_RANK[value] ?? 0) > (RISK_RANK[current] ?? 0) ? value : current, "unknown");
}

function gradeFor(score) {
  if (!Number.isFinite(score)) return null;
  if (score >= 93) return "A";
  if (score >= 85) return "B";
  if (score >= 70) return "C";
  if (score >= 55) return "D";
  return "F";
}

function normalizedLintCheck(finding) {
  const lintSeverity = text(finding?.severity).toLowerCase();
  if (lintSeverity === "error") {
    return { severity: "error", status: "fail" };
  }
  if (lintSeverity === "warning") {
    return { severity: "warning", status: "warn" };
  }
  return { severity: "info", status: "info" };
}

function createCheck({ id, category, severity, status, assetKey, source = "asset-eval" }) {
  return { id, category, severity, status, assetKey, source };
}

function penaltyFor(check) {
  return (SEVERITY_WEIGHT[check.severity] ?? 0) * (STATUS_MULTIPLIER[check.status] ?? 0);
}

function scoreChecks(checks) {
  const penalty = checks.reduce((total, check) => total + penaltyFor(check), 0);
  const score = Math.max(0, Math.round(100 - penalty));
  const failedErrors = checks.filter((check) => check.severity === "error" && check.status === "fail").length;
  const warnings = checks.filter((check) => check.status === "warn").length;
  const riskLevel = failedErrors > 0 || score < 70
    ? "high"
    : warnings > 0 || score < 85
      ? "medium"
      : "low";
  return { score, grade: gradeFor(score), riskLevel };
}

function surfaceForFinding(finding, profile) {
  const kind = text(finding?.assetKind).toLowerCase();
  if (kind === "skill") return "Skills";
  if (kind === "agent" || kind === "subagent") return "Custom Agents";
  if (kind === "hook") return "Hooks";
  if (kind === "mcp") return "MCP";
  if (kind === "rule" || profile === "agents-md-review") return "Rules";
  return null;
}

function assetKeyForFinding(finding, surface, index) {
  return text(finding?.assetName)
    || text(finding?.file)
    || `${surface.toLowerCase()}-${index + 1}`;
}

function lintChecksBySurface(instructionReview, assetReview) {
  const result = new Map(SURFACES.map((surface) => [surface, []]));
  for (const [profile, payload] of [["agents-md-review", instructionReview], ["agent-assets-review", assetReview]]) {
    for (const [index, finding] of rows(payload?.findings).entries()) {
      if (finding?.id === "root-length-acceptable") continue;
      const surface = surfaceForFinding(finding, profile);
      if (!surface || !result.has(surface)) continue;
      const check = normalizedLintCheck(finding);
      result.get(surface).push(createCheck({
        id: text(finding?.id) || `${surface.toLowerCase()}-lint-${index + 1}`,
        category: ["Skills", "Custom Agents"].includes(surface)
          ? "structure"
          : ["Hooks", "MCP"].includes(surface)
            ? "safety"
            : "guidance",
        severity: check.severity,
        status: check.status,
        assetKey: assetKeyForFinding(finding, surface, index),
        source: profile,
      }));
    }
  }
  return result;
}

function inventoryItems(inventory, surface) {
  const types = SURFACE_TYPES[surface];
  if (!types) return [];
  const seen = new Set();
  const result = [];
  for (const inventorySurface of rows(inventory?.surfaces)) {
    if (!types.has(inventorySurface?.type)) continue;
    for (const item of rows(inventorySurface?.items)) {
      const key = text(item?.id)
        || text(item?.filePath)
        || text(item?.path)
        || `${surface}:${text(item?.name)}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

function coverageRow(coverageRows, surface) {
  return rows(coverageRows).find((row) => row?.surface === surface) ?? null;
}

function itemAssetKey(item, surface, index) {
  return text(item?.name)
    || text(item?.label)
    || text(item?.filePath)
    || text(item?.path)
    || `${surface.toLowerCase()}-${index + 1}`;
}

async function markdownBytes(root, limit = 100) {
  const metadata = await stat(root).catch(() => null);
  if (!metadata) return 0;
  if (metadata.isFile()) {
    return root.toLowerCase().endsWith(".md") ? (await readFile(root).catch(() => Buffer.alloc(0))).byteLength : 0;
  }
  if (!metadata.isDirectory()) return 0;
  let total = 0;
  let visited = 0;
  const queue = [root];
  while (queue.length > 0 && visited < limit) {
    const directory = queue.shift();
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (visited >= limit) break;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        queue.push(target);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        total += (await readFile(target).catch(() => Buffer.alloc(0))).byteLength;
        visited += 1;
      }
    }
  }
  return total;
}

function tokenBand(value, thresholds) {
  if (!Number.isFinite(value)) return "unavailable";
  if (value <= thresholds.good) return "good";
  if (value <= thresholds.moderate) return "moderate";
  if (value <= thresholds.heavy) return "heavy";
  return "excessive";
}

function budgetCheck(id, value, thresholds, assetKey) {
  const band = tokenBand(value, thresholds);
  if (band === "excessive") {
    return createCheck({ id, category: "budget", severity: "error", status: "fail", assetKey });
  }
  if (band === "heavy") {
    return createCheck({ id, category: "budget", severity: "warning", status: "warn", assetKey });
  }
  return createCheck({ id, category: "budget", severity: "info", status: "pass", assetKey });
}

async function skillBudgetEvidence(items) {
  const checks = [];
  const budgets = [];
  for (const [index, item] of items.entries()) {
    const assetKey = itemAssetKey(item, "Skills", index);
    let entryPath = text(item?.filePath) || text(item?.path);
    const metadata = entryPath ? await stat(entryPath).catch(() => null) : null;
    if (metadata?.isDirectory()) entryPath = path.join(entryPath, "SKILL.md");
    const content = entryPath ? await readFile(entryPath, "utf8").catch(() => "") : "";
    if (!content) continue;
    const root = path.dirname(entryPath);
    const descriptionTokens = Math.ceil(text(item?.description).length / 4);
    const invokeTokens = Math.ceil(content.length / 4);
    const deferredTokens = Math.ceil(await markdownBytes(path.join(root, "references")) / 4);
    budgets.push({ assetKey, triggerTokens: descriptionTokens, invokeTokens, deferredTokens });
    checks.push(
      budgetCheck("trigger-cost-tokens", descriptionTokens, { good: 48, moderate: 92, heavy: 150 }, assetKey),
      budgetCheck("invoke-cost-tokens", invokeTokens, { good: 220, moderate: 480, heavy: 900 }, assetKey),
      budgetCheck("deferred-cost-tokens", deferredTokens, { good: 180, moderate: 520, heavy: 1200 }, assetKey),
    );
  }
  return { checks, budgets };
}

async function customAgentStaticEvidence(items) {
  let maxPromptTokens = 0;
  let explicitToolBoundaryCount = 0;
  let readableCount = 0;
  for (const item of items) {
    const filePath = text(item?.filePath) || text(item?.path);
    if (!filePath) continue;
    const content = await readFile(filePath, "utf8").catch(() => "");
    if (!content) continue;
    readableCount += 1;
    const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
    const prompt = frontmatter ? content.slice(frontmatter[0].length).trim() : content.trim();
    maxPromptTokens = Math.max(maxPromptTokens, Math.ceil(prompt.length / 4));
    if (frontmatter && /^tools\s*:/imu.test(frontmatter[1])) explicitToolBoundaryCount += 1;
  }
  return { maxPromptTokens, explicitToolBoundaryCount, readableCount };
}

function hookBudgetMs(event) {
  return /^(?:pre|post)tooluse(?:failure)?$/iu.test(String(event ?? "").replace(/\s+/gu, "")) ? 500 : 2000;
}

function hookPressure(items) {
  const groups = new Map();
  for (const item of items) {
    if (item?.async === true) continue;
    const event = text(item?.step) || "unknown";
    const matcher = text(item?.matcher) || "*";
    const key = `${event}:${matcher}`;
    groups.set(key, { event, matcher, count: (groups.get(key)?.count ?? 0) + 1 });
  }
  let maximum = 0;
  let riskLevel = "low";
  for (const group of groups.values()) {
    maximum = Math.max(maximum, group.count);
    const highFrequency = /^(?:pre|post)tooluse(?:failure)?$/iu.test(group.event.replace(/\s+/gu, ""));
    const mediumAt = highFrequency ? 3 : 5;
    const highAt = highFrequency ? 5 : 8;
    riskLevel = riskMax(riskLevel, group.count >= highAt ? "high" : group.count >= mediumAt ? "medium" : "low");
  }
  return { maximum, riskLevel };
}

function hookRuntimeSummary(runtime) {
  const commands = rows(runtime?.commands);
  const groups = rows(runtime?.groups);
  const candidates = [...commands, ...groups];
  let observedSampleCount = 0;
  let maximumP95 = null;
  let maximumBudget = null;
  let attributionGapP95 = null;
  let riskLevel = "unknown";
  for (const candidate of candidates) {
    const samples = nonNegativeInteger(candidate?.durationSamples);
    const executions = nonNegativeInteger(candidate?.executions);
    const failures = nonNegativeInteger(candidate?.failures);
    const p95 = Number(candidate?.p95Ms);
    const event = text(candidate?.name).split(" -> ")[0];
    const budget = hookBudgetMs(event);
    observedSampleCount += samples;
    if (samples >= 5 && Number.isFinite(p95)) {
      if (maximumP95 === null || p95 > maximumP95) {
        maximumP95 = p95;
        maximumBudget = budget;
      }
      riskLevel = riskMax(riskLevel, p95 > budget ? "high" : "low");
    }
    if (executions >= 5 && failures >= 3) riskLevel = "high";
  }
  for (const group of groups) {
    const samples = nonNegativeInteger(group?.durationSamples);
    const p95 = Number(group?.p95Ms);
    const event = text(group?.name);
    const budget = hookBudgetMs(event);
    const commandSamples = commands
      .filter((command) => text(command?.name).toLowerCase().startsWith(`${event.toLowerCase()} -> `))
      .reduce((total, command) => total + nonNegativeInteger(command?.durationSamples), 0);
    if (samples - commandSamples >= 5 && Number.isFinite(p95) && p95 > budget) {
      attributionGapP95 = attributionGapP95 === null ? p95 : Math.max(attributionGapP95, p95);
      riskLevel = "high";
    }
  }
  return { observedSampleCount, maximumP95, maximumBudget, attributionGapP95, riskLevel };
}

function findingRefs(surface, checks) {
  const projected = checks.some((check) =>
    ["agents-md-review", "agent-assets-review"].includes(check.source)
      && (check.status === "fail" || check.status === "warn"));
  if (!projected) return [];
  return [`practice-${surface.toLowerCase().replace(/[^a-z0-9]+/gu, "-")}-quality`];
}

function surfaceScores(checks, items, count) {
  const byAsset = new Map();
  for (const check of checks) {
    const assetChecks = byAsset.get(check.assetKey) ?? [];
    assetChecks.push(check);
    byAsset.set(check.assetKey, assetChecks);
  }
  const itemKeys = items.map((item, index) => itemAssetKey(item, "asset", index));
  for (const key of itemKeys) if (!byAsset.has(key)) byAsset.set(key, []);
  const evaluatedCount = Math.max(count, byAsset.size);
  const scores = [...byAsset.values()].map(scoreChecks);
  while (scores.length < evaluatedCount) scores.push(scoreChecks([]));
  if (scores.length === 0) return { evaluatedCount: 0, score: null, grade: null, riskLevel: "unknown" };
  const score = Math.round(scores.reduce((sum, item) => sum + item.score, 0) / scores.length);
  return {
    evaluatedCount: scores.length,
    score,
    grade: gradeFor(score),
    riskLevel: scores.reduce((risk, item) => riskMax(risk, item.riskLevel), "unknown"),
  };
}

function customAgentIssue(checks, locale) {
  const priority = [...checks]
    .filter((check) => check.status !== "pass")
    .sort((left, right) =>
      (right.severity === "error" ? 3 : right.severity === "warning" ? 2 : 1)
      - (left.severity === "error" ? 3 : left.severity === "warning" ? 2 : 1))[0];
  const labels = {
    "custom-agent-missing-frontmatter": ["one profile missing valid frontmatter", "一个配置缺少有效 frontmatter"],
    "custom-agent-malformed-frontmatter": ["one profile containing malformed frontmatter", "一个配置的 frontmatter 无法解析"],
    "custom-agent-missing-name": ["one profile missing a stable invocable name", "一个配置缺少稳定的可调用名称"],
    "custom-agent-invalid-name": ["one profile using an invalid invocable name", "一个配置的可调用名称不合法"],
    "custom-agent-name-mismatch": ["one profile containing a name/filename mismatch", "一个配置的名称与文件名不一致"],
    "custom-agent-missing-description": ["one profile missing a routing description", "一个配置缺少路由描述"],
    "custom-agent-description-too-short": ["one profile using an unclear routing description", "一个配置的路由描述不够清楚"],
    "custom-agent-empty-prompt": ["one profile missing a system prompt", "一个配置缺少 system prompt"],
    "custom-agent-prompt-too-short": ["one profile containing an incomplete system prompt", "一个配置的 system prompt 不完整"],
    "custom-agent-prompt-too-large": ["one profile exceeding the portable prompt limit", "一个配置超过可移植的 prompt 上限"],
    "custom-agent-missing-local-reference": ["one profile containing a broken local reference", "一个配置存在失效的本地引用"],
    "custom-agent-unbounded-tools": ["one profile missing a clear tool boundary", "一个配置缺少清楚的工具边界"],
    "custom-agent-tool-role-conflict": ["one read-only profile granting write-capable tools", "一个只读配置却授予了写入工具"],
  }[priority?.id];
  return labels ? labels[locale === "zh-CN" ? 1 : 0] : "";
}

function summaryText(surface, evaluation, locale, hookRuntime, assetCount = 0, checks = []) {
  if (evaluation.status === "not-applicable") {
    return locale === "zh-CN" ? `本次范围内没有需要评估的 ${surface}。` : `No ${surface} assets require evaluation in this scope.`;
  }
  if (surface === "Hooks" && hookRuntime.attributionGapP95 !== null) {
    return locale === "zh-CN"
      ? `Hook 事件组的 p95 为 ${hookRuntime.attributionGapP95} ms 且超过预算，但目前无法归因到具体命令。`
      : `A Hook event-group p95 of ${hookRuntime.attributionGapP95} ms is over budget but cannot be attributed to one command.`;
  }
  if (evaluation.status === "unavailable") {
    if (surface === "Custom Agents") {
      return locale === "zh-CN"
        ? `已配置 ${assetCount} 个 Custom Agents，但尚未完成 profile 内容检查。`
        : `${assetCount} Custom Agents are configured, but their profile content was not reviewed.`;
    }
    return locale === "zh-CN" ? `${surface} 的可归因证据不足，暂时无法评分。` : `${surface} lacks enough attributable evidence for a score.`;
  }
  if (surface === "Custom Agents") {
    const issue = customAgentIssue(checks, locale);
    if (locale === "zh-CN") {
      return issue
        ? `Custom Agents 评分 ${evaluation.score}（${evaluation.grade}）；已配置 ${assetCount} 个，${issue}。`
        : `Custom Agents 评分 ${evaluation.score}（${evaluation.grade}）；已配置 ${assetCount} 个，确定性检查未发现问题。`;
    }
    return issue
      ? `Custom Agents score ${evaluation.score} (${evaluation.grade}); ${assetCount} configured, with ${issue}.`
      : `Custom Agents score ${evaluation.score} (${evaluation.grade}); ${assetCount} configured, with no deterministic profile gaps.`;
  }
  if (surface === "Hooks" && hookRuntime.maximumP95 !== null) {
    if (assetCount > HOOK_RECOMMENDED_LIMIT) {
      return hookOverLimitSummary(assetCount, { locale, maximumP95: hookRuntime.maximumP95 });
    }
    return locale === "zh-CN"
      ? `Hooks 评分 ${evaluation.score}（${evaluation.grade}）；观察到的最高 p95 为 ${hookRuntime.maximumP95} ms。`
      : `Hooks score ${evaluation.score} (${evaluation.grade}); the highest observed p95 is ${hookRuntime.maximumP95} ms.`;
  }
  if (surface === "Hooks" && assetCount > HOOK_RECOMMENDED_LIMIT) {
    return hookOverLimitSummary(assetCount, { locale });
  }
  return locale === "zh-CN"
    ? `${surface} 评分 ${evaluation.score}（${evaluation.grade}），风险级别为 ${evaluation.riskLevel}。`
    : `${surface} scores ${evaluation.score} (${evaluation.grade}) with ${evaluation.riskLevel} risk.`;
}

function checkCounts(checks, cleanAssets = 0) {
  return {
    total: checks.length + cleanAssets,
    pass: checks.filter((check) => check.status === "pass").length + cleanAssets,
    warn: checks.filter((check) => check.status === "warn").length,
    fail: checks.filter((check) => check.status === "fail").length,
    info: checks.filter((check) => check.status === "info").length,
    failedErrors: checks.filter((check) => check.status === "fail" && check.severity === "error").length,
  };
}

export async function evaluateAgentAssetSurfaces({
  coverageRows = [],
  inventory = null,
  instructionReview = {},
  assetReview = {},
  hookRuntime = null,
  locale = "en",
} = {}) {
  const normalizedLocale = locale === "zh-CN" ? "zh-CN" : "en";
  const lintChecks = lintChecksBySurface(instructionReview, assetReview);
  const skillItems = inventoryItems(inventory, "Skills");
  const skillBudgets = await skillBudgetEvidence(skillItems);
  lintChecks.get("Skills").push(...skillBudgets.checks);
  const customAgentItems = inventoryItems(inventory, "Custom Agents");
  const customAgentEvidence = await customAgentStaticEvidence(customAgentItems);
  const evaluations = [];

  for (const surface of SURFACES) {
    const row = coverageRow(coverageRows, surface);
    const items = inventoryItems(inventory, surface);
    const count = row?.count === undefined ? items.length : nonNegativeInteger(row.count);
    const checks = lintChecks.get(surface) ?? [];
    const hasEvidence = Boolean(row) || items.length > 0 || checks.length > 0;
    const reviewCompleted = surface === "Rules"
      ? Array.isArray(instructionReview?.findings)
      : Array.isArray(assetReview?.findings);
    const hasScoringEvidence = checks.length > 0 || reviewCompleted;
    const scored = surfaceScores(checks, items, count);
    const hookPressureResult = surface === "Hooks" ? hookPressure(items) : { maximum: 0, riskLevel: "unknown" };
    const hookRuntimeResult = surface === "Hooks" ? hookRuntimeSummary(hookRuntime) : {
      observedSampleCount: 0,
      maximumP95: null,
      maximumBudget: null,
      attributionGapP95: null,
      riskLevel: "unknown",
    };
    const observed = hookRuntimeResult.observedSampleCount > 0;
    const status = surface === "Custom Agents" && count === 0
      ? "not-applicable"
      : !hasEvidence
      ? "not-applicable"
      : !hasScoringEvidence || scored.score === null
        ? "unavailable"
        : "scored";
    const independentHookRisk = surface === "Hooks"
      ? riskMax(count > HOOK_RECOMMENDED_LIMIT ? "high" : "low", hookPressureResult.riskLevel, hookRuntimeResult.riskLevel)
      : "unknown";
    const riskLevel = status === "scored"
      ? riskMax(scored.riskLevel, independentHookRisk)
      : status === "unavailable"
        ? independentHookRisk
        : "unknown";
    const evidenceState = observed && hasEvidence ? "mixed" : observed ? "observed" : hasEvidence ? "static" : "unavailable";
    const confidence = status === "unavailable"
      ? "low"
      : observed && hookRuntimeResult.observedSampleCount >= 5
      ? "high"
      : hasEvidence && (checks.length > 0 || items.length > 0)
        ? "medium"
        : "low";
    const metrics = [];
    if (count > 0) metrics.push({
      id: "asset-count",
      value: count,
      unit: "assets",
      band: surface === "Hooks" && count > HOOK_RECOMMENDED_LIMIT ? "over-limit" : "info",
      source: "inventory",
    });
    if (surface === "Skills" && skillBudgets.budgets.length > 0) {
      metrics.push({
        id: "max-invoke-tokens",
        value: Math.max(...skillBudgets.budgets.map((item) => item.invokeTokens)),
        unit: "tokens",
        band: tokenBand(Math.max(...skillBudgets.budgets.map((item) => item.invokeTokens)), { good: 220, moderate: 480, heavy: 900 }),
        source: "static-estimate",
      });
      metrics.push({
        id: "max-deferred-tokens",
        value: Math.max(...skillBudgets.budgets.map((item) => item.deferredTokens)),
        unit: "tokens",
        band: tokenBand(Math.max(...skillBudgets.budgets.map((item) => item.deferredTokens)), { good: 180, moderate: 520, heavy: 1200 }),
        source: "static-estimate",
      });
    }
    if (surface === "Custom Agents" && customAgentEvidence.readableCount > 0) {
      metrics.push({
        id: "max-prompt-tokens",
        value: customAgentEvidence.maxPromptTokens,
        unit: "tokens",
        band: customAgentEvidence.maxPromptTokens > 7_500 ? "over-portable-limit" : "unrated",
        source: "static-estimate",
      });
      metrics.push({
        id: "explicit-tool-boundary-count",
        value: customAgentEvidence.explicitToolBoundaryCount,
        unit: "agents",
        band: customAgentEvidence.explicitToolBoundaryCount === count ? "complete" : "partial",
        source: "inventory",
      });
    }
    if (surface === "Hooks") {
      metrics.push({ id: "max-sync-fanout", value: hookPressureResult.maximum, unit: "hooks", band: hookPressureResult.riskLevel, source: "inventory" });
      if (hookRuntimeResult.maximumP95 !== null) {
        metrics.push({
          id: "p95-duration",
          value: hookRuntimeResult.maximumP95,
          unit: "ms",
          band: hookRuntimeResult.attributionGapP95 !== null
            ? "unattributed-over-budget"
            : hookRuntimeResult.maximumP95 > hookRuntimeResult.maximumBudget ? "over-budget" : "within-budget",
          source: "host-observed",
        });
      }
    }
    if (surface === "MCP" && items.length > 0) {
      const toolCount = items.reduce((sum, item) => sum + nonNegativeInteger(item?.toolCount), 0);
      const resourceCount = items.reduce((sum, item) => sum + nonNegativeInteger(item?.resourceCount), 0);
      if (toolCount > 0) metrics.push({ id: "tool-count", value: toolCount, unit: "tools", band: "unrated", source: "inventory" });
      if (resourceCount > 0) metrics.push({ id: "resource-count", value: resourceCount, unit: "resources", band: "unrated", source: "inventory" });
    }
    const evaluation = {
      schemaVersion: 1,
      profile: PROFILE_BY_SURFACE[surface],
      status,
      score: status === "scored" ? scored.score : null,
      grade: status === "scored" ? scored.grade : null,
      riskLevel,
      confidence,
      evidenceState,
      evaluatedCount: scored.evaluatedCount,
      observedSampleCount: hookRuntimeResult.observedSampleCount,
      summary: "",
      checkCounts: checkCounts(checks, Math.max(0, scored.evaluatedCount - new Set(checks.map((check) => check.assetKey)).size)),
      metrics: metrics.slice(0, 3),
      findingRefs: findingRefs(surface, checks),
    };
    evaluation.summary = summaryText(surface, evaluation, normalizedLocale, hookRuntimeResult, count, checks);
    evaluations.push({ surface, evaluation });
  }
  return evaluations;
}

export function attachAssetEvaluations(coverageRows, evaluations) {
  const evaluationBySurface = new Map(rows(evaluations).map((item) => [item.surface, item.evaluation]));
  return rows(coverageRows).map((row) => ({
    ...row,
    ...(evaluationBySurface.has(row?.surface) ? { evaluation: evaluationBySurface.get(row.surface) } : {}),
  }));
}

function safeMetric(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = text(value.id).slice(0, 72);
  const unit = text(value.unit).slice(0, 32);
  const band = text(value.band).slice(0, 32);
  const source = text(value.source).slice(0, 32);
  const numericValue = Number(value.value);
  if (!id || !unit || !band || !source || !Number.isFinite(numericValue)) return null;
  return { id, value: numericValue, unit, band, source };
}

export function normalizeAssetEvaluation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const status = EVALUATION_STATUSES.has(value.status) ? value.status : "unavailable";
  const score = status === "scored" && Number.isInteger(Number(value.score))
    ? Math.max(0, Math.min(100, Number(value.score)))
    : null;
  const result = {
    schemaVersion: 1,
    profile: EVALUATION_PROFILES.has(value.profile) ? value.profile : "rules-quality-v1",
    status,
    score,
    grade: score === null ? null : gradeFor(score),
    riskLevel: EVALUATION_RISKS.has(value.riskLevel) ? value.riskLevel : "unknown",
    confidence: EVALUATION_CONFIDENCE.has(value.confidence) ? value.confidence : "low",
    evidenceState: EVALUATION_EVIDENCE.has(value.evidenceState) ? value.evidenceState : "unavailable",
    evaluatedCount: nonNegativeInteger(value.evaluatedCount),
    observedSampleCount: nonNegativeInteger(value.observedSampleCount),
    summary: text(value.summary).slice(0, 240),
    checkCounts: Object.fromEntries(CHECK_COUNT_FIELDS.map((field) => [field, nonNegativeInteger(value?.checkCounts?.[field])])),
    metrics: rows(value.metrics).map(safeMetric).filter(Boolean).slice(0, 3),
    findingRefs: [...new Set(rows(value.findingRefs).map((item) => text(item)).filter((item) => /^[a-z0-9][a-z0-9._-]{0,95}$/u.test(item)))],
  };
  if (status !== "scored") {
    result.score = null;
    result.grade = null;
    result.riskLevel = result.riskLevel === "unknown" ? "unknown" : result.riskLevel;
  }
  return result;
}

export function assetEvaluationErrors(value, location = "evaluation", findingIds = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [`${location} must be an object`];
  const errors = [];
  for (const field of Object.keys(value)) {
    if (!EVALUATION_FIELDS.includes(field)) errors.push(`${location} has unsupported field: ${field}`);
  }
  if (value.schemaVersion !== 1) errors.push(`${location}.schemaVersion must be 1`);
  if (!EVALUATION_PROFILES.has(value.profile)) errors.push(`${location}.profile is invalid`);
  if (!EVALUATION_STATUSES.has(value.status)) errors.push(`${location}.status is invalid`);
  if (!EVALUATION_RISKS.has(value.riskLevel)) errors.push(`${location}.riskLevel is invalid`);
  if (!EVALUATION_CONFIDENCE.has(value.confidence)) errors.push(`${location}.confidence is invalid`);
  if (!EVALUATION_EVIDENCE.has(value.evidenceState)) errors.push(`${location}.evidenceState is invalid`);
  for (const field of ["evaluatedCount", "observedSampleCount"]) {
    if (!Number.isInteger(value[field]) || value[field] < 0) errors.push(`${location}.${field} must be a non-negative integer`);
  }
  if (typeof value.summary !== "string" || !value.summary.trim() || value.summary.length > 240) {
    errors.push(`${location}.summary must be a non-empty string with at most 240 characters`);
  }
  if (value.status === "scored") {
    if (!Number.isInteger(value.score) || value.score < 0 || value.score > 100) errors.push(`${location}.score must be an integer from 0 to 100`);
    else if (value.grade !== gradeFor(value.score)) errors.push(`${location}.grade does not match score`);
    if (value.riskLevel === "unknown") errors.push(`${location}.riskLevel must be known when scored`);
  } else if (value.score !== null || value.grade !== null) {
    errors.push(`${location}.score and grade must be null when status is not scored`);
  }
  if (!value.checkCounts || typeof value.checkCounts !== "object" || Array.isArray(value.checkCounts)) {
    errors.push(`${location}.checkCounts must be an object`);
  } else {
    for (const field of Object.keys(value.checkCounts)) {
      if (!CHECK_COUNT_FIELDS.includes(field)) errors.push(`${location}.checkCounts has unsupported field: ${field}`);
    }
    for (const field of CHECK_COUNT_FIELDS) {
      if (!Number.isInteger(value.checkCounts[field]) || value.checkCounts[field] < 0) {
        errors.push(`${location}.checkCounts.${field} must be a non-negative integer`);
      }
    }
  }
  if (!Array.isArray(value.metrics) || value.metrics.length > 3) {
    errors.push(`${location}.metrics must contain at most three rows`);
  } else {
    for (const [index, metric] of value.metrics.entries()) {
      const prefix = `${location}.metrics[${index}]`;
      if (!metric || typeof metric !== "object" || Array.isArray(metric)) {
        errors.push(`${prefix} must be an object`);
        continue;
      }
      for (const field of Object.keys(metric)) {
        if (!METRIC_FIELDS.includes(field)) errors.push(`${prefix} has unsupported field: ${field}`);
      }
      for (const field of ["id", "unit", "band", "source"]) {
        if (typeof metric[field] !== "string" || !metric[field].trim()) errors.push(`${prefix}.${field} must be a non-empty string`);
      }
      if (!Number.isFinite(metric.value)) errors.push(`${prefix}.value must be numeric`);
    }
  }
  if (!Array.isArray(value.findingRefs)) {
    errors.push(`${location}.findingRefs must be an array`);
  } else if (findingIds) {
    for (const ref of value.findingRefs) {
      if (!findingIds.has(String(ref))) errors.push(`${location}.findingRefs contains unknown finding id: ${ref}`);
    }
  }
  return errors;
}

export function renderAssetEvaluationMarkdown(evaluations) {
  const rowsToRender = rows(evaluations).filter((item) => item?.evaluation?.status !== "not-applicable");
  const top = [...rowsToRender].sort((left, right) =>
    (RISK_RANK[right.evaluation.riskLevel] ?? 0) - (RISK_RANK[left.evaluation.riskLevel] ?? 0)
      || (left.evaluation.score ?? 101) - (right.evaluation.score ?? 101))[0];
  const fixFirst = top?.evaluation?.findingRefs?.[0] ?? "No repair-worthy finding was produced.";
  const next = rowsToRender.some((item) => ["static", "unavailable"].includes(item.evaluation.evidenceState))
    ? "Collect bounded runtime evidence for static-only surfaces."
    : "Repair the highest-risk linked finding, then rerun the same evaluation profile.";
  return [
    "# Agent Asset Evaluation",
    "",
    "## At a Glance",
    ...rowsToRender.map((item) => `- ${item.surface}: ${item.evaluation.score ?? "unavailable"}${item.evaluation.grade ? `/${item.evaluation.grade}` : ""} (${item.evaluation.riskLevel} risk, ${item.evaluation.confidence} confidence)`),
    "",
    "## Why It Matters",
    ...rowsToRender.map((item) => `- ${item.evaluation.summary}`),
    "",
    "## Fix First",
    `- ${fixFirst}`,
    "",
    "## Recommended Next Step",
    `- ${next}`,
  ].join("\n");
}

export const ASSET_EVALUATION_SURFACES = SURFACES;
