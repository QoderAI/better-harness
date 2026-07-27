#!/usr/bin/env node

import {
  DEFAULT_MAX_COMMITS,
  SCHEMA_VERSION,
  addCount,
  analysisDirectoryFor,
  applyIgnorePatterns,
  git,
  isCli,
  isDependencyOrGenerated,
  isSupportingFile,
  languageFor,
  normalizeHistoryWindows,
  normalizeLanguages,
  option,
  parseArgs,
  parseNumstat,
  positiveInt,
  resolveRepoRoot,
  sortedCounts,
  writeJsonResult,
} from "./common.mjs";

function parseLogWithNumstat(output) {
  const commits = [];
  let current = null;

  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("commit\x1f")) {
      const [, sha, timestamp, ...subjectParts] = line.split("\x1f");
      current = {
        sha,
        shortSha: sha.slice(0, 7),
        timestamp: Number(timestamp),
        subject: subjectParts.join("\x1f"),
        files: [],
      };
      commits.push(current);
      continue;
    }

    if (!current || !line.trim()) {
      continue;
    }

    current.files.push(...parseNumstat(line));
  }

  return commits;
}

function incrementFileStats(map, file, commit) {
  const item = map.get(file.filePath) ?? {
    path: file.filePath,
    language: file.language,
    role: file.role,
    supporting: file.supporting,
    commits: 0,
    added: 0,
    deleted: 0,
    churn: 0,
    lastTouched: commit.shortSha,
  };
  item.commits += 1;
  item.added += file.added;
  item.deleted += file.deleted;
  item.churn += file.added + file.deleted;
  item.lastTouched = commit.shortSha;
  map.set(file.filePath, item);
}

function isAllowedHistoryFile(file, allowedLanguages) {
  if (isDependencyOrGenerated(file.filePath)) {
    return false;
  }
  if (file.role === "source") {
    return Boolean(file.language && allowedLanguages.has(file.language));
  }
  return true;
}

function sortedHotFiles(map, limit) {
  return [...map.values()]
    .sort((a, b) => b.commits - a.commits || b.churn - a.churn || a.path.localeCompare(b.path))
    .slice(0, limit);
}

function collectHistoryStats(commits, allowedLanguages) {
  const fileStats = new Map();
  const supportingFileStats = new Map();
  const pathStats = new Map();
  const supportingPathStats = new Map();
  const languageStats = new Map();
  const coChangePaths = new Map();

  for (const commit of commits) {
    const relevantFiles = commit.files.filter((file) => isAllowedHistoryFile(file, allowedLanguages));
    const primaryFiles = relevantFiles.filter((file) => !isSupportingFile(file.filePath));
    const supportingFiles = relevantFiles.filter((file) => isSupportingFile(file.filePath));
    const directories = new Set();

    for (const file of primaryFiles) {
      incrementFileStats(fileStats, file, commit);
      const directory = analysisDirectoryFor(file.filePath);
      directories.add(directory);
      addCount(languageStats, file.language ?? "other", 1);
    }

    for (const file of supportingFiles) {
      incrementFileStats(supportingFileStats, file, commit);
      addCount(supportingPathStats, analysisDirectoryFor(file.filePath), 1);
    }

    for (const directory of directories) {
      addCount(pathStats, directory, 1);
    }

    const directoryList = [...directories].sort();
    for (let left = 0; left < directoryList.length; left += 1) {
      for (let right = left + 1; right < directoryList.length; right += 1) {
        addCount(coChangePaths, `${directoryList[left]} <-> ${directoryList[right]}`, 1);
      }
    }
  }

  return {
    fileStats,
    supportingFileStats,
    pathStats,
    supportingPathStats,
    languageStats,
    coChangePaths,
  };
}

function historyWindows(commits, allowedLanguages, daysList) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return daysList.map((days) => {
    const sinceSeconds = nowSeconds - days * 24 * 60 * 60;
    const windowCommits = commits.filter((commit) => commit.timestamp >= sinceSeconds);
    const stats = collectHistoryStats(windowCommits, allowedLanguages);
    const trend = trendForWindow(days, windowCommits.length);

    return {
      days,
      since: new Date(sinceSeconds * 1000).toISOString(),
      analyzedCommits: windowCommits.length,
      trendLabel: trend.label,
      interpretation: trend.interpretation,
      hotFiles: sortedHotFiles(stats.fileStats, 10),
      supportingHotFiles: sortedHotFiles(stats.supportingFileStats, 10),
      hotPaths: sortedCounts(stats.pathStats, 10).map((item) => ({
        path: item.name,
        commits: item.count,
      })),
    };
  });
}

function trendForWindow(days, analyzedCommits) {
  const horizon = days <= 30 ? "recent" : days <= 90 ? "sustained" : "long-range";
  const label = days <= 30 ? "recent-hotspots" : days <= 90 ? "sustained-hotspots" : "legacy-or-long-range-hotspots";
  const emptySuffix = analyzedCommits === 0 ? " No commits landed in this window, so treat it as missing evidence." : "";
  return {
    label,
    interpretation: `${horizon} window for spotting ${label.replaceAll("-", " ")} from bounded git history.${emptySuffix}`,
  };
}

function historyConfidence(commits, maxCommits) {
  if (commits.length === 0) {
    return { confidence: "low", reasons: ["no commits were available in the bounded history scan"] };
  }
  if (commits.length === 1) {
    return { confidence: "low", reasons: ["single-commit history cannot prove hotspot stability"] };
  }
  const newest = commits[0]?.timestamp ?? 0;
  const oldest = commits.at(-1)?.timestamp ?? newest;
  const spanDays = Math.max(0, Math.round((newest - oldest) / (24 * 60 * 60)));
  const reasons = [];
  if (commits.length < 10) {
    reasons.push(`only ${commits.length} commits were analyzed`);
  }
  if (spanDays < 30) {
    reasons.push(`history span is only ${spanDays} days`);
  }
  if (commits.length >= maxCommits) {
    reasons.push(`bounded at maxCommits=${maxCommits}`);
  }
  return {
    confidence: reasons.length >= 2 || commits.length < 5 ? "low" : reasons.length === 1 ? "medium" : "high",
    reasons: reasons.length > 0 ? reasons : ["bounded history has enough commits and time span for hotspot ranking"],
  };
}

function applyCommitIgnores(commits, ignorePatterns) {
  const ignoredSample = [];
  let ignoredCount = 0;
  const filteredCommits = commits.map((commit) => {
    const filtered = applyIgnorePatterns(commit.files, ignorePatterns, (file) => file.filePath);
    ignoredCount += filtered.filters.ignoredCount;
    for (const filePath of filtered.filters.ignoredSample) {
      if (ignoredSample.length < 10 && !ignoredSample.includes(filePath)) {
        ignoredSample.push(filePath);
      }
    }
    return { ...commit, files: filtered.items };
  });
  const firstFilter = applyIgnorePatterns([], ignorePatterns).filters;
  return {
    commits: filteredCommits,
    filters: {
      ignorePatterns: firstFilter.ignorePatterns,
      ignoredCount,
      ignoredSample,
    },
  };
}

export async function analyzeGitHistoryProfile(options = {}) {
  const repoRoot = resolveRepoRoot(options.cwd ?? process.env.QODER_CWD ?? process.cwd());
  const maxCommits = positiveInt(options.maxCommits, DEFAULT_MAX_COMMITS);
  const windowDays = normalizeHistoryWindows(options.historyWindows);
  const allowedLanguages = new Set(normalizeLanguages(options.languages));
  const output = git(
    repoRoot,
    ["log", `-${maxCommits}`, "--numstat", "--format=commit%x1f%H%x1f%ct%x1f%s", "--"],
    { allowFailure: true, timeout: 30_000 },
  );
  const parsedCommits = parseLogWithNumstat(output);
  const filteredHistory = applyCommitIgnores(parsedCommits, options.ignore);
  const commits = filteredHistory.commits;
  const stats = collectHistoryStats(commits, allowedLanguages);
  const maxHotFiles = positiveInt(options.maxHotFiles, 40);

  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "git-history-profile",
    status: "ok",
    repoRoot,
    filters: filteredHistory.filters,
    range: {
      maxCommits,
      analyzedCommits: commits.length,
      newest: commits[0]?.shortSha ?? null,
      oldest: commits.at(-1)?.shortSha ?? null,
    },
    confidence: historyConfidence(commits, maxCommits),
    historyWindows: historyWindows(commits, allowedLanguages, windowDays),
    languageTouchCounts: sortedCounts(stats.languageStats, 12).map((item) => ({
      language: item.name,
      touches: item.count,
    })),
    hotFiles: sortedHotFiles(stats.fileStats, maxHotFiles),
    supportingHotFiles: sortedHotFiles(stats.supportingFileStats, maxHotFiles),
    hotPaths: sortedCounts(stats.pathStats, positiveInt(options.maxHotPaths, 30)).map((item) => ({
      path: item.name,
      commits: item.count,
    })),
    supportingHotPaths: sortedCounts(stats.supportingPathStats, positiveInt(options.maxHotPaths, 30)).map((item) => ({
      path: item.name,
      commits: item.count,
    })),
    coChangePaths: sortedCounts(stats.coChangePaths, 20).map((item) => ({
      paths: item.name.split(" <-> "),
      commits: item.count,
    })),
  };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const result = await analyzeGitHistoryProfile({
    cwd: option(args, "cwd"),
    languages: option(args, "languages"),
    maxCommits: positiveInt(option(args, "max-commits"), DEFAULT_MAX_COMMITS),
    maxHotFiles: positiveInt(option(args, "max-hot-files"), 40),
    maxHotPaths: positiveInt(option(args, "max-hot-paths"), 30),
    historyWindows: option(args, "history-windows", option(args, "history-window-days")),
    ignore: option(args, "ignore"),
  });
  await writeJsonResult(result, args);
}

if (isCli(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`git-history-profile failed: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
