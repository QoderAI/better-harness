import { stableFingerprint } from "./episode-contract.mjs";

export const OBSERVATION_MANIFEST_SCHEMA_VERSION = 2;

function sourceShape(source) {
  return {
    id: source?.id ?? "unknown",
    kind: source?.kind ?? "unknown",
    enabled: Boolean(source?.enabled),
    exists: Boolean(source?.exists),
    optional: Boolean(source?.optional),
    workspaceScoped: Boolean(source?.workspaceScoped),
  };
}

export function buildObservationManifest({
  scope = {},
  sources = [],
  warnings = [],
  eligibleCount = 0,
  analyzedCount = 0,
  selectionStrategy = "all-eligible",
  selectionStrata = [],
  selectionPlan = null,
  adapterVersion = "session-analysis-v2",
  generatedAt = null,
  privacyMode = "reader-safe",
} = {}) {
  const sourceInventory = sources.map(sourceShape).sort((left, right) => left.id.localeCompare(right.id));
  const sampled = analyzedCount < eligibleCount;
  const latestN = selectionStrategy === "latest-n";
  const confidence =
    eligibleCount === 0 || analyzedCount === 0 ? "Low"
      : latestN ? "Low"
        : sampled ? "Medium"
          : "High";
  return {
    schemaVersion: OBSERVATION_MANIFEST_SCHEMA_VERSION,
    kind: "session-observation-manifest",
    generatedAt,
    scope: {
      platform: scope.platform ?? "unknown",
      workspaceScope: scope.workspace ? "workspace" : "platform",
      since: scope.since ?? null,
      until: scope.until ?? null,
      includeGlobalCapabilities: Boolean(scope.includeGlobalCapabilities),
    },
    sources: {
      total: sourceInventory.length,
      enabled: sourceInventory.filter((source) => source.enabled).length,
      existingEnabled: sourceInventory.filter((source) => source.enabled && source.exists).length,
      fingerprint: stableFingerprint(sourceInventory),
    },
    selection: {
      strategy: selectionStrategy,
      eligibleCount,
      analyzedCount,
      sampled,
      representative: !latestN && !sampled,
      strata: selectionStrata,
      confidence,
      ...(selectionPlan ? { plan: selectionPlan } : {}),
    },
    adapter: {
      id: scope.platform ?? "unknown",
      version: adapterVersion,
    },
    privacy: {
      mode: privacyMode,
      rawPromptIncluded: false,
      rawCommandIncluded: false,
      absoluteHomePathIncluded: false,
    },
    warningCodes: [...new Set(warnings.map((warning) => warning?.code).filter(Boolean))].sort(),
  };
}
