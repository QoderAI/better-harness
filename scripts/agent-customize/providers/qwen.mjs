import { realpathSync } from "node:fs";
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
  normalizePluginDisplayName,
  pluginMetadataEvidencePath,
  readJson,
  readText,
  sortByName,
  titleCase,
  workspaceSourceLabel,
} from "../core/items.mjs";

const QWEN_EXTENSION_MANIFEST = ["qwen-extension.json"];
const QWEN_EXTENSION_INSTALL_FILE = ".qwen-extension-install.json";
const QWEN_EXTENSION_ENABLEMENT_FILE = "extension-enablement.json";

function defaultQwenHome() {
  return process.env.QWEN_HOME ?? path.join(os.homedir(), ".qwen");
}

function ensureLeadingAndTrailingSlash(dirPath) {
  let result = dirPath.replace(/\\/g, "/");
  if (result.charAt(0) !== "/") result = "/" + result;
  if (result.charAt(result.length - 1) !== "/") result = result + "/";
  return result;
}

function overrideMatchesPath(rule, checkPath) {
  const isDisable = rule.startsWith("!");
  let base = isDisable ? rule.substring(1) : rule;
  const includeSubdirs = base.endsWith("*");
  if (includeSubdirs) base = base.substring(0, base.length - 1);
  base = ensureLeadingAndTrailingSlash(base);
  const glob = `${base}${includeSubdirs ? "*" : ""}`;
  const regexString = glob
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/(\/?)\*/g, "($1.*)?");
  return new RegExp(`^${regexString}$`).test(checkPath);
}

function isExtensionEnabled(enablementConfig, extensionName, workspace) {
  const extensionConfig = enablementConfig?.[extensionName];
  let enabled = true;
  const allOverrides = extensionConfig?.overrides ?? [];
  const lexicalPath = ensureLeadingAndTrailingSlash(workspace);
  let canonicalPath = lexicalPath;
  try { canonicalPath = ensureLeadingAndTrailingSlash(realpathSync.native(path.resolve(workspace))); } catch {}
  for (const rule of allOverrides) {
    if (overrideMatchesPath(rule, lexicalPath) || overrideMatchesPath(rule, canonicalPath)) {
      enabled = !rule.startsWith("!");
    }
  }
  return enabled;
}

function flattenSettingsHooks(settingsHooks) {
  if (!settingsHooks || typeof settingsHooks !== "object" || Array.isArray(settingsHooks)) return [];
  const items = [];
  for (const [, definitions] of Object.entries(settingsHooks)) {
    if (!Array.isArray(definitions)) continue;
    for (const def of definitions) {
      if (!Array.isArray(def?.hooks)) continue;
      for (const hook of def.hooks) {
        if (hook?.command) items.push({ command: hook.command, type: hook.type ?? "command" });
        else if (hook?.url) items.push({ command: hook.url, type: "http" });
      }
    }
  }
  return items;
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

function qwenMarkdownRuleSource(workspace, sourceLabel, precedence = "after-provider-rules") {
  return {
    type: "file",
    filePath: path.join(workspace, "QWEN.md"),
    scope: "project",
    sourceLabel,
    rootForEvidence: workspace,
    name: "QWEN.md",
    sourceKind: "qwen-md-context",
    precedence,
    useHeading: true,
  };
}

function normalizeProvidedQwenRecord(record) {
  const id = String(record?.id ?? record?.name ?? "").trim();
  const installPath = record?.installPath ?? record?.source;
  if (!id || !installPath) {
    return undefined;
  }
  return {
    id,
    name: record.name ?? id,
    marketplaceName: record.marketplaceName ?? "qwen",
    installPath: path.resolve(expandHome(installPath)),
    installMarkerPath: record.installMarkerPath,
    version: record.version,
    sources: Array.isArray(record.sources) ? record.sources : [record.source ?? "user"],
    source: record.source ?? "user",
    installMatch: record.installMatch ?? "provided",
    type: record.type ?? "link",
    enablementConfig: record.enablementConfig ?? null,
  };
}

async function readQwenInstalledPluginState(options = {}) {
  if (Array.isArray(options.qwenInstalledPluginRecords) || Array.isArray(options.installedPluginRecords)) {
    const records = (options.qwenInstalledPluginRecords ?? options.installedPluginRecords)
      .map(normalizeProvidedQwenRecord)
      .filter(Boolean);
    return { records, source: "provided", installRecordFiles: [] };
  }

  const qwenHome = path.resolve(expandHome(options.qwenHome ?? options["qwen-home"] ?? defaultQwenHome()));
  const extensionsRoot = path.join(qwenHome, "extensions");
  const enablementPath = path.join(extensionsRoot, QWEN_EXTENSION_ENABLEMENT_FILE);
  const enablement = (await readJson(enablementPath)) ?? {};
  const records = [];
  const installRecordFiles = [];
  for (const extensionDir of await listDirectories(extensionsRoot)) {
    const name = path.basename(extensionDir);
    const installMarkerPath = path.join(extensionDir, QWEN_EXTENSION_INSTALL_FILE);
    if (!(await pathExists(installMarkerPath))) {
      continue;
    }
    installRecordFiles.push(installMarkerPath);
    const installMarker = (await readJson(installMarkerPath)) ?? {};
    records.push({
      id: `qwen/${name}`,
      name,
      marketplaceName: "qwen",
      installPath: installMarker.source ?? extensionDir,
      installMarkerPath,
      version: installMarker.version,
      sources: ["user"],
      source: installMarker.originSource ?? "user",
      installMatch: "qwen-extension-install",
      type: installMarker.type ?? "link",
      enablementConfig: enablement,
    });
  }
  return {
    records,
    source: records.length > 0 ? "qwen-extensions" : "missing",
    installRecordFiles,
  };
}

async function collectQwenPluginMcpItems(pluginRoot, sourceLabel, manifest) {
  const items = [];
  if (manifest?.mcpServers && typeof manifest.mcpServers === "object") {
    for (const [name, config] of Object.entries(manifest.mcpServers)) {
      items.push({
        name,
        scope: "plugin",
        sourceLabel,
        command: config.command ?? null,
        args: config.args ?? [],
        evidence: evidence(path.join(pluginRoot, "qwen-extension.json"), pluginRoot),
      });
    }
  }
  for (const candidate of [path.join(pluginRoot, ".mcp.json"), path.join(pluginRoot, "mcp.json")]) {
    if (await pathExists(candidate)) {
      items.push(...(await collectMcpFromConfig(candidate, "plugin", sourceLabel, pluginRoot)));
    }
  }
  return items;
}

async function collectQwenPlugin(record, workspace) {
  const pluginRoot = path.resolve(expandHome(record.installPath));
  if (!(await pathExists(pluginRoot))) {
    return null;
  }
  const metadataEvidencePath = await pluginMetadataEvidencePath(pluginRoot, [QWEN_EXTENSION_MANIFEST, ["package.json"]]);
  const manifest = (await readJson(path.join(pluginRoot, ...QWEN_EXTENSION_MANIFEST))) ?? {};
  const packageJson = (await readJson(path.join(pluginRoot, "package.json"))) ?? {};
  const readme = await readText(path.join(pluginRoot, "README.md"), 6000);
  const heading = readme.match(/^#\s+(.+)$/mu)?.[1]?.trim();
  const rawDisplayName =
    manifest.displayName ||
    packageJson.displayName ||
    heading ||
    titleCase(manifest.name || packageJson.name || record.name);
  const displayName = normalizePluginDisplayName(rawDisplayName, record.name);
  const enabled = isExtensionEnabled(record.enablementConfig, record.name, workspace);
  const plugin = {
    id: record.id,
    qwenExtensionId: record.name,
    marketplaceName: record.marketplaceName,
    rootPath: pluginRoot,
    scope: "plugin",
    sourceLabel: displayName,
    name: manifest.name || packageJson.name || record.name,
    displayName,
    description: manifest.description || packageJson.description || "",
    publisher: { displayName: titleCase(record.marketplaceName) },
    version: record.version || manifest.version || packageJson.version,
    installSources: record.sources,
    installSource: record.source,
    installMatch: record.installMatch,
    installType: record.type,
    installRecordPath: record.installMarkerPath,
    enabled,
    evidence: evidence(metadataEvidencePath, path.dirname(path.dirname(pluginRoot))),
  };
  plugin.skills = await collectSkillFiles(path.join(pluginRoot, "skills"), "plugin", displayName, pluginRoot);
  plugin.mcpServers = await collectQwenPluginMcpItems(pluginRoot, displayName, manifest);
  plugin.rules = await collectRuleSources([
    directoryRuleSource(path.join(pluginRoot, "rules"), "plugin", displayName, pluginRoot),
  ]);
  plugin.commands = await collectMarkdownItems(path.join(pluginRoot, "commands"), "command", "plugin", displayName, pluginRoot);
  plugin.subagents = [
    ...(await collectMarkdownItems(path.join(pluginRoot, "agents"), "subagent", "plugin", displayName, pluginRoot)),
    ...(await collectMarkdownItems(path.join(pluginRoot, "subagents"), "subagent", "plugin", displayName, pluginRoot)),
  ].sort(sortByName);
  plugin.hooks = await collectHookItems(pluginRoot, "plugin", displayName, pluginRoot);
  return plugin;
}

async function collectQwenPlugins(records, workspace) {
  const plugins = [];
  for (const record of records) {
    const plugin = await collectQwenPlugin(record, workspace);
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

async function collectQwenUserPrimitives(qwenHome) {
  const settingsPath = path.join(qwenHome, "settings.json");
  const settings = (await readJson(settingsPath)) ?? {};
  const mcps = [];
  if (settings.mcpServers && typeof settings.mcpServers === "object") {
    for (const [name, config] of Object.entries(settings.mcpServers)) {
      mcps.push(normalizeSettingsMcp(name, config, "user", "User", settingsPath, qwenHome));
    }
  }
  const hooks = await collectHookItems(qwenHome, "user", "User", qwenHome);
  for (const hook of flattenSettingsHooks(settings.hooks)) {
    if (!hooks.some((h) => h.command === hook.command)) {
      hooks.push({
        command: hook.command,
        scope: "user",
        sourceLabel: "User",
        evidence: evidence(settingsPath, qwenHome),
      });
    }
  }
  return {
    skills: await collectSkillFiles(path.join(qwenHome, "skills"), "user", "User", qwenHome),
    subagents: await collectMarkdownItems(path.join(qwenHome, "agents"), "subagent", "user", "User", qwenHome),
    rules: await collectRuleSources([directoryRuleSource(path.join(qwenHome, "rules"), "user", "User", qwenHome)]),
    commands: await collectMarkdownItems(path.join(qwenHome, "commands"), "command", "user", "User", qwenHome),
    hooks,
    mcps,
  };
}

async function collectQwenWorkspacePrimitives(workspace) {
  const sourceLabel = await workspaceSourceLabel(workspace);
  const project = await collectWorkspaceRootPrimitives(path.join(workspace, ".qwen"), sourceLabel, workspace);
  const projectMcpPath = path.join(workspace, ".mcp.json");
  if (await pathExists(projectMcpPath)) {
    const projectMcps = (await collectMcpFromConfig(projectMcpPath, "project", sourceLabel, workspace)) ?? [];
    for (const mcp of projectMcps) {
      if (!project.mcps.some((m) => m.name === mcp.name)) project.mcps.push(mcp);
    }
  }
  const settingsPath = path.join(workspace, ".qwen", "settings.json");
  const settings = (await readJson(settingsPath)) ?? {};
  if (settings.mcpServers && typeof settings.mcpServers === "object") {
    for (const [name, config] of Object.entries(settings.mcpServers)) {
      if (!project.mcps.some((m) => m.name === name)) {
        project.mcps.push(normalizeSettingsMcp(name, config, "project", sourceLabel, settingsPath, workspace));
      }
    }
  }
  for (const hook of flattenSettingsHooks(settings.hooks)) {
    if (!project.hooks.some((h) => h.command === hook.command)) {
      project.hooks.push({
        command: hook.command,
        scope: "project",
        sourceLabel,
        evidence: evidence(settingsPath, workspace),
      });
    }
  }
  return {
    ...project,
    rules: [
      ...project.rules,
      ...(await collectRuleSources([
        qwenMarkdownRuleSource(workspace, sourceLabel),
        agentsMarkdownRuleSource(workspace, sourceLabel),
        designMarkdownRuleSource(workspace, sourceLabel),
      ])),
    ],
  };
}

function emptyPrimitives() {
  return { skills: [], subagents: [], rules: [], commands: [], hooks: [], mcps: [] };
}

export async function collectQwenCustomizeInventory(options = {}) {
  const qwenHome = path.resolve(expandHome(options.qwenHome ?? options["qwen-home"] ?? defaultQwenHome()));
  const workspace = normalizeWorkspace(options.workspace ?? process.cwd());
  const includeUserHome = options.includeUserHome !== false;
  const installState = includeUserHome
    ? await readQwenInstalledPluginState({ ...options, qwenHome })
    : { records: [], source: "not-authorized", installRecordFiles: [] };
  const [plugins, user, project] = await Promise.all([
    includeUserHome ? collectQwenPlugins(installState.records ?? [], workspace) : [],
    includeUserHome ? collectQwenUserPrimitives(qwenHome) : emptyPrimitives(),
    collectQwenWorkspacePrimitives(workspace),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    provider: "qwen",
    qwenHome,
    workspace,
    tabs: MANAGE_TABS,
    plugins,
    manage: buildManageCollections(plugins, user, project),
    diagnostics: {
      installedPluginState: installState.source,
      installedPluginRecordCount: plugins.length,
      installedPluginRecordFiles: installState.installRecordFiles ?? [],
      remotePluginInstallMarkersRequired: true,
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
