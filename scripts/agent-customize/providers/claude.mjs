import { realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expandHome, normalizeWorkspace, pathExists, pathStat } from "../../session-analysis/index.mjs";
import { MANAGE_TABS } from "../constants.mjs";
import {
  buildManageCollections,
  collectHooksFromConfig,
  collectHooksFromFile,
  collectMarkdownFileRuleItem,
  collectMarkdownItems,
  collectMarkdownRuleItems,
  collectMcpFromConfig,
  collectMcpFromValue,
  collectSkillFiles,
  evidence,
  normalizePluginDisplayName,
  pathInsideRoot,
  pluginMetadataEvidencePath,
  pluginPathValues,
  readJson,
  readText,
  sanitizeMcpItems,
  sortByName,
  titleCase,
  uniqueAssetsByRealPath,
  workspaceSourceLabel,
} from "../core/items.mjs";

const CLAUDE_PLUGIN_MANIFEST = [".claude-plugin", "plugin.json"];
const CLAUDE_HOOK_OPTIONS = Object.freeze({
  timeoutUnit: "seconds",
  projectDirVariables: ["CLAUDE_PROJECT_DIR"],
  includeCommand: false,
});

function defaultClaudeHome() {
  return process.env.CLAUDE_CONFIG_DIR
    ? path.resolve(expandHome(process.env.CLAUDE_CONFIG_DIR))
    : path.join(os.homedir(), ".claude");
}

function resolveClaudeHome(options = {}) {
  return path.resolve(expandHome(options.claudeHome ?? options["claude-home"] ?? defaultClaudeHome()));
}

function resolveClaudeStatePath(options, claudeHome) {
  const explicit = options.claudeStatePath ?? options["claude-state"] ?? options["claude-state-path"];
  if (explicit) return path.resolve(expandHome(explicit));
  if (process.env.CLAUDE_CONFIG_DIR && path.resolve(expandHome(process.env.CLAUDE_CONFIG_DIR)) === claudeHome) {
    return path.join(claudeHome, ".claude.json");
  }
  return path.join(os.homedir(), ".claude.json");
}

function emptyPrimitives() {
  return { skills: [], subagents: [], rules: [], commands: [], hooks: [], mcps: [] };
}

function pluginKey(value) {
  const id = String(value ?? "").trim();
  const separator = id.lastIndexOf("@");
  return {
    id,
    name: separator > 0 ? id.slice(0, separator) : id,
    marketplaceName: separator > 0 ? id.slice(separator + 1) : "local",
  };
}

function normalizeInstallScope(value) {
  const scope = String(value ?? "user").trim().toLowerCase();
  if (scope === "workspace") return "project";
  return scope || "unknown";
}

async function pathsReferToSameRoot(left, right) {
  const [resolvedLeft, resolvedRight] = await Promise.all([
    realpath(path.resolve(left)).catch(() => path.resolve(left)),
    realpath(path.resolve(right)).catch(() => path.resolve(right)),
  ]);
  return path.relative(resolvedLeft, resolvedRight) === "";
}

async function canonicalPathInsideRoot(root, candidate) {
  if (!root || !candidate || !(await pathExists(candidate))) return false;
  let realRoot;
  let realCandidate;
  try {
    [realRoot, realCandidate] = await Promise.all([
      realpath(path.resolve(root)),
      realpath(path.resolve(candidate)),
    ]);
  } catch {
    return false;
  }
  const relative = path.relative(realRoot, realCandidate);
  return relative === ""
    || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function componentRoots(pluginRoot, manifest, key, fallback, options = {}) {
  const declared = pluginPathValues(manifest?.[key]);
  const requested = options.addDefault
    ? [fallback, ...declared]
    : Object.hasOwn(manifest ?? {}, key)
      ? declared
      : [fallback];
  const roots = [];
  for (const value of requested.filter(Boolean)) {
    const candidate = await pathInsideRoot(pluginRoot, value);
    if (candidate && !roots.includes(candidate)) roots.push(candidate);
  }
  return roots;
}

async function collectSkillsFromRoots(roots, scope, sourceLabel, rootForEvidence) {
  return uniqueAssetsByRealPath((await Promise.all(
    roots.map((root) => collectSkillFiles(root, scope, sourceLabel, rootForEvidence)),
  )).flat());
}

async function collectMarkdownFromRoots(roots, kind, scope, sourceLabel, rootForEvidence) {
  return uniqueAssetsByRealPath((await Promise.all(
    roots.map((root) => collectMarkdownItems(root, kind, scope, sourceLabel, rootForEvidence)),
  )).flat());
}

async function collectClaudeHooks(files, scope, sourceLabel, rootForEvidence, options = {}) {
  const items = [];
  for (const filePath of files) {
    if (!(await pathExists(filePath))) continue;
    items.push(...await collectHooksFromFile(filePath, scope, sourceLabel, rootForEvidence, {
      ...CLAUDE_HOOK_OPTIONS,
      ...options,
    }));
  }
  return items.sort(sortByName);
}

async function collectUserRules(claudeHome) {
  return [
    ...await collectMarkdownFileRuleItem(
      path.join(claudeHome, "CLAUDE.md"),
      "user",
      "User",
      claudeHome,
      { name: "CLAUDE.md", sourceKind: "claude-global", precedence: "claude-user" },
    ),
    ...await collectMarkdownRuleItems(
      path.join(claudeHome, "rules"),
      "user",
      "User",
      claudeHome,
      { sourceKind: "claude-rule", precedence: "claude-user-rules" },
    ),
  ];
}

async function collectProjectRules(workspace, sourceLabel, claudeRoot = path.join(workspace, ".claude")) {
  const fileDefinitions = [
    [path.join(workspace, "CLAUDE.md"), "CLAUDE.md", "claude-project", "claude-project"],
    [
      path.join(claudeRoot, "CLAUDE.md"),
      path.relative(workspace, path.join(claudeRoot, "CLAUDE.md")).split(path.sep).join("/") || "CLAUDE.md",
      "claude-project",
      "claude-project",
    ],
    [path.join(workspace, "CLAUDE.local.md"), "CLAUDE.local.md", "claude-local", "claude-local"],
  ];
  const files = [];
  const visited = new Set();
  for (const [filePath, name, sourceKind, precedence] of fileDefinitions) {
    if (visited.has(filePath)) continue;
    visited.add(filePath);
    files.push(...await collectMarkdownFileRuleItem(filePath, "project", sourceLabel, workspace, {
      name,
      sourceKind,
      precedence,
    }));
  }
  return [
    ...files,
    ...await collectMarkdownRuleItems(
      path.join(claudeRoot, "rules"),
      "project",
      sourceLabel,
      workspace,
      { sourceKind: "claude-rule", precedence: "claude-project-rules" },
    ),
  ];
}

async function collectStateMcp(state, selector, filePath, scope, sourceLabel, rootForEvidence) {
  const servers = selector(state);
  return sanitizeMcpItems(collectMcpFromValue(servers, scope, sourceLabel, filePath, rootForEvidence));
}

function projectState(state, workspace) {
  const projects = state?.projects;
  if (!projects || typeof projects !== "object" || Array.isArray(projects)) return undefined;
  if (projects[workspace]) return projects[workspace];
  return Object.entries(projects).find(([candidate]) => {
    try {
      return normalizeWorkspace(candidate) === workspace;
    } catch {
      return false;
    }
  })?.[1];
}

async function collectClaudeUserPrimitives(claudeHome, statePath, state, workspace) {
  return {
    skills: await collectSkillFiles(path.join(claudeHome, "skills"), "user", "User", claudeHome),
    subagents: await collectMarkdownItems(path.join(claudeHome, "agents"), "subagent", "user", "User", claudeHome),
    rules: await collectUserRules(claudeHome),
    commands: await collectMarkdownItems(path.join(claudeHome, "commands"), "command", "user", "User", claudeHome),
    hooks: await collectClaudeHooks([path.join(claudeHome, "settings.json")], "user", "User", claudeHome, {
      projectDirRoot: workspace,
      scriptRoots: [workspace, claudeHome],
    }),
    mcps: await collectStateMcp(state, (value) => value?.mcpServers, statePath, "user", "User", claudeHome),
  };
}

async function collectClaudeWorkspacePrimitives(
  workspace,
  statePath,
  state,
  includeState,
  claudeRoot = path.join(workspace, ".claude"),
) {
  const sourceLabel = await workspaceSourceLabel(workspace);
  const stateMcps = includeState
    ? await collectStateMcp(
        state,
        (value) => projectState(value, workspace)?.mcpServers,
        statePath,
        "project",
        sourceLabel,
        workspace,
      )
    : [];
  const projectMcps = await collectMcpFromConfig(path.join(workspace, ".mcp.json"), "project", sourceLabel, workspace);
  return {
    skills: await collectSkillFiles(path.join(claudeRoot, "skills"), "project", sourceLabel, workspace),
    subagents: await collectMarkdownItems(path.join(claudeRoot, "agents"), "subagent", "project", sourceLabel, workspace),
    rules: await collectProjectRules(workspace, sourceLabel, claudeRoot),
    commands: await collectMarkdownItems(path.join(claudeRoot, "commands"), "command", "project", sourceLabel, workspace),
    hooks: await collectClaudeHooks(
      [path.join(claudeRoot, "settings.json"), path.join(claudeRoot, "settings.local.json")],
      "project",
      sourceLabel,
      workspace,
      { projectDirRoot: workspace, scriptRoots: [workspace] },
    ),
    mcps: sanitizeMcpItems([...projectMcps, ...stateMcps]).sort(sortByName),
  };
}

function enabledPluginMap(settings) {
  const value = settings?.enabledPlugins;
  return value && typeof value === "object" && !Array.isArray(value)
    ? new Map(Object.entries(value).map(([key, enabled]) => [key, enabled !== false]))
    : new Map();
}

async function readClaudeSettings(claudeHome, workspace, includeUserHome, workspaceIsClaudeHome) {
  const projectRoot = workspaceIsClaudeHome ? workspace : path.join(workspace, ".claude");
  const [user, project, local] = await Promise.all([
    includeUserHome && !workspaceIsClaudeHome ? readJson(path.join(claudeHome, "settings.json")) : undefined,
    readJson(path.join(projectRoot, "settings.json")),
    readJson(path.join(projectRoot, "settings.local.json")),
  ]);
  return {
    user: enabledPluginMap(user),
    project: enabledPluginMap(project),
    local: enabledPluginMap(local),
  };
}

function pluginSetting(id, settings) {
  for (const scope of ["local", "project", "user"]) {
    if (settings[scope].has(id)) return { scope, enabled: settings[scope].get(id) };
  }
  return undefined;
}

function pluginApplicable(record, workspace, settings, id) {
  const scope = normalizeInstallScope(record.scope);
  if (scope === "user") return true;
  if (!settings[scope]) return true;
  if (record.projectPath) return normalizeWorkspace(record.projectPath) === workspace;
  return settings[scope].get(id) === true;
}

function normalizeProvidedRecord(id, record, index) {
  const key = pluginKey(id ?? record?.id);
  const installPath = record?.installPath ? path.resolve(expandHome(record.installPath)) : undefined;
  if (!key.id || !installPath) return undefined;
  return {
    ...key,
    recordId: index === 0 ? key.id : `${key.id}#${index}`,
    installPath,
    version: record?.version,
    installedAt: record?.installedAt,
    scope: record?.scope ?? "user",
    projectPath: record?.projectPath,
  };
}

async function readClaudeInstalledPluginState(claudeHome, options = {}) {
  const provided = options.claudeInstalledPluginRecords ?? options.installedPluginRecords;
  if (Array.isArray(provided)) {
    const records = provided.map((record, index) => normalizeProvidedRecord(record.id, record, index)).filter(Boolean);
    return { source: "provided", records, indexPath: undefined, indexVersion: undefined };
  }
  const indexPath = path.join(claudeHome, "plugins", "installed_plugins.json");
  const index = await readJson(indexPath);
  const records = [];
  if (index?.plugins && typeof index.plugins === "object" && !Array.isArray(index.plugins)) {
    for (const [id, value] of Object.entries(index.plugins)) {
      const values = Array.isArray(value) ? value : [value];
      values.forEach((record, recordIndex) => {
        const normalized = normalizeProvidedRecord(id, record, recordIndex);
        if (normalized) records.push(normalized);
      });
    }
  }
  return {
    source: index ? "claude-installed-index" : "missing",
    records,
    indexPath,
    indexVersion: index?.version,
  };
}

async function collectClaudePluginHooks(pluginRoot, manifest, manifestPath, sourceLabel, workspace) {
  const hookOptions = {
    ...CLAUDE_HOOK_OPTIONS,
    projectDirVariables: ["CLAUDE_PROJECT_DIR", "CLAUDE_PLUGIN_ROOT"],
    projectDirRoot: pluginRoot,
    projectDirVariableRoots: { CLAUDE_PROJECT_DIR: workspace, CLAUDE_PLUGIN_ROOT: pluginRoot },
    scriptRoots: [workspace, pluginRoot],
  };
  const declared = manifest?.hooks;
  if (declared && typeof declared === "object" && !Array.isArray(declared)) {
    return collectHooksFromConfig(
      { hooks: declared },
      { filePath: manifestPath, scope: "plugin", sourceLabel, rootForEvidence: pluginRoot },
      hookOptions,
    );
  }
  const candidates = Object.hasOwn(manifest ?? {}, "hooks")
    ? pluginPathValues(declared)
    : [path.join("hooks", "hooks.json")];
  const items = [];
  for (const relativePath of candidates) {
    const candidate = await pathInsideRoot(pluginRoot, relativePath);
    if (!candidate) continue;
    const stats = await pathStat(candidate);
    if (stats?.isFile()) {
      items.push(...await collectHooksFromFile(candidate, "plugin", sourceLabel, pluginRoot, hookOptions));
    }
  }
  return items.sort(sortByName);
}

async function collectClaudePluginMcps(pluginRoot, manifest, manifestPath, sourceLabel) {
  const declared = manifest?.mcpServers;
  if (declared && typeof declared === "object" && !Array.isArray(declared)) {
    const servers = declared.mcpServers ?? declared;
    return sanitizeMcpItems(collectMcpFromValue(servers, "plugin", sourceLabel, manifestPath, pluginRoot));
  }
  const candidates = Object.hasOwn(manifest ?? {}, "mcpServers")
    ? pluginPathValues(declared)
    : [".mcp.json"];
  const items = [];
  for (const relativePath of candidates) {
    const candidate = await pathInsideRoot(pluginRoot, relativePath);
    if (candidate) items.push(...await collectMcpFromConfig(candidate, "plugin", sourceLabel, pluginRoot));
  }
  return sanitizeMcpItems(items).sort(sortByName);
}

async function collectClaudePlugin(record, settings, workspace) {
  const pluginRoot = record.installPath;
  const manifestPath = path.join(pluginRoot, ...CLAUDE_PLUGIN_MANIFEST);
  const manifest = await readJson(manifestPath) ?? {};
  const packageJson = await readJson(path.join(pluginRoot, "package.json")) ?? {};
  const readme = await readText(path.join(pluginRoot, "README.md"), 6000);
  const heading = readme.match(/^#\s+(.+)$/mu)?.[1]?.trim();
  const displayName = normalizePluginDisplayName(
    manifest.displayName || packageJson.displayName || heading || titleCase(manifest.name || packageJson.name || record.name),
    record.name,
  );
  const applicable = pluginApplicable(record, workspace, settings, record.id);
  const configured = pluginSetting(record.id, settings);
  const enabled = applicable && (configured ? configured.enabled : manifest.defaultEnabled !== false);
  const metadataPath = await pluginMetadataEvidencePath(pluginRoot, [CLAUDE_PLUGIN_MANIFEST, ["package.json"]]);
  const plugin = {
    id: record.recordId,
    claudePluginId: record.id,
    marketplaceName: record.marketplaceName,
    rootPath: pluginRoot,
    scope: "plugin",
    sourceLabel: displayName,
    name: manifest.name || packageJson.name || record.name,
    displayName,
    description: manifest.description || packageJson.description || "",
    publisher: { displayName: manifest.author?.name || titleCase(record.marketplaceName) },
    version: record.version || manifest.version || packageJson.version,
    installedAt: record.installedAt,
    installSources: [normalizeInstallScope(record.scope)],
    installSource: normalizeInstallScope(record.scope),
    installMatch: "claude-installed-index",
    projectPath: record.projectPath,
    applicable,
    enabled,
    workspaceScoped: record.workspaceScoped === true,
    enabledSettingScope: configured?.scope,
    evidence: evidence(metadataPath, claudeHomeForPluginIndex(pluginRoot)),
  };
  const [skillRoots, commandRoots, agentRoots] = await Promise.all([
    componentRoots(pluginRoot, manifest, "skills", "skills", { addDefault: true }),
    componentRoots(pluginRoot, manifest, "commands", "commands"),
    componentRoots(pluginRoot, manifest, "agents", "agents"),
  ]);
  plugin.skills = await collectSkillsFromRoots(skillRoots, "plugin", displayName, pluginRoot);
  plugin.commands = await collectMarkdownFromRoots(commandRoots, "command", "plugin", displayName, pluginRoot);
  plugin.subagents = await collectMarkdownFromRoots(agentRoots, "subagent", "plugin", displayName, pluginRoot);
  plugin.rules = [];
  plugin.hooks = await collectClaudePluginHooks(pluginRoot, manifest, manifestPath, displayName, workspace);
  plugin.mcpServers = await collectClaudePluginMcps(pluginRoot, manifest, manifestPath, displayName);
  return plugin;
}

function claudeHomeForPluginIndex(pluginRoot) {
  const marker = `${path.sep}plugins${path.sep}`;
  const index = pluginRoot.lastIndexOf(marker);
  return index > 0 ? pluginRoot.slice(0, index) : path.dirname(pluginRoot);
}

async function collectClaudePlugins(records, settings, workspace) {
  const plugins = [];
  for (const record of records) plugins.push(await collectClaudePlugin(record, settings, workspace));
  return plugins.sort(sortByName);
}

async function annotateWorkspacePluginRecords(records, workspace) {
  const annotated = [];
  for (const record of records) {
    const workspaceScoped = await canonicalPathInsideRoot(workspace, record.installPath);
    annotated.push({ ...record, workspaceScoped });
  }
  return annotated;
}

export async function collectClaudeCustomizeInventory(options = {}) {
  const claudeHome = resolveClaudeHome(options);
  const claudeStatePath = resolveClaudeStatePath(options, claudeHome);
  const workspace = normalizeWorkspace(options.workspace ?? process.cwd());
  const includeUserHome = options.includeUserHome !== false;
  const workspaceIsClaudeHome = await pathsReferToSameRoot(workspace, claudeHome);
  const claudeProjectRoot = workspaceIsClaudeHome ? workspace : path.join(workspace, ".claude");
  const state = includeUserHome ? await readJson(claudeStatePath) : undefined;
  const [settings, rawInstallState] = await Promise.all([
    readClaudeSettings(claudeHome, workspace, includeUserHome, workspaceIsClaudeHome),
    includeUserHome || workspaceIsClaudeHome
      ? readClaudeInstalledPluginState(claudeHome, options)
      : Promise.resolve({ source: "not-authorized", records: [], indexPath: undefined, indexVersion: undefined }),
  ]);
  const annotatedRecords = workspaceIsClaudeHome
    ? await annotateWorkspacePluginRecords(rawInstallState.records, workspace)
    : rawInstallState.records;
  const installState = {
    ...rawInstallState,
    records: includeUserHome ? annotatedRecords : annotatedRecords.filter((record) => record.workspaceScoped === true),
  };
  const userPrimitives = includeUserHome && !workspaceIsClaudeHome
    ? await collectClaudeUserPrimitives(claudeHome, claudeStatePath, state, workspace)
    : includeUserHome
      ? {
          ...emptyPrimitives(),
          mcps: await collectStateMcp(
            state,
            (value) => value?.mcpServers,
            claudeStatePath,
            "user",
            "User",
            claudeHome,
          ),
        }
      : emptyPrimitives();
  const [plugins, user, project] = await Promise.all([
    includeUserHome || workspaceIsClaudeHome ? collectClaudePlugins(installState.records, settings, workspace) : [],
    Promise.resolve(userPrimitives),
    collectClaudeWorkspacePrimitives(workspace, claudeStatePath, state, includeUserHome, claudeProjectRoot),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    provider: "claude",
    claudeHome,
    claudeStatePath,
    workspace,
    tabs: MANAGE_TABS,
    plugins,
    manage: buildManageCollections(plugins, user, project),
    diagnostics: {
      installedPluginState: installState.source,
      installedPluginRecordCount: installState.records.length,
      installedPluginIndexPath: installState.indexPath,
      installedPluginIndexVersion: installState.indexVersion,
      effectivePluginCount: plugins.filter((plugin) => plugin.enabled !== false).length,
      unresolvedProjectPluginCount: plugins.filter((plugin) => plugin.installSource === "project" && !plugin.applicable).length,
      marketplaceCatalogsAreNotInstallEvidence: true,
      runtimeMcpProbeExecuted: false,
      designatedClaudeHomeWorkspace: workspaceIsClaudeHome,
    },
    unsupported: [
      "enterprise managed settings",
      "CLI-session ephemeral hooks and plugins",
      "runtime MCP connection and authentication state",
      "auto-memory body analysis",
      "arbitrary nested workspace .claude asset inheritance",
    ],
  };
}
