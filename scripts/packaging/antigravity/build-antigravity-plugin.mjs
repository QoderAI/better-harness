#!/usr/bin/env node

import { createRequire } from "node:module";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import {
  ANTIGRAVITY_ARTIFACT_KIND,
  ANTIGRAVITY_ARTIFACT_MARKER,
  ANTIGRAVITY_ARTIFACT_SCHEMA_VERSION,
  ANTIGRAVITY_HOST,
  ANTIGRAVITY_PLUGIN_NAME,
  CANONICAL_SKILL,
  RUNTIME_DEPENDENCIES,
  RUNTIME_DEPENDENCY_LICENSES,
  isAllowedArtifactPath,
  validatePortablePathComponent,
  verifyAntigravityPluginArtifact,
} from "./verify-antigravity-plugin.mjs";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(currentDir, "..", "..", "..");
const SOURCE_MANIFEST = "scripts/packaging/antigravity/plugin-manifest.json";
const ROOT_FILES = Object.freeze([
  "README.md",
  "AGENTS.md",
  "DESIGN.md",
  "LICENSE",
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
]);
const SOURCE_ROOTS = Object.freeze([
  "skills/better-harness",
  "scripts",
  "references",
  "templates",
  "models",
  "hooks",
  "docs",
  "case-studies",
]);
const GENERATED_NAMES = new Set([
  ".DS_Store",
  ".plugin-eval",
  ".cache",
  ".docusaurus",
  ".vite",
  "cache",
  "coverage",
  "dist",
  "node_modules",
  "outputs",
  "temp",
  "tmp",
]);

export class AntigravityBuildError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AntigravityBuildError";
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(code, message, details) {
  throw new AntigravityBuildError(code, message, details);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonblankString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isContained(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (
    relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

async function readJsonObject(filePath, code) {
  let value;
  try {
    value = JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    fail(code, "Required source JSON is missing, unreadable, or malformed");
  }
  if (!isObject(value)) fail(code, "Required source JSON must be an object");
  return value;
}

async function requireRegularSource(filePath, canonicalRepoRoot, code) {
  let stats;
  try {
    stats = await lstat(filePath);
  } catch {
    fail(code, "Required source file is missing or unreadable");
  }
  if (stats.isSymbolicLink() || !stats.isFile()) fail(code, "Required source must be a regular file");
  const canonical = await realpath(filePath).catch(() => null);
  if (!canonical || !isContained(canonical, canonicalRepoRoot)) {
    fail(code, "Required source escapes the canonical repository root");
  }
  return { stats, canonical };
}

function shouldSkipSource(relativePath) {
  if (relativePath.startsWith("node_modules/")) return false;
  if (relativePath === "scripts/packaging" || relativePath.startsWith("scripts/packaging/")) return true;
  return relativePath.split("/").some((component) => (
    GENERATED_NAMES.has(component)
    || component === ".env"
    || component.startsWith(".env.")
    || component.endsWith(".tmp")
    || component.endsWith(".log")
  ));
}

async function copyRegularTree({ source, destination, relativePath, canonicalBoundary }) {
  if (shouldSkipSource(relativePath)) return;
  for (const component of relativePath.split("/")) validatePortablePathComponent(component);
  if (!isAllowedArtifactPath(relativePath)) fail("source-path-forbidden", "Source path is outside the artifact allowlist");
  let stats;
  try {
    stats = await lstat(source);
  } catch {
    fail("source-entry-unreadable", "Allowlisted source entry is missing or unreadable");
  }
  if (stats.isSymbolicLink()) fail("source-symlink-forbidden", "Source artifact input must not be a symbolic link");
  if (!stats.isDirectory() && !stats.isFile()) fail("source-special-file-forbidden", "Source artifact input must be regular");
  const canonical = await realpath(source).catch(() => null);
  if (!canonical || !isContained(canonical, canonicalBoundary)) {
    fail("source-path-escape", "Source artifact input escapes its canonical root");
  }
  if (stats.isFile()) {
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
    return;
  }
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true }).catch(() => {
    fail("source-directory-unreadable", "Allowlisted source directory cannot be read");
  });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    const childRelative = `${relativePath}/${entry.name}`;
    if (shouldSkipSource(childRelative)) continue;
    await copyRegularTree({
      source: path.join(source, entry.name),
      destination: path.join(destination, entry.name),
      relativePath: childRelative,
      canonicalBoundary,
    });
  }
}

export function artifactPackage(sourcePackage) {
  const binKeys = isObject(sourcePackage.bin) ? Object.keys(sourcePackage.bin) : [];
  const engineKeys = isObject(sourcePackage.engines) ? Object.keys(sourcePackage.engines).sort() : [];
  if (
    sourcePackage.name !== "@qoder-ai/better-harness"
    || !isNonblankString(sourcePackage.version)
    || !isNonblankString(sourcePackage.license)
    || sourcePackage.type !== "module"
    || !isObject(sourcePackage.dependencies)
  ) {
    fail("source-package-invalid", "Source package identity or runtime metadata is invalid");
  }
  if (
    binKeys.length !== 1
    || binKeys[0] !== "better-harness"
    || sourcePackage.bin["better-harness"] !== "scripts/better-harness.mjs"
  ) {
    fail("source-bin-invalid", "Source package bin must match the artifact runtime entry");
  }
  if (
    engineKeys.length !== 2
    || engineKeys[0] !== "node"
    || engineKeys[1] !== "npm"
    || !isNonblankString(sourcePackage.engines.node)
    || !isNonblankString(sourcePackage.engines.npm)
  ) {
    fail("source-engines-invalid", "Source package engines must contain nonblank node and npm ranges");
  }
  const dependencyKeys = Object.keys(sourcePackage.dependencies).sort();
  const expected = [...RUNTIME_DEPENDENCIES].sort();
  if (
    dependencyKeys.length !== expected.length
    || dependencyKeys.some((dependency, index) => dependency !== expected[index])
    || RUNTIME_DEPENDENCIES.some((dependency) => !isNonblankString(sourcePackage.dependencies[dependency]))
  ) {
    fail("source-dependencies-invalid", "Source package dependencies do not match the artifact profile");
  }
  return {
    name: sourcePackage.name,
    version: sourcePackage.version,
    private: true,
    license: sourcePackage.license,
    type: sourcePackage.type,
    bin: { "better-harness": sourcePackage.bin["better-harness"] },
    engines: { node: sourcePackage.engines.node, npm: sourcePackage.engines.npm },
    dependencies: Object.fromEntries(RUNTIME_DEPENDENCIES.map((dependency) => (
      [dependency, sourcePackage.dependencies[dependency]]
    ))),
  };
}

async function resolveDependencyRoot(repoRoot, dependency) {
  const require = createRequire(path.join(repoRoot, "package.json"));
  let packageJsonPath;
  try {
    packageJsonPath = require.resolve(`${dependency}/package.json`);
  } catch {
    fail("dependency-resolution-failed", "Required runtime dependency cannot be resolved");
  }
  const packageRoot = path.dirname(packageJsonPath);
  const canonicalRoot = await realpath(packageRoot).catch(() => null);
  if (!canonicalRoot) fail("dependency-resolution-failed", "Runtime dependency root cannot be resolved");
  return { packageRoot, canonicalRoot };
}

async function copyDependency({ repoRoot, stageRoot, dependency, expectedVersion }) {
  const { packageRoot, canonicalRoot } = await resolveDependencyRoot(repoRoot, dependency);
  const metadata = await readJsonObject(path.join(packageRoot, "package.json"), "dependency-package-invalid");
  if (metadata.name !== dependency || metadata.version !== expectedVersion) {
    fail("dependency-identity-invalid", "Resolved dependency identity or version does not match source package.json");
  }
  await requireRegularSource(
    path.join(packageRoot, RUNTIME_DEPENDENCY_LICENSES[dependency]),
    canonicalRoot,
    "dependency-license-invalid",
  );
  await copyRegularTree({
    source: packageRoot,
    destination: path.join(stageRoot, "node_modules", ...dependency.split("/")),
    relativePath: `node_modules/${dependency}`,
    canonicalBoundary: canonicalRoot,
  });
}

export async function assertOutputBoundary(repoRoot, outputRoot) {
  if (
    typeof outputRoot !== "string"
    || !outputRoot
    || outputRoot.includes("\0")
    || path.basename(path.resolve(outputRoot)) !== ANTIGRAVITY_PLUGIN_NAME
  ) {
    fail("output-invalid", "Output must be a path whose basename is better-harness");
  }
  const resolvedRepo = path.resolve(repoRoot);
  const resolvedOutput = path.resolve(outputRoot);
  const resolvedParent = path.dirname(resolvedOutput);
  if (resolvedOutput === path.parse(resolvedOutput).root) fail("output-overlap", "Output must not be a filesystem root");
  if (isContained(resolvedOutput, resolvedRepo) || isContained(resolvedRepo, resolvedOutput)) {
    fail("output-overlap", "Output must not overlap the repository source root");
  }
  const canonicalRepo = await realpath(resolvedRepo).catch(() => null);
  if (!canonicalRepo) fail("output-boundary-unavailable", "Output boundary cannot be resolved");

  const missingComponents = [];
  let existingAncestor = resolvedParent;
  while (true) {
    let stats;
    try {
      stats = await lstat(existingAncestor);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        fail("output-boundary-unavailable", "Output boundary cannot be resolved");
      }
      const parent = path.dirname(existingAncestor);
      if (parent === existingAncestor) {
        fail("output-boundary-unavailable", "Output boundary cannot be resolved");
      }
      missingComponents.unshift(path.basename(existingAncestor));
      existingAncestor = parent;
      continue;
    }
    if (!stats.isDirectory() && !stats.isSymbolicLink()) {
      fail("output-boundary-unavailable", "Output parent boundary must be a directory");
    }
    break;
  }
  const canonicalAncestor = await realpath(existingAncestor).catch(() => null);
  if (!canonicalAncestor) fail("output-boundary-unavailable", "Output boundary cannot be resolved");
  const canonicalAncestorStats = await lstat(canonicalAncestor).catch(() => null);
  if (!canonicalAncestorStats?.isDirectory()) {
    fail("output-boundary-unavailable", "Output parent boundary must resolve to a directory");
  }
  const canonicalParent = path.resolve(canonicalAncestor, ...missingComponents);
  const canonicalOutput = path.join(canonicalParent, path.basename(resolvedOutput));
  if (isContained(canonicalOutput, canonicalRepo) || isContained(canonicalRepo, canonicalOutput)) {
    fail("output-overlap", "Output must not overlap the repository source root");
  }
  return {
    resolvedOutput,
    resolvedParent,
    canonicalRepo,
    canonicalParent,
    canonicalOutput,
  };
}

function publicationComplete(replaced) {
  return {
    state: "published",
    backupCleanup: "complete",
    replaced,
  };
}

function publicationError(code, message, state, backupName, details = {}) {
  fail(code, message, {
    publication: { state, backupName, ...details },
  });
}

export async function publishStagedArtifact({
  stageRoot,
  outputRoot,
  replaceExisting,
  operations = { rename, remove: rm },
}) {
  if (!replaceExisting) {
    await operations.rename(stageRoot, outputRoot);
    return { publication: publicationComplete(false), warnings: [] };
  }
  const backupName = `.better-harness-antigravity-backup-${randomUUID()}`;
  const backupContainer = path.join(path.dirname(outputRoot), backupName);
  const backupRoot = path.join(backupContainer, ANTIGRAVITY_PLUGIN_NAME);
  await mkdir(backupContainer);
  try {
    await operations.rename(outputRoot, backupRoot);
  } catch {
    let backupCleanup = "complete";
    try {
      await operations.remove(backupContainer, { recursive: true, force: true });
    } catch {
      backupCleanup = "pending";
    }
    publicationError(
      "publish-backup-rename-failed",
      "Artifact publication could not begin and the destination was left unchanged",
      "not-published-destination-unchanged",
      backupName,
      { backupCleanup },
    );
  }

  try {
    await verifyAntigravityPluginArtifact(backupRoot);
  } catch {
    try {
      await operations.rename(backupRoot, outputRoot);
      await operations.remove(backupContainer, { recursive: true, force: true }).catch(() => {});
    } catch {
      publicationError(
        "destination-revalidation-rollback-failed",
        "Destination changed after preflight and its moved tree was retained",
        "not-published-backup-retained",
        backupName,
      );
    }
    publicationError(
      "destination-changed",
      "Destination changed after preflight and was restored without publication",
      "not-published-destination-restored",
      backupName,
    );
  }

  try {
    await operations.rename(stageRoot, outputRoot);
  } catch {
    try {
      await operations.rename(backupRoot, outputRoot);
      await operations.remove(backupContainer, { recursive: true, force: true }).catch(() => {});
    } catch {
      publicationError(
        "publish-rollback-failed",
        "Artifact publication failed and the verified moved tree was retained",
        "not-published-verified-backup-retained",
        backupName,
      );
    }
    publicationError(
      "publish-failed",
      "Artifact publication failed and the prior artifact was restored",
      "not-published-destination-restored",
      backupName,
    );
  }

  try {
    await operations.remove(backupContainer, { recursive: true, force: true });
  } catch {
    const warning = {
      code: "backup-cleanup-pending",
      state: "published",
      backupCleanup: "pending",
      backupName,
    };
    return {
      publication: {
        state: "published",
        backupCleanup: "pending",
        replaced: true,
        backupName,
      },
      warnings: [warning],
    };
  }
  return { publication: publicationComplete(true), warnings: [] };
}

async function pathExists(candidate) {
  return Boolean(await lstat(candidate).catch(() => null));
}

export async function buildAntigravityPluginArtifact({
  repoRoot,
  outputRoot,
  operations = { rename, remove: rm },
  boundaryOperations = { mkdir },
} = {}) {
  if (!repoRoot || !outputRoot) fail("build-arguments-invalid", "repoRoot and outputRoot are required");
  const preflightBoundary = await assertOutputBoundary(repoRoot, outputRoot);
  await boundaryOperations.mkdir(preflightBoundary.canonicalParent, { recursive: true });
  const boundary = await assertOutputBoundary(repoRoot, outputRoot);
  const sourceManifestPath = path.join(boundary.canonicalRepo, ...SOURCE_MANIFEST.split("/"));
  await requireRegularSource(sourceManifestPath, boundary.canonicalRepo, "source-manifest-invalid");
  const sourceManifest = await readJsonObject(sourceManifestPath, "source-manifest-invalid");
  if (
    Object.keys(sourceManifest).length !== 1
    || sourceManifest.name !== ANTIGRAVITY_PLUGIN_NAME
  ) {
    fail("source-manifest-invalid", "Source Antigravity manifest must equal the frozen name-only object");
  }

  let replaceExisting = false;
  const destinationStats = await lstat(boundary.canonicalOutput).catch(() => null);
  if (destinationStats) {
    if (destinationStats.isSymbolicLink() || !destinationStats.isDirectory()) {
      fail("destination-unowned", "Existing output is not a fully verified Antigravity artifact");
    }
    try {
      await verifyAntigravityPluginArtifact(boundary.canonicalOutput);
      replaceExisting = true;
    } catch {
      fail("destination-unowned", "Existing output is not a fully verified Antigravity artifact");
    }
  }

  const stageContainer = await mkdtemp(path.join(boundary.canonicalParent, ".better-harness-antigravity-stage-"));
  const stageRoot = path.join(stageContainer, ANTIGRAVITY_PLUGIN_NAME);
  await mkdir(stageRoot);
  try {
    const sourcePackage = await readJsonObject(
      path.join(boundary.canonicalRepo, "package.json"),
      "source-package-invalid",
    );
    const packageJson = artifactPackage(sourcePackage);
    for (const rootFile of ROOT_FILES) {
      await copyRegularTree({
        source: path.join(boundary.canonicalRepo, rootFile),
        destination: path.join(stageRoot, rootFile),
        relativePath: rootFile,
        canonicalBoundary: boundary.canonicalRepo,
      });
    }
    for (const sourceRoot of SOURCE_ROOTS) {
      if (!(await pathExists(path.join(boundary.canonicalRepo, ...sourceRoot.split("/"))))) continue;
      await copyRegularTree({
        source: path.join(boundary.canonicalRepo, ...sourceRoot.split("/")),
        destination: path.join(stageRoot, ...sourceRoot.split("/")),
        relativePath: sourceRoot,
        canonicalBoundary: boundary.canonicalRepo,
      });
    }
    for (const dependency of RUNTIME_DEPENDENCIES) {
      await copyDependency({
        repoRoot: boundary.canonicalRepo,
        stageRoot,
        dependency,
        expectedVersion: packageJson.dependencies[dependency],
      });
    }
    await writeFile(path.join(stageRoot, "plugin.json"), `${JSON.stringify(sourceManifest, null, 2)}\n`, "utf8");
    await writeFile(path.join(stageRoot, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
    await writeFile(path.join(stageRoot, ANTIGRAVITY_ARTIFACT_MARKER), `${JSON.stringify({
      kind: ANTIGRAVITY_ARTIFACT_KIND,
      schemaVersion: ANTIGRAVITY_ARTIFACT_SCHEMA_VERSION,
      host: ANTIGRAVITY_HOST,
      pluginName: ANTIGRAVITY_PLUGIN_NAME,
      version: packageJson.version,
      canonicalSkill: CANONICAL_SKILL,
      runtimeDependencies: [...RUNTIME_DEPENDENCIES],
    }, null, 2)}\n`, "utf8");

    const verified = await verifyAntigravityPluginArtifact(stageRoot);
    const published = await publishStagedArtifact({
      stageRoot,
      outputRoot: boundary.canonicalOutput,
      replaceExisting,
      operations,
    });
    await rm(stageContainer, { recursive: true, force: true });
    return {
      ...verified,
      replaced: replaceExisting,
      publication: published.publication,
      warnings: published.warnings,
    };
  } catch (error) {
    await rm(stageContainer, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export function parseArgs(argv) {
  const options = { outputRoot: null, json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--out") {
      if (options.outputRoot !== null) fail("argument-duplicate", "--out may be provided only once");
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail("argument-value-missing", "--out requires a value");
      options.outputRoot = value;
      index += 1;
    } else if (argument.startsWith("--out=")) {
      if (options.outputRoot !== null) fail("argument-duplicate", "--out may be provided only once");
      const value = argument.slice("--out=".length);
      if (!value) fail("argument-value-missing", "--out requires a value");
      options.outputRoot = value;
    } else if (argument === "--json") options.json = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else fail("argument-unknown", "Unknown argument");
  }
  if (!options.help && options.outputRoot === null) fail("argument-required", "--out is required");
  return options;
}

export function usage() {
  return [
    "Usage: node scripts/packaging/antigravity/build-antigravity-plugin.mjs --out <path> [options]",
    "",
    "Options:",
    "  --out <path>    Output root named better-harness (required)",
    "  --json          Emit parser-safe JSON",
    "  -h, --help      Print help",
    "",
  ].join("\n");
}

export function formatBuildSuccess(result, { json = false } = {}) {
  if (json) {
    return `${JSON.stringify({ ok: true, data: result, warnings: result.warnings ?? [] }, null, 2)}\n`;
  }
  const summary = `Antigravity plugin artifact built: ${result.pluginName} ${result.version} (${result.fileCount} files)\n`;
  if (result.publication?.backupCleanup !== "pending") return summary;
  const warning = result.warnings?.find((entry) => entry.code === "backup-cleanup-pending");
  return `${summary}Warning [backup-cleanup-pending]: artifact published; state=published backupCleanup=pending (${warning?.backupName ?? "backup-retained"})\n`;
}

export async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
    if (options.help) {
      process.stdout.write(usage());
      return 0;
    }
    const result = await buildAntigravityPluginArtifact({
      repoRoot: defaultRepoRoot,
      outputRoot: options.outputRoot,
    });
    process.stdout.write(formatBuildSuccess(result, { json: options.json }));
    return 0;
  } catch (error) {
    const code = error instanceof AntigravityBuildError ? error.code : "artifact-build-failed";
    const message = error instanceof AntigravityBuildError ? error.message : "Artifact build failed";
    if (options?.json || argv.includes("--json")) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: { code, message } }, null, 2)}\n`);
    } else {
      process.stderr.write(`Antigravity plugin build failed [${code}]: ${message}\n`);
    }
    return 1;
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  process.exitCode = await main();
}
