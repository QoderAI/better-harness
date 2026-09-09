import { useTranslation } from "react-i18next";
import { memo } from "react";
import { useStreamingText } from "./use-streaming-text.js";
import type { TimelineItem } from "./run-store.js";
import { MessageResponse } from "../components/ai-elements/message.js";

const MAX_RESPONSE_CHARACTERS = 4 * 1024 * 1024;
/** Shared first-chunk Markdown rendering for Debugger, Compare and Memory. */
export const StreamingMessage = memo(function StreamingMessage({ item }: { item: Extract<TimelineItem, { kind: "message" }> }): React.JSX.Element {
  const { t } = useTranslation("run");
  const text = useStreamingText(item.text.slice(0, MAX_RESPONSE_CHARACTERS), item.complete);
  return <div className="streaming-message" aria-busy={!item.complete}>
    {item.text.length > MAX_RESPONSE_CHARACTERS && <p className="acp-session-notice">{t("entry.resultTruncated")}</p>}
    <MessageResponse mode={item.complete ? "static" : "streaming"} isAnimating={!item.complete} parseIncompleteMarkdown={!item.complete}>{text}</MessageResponse>
    {!item.complete && <span className="ai-stream-cursor" aria-hidden="true">▌</span>}
  </div>;
});
