import { useSessionOwnedState } from "./session-view-store.js";
import { streamRun, type StudioRunProjectBinding } from "./stream-run.js";
import { createAcpSessionActions } from "./acp-session-actions.js";
import { postAcpRunAction } from "./acp-run-actions.js";
import { X } from "@phosphor-icons/react/X";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { parseHarnessRunStreamEventV1 } from "@qoder-ai/harness/protocol";
import { AcpSessionStream } from "./AcpSessionStream.js";
import { applyHarnessRunEvent, initialRunState, type HarnessRunState } from "./run-store.js";

export interface AcpHistoryRecord {
  runId: string;
  prompt: string;
  turnCount: number;
  updatedAt: string;
  agentId?: string;
  canRecover: boolean;
}

interface RetainedSession {
  id: string;
  savedAt: string;
  prompt: string;
  status: "finished" | "error" | "observed";
  toolCallCount: number;
  provider?: string;
}

export async function loadAcpConversation(id: string): Promise<{ prompt: string; state: HarnessRunState; truncated?: boolean }> {
  const response = await fetch(`/api/acp/conversations/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error("unavailable");
  const record = await response.json() as {
    events: Array<{ event: { type?: string }; observedAt: string }>;
    snapshot: NonNullable<HarnessRunState["conversation"]>;
    truncated?: boolean;
    prompt?: string;
  };
  let next = initialRunState();
  for (const [index, item] of record.events.entries()) {
    next = applyHarnessRunEvent(next, parseHarnessRunStreamEventV1({ kind: "HarnessRunStreamEventV1", threadId: id, runId: id, sequence: index + 1, event: item.event }));
    if (item.event.type === "protocol-event" && next.protocolEvents.length) next.protocolEvents.at(-1)!.observedAt = Date.parse(item.observedAt);
  }
  return {
    prompt: record.prompt ?? "",
    truncated: record.truncated,
    state: {
      ...next,
      conversation: { ...record.snapshot, status: "closed" },
      status: "finished",
      pendingPermission: undefined,
      pendingPermissions: [],
      acp: { ...next.acp, partial: record.truncated === true || next.acp.partial, prepared: false, controllable: false },
    },
  };
}

/** Saved observations are deliberately read-only: a disk record is not a live Agent. */
export function AcpConversationHistory({
  project,
  variant = "disclosure",
  refreshKey = 0,
  selectedId,
  onSelect,
  onOpenSession,
  onClose,
}: {
  project?: StudioRunProjectBinding;
  variant?: "disclosure" | "pane";
  refreshKey?: number;
  selectedId?: string;
  onSelect?: (record: AcpHistoryRecord) => void;
  onOpenSession?: (id: string) => void;
  onClose?: () => void;
}): React.JSX.Element {
  const { t } = useTranslation(variant === "pane" ? "compare" : "run");
  const { t: runT } = useTranslation("run");
  const [records, setRecords] = useState<AcpHistoryRecord[]>([]);
  const [sessions, setSessions] = useState<RetainedSession[]>([]);
  const owner = `history:${project?.id ?? "default"}`;
  const [state, setState, live] = useSessionOwnedState<HarnessRunState | undefined>(owner, undefined);
  const [draft, setDraft] = useSessionOwnedState(`${owner}:draft`, "");
  const active = state?.status === "running";
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string>();
  useEffect(() => {
    const abort = new AbortController();
    void fetch("/api/acp/conversations", { signal: abort.signal })
      .then((response) => response.json())
      .then((value) => { if (Array.isArray(value)) setRecords(value as AcpHistoryRecord[]); })
      .catch(() => undefined);
    if (variant === "pane") {
      void fetch("api/sessions", { signal: abort.signal })
        .then((response) => response.ok ? response.json() : { sessions: [] })
        .then((value: { sessions?: RetainedSession[] }) => { if (Array.isArray(value.sessions)) setSessions(value.sessions); })
        .catch(() => undefined);
    }
    return () => abort.abort();
  }, [refreshKey, variant]);

  async function open(id: string): Promise<void> {
    const record = records.find((item) => item.runId === id);
    if (variant === "pane") {
      if (onSelect !== undefined && record !== undefined) onSelect(record);
      return;
    }
    try {
      const loaded = await loadAcpConversation(id);
      setState(loaded.state);
      setPrompt(records.find((item) => item.runId === id)?.prompt || loaded.prompt);
      setError(undefined);
    } catch {
      setError(runT("conversation.historyUnavailable"));
    }
  }

  async function recover(): Promise<void> {
    if (!state?.runId || active || !draft.trim()) return;
    const previous = state;
    const id = crypto.randomUUID();
    setState({ ...initialRunState(), status: "running", runId: id });
    setError(undefined);
    try {
      await streamRun(`api/acp/runs/stream?conversation=1&recover=${encodeURIComponent(previous.runId!)}`, draft, `recovery-${id}`, id, project, (events) => {
        let next = live.current ?? initialRunState();
        for (const event of events) next = applyHarnessRunEvent(next, event);
        setState(next);
        if (next.conversation?.turns.length) setDraft("");
      });
      if (live.current?.error) throw new Error(live.current.error);
    } catch (cause) {
      setState(previous);
      setError(String(cause));
    }
  }

  const list = <div className="acp-history-list">
    {records.length === 0
      ? <p className="acp-history-empty">{variant === "pane" ? t("live.historyEmpty") : runT("connection.empty")}</p>
      : records.map((record) => <button
          type="button"
          key={record.runId}
          disabled={active}
          aria-current={record.runId === selectedId ? "true" : undefined}
          onClick={() => void open(record.runId)}
        >
          <strong>{record.prompt.trim() || record.runId}</strong>
          <span>{variant === "pane" ? t("live.historyTurns", { count: record.turnCount }) : record.turnCount} · {formatHistoryTime(record.updatedAt)}</span>
        </button>)}
  </div>;

  if (variant === "pane") {
    return <aside className="acp-history-pane" aria-label={t("live.historyAria")}>
      <header>
        <strong>{t("live.history")}</strong>
        {onClose && <button type="button" className="acp-history-close" aria-label={t("live.historyHide")} onClick={onClose}><X aria-hidden="true" size={13} /></button>}
      </header>
      <section className="acp-history-section" aria-label={t("live.historyConversations")}>
        <h3>{t("live.historyConversations")}</h3>
        {list}
      </section>
      <section className="acp-history-section" aria-label={t("live.historySessions")}>
        <h3>{t("live.historySessions")}</h3>
        <div className="acp-history-list">
          {sessions.length === 0
            ? <p className="acp-history-empty">{t("live.historySessionsEmpty")}</p>
            : sessions.map((session) => <button
                type="button"
                key={session.id}
                onClick={() => onOpenSession?.(session.id)}
              >
                <strong>{session.prompt.trim() || session.id}</strong>
                <span>{session.provider ?? session.status} · {formatHistoryTime(session.savedAt)}</span>
              </button>)}
        </div>
      </section>
      {error && <p role="alert">{error}</p>}
    </aside>;
  }

  return <details className="acp-conversation-history"><summary>{runT("conversation.history")}</summary>
    {list}
    {error && <p role="alert">{error}</p>}
    {state && <div className="acp-history-transcript"><p>{runT(active ? state.acp.controllable ? "conversation.restored" : "session.settingsConnecting" : "session.settingsReadOnly")}</p><AcpSessionStream state={state} prompt={prompt}
      actions={active && state.runId ? createAcpSessionActions(state.runId) : undefined}
      onPermission={active && state.runId ? (requestId, optionId) => postAcpRunAction(state.runId!, { requestId, optionId }) : undefined} /></div>}
    {state && !active && records.find((record) => record.runId === state.runId)?.canRecover && <form className="acp-history-recover" onSubmit={(event) => { event.preventDefault(); void recover(); }}>
      <input aria-label={runT("conversation.recoveryPrompt")} placeholder={runT("conversation.recoveryPrompt")} value={draft} onChange={(event) => setDraft(event.target.value)} />
      <button type="submit" disabled={!draft.trim()}>{runT("conversation.recover")}</button>
    </form>}
  </details>;
}

function formatHistoryTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}
