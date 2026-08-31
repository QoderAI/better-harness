// Keep this function self-contained: render-html embeds its source verbatim in
// the self-contained Inspector document, while unit tests import the same owner.
export function buildPromptCacheGapCue({
  profile,
  gapStartMs,
  gapEndMs,
  responsePositions = [],
  responsePositionsSorted = false,
} = {}) {
  const start = Number(gapStartMs);
  const end = Number(gapEndMs);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const thresholds = (profile?.comparableTtls ?? [])
    .filter((threshold) => Number.isFinite(threshold?.durationMs) && threshold.durationMs > 0)
    .sort((left, right) => left.durationMs - right.durationMs);
  if (thresholds.length === 0) return null;
  const positions = responsePositionsSorted
    ? responsePositions
    : responsePositions
      .map((position) => Number(position))
      .filter(Number.isFinite)
      .sort((left, right) => left - right);
  let lower = 0;
  let upper = positions.length;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (Number(positions[middle]) <= start) lower = middle + 1;
    else upper = middle;
  }
  let silenceStartMs = start;
  let silenceEndMs = end;
  let silenceMs = 0;
  for (let index = lower; index < positions.length; index += 1) {
    const position = Number(positions[index]);
    if (!Number.isFinite(position) || position >= end) break;
    const duration = position - silenceStartMs;
    if (duration > silenceMs) {
      silenceEndMs = position;
      silenceMs = duration;
    }
    silenceStartMs = position;
  }
  const finalDuration = end - silenceStartMs;
  if (finalDuration > silenceMs) {
    silenceEndMs = end;
    silenceMs = finalDuration;
  } else {
    silenceStartMs = silenceEndMs - silenceMs;
  }
  const crossed = thresholds.filter((threshold) => silenceMs >= threshold.durationMs);
  if (crossed.length === 0) return null;
  const threshold = crossed.at(-1);
  const nextThreshold = thresholds.find((candidate) => candidate.durationMs > silenceMs) ?? null;
  const boundaryCopy = crossed.length === 1
    ? crossed[0].label
    : crossed.map((candidate) => candidate.label).join(" and ");

  return {
    profileId: profile.id,
    providerLabel: profile.provider,
    modelLabel: profile.modelLabel,
    gapMs: end - start,
    silenceStartMs,
    silenceEndMs,
    silenceMs,
    thresholdMs: threshold.durationMs,
    thresholdLabel: threshold.label,
    crossedThresholdLabels: crossed.map((candidate) => candidate.label),
    nextThresholdLabel: nextThreshold?.label ?? null,
    summary: `${profile.provider} ${profile.modelLabel} ${boundaryCopy} cache TTL ${crossed.length === 1 ? "boundary" : "boundaries"} crossed`,
    detail: `The longest interval without an observed model response inside this no-call window crosses the ${profile.provider} ${profile.modelLabel} ${boundaryCopy} prompt-cache reference. A later turn may lose lower cache-read pricing. This is a pricing-risk cue, not observed cache expiry, a cache miss, or billed cost.`,
  };
}
