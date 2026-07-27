#!/usr/bin/env node

import {
  DEFAULT_MAX_COMMITS,
  SCHEMA_VERSION,
  addCount,
  analysisDirectoryFor,
  applyIgnorePatterns,
  compactReasonList,
  isCli,
  isDependencyOrGenerated,
  isSourceFile,
  isSupportingFile,
  isTestFile,
  languageFor,
  listTrackedFiles,
  normalizeLanguages,
  option,
  parseArgs,
  positiveInt,
  resolveRepoRoot,
  scoreToConfidence,
  sortedCounts,
  writeJsonResult,
} from "./common.mjs";
import { analyzeGitHistoryProfile } from "./git-history-profile.mjs";
import { analyzeProjectProfile } from "./project-profile.mjs";

const CORE_PATH_PATTERNS = [
  { pattern: /^(src|lib|server|app)$/i, score: 16, reason: "source root" },
  { pattern: /(^|\/)(core|kernel|runtime|engine)(\/|$)/i, score: 34, reason: "core path naming" },
  { pattern: /(^|\/)(auth|security|permission|permissions|crypto|session)(\/|$)/i, score: 32, reason: "security/session path" },
  { pattern: /(^|\/)(payment|billing|checkout|order)(\/|$)/i, score: 28, reason: "business-critical path" },
  { pattern: /(^|\/)(domain|model|service|services|api|server)(\/|$)/i, score: 22, reason: "domain/service path" },
  { pattern: /^internal\/[^/]+/i, score: 24, reason: "go internal package" },
  { pattern: /^pkg\/[^/]+/i, score: 18, reason: "go exported package" },
  { pattern: /^cmd\/[^/]+/i, score: 14, reason: "go command entrypoint" },
  { pattern: /^src\/main\/java\//i, score: 24, reason: "java production source" },
  { pattern: /^packages\/[^/]+/i, score: 16, reason: "workspace package" },
  { pattern: /^app\/api(\/|$)/i, score: 20, reason: "typescript api route" },
  { pattern: /^src\/(controller|controllers|service|services|entity|repository|security)(\/|$)/i, score: 18, reason: "framework source path" },
  { pattern: /^app\/(http|models|services|providers|policies|jobs|console|controllers|models)(\/|$)/i, score: 18, reason: "framework app path" },
  { pattern: /^routes(\/|$)/i, score: 12, reason: "framework route path" },
  { pattern: /^app\/(models|controllers|services|jobs|mailers)(\/|$)/i, score: 20, reason: "mvc app path" },
];

const FRAMEWORK_PATH_SIGNALS = [
  { framework: "laravel", pattern: /^app\/(Http|Models|Services|Providers|Policies|Jobs|Console)(\/|$)/, score: 22, reason: "laravel application path" },
  { framework: "laravel", pattern: /^routes(\/|$)/, score: 14, reason: "laravel route path" },
  { framework: "symfony", pattern: /^src\/(Controller|Entity|Service|Security|Repository|MessageHandler)(\/|$)/, score: 22, reason: "symfony application path" },
  { framework: "codeigniter", pattern: /^app\/(Controllers|Models|Libraries|Services|Config)(\/|$)/, score: 18, reason: "codeigniter application path" },
  { framework: "rails", pattern: /^app\/(models|controllers|services|jobs|mailers|policies)(\/|$)/, score: 22, reason: "rails application path" },
  { framework: "spring", pattern: /^src\/main\/java(\/|$)/, score: 18, reason: "spring production source path" },
  { framework: "nestjs", pattern: /^src(\/|$)/, score: 14, reason: "nestjs source root" },
  { framework: "nextjs", pattern: /^(app|pages|src\/app|src\/pages)(\/|$)/, score: 14, reason: "nextjs route/app path" },
];

const NON_CORE_SEGMENT_RE = /^(docs?|docs_src|examples?|_examples|samples?|demos?|tutorials?|bench|benchmarks?|benches|testing|fixtures?|testdata|testlib|ztest|readme|curriculum)$/i;

function isNonCoreCandidatePath(candidatePath) {
  return candidatePath.split("/").some((segment) => (
    NON_CORE_SEGMENT_RE.test(segment)
    || /^docs[-_]/i.test(segment)
    || /^examples?[-_]/i.test(segment)
    || /^e2e($|[-_])/i.test(segment)
  ));
}

function candidateForFile(map, filePath) {
  const directory = analysisDirectoryFor(filePath);
  const item = map.get(directory) ?? {
    path: directory,
    score: 0,
    reasons: [],
    files: 0,
    languages: new Map(),
    evidence: {
      sourceFiles: [],
      hotFiles: [],
      manifests: [],
    },
  };
  item.files += 1;
  addCount(item.languages, languageFor(filePath), 1);
  if (item.evidence.sourceFiles.length < 10) {
    item.evidence.sourceFiles.push(filePath);
  }
  map.set(directory, item);
  return item;
}

function applyPathSignals(candidate) {
  for (const signal of CORE_PATH_PATTERNS) {
    if (signal.pattern.test(candidate.path)) {
      candidate.score += signal.score;
      candidate.reasons.push(signal.reason);
    }
  }
}

function applyDensitySignals(candidate) {
  if (candidate.files >= 80) {
    candidate.score += 20;
    candidate.reasons.push("large package/root");
  } else if (candidate.files >= 20) {
    candidate.score += 15;
    candidate.reasons.push("dense package/root");
  } else if (candidate.files >= 4) {
    candidate.score += 14;
    candidate.reasons.push("package/root with multiple source files");
  }
}

function applyHistorySignals(candidate, history) {
  const hotFiles = history.hotFiles.filter((item) => item.path === candidate.path || item.path.startsWith(`${candidate.path}/`));
  const hotPath = history.hotPaths.find((item) => item.path === candidate.path);

  if (hotPath) {
    const hotPathScore = hotPath.commits >= 3
      ? Math.min(26, 8 + hotPath.commits * 4)
      : hotPath.commits === 2
        ? 10
        : 4;
    candidate.score += hotPathScore;
    if (hotPath.commits >= 2) {
      candidate.reasons.push(`hot path in git history (${hotPath.commits} commits)`);
    }
  }

  if (hotFiles.length > 0) {
    const repeatedCommits = hotFiles.reduce((sum, item) => sum + Math.max(0, item.commits - 1), 0);
    candidate.score += repeatedCommits > 0 ? Math.min(20, 6 + repeatedCommits * 3) : 3;
    if (repeatedCommits > 0) {
      candidate.reasons.push("contains repeatedly touched files");
    }
    candidate.evidence.hotFiles = hotFiles.slice(0, 8);
  }
}

function applyProfileSignals(candidate, profile) {
  const manifest = profile.manifests.find((item) => candidate.path === "." || candidate.path.startsWith(item.path.split("/").slice(0, -1).join("/") || "."));
  if (manifest) {
    candidate.score += 5;
    candidate.evidence.manifests.push(manifest);
  }

  const entry = profile.entryCandidates.find((item) => item.path.startsWith(`${candidate.path}/`));
  if (entry) {
    candidate.score += 12;
    candidate.reasons.push("contains entry candidate");
  }
}

function candidateHasSource(candidate, pattern) {
  return candidate.evidence.sourceFiles.some((filePath) => pattern.test(filePath));
}

function frameworkManifestDirectory(evidence) {
  const filePath = String(evidence ?? "").split(":")[0];
  if (!/(^|\/)(package\.json|composer\.json|Gemfile|pom\.xml|build\.gradle|build\.gradle\.kts)$/.test(filePath)) {
    return "";
  }
  const parts = filePath.split("/");
  return parts.length <= 1 ? "." : parts.slice(0, -1).join("/");
}

function applyFrameworkSignals(candidate, profile) {
  const frameworks = new Set((profile.frameworks ?? []).map((framework) => framework.name));
  for (const framework of profile.frameworks ?? []) {
    for (const evidence of framework.evidence ?? []) {
      const directory = frameworkManifestDirectory(evidence);
      if (directory && (candidate.path === directory || candidate.path.startsWith(`${directory}/`) || directory.startsWith(`${candidate.path}/`))) {
        candidate.score += framework.confidence === "high" ? 18 : 12;
        candidate.reasons.push(`${framework.name} manifest boundary`);
      }
    }
  }
  for (const signal of FRAMEWORK_PATH_SIGNALS) {
    if (frameworks.has(signal.framework) && signal.pattern.test(candidate.path)) {
      candidate.score += signal.score;
      candidate.reasons.push(signal.reason);
    }
  }

  if (frameworks.has("django") && candidateHasSource(candidate, /(^|\/)(models|views|urls|serializers|services)\.py$/)) {
    candidate.score += 20;
    candidate.reasons.push("django app module files");
  }
  if (frameworks.has("nestjs") && candidateHasSource(candidate, /(^|\/).*\.(module|service|controller)\.ts$/)) {
    candidate.score += 18;
    candidate.reasons.push("nestjs module/service/controller files");
  }
}

export async function analyzeCoreCandidates(options = {}) {
  const repoRoot = resolveRepoRoot(options.cwd ?? process.env.QODER_CWD ?? process.cwd());
  const allowedLanguages = new Set(normalizeLanguages(options.languages));
  const maxCandidates = positiveInt(options.maxCandidates, 30);
  const rawTrackedFiles = listTrackedFiles(repoRoot);
  const filteredTrackedFiles = applyIgnorePatterns(rawTrackedFiles, options.ignore);
  const trackedFiles = filteredTrackedFiles.items;
  const profile = options.profile ?? await analyzeProjectProfile({ cwd: repoRoot, languages: [...allowedLanguages], ignore: options.ignore });
  const history = options.history ?? await analyzeGitHistoryProfile({
    cwd: repoRoot,
    languages: [...allowedLanguages],
    maxCommits: positiveInt(options.maxCommits, DEFAULT_MAX_COMMITS),
    ignore: options.ignore,
  });
  const candidates = new Map();

  for (const filePath of trackedFiles) {
    if (isDependencyOrGenerated(filePath) || isTestFile(filePath) || isSupportingFile(filePath) || !isSourceFile(filePath)) {
      continue;
    }
    const language = languageFor(filePath);
    if (!allowedLanguages.has(language)) {
      continue;
    }
    if (isNonCoreCandidatePath(analysisDirectoryFor(filePath))) {
      continue;
    }
    candidateForFile(candidates, filePath);
  }

  for (const candidate of candidates.values()) {
    candidate.score += Math.min(10, candidate.files);
    applyDensitySignals(candidate);
    applyPathSignals(candidate);
    applyHistorySignals(candidate, history);
    applyProfileSignals(candidate, profile);
    applyFrameworkSignals(candidate, profile);
  }

  const resultCandidates = [...candidates.values()]
    .map((candidate) => ({
      path: candidate.path,
      score: Math.min(100, Math.round(candidate.score)),
      confidence: scoreToConfidence(candidate.score),
      files: candidate.files,
      languages: sortedCounts(candidate.languages, 8).map((item) => ({
        language: item.name,
        files: item.count,
      })),
      reasons: compactReasonList(candidate.reasons),
      evidence: {
        sourceFiles: candidate.evidence.sourceFiles,
        hotFiles: candidate.evidence.hotFiles,
        manifests: candidate.evidence.manifests,
      },
    }))
    .filter((candidate) => candidate.score >= 15 || candidate.evidence.hotFiles.length > 0)
    .sort((a, b) => b.score - a.score || b.files - a.files || a.path.localeCompare(b.path))
    .slice(0, maxCandidates);

  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "core-candidates",
    status: "ok",
    repoRoot,
    filters: filteredTrackedFiles.filters,
    candidates: resultCandidates,
    summary: {
      highConfidence: resultCandidates.filter((item) => item.confidence === "high").length,
      mediumConfidence: resultCandidates.filter((item) => item.confidence === "medium").length,
      candidateCount: resultCandidates.length,
    },
  };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const result = await analyzeCoreCandidates({
    cwd: option(args, "cwd"),
    languages: option(args, "languages"),
    maxCommits: positiveInt(option(args, "max-commits"), DEFAULT_MAX_COMMITS),
    maxCandidates: positiveInt(option(args, "max-candidates"), 30),
    ignore: option(args, "ignore"),
  });
  await writeJsonResult(result, args);
}

if (isCli(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`core-candidates failed: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
