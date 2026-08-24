#!/usr/bin/env node

import path from "node:path";
import os from "node:os";
import { realpathSync } from "node:fs";
import { stat as statPath } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { collectAgentCustomizeInventory } from "../agent-customize/index.mjs";
import {
  HOST_CAPABILITIES,
  hostIdSetFor,
  hostIdsFor,
  hostPipeList,
} from "../host-support/index.mjs";
import { runAgentLint } from "../agent-lint/index.mjs";
import { normalizeWorkspace, parseArgs, parseBooleanFlag } from "../session-analysis/index.mjs";
import { pathIsContained, resolveConfiguredCwd } from "../workspace-topology/index.mjs";
import { reviewAssetIntegrity } from "./asset-integrity.mjs";
import { collectProviderInventory, collectQoderInventory } from "./inventory.mjs";

export const ASSET_BASELINE_KIND = "agent-asset-baseline";
export const ASSET_BASELINE_SCHEMA_VERSION = 2;
export const MAX_BASELINE_FINDINGS = 16;
export const MAX_BASELINE_OWNER_ROUTES = 16;
const MAX_OWNER_ROUTE_STAT_CONCURRENCY = 32;

const ASSET_PRACTICE_HOSTS = hostIdsFor(HOST_CAPABILITIES.ASSET_PRACTICES);
const PROVIDERS = hostIdSetFor(HOST_CAPABILITIES.ASSET_PRACTICES);
const SEVERITY_RANK = Object.freeze({ error: 0, warning: 1, advisory: 2 });
const OWNER_KIND_RANK = Object.freeze({
  rules: 0,
  skills: 1,
  plugins: 2,
  mcps: 3,
  memories: 4,
  hooks: 5,
  commands: 6,
  agents: 7,
  workflows: 8,
});
const OWNER_SCOPE_RANK = Object.freeze({ workspace: 0, project: 0, inherited: 1, user: 2, plugin: 3 });
const BASELINE_STATUSES = new Set(["complete", "partial", "failed"]);
const BASELINE_ENVELOPE_NAMES = Object.freeze(["lint", "inventory", "integrity"]);

function invalidBaseline(message) {
  throw Object.assign(new Error(`invalid Agent Asset Baseline v2: ${message}`), {
    code: "INVALID_AGENT_ASSET_BASELINE",
  });
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonemptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateConfiguredSnapshot(snapshot) {
  if (!record(snapshot)) invalidBaseline("configuredSnapshot must be an object");
  if (!nonemptyString(snapshot.collectedAt) || Number.isNaN(Date.parse(snapshot.collectedAt))) {
    invalidBaseline("configuredSnapshot.collectedAt must be an ISO timestamp");
  }
  if (snapshot.evidenceKind !== "configured-not-observed") {
    invalidBaseline("configuredSnapshot.evidenceKind is unsupported");
  }
  if (!["qualified-defaults", "caller-overrides"].includes(snapshot.configurationSource)) {
    invalidBaseline("configuredSnapshot.configurationSource is unsupported");
  }
  if (!["included", "not-authorized"].includes(snapshot.userHomeCollection)) {
    invalidBaseline("configuredSnapshot.userHomeCollection is unsupported");
  }
  if (!["enabled", "disabled-by-byte-limit"].includes(snapshot.instructionCollection)) {
    invalidBaseline("configuredSnapshot.instructionCollection is unsupported");
  }
  if (!record(snapshot.qualification)
    || snapshot.qualification.provider !== "dsh"
    || !nonemptyString(snapshot.qualification.version)
    || !/^[a-f0-9]{40}$/u.test(snapshot.qualification.sourceSha ?? "")) {
    invalidBaseline("configuredSnapshot.qualification is malformed");
  }
  if (!record(snapshot.runtimeResolution)
    || ["cordis", "profile", "preset", "runtimeSkills"]
      .some((name) => snapshot.runtimeResolution[name] !== false)) {
    invalidBaseline("configuredSnapshot.runtimeResolution is malformed");
  }
}

export function validateAssetBaselineV2(baseline, expected = {}) {
  if (!record(baseline) || baseline.kind !== ASSET_BASELINE_KIND) {
    invalidBaseline("kind is unsupported");
  }
  if (baseline.schemaVersion !== ASSET_BASELINE_SCHEMA_VERSION) {
    invalidBaseline("schemaVersion is unsupported");
  }
  if (!BASELINE_STATUSES.has(baseline.status)) invalidBaseline("status is unsupported");
  if (!record(baseline.scope)
    || !nonemptyString(baseline.scope.provider)
    || !nonemptyString(baseline.scope.workspace)
    || !nonemptyString(baseline.scope.cwd)
    || typeof baseline.scope.includeUserHome !== "boolean"
    || typeof baseline.scope.includeMemories !== "boolean") {
    invalidBaseline("scope is malformed");
  }
  for (const name of ["provider", "workspace", "cwd", "includeUserHome", "includeMemories"]) {
    if (expected[name] !== undefined && baseline.scope[name] !== expected[name]) {
      invalidBaseline(`scope.${name} does not match the frozen context`);
    }
  }
  if (!record(baseline.envelopes)) invalidBaseline("envelopes must be an object");
  for (const name of BASELINE_ENVELOPE_NAMES) {
    const envelope = baseline.envelopes[name];
    if (!record(envelope) || !["available", "unavailable"].includes(envelope.status)) {
      invalidBaseline(`${name} envelope is malformed`);
    }
    if (envelope.status === "available" && !record(envelope.data)) {
      invalidBaseline(`${name} envelope is missing data`);
    }
    if (envelope.status === "unavailable"
      && (!record(envelope.error)
        || !nonemptyString(envelope.error.code)
        || !nonemptyString(envelope.error.message))) {
      invalidBaseline(`${name} envelope is missing an error`);
    }
  }
  if (!record(baseline.diagnostics)) invalidBaseline("diagnostics must be an object");
  if (baseline.status === "complete"
    && BASELINE_ENVELOPE_NAMES.some((name) => baseline.envelopes[name].status !== "available")) {
    invalidBaseline("complete status requires all envelopes");
  }
  if (baseline.status === "failed"
    && BASELINE_ENVELOPE_NAMES.some((name) => baseline.envelopes[name].status !== "unavailable")) {
    invalidBaseline("failed status requires unavailable envelopes");
  }
  if (baseline.scope.provider === "dsh") {
    if (baseline.status !== "failed") validateConfiguredSnapshot(baseline.configuredSnapshot);
    else if (baseline.configuredSnapshot !== undefined) validateConfiguredSnapshot(baseline.configuredSnapshot);
  } else if (baseline.configuredSnapshot !== undefined) {
    invalidBaseline("configuredSnapshot is only supported for DSH");
  }
  return baseline;
}

function text(value, limit = 320) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, limit);
}

function compactError(error, stage) {
  return {
    code: `${stage.toUpperCase().replace(/[^A-Z0-9]+/gu, "_")}_UNAVAILABLE`,
    message: text(error instanceof Error ? error.message : error),
  };
}

function portable(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function canonicalIfPresent(filePath) {
  try {
    return realpathSync(filePath);
  } catch {
    return filePath;
  }
}

function pathLocator(filePath, context) {
  if (typeof filePath !== "string" || !filePath.trim()) return undefined;
  if (filePath === "<path>" || filePath.startsWith("<workspace>") || filePath.startsWith("<git-root>") || filePath.startsWith("~/")) {
    return filePath.split(/[\\/]/u).includes("..") ? "<path>" : filePath;
  }
  const absolute = path.resolve(context.workspace, filePath);
  const resolved = canonicalIfPresent(absolute);
  const workspace = canonicalIfPresent(context.workspace);
  const lexicalWorkspace = context.workspaceInput ?? context.workspace;
  const lexicalGitRoot = context.gitRootInput ?? context.gitRoot;
  const gitRoot = lexicalGitRoot ? canonicalIfPresent(lexicalGitRoot) : undefined;
  const lexicalHome = context.includeUserHome ? context.home : undefined;
  const home = lexicalHome ? canonicalIfPresent(lexicalHome) : undefined;
  if (pathIsContained(lexicalWorkspace, absolute)
    && (resolved === absolute || pathIsContained(workspace, resolved))) {
    const relative = path.relative(lexicalWorkspace, absolute);
    return relative ? `<workspace>/${portable(relative)}` : "<workspace>";
  }
  if (lexicalGitRoot && pathIsContained(lexicalGitRoot, absolute)
    && (resolved === absolute || pathIsContained(gitRoot, resolved))) {
    const relative = path.relative(lexicalGitRoot, absolute);
    return relative ? `<git-root>/${portable(relative)}` : "<git-root>";
  }
  if (lexicalHome && pathIsContained(lexicalHome, absolute)
    && (resolved === absolute || pathIsContained(home, resolved))) {
    const relative = path.relative(lexicalHome, absolute);
    return relative ? `~/${portable(relative)}` : "~";
  }
  if (pathIsContained(workspace, resolved)) {
    const relative = path.relative(workspace, resolved);
    return relative ? `<workspace>/${portable(relative)}` : "<workspace>";
  }
  if (gitRoot && pathIsContained(gitRoot, resolved)) {
    const relative = path.relative(gitRoot, resolved);
    return relative ? `<git-root>/${portable(relative)}` : "<git-root>";
  }
  if (home && pathIsContained(home, resolved)) {
    const relative = path.relative(home, resolved);
    return relative ? `~/${portable(relative)}` : "~";
  }
  return "<path>";
}

function boundedText(value, context, knownPath) {
  let result = text(value);
  if (!result) return result;
  const marker = "BETTER_HARNESS_PATH_LOCATOR";
  const locator = knownPath ? pathLocator(knownPath, context) ?? "<path>" : undefined;
  if (knownPath) result = result.replaceAll(String(knownPath), marker);
  return result
    .replace(/\\\\[^\s,;)'"\]]+\\[^\s,;)'"\]]+/gu, (candidate) => pathLocator(candidate, context) ?? "<path>")
    .replace(/[A-Za-z]:[\\/][^\s,;)'"\]]+/gu, (candidate) => pathLocator(candidate, context) ?? "<path>")
    .replace(/\/(?:[^\s,;)'"\]]+\/?)+/gu, (candidate) => pathLocator(candidate, context) ?? "<path>")
    .replaceAll(marker, locator ?? "<path>");
}

function compactFinding(finding = {}, context) {
  const file = pathLocator(finding.file, context);
  return Object.fromEntries(Object.entries({
    id: text(finding.id, 96),
    severity: text(finding.severity, 24),
    assetKind: text(finding.assetKind ?? finding.kind, 48),
    assetName: text(finding.assetName, 96),
    scope: text(finding.scope, 32),
    file,
    line: Number.isInteger(finding.line) ? finding.line : undefined,
    evidence: boundedText(finding.evidence, context, finding.file),
    why: boundedText(finding.why, context, finding.file),
    whyThisMatters: boundedText(finding.whyThisMatters, context, finding.file),
    sourceLabel: text(finding.sourceLabel, 96),
    rubricRef: text(finding.rubricRef, 120),
  }).filter(([, value]) => value !== undefined && value !== ""));
}

function compactFindings(findings = [], context) {
  const ordered = [...findings].sort((left, right) =>
    (SEVERITY_RANK[left?.severity] ?? 9) - (SEVERITY_RANK[right?.severity] ?? 9)
      || String(left?.id ?? "").localeCompare(String(right?.id ?? "")),
  );
  return {
    items: ordered.slice(0, MAX_BASELINE_FINDINGS).map((finding) => compactFinding(finding, context)),
    total: ordered.length,
    omitted: Math.max(0, ordered.length - MAX_BASELINE_FINDINGS),
    truncated: ordered.length > MAX_BASELINE_FINDINGS,
  };
}

function workspaceRoute(filePath, workspace) {
  if (!filePath) return undefined;
  const absolute = path.resolve(filePath);
  const relative = path.relative(workspace, absolute);
  if (!relative || !pathIsContained(workspace, absolute)) return undefined;
  return relative.split(path.sep).join("/");
}

function ownerRouteFallbackOrder(left, right) {
  return (OWNER_KIND_RANK[left.kind] ?? 99) - (OWNER_KIND_RANK[right.kind] ?? 99)
    || (OWNER_SCOPE_RANK[left.scope] ?? 9) - (OWNER_SCOPE_RANK[right.scope] ?? 9)
    || String(left.name).localeCompare(String(right.name));
}

async function ownerRoutes(inventory, workspace, options = {}) {
  const routes = new Map();
  for (const surface of inventory?.surfaces ?? []) {
    if (!new Set(["rules", "skills", "mcps", "memories", "agents", "hooks", "commands", "workflows", "plugins"]).has(surface?.type)) continue;
    for (const item of surface.items ?? []) {
      const name = text(item?.displayName ?? item?.name ?? item?.label, 96);
      if (!name) continue;
      const sourcePath = item?.path ?? item?.filePath ?? item?.rootPath;
      const rawRoute = text(item?.originRoute, 180)
        || workspaceRoute(item?.path ?? item?.filePath, workspace);
      const locatedSource = sourcePath ? pathLocator(sourcePath, options.pathContext) : undefined;
      const route = Object.fromEntries(Object.entries({
        kind: text(surface.type, 32),
        scope: text(item?.scope ?? surface.scope, 24),
        name,
        version: text(item?.version, 32),
        owner: text(item?.pluginName ?? item?.ownerName ?? item?.sourceLabel, 96),
        route: locatedSource === "<path>" ? "<path>" : rawRoute,
        effectiveTarget: item?.effectiveTarget
          ? (path.isAbsolute(item.effectiveTarget)
            ? pathLocator(item.effectiveTarget, options.pathContext)
            : text(item.effectiveTarget, 180))
          : undefined,
      }).filter(([, value]) => value !== undefined && value !== ""));
      const key = [route.kind, route.scope, route.name, route.version, route.owner, route.route].join(":");
      if (!routes.has(key)) routes.set(key, { route, sourcePath });
    }
  }
  const stat = options.stat ?? statPath;
  const candidates = [...routes.values()];
  const timestamped = new Array(candidates.length);
  let nextCandidate = 0;
  await Promise.all(Array.from({ length: Math.min(MAX_OWNER_ROUTE_STAT_CONCURRENCY, candidates.length) }, async () => {
    while (nextCandidate < candidates.length) {
      const index = nextCandidate;
      nextCandidate += 1;
      const { route, sourcePath } = candidates[index];
      if (!sourcePath) {
        timestamped[index] = route;
        continue;
      }
      try {
        const info = await stat(sourcePath);
        const modifiedAt = info?.mtime instanceof Date ? info.mtime.toISOString() : undefined;
        timestamped[index] = modifiedAt ? { ...route, modifiedAt } : route;
      } catch {
        timestamped[index] = route;
      }
    }
  }));
  const ordered = timestamped.sort((left, right) => {
    const leftTime = left.modifiedAt ? Date.parse(left.modifiedAt) : Number.NEGATIVE_INFINITY;
    const rightTime = right.modifiedAt ? Date.parse(right.modifiedAt) : Number.NEGATIVE_INFINITY;
    return rightTime - leftTime || ownerRouteFallbackOrder(left, right);
  });
  const selected = ordered.slice(0, MAX_BASELINE_OWNER_ROUTES);
  const observedAt = (options.now?.() ?? new Date()).toISOString();
  const timestampedCount = ordered.filter((route) => route.modifiedAt).length;
  return {
    items: selected,
    total: ordered.length,
    omitted: Math.max(0, ordered.length - MAX_BASELINE_OWNER_ROUTES),
    truncated: ordered.length > MAX_BASELINE_OWNER_ROUTES,
    selection: {
      strategy: "latest-modified",
      limit: MAX_BASELINE_OWNER_ROUTES,
      observedAt,
      timestampSource: "filesystem-mtime",
      timestamped: timestampedCount,
      untimestamped: ordered.length - timestampedCount,
    },
  };
}

async function compactInventory(inventory, workspace, options = {}) {
  const memoryCategories = (inventory?.memories?.categories ?? [])
    .map((category) => ({
      category: text(category?.category ?? category?.name, 72),
      count: Array.isArray(category?.titleEntries) ? category.titleEntries.length : 0,
    }))
    .filter((category) => category.count > 0);
  const uniqueMemoryTitles = new Set(
    (inventory?.memories?.categories ?? []).flatMap((category) => category?.titleEntries ?? [])
      .map((entry) => `${entry?.scope ?? "unknown"}:${entry?.path ?? entry?.title ?? ""}`),
  );
  const coverageRows = (inventory?.summary?.practiceCoverageRows ?? []).map((row) => ({
    ...row,
    ...(row?.surface === "Memories"
      ? { paths: undefined }
      : Array.isArray(row?.paths)
        ? { paths: row.paths.slice(0, 12).map((filePath) => pathLocator(filePath, options.pathContext)) }
        : {}),
  })).map((row) => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined)));
  const inventorySummary = Object.fromEntries(Object.entries(inventory?.summary ?? {})
    .filter(([key]) => key !== "practiceCoverageRows"));
  return {
    scope: {
      platform: inventory?.scope?.platform,
      includeUserHome: Boolean(inventory?.scope?.includeUserHome),
      includeMemories: Boolean(inventory?.memories?.included),
    },
    summary: inventorySummary,
    coverageRows,
    ownerRoutes: await ownerRoutes(inventory, workspace, options),
    memories: {
      included: Boolean(inventory?.memories?.included),
      contentPolicy: inventory?.memories?.contentPolicy ?? "raw-memory-content-not-read",
      categories: memoryCategories,
      titleCount: uniqueMemoryTitles.size,
    },
    warnings: (inventory?.warnings ?? []).map((warning) => text(warning, 180)),
  };
}

function compactLint(lint, context) {
  return {
    kind: lint.kind,
    profile: lint.profile,
    summary: lint.summary,
    assetInventory: lint.assetInventory,
    findings: compactFindings(lint.findings, context),
  };
}

function compactIntegrity(integrity, context) {
  return {
    kind: integrity.kind,
    profile: integrity.profile,
    status: integrity.status,
    contentPolicy: integrity.contentPolicy,
    summary: integrity.summary,
    findings: compactFindings(integrity.findings, context),
  };
}

function unavailable(error, stage) {
  return { status: "unavailable", error: compactError(error, stage) };
}

function available(data) {
  return { status: "available", data };
}

function inheritedWorkspaceRoots(topology, workspace) {
  if (!topology?.gitRoot
    || !new Set(["workspace-member", "repo-subtree"]).has(topology.target?.kind)) {
    return [];
  }
  const relative = path.relative(topology.gitRoot, workspace);
  if (!relative || !pathIsContained(topology.gitRoot, workspace)) return [];
  const parts = relative.split(path.sep).filter(Boolean);
  const roots = [topology.gitRoot];
  for (let index = 1; index < parts.length; index += 1) {
    roots.push(path.join(topology.gitRoot, ...parts.slice(0, index)));
  }
  return roots;
}

function rawItemPath(item) {
  return item?.evidence?.path ?? item?.filePath ?? item?.rootPath;
}

function inheritedItem(item, topology) {
  const filePath = rawItemPath(item);
  const relative = filePath ? path.relative(topology.gitRoot, path.resolve(filePath)) : "";
  const originRoute = relative
    && pathIsContained(topology.gitRoot, path.resolve(filePath))
    ? relative.split(path.sep).join("/")
    : undefined;
  return {
    ...item,
    scope: "inherited",
    originScope: "inherited",
    originRoute,
    effectiveTarget: topology.target.route,
  };
}

function mergeInheritedInventories(projectInventory, inheritedInventories, topology) {
  const manage = Object.fromEntries(
    Object.entries(projectInventory.manage ?? {}).map(([collection, items]) => [collection, [...items]]),
  );
  for (const inventory of inheritedInventories) {
    for (const [collection, items] of Object.entries(inventory.manage ?? {})) {
      const target = manage[collection] ?? [];
      for (const item of items) {
        if (item?.scope !== "project") continue;
        const inherited = inheritedItem(item, topology);
        const key = [
          inherited.id,
          inherited.kind,
          inherited.name ?? inherited.displayName ?? inherited.label,
          rawItemPath(inherited),
        ].join(":");
        if (!target.some((candidate) => [
          candidate.id,
          candidate.kind,
          candidate.name ?? candidate.displayName ?? candidate.label,
          rawItemPath(candidate),
        ].join(":") === key)) {
          target.push(inherited);
        }
      }
      manage[collection] = target;
    }
  }
  return {
    ...projectInventory,
    manage,
    diagnostics: {
      ...(projectInventory.diagnostics ?? {}),
      inheritedWorkspaceCount: inheritedInventories.length,
      inheritedTargetRoute: topology.target.route,
    },
  };
}

function baselineConfiguredScope(options) {
  const workspace = normalizeWorkspace(options.workspace ?? ".");
  const cwd = normalizeWorkspace(options.cwd ?? workspace);
  return resolveConfiguredCwd({ workspace, cwd });
}

function configuredSnapshot(rawInventory, provider) {
  if (provider !== "dsh") return undefined;
  const diagnostics = rawInventory?.diagnostics;
  if (!diagnostics || !rawInventory?.generatedAt) return undefined;
  return {
    collectedAt: rawInventory.generatedAt,
    evidenceKind: diagnostics.evidenceKind,
    configurationSource: diagnostics.configurationSource,
    userHomeCollection: diagnostics.userHomeCollection,
    instructionCollection: diagnostics.instructionCollection,
    qualification: {
      provider: "dsh",
      version: diagnostics.qualifiedDshVersion,
      sourceSha: diagnostics.qualifiedDshSourceSha,
    },
    runtimeResolution: {
      cordis: false,
      profile: false,
      preset: false,
      runtimeSkills: false,
    },
  };
}

export async function collectAssetBaseline(options = {}, dependencies = {}) {
  const provider = options.provider ?? options.platform ?? "qoder";
  if (!PROVIDERS.has(provider)) {
    throw new Error(`Unsupported provider: ${provider}. Supported providers: ${ASSET_PRACTICE_HOSTS.join(", ")}.`);
  }
  const configuredScope = baselineConfiguredScope(options);
  const { workspace, cwd } = configuredScope;
  const topology = options.topology?.gitRoot
    ? { ...options.topology, gitRoot: canonicalIfPresent(options.topology.gitRoot) }
    : options.topology;
  const includeUserHome = parseBooleanFlag(options.includeUserHome ?? options["include-user-home"] ?? false);
  const memoryOption = options.includeMemories ?? options["include-memories"];
  const requestedMemories = memoryOption === undefined ? undefined : parseBooleanFlag(memoryOption);
  if (provider === "dsh" && requestedMemories === true) {
    throw Object.assign(new Error("DSH does not support Memory collection"), {
      code: "UNSUPPORTED_DSH_MEMORY_COLLECTION",
    });
  }
  // Qoder can isolate title metadata to the selected project. Keep that
  // metadata in the normal project baseline while user/global Memory remains
  // behind includeUserHome. Other providers expose Memory as user-level data.
  const includeMemories = requestedMemories === undefined
    ? provider === "qoder"
    : requestedMemories;
  const common = {
    ...options,
    provider,
    platform: provider,
    workspace,
    cwd,
    topology: options.topology,
    includeUserHome,
    includeGlobalHooks: includeUserHome,
    includeMemories,
  };
  const collectRawInventory = dependencies.collectRawInventory ?? collectAgentCustomizeInventory;
  let rawInventory;
  try {
    rawInventory = await collectRawInventory(common);
    const inheritedRoots = inheritedWorkspaceRoots(topology, workspace);
    if (inheritedRoots.length > 0) {
      const inheritedInventories = [];
      for (const inheritedWorkspace of inheritedRoots) {
        inheritedInventories.push(await collectRawInventory({
          ...common,
          workspace: inheritedWorkspace,
          includeUserHome: false,
          includeGlobalHooks: false,
          includeMemories: false,
        }));
      }
      rawInventory = mergeInheritedInventories(rawInventory, inheritedInventories, topology);
    }
  } catch (error) {
    const failed = unavailable(error, "inventory");
    return {
      kind: ASSET_BASELINE_KIND,
      schemaVersion: ASSET_BASELINE_SCHEMA_VERSION,
      status: "failed",
      scope: { provider, workspace, cwd, includeUserHome, includeMemories },
      envelopes: { lint: failed, inventory: failed, integrity: failed },
      diagnostics: { sharedInventorySnapshot: false, compact: true },
    };
  }

  const lintRunner = dependencies.runLint ?? runAgentLint;
  const inventoryRunner = dependencies.collectPublicInventory
    ?? (provider === "qoder" ? collectQoderInventory : collectProviderInventory);
  const pathContext = {
    workspace,
    workspaceInput: normalizeWorkspace(options.workspace ?? "."),
    gitRoot: topology?.gitRoot,
    gitRootInput: options.topology?.gitRoot,
    home: dependencies.homeDirectory?.() ?? os.homedir(),
    includeUserHome,
  };
  const [lintResult, inventoryResult] = await Promise.allSettled([
    lintRunner({ ...common, profile: "agent-assets-review", inventory: rawInventory }),
    inventoryRunner({ ...common, inventory: rawInventory }),
  ]);
  const lintEnvelope = lintResult.status === "fulfilled"
    ? available(compactLint(lintResult.value, pathContext))
    : unavailable(lintResult.reason, "lint");
  const inventoryEnvelope = inventoryResult.status === "fulfilled"
    ? available(await compactInventory(inventoryResult.value, workspace, {
      stat: dependencies.stat,
      now: dependencies.now,
      pathContext,
    }))
    : unavailable(inventoryResult.reason, "inventory");
  let integrityEnvelope;
  if (inventoryResult.status === "fulfilled") {
    try {
      const review = dependencies.reviewIntegrity ?? reviewAssetIntegrity;
      integrityEnvelope = available(compactIntegrity(
        review(inventoryResult.value, { locale: options.language }),
        pathContext,
      ));
    } catch (error) {
      integrityEnvelope = unavailable(error, "integrity");
    }
  } else {
    integrityEnvelope = unavailable(new Error("The shared public inventory is unavailable."), "integrity");
  }
  const envelopes = { lint: lintEnvelope, inventory: inventoryEnvelope, integrity: integrityEnvelope };
  const availableCount = Object.values(envelopes).filter((envelope) => envelope.status === "available").length;
  const truncatedStages = [
    lintEnvelope.data?.findings?.truncated ? "lint-findings" : null,
    integrityEnvelope.data?.findings?.truncated ? "integrity-findings" : null,
  ].filter(Boolean);
  const sampledStages = [
    inventoryEnvelope.data?.ownerRoutes?.truncated ? "inventory-owner-routes" : null,
  ].filter(Boolean);
  const snapshot = configuredSnapshot(rawInventory, provider);
  return {
    kind: ASSET_BASELINE_KIND,
    schemaVersion: ASSET_BASELINE_SCHEMA_VERSION,
    status: availableCount === 3 && truncatedStages.length === 0
      ? "complete"
      : availableCount === 0
        ? "failed"
        : "partial",
    scope: { provider, workspace, cwd, includeUserHome, includeMemories },
    ...(snapshot ? { configuredSnapshot: snapshot } : {}),
    envelopes,
    diagnostics: {
      sharedInventorySnapshot: true,
      compact: true,
      findingLimitPerEnvelope: MAX_BASELINE_FINDINGS,
      ownerRouteLimit: MAX_BASELINE_OWNER_ROUTES,
      inheritedWorkspaceCount: rawInventory?.diagnostics?.inheritedWorkspaceCount ?? 0,
      truncatedStages,
      sampledStages,
    },
  };
}

export function formatAssetBaselineMarkdown(result) {
  const lines = [
    "# Agent Asset Baseline",
    "",
    `Status: ${result.status}`,
    `Provider: ${result.scope.provider}`,
    `Scope: user-home=${result.scope.includeUserHome}; memories=${result.scope.includeMemories}`,
    "",
  ];
  for (const name of ["lint", "inventory", "integrity"]) {
    const envelope = result.envelopes[name];
    if (envelope.status === "unavailable") {
      lines.push(`- ${name}: unavailable (${envelope.error.code})`);
      continue;
    }
    const findings = envelope.data.findings;
    const suffix = findings ? `; findings ${findings.items.length}/${findings.total}` : "";
    lines.push(`- ${name}: available${suffix}`);
  }
  lines.push("", "Output is compact; use the individual diagnostic command only for a named unavailable or truncated stage.");
  return `${lines.join("\n")}\n`;
}

const USAGE = `Usage: better-harness coding-agent-practices asset-baseline [${hostPipeList(ASSET_PRACTICE_HOSTS)}] [options]

Collect one compact, read-only AI evidence envelope from a shared asset snapshot.

Options:
  --workspace <dir>          Workspace root (default: current directory)
  --cwd <dir>                Configured-practice cwd (default: workspace)
  --include-user-home        Include authorized user/global asset metadata
  --include-memories         Include authorized Memory title metadata (default: selected Qoder project)
  --claude-home <dir>        Claude config root override
  --claude-state <file>      Claude state-file override
  --kimi-home <dir>          Kimi Code data root override
  --dsh-home <dir>           DeepSeek Harness config root override
  --language <en|zh-CN>      Integrity finding language (default: en)
  --format <json|markdown>   Output format (default: json)
  --json                     Emit JSON
  -h, --help                 Print this help
`;

async function runCli(argv) {
  if (argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(USAGE);
    return 0;
  }
  const { command, options } = parseArgs(argv);
  const result = await collectAssetBaseline({ ...options, provider: options.provider ?? options.platform ?? command ?? "qoder" });
  const format = options.json ? "json" : options.format ?? "json";
  if (format === "markdown") process.stdout.write(formatAssetBaselineMarkdown(result));
  else if (format === "json") process.stdout.write(`${JSON.stringify(result)}\n`);
  else throw new Error(`Unsupported format: ${format}. Supported formats: json, markdown.`);
  return result.status === "complete" ? 0 : 1;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  runCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
