#!/usr/bin/env node

import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ANTIGRAVITY_ARTIFACT_KIND = "better-harness-antigravity-plugin-artifact";
export const ANTIGRAVITY_ARTIFACT_MARKER = ".antigravity-plugin-artifact.json";
export const ANTIGRAVITY_ARTIFACT_SCHEMA_VERSION = 1;
export const ANTIGRAVITY_HOST = "antigravity";
export const ANTIGRAVITY_PLUGIN_NAME = "better-harness";
export const CANONICAL_SKILL = "skills/better-harness/SKILL.md";
export const RUNTIME_ENTRY = "scripts/better-harness.mjs";
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
export const GRAPH_LIMITS = Object.freeze({
  markdownNodes: 128,
  markdownEdges: 1024,
  markdownDepth: 32,
  runtimeModules: 1024,
  runtimeEdges: 8192,
  runtimeDepth: 64,
});
export const FILE_LIMITS = Object.freeze({
  entries: 25_000,
  directoryDepth: 64,
  componentLength: 255,
  files: 20_000,
  totalBytes: 256 * 1024 * 1024,
  textBytes: 4 * 1024 * 1024,
});

const ROOT_FILES = new Set([
  "plugin.json",
  ANTIGRAVITY_ARTIFACT_MARKER,
  "package.json",
  "README.md",
  "AGENTS.md",
  "DESIGN.md",
  "LICENSE",
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
]);
const BROAD_ROOTS = new Set([
  "references",
  "templates",
  "models",
  "hooks",
  "docs",
  "case-studies",
]);
const RUNTIME_ROOTS = new Set([
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
  "outputs",
  "temp",
  "tmp",
]);
const MARKER_KEYS = Object.freeze([
  "canonicalSkill",
  "host",
  "kind",
  "pluginName",
  "runtimeDependencies",
  "schemaVersion",
  "version",
]);
const CLI_MANIFEST_KEYS = new Set(["description", "name"]);
const CLI_PLUGIN_NAME_PATTERN = /^[A-Za-z0-9_-]+$/u;
const PACKAGE_KEYS = Object.freeze([
  "bin",
  "dependencies",
  "engines",
  "license",
  "name",
  "private",
  "type",
  "version",
]);
const REQUIRED_FILES = Object.freeze([
  "plugin.json",
  ANTIGRAVITY_ARTIFACT_MARKER,
  "package.json",
  "README.md",
  "AGENTS.md",
  "DESIGN.md",
  "LICENSE",
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  CANONICAL_SKILL,
  RUNTIME_ENTRY,
  "node_modules/@vscode/tree-sitter-wasm/package.json",
  "node_modules/@vscode/tree-sitter-wasm/LICENSE",
  "node_modules/esbuild-wasm/package.json",
  "node_modules/esbuild-wasm/LICENSE.md",
  "node_modules/yaml/package.json",
  "node_modules/yaml/LICENSE",
]);

export class AntigravityArtifactError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AntigravityArtifactError";
    this.code = code;
  }
}

// `details` carries repository- or artifact-relative paths only. An absolute
// path would leak the operator's filesystem layout into an error a caller may
// log, which is why the messages themselves stay location-free.
function fail(code, message, details = {}) {
  const error = new AntigravityArtifactError(code, message);
  Object.assign(error, details);
  throw error;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonblankString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function posixPath(value) {
  return value.split(path.sep).join("/");
}

function isContained(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (
    relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function hasGeneratedName(relativePath, { allowDist = false } = {}) {
  const names = relativePath.split("/");
  return names.some((name) => (
    (GENERATED_NAMES.has(name) && !(allowDist && name === "dist"))
    || name === ".env"
    || name.startsWith(".env.")
    || name.endsWith(".tmp")
    || name.endsWith(".log")
  ));
}

export function isAllowedArtifactPath(relativePath) {
  if (typeof relativePath !== "string" || !relativePath || relativePath.includes("\0")) {
    return false;
  }
  const normalized = path.posix.normalize(relativePath);
  const isYamlDependency = normalized === "node_modules/yaml"
    || normalized.startsWith("node_modules/yaml/");
  if (
    normalized !== relativePath
    || normalized === "."
    || normalized === ".."
    || normalized.startsWith("../")
    || path.posix.isAbsolute(normalized)
    || normalized.includes("\\")
    || hasGeneratedName(normalized, { allowDist: isYamlDependency })
  ) {
    return false;
  }
  if (!normalized.includes("/")) return ROOT_FILES.has(normalized) || [
    "skills",
    "scripts",
    "references",
    "templates",
    "models",
    "hooks",
    "docs",
    "case-studies",
    "node_modules",
  ].includes(normalized);

  if (normalized === "skills/better-harness" || normalized.startsWith("skills/better-harness/")) {
    return true;
  }
  if (normalized.startsWith("skills/")) return false;

  if (normalized === "scripts/packaging" || normalized.startsWith("scripts/packaging/")) {
    return false;
  }
  if (normalized.startsWith("scripts/")) return true;

  const first = normalized.split("/", 1)[0];
  if (BROAD_ROOTS.has(first)) return true;

  if (normalized === "node_modules/@vscode") return true;
  if (
    normalized === "node_modules/@vscode/tree-sitter-wasm"
    || normalized.startsWith("node_modules/@vscode/tree-sitter-wasm/")
  ) {
    return true;
  }
  if (
    normalized === "node_modules/esbuild-wasm"
    || normalized.startsWith("node_modules/esbuild-wasm/")
  ) {
    return true;
  }
  if (isYamlDependency) return true;
  return false;
}

function assertSafeRelative(relativePath, code = "path-unsafe") {
  if (!isAllowedArtifactPath(relativePath)) {
    fail(code, "Artifact contains a path outside the Antigravity allowlist");
  }
}

function identityKey(relativePath) {
  return relativePath.normalize("NFC").toLowerCase();
}

const WINDOWS_RESERVED_COMPONENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

export function validatePortablePathComponent(component) {
  if (
    typeof component !== "string"
    || component.length === 0
    || component.length > FILE_LIMITS.componentLength
    || /[\u0000-\u001f\u007f]/u.test(component)
    || component.includes(":")
    || component.includes("\\")
    || component.endsWith(".")
    || component.endsWith(" ")
    || WINDOWS_RESERVED_COMPONENT.test(component)
  ) {
    fail("path-component-invalid", "Artifact contains a non-portable path component");
  }
  return component;
}

export function validateTraversalBounds(entryCount, directoryDepth) {
  if (!Number.isInteger(entryCount) || entryCount < 0 || entryCount > FILE_LIMITS.entries) {
    fail("artifact-entry-limit", "Artifact exceeds the fixed entry limit");
  }
  if (
    !Number.isInteger(directoryDepth)
    || directoryDepth < 0
    || directoryDepth > FILE_LIMITS.directoryDepth
  ) {
    fail("artifact-depth-limit", "Artifact exceeds the fixed directory depth limit");
  }
}

async function inspectArtifactTree(root, canonicalRoot) {
  const inventory = new Map();
  const identities = new Map();
  let fileCount = 0;
  let entryCount = 0;
  let totalBytes = 0;

  async function visit(directory, relativeDirectory = "", depth = 0) {
    validateTraversalBounds(entryCount, depth);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      fail("tree-unreadable", "Artifact tree cannot be read safely");
    }
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      validatePortablePathComponent(entry.name);
      entryCount += 1;
      validateTraversalBounds(entryCount, depth);
      const relative = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      assertSafeRelative(relative, "path-not-allowed");

      const key = identityKey(relative);
      if (identities.has(key) && identities.get(key) !== relative) {
        fail("path-identity-collision", "Artifact contains a case or Unicode path identity collision");
      }
      identities.set(key, relative);

      const absolute = path.join(root, ...relative.split("/"));
      let stats;
      try {
        stats = await lstat(absolute);
      } catch {
        fail("tree-entry-unreadable", "Artifact tree contains an unreadable entry");
      }
      if (stats.isSymbolicLink()) {
        fail("symlink-forbidden", "Artifact must not contain symbolic links or junctions");
      }
      if (!stats.isDirectory() && !stats.isFile()) {
        fail("special-file-forbidden", "Artifact must contain only regular files and directories");
      }

      let canonicalEntry;
      try {
        canonicalEntry = await realpath(absolute);
      } catch {
        fail("canonical-path-unavailable", "Artifact entry cannot be canonically resolved");
      }
      if (!isContained(canonicalEntry, canonicalRoot)) {
        fail("canonical-path-escape", "Artifact entry escapes the canonical plugin root");
      }
      inventory.set(relative, { absolute, canonical: canonicalEntry, stats });

      if (stats.isDirectory()) {
        await visit(absolute, relative, depth + 1);
      } else {
        fileCount += 1;
        totalBytes += stats.size;
        if (fileCount > FILE_LIMITS.files || totalBytes > FILE_LIMITS.totalBytes) {
          fail("artifact-bounds-exceeded", "Artifact exceeds fixed file or byte limits");
        }
      }
    }
  }

  await visit(root);
  return { inventory, entryCount, fileCount, totalBytes };
}

function requireRegularFile(inventory, relativePath) {
  const entry = inventory.get(relativePath);
  if (!entry?.stats.isFile()) {
    fail("required-file-missing", `Artifact is missing required regular file: ${relativePath}`);
  }
  return entry;
}

async function readBoundedText(entry, code) {
  if (entry.stats.size > FILE_LIMITS.textBytes) {
    fail("text-file-too-large", "Artifact metadata or closure source exceeds the fixed text limit");
  }
  try {
    return await readFile(entry.absolute, "utf8");
  } catch {
    fail(code, "Artifact metadata or closure source cannot be read");
  }
}

async function readJsonObject(inventory, relativePath, code) {
  const text = await readBoundedText(requireRegularFile(inventory, relativePath), code);
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail(code, `Artifact JSON is malformed: ${relativePath}`);
  }
  if (!isObject(value)) {
    fail(code, `Artifact JSON must be an object: ${relativePath}`);
  }
  return value;
}

export function effectivePluginName(manifest) {
  if (!isObject(manifest)) {
    fail("manifest-object-required", "plugin.json must contain a JSON object");
  }
  if (Object.keys(manifest).some((key) => !CLI_MANIFEST_KEYS.has(key))) {
    fail("manifest-schema-invalid", "Agy CLI plugin.json permits only name and description");
  }
  if (!Object.hasOwn(manifest, "name")) {
    fail("manifest-name-required", "Agy CLI plugin.json requires name");
  }
  if (typeof manifest.name !== "string") {
    fail("manifest-name-type-invalid", "Agy CLI plugin.json name must be a string");
  }
  if (manifest.name.length === 0) {
    fail("manifest-name-blank", "Agy CLI plugin.json name must not be empty");
  }
  if (!CLI_PLUGIN_NAME_PATTERN.test(manifest.name)) {
    fail("manifest-name-pattern-invalid", "Agy CLI plugin.json name contains unsupported characters");
  }
  if (Object.hasOwn(manifest, "description") && typeof manifest.description !== "string") {
    fail("manifest-description-invalid", "Agy CLI plugin.json description must be a string");
  }
  return manifest.name;
}

function validateMarker(marker) {
  const keys = Object.keys(marker).sort();
  if (keys.length !== MARKER_KEYS.length || keys.some((key, index) => key !== MARKER_KEYS[index])) {
    fail("marker-schema-invalid", "Artifact ownership marker fields do not match schema version 1");
  }
  if (marker.kind !== ANTIGRAVITY_ARTIFACT_KIND) {
    fail("marker-kind-invalid", "Artifact ownership marker kind is invalid");
  }
  if (marker.schemaVersion !== ANTIGRAVITY_ARTIFACT_SCHEMA_VERSION) {
    fail("marker-schema-version-invalid", "Artifact ownership marker schema version is unsupported");
  }
  if (marker.host !== ANTIGRAVITY_HOST) {
    fail("marker-host-invalid", "Artifact ownership marker host is invalid");
  }
  if (!isNonblankString(marker.pluginName)) {
    fail("marker-plugin-name-invalid", "Artifact ownership marker plugin name is invalid");
  }
  if (!isNonblankString(marker.version)) {
    fail("marker-version-invalid", "Artifact ownership marker version is invalid");
  }
  if (marker.canonicalSkill !== CANONICAL_SKILL) {
    fail("marker-skill-invalid", "Artifact ownership marker canonical Skill is invalid");
  }
  if (
    !Array.isArray(marker.runtimeDependencies)
    || marker.runtimeDependencies.length !== RUNTIME_DEPENDENCIES.length
    || marker.runtimeDependencies.some((value, index) => value !== RUNTIME_DEPENDENCIES[index])
  ) {
    fail("marker-dependencies-invalid", "Artifact ownership marker runtime dependencies are invalid");
  }
}

function validatePackage(packageJson, marker) {
  const packageKeys = Object.keys(packageJson).sort();
  if (
    packageKeys.length !== PACKAGE_KEYS.length
    || packageKeys.some((key, index) => key !== PACKAGE_KEYS[index])
  ) {
    fail("package-schema-invalid", "Artifact package.json must use the closed Better Harness artifact schema");
  }
  if (packageJson.name !== "@qoder-ai/better-harness") {
    fail("package-name-invalid", "Artifact package.json name must match Better Harness");
  }
  if (packageJson.private !== true) {
    fail("package-private-invalid", "Artifact package.json must be private");
  }
  if (!isNonblankString(packageJson.version) || packageJson.version !== marker.version) {
    fail("package-version-invalid", "Artifact package version must match the ownership marker");
  }
  if (!isNonblankString(packageJson.license)) {
    fail("package-license-invalid", "Artifact package.json must declare a nonblank license");
  }
  if (packageJson.type !== "module") {
    fail("package-type-invalid", "Artifact package.json must use the module type");
  }
  if (
    !isObject(packageJson.bin)
    || Object.keys(packageJson.bin).length !== 1
    || Object.keys(packageJson.bin)[0] !== "better-harness"
    || packageJson.bin["better-harness"] !== RUNTIME_ENTRY
  ) {
    fail("package-bin-invalid", "Artifact package bin must match the runtime entry exactly");
  }
  const engineKeys = isObject(packageJson.engines) ? Object.keys(packageJson.engines).sort() : [];
  if (
    engineKeys.length !== 2
    || engineKeys[0] !== "node"
    || engineKeys[1] !== "npm"
    || !isNonblankString(packageJson.engines.node)
    || !isNonblankString(packageJson.engines.npm)
  ) {
    fail("package-engines-invalid", "Artifact package engines must contain nonblank node and npm ranges");
  }
  if (!isObject(packageJson.dependencies)) {
    fail("package-dependencies-invalid", "Artifact package dependencies must be an object");
  }
  const keys = Object.keys(packageJson.dependencies).sort();
  const expected = [...RUNTIME_DEPENDENCIES].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail("package-dependencies-invalid", "Artifact package dependencies must match the runtime profile");
  }
  for (const dependency of RUNTIME_DEPENDENCIES) {
    if (!isNonblankString(packageJson.dependencies[dependency])) {
      fail("package-dependency-version-invalid", "Artifact dependency versions must be nonblank strings");
    }
  }
}

async function validateDependencyPackages(inventory, packageJson) {
  for (const dependency of RUNTIME_DEPENDENCIES) {
    const relative = `node_modules/${dependency}/package.json`;
    const dependencyPackage = await readJsonObject(inventory, relative, "dependency-package-invalid");
    if (dependencyPackage.name !== dependency) {
      fail("dependency-package-name-invalid", "Runtime dependency package identity does not match its root");
    }
    if (
      !isNonblankString(dependencyPackage.version)
      || dependencyPackage.version !== packageJson.dependencies[dependency]
    ) {
      fail("dependency-package-version-invalid", "Runtime dependency package version does not match package.json");
    }
  }
}

function maskMarkdownCode(source) {
  const output = [...source];
  let index = 0;
  let fence = null;
  const listStack = [];
  while (index < source.length) {
    const lineStart = index === 0 || source[index - 1] === "\n";
    if (lineStart) {
      const lineEnd = source.indexOf("\n", index);
      const end = lineEnd < 0 ? source.length : lineEnd;
      const line = source.slice(index, end);
      const marker = line.match(/^ {0,3}(`{3,}|~{3,})/u)?.[1];
      if (marker && (!fence || marker[0] === fence[0] && marker.length >= fence.length)) {
        fence = fence ? null : marker;
        for (let cursor = index; cursor < end; cursor += 1) output[cursor] = " ";
        index = end;
        continue;
      }
      if (!fence && line.trim().length > 0) {
        const leading = line.match(/^ */u)?.[0].length ?? 0;
        const listMarker = line.match(/^( *)(?:[-+*]|\d{1,9}[.)])([ \t]+)/u);
        if (listMarker) {
          const markerIndent = listMarker[1].length;
          while (listStack.length && markerIndent < listStack.at(-1).contentIndent) {
            listStack.pop();
          }
          const parentIndent = listStack.at(-1)?.contentIndent ?? 0;
          if (markerIndent - parentIndent <= 3) {
            listStack.push({ markerIndent, contentIndent: listMarker[0].length });
          }
        } else {
          while (listStack.length && leading < listStack.at(-1).contentIndent) listStack.pop();
          const contentIndent = listStack.at(-1)?.contentIndent ?? 0;
          const codeIndent = leading - contentIndent;
          if ((!listStack.length && leading >= 4) || (listStack.length && codeIndent >= 4)) {
            for (let cursor = index; cursor < end; cursor += 1) output[cursor] = " ";
            index = end;
            continue;
          }
        }
      }
    }
    if (fence) {
      if (source[index] !== "\n") output[index] = " ";
      index += 1;
      continue;
    }
    if (source[index] === "`") {
      let ticks = 1;
      while (source[index + ticks] === "`") ticks += 1;
      const closing = source.indexOf("`".repeat(ticks), index + ticks);
      if (closing < 0) fail("markdown-link-unsupported", "Markdown contains an unterminated code span");
      for (let cursor = index; cursor < closing + ticks; cursor += 1) {
        if (source[cursor] !== "\n") output[cursor] = " ";
      }
      index = closing + ticks;
      continue;
    }
    index += 1;
  }
  if (fence) fail("markdown-link-unsupported", "Markdown contains an unterminated code fence");
  return output.join("");
}

function unescapeMarkdownDestination(value) {
  return value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/gu, "$1");
}

function parseMarkdownDestination(source, start, terminator) {
  let index = start;
  while (/[ \t]/u.test(source[index] ?? "")) index += 1;
  if (source[index] === "<") {
    let value = "";
    index += 1;
    while (index < source.length && source[index] !== ">") {
      if (source[index] === "\n" || source[index] === "\r" || source[index] === "<") {
        fail("markdown-link-unsupported", "Markdown contains an unsupported angle destination");
      }
      if (source[index] === "\\" && index + 1 < source.length) {
        value += source[index] + source[index + 1];
        index += 2;
      } else {
        value += source[index];
        index += 1;
      }
    }
    if (source[index] !== ">") fail("markdown-link-unsupported", "Markdown angle destination is unterminated");
    return { target: unescapeMarkdownDestination(value), end: index + 1 };
  }

  let value = "";
  let depth = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\" && index + 1 < source.length) {
      value += char + source[index + 1];
      index += 2;
      continue;
    }
    if (char === "(" ) {
      depth += 1;
      value += char;
      index += 1;
      continue;
    }
    if (char === ")") {
      if (depth === 0 && terminator === ")") break;
      if (depth === 0) fail("markdown-link-unsupported", "Markdown destination has unbalanced parentheses");
      depth -= 1;
      value += char;
      index += 1;
      continue;
    }
    if (char === "\n" || char === "\r" || (depth === 0 && /[ \t]/u.test(char))) break;
    value += char;
    index += 1;
  }
  if (depth !== 0 || !value) fail("markdown-link-unsupported", "Markdown destination is malformed");
  return { target: unescapeMarkdownDestination(value), end: index };
}

function finishInlineMarkdownLink(source, destinationEnd) {
  let index = destinationEnd;
  while (/[ \t\n\r]/u.test(source[index] ?? "")) index += 1;
  if (source[index] === ")") return index + 1;
  const quote = source[index];
  if (!["\"", "'", "("].includes(quote)) {
    fail("markdown-link-unsupported", "Markdown link has an unsupported title or suffix");
  }
  const closing = quote === "(" ? ")" : quote;
  index += 1;
  while (index < source.length && source[index] !== closing) {
    if (source[index] === "\\") index += 2;
    else index += 1;
  }
  if (source[index] !== closing) fail("markdown-link-unsupported", "Markdown link title is unterminated");
  index += 1;
  while (/[ \t\n\r]/u.test(source[index] ?? "")) index += 1;
  if (source[index] !== ")") fail("markdown-link-unsupported", "Markdown link is unterminated");
  return index + 1;
}

function closingMarkdownLabel(source, start) {
  let depth = 1;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
      continue;
    }
    if (source[index] === "[") depth += 1;
    if (source[index] === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function normalizeMarkdownLabel(label) {
  return label
    .replace(/\\([\[\]\\])/gu, "$1")
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, " ");
}

export function parseMarkdownTargets(source) {
  if (typeof source !== "string") fail("markdown-source-invalid", "Markdown source must be text");
  const masked = maskMarkdownCode(source);
  const targets = [];
  const definitions = new Map();

  for (let lineStart = 0; lineStart <= masked.length;) {
      const lineEnd = masked.indexOf("\n", lineStart);
      const end = lineEnd < 0 ? masked.length : lineEnd;
      const line = masked.slice(lineStart, end);
      const originalLine = source.slice(lineStart, end);
    const indentation = line.match(/^ {0,3}/u)?.[0].length ?? 0;
    const definitionClose = line[indentation] === "["
      ? closingMarkdownLabel(line, indentation + 1)
      : -1;
    if (definitionClose >= 0 && line[definitionClose + 1] === ":") {
      let destinationStart = definitionClose + 2;
      while (/[ \t]/u.test(line[destinationStart] ?? "")) destinationStart += 1;
      const parsed = parseMarkdownDestination(line, destinationStart, "line");
      let cursor = parsed.end;
      while (/[ \t]/u.test(line[cursor] ?? "")) cursor += 1;
      if (cursor < line.length && !/^(?:["'(]).*(?:["')])$/u.test(line.slice(cursor))) {
        fail("markdown-link-unsupported", "Markdown reference definition has an unsupported suffix");
      }
      const label = normalizeMarkdownLabel(originalLine.slice(indentation + 1, definitionClose));
      if (!label) fail("markdown-link-unsupported", "Markdown reference label is empty");
      if (!definitions.has(label)) definitions.set(label, parsed.target);
    }
    if (lineEnd < 0) break;
    lineStart = lineEnd + 1;
  }

  for (let index = 0; index < masked.length; index += 1) {
    if (masked[index] !== "[") continue;
    const close = closingMarkdownLabel(masked, index + 1);
    if (close < 0) fail("markdown-link-unsupported", "Markdown link label is unterminated");
    if (masked[close + 1] === ":") {
      index = close;
      continue;
    }
    if (masked[close + 1] === "(") {
      if (!normalizeMarkdownLabel(source.slice(index + 1, close))) {
        fail("markdown-link-unsupported", "Markdown link label is empty");
      }
      const parsed = parseMarkdownDestination(masked, close + 2, ")");
      targets.push(parsed.target);
      index = finishInlineMarkdownLink(masked, parsed.end) - 1;
      continue;
    }
    if (masked[close + 1] === "[") {
      const referenceEnd = closingMarkdownLabel(masked, close + 2);
      if (referenceEnd < 0) fail("markdown-link-unsupported", "Markdown reference label is unterminated");
      const explicit = source.slice(close + 2, referenceEnd);
      const label = normalizeMarkdownLabel(explicit || source.slice(index + 1, close));
      if (!label) fail("markdown-link-unsupported", "Markdown reference label is empty");
      if (!definitions.has(label)) fail("markdown-reference-missing", "Markdown reference definition is missing");
      targets.push(definitions.get(label));
      index = referenceEnd;
      continue;
    }
    const shortcut = normalizeMarkdownLabel(source.slice(index + 1, close));
    if (definitions.has(shortcut)) {
      targets.push(definitions.get(shortcut));
      index = close;
    }
  }
  return targets;
}

function localMarkdownTarget(rawTarget, sourceRelative) {
  if (typeof rawTarget !== "string" || !rawTarget) return null;
  if (rawTarget.startsWith("#") || rawTarget.startsWith("?")) return null;
  if (/^[A-Za-z]:[\\/]/u.test(rawTarget) || rawTarget.startsWith("\\\\")) {
    fail("markdown-absolute-path", "Markdown closure contains an absolute local path");
  }
  const scheme = rawTarget.match(/^([A-Za-z][A-Za-z0-9+.-]*):/u)?.[1]?.toLowerCase();
  if (scheme) {
    if (["http", "https", "mailto", "pathname"].includes(scheme)) return null;
    if (scheme === "file") fail("markdown-file-uri", "Markdown closure contains a file URI");
    fail("markdown-scheme-invalid", "Markdown closure contains an unsupported URI scheme");
  }
  if (rawTarget.startsWith("/") || rawTarget.startsWith("\\") || rawTarget.includes("\\")) {
    fail("markdown-absolute-path", "Markdown closure contains an absolute or backslash path");
  }

  const boundary = [rawTarget.indexOf("#"), rawTarget.indexOf("?")]
    .filter((index) => index >= 0)
    .reduce((minimum, index) => Math.min(minimum, index), rawTarget.length);
  const encodedPath = rawTarget.slice(0, boundary);
  if (!encodedPath) return null;
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(encodedPath);
  } catch {
    fail("markdown-percent-invalid", "Markdown closure contains invalid percent encoding");
  }
  if (decodedPath.includes("\0") || decodedPath.includes("\\")) {
    fail("markdown-path-invalid", "Markdown closure contains an unsafe local path");
  }
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(sourceRelative), decodedPath));
  if (resolved === ".." || resolved.startsWith("../") || path.posix.isAbsolute(resolved)) {
    fail("markdown-path-escape", "Markdown closure target escapes the plugin root");
  }
  return resolved;
}

function markdownTargetCandidates(relativePath) {
  return path.posix.extname(relativePath)
    ? [relativePath]
    : [relativePath, `${relativePath}.md`, `${relativePath}/README.md`];
}

async function resolveMarkdownTarget(rawTarget, sourceRelative, candidateExists) {
  const unresolved = localMarkdownTarget(rawTarget, sourceRelative);
  if (!unresolved) return null;
  const candidates = markdownTargetCandidates(unresolved).filter((candidate) => (
    isAllowedArtifactPath(candidate)
  ));
  if (candidates.length === 0) {
    fail(
      "markdown-target-forbidden",
      "Markdown closure target is outside the artifact allowlist",
      { source: sourceRelative, target: unresolved },
    );
  }
  const matches = [];
  for (const candidate of candidates) {
    if (await candidateExists(candidate)) matches.push(candidate);
  }
  if (matches.length === 0) fail("required-file-missing", "Markdown closure target is missing");
  if (matches.length > 1) fail("markdown-target-ambiguous", "Markdown closure target is ambiguous");
  return matches[0];
}

async function traverseMarkdownClosure({ readSource, candidateExists }) {
  const queue = [{ relative: CANONICAL_SKILL, depth: 0 }];
  const visited = new Set();
  const targets = new Set();
  let edges = 0;

  while (queue.length) {
    const current = queue.shift();
    if (visited.has(current.relative)) continue;
    if (visited.size >= GRAPH_LIMITS.markdownNodes) {
      fail("markdown-node-limit", "Markdown closure exceeds the fixed node limit");
    }
    visited.add(current.relative);
    const text = await readSource(current.relative);
    for (const rawTarget of parseMarkdownTargets(text)) {
      const relative = await resolveMarkdownTarget(rawTarget, current.relative, candidateExists);
      if (!relative) continue;
      edges += 1;
      if (edges > GRAPH_LIMITS.markdownEdges) {
        fail("markdown-edge-limit", "Markdown closure exceeds the fixed edge limit");
      }
      targets.add(relative);
      if (relative.toLowerCase().endsWith(".md") && !visited.has(relative)) {
        if (current.depth + 1 > GRAPH_LIMITS.markdownDepth) {
          fail("markdown-depth-limit", "Markdown closure exceeds the fixed depth limit");
        }
        queue.push({ relative, depth: current.depth + 1 });
      }
    }
  }
  return {
    nodes: visited.size,
    edges,
    files: [...new Set([...visited, ...targets])].sort(),
  };
}

async function verifyMarkdownClosure(inventory) {
  return traverseMarkdownClosure({
    readSource: async (relative) => readBoundedText(
      requireRegularFile(inventory, relative),
      "markdown-read-failed",
    ),
    candidateExists: async (relative) => Boolean(inventory.get(relative)?.stats.isFile()),
  });
}

export async function verifyMarkdownSourceClosure(sourceRoot) {
  if (typeof sourceRoot !== "string" || !sourceRoot || sourceRoot.includes("\0")) {
    fail("markdown-source-root-invalid", "Markdown source root must be a filesystem path");
  }
  const resolvedRoot = path.resolve(sourceRoot);
  const canonicalRoot = await realpath(resolvedRoot).catch(() => null);
  if (!canonicalRoot) fail("markdown-source-root-invalid", "Markdown source root cannot be resolved");

  async function regularCandidate(relative, missingIsError = false) {
    assertSafeRelative(relative, "markdown-target-forbidden");
    const absolute = path.join(resolvedRoot, ...relative.split("/"));
    const stats = await lstat(absolute).catch(() => null);
    if (!stats) {
      if (missingIsError) fail("required-file-missing", "Markdown closure source is missing");
      return false;
    }
    if (stats.isSymbolicLink() || !stats.isFile()) {
      fail("markdown-source-file-invalid", "Markdown closure source must be a regular non-symlink file");
    }
    const canonical = await realpath(absolute).catch(() => null);
    if (!canonical || !isContained(canonical, canonicalRoot)) {
      fail("markdown-path-escape", "Markdown closure source escapes its canonical root");
    }
    return true;
  }

  return traverseMarkdownClosure({
    readSource: async (relative) => {
      await regularCandidate(relative, true);
      const absolute = path.join(resolvedRoot, ...relative.split("/"));
      const stats = await lstat(absolute);
      return readBoundedText({ absolute, stats }, "markdown-read-failed");
    },
    candidateExists: async (relative) => regularCandidate(relative),
  });
}

function tokenizeJavaScript(source) {
  const tokens = [];
  let index = 0;
  let canStartRegex = true;
  let syntaxBraceDepth = 0;
  const parenFrames = [];
  const controlHeads = new Set(["catch", "for", "if", "switch", "while", "with"]);

  function push(token) {
    tokens.push({ ...token, braceDepth: syntaxBraceDepth });
    if (token.type === "identifier") {
      canStartRegex = ["case", "delete", "do", "else", "in", "instanceof", "new", "return", "throw", "typeof", "void", "yield"].includes(token.value);
    } else if (["string", "number", "regex"].includes(token.type)) {
      canStartRegex = false;
    } else if (token.type === "punctuation") {
      canStartRegex = ![")", "]", "}"].includes(token.value) && token.value !== ".";
    }
  }

  function scan(stopAtTemplateBrace = false) {
    let braceDepth = 0;
    while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (/\s/u.test(char)) {
      index += 1;
      continue;
    }
    if (stopAtTemplateBrace && char === "}" && braceDepth === 0) {
      syntaxBraceDepth -= 1;
      index += 1;
      return;
    }
    if (char === "/" && next === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end < 0) fail("runtime-comment-invalid", "Runtime module contains an unterminated comment");
      index = end + 2;
      continue;
    }
    if (char === "'" || char === '"') {
      const quote = char;
      let value = "";
      let escaped = false;
      index += 1;
      let closed = false;
      while (index < source.length) {
        if (source[index] === "\\") {
          escaped = true;
          if (index + 1 >= source.length || /[\r\n]/u.test(source[index + 1])) {
            fail("runtime-string-invalid", "Runtime module contains an invalid string escape");
          }
          value += source[index + 1];
          index += 2;
          continue;
        }
        if (source[index] === quote) {
          closed = true;
          index += 1;
          break;
        }
        value += source[index];
        index += 1;
      }
      if (!closed) fail("runtime-string-invalid", "Runtime module contains an unterminated string");
      push({ type: "string", value, escaped });
      continue;
    }
    if (char === "`") {
      let closed = false;
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
          continue;
        }
        if (source[index] === "$" && source[index + 1] === "{") {
          index += 2;
          syntaxBraceDepth += 1;
          scan(true);
          continue;
        }
        if (source[index] === "`") {
          closed = true;
          index += 1;
          break;
        }
        index += 1;
      }
      if (!closed) fail("runtime-template-invalid", "Runtime module contains an unterminated template");
      canStartRegex = false;
      continue;
    }
    if (char === "/" && canStartRegex) {
      index += 1;
      let inClass = false;
      let closed = false;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
          continue;
        }
        if (source[index] === "[") inClass = true;
        else if (source[index] === "]") inClass = false;
        else if (source[index] === "/" && !inClass) {
          closed = true;
          index += 1;
          while (/[A-Za-z]/u.test(source[index] ?? "")) index += 1;
          break;
        } else if (/[\r\n]/u.test(source[index])) {
          break;
        }
        index += 1;
      }
      if (!closed) fail("runtime-regex-invalid", "Runtime module contains an unterminated regular expression");
      push({ type: "regex", value: "" });
      continue;
    }
    if (/[A-Za-z_$]/u.test(char)) {
      let end = index + 1;
      while (end < source.length && /[A-Za-z0-9_$]/u.test(source[end])) end += 1;
      push({ type: "identifier", value: source.slice(index, end) });
      index = end;
      continue;
    }
    if (/[0-9]/u.test(char)) {
      let end = index + 1;
      while (end < source.length && /[A-Za-z0-9_.]/u.test(source[end])) end += 1;
      push({ type: "number", value: source.slice(index, end) });
      index = end;
      continue;
    }
    if (char === "(") {
      const previous = tokens.at(-1);
      const beforePrevious = tokens.at(-2);
      parenFrames.push({
        control: (
          previous?.type === "identifier"
          && (
            controlHeads.has(previous.value)
            || (previous.value === "await" && beforePrevious?.value === "for")
          )
        ),
      });
    }
    if (char === "}" && braceDepth > 0) {
      braceDepth -= 1;
      syntaxBraceDepth -= 1;
    }
    push({ type: "punctuation", value: char });
    if (char === "{") {
      braceDepth += 1;
      syntaxBraceDepth += 1;
    }
    if (char === ")") {
      const frame = parenFrames.pop();
      if (frame?.control) canStartRegex = true;
    }
    index += 1;
  }
    if (stopAtTemplateBrace) fail("runtime-template-invalid", "Runtime template expression is unterminated");
  }

  scan();
  return tokens;
}

function importSpecifier(token, errorCode) {
  if (token?.type !== "string") fail(errorCode, "Runtime import/export has a nonliteral specifier");
  if (token.escaped) fail("runtime-import-escape", "Runtime import specifiers must not use string escapes");
  return token.value;
}

function matchingCloseParen(tokens, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    if (tokens[index].value === "(") depth += 1;
    if (tokens[index].value === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function isImportMethodName(tokens, importIndex) {
  const token = tokens[importIndex];
  if (token.braceDepth <= 0 || tokens[importIndex + 1]?.value !== "(") return false;
  const close = matchingCloseParen(tokens, importIndex + 1);
  if (close < 0 || tokens[close + 1]?.value !== "{") return false;
  return ["{", "}", ";", ","].includes(tokens[importIndex - 1]?.value);
}

export function parseEsmSpecifiers(source) {
  const tokens = tokenizeJavaScript(source);
  const specifiers = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "identifier" || token.value !== "import") continue;
    if (tokens[index - 1]?.value === ".") continue;
    if (isImportMethodName(tokens, index)) continue;
    const following = tokens[index + 1];
    if (following?.value === ".") continue;
    if (following?.value === "(") {
      const argument = tokens[index + 2];
      if (argument?.type !== "string" || tokens[index + 3]?.value !== ")") {
        fail("runtime-dynamic-import-unresolved", "Runtime contains a nonliteral dynamic import");
      }
      specifiers.push(importSpecifier(argument, "runtime-dynamic-import-unresolved"));
      continue;
    }
    if (following?.type === "string") {
      specifiers.push(importSpecifier(following, "runtime-import-invalid"));
      continue;
    }
    for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
      if (tokens[cursor].value === ";") break;
      if (tokens[cursor].type === "identifier" && tokens[cursor].value === "from") {
        specifiers.push(importSpecifier(tokens[cursor + 1], "runtime-import-invalid"));
        break;
      }
    }
  }
  for (let index = 0; index < tokens.length; index += 1) {
    if (
      tokens[index].type !== "identifier"
      || tokens[index].value !== "export"
      || tokens[index].braceDepth !== 0
      || tokens[index - 1]?.value === "."
    ) continue;
    for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
      if (tokens[cursor].value === ";") break;
      if (tokens[cursor].type === "identifier" && tokens[cursor].value === "from") {
        specifiers.push(importSpecifier(tokens[cursor + 1], "runtime-export-invalid"));
        break;
      }
    }
  }
  return specifiers;
}

function isAllowedBareDependency(specifier) {
  return RUNTIME_DEPENDENCIES.some((dependency) => (
    specifier === dependency || specifier.startsWith(`${dependency}/`)
  ));
}

function splitBareDependency(specifier) {
  const dependency = RUNTIME_DEPENDENCIES.find((candidate) => (
    specifier === candidate || specifier.startsWith(`${candidate}/`)
  ));
  if (!dependency) return null;
  return { dependency, subpath: specifier.slice(dependency.length + 1) };
}

function dependencySubpathTarget(inventory, dependency, subpath) {
  if (!subpath) return null;
  if (subpath.includes("\\") || subpath.includes("\0")) {
    fail("runtime-dependency-subpath-invalid", "Runtime dependency subpath is unsafe");
  }
  let decoded;
  try {
    decoded = decodeURIComponent(subpath);
  } catch {
    fail("runtime-dependency-subpath-invalid", "Runtime dependency subpath has invalid encoding");
  }
  const normalized = path.posix.normalize(decoded);
  if (
    normalized !== decoded
    || normalized === "."
    || normalized === ".."
    || normalized.startsWith("../")
    || path.posix.isAbsolute(normalized)
  ) {
    fail("runtime-dependency-subpath-invalid", "Runtime dependency subpath escapes its package root");
  }
  const base = `node_modules/${dependency}/${normalized}`;
  const extension = path.posix.extname(base);
  const candidates = extension
    ? [base]
    : [base, `${base}.mjs`, `${base}.js`, `${base}.json`, `${base}/index.mjs`, `${base}/index.js`, `${base}/index.json`];
  const matches = candidates.filter((candidate) => inventory.get(candidate)?.stats.isFile());
  if (matches.length === 0) fail("runtime-dependency-subpath-missing", "Runtime dependency subpath is missing");
  if (matches.length > 1) fail("runtime-dependency-subpath-ambiguous", "Runtime dependency subpath is ambiguous");
  assertSafeRelative(matches[0], "runtime-dependency-subpath-invalid");
  return matches[0];
}

function assertAllowedRuntimeRelative(relativePath) {
  const normalized = path.posix.normalize(relativePath);
  const first = normalized.split("/", 1)[0];
  if (
    normalized !== relativePath
    || normalized === ".."
    || normalized.startsWith("../")
    || path.posix.isAbsolute(normalized)
    || !RUNTIME_ROOTS.has(first)
    || normalized === "scripts/packaging"
    || normalized.startsWith("scripts/packaging/")
  ) {
    fail("runtime-target-forbidden", "Runtime module target is outside the allowed runtime roots", { target: relativePath });
  }
}

function resolveRuntimeTarget(inventory, sourceRelative, rawSpecifier) {
  if (rawSpecifier.startsWith("node:")) return { kind: "builtin" };
  if (!rawSpecifier.startsWith("./") && !rawSpecifier.startsWith("../")) {
    if (!isAllowedBareDependency(rawSpecifier)) {
      fail("runtime-dependency-forbidden", "Runtime imports an unexpected bare dependency");
    }
    const parsed = splitBareDependency(rawSpecifier);
    const subpathTarget = dependencySubpathTarget(inventory, parsed.dependency, parsed.subpath);
    return { kind: "external", dependency: parsed.dependency, subpathTarget };
  }
  if (rawSpecifier.includes("\\") || rawSpecifier.includes("\0")) {
    fail("runtime-specifier-invalid", "Runtime import contains an unsafe path");
  }
  const boundary = [rawSpecifier.indexOf("#"), rawSpecifier.indexOf("?")]
    .filter((index) => index >= 0)
    .reduce((minimum, index) => Math.min(minimum, index), rawSpecifier.length);
  let decoded;
  try {
    decoded = decodeURIComponent(rawSpecifier.slice(0, boundary));
  } catch {
    fail("runtime-percent-invalid", "Runtime import contains invalid percent encoding");
  }
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(sourceRelative), decoded));
  assertAllowedRuntimeRelative(base);
  const extension = path.posix.extname(base);
  const candidates = extension
    ? [base]
    : [base, `${base}.mjs`, `${base}.js`, `${base}.json`, `${base}/index.mjs`, `${base}/index.js`, `${base}/index.json`];
  const matches = candidates.filter((candidate) => inventory.get(candidate)?.stats.isFile());
  if (matches.length === 0) fail("runtime-target-missing", "Runtime import target is missing");
  if (matches.length > 1) fail("runtime-target-ambiguous", "Runtime import target is ambiguous");
  assertAllowedRuntimeRelative(matches[0]);
  return { kind: "local", relative: matches[0] };
}

async function verifyRuntimeClosure(inventory) {
  const queue = [{ relative: RUNTIME_ENTRY, depth: 0 }];
  const visited = new Set();
  const externalDependencies = new Set();
  let edges = 0;

  while (queue.length) {
    const current = queue.shift();
    if (visited.has(current.relative)) continue;
    if (visited.size >= GRAPH_LIMITS.runtimeModules) {
      fail("runtime-node-limit", "Runtime closure exceeds the fixed module limit");
    }
    visited.add(current.relative);
    const entry = requireRegularFile(inventory, current.relative);
    const extension = path.posix.extname(current.relative).toLowerCase();
    if (extension === ".json") continue;
    if (![".mjs", ".js"].includes(extension)) {
      fail("runtime-module-type-invalid", "Runtime closure contains an unsupported module type");
    }
    const source = await readBoundedText(entry, "runtime-read-failed");
    for (const specifier of parseEsmSpecifiers(source)) {
      edges += 1;
      if (edges > GRAPH_LIMITS.runtimeEdges) {
        fail("runtime-edge-limit", "Runtime closure exceeds the fixed edge limit");
      }
      const target = resolveRuntimeTarget(inventory, current.relative, specifier);
      if (target.kind === "external") externalDependencies.add(target.dependency);
      if (target.kind === "local" && !visited.has(target.relative)) {
        if (current.depth + 1 > GRAPH_LIMITS.runtimeDepth) {
          fail("runtime-depth-limit", "Runtime closure exceeds the fixed depth limit");
        }
        queue.push({ relative: target.relative, depth: current.depth + 1 });
      }
    }
  }
  return {
    modules: visited.size,
    edges,
    files: [...visited].sort(),
    externalDependencies: [...externalDependencies].sort(),
  };
}

export async function verifyAntigravityPluginArtifact(pluginRoot) {
  try {
    if (typeof pluginRoot !== "string" || !pluginRoot || pluginRoot.includes("\0")) {
      fail("plugin-root-invalid", "Plugin root must be a nonempty filesystem path");
    }
    const resolvedRoot = path.resolve(pluginRoot);
    let rootStats;
    try {
      rootStats = await lstat(resolvedRoot);
    } catch {
      fail("plugin-root-missing", "Plugin root is missing or unreadable");
    }
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
      fail("plugin-root-type-invalid", "Plugin root must be a real directory");
    }
    let canonicalRoot;
    try {
      canonicalRoot = await realpath(resolvedRoot);
    } catch {
      fail("plugin-root-unresolvable", "Plugin root cannot be canonically resolved");
    }
    const artifactDirectoryName = path.basename(canonicalRoot);
    if (artifactDirectoryName !== ANTIGRAVITY_PLUGIN_NAME) {
      fail("plugin-root-name-invalid", "Plugin root directory must be named better-harness");
    }

    const tree = await inspectArtifactTree(resolvedRoot, canonicalRoot);
    for (const requiredPath of REQUIRED_FILES) requireRegularFile(tree.inventory, requiredPath);

    const manifest = await readJsonObject(tree.inventory, "plugin.json", "manifest-invalid");
    const marker = await readJsonObject(
      tree.inventory,
      ANTIGRAVITY_ARTIFACT_MARKER,
      "marker-invalid",
    );
    const packageJson = await readJsonObject(tree.inventory, "package.json", "package-invalid");
    validateMarker(marker);
    const pluginName = effectivePluginName(manifest);
    if (pluginName !== ANTIGRAVITY_PLUGIN_NAME || marker.pluginName !== pluginName) {
      fail("plugin-identity-mismatch", "Plugin root, manifest, and ownership marker identities do not match");
    }
    validatePackage(packageJson, marker);
    await validateDependencyPackages(tree.inventory, packageJson);

    const markdown = await verifyMarkdownClosure(tree.inventory);
    const runtime = await verifyRuntimeClosure(tree.inventory);
    return {
      kind: ANTIGRAVITY_ARTIFACT_KIND,
      schemaVersion: ANTIGRAVITY_ARTIFACT_SCHEMA_VERSION,
      host: ANTIGRAVITY_HOST,
      pluginName,
      version: marker.version,
      canonicalSkill: CANONICAL_SKILL,
      runtimeDependencies: [...RUNTIME_DEPENDENCIES],
      entryCount: tree.entryCount,
      fileCount: tree.fileCount,
      totalBytes: tree.totalBytes,
      markdownClosure: markdown,
      runtimeClosure: runtime,
    };
  } catch (error) {
    if (error instanceof AntigravityArtifactError) throw error;
    fail("artifact-verification-failed", "Artifact verification failed at a protected read boundary");
  }
}

export function parseArgs(argv) {
  const options = { pluginRoot: null, json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--plugin-root") {
      if (options.pluginRoot !== null) fail("argument-duplicate", "--plugin-root may be provided only once");
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail("argument-value-missing", "--plugin-root requires a value");
      options.pluginRoot = value;
      index += 1;
    } else if (arg.startsWith("--plugin-root=")) {
      if (options.pluginRoot !== null) fail("argument-duplicate", "--plugin-root may be provided only once");
      const value = arg.slice("--plugin-root=".length);
      if (!value) fail("argument-value-missing", "--plugin-root requires a value");
      options.pluginRoot = value;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      fail("argument-unknown", "Unknown argument");
    }
  }
  if (!options.help && options.pluginRoot === null) {
    fail("argument-required", "--plugin-root is required");
  }
  return options;
}

export function usage() {
  return [
    "Usage: node scripts/packaging/antigravity/verify-antigravity-plugin.mjs --plugin-root <path> [options]",
    "",
    "Options:",
    "  --plugin-root <path>    Generated Antigravity plugin root (required)",
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
    const result = await verifyAntigravityPluginArtifact(options.pluginRoot);
    process.stdout.write(options.json
      ? `${JSON.stringify({ ok: true, data: result }, null, 2)}\n`
      : `Antigravity plugin artifact verified: ${result.pluginName} ${result.version} (${result.fileCount} files)\n`);
    return 0;
  } catch (error) {
    const code = error instanceof AntigravityArtifactError
      ? error.code
      : "artifact-verification-failed";
    const message = error instanceof AntigravityArtifactError
      ? error.message
      : "Artifact verification failed";
    if (options?.json || argv.includes("--json")) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: { code, message } }, null, 2)}\n`);
    } else {
      process.stderr.write(`Antigravity plugin verification failed [${code}]: ${message}\n`);
    }
    return 1;
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  process.exitCode = await main();
}
