import os from "node:os";
import path from "node:path";

import { pathExists, walkFiles } from "../../session-analysis/fs.mjs";
import { expandHome, normalizeWorkspace } from "../../session-analysis/paths.mjs";
import { MANAGE_TABS } from "../constants.mjs";
import {
  agentsMarkdownRuleSource,
  buildManageCollections,
  collectHookItems,
  collectMarkdownItems,
  collectMcpItems,
  collectRuleSources,
  collectSkillFiles,
  collectWorkspaceRootPrimitives,
  countJsonFiles,
  designMarkdownRuleSource,
  directoryRuleSource,
  evidence,
  listDirectories,
  mergeMcpItems,
  mergePrimitiveSets,
  normalizePluginDisplayName,
  pluginMetadataEvidencePath,
  readJson,
  readText,
  runtimeMcpRank,
  runtimeStatusGroup,
  sortByName,
  titleCase,
  workspaceSourceLabel,
} from "../core/items.mjs";
import { readInstalledPluginState } from "../storage.mjs";

async function collectRuntimePluginMcpItems(cursorHome) {
  const projectsRoot = path.join(cursorHome, "projects");
  const projectDirs = await listDirectories(projectsRoot);
  const byIdentifier = new Map();
  for (const projectDir of projectDirs) {
    const mcpRoot = path.join(projectDir, "mcps");
    const serverDirs = await listDirectories(mcpRoot);
    for (const serverDir of serverDirs) {
      const metadata = await readJson(path.join(serverDir, "SERVER_METADATA.json"));
      const serverIdentifier = metadata?.serverIdentifier ? String(metadata.serverIdentifier) : path.basename(serverDir);
      if (!serverIdentifier.startsWith("plugin-")) {
        continue;
      }
      const name = metadata?.serverName ? String(metadata.serverName) : serverIdentifier.replace(/^plugin-/u, "");
      const statusText = await readText(path.join(serverDir, "STATUS.md"), 2000);
      const toolCount = await countJsonFiles(path.join(serverDir, "tools"));
      const resourceCount = await countJsonFiles(path.join(serverDir, "resources"));
      const statusGroup = runtimeStatusGroup(statusText, toolCount, resourceCount);
      const record = {
        id: `runtime:plugin:mcp:${serverIdentifier}`,
        kind: "mcp",
        name,
        scope: "plugin",
        sourceLabel: "Plugin",
        serverIdentifier,
        filePath: path.join(serverDir, "SERVER_METADATA.json"),
        toolCount,
        resourceCount,
        needsAttention: statusGroup === "needsAttention",
        statusGroup,
        sourceKind: "runtime-plugin",
        evidence: evidence(path.join(serverDir, "SERVER_METADATA.json"), cursorHome),
      };
      const existing = byIdentifier.get(serverIdentifier);
      if (!existing || runtimeMcpRank(record) > runtimeMcpRank(existing)) {
        byIdentifier.set(serverIdentifier, record);
      }
    }
  }
  return [...byIdentifier.values()].sort(sortByName);
}

async function collectPluginMetadata(pluginRoot, marketplaceName, pluginName) {
  const cursorPlugin = (await readJson(path.join(pluginRoot, ".cursor-plugin", "plugin.json"))) ?? {};
  const manifest = (await readJson(path.join(pluginRoot, "manifest.json"))) ?? {};
  const packageJson = (await readJson(path.join(pluginRoot, "package.json"))) ?? {};
  const readme = await readText(path.join(pluginRoot, "README.md"), 6000);
  const heading = readme.match(/^#\s+(.+)$/mu)?.[1]?.trim();
  const rawDisplayName =
    cursorPlugin.displayName ||
    cursorPlugin.display_name ||
    manifest.displayName ||
    manifest.display_name ||
    packageJson.displayName ||
    packageJson.display_name ||
    heading ||
    titleCase(cursorPlugin.name || manifest.name || packageJson.name || pluginName);
  const cursorPluginId = cursorPlugin.id || manifest.id || packageJson.id;
  return {
    name: cursorPlugin.name || manifest.name || packageJson.name || pluginName,
    displayName: normalizePluginDisplayName(rawDisplayName, pluginName),
    description: cursorPlugin.description || manifest.description || packageJson.description || "",
    publisher: { displayName: titleCase(marketplaceName) },
    cursorPluginId: cursorPluginId ? String(cursorPluginId) : undefined,
    hasCursorMarketplaceManifest: await pathExists(path.join(pluginRoot, ".cursor-plugin", "marketplace.json")),
  };
}

async function collectPlugin(pluginRoot, marketplaceName, pluginName) {
  const metadata = await collectPluginMetadata(pluginRoot, marketplaceName, pluginName);
  const metadataEvidencePath = await pluginMetadataEvidencePath(pluginRoot, [
    [".cursor-plugin", "plugin.json"],
    ["manifest.json"],
    ["package.json"],
  ]);
  const plugin = {
    id: `${marketplaceName}/${pluginName}`,
    marketplaceName,
    rootPath: pluginRoot,
    scope: "plugin",
    sourceLabel: metadata.displayName,
    ...metadata,
    evidence: evidence(metadataEvidencePath, path.dirname(path.dirname(pluginRoot))),
  };
  plugin.skills = await collectSkillFiles(path.join(pluginRoot, "skills"), "plugin", plugin.displayName, pluginRoot);
  plugin.mcpServers = await collectMcpItems(pluginRoot, "plugin", plugin.displayName, pluginRoot);
  plugin.rules = await collectRuleSources([
    directoryRuleSource(path.join(pluginRoot, "rules"), "plugin", plugin.displayName, pluginRoot),
  ]);
  plugin.commands = await collectMarkdownItems(
    path.join(pluginRoot, "commands"),
    "command",
    "plugin",
    plugin.displayName,
    pluginRoot,
  );
  plugin.subagents = [
    ...(await collectMarkdownItems(path.join(pluginRoot, "agents"), "subagent", "plugin", plugin.displayName, pluginRoot)),
    ...(await collectMarkdownItems(path.join(pluginRoot, "subagents"), "subagent", "plugin", plugin.displayName, pluginRoot)),
  ].sort(sortByName);
  plugin.hooks = await collectHookItems(pluginRoot, "plugin", plugin.displayName, pluginRoot);
  return plugin;
}

async function collectPlugins(cursorHome) {
  const cacheRoot = path.join(cursorHome, "plugins", "cache");
  const marketplaces = await listDirectories(cacheRoot);
  const plugins = [];
  for (const marketplacePath of marketplaces) {
    const marketplaceName = path.basename(marketplacePath);
    const pluginDirs = await listDirectories(marketplacePath);
    for (const pluginPath of pluginDirs) {
      const pluginName = path.basename(pluginPath);
      const revisions = await listDirectories(pluginPath);
      for (const revisionPath of revisions) {
        plugins.push(await collectPlugin(revisionPath, marketplaceName, pluginName));
      }
    }
  }
  const byId = new Map();
  for (const plugin of plugins.sort(sortByName)) {
    if (!byId.has(plugin.id)) {
      byId.set(plugin.id, plugin);
    }
  }
  return [...byId.values()].sort(sortByName);
}

function workspaceProjectSlug(workspace) {
  return path
    .resolve(workspace)
    .split(path.sep)
    .filter(Boolean)
    .join("-")
    .replace(/[^A-Za-z0-9._-]/gu, "-");
}

function matchPluginFromServerIdentifier(serverIdentifier, plugins) {
  if (!serverIdentifier.startsWith("plugin-")) {
    return undefined;
  }
  return [...plugins]
    .sort((left, right) => right.name.length - left.name.length)
    .find((plugin) => {
      const prefix = `plugin-${plugin.name}`;
      return serverIdentifier === prefix || serverIdentifier.startsWith(`${prefix}-`);
    });
}

async function collectProjectPluginIdHints(cursorHome, workspace, plugins) {
  const projectMcpRoot = path.join(cursorHome, "projects", workspaceProjectSlug(workspace), "mcps");
  if (!(await pathExists(projectMcpRoot))) {
    return new Map();
  }
  const directories = await listDirectories(projectMcpRoot);
  const hints = new Map();
  for (const directory of directories) {
    const serverIdentifier = path.basename(directory);
    const plugin = matchPluginFromServerIdentifier(serverIdentifier, plugins);
    if (!plugin) {
      continue;
    }
    const toolFiles = await walkFiles(path.join(directory, "tools"), {
      maxDepth: 1,
      limit: 500,
      match: (filePath) => path.extname(filePath) === ".json",
    });
    for (const filePath of toolFiles) {
      const tool = await readJson(filePath);
      const pluginId = tool?.pluginId ? String(tool.pluginId) : undefined;
      if (pluginId) {
        hints.set(pluginId, plugin.id);
      }
    }
  }
  return hints;
}

function installSourcesForRecord(record) {
  return record.sources.length > 0 ? record.sources : [record.source ?? "user"];
}

function attachInstallRecord(plugin, record, matchKind, installOrder) {
  if (matchKind === "cache-fallback") {
    return {
      ...plugin,
      installSources: installSourcesForRecord(record),
      installSource: record.source,
      installMatch: matchKind,
    };
  }
  return {
    ...plugin,
    cursorPluginId: plugin.cursorPluginId ?? record.id,
    installedPluginRecordId: record.id,
    installSources: installSourcesForRecord(record),
    installSource: record.source,
    installMatch: matchKind,
    installOrder,
  };
}

function matchInstallRecord(record, plugins, pluginById, pluginIdHints) {
  const directPlugin = plugins.find((plugin) => plugin.cursorPluginId === record.id);
  if (directPlugin) {
    return { plugin: directPlugin, matchKind: "id" };
  }
  const hintedPluginId = pluginIdHints.get(record.id);
  if (hintedPluginId && pluginById.has(hintedPluginId)) {
    return { plugin: pluginById.get(hintedPluginId), matchKind: "project-mcp" };
  }
  return undefined;
}

function sortByInstallOrder(left, right) {
  const leftOrder = Number.isInteger(left.installOrder) ? left.installOrder : Number.MAX_SAFE_INTEGER;
  const rightOrder = Number.isInteger(right.installOrder) ? right.installOrder : Number.MAX_SAFE_INTEGER;
  return leftOrder === rightOrder ? sortByName(left, right) : leftOrder - rightOrder;
}

function filterInstalledPlugins(plugins, installState, pluginIdHints) {
  const records = installState.records;
  if (!Array.isArray(records)) {
    return {
      plugins,
      diagnostics: {
        installedPluginState: installState.source,
        installedPluginStorageKey: installState.storageKey,
        installedPluginRecordCount: undefined,
        installedPluginFallbackCount: 0,
        unmatchedInstalledPluginIds: [],
      },
    };
  }

  const pluginById = new Map(plugins.map((plugin) => [plugin.id, plugin]));
  const included = new Map();
  const matchedRecordIds = new Set();
  const unmatchedRecords = [];
  let fallbackCount = 0;

  records.forEach((record, installOrder) => {
    const match = matchInstallRecord(record, plugins, pluginById, pluginIdHints);
    if (match && !included.has(match.plugin.id)) {
      included.set(match.plugin.id, attachInstallRecord(match.plugin, record, match.matchKind, installOrder));
      matchedRecordIds.add(record.id);
      return;
    }
    unmatchedRecords.push({ record, installOrder });
  });

  const remainingSlots = records.length - included.size;
  if (remainingSlots > 0) {
    const fallbackCandidates = plugins
      .filter((plugin) => !included.has(plugin.id) && !plugin.hasCursorMarketplaceManifest)
      .sort(sortByName)
      .slice(0, remainingSlots);
    for (const [index, plugin] of fallbackCandidates.entries()) {
      const unmatched = unmatchedRecords[index];
      fallbackCount += 1;
      included.set(
        plugin.id,
        attachInstallRecord(
          plugin,
          unmatched?.record ?? { id: plugin.cursorPluginId ?? plugin.id, sources: ["user"] },
          "cache-fallback",
          unmatched?.installOrder,
        ),
      );
    }
  }

  return {
    plugins: [...included.values()].sort(sortByInstallOrder),
    diagnostics: {
      installedPluginState: installState.source,
      installedPluginStorageKey: installState.storageKey,
      installedPluginRecordCount: records.length,
      installedPluginFallbackCount: fallbackCount,
      unmatchedInstalledPluginIds: records
        .filter((record) => !matchedRecordIds.has(record.id))
        .map((record) => record.id),
      installedPluginMatching: fallbackCount > 0
        ? "numeric plugin IDs without local manifests were matched by cache fallback order"
        : "local evidence matched all installed plugin records",
    },
  };
}

async function collectUserPrimitives(cursorHome) {
  const userMcps = await collectMcpItems(cursorHome, "user", "User", cursorHome);
  const runtimePluginMcps = await collectRuntimePluginMcpItems(cursorHome);
  return {
    skills: await collectSkillFiles(path.join(cursorHome, "skills"), "user", "User", cursorHome),
    subagents: await collectMarkdownItems(path.join(cursorHome, "agents"), "subagent", "user", "User", cursorHome),
    rules: await collectRuleSources([directoryRuleSource(path.join(cursorHome, "rules"), "user", "User", cursorHome)]),
    commands: await collectMarkdownItems(path.join(cursorHome, "commands"), "command", "user", "User", cursorHome),
    hooks: await collectHookItems(cursorHome, "user", "User", cursorHome),
    mcps: mergeMcpItems([...userMcps, ...runtimePluginMcps]),
  };
}

async function collectWorkspacePrimitives(workspace) {
  const sourceLabel = await workspaceSourceLabel(workspace);
  const project = mergePrimitiveSets(
    await Promise.all(
      [".cursor", ".codex"].map((directory) =>
        collectWorkspaceRootPrimitives(path.join(workspace, directory), sourceLabel, workspace),
      ),
    ),
  );
  return {
    ...project,
    rules: [
      ...project.rules,
      ...(await collectRuleSources([
        agentsMarkdownRuleSource(workspace, sourceLabel),
        designMarkdownRuleSource(workspace, sourceLabel),
      ])),
    ],
  };
}

function emptyPrimitives() {
  return { skills: [], subagents: [], rules: [], commands: [], hooks: [], mcps: [] };
}

export async function collectCursorCustomizeInventory(options = {}) {
  const cursorHome = path.resolve(expandHome(options.cursorHome ?? path.join(os.homedir(), ".cursor")));
  const workspace = normalizeWorkspace(options.workspace ?? process.cwd());
  const includeUserHome = options.includeUserHome !== false;
  const [allPlugins, installState, user, project] = await Promise.all([
    includeUserHome ? collectPlugins(cursorHome) : [],
    includeUserHome ? readInstalledPluginState({ ...options, workspace }) : { records: [], source: "not-authorized" },
    includeUserHome ? collectUserPrimitives(cursorHome) : emptyPrimitives(),
    collectWorkspacePrimitives(workspace),
  ]);
  const pluginIdHints = includeUserHome ? await collectProjectPluginIdHints(cursorHome, workspace, allPlugins) : new Map();
  const { plugins, diagnostics } = filterInstalledPlugins(allPlugins, installState, pluginIdHints);
  return {
    generatedAt: new Date().toISOString(),
    provider: "cursor",
    cursorHome,
    workspace,
    tabs: MANAGE_TABS,
    plugins,
    manage: buildManageCollections(plugins, user, project),
    diagnostics,
    unsupported: [
      "remote marketplace browse ordering",
      "remote marketplace display metadata",
      "team usage counts",
      "cloud MCP authentication state",
      "dashboard-only policy state",
    ],
  };
}
