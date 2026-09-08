import { useSessionOwnedState } from "./session-view-store.js";
import { streamRun, type StudioRunProjectBinding } from "./stream-run.js";
import { createAcpSessionActions } from "./acp-session-actions.js";
import { postAcpRunAction } from "./acp-run-actions.js";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { parseHarnessRunStreamEventV1 } from "@qoder-ai/harness/protocol";
import { AcpSessionStream } from "./AcpSessionStream.js";
import { applyHarnessRunEvent, initialRunState, type HarnessRunState } from "./run-store.js";

/** Saved observations are deliberately read-only: a disk record is not a live Agent. */
export function AcpConversationHistory({ project }: { project?: StudioRunProjectBinding }): React.JSX.Element {
  const { t } = useTranslation("run");
  const [records, setRecords] = useState<Array<{ runId: string; prompt: string; turnCount: number; updatedAt: string; agentId?: string; canRecover: boolean }>>([]);
  const owner = `history:${project?.id ?? "default"}`;
  const [state, setState, live] = useSessionOwnedState<HarnessRunState | undefined>(owner, undefined);
  const [draft, setDraft] = useSessionOwnedState(`${owner}:draft`, "");
  const active = state?.status === "running";
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string>();
  useEffect(() => { const abort = new AbortController(); void fetch("/api/acp/conversations", { signal: abort.signal }).then(response => response.json()).then(value => { if (Array.isArray(value)) setRecords(value); }).catch(() => undefined); return () => abort.abort(); }, []);
  async function open(id: string): Promise<void> {
    try {
      const response = await fetch(`/api/acp/conversations/${encodeURIComponent(id)}`);
      if (!response.ok) throw new Error(t("conversation.historyUnavailable"));
      const record = await response.json();
      let next = initialRunState();
      for (const [index, item] of record.events.entries()) {
        next = applyHarnessRunEvent(next, parseHarnessRunStreamEventV1({ kind: "HarnessRunStreamEventV1", threadId: id, runId: id, sequence: index + 1, event: item.event }));
        if (item.event.type === "protocol-event" && next.protocolEvents.length) next.protocolEvents.at(-1)!.observedAt = Date.parse(item.observedAt);
      }
      setState({ ...next, conversation: { ...record.snapshot, status: "closed" }, status: "finished", pendingPermission: undefined, pendingPermissions: [], acp: { ...next.acp, partial: record.truncated === true || next.acp.partial, prepared: false, controllable: false } });
      setPrompt(records.find(item => item.runId === id)?.prompt ?? ""); setError(undefined);
    } catch (cause) { setError(String(cause)); }
  }
  async function recover(): Promise<void> {
    if (!state?.runId || active || !draft.trim()) return;
    const previous = state;
    const id = crypto.randomUUID();
    setState({ ...initialRunState(), status: "running", runId: id }); setError(undefined);
    try {
      await streamRun(`api/acp/runs/stream?conversation=1&recover=${encodeURIComponent(previous.runId!)}`, draft, `recovery-${id}`, id, project, events => {
        let next = live.current ?? initialRunState();
        for (const event of events) next = applyHarnessRunEvent(next, event);
        setState(next);
        if (next.conversation?.turns.length) setDraft("");
      });
      if (live.current?.error) throw new Error(live.current.error);
    } catch (cause) { setState(previous); setError(String(cause)); }
  }
  return <details className="acp-conversation-history"><summary>{t("conversation.history")}</summary>
    <div className="acp-history-list">{records.map(record => <button type="button" key={record.runId} disabled={active} onClick={() => void open(record.runId)}><strong>{record.prompt}</strong><span>{record.turnCount} · {record.updatedAt}</span></button>)}</div>
    {error && <p role="alert">{error}</p>}
    {state && <div className="acp-history-transcript"><p>{t(active ? state.acp.controllable ? "conversation.restored" : "session.settingsConnecting" : "session.settingsReadOnly")}</p><AcpSessionStream state={state} prompt={prompt}
      actions={active && state.runId ? createAcpSessionActions(state.runId) : undefined}
      onPermission={active && state.runId ? (requestId, optionId) => postAcpRunAction(state.runId!, { requestId, optionId }) : undefined} /></div>}
    {state && !active && records.find(record => record.runId === state.runId)?.canRecover && <form className="acp-history-recover" onSubmit={event => { event.preventDefault(); void recover(); }}>
      <input aria-label={t("conversation.recoveryPrompt")} placeholder={t("conversation.recoveryPrompt")} value={draft} onChange={event => setDraft(event.target.value)} />
      <button type="submit" disabled={!draft.trim()}>{t("conversation.recover")}</button>
    </form>}
  </details>;
}
