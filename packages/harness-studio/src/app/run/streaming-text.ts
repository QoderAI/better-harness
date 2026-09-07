/**
 * Reveal one animation-frame slice of a streaming message.
 *
 * The rate follows Zed's target: show the current backlog over roughly 200ms at
 * a 16ms cadence. It is recomputed whenever the target grows, so a burst makes
 * each frame larger instead of building an ever-growing lag.
 */
export function nextStreamingText(
  current: string,
  target: string,
  complete = false,
  frameMs = 16,
  targetMs = 200,
): string {
  if (complete || !target.startsWith(current)) return target;
  const pending = Array.from(target.slice(current.length));
  if (pending.length === 0) return current;
  const count = Math.max(1, Math.ceil(pending.length * frameMs / targetMs));
  return current + pending.slice(0, count).join("");
}
