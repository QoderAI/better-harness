import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from '@phosphor-icons/react/ArrowLeft';
import { isPerformanceSource, type PerformanceSource, type TimingEvidence } from '../../contracts/session-performance.js';
import { HighlightedCode } from '../code/HighlightedCode.js';

export function PerformanceSourceView({ sessionId, record, headers, onClose }: {
  sessionId: string; record: TimingEvidence; headers: Record<string, string>; onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('performance');
  const [source, setSource] = useState<PerformanceSource>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => {
    const controller = new AbortController(); setSource(undefined); setError('');
    const query = new URLSearchParams({ source: record.source, line: String(record.line) });
    fetch(`api/session-performance/${encodeURIComponent(sessionId)}?${query}`, { headers, signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(response.status === 413 ? 'sourceLimit' : 'sourceError');
        const value: unknown = await response.json();
        if (!isPerformanceSource(value) || value.source !== record.source || value.line !== record.line) throw new Error('sourceError');
        if (!controller.signal.aborted) setSource(value);
      }).catch(reason => { if (!controller.signal.aborted) setError(reason.message === 'sourceLimit' ? 'sourceLimit' : 'sourceError'); });
    return () => controller.abort();
  }, [sessionId, record.source, record.line, headers, retry]);
  return <section className="performance-source-view" ref={ref} tabIndex={-1} aria-label={t('sourceTitle')} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <button onClick={onClose}><ArrowLeft size={15} aria-hidden="true" />{t('backEvidence')}</button>
    <h3>{t('sourceTitle')}</h3><code>{record.source}:{record.line}</code>
    <p className="performance-note">{t('sourceNote')}</p>
    {error ? <div role="alert"><p>{t(error)}</p><button onClick={() => setRetry(value => value + 1)}>{t('sourceRetry')}</button></div> : !source ? <p role="status">{t('sourceLoading')}</p> : <>
      {source.truncated && <p className="performance-warning">{t('sourceTruncated')}</p>}
      <HighlightedCode code={source.content} sourceHint="source.jsonl" startLine={source.startLine} highlightLine={source.line} label={t('sourceLine', { line: source.line })} />
    </>}
  </section>;
}
