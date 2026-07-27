#!/usr/bin/env node

import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseArgs } from "../session-analysis/cli.mjs";
import { HOOK_RECOMMENDED_LIMIT, hookOverLimitSummary } from "./asset-eval/index.mjs";
import { collectProviderInventory, collectQoderInventory } from "./inventory.mjs";

export const ASSET_INTEGRITY_PROFILE = "asset-integrity-review";
export const MEMORY_TITLE_SIMILARITY_THRESHOLD = 0.8;
export const PLUGIN_NAME_FAMILY_SIMILARITY_THRESHOLD = 0.68;
export const MAX_MEMORY_TITLES_REVIEWED = 2_000;
const MAX_EMITTED_CANDIDATES = 12;

function rows(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function text(value, limit = 120) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, limit);
}

function shortHash(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, 12);
}

export function normalizeAssetTitle(value) {
  return text(value, 240)
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function bigrams(value) {
  const chars = [...value];
  if (chars.length < 2) return new Set(chars);
  return new Set(chars.slice(0, -1).map((char, index) => `${char}${chars[index + 1]}`));
}

function bigramSimilarity(left, right) {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  const smaller = left.size <= right.size ? left : right;
  const larger = smaller === left ? right : left;
  for (const token of smaller) if (larger.has(token)) intersection += 1;
  return (2 * intersection) / (left.size + right.size);
}

export function titleSimilarity(left, right) {
  const a = bigrams(normalizeAssetTitle(left));
  const b = bigrams(normalizeAssetTitle(right));
  return bigramSimilarity(a, b);
}

function memoryTitleEntries(inventory) {
  const seen = new Set();
  return rows(inventory?.memories?.categories)
    .flatMap((category) => rows(category?.titleEntries))
    .filter((entry) => {
      const title = text(entry?.title);
      const key = `${entry?.scope ?? "unknown"}:${entry?.path ?? title}`;
      if (!title || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => String(left.scope).localeCompare(String(right.scope)) || String(left.title).localeCompare(String(right.title)));
}

function memoryFindings(inventory, locale, maxReviewedTitles = MAX_MEMORY_TITLES_REVIEWED) {
  const allEntries = memoryTitleEntries(inventory);
  const reviewedEntries = allEntries.slice(0, Math.max(1, Math.min(MAX_MEMORY_TITLES_REVIEWED, Number(maxReviewedTitles) || MAX_MEMORY_TITLES_REVIEWED)));
  const exactGroups = new Map();
  // Exact grouping is linear, so keep it complete even when near-pair review is bounded.
  for (const entry of allEntries) {
    const normalized = normalizeAssetTitle(entry.title);
    if (!normalized) continue;
    const group = exactGroups.get(normalized) ?? [];
    group.push(entry);
    exactGroups.set(normalized, group);
  }

  const findings = [];
  for (const [normalized, group] of exactGroups) {
    if (group.length < 2) continue;
    const titles = group.slice(0, 3).map((entry) => `“${text(entry.title, 80)}”`).join(locale === "zh-CN" ? "、" : ", ");
    findings.push({
      id: "memory-title-collision",
      severity: "advisory",
      assetKind: "memory",
      assetName: `memory-title-${shortHash(normalized)}`,
      why: locale === "zh-CN"
        ? `发现 ${group.length} 条规范化后同名的 Memory 标题：${titles}。这只证明标题元数据发生命名碰撞，不能证明正文重复或当前影响；仅作为人工治理审查候选。`
        : `${group.length} Memory titles normalize to the same name: ${titles}. This proves only a title-metadata collision, not duplicate body content or current impact; treat it as a manual governance-review candidate.`,
    });
  }

  const comparableEntries = reviewedEntries.map((entry) => {
    const normalized = normalizeAssetTitle(entry.title);
    return { entry, normalized, bigrams: bigrams(normalized) };
  });
  const nearPairs = [];
  for (let leftIndex = 0; leftIndex < comparableEntries.length; leftIndex += 1) {
    const left = comparableEntries[leftIndex];
    if (left.normalized.length < 8) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < comparableEntries.length; rightIndex += 1) {
      const right = comparableEntries[rightIndex];
      if (right.normalized.length < 8 || left.normalized === right.normalized) continue;
      const score = bigramSimilarity(left.bigrams, right.bigrams);
      if (score >= MEMORY_TITLE_SIMILARITY_THRESHOLD) nearPairs.push({ left, right, score });
    }
  }
  nearPairs.sort((a, b) => b.score - a.score || String(a.left.entry.title).localeCompare(String(b.left.entry.title)));
  for (const pair of nearPairs.slice(0, MAX_EMITTED_CANDIDATES)) {
    const leftTitle = text(pair.left.entry.title, 80);
    const rightTitle = text(pair.right.entry.title, 80);
    findings.push({
      id: "memory-title-similarity",
      severity: "advisory",
      assetKind: "memory",
      assetName: `memory-title-pair-${shortHash(`${pair.left.entry.scope}:${leftTitle}:${rightTitle}`)}`,
      why: locale === "zh-CN"
        ? `Memory 标题“${leftTitle}”与“${rightTitle}”相似度为 ${Math.round(pair.score * 100)}%；仅作为人工合并审查候选。`
        : `Memory titles “${leftTitle}” and “${rightTitle}” are ${Math.round(pair.score * 100)}% similar; this is a manual merge-review candidate only.`,
    });
  }
  return {
    findings,
    diagnostics: {
      titleCount: allEntries.length,
      reviewedTitleCount: reviewedEntries.length,
      truncated: allEntries.length > reviewedEntries.length,
      exactCollisionGroups: [...exactGroups.values()].filter((group) => group.length > 1).length,
      similarityCandidates: nearPairs.length,
    },
  };
}

function surfaceItems(inventory, type, { includePluginGroup = true } = {}) {
  return rows(inventory?.surfaces)
    .filter((surface) => surface?.type === type && (includePluginGroup || surface?.group !== "Plugin/marketplace assets"))
    .flatMap((surface) => rows(surface?.items));
}

function pluginLabel(plugin) {
  const id = text(plugin?.id, 72) || "unknown-plugin";
  const version = text(plugin?.version, 32);
  return version ? `${id} (${version})` : id;
}

function pluginFindings(inventory, locale) {
  const plugins = surfaceItems(inventory, "plugins");
  const findings = [];
  const collisionKeys = new Map();
  for (const plugin of plugins) {
    for (const [kind, value] of [["canonical", plugin?.canonicalName], ["display", plugin?.displayName ?? plugin?.name]]) {
      const normalized = normalizeAssetTitle(value);
      if (!normalized) continue;
      const key = `${kind}:${normalized}`;
      const group = collisionKeys.get(key) ?? [];
      group.push(plugin);
      collisionKeys.set(key, group);
    }
  }
  const emittedGroups = new Set();
  for (const [key, group] of collisionKeys) {
    const unique = [...new Map(group.map((plugin) => [plugin.id, plugin])).values()];
    const identity = unique.map((plugin) => plugin.id).sort().join(":");
    if (unique.length < 2 || emittedGroups.has(identity)) continue;
    emittedGroups.add(identity);
    const labels = unique.slice(0, 4).map(pluginLabel).join(locale === "zh-CN" ? "、" : ", ");
    findings.push({
      id: "plugin-name-collision",
      severity: "warning",
      assetKind: "plugin",
      assetName: `plugin-group-${shortHash(identity)}`,
      why: locale === "zh-CN"
        ? `多个已启用 Plugin 使用相同名称：${labels}。请确认哪个来源是当前能力所有者。`
        : `Multiple enabled Plugins share the same name: ${labels}. Confirm which source owns the active capability.`,
    });
  }

  const fingerprints = new Map();
  for (const plugin of plugins) {
    if (!plugin?.capabilityFingerprint || Number(plugin?.capabilityCount ?? 0) === 0) continue;
    const group = fingerprints.get(plugin.capabilityFingerprint) ?? [];
    group.push(plugin);
    fingerprints.set(plugin.capabilityFingerprint, group);
  }
  for (const [fingerprint, group] of fingerprints) {
    if (group.length < 2) continue;
    const labels = group.slice(0, 4).map(pluginLabel).join(locale === "zh-CN" ? "、" : ", ");
    findings.push({
      id: "plugin-capability-overlap",
      severity: "advisory",
      assetKind: "plugin",
      assetName: `plugin-capabilities-${shortHash(fingerprint)}`,
      why: locale === "zh-CN"
        ? `${labels} 暴露了相同的非空 capability 指纹；需要核对它们是镜像、版本替代还是有意并存。`
        : `${labels} expose the same non-empty capability fingerprint; review whether they are mirrors, replacements, or intentional variants.`,
    });
  }

  const familyPairs = [];
  for (let leftIndex = 0; leftIndex < plugins.length; leftIndex += 1) {
    const left = plugins[leftIndex];
    const leftName = left?.displayName ?? left?.name;
    for (let rightIndex = leftIndex + 1; rightIndex < plugins.length; rightIndex += 1) {
      const right = plugins[rightIndex];
      const rightName = right?.displayName ?? right?.name;
      const leftNormalized = normalizeAssetTitle(leftName);
      const rightNormalized = normalizeAssetTitle(rightName);
      if (leftNormalized.length < 6 || rightNormalized.length < 6 || leftNormalized === rightNormalized) continue;
      const score = titleSimilarity(leftName, rightName);
      if (score >= PLUGIN_NAME_FAMILY_SIMILARITY_THRESHOLD) familyPairs.push({ left, right, score });
    }
  }
  familyPairs.sort((a, b) => b.score - a.score || String(a.left.id).localeCompare(String(b.left.id)));
  for (const pair of familyPairs.slice(0, MAX_EMITTED_CANDIDATES)) {
    findings.push({
      id: "plugin-name-family-overlap",
      severity: "advisory",
      assetKind: "plugin",
      assetName: `plugin-family-${shortHash(`${pair.left.id}:${pair.right.id}`)}`,
      why: locale === "zh-CN"
        ? `${pluginLabel(pair.left)} 与 ${pluginLabel(pair.right)} 的名称相似度为 ${Math.round(pair.score * 100)}%；这可能是重命名、版本替代或有意测试变体，需要人工核对，不应自动停用。`
        : `${pluginLabel(pair.left)} and ${pluginLabel(pair.right)} have ${Math.round(pair.score * 100)}% name similarity; they may be a rename, replacement, or intentional test variant and must not be disabled automatically.`,
    });
  }
  return {
    findings,
    diagnostics: {
      enabledPluginCount: plugins.length,
      nameCollisionGroups: emittedGroups.size,
      capabilityOverlapGroups: [...fingerprints.values()].filter((group) => group.length > 1).length,
      familyCandidates: familyPairs.length,
    },
  };
}

function highFrequencyHookEvent(value) {
  return /^(?:pre|post)tooluse(?:failure)?$/iu.test(String(value ?? "").replace(/\s+/gu, ""));
}

function hookFindings(inventory, locale) {
  const hooks = surfaceItems(inventory, "hooks", { includePluginGroup: false });
  const findings = [];
  if (hooks.length > HOOK_RECOMMENDED_LIMIT) {
    findings.push({
      id: "hook-count-over-recommended-limit",
      severity: "warning",
      assetKind: "hook",
      assetName: "enabled-hooks",
      why: hookOverLimitSummary(hooks.length, { locale }),
    });
  }

  const exactGroups = new Map();
  for (const hook of hooks) {
    if (!hook?.configurationDigest || !hook?.path) continue;
    const key = `${hook.scope ?? "unknown"}:${path.normalize(hook.path)}:${hook.configurationDigest}`;
    const group = exactGroups.get(key) ?? [];
    group.push(hook);
    exactGroups.set(key, group);
  }
  for (const [key, group] of exactGroups) {
    if (group.length < 2) continue;
    const event = text(group[0]?.step, 40) || "Hook";
    const matcher = text(group[0]?.matcher, 40) || "*";
    findings.push({
      id: "hook-duplicate-registration",
      severity: "warning",
      assetKind: "hook",
      assetName: `hook-duplicate-${shortHash(key)}`,
      why: locale === "zh-CN"
        ? `${event}/${matcher} 中发现 ${group.length} 个完整配置摘要相同的 Hook 注册；只应在核对所属配置后移除后续重复项。`
        : `${event}/${matcher} contains ${group.length} Hook registrations with the same full configuration digest; remove only later duplicates after inspecting the owner.`,
    });
  }

  const fanoutGroups = new Map();
  for (const hook of hooks.filter((item) => item?.async !== true)) {
    const event = text(hook?.step, 40) || "unknown";
    const matcher = text(hook?.matcher, 60) || "*";
    const key = `${event}:${matcher}`;
    const group = fanoutGroups.get(key) ?? { event, matcher, count: 0 };
    group.count += 1;
    fanoutGroups.set(key, group);
  }
  for (const [key, group] of fanoutGroups) {
    const threshold = highFrequencyHookEvent(group.event) ? 3 : 5;
    if (group.count < threshold) continue;
    findings.push({
      id: "hook-event-matcher-fanout",
      severity: "advisory",
      assetKind: "hook",
      assetName: `hook-fanout-${shortHash(key)}`,
      why: locale === "zh-CN"
        ? `${group.event}/${group.matcher} 同步 fan-out 到 ${group.count} 个 Hook，达到静态复查阈值 ${threshold}；这不代表已观察到运行时变慢。`
        : `${group.event}/${group.matcher} synchronously fans out to ${group.count} Hooks, meeting the static review threshold of ${threshold}; this does not claim observed runtime latency.`,
    });
  }
  return {
    findings,
    diagnostics: {
      enabledHookCount: hooks.length,
      overRecommendedLimit: hooks.length > HOOK_RECOMMENDED_LIMIT,
      exactDuplicateGroups: [...exactGroups.values()].filter((group) => group.length > 1).length,
      fanoutCandidates: [...fanoutGroups.values()].filter((group) => group.count >= (highFrequencyHookEvent(group.event) ? 3 : 5)).length,
    },
  };
}

export function reviewAssetIntegrity(inventory, options = {}) {
  const locale = options.locale === "zh-CN" ? "zh-CN" : "en";
  const memory = memoryFindings(inventory, locale, options.maxMemoryTitlesReviewed);
  const plugins = pluginFindings(inventory, locale);
  const hooks = hookFindings(inventory, locale);
  const findings = [...memory.findings, ...plugins.findings, ...hooks.findings];
  return {
    kind: ASSET_INTEGRITY_PROFILE,
    profile: ASSET_INTEGRITY_PROFILE,
    status: "reviewed",
    contentPolicy: "memory-title-and-path-metadata-only",
    summary: {
      findingCount: findings.length,
      memories: memory.diagnostics,
      plugins: plugins.diagnostics,
      hooks: hooks.diagnostics,
    },
    findings,
  };
}

export function formatAssetIntegrityMarkdown(result) {
  const lines = ["# Agent Asset Integrity Review", "", `Findings: ${result.summary.findingCount}`, ""];
  for (const finding of result.findings) lines.push(`- [${finding.severity}] ${finding.why}`);
  if (result.findings.length === 0) lines.push("No bounded integrity candidates found.");
  return `${lines.join("\n")}\n`;
}

const USAGE = `Usage: better-harness coding-agent-practices asset-integrity [qoder|codex|claude|cursor] [options]

Run a read-only metadata integrity review for Memory titles, enabled Plugins,
and Hooks. Memory bodies are never read.

Options:
  --workspace <dir>          Workspace root (default: current directory)
  --qoder-home <dir>         Qoder home override
  --codex-home <dir>         Codex home override
  --claude-home <dir>        Claude config root override
  --claude-state <file>      Claude state-file override
  --cursor-home <dir>        Cursor home override
  --shared-cache <dir>       Qoder shared-cache override
  --include-memories         Include generated Memory title metadata
  --include-user-home        Include user/global asset metadata
  --language <en|zh-CN>      Finding language (default: en)
  --format <json|markdown>   Output format (default: json)
  --json                     Emit JSON
  -h, --help                 Print this help
`;

async function runCli(argv) {
  if (argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(USAGE);
    return;
  }
  const { command, options } = parseArgs(argv);
  const provider = options.provider ?? options.platform ?? command ?? "qoder";
  if (!["qoder", "codex", "claude", "cursor"].includes(provider)) {
    throw new Error(`Unsupported provider: ${provider}. Supported providers: qoder, codex, claude, cursor.`);
  }
  const includeUserHome = options.includeUserHome ?? options["include-user-home"] ?? false;
  const includeMemories = options.includeMemories ?? options["include-memories"] ?? false;
  const inventoryOptions = {
    ...options,
    platform: provider,
    includeGlobalHooks: includeUserHome,
    includeMemories,
    includeUserHome,
  };
  const inventory = provider === "qoder"
    ? await collectQoderInventory(inventoryOptions)
    : await collectProviderInventory(inventoryOptions);
  const result = reviewAssetIntegrity(inventory, { locale: options.language });
  const format = options.json ? "json" : options.format ?? "json";
  if (format === "markdown") process.stdout.write(formatAssetIntegrityMarkdown(result));
  else if (format === "json") process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else throw new Error(`Unsupported format: ${format}. Supported formats: json, markdown.`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
