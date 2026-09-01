import type { DashboardInput } from "./contracts";

function sum(values: number[]) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}

function selectionNote(strategy: string) {
  if (strategy === "all-eligible") return "all-eligible selection";
  if (strategy === "latest-n") return "latest-n bounded selection";
  if (strategy === "mixed") return "mixed host selection";
  return `${strategy} selection`;
}

export function buildDashboardModel(input: DashboardInput) {
  const { usageSummary: summary, usageActivity: activity } = input;
  const coverage = summary.usageEfficiency.coverage;
  const tokenTotals = summary.usageEfficiency.tokenTotals;
  const contextUsage = input.contextUsage;
  const assetTotals = input.assetInventories.reduce(
    (totals, report) => {
      for (const key of Object.keys(totals) as Array<keyof typeof totals>) {
        totals[key] += report.assetInventory.summary[key] ?? 0;
      }
      return totals;
    },
    { skills: 0, mcps: 0, hooks: 0, commands: 0, rules: 0, agents: 0, plugins: 0 },
  );
  const assetFindings = input.assetInventories.flatMap((report) => report.findings);

  return {
    generatedAt: input.generatedAt,
    sources: input.sources,
    overview: {
      analyzedSessions: summary.selection.analyzedCount,
      eligibleSessions: summary.selection.eligibleCount,
      selectionStrategy: summary.selection.strategy,
      selectionNote: selectionNote(summary.selection.strategy),
      activeMinutes: Number(sum(activity.sessions.activeMinutes).toFixed(1)),
      modelResponses: coverage.responseCount,
      skillInvocations: sum(activity.skills.map((skill) => skill.total)),
    },
    activity: activity.dates.map((date, index) => ({
      date,
      sessionStarts: activity.sessions.starts[index] ?? 0,
      activeMinutes: activity.sessions.activeMinutes[index] ?? 0,
    })),
    evidence: {
      selectionComplete: summary.selection.complete,
      accountingMode: summary.usageEfficiency.accountingMode,
      usageFieldCoverage: ratio(coverage.usageFieldObservedCount, coverage.responseCount),
      exactCostAvailable: summary.evidenceBoundary.exactCostAvailable,
      requiresSemanticReview: summary.evidenceBoundary.requiresSemanticReview,
      warningCodes: summary.evidenceBoundary.warningCodes,
      longActiveCount: summary.usageEfficiency.longSessions.longActiveCount,
      wallOnlyCount: summary.usageEfficiency.longSessions.wallOnlyCount,
    },
    tokenUsage: {
      inputTokens: tokenTotals?.inputTokens ?? 0,
      outputTokens: tokenTotals?.outputTokens ?? 0,
      cacheReadInputTokens: tokenTotals?.cacheReadInputTokens ?? 0,
      cacheCreationInputTokens: tokenTotals?.cacheCreationInputTokens ?? 0,
      observed: tokenTotals !== null,
    },
    tokenActivity: activity.tokens ? {
      observedResponseCount: activity.tokens.observedResponseCount,
      totals: activity.tokens.totals,
      rows: activity.dates.map((date, index) => ({
        date,
        inputTokens: activity.tokens?.daily.inputTokens[index] ?? 0,
        outputTokens: activity.tokens?.daily.outputTokens[index] ?? 0,
        cacheReadInputTokens: activity.tokens?.daily.cacheReadInputTokens[index] ?? 0,
        cacheCreationInputTokens: activity.tokens?.daily.cacheCreationInputTokens[index] ?? 0,
      })),
    } : null,
    contextUsage: contextUsage ? {
      status: contextUsage.status,
      evidence: contextUsage.evidence,
      capturedAt: contextUsage.capturedAt ?? null,
      totalTokensUsed: contextUsage.totalTokensUsed ?? 0,
      contextWindowSize: contextUsage.contextWindowSize ?? 0,
      percentFull: contextUsage.percentFull ?? 0,
      categories: [...contextUsage.categories].sort((left, right) => right.estimatedTokens - left.estimatedTokens),
      itemCount: contextUsage.coverage.itemCount,
      truncated: contextUsage.coverage.truncated,
    } : null,
    assets: {
      observed: input.assetInventories.length > 0,
      totals: assetTotals,
      inventoryReports: input.assetInventories.length,
      providers: [...new Set(input.assetInventories.map((report) => report.assetInventory.provider))],
      findings: {
        errors: assetFindings.filter((finding) => finding.severity === "error").length,
        warnings: assetFindings.filter((finding) => finding.severity === "warning").length,
        advisories: assetFindings.filter((finding) => finding.severity === "advisory").length,
      },
    },
    models: [...summary.usageEfficiency.modelUsage]
      .sort((left, right) => right.responseCount - left.responseCount),
    skills: [...activity.skills].sort((left, right) => {
      if (left.name === "Other") return 1;
      if (right.name === "Other") return -1;
      return right.total - left.total;
    }),
    evidencePackets: input.evidencePackets.map((packet) => ({
      id: packet.task.id,
      title: packet.task.title,
      workspace: packet.workspace.label,
      generatedAt: packet.generatedAt,
      acceptance: packet.coverage.acceptance,
      assets: packet.coverage.assetOutcomes,
      observations: packet.coverage.observations,
      redactions: packet.privacy.redactions,
    })),
  };
}

export type DashboardModel = ReturnType<typeof buildDashboardModel>;
