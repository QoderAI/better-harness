import { constants as fsConstants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getHostProfile } from "../host-support/index.mjs";
import { LifecycleCliError } from "./contract.mjs";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "..", "..");
const packageJsonPath = path.join(repoRoot, "package.json");

function expandLeadingHome(value) {
  const raw = String(value);
  if (raw === "~") return os.homedir();
  if (/^~[\\/]/u.test(raw)) return path.join(os.homedir(), raw.slice(2));
  return raw;
}

export function normalizeLifecyclePaths(options = {}) {
  const workspace = path.resolve(expandLeadingHome(options.workspace ?? process.cwd()));
  return {
    ...options,
    workspace,
    ...(options.hostHome != null
      ? { hostHome: path.resolve(expandLeadingHome(options.hostHome)) }
      : {}),
  };
}

function pathRules(value, home, workspace, platform) {
  const windowsStyle = platform === "win32" || [value, home, workspace]
    .some((entry) => typeof entry === "string" && /^[A-Za-z]:[\\/]/u.test(entry));
  return {
    api: windowsStyle ? path.win32 : path,
    insensitive: windowsStyle,
  };
}

export function redactPath(value, { home = os.homedir(), workspace, platform = process.platform } = {}) {
  if (typeof value !== "string" || !value) return undefined;
  const rules = pathRules(value, home, workspace, platform);
  const resolved = rules.api.resolve(value);
  const resolvedHome = home ? rules.api.resolve(home) : undefined;
  const resolvedWorkspace = workspace ? rules.api.resolve(workspace) : undefined;
  const comparable = (entry) => rules.insensitive ? entry?.toLowerCase() : entry;
  const contains = (root) => root && (
    comparable(resolved) === comparable(root)
    || comparable(resolved).startsWith(`${comparable(root)}${rules.api.sep}`)
  );
  if (contains(resolvedWorkspace)) {
    const relative = rules.api.relative(resolvedWorkspace, resolved);
    return relative ? `<workspace>/${relative.split(rules.api.sep).join("/")}` : "<workspace>";
  }
  if (contains(resolvedHome)) {
    const relative = rules.api.relative(resolvedHome, resolved);
    return relative ? `~/${relative.split(rules.api.sep).join("/")}` : "~";
  }
  return `<external>/${rules.api.basename(resolved)}`;
}

function executableCandidates(name, platform, env) {
  if (platform !== "win32") return [name];
  if (/\.[A-Za-z0-9]+$/u.test(name)) return [name];
  const pathExt = Object.entries(env)
    .find(([key]) => key.toUpperCase() === "PATHEXT")?.[1];
  const extensions = String(pathExt ?? ".EXE;.CMD;.BAT;.COM")
    .split(";")
    .map((extension) => extension.trim())
    .filter(Boolean)
    .map((extension) => extension.startsWith(".") ? extension : `.${extension}`)
    .map((extension) => extension.toLowerCase());
  return [...new Set(extensions)].map((extension) => `${name}${extension}`);
}

async function isExecutableFile(candidate, platform) {
  const candidateStat = await stat(candidate);
  if (!candidateStat.isFile()) return false;
  await access(candidate, platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK);
  return true;
}

export async function discoverHostExecutable(profile, options = {}) {
  if (typeof options.hostDiscovery === "function") {
    return options.hostDiscovery(profile);
  }
  if ((profile.executables ?? []).length === 0) return "unobserved";
  const env = options.env ?? process.env;
  const platform = options.runtimePlatform ?? options.platform ?? process.platform;
  const pathValue = env.PATH ?? env.Path ?? env.path ?? "";
  const delimiter = platform === "win32" ? path.win32.delimiter : path.delimiter;
  const directories = pathValue.split(delimiter).filter(Boolean);
  for (const executable of profile.executables) {
    for (const directory of directories) {
      for (const candidate of executableCandidates(executable, platform, env)) {
        try {
          if (await isExecutableFile(path.join(directory, candidate), platform)) return "present";
        } catch {
          // Continue through the bounded PATH candidates.
        }
      }
    }
  }
  return "absent";
}

export async function packageInfo(options = {}) {
  if (options.packageInfo) return options.packageInfo;
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  return {
    name: packageJson.name,
    version: packageJson.version,
    nodeRange: packageJson.engines?.node,
    npmRange: packageJson.engines?.npm,
  };
}

export async function validateWorkspace(workspace) {
  const resolved = path.resolve(workspace ?? process.cwd());
  const stats = await stat(resolved).catch(() => null);
  if (!stats?.isDirectory()) {
    throw new LifecycleCliError(
      "INVALID_WORKSPACE",
      "Workspace is not an existing directory.",
      { kind: "usage", hint: "Check the --workspace value." },
    );
  }
  return resolved;
}

export async function pluginLifecycleRuntimeInfo(options = {}) {
  const info = await packageInfo(options);
  return {
    ...info,
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
  };
}

export function authorizedRootLabel(host, {
  hostHome,
  home,
  resolvedRoot,
  workspace,
  platform,
} = {}) {
  if (resolvedRoot) return redactPath(resolvedRoot, { home, workspace, platform });
  if (hostHome) return redactPath(hostHome, { home, workspace, platform });
  const profile = getHostProfile(host);
  return profile?.inventoryHomeRoutes
    .find((route) => route.option === profile.inventoryHomeOption)
    ?.fallbackLabel;
}
