import { useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CaretDown } from '@phosphor-icons/react/CaretDown';
import type { MemoryDocument, MemoryEntry, MemorySnapshot, MemorySource } from '../../contracts/memory.js';
import { parseMarkdown } from '../../contracts/markdown-parser.js';
import { MarkdownBlockView } from '../artifacts/MarkdownArtifactView.js';
import { hostLabel } from './browser-model.js';

export function MemoryReader({ scrollPositions, document, source, snapshot, entry, reading, error, onRetry }: {
  scrollPositions: Map<string, number>; document: MemoryDocument; source?: MemorySource; snapshot?: MemorySnapshot; entry?: MemoryEntry; reading: boolean; error: boolean; onRetry: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('common');
  const reader = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const positionKey = `${document.id}:${entry?.id ?? ''}`;
  useLayoutEffect(() => {
    if (snapshot?.documentId === document.id && body.current) body.current.scrollTop = scrollPositions.get(positionKey) ?? 0;
  }, [positionKey, snapshot?.digest, document.id, scrollPositions]);
  const content = entry?.content ?? snapshot?.content ?? '';
  const blocks = useMemo(() => parseMarkdown(content).blocks, [content]);
  const hasFrontmatter = /^---\s*(?:\r?\n|\r)/u.test(content) && blocks[0]?.kind === 'code' && blocks[0].language === 'yaml';
  const scope = entry?.scope.kind ?? snapshot?.extraction?.contentScope ?? document.contentScope?.kind ?? 'unknown';
  return <section className="memory-reader" ref={reader} aria-label={t('memory.preview')}>

    <div ref={body} className="memory-reader-body" aria-busy={reading} onScroll={event => { if (snapshot?.documentId === document.id) scrollPositions.set(positionKey, event.currentTarget.scrollTop); }}>
      {!snapshot ? <div className="memory-reader-state">{reading ? <p role="status">{t('memory.loading')}</p> : error && <><p role="alert">{t('memory.readError')}</p><button type="button" onClick={onRetry}>{t('memory.retry')}</button></>}</div>
        : <article className="markdown-document">{blocks.map((block, index) => { const rendered = <MarkdownBlockView key={index} block={block} context={{ resources: [], goTo: slug => { for (const node of reader.current?.querySelectorAll<HTMLElement>('[data-md-heading]') ?? []) if (node.dataset.mdHeading === slug) node.scrollIntoView({ block: 'nearest' }); } }} />; return hasFrontmatter && index === 0 ? <details key={`${positionKey}:frontmatter`} className="memory-frontmatter"><summary>{t('memory.frontmatter')}</summary>{rendered}</details> : rendered; })}</article>}
    </div>
    <details className="memory-provenance"><summary><CaretDown size={12} aria-hidden="true" /><span>{t('memory.provenance')}</span><span className="memory-provenance-path">{document.nativeIdentity.path}</span></summary><dl>
      <dt>{t('memory.host')}</dt><dd>{hostLabel(document.provenance.host)}</dd><dt>{t('memory.scope')}</dt><dd>{t(`memory.scopeLabels.${scope}`)}</dd>
      <dt>{t('memory.support')}</dt><dd>{source?.support}</dd>
      <dt>{t('memory.library')}</dt><dd>{source?.library?.root ?? source?.root?.displayPath}</dd>
      <dt>{t('memory.binding')}</dt><dd>{document.binding?.identity ?? t(`memory.bindingLabels.${document.binding?.kind ?? 'unknown'}`)}</dd>
      {entry && <><dt>{t('memory.lines')}</dt><dd>{entry.source.startLine}–{entry.source.endLine}</dd></>}
      {snapshot && <><dt>SHA-256</dt><dd><code>sha256:{snapshot.digest}</code></dd><dt>{t('memory.captured')}</dt><dd>{new Date(snapshot.capturedAt).toLocaleString()}</dd></>}
    </dl></details>
  </section>;
}
