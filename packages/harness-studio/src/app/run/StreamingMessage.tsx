import { parseMarkdown } from "../../contracts/markdown-parser.js";
import { MarkdownBlockView } from "../artifacts/MarkdownArtifactView.js";
import { useTranslation } from "react-i18next";
import { memo, useMemo, useRef } from "react";
import { useStreamingText } from "./use-streaming-text.js";
import type { TimelineItem } from "./run-store.js";

/** Shared assistant text projection for Debugger and Compare. */
export const StreamingMessage = memo(function StreamingMessage({ item }: { item: Extract<TimelineItem, { kind: "message" }> }): React.JSX.Element {
  const { t } = useTranslation("run");
  const root = useRef<HTMLDivElement>(null);
  const text = useStreamingText(item.text, item.complete);
  const parsed = useMemo(() => item.complete ? parseMarkdown(item.text.slice(0, 4 * 1024 * 1024)) : undefined, [item.complete, item.text]);
  if (parsed) return <div className="streaming-message markdown-document" ref={root}>{item.text.length > 4 * 1024 * 1024 && <p className="acp-session-notice">{t("entry.resultTruncated")}</p>}{parsed.diagnostics.some((diagnostic) => diagnostic.level !== "info") && <details className="acp-session-notice"><summary>{t("session.partial")}</summary>{parsed.diagnostics.filter((diagnostic) => diagnostic.level !== "info").map((diagnostic, index) => <p key={index}>{diagnostic.message}</p>)}</details>}{parsed.blocks.map((block, index) => <MarkdownBlockView key={index} block={block} context={{ resources: [], goTo: (slug) => { const heading = [...(root.current?.querySelectorAll<HTMLElement>("[data-md-heading]") ?? [])].find((element) => element.dataset.mdHeading === slug); heading?.scrollIntoView({ block: "nearest" }); } }} />)}</div>;
  return <pre className="streaming-message" aria-busy={!item.complete}>{text}{!item.complete && <span aria-hidden="true"> ▌</span>}</pre>;
});
