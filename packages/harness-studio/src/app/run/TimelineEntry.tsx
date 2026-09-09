import { useSessionOwnedState } from "./session-view-store.js";
import { AcpContent } from "./AcpContent.js";
import { memo, useMemo, useId, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Message, MessageContent } from "../components/ai-elements/message.js";
import { ChainOfThought, ChainOfThoughtContent, ChainOfThoughtHeader } from "../components/ai-elements/chain-of-thought.js";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "../components/ai-elements/tool.js";
import { toolElementState } from "./ai-elements-adapter.js";
import { ArtifactCodeView } from "../code/ArtifactCodeView.js";
import { studioLocale } from "../i18n/index.js";
import { StreamingMessage } from "./StreamingMessage.js";
import { describeToolPayload } from "./tool-call-model.js";
import type { TimelineItem } from "./run-store.js";
type MessageTimelineItem = Extract<TimelineItem, { kind: "message" }>;
type ToolCallTimelineItem = Extract<TimelineItem, { kind: "tool-call" }>;

const MessageEntry = memo(function MessageEntry({ item, persistenceKey, flatThought }: { item: MessageTimelineItem; persistenceKey?: string; flatThought?: boolean }): React.JSX.Element {
  const { t } = useTranslation("run");
  const [expanded, setExpanded] = useSessionOwnedState(persistenceKey ?? `thought:${item.id}`, false);
  const content = item.content?.length ? item.content.map((content, index) => <AcpContent key={index} value={content} />) : <StreamingMessage item={item} />;
  if (item.role === "thought" && flatThought) return <div className="acp-thought" role="group" aria-label={t("session.thinking")} aria-busy={!item.complete}>{content}</div>;
  if (item.role === "thought") return <ChainOfThought className="acp-thought" open={expanded} onOpenChange={setExpanded}>
    <ChainOfThoughtHeader>{t("session.thinking")}</ChainOfThoughtHeader>
    <ChainOfThoughtContent aria-busy={!item.complete}>{content}</ChainOfThoughtContent>
  </ChainOfThought>;
  return <Message className="entry message" from={item.role === "user" ? "user" : "assistant"} aria-label={t(item.role === "user" ? "live.userRequest" : "assistant")}>
    <MessageContent>{content}</MessageContent>
  </Message>;
});

export const ToolCallEntry = memo(function ToolCallEntry({ item, children, richResult = false, persistenceKey, revealToken, filePaths }: { filePaths?: string[]; revealToken?: number; persistenceKey?: string; item: ToolCallTimelineItem; children?: React.ReactNode; richResult?: boolean }): React.JSX.Element {
  const { t } = useTranslation("run");
  const localId = useId();
  const [expanded, setExpanded] = useSessionOwnedState(persistenceKey ?? localId, false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (revealToken === undefined) return;
    setExpanded(true);
    const frame = requestAnimationFrame(() => {
      const header = root.current?.querySelector('button');
      header?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      header?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [revealToken, setExpanded]);
  const argumentsView = useMemo(() => describeToolPayload(item.argsText, t("entry.noArguments")), [item.argsText]);
  const resultView = useMemo(
    () => item.resultText === undefined ? undefined : describeToolPayload(item.resultText, t("entry.emptyResult")),
    [item.resultText],
  );
  return <Tool ref={root} className={`tool-card status-${item.status}`} open={expanded} onOpenChange={setExpanded}>
    <ToolHeader className={filePaths?.length ? "has-file-path" : undefined} title={item.name} state={toolElementState(item.status)} statusLabel={toolStatusLabel(item.status, t)} summary={filePaths?.length ? [...new Set(filePaths)].join(" · ") : argumentsView.summary} />
    <ToolContent className="tool-detail">
      {item.argsText && <ToolInput label={t("entry.arguments")}><ArtifactCodeView mode="source" content={argumentsView.formatted} sourceHint={argumentsView.structured ? "tool-input.json" : "tool-input.txt"} className={argumentsView.structured ? "structured" : ""} label={t("entry.argumentsLabel")} /></ToolInput>}
      {!richResult && <ToolOutput label={t("entry.result")}>{resultView ? <>{item.resultTruncated ? <p className="tool-notice">{item.resultOriginalBytes === undefined ? t("entry.resultTruncated") : t("entry.resultTruncatedFrom", { bytes: item.resultOriginalBytes.toLocaleString(studioLocale()) })}</p> : null}<ArtifactCodeView mode="source" content={resultView.formatted} sourceHint={resultView.structured ? "tool-result.json" : "tool-result.txt"} className={resultView.structured ? "structured" : ""} label={t("entry.resultLabel")} /></> : <p className="tool-empty">{item.status === "running" || item.status === "preparing" ? t("entry.waitingForResult") : item.status === "result-unavailable" ? t("entry.noRetainedResult") : t("entry.noResultPayload")}</p>}</ToolOutput>}
      {children}
      <footer><span>{t("entry.callId")}</span><code title={item.id}>{item.id}</code></footer>
    </ToolContent>
  </Tool>;
});

export const TimelineEntry = memo(function TimelineEntry({ item, persistenceKey, flatThought }: { item: TimelineItem; persistenceKey?: string; flatThought?: boolean }): React.JSX.Element {
  return item.kind === "message" ? <MessageEntry item={item} flatThought={flatThought} persistenceKey={persistenceKey} /> : <ToolCallEntry item={item} persistenceKey={persistenceKey} />;
});

export function toolStatusLabel(status: ToolCallTimelineItem["status"], t: (key: string) => string): string {
  switch (status) {
    case "preparing": return t("toolStatus.preparing");
    case "running": return t("toolStatus.running");
    case "completed": return t("toolStatus.completed");
    case "failed": return t("toolStatus.failed");
    case "result-unavailable": return t("toolStatus.resultUnavailable");
    case "interrupted": return t("toolStatus.interrupted");
  }
}
