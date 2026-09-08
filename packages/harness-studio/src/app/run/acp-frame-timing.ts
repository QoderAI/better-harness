/**
 * Observed timing for retained ACP frames.
 *
 * A wire frame carries no timestamp, so the Studio reads its own clock as it
 * folds one into run state. Everything derived from that reading lives here as
 * pure functions: the pane renders what these return, and the boundaries
 * (a first frame with no predecessor, a window of one frame, the unit steps in
 * the elapsed label) are asserted against the returned values rather than
 * against markup.
 */

/** Timing derived for one retained frame relative to the frame before it. */
export interface AcpFrameTiming {
  observedAt: number;
  /** Elapsed observation time since the previous frame; absent for the first. */
  sincePreviousMs?: number;
}

/** The observation window spanned by every retained frame. */
export interface AcpObservationSpan {
  firstAt: number;
  lastAt: number;
  totalMs: number;
}

/**
 * Maps frames to their timing over the *whole* retained array, so a rendered
 * tail still reports true deltas for frames whose predecessor is off-screen.
 */
export function acpFrameTimings(frames: readonly { observedAt: number }[]): AcpFrameTiming[] {
  return frames.map((frame, index) => {
    const previous = frames[index - 1];
    return previous === undefined
      ? { observedAt: frame.observedAt }
      : { observedAt: frame.observedAt, sincePreviousMs: Math.max(0, frame.observedAt - previous.observedAt) };
  });
}

/** Reduces retained frames to their window, or undefined when none was observed. */
export function acpObservationSpan(frames: readonly { observedAt: number }[]): AcpObservationSpan | undefined {
  const first = frames[0];
  const last = frames[frames.length - 1];
  if (first === undefined || last === undefined) return undefined;
  return { firstAt: first.observedAt, lastAt: last.observedAt, totalMs: Math.max(0, last.observedAt - first.observedAt) };
}

/** Wall-clock reading for one observation, in the viewer's locale. */
export function formatObservedClock(observedAt: number, locale: string): string {
  return new Date(observedAt).toLocaleTimeString(locale, { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Elapsed observation time, stepping units so the label stays under six characters. */
export function formatObservedElapsed(milliseconds: number): string {
  const bounded = Math.max(0, milliseconds);
  if (bounded < 1_000) return `${Math.round(bounded)} ms`;
  if (bounded < 60_000) return `${(bounded / 1_000).toFixed(bounded < 10_000 ? 1 : 0)} s`;
  return `${Math.floor(bounded / 60_000)}m ${Math.round((bounded % 60_000) / 1_000)}s`;
}
