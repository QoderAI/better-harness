/**
 * OpenBitFun (BitFun) configured-asset inventory.
 *
 * Three storage families, kept separate on purpose:
 * - product home: OPENBITFUN_HOME or ~/.openbitfun
 * - user root: OPENBITFUN_USER_ROOT or the platform config dir + openbitfun
 * - project root: <workspace>/.openbitfun
 *
 * Only surfaces BitFun reads natively (plus the shared .agents/skills root) are
 * inventoried. Plugin packages and compatibility skill roots owned by other
 * hosts are reported as unsupported instead of being copied into this scope.
 */
import os from "node:os";
import path from "node:path";

import { expandHome, normalizeWorkspace, pathExists } from "../../session-analysis/index.mjs";
import { MANAGE_TABS } from "../constants.mjs";
import {
  agentsMarkdownRuleSource,
  buildManageCollections,
  collectHookItems,
  collectMarkdownItems,
  collectMcpFromValue,
  collectRuleSources,
  collectSkillFiles,
  directoryRuleSource,
  readJson,
  sortByName,
  workspaceSourceLabel,
} from "../core/items.mjs";

const NATIVE_HIDDEN_DIR = ".openbitfun";
const NATIVE_DATA_NAMESPACE = "openbitfun";

const COMPAT_INSTRUCTION_FILES = ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"];

export function defaultBitfunHome() {
  return process.env.OPENBITFUN_HOME ?? path.join(os.homedir(), NATIVE_HIDDEN_DIR);
}

function platformConfigRoot() {
  if (process.platform === "win32") {
    return process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support");
  }
  return process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
}

function platformDataRoot() {
  if (process.platform === "win32") {
    return process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support");
  }
  return process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
}

export function defaultBitfunUserRoot() {
  return process.env.OPENBITFUN_USER_ROOT
    ?? path.join(platformConfigRoot(), NATIVE_DATA_NAMESPACE);
}

export function defaultBitfunUserSkillsDir(userRoot = defaultBitfunUserRoot()) {
  // macOS resolves the user root and the user skills dir to the same directory.
  if (process.platform === "darwin") return path.join(userRoot, "skills");
  return path.join(platformDataRoot(), NATIVE_DATA_NAMESPACE, "skills");
}

/**
 * app.json stores MCP servers as snake_case `mcp_servers` whose value is
 * `{ "mcpServers": { ... } }`. Accept a bare server map as well so a
 * hand-edited file stays readable instead of silently disappearing.
 */
export function bitfunMcpServersFromAppConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const section = config.mcp_servers ?? config.mcpServers;
  if (!section || typeof section !== "object" || Array.isArray(section)) return null;
  const servers = section.mcpServers ?? section;
  return servers && typeof servers === "object" && !Array.isArray(servers) ? servers : null;
}

async function collectBitfunMcps(appConfigPath, scope, sourceLabel, rootForEvidence) {
  const config = await readJson(appConfigPath);
  const servers = bitfunMcpServersFromAppConfig(config);
  if (!servers) return [];
  return collectMcpFromValue(servers, scope, sourceLabel, appConfigPath, rootForEvidence);
}

function isInsideRoot(filePath, root) {
  if (!filePath) return false;
  const relative = path.relative(root, filePath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function emptyPrimitives() {
  return { skills: [], subagents: [], rules: [], commands: [], hooks: [], mcps: [] };
}

async function collectBitfunUserPrimitives({ userRoot, userSkillsDir, includeUserHome }) {
  if (!includeUserHome) return emptyPrimitives();
  const configDir = path.join(userRoot, "config");
  const builtinSkillsDir = path.join(userSkillsDir, ".system");
  const [allSkills, subagents, hooks, mcps] = await Promise.all([
    collectSkillFiles(userSkillsDir, "user", "User", userRoot),
    collectMarkdownItems(path.join(userRoot, "agents"), "subagent", "user", "User", userRoot),
    collectHookItems(configDir, "user", "User", userRoot),
    collectBitfunMcps(path.join(configDir, "app.json"), "user", "User", userRoot),
  ]);
  return {
    // .system holds BitFun's own builtin skills; they are managed by the host.
    skills: allSkills.filter((skill) => !isInsideRoot(skill.filePath, builtinSkillsDir)),
    subagents,
    rules: [],
    commands: [],
    hooks,
    mcps,
  };
}

function compatInstructionSource(workspace, sourceLabel, relativePath) {
  return {
    type: "file",
    filePath: path.join(workspace, relativePath),
    scope: "project",
    sourceLabel,
    rootForEvidence: workspace,
    name: relativePath,
    sourceKind: "compat-instructions",
    precedence: "after-provider-rules",
    useHeading: false,
    exactName: true,
  };
}

async function collectBitfunWorkspacePrimitives(workspace) {
  const sourceLabel = await workspaceSourceLabel(workspace);
  const projectRoot = path.join(workspace, NATIVE_HIDDEN_DIR);
  const [skills, subagents, rules, hooks, agentsSkills] = await Promise.all([
    collectSkillFiles(path.join(projectRoot, "skills"), "project", sourceLabel, workspace),
    collectMarkdownItems(path.join(projectRoot, "agents"), "subagent", "project", sourceLabel, workspace),
    collectRuleSources([
      agentsMarkdownRuleSource(workspace, sourceLabel),
      directoryRuleSource(path.join(projectRoot, "rules"), "project", sourceLabel, workspace),
      ...COMPAT_INSTRUCTION_FILES.map((relativePath) => compatInstructionSource(workspace, sourceLabel, relativePath)),
    ]),
    collectHookItems(path.join(projectRoot, "config"), "project", sourceLabel, workspace),
    collectSkillFiles(path.join(workspace, ".agents", "skills"), "project", sourceLabel, workspace),
  ]);
  return {
    skills: [...skills, ...agentsSkills].sort(sortByName),
    subagents,
    rules,
    commands: [],
    hooks,
    mcps: [],
  };
}

export async function collectBitfunCustomizeInventory(options = {}) {
  const bitfunHome = path.resolve(expandHome(
    options.bitfunHome ?? options["bitfun-home"] ?? defaultBitfunHome(),
  ));
  const bitfunUserRoot = path.resolve(expandHome(
    options.bitfunUserRoot ?? options["bitfun-user-root"] ?? defaultBitfunUserRoot(),
  ));
  const bitfunUserSkillsDir = path.resolve(expandHome(
    options.bitfunUserSkillsDir
      ?? options["bitfun-user-skills-dir"]
      ?? defaultBitfunUserSkillsDir(bitfunUserRoot),
  ));
  const workspace = normalizeWorkspace(options.workspace ?? process.cwd());
  const includeUserHome = options.includeUserHome !== false;
  const configDir = path.join(bitfunUserRoot, "config");
  const projectRoot = path.join(workspace, NATIVE_HIDDEN_DIR);

  const [user, project] = await Promise.all([
    collectBitfunUserPrimitives({ userRoot: bitfunUserRoot, userSkillsDir: bitfunUserSkillsDir, includeUserHome }),
    collectBitfunWorkspacePrimitives(workspace),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    provider: "bitfun",
    bitfunHome,
    bitfunUserRoot,
    bitfunUserSkillsDir,
    workspace,
    tabs: MANAGE_TABS,
    plugins: [],
    manage: buildManageCollections([], user, project),
    diagnostics: {
      // BitFun installs product plugin packages, but this adapter does not
      // execute or inventory them; keep the empty state explicit.
      installedPluginState: "unsupported",
      installedPluginRecordCount: 0,
      installedPluginRecordFiles: [],
      remotePluginInstallMarkersRequired: false,
      // app.json always names the user config document; null when the user
      // home is out of scope so a redacted run cannot imply it was read.
      appConfigPath: includeUserHome ? path.join(configDir, "app.json") : null,
      userHooksPath: includeUserHome ? path.join(configDir, "hooks.json") : null,
      projectConfigDir: path.join(projectRoot, "config"),
      projectHooksPath: path.join(projectRoot, "config", "hooks.json"),
      builtinUserSkillsDir: includeUserHome ? path.join(bitfunUserSkillsDir, ".system") : null,
      exists: Boolean(await pathExists(bitfunHome)),
    },
    unsupported: [
      "product plugin packages under .openbitfun/plugins and the user data plugins dir",
      "compatibility skill roots owned by other hosts (.claude, .codex, .cursor, .opencode, .dsh, .pi)",
      "agent_profiles.json, agent_subagents.json, mode_skills.json, and tool_permissions.json",
      "project MCP overlay stored in the shared app.json project section",
      "MCP env secret values from app.json",
      "remote SSH workspaces, memories/coordination SQLite stores, cron jobs, and miniapps",
    ],
  };
}
