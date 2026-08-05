import os from "node:os";
import { readdir } from "node:fs/promises";
import path from "node:path";

import { expandHome, normalizeWorkspace, pathExists, pathStat } from "../../session-analysis/index.mjs";
import { MANAGE_TABS } from "../constants.mjs";
import {
  agentsMarkdownRuleSource,
  buildManageCollections,
  collectMarkdownItems,
  collectRuleSources,
  collectSkillFiles,
  collectWorkspaceRootPrimitives,
  designMarkdownRuleSource,
  evidence,
  listDirectories,
  normalizePluginDisplayName,
  readJson,
  readMarkdownName,
  readText,
  sortByName,
  titleCase,
  withoutExtension,
  workspaceSourceLabel,
} from "../core/items.mjs";

function defaultPiHome() {
  // Pi resolves its agent dir from PI_CODING_AGENT_DIR (default ~/.pi/agent).
  return process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
}

function packageSourceString(entry) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object" && typeof entry.source === "string") return entry.source;
  return null;
}

// Pi settings package entries are either a source string or an object form
// carrying autoload and per-resource filters. Keep the whole effective-state
// contract: autoload and filters decide what Pi actually loads.
function normalizePiPackageEntry(entry) {
  const source = packageSourceString(entry)?.trim();
  if (!source) return null;
  if (typeof entry === "string") {
    return { source, autoload: true, filters: {} };
  }
  return {
    source,
    autoload: entry.autoload !== false,
    filters: {
      skills: Array.isArray(entry.skills) ? entry.skills : undefined,
      prompts: Array.isArray(entry.prompts) ? entry.prompts : undefined,
    },
  };
}

function toPosixPath(value) {
  return value.split(path.sep).join("/").replace(/^\.\//u, "");
}

function piGlobToRegExp(pattern) {
  let out = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        out += ".*";
        i += 1;
        if (pattern[i + 1] === "/") i += 1;
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/gu, "\\$&");
    }
  }
  return new RegExp(`^${out}$`, "u");
}

function piItemCandidates(item, packageRoot) {
  const rel = toPosixPath(path.relative(packageRoot, item.filePath));
  const parent = path.posix.dirname(rel);
  return [rel, path.posix.basename(rel), parent, path.posix.basename(parent)].filter(Boolean);
}

function matchesPiPattern(pattern, candidates) {
  const normalized = toPosixPath(pattern);
  const regex = piGlobToRegExp(normalized);
  return candidates.some((candidate) => regex.test(candidate));
}

// Apply Pi's documented filter layering: omitted key loads all, [] loads
// none, positive patterns narrow, !pattern excludes, +path force-includes an
// exact path, and -path force-excludes an exact path.
function applyPiResourceFilter(items, packageRoot, filter) {
  if (filter === undefined) return items;
  if (filter.length === 0) return [];
  const positives = filter.filter((p) => typeof p === "string" && !/^[!+-]/u.test(p));
  const excludes = filter.filter((p) => typeof p === "string" && p.startsWith("!")).map((p) => p.slice(1));
  const forceIncludes = filter.filter((p) => typeof p === "string" && p.startsWith("+")).map((p) => toPosixPath(p.slice(1)));
  const forceExcludes = filter.filter((p) => typeof p === "string" && p.startsWith("-")).map((p) => toPosixPath(p.slice(1)));
  return items.filter((item) => {
    const candidates = piItemCandidates(item, packageRoot);
    if (forceExcludes.some((exact) => candidates.includes(exact))) return false;
    if (forceIncludes.some((exact) => candidates.includes(exact))) return true;
    if (positives.length > 0 && !positives.some((pattern) => matchesPiPattern(pattern, candidates))) return false;
    if (excludes.some((pattern) => matchesPiPattern(pattern, candidates))) return false;
    return true;
  });
}

// With autoload:false Pi treats resource patterns as a delta: no patterns
// change nothing, plain/+ patterns enable matches, and !/- patterns disable
// matches. A project delta can layer over the effective user package state.
function applyPiResourceDelta(items, packageRoot, baseItems, filter = []) {
  const enabled = new Set(baseItems.map((item) => item.filePath));
  for (const rawPattern of filter) {
    if (typeof rawPattern !== "string" || rawPattern.length === 0) continue;
    const marker = /^[!+-]/u.test(rawPattern) ? rawPattern[0] : "";
    const pattern = marker ? rawPattern.slice(1) : rawPattern;
    const exact = marker === "+" || marker === "-";
    const nextEnabled = marker !== "!" && marker !== "-";
    const normalized = toPosixPath(pattern);
    for (const item of items) {
      const candidates = piItemCandidates(item, packageRoot);
      const matches = exact
        ? candidates.includes(normalized)
        : matchesPiPattern(pattern, candidates);
      if (!matches) continue;
      if (nextEnabled) enabled.add(item.filePath);
      else enabled.delete(item.filePath);
    }
  }
  return items.filter((item) => enabled.has(item.filePath));
}

// Manifest arrays are resource sources; plain directory entries are walked
// and `!` exclusions are honored as a filter layer. Glob source expansion
// beyond declared directories stays unexpanded (fail closed) rather than
// over-reporting resources Pi may not load.
function manifestOverrides(manifest, key) {
  const declared = Array.isArray(manifest?.[key]) ? manifest[key] : [];
  return declared.filter((entry) => typeof entry === "string" && /^[!+-]/u.test(entry));
}

function normalizeGitClonePath(source) {
  let value = source.trim();
  if (value.startsWith("git:")) value = value.slice("git:".length);
  if (/^(?:https?|ssh|git):\/\//u.test(value)) {
    try {
      const url = new URL(value);
      value = `${url.hostname}/${url.pathname.replace(/^\//u, "")}`;
    } catch {
      value = value.replace(/^(?:https?|ssh|git):\/\//u, "").replace(/^[^@/]+@/u, "");
    }
  }
  value = value.replace(/^[^@/]+@([^:]+):/u, "$1/");
  const at = value.lastIndexOf("@");
  if (at > value.lastIndexOf("/")) value = value.slice(0, at);
  value = value.replace(/\.git$/u, "");
  return value.split("/").filter(Boolean).join(path.sep);
}

export function resolvePiPackageRecord(source, { scopeRoot, settingsDir, scope }) {
  if (source.startsWith("npm:")) {
    let spec = source.slice("npm:".length);
    const versionAt = spec.lastIndexOf("@");
    if (versionAt > 0) spec = spec.slice(0, versionAt);
    return {
      id: `pi/${scope}/npm:${spec}`,
      identity: `npm:${spec}`,
      name: spec,
      source,
      sourceKind: "npm",
      installPath: path.join(scopeRoot, "npm", "node_modules", ...spec.split("/")),
    };
  }
  if (source.startsWith("git:") || /^(?:https?|ssh|git):\/\//u.test(source) || /^[^@\s]+@[^:\s]+:.+/u.test(source)) {
    const clonePath = normalizeGitClonePath(source);
    const identity = `git:${clonePath.split(path.sep).join("/")}`;
    return {
      id: `pi/${scope}/${identity}`,
      identity,
      name: path.basename(clonePath),
      source,
      sourceKind: "git",
      installPath: path.join(scopeRoot, "git", clonePath),
    };
  }
  const localPath = path.isAbsolute(expandHome(source))
    ? path.resolve(expandHome(source))
    : path.resolve(settingsDir, source);
  return {
    id: `pi/${scope}/local:${localPath}`,
    identity: `local:${localPath}`,
    name: path.basename(localPath),
    source,
    sourceKind: "local",
    installPath: localPath,
  };
}

function manifestResourcePaths(manifest, packageRoot, key, conventional) {
  const declared = Array.isArray(manifest?.[key]) ? manifest[key] : null;
  if (!declared) {
    return [path.join(packageRoot, conventional)];
  }
  const dirs = [];
  for (const entry of declared) {
    if (typeof entry !== "string" || entry.includes("*") || /^[!+-]/u.test(entry)) continue;
    dirs.push(path.resolve(packageRoot, entry));
  }
  return dirs;
}

async function piMarkdownItem(filePath, kind, scope, sourceLabel, rootForEvidence) {
  const stat = await pathStat(filePath);
  if (!stat?.isFile() || path.extname(filePath).toLowerCase() !== ".md") return [];
  const fallback = kind === "skill" && path.basename(filePath) === "SKILL.md"
    ? path.basename(path.dirname(filePath))
    : withoutExtension(filePath);
  const metadata = await readMarkdownName(filePath, fallback, { useHeading: kind === "skill" });
  return [{
    id: `${scope}:${kind}:${filePath}`,
    kind,
    scope,
    sourceLabel,
    filePath,
    name: fallback,
    declaredName: metadata.name && metadata.name !== fallback ? metadata.name : undefined,
    description: metadata.description,
    evidence: evidence(filePath, rootForEvidence),
  }];
}

async function collectPiSkillPath(resourcePath, scope, sourceLabel, packageRoot) {
  const stat = await pathStat(resourcePath);
  if (!stat) return [];
  if (stat.isFile()) return piMarkdownItem(resourcePath, "skill", scope, sourceLabel, packageRoot);
  if (!stat.isDirectory()) return [];
  const nested = await collectSkillFiles(resourcePath, scope, sourceLabel, packageRoot);
  let entries = [];
  try { entries = await readdir(resourcePath, { withFileTypes: true }); } catch { return nested; }
  const flat = (await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name !== "SKILL.md" && entry.name.endsWith(".md"))
    .map((entry) => piMarkdownItem(path.join(resourcePath, entry.name), "skill", scope, sourceLabel, packageRoot))))
    .flat();
  return [...nested, ...flat].sort(sortByName);
}

async function collectPiPromptPath(resourcePath, scope, sourceLabel, packageRoot) {
  const stat = await pathStat(resourcePath);
  if (!stat) return [];
  if (stat.isFile()) return piMarkdownItem(resourcePath, "command", scope, sourceLabel, packageRoot);
  if (!stat.isDirectory()) return [];
  return collectMarkdownItems(resourcePath, "command", scope, sourceLabel, packageRoot);
}

async function collectPiPackagePlugin(
  record,
  scope,
  entryConfig = { autoload: true, filters: {} },
  { baseConfig, installSources = [scope] } = {},
) {
  const packageRoot = record.installPath;
  if (!(await pathExists(packageRoot))) {
    return null;
  }
  const packageJson = (await readJson(path.join(packageRoot, "package.json"))) ?? {};
  const manifest = packageJson.pi && typeof packageJson.pi === "object" ? packageJson.pi : null;
  const readme = await readText(path.join(packageRoot, "README.md"), 6000);
  const heading = readme.match(/^#\s+(.+)$/mu)?.[1]?.trim();
  const rawDisplayName = packageJson.displayName || heading || titleCase(packageJson.name || record.name);
  const displayName = normalizePluginDisplayName(rawDisplayName, record.name);
  const metadataPath = (await pathExists(path.join(packageRoot, "package.json")))
    ? path.join(packageRoot, "package.json")
    : packageRoot;
  const plugin = {
    id: record.id,
    piPackageSource: record.identity,
    rootPath: packageRoot,
    scope: "plugin",
    sourceLabel: displayName,
    name: packageJson.name || record.name,
    displayName,
    description: packageJson.description || "",
    publisher: { displayName: "Pi Package" },
    version: packageJson.version,
    installSources,
    installSource: scope,
    installMatch: `pi-settings-${record.sourceKind}`,
    installType: record.sourceKind,
    enabled: entryConfig.autoload !== false || Boolean(baseConfig),
    evidence: evidence(metadataPath, path.dirname(packageRoot)),
  };
  const skillPaths = manifestResourcePaths(manifest, packageRoot, "skills", "skills");
  const promptPaths = manifestResourcePaths(manifest, packageRoot, "prompts", "prompts");
  const collectedSkills = (await Promise.all(
    skillPaths.map((resourcePath) => collectPiSkillPath(resourcePath, "plugin", displayName, packageRoot)),
  )).flat();
  const collectedPrompts = (await Promise.all(
    promptPaths.map((resourcePath) => collectPiPromptPath(resourcePath, "plugin", displayName, packageRoot)),
  )).flat();
  const skillOverrides = manifestOverrides(manifest, "skills");
  const promptOverrides = manifestOverrides(manifest, "prompts");
  const manifestSkills = applyPiResourceFilter(
    collectedSkills,
    packageRoot,
    skillOverrides.length > 0 ? skillOverrides : undefined,
  );
  const manifestPrompts = applyPiResourceFilter(
    collectedPrompts,
    packageRoot,
    promptOverrides.length > 0 ? promptOverrides : undefined,
  );
  const baseSkills = baseConfig
    ? (baseConfig.autoload === false
      ? applyPiResourceDelta(manifestSkills, packageRoot, [], baseConfig.filters.skills)
      : applyPiResourceFilter(manifestSkills, packageRoot, baseConfig.filters.skills))
    : [];
  const basePrompts = baseConfig
    ? (baseConfig.autoload === false
      ? applyPiResourceDelta(manifestPrompts, packageRoot, [], baseConfig.filters.prompts)
      : applyPiResourceFilter(manifestPrompts, packageRoot, baseConfig.filters.prompts))
    : [];
  plugin.skills = (entryConfig.autoload === false
    ? applyPiResourceDelta(manifestSkills, packageRoot, baseSkills, entryConfig.filters.skills)
    : applyPiResourceFilter(manifestSkills, packageRoot, entryConfig.filters.skills)).sort(sortByName);
  plugin.commands = (entryConfig.autoload === false
    ? applyPiResourceDelta(manifestPrompts, packageRoot, basePrompts, entryConfig.filters.prompts)
    : applyPiResourceFilter(manifestPrompts, packageRoot, entryConfig.filters.prompts)).sort(sortByName);
  if (entryConfig.autoload === false) {
    plugin.enabled = plugin.skills.length > 0 || plugin.commands.length > 0 || Boolean(baseConfig?.autoload);
    plugin.resourceState = plugin.enabled ? "selective-autoload" : "not-autoloaded";
  }
  plugin.rules = [];
  plugin.subagents = [];
  plugin.hooks = [];
  plugin.mcpServers = [];
  return plugin;
}

async function collectPiExtensionPlugins(piHome) {
  const extensionsRoot = path.join(piHome, "extensions");
  const plugins = [];
  for (const extensionDir of await listDirectories(extensionsRoot)) {
    const name = path.basename(extensionDir);
    const record = {
      id: `pi/user/extensions/${name}`,
      identity: `extension:${extensionDir}`,
      name,
      source: extensionDir,
      sourceKind: "extension-dir",
      installPath: extensionDir,
    };
    const plugin = await collectPiPackagePlugin(record, "user");
    if (plugin) {
      plugin.installMatch = "pi-extensions-dir";
      plugin.installType = "extension-dir";
      plugins.push(plugin);
    }
  }
  return plugins;
}

function collectPiPackageEntries(settings, settingsPath, scopeRoot, scope) {
  const entries = Array.isArray(settings?.packages) ? settings.packages : [];
  const records = [];
  const seen = new Set();
  for (const entry of entries) {
    const entryConfig = normalizePiPackageEntry(entry);
    if (!entryConfig) continue;
    const record = resolvePiPackageRecord(entryConfig.source, {
      scopeRoot,
      settingsDir: path.dirname(settingsPath),
      scope,
    });
    if (seen.has(record.identity)) continue;
    seen.add(record.identity);
    records.push({ record, entryConfig, scope });
  }
  return records;
}

async function collectEffectivePiPackagePlugins(userEntries, projectEntries) {
  const userByIdentity = new Map(userEntries.map((entry) => [entry.record.identity, entry]));
  const consumedUsers = new Set();
  const plugins = [];
  for (const projectEntry of projectEntries) {
    const userEntry = userByIdentity.get(projectEntry.record.identity);
    if (userEntry) consumedUsers.add(projectEntry.record.identity);
    const isDelta = projectEntry.entryConfig.autoload === false && userEntry;
    const plugin = await collectPiPackagePlugin(
      isDelta ? userEntry.record : projectEntry.record,
      "project",
      projectEntry.entryConfig,
      isDelta
        ? { baseConfig: userEntry.entryConfig, installSources: ["project", "user"] }
        : { installSources: ["project"] },
    );
    if (plugin) plugins.push(plugin);
  }
  for (const userEntry of userEntries) {
    if (consumedUsers.has(userEntry.record.identity)) continue;
    const plugin = await collectPiPackagePlugin(
      userEntry.record,
      "user",
      userEntry.entryConfig,
      { installSources: ["user"] },
    );
    if (plugin) plugins.push(plugin);
  }
  return plugins;
}

async function agentsSkillsDir(base) {
  return path.join(base, ".agents", "skills");
}

async function collectPiUserPrimitives(piHome, userHome) {
  const globalRules = await collectRuleSources([
    {
      type: "file",
      filePath: path.join(piHome, "AGENTS.md"),
      scope: "user",
      sourceLabel: "User",
      rootForEvidence: piHome,
      name: "AGENTS.md",
      sourceKind: "pi-global-context",
      precedence: "before-project-rules",
      useHeading: true,
    },
  ]);
  return {
    skills: [
      ...(await collectSkillFiles(path.join(piHome, "skills"), "user", "User", piHome)),
      // Pi discovers the Agent Skills standard directory from the real user
      // home even when PI_CODING_AGENT_DIR relocates the agent dir; model the
      // two roots independently instead of deriving one from the other.
      ...(await collectSkillFiles(await agentsSkillsDir(userHome), "user", "User", userHome)),
    ].sort(sortByName),
    subagents: [],
    rules: globalRules,
    commands: await collectMarkdownItems(path.join(piHome, "prompts"), "command", "user", "User", piHome),
    hooks: [],
    mcps: [],
  };
}

async function collectPiWorkspacePrimitives(workspace) {
  const sourceLabel = await workspaceSourceLabel(workspace);
  const project = await collectWorkspaceRootPrimitives(path.join(workspace, ".pi"), sourceLabel, workspace);
  // Pi prompt templates register as slash commands from .pi/prompts.
  const promptCommands = await collectMarkdownItems(
    path.join(workspace, ".pi", "prompts"), "command", "project", sourceLabel, workspace,
  );
  for (const command of promptCommands) {
    if (!project.commands.some((item) => item.filePath === command.filePath)) {
      project.commands.push(command);
    }
  }
  project.commands.sort(sortByName);
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

export async function collectPiCustomizeInventory(options = {}) {
  const piHome = path.resolve(expandHome(options.piHome ?? options["pi-home"] ?? defaultPiHome()));
  const userHome = path.resolve(expandHome(options.piUserHome ?? options["pi-user-home"] ?? os.homedir()));
  const workspace = normalizeWorkspace(options.workspace ?? process.cwd());
  const includeUserHome = options.includeUserHome !== false;
  const userSettingsPath = path.join(piHome, "settings.json");
  const projectSettingsPath = path.join(workspace, ".pi", "settings.json");
  const userSettings = includeUserHome ? (await readJson(userSettingsPath)) ?? {} : {};
  const projectSettings = (await readJson(projectSettingsPath)) ?? {};
  const userPackageEntries = includeUserHome
    ? collectPiPackageEntries(userSettings, userSettingsPath, piHome, "user")
    : [];
  const projectPackageEntries = collectPiPackageEntries(
    projectSettings,
    projectSettingsPath,
    path.join(workspace, ".pi"),
    "project",
  );
  const [packagePlugins, extensionPlugins, user, project] = await Promise.all([
    collectEffectivePiPackagePlugins(userPackageEntries, projectPackageEntries),
    includeUserHome ? collectPiExtensionPlugins(piHome) : [],
    includeUserHome ? collectPiUserPrimitives(piHome, userHome) : emptyPrimitives(),
    collectPiWorkspacePrimitives(workspace),
  ]);
  const plugins = [...packagePlugins, ...extensionPlugins].sort(sortByName);
  return {
    generatedAt: new Date().toISOString(),
    provider: "pi",
    piHome,
    piUserHome: userHome,
    workspace,
    tabs: MANAGE_TABS,
    plugins,
    manage: buildManageCollections(plugins, user, project),
    diagnostics: {
      installedPluginState: plugins.length > 0 ? "pi-settings-packages" : "missing",
      installedPluginRecordCount: plugins.length,
      installedPluginRecordFiles: [
        ...(includeUserHome && Array.isArray(userSettings.packages) && userSettings.packages.length > 0
          ? [userSettingsPath]
          : []),
        ...(Array.isArray(projectSettings.packages) && projectSettings.packages.length > 0
          ? [projectSettingsPath]
          : []),
      ],
      remotePluginInstallMarkersRequired: false,
    },
    unsupported: [
      "pi manifest glob source expansion outside declared resource directories",
      "pi config per-resource enable state beyond settings package entries",
      "native MCP inventory (Pi loads MCP through extensions)",
      "extension runtime registration state",
      "theme inventory",
    ],
  };
}
