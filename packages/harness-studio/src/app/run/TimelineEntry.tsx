import { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Wrench } from "@phosphor-icons/react/Wrench";
import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { ArtifactCodeView } from "../code/ArtifactCodeView.js";
import { studioLocale } from "../i18n/index.js";
import { StreamingMessage } from "./StreamingMessage.js";
import { describeToolPayload } from "./tool-call-model.js";
import type { TimelineItem } from "./run-store.js";
type MessageTimelineItem = Extract<TimelineItem, { kind: "message" }>;
type ToolCallTimelineItem = Extract<TimelineItem, { kind: "tool-call" }>;

const MessageEntry = memo(function MessageEntry({ item }: { item: MessageTimelineItem }): React.JSX.Element {
  const { t } = useTranslation("run");
  if (item.role === "thought") return <details className="acp-thought"><summary>{t("session.thinking")}</summary><StreamingMessage item={item} /></details>;
  return <div className="entry message"><span className="entry-tag">{t("assistant")}</span><StreamingMessage item={item} /></div>;
});

export const ToolCallEntry = memo(function ToolCallEntry({ item }: { item: ToolCallTimelineItem }): React.JSX.Element {
  const { t } = useTranslation("run");
  const [expanded, setExpanded] = useState(false);
  const argumentsView = useMemo(() => describeToolPayload(item.argsText, t("entry.noArguments")), [item.argsText]);
  const resultView = useMemo(
    () => item.resultText === undefined ? undefined : describeToolPayload(item.resultText, t("entry.emptyResult")),
    [item.resultText],
  );
  return <details className={`tool-card status-${item.status}`} onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary>
      <span className="tool-icon" aria-hidden="true"><Wrench size={15} weight="bold" /></span>
      <span className="tool-title"><small>{t("toolCall")}</small><strong>{item.name}</strong><code>{argumentsView.summary}</code></span>
      <span className="tool-status" aria-live="polite">{toolStatusLabel(item.status, t)}</span>
      <CaretDown className="tool-chevron" size={14} aria-hidden="true" />
    </summary>
    {expanded && <div className="tool-detail">
      <section><h4>{t("entry.arguments")}</h4><ArtifactCodeView mode="source" content={argumentsView.formatted} sourceHint={argumentsView.structured ? "tool-input.json" : "tool-input.txt"} className={argumentsView.structured ? "structured" : ""} label={t("entry.argumentsLabel")} /></section>
      <section><h4>{t("entry.result")}</h4>{resultView ? <>{item.resultTruncated ? <p className="tool-notice">{item.resultOriginalBytes === undefined ? t("entry.resultTruncated") : t("entry.resultTruncatedFrom", { bytes: item.resultOriginalBytes.toLocaleString(studioLocale()) })}</p> : null}<ArtifactCodeView mode="source" content={resultView.formatted} sourceHint={resultView.structured ? "tool-result.json" : "tool-result.txt"} className={resultView.structured ? "structured" : ""} label={t("entry.resultLabel")} /></> : <p className="tool-empty">{item.status === "running" || item.status === "preparing" ? t("entry.waitingForResult") : item.status === "result-unavailable" ? t("entry.noRetainedResult") : t("entry.noResultPayload")}</p>}</section>
      <footer><span>{t("entry.callId")}</span><code title={item.id}>{item.id}</code></footer>
    </div>}
  </details>;
});

export const TimelineEntry = memo(function TimelineEntry({ item }: { item: TimelineItem }): React.JSX.Element {
  return item.kind === "message" ? <MessageEntry item={item} /> : <ToolCallEntry item={item} />;
});

function toolStatusLabel(status: ToolCallTimelineItem["status"], t: (key: string) => string): string {
  switch (status) {
    case "preparing": return t("toolStatus.preparing");
    case "running": return t("toolStatus.running");
    case "completed": return t("toolStatus.completed");
    case "failed": return t("toolStatus.failed");
    case "result-unavailable": return t("toolStatus.resultUnavailable");
    case "interrupted": return t("toolStatus.interrupted");
  }
}
