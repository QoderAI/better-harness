import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMA_VERSION = 1;
export const DEFAULT_MAX_COMMITS = 500;
export const DEFAULT_HISTORY_WINDOWS_DAYS = [30, 90, 180];

export const SOURCE_EXTENSIONS = new Map([
  [".go", "go"],
  [".java", "java"],
  [".ts", "typescript"],
  [".tsx", "tsx"],
  [".js", "javascript"],
  [".mjs", "javascript"],
  [".cjs", "javascript"],
  [".jsx", "javascript"],
  [".php", "php"],
  [".py", "python"],
  [".rs", "rust"],
  [".rb", "ruby"],
  [".cs", "csharp"],
  [".cpp", "cpp"],
  [".cc", "cpp"],
  [".cxx", "cpp"],
  [".c", "c"],
  [".h", "c"],
  [".hpp", "cpp"],
  [".kt", "kotlin"],
  [".kts", "kotlin"],
]);

export const DEFAULT_LANGUAGES = [
  "go",
  "java",
  "typescript",
  "javascript",
  "tsx",
  "php",
  "python",
  "ruby",
  "csharp",
  "cpp",
  "c",
  "kotlin",
];
export const ALL_SOURCE_LANGUAGES = [...new Set(SOURCE_EXTENSIONS.values())].sort();

const TEST_PATH_RE = /(^|\/)(__tests__|tests?|specs?|testdata|fixtures?)(\/|$)|[._-](test|spec)\.[^.]+$/i;
const DOC_EXTENSIONS = new Set([".adoc", ".md", ".mdx", ".rst", ".txt"]);
const CONFIG_EXTENSIONS = new Set([".json", ".jsonc", ".toml", ".yaml", ".yml", ".xml"]);
const CONFIG_FILE_RE = /(^|\/)(composer\.(json|lock)|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig\.json|jsconfig\.json|go\.mod|go\.sum|pom\.xml|build\.gradle\.kts?|settings\.gradle\.kts?|gradle\.properties|Gemfile(\.lock)?|Rakefile|Dockerfile|docker-compose\.ya?ml|Makefile|Jenkinsfile|azure-pipelines\.ya?ml)$/i;
const CONFIG_PATH_RE = /(^|\/)(\.github\/workflows|\.gitlab|\.circleci|\.buildkite|config|configs?|docker|k8s|helm)(\/|$)/i;
const FIXTURE_SEGMENT_RE = /^(fixtures?|testdata|samples?|examples?)$/i;
const LOCALIZATION_SEGMENT_RE = /^(i18n|intl|l10n|locale|locales|lang|langs|language|languages|translations?|messages)$/i;
const LOCALE_FILE_RE = /^(?:[a-z]{2}(?:[-_][a-z0-9]{2,4}){0,2}|messages?[-_.][a-z]{2,3}(?:[-_][a-z0-9]{2,4}){0,2}|translations?[-_.][a-z]{2,3}(?:[-_][a-z0-9]{2,4}){0,2})\.(?:json|ya?ml|ts|tsx|js|mjs|cjs|properties)$/i;
const MIGRATION_PATH_RE = /(^|\/)(db\/migrate|database\/migrations|migrations?)(\/|$)/i;
const GENERATED_OR_DEPENDENCY = new Set([
  ".cache",
  ".codex",
  ".git",
  ".next",
  ".qoder",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
]);
const HARNESS_OWNED_ROOT_ARTIFACTS = new Set([
  "AI_READINESS_FINDINGS.json",
  "REPORT_SUMMARY.txt",
  "report.canvas.tsx",
  "test-report.canvas.tsx",
]);

const GIT_MAX_BUFFER_BYTES = 128 * 1024 * 1024;

export function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      args._.push(arg);
      continue;
    }

    const body = arg.slice(2);
    const equalIndex = body.indexOf("=");
    if (equalIndex !== -1) {
      args[body.slice(0, equalIndex)] = body.slice(equalIndex + 1);
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[body] = next;
      index += 1;
    } else {
      args[body] = true;
    }
  }
  return args;
}

export function option(args, name, fallback = undefined) {
  return args[name] ?? fallback;
}

export function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function splitList(value, fallback = []) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null || value === true || value === "") {
    return [...fallback];
  }
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

export function positiveIntList(value, fallback = []) {
  return splitList(value, fallback)
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0);
}

export function normalizeHistoryWindows(value) {
  const windows = positiveIntList(value, DEFAULT_HISTORY_WINDOWS_DAYS);
  return unique(windows).sort((a, b) => a - b);
}

export function normalizeLanguages(value) {
  if (String(value ?? "").trim().toLowerCase() === "auto" || String(value ?? "").trim().toLowerCase() === "all") {
    return [...ALL_SOURCE_LANGUAGES];
  }
  return splitList(value, DEFAULT_LANGUAGES).map((item) => item.toLowerCase());
}

export function normalizeIgnorePatterns(value) {
  return splitList(value, []).map(toPosix);
}

export function toPosix(value) {
  return String(value ?? "").replaceAll("\\", "/").replaceAll(path.sep, "/");
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegExp(pattern) {
  let source = "";
  const normalized = toPosix(pattern);
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += escapeRegExp(char);
  }
  return new RegExp(`^${source}$`);
}

export function pathMatchesPattern(filePath, pattern) {
  const normalized = toPosix(filePath);
  const candidate = toPosix(pattern).replace(/^\.?\//, "");
  if (!candidate) {
    return false;
  }
  if (candidate.endsWith("/")) {
    return normalized.startsWith(candidate);
  }
  if (candidate.endsWith("/**")) {
    return normalized === candidate.slice(0, -3) || normalized.startsWith(candidate.slice(0, -2));
  }
  if (!candidate.includes("/") && !candidate.includes("*") && !candidate.includes("?")) {
    return normalized === candidate || path.posix.basename(normalized) === candidate;
  }
  return globToRegExp(candidate).test(normalized);
}

export function isIgnoredPath(filePath, patterns = []) {
  return normalizeIgnorePatterns(patterns).some((pattern) => pathMatchesPattern(filePath, pattern));
}

export function applyIgnorePatterns(items, patterns = [], pathFor = (item) => item) {
  const normalizedPatterns = normalizeIgnorePatterns(patterns);
  if (normalizedPatterns.length === 0) {
    return {
      items,
      filters: {
        ignorePatterns: [],
        ignoredCount: 0,
        ignoredSample: [],
      },
    };
  }

  const kept = [];
  const ignoredSample = [];
  let ignoredCount = 0;
  for (const item of items) {
    const itemPath = pathFor(item);
    if (isIgnoredPath(itemPath, normalizedPatterns)) {
      ignoredCount += 1;
      if (ignoredSample.length < 10) {
        ignoredSample.push(toPosix(itemPath));
      }
      continue;
    }
    kept.push(item);
  }

  return {
    items: kept,
    filters: {
      ignorePatterns: normalizedPatterns,
      ignoredCount,
      ignoredSample,
    },
  };
}

export function git(cwd, args, { allowFailure = false, timeout = 20_000 } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: GIT_MAX_BUFFER_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
  });

  if (result.status !== 0) {
    if (allowFailure) {
      return "";
    }
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }

  return result.stdout;
}

export function resolveRepoRoot(cwd = process.cwd()) {
  return path.resolve(git(path.resolve(cwd), ["rev-parse", "--show-toplevel"]).trim());
}

export function listTrackedFiles(repoRoot) {
  return git(repoRoot, ["ls-files", "-z"], { allowFailure: true })
    .split("\0")
    .filter(Boolean)
    .map(toPosix);
}

export function languageFor(filePath) {
  return SOURCE_EXTENSIONS.get(path.posix.extname(toPosix(filePath)).toLowerCase()) ?? null;
}

export function isSourceFile(filePath) {
  return Boolean(languageFor(filePath));
}

export function isTestFile(filePath) {
  return TEST_PATH_RE.test(toPosix(filePath));
}

export function isDependencyOrGenerated(filePath) {
  const normalized = toPosix(filePath);
  const segments = normalized.split("/");
  return segments.some((segment) => GENERATED_OR_DEPENDENCY.has(segment))
    || (segments.length === 1 && HARNESS_OWNED_ROOT_ARTIFACTS.has(segments[0]));
}

export function fileRoleFor(filePath) {
  const normalized = toPosix(filePath);
  const extension = path.posix.extname(normalized).toLowerCase();
  const base = path.posix.basename(normalized).toLowerCase();
  const segments = normalized.split("/");

  if (isDependencyOrGenerated(normalized)) {
    return "generated";
  }
  if (/^\.github\/workflows\//i.test(normalized) || CONFIG_FILE_RE.test(normalized)) {
    return "configuration";
  }
  if (segments.some((segment) => LOCALIZATION_SEGMENT_RE.test(segment)) || LOCALE_FILE_RE.test(base)) {
    return "localization";
  }
  if (segments.some((segment) => FIXTURE_SEGMENT_RE.test(segment))) {
    return "fixture";
  }
  if (DOC_EXTENSIONS.has(extension) || /^(docs?|references?|case-studies)(\/|$)/i.test(normalized)) {
    return "documentation";
  }
  if (isTestFile(normalized)) {
    return "test";
  }
  if (MIGRATION_PATH_RE.test(normalized)) {
    return "migration";
  }
  if (CONFIG_PATH_RE.test(normalized) || CONFIG_EXTENSIONS.has(extension)) {
    return "configuration";
  }
  if (isSourceFile(normalized)) {
    return "source";
  }
  return "other";
}

export function isSupportingFile(filePath) {
  return fileRoleFor(filePath) !== "source";
}

export function directoryOf(filePath, depth = 2) {
  const parts = toPosix(filePath).split("/");
  if (parts.length <= 1) {
    return ".";
  }
  return parts.slice(0, Math.min(depth, parts.length - 1)).join("/");
}

export function analysisDirectoryFor(filePath) {
  const parts = toPosix(filePath).split("/");
  if (parts.length <= 1) {
    return ".";
  }

  if (parts[0] === "src" && parts[1] === "main" && parts[2]) {
    return parts.slice(0, Math.min(4, parts.length - 1)).join("/");
  }

  if (["src", "internal", "pkg", "cmd", "app", "lib", "server"].includes(parts[0]) && parts.length === 2) {
    return parts[0];
  }

  if (["src", "internal", "pkg", "cmd", "app", "lib", "server"].includes(parts[0]) && parts[1]) {
    return parts.slice(0, 2).join("/");
  }

  if (["packages", "apps", "modules", "services"].includes(parts[0]) && parts[1]) {
    return parts.slice(0, 2).join("/");
  }

  return directoryOf(filePath, 2);
}

export function parentDirectories(filePath, maxDepth = 3) {
  const parts = toPosix(filePath).split("/");
  const max = Math.min(maxDepth, Math.max(1, parts.length - 1));
  const directories = [];
  for (let depth = 1; depth <= max; depth += 1) {
    directories.push(parts.slice(0, depth).join("/"));
  }
  return directories;
}

export function unique(items) {
  return [...new Set(items.filter((item) => item !== undefined && item !== null && item !== ""))];
}

export function addCount(map, key, amount = 1) {
  if (!key) {
    return;
  }
  map.set(key, (map.get(key) ?? 0) + amount);
}

export function sortedCounts(map, limit = 20) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

export function scoreToConfidence(score) {
  if (score >= 65) {
    return "high";
  }
  if (score >= 35) {
    return "medium";
  }
  return "low";
}

export function readJsonFile(repoRoot, filePath) {
  const absolute = path.join(repoRoot, filePath);
  if (!existsSync(absolute)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(absolute, "utf8"));
  } catch {
    return null;
  }
}

export function normalizeRenamePath(filePath) {
  return toPosix(filePath)
    .replace(/\{([^{}]*?) => ([^{}]*?)\}/g, "$2")
    .replace(/^.* => /, "")
    .replace(/[{}]/g, "");
}

export function parseNumstat(output) {
  const files = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    const [addedRaw, deletedRaw, ...pathParts] = line.split("\t");
    const filePath = normalizeRenamePath(pathParts.join("\t"));
    if (!filePath) {
      continue;
    }

    const added = addedRaw === "-" ? 0 : Number(addedRaw);
    const deleted = deletedRaw === "-" ? 0 : Number(deletedRaw);
    files.push({
      filePath,
      added: Number.isFinite(added) ? added : 0,
      deleted: Number.isFinite(deleted) ? deleted : 0,
      language: languageFor(filePath),
      role: fileRoleFor(filePath),
      supporting: isSupportingFile(filePath),
    });
  }
  return files;
}

export function compactReasonList(reasons, limit = 6) {
  return unique(reasons).slice(0, limit);
}

export async function writeJsonResult(data, args = {}) {
  const json = `${JSON.stringify(data, null, 2)}\n`;
  if (args.output && args.output !== true) {
    const outputPath = path.resolve(String(args.output));
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, json, "utf8");
  }
  if (!args.quiet) {
    process.stdout.write(json);
  }
}

export function isCli(importMetaUrl) {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(importMetaUrl);
}
