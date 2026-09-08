import { useEffect, useRef, useState } from "react";
import { nextStreamingText } from "./streaming-text.js";

/**
 * Reveal streaming text at the shared cadence instead of painting each delta.
 *
 * An Agent's transport already coalesces tokens into bursts, so rendering
 * `item.text` directly makes a live turn arrive as a block. Revealing the
 * backlog over ~200ms at a 16ms cadence turns those bursts back into visible
 * progress. Owned here rather than in a view so the Debugger and Compare read
 * the same stream at the same speed.
 *
 * A target that is not an extension of what is shown means the message was
 * replaced rather than grown; that case is adopted immediately, because
 * animating toward text that no longer shares a prefix would show something the
 * Agent never said.
 */
export function useStreamingText(target: string, complete: boolean): string {
  const [reducedMotion, setReducedMotion] = useState(() => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  const [revealed, setRevealed] = useState(complete || reducedMotion ? target : "");
  const revealedRef = useRef(revealed);
  const targetRef = useRef(target);
  const frameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const query = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (query === undefined) return;
    const change = (): void => setReducedMotion(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);

  useEffect(() => {
    targetRef.current = target;
    const replace = complete || reducedMotion || !target.startsWith(revealedRef.current);
    if (replace) {
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
      frameRef.current = undefined;
      revealedRef.current = target;
      setRevealed(target);
      return;
    }
    const tick = (): void => {
      const current = revealedRef.current;
      const pending = targetRef.current.slice(current.length);
      if (pending.length === 0) {
        frameRef.current = undefined;
        return;
      }
      // Match Zed's 16ms/200ms reveal target. Array.from splits by Unicode
      // code point, so CJK and emoji are never cut at a UTF-16 surrogate.
      const next = nextStreamingText(current, targetRef.current);
      revealedRef.current = next;
      setRevealed(next);
      frameRef.current = requestAnimationFrame(tick);
    };
    if (frameRef.current === undefined && revealedRef.current !== target) {
      frameRef.current = requestAnimationFrame(tick);
    }
    return () => {
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
      frameRef.current = undefined;
    };
  }, [complete, reducedMotion, target]);

  return revealed;
}
