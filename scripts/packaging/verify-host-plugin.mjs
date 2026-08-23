#!/usr/bin/env node

import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ARTIFACT_KIND = "better-harness-host-plugin-artifact";
export const ARTIFACT_SCHEMA_VERSION = 1;
export const ARTIFACT_MARKER = ".host-plugin-artifact.json";
export const SUPPORTED_HOSTS = Object.freeze(["codex"]);
export const RUNTIME_DEPENDENCIES = Object.freeze([
  "@vscode/tree-sitter-wasm",
  "esbuild-wasm",
  "yaml",
]);
export const RUNTIME_DEPENDENCY_LICENSES = Object.freeze({
  "@vscode/tree-sitter-wasm": "LICENSE",
  "esbuild-wasm": "LICENSE.md",
  yaml: "LICENSE",
});

const HOSTS = Object.freeze({
  codex: {
    manifestDir: ".codex-plugin",
    manifestPath: ".codex-plugin/plugin.json",
  },
});

const REQUIRED_PATHS = Object.freeze([
  "LICENSE",
  "README.md",
  "AGENTS.md",
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "case-studies/factory/model/factory-readiness.md",
  "docs/glossary.md",
  "hooks/hooks.json.template",
  "models/routing.md",
  "references/README.md",
  "references/loop-engineering/loop-blueprint.md",
  "scripts/better-harness.mjs",
  "skills/better-harness/SKILL.md",
  "templates/reporting/routing.md",
]);

const FORBIDDEN_TOP_LEVEL = new Set([
  ".agents",
  ".claude-plugin",
  ".cursor-plugin",
  ".git",
  ".harness",
  ".better-harness",
  ".idea",
  ".qoder",
  ".qoder-plugin",
  "benchmark",
  "dev",
  "outputs",
  "test",
]);

const FORBIDDEN_PATHS = new Set([
  "assets/logo.svg",
]);

function hostDefinition(host) {
  const definition = HOSTS[host];
  if (!definition) {
    throw new Error(`Unsupported host: ${host}. Supported hosts: ${SUPPORTED_HOSTS.join(", ")}`);
  }
  return definition;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function requireRegularFile(root, relativePath) {
  const filePath = path.join(root, relativePath);
  let stats;
  try {
    stats = await lstat(filePath);
  } catch {
    throw new Error(`Missing required artifact file: ${relativePath}`);
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`Artifact path must be a regular file: ${relativePath}`);
  }
  return stats;
}

async function inspectTree(root) {
  const summary = { fileCount: 0, totalBytes: 0 };

  async function visit(current, relative = "") {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryRelative = relative ? path.join(relative, entry.name) : entry.name;
      const entryPath = path.join(current, entry.name);
      const posixRelative = entryRelative.split(path.sep).join("/");

      if (entry.isSymbolicLink()) {
        throw new Error(`Artifact must not contain symlinks: ${posixRelative}`);
      }
      if (entry.name === ".DS_Store" || entry.name === ".plugin-eval") {
        throw new Error(`Artifact contains generated or host-local state: ${posixRelative}`);
      }
      if (relative === "" && FORBIDDEN_TOP_LEVEL.has(entry.name)) {
        throw new Error(`Artifact contains forbidden top-level path: ${entry.name}`);
      }
      if (FORBIDDEN_PATHS.has(posixRelative)) {
        throw new Error(`Artifact contains forbidden path: ${posixRelative}`);
      }
      if (posixRelative === "scripts/packaging" || posixRelative.startsWith("scripts/packaging/")) {
        throw new Error(`Artifact contains source-local packaging code: ${posixRelative}`);
      }
      if (posixRelative === "skills/harness" || posixRelative.startsWith("skills/harness/")) {
        throw new Error(`Artifact contains retired skill: ${posixRelative}`);
      }
      if (posixRelative === "skills/loop-blueprint" || posixRelative.startsWith("skills/loop-blueprint/")) {
        throw new Error(`Artifact contains retired skill: ${posixRelative}`);
      }
      if (entry.isDirectory()) {
        await visit(entryPath, entryRelative);
      } else if (entry.isFile()) {
        const stats = await lstat(entryPath);
        summary.fileCount += 1;
        summary.totalBytes += stats.size;
      }
    }
  }

  await visit(root);
  return summary;
}

export async function verifyHostPluginArtifact(pluginRoot, { host = "codex" } = {}) {
  const resolvedRoot = path.resolve(pluginRoot);
  const definition = hostDefinition(host);
  const rootStats = await lstat(resolvedRoot).catch(() => null);
  if (!rootStats?.isDirectory()) {
    throw new Error(`Plugin artifact root does not exist: ${resolvedRoot}`);
  }

  const marker = await readJson(path.join(resolvedRoot, ARTIFACT_MARKER)).catch(() => null);
  if (!marker || marker.kind !== ARTIFACT_KIND || marker.schemaVersion !== ARTIFACT_SCHEMA_VERSION) {
    throw new Error(`Plugin artifact marker is missing or invalid: ${ARTIFACT_MARKER}`);
  }
  if (marker.host !== host) {
    throw new Error(`Plugin artifact host mismatch: expected ${host}, found ${marker.host ?? "<missing>"}`);
  }

  await requireRegularFile(resolvedRoot, definition.manifestPath);
  await requireRegularFile(resolvedRoot, "package.json");
  await requireRegularFile(resolvedRoot, ARTIFACT_MARKER);
  for (const requiredPath of REQUIRED_PATHS) {
    await requireRegularFile(resolvedRoot, requiredPath);
  }
  for (const dependency of RUNTIME_DEPENDENCIES) {
    await requireRegularFile(resolvedRoot, path.join("node_modules", dependency, "package.json"));
    await requireRegularFile(
      resolvedRoot,
      path.join("node_modules", dependency, RUNTIME_DEPENDENCY_LICENSES[dependency]),
    );
  }

  const manifest = await readJson(path.join(resolvedRoot, definition.manifestPath));
  const packageJson = await readJson(path.join(resolvedRoot, "package.json"));
  if (path.basename(resolvedRoot) !== manifest.name) {
    throw new Error(`Plugin artifact directory must match manifest name: ${manifest.name}`);
  }
  if (manifest.name !== marker.pluginName) {
    throw new Error(`Plugin artifact marker name mismatch: ${marker.pluginName ?? "<missing>"}`);
  }
  if (manifest.version !== packageJson.version || manifest.version !== marker.version) {
    throw new Error(
      `Plugin artifact version mismatch: manifest=${manifest.version}, package=${packageJson.version}, marker=${marker.version}`,
    );
  }
  if (manifest.skills !== "./skills/") {
    throw new Error(`Plugin artifact manifest must route skills through ./skills/: ${manifest.skills ?? "<missing>"}`);
  }
  if (packageJson.private !== true) {
    throw new Error("Plugin artifact package.json must be private");
  }
  if (typeof packageJson.license !== "string" || !packageJson.license.trim()) {
    throw new Error("Plugin artifact package.json must declare a license");
  }

  const summary = await inspectTree(resolvedRoot);
  return {
    kind: ARTIFACT_KIND,
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    host,
    pluginRoot: resolvedRoot,
    pluginName: manifest.name,
    version: manifest.version,
    ...summary,
  };
}

function parseArgs(argv) {
  const options = {
    host: "codex",
    pluginRoot: path.resolve("dist", "plugins", "better-harness"),
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--host") options.host = argv[++index];
    else if (arg.startsWith("--host=")) options.host = arg.slice("--host=".length);
    else if (arg === "--plugin-root") options.pluginRoot = path.resolve(argv[++index]);
    else if (arg.startsWith("--plugin-root=")) options.pluginRoot = path.resolve(arg.slice("--plugin-root=".length));
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return [
    "Usage: node scripts/packaging/verify-host-plugin.mjs [options]",
    "",
    "Options:",
    "  --host <codex>          Host artifact to verify (default: codex)",
    "  --plugin-root <path>    Generated plugin root",
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
    const result = await verifyHostPluginArtifact(options.pluginRoot, { host: options.host });
    process.stdout.write(options.json
      ? `${JSON.stringify({ ok: true, data: result }, null, 2)}\n`
      : `host plugin artifact verified: ${result.pluginRoot} (${result.fileCount} files, ${result.totalBytes} bytes)\n`);
    return 0;
  } catch (error) {
    if (options?.json || argv.includes("--json")) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: { message: error.message } }, null, 2)}\n`);
    } else {
      process.stderr.write(`host plugin verification failed: ${error.message}\n`);
    }
    return 1;
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  process.exitCode = await main();
}
