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
  collectRuleSources,
  collectSkillFiles,
  designMarkdownRuleSource,
  directoryRuleSource,
  evidence,
  normalizePluginDisplayName,
  pluginMetadataEvidencePath,
  readJson,
  readText,
  sortByName,
  titleCase,
  uniqueAssetsByRealPath,
  workspaceSourceLabel,
} from "../core/items.mjs";

// Copilot resolves a plugin manifest from these roots, in this order.
const COPILOT_PLUGIN_MANIFESTS = [
  [".plugin", "plugin.json"],
  ["plugin.json"],
  [".github", "plugin", "plugin.json"],
  [".claude-plugin", "plugin.json"],
];

function defaultCopilotHome() {
  return process.env.COPILOT_HOME ?? path.join(os.homedir(), ".copilot");
}

// Copilot writes `config.json` and `settings.json` as JSONC with whole-line `//`
// comments. Only full-line comments are stripped so string values that contain
// `//` (for example URLs) stay intact.
async function readCopilotJson(filePath) {
  const text = await readText(filePath, 512_000);
  if (!text) return undefined;
  const stripped = text
    .split(/\r?\n/u)
    .filter((line) => !/^\s*\/\//u.test(line))
    .join("\n");
  try {
    return JSON.parse(stripped);
  } catch {
    return undefined;
  }
}

function copilotInstructionsRuleSource(filePath, scope, sourceLabel, rootForEvidence, precedence) {
  return {
    type: "file",
    filePath,
    scope,
    sourceLabel,
    rootForEvidence,
    name: path.basename(filePath),
    sourceKind: "copilot-instructions",
    precedence,
    useHeading: true,
  };
}

function normalizeSettingsMcp(name, config, scope, sourceLabel, evidencePath, rootForEvidence) {
  return {
    name,
    scope,
    sourceLabel,
    command: config.command ?? null,
    args: config.args ?? [],
    url: config.url ?? config.httpUrl ?? null,
    evidence: evidence(evidencePath, rootForEvidence),
  };
}

function flattenSettingsHooks(settingsHooks) {
  if (!settingsHooks || typeof settingsHooks !== "object" || Array.isArray(settingsHooks)) return [];
  const items = [];
  for (const [, definitions] of Object.entries(settingsHooks)) {
    if (!Array.isArray(definitions)) continue;
    for (const definition of definitions) {
      const hooks = Array.isArray(definition?.hooks) ? definition.hooks : [definition];
      for (const hook of hooks) {
        const command = hook?.command ?? hook?.bash ?? hook?.powershell;
        if (command) items.push({ command, type: hook?.type ?? "command" });
        else if (hook?.url) items.push({ command: hook.url, type: "http" });
      }
    }
  }
  return items;
}

function normalizeProvidedCopilotRecord(record) {
  const name = String(record?.name ?? "").trim();
  const installPath = record?.cache_path ?? record?.cachePath ?? record?.installPath;
  if (!name || !installPath) {
    return undefined;
  }
  const marketplaceName = record.marketplace || "_direct";
  return {
    id: `${marketplaceName}/${name}`,
    name,
    marketplaceName,
    installPath: path.resolve(expandHome(installPath)),
    version: record.version,
    enabled: record.enabled !== false,
    source: record.source?.source ?? (record.marketplace ? "marketplace" : "direct"),
    sources: [record.marketplace ? "marketplace" : "direct"],
    installMatch: record.marketplace ? "copilot-marketplace" : "copilot-direct",
    installedAt: record.installed_at ?? record.installedAt,
  };
}

async function readCopilotInstalledPluginState(options = {}) {
  if (Array.isArray(options.copilotInstalledPluginRecords) || Array.isArray(options.installedPluginRecords)) {
    const records = (options.copilotInstalledPluginRecords ?? options.installedPluginRecords)
      .map(normalizeProvidedCopilotRecord)
      .filter(Boolean);
    return { records, source: "provided", installRecordFiles: [] };
  }

  const copilotHome = path.resolve(expandHome(options.copilotHome ?? options["copilot-home"] ?? defaultCopilotHome()));
  const configPath = path.join(copilotHome, "config.json");
  const config = (await readCopilotJson(configPath)) ?? {};
  const entries = Array.isArray(config.installedPlugins) ? config.installedPlugins : [];
  const records = entries.map(normalizeProvidedCopilotRecord).filter(Boolean);
  return {
    records,
    source: records.length > 0 ? "copilot-config" : "missing",
    installRecordFiles: records.length > 0 ? [configPath] : [],
  };
}

async function collectCopilotPluginMcpItems(pluginRoot, sourceLabel, manifest) {
  const items = [];
  if (manifest?.mcpServers && typeof manifest.mcpServers === "object") {
    for (const [name, config] of Object.entries(manifest.mcpServers)) {
      if (!config || typeof config !== "object") continue;
      items.push({
        name,
        scope: "plugin",
        sourceLabel,
        command: config.command ?? null,
        args: config.args ?? [],
        evidence: evidence(path.join(pluginRoot, "plugin.json"), pluginRoot),
      });
    }
  }
  for (const candidate of [
    path.join(pluginRoot, ".mcp.json"),
    path.join(pluginRoot, ".github", "mcp.json"),
  ]) {
    if (await pathExists(candidate)) {
      items.push(...(await collectMcpFromConfig(candidate, "plugin", sourceLabel, pluginRoot)));
    }
  }
  return items;
}

async function readCopilotPluginManifest(pluginRoot) {
  for (const segments of COPILOT_PLUGIN_MANIFESTS) {
    const candidate = path.join(pluginRoot, ...segments);
    if (await pathExists(candidate)) {
      return (await readJson(candidate)) ?? {};
    }
  }
  return {};
}

function manifestPaths(manifest, key, fallback) {
  const value = manifest?.[key];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((entry) => typeof entry === "string");
  return fallback;
}

async function collectCopilotPlugin(record) {
  const pluginRoot = path.resolve(expandHome(record.installPath));
  if (!(await pathExists(pluginRoot))) {
    return null;
  }
  const metadataEvidencePath = await pluginMetadataEvidencePath(pluginRoot, COPILOT_PLUGIN_MANIFESTS);
  const manifest = await readCopilotPluginManifest(pluginRoot);
  const readme = await readText(path.join(pluginRoot, "README.md"), 6000);
  const heading = readme.match(/^#\s+(.+)$/mu)?.[1]?.trim();
  const rawDisplayName = manifest.displayName || heading || titleCase(manifest.name || record.name);
  const displayName = normalizePluginDisplayName(rawDisplayName, record.name);
  const plugin = {
    id: record.id,
    copilotPluginName: record.name,
    marketplaceName: record.marketplaceName,
    rootPath: pluginRoot,
    scope: "plugin",
    sourceLabel: displayName,
    name: manifest.name || record.name,
    displayName,
    description: manifest.description || "",
    publisher: { displayName: titleCase(record.marketplaceName) },
    version: record.version || manifest.version,
    installSources: record.sources,
    installSource: record.source,
    installMatch: record.installMatch,
    installedAt: record.installedAt,
    enabled: record.enabled,
    evidence: evidence(metadataEvidencePath, path.dirname(path.dirname(pluginRoot))),
  };

  const skillRoots = manifestPaths(manifest, "skills", ["skills"]);
  const agentRoots = manifestPaths(manifest, "agents", ["agents"]);
  const commandRoots = manifestPaths(manifest, "commands", ["commands"]);

  plugin.skills = (
    await Promise.all(
      skillRoots.map((root) => collectSkillFiles(path.resolve(pluginRoot, root), "plugin", displayName, pluginRoot)),
    )
  )
    .flat()
    .sort(sortByName);
  plugin.subagents = (
    await Promise.all(
      agentRoots.map((root) =>
        collectMarkdownItems(path.resolve(pluginRoot, root), "subagent", "plugin", displayName, pluginRoot),
      ),
    )
  )
    .flat()
    .sort(sortByName);
  plugin.commands = (
    await Promise.all(
      commandRoots.map((root) =>
        collectMarkdownItems(path.resolve(pluginRoot, root), "command", "plugin", displayName, pluginRoot),
      ),
    )
  )
    .flat()
    .sort(sortByName);
  plugin.mcpServers = await collectCopilotPluginMcpItems(pluginRoot, displayName, manifest);
  plugin.rules = [];
  plugin.hooks = await collectHookItems(pluginRoot, "plugin", displayName, pluginRoot);
  return plugin;
}

async function collectCopilotPlugins(records) {
  const plugins = [];
  for (const record of records) {
    const plugin = await collectCopilotPlugin(record);
    if (plugin) {
      plugins.push(plugin);
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

async function collectCopilotUserPrimitives(copilotHome) {
  const settingsPath = path.join(copilotHome, "settings.json");
  const settings = (await readCopilotJson(settingsPath)) ?? {};
  const mcps = [];
  const mcpConfigPath = path.join(copilotHome, "mcp-config.json");
  if (await pathExists(mcpConfigPath)) {
    mcps.push(...((await collectMcpFromConfig(mcpConfigPath, "user", "User", copilotHome)) ?? []));
  }
  if (settings.mcpServers && typeof settings.mcpServers === "object") {
    for (const [name, config] of Object.entries(settings.mcpServers)) {
      if (!config || typeof config !== "object") continue;
      if (!mcps.some((mcp) => mcp.name === name)) {
        mcps.push(normalizeSettingsMcp(name, config, "user", "User", settingsPath, copilotHome));
      }
    }
  }

  const hooks = await collectHookItems(copilotHome, "user", "User", copilotHome);
  for (const hook of flattenSettingsHooks(settings.hooks)) {
    if (!hooks.some((existing) => existing.command === hook.command)) {
      hooks.push({
        command: hook.command,
        scope: "user",
        sourceLabel: "User",
        evidence: evidence(settingsPath, copilotHome),
      });
    }
  }

  const skills = await uniqueAssetsByRealPath([
    ...(await collectSkillFiles(path.join(copilotHome, "skills"), "user", "User", copilotHome)),
    ...(await collectSkillFiles(
      path.join(path.dirname(copilotHome), ".agents", "skills"),
      "user",
      "User",
      copilotHome,
    )),
  ]);

  return {
    skills: skills.sort(sortByName),
    subagents: await collectMarkdownItems(path.join(copilotHome, "agents"), "subagent", "user", "User", copilotHome),
    rules: await collectRuleSources([
      copilotInstructionsRuleSource(
        path.join(copilotHome, "copilot-instructions.md"),
        "user",
        "User",
        copilotHome,
        "before-project-rules",
      ),
      directoryRuleSource(path.join(copilotHome, "instructions"), "user", "User", copilotHome, {
        sourceKind: "copilot-instructions",
        precedence: "before-project-rules",
      }),
    ]),
    commands: [],
    hooks,
    mcps,
  };
}

async function collectCopilotWorkspacePrimitives(workspace) {
  const sourceLabel = await workspaceSourceLabel(workspace);
  const github = path.join(workspace, ".github");

  const skills = await uniqueAssetsByRealPath([
    ...(await collectSkillFiles(path.join(github, "skills"), "project", sourceLabel, workspace)),
    ...(await collectSkillFiles(path.join(workspace, ".agents", "skills"), "project", sourceLabel, workspace)),
  ]);

  const mcps = [];
  for (const candidate of [path.join(workspace, ".mcp.json"), path.join(github, "mcp.json")]) {
    if (await pathExists(candidate)) {
      for (const mcp of (await collectMcpFromConfig(candidate, "project", sourceLabel, workspace)) ?? []) {
        if (!mcps.some((existing) => existing.name === mcp.name)) mcps.push(mcp);
      }
    }
  }

  const settingsPath = path.join(github, "copilot", "settings.json");
  const settings = (await readCopilotJson(settingsPath)) ?? {};
  const hooks = await collectHookItems(github, "project", sourceLabel, workspace);
  for (const hook of flattenSettingsHooks(settings.hooks)) {
    if (!hooks.some((existing) => existing.command === hook.command)) {
      hooks.push({
        command: hook.command,
        scope: "project",
        sourceLabel,
        evidence: evidence(settingsPath, workspace),
      });
    }
  }

  return {
    skills: skills.sort(sortByName),
    subagents: await collectMarkdownItems(path.join(github, "agents"), "subagent", "project", sourceLabel, workspace),
    rules: await collectRuleSources([
      copilotInstructionsRuleSource(
        path.join(github, "copilot-instructions.md"),
        "project",
        sourceLabel,
        workspace,
        "before-agents-md",
      ),
      directoryRuleSource(path.join(github, "instructions"), "project", sourceLabel, workspace, {
        sourceKind: "copilot-instructions",
        precedence: "before-agents-md",
      }),
      agentsMarkdownRuleSource(workspace, sourceLabel),
      designMarkdownRuleSource(workspace, sourceLabel),
    ]),
    commands: await collectMarkdownItems(path.join(github, "prompts"), "command", "project", sourceLabel, workspace),
    hooks,
    mcps,
  };
}

function emptyPrimitives() {
  return { skills: [], subagents: [], rules: [], commands: [], hooks: [], mcps: [] };
}

export async function collectCopilotCustomizeInventory(options = {}) {
  const copilotHome = path.resolve(
    expandHome(options.copilotHome ?? options["copilot-home"] ?? defaultCopilotHome()),
  );
  const workspace = normalizeWorkspace(options.workspace ?? process.cwd());
  const includeUserHome = options.includeUserHome !== false;
  const installState = includeUserHome
    ? await readCopilotInstalledPluginState({ ...options, copilotHome })
    : { records: [], source: "not-authorized", installRecordFiles: [] };
  const [plugins, user, project] = await Promise.all([
    includeUserHome ? collectCopilotPlugins(installState.records ?? []) : [],
    includeUserHome ? collectCopilotUserPrimitives(copilotHome) : emptyPrimitives(),
    collectCopilotWorkspacePrimitives(workspace),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    provider: "copilot",
    copilotHome,
    workspace,
    tabs: MANAGE_TABS,
    plugins,
    manage: buildManageCollections(plugins, user, project),
    diagnostics: {
      installedPluginState: installState.source,
      installedPluginRecordCount: plugins.length,
      installedPluginRecordFiles: installState.installRecordFiles ?? [],
      remotePluginInstallMarkersRequired: false,
    },
    unsupported: [
      "remote marketplace browse ordering",
      "remote marketplace display metadata",
      "organization and enterprise managed plugin standards",
      "remote organization and enterprise custom agents",
      "session-scoped hooks",
      "cloud MCP authentication state",
    ],
  };
}
