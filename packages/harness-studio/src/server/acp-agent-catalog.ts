import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { basename, extname, posix, win32 } from "node:path";
import type {
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
}

interface Preset {
  id: string;
  label: string;
  executable?: string;
  args?: readonly string[];
  modelPolicy: "lane" | "agent-default";
  missing: string;
}

const PRESETS: readonly Preset[] = [
  {
    id: "qodercli",
    label: "Qoder CLI",
    executable: "qodercli",
    args: ["--acp"],
    modelPolicy: "agent-default",
    missing: "qodercli is not installed or is not on PATH.",
  },
  {
    id: "pi",
    label: "Pi ACP",
    executable: "pi-acp",
    modelPolicy: "agent-default",
    missing: "pi-acp is not installed; the pi CLI alone is not an ACP server.",
  },
  {
    id: "dsh",
    label: "DSH ACP",
    executable: "dsh",
    args: ["--profile", "acp"],
    modelPolicy: "agent-default",
    missing: "dsh is not installed or is not on PATH. DSH requires the acp profile (--profile acp).",
  },
  {
    id: "codex-acp",
    label: "Codex ACP",
    executable: "codex-acp",
    modelPolicy: "lane",
    missing: "codex-acp is not installed or is not on PATH.",
  },
  {
    id: "claude-acp",
    label: "Claude ACP",
    executable: "claude-agent-acp",
    modelPolicy: "agent-default",
    missing: "claude-agent-acp is not installed; the claude CLI alone is not an ACP server.",
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
    if (explicit !== undefined && explicitPreset?.id === preset.id) {
      profiles.push({
        id: preset.id,
        label: explicit.label ?? preset.label,
        agent: { ...explicit, modelPolicy: explicit.modelPolicy ?? preset.modelPolicy },
      });
      continue;
    }
    if (preset.executable === undefined) {
      profiles.push({ id: preset.id, label: preset.label, unavailableReason: preset.missing });
      continue;
    }
    const command = await findExecutable(preset.executable, { env, platform, accessPath });
    profiles.push(command === undefined
      ? { id: preset.id, label: preset.label, unavailableReason: preset.missing }
      : {
          id: preset.id,
          label: preset.label,
          agent: { command, args: preset.args, label: preset.label, modelPolicy: preset.modelPolicy },
        });
  }
  if (explicit !== undefined && explicitPreset === undefined) {
    profiles.unshift({ id: portableAgentId(explicit.command), label: explicit.label ?? "Custom ACP", agent: explicit });
  }
  return profiles;
}

export function effectiveAcpAgentProfiles(options: HarnessStudioServerOptions): StudioAcpAgentProfile[] {
  const profiles = [...(options.acpAgents ?? [])];
  if (options.acpAgent === undefined) return profiles;
  if (profiles.some((profile) => profile.agent === options.acpAgent)) return profiles;
  const preset = presetForCommand(options.acpAgent.command);
  const id = preset?.id ?? portableAgentId(options.acpAgent.command);
  const index = profiles.findIndex((candidate) => candidate.id === id);
  const profile = { id, label: options.acpAgent.label ?? preset?.label ?? "ACP Agent", agent: options.acpAgent };
  if (index === -1) profiles.unshift(profile);
  else profiles[index] = profile;
  return profiles;
}

export function publicAcpAgentProfiles(options: HarnessStudioServerOptions): {
  agents: PublicAcpAgentProfile[];
  defaultAgentId?: string;
} {
  const profiles = effectiveAcpAgentProfiles(options);
  const defaultProfile = options.acpAgent === undefined
    ? profiles.find((profile) => profile.agent !== undefined)
    : profiles.find((profile) => profile.agent === options.acpAgent)
      ?? profiles.find((profile) => profile.agent?.command === options.acpAgent?.command);
  return {
    agents: profiles.map((profile) => ({
      id: profile.id,
      label: profile.label,
      available: profile.agent !== undefined,
      modelPolicy: profile.agent?.modelPolicy ?? "lane",
      detail: profile.agent === undefined
        ? profile.unavailableReason ?? "This ACP Agent is unavailable."
        : profile.agent.modelPolicy === "agent-default"
          ? "Available · ACP v1 stdio · uses Agent default model"
          : "Available · ACP v1 stdio · uses lane model",
    })),
    ...(defaultProfile === undefined ? {} : { defaultAgentId: defaultProfile.id }),
  };
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
  const executable = win32.basename(command).replace(/\.(?:cmd|exe|bat|com)$/iu, "");
  if (executable === "dsh") return PRESETS.find((preset) => preset.id === "dsh");
  return PRESETS.find((preset) => preset.executable === executable);
}

function portableAgentId(command: string): string {
  const candidate = basename(command).replace(/\.(?:cmd|exe|bat|com)$/iu, "")
    .toLowerCase().replace(/[^a-z0-9_-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return candidate === "" ? "custom-acp" : candidate;
}
