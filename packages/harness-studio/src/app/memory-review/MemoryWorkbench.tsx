import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from '@phosphor-icons/react/ArrowRight';
import { CaretDown } from '@phosphor-icons/react/CaretDown';
import { Check } from '@phosphor-icons/react/Check';
import { FileText } from '@phosphor-icons/react/FileText';
import { GitBranch } from '@phosphor-icons/react/GitBranch';
import { MagnifyingGlass } from '@phosphor-icons/react/MagnifyingGlass';
import { PencilSimple } from '@phosphor-icons/react/PencilSimple';
import { X } from '@phosphor-icons/react/X';
import { ToolbarActions } from '../shell/ToolbarActions.js';
import { useRovingTablist } from '../roving-tablist.js';
import { memoryPreviewCandidates, type MemoryCandidate, type MemoryOwner } from './preview-data.js';

type Area = 'inbox' | 'project';
const OWNERS: MemoryOwner[] = ['ADR', 'Project Wiki', 'Procedure', 'Personal Memory'];
const LEVELS = ['Claimed', 'Observed', 'Grounded', 'Verified'] as const;
const strength = (candidate: MemoryCandidate): number => Math.max(...candidate.evidence.map((evidence) => LEVELS.indexOf(evidence.level)));

export function MemoryWorkbench({ onSources }: { onSources: () => void }): React.JSX.Element {
  const { t } = useTranslation('common');
  const [candidates, setCandidates] = useState(memoryPreviewCandidates);
  const [area, setArea] = useState<Area>('inbox');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('isolation');
  const [editing, setEditing] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [notice, setNotice] = useState('');
  const tabs = useRovingTablist<Area>({ ids: ['inbox', 'project'], active: area, onSelect: navigate, panelId: 'memory-review-panel' });
  const inbox = candidates.filter((item) => !['accepted', 'rejected'].includes(item.status));
  const project = candidates.filter((item) => item.status === 'accepted' && item.owner !== 'Personal Memory');
  const items = (area === 'inbox' ? inbox : project).filter((item) => (filter === 'all' || item.status === filter || item.kind === filter) && `${item.title} ${item.statement}`.toLowerCase().includes(query.toLowerCase()));
  const selected = candidates.find((item) => item.id === selectedId);
  const evidenceCount = useMemo(() => candidates.reduce((count, item) => count + item.evidence.length, 0), [candidates]);
  function navigate(next: Area): void { setArea(next); setFilter('all'); setQuery(''); setEditing(false); setResolved(false); setSelectedId(next === 'project' ? project[0]?.id ?? '' : inbox[0]?.id ?? ''); }
  function choose(item: MemoryCandidate): void { setSelectedId(item.id); setEditing(false); setResolved(false); }
  function chooseFilter(value: string): void {
    setFilter(value); setEditing(false); setResolved(false);
    const next = (area === 'inbox' ? inbox : project).find((item) => (value === 'all' || item.status === value || item.kind === value) && `${item.title} ${item.statement}`.toLowerCase().includes(query.toLowerCase()));
    setSelectedId(next?.id ?? '');
  }
  function update(change: Partial<MemoryCandidate>): void { setCandidates((current) => current.map((item) => item.id === selectedId ? { ...item, ...change } : item)); }
  function decide(status: 'accepted' | 'rejected'): void {
    if (!selected) return;
    update({ status });
    setNotice(status === 'accepted' ? t('memoryReview.acceptedNotice', { title: selected.title, owner: selected.owner }) : t('memoryReview.rejectedNotice', { title: selected.title }));
    setSelectedId(items.find((item) => item.id !== selected.id)?.id ?? '');
    setEditing(false); setResolved(false);
  }
  return <section className="memory-review-workbench" aria-label={t('area.memory')}>
    <ToolbarActions><button type="button" onClick={onSources}><FileText size={15} aria-hidden="true" />{t('memoryReview.sources')}</button></ToolbarActions>
    <div className="memory-review-topbar">
      <div className="memory-review-tabs" {...tabs.tablistProps} aria-label={t('area.memory')}>
        <button type="button" {...tabs.getTabProps('inbox')} onClick={() => navigate('inbox')}>{t('memoryReview.inbox')}<span>{inbox.length}</span></button>
        <button type="button" {...tabs.getTabProps('project')} onClick={() => navigate('project')}>{t('memoryReview.project')}<span>{project.length}</span></button>
      </div>
      <span className="memory-review-preview-label">{t('memoryReview.preview')}</span>
    </div>
    <div className="memory-review-layout" id="memory-review-panel" role="tabpanel">
      <aside className="memory-review-queue" aria-label={t('memoryReview.filters')}>
        <h2>{area === 'inbox' ? t('memoryReview.queue') : t('memoryReview.curated')}</h2>
        <button type="button" aria-pressed={filter === 'all'} onClick={() => chooseFilter('all')}><span>{area === 'inbox' ? t('memoryReview.allCandidates') : t('memoryReview.allMemory')}</span><small>{area === 'inbox' ? inbox.length : project.length}</small></button>
        {area === 'inbox' && (['review', 'conflict'] as const).map((value) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => chooseFilter(value)}><span>{t(`memoryReview.${value}`)}</span><small>{inbox.filter((item) => item.status === value).length}</small></button>)}
        <h2>{t('memoryReview.kind')}</h2>
        {['Decision', 'Constraint', 'Procedure', 'Lesson'].map((value) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => chooseFilter(value)}>{value}</button>)}
        <div className="memory-review-queue-note"><GitBranch size={16} aria-hidden="true" /><p>{t('memoryReview.refineryHint')}</p></div>
      </aside>
      <section className="memory-review-candidates" aria-label={area === 'inbox' ? t('memoryReview.candidates') : t('memoryReview.project')}>
        <header className="memory-review-list-header"><h2>{area === 'inbox' ? t('memoryReview.candidates') : t('memoryReview.project')}</h2><label><MagnifyingGlass size={15} aria-hidden="true" /><input type="search" aria-label={t('memoryReview.search')} placeholder={t('memoryReview.search')} value={query} onChange={(event) => { setQuery(event.target.value); setSelectedId(''); setEditing(false); }} /></label></header>
        <div className="memory-review-card-list">
          {items.length === 0 && <div className="memory-review-empty"><Check size={24} aria-hidden="true" /><h3>{area === 'project' ? t('memoryReview.noProject') : t('memoryReview.noCandidates')}</h3><p>{area === 'project' ? t('memoryReview.promoteHint') : t('memoryReview.filterHint')}</p></div>}
          {items.map((item) => <button type="button" key={item.id} className="memory-review-card" aria-pressed={selectedId === item.id} onClick={() => choose(item)}>
            <div className="memory-review-card-meta"><span>{item.kind}</span><span data-status={item.status}>{item.status === 'accepted' ? t('memoryReview.accepted') : t(`memoryReview.${item.status}`)}</span></div>
            <h3>{item.title}</h3><p>{item.statement}</p>
            {area === 'inbox' && <div className="memory-review-lineage-chips">{item.evidence.map((evidence, index) => <span key={evidence.reference}>{index > 0 && <i aria-hidden="true" />}{evidence.source}</span>)}<ArrowRight size={13} aria-hidden="true" /></div>}
            <div className="memory-review-card-bottom"><span className="memory-review-grounding"><span className="memory-review-level-dots" aria-hidden="true">{LEVELS.map((level, index) => <i key={level} data-lit={index <= strength(item)} />)}</span>{LEVELS[strength(item)]}<small>· {item.evidence.length} {t('memoryReview.evidenceShort')}</small></span><span className="memory-review-suggested">{area === 'inbox' ? t('memoryReview.suggested') : t('memoryReview.owner')}<ArrowRight size={12} aria-hidden="true" /><strong>{item.owner}</strong></span></div>
          </button>)}
        </div>
      </section>
      <aside className={`memory-review-inspector${selected ? ' has-selection' : ''}`} aria-label={t('memoryReview.inspector')}>
        <header className="memory-review-inspector-header"><h2>{t('memoryReview.inspector')}</h2>{selected && <span>{selected.kind}</span>}</header>
        {!selected ? <p className="memory-review-inspector-empty">{t('memoryReview.select')}</p> : <>
          <div className="memory-review-inspector-scroll">
            <div className="memory-review-statement"><h3>{selected.title}</h3>{editing ? <label>{t('memoryReview.statement')}<textarea aria-label={t('memoryReview.statement')} autoFocus value={selected.statement} onChange={(event) => update({ statement: event.target.value })} /></label> : <p>{selected.statement}</p>}<span>{t('memoryReview.projectScope')} · {selected.status === 'accepted' ? t('memoryReview.accepted') : t('memoryReview.proposed')}</span></div>
            <section className="memory-review-inspector-section"><h4>{t('memoryReview.evidence')}</h4><ol className="memory-review-evidence-list">{selected.evidence.map((evidence) => <li key={evidence.reference}><div><strong>{evidence.source}</strong><span>{evidence.level}</span></div><small>{evidence.reference}</small><p>{evidence.observation}</p></li>)}</ol></section>
            {selected.conflict && <section className="memory-review-inspector-section memory-review-conflict"><h4>{t('memoryReview.conflict')}</h4><div><small>{t('memoryReview.olderMemory')}</small><p>{selected.conflict.previous}</p></div><div><small>{t('memoryReview.currentDecision')}</small><p>{selected.conflict.current}</p></div><label><input type="checkbox" checked={resolved} onChange={(event) => setResolved(event.target.checked)} />{t('memoryReview.resolveConflict')}</label></section>}
            <section className="memory-review-inspector-section"><h4>{t('memoryReview.appliesTo')}</h4><div className="memory-review-applies">{selected.appliesTo.map((item) => <span key={item}>{item}</span>)}</div></section>
            {selected.status === 'accepted' && <section className="memory-review-inspector-section"><h4>{t('memoryReview.promotion')}</h4><ol className="memory-review-promotion-line"><li>{t('memoryReview.nativeEvidence')}</li><li>{t('memoryReview.candidate')}</li><li>{t('memoryReview.humanReview')}</li><li><Check size={13} aria-hidden="true" />{selected.owner}</li></ol></section>}
          </div>
          {selected.status !== 'accepted' && <footer className="memory-review-review-actions"><label className="memory-review-owner-select"><span>{t('memoryReview.promoteTo')}</span><select aria-label={t('memoryReview.promoteTo')} value={selected.owner} onChange={(event) => update({ owner: event.target.value as MemoryOwner })}>{OWNERS.map((owner) => <option key={owner}>{owner}</option>)}</select><CaretDown size={12} aria-hidden="true" /></label><button className="primary" type="button" disabled={selected.statement.trim() === '' || (selected.status === 'conflict' && !resolved)} onClick={() => decide('accepted')}><Check size={15} aria-hidden="true" />{t('memoryReview.accept')}<ArrowRight size={12} aria-hidden="true" />{selected.owner}</button><div><button type="button" onClick={() => setEditing((value) => !value)}><PencilSimple size={14} aria-hidden="true" />{editing ? t('memoryReview.done') : t('memoryReview.edit')}</button><button type="button" onClick={() => decide('rejected')}><X size={14} aria-hidden="true" />{t('memoryReview.reject')}</button></div></footer>}
        </>}
      </aside>
    </div>
    <footer className="memory-review-status"><span role="status">{notice || t('memoryReview.previewBoundary')}</span><span>{evidenceCount} {t('memoryReview.exampleEvidence')}</span></footer>
  </section>;
}
