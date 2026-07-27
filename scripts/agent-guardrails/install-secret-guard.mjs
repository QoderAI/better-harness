#!/usr/bin/env node

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildSecretGuardHookCommand,
  DEFAULT_SECRET_GUARD_PLATFORM,
  resolveSecretGuardPlatform,
  resolveSecretGuardPlatformPaths,
  supportedSecretGuardPlatforms,
} from "./platforms.mjs";

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function resolveRequestedPlatform(options) {
  const host = options.host ?? null;
  const platform = options.platform ?? null;
  if (host && platform && String(host).trim().toLowerCase() !== String(platform).trim().toLowerCase()) {
    throw new Error(`--host (${host}) and --platform (${platform}) must match when both are provided`);
  }
  return resolveSecretGuardPlatform(platform ?? host ?? DEFAULT_SECRET_GUARD_PLATFORM);
}

function desiredHooks({ targetDir, scriptPath, platform }) {
  return Object.fromEntries(
    Object.entries(platform.hookEvents).map(([eventName, event]) => [
      eventName,
      {
        ...(event.matcher ? { matcher: event.matcher } : {}),
        hooks: [
          {
            type: "command",
            command: buildSecretGuardHookCommand({ targetDir, scriptPath, mode: event.mode, platform }),
          },
        ],
      },
    ]),
  );
}

function runtimeFiles({ paths, sourceScript, sourcePlatformScript }) {
  return [
    {
      name: "secret-scan",
      sourcePath: sourceScript,
      targetPath: paths.scriptPath,
    },
    {
      name: "platforms",
      sourcePath: sourcePlatformScript,
      targetPath: path.join(path.dirname(paths.scriptPath), "platforms.mjs"),
    },
  ];
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

async function hashFile(filePath) {
  try {
    const hash = createHash("sha256");
    hash.update(await fs.readFile(filePath));
    return hash.digest("hex");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function hasCommand(entries, command) {
  return entries.some((entry) => (
    Array.isArray(entry?.hooks) &&
    entry.hooks.some((hook) => hook?.type === "command" && hook?.command === command)
  ));
}

function hookDrift(settings, rootKey, desired) {
  const root = settings[rootKey] && typeof settings[rootKey] === "object" ? settings[rootKey] : {};
  return Object.fromEntries(
    Object.entries(desired).map(([eventName, entry]) => {
      const existing = Array.isArray(root[eventName]) ? root[eventName] : [];
      const command = entry.hooks[0]?.command ?? "";
      return [
        eventName,
        {
          present: hasCommand(existing, command),
          expectedCommand: command,
        },
      ];
    }),
  );
}

async function inspectRuntimeFiles(files) {
  const entries = await Promise.all(files.map(async (file) => {
    const [sourceHash, targetHash] = await Promise.all([
      hashFile(file.sourcePath),
      hashFile(file.targetPath),
    ]);
    return [
      file.name,
      {
        sourcePath: file.sourcePath,
        targetPath: file.targetPath,
        sourceHash,
        targetHash,
        targetExists: Boolean(targetHash),
        matches: Boolean(sourceHash && targetHash && sourceHash === targetHash),
      },
    ];
  }));
  return Object.fromEntries(entries);
}

async function inspectInstallState({ paths, files, settings, desired }) {
  const runtime = await inspectRuntimeFiles(files);
  const hooks = hookDrift(settings, paths.settingsRootKey, desired);
  const configMatches = Object.values(hooks).every((hook) => hook.present);
  const runtimeMatches = Object.values(runtime).every((file) => file.matches);
  return {
    script: runtime["secret-scan"],
    runtimeFiles: runtime,
    config: {
      path: paths.settingsPath,
      rootKey: paths.settingsRootKey,
      matches: configMatches,
      hooks,
    },
    needsInstall: !runtimeMatches || !configMatches,
  };
}

function mergeHook(settings, rootKey, eventName, entry) {
  settings[rootKey] ??= {};
  const root = settings[rootKey];
  const existing = Array.isArray(root[eventName]) ? root[eventName] : [];
  const command = entry.hooks[0]?.command;
  if (!command || hasCommand(existing, command)) {
    root[eventName] = existing;
    return false;
  }
  root[eventName] = [...existing, entry];
  return true;
}

async function copyRuntimeFiles({ files, dryRun }) {
  if (dryRun) return;
  for (const file of files) {
    await fs.mkdir(path.dirname(file.targetPath), { recursive: true });
    await fs.copyFile(file.sourcePath, file.targetPath);
    await fs.chmod(file.targetPath, 0o755).catch(() => {});
  }
}

export async function installSecretGuard(options = {}) {
  const platform = resolveRequestedPlatform(options);
  const targetDir = path.resolve(options.targetDir ?? options.target ?? process.cwd());
  const sourceScript = path.resolve(options.sourceScript ?? path.join(repoRoot(), "scripts", "agent-guardrails", "secret-scan.mjs"));
  const sourcePlatformScript = path.resolve(options.sourcePlatformScript ?? path.join(repoRoot(), "scripts", "agent-guardrails", "platforms.mjs"));
  const paths = resolveSecretGuardPlatformPaths(targetDir, platform);
  const files = runtimeFiles({ paths, sourceScript, sourcePlatformScript });
  const settings = await readJson(paths.settingsPath);
  const desired = desiredHooks({ targetDir, scriptPath: paths.scriptPath, platform });
  const before = await inspectInstallState({ paths, files, settings, desired });
  const addedHooks = [];

  if (options.check) {
    return {
      platform: platform.id,
      host: platform.id,
      targetDir,
      settingsPath: paths.settingsPath,
      copiedScript: paths.scriptPath,
      copiedFiles: Object.fromEntries(files.map((file) => [file.name, file.targetPath])),
      addedHooks,
      commands: Object.fromEntries(
        Object.entries(desired).map(([eventName, entry]) => [eventName, entry.hooks[0].command]),
      ),
      check: before,
      needsInstall: before.needsInstall,
    };
  }

  for (const [eventName, entry] of Object.entries(desired)) {
    if (mergeHook(settings, paths.settingsRootKey, eventName, entry)) addedHooks.push(eventName);
  }

  if (!options.dryRun) {
    await copyRuntimeFiles({ files, dryRun: false });
    await fs.mkdir(path.dirname(paths.settingsPath), { recursive: true });
    await fs.writeFile(paths.settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  }

  const check = options.dryRun
    ? before
    : await inspectInstallState({
      paths,
      files,
      settings: await readJson(paths.settingsPath),
      desired,
    });

  return {
    platform: platform.id,
    host: platform.id,
    targetDir,
    settingsPath: paths.settingsPath,
    copiedScript: paths.scriptPath,
    copiedFiles: Object.fromEntries(files.map((file) => [file.name, file.targetPath])),
    addedHooks,
    commands: Object.fromEntries(
      Object.entries(desired).map(([eventName, entry]) => [eventName, entry.hooks[0].command]),
    ),
    check,
    needsInstall: check.needsInstall,
  };
}

function usage() {
  return `install-secret-guard.mjs

Usage:
  node scripts/agent-guardrails/install-secret-guard.mjs --target <project> --platform <${supportedSecretGuardPlatforms().join("|")}>

Options:
  --target <path>       Target project directory. Defaults to cwd.
  --platform <name>     ${supportedSecretGuardPlatforms().join(" or ")}. Defaults to ${DEFAULT_SECRET_GUARD_PLATFORM}.
  --host <name>         Compatibility alias for --platform.
  --check               Report scanner/config drift without writing. Exits 1 when drift is detected.
  --dry-run             Print the planned merge without writing files.
  --json                Print JSON output.
`;
}

function parseArgs(argv) {
  const options = { json: false, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = (name) => {
      const next = argv[index + 1];
      if (!next) throw new Error(`${name} requires a value`);
      index += 1;
      return next;
    };
    const maybeEquals = (name) => arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : value(name);
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--check") options.check = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--platform" || arg.startsWith("--platform=")) options.platform = maybeEquals("--platform");
    else if (arg === "--host" || arg.startsWith("--host=")) options.host = maybeEquals("--host");
    else if (arg === "--target" || arg.startsWith("--target=")) options.targetDir = maybeEquals("--target");
    else if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
    else options.targetDir = arg;
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(usage());
    return 0;
  }
  const result = await installSecretGuard(options);
  if (options.json || options.dryRun || options.check) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`Installed secret guard for ${result.platform}\n`);
    process.stdout.write(`Script: ${result.copiedScript}\n`);
    process.stdout.write(`Config: ${result.settingsPath}\n`);
    process.stdout.write(`Added hooks: ${result.addedHooks.length ? result.addedHooks.join(", ") : "none"}\n`);
  }
  if (options.check && result.needsInstall) {
    return 1;
  }
  return 0;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`install-secret-guard.mjs error: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
