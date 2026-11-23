/**
 * OpenClaw configured-asset inventory.
 *
 * OpenClaw separates two storage families:
 * - state directory: OPENCLAW_STATE_DIR or ~/.openclaw, holding openclaw.json,
 *   managed skills, and per-agent runtime state
 * - agent workspace: the agent's home directory holding instruction files and
 *   workspace skills
 *
 * Live sessions and transcripts live in per-agent SQLite, so this adapter stays
 * read-only, never decodes a database, and never runs `openclaw sessions
 * export-trajectory` (that command mutates the workspace it exports from).
 */
import os from "node:os";
import path from "node:path";

import { expandHome, normalizeWorkspace, pathExists } from "../../session-analysis/index.mjs";
import { MANAGE_TABS } from "../constants.mjs";
import { readJson5File } from "../core/json5.mjs";
import {
  buildManageCollections,
  collectMcpFromValue,
  collectRuleSources,
  collectSkillFiles,
  listDirectories,
  sortByName,
  workspaceSourceLabel,
} from "../core/items.mjs";

const NATIVE_HIDDEN_DIR = ".openclaw";

/**
 * Bootstrap files OpenClaw loads into every session from the agent workspace.
 * Daily memory notes under memory/ are intentionally left out: they are
 * per-day logs, not standing instructions.
 */
const WORKSPACE_INSTRUCTION_FILES = ["AGENTS.md", "SOUL.md", "USER.md", "IDENTITY.md", "MEMORY.md", "BOOT.md"];

export function defaultOpenClawHome() {
  const stateDir = process.env.OPENCLAW_STATE_DIR;
  if (stateDir && stateDir.trim() !== "") return stateDir;
  const profile = process.env.OPENCLAW_PROFILE;
  const directory =
    profile && profile.trim() !== "" && profile !== "default" ? `${NATIVE_HIDDEN_DIR}-${profile}` : NATIVE_HIDDEN_DIR;
  return path.join(os.homedir(), directory);
}

export function defaultOpenClawConfigPath(stateDir = defaultOpenClawHome()) {
  const configPath = process.env.OPENCLAW_CONFIG_PATH;
  if (configPath && configPath.trim() !== "") return configPath;
  return path.join(stateDir, "openclaw.json");
}

export function openClawMcpServersFromConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const section = config.mcp;
  if (!section || typeof section !== "object" || Array.isArray(section)) return null;
  const servers = section.servers;
  return servers && typeof servers === "object" && !Array.isArray(servers) ? servers : null;
}

/**
 * OpenClaw names the remote transport `transport`; the shared MCP item shape
 * keeps a single `type` field, so carry the host's name across.
 */
function normalizeTransportType(servers) {
  const normalized = {};
  for (const [name, value] of Object.entries(servers)) {
    const server = value && typeof value === "object" && !Array.isArray(value) ? value : null;
    normalized[name] = server && server.type === undefined && typeof server.transport === "string"
      ? { ...server, type: server.transport }
      : value;
  }
  return normalized;
}

/**
 * Resolve every configured agent workspace. The default workspace applies to a
 * sole agent and to the base of an unpinned multi-agent roster, matching the
 * resolution order the agent-workspace docs describe.
 */
export function resolveOpenClawAgentWorkspaces(config, stateDir, env = process.env) {
  const agents = config?.agents && typeof config.agents === "object" && !Array.isArray(config.agents)
    ? config.agents
    : {};
  const defaults = agents.defaults && typeof agents.defaults === "object" && !Array.isArray(agents.defaults)
    ? agents.defaults
    : {};
  const entries = agents.entries && typeof agents.entries === "object" && !Array.isArray(agents.entries)
    ? agents.entries
    : {};
  const envWorkspace = typeof env.OPENCLAW_WORKSPACE_DIR === "string" && env.OPENCLAW_WORKSPACE_DIR.trim() !== ""
    ? env.OPENCLAW_WORKSPACE_DIR.trim()
    : null;
  const configuredRoot = typeof defaults.workspace === "string" && defaults.workspace.trim() !== ""
    ? defaults.workspace.trim()
    : null;
  const workspaceRoot = envWorkspace ?? configuredRoot;
  const rootSource = envWorkspace ? "env" : "defaults";
  const agentIds = Object.keys(entries);
  const defaultWorkspace = path.resolve(expandHome(workspaceRoot ?? path.join(stateDir, "workspace")));

  if (agentIds.length === 0) {
    return [{ agentId: "main", workspace: defaultWorkspace, source: workspaceRoot ? rootSource : "default" }];
  }
  if (agentIds.length === 1) {
    const entry = entries[agentIds[0]] && typeof entries[agentIds[0]] === "object" ? entries[agentIds[0]] : {};
    const pinned = typeof entry.workspace === "string" && entry.workspace.trim() !== "" ? entry.workspace.trim() : null;
    return [{
      agentId: agentIds[0],
      workspace: pinned ? path.resolve(expandHome(pinned)) : defaultWorkspace,
      source: pinned ? "entry" : workspaceRoot ? rootSource : "default",
    }];
  }
  return agentIds.map((agentId) => {
    const entry = entries[agentId] && typeof entries[agentId] === "object" ? entries[agentId] : {};
    const pinned = typeof entry.workspace === "string" && entry.workspace.trim() !== "" ? entry.workspace.trim() : null;
    if (pinned) {
      return { agentId, workspace: path.resolve(expandHome(pinned)), source: "entry" };
    }
    return {
      agentId,
      workspace: workspaceRoot
        ? path.resolve(expandHome(path.join(workspaceRoot, agentId)))
        : path.resolve(stateDir, `workspace-${agentId}`),
      source: workspaceRoot ? rootSource : "state-dir",
    };
  });
}

function isInsideOrEqual(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function matchOpenClawAgentWorkspace(agentWorkspaces, workspace) {
  const resolved = path.resolve(workspace);
  const matches = agentWorkspaces.filter((entry) => isInsideOrEqual(resolved, entry.workspace));
  matches.sort((left, right) => right.workspace.length - left.workspace.length);
  return matches[0] ?? null;
}

function emptyPrimitives() {
  return { skills: [], subagents: [], rules: [], commands: [], hooks: [], mcps: [] };
}

async function collectOpenClawUserPrimitives({ stateDir, personalSkillsDir, config, configPath, includeUserHome }) {
  if (!includeUserHome) return emptyPrimitives();
  const skills = await collectSkillFiles(path.join(stateDir, "skills"), "user", "User", stateDir);
  for (const agentDir of await listDirectories(path.join(stateDir, "agents"))) {
    skills.push(...(await collectSkillFiles(
      path.join(agentDir, "agent", "workshop-skills"), "user", "User", stateDir,
    )));
  }
  if (personalSkillsDir) {
    skills.push(...(await collectSkillFiles(personalSkillsDir, "user", "User", personalSkillsDir)));
  }
  const servers = openClawMcpServersFromConfig(config);
  return {
    skills: skills.sort(sortByName),
    subagents: [],
    rules: [],
    commands: [],
    hooks: [],
    mcps: servers ? collectMcpFromValue(normalizeTransportType(servers), "user", "User", configPath, stateDir) : [],
  };
}

async function collectOpenClawWorkspacePrimitives(workspace) {
  const sourceLabel = await workspaceSourceLabel(workspace);
  const [workspaceSkills, standardSkills, rules] = await Promise.all([
    collectSkillFiles(path.join(workspace, "skills"), "project", sourceLabel, workspace),
    collectSkillFiles(path.join(workspace, ".agents", "skills"), "project", sourceLabel, workspace),
    collectRuleSources(
      WORKSPACE_INSTRUCTION_FILES.map((name) => ({
        type: "file",
        filePath: path.join(workspace, name),
        scope: "project",
        sourceLabel,
        rootForEvidence: workspace,
        name,
        sourceKind: "openclaw-workspace-instruction",
        precedence: "before-project-rules",
        useHeading: true,
        exactName: true,
      })),
    ),
  ]);
  return {
    skills: [...workspaceSkills, ...standardSkills].sort(sortByName),
    subagents: [],
    rules,
    commands: [],
    hooks: [],
    mcps: [],
  };
}

export async function collectOpenClawCustomizeInventory(options = {}) {
  const requestedHome = options.openclawHome ?? options["openclaw-home"];
  const usingDefaultStateDir = requestedHome === undefined || requestedHome === null;
  const openclawHome = path.resolve(expandHome(
    usingDefaultStateDir ? defaultOpenClawHome() : requestedHome,
  ));
  const openclawConfigPath = path.resolve(expandHome(
    options.openclawConfigPath
      ?? options["openclaw-config-path"]
      ?? defaultOpenClawConfigPath(openclawHome),
  ));
  const workspace = normalizeWorkspace(options.workspace ?? process.cwd());
  const includeUserHome = options.includeUserHome !== false;
  const configRead = includeUserHome
    ? await readJson5File(openclawConfigPath)
    : { ok: false, exists: false, value: undefined, format: "skipped" };
  const config = configRead.ok ? configRead.value : undefined;
  const agentWorkspaces = resolveOpenClawAgentWorkspaces(config, openclawHome);
  const matchedAgent = configRead.ok ? matchOpenClawAgentWorkspace(agentWorkspaces, workspace) : null;
  // Without a readable config there is no roster to attribute against; treat
  // the requested workspace as the agent workspace so a restricted run still
  // reports the files OpenClaw would load from it.
  const activeAgent = matchedAgent ?? (configRead.ok ? null : { agentId: null, workspace });
  const personalSkillsDir = includeUserHome && usingDefaultStateDir && !process.env.OPENCLAW_STATE_DIR
    ? path.join(os.homedir(), ".agents", "skills")
    : null;

  const [user, project] = await Promise.all([
    collectOpenClawUserPrimitives({
      stateDir: openclawHome,
      personalSkillsDir,
      config,
      configPath: openclawConfigPath,
      includeUserHome,
    }),
    activeAgent ? collectOpenClawWorkspacePrimitives(activeAgent.workspace) : emptyPrimitives(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    provider: "openclaw",
    openclawHome,
    openclawConfigPath,
    openclawWorkspace: activeAgent?.workspace ?? null,
    activeAgentId: activeAgent?.agentId ?? null,
    workspace,
    tabs: MANAGE_TABS,
    plugins: [],
    manage: buildManageCollections([], user, project),
    diagnostics: {
      // OpenClaw installs plugin packages, but this adapter does not execute or
      // inventory them; keep the empty state explicit.
      installedPluginState: "unsupported",
      installedPluginRecordCount: 0,
      installedPluginRecordFiles: [],
      remotePluginInstallMarkersRequired: false,
      configPath: includeUserHome ? openclawConfigPath : null,
      configParseState: configRead.format,
      configParseMessage: configRead.ok ? null : configRead.message ?? null,
      managedSkillsDir: includeUserHome ? path.join(openclawHome, "skills") : null,
      personalSkillsDir,
      workspaceRoot: workspace,
      // Only a config-backed roster is reported; a restricted run must not
      // imply it resolved agent workspaces from a config it never read.
      agentWorkspaces: configRead.ok
        ? agentWorkspaces.map((entry) => ({
          agentId: entry.agentId,
          workspace: entry.workspace,
          source: entry.source,
          active: matchedAgent?.agentId === entry.agentId,
        }))
        : [],
      exists: Boolean(await pathExists(openclawHome)),
    },
    unsupported: [
      "live sessions and transcripts stored in per-agent openclaw-agent.sqlite and shared state SQLite",
      "legacy session archives under agents/<agentId>/sessions",
      "plugin packages and cron jobs configured under the state directory",
      "daily memory notes under memory/ in each agent workspace",
      "MCP header and env values in openclaw.json",
      "agent roster fields outside agents.entries and agents.defaults.workspace",
      ...(activeAgent
        ? []
        : [`project scope skipped: ${workspace} is not a configured OpenClaw agent workspace`]),
    ],
  };
}
