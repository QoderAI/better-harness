import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from '@phosphor-icons/react/ArrowLeft';
import { ArrowClockwise } from '@phosphor-icons/react/ArrowClockwise';
import { StorageReport } from './StorageReport.js';
import { X } from '@phosphor-icons/react/X';
import type { PerformanceCatalog, PerformanceDetail, TimingSpan } from '../../contracts/session-performance.js';
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
  const [turnId, setTurnId] = useState('');
  const [kind, setKind] = useState('all');
  const [spanId, setSpanId] = useState<string>();
  const [page, setPage] = useState(0);
  const [spanPage, setSpanPage] = useState(0);
  const detailRef = useRef<HTMLElement>(null);
  const evidenceRef = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const headers = useMemo(() => ({ 'x-harness-project-id': config.activeProjectId ?? '', 'x-harness-project-revision': String(config.projectRevision ?? 0) }), [config.activeProjectId, config.projectRevision]);
  useEffect(() => { const listener = (): void => { const query = params(); setSelection(query.get('session')); setQuery(query.get('q') ?? ''); setSort(query.get('sort') ?? 'longest'); setSpanId(undefined); }; globalThis.addEventListener('hashchange', listener); return () => globalThis.removeEventListener('hashchange', listener); }, []);
  useEffect(() => {
    const controller = new AbortController(); setError(''); setCatalog(undefined);
    fetch(`api/session-performance${refresh ? '?refresh=true' : ''}`, { headers, signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(response.status === 503 ? 'unavailable' : 'error'); return await response.json() as PerformanceCatalog; })
      .then(setCatalog).catch(e => { if (!controller.signal.aborted) setError(e.message === 'unavailable' ? 'unavailable' : 'error'); });
    return () => controller.abort();
  }, [headers, refresh]);
  const sessions = useMemo(() => (catalog?.sessions ?? []).filter(s => withinDateRange(s.lastActivityMs === null ? undefined : new Date(s.lastActivityMs).toISOString(), dateRange)
    && `${s.label} ${s.id}`.toLowerCase().includes(query.toLowerCase())).sort((a,b) => sort === 'recent' ? (b.lastActivityMs ?? 0) - (a.lastActivityMs ?? 0) : b.breakdown.totalMs - a.breakdown.totalMs), [catalog, dateRange, query, sort]);
  const selectedId = selection ?? sessions[0]?.id;
  useEffect(() => { setPage(0); }, [query, sort, dateRange]);
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
  const selectedSpan = detail?.spans.find(span => span.id === spanId);
  const start = selectedTurn?.startMs ?? detail?.session.firstSeenMs ?? 0;
  const end = selectedTurn?.endMs ?? detail?.session.lastActivityMs ?? detail?.session.lastSeenMs ?? start;
  const scale = Math.max(1, end - start);
  const selectSpan = (id: string): void => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setSpanId(id); };
  const closeEvidence = (): void => { setSpanId(undefined); requestAnimationFrame(() => opener.current?.isConnected ? opener.current.focus() : detailRef.current?.focus()); };
  useEffect(() => { if (selectedSpan) evidenceRef.current?.focus(); }, [selectedSpan?.id]);
  const chooseSession = (id: string): void => { routeSelection(id); setSelection(id); requestAnimationFrame(() => detailRef.current?.focus()); };
  const summary = detail?.session;
  const metricLabel = (name: string): string => t(`kinds.${name}`, { defaultValue: name });
  const paged = <T,>(items: T[], index: number, size: number): T[] => items.slice(index * size, (index + 1) * size);
  function pager(index: number, length: number, size: number, change: (index: number) => void): React.JSX.Element | null {
    const total = Math.max(1, Math.ceil(length / size));
    return total <= 1 ? null : <div className="performance-pager"><button disabled={index === 0} onClick={() => change(index - 1)}>{t('previous')}</button><span>{t('page', { page: index + 1, total })}</span><button disabled={index + 1 >= total} onClick={() => change(index + 1)}>{t('next')}</button></div>;
  }
  return <section className={`performance-workspace${selection ? ' performance-has-session' : ''}${selectedSpan ? ' performance-has-evidence' : ''}`} aria-label={t('title')}>
    <header className="performance-header"><span>{t('subtitle')}</span><button disabled={!catalog && !error} onClick={() => setRefresh(value => value + 1)} aria-label={t('refresh')}><ArrowClockwise aria-hidden="true" size={16} />{t('refresh')}</button></header>
    {error ? <p className="performance-state" role="alert">{t(error === 'unavailable' ? 'unavailable' : 'error')}</p> : !catalog ? <p className="performance-state" role="status">{t('loading')}</p> : <div className="performance-panes">
      <aside className="performance-catalog" aria-label={t('sessions')}>
        <div className="performance-filters"><input aria-label={t('search')} placeholder={t('search')} value={query} onChange={event => { setQuery(event.target.value); saveFilter('q', event.target.value); }} /><select aria-label={t('sort')} value={sort} onChange={event => { setSort(event.target.value); saveFilter('sort', event.target.value); }}><option value="longest">{t('longest')}</option><option value="recent">{t('recent')}</option></select></div>
        <div className="performance-session-list">{sessions.length === 0 && <p className="performance-state">{t('empty')}</p>}{paged(sessions, page, 40).map(session => <button className="performance-session" key={session.id} aria-current={session.id === selectedId ? 'true' : undefined} onClick={() => chooseSession(session.id)}>
          <span><strong>{session.label}</strong><b>{timingDuration(session.breakdown.totalMs)}</b></span><small>{date(session.lastActivityMs)}</small>
        </button>)}</div>
        {pager(page, sessions.length, 40, setPage)}{catalog.coverage.omittedSessions > 0 && <p className="performance-note">{t('omitted', { count: catalog.coverage.omittedSessions })}</p>}
      </aside>
      <main className="performance-analysis" tabIndex={-1} ref={detailRef} aria-label={t('title')}>
        <button className="performance-back" onClick={() => { routeSelection(null); setSelection(null); }}><ArrowLeft aria-hidden="true" size={15} />{t('back')}</button>
        {detailError ? <p className="performance-state" role="alert">{t('error')}</p> : !detail ? <p className="performance-state" role="status">{selectedId ? t('loading') : t('select')}</p> : summary && <>
          <StorageReport key={summary.id} detail={detail} onSelect={selectSpan} />
          <details className="storage-events"><summary>{t('eventDetails')}</summary>
          <section className="performance-intervals"><div className="performance-toolbar"><h3>{t('timeline')}</h3><label>{t('turn')}<select aria-label={t('turn')} value={turnId} onChange={event => { setTurnId(event.target.value); saveFilter('turn', event.target.value); }}><option value="all">{t('allTurns')}</option>{detail.turns.map((turn, index) => <option key={turn.id} value={turn.id}>{index + 1} · {t(turn.isSubagent ? 'child' : 'root')} · {timingDuration(turn.durationMs)}</option>)}</select></label><label>{t('category')}<select aria-label={t('category')} value={kind} onChange={event => { setKind(event.target.value); saveFilter('kind', event.target.value); }}><option value="all">{t('all')}</option>{[...new Set(detail.spans.map(s => s.kind))].map(value => <option key={value} value={value}>{metricLabel(value)}</option>)}</select></label></div>
            <p className="performance-note">{t('overlap')}</p><div className="performance-metrics">{summary.metrics.map(metric => <button aria-pressed={kind === metric.kind} key={metric.kind} onClick={() => { const next = kind === metric.kind ? 'all' : metric.kind; setKind(next); saveFilter('kind', next); }}><span>{metricLabel(metric.kind)} · {metric.count}</span><strong>{timingDuration(metric.durationMs)}</strong></button>)}</div>
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
      {selectedSpan && <aside className="performance-evidence" aria-label={t('evidence')} tabIndex={-1} ref={evidenceRef} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); closeEvidence(); } }}>
        <div className="performance-toolbar"><h3>{t('evidence')}</h3><button aria-label={t('close')} onClick={closeEvidence}><X aria-hidden="true" size={15} /></button></div>
        <button className="performance-evidence-back" onClick={closeEvidence}><ArrowLeft aria-hidden="true" size={15} />{t('backDetail')}</button>
        <h2>{selectedSpan.label || metricLabel(selectedSpan.kind)}</h2><strong className="performance-evidence-duration">{timingDuration(selectedSpan.durationMs)}</strong>
        <dl className="performance-facts">{[['category', metricLabel(selectedSpan.kind)], ['status', t(`statuses.${selectedSpan.status}`, { defaultValue: selectedSpan.status })], ['basis', t(`bases.${selectedSpan.basis}`, { defaultValue: selectedSpan.basis })], ['start', date(selectedSpan.startMs)], ['end', date(selectedSpan.endMs)], ['relationship', selectedSpan.relationship ? t(`relationships.${selectedSpan.relationship}`, { defaultValue: selectedSpan.relationship }) : t('unknownValue')]].map(([key,value]) => <div key={key}><dt>{t(key!)}</dt><dd>{value}</dd></div>)}</dl>
        {selectedSpan.parentId && detail?.spans.some(s => s.id === selectedSpan.parentId) && <button onClick={() => selectSpan(selectedSpan.parentId!)}>{t('parent')}</button>}
        {!!detail?.spans.some(s => s.parentId === selectedSpan.id) && <section><h3>{t('children')}</h3>{detail.spans.filter(s => s.parentId === selectedSpan.id).slice(0,80).map(child => <button className="performance-agent-row" key={child.id} onClick={() => selectSpan(child.id)}><span>{child.label || metricLabel(child.kind)}</span><strong>{timingDuration(child.durationMs)}</strong></button>)}</section>}
        <h3>{t('raw')}</h3>{selectedSpan.evidence.map((record, index) => <div className="performance-source" key={index}><strong>{record.eventType}</strong><code>{record.source}:{record.line}</code><small>{date(record.timestampMs)}</small></div>)}
        <details><summary>{t('facts')}</summary><pre>{JSON.stringify(selectedSpan.facts, null, 2)}</pre></details>
      </aside>}
    </div>}
  </section>;
}
