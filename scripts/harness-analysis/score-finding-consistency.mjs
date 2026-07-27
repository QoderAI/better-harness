export const AGENT_WORK_LOOP_LOW_SCORE_FINDING_THRESHOLD = 70;

function rows(value) {
  return Array.isArray(value) ? value : [];
}

export function lowScoreFindingConsistencyErrors(dimensions, findings, {
  threshold = AGENT_WORK_LOOP_LOW_SCORE_FINDING_THRESHOLD,
  applicableDimensionIds,
  allowUnlinkedLowScore,
} = {}) {
  const applicableIds = Array.isArray(applicableDimensionIds)
    ? new Set(applicableDimensionIds.map(String))
    : null;
  const findingsById = new Map();
  for (const finding of rows(findings)) {
    const id = String(finding?.id ?? "");
    if (!id) continue;
    const bucket = findingsById.get(id) ?? [];
    bucket.push(finding);
    findingsById.set(id, bucket);
  }

  const errors = [];
  for (const dimension of rows(dimensions)) {
    const dimensionId = String(dimension?.id ?? "(unknown)");
    if (applicableIds && !applicableIds.has(dimensionId)) continue;
    if (!Number.isInteger(dimension?.score) || dimension.score >= threshold) continue;
    if (typeof allowUnlinkedLowScore === "function" && allowUnlinkedLowScore(dimension)) continue;
    const hasLinkedFinding = rows(dimension?.findingRefs).some((ref) =>
      rows(findingsById.get(String(ref))).some((finding) =>
        rows(finding?.dimensionRefs).map(String).includes(dimensionId)));
    if (!hasLinkedFinding) {
      errors.push(`summary dimension ${dimensionId} score ${dimension.score} is below ${threshold} and requires at least one linked finding whose dimensionRefs links back to ${dimensionId}`);
    }
  }
  return errors;
}
