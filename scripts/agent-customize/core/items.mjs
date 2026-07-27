import { createHash } from "node:crypto";
import { readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { pathExists, walkFiles } from "../../session-analysis/fs.mjs";
import { SCOPE_TITLES, TAB_TO_COLLECTION } from "../constants.mjs";

const TEXT_FILE_EXTENSIONS = new Set([".md", ".mdc"]);
const MCP_CONFIG_NAMES = ["mcp.json", ".mcp.json"];

export function sortByName(left, right) {
  return (left.displayName ?? left.name ?? "").localeCompare(right.displayName ?? right.name ?? "", undefined, {
    sensitivity: "base",
  });
}

function ruleSourceRank(item) {
  if (item.sourceKind === "design-md-contract") {
    return 30;
  }
  if (item.sourceKind === "agents-md-compat" || item.precedence === "after-qoder-rules") {
    return 20;
  }
  return 10;
}

export function sortRules(left, right) {
  const sourceDelta = ruleSourceRank(left) - ruleSourceRank(right);
  return sourceDelta || sortByName(left, right);
}

export function withoutExtension(filePath) {
  const base = path.basename(filePath);
  const extension = path.extname(base);
  return extension ? base.slice(0, -extension.length) : base;
}

export function titleCase(value) {
  return value
    .trim()
    .split(/[\s_-]+/u)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function normalizePluginDisplayName(value, fallback) {
  const raw = String(value || fallback || "").trim();
  if (!raw) {
    return raw;
  }
  return raw
    .replace(/\s+MCP\s+(?:Plugin|Server)$/iu, "")
    .replace(/\s+Desktop$/iu, "")
    .trim();
}

export async function readText(filePath, maxChars = 24_000) {
  try {
    const text = await readFile(filePath, "utf8");
    return text.slice(0, maxChars);
  } catch {
    return "";
  }
}

export async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

export function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/u);
  if (!match) {
    return {};
  }
  const metadata = {};
  const lines = match[1].split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const keyValue = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/u);
    if (!keyValue) continue;
    const marker = keyValue[2].trim();
    if (!/^[>|][+-]?$/u.test(marker)) {
      metadata[keyValue[1]] = marker.replace(/^["']|["']$/gu, "");
      continue;
    }
    const block = [];
    while (index + 1 < lines.length && (lines[index + 1].trim() === "" || /^\s+/u.test(lines[index + 1]))) {
      index += 1;
      block.push(lines[index].replace(/^\s+/u, "").trimEnd());
    }
    metadata[keyValue[1]] = marker.startsWith(">")
      ? block.join(" ").replace(/\s+/gu, " ").trim()
      : block.join("\n").trim();
  }
  return metadata;
}

export async function readMarkdownName(filePath, fallback, options = {}) {
  const text = await readText(filePath);
  const metadata = parseFrontmatter(text);
  const heading = options.useHeading ? text.match(/^#\s+(.+)$/mu)?.[1]?.trim() : undefined;
  return {
    name: metadata.name || heading || fallback,
    description: metadata.description || "",
  };
}

export async function listDirectories(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => path.join(root, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

export function evidence(filePath, root) {
  return {
    path: filePath,
    relativePath: root ? path.relative(root, filePath) : undefined,
  };
}

export async function pluginMetadataEvidencePath(pluginRoot, relativeCandidates) {
  for (const segments of relativeCandidates) {
    const candidate = path.join(pluginRoot, ...segments);
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return pluginRoot;
}

export async function collectSkillFiles(root, scope, sourceLabel, rootForEvidence = root) {
  if (!(await pathExists(root))) {
    return [];
  }
  const files = await walkFiles(root, {
    maxDepth: 5,
    limit: 5000,
    match: (filePath) => path.basename(filePath) === "SKILL.md",
  });
  const items = [];
  for (const filePath of files) {
    const fallback = path.basename(path.dirname(filePath));
    const metadata = await readMarkdownName(filePath, fallback, { useHeading: true });
    items.push({
      id: `${scope}:${filePath}`,
      kind: "skill",
      scope,
      sourceLabel,
      filePath,
      name: fallback,
      declaredName: metadata.name && metadata.name !== fallback ? metadata.name : undefined,
      description: metadata.description,
      evidence: evidence(filePath, rootForEvidence),
    });
  }
  return items.sort(sortByName);
}

export async function collectMarkdownItems(root, kind, scope, sourceLabel, rootForEvidence = root) {
  if (!(await pathExists(root))) {
    return [];
  }
  const files = await walkFiles(root, {
    maxDepth: 4,
    limit: 5000,
    match: (filePath) => TEXT_FILE_EXTENSIONS.has(path.extname(filePath)),
  });
  const items = [];
  for (const filePath of files) {
    const fallback = withoutExtension(filePath);
    const metadata = await readMarkdownName(filePath, fallback);
    items.push({
      id: `${scope}:${kind}:${filePath}`,
      kind,
      scope,
      sourceLabel,
      filePath,
      ...metadata,
      evidence: evidence(filePath, rootForEvidence),
    });
  }
  return items.sort(sortByName);
}

export async function uniqueAssetsByRealPath(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const filePath = item.filePath ?? item.evidence?.path;
    const key = filePath
      ? await realpath(filePath).catch(() => path.resolve(filePath))
      : item.id;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export async function collectMarkdownRuleItems(root, scope, sourceLabel, rootForEvidence = root, options = {}) {
  return (await collectMarkdownItems(root, "rule", scope, sourceLabel, rootForEvidence))
    .map((item) => ({
      ...item,
      sourceKind: options.sourceKind ?? item.sourceKind,
      precedence: options.precedence ?? item.precedence,
    }))
    .sort(sortRules);
}

export async function collectMarkdownFileRuleItem(filePath, scope, sourceLabel, rootForEvidence, options = {}) {
  if (options.exactName) {
    try {
      const entries = await readdir(path.dirname(filePath));
      if (!entries.includes(path.basename(filePath))) return [];
    } catch {
      return [];
    }
  }
  if (!(await pathExists(filePath))) {
    return [];
  }
  const fallback = options.name ?? withoutExtension(filePath);
  const metadata = await readMarkdownName(filePath, fallback, { useHeading: options.useHeading });
  return [
    {
      id: `${scope}:rule:${filePath}`,
      kind: "rule",
      scope,
      sourceLabel,
      filePath,
      name: options.name ?? metadata.name,
      declaredName: metadata.name && metadata.name !== fallback ? metadata.name : undefined,
      description: metadata.description,
      sourceKind: options.sourceKind,
      precedence: options.precedence,
      evidence: evidence(filePath, rootForEvidence),
    },
  ];
}

export function agentsMarkdownRuleSource(workspace, sourceLabel, precedence = "after-provider-rules") {
  return {
    type: "file",
    filePath: path.join(workspace, "AGENTS.md"),
    scope: "project",
    sourceLabel,
    rootForEvidence: workspace,
    name: "AGENTS.md",
    sourceKind: "agents-md-compat",
    precedence,
    useHeading: true,
  };
}

export function designMarkdownRuleSource(workspace, sourceLabel, precedence = "after-agents-md") {
  return {
    type: "file",
    filePath: path.join(workspace, "DESIGN.md"),
    scope: "project",
    sourceLabel,
    rootForEvidence: workspace,
    name: "DESIGN.md",
    sourceKind: "design-md-contract",
    precedence,
    useHeading: false,
    exactName: true,
  };
}

export function directoryRuleSource(root, scope, sourceLabel, rootForEvidence, options = {}) {
  return {
    type: "directory",
    root,
    scope,
    sourceLabel,
    rootForEvidence,
    sourceKind: options.sourceKind,
    precedence: options.precedence,
  };
}

export async function collectRuleSources(sources) {
  const items = [];
  for (const source of sources) {
    if (source.type === "file") {
      items.push(
        ...(await collectMarkdownFileRuleItem(
          source.filePath,
          source.scope,
          source.sourceLabel,
          source.rootForEvidence,
          source,
        )),
      );
    } else {
      items.push(
        ...(await collectMarkdownRuleItems(
          source.root,
          source.scope,
          source.sourceLabel,
          source.rootForEvidence,
          source,
        )),
      );
    }
  }
  return items.sort(sortRules);
}

function normalizeHookEventName(name) {
  return name
    .replace(/([a-z])([A-Z])/gu, "$1 $2")
    .replace(/[_-]+/gu, " ")
    .trim();
}

function hookCommandTokens(command) {
  return String(command ?? "").match(/"[^"]*"|'[^']*'|\S+/gu)?.map((token) =>
    token.replace(/^["']|["']$/gu, "")
  ) ?? [];
}

function hookCommandToken(value) {
  const token = String(value ?? "");
  if (/^(?:\$\{?[A-Z0-9_]+\}?|%[A-Z0-9_]+%)[\\/]/iu.test(token)) {
    return token.split(/[\\/]/u).filter(Boolean).at(-1) ?? token;
  }
  if (/^(?:[A-Za-z]:[\\/]|[\\/])/u.test(token)) {
    return token.split(/[\\/]/u).filter(Boolean).at(-1) ?? token;
  }
  return token;
}

function sanitizeHookCommand(command) {
  const tokens = hookCommandTokens(command);
  if (tokens.length === 0) return undefined;
  const executable = hookCommandToken(tokens[0]).toLowerCase();
  if (["node", "python", "python3", "bash", "sh", "zsh", "ruby", "powershell", "pwsh", "cmd"].includes(executable)) {
    const script = tokens.slice(1).find((token) => /\.(?:c?m?js|ts|py|sh|rb|ps1|cmd|bat)$/iu.test(token));
    return script ? `${executable} ${hookCommandToken(script)}` : executable;
  }
  if (executable === "npx" && tokens[1]) {
    return `npx ${hookCommandToken(tokens[1])}`;
  }
  return executable;
}

function sanitizeHookCondition(value) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value
    .replace(/"[^"]*"|'[^']*'/gu, "<value>")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 200);
}

function orderedJson(value) {
  if (Array.isArray(value)) return value.map(orderedJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, orderedJson(value[key])]),
    );
  }
  return value;
}

export function hookConfigurationDigest(event, record, hook) {
  const recordContext = record && typeof record === "object" && !Array.isArray(record)
    ? Object.fromEntries(Object.entries(record).filter(([key]) => key !== "hooks"))
    : record;
  return createHash("sha256")
    .update(JSON.stringify(orderedJson({ event, record: recordContext, hook })))
    .digest("hex");
}

function projectHookScriptPath(command, rootForEvidence, options = {}) {
  if (!rootForEvidence) return undefined;
  const script = hookCommandTokens(command)
    .find((token) => /\.(?:c?m?js|ts|py|sh|rb|ps1|cmd|bat)$/iu.test(token));
  if (!script) return undefined;
  const root = path.resolve(options.projectDirRoot ?? rootForEvidence);
  const variables = options.projectDirVariables ?? ["QODER_PROJECT_DIR"];
  const variableRoots = options.projectDirVariableRoots ?? {};
  let expanded = script;
  for (const variable of variables) {
    const variableRoot = path.resolve(variableRoots[variable] ?? root);
    if (expanded.startsWith(`\${${variable}}`)) expanded = `${variableRoot}${expanded.slice(variable.length + 3)}`;
    else if (expanded.startsWith(`$${variable}`)) expanded = `${variableRoot}${expanded.slice(variable.length + 1)}`;
    else if (expanded.toLowerCase().startsWith(`%${variable}%`.toLowerCase())) {
      expanded = `${variableRoot}${expanded.slice(variable.length + 2)}`;
    }
  }
  if (expanded.includes("$") || expanded.includes("%")) return undefined;
  const target = path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(root, expanded);
  const allowedRoots = (options.scriptRoots ?? [root]).map((value) => path.resolve(value));
  return allowedRoots.some((allowedRoot) => {
    const relative = path.relative(allowedRoot, target);
    return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  }) ? target : undefined;
}

function finiteHookTimeout(...values) {
  const value = values.find((item) => Number.isFinite(Number(item)));
  return value === undefined ? undefined : Number(value);
}

function normalizedHookTimeout(hook, record, options = {}) {
  const explicitMilliseconds = finiteHookTimeout(
    hook?.timeoutMs,
    hook?.timeout_ms,
    record?.timeoutMs,
    record?.timeout_ms,
  );
  if (explicitMilliseconds !== undefined) return explicitMilliseconds;
  const rawTimeout = finiteHookTimeout(hook?.timeout, record?.timeout);
  if (rawTimeout === undefined) return undefined;
  return rawTimeout * (options.timeoutUnit === "seconds" ? 1000 : 1);
}

export function collectHooksFromConfig(config, context, options = {}) {
  const { filePath, scope, sourceLabel, rootForEvidence } = context;
  const hooks = config?.hooks;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) {
    return [];
  }
  const items = [];
  for (const [step, value] of Object.entries(hooks)) {
    const records = Array.isArray(value) ? value : [value];
    records.forEach((record, index) => {
      const nestedHooks = Array.isArray(record?.hooks) ? record.hooks : [record];
      nestedHooks.forEach((hook, hookIndex) => {
        const label =
          typeof hook?.label === "string" && hook.label.trim()
            ? hook.label.trim()
            : typeof hook?.name === "string" && hook.name.trim()
              ? hook.name.trim()
              : typeof record?.label === "string" && record.label.trim()
                ? record.label.trim()
                : typeof record?.name === "string" && record.name.trim()
                  ? record.name.trim()
                  : record?.matcher
                    ? `${normalizeHookEventName(step)} ${record.matcher}`
                    : normalizeHookEventName(step);
        const command = typeof hook?.command === "string" ? hook.command : undefined;
        const asyncState = typeof hook?.async === "boolean"
          ? hook.async
          : typeof record?.async === "boolean"
            ? record.async
            : undefined;
        items.push({
          id: `${scope}:hook:${filePath}:${step}:${index}:${hookIndex}`,
          kind: "hook",
          scope,
          sourceLabel,
          step,
          label,
          matcher: typeof record?.matcher === "string" ? record.matcher : undefined,
          handlerType: typeof hook?.type === "string" ? hook.type : command ? "command" : "unknown",
          command: options.includeCommand === false ? undefined : command,
          commandDisplay: sanitizeHookCommand(command),
          configurationDigest: hookConfigurationDigest(step, record, hook),
          scriptPath: projectHookScriptPath(command, rootForEvidence, options),
          timeoutMs: normalizedHookTimeout(hook, record, options),
          condition: sanitizeHookCondition(hook?.if ?? record?.if),
          async: asyncState,
          registrationIndex: index,
          hookIndex,
          filePath,
          evidence: evidence(filePath, rootForEvidence),
        });
      });
    });
  }
  return items.sort(sortByName);
}

export async function collectHooksFromFile(filePath, scope, sourceLabel, rootForEvidence, options = {}) {
  const config = await readJson(filePath);
  return collectHooksFromConfig(config, { filePath, scope, sourceLabel, rootForEvidence }, options);
}

export async function collectHookItems(root, scope, sourceLabel, rootForEvidence = root) {
  const candidates = [path.join(root, "hooks.json")];
  const hooksDir = path.join(root, "hooks");
  if (await pathExists(hooksDir)) {
    const files = await walkFiles(hooksDir, {
      maxDepth: 2,
      limit: 500,
      match: (filePath) => path.extname(filePath) === ".json",
    });
    candidates.push(...files);
  }
  const items = [];
  for (const filePath of candidates) {
    if (await pathExists(filePath)) {
      items.push(...(await collectHooksFromFile(filePath, scope, sourceLabel, rootForEvidence)));
    }
  }
  return items.sort(sortByName);
}

export function normalizeMcpServer(name, value, context) {
  const server = value && typeof value === "object" ? value : {};
  const disabled = server.enabled === false || server.disabled === true;
  const parseError = value === null || typeof value !== "object" || Array.isArray(value);
  const args = Array.isArray(server.args) ? server.args.filter((arg) => typeof arg === "string") : [];
  const env = server.env && typeof server.env === "object" && !Array.isArray(server.env) ? server.env : {};
  const envKeys = Object.keys(env).sort();
  const directSecretEnvKeys = envKeys.filter((key) => {
    if (!/(?:token|secret|password|credential|api[_-]?key)/iu.test(key)) {
      return false;
    }
    const envValue = env[key];
    if (typeof envValue !== "string" || envValue.trim() === "") {
      return false;
    }
    return !/^(?:\$\{?[A-Z0-9_]+\}?|env:|process\.env\.)/iu.test(envValue.trim());
  });
  return {
    id: `${context.scope}:mcp:${context.filePath}:${name}`,
    kind: "mcp",
    name,
    scope: context.scope,
    sourceLabel: context.sourceLabel,
    filePath: context.filePath,
    type: typeof server.type === "string" ? server.type : undefined,
    command: typeof server.command === "string" ? server.command : undefined,
    args,
    url: typeof server.url === "string" ? server.url : undefined,
    envKeys,
    directSecretEnvKeys,
    enabled: !disabled,
    needsAttention: parseError,
    statusGroup: parseError ? "needsAttention" : "installed",
    evidence: evidence(context.filePath, context.rootForEvidence),
  };
}

export function collectMcpFromValue(servers, scope, sourceLabel, filePath, rootForEvidence) {
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    return [];
  }
  return Object.entries(servers)
    .map(([name, value]) =>
      normalizeMcpServer(name, value, { scope, sourceLabel, filePath, rootForEvidence }),
    )
    .sort(sortByName);
}

export async function collectMcpFromConfig(filePath, scope, sourceLabel, rootForEvidence) {
  const config = await readJson(filePath);
  const servers = config?.mcpServers ?? config;
  return collectMcpFromValue(servers, scope, sourceLabel, filePath, rootForEvidence);
}

export async function collectMcpItems(root, scope, sourceLabel, rootForEvidence = root) {
  const items = [];
  for (const configName of MCP_CONFIG_NAMES) {
    const filePath = path.join(root, configName);
    if (await pathExists(filePath)) {
      items.push(...(await collectMcpFromConfig(filePath, scope, sourceLabel, rootForEvidence)));
    }
  }
  return items.sort(sortByName);
}

export async function countJsonFiles(root) {
  if (!(await pathExists(root))) {
    return 0;
  }
  const files = await walkFiles(root, {
    maxDepth: 1,
    limit: 5000,
    match: (filePath) => path.extname(filePath) === ".json",
  });
  return files.length;
}

export async function collectJsonAssetNames(root) {
  if (!(await pathExists(root))) {
    return [];
  }
  const files = await walkFiles(root, {
    maxDepth: 1,
    limit: 5000,
    match: (filePath) => path.extname(filePath) === ".json",
  });
  const names = [];
  for (const filePath of files) {
    const value = await readJson(filePath);
    const name = typeof value?.name === "string" && value.name.trim()
      ? value.name.trim()
      : path.basename(filePath, ".json");
    names.push(name);
  }
  return [...new Set(names)].sort((left, right) => left.localeCompare(right));
}

export function runtimeStatusGroup(statusText, toolCount, resourceCount) {
  const status = statusText.toLowerCase();
  if (status.includes("needs authentication") || status.includes("errored")) {
    return "needsAttention";
  }
  return toolCount > 0 || resourceCount > 0 ? "connected" : "installed";
}

export function runtimeMcpRank(item) {
  if (item.statusGroup === "connected") {
    return 3;
  }
  if (item.sourceKind === "runtime-plugin" || item.sourceKind === "runtime-mcp") {
    return 2;
  }
  return 1;
}

export function mergeMcpItems(items) {
  const byKey = new Map();
  for (const item of items) {
    const key = `${item.scope ?? "other"}:${item.name ?? item.id}`;
    const existing = byKey.get(key);
    if (!existing || runtimeMcpRank(item) > runtimeMcpRank(existing)) {
      byKey.set(key, item);
    }
  }
  return [...byKey.values()].sort(sortByName);
}

function repoSlugFromRemoteUrl(url) {
  const cleaned = String(url || "")
    .trim()
    .replace(/^git@[^:]+:/u, "")
    .replace(/^https?:\/\/[^/]+\//u, "")
    .replace(/^ssh:\/\/git@[^/]+\//u, "")
    .replace(/\.git$/u, "");
  const parts = cleaned.split("/").filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join("/") : "";
}

export async function workspaceSourceLabel(workspace) {
  const config = await readText(path.join(workspace, ".git", "config"), 12_000);
  const origin = config.match(/^\s*url\s*=\s*(.+)$/mu)?.[1];
  const slug = repoSlugFromRemoteUrl(origin);
  return slug || path.basename(workspace);
}

export async function collectWorkspaceRootPrimitives(root, sourceLabel, workspace) {
  return {
    skills: await collectSkillFiles(path.join(root, "skills"), "project", sourceLabel, workspace),
    subagents: await collectMarkdownItems(path.join(root, "agents"), "subagent", "project", sourceLabel, workspace),
    rules: await collectRuleSources([directoryRuleSource(path.join(root, "rules"), "project", sourceLabel, workspace)]),
    commands: await collectMarkdownItems(path.join(root, "commands"), "command", "project", sourceLabel, workspace),
    hooks: await collectHookItems(root, "project", sourceLabel, workspace),
    mcps: await collectMcpItems(root, "project", sourceLabel, workspace),
  };
}

export function mergePrimitiveSets(sets) {
  return {
    skills: sets.flatMap((set) => set.skills),
    subagents: sets.flatMap((set) => set.subagents),
    rules: sets.flatMap((set) => set.rules),
    commands: sets.flatMap((set) => set.commands),
    hooks: sets.flatMap((set) => set.hooks),
    mcps: sets.flatMap((set) => set.mcps),
  };
}

export function flattenPlugins(plugins, key) {
  return plugins.flatMap((plugin) =>
    (plugin[key] ?? []).map((item) => ({
      ...item,
      pluginId: plugin.id,
      pluginName: plugin.name,
      pluginEnabled: plugin.enabled,
      sourceLabel: plugin.displayName,
    })),
  );
}

export function buildManageCollections(plugins, user, project) {
  return {
    plugins: plugins.map((plugin) => ({ kind: "plugin", ...plugin })),
    mcps: mergeMcpItems([...user.mcps, ...project.mcps, ...flattenPlugins(plugins, "mcpServers")]),
    skills: [...user.skills, ...project.skills, ...flattenPlugins(plugins, "skills")].sort(sortByName),
    subagents: [...user.subagents, ...project.subagents, ...flattenPlugins(plugins, "subagents")].sort(sortByName),
    rules: [...user.rules, ...project.rules, ...flattenPlugins(plugins, "rules")].sort(sortRules),
    commands: [...user.commands, ...project.commands, ...flattenPlugins(plugins, "commands")].sort(sortByName),
    hooks: [...user.hooks, ...project.hooks, ...flattenPlugins(plugins, "hooks")].sort(sortByName),
  };
}

export function tabAvailableForScope(tab, scopeKind = "user") {
  if (["plugins", "mcps", "rules", "commands"].includes(tab)) {
    return true;
  }
  if (["skills", "agents", "hooks"].includes(tab)) {
    return scopeKind === "user" || scopeKind === "workspace" || scopeKind === "project";
  }
  return false;
}

function allowedSourceScopes(scopeKind = "user", tab = "plugins") {
  if (scopeKind === "team") {
    return tab === "mcps" ? new Set(["team", "dashboard"]) : new Set(["team"]);
  }
  if (scopeKind === "workspace" || scopeKind === "project") {
    return new Set(["project"]);
  }
  return new Set(["user", "plugin"]);
}

function pluginMatchesScope(plugin, sourceScopes) {
  const installSources = Array.isArray(plugin.installSources) && plugin.installSources.length > 0
    ? plugin.installSources
    : [plugin.installSource ?? "user"];
  return installSources.some((source) => sourceScopes.has(source));
}

export function filterManageItems(inventory, options = {}) {
  const tab = options.tab ?? "plugins";
  const query = (options.query ?? "").trim().toLowerCase();
  const collection = TAB_TO_COLLECTION[tab];
  if (!collection) {
    return [];
  }
  const values = collection === "plugins" ? inventory.plugins : inventory.manage[collection] ?? [];
  const sourceScopes = options.scopeKind ? allowedSourceScopes(options.scopeKind, tab) : undefined;
  return values.filter((item) => {
    if (sourceScopes && collection === "plugins" && !pluginMatchesScope(item, sourceScopes)) {
      return false;
    }
    if (sourceScopes && collection !== "plugins" && !sourceScopes.has(item.scope ?? "other")) {
      return false;
    }
    if (!query) {
      return true;
    }
    if (tab === "plugins") {
      return (item.displayName ?? "").toLowerCase().includes(query);
    }
    if (tab === "mcps") {
      return (item.name ?? "").toLowerCase().includes(query);
    }
    if (tab === "hooks") {
      return `${item.step ?? ""} ${item.label ?? ""}`.toLowerCase().includes(query);
    }
    return (item.name ?? "").toLowerCase().includes(query);
  });
}

function scopeTitle(scope) {
  return SCOPE_TITLES[scope] ?? SCOPE_TITLES.other;
}

export function groupManageItems(items, options = {}) {
  if (options.tab === "plugins") {
    return items.length > 0 ? [{ key: "plugins", title: "Installed", items }] : [];
  }
  if (options.tab === "mcps" && options.groupBy !== "scope") {
    const needsAttention = items.filter((item) => item.needsAttention);
    const connected = items.filter((item) => !item.needsAttention && item.statusGroup === "connected");
    const installed = items.filter((item) => !item.needsAttention && item.statusGroup !== "connected");
    return [
      needsAttention.length > 0 ? { key: "needs-attention", title: "Needs Attention", items: needsAttention } : null,
      connected.length > 0 ? { key: "connected", title: "Connected", items: connected } : null,
      installed.length > 0 ? { key: "installed", title: "Installed", items: installed } : null,
    ].filter(Boolean);
  }
  if (options.groupBy !== "scope") {
    const bySource = new Map();
    for (const item of items) {
      const source = item.sourceLabel ?? scopeTitle(item.scope ?? "other");
      const group = bySource.get(source) ?? [];
      group.push(item);
      bySource.set(source, group);
    }
    return [...bySource.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([source, group]) => ({
        key: `source:${source}`,
        title: source,
        items: group.sort(sortByName),
      }));
  }
  const byScope = new Map();
  for (const item of items) {
    const scope = item.scope ?? "other";
    const group = byScope.get(scope) ?? [];
    group.push(item);
    byScope.set(scope, group);
  }
  return [...byScope.entries()].map(([scope, group]) => ({
    key: `scope:${scope}`,
    title: scopeTitle(scope),
    items: group.sort(sortByName),
  }));
}
