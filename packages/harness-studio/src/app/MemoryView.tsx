import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowClockwise } from '@phosphor-icons/react/ArrowClockwise';
import { CaretDown } from '@phosphor-icons/react/CaretDown';
import { FileText } from '@phosphor-icons/react/FileText';
import { MagnifyingGlass } from '@phosphor-icons/react/MagnifyingGlass';
import { LockSimple } from '@phosphor-icons/react/LockSimple';
import { X } from '@phosphor-icons/react/X';
import type { MemoryDocument, MemoryInventory, MemorySnapshot, MemorySource } from '../contracts/memory.js';
import { parseMarkdown } from '../contracts/markdown-parser.js';
import { MarkdownBlockView } from './artifacts/MarkdownArtifactView.js';
import { DataTable } from './shell/DataTable.js';
import { ToolbarActions } from './shell/ToolbarActions.js';
import { useRovingTablist } from './roving-tablist.js';

const HOST_LABELS: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', qoder: 'Qoder', qwen: 'Qwen Code', cursor: 'Cursor', pi: 'Pi', kimi: 'Kimi', copilot: 'Copilot', workbuddy: 'WorkBuddy', grok: 'Grok', auggie: 'Auggie', dsh: 'DSH' };
const hostLabel = (host: string): string => HOST_LABELS[host] ?? host;
type MemoryTab = 'documents' | 'sources';

export function MemoryView(): React.JSX.Element {
  const { t } = useTranslation('common');
  const [inventory, setInventory] = useState<MemoryInventory>();
  const [selected, setSelected] = useState<MemoryDocument>();
  const [snapshot, setSnapshot] = useState<MemorySnapshot>();
  const [host, setHost] = useState('all');
  const [scope, setScope] = useState('all');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<MemoryTab>('documents');
  const [error, setError] = useState(false);
  const [reading, setReading] = useState(false);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const readRequest = useRef<AbortController | undefined>(undefined);
  const reader = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const tabs = useRovingTablist<MemoryTab>({ ids: ['documents', 'sources'], active: tab, onSelect: setTab, panelId: 'memory-inventory-panel' });

  useEffect(() => {
    const controller = new AbortController();
    generation.current++;
    setInventory(undefined); setSelected(undefined); setSnapshot(undefined); setError(false); setReading(false);
    void fetch('/api/memory', { signal: controller.signal, cache: 'no-store' }).then(async (response) => {
      if (!response.ok) throw new Error();
      const data = await response.json() as MemoryInventory;
      if (!controller.signal.aborted) setInventory(data);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => { controller.abort(); readRequest.current?.abort(); generation.current++; };
  }, [revision]);

  const sources = inventory?.sources.filter((source) => (host === 'all' || source.host === host) && (scope === 'all' || source.scope === scope)) ?? [];
  const term = query.trim().toLocaleLowerCase();
  const documents = inventory?.documents.filter((doc) => sources.some((source) => source.sourceId === doc.sourceId)
    && `${doc.metadata.title} ${hostLabel(doc.provenance.host)} ${doc.role}`.toLocaleLowerCase().includes(term)) ?? [];
  const visibleSources = sources.filter((source) => `${hostLabel(source.host)} ${source.root?.displayPath ?? ''} ${source.coverage.state}`.toLocaleLowerCase().includes(term));
  const selectedSource = inventory?.sources.find((source) => source.sourceId === selected?.sourceId);
  const blocks = useMemo(() => snapshot ? parseMarkdown(snapshot.content).blocks : [], [snapshot]);
  function clear(): void { generation.current++; readRequest.current?.abort(); setSelected(undefined); setSnapshot(undefined); setReading(false); setError(false); }
  function select(doc: MemoryDocument): void { if (doc.id !== selected?.id) { clear(); setSelected(doc); void read(doc); } }
  function closeReader(): void { clear(); search.current?.focus(); }
  async function read(doc: MemoryDocument): Promise<void> {
    readRequest.current?.abort();
    const controller = new AbortController();
    readRequest.current = controller;
    const current = ++generation.current;
    setReading(true); setError(false);
    try {
      const response = await fetch('/api/memory/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: doc.id, scope: doc.scope, authorized: true }), cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error();
      const value = await response.json() as MemorySnapshot;
      if (current === generation.current) setSnapshot(value);
    } catch { if (current === generation.current) setError(true); }
    finally { if (current === generation.current) setReading(false); }
  }

  const columns: ColumnDef<MemoryDocument, never>[] = [
    { accessorKey: 'metadata.title', header: t('memory.document'), meta: { width: '42%' }, cell: ({ row }) => <button type="button" className="memory-document-name" aria-pressed={selected?.id === row.original.id} title={row.original.nativeIdentity.path}><FileText size={15} aria-hidden="true" /><span>{row.original.metadata.title}</span></button> },
    { accessorKey: 'provenance.host', header: t('memory.host'), meta: { width: '20%' }, cell: ({ row }) => hostLabel(row.original.provenance.host) },
    { accessorKey: 'scope', header: t('memory.scope'), meta: { width: '15%' }, cell: ({ row }) => <span className="memory-scope-label">{row.original.scope}</span> },
    { accessorKey: 'metadata.updatedAt', header: t('memory.updated'), meta: { width: '23%' }, cell: ({ row }) => <span className="memory-date">{new Date(row.original.metadata.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span> },
  ];
  const sourceColumns: ColumnDef<MemorySource, never>[] = [
    { accessorKey: 'host', header: t('memory.host'), meta: { width: '18%' }, cell: ({ row }) => hostLabel(row.original.host) },
    { accessorKey: 'scope', header: t('memory.scope'), meta: { width: '12%' } },
    { accessorKey: 'root.displayPath', header: t('memory.location'), meta: { width: '45%' }, cell: ({ row }) => <span title={row.original.root?.displayPath}>{row.original.root?.displayPath ?? t('memory.noNativeSource')}</span> },
    { accessorKey: 'coverage.state', header: t('memory.coverage'), meta: { width: '25%' }, cell: ({ row }) => <span className="memory-source-status" data-state={row.original.coverage.state} title={row.original.coverage.reason ?? row.original.support}><span aria-hidden="true" />{row.original.coverage.state}</span> },
  ];
  const showingReader = tab === 'documents' && selected !== undefined;
  return <section className="memory-workbench" aria-label={t('area.memory')}>
    <ToolbarActions><button type="button" className="memory-refresh" onClick={() => setRevision((value) => value + 1)}><ArrowClockwise size={15} aria-hidden="true" />{t('memory.refresh')}</button></ToolbarActions>
    <div className="memory-commandbar">
      <div className="memory-tabs" {...tabs.tablistProps} aria-label={t('area.memory')}>
        {(['documents', 'sources'] as const).map((value) => <button key={value} id={`memory-tab-${value}`} type="button" {...tabs.getTabProps(value)} onClick={() => setTab(value)}>{value === 'documents' ? t('memory.documentsTab') : t('memory.sourcesTab')}<span>{value === 'documents' ? documents.length : visibleSources.length}</span></button>)}
      </div>
      <span className="memory-readonly"><LockSimple size={12} aria-hidden="true" />{t('memory.readonly')}</span>
    </div>
    <div className="memory-filterbar">
      <label className="memory-search"><MagnifyingGlass size={15} aria-hidden="true" /><input ref={search} type="search" aria-label={t('memory.search')} placeholder={t('memory.search')} value={query} onChange={(event) => { clear(); setQuery(event.target.value); }} /></label>
      <label className="memory-filter"><span>{t('memory.host')}</span><select aria-label={t('memory.host')} value={host} onChange={(event) => { clear(); setHost(event.target.value); }}><option value="all">{t('memory.all')}</option>{[...new Set(inventory?.sources.map((source) => source.host))].map((value) => <option key={value} value={value}>{hostLabel(value)}</option>)}</select><CaretDown size={11} aria-hidden="true" /></label>
      <label className="memory-filter"><span>{t('memory.scope')}</span><select aria-label={t('memory.scope')} value={scope} onChange={(event) => { clear(); setScope(event.target.value); }}><option value="all">{t('memory.all')}</option>{['project', 'user', 'team'].map((value) => <option key={value}>{value}</option>)}</select><CaretDown size={11} aria-hidden="true" /></label>
    </div>
    {error && <p className="memory-message" role="alert">{t('memory.error')}</p>}
    {!inventory && !error && <p className="memory-message" role="status">{t('memory.loading')}</p>}
    {inventory && <div className={`memory-panes${showingReader ? ' has-reader' : ''}`}>
      <section className="memory-inventory" id="memory-inventory-panel" role="tabpanel" aria-labelledby={`memory-tab-${tab}`}>
        {tab === 'documents' ? <DataTable columns={columns} rows={documents} rowId={(doc) => doc.id} label={t('memory.documents')} minWidth="450px" className="memory-document-table" selectedRowId={selected?.id} onSelectRow={select} emptyMessage={t('memory.empty')} />
          : <DataTable columns={sourceColumns} rows={visibleSources} rowId={(source) => source.sourceId} label={t('memory.sourcesTab')} minWidth="660px" emptyMessage={t('memory.empty')} />}
        <footer className="memory-inventory-footer"><span>{t('memory.inventoryHint')}</span>{tab === 'documents' && <button type="button" onClick={() => setTab('sources')}>{t('memory.viewSources')}</button>}</footer>
      </section>
      {showingReader && <section className="memory-reader" ref={reader} aria-label={t('memory.preview')}>
        <header className="memory-reader-header"><FileText size={16} aria-hidden="true" /><div className="memory-reader-heading"><strong>{selected.metadata.title}</strong><div className="memory-reader-meta"><span>{hostLabel(selected.provenance.host)}</span><span>{selected.scope}</span><span>{selected.role}</span></div></div><button type="button" aria-label={t('memory.close')} title={t('memory.close')} onClick={closeReader}><X size={15} /></button></header>
        <div className="memory-reader-body" aria-busy={reading}>
          {!snapshot ? <div className="memory-reader-state">{reading ? <p role="status">{t('memory.loading')}</p> : error && <button type="button" onClick={() => void read(selected)}>{t('memory.retry')}</button>}</div>
            : <article className="markdown-document">{blocks.map((block, index) => <MarkdownBlockView key={index} block={block} context={{ resources: [], goTo: (slug) => { for (const node of reader.current?.querySelectorAll<HTMLElement>('[data-md-heading]') ?? []) if (node.dataset.mdHeading === slug) node.scrollIntoView({ block: 'nearest' }); } }} />)}</article>}
        </div>
        <details className="memory-provenance"><summary><CaretDown size={12} aria-hidden="true" /><span>{t('memory.provenance')}</span><span className="memory-provenance-path">{selected.nativeIdentity.path}</span></summary><dl>
          <dt>{t('memory.support')}</dt><dd>{selectedSource?.support}</dd>
          <dt>{t('memory.workspace')}</dt><dd>{selectedSource?.workspace?.identity ?? t('memory.userMemory')}</dd>
          {snapshot && <><dt>SHA-256</dt><dd><code>sha256:{snapshot.digest}</code></dd><dt>{t('memory.captured')}</dt><dd>{new Date(snapshot.capturedAt).toLocaleString()}</dd></>}
        </dl></details>
      </section>}
    </div>}
  </section>;
}
