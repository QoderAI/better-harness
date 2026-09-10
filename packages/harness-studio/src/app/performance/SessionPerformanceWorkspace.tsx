import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from '@phosphor-icons/react/ArrowLeft';
import { ArrowClockwise } from '@phosphor-icons/react/ArrowClockwise';
import { ChatText } from '@phosphor-icons/react/ChatText';
import { PerformanceSourceView } from './PerformanceSourceView.js';
import { SessionTranscriptPane } from './SessionTranscriptPane.js';
import { StorageReport } from './StorageReport.js';
import { ToolbarActions } from '../shell/ToolbarActions.js';
import { X } from '@phosphor-icons/react/X';
import type { PerformanceCatalog, PerformanceDetail, TimingEvidence } from '../../contracts/session-performance.js';
import type { StudioConfig } from '../studio-shell-model.js';
import { withinDateRange, type StudioDateRange } from '../date-range.js';

export function timingDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
  if (ms < 3600000) { const seconds = Math.round(ms / 1000); return `${Math.floor(seconds / 60)} m ${seconds % 60} s`; }
  return `${(ms / 3600000).toFixed(2)} h`;
}
const params = (): URLSearchParams => new URLSearchParams(globalThis.location.hash.split('?')[1] ?? '');
function saveFilter(key: string, value: string): void {
  const query = params(); if (value) query.set(key, value); else query.delete(key);
  globalThis.history.replaceState(null, '', `${globalThis.location.hash.split('?')[0]}${query.size ? `?${query}` : ''}`);
}
function routeSelection(id: string | null): void {
  const query = params();
  if (id) query.set('session', id); else query.delete('session');
  query.delete('turn'); query.delete('kind');
  const hash = `${globalThis.location.hash.split('?')[0]}${query.size ? `?${query}` : ''}`;
  globalThis.location.hash = hash;
}
const date = (ms: number | null | undefined): string => ms === null || ms === undefined ? '—' : new Date(ms).toLocaleString();

/** Only counts this one interval recorded; an absent count stays absent. */
const TOKEN_FACTS: [string, string][] = [['usageInput', 'inputTokens'], ['usageOutput', 'outputTokens'],
  ['usageReasoning', 'reasoningTokens'], ['usageCacheRead', 'cacheReadTokens'], ['usageCacheWrite', 'cacheCreationTokens']];
function tokenFacts(facts: Record<string, string | number | boolean | null>): [string, number][] {
  return TOKEN_FACTS.flatMap(([term, key]) => typeof facts[key] === 'number' && Number.isFinite(facts[key])
    ? [[term, facts[key]] as [string, number]] : []);
}

export default function SessionPerformanceWorkspace({ config, dateRange }: { config: StudioConfig; dateRange: StudioDateRange }): React.JSX.Element {
  const { t } = useTranslation('performance');
  const [catalog, setCatalog] = useState<PerformanceCatalog>();
  const [detail, setDetail] = useState<PerformanceDetail>();
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [selection, setSelection] = useState(() => params().get('session'));
  const [query, setQuery] = useState(() => params().get('q') ?? '');
  const [sort, setSort] = useState(() => params().get('sort') ?? 'longest');
  const [providerFilter, setProviderFilter] = useState(() => params().get('provider') ?? 'all');
  const [catalogWidth, setCatalogWidth] = useState(() => {
    try { const stored = globalThis.localStorage?.getItem('performance.catalogWidth'); const n = stored ? Number(stored) : NaN; return Number.isFinite(n) && n >= 180 && n <= 600 ? n : 260; } catch { return 260; }
  });
  const [resizing, setResizing] = useState(false);
  const workspaceRef = useRef<HTMLElement>(null);
  const [turnId, setTurnId] = useState('');
  const [kind, setKind] = useState('all');
  const [spanId, setSpanId] = useState<string>();
  const [transcriptOpen, setTranscriptOpen] = useState(() => params().get('transcript') === 'open');
  const [sourceRecord, setSourceRecord] = useState<TimingEvidence>();
  const sourceOpener = useRef<HTMLElement | null>(null);
  const [page, setPage] = useState(0);
  const [spanPage, setSpanPage] = useState(0);
  const detailRef = useRef<HTMLElement>(null);
  const evidenceRef = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const headers = useMemo(() => ({ 'x-harness-project-id': config.activeProjectId ?? '', 'x-harness-project-revision': String(config.projectRevision ?? 0) }), [config.activeProjectId, config.projectRevision]);
  useEffect(() => { const listener = (): void => { const query = params(); setSelection(query.get('session')); setQuery(query.get('q') ?? ''); setSort(query.get('sort') ?? 'longest'); setProviderFilter(query.get('provider') ?? 'all'); setSpanId(undefined); }; globalThis.addEventListener('hashchange', listener); return () => globalThis.removeEventListener('hashchange', listener); }, []);
  useEffect(() => { if (!resizing) return; const onMove = (e: PointerEvent): void => { const rect = workspaceRef.current?.getBoundingClientRect(); if (!rect) return; setCatalogWidth(Math.max(180, Math.min(600, e.clientX - rect.left))); }; const onUp = (): void => setResizing(false); window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); document.body.classList.add('performance-resizing'); return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); document.body.classList.remove('performance-resizing'); }; }, [resizing]);
  useEffect(() => { try { globalThis.localStorage?.setItem('performance.catalogWidth', String(catalogWidth)); } catch {} }, [catalogWidth]);
  useEffect(() => {
    const controller = new AbortController(); setError(''); setCatalog(undefined);
    fetch(`api/session-performance${refresh ? '?refresh=true' : ''}`, { headers, signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(response.status === 503 ? 'unavailable' : 'error'); return await response.json() as PerformanceCatalog; })
      .then(setCatalog).catch(e => { if (!controller.signal.aborted) setError(e.message === 'unavailable' ? 'unavailable' : 'error'); });
    return () => controller.abort();
  }, [headers, refresh]);
  const providers = useMemo(() => [...new Set((catalog?.sessions ?? []).map(s => s.provider).filter((p): p is string => !!p))].sort(), [catalog]);
  const sessions = useMemo(() => (catalog?.sessions ?? []).filter(s => (providerFilter === 'all' || s.provider === providerFilter)
    && withinDateRange(s.lastActivityMs === null ? undefined : new Date(s.lastActivityMs).toISOString(), dateRange)
    && `${s.label} ${s.id}`.toLowerCase().includes(query.toLowerCase())).sort((a,b) => sort === 'recent' ? (b.lastActivityMs ?? 0) - (a.lastActivityMs ?? 0) : b.breakdown.totalMs - a.breakdown.totalMs), [catalog, dateRange, query, sort, providerFilter]);
  const selectedId = selection ?? sessions[0]?.id;
  function chooseSession(id: string): void { routeSelection(id); setSelection(id); requestAnimationFrame(() => detailRef.current?.focus()); }
  useEffect(() => { setPage(0); }, [query, sort, dateRange, providerFilter]);
  useEffect(() => {
    setDetail(undefined); setSpanId(undefined); setDetailError(false); setKind(params().get('kind') ?? 'all'); setSpanPage(0);
    if (!selectedId || !catalog) return;
    const controller = new AbortController();
    fetch(`api/session-performance/${encodeURIComponent(selectedId)}${refresh ? '?refresh=true' : ''}`, { headers, signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error('detail'); return await response.json() as PerformanceDetail; })
      .then(value => { setDetail(value); const longest = [...value.turns].filter(turn => !turn.isSubagent && turn.durationMs !== null).sort((a,b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))[0]; const retained = params().get('turn'); setTurnId(retained === 'all' || value.turns.some(turn => turn.id === retained) ? retained! : longest?.id ?? 'all'); })
      .catch(() => { if (!controller.signal.aborted) setDetailError(true); });
    return () => controller.abort();
  }, [selectedId, headers, catalog, refresh]);
  useEffect(() => { setSpanPage(0); }, [kind, turnId]);
  const selectedTurn = detail?.turns.find(turn => turn.id === turnId);
  const rows = (detail?.spans ?? []).filter(span => (kind === 'all' || span.kind === kind)
    && (!selectedTurn || span.turnId === selectedTurn.label || (span.startMs !== null && span.endMs !== null && span.startMs <= (selectedTurn.endMs ?? selectedTurn.startMs) && span.endMs >= selectedTurn.startMs)));
  useEffect(() => { setSourceRecord(undefined); }, [spanId, detail]);
  const closeSource = (): void => { setSourceRecord(undefined); requestAnimationFrame(() => sourceOpener.current?.focus()); };
  const selectedSpan = detail?.spans.find(span => span.id === spanId);
  // The recorded invocation id is the only key both projections share, so it is
  // what makes a timing interval and a retained call the same observation.
  const spansByCall = useMemo(() => {
    const index = new Map<number, string>();
    for (const span of detail?.spans ?? []) {
      if (!['tool', 'shell', 'subagent'].includes(span.kind) || span.startMs === null) continue;
      if (!index.has(span.startMs)) index.set(span.startMs, span.id);
    }
    return index;
  }, [detail]);
  const activeCallStartMs = selectedSpan?.startMs ?? undefined;
  const toggleTranscript = (): void => setTranscriptOpen(open => { saveFilter('transcript', open ? '' : 'open'); return !open; });
  const start = selectedTurn?.startMs ?? detail?.session.firstSeenMs ?? 0;
  const end = selectedTurn?.endMs ?? detail?.session.lastActivityMs ?? detail?.session.lastSeenMs ?? start;
  const scale = Math.max(1, end - start);
  const selectSpan = (id: string): void => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setSpanId(id); };
  const closeEvidence = (): void => { setSpanId(undefined); requestAnimationFrame(() => opener.current?.isConnected ? opener.current.focus() : detailRef.current?.focus()); };
  useEffect(() => { if (selectedSpan) evidenceRef.current?.focus(); }, [selectedSpan?.id]);
  useEffect(() => { if (providerFilter !== 'all' && detail?.session.provider && detail.session.provider !== providerFilter && sessions.length > 0) { chooseSession(sessions[0].id); } }, [providerFilter, detail?.session.provider, sessions, chooseSession]);
  const summary = detail?.session;
  const metricLabel = (name: string): string => t(`kinds.${name}`, { defaultValue: name });
  const paged = <T,>(items: T[], index: number, size: number): T[] => items.slice(index * size, (index + 1) * size);
  function pager(index: number, length: number, size: number, change: (index: number) => void): React.JSX.Element | null {
    const total = Math.max(1, Math.ceil(length / size));
    return total <= 1 ? null : <div className="performance-pager"><button disabled={index === 0} onClick={() => change(index - 1)}>{t('previous')}</button><span>{t('page', { page: index + 1, total })}</span><button disabled={index + 1 >= total} onClick={() => change(index + 1)}>{t('next')}</button></div>;
  }
  const transcriptShown = transcriptOpen && !!selectedId && !!detail;
  return <><ToolbarActions>
    <button className="performance-transcript-toggle" aria-pressed={transcriptOpen} disabled={!selectedId} onClick={toggleTranscript} aria-label={t('transcript')}><ChatText aria-hidden="true" size={16} />{t('transcript')}</button>
    <button className="performance-refresh" disabled={!catalog && !error} onClick={() => setRefresh(value => value + 1)} aria-label={t('refresh')}><ArrowClockwise aria-hidden="true" size={16} />{t('refresh')}</button>
  </ToolbarActions>
  <section ref={workspaceRef} style={{ '--performance-catalog-width': `${catalogWidth}px` } as CSSProperties} className={`performance-workspace${selection ? ' performance-has-session' : ''}${selectedSpan ? ' performance-has-evidence' : ''}${sourceRecord ? ' performance-has-source' : ''}${transcriptShown ? ' performance-has-transcript' : ''}${resizing ? ' performance-resizing' : ''}`} aria-label={t('title')}>
    {error ? <p className="performance-state" role="alert">{t(error === 'unavailable' ? 'unavailable' : 'error')}</p> : !catalog ? <p className="performance-state" role="status">{t('loading')}</p> : <div className="performance-panes">
      <aside className="performance-catalog" aria-label={t('sessions')}>
        <div className="performance-filters"><input aria-label={t('search')} placeholder={t('search')} value={query} onChange={event => { setQuery(event.target.value); saveFilter('q', event.target.value); }} /><select aria-label={t('sort')} value={sort} onChange={event => { setSort(event.target.value); saveFilter('sort', event.target.value); }}><option value="longest">{t('longest')}</option><option value="recent">{t('recent')}</option></select>{providers.length > 0 && <select aria-label={t('provider')} value={providerFilter} onChange={event => { setProviderFilter(event.target.value); saveFilter('provider', event.target.value); }}><option value="all">{t('allProviders')}</option>{providers.map(provider => <option key={provider} value={provider}>{provider}</option>)}</select>}</div>
        <div className="performance-session-list">{sessions.length === 0 && <p className="performance-state">{t('empty')}</p>}{paged(sessions, page, 40).map(session => <button className="performance-session" key={session.id} aria-current={session.id === selectedId ? 'true' : undefined} onClick={() => chooseSession(session.id)}>
          <span><strong>{session.label}</strong><b>{timingDuration(session.breakdown.totalMs)}</b></span><small>{date(session.lastActivityMs)}</small>
        </button>)}</div>
        {pager(page, sessions.length, 40, setPage)}{catalog.coverage.omittedSessions > 0 && <p className="performance-note">{t('omitted', { count: catalog.coverage.omittedSessions })}</p>}
      </aside>
      <div className="performance-sash" role="separator" aria-label={t('resize')} onPointerDown={() => setResizing(true)} />
      <main className="performance-analysis" tabIndex={-1} ref={detailRef} aria-label={t('title')}>
        <button className="performance-back" onClick={() => { routeSelection(null); setSelection(null); }}><ArrowLeft aria-hidden="true" size={15} />{t('back')}</button>
        {detailError ? <p className="performance-state" role="alert">{t('error')}</p> : !detail ? <p className="performance-state" role="status">{selectedId ? t('loading') : t('select')}</p> : summary && <>
          {summary.status === 'no-evidence' && <p className="performance-state" role="status">{t('agentUnsupported')}</p>}
          <StorageReport key={summary.id} detail={detail} onSelect={selectSpan} />
          <details className="storage-events"><summary>{t('eventDetails')}</summary>
          <section className="performance-intervals"><div className="performance-toolbar"><h3>{t('timeline')}</h3><label>{t('turn')}<select aria-label={t('turn')} value={turnId} onChange={event => { setTurnId(event.target.value); saveFilter('turn', event.target.value); }}><option value="all">{t('allTurns')}</option>{detail.turns.map((turn, index) => <option key={turn.id} value={turn.id}>{index + 1} · {t(turn.isSubagent ? 'child' : 'root')} · {timingDuration(turn.durationMs)}</option>)}</select></label><label>{t('category')}<select aria-label={t('category')} value={kind} onChange={event => { setKind(event.target.value); saveFilter('kind', event.target.value); }}><option value="all">{t('all')}</option>{[...new Set(detail.spans.map(s => s.kind))].map(value => <option key={value} value={value}>{metricLabel(value)}</option>)}</select></label></div>
            <div className="performance-metrics">{summary.metrics.map(metric => <button aria-pressed={kind === metric.kind} key={metric.kind} onClick={() => { const next = kind === metric.kind ? 'all' : metric.kind; setKind(next); saveFilter('kind', next); }}><span>{metricLabel(metric.kind)} · {metric.count}</span><strong>{timingDuration(metric.durationMs)}</strong></button>)}</div>
            <div className="performance-axis"><span>{date(start)}</span><span>+{timingDuration(scale)}</span></div>
            <div className="performance-span-list">{rows.length === 0 && <p className="performance-note">{t('noSpans')}</p>}{paged(rows, spanPage, 80).map(span => {
              const left = Math.max(0, Math.min(100, ((span.startMs ?? span.endMs ?? start) - start) / scale * 100));
              const width = Math.max(0.4, Math.min(100 - left, ((span.endMs ?? span.startMs ?? start) - Math.max(start, span.startMs ?? start)) / scale * 100));
              return <button key={span.id} className={`performance-span kind-${span.kind}`} aria-pressed={spanId === span.id} onClick={() => selectSpan(span.id)}>
                <span className="performance-span-label"><strong>{span.label || metricLabel(span.kind)}</strong><small>{metricLabel(span.kind)}{span.status !== 'complete' ? ` · ${t(`statuses.${span.status}`, { defaultValue: span.status })}` : ''}</small></span>
                <span className="performance-track" aria-hidden="true"><i style={{ left: `${left}%`, width: `${width}%` }} /></span><b>{timingDuration(span.durationMs)}</b>
              </button>;
            })}</div>{pager(spanPage, rows.length, 80, setSpanPage)}
          </section>
          </details>
        </>}
      </main>
      {transcriptShown && <SessionTranscriptPane
        sessionId={selectedId}
        {...(activeCallStartMs === undefined ? {} : { activeCallStartMs })}
        linkedCallStartMs={new Set(spansByCall.keys())}
        onSelectCall={at => { const span = spansByCall.get(at); if (span) selectSpan(span); }}
        onClose={toggleTranscript}
      />}
      {selectedSpan && <aside className="performance-evidence" aria-label={t('evidence')} tabIndex={-1} ref={evidenceRef} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); closeEvidence(); } }}>
        <div className="performance-toolbar"><h3>{t('evidence')}</h3><button aria-label={t('close')} onClick={closeEvidence}><X aria-hidden="true" size={15} /></button></div>
        <button className="performance-evidence-back" onClick={closeEvidence}><ArrowLeft aria-hidden="true" size={15} />{t('backDetail')}</button>
        {sourceRecord && <PerformanceSourceView key={`${sourceRecord.source}:${sourceRecord.line}`} sessionId={selectedId!} record={sourceRecord} headers={headers} onClose={closeSource} />}<div hidden={!!sourceRecord}>
        <section className="storage-summary performance-evidence-head">
          <div className="storage-title"><h2>{selectedSpan.label || metricLabel(selectedSpan.kind)}</h2><span><strong>{timingDuration(selectedSpan.durationMs)}</strong><small>{metricLabel(selectedSpan.kind)}</small></span></div>
          {typeof selectedSpan.facts.callSummary === 'string' && <pre className="performance-call-summary">{selectedSpan.facts.callSummary}</pre>}
        </section>
        {tokenFacts(selectedSpan.facts).length > 0 && <dl className="storage-usage-facts performance-evidence-tokens">{tokenFacts(selectedSpan.facts).map(([key, value]) => <div key={key}><dt>{t(key)}</dt><dd>{value.toLocaleString()}</dd></div>)}</dl>}
        <dl className="performance-facts">{[['category', metricLabel(selectedSpan.kind)], ['status', t(`statuses.${selectedSpan.status}`, { defaultValue: selectedSpan.status })], ['basis', t(`bases.${selectedSpan.basis}`, { defaultValue: selectedSpan.basis })], ['start', date(selectedSpan.startMs)], ['end', date(selectedSpan.endMs)], ['relationship', selectedSpan.relationship ? t(`relationships.${selectedSpan.relationship}`, { defaultValue: selectedSpan.relationship }) : t('unknownValue')]].map(([key,value]) => <div key={key}><dt>{t(key!)}</dt><dd>{value}</dd></div>)}</dl>
        {selectedSpan.parentId && detail?.spans.some(s => s.id === selectedSpan.parentId) && <button className="performance-agent-row" onClick={() => selectSpan(selectedSpan.parentId!)}><span>{t('parent')}</span></button>}
        {/* Hooks, dispatch and execution phases of this call are its children, so
            a reader sees what the interval contained without leaving it. */}
        {!!detail?.spans.some(s => s.parentId === selectedSpan.id) && <section className="performance-evidence-children"><h3>{t('children')}</h3>{detail.spans.filter(s => s.parentId === selectedSpan.id).slice(0,80).map(child => <button className="performance-agent-row" key={child.id} onClick={() => selectSpan(child.id)}><span><strong>{child.label || metricLabel(child.kind)}</strong><small>{metricLabel(child.kind)}</small></span><strong>{timingDuration(child.durationMs)}</strong></button>)}</section>}
        <h3>{t('raw')}</h3>{selectedSpan.evidence.map((record, index) => <div className="performance-source" key={index}><strong>{record.eventType}</strong><button className="performance-source-link" onClick={event => { sourceOpener.current = event.currentTarget; setSourceRecord(record); }}><code>{record.source}:{record.line}</code></button><small>{date(record.timestampMs)}</small></div>)}
        <details><summary>{t('facts')}</summary><pre>{JSON.stringify(selectedSpan.facts, null, 2)}</pre></details></div>
      </aside>}
    </div>}
  </section></>;
}
