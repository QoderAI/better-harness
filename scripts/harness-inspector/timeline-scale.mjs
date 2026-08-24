export const DOMINANT_IDLE_MIN_MS = 5 * 60_000;
export const DOMINANT_IDLE_MIN_SHARE = 0.12;
export const DOMINANT_IDLE_VISUAL_SHARE = 0.025;

// Keep this function self-contained: render-html embeds its source verbatim in
// the self-contained Inspector document, while unit tests import the same owner.
export function buildCompressedTimelineScale({
  min,
  max,
  positions = [],
  plotLeft = 0,
  plotWidth = 1,
  timeBasis = true,
} = {}) {
  const rawMin = Number(min);
  const rawMax = Number(max);
  const rawSpan = Math.max(1, rawMax - rawMin);
  const sorted = [...new Set(positions
    .map(Number)
    .filter((position) => Number.isFinite(position) && position >= rawMin && position <= rawMax))]
    .sort((left, right) => left - right);
  const threshold = Math.max(5 * 60_000, rawSpan * 0.12);
  const compressedSpan = rawSpan * 0.025;
  const gaps = [];
  if (timeBasis) {
    for (let index = 1; index < sorted.length; index += 1) {
      const duration = sorted[index] - sorted[index - 1];
      if (duration > threshold) {
        gaps.push({
          from: sorted[index - 1],
          to: sorted[index],
          duration,
          visualDuration: compressedSpan,
        });
      }
    }
  }

  const segments = [];
  let rawCursor = rawMin;
  let visualCursor = 0;
  const append = (from, to, visualDuration, compressed) => {
    if (!(to > from)) return;
    segments.push({
      from,
      to,
      visualFrom: visualCursor,
      visualTo: visualCursor + visualDuration,
      compressed,
    });
    visualCursor += visualDuration;
  };
  for (const gap of gaps) {
    append(rawCursor, gap.from, gap.from - rawCursor, false);
    append(gap.from, gap.to, gap.visualDuration, true);
    rawCursor = gap.to;
  }
  append(rawCursor, rawMax, rawMax - rawCursor, false);
  if (segments.length === 0) append(rawMin, rawMax, rawSpan, false);

  const visualSpan = Math.max(1, visualCursor);
  const clamp = (value, lower, upper) => Math.min(upper, Math.max(lower, value));
  const visualFor = (position) => {
    const bounded = clamp(Number(position), rawMin, rawMax);
    const segment = segments.find((candidate) => bounded <= candidate.to) ?? segments.at(-1);
    const ratio = (bounded - segment.from) / Math.max(1, segment.to - segment.from);
    return segment.visualFrom + ratio * (segment.visualTo - segment.visualFrom);
  };
  const positionForVisual = (visualPosition) => {
    const bounded = clamp(Number(visualPosition), 0, visualSpan);
    const segment = segments.find((candidate) => bounded <= candidate.visualTo) ?? segments.at(-1);
    const ratio = (bounded - segment.visualFrom) / Math.max(1, segment.visualTo - segment.visualFrom);
    return segment.from + ratio * (segment.to - segment.from);
  };
  const xFor = (position) => plotLeft + (visualFor(position) / visualSpan) * plotWidth;
  const positionForX = (x) => positionForVisual(
    ((clamp(Number(x), plotLeft, plotLeft + plotWidth) - plotLeft) / Math.max(1, plotWidth)) * visualSpan,
  );

  return {
    compressed: gaps.length > 0,
    gaps,
    segments,
    rawMin,
    rawMax,
    rawSpan,
    visualSpan,
    xFor,
    positionForX,
    visualFractionFor: (position) => visualFor(position) / visualSpan,
    durationWidth: (position, duration) => Math.max(0, xFor(Number(position) + Number(duration)) - xFor(position)),
  };
}
