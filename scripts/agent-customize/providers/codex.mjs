import os from "node:os";
import path from "node:path";

import { pathExists } from "../../session-analysis/fs.mjs";
import { expandHome, normalizeWorkspace } from "../../session-analysis/paths.mjs";
import { MANAGE_TABS } from "../constants.mjs";
import {
  agentsMarkdownRuleSource,
  buildManageCollections,
  collectHookItems,
  collectMarkdownItems,
  collectMcpFromConfig,
  collectMcpItems,
  collectRuleSources,
  collectSkillFiles,
  collectWorkspaceRootPrimitives,
  designMarkdownRuleSource,
  directoryRuleSource,
  evidence,
  listDirectories,
  mergePrimitiveSets,
  normalizePluginDisplayName,
  pluginMetadataEvidencePath,
  readJson,
  readMarkdownName,
  readText,
  sortByName,
  titleCase,
  workspaceSourceLabel,
} from "../core/items.mjs";

const CODEX_PLUGIN_MANIFEST = [".codex-plugin", "plugin.json"];
const CODEX_REMOTE_INSTALL_FILE = ".codex-remote-plugin-install.json";
const ALWAYS_INSTALLED_MARKETPLACES = new Set([
  "openai-bundled",
  "openai-curated",
  "openai-primary-runtime",
]);

function defaultCodexHome() {
  return path.join(os.homedir(), ".codex");
}

function defaultCodexAppPath() {
  if (process.platform === "darwin") {
    return "/Applications/Codex.app";
  }
  return undefined;
}

function resolvePluginPath(pluginRoot, value, fallback) {
  const raw = typeof value === "string" && value.trim() ? value.trim() : fallback;
  if (!raw) {
    return undefined;
  }
  return path.resolve(pluginRoot, raw);
}

async function collectCodexPluginMcpItems(pluginRoot, manifest, sourceLabel) {
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

async function collectCodexPluginCommandItems(pluginRoot, manifest, sourceLabel) {
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

async function collectCodexPlugin(record) {
  const pluginRoot = path.resolve(expandHome(record.installPath));
  const metadataEvidencePath = await pluginMetadataEvidencePath(pluginRoot, [CODEX_PLUGIN_MANIFEST, ["package.json"]]);
  const manifest = (await readJson(path.join(pluginRoot, ...CODEX_PLUGIN_MANIFEST))) ?? {};
  const packageJson = (await readJson(path.join(pluginRoot, "package.json"))) ?? {};
  const readme = await readText(path.join(pluginRoot, "README.md"), 6000);
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
    codexPluginId: record.remotePluginId ?? record.id,
    marketplaceName: record.marketplaceName,
    rootPath: pluginRoot,
    scope: "plugin",
    sourceLabel: displayName,
    name: manifest.name || packageJson.name || record.name,
    displayName,
    description:
      manifest.interface?.shortDescription ||
      manifest.description ||
      packageJson.description ||
      "",
    publisher: { displayName: manifest.author?.name || manifest.interface?.developerName || titleCase(record.marketplaceName) },
    version: record.version || manifest.version || packageJson.version,
    installSources: record.sources,
    installSource: record.source,
    installMatch: record.installMatch,
    remotePluginId: record.remotePluginId,
    installRecordPath: record.installRecordPath,
    evidence: evidence(metadataEvidencePath, path.dirname(path.dirname(pluginRoot))),
  };
  const skillsRoot = resolvePluginPath(pluginRoot, manifest.skills, "skills");
  plugin.skills = skillsRoot ? await collectSkillFiles(skillsRoot, "plugin", displayName, pluginRoot) : [];
  plugin.mcpServers = await collectCodexPluginMcpItems(pluginRoot, manifest, displayName);
  plugin.rules = await collectRuleSources([
    directoryRuleSource(path.join(pluginRoot, "rules"), "plugin", displayName, pluginRoot),
  ]);
  plugin.commands = await collectCodexPluginCommandItems(pluginRoot, manifest, displayName);
  plugin.subagents = [
    ...(await collectMarkdownItems(path.join(pluginRoot, "agents"), "subagent", "plugin", displayName, pluginRoot)),
    ...(await collectMarkdownItems(path.join(pluginRoot, "subagents"), "subagent", "plugin", displayName, pluginRoot)),
  ].sort(sortByName);
  plugin.hooks = await collectHookItems(pluginRoot, "plugin", displayName, pluginRoot);
  return plugin;
}

function normalizeProvidedCodexRecord(record) {
  const id = String(record?.id ?? "").trim();
  const installPath = record?.installPath ? path.resolve(expandHome(record.installPath)) : "";
  if (!id || !installPath) {
    return undefined;
  }
  const [marketplaceName, name] = id.includes("/")
    ? id.split("/", 2)
    : [record.marketplaceName ?? "local", record.name ?? id];
  return {
    id,
    name,
    marketplaceName,
    installPath,
    version: record.version,
    sources: Array.isArray(record.sources) ? record.sources : [record.source ?? "user"],
    source: record.source ?? "user",
    installMatch: record.installMatch ?? "provided",
    remotePluginId: record.remotePluginId,
    installRecordPath: record.installRecordPath,
  };
}

async function collectCodexRevisionRecords(marketplaceName, pluginPath, installMarkerPath) {
  const pluginName = path.basename(pluginPath);
  const marker = installMarkerPath ? await readJson(installMarkerPath) : undefined;
  const revisions = await listDirectories(pluginPath);
  const candidateRoots = revisions.length > 0 ? revisions : [pluginPath];
  const records = [];
  for (const revisionRoot of candidateRoots) {
    const manifestPath = path.join(revisionRoot, ...CODEX_PLUGIN_MANIFEST);
    if (!(await pathExists(manifestPath))) {
      continue;
    }
    const manifest = (await readJson(manifestPath)) ?? {};
    records.push({
      id: `${marketplaceName}/${pluginName}`,
      name: manifest.name || pluginName,
      marketplaceName,
      installPath: revisionRoot,
      version: manifest.version || path.basename(revisionRoot),
      sources: ["user"],
      source: "user",
      installMatch: installMarkerPath ? "codex-remote-plugin-install" : "codex-local-cache",
      remotePluginId: marker?.remote_plugin_id,
      installRecordPath: installMarkerPath,
    });
  }
  return records;
}

async function readCodexInstalledPluginState(options = {}) {
  if (Array.isArray(options.codexInstalledPluginRecords) || Array.isArray(options.installedPluginRecords)) {
    const records = (options.codexInstalledPluginRecords ?? options.installedPluginRecords)
      .map(normalizeProvidedCodexRecord)
      .filter(Boolean);
    return { records, source: "provided", installRecordFiles: [] };
  }

  const codexHome = path.resolve(expandHome(options.codexHome ?? defaultCodexHome()));
  const cacheRoot = path.join(codexHome, "plugins", "cache");
  const records = [];
  const installRecordFiles = [];
  for (const marketplacePath of await listDirectories(cacheRoot)) {
    const marketplaceName = path.basename(marketplacePath);
    for (const pluginPath of await listDirectories(marketplacePath)) {
      const installMarkerPath = path.join(pluginPath, CODEX_REMOTE_INSTALL_FILE);
      const hasInstallMarker = await pathExists(installMarkerPath);
      if (!ALWAYS_INSTALLED_MARKETPLACES.has(marketplaceName) && !hasInstallMarker) {
        continue;
      }
      if (hasInstallMarker) {
        installRecordFiles.push(installMarkerPath);
      }
      records.push(...(await collectCodexRevisionRecords(
        marketplaceName,
        pluginPath,
        hasInstallMarker ? installMarkerPath : undefined,
      )));
    }
  }
  const remoteInstalledNames = new Set(
    records
      .filter((record) => record.installMatch === "codex-remote-plugin-install")
      .map((record) => record.name),
  );
  const activeRecords = records.filter(
    (record) => !(record.marketplaceName === "openai-curated" && remoteInstalledNames.has(record.name)),
  );
  return {
    records: activeRecords,
    source: records.length > 0 ? "codex-plugin-cache" : "missing",
    installRecordFiles,
    shadowedCuratedCacheCount: records.length - activeRecords.length,
  };
}

async function collectCodexPlugins(records) {
  const plugins = [];
  for (const record of records) {
    plugins.push(await collectCodexPlugin(record));
  }
  const byId = new Map();
  for (const plugin of plugins.sort(sortByName)) {
    if (!byId.has(plugin.id)) {
      byId.set(plugin.id, plugin);
    }
  }
  return [...byId.values()].sort(sortByName);
}

async function collectCodexUserPrimitives(codexHome) {
  return {
    skills: await collectSkillFiles(path.join(codexHome, "skills"), "user", "User", codexHome),
    subagents: await collectMarkdownItems(path.join(codexHome, "agents"), "subagent", "user", "User", codexHome),
    rules: await collectRuleSources([directoryRuleSource(path.join(codexHome, "rules"), "user", "User", codexHome)]),
    commands: await collectMarkdownItems(path.join(codexHome, "commands"), "command", "user", "User", codexHome),
    hooks: await collectHookItems(codexHome, "user", "User", codexHome),
    mcps: await collectMcpItems(codexHome, "user", "User", codexHome),
  };
}

async function collectCodexWorkspacePrimitives(workspace) {
  const sourceLabel = await workspaceSourceLabel(workspace);
  const project = mergePrimitiveSets(
    await Promise.all(
      [".codex", ".agents"].map((directory) =>
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

export async function collectCodexCustomizeInventory(options = {}) {
  const codexHome = path.resolve(expandHome(options.codexHome ?? options["codex-home"] ?? defaultCodexHome()));
  const codexAppPath = options.codexAppPath ?? options["codex-app-path"] ?? defaultCodexAppPath();
  const workspace = normalizeWorkspace(options.workspace ?? process.cwd());
  const includeUserHome = options.includeUserHome !== false;
  const installState = includeUserHome
    ? await readCodexInstalledPluginState({ ...options, codexHome })
    : { records: [], source: "not-authorized", installRecordFiles: [], shadowedCuratedCacheCount: 0 };
  const [plugins, user, project] = await Promise.all([
    includeUserHome ? collectCodexPlugins(installState.records ?? []) : [],
    includeUserHome ? collectCodexUserPrimitives(codexHome) : emptyPrimitives(),
    collectCodexWorkspacePrimitives(workspace),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    provider: "codex",
    codexHome,
    codexAppPath,
    workspace,
    tabs: MANAGE_TABS,
    plugins,
    manage: buildManageCollections(plugins, user, project),
    diagnostics: {
      installedPluginState: installState.source,
      installedPluginRecordCount: plugins.length,
      installedPluginRecordFiles: installState.installRecordFiles ?? [],
      shadowedCuratedCacheCount: installState.shadowedCuratedCacheCount ?? 0,
      remotePluginInstallMarkersRequired: true,
      appBundleExists: codexAppPath ? await pathExists(codexAppPath) : undefined,
    },
    unsupported: [
      "remote marketplace browse ordering",
      "remote marketplace display metadata",
      "team usage counts",
      "cloud MCP authentication state",
      "dashboard-only policy state",
    ],
  };
}
