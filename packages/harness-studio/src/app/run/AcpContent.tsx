import { StreamingMessage } from "./StreamingMessage.js";
import { createContext, useContext } from "react";
import type { AcpSessionState } from "./acp-session-state.js";
export const AcpTerminalContext = createContext<AcpSessionState["terminals"]>(undefined);
import { useTranslation } from "react-i18next";
import { recordValue } from "./acp-session-state.js";
import { ArtifactCodeView } from "../code/ArtifactCodeView.js";

export function safeAcpLink(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try { const url = new URL(value); return ["https:", "http:", "mailto:"].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
}
/** Content is untrusted protocol data. Render nodes, never injected HTML. */
export function AcpContent({ value }: { value: unknown }): React.JSX.Element {
  const { t } = useTranslation("run");
  const terminals = useContext(AcpTerminalContext);
  const block = recordValue(value);
  if (block?.type === "content") return <AcpContent value={block.content} />;
  if (block?.type === "text" && typeof block.text === "string") return <StreamingMessage item={{ kind: "message", id: "content", text: block.text, complete: true }} />;
  if (block?.type === "diff" && typeof block.path === "string" && typeof block.newText === "string") return <section className="acp-content-diff"><strong>{block.path}</strong><ArtifactCodeView mode="diff" label={t("session.diff")} diff={{ path: block.path, beforeStart: 1, afterStart: 1, before: typeof block.oldText === "string" ? block.oldText.split("\n") : [], after: block.newText.split("\n") }} /></section>;
  if ((block?.type === "image" || block?.type === "audio") && typeof block.data === "string" && typeof block.mimeType === "string") {
    const image = block.type === "image" && /^image\/(png|jpeg|gif|webp|avif)$/.test(block.mimeType);
    const audio = block.type === "audio" && /^audio\/(mpeg|mp3|ogg|wav|webm|flac|mp4)$/.test(block.mimeType);
    if (block.data.length <= 4 * 1024 * 1024 && /^[a-zA-Z0-9+/=\r\n]+$/.test(block.data)) {
      const src = `data:${block.mimeType};base64,${block.data}`;
      if (image) return <img className="acp-content-image" src={src} alt={t("session.image")} loading="lazy" />;
      if (audio) return <audio controls preload="none" src={src} aria-label={t("session.audio")} />;
    }
  }
  if (block?.type === "resource_link") {
    const link = safeAcpLink(block.uri);
    const name = typeof block.title === "string" ? block.title : typeof block.name === "string" ? block.name : String(block.uri ?? "");
    return <p className="acp-resource">{link ? <a href={link} target="_blank" rel="noopener noreferrer">{name}</a> : <strong>{name}</strong>}<code>{String(block.uri ?? "")}</code>{typeof block.description === "string" && <span>{block.description}</span>}</p>;
  }
  if (block?.type === "resource") {
    const resource = recordValue(block.resource);
    if (typeof resource?.text === "string") return <section><strong>{String(resource.uri ?? "")}</strong><ArtifactCodeView mode="source" sourceHint={String(resource.uri ?? "resource.txt")} content={resource.text} label={t("session.resource")} /></section>;
  }
  if (block?.type === "terminal") {
    const id = String(block.terminalId ?? "");
    const terminal = terminals?.get(id);
    return <section className="acp-terminal"><strong>{t("session.terminal", { id })}</strong>
      {terminal?.output !== undefined ? <pre>{terminal.output}</pre> : <p>{t("session.terminalPending")}</p>}
      {terminal?.truncated && <p>{t("entry.resultTruncated")}</p>}
      {terminal?.exitCode !== undefined && <p>{t("session.terminalExit", { code: terminal.exitCode })}</p>}
      {terminal?.signal && <p>{terminal.signal}</p>}
    </section>;
  }
  return <details className="acp-content-fallback"><summary>{t("session.contentFallback", { type: String(block?.type ?? "unknown") })}</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>;
}
