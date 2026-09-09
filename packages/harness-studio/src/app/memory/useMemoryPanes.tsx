import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
const defaults = { explorer: 280, analysis: 360 };
const minimum = { explorer: 180, analysis: 280 };
type Pane = keyof typeof defaults;

export function useMemoryPanes(analysis: boolean) {
  const { t } = useTranslation('common');
  const root = useRef<HTMLElement>(null);
  const drag = useRef<{ pane: Pane; x: number; size: number } | undefined>(undefined);
  const [layout, setLayout] = useState({ width: 0, narrow: false, compact: false });
  const [sizes, setSizes] = useState(defaults);
  useEffect(() => {
    const update = () => setLayout({ width: root.current?.clientWidth ?? 0, narrow: matchMedia('(max-width: 700px)').matches, compact: matchMedia('(max-width: 1100px)').matches });
    const observer = new ResizeObserver(update); if (root.current) observer.observe(root.current);
    window.addEventListener('resize', update); update();
    return () => { observer.disconnect(); window.removeEventListener('resize', update); };
  }, []);
  const showExplorer = !layout.narrow && !(analysis && layout.compact);
  const available = Math.max(0, layout.width - 240 - (showExplorer ? 6 : 0) - (analysis ? 6 : 0));
  const explorer = Math.max(minimum.explorer, Math.min(sizes.explorer, available - (analysis ? minimum.analysis : 0)));
  const inspector = Math.max(minimum.analysis, Math.min(sizes.analysis, available - (showExplorer ? explorer : 0)));
  const fitted = { explorer, analysis: inspector };
  const maximum = (pane: Pane) => Math.max(minimum[pane], available - (pane === 'explorer' ? analysis ? inspector : 0 : showExplorer ? explorer : 0));
  const resize = (pane: Pane, value: number) => setSizes(previous => ({ ...previous, [pane]: Math.max(minimum[pane], Math.min(maximum(pane), value)) }));
  function sash(pane: Pane) {
    return <div className={`memory-sash memory-sash-${pane}`} role="separator" tabIndex={layout.narrow || (pane === 'explorer' && !showExplorer) ? -1 : 0} aria-orientation="vertical" aria-label={t(pane === 'explorer' ? 'memory.resizeExplorer' : 'memory.resizeAnalysis')} aria-valuemin={minimum[pane]} aria-valuemax={Math.round(maximum(pane))} aria-valuenow={Math.round(fitted[pane])}
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { pane, x: event.clientX, size: fitted[pane] }; }}
      onPointerMove={event => { if (drag.current?.pane === pane) resize(pane, drag.current.size + (event.clientX - drag.current.x) * (pane === 'explorer' ? 1 : -1)); }}
      onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); drag.current = undefined; }} onLostPointerCapture={() => { drag.current = undefined; }}
      onDoubleClick={() => resize(pane, defaults[pane])}
      onKeyDown={event => { const step = event.shiftKey ? 32 : 8;
        if (event.key === 'Home') resize(pane, minimum[pane]);
        else if (event.key === 'End') resize(pane, maximum(pane));
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') resize(pane, fitted[pane] + (event.key === 'ArrowRight' ? step : -step) * (pane === 'explorer' ? 1 : -1));
        else return; event.preventDefault();
      }} />;
  }
  return { root, sash, style: { '--memory-explorer-width': `${explorer}px`, '--memory-analysis-width': `${inspector}px` } as CSSProperties };
}
