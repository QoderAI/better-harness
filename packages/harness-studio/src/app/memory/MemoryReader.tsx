import { useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText } from '@phosphor-icons/react/FileText';
import { CaretDown } from '@phosphor-icons/react/CaretDown';
import { X } from '@phosphor-icons/react/X';
import type { MemoryDocument, MemoryEntry, MemorySnapshot, MemorySource } from '../../contracts/memory.js';
import { parseMarkdown } from '../../contracts/markdown-parser.js';
import { MarkdownBlockView } from '../artifacts/MarkdownArtifactView.js';
import { hostLabel } from './browser-model.js';

export function MemoryReader({ scrollPositions, document, source, snapshot, entry, reading, error, onRetry, onClose }: {
  scrollPositions: Map<string, number>; document: MemoryDocument; source?: MemorySource; snapshot?: MemorySnapshot; entry?: MemoryEntry; reading: boolean; error: boolean; onRetry: () => void; onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('common');
  const reader = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const positionKey = `${document.id}:${entry?.id ?? ''}`;
  useLayoutEffect(() => {
    if (snapshot?.documentId === document.id && body.current) body.current.scrollTop = scrollPositions.get(positionKey) ?? 0;
  }, [positionKey, snapshot?.digest, document.id, scrollPositions]);
  const blocks = useMemo(() => parseMarkdown(entry?.content ?? snapshot?.content ?? '').blocks, [entry, snapshot]);
  const scope = entry?.scope.kind ?? snapshot?.extraction?.contentScope ?? document.contentScope?.kind ?? 'unknown';
  return <section className="memory-reader" ref={reader} aria-label={t('memory.preview')}>
    <header className="memory-reader-header"><FileText size={16} aria-hidden="true" /><div className="memory-reader-heading"><strong>{document.metadata.title}</strong><div className="memory-reader-meta"><span>{hostLabel(document.provenance.host)}</span><span>{t(`memory.scopeLabels.${scope}`)}</span><span>{t(`memory.roles.${document.materialRole ?? 'unknown'}`)}</span></div></div><button type="button" aria-label={t('memory.close')} title={t('memory.close')} onClick={onClose}><X size={15} /></button></header>
    <div ref={body} className="memory-reader-body" aria-busy={reading} onScroll={event => { if (snapshot?.documentId === document.id) scrollPositions.set(positionKey, event.currentTarget.scrollTop); }}>
      {!snapshot ? <div className="memory-reader-state">{reading ? <p role="status">{t('memory.loading')}</p> : error && <><p role="alert">{t('memory.readError')}</p><button type="button" onClick={onRetry}>{t('memory.retry')}</button></>}</div>
        : <article className="markdown-document">{blocks.map((block, index) => <MarkdownBlockView key={index} block={block} context={{ resources: [], goTo: slug => { for (const node of reader.current?.querySelectorAll<HTMLElement>('[data-md-heading]') ?? []) if (node.dataset.mdHeading === slug) node.scrollIntoView({ block: 'nearest' }); } }} />)}</article>}
    </div>
    <details className="memory-provenance"><summary><CaretDown size={12} aria-hidden="true" /><span>{t('memory.provenance')}</span><span className="memory-provenance-path">{document.nativeIdentity.path}</span></summary><dl>
      <dt>{t('memory.support')}</dt><dd>{source?.support}</dd>
      <dt>{t('memory.library')}</dt><dd>{source?.library?.root ?? source?.root?.displayPath}</dd>
      <dt>{t('memory.binding')}</dt><dd>{document.binding?.identity ?? t(`memory.bindingLabels.${document.binding?.kind ?? 'unknown'}`)}</dd>
      {entry && <><dt>{t('memory.lines')}</dt><dd>{entry.source.startLine}–{entry.source.endLine}</dd></>}
      {snapshot && <><dt>SHA-256</dt><dd><code>sha256:{snapshot.digest}</code></dd><dt>{t('memory.captured')}</dt><dd>{new Date(snapshot.capturedAt).toLocaleString()}</dd></>}
    </dl></details>
  </section>;
}
