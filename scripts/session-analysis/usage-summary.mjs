#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { createAnalyzer } from "../session-analysis.mjs";
import { parseArgs } from "./cli.mjs";

const HELP = `Usage: better-harness session-analysis usage-summary [options]

Emit a bounded, read-only usage boundary as JSON. This command never accepts
--output and never writes report or scratch files.

Options:
  --platform <qoder|codex|claude|cursor>
                            Session provider (default: qoder)
  --workspace <path>        Target workspace (default: current directory)
  --selection <strategy>    Selection strategy (default: all-eligible)
  --limit <n>               Maximum eligible sessions to analyze (default: 1000)
  --home <path>             Explicit provider home for fixtures or isolated runs
  --format json             Output format; JSON only
  -h, --help                Print help
`;

function count(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function optionalText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function tokenTotals(value) {
  if (!value || typeof value !== "object") return null;
  return {
    inputTokens: count(value.inputTokens),
    outputTokens: count(value.outputTokens),
    cacheReadInputTokens: count(value.cacheReadInputTokens),
    cacheCreationInputTokens: count(value.cacheCreationInputTokens),
  };
}

export function buildUsageSummary(result = {}) {
  const selection = result.selection ?? {};
  const usage = result.insights?.keySignals?.usageEfficiency ?? {};
  const coverage = usage.coverage ?? {};
  const longSessions = usage.longSessions ?? {};
  const outcomeReview = usage.outcomeReview ?? {};
  const eligibleCount = count(selection.eligibleCount);
  const analyzedCount = count(selection.analyzedCount ?? coverage.analyzedSessionCount);
  const candidateCount = Array.isArray(usage.candidates) ? usage.candidates.length : 0;

  return {
    kind: "better-harness.session-usage-summary",
    schemaVersion: 1,
    selection: {
      strategy: optionalText(selection.strategy) ?? "all-eligible",
      eligibleCount,
      analyzedCount,
      complete: eligibleCount === analyzedCount,
    },
    usageEfficiency: {
      accountingMode: optionalText(usage.accountingMode) ?? "effort-proxy",
      coverage: {
        analyzedSessionCount: count(coverage.analyzedSessionCount),
        responseCount: count(coverage.responseCount),
        usageFieldObservedCount: count(coverage.usageFieldObservedCount),
        nonZeroUsageCount: count(coverage.nonZeroUsageCount),
        modelAttributedResponseCount: count(coverage.modelAttributedResponseCount),
        unattributedResponseCount: count(coverage.unattributedResponseCount),
        exactCreditsAvailable: coverage.exactCreditsAvailable === true,
      },
      longSessions: {
        longActiveCount: count(longSessions.longActiveCount),
        longWallCount: count(longSessions.longWallCount),
        wallOnlyCount: count(longSessions.wallOnlyCount),
      },
      tokenTotals: tokenTotals(usage.tokenTotals),
      modelUsage: (Array.isArray(usage.modelUsage) ? usage.modelUsage : []).map((row) => ({
        model: optionalText(row?.model) ?? "Unknown model",
        responseCount: count(row?.responseCount),
        usageFieldObservedCount: count(row?.usageFieldObservedCount),
        nonZeroUsageCount: count(row?.nonZeroUsageCount),
        tokenTotals: tokenTotals(row?.tokenTotals),
      })),
      outcomeReview: {
        status: optionalText(outcomeReview.status) ?? "not-applicable",
        reviewedCandidateCount: count(outcomeReview.reviewedCandidateCount),
        reviewedActiveLongCount: count(outcomeReview.reviewedActiveLongCount),
        comparableModelOutcomeEvidence: outcomeReview.comparableModelOutcomeEvidence === true,
        reason: optionalText(outcomeReview.reason),
      },
      candidateCount,
      opportunityCount: Array.isArray(usage.opportunities) ? usage.opportunities.length : 0,
    },
    evidenceBoundary: {
      hasEligibleSessions: eligibleCount > 0,
      requiresSemanticReview: candidateCount > 0,
      exactCostAvailable: usage.actualCost?.available === true,
      warningCodes: (Array.isArray(result.warnings) ? result.warnings : [])
        .map((warning) => optionalText(warning?.code))
        .filter(Boolean),
    },
  };
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(HELP);
    return;
  }

  const { options } = parseArgs(argv);
  if (options.output !== undefined) {
    throw new Error("usage-summary is read-only and does not accept --output");
  }
  const format = options.format ?? "json";
  if (format !== "json") {
    throw new Error("usage-summary supports only --format json");
  }

  const platform = options.platform ?? "qoder";
  const analyzer = await createAnalyzer(platform);
  const result = await analyzer.analyze({
    ...options,
    command: "insights",
    selection: options.selection ?? "all-eligible",
    limit: options.limit ?? 1000,
  });
  process.stdout.write(`${JSON.stringify(buildUsageSummary(result), null, 2)}\n`);
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    process.stderr.write(`session usage summary failed: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
