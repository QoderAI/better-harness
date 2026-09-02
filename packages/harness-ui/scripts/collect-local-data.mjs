#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { runAgentLint } from "../../../scripts/agent-lint/index.mjs";
import { SUPPORTED_CUSTOMIZE_PROVIDERS } from "../../../scripts/agent-customize/providers/index.mjs";
import { createAnalyzer, SUPPORTED_SESSION_PLATFORMS } from "../../../scripts/session-analysis/analyzer.mjs";
import { buildUsageSummary } from "../../../scripts/session-analysis/usage-summary.mjs";
import { aggregateDeliverySignals, projectDeliverySignals } from "./delivery-signals.mjs";
import { collectRepositorySignals } from "./repository-signals.mjs";
import { readUploadDeliveries, resolveUploadsDirectory } from "./upload-store.mjs";
import { resolveWorkspace, workspaceIdentity } from "./workspace.mjs";

// Every host adapter the workspace can analyze is collected by default, so a
// Dashboard never silently omits a host the developer actually works in.
const DEFAULT_PROVIDERS = SUPPORTED_SESSION_PLATFORMS;

export function normalizeSessionLimit(value) {
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("The session limit must be a positive safe integer.");
  }
  return limit;
}

function count(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function tokenTotals(value) {
  if (!value) return null;
  return {
    inputTokens: count(value.inputTokens),
    outputTokens: count(value.outputTokens),
    cacheReadInputTokens: count(value.cacheReadInputTokens),
    cacheCreationInputTokens: count(value.cacheCreationInputTokens),
  };
}

function addTokenTotals(target, value) {
  target.inputTokens += count(value?.inputTokens);
  target.outputTokens += count(value?.outputTokens);
  target.cacheReadInputTokens += count(value?.cacheReadInputTokens);
  target.cacheCreationInputTokens += count(value?.cacheCreationInputTokens);
}

function aggregateModelUsage(rows) {
  const models = new Map();
  for (const row of rows) {
    for (const model of row.summary.usageEfficiency.modelUsage) {
      const current = models.get(model.model) ?? {
        model: model.model,
        responseCount: 0,
        usageFieldObservedCount: 0,
        nonZeroUsageCount: 0,
        tokenTotals: null,
      };
      current.responseCount += count(model.responseCount);
      current.usageFieldObservedCount += count(model.usageFieldObservedCount);
      current.nonZeroUsageCount += count(model.nonZeroUsageCount);
      if (model.tokenTotals) {
        current.tokenTotals ??= tokenTotals({});
        addTokenTotals(current.tokenTotals, model.tokenTotals);
      }
      models.set(model.model, current);
    }
  }
  return [...models.values()].sort((left, right) => right.responseCount - left.responseCount);
}

export function aggregateUsageSummaries(rows) {
  const modes = [...new Set(rows.map((row) => row.summary.usageEfficiency.accountingMode))];
  const strategies = [...new Set(rows.map((row) => row.summary.selection.strategy))];
  const observedTokenRows = rows.filter((row) => row.summary.usageEfficiency.tokenTotals);
  const totals = observedTokenRows.length > 0 ? tokenTotals({}) : null;
  if (totals) {
    for (const row of observedTokenRows) addTokenTotals(totals, row.summary.usageEfficiency.tokenTotals);
  }

  return {
    kind: "better-harness.session-usage-summary",
    schemaVersion: 1,
    selection: {
      // One host analyzed with `latest-n` is reported as `latest-n`, not as a
      // mix; only hosts that disagree produce `mixed`.
      strategy: strategies.length > 1 ? "mixed" : strategies[0] ?? "all-eligible",
      eligibleCount: rows.reduce((total, row) => total + count(row.summary.selection.eligibleCount), 0),
      analyzedCount: rows.reduce((total, row) => total + count(row.summary.selection.analyzedCount), 0),
      complete: rows.length > 0 && rows.every((row) => row.summary.selection.complete),
    },
    usageEfficiency: {
      accountingMode: modes.length === 1 ? modes[0] : modes.length > 1 ? "mixed" : "unobserved",
      coverage: {
        analyzedSessionCount: rows.reduce((total, row) => total + count(row.summary.usageEfficiency.coverage.analyzedSessionCount), 0),
        responseCount: rows.reduce((total, row) => total + count(row.summary.usageEfficiency.coverage.responseCount), 0),
        usageFieldObservedCount: rows.reduce((total, row) => total + count(row.summary.usageEfficiency.coverage.usageFieldObservedCount), 0),
        nonZeroUsageCount: rows.reduce((total, row) => total + count(row.summary.usageEfficiency.coverage.nonZeroUsageCount), 0),
        modelAttributedResponseCount: rows.reduce((total, row) => total + count(row.summary.usageEfficiency.coverage.modelAttributedResponseCount), 0),
        unattributedResponseCount: rows.reduce((total, row) => total + count(row.summary.usageEfficiency.coverage.unattributedResponseCount), 0),
        exactCreditsAvailable: rows.length > 0 && rows.every((row) => row.summary.usageEfficiency.coverage.exactCreditsAvailable),
        // Hosts that fold cache reads into their input lane and hosts that keep
        // it separate cannot be summed into one comparable input total. Keeping
        // every observed mode lets the page say so instead of hiding it.
        cacheAccountingModes: [...new Set(rows.flatMap((row) => row.summary.usageEfficiency.coverage.cacheAccountingModes ?? []))].sort(),
      },
      longSessions: {
        longActiveCount: rows.reduce((total, row) => total + count(row.summary.usageEfficiency.longSessions.longActiveCount), 0),
        longWallCount: rows.reduce((total, row) => total + count(row.summary.usageEfficiency.longSessions.longWallCount), 0),
        wallOnlyCount: rows.reduce((total, row) => total + count(row.summary.usageEfficiency.longSessions.wallOnlyCount), 0),
      },
      tokenTotals: totals,
      modelUsage: aggregateModelUsage(rows),
      outcomeReview: {
        status: rows.some((row) => row.summary.usageEfficiency.outcomeReview.status === "required") ? "required" : "not-applicable",
        reviewedCandidateCount: rows.reduce((total, row) => total + count(row.summary.usageEfficiency.outcomeReview.reviewedCandidateCount), 0),
        reviewedActiveLongCount: rows.reduce((total, row) => total + count(row.summary.usageEfficiency.outcomeReview.reviewedActiveLongCount), 0),
        comparableModelOutcomeEvidence: rows.length > 0 && rows.every((row) => row.summary.usageEfficiency.outcomeReview.comparableModelOutcomeEvidence),
        reason: rows.some((row) => row.summary.usageEfficiency.outcomeReview.reason) ? "provider-review-required" : null,
      },
      candidateCount: rows.reduce((total, row) => total + count(row.summary.usageEfficiency.candidateCount), 0),
      opportunityCount: rows.reduce((total, row) => total + count(row.summary.usageEfficiency.opportunityCount), 0),
    },
    evidenceBoundary: {
      hasEligibleSessions: rows.some((row) => row.summary.evidenceBoundary.hasEligibleSessions),
      requiresSemanticReview: rows.some((row) => row.summary.evidenceBoundary.requiresSemanticReview),
      exactCostAvailable: rows.length > 0 && rows.every((row) => row.summary.evidenceBoundary.exactCostAvailable),
      warningCodes: rows.flatMap((row) => row.summary.evidenceBoundary.warningCodes.map((code) => `${row.provider}:${code}`)),
    },
  };
}

function seriesMap(activities, key, dates) {
  const totals = new Map();
  const daily = new Map();
  for (const activity of activities) {
    for (const series of activity[key] ?? []) {
      totals.set(series.name, (totals.get(series.name) ?? 0) + count(series.total));
      const values = daily.get(series.name) ?? new Map();
      activity.dates.forEach((date, index) => values.set(date, (values.get(date) ?? 0) + count(series.daily[index])));
      daily.set(series.name, values);
    }
  }
  return [...totals.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([name, total]) => ({ name, total, daily: dates.map((date) => daily.get(name)?.get(date) ?? 0) }));
}

export function aggregateUsageActivity(activities) {
  const usable = activities.filter(Boolean);
  if (usable.length === 0) {
    return {
      schemaVersion: 4,
      dateBasis: "UTC",
      measurementBasis: "session-starts-active-estimate-model-active-session-days-skill-invocations-loads-mcp-tool-calls-and-observed-token-usage",
      truncated: false,
      dates: [],
      sessions: { total: 0, starts: [], activeMinutes: [] },
      models: [],
      skills: [],
      mcps: [],
    };
  }
  const dates = [...new Set(usable.flatMap((activity) => activity.dates))].sort();
  const tokenFields = ["inputTokens", "outputTokens", "cacheReadInputTokens", "cacheCreationInputTokens"];
  const tokenActivities = usable.filter((activity) => activity.tokens);
  const valueForDate = (activity, field, date) => {
    const index = activity.dates.indexOf(date);
    return index === -1 ? 0 : count(activity.sessions[field][index]);
  };
  return {
    schemaVersion: 4,
    dateBasis: "UTC",
    measurementBasis: "session-starts-active-estimate-model-active-session-days-skill-invocations-loads-mcp-tool-calls-and-observed-token-usage",
    truncated: usable.some((activity) => activity.truncated),
    dates,
    sessions: {
      total: usable.reduce((total, activity) => total + count(activity.sessions.total), 0),
      starts: dates.map((date) => usable.reduce((total, activity) => total + valueForDate(activity, "starts", date), 0)),
      activeMinutes: dates.map((date) => Number(usable.reduce((total, activity) => total + valueForDate(activity, "activeMinutes", date), 0).toFixed(1))),
    },
    models: seriesMap(usable, "models", dates),
    skills: seriesMap(usable, "skills", dates),
    mcps: seriesMap(usable, "mcps", dates),
    ...(tokenActivities.length > 0 ? {
      tokens: {
        observedResponseCount: tokenActivities.reduce((total, activity) => total + count(activity.tokens.observedResponseCount), 0),
        totals: Object.fromEntries(tokenFields.map((field) => [
          field,
          tokenActivities.reduce((total, activity) => total + count(activity.tokens.totals[field]), 0),
        ])),
        daily: Object.fromEntries(tokenFields.map((field) => [
          field,
          dates.map((date) => tokenActivities.reduce((total, activity) => {
            const index = activity.dates.indexOf(date);
            return total + (index === -1 ? 0 : count(activity.tokens.daily[field][index]));
          }, 0)),
        ])),
      },
    } : {}),
  };
}

function emptySummary() {
  return aggregateUsageSummaries([]);
}

// `all-eligible` analyzes the whole population and ignores any limit, so an
// explicit limit has to switch the strategy for it to bound the work at all.
async function collectSessionProvider(provider, workspace, limit) {
  const analyzer = await createAnalyzer(provider);
  const result = await analyzer.analyze({
    workspace,
    command: "insights",
    ...(limit ? { selection: "latest-n", limit } : { selection: "all-eligible" }),
  });
  return {
    provider,
    summary: buildUsageSummary(result),
    activity: result.insights?.keySignals?.usageEfficiency?.activity ?? null,
    contextUsage: result.contextUsage ?? null,
    delivery: projectDeliverySignals(result.insights),
  };
}

// One row per host, so an organization view can compare hosts instead of only
// seeing their sum. Everything here already exists in the host's own summary.
export function providerBreakdown(rows) {
  return rows.map((row) => {
    const coverage = row.summary.usageEfficiency.coverage;
    return {
      provider: row.provider,
      analyzedSessions: count(row.summary.selection.analyzedCount),
      eligibleSessions: count(row.summary.selection.eligibleCount),
      responseCount: count(coverage.responseCount),
      modelAttributedResponseCount: count(coverage.modelAttributedResponseCount),
      activeMinutes: Number((row.activity?.sessions?.activeMinutes ?? [])
        .reduce((total, value) => total + count(value), 0)
        .toFixed(1)),
      accountingMode: row.summary.usageEfficiency.accountingMode,
      cacheAccountingModes: coverage.cacheAccountingModes ?? [],
      tokenTotals: row.summary.usageEfficiency.tokenTotals,
      editCount: row.delivery?.validationAfterEdit.editCount ?? 0,
      episodeCount: row.delivery?.episodes.episodeCount ?? 0,
    };
  });
}

async function collectAssetProvider(provider, workspace) {
  return runAgentLint({ workspace, profile: "agent-assets-review", provider });
}

// Context-window occupancy is native host evidence rather than an aggregate, so
// one observed host is reported as itself instead of being summed across hosts.
export function selectContextUsage(rows) {
  return rows.find((row) => row.contextUsage?.status === "observed")?.contextUsage ?? null;
}

export async function collectLocalDashboardData({
  workspace,
  providers = DEFAULT_PROVIDERS,
  limit,
  uploadsDirectory,
} = {}) {
  const resolvedWorkspace = path.resolve(workspace ?? resolveWorkspace());
  const sessionRows = [];
  const assetInventories = [];
  const errors = [];
  // Asset inventory covers a narrower host set than session analysis, so a host
  // without an inventory adapter is skipped instead of reported as a failure.
  const assetProviders = providers.filter((provider) => SUPPORTED_CUSTOMIZE_PROVIDERS.includes(provider));

  const uploads = await readUploadDeliveries({
    directory: resolveUploadsDirectory({ workspace: resolvedWorkspace, uploadsDirectory }),
  }).catch((error) => ({
    deliveries: [],
    total: 0,
    truncated: false,
    errors: [{ source: "uploads", message: error?.message ?? String(error) }],
  }));
  errors.push(...uploads.errors);

  // Commits and topology answer what the sessions produced and how the
  // workspace is divided. They read git rather than session analysis, so they
  // run alongside it and a repository without git still gets the rest.
  const repositoryWork = collectRepositorySignals({ workspace: resolvedWorkspace, platforms: providers })
    .catch((error) => ({
      commitAttribution: null,
      topology: null,
      errors: [{ source: "repository", message: error?.message ?? String(error) }],
    }));

  const [repository] = await Promise.all([
    repositoryWork,
    ...providers.map((provider) => collectSessionProvider(provider, resolvedWorkspace, limit)
      .then((row) => sessionRows.push(row))
      .catch((error) => errors.push({ source: `${provider}:sessions`, message: error?.message ?? String(error) }))),
    ...assetProviders.map((provider) => collectAssetProvider(provider, resolvedWorkspace)
      .then((report) => assetInventories.push(report))
      .catch((error) => errors.push({ source: `${provider}:assets`, message: error?.message ?? String(error) }))),
  ]);
  errors.push(...repository.errors);

  sessionRows.sort((left, right) => providers.indexOf(left.provider) - providers.indexOf(right.provider));
  assetInventories.sort((left, right) => providers.indexOf(left.assetInventory.provider) - providers.indexOf(right.assetInventory.provider));
  const usageSummary = sessionRows.length > 0 ? aggregateUsageSummaries(sessionRows) : emptySummary();
  const contextUsage = selectContextUsage(sessionRows);
  const usageActivity = aggregateUsageActivity(sessionRows.map((row) => row.activity));
  return {
    generatedAt: new Date().toISOString(),
    workspace: workspaceIdentity(resolvedWorkspace),
    // The analyzed window is a boundary on every dated series below. Without it
    // a reader cannot tell a week of evidence from a year of it.
    window: {
      firstDate: usageActivity.dates[0] ?? null,
      lastDate: usageActivity.dates.at(-1) ?? null,
      dayCount: usageActivity.dates.length,
      truncated: usageActivity.truncated === true,
    },
    sources: {
      sessionProviders: sessionRows.map((row) => row.provider),
      assetProviders: assetInventories.map((report) => report.assetInventory.provider),
      tokenProviders: sessionRows.filter((row) => row.summary.usageEfficiency.tokenTotals).map((row) => row.provider),
      errors: errors.map((error) => ({ source: error.source, message: String(error.message).split("\n", 1)[0].slice(0, 240) })),
    },
    usageSummary,
    usageActivity,
    providerBreakdown: providerBreakdown(sessionRows),
    deliverySignals: aggregateDeliverySignals(sessionRows.map((row) => row.delivery)),
    ...(repository.commitAttribution ? { commitAttribution: repository.commitAttribution } : {}),
    ...(repository.topology ? { topology: repository.topology } : {}),
    ...(contextUsage ? { contextUsage } : {}),
    assetInventories,
    evidenceDeliveries: {
      items: uploads.deliveries,
      total: uploads.total ?? uploads.deliveries.length,
      truncated: uploads.truncated === true,
    },
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--workspace") options.workspace = argv[++index];
    else if (value === "--providers") options.providers = String(argv[++index]).split(",").map((item) => item.trim()).filter(Boolean);
    else if (value === "--limit") options.limit = normalizeSessionLimit(argv[++index]);
    else if (value === "--uploads") options.uploadsDirectory = argv[++index];
  }
  return options;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  collectLocalDashboardData(parseArgs(process.argv.slice(2)))
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`harness-ui data collection failed: ${error.stack ?? error.message}\n`);
      process.exitCode = 1;
    });
}
