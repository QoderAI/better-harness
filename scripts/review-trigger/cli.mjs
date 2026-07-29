#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { enrichFindingWithRecommendation } from "../findings-recommend.mjs";

const TEST_PATH_RE = /(^|\/)(__tests__|tests?|specs?)(\/|$)|[._-](test|spec)\.[^.]+$/i;

const SEVERITY_ORDER = {
  advisory: 1,
  warning: 2,
  error: 3,
};

class ReviewTriggerCliError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReviewTriggerCliError";
    this.code = code;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function compactText(value, limit = 240) {
  const text = String(value ?? "").replace(/\s+/gu, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactSuggestion(value, fallbackEn, limit = 180) {
  const source = isPlainObject(value) ? value : {};
  const en = compactText(source.en ?? source["en-US"] ?? fallbackEn, limit);
  const zh = compactText(source.zh ?? source["zh-CN"], limit);
  if (!en && !zh) {
    return undefined;
  }
  return {
    ...(en ? { en } : {}),
    ...(zh ? { zh, "zh-CN": zh } : {}),
  };
}

function severityRank(severity) {
  return SEVERITY_ORDER[severity] ?? 0;
}

function sortFindings(findings) {
  return [...findings].sort((left, right) => {
    const severityDelta = severityRank(right.severity) - severityRank(left.severity);
    if (severityDelta !== 0) {
      return severityDelta;
    }
    return left.id.localeCompare(right.id);
  });
}

function withFingerprint(finding) {
  const fingerprint = sha256([
    finding.id,
    finding.source,
    finding.file ?? "",
    finding.line ?? "",
    finding.evidence,
  ].join("\0")).slice(0, 24);
  return { ...finding, fingerprint };
}

function summarizeFindings(findings) {
  const summary = {
    findings: findings.length,
    errors: 0,
    warnings: 0,
    advisories: 0,
    maxSeverity: findings.length === 0 ? "none" : "advisory",
  };
  for (const finding of findings) {
    if (finding.severity === "error") {
      summary.errors += 1;
    } else if (finding.severity === "warning") {
      summary.warnings += 1;
    } else {
      summary.advisories += 1;
    }
    if (severityRank(finding.severity) > severityRank(summary.maxSeverity)) {
      summary.maxSeverity = finding.severity;
    }
  }
  return summary;
}

export function normalizeAgentInstructionFindings(agentLintPayload) {
  return (agentLintPayload.findings ?? []).map((finding) => {
    const normalized = enrichFindingWithRecommendation({
      id: `agent-instructions.${finding.id}`,
      category: "agent-instructions",
      severity: finding.severity ?? "warning",
      source: "agent-lint:agents-md-review",
      file: finding.file,
      line: finding.line,
      evidence: compactText(finding.evidence),
      nextStep: compactText(finding.remediation),
    }, [
      `agent-lint.agents-md-review.${finding.id}`,
      `agent-instructions.${finding.id}`,
      finding.id,
    ]);
    const suggestion = compactSuggestion(finding.suggestion ?? normalized.suggestion, normalized.nextStep);
    return withFingerprint({
      ...normalized,
      ...(suggestion ? { suggestion } : {}),
    });
  });
}

function thresholdLevel(value, threshold) {
  if (value >= threshold.critical) {
    return "critical";
  }
  if (value >= threshold.high) {
    return "high";
  }
  if (value >= threshold.warn) {
    return "medium";
  }
  return "low";
}

function strongestChangeLevel(metrics, thresholds) {
  const levels = [
    thresholdLevel(metrics.changedFiles, thresholds.changedFiles),
    thresholdLevel(metrics.changedLines, thresholds.changedLines),
    thresholdLevel(metrics.changedSymbols, thresholds.changedSymbols),
  ];
  if (levels.includes("critical")) {
    return "critical";
  }
  if (levels.includes("high")) {
    return "high";
  }
  if (levels.includes("medium")) {
    return "medium";
  }
  return "low";
}

function changedFilePath(file) {
  return typeof file === "string" ? file : file.filePath ?? "";
}

function isChangedTestFile(file) {
  return TEST_PATH_RE.test(changedFilePath(file).replaceAll("\\", "/"));
}

function hasLocalChanges(cwd) {
  const result = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=normal"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 10_000,
  });
  if (result.error || result.status !== 0) {
    throw new ReviewTriggerCliError(
      "runtime-failure",
      "review-trigger could not inspect the Git worktree",
    );
  }
  return result.stdout.trim().length > 0;
}

function withReviewRecommendation(finding, ids) {
  const enriched = enrichFindingWithRecommendation(finding, ids);
  if (!enriched.nextStep && enriched.recommendation?.en) {
    return {
      ...enriched,
      nextStep: enriched.recommendation.en,
    };
  }
  return enriched;
}

export function buildChangeTestEvidenceFindings({ blastReport, mappingReport, config }) {
  const findings = [];
  const metrics = blastReport.metrics;
  const changeLevel = strongestChangeLevel(metrics, config.thresholds);
  const changedTestFiles = blastReport.changedFiles.filter(isChangedTestFile);

  if (changeLevel !== "low" && changedTestFiles.length === 0 && metrics.changedFiles > 0) {
    findings.push(withFingerprint(withReviewRecommendation({
      id: "change-test-evidence.large-change-without-tests",
      category: "change-test-evidence",
      severity: changeLevel === "medium" ? "warning" : "error",
      source: "blast-radius",
      evidence: (
        `Changed ${metrics.changedFiles} file(s), ${metrics.changedLines} line(s), ` +
        `${metrics.changedSymbols} symbol(s), but no changed test files were observed.`
      ),
      metrics: {
        changedFiles: metrics.changedFiles,
        changedLines: metrics.changedLines,
        changedSymbols: metrics.changedSymbols,
        changedTestFiles: changedTestFiles.length,
        changeLevel,
      },
    }, ["review-trigger.change-test-evidence.large-change-without-tests"])));
  }

  const actionableMappings = (mappingReport.mappings ?? []).filter((mapping) => mapping.gate !== "pass");
  const blockingMappings = actionableMappings.filter((mapping) => mapping.gate === "block");
  const advisoryMappings = actionableMappings.filter((mapping) => mapping.gate === "remind");

  if (mappingReport.shouldNotify && (changeLevel !== "low" || mappingReport.shouldBlock)) {
    const sample = actionableMappings.slice(0, 5).map((mapping) => ({
      sourceFile: mapping.sourceFile,
      gate: mapping.gate,
      status: mapping.status,
      confidence: mapping.confidence,
      candidateTestFiles: mapping.candidateTestFiles.slice(0, 3),
    }));
    findings.push(withFingerprint(withReviewRecommendation({
      id: "change-test-evidence.missing-mapped-tests",
      category: "change-test-evidence",
      severity: mappingReport.shouldBlock ? "error" : "warning",
      source: "mapping-gate",
      evidence: (
        `${blockingMappings.length} blocking and ${advisoryMappings.length} advisory ` +
        `test mapping(s) need evidence.`
      ),
      mappings: sample,
    }, ["review-trigger.change-test-evidence.missing-mapped-tests"])));
  }

  return findings;
}

export function buildChangeTestEvidenceFindingsFromChanges({ changes, config }) {
  const changedFiles = changes.files ?? [];
  const metrics = {
    changedFiles: changedFiles.length,
    changedLines: changedFiles.reduce((sum, file) => sum + (file.added ?? 0) + (file.deleted ?? 0), 0),
    changedSymbols: 0,
  };
  const changeLevel = strongestChangeLevel(metrics, config.thresholds);
  const changedTestFiles = changedFiles.filter(isChangedTestFile);

  if (changeLevel === "low" || changedTestFiles.length > 0 || metrics.changedFiles === 0) {
    return [];
  }

  return [withFingerprint(withReviewRecommendation({
    id: "change-test-evidence.large-change-without-tests",
    category: "change-test-evidence",
    severity: changeLevel === "medium" ? "warning" : "error",
    source: "git-diff",
    evidence: (
      `Changed ${metrics.changedFiles} file(s) and ${metrics.changedLines} line(s), ` +
      "but no changed test files were observed."
    ),
    metrics: {
      changedFiles: metrics.changedFiles,
      changedLines: metrics.changedLines,
      changedTestFiles: changedTestFiles.length,
      changeLevel,
    },
  }, ["review-trigger.change-test-evidence.large-change-without-tests"]))];
}

export async function collectReviewTriggerFindings(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.env.QODER_CWD ?? process.cwd());
  const warnings = [];
  const findings = [];

  try {
    const { runAgentLint } = await import("../agent-lint/index.mjs");
    const agentLintPayload = await runAgentLint({
      workspace: cwd,
      profile: "agents-md-review",
      maxReferenceDepth: 1,
    });
    findings.push(...normalizeAgentInstructionFindings(agentLintPayload));
  } catch (error) {
    warnings.push(`agent-instructions scan failed: ${error.message}`);
  }

  try {
    if (!options.blastReport && !options.mappingReport && !options.changes && !hasLocalChanges(cwd)) {
      return {
        cwd,
        findings: sortFindings(findings),
        warnings,
      };
    }

    const { loadConfig, isIgnored } = await import("../../hooks/git-scripts/blast-radius/config.mjs");
    const { collectGitChanges } = await import("../../hooks/git-scripts/blast-radius/git.mjs");
    const config = options.config ?? await loadConfig(cwd, options.configPath);
    const changes = options.changes ?? await collectGitChanges(cwd, config);
    const changedFiles = changes.files.filter((file) => !isIgnored(changedFilePath(file), config));
    if (changedFiles.length === 0 && !options.blastReport && !options.mappingReport) {
      return {
        cwd,
        findings: sortFindings(findings),
        warnings,
      };
    }

    if (options.blastReport || options.mappingReport) {
      const { analyzeRepository } = await import("../../hooks/git-scripts/blast-radius.mjs");
      const { analyzeTestMappings } = await import("../../hooks/git-scripts/mapping-gate.mjs");
      const blastReport = options.blastReport ?? await analyzeRepository(cwd, { config, changes });
      const mappingReport = options.mappingReport ?? await analyzeTestMappings(cwd, {
        config,
        changes: { files: blastReport.changedFiles },
      });
      findings.push(...buildChangeTestEvidenceFindings({ blastReport, mappingReport, config }));
    } else {
      findings.push(...buildChangeTestEvidenceFindingsFromChanges({
        changes: { ...changes, files: changedFiles },
        config,
      }));
    }
  } catch {
    throw new ReviewTriggerCliError(
      "runtime-failure",
      "review-trigger could not verify change-test evidence",
    );
  }

  return {
    cwd,
    findings: sortFindings(findings),
    warnings,
  };
}

async function assertDirectory(cwd) {
  try {
    const stats = await stat(cwd);
    if (!stats.isDirectory()) {
      throw new ReviewTriggerCliError("runtime-failure", "review-trigger cwd is not a directory");
    }
  } catch (error) {
    if (error instanceof ReviewTriggerCliError) {
      throw error;
    }
    throw new ReviewTriggerCliError("runtime-failure", "review-trigger cwd is unavailable");
  }
}

export async function runReviewTrigger(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.env.QODER_CWD ?? process.cwd());
  await assertDirectory(cwd);
  if (options.input?.stop_hook_active) {
    return {
      ok: true,
      kind: "better-harness.review-trigger",
      status: "skipped",
      reason: "stop-hook-active",
      exitCode: 0,
      cwd,
      summary: summarizeFindings([]),
      findings: [],
      warnings: [],
    };
  }

  const collected = await collectReviewTriggerFindings({ ...options, cwd });
  const summary = summarizeFindings(collected.findings);

  return {
    ok: true,
    kind: "better-harness.review-trigger",
    status: collected.findings.length > 0 ? "findings" : "ok",
    exitCode: 0,
    cwd,
    summary,
    findings: collected.findings,
    warnings: collected.warnings,
  };
}

function parseArgs(argv) {
  const options = {
    mode: "stop",
    json: false,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = (name) => {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new ReviewTriggerCliError("invalid-arguments", `${name} requires a value`);
      }
      index += 1;
      return next;
    };
    const assignMaybeEquals = (name) => {
      const next = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : value(name);
      if (!next) {
        throw new ReviewTriggerCliError("invalid-arguments", `${name} requires a value`);
      }
      return next;
    };

    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--mode" || arg.startsWith("--mode=")) options.mode = assignMaybeEquals("--mode");
    else if (arg === "--cwd" || arg.startsWith("--cwd=")) options.cwd = assignMaybeEquals("--cwd");
    else if (arg === "--workspace" || arg.startsWith("--workspace=")) options.cwd = assignMaybeEquals("--workspace");
  }
  return options;
}

function usage() {
  return [
    "Usage: node scripts/review-trigger/cli.mjs [--mode stop] [--json] [--dry-run] [--cwd <path>]",
    "",
    "Collect lightweight Stop-hook findings without launching host applications.",
    "",
  ].join("\n");
}

async function readStdin() {
  if (process.stdin.isTTY) {
    return "";
  }
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function failureEnvelope(error) {
  const code = error instanceof ReviewTriggerCliError ? error.code : "runtime-failure";
  const message = code === "invalid-arguments"
    ? "review-trigger received invalid arguments"
    : "review-trigger runtime failed";
  return {
    ok: false,
    kind: "better-harness.review-trigger",
    status: "error",
    exitCode: 1,
    error: {
      code,
      message,
    },
  };
}

function emitFailure(error, options = {}) {
  const envelope = failureEnvelope(error);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
  } else {
    process.stderr.write(`${envelope.error.message}\n`);
  }
  return envelope.exitCode;
}

function formatHuman(result) {
  if (result.findings.length === 0) {
    return "";
  }
  const lines = [
    "Better Harness review-trigger found proactive findings.",
    `Findings: ${result.summary.findings} (errors=${result.summary.errors}, warnings=${result.summary.warnings}, advisories=${result.summary.advisories})`,
  ];
  for (const finding of result.findings.slice(0, 5)) {
    const location = finding.file ? ` (${finding.file}${finding.line ? `:${finding.line}` : ""})` : "";
    lines.push(`- [${finding.severity}] ${finding.id}${location}: ${finding.evidence}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    return emitFailure(error, { json: argv.includes("--json") });
  }

  if (args.help) {
    process.stdout.write(usage());
    return 0;
  }

  const rawInput = await readStdin();
  let input = {};
  if (rawInput.trim()) {
    try {
      input = JSON.parse(rawInput);
    } catch (error) {
      input = {};
    }
  }

  let result;
  try {
    result = await runReviewTrigger({ ...args, input });
  } catch (error) {
    return emitFailure(error, { json: args.json });
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify({
      ...result,
      dryRun: args.dryRun,
    }, null, 2)}\n`);
  } else {
    const output = formatHuman(result);
    if (output) {
      process.stderr.write(output);
    }
  }

  return result.exitCode;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.exitCode = emitFailure(error, { json: process.argv.slice(2).includes("--json") });
  });
}
