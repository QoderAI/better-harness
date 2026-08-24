import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { collectAgentCustomizeInventory } from "../../agent-customize/index.mjs";
import { runAgentLint } from "../../agent-lint/index.mjs";
import { normalizedHostHomeOptions } from "../../host-support/index.mjs";
import { createAnalyzer } from "../../session-analysis.mjs";
import {
  HOOK_RECOMMENDED_LIMIT,
  hookOverLimitSummary,
} from "../asset-eval/index.mjs";
import {
  CHECKUP_KIND,
  CHECKUP_SCHEMA_VERSION,
  assertFindingStatus,
  countBy,
  digest,
  inventoryProviderHome,
  normalizeCheckupOptions,
  publicSource,
  resolveProviderHome,
  safeLabel,
  shortHash,
} from "./contract.mjs";
import { collectQoderSourceResolution } from "./sources.mjs";
import {
  buildLifecycleCapabilityRecommendation,
  buildRepeatedFrictionTriage,
} from "./friction.mjs";

const MANAGE_COLLECTIONS = ["skills", "mcps", "hooks", "rules", "commands", "subagents"];
const CANDIDATE_KINDS = new Set(["skill", "mcp", "plugin"]);

function normalizedName(value) {
  return String(value ?? "").trim().toLowerCase();
}

function capabilityName(value) {
  return normalizedName(value).replace(/[^a-z0-9]+/gu, "");
}

function topCounts(items = []) {
  return items
    .map((item) => ({ name: safeLabel(item?.name), count: Number(item?.count ?? 0) }))
    .filter((item) => item.name !== "unknown" && item.count > 0)
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

function pluginScope(plugin) {
  const sources = [...new Set((plugin.installSources ?? [plugin.installSource]).filter(Boolean).map((source) =>
    source === "workspace" || source === "local" ? "project" : source
  ))];
  if (sources.length > 1) return "other";
  const source = sources[0];
  if (source === "project" || source === "workspace" || source === "local") return "project";
  if (source === "user") return "user";
  return plugin.scope ?? "plugin";
}

function sourceIdentity(item) {
  return [item.kind, item.scope, item.name, item.sourceLabel, item.ownerId].filter(Boolean).join(":");
}

function relativeSourceRef(item, inventory, provider) {
  if (!item.filePath || item.scope === "plugin") return null;
  const filePath = path.resolve(item.filePath);
  const providerHome = inventoryProviderHome(provider, inventory);
  const roots = [
    { base: "workspace", root: inventory.workspace },
    { base: "provider-home", root: providerHome },
  ].filter((entry) => entry.root);
  for (const entry of roots) {
    const root = path.resolve(entry.root);
    const relativePath = path.relative(root, filePath);
    if (relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
      return {
        base: entry.base,
        relativePath: relativePath.split(path.sep).join("/"),
        provider: String(provider ?? inventory.provider ?? "").toLowerCase() || undefined,
      };
    }
  }
  return null;
}

function publicAsset(item, ownerId, sourceRef = null) {
  const kind = item.kind ?? "unknown";
  const name = safeLabel(item.displayName ?? item.name ?? item.label, `${kind}-asset`);
  const scope = item.scope ?? "other";
  const sourceLabel = safeLabel(item.sourceLabel, scope);
  const identity = sourceIdentity({ kind, scope, name, sourceLabel, ownerId });
  const stableIdentity = [
    identity,
    sourceRef?.base,
    sourceRef?.relativePath,
    item.registrationIndex,
    item.hookIndex,
  ].filter((value) => value !== undefined && value !== null).join(":");
  return {
    id: `${kind}-${shortHash(stableIdentity)}`,
    kind,
    name,
    scope,
    sourceLabel,
    enabled: item.enabled !== false,
    statusGroup: safeLabel(item.statusGroup, "configured"),
    sourceKind: safeLabel(item.sourceKind, "source"),
    ownerId,
    pluginId: kind === "plugin" ? safeLabel(item.qoderPluginId ?? item.id, name) : undefined,
    toolCount: Number(item.toolCount ?? item.tools?.length ?? 0),
    resourceCount: Number(item.resourceCount ?? item.resources?.length ?? 0),
    providedAssetCount:
      kind === "plugin"
        ? ["skills", "mcpServers", "rules", "commands", "subagents", "hooks"]
            .reduce((count, key) => count + (Array.isArray(item[key]) ? item[key].length : 0), 0)
        : 0,
    event: kind === "hook" ? safeLabel(item.step, "unknown-hook") : undefined,
    commandIdentity: kind === "hook" ? safeLabel(item.commandDisplay, "unavailable") : undefined,
    configurationDigest: kind === "hook" && /^[a-f0-9]{64}$/u.test(String(item.configurationDigest ?? ""))
      ? item.configurationDigest
      : undefined,
    handlerType: kind === "hook" ? safeLabel(item.handlerType, "unknown") : undefined,
    timeoutMs: kind === "hook" && Number.isFinite(item.timeoutMs) ? item.timeoutMs : undefined,
    async: kind === "hook" && typeof item.async === "boolean" ? item.async : undefined,
    toolNames: kind === "mcp"
      ? [...new Set((item.toolNames ?? []).map((tool) => safeLabel(tool)).filter((tool) => tool !== "unknown"))].sort()
      : undefined,
    installedAt: item.installedAt ?? null,
    sourceIdentity: identity ? `identity-${shortHash(identity)}` : null,
    sourceRef,
    matcher: kind === "hook" ? safeLabel(item.matcher, "all") : undefined,
    registrationIndex: kind === "hook" && Number.isInteger(item.registrationIndex) ? item.registrationIndex : undefined,
    hookIndex: kind === "hook" && Number.isInteger(item.hookIndex) ? item.hookIndex : undefined,
  };
}

function configuredAssets(inventory = {}, provider = inventory.provider) {
  const assets = [];
  const plugins = Array.isArray(inventory.plugins) ? inventory.plugins : [];
  for (const plugin of plugins) {
    const pluginAsset = publicAsset({ ...plugin, kind: "plugin", scope: pluginScope(plugin) });
    assets.push(pluginAsset);
  }
  for (const key of MANAGE_COLLECTIONS) {
    for (const item of inventory.manage?.[key] ?? []) {
      const owner = plugins.find((plugin) => plugin.sourceLabel === item.sourceLabel && item.scope === "plugin");
      const ownerId = owner
        ? publicAsset({ ...owner, kind: "plugin", scope: pluginScope(owner) }).id
        : undefined;
      assets.push(publicAsset(item, ownerId, relativeSourceRef(item, inventory, provider)));
    }
  }
  const projectMcpNames = new Set(
    assets
      .filter((asset) => asset.kind === "mcp" && asset.scope === "project")
      .map((asset) => normalizedName(asset.name)),
  );
  for (const asset of assets) {
    asset.shadowedHere = asset.kind === "mcp" && asset.scope === "user" && projectMcpNames.has(normalizedName(asset.name));
  }
  return assets.sort((left, right) =>
    left.kind.localeCompare(right.kind) || left.scope.localeCompare(right.scope) || left.name.localeCompare(right.name)
  );
}

function inferredMcpServer(toolName) {
  const value = String(toolName ?? "");
  const match = value.match(/^mcp__([^_]+(?:_[^_]+)*)__.+$/iu) ?? value.match(/^mcp[_-]([A-Za-z0-9-]+)[_-].+$/u);
  return match ? capabilityName(match[1]) : null;
}

function observedIndexes(inventory, facets = {}) {
  const skills = topCounts(facets.topSkills);
  const hooks = topCounts(facets.topHooks);
  const tools = topCounts(facets.topTools);
  const observedSkillNames = new Set(skills.map((item) => normalizedName(item.name)));
  const observedHookNames = new Set(hooks.map((item) => normalizedName(item.name)));
  const observedToolNames = new Set(tools.map((item) => normalizedName(item.name)));
  const encodedMcpServers = new Set(tools.map((item) => inferredMcpServer(item.name)).filter(Boolean));
  const toolOwners = new Map();
  for (const mcp of inventory.manage?.mcps ?? []) {
    for (const toolName of mcp.toolNames ?? []) {
      const key = normalizedName(toolName);
      const owners = toolOwners.get(key) ?? new Set();
      owners.add(normalizedName(mcp.name));
      toolOwners.set(key, owners);
    }
  }
  const observedMcpNames = new Set();
  for (const mcp of inventory.manage?.mcps ?? []) {
    const name = normalizedName(mcp.name);
    const encodedMatch = encodedMcpServers.has(capabilityName(name));
    const stableToolMatch = (mcp.toolNames ?? []).some((toolName) => {
      const key = normalizedName(toolName);
      return observedToolNames.has(key) && toolOwners.get(key)?.size === 1;
    });
    if (encodedMatch || stableToolMatch) observedMcpNames.add(name);
  }
  const commandHookKeys = new Set((facets.hookRuntime?.commands ?? []).map((item) => normalizedName(item.name)));
  const hookConfigCounts = new Map();
  for (const hook of inventory.manage?.hooks ?? []) {
    const event = normalizedName(hook.step);
    hookConfigCounts.set(event, (hookConfigCounts.get(event) ?? 0) + 1);
  }
  const singleHookEvents = new Set((facets.hookRuntime?.groups ?? [])
    .map((item) => normalizedName(item.name))
    .filter((event) => hookConfigCounts.get(event) === 1));
  const pluginNames = new Set();

  for (const plugin of inventory.plugins ?? []) {
    const childSkillObserved = (plugin.skills ?? []).some((item) => observedSkillNames.has(normalizedName(item.name)));
    const childHookObserved = (plugin.hooks ?? []).some((item) =>
      commandHookKeys.has(normalizedName(`${item.step} -> ${item.commandDisplay}`)) ||
      singleHookEvents.has(normalizedName(item.step)) ||
      (!facets.hookRuntime && observedHookNames.has(normalizedName(item.label ?? item.name)))
    );
    const childMcpObserved = (plugin.mcpServers ?? []).some((item) => observedMcpNames.has(normalizedName(item.name)));
    if (childSkillObserved || childHookObserved || childMcpObserved) {
      pluginNames.add(normalizedName(plugin.displayName ?? plugin.name));
    }
  }

  return {
    skills,
    hooks,
    mcpTools: tools,
    plugins: [...pluginNames].sort().map((name) => ({ name, count: 1 })),
    skillNames: observedSkillNames,
    hookNames: observedHookNames,
    pluginNames,
    mcpNames: observedMcpNames,
    commandHookKeys,
    singleHookEvents,
    hookRuntime: facets.hookRuntime ?? null,
  };
}

function assetObserved(asset, observed) {
  const name = normalizedName(asset.name);
  if (asset.kind === "skill") return observed.skillNames.has(name);
  if (asset.kind === "mcp") return observed.mcpNames.has(name);
  if (asset.kind === "plugin") return observed.pluginNames.has(name);
  if (asset.kind === "hook") {
    const commandKey = normalizedName(`${asset.event} -> ${asset.commandIdentity}`);
    return observed.hookRuntime
      ? observed.commandHookKeys.has(commandKey) || observed.singleHookEvents.has(normalizedName(asset.event))
      : observed.hookNames.has(name);
  }
  return false;
}

function ageState(asset, observationWindow) {
  if (!asset.installedAt) return "unknown";
  const installed = Date.parse(asset.installedAt);
  const until = Date.parse(observationWindow.until);
  if (Number.isNaN(installed) || Number.isNaN(until)) return "unknown";
  const ageDays = Math.floor((until - installed) / (24 * 60 * 60 * 1000));
  return ageDays >= observationWindow.newInstallGraceDays ? "outside-grace" : "inside-grace";
}

function hookBudgetMs(event) {
  return /^(?:pre|post)tooluse(?:failure)?$/iu.test(String(event ?? "").replace(/\s+/gu, "")) ? 500 : 2000;
}

function hookCommandStat(asset, observed) {
  if (!observed.hookRuntime || !asset.commandIdentity || asset.commandIdentity === "unavailable") return null;
  const key = normalizedName(`${asset.event} -> ${asset.commandIdentity}`);
  return observed.hookRuntime.commands?.find((item) => normalizedName(item.name) === key) ?? null;
}

function findingTitle(asset, status, reasonCode, locale) {
  if (locale === "zh-CN") {
    if (status === "observed") return `${asset.name}：选定会话中已观察到使用`;
    if (status === "configured-only") return `${asset.name}：已配置，但还没有可用的运行证据`;
    if (status === "unobserved") return `${asset.name}：暂未观察到使用，现阶段不应清理`;
    if (status === "healthy") return `${asset.name}：当前不需要清理`;
    if (status === "candidate" && reasonCode.startsWith("hook-")) return `${asset.name}：Hook 的耗时或失败情况需要复查`;
    if (status === "candidate") return `${asset.name}：可以评审“先禁用、再验证”的清理方案`;
    return `${asset.name}：现有归属或证据不足，暂时不能安全判断`;
  }
  if (status === "observed") return `${asset.name}: use is visible in the selected window`;
  if (status === "configured-only") return `${asset.name}: runtime use has not been checked`;
  if (status === "unobserved") return `${asset.name}: no use was observed, so cleanup is not justified yet`;
  if (status === "healthy") return `${asset.name}: no cleanup action is needed`;
  if (status === "candidate" && reasonCode.startsWith("hook-")) return `${asset.name}: Hook duration or failures need review`;
  if (status === "candidate") return `${asset.name}: review a disable-first cleanup`;
  return `${asset.name}: current owner evidence cannot support a safe decision`;
}

function classifyAsset(asset, context) {
  const { coverage, observationWindow, observed, identityCounts, locale } = context;
  const observedHere = assetObserved(asset, observed);
  const age = ageState(asset, observationWindow);
  const identityUnique = asset.sourceIdentity && identityCounts.get(asset.sourceIdentity) === 1;
  const globalScope = asset.scope === "user" || asset.scope === "plugin";
  const candidateAllowed = CANDIDATE_KINDS.has(asset.kind);
  const hookStat = asset.kind === "hook" ? hookCommandStat(asset, observed) : null;
  const hookBudget = asset.kind === "hook" ? hookBudgetMs(asset.event) : null;
  const slowHook = hookStat && hookStat.durationSamples >= 5 && hookStat.p95Ms > hookBudget;
  const failingHook = hookStat && hookStat.executions >= 5 && hookStat.failures >= 3;

  let status;
  let reasonCode;
  if (!asset.enabled) {
    status = "healthy";
    reasonCode = "asset-disabled";
  } else if (!identityUnique) {
    status = "unavailable";
    reasonCode = "asset-identity-ambiguous";
  } else if (slowHook) {
    status = "candidate";
    reasonCode = "hook-p95-over-budget";
  } else if (failingHook) {
    status = "candidate";
    reasonCode = "hook-repeated-failures";
  } else if (hookStat && hookStat.durationSamples >= 5) {
    status = "healthy";
    reasonCode = "hook-runtime-within-budget";
  } else if (observedHere) {
    status = "observed";
    reasonCode = "runtime-use-observed";
  } else if (asset.shadowedHere) {
    status = "unobserved";
    reasonCode = "shadowed-here";
  } else if (asset.scope === "plugin" && asset.kind !== "plugin") {
    status = "unobserved";
    reasonCode = "plugin-owner-required";
  } else if (["runtime-mcp", "runtime-plugin"].includes(asset.sourceKind)) {
    status = "unavailable";
    reasonCode = "generated-runtime-evidence-only";
  } else if (!new Set(["project", "user"]).has(asset.scope) && candidateAllowed) {
    status = "unavailable";
    reasonCode = "target-scope-ambiguous";
  } else if (!coverage.runtimeAvailable) {
    status = "configured-only";
    reasonCode = "runtime-evidence-unavailable";
  } else if (!coverage.sufficient) {
    status = "unobserved";
    reasonCode = "insufficient-session-coverage";
  } else if (candidateAllowed && !coverage.cleanupEligible) {
    status = "unobserved";
    reasonCode = "cleanup-census-incomplete";
  } else if (globalScope && !coverage.userGlobalCovered) {
    status = "unobserved";
    reasonCode = "global-pass-required";
  } else if (!candidateAllowed) {
    status = "unobserved";
    reasonCode = "no-safe-disable-owner";
  } else if (age === "inside-grace") {
    status = "unobserved";
    reasonCode = "new-install-grace";
  } else if (age !== "outside-grace") {
    status = "unobserved";
    reasonCode = "install-age-unavailable";
  } else {
    status = "candidate";
    reasonCode = "covered-window-no-use-observed";
  }

  assertFindingStatus(status);
  const actionId = status === "candidate"
    ? `${asset.kind === "hook" ? "review" : "disable"}-${asset.kind}-${shortHash(`${asset.id}:${asset.scope}`)}`
    : null;
  return {
    id: `finding-${shortHash(asset.id)}`,
    kind: asset.kind === "rule" ? "instruction" : asset.kind,
    status,
    scope: asset.scope,
    title: findingTitle(asset, status, reasonCode, locale),
    evidence: [
      { code: "configured-asset", state: asset.enabled ? "enabled" : "disabled" },
      { code: reasonCode, state: status },
      { code: "install-age", state: age },
      ...(hookStat
        ? [{
            code: "hook-runtime",
            state: `${hookStat.executions}-executions/${hookStat.durationSamples}-durations/p95-${hookStat.p95Ms ?? "unavailable"}ms/budget-${hookBudget}ms`,
          }]
        : []),
    ],
    coverage: {
      analyzedSessions: coverage.analyzedSessions,
      minimumSessions: coverage.minimumSessions,
      sufficient: coverage.sufficient,
      cleanupEligible: coverage.cleanupEligible,
      globalPass: observationWindow.includeGlobalCapabilities,
    },
    whyThisMatters: locale === "zh-CN"
      ? status === "candidate" && asset.kind === "hook"
        ? "可归因的运行证据已经超过复查阈值；先检查所属 Hook，再选择最小修复。"
        : status === "candidate"
          ? "完整的 all-eligible 普查窗口里没有观察到使用；任何变更前都应先评审“禁用优先”的方案。"
          : "“已经配置”和“实际使用”是两件事；当前状态说明了为什么现在还不能清理。"
      :
      status === "candidate" && asset.kind === "hook"
        ? "Attributed runtime evidence crossed a review budget; inspect the owning hook before choosing a narrow remediation."
        : status === "candidate"
        ? "A complete all-eligible census found no mapped use; review a disable-first action before changing state."
        : "Configured presence and observed use are separate claims; this status explains why cleanup is not yet justified.",
    candidateActions: actionId ? [actionId] : [],
  };
}

function hookCountPressureFindings(assets, runtime, coverage, locale) {
  const hooks = assets.filter((item) => item.kind === "hook" && item.enabled);
  if (hooks.length <= HOOK_RECOMMENDED_LIMIT) return [];
  const scopes = [...new Set(hooks.map((hook) => hook.scope))];
  const scope = scopes.length === 1 ? scopes[0] : "other";
  const maximumP95 = Math.max(
    0,
    ...(runtime?.groups ?? []).map((group) => Number(group.p95Ms ?? 0)).filter(Number.isFinite),
  );
  return [{
    id: `finding-hook-count-${shortHash(`effective:${scopes.sort().join(":")}`)}`,
    kind: "hook",
    status: "unavailable",
    scope,
    title: locale === "zh-CN"
      ? `${scope} 范围：${hooks.length} 个已启用 Hooks 超过建议上限 ${HOOK_RECOMMENDED_LIMIT}`
      : `${scope} scope: ${hooks.length} enabled Hooks exceed the recommended limit of ${HOOK_RECOMMENDED_LIMIT}`,
    evidence: [
      { code: "hook-count-over-recommended-limit", state: `${hooks.length}/${HOOK_RECOMMENDED_LIMIT}` },
    ],
    coverage: {
      analyzedSessions: coverage.analyzedSessions,
      minimumSessions: coverage.minimumSessions,
      sufficient: coverage.sufficient,
    },
    whyThisMatters: hookOverLimitSummary(hooks.length, {
      locale,
      maximumP95: maximumP95 > 0 ? maximumP95 : undefined,
    }),
    candidateActions: [],
  }];
}

function staticHookReviewFindings(assetLintResult, coverage, locale) {
  return (assetLintResult?.findings ?? []).flatMap((finding, index) => {
    if (finding?.assetKind !== "hook" || !["error", "warning"].includes(finding?.severity)) return [];
    const code = safeLabel(finding.id, "hook-static-review");
    const name = safeLabel(finding.assetName, "Hook");
    const scope = safeLabel(finding.scope, "other");
    return [{
      id: `finding-hook-static-${shortHash(`${code}:${scope}:${name}:${index}`)}`,
      kind: "hook",
      status: "unavailable",
      scope,
      title: locale === "zh-CN"
        ? `${name}：静态 Hook 检查发现 ${code}`
        : `${name}: static Hook review found ${code}`,
      evidence: [
        { code, state: safeLabel(finding.severity, "warning") },
        { code: "static-hook-review", state: "manual-owner-review-required" },
      ],
      coverage: {
        analyzedSessions: coverage.analyzedSessions,
        minimumSessions: coverage.minimumSessions,
        sufficient: coverage.sufficient,
      },
      whyThisMatters: locale === "zh-CN"
        ? "静态检查能指出风险模式，但不能证明运行耗时或自动选择要修改的注册项；请先核对所属配置。"
        : "Static review can identify a risky pattern, but it cannot prove runtime cost or safely choose a registration to modify; inspect the owner first.",
      candidateActions: [],
    }];
  }).slice(0, 20);
}

function ambiguousHookRuntimeFindings(runtime, coverage, locale) {
  if (!runtime) return [];
  return (runtime.groups ?? []).flatMap((group) => {
    const commandSamples = (runtime.commands ?? [])
      .filter((item) => normalizedName(item.name).startsWith(`${normalizedName(group.name)} -> `))
      .reduce((count, item) => count + Number(item.durationSamples ?? 0), 0);
    const unattributedSamples = Number(group.durationSamples ?? 0) - commandSamples;
    const budget = hookBudgetMs(group.name);
    if (unattributedSamples < 5 || !(group.p95Ms > budget)) return [];
    return [{
      id: `finding-hook-group-${shortHash(group.name)}`,
      kind: "hook",
      status: "unavailable",
      scope: "other",
      title: locale === "zh-CN"
        ? `${group.name}：事件组耗时偏高，但还不能归因到具体命令`
        : `${group.name}: group latency is high but cannot be attributed to one command`,
      evidence: [
        { code: "hook-runtime-attribution-gap", state: `${unattributedSamples}-unattributed-samples` },
        { code: "hook-group-p95-over-budget", state: `${group.p95Ms}ms/${budget}ms` },
        { code: "ambiguous-completion-attribution", state: `${unattributedSamples}-samples` },
      ],
      coverage: {
        analyzedSessions: coverage.analyzedSessions,
        minimumSessions: coverage.minimumSessions,
        sufficient: coverage.sufficient,
      },
      whyThisMatters: "Parallel completion evidence supports a group-level performance concern but cannot safely name one hook command.",
      candidateActions: [],
    }];
  });
}

function duplicateHookFindings(assets, coverage, locale) {
  const groups = new Map();
  for (const asset of assets.filter((item) =>
    item.kind === "hook" && item.enabled && item.configurationDigest && item.sourceRef
  )) {
    const key = [
      asset.sourceRef?.base,
      asset.sourceRef?.relativePath,
      asset.configurationDigest,
    ].join(":");
    const matches = groups.get(key) ?? [];
    matches.push(asset);
    groups.set(key, matches);
  }
  const findings = [];
  for (const matches of groups.values()) {
    if (matches.length < 2 || !matches[0].sourceRef) continue;
    const ordered = [...matches].sort((left, right) =>
      Number(left.registrationIndex ?? 0) - Number(right.registrationIndex ?? 0) ||
      Number(left.hookIndex ?? 0) - Number(right.hookIndex ?? 0)
    );
    for (const asset of ordered.slice(1)) {
      const actionId = `deduplicate-hook-${shortHash(asset.id)}`;
      findings.push({
        id: `finding-hook-duplicate-${shortHash(asset.id)}`,
        targetAssetId: asset.id,
        kind: "hook",
        status: "candidate",
        scope: asset.scope,
        title: locale === "zh-CN"
          ? `${asset.name}：同一个 Hook 被重复注册`
          : `${asset.name}: the same Hook is registered more than once`,
        evidence: [
          {
            code: "hook-duplicate-registration",
            state: `${asset.event}/${asset.matcher}/${asset.commandIdentity}/config-${shortHash(asset.configurationDigest)}`,
          },
        ],
        coverage: {
          analyzedSessions: coverage.analyzedSessions,
          minimumSessions: coverage.minimumSessions,
          sufficient: coverage.sufficient,
        },
        whyThisMatters: "The same owner registers an exact full-configuration match more than once; remove only the later duplicate after reviewing the patch.",
        candidateActions: [actionId],
      });
    }
  }
  return findings;
}

function instructionReviewSummary(lintResult = {}) {
  const findings = Array.isArray(lintResult.findings) ? lintResult.findings : [];
  const hostReview = lintResult.hostInstructionReview ?? {};
  const detectorCounts = {};
  for (const finding of findings.filter((item) => item.detector)) {
    detectorCounts[finding.detector] = (detectorCounts[finding.detector] ?? 0) + 1;
  }
  return {
    profile: safeLabel(lintResult.profile, "agents-md-review"),
    provider: safeLabel(hostReview.provider, "unknown"),
    sourceLedger: (hostReview.sources ?? []).map((source) => ({
      id: safeLabel(source.id),
      scope: safeLabel(source.scope),
      sourceKind: safeLabel(source.sourceKind),
      precedence: Number(source.precedence ?? 0),
      label: safeLabel(source.relativePath),
    })),
    summary: {
      findings: findings.length,
      errors: findings.filter((item) => item.severity === "error").length,
      warnings: findings.filter((item) => item.severity === "warning").length,
      advisories: findings.filter((item) => item.severity === "advisory").length,
    },
    findingCodes: [...new Set(findings.map((item) => safeLabel(item.id)).filter(Boolean))].sort(),
    detectorCounts: Object.fromEntries(Object.entries(detectorCounts).sort(([left], [right]) => left.localeCompare(right))),
  };
}

function assetReviewSummary(lintResult = {}) {
  const findings = Array.isArray(lintResult.findings) ? lintResult.findings : [];
  return {
    profile: safeLabel(lintResult.profile, "agent-assets-review"),
    summary: {
      findings: findings.length,
      errors: findings.filter((item) => item.severity === "error").length,
      warnings: findings.filter((item) => item.severity === "warning").length,
      advisories: findings.filter((item) => item.severity === "advisory").length,
    },
    findingCodes: [...new Set(findings.map((item) => safeLabel(item.id)).filter(Boolean))].sort(),
  };
}

function findingReason(finding) {
  return (finding?.evidence ?? []).find((item) => !new Set([
    "configured-asset",
    "install-age",
    "hook-runtime",
  ]).has(item?.code))?.code ?? "unknown";
}

function checkupSummary(assets, assetFindings, findings, coverage) {
  const capabilityUse = ["skill", "mcp", "plugin"].map((kind) => {
    const enabledIds = new Set(assets.filter((asset) => asset.kind === kind && asset.enabled).map((asset) => asset.id));
    const rows = assetFindings.filter((finding) => enabledIds.has(finding.targetAssetId));
    const statusCounts = countBy(rows, "status");
    const blockerCounts = {};
    for (const finding of rows.filter((item) => item.status !== "observed" && item.status !== "candidate")) {
      const reason = findingReason(finding);
      blockerCounts[reason] = (blockerCounts[reason] ?? 0) + 1;
    }
    return {
      kind,
      configured: enabledIds.size,
      observed: statusCounts.observed ?? 0,
      unobserved: statusCounts.unobserved ?? 0,
      configuredOnly: statusCounts["configured-only"] ?? 0,
      unavailable: statusCounts.unavailable ?? 0,
      candidate: statusCounts.candidate ?? 0,
      blockers: Object.fromEntries(Object.entries(blockerCounts).sort(([left], [right]) => left.localeCompare(right))),
    };
  });
  const attention = findings.filter((finding) =>
    finding.kind === "hook"
    && finding.status !== "candidate"
    && (finding.evidence ?? []).some((item) =>
      item?.code === "hook-count-over-recommended-limit"
      || item?.code === "hook-group-p95-over-budget"
      || item?.code === "static-hook-review"
    )
  ).map((finding) => ({
    id: finding.id,
    kind: finding.kind,
    scope: finding.scope,
    title: finding.title,
    evidenceCodes: (finding.evidence ?? []).map((item) => item.code),
  }));
  return {
    statusCounts: countBy(findings, "status"),
    cleanup: {
      eligible: coverage.cleanupEligible,
      reason: coverage.cleanupReason,
    },
    capabilityUse,
    attention,
  };
}

function publicHookRuntime(runtime) {
  if (!runtime) return null;
  const publicStats = (items = []) => items.map(({ evidenceRefs: _evidenceRefs, ...item }) => item);
  return {
    finishedExecutions: Number(runtime.finishedExecutions ?? 0),
    startedWithoutFinish: Number(runtime.startedWithoutFinish ?? 0),
    ambiguousCompletions: Number(runtime.ambiguousCompletions ?? 0),
    groups: publicStats(runtime.groups),
    commands: publicStats(runtime.commands),
  };
}

function capabilityFinding(recommendation, coverage, locale) {
  if (!recommendation) return null;
  const status = recommendation.evidenceState === "observed"
    ? "observed"
    : recommendation.evidenceState === "needs-more-evidence"
      ? "unavailable"
      : "unobserved";
  const focus = recommendation.discipline?.[0] ?? recommendation.lifecycle?.[0] ?? "workflow";
  const title = locale === "zh-CN"
    ? recommendation.nextStep === "try-built-in"
      ? `${focus} 工作流：先试用内置能力，不要急着新建 Skill`
      : recommendation.nextStep === "try-configured"
        ? `${focus} 工作流：先试用已配置能力，再判断是否真的缺失`
        : recommendation.nextStep === "create-skill-handoff"
          ? `${focus} 工作流：已准备好一个需要单独确认的小型 Skill 交接`
          : recommendation.nextStep === "keep"
            ? `${focus} 工作流：已经观察到 Skill 覆盖`
            : `${focus} 工作流：推荐 Skill 之前还需要更多证据`
    : recommendation.nextStep === "try-built-in"
    ? `${focus} workflow: try the built-in path before creating a new Skill`
    : recommendation.nextStep === "try-configured"
      ? `${focus} workflow: try configured coverage before declaring a gap`
      : recommendation.nextStep === "create-skill-handoff"
        ? `${focus} workflow: a small Skill handoff is ready for separate approval`
        : recommendation.nextStep === "keep"
          ? `${focus} workflow: observed Skill coverage already exists`
          : `${focus} workflow: more evidence is needed before recommending a Skill`;
  return {
    id: `finding-capability-${shortHash(`${focus}:${recommendation.nextStep}`)}`,
    kind: "skill",
    status,
    scope: "other",
    title,
    evidence: [{ code: "lifecycle-recommendation-ladder", state: recommendation.evidenceState }],
    coverage: {
      analyzedSessions: coverage.analyzedSessions,
      minimumSessions: coverage.minimumSessions,
      sufficient: coverage.sufficient,
    },
    whyThisMatters: "Repeated friction can justify a bounded trial or handoff, but it does not prove that a new Skill is needed.",
    candidateActions: [],
    capabilityRecommendation: recommendation,
  };
}

export function buildCheckupScan({
  inventory = {},
  lintResult = {},
  assetLintResult = {},
  sessionResult = {},
  sourceResolution = {},
  options = {},
}) {
  const normalized = normalizeCheckupOptions(options);
  const sources = (sessionResult.sources ?? []).map(publicSource);
  const analyzedSessions = Number(
    sessionResult.selection?.analyzedCount ?? sessionResult.facets?.analyzedSessionCount ?? sessionResult.sessions?.length ?? 0,
  );
  const eligibleSessions = Number(
    sessionResult.selection?.eligibleCount ?? sessionResult.facets?.sessionCount ?? analyzedSessions,
  );
  const runtimeAvailable = sources.some((source) => source.enabled && source.exists);
  const globalSourceAvailable = sources.some((source) =>
    source.kind === "global-project-jsonl" && source.enabled && source.exists
  );
  const globalSessionCount = Number(sessionResult.facets?.sourceCoverage?.["global-project-jsonl"] ?? 0);
  const userGlobalCovered = normalized.includeGlobalCapabilities && globalSourceAvailable && globalSessionCount > 0;
  const selectionStrategy = String(sessionResult.selection?.strategy ?? normalized.selection);
  const cleanupComplete = selectionStrategy === "all-eligible" && analyzedSessions === eligibleSessions;
  const sufficient = runtimeAvailable && analyzedSessions >= normalized.minimumSessions;
  const coverage = {
    sources,
    eligibleSessions,
    analyzedSessions,
    minimumSessions: normalized.minimumSessions,
    sufficient,
    cleanupEligible: sufficient && cleanupComplete,
    cleanupReason: !runtimeAvailable
      ? "runtime-evidence-unavailable"
      : !sufficient
        ? "insufficient-session-coverage"
        : !cleanupComplete
          ? "cleanup-census-incomplete"
          : "complete-all-eligible-census",
    selectionStrategy,
    populationComplete: cleanupComplete,
    runtimeAvailable,
    userGlobal: normalized.includeGlobalCapabilities
      ? userGlobalCovered
        ? "covered"
        : "requested-unavailable"
      : "not-included",
    userGlobalCovered,
    globalSessionCount,
  };
  const observationWindow = {
    since: normalized.since,
    until: normalized.until,
    sessionLimit: normalized.sessionLimit,
    selection: selectionStrategy,
    includeGlobalCapabilities: normalized.includeGlobalCapabilities,
    minimumSessions: normalized.minimumSessions,
    newInstallGraceDays: normalized.newInstallGraceDays,
  };
  const assets = configuredAssets(inventory, normalized.provider);
  const observed = observedIndexes(inventory, sessionResult.facets);
  const repeatedFrictionTriage = normalized.frictionSignals.length > 0
    ? buildRepeatedFrictionTriage({
        signals: normalized.frictionSignals,
        strength: normalized.frictionStrength,
        observationCount: normalized.frictionObservationCount,
        source: normalized.frictionSource,
        window: { since: normalized.since, until: normalized.until },
        skillOwnerSelected: normalized.skillOwnerSelected,
      })
    : null;
  const capabilityRecommendation = buildLifecycleCapabilityRecommendation({
    triage: repeatedFrictionTriage,
    configuredSkills: assets.filter((asset) => asset.kind === "skill").map((asset) => asset.name),
    observedSkills: observed.skills.map((item) => item.name),
  });
  const identityCounts = new Map();
  for (const asset of assets) {
    if (asset.sourceIdentity) {
      identityCounts.set(asset.sourceIdentity, (identityCounts.get(asset.sourceIdentity) ?? 0) + 1);
    }
  }
  const assetFindings = assets.map((asset) => ({
    ...classifyAsset(asset, {
      coverage,
      observationWindow,
      observed,
      identityCounts,
      locale: normalized.locale,
    }),
    targetAssetId: asset.id,
  }));
  const findings = [
    ...assetFindings,
    ...duplicateHookFindings(assets, coverage, normalized.locale),
    ...ambiguousHookRuntimeFindings(observed.hookRuntime, coverage, normalized.locale),
    ...hookCountPressureFindings(assets, observed.hookRuntime, coverage, normalized.locale),
    ...staticHookReviewFindings(assetLintResult, coverage, normalized.locale),
    ...[capabilityFinding(capabilityRecommendation, coverage, normalized.locale)].filter(Boolean),
  ];
  const publicAssets = assets.map(({
    installedAt: _installedAt,
    sourceIdentity: _sourceIdentity,
    shadowedHere: _shadowedHere,
    ...asset
  }) => asset);
  const summary = checkupSummary(assets, assetFindings, findings, coverage);

  return {
    kind: CHECKUP_KIND,
    schemaVersion: CHECKUP_SCHEMA_VERSION,
    phase: "scan",
    provider: normalized.provider,
    locale: normalized.locale,
    workspace: normalized.workspaceLabel,
    observationWindow,
    coverage,
    configuredInventory: {
      summary: {
        total: publicAssets.length,
        byKind: countBy(publicAssets, "kind"),
        byScope: countBy(publicAssets, "scope"),
      },
      assets: publicAssets,
      sourceFingerprints: {},
    },
    observedUse: {
      skills: observed.skills,
      hooks: observed.hooks,
      mcpTools: observed.mcpTools,
      plugins: observed.plugins,
      hookRuntime: publicHookRuntime(observed.hookRuntime),
    },
    instructionReview: instructionReviewSummary(lintResult),
    assetReview: assetReviewSummary(assetLintResult),
    repeatedFrictionTriage,
    findings,
    summary,
    diagnostics: {
      inventoryAvailable: Boolean(inventory.manage),
      configuredSourceState: inventory.diagnostics?.installedPluginState === "missing" ? "unavailable" : "available",
      runtimeSourceState: runtimeAvailable ? "available" : "unavailable",
      qoderSourceResolution: sourceResolution,
      warningCodes: [...new Set((sessionResult.warnings ?? []).map((warning) => safeLabel(warning.code)))].sort(),
      privacy: "paths-prompts-session-ids-and-command-arguments-omitted",
      scanDigest: digest({ observationWindow, coverage, publicAssets, findings, summary }),
    },
  };
}

export async function runCheckupScan(options = {}, dependencies = {}) {
  const normalized = normalizeCheckupOptions(options);
  const homeOptions = normalizedHostHomeOptions(normalized, normalized.provider);
  const collectInventory = dependencies.collectInventory ?? collectAgentCustomizeInventory;
  const lint = dependencies.runLint ?? runAgentLint;
  const analyzer = dependencies.analyzer ?? (await createAnalyzer(normalized.provider));
  const [inventory, lintResult, assetLintResult, sessionResult] = await Promise.all([
    dependencies.inventory ?? collectInventory({
      provider: normalized.provider,
      workspace: normalized.workspace,
      ...homeOptions,
      qoderSharedClientCacheRoot: normalized.qoderSharedClientCacheRoot,
      claudeStatePath: normalized.claudeStatePath,
    }),
    dependencies.lintResult ?? lint({
      workspace: normalized.workspace,
      profile: "agents-md-review",
      provider: normalized.provider,
      includeUserHome: true,
      ...homeOptions,
      claudeStatePath: normalized.claudeStatePath,
    }),
    dependencies.assetLintResult ?? (dependencies.lintResult
      ? { profile: "agent-assets-review", findings: [] }
      : lint({
          workspace: normalized.workspace,
          profile: "agent-assets-review",
          provider: normalized.provider,
          includeUserHome: true,
          ...homeOptions,
          claudeStatePath: normalized.claudeStatePath,
        })),
    dependencies.sessionResult ?? analyzer.analyze({
      command: "facets",
      workspace: normalized.workspace,
      ...homeOptions,
      since: normalized.since,
      until: normalized.until,
      limit: normalized.sessionLimit,
      selection: normalized.selection,
      includeGlobalCapabilities: normalized.includeGlobalCapabilities,
    }),
  ]);
  const sourceResolution = dependencies.sourceResolution ?? await collectQoderSourceResolution(normalized, inventory);
  const scan = buildCheckupScan({
    inventory,
    lintResult,
    assetLintResult,
    sessionResult,
    sourceResolution,
    options: normalized,
  });
  const fingerprints = {};
  const providerHome = inventoryProviderHome(normalized.provider, inventory)
    ?? (() => {
      try {
        return resolveProviderHome(normalized.provider, normalized);
      } catch {
        return null;
      }
    })();
  for (const sourceRef of scan.configuredInventory.assets.map((asset) => asset.sourceRef).filter(Boolean)) {
    const key = `${sourceRef.base}:${sourceRef.relativePath}`;
    if (fingerprints[key]) continue;
    const root = sourceRef.base === "workspace"
      ? normalized.workspace
      : sourceRef.base === "provider-home"
        ? providerHome
        : null;
    if (!root) continue;
    const filePath = path.resolve(root, sourceRef.relativePath);
    const relative = path.relative(path.resolve(root), filePath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue;
    const content = await readFile(filePath).catch(() => null);
    if (content) fingerprints[key] = createHash("sha256").update(content).digest("hex");
  }
  scan.configuredInventory.sourceFingerprints = fingerprints;
  scan.diagnostics.scanDigest = digest({
    observationWindow: scan.observationWindow,
    coverage: scan.coverage,
    publicAssets: scan.configuredInventory.assets,
    sourceFingerprints: fingerprints,
    findings: scan.findings,
    summary: scan.summary,
  });
  return scan;
}
