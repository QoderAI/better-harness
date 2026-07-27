#!/usr/bin/env node

import { createRequire } from "node:module";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ARTIFACT_KIND,
  ARTIFACT_MARKER,
  ARTIFACT_SCHEMA_VERSION,
  RUNTIME_DEPENDENCIES,
  SUPPORTED_HOSTS,
  verifyHostPluginArtifact,
} from "./verify-host-plugin.mjs";

const require = createRequire(import.meta.url);
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(currentDir, "..", "..");

const HOST_SHELLS = Object.freeze({
  codex: ".codex-plugin",
});

const ROOT_FILES = Object.freeze([
  "README.md",
  "AGENTS.md",
  "LICENSE",
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
]);

const RUNTIME_ROOTS = Object.freeze([
  "case-studies",
  "docs",
  "hooks",
  "models",
  "references",
  "scripts",
  "skills",
  "templates",
]);

function hostShell(host) {
  const shell = HOST_SHELLS[host];
  if (!shell) {
    throw new Error(`Unsupported host: ${host}. Supported hosts: ${SUPPORTED_HOSTS.join(", ")}`);
  }
  return shell;
}

function isWithin(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (
    !relative.startsWith(`..${path.sep}`)
    && relative !== ".."
    && !path.isAbsolute(relative)
  );
}

function assertOutputBoundary(repoRoot, outputRoot, shell) {
  const sourceRoots = [shell, "assets", ...RUNTIME_ROOTS]
    .map((relativePath) => path.join(repoRoot, relativePath));
  const overlap = sourceRoots.find((sourceRoot) => (
    isWithin(outputRoot, sourceRoot) || isWithin(sourceRoot, outputRoot)
  ));
  if (overlap) {
    throw new Error(`Host plugin output must not overlap canonical source roots: ${outputRoot}`);
  }
}

async function pathExists(filePath) {
  return Boolean(await lstat(filePath).catch(() => null));
}

function shouldCopy(sourcePath, repoRoot) {
  const relative = path.relative(repoRoot, sourcePath).split(path.sep).join("/");
  const base = path.basename(sourcePath);
  if (base === ".DS_Store" || base === ".plugin-eval") return false;
  if (base.endsWith(".tmp") || base.endsWith(".log")) return false;
  return relative !== "scripts/packaging" && !relative.startsWith("scripts/packaging/");
}

async function copyRepoPath(repoRoot, artifactRoot, relativePath) {
  const source = path.join(repoRoot, relativePath);
  if (!(await pathExists(source))) {
    throw new Error(`Missing source path for host plugin artifact: ${relativePath}`);
  }
  const destination = path.join(artifactRoot, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, {
    recursive: true,
    dereference: true,
    filter: (candidate) => shouldCopy(candidate, repoRoot),
  });
}

async function copyRuntimeDependency(artifactRoot, dependency) {
  const packageJsonPath = require.resolve(`${dependency}/package.json`);
  const packageRoot = await realpath(path.dirname(packageJsonPath));
  const destination = path.join(artifactRoot, "node_modules", ...dependency.split("/"));
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(packageRoot, destination, { recursive: true, dereference: true });
}

export function artifactPackage(sourcePackage) {
  if (typeof sourcePackage.license !== "string" || !sourcePackage.license.trim()) {
    throw new Error("Source package.json must declare a license");
  }
  const metadata = {
    name: sourcePackage.name,
    version: sourcePackage.version,
    private: true,
    description: sourcePackage.description,
    license: sourcePackage.license,
    type: sourcePackage.type,
    bin: sourcePackage.bin,
    engines: sourcePackage.engines,
    dependencies: sourcePackage.dependencies,
  };
  for (const field of ["repository", "homepage"]) {
    if (sourcePackage[field] !== undefined) {
      metadata[field] = sourcePackage[field];
    }
  }
  return metadata;
}

async function assertReplaceable(outputRoot) {
  if (!(await pathExists(outputRoot))) return false;
  const markerPath = path.join(outputRoot, ARTIFACT_MARKER);
  const marker = await readFile(markerPath, "utf8")
    .then((content) => JSON.parse(content))
    .catch(() => null);
  if (marker?.kind !== ARTIFACT_KIND || marker?.schemaVersion !== ARTIFACT_SCHEMA_VERSION) {
    throw new Error(`Refusing to replace unowned output directory: ${outputRoot}`);
  }
  return true;
}

async function publishStagedArtifact(stageRoot, outputRoot, replaceExisting) {
  if (!replaceExisting) {
    await rename(stageRoot, outputRoot);
    return;
  }

  const backupRoot = `${outputRoot}.previous-${process.pid}`;
  await rm(backupRoot, { recursive: true, force: true });
  await rename(outputRoot, backupRoot);
  try {
    await rename(stageRoot, outputRoot);
    await rm(backupRoot, { recursive: true, force: true });
  } catch (error) {
    await rename(backupRoot, outputRoot).catch(() => {});
    throw error;
  }
}

export async function buildHostPluginArtifact({
  host = "codex",
  outputRoot = path.join(defaultRepoRoot, "dist", "plugins", "better-harness"),
  repoRoot = defaultRepoRoot,
} = {}) {
  const resolvedRepoRoot = path.resolve(repoRoot);
  const resolvedOutputRoot = path.resolve(outputRoot);
  const shell = hostShell(host);
  if (path.basename(resolvedOutputRoot) !== "better-harness") {
    throw new Error(`Host plugin output directory must be named better-harness: ${resolvedOutputRoot}`);
  }
  assertOutputBoundary(resolvedRepoRoot, resolvedOutputRoot, shell);

  const replaceExisting = await assertReplaceable(resolvedOutputRoot);
  const outputParent = path.dirname(resolvedOutputRoot);
  await mkdir(outputParent, { recursive: true });
  const stageContainer = await mkdtemp(path.join(outputParent, ".better-harness.build-"));
  const stageRoot = path.join(stageContainer, "better-harness");
  await mkdir(stageRoot, { recursive: true });

  try {
    const sourcePackage = JSON.parse(await readFile(path.join(resolvedRepoRoot, "package.json"), "utf8"));
    const hostManifest = JSON.parse(await readFile(path.join(resolvedRepoRoot, shell, "plugin.json"), "utf8"));

    await copyRepoPath(resolvedRepoRoot, stageRoot, shell);
    for (const rootFile of ROOT_FILES) {
      await copyRepoPath(resolvedRepoRoot, stageRoot, rootFile);
    }
    for (const root of RUNTIME_ROOTS) {
      await copyRepoPath(resolvedRepoRoot, stageRoot, root);
    }
    for (const dependency of RUNTIME_DEPENDENCIES) {
      await copyRuntimeDependency(stageRoot, dependency);
    }

    await writeFile(
      path.join(stageRoot, "package.json"),
      `${JSON.stringify(artifactPackage(sourcePackage), null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      path.join(stageRoot, ARTIFACT_MARKER),
      `${JSON.stringify({
        kind: ARTIFACT_KIND,
        schemaVersion: ARTIFACT_SCHEMA_VERSION,
        host,
        pluginName: hostManifest.name,
        version: hostManifest.version,
        runtimeRoots: RUNTIME_ROOTS,
        runtimeDependencies: RUNTIME_DEPENDENCIES,
      }, null, 2)}\n`,
      "utf8",
    );

    const stagedResult = await verifyHostPluginArtifact(stageRoot, { host });
    await publishStagedArtifact(stageRoot, resolvedOutputRoot, replaceExisting);
    await rm(stageContainer, { recursive: true, force: true });
    return {
      ...stagedResult,
      pluginRoot: resolvedOutputRoot,
      replaced: replaceExisting,
    };
  } catch (error) {
    await rm(stageContainer, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function parseArgs(argv) {
  const options = {
    host: "codex",
    outputRoot: path.join(defaultRepoRoot, "dist", "plugins", "better-harness"),
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--host") options.host = argv[++index];
    else if (arg.startsWith("--host=")) options.host = arg.slice("--host=".length);
    else if (arg === "--out") options.outputRoot = path.resolve(argv[++index]);
    else if (arg.startsWith("--out=")) options.outputRoot = path.resolve(arg.slice("--out=".length));
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return [
    "Usage: node scripts/packaging/build-host-plugin.mjs [options]",
    "",
    "Options:",
    "  --host <codex>          Host artifact to build (default: codex)",
    "  --out <path>            Output root named better-harness",
    "  --json                  Emit parser-safe JSON",
    "  -h, --help              Print help",
    "",
  ].join("\n");
}

export async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
    if (options.help) {
      process.stdout.write(usage());
      return 0;
    }
    const result = await buildHostPluginArtifact(options);
    process.stdout.write(options.json
      ? `${JSON.stringify({ ok: true, data: result }, null, 2)}\n`
      : `host plugin artifact built: ${result.pluginRoot} (${result.fileCount} files, ${result.totalBytes} bytes)\n`);
    return 0;
  } catch (error) {
    if (options?.json || argv.includes("--json")) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: { message: error.message } }, null, 2)}\n`);
    } else {
      process.stderr.write(`host plugin build failed: ${error.message}\n`);
    }
    return 1;
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  process.exitCode = await main();
}
