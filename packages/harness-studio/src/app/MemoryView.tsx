import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowClockwise } from '@phosphor-icons/react/ArrowClockwise';
import { Robot } from '@phosphor-icons/react/Robot';
import { Users } from '@phosphor-icons/react/Users';
import { FacetNavigation } from './shell/FacetNavigation.js';
import { Folder } from '@phosphor-icons/react/Folder';
import { X } from '@phosphor-icons/react/X';
import { MagnifyingGlass } from '@phosphor-icons/react/MagnifyingGlass';
import { Sparkle } from '@phosphor-icons/react/Sparkle';
import type { MemoryInventory, MemorySnapshot } from '../contracts/memory.js';
import { ToolbarActions } from './shell/ToolbarActions.js';
import { useMemoryPanes } from './memory/useMemoryPanes.js';
import { MemoryReader } from './memory/MemoryReader.js';
import { MemoryAnalysisPanel, type MemoryAcpAgent } from './memory/MemoryAnalysisPanel.js';
import { MemoryExplorer } from './memory/MemoryExplorer.js';
import { buildMemoryTree, memoryEditorKey, type MemoryTreeNode } from './memory/tree-model.js';
import { forgetSnapshots, hostLabel, memoryBrowseIndexes, knownSnapshots, MEMORY_LOCATION_KEY, memoryLocationHash, parseMemoryLocation, rememberSnapshot, type MemoryLocation } from './memory/browser-model.js';
import { withinDateRange, type StudioDateRange } from './date-range.js';

function initialLocation(): MemoryLocation {
  const hash = globalThis.location.hash;
  if (hash.includes('?') || hash.endsWith('/memory-sources')) return parseMemoryLocation(hash);
  try { const saved = localStorage.getItem(MEMORY_LOCATION_KEY); if (saved) return parseMemoryLocation(saved); } catch { /* Storage is optional. */ }
  return parseMemoryLocation(hash);
}

interface EditorTab { key: string; document: string; entry?: string; title: string; view: MemoryLocation['view']; project?: string }

export function MemoryView({ dateRange }: { dateRange: StudioDateRange }): React.JSX.Element {
  const { t } = useTranslation('common');
  const [inventory, setInventory] = useState<MemoryInventory>();
  const [location, setLocation] = useState(initialLocation);
  const [snapshot, setSnapshot] = useState<MemorySnapshot>();
  const [cacheRevision, setCacheRevision] = useState(0);
  const [error, setError] = useState(false);
  const [readError, setReadError] = useState(false);
  const [reading, setReading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [readRevision, setReadRevision] = useState(0);
  const [indexing, setIndexing] = useState(false);
  const [indexError, setIndexError] = useState(false);
  const [indexRevision, setIndexRevision] = useState(0);
  const [analysis, setAnalysis] = useState(false);
  const panes = useMemoryPanes(analysis);
  const [capability, setCapability] = useState<{ available: boolean; agents?: MemoryAcpAgent[]; maxBytes: number }>();
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const analysisTrigger = useRef<HTMLButtonElement>(null);
  const readerPositions = useRef(new Map<string, number>());
  const locationRef = useRef(location); locationRef.current = location;

  function navigate(change: Partial<MemoryLocation>, replace = false): void {
    const next = { ...locationRef.current, ...change };
    const hash = memoryLocationHash(next);
    globalThis.history[replace ? 'replaceState' : 'pushState'](null, '', hash);
    setLocation(next);
    try { localStorage.setItem(MEMORY_LOCATION_KEY, hash); } catch { /* Storage is optional. */ }
    globalThis.dispatchEvent(new Event('popstate'));
  }
  function closeAnalysis(): void { setAnalysis(false); requestAnimationFrame(() => analysisTrigger.current?.focus()); }
  const activeKey = location.document ? memoryEditorKey(location.document, location.entry) : undefined;
  function activate(tab: EditorTab): void { navigate({ document: tab.document, entry: tab.entry, view: tab.view, project: tab.project }); setExplorerOpen(false); }
  function closeTab(key: string): void {
    const index = tabs.findIndex(tab => tab.key === key), remaining = tabs.filter(tab => tab.key !== key);
    setTabs(remaining);
    if (activeKey === key) { const next = remaining[Math.min(index, remaining.length - 1)]; if (next) { activate(next); requestAnimationFrame(() => globalThis.document.querySelector<HTMLButtonElement>('.memory-editor-tabs [aria-selected="true"]')?.focus()); } else { navigate({ document: undefined, entry: undefined }); setExplorerOpen(true); requestAnimationFrame(() => search.current?.focus()); } }
  }
  function open(item: NonNullable<MemoryTreeNode['item']>): void { const { row, view, project } = item; activate({ key: memoryEditorKey(row.document.id, row.entry?.id), document: row.document.id, entry: row.entry?.id, title: row.title, view, project }); }


  useEffect(() => {
    const onLocation = (): void => {
      const next = initialLocation(); setLocation(next);
      try { localStorage.setItem(MEMORY_LOCATION_KEY, memoryLocationHash(next)); } catch { /* Storage is optional. */ }
    };
    window.addEventListener('hashchange', onLocation); window.addEventListener('popstate', onLocation);
    return () => { window.removeEventListener('hashchange', onLocation); window.removeEventListener('popstate', onLocation); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setError(false); setInventory(undefined);
    void fetch('/api/memory', { signal: controller.signal, cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error();
      const value = await response.json() as MemoryInventory;
      if (!controller.signal.aborted) setInventory(value);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    void fetch('/api/memory/analysis', { signal: controller.signal, cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error();
      const value = await response.json(); if (!controller.signal.aborted) setCapability(value);
    }).catch(() => { if (!controller.signal.aborted) setCapability({ available: false, maxBytes: 0 }); });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    if (!inventory) { setIndexing(false); setIndexError(false); return; }
    const controller = new AbortController();
    const existing = knownSnapshots(inventory);
    const documents = memoryBrowseIndexes(inventory).filter(doc => !existing.some(snapshot => snapshot.documentId === doc.id));
    setIndexError(false); setIndexing(documents.length > 0);
    void Promise.all(documents.map(async doc => {
      try {
        const response = await fetch('/api/memory/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: doc.id, scope: doc.scope, authorized: true }), signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error();
        const value = await response.json() as MemorySnapshot;
        if (!controller.signal.aborted) { rememberSnapshot(value); setCacheRevision(version => version + 1); }
      } catch { if (!controller.signal.aborted) setIndexError(true); }
    })).finally(() => { if (!controller.signal.aborted) setIndexing(false); });
    return () => controller.abort();
  }, [inventory, indexRevision]);

  const loaded = useMemo(() => inventory ? knownSnapshots(inventory) : [], [inventory, cacheRevision]);
  const filteredInventory = useMemo(() => {
    if (!inventory) return undefined;
    const documents = inventory.documents.filter(doc => withinDateRange(doc.provenance.observedAt, dateRange));
    return { ...inventory, documents };
  }, [inventory, dateRange]);
  const nodes = useMemo(() => filteredInventory ? buildMemoryTree(filteredInventory, loaded, key => t(`memory.${key}`), location.host) : [], [filteredInventory, loaded, t, location.host]);
  const selected = inventory?.documents.find(doc => doc.id === location.document);
  const selectedSource = inventory?.sources.find(source => source.sourceId === selected?.sourceId);
  const selectedEntry = snapshot?.extraction?.entries.find(entry => entry.id === location.entry);

  useEffect(() => {
    const controller = new AbortController();
    setSnapshot(undefined); setReadError(false); setReading(false);
    if (!selected) return () => controller.abort();
    const doc = selected;
    // Open editors share frozen session-local snapshots until an explicit refresh.
    const cached = knownSnapshots(inventory!).find(value => value.documentId === doc.id);
    if (cached) { setSnapshot(cached); return () => controller.abort(); }
    setReading(true);
    void fetch('/api/memory/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: doc.id, scope: doc.scope, authorized: true }), signal: controller.signal, cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error();
      const value = await response.json() as MemorySnapshot;
      if (!controller.signal.aborted) { rememberSnapshot(value); setSnapshot(value); setCacheRevision(version => version + 1); }
    }).catch(() => { if (!controller.signal.aborted) setReadError(true); }).finally(() => { if (!controller.signal.aborted) setReading(false); });
    return () => controller.abort();
  }, [selected?.id, !!location.entry, inventory, readRevision]);

  useEffect(() => {
    if (!selected || !activeKey) return;
    setTabs(current => { const title = selectedEntry?.title ?? selected.metadata.title; const existing = current.find(tab => tab.key === activeKey); if (existing?.title === title) return current; const tab: EditorTab = { key: activeKey, document: selected.id, entry: location.entry, title, view: location.view, project: location.project }; return existing ? current.map(item => item.key === activeKey ? tab : item) : [...current, tab]; });
  }, [activeKey, selected, selectedEntry?.title]);
  useEffect(() => { globalThis.document.querySelector('.memory-editor-tabs [aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [activeKey, tabs.length]);
  const sourceCoverage = inventory?.sources.filter(source => location.host === 'all' || source.host === location.host) ?? [];
  return <section ref={panes.root} style={panes.style} className={`memory-workbench memory-browser${analysis ? ' has-analysis' : ''}${explorerOpen || !selected ? ' explorer-open' : ''}`} aria-label={t('area.memory')} onKeyDown={event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'w' && activeKey) { event.preventDefault(); closeTab(activeKey); }
    if (event.key === 'Escape' && explorerOpen && selected) { setExplorerOpen(false); requestAnimationFrame(() => globalThis.document.querySelector<HTMLButtonElement>('.memory-explorer-toggle')?.focus()); }
  }}>
    <ToolbarActions>
      <button type="button" className="memory-refresh" aria-label={t('memory.refresh')} title={t('memory.refresh')} onClick={() => { forgetSnapshots(); setCacheRevision(value => value + 1); setRevision(value => value + 1); }}><ArrowClockwise size={15} aria-hidden="true" /></button>
      <button ref={analysisTrigger} type="button" aria-expanded={analysis} aria-controls={analysis ? 'memory-analysis-panel' : undefined} aria-disabled={!capability?.available} title={!capability?.available ? t('memory.analysisUnavailable') : undefined} onClick={() => { if (capability?.available) analysis ? closeAnalysis() : setAnalysis(true); }}><Sparkle size={15} aria-hidden="true" />{t('memory.aiAnalysis')}</button>
    </ToolbarActions>
    <aside className="memory-explorer" aria-label={t('memory.navigation')}>
      <div className="memory-filterbar"><label className="memory-search"><MagnifyingGlass size={15} aria-hidden="true" /><input ref={search} type="search" aria-label={t('memory.search')} placeholder={t('memory.search')} value={location.query} onChange={event => navigate({ query: event.target.value }, true)} /></label></div>
      <FacetNavigation className="memory-agent-nav" label={t('memory.host')} groups={[{
        id: 'agents', label: t('customize:library.sections.agents'),
        items: filteredInventory ? ['all', ...new Set(filteredInventory.sources.map(source => source.host))].map(host => {
          const count = filteredInventory.documents.filter(doc => host === 'all' || doc.provenance.host === host).length;
          return { id: host, label: host === 'all' ? t('customize:library.allAgents') : hostLabel(host), current: location.host === host, count,
            icon: host === 'all' ? <Users size={16} aria-hidden="true" /> : <Robot size={16} aria-hidden="true" />,
            onSelect: () => navigate({ host }) };
        }).filter(item => item.count > 0) : [],
      }]} />
      {error ? <div className="memory-message"><p role="alert">{t('memory.error')}</p><button type="button" onClick={() => setRevision(value => value + 1)}>{t('memory.refresh')}</button></div> : !inventory ? <p className="memory-message" role="status">{t('memory.loading')}</p> : <MemoryExplorer nodes={nodes} query={location.query} activeKey={activeKey} initialView={location.view} onOpen={open} label={t('memory.documents')} />}
      {(indexing || indexError) && <div className="memory-index-status"><span role={indexError ? 'alert' : 'status'}>{t(indexError ? 'memory.indexError' : 'memory.loadingEntries')}</span>{indexError && <button type="button" onClick={() => setIndexRevision(value => value + 1)}>{t('memory.retry')}</button>}</div>}
      <details className="memory-source-coverage"><summary>{t('memory.sourceStatus')}</summary>{sourceCoverage.map(source => <div key={source.sourceId}><span>{hostLabel(source.host)}</span><span>{t(`memory.coverageLabels.${source.coverage.state}`)}</span><span className="memory-coverage-path">{source.root?.displayPath ?? t('memory.noNativeSource')}</span></div>)}</details>
      <footer className="memory-inventory-footer">{t('memory.fileCount', { count: filteredInventory?.documents.length ?? 0 })}</footer>
    </aside>
    {panes.sash('explorer')}
    <div className="memory-editor">
      <div className="memory-editor-bar"><button className="memory-explorer-toggle" type="button" aria-label={t('memory.navigation')} aria-expanded={explorerOpen} onClick={() => { setExplorerOpen(value => !value); requestAnimationFrame(() => search.current?.focus()); }}><Folder size={16} /></button><div className="memory-editor-tabs" role="tablist" aria-label={t('memory.openEditors')}>
        {tabs.map((tab, index) => <div className="memory-editor-tab" key={tab.key} data-active={tab.key === activeKey}><button role="tab" id={`memory-editor-tab-${index}`} type="button" aria-selected={tab.key === activeKey} aria-controls="memory-editor-panel" tabIndex={tab.key === activeKey ? 0 : -1} title={inventory?.documents.find(doc => doc.id === tab.document)?.nativeIdentity.path} onClick={() => activate(tab)} onKeyDown={event => { const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : undefined; if (next !== undefined) { event.preventDefault(); activate(tabs[next]!); requestAnimationFrame(() => globalThis.document.getElementById(`memory-editor-tab-${next}`)?.focus()); } else if (event.key === 'Delete') { event.preventDefault(); closeTab(tab.key); } }}>{tab.title}</button><button type="button" aria-label={t('memory.closeEditor', { title: tab.title })} onClick={() => closeTab(tab.key)}><X size={12} /></button></div>)}
      </div></div>
      <div className="memory-editor-panel" id="memory-editor-panel" role="tabpanel" aria-labelledby={activeKey && tabs.some(tab => tab.key === activeKey) ? `memory-editor-tab-${tabs.findIndex(tab => tab.key === activeKey)}` : undefined}>
        {selected ? <MemoryReader scrollPositions={readerPositions.current} document={selected} source={selectedSource} snapshot={snapshot} entry={selectedEntry} reading={reading} error={readError} onRetry={() => setReadRevision(value => value + 1)} /> : <div className="memory-empty">{t('memory.pickFile')}</div>}
      </div>
    </div>
    {analysis && panes.sash('analysis')}
    {analysis && <div id="memory-analysis-panel" className="memory-analysis-slot"><MemoryAnalysisPanel snapshot={snapshot} entry={selectedEntry} agents={capability?.agents ?? []} maxBytes={capability?.maxBytes ?? 0} onClose={closeAnalysis} onReveal={(value, entry) => { rememberSnapshot(value); setCacheRevision(version => version + 1); navigate({ document: value.documentId, entry: entry?.id }); setExplorerOpen(false); }} /></div>}
  </section>;
}
