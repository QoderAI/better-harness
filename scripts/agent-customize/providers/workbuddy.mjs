import os from "node:os";
import path from "node:path";

import { pathExists } from "../../session-analysis/fs.mjs";
import { expandHome, normalizeWorkspace } from "../../session-analysis/paths.mjs";
import { MANAGE_TABS } from "../constants.mjs";
import {
  agentsMarkdownRuleSource,
  buildManageCollections,
  collectMarkdownItems,
  collectMcpFromConfig,
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

function defaultWorkbuddyHome() {
  // WorkBuddy resolves its data root from WORKBUDDY_DIR (default ~/.workbuddy).
  return process.env.WORKBUDDY_DIR ?? path.join(os.homedir(), ".workbuddy");
}

const IDENTITY_RULE_FILES = ["AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md"];

async function readPluginManifest(pluginRoot) {
  for (const shell of [".codebuddy-plugin", ".claude-plugin"]) {
    const manifestPath = path.join(pluginRoot, shell, "plugin.json");
    const manifest = await readJson(manifestPath);
    if (manifest) return { manifest, manifestPath };
  }
  return { manifest: null, manifestPath: null };
}

async function collectWorkbuddyMarketplacePlugin({ pluginRoot, pluginName, marketplaceName, enabledPlugins }) {
  const { manifest, manifestPath } = await readPluginManifest(pluginRoot);
  const readme = await readText(path.join(pluginRoot, "README.md"), 6000);
  const heading = readme.match(/^#\s+(.+)$/mu)?.[1]?.trim();
  const rawDisplayName = manifest?.displayName || heading || titleCase(manifest?.name || pluginName);
  const displayName = normalizePluginDisplayName(rawDisplayName, pluginName);
  const enabledKey = `${pluginName}@${marketplaceName}`;
  const plugin = {
    id: `workbuddy/marketplace/${marketplaceName}/${pluginName}`,
    rootPath: pluginRoot,
    scope: "plugin",
    sourceLabel: displayName,
    name: manifest?.name || pluginName,
    displayName,
    description: manifest?.description || "",
    publisher: { displayName: `WorkBuddy Marketplace (${marketplaceName})` },
    version: manifest?.version,
    installSources: ["marketplace"],
    installSource: "marketplace",
    installMatch: "workbuddy-marketplace-dir",
    installType: "marketplace",
    enabled: enabledPlugins?.[enabledKey] === true,
    evidence: evidence(manifestPath ?? pluginRoot, path.dirname(pluginRoot)),
  };
  plugin.skills = (await collectSkillFiles(pluginRoot, "plugin", displayName, pluginRoot)).sort(sortByName);
  plugin.commands = await collectMarkdownItems(
    path.join(pluginRoot, "commands"), "command", "plugin", displayName, pluginRoot,
  );
  plugin.rules = [];
  plugin.subagents = [];
  plugin.hooks = [];
  plugin.mcpServers = [];
  return plugin;
}

async function collectWorkbuddyMarketplacePlugins(workbuddyHome, settings) {
  const marketplacesRoot = path.join(workbuddyHome, "plugins", "marketplaces");
  const enabledPlugins = settings?.enabledPlugins && typeof settings.enabledPlugins === "object"
    ? settings.enabledPlugins
    : {};
  const plugins = [];
  for (const marketplaceDir of await listDirectories(marketplacesRoot)) {
    const marketplaceName = path.basename(marketplaceDir);
    const pluginsRoot = path.join(marketplaceDir, "plugins");
    if (!(await pathExists(pluginsRoot))) continue;
    for (const pluginRoot of await listDirectories(pluginsRoot)) {
      plugins.push(await collectWorkbuddyMarketplacePlugin({
        pluginRoot,
        pluginName: path.basename(pluginRoot),
        marketplaceName,
        enabledPlugins,
      }));
    }
  }
  return plugins;
}

async function agentsSkillsDir(base) {
  return path.join(base, ".agents", "skills");
}

async function collectWorkbuddyUserPrimitives(workbuddyHome) {
  const userHomeBase = path.dirname(workbuddyHome);
  // Global AGENTS.md plus the SOUL/IDENTITY/USER identity files enter every
  // WorkBuddy conversation as standing context; inventory them as user rules.
  const globalRules = await collectRuleSources(
    IDENTITY_RULE_FILES.map((name) => ({
      type: "file",
      filePath: path.join(workbuddyHome, name),
      scope: "user",
      sourceLabel: "User",
      rootForEvidence: workbuddyHome,
      name,
      sourceKind: "workbuddy-global-context",
      precedence: "before-project-rules",
      useHeading: true,
    })),
  );
  return {
    skills: [
      ...(await collectSkillFiles(path.join(workbuddyHome, "skills"), "user", "User", workbuddyHome)),
      ...(await collectSkillFiles(await agentsSkillsDir(userHomeBase), "user", "User", userHomeBase)),
    ].sort(sortByName),
    subagents: [],
    rules: globalRules,
    commands: [],
    hooks: [],
    mcps: await collectMcpFromConfig(path.join(workbuddyHome, "mcp.json"), "user", "User", workbuddyHome),
  };
}

async function collectWorkbuddyWorkspacePrimitives(workspace) {
  const sourceLabel = await workspaceSourceLabel(workspace);
  const project = await collectWorkspaceRootPrimitives(path.join(workspace, ".workbuddy"), sourceLabel, workspace);
  const agentsStandardSkills = await collectSkillFiles(
    await agentsSkillsDir(workspace), "project", sourceLabel, workspace,
  );
  project.skills = [...project.skills, ...agentsStandardSkills].sort(sortByName);
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

export async function collectWorkbuddyCustomizeInventory(options = {}) {
  const workbuddyHome = path.resolve(expandHome(
    options.workbuddyHome ?? options["workbuddy-home"] ?? defaultWorkbuddyHome(),
  ));
  const workspace = normalizeWorkspace(options.workspace ?? process.cwd());
  const includeUserHome = options.includeUserHome !== false;
  const settingsPath = path.join(workbuddyHome, "settings.json");
  const settings = includeUserHome ? (await readJson(settingsPath)) ?? {} : {};
  const [marketplacePlugins, user, project] = await Promise.all([
    includeUserHome ? collectWorkbuddyMarketplacePlugins(workbuddyHome, settings) : [],
    includeUserHome ? collectWorkbuddyUserPrimitives(workbuddyHome) : emptyPrimitives(),
    collectWorkbuddyWorkspacePrimitives(workspace),
  ]);
  const plugins = [...marketplacePlugins].sort(sortByName);
  return {
    generatedAt: new Date().toISOString(),
    provider: "workbuddy",
    workbuddyHome,
    workspace,
    tabs: MANAGE_TABS,
    plugins,
    manage: buildManageCollections(plugins, user, project),
    diagnostics: {
      installedPluginState: plugins.length > 0 ? "workbuddy-marketplace-dirs" : "missing",
      installedPluginRecordCount: plugins.length,
      installedPluginRecordFiles: [
        ...(includeUserHome && settings?.enabledPlugins && Object.keys(settings.enabledPlugins).length > 0
          ? [settingsPath]
          : []),
      ],
      remotePluginInstallMarkersRequired: false,
    },
    unsupported: [
      "marketplace catalog entries that are downloaded but not extracted",
      "per-plugin runtime enablement beyond settings.json enabledPlugins",
      "workbuddy.db and other binary state stores",
      "connectors and automation inventories",
    ],
  };
}
