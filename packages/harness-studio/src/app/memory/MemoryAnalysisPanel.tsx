import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from '@phosphor-icons/react/X';
import type { MemoryEntry, MemorySnapshot } from '../../contracts/memory.js';
import { AcpSessionStream } from '../run/AcpSessionStream.js';
import { createAcpSessionActions } from '../run/acp-session-actions.js';
import { postAcpRunAction } from '../run/acp-run-actions.js';
import { applyHarnessRunEvent, initialRunState, settleRunState, type HarnessRunState } from '../run/run-store.js';
import { streamRun } from '../run/stream-run.js';

export interface MemoryAcpAgent { id: string; label: string; available: boolean; unavailableReason?: string }
export function MemoryAnalysisPanel({ snapshot, entry, agents, maxBytes, onClose, onReveal }: { snapshot?: MemorySnapshot; entry?: MemoryEntry; agents: MemoryAcpAgent[]; maxBytes: number; onClose: () => void; onReveal: (snapshot: MemorySnapshot, entry?: MemoryEntry) => void }): React.JSX.Element {
  const { t } = useTranslation('common');
  const [agentId, setAgentId] = useState(() => agents.find(agent => agent.available)?.id ?? '');
  const [state, setState] = useState<HarnessRunState>(initialRunState);
  const stateRef = useRef(state);
  const [frozen, setFrozen] = useState<{ snapshot: MemorySnapshot; entry?: MemoryEntry }>();
  const request = useRef<AbortController | undefined>(undefined);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { close.current?.focus(); return () => request.current?.abort(); }, []);
  const actions = useMemo(() => state.runId ? createAcpSessionActions(state.runId) : undefined, [state.runId]);
  const displayState = useMemo(() => {
    const first = [...state.timelineByKey].find(([, item]) => item.kind === 'message' && item.role === 'user');
    if (!first || first[1].kind !== 'message') return state;
    const timelineByKey = new Map(state.timelineByKey);
    timelineByKey.set(first[0], { ...first[1], content: [{ type: 'text', text: t('memory.analysisRequest', { title: frozen?.entry?.title ?? frozen?.snapshot.document?.metadata.title ?? 'Memory' }) }] });
    return { ...state, timelineByKey };
  }, [state, state.timelineRevision, frozen, t]);
  const active = state.status === 'running';
  const selection = frozen ?? (snapshot ? { snapshot, entry } : undefined);
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
  return <aside className="memory-analysis memory-acp-analysis" aria-label={t('memory.aiAnalysis')} onKeyDown={event => { if (event.key === 'Escape' && event.target === close.current) { event.stopPropagation(); onClose(); } }}>
    <header className="memory-analysis-header"><strong>{t('memory.aiAnalysis')}</strong><button ref={close} type="button" onClick={onClose} aria-label={t('memory.closeAnalysis')}><X size={15} /></button></header>
    <div className="memory-acp-launcher">
      {selection && <button className="memory-analysis-source" type="button" title={selection.snapshot.document?.nativeIdentity.path} onClick={() => onReveal(selection.snapshot, selection.entry)}>{selection.entry?.title ?? selection.snapshot.document?.metadata.title}{selection.entry && <small>{t('memory.lines')} {selection.entry.source.startLine}–{selection.entry.source.endLine}</small>}</button>}
      <label>{t('memory.host')}<select aria-label={t('memory.analysisAgent')} value={agentId} disabled={active} onChange={event => setAgentId(event.target.value)}>{!agents.some(agent => agent.available) && <option value="">{t('memory.analysisUnavailable')}</option>}{agents.map(agent => <option key={agent.id} value={agent.id} disabled={!agent.available}>{agent.label}</option>)}</select></label>
      {active ? !state.conversation || !!state.acp.prepared ? <button type="button" onClick={() => void stop()}>{t('memory.closeSession')}</button> : null : snapshot ? tooLarge ? <p role="status">{t('memory.analysisTooLarge')}</p> : <button type="button" className="primary" disabled={!agentId} onClick={() => void connect()}>{t('memory.connectAgent')}</button> : <p>{t('memory.selectForAnalysis')}</p>}
    </div>
    {state.runId && <AcpSessionStream state={displayState} prompt="" actions={actions} onPermission={(requestId, optionId) => postAcpRunAction(state.runId!, { requestId, optionId })} />}
  </aside>;
}
