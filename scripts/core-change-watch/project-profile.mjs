#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  SCHEMA_VERSION,
  addCount,
  analysisDirectoryFor,
  applyIgnorePatterns,
  compactReasonList,
  fileRoleFor,
  isCli,
  isDependencyOrGenerated,
  isSourceFile,
  isTestFile,
  languageFor,
  listTrackedFiles,
  normalizeLanguages,
  option,
  parseArgs,
  readJsonFile,
  resolveRepoRoot,
  sortedCounts,
  toPosix,
  writeJsonResult,
} from "./common.mjs";

const MANIFESTS = new Set([
  "package.json",
  "tsconfig.json",
  "jsconfig.json",
  "composer.json",
  "composer.lock",
  "Gemfile",
  "Gemfile.lock",
  "go.mod",
  "go.work",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "gradle.properties",
  "Cargo.toml",
  "pyproject.toml",
  "Pipfile",
  "requirements.txt",
]);

const AGENT_INSTRUCTION_FILE = "AGENTS.md";
const SOURCE_FILES_PER_AGENT_INSTRUCTION = 250;
const SIGNIFICANT_SOURCE_ROOT_FILES = 100;
const SOURCE_LINE_METHOD = "tracked readable primary source files only; excludes tests, non-source assets, generated/dependency paths, and untracked files";
const SOURCE_LINE_SKIPPED_METHOD = "not measured by default; use --measure-source-lines to count tracked readable primary source files only";

function scriptNames(manifest, filePath) {
  if (!manifest?.scripts || typeof manifest.scripts !== "object") {
    return [];
  }
  return Object.keys(manifest.scripts).sort();
}

function manifestKind(filePath) {
  const base = path.posix.basename(toPosix(filePath));
  if (base === "package.json") {
    return "node";
  }
  if (base === "composer.json" || base === "composer.lock") {
    return "php";
  }
  if (base === "Gemfile" || base === "Gemfile.lock") {
    return "ruby";
  }
  if (base === "go.mod" || base === "go.work") {
    return "go";
  }
  if (base === "pom.xml" || base.startsWith("build.gradle") || base.startsWith("settings.gradle")) {
    return "java";
  }
  if (base.endsWith(".toml")) {
    return "toml";
  }
  if (base === "Pipfile" || base === "requirements.txt") {
    return "python";
  }
  return "config";
}

function isManifestFile(filePath) {
  return MANIFESTS.has(path.posix.basename(toPosix(filePath)));
}

function entryScore(filePath) {
  const normalized = toPosix(filePath);
  const base = path.posix.basename(normalized);
  if (normalized === "artisan") {
    return 88;
  }
  if (normalized === "bin/console") {
    return 84;
  }
  if (normalized === "manage.py") {
    return 82;
  }
  if (normalized === "config.ru") {
    return 76;
  }
  if (/^public\/index\.php$/.test(normalized)) {
    return 86;
  }
  if (/^src\/Kernel\.php$/.test(normalized)) {
    return 78;
  }
  if (/^cmd\/[^/]+\/main\.go$/.test(normalized)) {
    return 90;
  }
  if (base === "main.go") {
    return 80;
  }
  if (/^src\/main\/java\//.test(normalized)) {
    return 70;
  }
  if (/\/(server|app|main|index)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(normalized)) {
    return 65;
  }
  if (/^(server|app|main|index)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(normalized)) {
    return 60;
  }
  if (/\/(server|app|main|index)\.php$/.test(normalized) || /^(server|app|main|index)\.php$/.test(normalized)) {
    return 58;
  }
  return 0;
}

function corePathHint(filePath) {
  const directory = analysisDirectoryFor(filePath);
  if (/(^|\/)(core|auth|security|permission|permissions|crypto|session|payment|billing|domain|service|api)(\/|$)/i.test(directory)) {
    return directory;
  }
  return "";
}

function safeReadText(repoRoot, filePath) {
  const absolute = path.join(repoRoot, filePath);
  if (!existsSync(absolute)) {
    return "";
  }
  try {
    return readFileSync(absolute, "utf8");
  } catch {
    return "";
  }
}

function readTextOrNull(repoRoot, filePath) {
  const absolute = path.join(repoRoot, filePath);
  if (!existsSync(absolute)) {
    return null;
  }
  try {
    return readFileSync(absolute, "utf8");
  } catch {
    return null;
  }
}

function countFileLinesOrNull(repoRoot, filePath) {
  const absolute = path.join(repoRoot, filePath);
  if (!existsSync(absolute)) {
    return null;
  }
  let buffer;
  try {
    buffer = readFileSync(absolute);
  } catch {
    return null;
  }
  if (buffer.length === 0) {
    return 0;
  }
  let newlineCount = 0;
  for (const byte of buffer) {
    if (byte === 10) {
      newlineCount += 1;
    }
  }
  return newlineCount + (buffer[buffer.length - 1] === 10 ? 0 : 1);
}

function shouldMeasureSourceLines(options = {}) {
  if (options.measureSourceLines === true) {
    return true;
  }
  const mode = String(options.sourceLineMode ?? "").trim().toLowerCase();
  return mode === "measure" || mode === "measured";
}

function firstMarkdownHeading(text) {
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const match = /^#\s+(.+?)\s*#*\s*$/.exec(line.trim());
    if (match) {
      return match[1].trim();
    }
  }
  return "";
}

function rootPackageIdentity(repoRoot, fileSet) {
  if (!fileSet.has("package.json")) {
    return null;
  }
  const manifest = readJsonFile(repoRoot, "package.json");
  if (!manifest || typeof manifest !== "object") {
    return null;
  }
  const identity = {
    name: typeof manifest.name === "string" ? manifest.name : "",
    description: typeof manifest.description === "string" ? manifest.description : "",
    evidence: [],
  };
  if (identity.name) {
    identity.evidence.push("package.json:name");
  }
  if (identity.description) {
    identity.evidence.push("package.json:description");
  }
  return identity.name || identity.description ? identity : null;
}

function rootReadmeTitle(repoRoot, trackedFiles) {
  const readmePath = trackedFiles.find((filePath) => /^readme(?:\.[^.]+)?$/i.test(path.posix.basename(filePath)) && !filePath.includes("/"));
  if (!readmePath) {
    return { title: "", path: "" };
  }
  const text = readTextOrNull(repoRoot, readmePath);
  return {
    title: firstMarkdownHeading(text),
    path: readmePath,
  };
}

function dependencyNames(manifest) {
  return new Set([
    ...Object.keys(manifest?.dependencies ?? {}),
    ...Object.keys(manifest?.devDependencies ?? {}),
    ...Object.keys(manifest?.require ?? {}),
    ...Object.keys(manifest?.["require-dev"] ?? {}),
  ]);
}

function addFrameworkSignal(signals, name, score, evidence) {
  const item = signals.get(name) ?? {
    name,
    score: 0,
    evidence: [],
  };
  item.score += score;
  item.evidence.push(evidence);
  signals.set(name, item);
}

function hasFileMatching(fileSet, pattern) {
  return [...fileSet].some((filePath) => pattern.test(filePath));
}

function manifestFiles(fileSet, pattern) {
  return [...fileSet].filter((filePath) => pattern.test(filePath)).sort();
}

function jsonManifests(repoRoot, fileSet, pattern) {
  return manifestFiles(fileSet, pattern)
    .map((filePath) => ({ path: filePath, manifest: readJsonFile(repoRoot, filePath) }))
    .filter((item) => item.manifest);
}

function firstManifestWithDependency(manifests, dependencyName) {
  return manifests.find((item) => dependencyNames(item.manifest).has(dependencyName))?.path ?? "";
}

function firstTextMatch(repoRoot, fileSet, pattern, textPattern) {
  for (const filePath of manifestFiles(fileSet, pattern)) {
    if (textPattern.test(safeReadText(repoRoot, filePath))) {
      return filePath;
    }
  }
  return "";
}

function joinedManifestText(repoRoot, fileSet, pattern) {
  return manifestFiles(fileSet, pattern)
    .map((filePath) => safeReadText(repoRoot, filePath))
    .join("\n");
}

function detectFrameworks(repoRoot, trackedFiles) {
  const fileSet = new Set(trackedFiles);
  const signals = new Map();
  const packageManifests = jsonManifests(repoRoot, fileSet, /(^|\/)package\.json$/);
  const composerManifests = jsonManifests(repoRoot, fileSet, /(^|\/)composer\.json$/);
  const nestManifest = firstManifestWithDependency(packageManifests, "@nestjs/core");
  const nextManifest = firstManifestWithDependency(packageManifests, "next");
  const laravelManifest = firstManifestWithDependency(composerManifests, "laravel/framework");
  const symfonyManifest = firstManifestWithDependency(composerManifests, "symfony/framework-bundle")
    || firstManifestWithDependency(composerManifests, "symfony/http-kernel");
  const codeIgniterManifest = firstManifestWithDependency(composerManifests, "codeigniter4/framework");
  const railsGemfile = firstTextMatch(repoRoot, fileSet, /(^|\/)Gemfile$/, /\bgem\s+["']rails["']/);
  const pythonManifestText = joinedManifestText(repoRoot, fileSet, /(^|\/)(requirements\.txt|pyproject\.toml|Pipfile)$/);
  const javaBuildText = joinedManifestText(repoRoot, fileSet, /(^|\/)(pom\.xml|build\.gradle|build\.gradle\.kts)$/);

  if (nestManifest || hasFileMatching(fileSet, /(^|\/)src\/.*\.module\.ts$/)) {
    addFrameworkSignal(signals, "nestjs", nestManifest ? 70 : 35, nestManifest ? `${nestManifest}:@nestjs/core` : "src/*.module.ts");
  }
  if (nextManifest || hasFileMatching(fileSet, /(^|\/)next\.config\.(js|mjs|ts)$/)) {
    addFrameworkSignal(signals, "nextjs", nextManifest ? 60 : 25, nextManifest ? `${nextManifest}:next` : "next.config.*");
  }
  if (laravelManifest || fileSet.has("artisan") || fileSet.has("bootstrap/app.php")) {
    addFrameworkSignal(signals, "laravel", laravelManifest ? 80 : 35, laravelManifest ? `${laravelManifest}:laravel/framework` : "artisan/bootstrap/app.php");
  }
  if (symfonyManifest || fileSet.has("bin/console") || fileSet.has("config/bundles.php")) {
    addFrameworkSignal(signals, "symfony", symfonyManifest ? 75 : 35, symfonyManifest ? `${symfonyManifest}:symfony` : "bin/console/config evidence");
  }
  if (codeIgniterManifest || fileSet.has("app/Config/Routes.php")) {
    addFrameworkSignal(signals, "codeigniter", codeIgniterManifest ? 70 : 30, codeIgniterManifest ? `${codeIgniterManifest}:codeigniter4/framework` : "app/Config/Routes.php");
  }
  if (railsGemfile || fileSet.has("config/routes.rb") || hasFileMatching(fileSet, /^app\/(models|controllers|services)\//)) {
    addFrameworkSignal(signals, "rails", railsGemfile ? 75 : 35, railsGemfile ? `${railsGemfile}:rails` : "rails app paths");
  }
  if (/\bdjango\b/i.test(pythonManifestText) || fileSet.has("manage.py") || hasFileMatching(fileSet, /(^|\/)settings\.py$/)) {
    addFrameworkSignal(signals, "django", /\bdjango\b/i.test(pythonManifestText) ? 70 : 35, /\bdjango\b/i.test(pythonManifestText) ? "python manifest:django" : "manage.py/settings.py");
  }
  if (/spring-boot|org\.springframework/i.test(javaBuildText) || hasFileMatching(fileSet, /^src\/main\/java\/.*Application\.java$/)) {
    addFrameworkSignal(signals, "spring", /spring-boot|org\.springframework/i.test(javaBuildText) ? 75 : 35, /spring-boot|org\.springframework/i.test(javaBuildText) ? "maven/gradle:spring" : "Application.java");
  }

  return [...signals.values()]
    .map((item) => ({
      name: item.name,
      score: Math.min(100, item.score),
      confidence: item.score >= 70 ? "high" : item.score >= 35 ? "medium" : "low",
      evidence: compactReasonList(item.evidence, 6),
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function sourceLineStatus(totals) {
  if (totals.sourceFiles === 0) {
    return "none";
  }
  if (totals.sourceLineMeasurement === "skipped") {
    return "skipped";
  }
  if (totals.unreadableSourceFiles === 0) {
    return "complete";
  }
  if (totals.readableSourceFiles > 0) {
    return "partial";
  }
  return "unavailable";
}

function projectIdentity(repoRoot, trackedFiles) {
  const fileSet = new Set(trackedFiles);
  const packageIdentity = rootPackageIdentity(repoRoot, fileSet);
  const readme = rootReadmeTitle(repoRoot, trackedFiles);
  const evidence = [];

  if (packageIdentity?.evidence?.length) {
    evidence.push(...packageIdentity.evidence);
  }
  if (readme.title) {
    evidence.push(`${readme.path}:h1`);
  }

  return {
    name: packageIdentity?.name || readme.title || path.basename(repoRoot),
    description: packageIdentity?.description || "",
    readmeTitle: readme.title,
    evidence: compactReasonList(evidence, 8),
  };
}

function instructionScope(filePath) {
  const directory = path.posix.dirname(toPosix(filePath));
  return directory === "." ? "." : directory;
}

function isPathUnderScope(filePath, scope) {
  const normalized = toPosix(filePath);
  const normalizedScope = toPosix(scope);
  return normalizedScope === "." || normalized === normalizedScope || normalized.startsWith(`${normalizedScope}/`);
}

function agentInstructionFiles(trackedFiles) {
  return trackedFiles
    .filter((filePath) => path.posix.basename(toPosix(filePath)) === AGENT_INSTRUCTION_FILE)
    .filter((filePath) => !isDependencyOrGenerated(filePath))
    .map((filePath) => ({
      path: toPosix(filePath),
      scope: instructionScope(filePath),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function suggestedInstructionMinimum(totals, sourceRoots) {
  if (totals.sourceFiles === 0) {
    return 0;
  }
  const sourceFileMinimum = Math.ceil(totals.sourceFiles / SOURCE_FILES_PER_AGENT_INSTRUCTION);
  const sourceRootMinimum = sourceRoots.filter((item) => item.files >= SIGNIFICANT_SOURCE_ROOT_FILES).length;
  return Math.max(1, sourceFileMinimum, sourceRootMinimum);
}

function agentInstructionStatus(count, suggestedMinimum) {
  if (suggestedMinimum === 0) {
    return count > 0 ? "present" : "none";
  }
  if (count === 0) {
    return "missing";
  }
  if (count < suggestedMinimum) {
    return "thin";
  }
  return "adequate";
}

function analyzeAgentInstructions({ trackedFiles, sourceRecords, sourceRoots, totals }) {
  const files = agentInstructionFiles(trackedFiles);
  const nestedScopes = files.filter((item) => item.scope !== ".").map((item) => item.scope);
  let sourceFilesUnderNestedInstructions = 0;
  const uncoveredSourceDirs = new Map();

  for (const source of sourceRecords) {
    const underNestedInstruction = nestedScopes.some((scope) => isPathUnderScope(source.path, scope));
    if (underNestedInstruction) {
      sourceFilesUnderNestedInstructions += 1;
    } else {
      addCount(uncoveredSourceDirs, source.directory, 1);
    }
  }

  const rootCount = files.filter((item) => item.scope === ".").length;
  const nestedCount = files.length - rootCount;
  const suggestedMinimum = suggestedInstructionMinimum(totals, sourceRoots);
  const suggestedAdditional = Math.max(0, suggestedMinimum - files.length);
  const status = agentInstructionStatus(files.length, suggestedMinimum);
  const reasons = [];

  if (rootCount > 0) {
    reasons.push("root AGENTS.md present");
  }
  if (nestedCount > 0) {
    reasons.push(`${nestedCount} nested AGENTS.md files provide module-local guidance`);
  }
  if (status === "thin") {
    reasons.push(`AGENTS.md count ${files.length} is below suggested minimum ${suggestedMinimum} for source scale`);
  }
  if (status === "missing") {
    reasons.push("no tracked AGENTS.md files found for a source-bearing repository");
  }
  if (totals.sourceFiles >= SOURCE_FILES_PER_AGENT_INSTRUCTION && sourceFilesUnderNestedInstructions === 0) {
    reasons.push("large source tree has no nested AGENTS.md coverage");
  }

  return {
    count: files.length,
    rootCount,
    nestedCount,
    files,
    status,
    suggestedMinimum,
    suggestedAdditional,
    sourceFilesPerInstruction: files.length > 0 ? Math.ceil(totals.sourceFiles / files.length) : null,
    sourceFilesUnderNestedInstructions,
    nestedSourceFileCoveragePercent: totals.sourceFiles > 0
      ? Math.round((sourceFilesUnderNestedInstructions / totals.sourceFiles) * 100)
      : null,
    suggestedScopes: sortedCounts(uncoveredSourceDirs, 8).map((item) => ({ path: item.name, sourceFiles: item.count })),
    reasons: compactReasonList(reasons, 8),
  };
}

function buildProjectInfo({
  repoRoot,
  trackedFiles,
  languages,
  manifests,
  frameworks,
  sourceRoots,
  entryCandidates,
  totals,
}) {
  const identity = projectIdentity(repoRoot, trackedFiles);
  return {
    ...identity,
    primaryLanguages: languages.slice(0, 5).map((item) => ({
      language: item.language,
      sourceFiles: item.sourceFiles,
      testFiles: item.testFiles,
    })),
    frameworks: frameworks.slice(0, 5).map((item) => ({
      name: item.name,
      confidence: item.confidence,
      evidence: item.evidence,
    })),
    sourceFiles: totals.sourceFiles,
    testFiles: totals.testFiles,
    measuredSourceLines: totals.sourceLines,
    sourceLineStatus: sourceLineStatus(totals),
    sourceLineMethod: totals.sourceLineMeasurement === "skipped" ? SOURCE_LINE_SKIPPED_METHOD : SOURCE_LINE_METHOD,
    sourceRoots: sourceRoots.slice(0, 8),
    entryCandidates: entryCandidates.slice(0, 5).map((item) => ({
      path: item.path,
      language: item.language,
      score: item.score,
    })),
    manifests: manifests.slice(0, 8),
  };
}

export async function analyzeProjectProfile(options = {}) {
  const repoRoot = resolveRepoRoot(options.cwd ?? process.env.QODER_CWD ?? process.cwd());
  const allowedLanguages = new Set(normalizeLanguages(options.languages));
  const measureSourceLines = shouldMeasureSourceLines(options);
  const rawTrackedFiles = listTrackedFiles(repoRoot);
  const filteredTrackedFiles = applyIgnorePatterns(rawTrackedFiles, options.ignore);
  const trackedFiles = filteredTrackedFiles.items;
  const analysisTrackedFiles = trackedFiles.filter((filePath) => !isDependencyOrGenerated(filePath));
  const sourceRoots = new Map();
  const sourceRecords = [];
  const languageStats = new Map();
  const coreHints = new Map();
  const entryCandidates = [];
  const manifests = [];
  const totals = {
    trackedFiles: trackedFiles.length,
    trackedFilesBeforeFilters: rawTrackedFiles.length,
    sourceFiles: 0,
    testFiles: 0,
    generatedOrDependencyFiles: 0,
    sourceLines: measureSourceLines ? 0 : null,
    sourceLineMeasurement: measureSourceLines ? "measured" : "skipped",
    readableSourceFiles: 0,
    unreadableSourceFiles: 0,
  };

  for (const filePath of trackedFiles) {
    const normalized = toPosix(filePath);
    if (isDependencyOrGenerated(normalized)) {
      totals.generatedOrDependencyFiles += 1;
      continue;
    }

    if (isManifestFile(normalized)) {
      const manifest = readJsonFile(repoRoot, normalized);
      manifests.push({
        path: normalized,
        kind: manifestKind(normalized),
        scripts: scriptNames(manifest, normalized),
      });
    }

    if (!isSourceFile(normalized)) {
      const score = entryScore(normalized);
      if (score > 0 && existsSync(path.join(repoRoot, normalized))) {
        entryCandidates.push({
          path: normalized,
          language: languageFor(normalized),
          score,
          reasons: compactReasonList(["entrypoint naming convention"]),
        });
      }
      continue;
    }

    const language = languageFor(normalized);
    if (!allowedLanguages.has(language)) {
      continue;
    }

    const score = entryScore(normalized);
    if (score > 0 && existsSync(path.join(repoRoot, normalized))) {
      entryCandidates.push({
        path: normalized,
        language,
        score,
        reasons: compactReasonList(["entrypoint naming convention"]),
      });
    }

    const role = fileRoleFor(normalized);
    const isTest = role === "test" || isTestFile(normalized);
    const isPrimarySource = role === "source";
    if (!isPrimarySource && !isTest) {
      continue;
    }

    totals.sourceFiles += isPrimarySource ? 1 : 0;
    totals.testFiles += isTest ? 1 : 0;

    if (isPrimarySource) {
      let lines = null;
      if (measureSourceLines) {
        lines = countFileLinesOrNull(repoRoot, normalized);
        if (lines === null) {
          totals.unreadableSourceFiles += 1;
        } else {
          totals.readableSourceFiles += 1;
          totals.sourceLines += lines;
        }
      }
      sourceRecords.push({
        path: normalized,
        language,
        lines,
        directory: analysisDirectoryFor(normalized),
      });
    }

    const stats = languageStats.get(language) ?? {
      language,
      files: 0,
      sourceFiles: 0,
      testFiles: 0,
      roots: new Map(),
    };
    stats.files += 1;
    stats.sourceFiles += isPrimarySource ? 1 : 0;
    stats.testFiles += isTest ? 1 : 0;
    addCount(stats.roots, analysisDirectoryFor(normalized), 1);
    languageStats.set(language, stats);

    if (isPrimarySource) {
      addCount(sourceRoots, normalized.split("/")[0] ?? ".", 1);
      const hint = corePathHint(normalized);
      addCount(coreHints, hint, hint ? 1 : 0);
    }

  }

  const languages = [...languageStats.values()]
    .map((item) => ({
      language: item.language,
      files: item.files,
      sourceFiles: item.sourceFiles,
      testFiles: item.testFiles,
      roots: sortedCounts(item.roots, 8),
    }))
    .sort((a, b) => b.sourceFiles - a.sourceFiles || a.language.localeCompare(b.language));
  const sortedManifests = manifests.sort((a, b) => a.path.localeCompare(b.path));
  const frameworks = detectFrameworks(repoRoot, analysisTrackedFiles);
  const sortedSourceRoots = sortedCounts(sourceRoots, 12).map((item) => ({ path: item.name, files: item.count }));
  const sortedEntryCandidates = entryCandidates.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, 20);

  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "project-profile",
    status: "ok",
    repoRoot,
    filters: filteredTrackedFiles.filters,
    projectInfo: buildProjectInfo({
      repoRoot,
      trackedFiles,
      languages,
      manifests: sortedManifests,
      frameworks,
      sourceRoots: sortedSourceRoots,
      entryCandidates: sortedEntryCandidates,
      totals,
    }),
    agentInstructions: analyzeAgentInstructions({
      trackedFiles,
      sourceRecords,
      sourceRoots: sortedSourceRoots,
      totals,
    }),
    languages,
    manifests: sortedManifests,
    frameworks,
    sourceRoots: sortedSourceRoots,
    entryCandidates: sortedEntryCandidates,
    corePathHints: sortedCounts(coreHints, 20).map((item) => ({ path: item.name, files: item.count })),
    totals,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const result = await analyzeProjectProfile({
    cwd: option(args, "cwd"),
    languages: option(args, "languages"),
    ignore: option(args, "ignore"),
    measureSourceLines: Boolean(args["measure-source-lines"]),
  });
  await writeJsonResult(result, args);
}

if (isCli(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`project-profile failed: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
