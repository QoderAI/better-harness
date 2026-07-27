#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";

import {
  SCHEMA_VERSION,
  applyIgnorePatterns,
  fileRoleFor,
  git,
  isCli,
  isDependencyOrGenerated,
  languageFor,
  listTrackedFiles,
  option,
  parseArgs,
  parseNumstat,
  resolveRepoRoot,
  toPosix,
  unique,
  writeJsonResult,
} from "./common.mjs";

const TYPE_METADATA = {
  "public-api-docs": {
    id: "public-api-doc-sync",
    action: "Update public API documentation or state why the changed API surface is internal.",
    companionRoles: ["documentation"],
  },
  "schema-tests": {
    id: "schema-test-sync",
    action: "Add or update schema/migration tests, or document why the migration is covered elsewhere.",
    companionRoles: ["test"],
  },
  "ui-story-snapshot": {
    id: "ui-story-snapshot-sync",
    action: "Update Storybook stories, snapshots, or visual regression coverage for the changed UI component.",
    companionRoles: ["test", "fixture"],
  },
  "config-setup-docs": {
    id: "config-setup-doc-sync",
    action: "Update setup documentation or README guidance for the changed configuration.",
    companionRoles: ["documentation"],
  },
  "error-contract": {
    id: "error-contract-test-sync",
    action: "Update contract tests or API expectations for the changed error code surface.",
    companionRoles: ["test"],
  },
  "cli-help-docs": {
    id: "cli-help-doc-sync",
    action: "Update CLI help documentation, help snapshots, or command usage tests.",
    companionRoles: ["documentation", "test"],
  },
};

const API_PATH_RE = /(^|\/)(src\/api|api|public-api|packages\/[^/]+\/src\/api)(\/|$)|(^|\/)(client|sdk|public)\.(ts|tsx|js|mjs|cjs|go|java|py|php|rb|rs)$/i;
const API_ENTRY_PATH_RE = /(^|\/)(index|main|mod|lib)\.(ts|tsx|js|mjs|cjs|go|java|py|php|rb|rs)$/i;
const API_HUNK_RE = /\bexport\s+(?:async\s+)?(?:function|class|interface|type|enum|const)\b|\bpublic\s+(?:class|interface|enum|static|function)\b/i;
const STORY_PATH_RE = /(^|\/)(\.storybook|stories?)(\/|$)|\.stories\.[^.]+$/i;
const SNAPSHOT_PATH_RE = /(^|\/)__snapshots__(\/|$)|\.snap$/i;
const UI_PATH_RE = /(^|\/)(components?|ui|views?|pages?|screens?)(\/|$)|\.(tsx|jsx|vue|svelte)$/i;
const CONFIG_LOCK_RE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|go\.sum|composer\.lock|Gemfile\.lock|poetry\.lock|Cargo\.lock)$/i;
const ERROR_PATH_RE = /(^|\/)(errors?|exceptions?|contracts?\/errors?)(\/|$)|error[-_.]?(code|codes|enum|contract)|status[-_.]?code/i;
const CLI_PATH_RE = /(^|\/)(cli|cmd|commands?|bin)(\/|$)|(^|\/)(parser|args?|options?|command)\.(ts|tsx|js|mjs|cjs|go|java|py|php|rb|rs)$/i;
const CLI_HUNK_RE = /\b(commander|yargs|argparse|cobra|clap|picocli|option|argument|flag|subcommand|--[a-z0-9][a-z0-9-]*)\b/i;

function changedFiles(repoRoot, baseRef, ignorePatterns) {
  const output = git(
    repoRoot,
    ["diff", "--numstat", "--no-ext-diff", "--find-renames", baseRef, "--"],
    { allowFailure: true },
  );
  const trackedFiles = parseNumstat(output);
  const files = [...trackedFiles, ...untrackedFiles(repoRoot)]
    .filter((file) => !isDependencyOrGenerated(file.filePath));
  return applyIgnorePatterns(files, ignorePatterns, (file) => file.filePath);
}

function untrackedFiles(repoRoot) {
  const output = git(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"], { allowFailure: true });
  return output
    .split("\0")
    .filter(Boolean)
    .map((filePath) => ({
      filePath,
      added: 0,
      deleted: 0,
      language: languageFor(filePath),
      role: fileRoleFor(filePath),
      supporting: fileRoleFor(filePath) !== "source",
      untracked: true,
    }));
}

function diffText(repoRoot, baseRef, filePath) {
  if (filePath.startsWith(".") || filePath.includes("..")) {
    return "";
  }
  if (git(repoRoot, ["ls-files", "--others", "--exclude-standard", "--", filePath], { allowFailure: true }).trim()) {
    try {
      return readFileSync(path.join(repoRoot, filePath), "utf8");
    } catch {
      return "";
    }
  }
  return git(repoRoot, ["diff", "--no-ext-diff", baseRef, "--", filePath], { allowFailure: true });
}

function changedSet(files) {
  return new Set(files.map((file) => file.filePath));
}

function trackedCandidates(repoRoot, predicate, limit = 8) {
  return listTrackedFiles(repoRoot)
    .filter((filePath) => !isDependencyOrGenerated(filePath))
    .filter(predicate)
    .slice(0, limit);
}

function companionChanged(files, predicate) {
  return files.some((file) => predicate(file.filePath, file));
}

function docsCandidatePredicate(filePath) {
  const normalized = toPosix(filePath);
  return fileRoleFor(normalized) === "documentation"
    && (/^README(\.[^.]+)?$/i.test(path.posix.basename(normalized))
      || /(^|\/)(docs?|references?)(\/|$)/i.test(normalized));
}

function testCandidatePredicate(filePath) {
  return fileRoleFor(filePath) === "test";
}

function storyCandidatePredicate(filePath) {
  return STORY_PATH_RE.test(toPosix(filePath)) || SNAPSHOT_PATH_RE.test(toPosix(filePath));
}

function cliHelpCandidatePredicate(filePath) {
  const normalized = toPosix(filePath);
  return docsCandidatePredicate(normalized)
    || /(^|\/)(test|tests|__tests__)(\/|$).*help/i.test(normalized)
    || /help.*\.(test|spec)\.[^.]+$/i.test(normalized);
}

function sourceChanges(files, repoRoot, baseRef, predicate) {
  return files
    .filter((file) => file.role === "source")
    .filter((file) => predicate(file.filePath, diffText(repoRoot, baseRef, file.filePath), file));
}

function configSemanticChanges(files) {
  return files.filter((file) => file.role === "configuration" && !CONFIG_LOCK_RE.test(file.filePath));
}

function ruleFinding({ driftType, triggerFiles, candidateCompanionFiles, evidence }) {
  const metadata = TYPE_METADATA[driftType];
  return {
    id: metadata.id,
    driftType,
    severity: "medium",
    confidence: "medium",
    triggerFiles: triggerFiles.map((file) => file.filePath),
    missingCompanionRoles: metadata.companionRoles,
    candidateCompanionFiles,
    action: metadata.action,
    evidence,
  };
}

function buildFindings(repoRoot, baseRef, files) {
  const findings = [];
  const changed = changedSet(files);
  const docsChanged = companionChanged(files, (filePath) => docsCandidatePredicate(filePath));
  const testsChanged = companionChanged(files, (filePath) => testCandidatePredicate(filePath));
  const storiesChanged = companionChanged(files, (filePath) => storyCandidatePredicate(filePath));
  const cliHelpChanged = companionChanged(files, (filePath) => cliHelpCandidatePredicate(filePath));
  const contractTestsChanged = companionChanged(files, (filePath) => testCandidatePredicate(filePath) && /contract|error|api/i.test(filePath));

  const apiChanges = sourceChanges(files, repoRoot, baseRef, (filePath, text) => API_PATH_RE.test(filePath) || (API_ENTRY_PATH_RE.test(filePath) && API_HUNK_RE.test(text)));
  if (apiChanges.length > 0 && !docsChanged) {
    findings.push(ruleFinding({
      driftType: "public-api-docs",
      triggerFiles: apiChanges,
      candidateCompanionFiles: trackedCandidates(repoRoot, docsCandidatePredicate),
      evidence: "Changed public API-like source without changed documentation files.",
    }));
  }

  const schemaChanges = files.filter((file) => file.role === "migration" || /(^|\/)(schemas?|db\/schema|database\/schema)(\/|$)|schema\.(sql|json|ya?ml|ts|js)$/i.test(file.filePath));
  if (schemaChanges.length > 0 && !testsChanged) {
    findings.push(ruleFinding({
      driftType: "schema-tests",
      triggerFiles: schemaChanges,
      candidateCompanionFiles: trackedCandidates(repoRoot, testCandidatePredicate),
      evidence: "Changed schema or migration files without changed test files.",
    }));
  }

  const uiChanges = sourceChanges(files, repoRoot, baseRef, (filePath) => UI_PATH_RE.test(filePath) && !STORY_PATH_RE.test(filePath));
  if (uiChanges.length > 0 && !storiesChanged) {
    findings.push(ruleFinding({
      driftType: "ui-story-snapshot",
      triggerFiles: uiChanges,
      candidateCompanionFiles: trackedCandidates(repoRoot, storyCandidatePredicate),
      evidence: "Changed UI source without changed stories or snapshots.",
    }));
  }

  const configChanges = configSemanticChanges(files);
  if (configChanges.length > 0 && !docsChanged) {
    findings.push(ruleFinding({
      driftType: "config-setup-docs",
      triggerFiles: configChanges,
      candidateCompanionFiles: trackedCandidates(repoRoot, docsCandidatePredicate),
      evidence: "Changed setup or configuration files without changed README/docs files.",
    }));
  }

  const errorChanges = sourceChanges(files, repoRoot, baseRef, (filePath) => ERROR_PATH_RE.test(filePath));
  if (errorChanges.length > 0 && !contractTestsChanged) {
    findings.push(ruleFinding({
      driftType: "error-contract",
      triggerFiles: errorChanges,
      candidateCompanionFiles: trackedCandidates(repoRoot, (filePath) => testCandidatePredicate(filePath) && /contract|error|api/i.test(filePath)),
      evidence: "Changed error-code-like source without changed contract/error test files.",
    }));
  }

  const cliChanges = sourceChanges(files, repoRoot, baseRef, (filePath, text) => CLI_PATH_RE.test(filePath) || CLI_HUNK_RE.test(text));
  if (cliChanges.length > 0 && !cliHelpChanged) {
    findings.push(ruleFinding({
      driftType: "cli-help-docs",
      triggerFiles: cliChanges,
      candidateCompanionFiles: trackedCandidates(repoRoot, cliHelpCandidatePredicate),
      evidence: "Changed CLI parser or command-like source without changed help docs or help tests.",
    }));
  }

  return findings.map((finding) => ({
    ...finding,
    candidateCompanionFiles: unique(finding.candidateCompanionFiles.filter((filePath) => !changed.has(filePath))).slice(0, 8),
  }));
}

export async function analyzeChangeDrift(options = {}) {
  const repoRoot = resolveRepoRoot(options.cwd ?? process.env.QODER_CWD ?? process.cwd());
  const baseRef = options.baseRef ?? "HEAD";
  const diffFiles = options.changedFiles
    ? applyIgnorePatterns(options.changedFiles, options.ignore, (file) => file.filePath ?? file.path)
    : changedFiles(repoRoot, baseRef, options.ignore);
  const files = diffFiles.items.map((file) => ({
    ...file,
    filePath: toPosix(file.filePath ?? file.path),
    language: file.language ?? languageFor(file.filePath ?? file.path),
    role: file.role ?? fileRoleFor(file.filePath ?? file.path),
    supporting: file.supporting ?? fileRoleFor(file.filePath ?? file.path) !== "source",
  }));
  const findings = buildFindings(repoRoot, baseRef, files);
  const typeCounts = {};
  for (const finding of findings) {
    typeCounts[finding.driftType] = (typeCounts[finding.driftType] ?? 0) + 1;
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "change-drift",
    status: findings.length > 0 ? "advisory" : "ok",
    repoRoot,
    baseRef,
    filters: diffFiles.filters,
    summary: {
      findingCount: findings.length,
      highConfidenceCount: findings.filter((finding) => finding.confidence === "high").length,
      typeCounts,
      changedFiles: files.length,
    },
    changedFiles: files.map((file) => ({
      path: file.filePath,
      role: file.role,
      language: file.language,
      added: file.added,
      deleted: file.deleted,
      untracked: Boolean(file.untracked),
    })),
    findings,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const result = await analyzeChangeDrift({
    cwd: option(args, "cwd"),
    baseRef: option(args, "base-ref", option(args, "base", "HEAD")),
    ignore: option(args, "ignore"),
  });
  await writeJsonResult(result, args);
}

if (isCli(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`change-drift failed: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
