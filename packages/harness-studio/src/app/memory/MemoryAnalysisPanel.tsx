import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from '@phosphor-icons/react/X';
import type { MemoryEntry, MemorySnapshot } from '../../contracts/memory.js';
import { AcpComposer } from '../run/AcpComposer.js';
import { AcpSessionSettings } from '../run/AcpSessionSettings.js';
import { FileText } from '@phosphor-icons/react/FileText';
import { AcpSessionStream } from '../run/AcpSessionStream.js';
import { createAcpSessionActions } from '../run/acp-session-actions.js';
import { postAcpRunAction } from '../run/acp-run-actions.js';
import { applyHarnessRunEvent, initialRunState, settleRunState, type HarnessRunState } from '../run/run-store.js';
import { streamRun } from '../run/stream-run.js';

export interface MemoryAcpAgent { id: string; label: string; available: boolean; unavailableReason?: string }
export function MemoryAnalysisPanel({ snapshot, entry, agents, maxBytes, onClose, onReveal }: { snapshot?: MemorySnapshot; entry?: MemoryEntry; agents: MemoryAcpAgent[]; maxBytes: number; onClose: () => void; onReveal: (snapshot: MemorySnapshot, entry?: MemoryEntry) => void }): React.JSX.Element {
  const { t } = useTranslation('common');
  const [draft, setDraft] = useState(t('memory.analysisPlaceholder'));
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string>();
  const input = useRef<HTMLTextAreaElement>(null);
  const sentPrompt = useRef('');
  const [agentId, setAgentId] = useState(() => agents.find(agent => agent.available)?.id ?? '');
  const [state, setState] = useState<HarnessRunState>(initialRunState);
  const stateRef = useRef(state);
  const [frozen, setFrozen] = useState<{ snapshot: MemorySnapshot; entry?: MemoryEntry }>();
  const request = useRef<AbortController | undefined>(undefined);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { input.current?.focus(); return () => request.current?.abort(); }, []);
  const actions = useMemo(() => state.runId ? createAcpSessionActions(state.runId) : undefined, [state.runId]);
  const displayState = useMemo(() => {
    const first = [...state.timelineByKey].find(([, item]) => item.kind === 'message' && item.role === 'user');
    if (!first || first[1].kind !== 'message') return state;
    const timelineByKey = new Map(state.timelineByKey);
    timelineByKey.set(first[0], { ...first[1], content: [{ type: 'text', text: sentPrompt.current || t('memory.analysisRequest', { title: frozen?.entry?.title ?? frozen?.snapshot.document?.metadata.title ?? 'Memory' }) }] });
    return { ...state, timelineByKey };
  }, [state, state.timelineRevision, frozen, t]);
  const active = state.status === 'running';
  const selection = (active ? frozen : undefined) ?? (snapshot ? { snapshot, entry } : undefined);
  const tooLarge = snapshot !== undefined && new TextEncoder().encode(snapshot.content).length > maxBytes;
  async function connect(): Promise<void> {
    if (!snapshot || active || !agentId || tooLarge) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const runId = `memory_${crypto.randomUUID()}`, threadId = `memory_${crypto.randomUUID()}`;
    const fresh: HarnessRunState = { ...initialRunState(), status: 'running', runId, threadId };
    stateRef.current = fresh; setState(fresh); setFrozen({ snapshot, entry });
    const prompt = JSON.stringify({ id: snapshot.documentId, scope: snapshot.scope, digest: snapshot.digest, entryId: entry?.id, authorized: true, agentId });
    try {
      await streamRun('/api/memory/acp/stream', prompt, threadId, runId, undefined, events => {
        if (controller.signal.aborted) return;
        stateRef.current = events.reduce(applyHarnessRunEvent, stateRef.current); setState(stateRef.current);
      }, controller.signal);
    } catch {
      if (!controller.signal.aborted) { stateRef.current = settleRunState({ ...stateRef.current, status: 'error', error: t('memory.acpFailed') }, 'interrupted'); setState(stateRef.current); }
    }
  }
  async function stop(): Promise<void> {
    if (state.runId) await postAcpRunAction(state.runId, 'cancel').catch(() => undefined);
    request.current?.abort();
    stateRef.current = settleRunState({ ...stateRef.current, status: 'finished' }, 'interrupted'); setState(stateRef.current);
  }
  const context = selection && <button className="memory-analysis-source" type="button" title={selection.snapshot.document?.nativeIdentity.path} onClick={() => onReveal(selection.snapshot, selection.entry)}><FileText size={14} aria-hidden="true" /><span>{selection.snapshot.document?.metadata.title}{selection.entry ? ` · ${selection.entry.title}` : ''}</span></button>;
  async function sendInitial(): Promise<void> {
    if (!state.acp.prepared || !actions || sending || !draft.trim()) return;
    setSending(true); setSendError(undefined); sentPrompt.current = draft;
    try { await actions.execute({ action: 'start', prompt: draft }); }
    catch (error) { setSendError(error instanceof Error ? error.message : String(error)); }
    finally { setSending(false); }
  }
  return <aside className="memory-analysis memory-acp-analysis" aria-label={t('memory.aiAnalysis')} onKeyDown={event => { if (event.key === 'Escape' && event.target === close.current) { event.stopPropagation(); onClose(); } }}>
    <div className="memory-analysis-toolbar"><button ref={close} type="button" onClick={onClose} aria-label={t('memory.closeAnalysis')}><X size={15} /></button></div>
    {state.runId ? <AcpSessionStream compact showComposer={false} state={displayState} prompt="" actions={actions} onPermission={(requestId, optionId) => postAcpRunAction(state.runId!, { requestId, optionId })} /> : <div className="memory-analysis-transcript" />}
    <footer className="memory-analysis-composer">
      {active && state.conversation && !state.acp.prepared && actions ? <AcpComposer key={state.runId} compact context={context} state={state} actions={actions} /> : <div className="acp-composer">
        {context}
        <textarea ref={input} rows={3} aria-label={t('memory.analysisInput')} placeholder={t('memory.analysisPlaceholder')} value={draft} maxLength={8192} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void sendInitial(); } }} />
        <div className="acp-composer-actions"><button className="primary" type="button" disabled={!state.acp.prepared || !active || sending || !draft.trim()} onClick={() => void sendInitial()}>{t('memory.sendAnalysis')}</button></div>
      </div>}
      {active && actions && <div className="acp-composer-toolbar"><AcpSessionSettings session={state.acp} runId={state.runId} active={active} actions={actions} /></div>}
      <div className="memory-acp-launcher">
        <select aria-label={t('memory.analysisAgent')} value={agentId} disabled={active} onChange={event => setAgentId(event.target.value)}>{!agents.some(agent => agent.available) && <option value="">{t('memory.analysisUnavailable')}</option>}{agents.map(agent => <option key={agent.id} value={agent.id} disabled={!agent.available}>{agent.label}</option>)}</select>
        {active ? <button type="button" onClick={() => void stop()}>{t('memory.closeSession')}</button> : <button type="button" disabled={!snapshot || !agentId || tooLarge} onClick={() => void connect()}>{t('memory.connectAgent')}</button>}
      </div>
      {sendError && <p role="alert">{sendError}</p>}
      {!active && tooLarge && <p role="status">{t('memory.analysisTooLarge')}</p>}
      {!selection && <p>{t('memory.selectForAnalysis')}</p>}
    </footer>
  </aside>;
}
