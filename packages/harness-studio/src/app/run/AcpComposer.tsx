import { observedToolPaths } from "./acp-tool-projection.js";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionOwnedState } from "./session-view-store.js";
import type { AcpPromptContent } from "@qoder-ai/harness/exec";
import type { AcpSessionActions } from "./acp-session-actions.js";
import type { HarnessRunState } from "./run-store.js";
import { Paperclip } from "@phosphor-icons/react/Paperclip";
import { At } from "@phosphor-icons/react/At";
import { Stop } from "@phosphor-icons/react/Stop";
import { FileText } from "@phosphor-icons/react/FileText";
import { X } from "@phosphor-icons/react/X";
import { PromptInput, PromptInputButton, PromptInputFooter, PromptInputHeader, PromptInputSubmit, PromptInputTextarea, PromptInputTools } from "../components/ai-elements/prompt-input.js";
import type { PromptSuggestion } from "../components/ai-elements/prompt-input-model.js";

export function AcpComposer({ state, actions, context, toolbar, compact = false, sessionLabel, agentId }: { state: HarnessRunState; actions: AcpSessionActions; context?: ReactNode; toolbar?: ReactNode; compact?: boolean; sessionLabel?: string; agentId?: string }): React.JSX.Element {
  const { t } = useTranslation("run");
  const key = `acp-draft:${state.runId}`;
  const [draft, setDraft] = useState(() => { try { return localStorage.getItem(key) ?? ""; } catch { return ""; } });
  const [attachments, setAttachments] = useSessionOwnedState<AcpPromptContent>(`${key}:attachments`, []);
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);
  const attempt = useRef<{ signature: string; id: string } | undefined>(undefined);
  const input = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const conversation = state.conversation!;
  const generating = conversation.status === "generating" || conversation.status === "cancelling";
  const closed = conversation.status === "closed";
  const paths = [...new Set([...state.acp.tools.values()].flatMap(observedToolPaths))];
  const mentions: PromptSuggestion[] = paths.map(path => ({ id: `file:${path}`, trigger: "@", label: path, description: t("conversation.observedFile"), value: `@${path}` }));
  for (const block of attachments) if (block.type === "resource") mentions.push({ id: `attachment:${block.resource.uri}`, trigger: "@", label: attachmentLabel(block), description: t("conversation.attachedFile"), value: `@${attachmentLabel(block)}` });
  const canAttach = conversation.capabilities.image || conversation.capabilities.audio || conversation.capabilities.embeddedContext;
  const submitLabel = t(editing ? "conversation.save" : generating ? "conversation.queue" : "conversation.send");
  function insertTrigger(trigger: "/" | "@") {
    const node = input.current;
    if (!node) return;
    const start = node.selectionStart, end = node.selectionEnd;
    const prefix = draft.slice(0, start);
    const separator = trigger === "/" ? (prefix && !prefix.endsWith("\n") ? "\n" : "") : (prefix && !/\s$/u.test(prefix) ? " " : "");
    const next = prefix + separator + trigger;
    setDraft(next + draft.slice(end)); node.focus();
    requestAnimationFrame(() => node.setSelectionRange(next.length, next.length));
  }
  useEffect(() => { try { if (draft) localStorage.setItem(key, draft); else localStorage.removeItem(key); } catch { /* storage may be unavailable */ } }, [draft, key]);
  async function act(operation: () => Promise<unknown>): Promise<boolean> {
    if (busy.current) return false;
    busy.current = true; setPending(true); setError(undefined);
    try { await operation(); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return false; }
    finally { busy.current = false; setPending(false); }
  }
  async function send(immediately = false): Promise<void> {
    if (closed || pending || loading || (!draft.trim() && !attachments.length)) return;
    const content: AcpPromptContent = [...(draft.trim() ? [{ type: "text" as const, text: draft }] : []), ...attachments];
    const signature = JSON.stringify(content);
    if (attempt.current?.signature !== signature) attempt.current = { signature, id: crypto.randomUUID() };
    const previousDraft = draft;
    const previousAttachments = attachments;
    const id = editing ?? attempt.current!.id;
    const ok = await act(() => actions.execute(editing ? { action: "queue-edit", id, content } : { action: "send", id, content, immediately }));
    if (ok) { setDraft(current => current === previousDraft ? "" : current); setAttachments(current => current.filter(block => !previousAttachments.includes(block))); setEditing(undefined); attempt.current = undefined; input.current?.focus(); }
  }
  async function attach(files: FileList | null): Promise<void> {
    if (!files || loading || pending || closed) return;
    setLoading(true); setError(undefined);
    try {
      const blocks: AcpPromptContent = [];
      for (const item of Array.from(files)) {
        if (item.size > 2 * 1024 * 1024) throw new Error(t("conversation.attachmentLimit"));
        if ((item.type.startsWith("image/") && conversation.capabilities.image) || (item.type.startsWith("audio/") && conversation.capabilities.audio)) {
          const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]!); reader.onerror = reject; reader.readAsDataURL(item); });
          blocks.push({ type: item.type.startsWith("audio/") ? "audio" : "image", mimeType: item.type, data });
        } else if (conversation.capabilities.embeddedContext && (item.type.startsWith("text/") || /\.(md|json|js|ts|tsx|py|rs|txt|csv)$/i.test(item.name))) {
          blocks.push({ type: "resource", resource: { uri: `attachment:///${encodeURIComponent(item.name)}`, mimeType: item.type || "text/plain", text: await item.text() } });
        } else throw new Error(t("conversation.unsupportedAttachment"));
      }
      setAttachments(current => [...current, ...blocks]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); if (file.current) file.current.value = ""; }
  }
  return <div className="acp-composer">
    {!!conversation.queue.length && <details className="acp-message-queue" open><summary>{t("conversation.queued", { count: conversation.queue.length })}</summary>
      {conversation.queue.map(item => <div key={item.id}><span>{item.content.map(block => block.type === "text" ? block.text : `[${block.type}]`).join(" ")}</span>
        <button type="button" disabled={pending} onClick={() => { setEditing(item.id); setDraft(item.content.filter(block => block.type === "text").map(block => block.text).join("\n")); setAttachments(item.content.filter(block => block.type !== "text")); input.current?.focus(); }}>{t("conversation.edit")}</button>
        <button type="button" disabled={pending} onClick={() => void act(() => actions.execute({ action: "queue-remove", id: item.id }))}>{t("conversation.remove")}</button></div>)}
      {conversation.queuePaused && <button type="button" disabled={pending} onClick={() => void act(() => actions.execute({ action: "queue-resume" }))}>{t("conversation.resumeQueue")}</button>}
    </details>}
    <PromptInput data-dragging={dragging || undefined} onSubmit={event => { event.preventDefault(); void send(); }}
      onDragOver={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(canAttach && !closed); } }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={event => { event.preventDefault(); setDragging(false); void attach(event.dataTransfer.files); }}>
      {(context || attachments.length > 0) && <PromptInputHeader>
        {context}
        {!!attachments.length && <ul className="acp-attachments">{attachments.map((block, index) => <li key={index}>
          {block.type === "image" ? <img alt="" src={`data:${block.mimeType};base64,${block.data}`} /> : <FileText size={14} aria-hidden="true" />}
          <span title={attachmentLabel(block)}>{attachmentLabel(block)}</span><PromptInputButton aria-label={t("conversation.removeAttachment", { index: index + 1 })} onClick={() => setAttachments(items => items.filter((_, position) => position !== index))}><X size={12} aria-hidden="true" /></PromptInputButton>
        </li>)}</ul>}
      </PromptInputHeader>}
      <PromptInputTextarea ref={input} rows={2} value={draft} onValueChange={setDraft} onSend={immediately => void send(immediately)}
        aria-description={t("conversation.inputKeys")} title={t("conversation.inputKeys")} aria-label={t("conversation.followup")} placeholder={t("conversation.promptPlaceholder")} disabled={closed}
        suggestions={mentions} suggestionLabels={{ mentions: t("conversation.sessionFiles"), empty: t("conversation.noSuggestions"), keyboard: t("conversation.suggestionKeys") }}
        onPaste={event => { if (event.clipboardData.files.length) { event.preventDefault(); void attach(event.clipboardData.files); } }} />
      <PromptInputFooter className="acp-composer-actions">
        <PromptInputTools>
          {canAttach && <><input ref={file} hidden type="file" multiple onChange={event => void attach(event.target.files)} /><PromptInputButton aria-label={t(loading ? "conversation.loading" : "conversation.attach")} data-tooltip={t(loading ? "conversation.loading" : "conversation.attach")} disabled={pending || loading || closed} onClick={() => file.current?.click()}><Paperclip size={16} aria-hidden="true" /></PromptInputButton></>}
          {!!mentions.length && <PromptInputButton aria-label={t("conversation.sessionFiles")} data-tooltip={t("conversation.sessionFiles")} disabled={closed} onClick={() => insertTrigger("@")}><At size={16} aria-hidden="true" /></PromptInputButton>}
          {toolbar}
        </PromptInputTools>
        <div className="ai-prompt-send-actions">
          {generating && <PromptInputButton aria-label={t("conversation.stop")} data-tooltip={t("conversation.stop")} disabled={pending || conversation.status === "cancelling"} onClick={() => void act(() => actions.execute({ action: "stop" }))}><Stop size={16} weight="fill" aria-hidden="true" /></PromptInputButton>}
          <PromptInputSubmit label={submitLabel} state={editing ? "save" : generating ? "queue" : "send"} pending={pending || loading} disabled={pending || loading || closed || (!draft.trim() && !attachments.length)} />
        </div>
      </PromptInputFooter>
    </PromptInput>
    {conversation.turns.at(-1)?.error && <p className="acp-setting-error" role="alert">{conversation.turns.at(-1)?.error}</p>}
    {conversation.turns.at(-1)?.stopReason && !["end_turn", "error"].includes(conversation.turns.at(-1)!.stopReason!) && <p className="acp-session-notice">{t("conversation.turnStopped", { reason: conversation.turns.at(-1)!.stopReason })}</p>}
    {error && <p className="acp-setting-error" role="alert">{error}</p>}
  </div>;
}

function attachmentLabel(block: AcpPromptContent[number]): string {
  if (block.type === "resource") {
    try { return block.resource.uri.startsWith("attachment:///") ? decodeURIComponent(block.resource.uri.slice("attachment:///".length)) : block.resource.uri; } catch { return block.resource.uri; }
  }
  if (block.type === "image" || block.type === "audio") return block.mimeType;
  return block.type;
}
