import type { AssetIdentity, DashboardInput } from "./contracts";

const ASSET_KEYS = ["skills", "mcps", "hooks", "commands", "rules", "agents", "plugins"] as const;

type AssetKey = (typeof ASSET_KEYS)[number];

// The inventory summary is per host; the asset identity is per file. Several
// hosts read the same `.agents/skills/*` and the same `AGENTS.md`, so the two
// counts answer different questions and must not be confused for each other.
const ASSET_KIND_TO_KEY: Record<string, AssetKey> = {
  skill: "skills",
  mcp: "mcps",
  hook: "hooks",
  command: "commands",
  rule: "rules",
  agent: "agents",
  plugin: "plugins",
};

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

function emptyAssetTotals(): Record<AssetKey, number> {
  return { skills: 0, mcps: 0, hooks: 0, commands: 0, rules: 0, agents: 0, plugins: 0 };
}

/**
 * Distinct configured assets across every host inventory, plus the configured
 * instances those inventories reported.
 *
 * A host that cannot enumerate identities (an older report, or one truncated by
 * the identity bound) would otherwise silently drop out of the distinct count,
 * so `complete` records whether every report contributed identities. When it
 * did not, only the instance count is trustworthy.
 */
function buildAssetTotals(input: DashboardInput) {
  const distinct = emptyAssetTotals();
  const instances = emptyAssetTotals();
  const seen = new Set<string>();
  let complete = input.assetInventories.length > 0;

  for (const report of input.assetInventories) {
    for (const key of ASSET_KEYS) instances[key] += report.assetInventory.summary[key] ?? 0;

    const assets: AssetIdentity[] | undefined = report.assetInventory.assets;
    if (!assets || report.assetInventory.assetsTruncated) {
      complete = false;
      continue;
    }
    for (const asset of assets) {
      const key = ASSET_KIND_TO_KEY[asset.kind];
      if (!key) continue;
      const identity = `${asset.kind}:${asset.id}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      distinct[key] += 1;
    }
  }

  return {
    distinct,
    instances,
    complete,
    // How many times the average distinct asset was counted per host. Above 1
    // means several hosts are configured against the same files.
    hostMultiplier: complete && sum(Object.values(distinct)) > 0
      ? Number((sum(Object.values(instances)) / sum(Object.values(distinct))).toFixed(1))
      : null,
  };
}

export function buildDashboardModel(input: DashboardInput) {
  const { usageSummary: summary, usageActivity: activity } = input;
  const coverage = summary.usageEfficiency.coverage;
  const tokenTotals = summary.usageEfficiency.tokenTotals;
  const contextUsage = input.contextUsage;
  const assetTotals = buildAssetTotals(input);
  const assetFindings = input.assetInventories.flatMap((report) => report.findings);
  const deliveries = input.evidenceDeliveries?.items ?? [];
  const cacheAccountingModes = coverage.cacheAccountingModes ?? [];

  return {
    generatedAt: input.generatedAt,
    workspaceLabel: input.workspace?.label ?? null,
    window: input.window ?? null,
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
      longWallCount: summary.usageEfficiency.longSessions.longWallCount,
      wallOnlyCount: summary.usageEfficiency.longSessions.wallOnlyCount,
    },
    tokenUsage: {
      inputTokens: tokenTotals?.inputTokens ?? 0,
      outputTokens: tokenTotals?.outputTokens ?? 0,
      cacheReadInputTokens: tokenTotals?.cacheReadInputTokens ?? 0,
      cacheCreationInputTokens: tokenTotals?.cacheCreationInputTokens ?? 0,
      observed: tokenTotals !== null,
      accountingMode: summary.usageEfficiency.accountingMode,
      cacheAccountingModes,
      // `included-in-input` hosts already count cache reads inside their input
      // lane. Mixed with a `separate-input-lane` host, the summed Input and
      // Cache read lanes overlap by an unknown amount and cannot be compared.
      cacheLanesOverlap: cacheAccountingModes.includes("included-in-input"),
      cacheLanesComparable: cacheAccountingModes.length <= 1,
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
      /** Distinct configured files across hosts. */
      totals: assetTotals.distinct,
      /** What the per-host summaries add up to; one file counts once per host. */
      configuredInstances: assetTotals.instances,
      distinctComplete: assetTotals.complete,
      hostMultiplier: assetTotals.hostMultiplier,
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
    // The model chart can only show responses a host attributed to a model.
    // Without this the chart reads as the full response population.
    modelCoverage: {
      attributed: coverage.modelAttributedResponseCount,
      unattributed: coverage.unattributedResponseCount,
      total: coverage.responseCount,
      attributionRate: ratio(coverage.modelAttributedResponseCount, coverage.responseCount),
    },
    skills: [...activity.skills].sort((left, right) => {
      if (left.name === "Other") return 1;
      if (right.name === "Other") return -1;
      return right.total - left.total;
    }),
    // A host that was scanned and found nothing is coverage evidence, but a
    // dozen all-zero rows bury the hosts that did work. Rows carry the active
    // hosts; the scanned-but-empty ones are named once instead.
    providerBreakdown: [...(input.providerBreakdown ?? [])]
      .filter((row) => row.analyzedSessions > 0)
      .sort((left, right) => right.analyzedSessions - left.analyzedSessions || left.provider.localeCompare(right.provider)),
    providersWithoutSessions: (input.providerBreakdown ?? [])
      .filter((row) => row.analyzedSessions === 0)
      .map((row) => row.provider)
      .sort(),
    delivery: input.deliverySignals
      ? {
        ...input.deliverySignals,
        episodeClosureRate: ratio(
          input.deliverySignals.episodes.closedEpisodeCount,
          input.deliverySignals.episodes.eligibleEpisodeCount,
        ),
      }
      : null,
    commitAttribution: input.commitAttribution
      ? {
        ...input.commitAttribution,
        attributionRate: ratio(input.commitAttribution.attributedCommits, input.commitAttribution.commitCount),
        lineAttributionRate: ratio(input.commitAttribution.attributedLinesAdded, input.commitAttribution.linesAdded),
      }
      : null,
    topology: input.topology ?? null,
    evidenceDeliveries: {
      shown: deliveries.length,
      total: input.evidenceDeliveries?.total ?? deliveries.length,
      truncated: input.evidenceDeliveries?.truncated ?? false,
      organizations: [...new Set(deliveries.map((delivery) => delivery.organization))].sort(),
      items: deliveries.map((delivery) => ({
        id: delivery.packet.task.id,
        title: delivery.packet.task.title,
        workspace: delivery.packet.workspace.label,
        organization: delivery.organization,
        acceptedAt: delivery.acceptedAt,
        receiptState: delivery.receiptState,
        // The digest is prefixed with its algorithm; a short form has to skip
        // the prefix or it shows the same 7 characters for every packet.
        digest: delivery.packetDigest.replace(/^[a-z0-9]+:/u, "").slice(0, 12),
        digestAlgorithm: delivery.packetDigest.includes(":") ? delivery.packetDigest.split(":", 1)[0] : null,
        generatedAt: delivery.packet.generatedAt,
        acceptance: delivery.packet.coverage.acceptance,
        assets: delivery.packet.coverage.assetOutcomes,
        assetMatches: delivery.packet.coverage.assetMatches,
        observations: delivery.packet.coverage.observations,
        redactions: delivery.packet.privacy.redactions,
      })),
    },
  };
}

export type DashboardModel = ReturnType<typeof buildDashboardModel>;
