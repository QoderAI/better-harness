/**
 * Grok CLI configured-asset inventory.
 * Native home: GROK_HOME or ~/.grok. Project: <workspace>/.grok and .agents.
 */
import os from "node:os";
import path from "node:path";
import { readdir, realpath } from "node:fs/promises";

import { expandHome, normalizeWorkspace, pathExists } from "../../session-analysis/index.mjs";
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
  designMarkdownRuleSource,
  evidence,
  listDirectories,
  normalizePluginDisplayName,
  readJson,
  readText,
  sortByName,
  titleCase,
  workspaceSourceLabel,
} from "../core/items.mjs";

export function defaultGrokHome() {
  return process.env.GROK_HOME ?? path.join(os.homedir(), ".grok");
}

function emptyPrimitives() {
  return { skills: [], subagents: [], rules: [], commands: [], hooks: [], mcps: [] };
}

/**
 * Minimal TOML table scanner for [mcp_servers.name] / [mcp_servers."name"] blocks.
 * Does not evaluate full TOML; only extracts server identity and enabled flags.
 */
export function parseGrokMcpServersFromToml(text) {
  if (typeof text !== "string" || text.trim() === "") return [];
  const servers = [];
  const lines = text.split(/\r?\n/u);
  let current = null;
  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/u, "").trim();
    if (!line) continue;
    const header = line.match(/^\[mcp_servers\.("?)([^"\]]+)\1\]$/u);
    if (header) {
      if (current) servers.push(current);
      current = {
        name: header[2],
        enabled: true,
        hasCommand: false,
        hasUrl: false,
      };
      continue;
    }
    if (!current) continue;
    if (/^\[/u.test(line)) {
      servers.push(current);
      current = null;
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/u);
    if (!kv) continue;
    const key = kv[1];
    const value = kv[2].trim();
    if (key === "enabled") {
      current.enabled = !/^(false|0|no|off)$/iu.test(value);
    } else if (key === "command") {
      current.hasCommand = true;
    } else if (key === "url") {
      current.hasUrl = true;
    }
  }
  if (current) servers.push(current);
  return servers;
}

async function readTomlText(filePath) {
  try {
    return await readText(filePath, 256_000);
  } catch {
    return null;
  }
}

async function collectGrokMcpFromConfig(configPath, scope, sourceLabel, rootForEvidence) {
  const text = await readTomlText(configPath);
  if (!text) return [];
  const servers = parseGrokMcpServersFromToml(text);
  return servers.map((server) => ({
    id: `grok/${scope}/mcp/${server.name}`,
    name: server.name,
    scope,
    sourceLabel,
    enabled: server.enabled !== false,
    transport: server.hasUrl ? "http" : (server.hasCommand ? "stdio" : "unknown"),
    evidence: evidence(configPath, rootForEvidence),
    // Secrets in env= never serialized.
    unsupported: ["mcp env secret values"],
  })).sort(sortByName);
}

/**
 * Parse [plugins] paths/enabled/disabled from config.toml (minimal TOML).
 */
export function parseGrokPluginsSectionFromToml(text) {
  if (typeof text !== "string" || text.trim() === "") {
    return { paths: [], enabled: [], disabled: [] };
  }
  const lines = text.split(/\r?\n/u);
  let inPlugins = false;
  const result = { paths: [], enabled: [], disabled: [] };
  let multiKey = null;
  let multiBuf = "";
  const flushMulti = () => {
    if (!multiKey) return;
    const raw = multiBuf.replace(/\s+/gu, " ").trim();
    const items = [...raw.matchAll(/"([^"]+)"|'([^']+)'/gu)].map((m) => m[1] ?? m[2]);
    result[multiKey] = items;
    multiKey = null;
    multiBuf = "";
  };
  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/u, "").trim();
    if (!line) continue;
    if (/^\[plugins\]$/u.test(line)) {
      flushMulti();
      inPlugins = true;
      continue;
    }
    if (/^\[/u.test(line)) {
      flushMulti();
      inPlugins = false;
      continue;
    }
    if (!inPlugins) continue;
    if (multiKey) {
      multiBuf += ` ${line}`;
      if (line.includes("]")) flushMulti();
      continue;
    }
    const kv = line.match(/^(paths|enabled|disabled)\s*=\s*(.+)$/u);
    if (!kv) continue;
    const key = kv[1];
    const value = kv[2].trim();
    if (value.startsWith("[") && !value.includes("]")) {
      multiKey = key;
      multiBuf = value;
      continue;
    }
    const items = [...value.matchAll(/"([^"]+)"|'([^']+)'/gu)].map((m) => m[1] ?? m[2]);
    result[key] = items;
  }
  flushMulti();
  return result;
}

async function collectPluginsFromRoot(pluginsRoot, installMatch, enabledSet, disabledSet) {
  if (!(await pathExists(pluginsRoot))) return [];
  const plugins = [];
  for (const pluginRoot of await listDirectories(pluginsRoot)) {
    const name = path.basename(pluginRoot);
    const manifestCandidates = [
      path.join(pluginRoot, "plugin.json"),
      path.join(pluginRoot, ".claude-plugin", "plugin.json"),
      path.join(pluginRoot, ".grok-plugin", "plugin.json"),
    ];
    let manifest = null;
    let manifestPath = null;
    for (const candidate of manifestCandidates) {
      manifest = await readJson(candidate);
      if (manifest) {
        manifestPath = candidate;
        break;
      }
    }
    const pluginName = manifest?.name || name;
    const displayName = normalizePluginDisplayName(
      manifest?.displayName || pluginName || titleCase(name),
      name,
    );
    // Grok: plugins are off by default unless listed in enabled (or no lists at all → discover as enabled for trusted user roots).
    let enabled = true;
    if (enabledSet.size > 0 || disabledSet.size > 0) {
      enabled = enabledSet.has(pluginName) || enabledSet.has(name);
      if (disabledSet.has(pluginName) || disabledSet.has(name)) enabled = false;
      if (enabledSet.size === 0 && disabledSet.size > 0) {
        enabled = !(disabledSet.has(pluginName) || disabledSet.has(name));
      }
    }
    const plugin = {
      id: `grok/${installMatch}/${name}`,
      rootPath: pluginRoot,
      scope: "plugin",
      sourceLabel: displayName,
      name: pluginName,
      displayName,
      description: manifest?.description || "",
      installSources: [installMatch],
      installSource: installMatch,
      installMatch,
      installType: "local",
      enabled,
      evidence: evidence(manifestPath ?? pluginRoot, path.dirname(pluginRoot)),
    };
    plugin.skills = (await collectSkillFiles(pluginRoot, "plugin", displayName, pluginRoot)).sort(sortByName);
    plugin.commands = await collectMarkdownItems(
      path.join(pluginRoot, "commands"),
      "command",
      "plugin",
      displayName,
      pluginRoot,
    );
    plugin.rules = [];
    plugin.subagents = [];
    plugin.hooks = await collectHookItems(pluginRoot, "plugin", displayName, pluginRoot);
    plugin.mcpServers = await collectMcpItems(pluginRoot, "plugin", displayName, pluginRoot);
    plugins.push(plugin);
  }
  return plugins;
}

/**
 * Union the [plugins] tables of several config files. Repeated keys across
 * files add entries instead of replacing them, so a project config cannot
 * silently drop user-declared plugin paths.
 */
export function mergeGrokPluginsSections(sections) {
  const merged = { paths: [], enabled: [], disabled: [] };
  for (const section of sections) {
    if (!section) continue;
    for (const key of ["paths", "enabled", "disabled"]) {
      for (const value of section[key] ?? []) {
        if (!merged[key].includes(value)) merged[key].push(value);
      }
    }
  }
  return merged;
}

async function collectGrokPlugins(grokHome, workspace, section, { includeUserHome = true } = {}) {
  const enabledSet = new Set(section.enabled);
  const disabledSet = new Set(section.disabled);
  const grokHomeReal = await resolveRealPath(grokHome);
  const projectPluginsRoot = path.join(workspace, ".grok", "plugins");
  const projectIsUserHome = (await resolveRealPath(path.join(workspace, ".grok"))) === grokHomeReal;

  const roots = [];
  if (includeUserHome) {
    roots.push(
      { root: path.join(grokHome, "plugins"), match: "grok-plugins-dir" },
      { root: path.join(grokHome, "installed-plugins"), match: "grok-installed-plugins-dir" },
    );
    for (const extra of section.paths) {
      roots.push({ root: path.resolve(expandHome(extra)), match: "grok-plugins-path-config" });
    }
  }
  // Project plugins only when they are not the same physical tree as the user home.
  if (!projectIsUserHome) {
    roots.push({ root: projectPluginsRoot, match: "grok-project-plugins-dir" });
  }

  // Dedupe physical plugin directories; merge discovery roots into installSources.
  const byRealRoot = new Map();
  const recordFiles = [];
  const seenRecordRoots = new Set();
  for (const { root, match } of roots) {
    if (!(await pathExists(root))) continue;
    const realScanRoot = await resolveRealPath(root);
    if (!seenRecordRoots.has(realScanRoot)) {
      seenRecordRoots.add(realScanRoot);
      recordFiles.push(root);
    }
    for (const plugin of await collectPluginsFromRoot(root, match, enabledSet, disabledSet)) {
      const realPluginRoot = await resolveRealPath(plugin.rootPath);
      const existing = byRealRoot.get(realPluginRoot);
      if (!existing) {
        // Keep the discovery-root qualified id so two different plugin roots
        // that share a directory name stay distinguishable downstream.
        byRealRoot.set(realPluginRoot, {
          ...plugin,
          installSources: [match],
          installSource: match,
          installMatch: match,
        });
        continue;
      }
      const sources = new Set([...(existing.installSources ?? [existing.installMatch]), match]);
      existing.installSources = [...sources].sort();
      // Prefer the first discovered match as primary installMatch; require enabled in all sightings.
      existing.enabled = existing.enabled && plugin.enabled;
    }
  }
  return {
    plugins: [...byRealRoot.values()].sort(sortByName),
    recordFiles: [...new Set(recordFiles)],
  };
}

async function collectGrokUserPrimitives(grokHome) {
  const configPath = path.join(grokHome, "config.toml");
  const agentsSkillsHome = path.join(os.homedir(), ".agents", "skills");
  const [skills, bundledSkills, agentsSkills, commands, hooks, mcps] = await Promise.all([
    collectSkillFiles(path.join(grokHome, "skills"), "user", "User", grokHome),
    collectSkillFiles(path.join(grokHome, "bundled", "skills"), "user", "User bundled", grokHome),
    // Grok also loads ~/.agents/skills (often linked under ~/.grok/skills).
    collectSkillFiles(agentsSkillsHome, "user", "User agents", agentsSkillsHome),
    collectMarkdownItems(path.join(grokHome, "commands"), "command", "user", "User", grokHome),
    collectHookItems(grokHome, "user", "User", grokHome),
    collectGrokMcpFromConfig(configPath, "user", "User", grokHome),
  ]);
  // Dedupe skills that appear both under ~/.grok/skills and ~/.agents/skills via symlink.
  const byReal = new Map();
  for (const skill of [...skills, ...bundledSkills, ...agentsSkills]) {
    const filePath = skill?.filePath ?? skill?.path;
    if (!filePath) continue;
    const key = await resolveRealPath(filePath);
    if (!byReal.has(key)) byReal.set(key, skill);
  }
  return {
    skills: [...byReal.values()].sort(sortByName),
    subagents: [],
    rules: [],
    commands,
    hooks,
    mcps,
  };
}

async function resolveRealPath(filePath) {
  try {
    return await realpath(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

/**
 * Merge project skills from `.grok/skills` and `.agents/skills`.
 * When `.grok/skills` is a symlink to `.agents/skills` (OnMyAgent layout), keep
 * a single entry and prefer the `.agents` SoT path for evidence/owner routes.
 */
export async function mergeGrokProjectSkills(skills, workspace) {
  const agentsRoot = path.resolve(workspace, ".agents", "skills");
  const byReal = new Map();
  for (const skill of skills) {
    const filePath = skill?.filePath ?? skill?.path;
    if (!filePath) continue;
    const key = await resolveRealPath(filePath);
    const existing = byReal.get(key);
    if (!existing) {
      byReal.set(key, skill);
      continue;
    }
    const existingPath = existing.filePath ?? existing.path ?? "";
    const preferAgents =
      String(filePath).startsWith(agentsRoot)
      && !String(existingPath).startsWith(agentsRoot);
    if (preferAgents) byReal.set(key, skill);
  }
  return [...byReal.values()].sort(sortByName);
}

async function collectGrokWorkspacePrimitives(workspace, grokHome) {
  const sourceLabel = await workspaceSourceLabel(workspace);
  const projectRoot = path.join(workspace, ".grok");
  // When workspace is the user home, workspace/.grok === ~/.grok — do not
  // double-count the same tree as both user and project scope.
  const projectIsUserHome = (await resolveRealPath(projectRoot)) === (await resolveRealPath(grokHome));
  const project = projectIsUserHome
    ? emptyPrimitives()
    : await collectWorkspaceRootPrimitives(projectRoot, sourceLabel, workspace);
  const agentsProjectRoot = path.join(workspace, ".agents", "skills");
  const agentsUserRoot = path.join(os.homedir(), ".agents", "skills");
  const agentsIsUserHome = (await resolveRealPath(agentsProjectRoot))
    === (await resolveRealPath(agentsUserRoot));
  const agentsSkills = agentsIsUserHome
    ? []
    : await collectSkillFiles(agentsProjectRoot, "project", sourceLabel, workspace);
  const projectConfigMcps = projectIsUserHome
    ? []
    : await collectGrokMcpFromConfig(
      path.join(projectRoot, "config.toml"),
      "project",
      sourceLabel,
      workspace,
    );
  const projectMcps = await collectMcpItems(workspace, "project", sourceLabel, workspace);
  // Project hooks under .grok/hooks (collectWorkspaceRootPrimitives may already cover hooks).
  return {
    ...project,
    skills: await mergeGrokProjectSkills([...project.skills, ...agentsSkills], workspace),
    mcps: [...project.mcps, ...projectConfigMcps, ...projectMcps].sort(sortByName),
    rules: [
      ...project.rules,
      ...(await collectRuleSources([
        agentsMarkdownRuleSource(workspace, sourceLabel),
        designMarkdownRuleSource(workspace, sourceLabel),
      ])),
    ],
  };
}

export async function collectGrokCustomizeInventory(options = {}) {
  const grokHome = path.resolve(expandHome(
    options.grokHome ?? options["grok-home"] ?? defaultGrokHome(),
  ));
  const workspace = normalizeWorkspace(options.workspace ?? process.cwd());
  const includeUserHome = options.includeUserHome !== false;
  const configPath = path.join(grokHome, "config.toml");
  const projectConfigPath = path.join(workspace, ".grok", "config.toml");
  // Project config may declare plugins/MCP independently of the user home.
  const userConfigText = includeUserHome ? await readTomlText(configPath) : null;
  const projectConfigText = await readTomlText(projectConfigPath);
  // Union the user and project [plugins] tables so project enabled/disabled
  // lists apply without discarding user-declared paths.
  const pluginSection = mergeGrokPluginsSections([
    parseGrokPluginsSectionFromToml(userConfigText ?? ""),
    parseGrokPluginsSectionFromToml(projectConfigText ?? ""),
  ]);
  const [pluginPack, user, project] = await Promise.all([
    collectGrokPlugins(grokHome, workspace, pluginSection, { includeUserHome }),
    includeUserHome ? collectGrokUserPrimitives(grokHome) : emptyPrimitives(),
    collectGrokWorkspacePrimitives(workspace, grokHome),
  ]);
  const plugins = pluginPack.plugins;
  return {
    generatedAt: new Date().toISOString(),
    provider: "grok",
    grokHome,
    workspace,
    tabs: MANAGE_TABS,
    plugins,
    manage: buildManageCollections(plugins, user, project),
    diagnostics: {
      installedPluginState: plugins.length > 0 ? "grok-plugins-dirs" : "missing",
      installedPluginRecordCount: plugins.length,
      // recordFiles already scoped by includeUserHome inside collectGrokPlugins.
      installedPluginRecordFiles: pluginPack.recordFiles,
      remotePluginInstallMarkersRequired: false,
      // configPath always names the user config; null when the user home is out of scope.
      configPath: includeUserHome ? configPath : null,
      projectConfigPath,
    },
    unsupported: [
      "auth.json credentials (never inventoried as values)",
      "MCP env secret values from config.toml",
      "marketplace-cache catalog entries without install",
      "runtime plugin trust state beyond enabled inventory",
      "plugin enablement/trust precedence is filesystem-presence approximation when no enabled/disabled lists are declared",
    ],
  };
}
