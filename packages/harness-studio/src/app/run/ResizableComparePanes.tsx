import { fitComparePaneSizes } from "./compare-pane-sizes.js";
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSessionOwnedState } from './session-view-store.js';

export function ResizableComparePanes({ owner, panes }: { owner: string; panes: { key: string; label: string; content: ReactNode }[] }): React.JSX.Element {
  const { t } = useTranslation('compare');
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ index: number; x: number; left: number; right: number } | undefined>(undefined);
  const [width, setWidth] = useState(0);
  const [sizes, setSizes] = useSessionOwnedState<number[]>(`${owner}:split:${panes.length}`, () => panes.map(() => 1));
  const usable = Math.max(1, width - (panes.length - 1) * 6);
  const fitted = fitComparePaneSizes(sizes, usable);
  const stacked = width < Math.max(600, panes.length * 220);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(root.current!); return () => observer.disconnect();
  }, []);
  function resize(index: number, left: number, pair = fitted[index]! + fitted[index + 1]!): void {
    const minimum = Math.min(220, pair / 2);
    const value = Math.max(minimum, Math.min(pair - minimum, left));
    setSizes(fitted.map((size, i) => i === index ? value : i === index + 1 ? pair - value : size));
  }
  return <div ref={root} className="live-compare-lanes" data-layout={stacked ? 'stacked' : 'columns'}
    style={stacked ? undefined : { gridTemplateColumns: fitted.map(size => `minmax(0, ${size}fr)`).join(' 6px ') }}>
    {panes.map((pane, index) => <Fragment key={pane.key}>
      {pane.content}
      {index < panes.length - 1 && <div className="compare-sash debugger-sash" role="separator" tabIndex={stacked ? -1 : 0}
        aria-orientation="vertical" aria-label={t('live.resize', { left: pane.label, right: panes[index + 1]!.label })}
        aria-valuemin={220} aria-valuemax={Math.max(220, Math.round(fitted[index]! + fitted[index + 1]! - 220))} aria-valuenow={Math.round(fitted[index] ?? 220)}
        onPointerDown={event => { if (stacked || event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { index, x: event.clientX, left: fitted[index]!, right: fitted[index + 1]! }; }}
        onPointerMove={event => { const start = drag.current; if (start?.index === index) resize(index, start.left + event.clientX - start.x, start.left + start.right); }}
        onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); drag.current = undefined; }}
        onLostPointerCapture={() => { drag.current = undefined; }}
        onDoubleClick={() => resize(index, (fitted[index]! + fitted[index + 1]!) / 2)}
        onKeyDown={event => {
          const step = event.shiftKey ? 32 : 8;
          if (event.key === 'Home') resize(index, 220);
          else if (event.key === 'End') resize(index, fitted[index]! + fitted[index + 1]! - 220);
          else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') resize(index, fitted[index]! + (event.key === 'ArrowRight' ? step : -step));
          else return;
          event.preventDefault();
        }} />}
    </Fragment>)}
  </div>;
}
