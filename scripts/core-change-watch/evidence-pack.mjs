#!/usr/bin/env node

import {
  DEFAULT_MAX_COMMITS,
  SCHEMA_VERSION,
  applyIgnorePatterns,
  fileRoleFor,
  isCli,
  isSupportingFile,
  languageFor,
  normalizeHistoryWindows,
  normalizeLanguages,
  option,
  parseArgs,
  positiveInt,
  resolveRepoRoot,
  writeJsonResult,
} from "./common.mjs";
import { analyzeChangeDrift } from "./change-drift.mjs";
import { analyzeCoreCandidates } from "./core-candidates.mjs";
import { analyzeDiffImpact } from "./diff-impact.mjs";
import { analyzeGitHistoryProfile } from "./git-history-profile.mjs";
import { analyzeProjectProfile } from "./project-profile.mjs";

function addRead(reads, path, reason, priority = 50) {
  if (!path) {
    return;
  }
  const role = fileRoleFor(path);
  const supporting = isSupportingFile(path);
  const existing = reads.get(path);
  if (existing) {
    existing.priority = Math.max(existing.priority, priority);
    existing.reasons = [...new Set([...existing.reasons, reason])];
    return;
  }
  reads.set(path, {
    path,
    language: languageFor(path),
    role,
    supporting,
    priority,
    reasons: [reason],
  });
}

function recommendedReads(core, diff, profile, maxReads) {
  const reads = new Map();

  for (const file of diff.changedFiles) {
    addRead(reads, file.path, "changed file", 100);
  }

  for (const hit of diff.coreHits) {
    addRead(reads, hit.filePath, `changed core candidate ${hit.path}`, 95);
  }

  for (const hit of diff.hotHits) {
    addRead(reads, hit.path, "changed hot file", 90);
  }

  for (const candidate of core.candidates.slice(0, 8)) {
    for (const file of candidate.evidence.hotFiles.slice(0, 3)) {
      addRead(reads, file.path, `hot file under ${candidate.path}`, 75);
    }
    for (const file of candidate.evidence.sourceFiles.slice(0, 2)) {
      addRead(reads, file, `representative source under ${candidate.path}`, 55);
    }
  }

  for (const entry of profile.entryCandidates.slice(0, 5)) {
    addRead(reads, entry.path, "entry candidate", 45);
  }

  return [...reads.values()]
    .sort((a, b) => b.priority - a.priority || a.path.localeCompare(b.path))
    .slice(0, maxReads);
}

function actionFiles(files, limit = 8) {
  const seen = new Set();
  const result = [];
  for (const file of files) {
    const path = typeof file === "string" ? file : file?.path;
    if (!path || seen.has(path)) {
      continue;
    }
    seen.add(path);
    result.push({
      path,
      role: fileRoleFor(path),
      language: languageFor(path),
    });
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}

function supportingFilesByRole(history, diff, role) {
  const fromDiff = diff.companionHits?.filter((item) => item.role === role) ?? [];
  const fromHistory = history.supportingHotFiles?.filter((item) => item.role === role) ?? [];
  return actionFiles([...fromDiff, ...fromHistory], 8);
}

function buildFollowUpActions(core, diff, history, changeDrift, maxActions) {
  const actions = [];
  const topCoreFiles = actionFiles(core.candidates.slice(0, 4).flatMap((candidate) => [
    ...candidate.evidence.hotFiles,
    ...candidate.evidence.sourceFiles,
  ]), 10);
  const changedPrimaryFiles = actionFiles(
    diff.changedFiles.filter((file) => !file.supporting),
    10,
  );
  const affectedCoreFiles = actionFiles(diff.coreHits.map((hit) => hit.filePath), 10);
  const localizationFiles = supportingFilesByRole(history, diff, "localization");
  const documentationFiles = supportingFilesByRole(history, diff, "documentation");
  const testFiles = actionFiles([
    ...(history.supportingHotFiles?.filter((item) => item.role === "test" || item.role === "fixture") ?? []),
    ...diff.changedFiles.filter((item) => item.role === "test" || item.role === "fixture"),
  ], 8);

  if (topCoreFiles.length > 0) {
    actions.push({
      id: "inspect-primary-core",
      type: "inspection",
      priority: "high",
      title: "Inspect primary core implementation before editing",
      reason: "Core candidates combine path, density, and git-history signals.",
      files: topCoreFiles,
      passCheck: "The agent can name the target implementation files and likely callers before making changes.",
    });
  }

  if (changedPrimaryFiles.length > 0 || topCoreFiles.length > 0) {
    actions.push({
      id: "apply-targeted-implementation",
      type: "implementation",
      priority: "high",
      title: "Make the requested behavior change in primary source first",
      reason: "Supporting files should follow source behavior, not substitute for the implementation change.",
      files: changedPrimaryFiles.length > 0 ? changedPrimaryFiles : topCoreFiles.slice(0, 6),
      passCheck: "The requested behavior is implemented in source code and not only reflected in docs, locale, or fixture files.",
    });
  }

  if (affectedCoreFiles.length > 0) {
    actions.push({
      id: "review-core-diagnostic-coverage",
      type: "inspection",
      priority: "high",
      title: "Review diagnostic coverage across the affected core chain",
      reason: "A core change can be difficult to localize and re-check when its trigger, boundary decisions, failure or recovery, and result are not joined by readable logs and a stable correlation identity.",
      files: affectedCoreFiles,
      passCheck: "Inspect the smallest affected chain from trigger through boundary or decision to failure, recovery, and result; confirm readable correlated evidence, or keep the concrete missing segment and its impact as a reader-facing finding.",
    });
  }

  if (localizationFiles.length > 0) {
    actions.push({
      id: "sync-localization",
      type: "companion-sync",
      priority: "medium",
      title: "Sync localization files when user-facing text changes",
      reason: "Localization files are supporting hotspots and often need companion edits after UI or message changes.",
      files: localizationFiles,
      passCheck: "Changed or introduced user-facing strings have matching locale updates, or the agent states why none are needed.",
    });
  }

  if (documentationFiles.length > 0) {
    actions.push({
      id: "sync-documentation",
      type: "companion-sync",
      priority: "medium",
      title: "Sync documentation when behavior or workflow changes",
      reason: "Documentation hotspots are useful follow-up checks but should not be mistaken for core implementation.",
      files: documentationFiles,
      passCheck: "Docs that describe the changed behavior are updated, or the agent states why docs are unaffected.",
    });
  }

  for (const finding of changeDrift.findings ?? []) {
    actions.push({
      id: `sync-change-drift-${finding.id}`,
      type: "companion-sync",
      priority: finding.severity === "high" ? "high" : "medium",
      title: companionActionTitle(finding),
      reason: finding.evidence,
      files: actionFiles([...finding.triggerFiles, ...finding.candidateCompanionFiles], 8),
      passCheck: finding.action,
    });
  }

  if (testFiles.length > 0 || diff.reviewRecommended || topCoreFiles.length > 0) {
    actions.push({
      id: "validate-impact",
      type: "validation",
      priority: diff.reviewRecommended ? "high" : "medium",
      title: "Run focused validation for changed core or hotspot areas",
      reason: diff.reviewRecommended
        ? "Diff impact requires attention because the change touches configured or detected core code."
        : testFiles.length > 0
          ? "Detected tests or fixtures can anchor validation."
          : "Core candidates need focused validation after implementation changes.",
      files: testFiles,
      passCheck: "Relevant focused tests, build, lint, smoke, or caller/API checks pass or failures are reported with exact output.",
    });
  }

  return actions.slice(0, maxActions);
}

function stageFilters(projectProfile, historyProfile, coreAnalysis, diffImpact) {
  return {
    projectProfile: projectProfile.filters,
    historyProfile: historyProfile.filters,
    coreAnalysis: coreAnalysis.filters,
    diffImpact: diffImpact.filters,
  };
}

function parentPattern(filePath) {
  const parts = String(filePath).split("/");
  if (parts.length <= 1) {
    return filePath;
  }
  return `${parts.slice(0, -1).join("/")}/**`;
}

function suggestedIgnorePatterns(history) {
  const patterns = [];
  for (const file of history.supportingHotFiles?.slice(0, 12) ?? []) {
    if (file.role === "localization" || file.role === "documentation" || file.role === "fixture") {
      patterns.push(parentPattern(file.path));
    } else if (file.role === "configuration" || file.role === "migration") {
      patterns.push(file.path);
    }
  }
  return [...new Set(patterns)].slice(0, 6);
}

function buildAgentGuidance(history, core, filters) {
  const patterns = suggestedIgnorePatterns(history);
  const supportingDominates = (history.supportingHotFiles?.length ?? 0) > 0
    && (history.hotFiles?.length ?? 0) < (history.supportingHotFiles?.length ?? 0);
  return {
    stance: "Use the pack as an evidence starting point, then inspect source files and rerun narrower analysis when project-specific noise is visible.",
    optionalReruns: patterns.length > 0
      ? [{
          id: "rerun-with-explicit-ignore",
          reason: supportingDominates
            ? "Supporting hotspots dominate the raw history; rerun with explicit ignores before writing a core-boundary report if they are not relevant to the task."
            : "Supporting hotspots are visible; rerun with explicit ignores if they distract from the requested implementation change.",
          commandArgs: ["--ignore", patterns.join(",")],
          patterns,
        }]
      : [],
    reportFiltering: [
      "Keep primary source candidates and supporting files in separate sections.",
      "When a locale, docs, fixture, config, or migration file matters, explain it as companion sync or evidence, not as the primary implementation.",
      "For an affected core chain, review diagnostic coverage through the shared observability rubric. If inspected evidence confirms that a named segment lacks readable logs or correlation, keep the gap and its causal impact as a reader-facing finding; do not infer the gap from logger-call counts or a runtime-only access failure.",
      "If explicit ignores are used, mention the patterns and do not hide changed files that are directly relevant to the user's request.",
    ],
    currentFilters: filters,
    coreCandidateCount: core.candidates.length,
  };
}

function buildEvidenceSources({ baseRef, maxCommits, historyWindows, noHistory }) {
  return {
    boundary: "static-local-git-and-file-analysis",
    numericSources: [
      {
        claim: "tracked file, language, manifest, source-root, entrypoint, and framework counts",
        source: "projectProfile",
        command: "git ls-files -z plus local manifest/path inspection",
      },
      {
        claim: "hot files, hot paths, co-change paths, and history windows",
        source: "historyProfile",
        command: noHistory ? "UNVERIFIED: history scan skipped by --no-history" : `git log -${maxCommits} --numstat --format=commit... --`,
      },
      {
        claim: "changed files, line counts, inferred core candidate hits, hot hits, and companion hits",
        source: "diffImpact",
        command: `git diff --numstat --no-ext-diff --find-renames ${baseRef} --`,
      },
      {
        claim: "changed API, schema, UI, config, error, and CLI surfaces with missing companion evidence",
        source: "changeDrift",
        command: `git diff --numstat --no-ext-diff --find-renames ${baseRef} -- plus git ls-files -z`,
      },
      {
        claim: "history day windows",
        source: "summary.historyWindows",
        command: `bounded history windows: ${historyWindows.join(",")}`,
      },
    ],
    unverifiedClaims: [
      { claim: "tests passed", status: "UNVERIFIED", reason: "core-change-watch does not run target project tests" },
      { claim: "CI status", status: "UNVERIFIED", reason: "core-change-watch does not open external CI systems" },
      { claim: "runtime behavior", status: "UNVERIFIED", reason: "core-change-watch does not execute the target application" },
    ],
  };
}

function summarizeProjectInfo(projectProfile) {
  return {
    name: projectProfile.projectInfo.name,
    description: projectProfile.projectInfo.description,
    readmeTitle: projectProfile.projectInfo.readmeTitle,
    identityEvidence: projectProfile.projectInfo.evidence,
    primaryLanguages: projectProfile.projectInfo.primaryLanguages,
    frameworks: projectProfile.projectInfo.frameworks,
    sourceFiles: projectProfile.projectInfo.sourceFiles,
    testFiles: projectProfile.projectInfo.testFiles,
    measuredSourceLines: projectProfile.projectInfo.measuredSourceLines,
    sourceLineStatus: projectProfile.projectInfo.sourceLineStatus,
    sourceLineMethod: projectProfile.projectInfo.sourceLineMethod,
    sourceRoots: projectProfile.projectInfo.sourceRoots,
    entryCandidates: projectProfile.projectInfo.entryCandidates,
  };
}

function summarizeAgentInstructions(projectProfile) {
  const instructions = projectProfile.agentInstructions;
  return {
    status: instructions.status,
    count: instructions.count,
    rootCount: instructions.rootCount,
    nestedCount: instructions.nestedCount,
    suggestedMinimum: instructions.suggestedMinimum,
    suggestedAdditional: instructions.suggestedAdditional,
    sourceFilesPerInstruction: instructions.sourceFilesPerInstruction,
    sourceFilesUnderNestedInstructions: instructions.sourceFilesUnderNestedInstructions,
    nestedSourceFileCoveragePercent: instructions.nestedSourceFileCoveragePercent,
    suggestedScopes: instructions.suggestedScopes,
    reasons: instructions.reasons,
  };
}

function matrixItem(id, title, status, evidence, note) {
  return { id, title, status, evidence, note };
}

function companionActionTitle(finding) {
  return {
    "public-api-docs": "Sync public API documentation",
    "schema-tests": "Add schema or migration test evidence",
    "ui-story-snapshot": "Update UI story or snapshot coverage",
    "config-setup-docs": "Sync setup documentation",
    "error-contract": "Update error contract tests",
    "cli-help-docs": "Sync CLI help documentation",
  }[finding.driftType] ?? "Sync companion evidence";
}

function buildReviewMatrix(projectProfile, historyProfile, coreAnalysis, diffImpact, changeDrift, followUpActions) {
  return [
    matrixItem(
      "core-supporting-separation",
      "Core candidates and supporting hotspots are separated",
      historyProfile.hotFiles.every((item) => item.role === "source") ? "ready" : "review",
      { primaryHotFiles: historyProfile.hotFiles.length, supportingHotFiles: historyProfile.supportingHotFiles.length },
      "Primary hot file lists should not be led by locale, docs, tests, fixtures, config, or migrations.",
    ),
    matrixItem(
      "follow-up-edit-readiness",
      "Analysis can drive implementation work",
      followUpActions.some((item) => item.type === "implementation") ? "ready" : "manual",
      { actionIds: followUpActions.map((item) => item.id) },
      "For change/fix/optimize requests, convert follow-up actions into edits before final validation.",
    ),
    matrixItem(
      "history-window-coverage",
      "History uses 30/90/180 style windows with confidence notes",
      historyProfile.historyWindows.length >= 3 && historyProfile.confidence ? "ready" : "review",
      { windows: historyProfile.historyWindows.map((item) => item.days), confidence: historyProfile.confidence?.confidence ?? "unknown" },
      "Low history confidence should downgrade hotspot certainty, not block source inspection.",
    ),
    matrixItem(
      "large-repo-safety",
      "Large git output has explicit bounded handling",
      projectProfile.totals.trackedFiles > 0 || projectProfile.totals.trackedFilesBeforeFilters > 0 ? "ready" : "review",
      { trackedFiles: projectProfile.totals.trackedFiles, trackedFilesBeforeFilters: projectProfile.totals.trackedFilesBeforeFilters },
      "A non-empty tracked-file profile is the first regression guard for large repositories.",
    ),
    matrixItem(
      "language-framework-coverage",
      "Language and framework signals are visible",
      projectProfile.languages.length > 0 ? "ready" : "manual",
      { languages: projectProfile.languages.map((item) => item.language), frameworks: projectProfile.frameworks.map((item) => item.name) },
      "Framework signals guide inspection; they do not replace reading implementation files.",
    ),
    matrixItem(
      "static-evidence-boundary",
      "Runtime, CI, and test claims stay unverified until separately checked",
      "ready",
      { boundary: "static-local-git-and-file-analysis", unverified: ["tests passed", "CI status", "runtime behavior"] },
      "Reports should cite commands for local counts and mark non-executed claims as UNVERIFIED.",
    ),
    matrixItem(
      "core-diagnostic-coverage",
      "Affected core chains receive a diagnostic-coverage review",
      diffImpact.coreHits.length > 0
        ? followUpActions.some((item) => item.id === "review-core-diagnostic-coverage") ? "review" : "manual"
        : "not-applicable",
      {
        affectedCoreFiles: diffImpact.coreHits.map((item) => item.filePath),
        actionId: "review-core-diagnostic-coverage",
      },
      "The static pack requests a semantic review; source, executable-route, or captured-output evidence must confirm any missing-log finding.",
    ),
    matrixItem(
      "change-drift-companion-coverage",
      "Changed surfaces have companion evidence checks",
      changeDrift.summary.findingCount > 0 ? "review" : "ready",
      {
        findingCount: changeDrift.summary.findingCount,
        types: Object.keys(changeDrift.summary.typeCounts ?? {}),
      },
      "Companion drift findings are advisory; update the companion file or document why it is not needed.",
    ),
    matrixItem(
      "agent-report-flexibility",
      "Agents can rerun or filter instead of accepting noisy defaults",
      "ready",
      {
        filtersApplied: Object.values(stageFilters(projectProfile, historyProfile, coreAnalysis, diffImpact))
          .some((filter) => (filter?.ignorePatterns?.length ?? 0) > 0),
        optionalSupportingPatterns: suggestedIgnorePatterns(historyProfile),
      },
      "Optional filters are analysis aids; they should be disclosed when used.",
    ),
  ];
}

export async function buildEvidencePack(options = {}) {
  const repoRoot = resolveRepoRoot(options.cwd ?? process.env.QODER_CWD ?? process.cwd());
  const languages = normalizeLanguages(options.languages);
  const maxCommits = positiveInt(options.maxCommits, DEFAULT_MAX_COMMITS);
  const maxCandidates = positiveInt(options.maxCandidates, 30);
  const maxRecommendedReads = positiveInt(options.maxRecommendedReads, 20);
  const maxFollowUpActions = positiveInt(options.maxFollowUpActions, 8);
  const historyWindows = normalizeHistoryWindows(options.historyWindows);
  const projectProfile = await analyzeProjectProfile({
    cwd: repoRoot,
    languages,
    ignore: options.ignore,
    measureSourceLines: Boolean(options.measureSourceLines),
  });
  const historyProfile = options.noHistory
    ? {
        schemaVersion: SCHEMA_VERSION,
        kind: "git-history-profile",
        status: "skipped",
        repoRoot,
        filters: applyIgnorePatterns([], options.ignore).filters,
        hotFiles: [],
        supportingHotFiles: [],
        hotPaths: [],
        supportingHotPaths: [],
        coChangePaths: [],
        languageTouchCounts: [],
        confidence: { confidence: "low", reasons: ["history scan skipped by --no-history"] },
        historyWindows: historyWindows.map((days) => ({
          days,
          since: null,
          analyzedCommits: 0,
          trendLabel: days <= 30 ? "recent-hotspots" : days <= 90 ? "sustained-hotspots" : "legacy-or-long-range-hotspots",
          interpretation: "History scan skipped; this window is present for schema stability only.",
          hotFiles: [],
          supportingHotFiles: [],
          hotPaths: [],
        })),
        range: { maxCommits: 0, analyzedCommits: 0, newest: null, oldest: null },
      }
    : await analyzeGitHistoryProfile({ cwd: repoRoot, languages, maxCommits, historyWindows, ignore: options.ignore });
  const coreAnalysis = await analyzeCoreCandidates({
    cwd: repoRoot,
    languages,
    maxCommits,
    maxCandidates,
    profile: projectProfile,
    history: historyProfile,
    ignore: options.ignore,
  });
  const diffImpact = await analyzeDiffImpact({
    cwd: repoRoot,
    languages,
    baseRef: options.baseRef ?? "HEAD",
    maxCommits,
    profile: projectProfile,
    history: historyProfile,
    core: coreAnalysis,
    ignore: options.ignore,
  });
  const changeDrift = await analyzeChangeDrift({
    cwd: repoRoot,
    baseRef: options.baseRef ?? "HEAD",
    ignore: options.ignore,
    changedFiles: diffImpact.changedFiles,
  });
  const followUpActions = buildFollowUpActions(coreAnalysis, diffImpact, historyProfile, changeDrift, maxFollowUpActions);
  const filters = stageFilters(projectProfile, historyProfile, coreAnalysis, diffImpact);
  const pack = {
    schemaVersion: SCHEMA_VERSION,
    kind: "core-change-watch-evidence-pack",
    status: "ok",
    repoRoot,
    generatedAt: new Date().toISOString(),
    summary: {
      reviewRecommended: diffImpact.reviewRecommended,
      attentionRequired: diffImpact.attentionRequired,
      diffStatus: diffImpact.status,
      diffSeverity: diffImpact.severity,
      diffScore: diffImpact.score,
      topLanguages: projectProfile.languages.slice(0, 5).map((item) => item.language),
      projectInfo: summarizeProjectInfo(projectProfile),
      agentInstructions: summarizeAgentInstructions(projectProfile),
      coreCandidates: coreAnalysis.summary,
      changedFiles: diffImpact.metrics.changedFiles,
      changedLines: diffImpact.metrics.changedLines,
      companionHits: diffImpact.metrics.companionHits,
      changeDrift: {
        status: changeDrift.status,
        findingCount: changeDrift.summary.findingCount,
        typeCounts: changeDrift.summary.typeCounts,
      },
      historyWindows: historyProfile.historyWindows.map((item) => item.days),
      historyConfidence: historyProfile.confidence,
      frameworks: projectProfile.frameworks.slice(0, 5).map((item) => item.name),
      filtersApplied: Object.values(filters).some((filter) => (filter?.ignorePatterns?.length ?? 0) > 0),
    },
    filters,
    evidenceSources: buildEvidenceSources({
      baseRef: options.baseRef ?? "HEAD",
      maxCommits,
      historyWindows: historyProfile.historyWindows.map((item) => item.days),
      noHistory: Boolean(options.noHistory),
    }),
    projectProfile,
    historyProfile,
    coreAnalysis,
    diffImpact,
    changeDrift,
    recommendedReads: recommendedReads(coreAnalysis, diffImpact, projectProfile, maxRecommendedReads),
    followUpActions,
    agentGuidance: buildAgentGuidance(historyProfile, coreAnalysis, filters),
    reviewMatrix: buildReviewMatrix(projectProfile, historyProfile, coreAnalysis, diffImpact, changeDrift, followUpActions),
  };
  return pack;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const result = await buildEvidencePack({
    cwd: option(args, "cwd"),
    languages: option(args, "languages"),
    baseRef: option(args, "base-ref", option(args, "base", "HEAD")),
    maxCommits: positiveInt(option(args, "max-commits"), DEFAULT_MAX_COMMITS),
    maxCandidates: positiveInt(option(args, "max-candidates"), 30),
    maxRecommendedReads: positiveInt(option(args, "max-recommended-reads"), 20),
    maxFollowUpActions: positiveInt(option(args, "max-follow-up-actions"), 8),
    historyWindows: option(args, "history-windows", option(args, "history-window-days")),
    ignore: option(args, "ignore"),
    noHistory: Boolean(args["no-history"]),
    measureSourceLines: Boolean(args["measure-source-lines"]),
  });
  await writeJsonResult(result, args);
}

if (isCli(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`evidence-pack failed: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
