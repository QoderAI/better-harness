import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMA_VERSION = 2;
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

export function git(cwd, args, { timeout = 20_000 } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: GIT_MAX_BUFFER_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
  });

  if (result.status !== 0) {
    const error = Object.assign(
      new Error(`git ${args.join(" ")} failed: ${String(result.stderr ?? "").trim()}`),
      {
        code: result.error?.code === "ETIMEDOUT" ? "GIT_COMMAND_TIMEOUT" : "GIT_COMMAND_FAILED",
        command: Object.freeze(["git", ...args]),
        exitStatus: result.status,
      },
    );
    throw error;
  }

  return result.stdout;
}

export function resolveRepoRoot(cwd = process.cwd()) {
  return path.resolve(git(path.resolve(cwd), ["rev-parse", "--show-toplevel"]).trim());
}

function analysisScopeError(message, code = "INVALID_ANALYSIS_SCOPE") {
  return Object.assign(new Error(message), { code });
}

function canonicalAbsolutePath(value) {
  const resolved = path.resolve(value);
  let existingAncestor = resolved;
  const missingSegments = [];
  while (!existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) {
      return resolved;
    }
    missingSegments.unshift(path.basename(existingAncestor));
    existingAncestor = parent;
  }
  const nativeRealpath = typeof realpathSync.native === "function"
    ? realpathSync.native(existingAncestor)
    : realpathSync(existingAncestor);
  return path.resolve(nativeRealpath, ...missingSegments);
}

function canonicalPathIdentity(value) {
  const canonical = canonicalAbsolutePath(value);
  return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}

function sameCanonicalPath(left, right) {
  return canonicalPathIdentity(left) === canonicalPathIdentity(right);
}

function unwrapAnalysisScope(value) {
  if (value && typeof value === "object" && Object.hasOwn(value, "analysisScope")) {
    return value.analysisScope;
  }
  return value;
}

function normalizeRepoRelativePath(value, {
  allowRoot = true,
  label = "repository-relative path",
  code = "INVALID_ANALYSIS_SCOPE",
} = {}) {
  const raw = toPosix(value ?? "");
  if (raw.includes("\0")) {
    throw analysisScopeError(`${label} must not contain NUL bytes`, code);
  }
  if (path.posix.isAbsolute(raw) || path.win32.isAbsolute(raw)) {
    throw analysisScopeError(`${label} must be relative to the Git root: ${raw}`, code);
  }

  const withoutLeadingDot = raw.replace(/^(?:\.\/)+/u, "");
  if (withoutLeadingDot === "" || withoutLeadingDot === ".") {
    if (allowRoot) {
      return ".";
    }
    throw analysisScopeError(`${label} must identify a path below the Git root`, code);
  }

  if (withoutLeadingDot.split("/").includes("..")) {
    throw analysisScopeError(`${label} must not traverse outside its scope: ${raw}`, code);
  }

  const normalized = path.posix.normalize(withoutLeadingDot).replace(/\/+$/u, "");
  if (path.posix.isAbsolute(normalized)
    || normalized === ".."
    || normalized.startsWith("../")) {
    throw analysisScopeError(`${label} must not traverse outside its scope: ${raw}`, code);
  }
  return normalized || ".";
}

function routeForTarget(repoRoot, targetRoot) {
  const canonicalRepoRoot = canonicalAbsolutePath(repoRoot);
  const canonicalTargetRoot = canonicalAbsolutePath(targetRoot);
  const relative = path.relative(canonicalRepoRoot, canonicalTargetRoot);
  if (relative === "") {
    return ".";
  }
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw analysisScopeError(
      `analysis target must stay inside the Git root: ${targetRoot}`,
      "INVALID_PACKAGE_SCOPE",
    );
  }
  return normalizeRepoRelativePath(relative, {
    label: "analysis target route",
    code: "INVALID_PACKAGE_SCOPE",
  });
}

function canonicalAnalysisScope(value) {
  const scope = unwrapAnalysisScope(value);
  if (scope === undefined || scope === null) {
    return { kind: "repo", route: ".", pathspecs: [] };
  }
  if (typeof scope !== "object" || Array.isArray(scope)) {
    throw analysisScopeError("analysis scope must be an object");
  }

  const routeValue = scope.route ?? scope.packageRelPath
    ?? (scope.kind === "repo" || scope.targetKind === "repo-root" ? "." : undefined);
  if (routeValue === undefined || routeValue === null) {
    throw analysisScopeError("analysis scope route is required");
  }
  const route = normalizeRepoRelativePath(routeValue, { label: "analysis scope route" });
  const inferredKind = route === "." ? "repo" : "path";
  const kind = scope.kind ?? inferredKind;
  if (!new Set(["repo", "path"]).has(kind)) {
    throw analysisScopeError(`unsupported analysis scope kind: ${kind}`);
  }
  if (kind !== inferredKind) {
    throw analysisScopeError(`analysis scope kind ${kind} is incompatible with route ${route}`);
  }

  const pathspecs = kind === "repo" ? [] : [literalGitPathspec(route)];
  if (scope.pathspecs !== undefined) {
    if (!Array.isArray(scope.pathspecs)
      || scope.pathspecs.length !== pathspecs.length
      || scope.pathspecs.some((item, index) => item !== pathspecs[index])) {
      throw analysisScopeError(`analysis scope pathspecs do not match route ${route}`);
    }
  }
  return { kind, route, pathspecs };
}

export function literalGitPathspec(filePath) {
  const normalized = normalizeRepoRelativePath(filePath, {
    allowRoot: false,
    label: "Git pathspec route",
    code: "INVALID_PACKAGE_SCOPE",
  });
  return `:(top,literal)${normalized}`;
}

export function publicAnalysisScope(analysisScope) {
  const scope = canonicalAnalysisScope(analysisScope);
  return Object.freeze({
    kind: scope.kind,
    route: scope.route,
    pathspecs: Object.freeze([...scope.pathspecs]),
  });
}

export function resolveAnalysisScope(options = {}) {
  const normalizedOptions = typeof options === "string" ? { cwd: options } : options;
  if (!normalizedOptions || typeof normalizedOptions !== "object" || Array.isArray(normalizedOptions)) {
    throw analysisScopeError("analysis scope options must be an object");
  }

  const discoveryCwd = canonicalAbsolutePath(
    normalizedOptions.cwd
      ?? normalizedOptions.targetRoot
      ?? normalizedOptions.repoRoot
      ?? process.cwd(),
  );
  const repoRoot = canonicalAbsolutePath(normalizedOptions.repoRoot ?? resolveRepoRoot(discoveryCwd));
  const explicitRoute = normalizedOptions.route ?? normalizedOptions.packageRelPath;
  const targetRoot = explicitRoute === undefined
    ? canonicalAbsolutePath(normalizedOptions.targetRoot ?? discoveryCwd)
    : canonicalAbsolutePath(path.resolve(repoRoot, ...normalizeRepoRelativePath(explicitRoute, {
      label: "analysis target route",
      code: "INVALID_PACKAGE_SCOPE",
    }).split("/")));
  const route = routeForTarget(repoRoot, targetRoot);

  if (explicitRoute !== undefined) {
    const normalizedExplicitRoute = normalizeRepoRelativePath(explicitRoute, {
      label: "analysis target route",
      code: "INVALID_PACKAGE_SCOPE",
    });
    if (normalizedExplicitRoute !== route) {
      throw analysisScopeError(
        `analysis target route ${normalizedExplicitRoute} does not match target ${targetRoot}`,
        "INVALID_PACKAGE_SCOPE",
      );
    }
  }
  if (normalizedOptions.targetRoot !== undefined
    && routeForTarget(repoRoot, canonicalAbsolutePath(normalizedOptions.targetRoot)) !== route) {
    throw analysisScopeError(
      "analysis target route and targetRoot identify different paths",
      "INVALID_PACKAGE_SCOPE",
    );
  }

  const publicScope = publicAnalysisScope({
    kind: route === "." ? "repo" : "path",
    route,
  });
  return Object.freeze({
    ...publicScope,
    repoRoot,
    targetRoot,
  });
}

export function resolveAnalysisScopeForOptions(options = {}) {
  const supplied = unwrapAnalysisScope(options.analysisScope);
  const resolved = resolveAnalysisScope({
    cwd: options.cwd ?? process.env.QODER_CWD ?? process.cwd(),
    repoRoot: supplied?.repoRoot ?? options.repoRoot,
    targetRoot: supplied?.targetRoot ?? options.targetRoot,
    route: supplied?.route ?? options.packageRelPath,
  });
  if (supplied !== undefined && supplied !== null) {
    assertCompatibleAnalysisScope(supplied, resolved, "provided analysis scope");
  }
  return resolved;
}

export function isPathInAnalysisScope(filePath, analysisScope) {
  let normalized;
  try {
    normalized = normalizeRepoRelativePath(filePath, { label: "analyzed file path" });
  } catch {
    return false;
  }
  const scope = canonicalAnalysisScope(analysisScope);
  return scope.kind === "repo"
    || normalized === scope.route
    || normalized.startsWith(`${scope.route}/`);
}

export function toAnalysisRelativePath(filePath, analysisScope) {
  const normalized = normalizeRepoRelativePath(filePath, { label: "analyzed file path" });
  const scope = canonicalAnalysisScope(analysisScope);
  if (!isPathInAnalysisScope(normalized, scope)) {
    throw analysisScopeError(
      `path ${normalized} is outside analysis scope ${scope.route}`,
      "PATH_OUTSIDE_ANALYSIS_SCOPE",
    );
  }
  if (scope.kind === "repo") {
    return normalized;
  }
  return normalized === scope.route ? "." : normalized.slice(scope.route.length + 1);
}

export function fromAnalysisRelativePath(filePath, analysisScope) {
  const normalized = normalizeRepoRelativePath(filePath, {
    label: "analysis-relative path",
    code: "PATH_OUTSIDE_ANALYSIS_SCOPE",
  });
  const scope = canonicalAnalysisScope(analysisScope);
  if (scope.kind === "repo" || normalized === ".") {
    return normalized === "." && scope.kind === "path" ? scope.route : normalized;
  }
  return path.posix.join(scope.route, normalized);
}

export function scopePathspecArgs(analysisScope) {
  const scope = canonicalAnalysisScope(analysisScope);
  return ["--", ...scope.pathspecs];
}

export function assertCompatibleAnalysisScope(actual, expected, owner = "analysis input") {
  const expectedScope = canonicalAnalysisScope(expected);
  const actualValue = unwrapAnalysisScope(actual);
  if ((actualValue === undefined || actualValue === null) && expectedScope.kind === "repo") {
    return true;
  }
  if (actualValue === undefined || actualValue === null) {
    throw analysisScopeError(
      `${owner} is missing analysis scope ${expectedScope.route}`,
      "ANALYSIS_SCOPE_MISMATCH",
    );
  }

  const actualScope = canonicalAnalysisScope(actualValue);
  const actualRepoRoot = actualValue.repoRoot;
  const expectedValue = unwrapAnalysisScope(expected);
  const expectedRepoRoot = expectedValue?.repoRoot;
  const sameRepoRoot = actualRepoRoot === undefined || expectedRepoRoot === undefined
    || sameCanonicalPath(actualRepoRoot, expectedRepoRoot);
  if (!sameRepoRoot
    || actualScope.kind !== expectedScope.kind
    || actualScope.route !== expectedScope.route) {
    throw analysisScopeError(
      `${owner} analysis scope ${actualScope.route} does not match ${expectedScope.route}`,
      "ANALYSIS_SCOPE_MISMATCH",
    );
  }
  return true;
}

export function listTrackedFiles(repoRoot, analysisScope = null) {
  const resolvedRepoRoot = canonicalAbsolutePath(repoRoot);
  const scopeValue = unwrapAnalysisScope(analysisScope);
  if (scopeValue?.repoRoot !== undefined
    && !sameCanonicalPath(scopeValue.repoRoot, resolvedRepoRoot)) {
    throw analysisScopeError(
      `tracked-file Git root ${resolvedRepoRoot} does not match analysis scope Git root ${scopeValue.repoRoot}`,
      "ANALYSIS_SCOPE_MISMATCH",
    );
  }
  return git(resolvedRepoRoot, ["ls-files", "-z", ...scopePathspecArgs(scopeValue)])
    .split("\0")
    .filter(Boolean)
    .map(toPosix)
    .filter((filePath) => isPathInAnalysisScope(filePath, scopeValue));
}

export function listUntrackedFiles(repoRoot, analysisScope = null) {
  const resolvedRepoRoot = canonicalAbsolutePath(repoRoot);
  const scopeValue = unwrapAnalysisScope(analysisScope);
  if (scopeValue?.repoRoot !== undefined
    && !sameCanonicalPath(scopeValue.repoRoot, resolvedRepoRoot)) {
    throw analysisScopeError(
      `untracked-file Git root ${resolvedRepoRoot} does not match analysis scope Git root ${scopeValue.repoRoot}`,
      "ANALYSIS_SCOPE_MISMATCH",
    );
  }
  return git(
    resolvedRepoRoot,
    ["ls-files", "--others", "--exclude-standard", "-z", ...scopePathspecArgs(scopeValue)],
  )
    .split("\0")
    .filter(Boolean)
    .map(toPosix)
    .filter((filePath) => isPathInAnalysisScope(filePath, scopeValue));
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

export function analysisDirectoryForScope(filePath, analysisScope) {
  const localPath = toAnalysisRelativePath(filePath, analysisScope);
  return fromAnalysisRelativePath(analysisDirectoryFor(localPath), analysisScope);
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

export function parseNumstat(output, analysisScope = null) {
  const files = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    const [addedRaw, deletedRaw, ...pathParts] = line.split("\t");
    const filePath = normalizeRenamePath(pathParts.join("\t"));
    if (!filePath || !isPathInAnalysisScope(filePath, analysisScope)) {
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
