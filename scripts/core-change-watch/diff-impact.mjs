#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";

import {
  DEFAULT_MAX_COMMITS,
  SCHEMA_VERSION,
  applyIgnorePatterns,
  analysisDirectoryFor,
  git,
  isCli,
  isDependencyOrGenerated,
  isSupportingFile,
  fileRoleFor,
  languageFor,
  normalizeLanguages,
  option,
  parseArgs,
  parseNumstat,
  positiveInt,
  resolveRepoRoot,
  writeJsonResult,
} from "./common.mjs";
import { analyzeCoreCandidates } from "./core-candidates.mjs";
import { analyzeGitHistoryProfile } from "./git-history-profile.mjs";
import { analyzeProjectProfile } from "./project-profile.mjs";

function severityFor(score) {
  if (score >= 85) {
    return "critical";
  }
  if (score >= 65) {
    return "high";
  }
  if (score >= 35) {
    return "medium";
  }
  return "low";
}

function changedFiles(repoRoot, baseRef, ignorePatterns) {
  const output = git(
    repoRoot,
    ["diff", "--numstat", "--no-ext-diff", "--find-renames", baseRef, "--"],
    { allowFailure: true },
  );
  const trackedFiles = parseNumstat(output);
  const files = [...trackedFiles, ...untrackedFiles(repoRoot)].filter((file) => !isDependencyOrGenerated(file.filePath));
  return applyIgnorePatterns(files, ignorePatterns, (file) => file.filePath);
}

function textLineCount(repoRoot, filePath) {
  try {
    const text = readFileSync(path.join(repoRoot, filePath), "utf8");
    return text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length;
  } catch {
    return 0;
  }
}

function untrackedFiles(repoRoot) {
  const output = git(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"], { allowFailure: true });
  return output
    .split("\0")
    .filter(Boolean)
    .map((filePath) => ({
      filePath,
      added: textLineCount(repoRoot, filePath),
      deleted: 0,
      language: languageFor(filePath),
      role: fileRoleFor(filePath),
      supporting: isSupportingFile(filePath),
      untracked: true,
    }));
}

function hitForChangedFile(file, core) {
  const directory = analysisDirectoryFor(file.filePath);
  return core.candidates.find((candidate) => file.filePath === candidate.path || file.filePath.startsWith(`${candidate.path}/`) || directory === candidate.path);
}

function coreHitForChangedFile(file, core) {
  const candidate = hitForChangedFile(file, core);
  return candidate
    ? {
        path: candidate.path,
        source: "candidate",
        confidence: candidate.confidence,
        score: candidate.score,
      }
    : null;
}

export async function analyzeDiffImpact(options = {}) {
  const repoRoot = resolveRepoRoot(options.cwd ?? process.env.QODER_CWD ?? process.cwd());
  const baseRef = options.baseRef ?? "HEAD";
  const allowedLanguages = new Set(normalizeLanguages(options.languages));
  const profile = options.profile ?? await analyzeProjectProfile({ cwd: repoRoot, languages: [...allowedLanguages], ignore: options.ignore });
  const history = options.history ?? await analyzeGitHistoryProfile({
    cwd: repoRoot,
    languages: [...allowedLanguages],
    maxCommits: positiveInt(options.maxCommits, DEFAULT_MAX_COMMITS),
    ignore: options.ignore,
  });
  const core = options.core ?? await analyzeCoreCandidates({
    cwd: repoRoot,
    languages: [...allowedLanguages],
    maxCommits: positiveInt(options.maxCommits, DEFAULT_MAX_COMMITS),
    profile,
    history,
    ignore: options.ignore,
  });
  const diffFiles = changedFiles(repoRoot, baseRef, options.ignore);
  const files = diffFiles.items.filter((file) => file.role !== "source" || allowedLanguages.has(file.language));
  const coreHits = [];
  const hotHits = [];
  const companionHits = [];
  const reasons = [];
  let score = 0;

  for (const file of files) {
    const lines = file.added + file.deleted;
    score += Math.min(20, Math.ceil(lines / 25));

    if (isSupportingFile(file.filePath)) {
      const supportingHotFile = history.supportingHotFiles?.find((item) => item.path === file.filePath);
      if (supportingHotFile) {
        companionHits.push({
          path: supportingHotFile.path,
          role: supportingHotFile.role,
          commits: supportingHotFile.commits,
          churn: supportingHotFile.churn,
        });
        score += Math.min(10, supportingHotFile.commits);
        reasons.push(`changed supporting hot file ${supportingHotFile.path}`);
      }
      continue;
    }

    const coreHit = coreHitForChangedFile(file, core);
    if (coreHit) {
      const hit = {
        path: coreHit.path,
        filePath: file.filePath,
        source: coreHit.source,
        confidence: coreHit.confidence,
        score: coreHit.score,
      };
      coreHits.push(hit);
      score += coreHit.confidence === "high" ? 45 : 28;
      reasons.push(`changed core candidate ${coreHit.path}`);
    }

    const hotFile = history.hotFiles.find((item) => item.path === file.filePath);
    if (hotFile) {
      hotHits.push({
        path: hotFile.path,
        commits: hotFile.commits,
        churn: hotFile.churn,
      });
      score += Math.min(22, hotFile.commits * 3);
      reasons.push(`changed hot file ${hotFile.path}`);
    }
  }

  if (files.length >= 10) {
    score += 20;
    reasons.push(`wide file change count ${files.length}`);
  } else if (files.length >= 4) {
    score += 10;
    reasons.push(`multi-file change count ${files.length}`);
  }

  const changedLines = files.reduce((sum, file) => sum + file.added + file.deleted, 0);
  if (changedLines >= 500) {
    score += 25;
    reasons.push(`large changed-line count ${changedLines}`);
  } else if (changedLines >= 120) {
    score += 12;
    reasons.push(`moderate changed-line count ${changedLines}`);
  }

  const normalizedScore = Math.min(100, Math.round(score));
  const attentionRequired = coreHits.some((item) => item.confidence !== "low");

  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "diff-impact",
    status: attentionRequired ? "attention-required" : "ok",
    repoRoot,
    baseRef,
    filters: diffFiles.filters,
    score: normalizedScore,
    severity: severityFor(normalizedScore),
    reviewRecommended: attentionRequired,
    attentionRequired,
    reasons: [...new Set(reasons)].slice(0, 12),
    changedFiles: files.map((file) => ({
      path: file.filePath,
      added: file.added,
      deleted: file.deleted,
      language: languageFor(file.filePath),
      role: file.role,
      supporting: file.supporting,
      untracked: Boolean(file.untracked),
    })),
    coreHits,
    hotHits,
    companionHits,
    metrics: {
      changedFiles: files.length,
      changedLines,
      coreHits: coreHits.length,
      hotHits: hotHits.length,
      companionHits: companionHits.length,
    },
  };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const result = await analyzeDiffImpact({
    cwd: option(args, "cwd"),
    languages: option(args, "languages"),
    baseRef: option(args, "base-ref", option(args, "base", "HEAD")),
    maxCommits: positiveInt(option(args, "max-commits"), DEFAULT_MAX_COMMITS),
    ignore: option(args, "ignore"),
  });
  await writeJsonResult(result, args);
}

if (isCli(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`diff-impact failed: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
