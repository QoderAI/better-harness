import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { basename, extname, posix, win32 } from "node:path";
import type {
  AcpBoxRecipe,
  HarnessStudioServerOptions,
  StudioAcpAgentOptions,
  StudioAcpAgentProfile,
} from "./studio-types.js";

export interface PublicAcpAgentProfile {
  id: string;
  label: string;
  available: boolean;
  modelPolicy: "lane" | "agent-default";
  detail: string;
  /** Whether this Agent can also run inside a microVM. */
  boxAvailable: boolean;
  /** Why it can or cannot, in the same voice as `detail`. */
  boxDetail: string;
}

interface Preset {
  id: string;
  label: string;
  executable?: string;
  args?: readonly string[];
  modelPolicy: "lane" | "agent-default";
  missing: string;
  /** How to install and launch this Agent inside a box, when that is possible. */
  box?: AcpBoxRecipe;
  /** Why a box cannot host it. Required when `box` is absent. */
  boxMissing?: string;
}

const PRESETS: readonly Preset[] = [
  {
    id: "qodercli",
    label: "Qoder CLI",
    executable: "qodercli",
    args: ["--acp"],
    modelPolicy: "agent-default",
    missing: "qodercli is not installed or is not on PATH.",
    // qodercli ships as a single Bun-compiled Mach-O binary and has no package
    // on a public registry, so there is nothing a Linux guest could install.
    boxMissing: "qodercli ships only as a macOS arm64 binary; a box runs Linux.",
  },
  {
    id: "pi",
    label: "Pi ACP",
    executable: "pi-acp",
    modelPolicy: "agent-default",
    missing: "pi-acp is not installed; the pi CLI alone is not an ACP server.",
    box: {
      image: "node:20-slim",
      // `pi-acp` is the adapter; it drives the `pi` CLI, so both are installed.
      packages: ["@earendil-works/pi-coding-agent", "pi-acp"],
      probe: "command -v pi-acp",
      command: "pi-acp",
      allowNet: ["api.anthropic.com", "api.openai.com", "generativelanguage.googleapis.com"],
      modelPolicy: "agent-default",
    },
  },
  {
    id: "dsh",
    label: "DSH ACP",
    modelPolicy: "agent-default",
    missing: "No portable DSH ACP entrypoint is registered; configure it with --acp-agent and --acp-arg.",
    boxMissing: "No portable DSH ACP entrypoint is registered, so a box has nothing to install.",
  },
  {
    id: "codex-acp",
    label: "Codex ACP",
    executable: "codex-acp",
    modelPolicy: "lane",
    missing: "codex-acp is not installed or is not on PATH.",
    boxMissing: "codex-acp has no package on the public npm registry to install into a box.",
  },
  {
    id: "claude-acp",
    label: "Claude ACP",
    executable: "claude-agent-acp",
    modelPolicy: "agent-default",
    missing: "claude-agent-acp is not installed; the claude CLI alone is not an ACP server.",
    box: {
      image: "node:20-slim",
      // The Zed adapter bundles the Claude Agent SDK, so the CLI is not needed.
      packages: ["@zed-industries/claude-code-acp"],
      probe: "command -v claude-code-acp",
      command: "claude-code-acp",
      allowNet: ["api.anthropic.com"],
      modelPolicy: "agent-default",
    },
  },
];

/** Discover only real local ACP entrypoints. This never installs or invokes a package. */
export async function discoverAcpAgentProfiles(input: {
  explicit?: StudioAcpAgentOptions;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  accessPath?: (path: string) => Promise<void>;
} = {}): Promise<StudioAcpAgentProfile[]> {
  const env = input.env ?? process.env;
  const platform = input.platform ?? process.platform;
  const accessPath = input.accessPath ?? (async (path) => access(
    path,
    platform === "win32" ? constants.F_OK : constants.X_OK,
  ));
  const explicit = input.explicit;
  const explicitPreset = explicit === undefined ? undefined : presetForCommand(explicit.command);
  const profiles: StudioAcpAgentProfile[] = [];
  for (const preset of PRESETS) {
    // A box recipe is independent of host availability: the Agent is installed
    // in the guest, so an Agent missing from this machine may still be boxable
    // — and a locally installed one may not be.
    const box = boxFields(preset);
    if (explicit !== undefined && explicitPreset?.id === preset.id) {
      profiles.push({
        id: preset.id,
        label: explicit.label ?? preset.label,
        agent: { ...explicit, modelPolicy: explicit.modelPolicy ?? preset.modelPolicy },
        ...box,
      });
      continue;
    }
    if (preset.executable === undefined) {
      profiles.push({ id: preset.id, label: preset.label, unavailableReason: preset.missing, ...box });
      continue;
    }
    const command = await findExecutable(preset.executable, { env, platform, accessPath });
    profiles.push(command === undefined
      ? { id: preset.id, label: preset.label, unavailableReason: preset.missing, ...box }
      : {
          id: preset.id,
          label: preset.label,
          agent: { command, args: preset.args, label: preset.label, modelPolicy: preset.modelPolicy },
          ...box,
        });
  }
  if (explicit !== undefined && explicitPreset === undefined) {
    profiles.unshift({
      id: portableAgentId(explicit.command),
      label: explicit.label ?? "Custom ACP",
      agent: explicit,
      boxUnavailableReason: CUSTOM_AGENT_BOX_REASON,
    });
  }
  return profiles;
}

const CUSTOM_AGENT_BOX_REASON =
  "A custom Agent has no microVM recipe; Studio will not guess how to install it in a guest.";

function boxFields(preset: Preset): Pick<StudioAcpAgentProfile, "box" | "boxUnavailableReason"> {
  return preset.box === undefined
    ? { boxUnavailableReason: preset.boxMissing ?? CUSTOM_AGENT_BOX_REASON }
    : { box: preset.box };
}

export function effectiveAcpAgentProfiles(options: HarnessStudioServerOptions): StudioAcpAgentProfile[] {
  const profiles = [...(options.acpAgents ?? [])];
  if (options.acpAgent === undefined) return profiles;
  if (profiles.some((profile) => profile.agent === options.acpAgent)) return profiles;
  const preset = presetForCommand(options.acpAgent.command);
  const id = preset?.id ?? portableAgentId(options.acpAgent.command);
  const index = profiles.findIndex((candidate) => candidate.id === id);
  // Keep the placement facts attached. Losing them here would silently downgrade
  // a boxable Agent to host-only whenever an explicit Agent is configured. One
  // source wins outright, so `box` and `boxUnavailableReason` stay exclusive.
  const existing = index === -1 ? undefined : profiles[index];
  const placement = existing?.box !== undefined
    ? { box: existing.box }
    : preset !== undefined
      ? boxFields(preset)
      : { boxUnavailableReason: existing?.boxUnavailableReason ?? CUSTOM_AGENT_BOX_REASON };
  const profile = {
    id,
    label: options.acpAgent.label ?? preset?.label ?? "ACP Agent",
    agent: options.acpAgent,
    ...placement,
  };
  if (index === -1) profiles.unshift(profile);
  else profiles[index] = profile;
  return profiles;
}

export function publicAcpAgentProfiles(options: HarnessStudioServerOptions): {
  agents: PublicAcpAgentProfile[];
  defaultAgentId?: string;
  defaultBoxAgentId?: string;
} {
  const profiles = effectiveAcpAgentProfiles(options);
  const defaultProfile = options.acpAgent === undefined
    ? profiles.find((profile) => profile.agent !== undefined)
    : profiles.find((profile) => profile.agent === options.acpAgent)
      ?? profiles.find((profile) => profile.agent?.command === options.acpAgent?.command);
  // Without a staged shim there is no placement to offer, so every Agent reports
  // box-unavailable for that reason rather than for its own.
  const shim = options.boxExecExecutable !== undefined;
  const agents = profiles.map((profile) => ({
    id: profile.id,
    label: profile.label,
    available: profile.agent !== undefined,
    modelPolicy: profile.agent?.modelPolicy ?? "lane",
    detail: profile.agent === undefined
      ? profile.unavailableReason ?? "This ACP Agent is unavailable."
      : profile.agent.modelPolicy === "agent-default"
        ? "Available · ACP v1 stdio · uses Agent default model"
        : "Available · ACP v1 stdio · uses lane model",
    boxAvailable: shim && profile.box !== undefined,
    boxDetail: !shim
      ? "This Studio build has no microVM shim staged."
      : profile.box === undefined
        ? profile.boxUnavailableReason ?? "This Agent has no microVM recipe."
        : `Runs in a ${profile.box.image} microVM · installs ${profile.box.packages.join(", ")}`,
  }));
  const defaultBoxAgent = agents.find((agent) => agent.boxAvailable);
  return {
    agents,
    ...(defaultProfile === undefined ? {} : { defaultAgentId: defaultProfile.id }),
    // The host default (qodercli) is usually not boxable, so a box run needs its
    // own default rather than falling back to an Agent it cannot start.
    ...(defaultBoxAgent === undefined ? {} : { defaultBoxAgentId: defaultBoxAgent.id }),
  };
}

/**
 * Rewrite an Agent so its process runs inside a microVM.
 *
 * `harness-acp-host` spawns `command + args` and speaks JSON-RPC to its stdio.
 * It does not care what that process is, so placement needs no change there —
 * only a command that looks like an Agent from outside and is a VM inside.
 *
 * The project is bind-mounted at `/workspace`, so the Agent's edits are real
 * while its command execution stays in the guest.
 */
export function acpAgentInBox(
  agent: StudioAcpAgentOptions | undefined,
  recipe: AcpBoxRecipe,
  input: { shim: string; cwd: string; label?: string; registry?: string },
): StudioAcpAgentOptions {
  const registry = input.registry ?? "registry.npmjs.org";
  const guestRoot = "/workspace";
  return {
    // `agent` is optional because host installation is irrelevant to a box: the
    // Agent that will run is `recipe.command`, installed in the guest. When the
    // Agent is absent locally there is simply no host metadata to carry over.
    ...agent,
    ...(agent?.label === undefined && input.label !== undefined ? { label: input.label } : {}),
    // The guest runs the recipe's program, so the recipe decides the policy.
    modelPolicy: recipe.modelPolicy,
    command: input.shim,
    args: [
      "--box", boxNameForWorkspace(input.cwd),
      "--image", recipe.image,
      "--mount", `${input.cwd}:${guestRoot}`,
      "--workdir", guestRoot,
      "--allow-net", registry,
      ...recipe.allowNet.flatMap((host) => ["--allow-net", host]),
      "--probe", recipe.probe,
      "--provision", `npm install -g --ignore-scripts ${recipe.packages.join(" ")}`,
      "--", recipe.command,
      ...(recipe.args ?? []),
    ],
  };
}

/**
 * One box per Project, reused across sessions.
 *
 * Reuse is the whole economy: the second run in a Project skips the package
 * install the first one paid for. The name is derived rather than random so
 * that reuse survives a Studio restart, and it is slugged because BoxLite
 * names are not paths.
 */
export function boxNameForWorkspace(cwd: string): string {
  const slug = basename(cwd).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  let hash = 5381;
  for (const character of cwd) hash = ((hash << 5) + hash + character.charCodeAt(0)) >>> 0;
  return `harness-${slug === "" ? "project" : slug.slice(0, 24)}-${hash.toString(36)}`;
}

export function resolveAcpAgent(
  options: HarnessStudioServerOptions,
  id: string,
): StudioAcpAgentOptions | undefined {
  return effectiveAcpAgentProfiles(options).find((profile) => profile.id === id)?.agent;
}

export async function findExecutable(name: string, input: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  accessPath?: (path: string) => Promise<void>;
} = {}): Promise<string | undefined> {
  const env = input.env ?? process.env;
  const platform = input.platform ?? process.platform;
  const accessPath = input.accessPath ?? (async (path) => access(
    path,
    platform === "win32" ? constants.F_OK : constants.X_OK,
  ));
  const pathValue = env.PATH ?? env.Path ?? env.path ?? "";
  const pathApi = platform === "win32" ? win32 : posix;
  const extensions = platform === "win32"
    ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  const names = platform === "win32" && extname(name) === ""
    ? extensions.map((extension) => `${name}${extension.toLowerCase()}`)
    : [name];
  for (const directory of pathValue.split(pathApi.delimiter).filter(Boolean)) {
    for (const candidateName of names) {
      const candidate = pathApi.join(directory, candidateName);
      try {
        await accessPath(candidate);
        return candidate;
      } catch {
        // Continue through the bounded PATH candidate list.
      }
    }
  }
  return undefined;
}

function presetForCommand(command: string): Preset | undefined {
  const executable = basename(command).replace(/\.(?:cmd|exe|bat|com)$/iu, "");
  if (executable === "dsh") return PRESETS.find((preset) => preset.id === "dsh");
  return PRESETS.find((preset) => preset.executable === executable);
}

function portableAgentId(command: string): string {
  const candidate = basename(command).replace(/\.(?:cmd|exe|bat|com)$/iu, "")
    .toLowerCase().replace(/[^a-z0-9_-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return candidate === "" ? "custom-acp" : candidate;
}
