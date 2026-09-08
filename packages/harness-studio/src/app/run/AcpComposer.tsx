import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionOwnedState } from "./session-view-store.js";
import type { AcpPromptContent } from "@qoder-ai/harness/exec";
import type { AcpSessionActions } from "./acp-session-actions.js";
import type { HarnessRunState } from "./run-store.js";

export function AcpComposer({ state, actions }: { state: HarnessRunState; actions: AcpSessionActions }): React.JSX.Element {
  const { t } = useTranslation("run");
  const key = `acp-draft:${state.runId}`;
  const [draft, setDraft] = useState(() => { try { return localStorage.getItem(key) ?? ""; } catch { return ""; } });
  const [attachments, setAttachments] = useSessionOwnedState<AcpPromptContent>(`${key}:attachments`, []);
  const [commandIndex, setCommandIndex] = useState(0);
  const [commandsDismissed, setCommandsDismissed] = useState(false);
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
  const commands = !commandsDismissed && draft.startsWith("/") && !draft.includes(" ") ? (state.acp.commands ?? []).filter(command => command.name.startsWith(draft.slice(1))).slice(0, 8) : [];
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
    {!!commands.length && <div className="acp-command-suggestions" role="listbox" aria-label={t("conversation.commands")}>{commands.map((command, index) => <button type="button" role="option" aria-selected={index === commandIndex} key={command.name} onClick={() => { setDraft(`/${command.name} `); input.current?.focus(); }}><strong>/{command.name}</strong><span>{command.description}{command.inputHint ? ` · ${command.inputHint}` : ""}</span></button>)}</div>}
    {!!attachments.length && <ul className="acp-attachments">{attachments.map((block, index) => <li key={index}><span>{block.type === "resource" ? block.resource.uri : t("session.image")}</span><button type="button" aria-label={t("conversation.removeAttachment", { index: index + 1 })} onClick={() => setAttachments(items => items.filter((_, position) => position !== index))}>×</button></li>)}</ul>}
    <textarea ref={input} rows={2} value={draft} aria-label={t("conversation.followup")} placeholder={t("conversation.followup")} disabled={closed}
      onChange={event => { setDraft(event.target.value); setCommandIndex(0); setCommandsDismissed(false); }} onPaste={event => { if (event.clipboardData.files.length) { event.preventDefault(); void attach(event.clipboardData.files); } }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (commands.length && ["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setCommandIndex(index => (index + (event.key === "ArrowDown" ? 1 : commands.length - 1)) % commands.length); return; }
        if (commands.length && event.key === "Escape") { event.preventDefault(); setCommandsDismissed(true); return; }
        if (commands.length && ["Enter", "Tab"].includes(event.key) && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); setDraft(`/${commands[commandIndex % commands.length]!.name} `); return; }
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void send(event.altKey || event.metaKey || event.ctrlKey); } }} />
    <div className="acp-composer-actions">
      {(conversation.capabilities.image || conversation.capabilities.audio || conversation.capabilities.embeddedContext) && <><input ref={file} hidden type="file" multiple onChange={event => void attach(event.target.files)} /><button type="button" disabled={pending || loading || closed} onClick={() => file.current?.click()}>{t(loading ? "conversation.loading" : "conversation.attach")}</button></>}
      <span className="acp-turn-status" role="status">{t(`conversation.status.${conversation.status}`)}</span>
      {generating && <button type="button" disabled={pending} onClick={() => void act(() => actions.execute({ action: "stop" }))}>{t("conversation.stop")}</button>}
      {generating && (!!draft.trim() || attachments.length > 0) && <button type="button" disabled={pending || loading} onClick={() => void send(true)}>{t("conversation.sendNow")}</button>}
      <button className="primary" type="button" disabled={pending || loading || closed || (!draft.trim() && !attachments.length)} onClick={() => void send()}>{t(editing ? "conversation.save" : generating ? "conversation.queue" : "conversation.send")}</button>
      {(!generating || error !== undefined || conversation.status === "cancelling") && !closed && <button type="button" disabled={pending} onClick={() => void act(() => actions.execute({ action: "close" }))}>{t("conversation.close")}</button>}
    </div>
    {conversation.turns.at(-1)?.error && <p className="acp-setting-error" role="alert">{conversation.turns.at(-1)?.error}</p>}
    {conversation.turns.at(-1)?.stopReason && !["end_turn", "error"].includes(conversation.turns.at(-1)!.stopReason!) && <p className="acp-session-notice">{t("conversation.turnStopped", { reason: conversation.turns.at(-1)!.stopReason })}</p>}
    {error && <p className="acp-setting-error" role="alert">{error}</p>}
  </div>;
}
