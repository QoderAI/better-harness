import { useLayoutEffect, useRef } from "react";
import { useStickToBottomContext } from "use-stick-to-bottom";

const readingPositions = new Map<string, { top: number; following: boolean }>();

/** ACP view persistence around AI Elements' scroll controller. No transport state. */
export function AcpConversationPosition({ sessionKey, turnKey, label }: { sessionKey?: string; turnKey?: string; label: string }): null {
  const { scrollRef, scrollToBottom, stopScroll, state } = useStickToBottomContext();
  const previousTurn = useRef(turnKey);
  useLayoutEffect(() => {
    const list = scrollRef.current;
    if (!list) return;
    list.tabIndex = 0;
    list.setAttribute("aria-label", label);
    const saved = sessionKey ? readingPositions.get(sessionKey) : undefined;
    if (saved && !saved.following) { stopScroll(); list.scrollTop = saved.top; }
    else void scrollToBottom({ animation: "instant" });
    let lastTop = list.scrollTop;
    const save = () => {
      if (sessionKey) readingPositions.set(sessionKey, { top: list.scrollTop, following: state.isAtBottom });
    };
    const onScroll = () => {
      // Incremental rendering can resize in the same frame as an upward scroll.
      // Stop before the library's deferred resize/scroll reconciliation can
      // mistake that user movement for a programmatic adjustment.
      const previousTop = Math.max(lastTop, state.ignoreScrollToTop ?? 0);
      if (list.scrollTop < previousTop && list.scrollHeight - list.scrollTop - list.clientHeight > 24) stopScroll();
      lastTop = list.scrollTop;
      save();
    };
    list.addEventListener("scroll", onScroll, { capture: true });
    return () => { save(); list.removeEventListener("scroll", onScroll, { capture: true }); };
  }, [sessionKey, scrollRef, scrollToBottom, stopScroll, state, label]);
  useLayoutEffect(() => {
    if (previousTurn.current !== turnKey) { previousTurn.current = turnKey; void scrollToBottom({ animation: "instant" }); }
  }, [turnKey, scrollToBottom]);
  return null;
}
