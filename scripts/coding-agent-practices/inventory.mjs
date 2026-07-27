#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseArgs, parseBooleanFlag } from "../session-analysis/cli.mjs";
import { pathExists, walkFiles } from "../session-analysis/fs.mjs";
import { expandHome, normalizeWorkspace } from "../session-analysis/paths.mjs";
import { collectAgentCustomizeInventory } from "../agent-customize/index.mjs";

const MEMORY_CONFIG_KEYS = new Set([
  "memory.fetch.enable",
  "memory.retrieve.enable",
  "memory.retrieve.exclude.category",
  "memory.usage.prompt.enabled",
  "memory.file_memory.prompt.enabled",
  "memory.topictree.enable",
  "memory.auto.extract.v2.enable",
  "memory.init.extract.v2.enable",
  "memory.active.mode.enable.v4",
]);

const CODEX_MEMORY_CONFIG_KEYS = new Set([
  "features.memories",
  "memories.generate_memories",
  "memories.use_memories",
  "memories.disable_on_external_context",
  "memories.no_memories_if_mcp_or_web_search",
  "memories.min_rate_limit_remaining_percent",
  "memories.extract_model",
  "memories.consolidation_model",
]);

function normalizeBoolean(value) {
  return parseBooleanFlag(value);
}

function defaultSharedCache() {
  const home = os.homedir();
  if (process.platform === "win32") {
    return path.join(home, "AppData", "Roaming", "Qoder", "SharedClientCache", "cache");
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Qoder", "SharedClientCache", "cache");
  }
  return path.join(home, ".config", "Qoder", "SharedClientCache", "cache");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readTextHead(filePath, maxChars = 8000) {
  const text = await readFile(filePath, "utf8");
  return text.slice(0, maxChars);
}

function parseSkillMetadata(text, fallbackName) {
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---/);
  const body = frontmatter?.[1] ?? text;
  const name = body.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? fallbackName;
  const description = body.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";
  return { name, description };
}

function itemForFile(filePath, rootPath, extra = {}) {
  return {
    name: path.basename(filePath),
    path: filePath,
    relativePath: path.relative(rootPath, filePath),
    ...extra,
  };
}

async function skillItems(rootPath, maxDepth = 4) {
  const files = await walkFiles(rootPath, {
    maxDepth,
    limit: 5000,
    match: (filePath) => path.basename(filePath) === "SKILL.md",
  });
  const items = [];
  for (const filePath of files) {
    const fallbackName = path.basename(path.dirname(filePath));
    const metadata = parseSkillMetadata(await readTextHead(filePath), fallbackName);
    items.push(itemForFile(filePath, rootPath, metadata));
  }
  return items;
}

async function simpleFileItems(rootPath, options = {}) {
  const files = await walkFiles(rootPath, {
    maxDepth: options.maxDepth ?? 3,
    limit: options.limit ?? 5000,
    match: options.match,
  });
  return files.map((filePath) => itemForFile(filePath, rootPath));
}

async function workflowItems(workspace) {
  const roots = [
    path.join(workspace, ".github", "workflows"),
    path.join(workspace, ".qoder", "workflows"),
    path.join(workspace, ".codex", "workflows"),
    path.join(workspace, ".agents", "workflows"),
    path.join(workspace, "workflows"),
  ];
  const items = [];
  for (const root of roots) {
    if (!(await pathExists(root))) continue;
    items.push(...await simpleFileItems(root, {
      maxDepth: 4,
      match: (filePath) => /\.(?:md|ya?ml|json)$/iu.test(path.basename(filePath)),
    }));
  }
  return items;
}

async function singleFileItem(filePath, options = {}) {
  return [itemForFile(filePath, options.rootPath ?? path.dirname(filePath), options.extra)];
}

async function settingsItems(filePath) {
  if (!(await pathExists(filePath))) {
    return [];
  }
  const value = await readJson(filePath).catch(() => null);
  if (!value || typeof value !== "object") {
    return [itemForFile(filePath, path.dirname(filePath), { name: path.basename(filePath), parseError: true })];
  }
  return Object.keys(value)
    .filter((key) => ["hooks", "mcpServers", "permissions", "skills"].includes(key))
    .sort()
    .map((key) => ({
      name: key,
      path: filePath,
      relativePath: path.basename(filePath),
      configured: Boolean(value[key]),
    }));
}

async function installedPluginItems(rootPath) {
  const files = await walkFiles(rootPath, {
    maxDepth: 1,
    limit: 50,
    match: (filePath) => /^installed_plugins.*\.json$/u.test(path.basename(filePath)),
  });
  const items = [];
  for (const filePath of files) {
    const value = await readJson(filePath).catch(() => null);
    const plugins = Array.isArray(value?.plugins) ? value.plugins : Array.isArray(value) ? value : [];
    items.push(
      itemForFile(filePath, rootPath, {
        plugins: plugins
          .map((plugin) => plugin?.name ?? plugin?.id ?? null)
          .filter(Boolean)
          .sort(),
      }),
    );
  }
  return items;
}

function createSurface({ id, group, scope, type, label, path: surfacePath, items, exists }) {
  return {
    id,
    group,
    scope,
    type,
    label,
    path: surfacePath,
    exists,
    count: items.length,
    evidenceLevel: exists ? "configured" : "absent",
    items,
  };
}

async function collectSurface(definition) {
  const exists = await pathExists(definition.path);
  const items = exists ? await definition.collect(definition.path) : [];
  return createSurface({ ...definition, exists, items });
}

function memoryWorkspaceSlug(workspace) {
  return path.resolve(workspace)
    .replace(/^[A-Za-z]:/u, "")
    .replace(/[\\/]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function isMarkdownMemoryPath(filePath) {
  return /\.md$/iu.test(path.basename(filePath));
}

function createMemoryCategory(category, scope) {
  const entry = { category, scope, path: undefined, count: 0 };
  Object.defineProperty(entry, "titleEntries", {
    value: [],
    enumerable: false,
    writable: false,
  });
  return entry;
}

function addMemoryTitle(entry, filePath) {
  if (!isMarkdownMemoryPath(filePath)) return;
  entry.titleEntries.push({
    title: path.basename(filePath, path.extname(filePath)),
    path: filePath,
    scope: entry.scope,
    category: entry.category,
  });
}

async function collectMemoryCategories(rootPath, workspace, includeGlobal = false) {
  const files = await walkFiles(rootPath, {
    maxDepth: 8,
    limit: 10_000,
    match: (filePath) => !path.basename(filePath).startsWith("."),
  });
  const workspaceSlug = memoryWorkspaceSlug(workspace);
  const categories = new Map();
  for (const filePath of files.sort()) {
    const parts = path.relative(rootPath, filePath).split(path.sep);
    const scope = parts[1] === "global"
      ? "Global"
      : parts[1] === "projects" && parts[2] === workspaceSlug
        ? "Project"
        : undefined;
    if (!scope) continue;
    if (scope === "Global" && !includeGlobal) continue;
    const category = path.basename(path.dirname(filePath));
    const dir = path.dirname(filePath);
    const key = `${scope}:${dir}`;
    const current = categories.get(key) ?? createMemoryCategory(category, scope);
    current.count += 1;
    addMemoryTitle(current, filePath);
    // Keep the semantic category grouping, but expose one openable note file
    // instead of the parent directory so report sources stay directly usable.
    if (!current.path && isMarkdownMemoryPath(filePath)) current.path = filePath;
    categories.set(key, current);
  }
  return [...categories.values()].sort((a, b) => {
    const scopeDelta = (a.scope === "Project" ? 0 : 1) - (b.scope === "Project" ? 0 : 1);
    return scopeDelta || a.category.localeCompare(b.category) || String(a.path ?? "").localeCompare(String(b.path ?? ""));
  });
}

function primitiveConfigValue(value) {
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (value === null) {
    return null;
  }
  return "[non-primitive]";
}

async function collectMemoryConfig(sharedCache) {
  const configPath = path.join(sharedCache, "app-config.json");
  const config = await readJson(configPath).catch(() => null);
  if (!config || typeof config !== "object") {
    return [];
  }
  return Object.entries(config)
    .filter(([key]) => key.startsWith("memory.") || MEMORY_CONFIG_KEYS.has(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ({ key, value: primitiveConfigValue(value), path: configPath }));
}

async function collectMemoryDatabaseFiles(sharedCache) {
  const dbRoot = path.join(sharedCache, "db");
  const files = await walkFiles(dbRoot, {
    maxDepth: 1,
    limit: 100,
    match: (filePath) => /\.(db|db-wal|db-shm)$/u.test(path.basename(filePath)),
  });
  return files.map((filePath) => ({
    name: path.basename(filePath),
    path: filePath,
    relativePath: path.relative(sharedCache, filePath),
  }));
}

async function collectMemories(scope) {
  const rootPath = path.join(scope.qoderHome, "memories");
  const rootExists = await pathExists(rootPath);
  const sharedCacheExists = await pathExists(scope.sharedCache);
  return {
    included: scope.includeMemories,
    root: rootPath,
    rootExists,
    sharedCache: scope.sharedCache,
    sharedCacheExists,
    categories: rootExists
      ? await collectMemoryCategories(rootPath, scope.workspace, scope.includeUserHome)
      : [],
    configKeys: sharedCacheExists && scope.includeUserHome ? await collectMemoryConfig(scope.sharedCache) : [],
    databaseFiles: sharedCacheExists && scope.includeUserHome ? await collectMemoryDatabaseFiles(scope.sharedCache) : [],
    contentPolicy: "raw-memory-content-not-read",
  };
}

function parseTomlMemoryValue(value) {
  const normalized = value.trim().replace(/\s+#.*$/u, "");
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/u.test(normalized)) return Number(normalized);
  const quoted = normalized.match(/^"((?:[^"\\]|\\.)*)"$/u)?.[1];
  return quoted?.replace(/\\(["\\])/gu, "$1");
}

async function collectCodexMemoryConfig(codexHome) {
  const configPath = path.join(codexHome, "config.toml");
  const text = await readFile(configPath, "utf8").catch(() => null);
  if (typeof text !== "string") return [];

  let section = "";
  const entries = [];
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    const sectionMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/u);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    if (!line || line.startsWith("#")) continue;
    const assignment = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/u);
    if (!assignment) continue;
    const rawKey = assignment[1];
    const key = rawKey.includes(".") || !section ? rawKey : `${section}.${rawKey}`;
    if (!CODEX_MEMORY_CONFIG_KEYS.has(key)) continue;
    const value = parseTomlMemoryValue(assignment[2]);
    if (value === undefined) continue;
    entries.push({ key, value, path: configPath });
  }
  return entries.sort((left, right) => left.key.localeCompare(right.key));
}

async function collectCodexMemoryCategories(rootPath) {
  const files = await walkFiles(rootPath, {
    maxDepth: 8,
    limit: 10_000,
    match: (filePath) => !path.basename(filePath).startsWith("."),
  });
  const categories = new Map();
  for (const filePath of files.sort()) {
    const parts = path.relative(rootPath, filePath).split(path.sep);
    const category = parts.length > 1 ? parts[0] : "root";
    const current = categories.get(category) ?? createMemoryCategory(category, "Global");
    current.count += 1;
    addMemoryTitle(current, filePath);
    if (!current.path && isMarkdownMemoryPath(filePath)) current.path = filePath;
    categories.set(category, current);
  }
  return [...categories.values()].sort((left, right) => left.category.localeCompare(right.category));
}

async function collectCodexMemories(scope) {
  const codexHome = path.resolve(expandHome(scope.codexHome ?? "~/.codex"));
  const root = path.join(codexHome, "memories");
  const configPath = path.join(codexHome, "config.toml");
  const rootExists = await pathExists(root);
  const configExists = await pathExists(configPath);
  return {
    included: scope.includeMemories,
    root,
    rootExists,
    sharedCache: undefined,
    sharedCacheExists: configExists,
    categories: rootExists ? await collectCodexMemoryCategories(root) : [],
    configKeys: configExists ? await collectCodexMemoryConfig(codexHome) : [],
    databaseFiles: [],
    contentPolicy: "raw-memory-content-not-read",
  };
}

function makeSessionSourceHints(scope) {
  if (!["qoder", "codex", "claude", "cursor"].includes(scope.platform)) {
    return [];
  }
  return [
    {
      platform: scope.platform,
      evidenceLevel: "source-probe-command",
      command: `node scripts/session-analysis.mjs sources --platform ${scope.platform} --workspace ${scope.workspace} --format markdown`,
    },
  ];
}

function summarize(surfaces) {
  const present = (group) => surfaces.filter((surface) => surface.group === group && surface.exists).length;
  return {
    projectAssets: present("Project assets"),
    userAssets: present("User/global assets"),
    pluginAssets: present("Plugin/marketplace assets"),
    sessionSourceHints: present("Session observed behavior"),
    memories: present("Memories"),
  };
}

function publicScope(options = {}) {
  const workspace = normalizeWorkspace(options.workspace);
  const environmentHome = process.env.QODER_HOME;
  const environmentBase = path.basename(String(environmentHome ?? "")).toLowerCase();
  const environmentIsAssetHome = environmentBase === ".qoder" || environmentBase === "qoder";
  const qoderHome = path.resolve(expandHome(
    options.qoderHome ?? options["qoder-home"] ?? (environmentIsAssetHome ? environmentHome : "~/.qoder"),
  ));
  const explicitSharedCache = options.sharedCache ?? options["shared-cache"];
  const sharedCache = explicitSharedCache
    ? path.resolve(expandHome(explicitSharedCache))
    : environmentHome && !environmentIsAssetHome
      ? path.join(path.resolve(expandHome(environmentHome)), "cache")
      : defaultSharedCache();
  return {
    platform: "qoder",
    workspace,
    qoderHome,
    includeUserHome: normalizeBoolean(options.includeUserHome ?? options["include-user-home"] ?? false),
    includeMemories: normalizeBoolean(options.includeMemories ?? options["include-memories"] ?? false),
    sharedCache,
  };
}

function providerScope(options = {}, platform = options.platform ?? "qoder") {
  const workspace = normalizeWorkspace(options.workspace);
  const qoderHome = options.qoderHome ?? options["qoder-home"];
  const sharedCache = options.sharedCache ?? options["shared-cache"];
  const sharedClientCacheRoot = options.qoderSharedClientCacheRoot ??
    options["qoder-shared-client-cache-root"] ??
    (sharedCache && path.basename(sharedCache) === "cache" ? path.dirname(sharedCache) : sharedCache);
  return {
    platform,
    workspace,
    includeUserHome: normalizeBoolean(options.includeUserHome ?? options["include-user-home"] ?? false),
    includeGlobalHooks: normalizeBoolean(options.includeGlobalHooks ?? options["include-global-hooks"] ?? false),
    includeMemories: normalizeBoolean(options.includeMemories ?? options["include-memories"] ?? false),
    cursorHome: options.cursorHome ?? options["cursor-home"],
    qoderHome,
    sharedCache,
    qoderSharedClientCacheRoot: sharedClientCacheRoot,
    codexHome: options.codexHome ?? options["codex-home"],
    codexAppPath: options.codexAppPath ?? options["codex-app-path"],
    claudeHome: options.claudeHome ?? options["claude-home"],
    claudeStatePath: options.claudeStatePath ?? options["claude-state"] ?? options["claude-state-path"],
  };
}

function itemPath(item) {
  return item.evidence?.path ?? item.filePath ?? item.rootPath;
}

function pluginCapabilityFingerprint(item) {
  const entries = ["skills", "mcpServers", "rules", "commands", "subagents", "hooks"]
    .flatMap((collection) => (item?.[collection] ?? []).map((asset) => {
      const name = asset?.name ?? asset?.displayName ?? asset?.label ?? asset?.id ?? "unknown";
      return `${collection}:${String(name).normalize("NFKC").toLowerCase()}`;
    }))
    .sort();
  return {
    count: entries.length,
    fingerprint: entries.length > 0
      ? createHash("sha256").update(entries.join("\n")).digest("hex")
      : undefined,
  };
}

function customizeItem(item) {
  const itemName = item.displayName ?? item.name ?? item.label ?? item.id;
  const isPlugin = item.kind === "plugin"
    || ["skills", "mcpServers", "rules", "commands", "subagents", "hooks"].some((key) => Array.isArray(item?.[key]));
  const pluginCapabilities = isPlugin ? pluginCapabilityFingerprint(item) : null;
  return {
    id: item.id,
    name: itemName,
    path: itemPath(item),
    relativePath: item.evidence?.relativePath,
    sourceLabel: item.sourceLabel,
    kind: item.kind,
    sourceKind: item.sourceKind,
    precedence: item.precedence,
    scope: item.scope,
    pluginId: item.pluginId,
    pluginName: item.pluginName,
    pluginEnabled: item.pluginEnabled,
    canonicalName: isPlugin ? item.name : undefined,
    displayName: isPlugin ? item.displayName : undefined,
    version: isPlugin ? item.version : undefined,
    installSource: isPlugin ? item.installSource : undefined,
    capabilityCount: pluginCapabilities?.count,
    capabilityFingerprint: pluginCapabilities?.fingerprint,
    step: item.step,
    matcher: item.matcher,
    handlerType: item.handlerType,
    commandDisplay: item.commandDisplay,
    timeoutMs: item.timeoutMs,
    condition: item.condition,
    async: item.async,
    scriptPath: item.scriptPath,
    configurationDigest: item.configurationDigest,
    registrationIndex: item.registrationIndex,
    hookIndex: item.hookIndex,
  };
}

function scopeItems(inventory, collection, scope) {
  return (inventory.manage?.[collection] ?? [])
    .filter((item) => item.scope === scope)
    .map(customizeItem);
}

function pluginScopedItems(inventory, collection) {
  return (inventory.manage?.[collection] ?? [])
    .filter((item) => item.scope === "plugin" && item.pluginEnabled !== false)
    .map(customizeItem);
}

function customizeSurface({ provider, group, scope, type, label, basePath, items }) {
  return createSurface({
    id: `${scope}-${provider}-${type}`,
    group,
    scope,
    type,
    label,
    path: items[0]?.path ?? basePath,
    exists: items.length > 0,
    items,
  });
}

async function buildConfiguredAssetSurfaces(inventory, scope) {
  const provider = scope.platform;
  const projectBase = scope.workspace;
  const userBase = inventory.cursorHome ?? inventory.qoderHome ?? inventory.codexHome ?? inventory.claudeHome;
  const surfaceTypes = [
    ["skills", "skills", "Skills"],
    ["subagents", "agents", "Agents"],
    ["rules", "rules", "Rules"],
    ["commands", "commands", "Commands"],
    ["hooks", "hooks", "Hooks"],
    ["mcps", "mcps", "MCPs"],
  ];
  const surfaces = [];

  for (const [collection, type, label] of surfaceTypes) {
    const items = scopeItems(inventory, collection, "project");
    if (items.length > 0) {
      surfaces.push(customizeSurface({
        provider,
        group: "Project assets",
        scope: "project",
        type,
        label: `Project ${provider} ${label}`,
        basePath: projectBase,
        items,
      }));
    }
  }

  const projectWorkflows = await workflowItems(projectBase);
  if (projectWorkflows.length > 0) {
    surfaces.push(customizeSurface({
      provider,
      group: "Project assets",
      scope: "project",
      type: "workflows",
      label: `Project ${provider} Workflows`,
      basePath: projectBase,
      items: projectWorkflows,
    }));
  }

  if (scope.includeUserHome || scope.includeGlobalHooks) {
    for (const [collection, type, label] of surfaceTypes) {
      if (!scope.includeUserHome && collection !== "hooks") continue;
      const items = scopeItems(inventory, collection, "user");
      if (items.length > 0) {
        surfaces.push(customizeSurface({
          provider,
          group: "User/global assets",
          scope: "user",
          type,
          label: `User ${provider} ${label}`,
          basePath: userBase,
          items,
        }));
      }
    }
  }

  if (scope.includeUserHome) {
    const effectivePlugins = inventory.plugins.filter((plugin) => plugin.enabled !== false);
    if (effectivePlugins.length > 0) {
      surfaces.push(customizeSurface({
        provider,
        group: "Plugin/marketplace assets",
        scope: "plugin",
        type: "plugins",
        label: `${provider} enabled installed plugins`,
        basePath: userBase,
        items: effectivePlugins.map(customizeItem),
      }));
    }
    for (const [collection, type, label] of surfaceTypes) {
      const items = pluginScopedItems(inventory, collection);
      if (items.length > 0) {
        surfaces.push(customizeSurface({
          provider,
          group: "Plugin/marketplace assets",
          scope: "plugin",
          type,
          label: `${provider} plugin ${label}`,
          basePath: userBase,
          items,
        }));
      }
    }
  }

  return surfaces;
}

export async function collectProviderInventory(options = {}) {
  const platform = options.platform ?? "qoder";
  const scope = providerScope(options, platform);
  const inventory = options.inventory ?? await collectAgentCustomizeInventory({
    provider: platform,
    workspace: scope.workspace,
    cursorHome: scope.cursorHome,
    qoderHome: scope.qoderHome,
    qoderSharedClientCacheRoot: scope.qoderSharedClientCacheRoot,
    codexHome: scope.codexHome,
    codexAppPath: scope.codexAppPath,
    claudeHome: scope.claudeHome,
    claudeStatePath: scope.claudeStatePath,
    includeUserHome: scope.includeUserHome,
    includeGlobalHooks: scope.includeGlobalHooks,
  });
  const surfaces = await buildConfiguredAssetSurfaces(inventory, scope);
  const sessionSourceHints = makeSessionSourceHints(scope);
  surfaces.push(
    createSurface({
      id: "session-source-hints",
      group: "Session observed behavior",
      scope: "workspace",
      type: "sessions",
      label: "Workspace session source probe",
      path: scope.workspace,
      exists: sessionSourceHints.length > 0,
      items: sessionSourceHints,
    }),
  );
  const memories = platform === "codex" && scope.includeMemories
    ? await collectCodexMemories(scope)
    : {
        included: false,
        root: scope.qoderHome ? path.join(path.resolve(expandHome(scope.qoderHome)), "memories") : undefined,
        rootExists: false,
        sharedCache: scope.sharedCache,
        sharedCacheExists: false,
        categories: [],
        configKeys: [],
        databaseFiles: [],
        contentPolicy: "raw-memory-content-not-read",
      };
  if (memories.included) {
    surfaces.push(
      createSurface({
        id: "codex-memory-files",
        group: "Memories",
        scope: "user",
        type: "memories",
        label: "Codex generated memory file tree",
        path: memories.root,
        exists: memories.rootExists,
        items: memories.categories,
      }),
      createSurface({
        id: "codex-memory-config",
        group: "Memories",
        scope: "user",
        type: "memory-config",
        label: "Codex memory configuration",
        path: path.join(path.dirname(memories.root), "config.toml"),
        exists: memories.sharedCacheExists,
        items: memories.configKeys,
      }),
    );
  }
  return {
    scope,
    summary: summarize(surfaces),
    surfaces,
    sessionSourceHints,
    memories,
    customizeDiagnostics: inventory.diagnostics,
    warnings: scope.includeMemories && !["qoder", "codex"].includes(platform)
      ? [`Memory inventory is only implemented for qoder and codex; skipped ${platform} memories.`]
      : [],
  };
}

function boundedReportPath(filePath, workspace) {
  if (typeof filePath !== "string" || !filePath.trim()) return undefined;
  const absolute = path.resolve(filePath);
  const workspaceRelative = path.relative(workspace, absolute);
  if (workspaceRelative && !workspaceRelative.startsWith("..") && !path.isAbsolute(workspaceRelative)) {
    return workspaceRelative.split(path.sep).join("/");
  }
  if (!workspaceRelative) return ".";
  const homeRelative = path.relative(os.homedir(), absolute);
  if (homeRelative && !homeRelative.startsWith("..") && !path.isAbsolute(homeRelative)) {
    return `~/${homeRelative.split(path.sep).join("/")}`;
  }
  return undefined;
}

function practiceCoverageRows(surfaces, scope) {
  const definitions = [
    ["Rules", (surface) => surface.type === "rules" && surface.group !== "Plugin/marketplace assets"],
    ["Skills", (surface) => surface.type === "skills" && surface.group !== "Plugin/marketplace assets"],
    ["Hooks", (surface) => surface.type === "hooks" && surface.group !== "Plugin/marketplace assets"],
    ["Commands", (surface) => surface.type === "commands" && surface.group !== "Plugin/marketplace assets"],
    ["Custom Agents", (surface) => surface.type === "agents" && surface.group !== "Plugin/marketplace assets"],
    ["MCP", (surface) => surface.type === "mcps" && surface.group !== "Plugin/marketplace assets"],
    ["Workflows", (surface) => surface.type === "workflows"],
    ["Plugins", (surface) => surface.type === "plugins"],
  ];
  const rows = [];
  for (const [surfaceName, matches] of definitions) {
    const matchedSurfaces = surfaces.filter(matches);
    const items = matchedSurfaces.flatMap((surface) => surface.items ?? []);
    const uniqueItems = new Map();
    for (const item of items) {
      const itemPath = item.path ?? item.filePath ?? item.rootPath;
      const key = item.id ?? `${item.scope ?? ""}:${item.name ?? ""}:${itemPath ?? ""}`;
      if (!uniqueItems.has(key)) uniqueItems.set(key, item);
    }
    if (uniqueItems.size === 0) continue;
    const scopes = [...new Set(matchedSurfaces.map((surface) => {
      if (surface.group === "Plugin/marketplace assets" || surface.scope === "plugin") return "Plugin";
      if (surface.scope === "user") return "Global";
      return "Project";
    }))];
    const paths = [...new Set([...uniqueItems.values()]
      .map((item) => boundedReportPath(item.path ?? item.filePath ?? item.rootPath, scope.workspace))
      .filter(Boolean))].slice(0, 12);
    rows.push({ surface: surfaceName, scopes, count: uniqueItems.size, paths });
  }

  const memorySurfaces = surfaces.filter((surface) => surface.type === "memories");
  const memoryItems = memorySurfaces.flatMap((surface) => surface.items ?? []);
  const memoryCount = memoryItems.reduce((total, item) => total + (Number(item.count) || 0), 0);
  if (memoryCount > 0) {
    rows.push({
      surface: "Memories",
      scopes: ["Project", "Global"].filter((candidate) => memoryItems.some((item) => item.scope === candidate)),
      count: memoryCount,
      paths: [...new Set(memoryItems
        .map((item) => boundedReportPath(item.path, scope.workspace))
        .filter(Boolean))].slice(0, 12),
    });
  }
  return rows;
}

export async function collectQoderInventory(options = {}) {
  const scope = publicScope(options);
  const providerInventory = await collectProviderInventory({
    ...options,
    platform: "qoder",
    workspace: scope.workspace,
    qoderHome: scope.qoderHome,
    qoderSharedClientCacheRoot: path.basename(scope.sharedCache) === "cache"
      ? path.dirname(scope.sharedCache)
      : scope.sharedCache,
    includeUserHome: scope.includeUserHome,
  });
  const surfaces = [...providerInventory.surfaces];
  const memories = scope.includeMemories
    ? await collectMemories(scope)
    : {
        included: false,
        root: path.join(scope.qoderHome, "memories"),
        rootExists: false,
        sharedCache: scope.sharedCache,
        sharedCacheExists: false,
        categories: [],
        configKeys: [],
        databaseFiles: [],
        contentPolicy: "raw-memory-content-not-read",
      };

  if (scope.includeMemories) {
    surfaces.push(
      createSurface({
        id: "qoder-memory-files",
        group: "Memories",
        scope: "user",
        type: "memories",
        label: "Qoder memory file tree",
        path: memories.root,
        exists: memories.rootExists,
        items: memories.categories,
      }),
      createSurface({
        id: "qoder-memory-config",
        group: "Memories",
        scope: "user",
        type: "memory-config",
        label: "Qoder memory config and database",
        path: memories.sharedCache,
        exists: memories.sharedCacheExists,
        items: [...memories.configKeys, ...memories.databaseFiles],
      }),
    );
  }

  return {
    scope,
    summary: {
      ...summarize(surfaces),
      practiceCoverageRows: practiceCoverageRows(surfaces, scope),
    },
    surfaces,
    sessionSourceHints: providerInventory.sessionSourceHints,
    memories,
    customizeDiagnostics: providerInventory.customizeDiagnostics,
    warnings: [],
  };
}

function markdownTable(rows, columns) {
  const header = `| ${columns.map((column) => column.label).join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${columns.map((column) => String(column.value(row) ?? "")).join(" | ")} |`);
  return [header, divider, ...body].join("\n");
}

export function formatInventoryMarkdown(result) {
  const lines = ["# Coding Agent Asset Inventory", ""];
  lines.push(`Workspace: ${result.scope.workspace}`);
  lines.push(`Platform: ${result.scope.platform}`);
  if (result.scope.qoderHome) {
    lines.push(`Qoder home: ${result.scope.qoderHome}`);
  }
  if (result.scope.codexHome) {
    lines.push(`Codex home: ${result.scope.codexHome}`);
  }
  if (result.scope.cursorHome) {
    lines.push(`Cursor home: ${result.scope.cursorHome}`);
  }
  lines.push("");
  lines.push(
    markdownTable(result.surfaces, [
      { label: "Group", value: (row) => row.group },
      { label: "Surface", value: (row) => row.label },
      { label: "Exists", value: (row) => row.exists },
      { label: "Count", value: (row) => row.count },
      { label: "Evidence", value: (row) => row.evidenceLevel },
      { label: "Path", value: (row) => row.path },
    ]),
  );
  const practiceRows = result.summary.practiceCoverageRows ?? [];
  if (practiceRows.length > 0) {
    lines.push("");
    lines.push("## Report Coverage Rows");
    lines.push(
      markdownTable(practiceRows, [
        { label: "Surface", value: (row) => row.surface },
        { label: "Count", value: (row) => row.count },
        { label: "Paths", value: (row) => row.paths.join(", ") },
      ]),
    );
  }
  if (result.memories.included) {
    lines.push("");
    lines.push("## Memories");
    lines.push(`Content policy: ${result.memories.contentPolicy}`);
    lines.push(`Categories: ${result.memories.categories.map((item) => item.category).join(", ") || "none"}`);
    lines.push(`Config keys: ${result.memories.configKeys.map((item) => item.key).join(", ") || "none"}`);
    lines.push(`Database files: ${result.memories.databaseFiles.map((item) => item.relativePath).join(", ") || "none"}`);
  }
  return `${lines.join("\n")}\n`;
}

const USAGE = `Usage: better-harness coding-agent-practices inventory [qoder|codex|claude|cursor] [options]

Inspect configured coding-agent assets and practice evidence for one platform.

Options:
  --platform <qoder|codex|claude|cursor>  Select the platform (default: qoder; may also be the first positional)
  --workspace <dir>                Workspace root to inspect (default: current directory)
  --json                           Emit JSON (default)
  --format <json|markdown>         Output format
  --include-user-home              Include user/global assets
  --include-memories               Include Qoder or Codex memory metadata
  --claude-home <dir>              Claude config root override
  --claude-state <file>            Claude state-file override
  -h, --help                       Print this help
`;

function wantsHelp(argv) {
  return argv.includes("-h") || argv.includes("--help");
}

async function runCli(argv) {
  if (wantsHelp(argv)) {
    process.stdout.write(USAGE);
    return;
  }
  const { command, options } = parseArgs(argv);
  const platform = options.platform ?? command ?? "qoder";
  if (!["cursor", "qoder", "codex", "claude"].includes(platform)) {
    throw new Error(
      `Unsupported platform: ${platform}. Supported platforms: cursor, qoder, codex, claude.\n\n${USAGE}`,
    );
  }
  const result = platform === "qoder"
    ? await collectQoderInventory({ ...options, platform })
    : await collectProviderInventory({ ...options, platform });
  const format = options.json ? "json" : options.format ?? "json";
  if (format === "markdown") {
    process.stdout.write(formatInventoryMarkdown(result));
    return;
  }
  if (format !== "json") {
    throw new Error(`Unsupported format: ${format}. Supported formats: json, markdown.`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
