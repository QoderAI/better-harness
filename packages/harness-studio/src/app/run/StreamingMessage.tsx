import { memo } from "react";
import { useStreamingText } from "./use-streaming-text.js";
import type { TimelineItem } from "./run-store.js";

/** Shared assistant text projection for Debugger and Compare. */
export const StreamingMessage = memo(function StreamingMessage({ item }: { item: Extract<TimelineItem, { kind: "message" }> }): React.JSX.Element {
  const text = useStreamingText(item.text, item.complete);
  return <pre className="streaming-message" aria-busy={!item.complete}>{text}{!item.complete && <span aria-hidden="true"> ▌</span>}</pre>;
});
