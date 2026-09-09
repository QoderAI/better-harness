/** Fit saved proportions without allowing a viewport change to crush one pane. */
export function fitComparePaneSizes(preferred: readonly number[], available: number, minimum = 220): number[] {
  if (available <= preferred.length * minimum) return preferred.map(() => available / preferred.length);
  const fitted = preferred.map(() => 0);
  let remaining = available;
  let active = preferred.map((_, index) => index);
  while (active.length) {
    const total = active.reduce((sum, index) => sum + preferred[index]!, 0);
    const tooSmall = active.filter(index => preferred[index]! / total * remaining < minimum);
    if (!tooSmall.length) {
      for (const index of active) fitted[index] = preferred[index]! / total * remaining;
      break;
    }
    for (const index of tooSmall) { fitted[index] = minimum; remaining -= minimum; }
    active = active.filter(index => !tooSmall.includes(index));
  }
  return fitted;
}
