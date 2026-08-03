import os from "node:os";
import path from "node:path";

import {
  expandHome,
  normalizeWorkspace,
  pathExists,
  pathStat,
  walkFiles,
} from "../../session-analysis/index.mjs";
import { MANAGE_TABS } from "../constants.mjs";
import {
  agentsMarkdownRuleSource,
  buildManageCollections,
  collectHooksFromConfig,
  collectMarkdownItems,
  collectMcpFromValue,
  collectMcpItems,
  collectRuleSources,
  collectSkillFiles,
  evidence,
  filterItemsInsideRoot,
  normalizePluginDisplayName,
  pathInsideRoot,
  pluginMetadataEvidencePath,
  pluginPathValues,
  readJson,
  readMarkdownName,
  sanitizeMcpItems,
  sortByName,
  titleCase,
  uniqueAssetsByRealPath,
  withoutExtension,
  workspaceSourceLabel,
} from "../core/items.mjs";

const KIMI_PLUGIN_MANIFESTS = [["kimi.plugin.json"], [".kimi-plugin", "plugin.json"]];

function defaultKimiHome() {
  return path.join(os.homedir(), ".kimi-code");
}

function claudeMarkdownRuleSource(workspace, sourceLabel) {
  return {
    type: "file",
    filePath: path.join(workspace, "CLAUDE.md"),
    scope: "project",
    sourceLabel,
    rootForEvidence: workspace,
    name: "CLAUDE.md",
    sourceKind: "claude-md-compat",
    precedence: "after-agents-md",
    useHeading: true,
  };
}

async function collectKimiUserPrimitives(kimiHome) {
  return {
    skills: await collectSkillFiles(path.join(kimiHome, "skills"), "user", "User", kimiHome),
    subagents: [],
    rules: [],
    commands: [],
    hooks: [],
    mcps: await collectMcpItems(kimiHome, "user", "User", kimiHome),
  };
}

async function collectKimiWorkspacePrimitives(workspace) {
  const sourceLabel = await workspaceSourceLabel(workspace);
  const skills = [
    ...(await collectSkillFiles(path.join(workspace, ".kimi-code", "skills"), "project", sourceLabel, workspace)),
    ...(await collectSkillFiles(path.join(workspace, ".kimi", "skills"), "project", sourceLabel, workspace)),
  ];
  const rules = await collectRuleSources([
    agentsMarkdownRuleSource(workspace, sourceLabel),
    claudeMarkdownRuleSource(workspace, sourceLabel),
  ]);
  return { skills, subagents: [], rules, commands: [], hooks: [], mcps: [] };
}

function emptyPrimitives() {
  return { skills: [], subagents: [], rules: [], commands: [], hooks: [], mcps: [] };
}

async function readKimiInstalledPluginState(kimiHome) {
  const indexPath = path.join(kimiHome, "plugins", "installed.json");
  const exists = await pathExists(indexPath);
  const index = exists ? await readJson(indexPath) : undefined;
  const records = [];
  if (index && Array.isArray(index.plugins)) {
    for (const record of index.plugins) {
      const id = typeof record?.id === "string" ? record.id.trim() : "";
      const root = typeof record?.root === "string" ? record.root.trim() : "";
      if (!id || !root) continue;
      records.push({
        id,
        root: path.resolve(expandHome(root)),
        source: typeof record.source === "string" ? record.source : undefined,
        enabled: record.enabled === true,
        installedAt: record.installedAt,
        updatedAt: record.updatedAt,
        originalSource: record.originalSource,
      });
    }
  }
  return {
    indexPath,
    exists,
    parseFailed: exists && index === undefined,
    indexVersion: index?.version,
    records,
  };
}

async function readKimiPluginManifest(pluginRoot) {
  let parseFailedPath;
  for (const segments of KIMI_PLUGIN_MANIFESTS) {
    const manifestPath = path.join(pluginRoot, ...segments);
    if (!(await pathExists(manifestPath))) continue;
    const manifest = await readJson(manifestPath);
    if (manifest && typeof manifest === "object" && !Array.isArray(manifest)) {
      return { manifest, manifestPath };
    }
    // A malformed manifest must not mask a valid fallback candidate.
    parseFailedPath ??= manifestPath;
  }
  return {
    manifest: {},
    manifestPath: parseFailedPath ?? path.join(pluginRoot, ...KIMI_PLUGIN_MANIFESTS[0]),
    parseFailed: parseFailedPath !== undefined,
  };
}

async function declaredComponentRoots(pluginRoot, values) {
  const roots = [];
  for (const value of values) {
    const candidate = await pathInsideRoot(pluginRoot, value);
    if (candidate && !roots.includes(candidate)) roots.push(candidate);
  }
  return roots;
}

async function kimiPluginSkillRoots(pluginRoot, manifest) {
  if (Object.hasOwn(manifest, "skills")) {
    return declaredComponentRoots(pluginRoot, pluginPathValues(manifest.skills));
  }
  return (await pathExists(path.join(pluginRoot, "SKILL.md"))) ? [pluginRoot] : [];
}

async function kimiPluginAgentRoots(pluginRoot, manifest) {
  if (Object.hasOwn(manifest, "agents")) {
    return declaredComponentRoots(pluginRoot, pluginPathValues(manifest.agents));
  }
  return declaredComponentRoots(pluginRoot, ["agents"]);
}

async function collectSkillsFromRoots(roots, sourceLabel, pluginRoot) {
  return uniqueAssetsByRealPath((await Promise.all(
    roots.map((root) => collectSkillFiles(root, "plugin", sourceLabel, pluginRoot)),
  )).flat());
}

async function collectKimiPluginCommands(pluginRoot, manifest, sourceLabel) {
  const items = [];
  for (const declaredPath of pluginPathValues(manifest.commands)) {
    const candidate = await pathInsideRoot(pluginRoot, declaredPath);
    if (!candidate) continue;
    const stats = await pathStat(candidate);
    const isDirectory = stats?.isDirectory() === true;
    const files = isDirectory
      ? await walkFiles(candidate, {
          maxDepth: 4,
          limit: 2000,
          match: (filePath) => path.extname(filePath) === ".md",
        })
      : stats?.isFile() && path.extname(candidate) === ".md"
        ? [candidate]
        : [];
    for (const filePath of files) {
      const fallback = isDirectory
        ? path.relative(candidate, filePath).replace(/\.md$/iu, "").split(path.sep).join("/")
        : withoutExtension(filePath);
      const metadata = await readMarkdownName(filePath, fallback);
      items.push({
        id: `plugin:command:${filePath}`,
        kind: "command",
        scope: "plugin",
        sourceLabel,
        filePath,
        ...metadata,
        evidence: evidence(filePath, pluginRoot),
      });
    }
  }
  return (await uniqueAssetsByRealPath(items)).sort(sortByName);
}

function kimiPluginHookConfig(hooks) {
  const grouped = {};
  for (const hook of Array.isArray(hooks) ? hooks : []) {
    if (!hook || typeof hook !== "object") continue;
    const event = typeof hook.event === "string" && hook.event.trim() ? hook.event.trim() : "unknown";
    (grouped[event] ??= []).push({
      matcher: typeof hook.matcher === "string" ? hook.matcher : undefined,
      hooks: [{ type: "command", command: hook.command, timeout: hook.timeout }],
    });
  }
  return { hooks: grouped };
}

function collectKimiPluginHooks(manifest, manifestPath, sourceLabel, pluginRoot) {
  if (!Array.isArray(manifest.hooks)) return [];
  return collectHooksFromConfig(
    kimiPluginHookConfig(manifest.hooks),
    { filePath: manifestPath, scope: "plugin", sourceLabel, rootForEvidence: pluginRoot },
    { timeoutUnit: "seconds" },
  );
}

function collectKimiPluginMcps(manifest, manifestPath, sourceLabel, pluginRoot) {
  const declared = manifest.mcpServers;
  if (!declared || typeof declared !== "object" || Array.isArray(declared)) return [];
  const servers = declared.mcpServers ?? declared;
  return sanitizeMcpItems(collectMcpFromValue(servers, "plugin", sourceLabel, manifestPath, pluginRoot));
}

async function collectKimiPlugin(record) {
  const pluginRoot = record.root;
  const { manifest, manifestPath } = await readKimiPluginManifest(pluginRoot);
  const name = typeof manifest.name === "string" && manifest.name.trim() ? manifest.name.trim() : record.id;
  const displayName = normalizePluginDisplayName(
    typeof manifest.interface?.displayName === "string" && manifest.interface.displayName.trim()
      ? manifest.interface.displayName
      : titleCase(name),
    name,
  );
  const plugin = {
    id: record.id,
    kimiPluginId: record.id,
    rootPath: pluginRoot,
    scope: "plugin",
    sourceLabel: displayName,
    name,
    displayName,
    description: typeof manifest.description === "string" ? manifest.description : "",
    version: manifest.version,
    enabled: record.enabled,
    installedAt: record.installedAt,
    updatedAt: record.updatedAt,
    installSource: "user",
    installSources: ["user"],
    source: record.source,
    originalSource: record.originalSource,
    // systemPrompt injection is plugin metadata only; it is never merged into rules.
    systemPrompt: typeof manifest.systemPrompt === "string" ? manifest.systemPrompt : undefined,
    systemPromptPath: typeof manifest.systemPromptPath === "string"
      ? await pathInsideRoot(pluginRoot, manifest.systemPromptPath)
      : undefined,
    sessionStartSkill: typeof manifest.sessionStart?.skill === "string" ? manifest.sessionStart.skill : undefined,
    evidence: evidence(await pluginMetadataEvidencePath(pluginRoot, KIMI_PLUGIN_MANIFESTS), pluginRoot),
    skills: [],
    subagents: [],
    rules: [],
    commands: [],
    hooks: [],
    mcpServers: [],
  };
  if (!plugin.enabled) return plugin;
  const [skillRoots, agentRoots] = await Promise.all([
    kimiPluginSkillRoots(pluginRoot, manifest),
    kimiPluginAgentRoots(pluginRoot, manifest),
  ]);
  // Collection follows symlinks, so a symlink inside the plugin root could
  // otherwise pull files from outside it into the inventory; drop any item
  // whose realpath escapes the plugin root.
  plugin.skills = await filterItemsInsideRoot(
    await collectSkillsFromRoots(skillRoots, displayName, pluginRoot),
    pluginRoot,
  );
  plugin.subagents = await filterItemsInsideRoot(
    await uniqueAssetsByRealPath((await Promise.all(
      agentRoots.map((root) => collectMarkdownItems(root, "subagent", "plugin", displayName, pluginRoot)),
    )).flat()),
    pluginRoot,
  );
  plugin.commands = await filterItemsInsideRoot(
    await collectKimiPluginCommands(pluginRoot, manifest, displayName),
    pluginRoot,
  );
  plugin.hooks = collectKimiPluginHooks(manifest, manifestPath, displayName, pluginRoot);
  plugin.mcpServers = collectKimiPluginMcps(manifest, manifestPath, displayName, pluginRoot);
  return plugin;
}

async function collectKimiPlugins(kimiHome) {
  const state = await readKimiInstalledPluginState(kimiHome);
  const plugins = [];
  for (const record of state.records) plugins.push(await collectKimiPlugin(record));
  return { state, plugins: plugins.sort(sortByName) };
}

export async function collectKimiCustomizeInventory(options = {}) {
  const kimiHome = path.resolve(expandHome(options.kimiHome ?? options["kimi-home"] ?? defaultKimiHome()));
  const workspace = normalizeWorkspace(options.workspace ?? process.cwd());
  const includeUserHome = options.includeUserHome !== false;
  const [pluginState, user, project] = await Promise.all([
    includeUserHome ? collectKimiPlugins(kimiHome) : Promise.resolve(undefined),
    includeUserHome ? collectKimiUserPrimitives(kimiHome) : emptyPrimitives(),
    collectKimiWorkspacePrimitives(workspace),
  ]);
  const plugins = pluginState?.plugins ?? [];
  const configPath = path.join(kimiHome, "config.toml");
  return {
    generatedAt: new Date().toISOString(),
    provider: "kimi",
    kimiHome,
    workspace,
    tabs: MANAGE_TABS,
    plugins,
    manage: buildManageCollections(plugins, user, project),
    diagnostics: {
      configTomlExists: await pathExists(configPath),
      configTomlNotParsed: "config.toml holds model/provider settings, not customizable assets",
      projectSkillRootsProbed: [
        path.join(workspace, ".kimi-code", "skills"),
        path.join(workspace, ".kimi", "skills"),
      ],
      installedPluginIndexPath: path.join(kimiHome, "plugins", "installed.json"),
      ...(pluginState
        ? {
            installedPluginIndexExists: pluginState.state.exists,
            installedPluginIndexParseFailed: pluginState.state.parseFailed,
            installedPluginIndexVersion: pluginState.state.indexVersion,
            installedPluginRecordCount: pluginState.state.records.length,
            enabledPluginCount: plugins.filter((plugin) => plugin.enabled).length,
          }
        : { pluginCollectionSkipped: "include-user-home-disabled" }),
    },
    unsupported: [
      "plugin systemPrompt/systemPromptPath injection (recorded as plugin metadata only, not merged into rules)",
      "memory (Kimi Code has no memory equivalent)",
    ],
  };
}
