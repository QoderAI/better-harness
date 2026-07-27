import os from "node:os";
import path from "node:path";

import { pathExists } from "../../session-analysis/fs.mjs";
import { expandHome, normalizeWorkspace } from "../../session-analysis/paths.mjs";
import { MANAGE_TABS } from "../constants.mjs";
import {
  agentsMarkdownRuleSource,
  buildManageCollections,
  collectHookItems,
  collectHooksFromFile,
  collectJsonAssetNames,
  collectMarkdownItems,
  collectMcpFromConfig,
  collectRuleSources,
  collectSkillFiles,
  countJsonFiles,
  designMarkdownRuleSource,
  directoryRuleSource,
  evidence,
  listDirectories,
  normalizePluginDisplayName,
  pluginMetadataEvidencePath,
  readJson,
  readMarkdownName,
  readText,
  runtimeStatusGroup,
  sortByName,
  titleCase,
  uniqueAssetsByRealPath,
  workspaceSourceLabel,
} from "../core/items.mjs";

const QODER_PLUGIN_MANIFEST = [".qoder-plugin", "plugin.json"];

function defaultQoderHome() {
  return path.join(os.homedir(), ".qoder");
}

function defaultQoderSharedClientCacheRoot() {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "Qoder", "SharedClientCache");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Qoder", "SharedClientCache");
  }
  const xdgConfig = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(xdgConfig, "Qoder", "SharedClientCache");
}

function looksLikeQoderAssetHome(candidate) {
  const base = path.basename(String(candidate ?? "")).toLowerCase();
  return base === ".qoder" || base === "qoder";
}

function resolveQoderAssetHome(options = {}) {
  const explicit = options.qoderHome ?? options["qoder-home"];
  if (explicit) return path.resolve(expandHome(explicit));
  const environmentHome = process.env.QODER_HOME;
  if (environmentHome && looksLikeQoderAssetHome(environmentHome)) {
    return path.resolve(expandHome(environmentHome));
  }
  return defaultQoderHome();
}

function resolveQoderSharedClientCacheRoot(options = {}) {
  const explicit =
    options.qoderSharedClientCacheRoot ??
    options["qoder-shared-client-cache-root"] ??
    options.sharedClientCacheRoot;
  if (explicit) return path.resolve(expandHome(explicit));
  const environmentHome = process.env.QODER_HOME;
  if (environmentHome && !looksLikeQoderAssetHome(environmentHome)) {
    return path.resolve(expandHome(environmentHome));
  }
  return defaultQoderSharedClientCacheRoot();
}

export function qoderWorkspaceSlugs(workspace) {
  const expanded = expandHome(workspace ?? process.cwd());
  const normalized = path.win32.isAbsolute(expanded)
    ? path.win32.normalize(expanded)
    : normalizeWorkspace(expanded);
  return [...new Set([
    normalized.replace(/:/gu, "-").replace(/[\\/]+/gu, "-"),
    normalized.replace(/:/gu, "").replace(/[\\/]+/gu, "-"),
  ])];
}

function splitQoderPluginKey(key) {
  const raw = String(key || "").trim();
  const separator = raw.lastIndexOf("@");
  return {
    id: raw,
    name: separator > 0 ? raw.slice(0, separator) : raw,
    marketplaceName: separator > 0 ? raw.slice(separator + 1) : "local",
  };
}

function qoderScopeForRecord(record, workspace) {
  const rawScope = String(record?.scope ?? "user").trim();
  if (rawScope === "local") {
    const projectPath = record?.projectPath ? normalizeWorkspace(record.projectPath) : "";
    return projectPath && projectPath === workspace ? "project" : "other";
  }
  if (rawScope === "workspace") {
    return "project";
  }
  return rawScope || "user";
}

function mergeQoderInstalledRecord(existing, next) {
  const merged = existing ?? {
    id: next.id,
    name: next.name,
    marketplaceName: next.marketplaceName,
    installPath: next.installPath,
    version: next.version,
    sources: [],
    source: next.source,
    projectPaths: [],
    indexSources: [],
    installedAt: next.installedAt,
  };
  if (!merged.installPath && next.installPath) {
    merged.installPath = next.installPath;
  }
  if (!merged.version && next.version) {
    merged.version = next.version;
  }
  if (!merged.installedAt && next.installedAt) {
    merged.installedAt = next.installedAt;
  }
  if (next.source && !merged.sources.includes(next.source)) {
    merged.sources.push(next.source);
  }
  if (next.projectPath && !merged.projectPaths.includes(next.projectPath)) {
    merged.projectPaths.push(next.projectPath);
  }
  if (next.indexSource && !merged.indexSources.includes(next.indexSource)) {
    merged.indexSources.push(next.indexSource);
  }
  if (merged.sources.includes("project")) {
    merged.source = "project";
  } else if (merged.sources.includes("user")) {
    merged.source = "user";
  } else {
    merged.source = merged.sources[0] ?? next.source ?? "user";
  }
  return merged;
}

async function readQoderInstalledPluginState(options = {}) {
  if (Array.isArray(options.qoderInstalledPluginRecords) || Array.isArray(options.installedPluginRecords)) {
    const records = (options.qoderInstalledPluginRecords ?? options.installedPluginRecords)
      .map((record) => {
        const key = splitQoderPluginKey(record.id);
        return {
          ...key,
          installPath: record.installPath,
          version: record.version,
          sources: Array.isArray(record.sources) ? record.sources : [record.source ?? "user"],
          source: record.source ?? "user",
          indexSources: record.indexSources ?? ["provided"],
        };
      })
      .filter((record) => record.id && record.installPath);
    return { records, source: "provided", indexFiles: [] };
  }

  const qoderHome = path.resolve(expandHome(options.qoderHome ?? defaultQoderHome()));
  const workspace = normalizeWorkspace(options.workspace ?? process.cwd());
  const legacyIndexPath = path.join(qoderHome, "plugins", "installed_plugins.json");
  const scopedIndexPath = path.join(qoderHome, "plugins", "installed_plugins_v2.json");
  const recordsById = new Map();
  const indexFiles = [];

  const legacyIndex = await readJson(legacyIndexPath);
  if (legacyIndex?.plugins && typeof legacyIndex.plugins === "object" && !Array.isArray(legacyIndex.plugins)) {
    indexFiles.push(legacyIndexPath);
    for (const [id, value] of Object.entries(legacyIndex.plugins)) {
      const key = splitQoderPluginKey(id);
      const source = qoderScopeForRecord(value, workspace);
      recordsById.set(
        key.id,
        mergeQoderInstalledRecord(recordsById.get(key.id), {
          ...key,
          installPath: value?.installPath,
          version: value?.version,
          source,
          projectPath: value?.projectPath,
          installedAt: value?.installedAt,
          indexSource: "installed_plugins.json",
        }),
      );
    }
  }

  const scopedIndex = await readJson(scopedIndexPath);
  if (scopedIndex?.plugins && typeof scopedIndex.plugins === "object" && !Array.isArray(scopedIndex.plugins)) {
    indexFiles.push(scopedIndexPath);
    for (const [id, values] of Object.entries(scopedIndex.plugins)) {
      const key = splitQoderPluginKey(id);
      const records = Array.isArray(values) ? values : [values];
      for (const value of records) {
        const source = qoderScopeForRecord(value, workspace);
        recordsById.set(
          key.id,
          mergeQoderInstalledRecord(recordsById.get(key.id), {
            ...key,
            installPath: value?.installPath,
            version: value?.version,
            source,
            projectPath: value?.projectPath,
            installedAt: value?.installedAt,
            indexSource: "installed_plugins_v2.json",
          }),
        );
      }
    }
  }

  return {
    records: [...recordsById.values()],
    source: indexFiles.length > 0 ? "qoder-installed-index" : "missing",
    indexFiles,
  };
}

async function readQoderEnabledPlugins(qoderHome) {
  const settings = await readJson(path.join(qoderHome, "settings.json"));
  const enabledPlugins = settings?.enabledPlugins;
  return enabledPlugins && typeof enabledPlugins === "object" && !Array.isArray(enabledPlugins)
    ? new Map(Object.entries(enabledPlugins).map(([key, value]) => [key, value !== false]))
    : new Map();
}

function resolvePluginPath(pluginRoot, value, fallback) {
  const raw = typeof value === "string" && value.trim() ? value.trim() : fallback;
  if (!raw) {
    return undefined;
  }
  return path.resolve(pluginRoot, raw);
}

async function collectQoderPluginMcpItems(pluginRoot, manifest, sourceLabel) {
  const candidates = [
    resolvePluginPath(pluginRoot, manifest.mcpServers),
    path.join(pluginRoot, "mcp.json"),
    path.join(pluginRoot, ".mcp.json"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return collectMcpFromConfig(candidate, "plugin", sourceLabel, pluginRoot);
    }
  }
  return [];
}

async function collectQoderPluginCommandItems(pluginRoot, manifest, sourceLabel) {
  if (manifest.commands && typeof manifest.commands === "object" && !Array.isArray(manifest.commands)) {
    const commands = [];
    for (const [name, value] of Object.entries(manifest.commands)) {
      const source = typeof value === "string" ? value : value?.source;
      const filePath = source ? path.resolve(pluginRoot, source) : undefined;
      if (!filePath || !(await pathExists(filePath))) {
        continue;
      }
      const metadata = await readMarkdownName(filePath, name);
      commands.push({
        id: `plugin:command:${filePath}`,
        kind: "command",
        scope: "plugin",
        sourceLabel,
        filePath,
        name: metadata.name || name,
        description: value?.description || metadata.description,
        evidence: evidence(filePath, pluginRoot),
      });
    }
    return commands.sort(sortByName);
  }
  const commandsRoot = resolvePluginPath(pluginRoot, manifest.commands, "commands");
  return commandsRoot
    ? collectMarkdownItems(commandsRoot, "command", "plugin", sourceLabel, pluginRoot)
    : [];
}

async function collectQoderPluginHooks(pluginRoot, manifest, sourceLabel) {
  const hooksPath = resolvePluginPath(pluginRoot, manifest.hooks);
  if (hooksPath && (await pathExists(hooksPath))) {
    return collectHooksFromFile(hooksPath, "plugin", sourceLabel, pluginRoot);
  }
  return collectHookItems(pluginRoot, "plugin", sourceLabel, pluginRoot);
}

async function collectQoderPlugin(record, enabledPlugins) {
  const pluginRoot = record.installPath ? path.resolve(expandHome(record.installPath)) : "";
  const metadataEvidencePath = pluginRoot
    ? await pluginMetadataEvidencePath(pluginRoot, [QODER_PLUGIN_MANIFEST, ["package.json"]])
    : undefined;
  const manifest = pluginRoot ? (await readJson(path.join(pluginRoot, ...QODER_PLUGIN_MANIFEST))) ?? {} : {};
  const packageJson = pluginRoot ? (await readJson(path.join(pluginRoot, "package.json"))) ?? {} : {};
  const readme = pluginRoot ? await readText(path.join(pluginRoot, "README.md"), 6000) : "";
  const heading = readme.match(/^#\s+(.+)$/mu)?.[1]?.trim();
  const rawDisplayName =
    manifest.interface?.displayName ||
    manifest.displayName ||
    packageJson.displayName ||
    heading ||
    titleCase(manifest.name || packageJson.name || record.name);
  const displayName = normalizePluginDisplayName(rawDisplayName, record.name);
  const plugin = {
    id: record.id,
    qoderPluginId: record.id,
    marketplaceName: record.marketplaceName,
    rootPath: pluginRoot || undefined,
    scope: "plugin",
    sourceLabel: displayName,
    name: manifest.name || packageJson.name || record.name,
    displayName,
    description: manifest.description || packageJson.description || "",
    publisher: { displayName: manifest.author?.name || titleCase(record.marketplaceName) },
    version: record.version || manifest.version || packageJson.version,
    installedAt: record.installedAt,
    installSources: record.sources,
    installSource: record.source,
    installMatch: "qoder-installed-index",
    enabled: enabledPlugins.has(record.id) ? enabledPlugins.get(record.id) : undefined,
    indexSources: record.indexSources,
    evidence: metadataEvidencePath ? evidence(metadataEvidencePath, path.dirname(path.dirname(pluginRoot))) : undefined,
  };
  const skillsRoot = resolvePluginPath(pluginRoot, manifest.skills, "skills");
  plugin.skills = skillsRoot ? await collectSkillFiles(skillsRoot, "plugin", displayName, pluginRoot) : [];
  plugin.mcpServers = pluginRoot ? await collectQoderPluginMcpItems(pluginRoot, manifest, displayName) : [];
  plugin.rules = pluginRoot
    ? await collectRuleSources([directoryRuleSource(path.join(pluginRoot, "rules"), "plugin", displayName, pluginRoot)])
    : [];
  plugin.commands = pluginRoot ? await collectQoderPluginCommandItems(pluginRoot, manifest, displayName) : [];
  plugin.subagents = pluginRoot
    ? [
        ...(await collectMarkdownItems(path.join(pluginRoot, "agents"), "subagent", "plugin", displayName, pluginRoot)),
        ...(await collectMarkdownItems(path.join(pluginRoot, "subagents"), "subagent", "plugin", displayName, pluginRoot)),
      ].sort(sortByName)
    : [];
  plugin.hooks = pluginRoot ? await collectQoderPluginHooks(pluginRoot, manifest, displayName) : [];
  return plugin;
}

async function collectQoderInstalledPlugins(records, enabledPlugins) {
  const plugins = [];
  for (const record of records) {
    plugins.push(await collectQoderPlugin(record, enabledPlugins));
  }
  return plugins.sort(sortByName);
}

async function collectQoderRuntimeMcpItems(root, scope, sourceLabel, rootForEvidence) {
  const directories = await listDirectories(root);
  const items = [];
  for (const directory of directories) {
    const metadataPath = path.join(directory, "SERVER_METADATA.json");
    const metadata = await readJson(metadataPath);
    if (!metadata) {
      continue;
    }
    const name = String(metadata.name || path.basename(directory));
    const statusText = await readText(path.join(directory, "STATUS.md"), 2000);
    const toolCount = Number.isFinite(metadata.toolCount)
      ? metadata.toolCount
      : await countJsonFiles(path.join(directory, "tools"));
    const toolNames = await collectJsonAssetNames(path.join(directory, "tools"));
    const resourceCount = Number.isFinite(metadata.resourceCount)
      ? metadata.resourceCount
      : await countJsonFiles(path.join(directory, "resources"));
    const statusGroup = runtimeStatusGroup(statusText, toolCount, resourceCount);
    items.push({
      id: `${scope}:runtime:mcp:${directory}`,
      kind: "mcp",
      name,
      scope,
      sourceLabel,
      filePath: metadataPath,
      toolCount,
      toolNames,
      resourceCount,
      needsAttention: statusGroup === "needsAttention",
      statusGroup,
      sourceKind: "runtime-mcp",
      evidence: evidence(metadataPath, rootForEvidence),
    });
  }
  return items.sort(sortByName);
}

async function firstConfiguredMcpSource(candidates, scope, sourceLabel) {
  for (const candidate of candidates) {
    if (!(await pathExists(candidate.filePath))) continue;
    const items = await collectMcpFromConfig(candidate.filePath, scope, sourceLabel, candidate.rootForEvidence);
    return { items, source: candidate.filePath };
  }
  return { items: [], source: null };
}

function enrichConfiguredMcpItems(configuredItems, runtimeItems) {
  const runtimeByName = new Map(runtimeItems.map((item) => [item.name, item]));
  return configuredItems.map((item) => {
    const runtime = runtimeByName.get(item.name);
    if (!runtime) return item;
    return {
      ...item,
      toolCount: runtime.toolCount,
      toolNames: runtime.toolNames,
      resourceCount: runtime.resourceCount,
      needsAttention: runtime.needsAttention,
      statusGroup: runtime.statusGroup,
      runtimeEvidence: runtime.evidence,
    };
  });
}

async function collectQoderUserPrimitives(qoderHome, sharedClientCacheRoot) {
  const configured = await firstConfiguredMcpSource([
    {
      filePath: path.join(sharedClientCacheRoot, "mcp.json"),
      rootForEvidence: sharedClientCacheRoot,
    },
    {
      filePath: path.join(sharedClientCacheRoot, "extension", "local", "mcp.json"),
      rootForEvidence: sharedClientCacheRoot,
    },
    {
      filePath: path.join(qoderHome, "shared_client", "mcp.json"),
      rootForEvidence: qoderHome,
    },
    {
      filePath: path.join(qoderHome, "shared_client", "extension", "local", "mcp.json"),
      rootForEvidence: qoderHome,
    },
  ], "user", "User");
  const userRuntimeMcps = await collectQoderRuntimeMcpItems(
    path.join(sharedClientCacheRoot, "mcps"),
    "user",
    "User",
    sharedClientCacheRoot,
  );
  const userMcps = enrichConfiguredMcpItems(configured.items, userRuntimeMcps);
  return {
    skills: await collectSkillFiles(path.join(qoderHome, "skills"), "user", "User", qoderHome),
    subagents: await collectMarkdownItems(path.join(qoderHome, "agents"), "subagent", "user", "User", qoderHome),
    rules: await collectRuleSources([directoryRuleSource(path.join(qoderHome, "rules"), "user", "User", qoderHome)]),
    commands: await collectMarkdownItems(path.join(qoderHome, "commands"), "command", "user", "User", qoderHome),
    hooks: [
      ...(await collectHooksFromFile(path.join(qoderHome, "settings.json"), "user", "User", qoderHome)),
      ...(await collectHookItems(qoderHome, "user", "User", qoderHome)),
    ].sort(sortByName),
    mcps: userMcps,
    mcpSource: configured.source,
    runtimeMcps: userRuntimeMcps,
  };
}

async function collectQoderUserHooks(qoderHome) {
  return [
    ...(await collectHooksFromFile(path.join(qoderHome, "settings.json"), "user", "User", qoderHome)),
    ...(await collectHookItems(qoderHome, "user", "User", qoderHome)),
  ].sort(sortByName);
}

async function collectQoderWorkspacePrimitives(workspace, sharedClientCacheRoot, includeRuntime = true) {
  const sourceLabel = await workspaceSourceLabel(workspace);
  const qoderRoot = path.join(workspace, ".qoder");
  const agentRoot = path.join(workspace, ".agents");
  const slugs = qoderWorkspaceSlugs(workspace);
  const settingsHooks = [
    ...(await collectHooksFromFile(path.join(qoderRoot, "settings.json"), "project", sourceLabel, workspace)),
    ...(await collectHooksFromFile(path.join(qoderRoot, "settings.local.json"), "project", sourceLabel, workspace)),
  ];
  const projectQoderMcpPath = path.join(qoderRoot, "mcp.json");
  const projectFallbackMcpPath = path.join(workspace, ".mcp.json");
  const configuredMcps = await firstConfiguredMcpSource([
    { filePath: projectQoderMcpPath, rootForEvidence: workspace },
    { filePath: projectFallbackMcpPath, rootForEvidence: workspace },
  ], "project", sourceLabel);
  let runtimeMcps = [];
  if (includeRuntime) {
    for (const slug of slugs) {
      runtimeMcps = await collectQoderRuntimeMcpItems(
        path.join(sharedClientCacheRoot, "projects", slug, "mcps"),
        "project",
        sourceLabel,
        sharedClientCacheRoot,
      );
      if (runtimeMcps.length > 0) break;
    }
  }
  const skills = await uniqueAssetsByRealPath([
    ...(await collectSkillFiles(path.join(qoderRoot, "skills"), "project", sourceLabel, workspace)),
    ...(await collectSkillFiles(path.join(agentRoot, "skills"), "project", sourceLabel, workspace)),
  ]);
  const subagents = await uniqueAssetsByRealPath([
    ...(await collectMarkdownItems(path.join(qoderRoot, "agents"), "subagent", "project", sourceLabel, workspace)),
    ...(await collectMarkdownItems(path.join(agentRoot, "agents"), "subagent", "project", sourceLabel, workspace)),
  ]);
  return {
    skills: skills.sort(sortByName),
    subagents: subagents.sort(sortByName),
    rules: await collectRuleSources(qoderWorkspaceRuleSources(workspace, qoderRoot, sourceLabel)),
    commands: await collectMarkdownItems(path.join(qoderRoot, "commands"), "command", "project", sourceLabel, workspace),
    hooks: [...settingsHooks, ...(await collectHookItems(qoderRoot, "project", sourceLabel, workspace))].sort(sortByName),
    mcps: enrichConfiguredMcpItems(configuredMcps.items, runtimeMcps),
    mcpSource: configuredMcps.source,
    runtimeMcps,
  };
}

function emptyPrimitives() {
  return { skills: [], subagents: [], rules: [], commands: [], hooks: [], mcps: [], mcpSource: null, runtimeMcps: [] };
}

function qoderWorkspaceRuleSources(workspace, qoderRoot, sourceLabel) {
  return [
    directoryRuleSource(path.join(qoderRoot, "rules"), "project", sourceLabel, workspace, {
      sourceKind: "qoder-rules",
    }),
    agentsMarkdownRuleSource(workspace, sourceLabel, "after-qoder-rules"),
    designMarkdownRuleSource(workspace, sourceLabel),
  ];
}

export async function collectQoderCustomizeInventory(options = {}) {
  const qoderHome = resolveQoderAssetHome(options);
  const sharedClientCacheRoot = resolveQoderSharedClientCacheRoot(options);
  const workspace = normalizeWorkspace(options.workspace ?? process.cwd());
  const includeUserHome = options.includeUserHome !== false;
  const installState = includeUserHome
    ? await readQoderInstalledPluginState({ ...options, qoderHome, workspace })
    : { records: [], source: "not-authorized", indexFiles: [] };
  const enabledPlugins = includeUserHome ? await readQoderEnabledPlugins(qoderHome) : new Map();
  const includeGlobalHooks = options.includeGlobalHooks === true;
  const [plugins, user, project] = await Promise.all([
    includeUserHome ? collectQoderInstalledPlugins(installState.records ?? [], enabledPlugins) : [],
    includeUserHome
      ? collectQoderUserPrimitives(qoderHome, sharedClientCacheRoot)
      : includeGlobalHooks
        ? collectQoderUserHooks(qoderHome).then((hooks) => ({ ...emptyPrimitives(), hooks }))
        : emptyPrimitives(),
    collectQoderWorkspacePrimitives(workspace, sharedClientCacheRoot, includeUserHome),
  ]);
  const installedPluginIds = new Set(plugins.map((plugin) => plugin.id));
  return {
    generatedAt: new Date().toISOString(),
    provider: "qoder",
    qoderHome,
    sharedClientCacheRoot,
    workspace,
    tabs: MANAGE_TABS,
    plugins,
    manage: buildManageCollections(plugins, user, project),
    diagnostics: {
      installedPluginState: installState.source,
      installedPluginIndexFiles: installState.indexFiles ?? [],
      installedPluginRecordCount: plugins.length,
      enabledInstalledPluginCount: plugins.filter((plugin) => plugin.enabled === true).length,
      disabledInstalledPluginCount: plugins.filter((plugin) => plugin.enabled === false).length,
      unspecifiedInstalledPluginCount: plugins.filter((plugin) => plugin.enabled == null).length,
      configuredPluginStateCount: enabledPlugins.size,
      unmatchedEnabledPluginSettingCount: [...enabledPlugins]
        .filter(([id, enabled]) => enabled && !installedPluginIds.has(id)).length,
      cacheOnlyPluginsExcluded: true,
      enabledPluginsAreNotInstallEvidence: true,
      userMcpSource: user.mcpSource,
      projectMcpSource: project.mcpSource,
      runtimeOnlyUserMcpCount: user.runtimeMcps.filter((runtime) => !user.mcps.some((item) => item.name === runtime.name)).length,
      runtimeOnlyProjectMcpCount: project.runtimeMcps.filter((runtime) => !project.mcps.some((item) => item.name === runtime.name)).length,
    },
    unsupported: [
      "remote marketplace browse ordering",
      "remote marketplace display metadata",
      "cloud MCP authentication state",
      "dashboard-only policy state",
    ],
  };
}
