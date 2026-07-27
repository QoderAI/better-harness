function timestamp(session) {
  const value = session?.lastSeen ?? session?.firstSeen ?? null;
  const millis = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(millis) ? null : millis;
}

function normalizedLimit(limit, fallback) {
  if (limit === undefined || limit === null || limit === "") return fallback;
  const parsed = Number(limit);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

export function normalizeSelectionStrategy(value) {
  if (value === "stratified") return "stratified";
  if (value === "all-eligible") return "all-eligible";
  return "latest-n";
}

function stratifiedIndexes(length, limit) {
  if (limit <= 0 || length === 0) return [];
  if (limit >= length) return Array.from({ length }, (_, index) => index);
  if (limit === 1) return [length - 1];
  const indexes = new Set();
  for (let index = 0; index < limit; index += 1) {
    indexes.add(Math.round((index * (length - 1)) / (limit - 1)));
  }
  return [...indexes].sort((left, right) => left - right);
}

export function selectSessions(sessions = [], { limit, strategy = "latest-n", defaultLimit = 50 } = {}) {
  const eligible = [...sessions];
  const resolvedLimit = normalizedLimit(limit, defaultLimit);
  const requestedStrategy = normalizeSelectionStrategy(strategy);
  if (resolvedLimit === 0) {
    return {
      sessions: [],
      strategy: requestedStrategy,
      requestedStrategy,
      eligibleCount: eligible.length,
      analyzedCount: 0,
      strata: requestedStrategy === "stratified" ? ["time"] : [],
    };
  }
  if (requestedStrategy === "all-eligible" || resolvedLimit >= eligible.length) {
    return {
      sessions: eligible,
      strategy: "all-eligible",
      requestedStrategy,
      eligibleCount: eligible.length,
      analyzedCount: eligible.length,
      strata: [],
    };
  }
  if (requestedStrategy === "stratified") {
    const ordered = eligible
      .map((session, index) => ({ session, index, timestamp: timestamp(session) }))
      .sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0) || left.index - right.index);
    const selectedIndexes = new Set(stratifiedIndexes(ordered.length, resolvedLimit).map((index) => ordered[index].index));
    return {
      sessions: eligible.filter((_session, index) => selectedIndexes.has(index)),
      strategy: "stratified",
      requestedStrategy,
      eligibleCount: eligible.length,
      analyzedCount: selectedIndexes.size,
      strata: ["time"],
    };
  }
  return {
    sessions: eligible.slice(0, resolvedLimit),
    strategy: "latest-n",
    requestedStrategy,
    eligibleCount: eligible.length,
    analyzedCount: Math.min(resolvedLimit, eligible.length),
    strata: [],
  };
}

export function selectionSummary(selection = {}) {
  const summary = {
    strategy: selection.strategy ?? "latest-n",
    requestedStrategy: selection.requestedStrategy ?? selection.strategy ?? "latest-n",
    eligibleCount: Number(selection.eligibleCount ?? 0),
    analyzedCount: Number(selection.analyzedCount ?? 0),
    strata: Array.isArray(selection.strata) ? selection.strata : [],
  };
  if (selection.plan) {
    summary.plan = {
      schemaVersion: selection.plan.schemaVersion,
      digest: selection.plan.digest,
      planner: selection.plan.planner,
      profileDigest: selection.plan.profileDigest,
      fallback: selection.plan.fallback,
      fallbackSelectedCount: Number(selection.plan.fallbackSelectedCount ?? 0),
      strata: Array.isArray(selection.plan.strata)
          ? selection.plan.strata.map((stratum) => ({
            id: stratum.id,
            family: stratum.family,
            target: Number(stratum.target ?? 0),
            matchedCount: Number(stratum.matchedCount ?? 0),
            overlapCount: Number(stratum.overlapCount ?? 0),
            selectedCount: Number(stratum.selectedCount ?? 0),
            shortfall: Number(stratum.shortfall ?? 0),
          }))
        : [],
    };
  }
  return summary;
}
