import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

const DEFAULTS = { tree: 200, inspector: 248 };
const MINIMUM = { tree: 160, inspector: 200 };
const CENTER_MINIMUM = 240;
const SASHES = 12;
type Pane = keyof typeof DEFAULTS;

export function ResizableDebuggerPanes(props: { tree: ReactNode; activity: ReactNode; inspector: ReactNode }): React.JSX.Element {
  const { t } = useTranslation("run");
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pane: Pane; x: number; size: number } | null>(null);
  const [width, setWidth] = useState(0);
  const [sizes, setSizes] = useState(DEFAULTS);
  const stacked = width < 700;
  // Derive fitting sizes without overwriting the user's preferences on a resize.
  const available = Math.max(0, width - CENTER_MINIMUM - SASHES);
  const tree = Math.max(MINIMUM.tree, Math.min(sizes.tree, available - MINIMUM.inspector));
  const inspector = Math.max(MINIMUM.inspector, Math.min(sizes.inspector, available - tree));
  const fitted = { tree, inspector };
  useEffect(() => {
    const element = root.current!;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  function maximum(pane: Pane): number { return Math.max(MINIMUM[pane], available - fitted[pane === "tree" ? "inspector" : "tree"]); }
  function resize(pane: Pane, size: number): void {
    setSizes((previous) => ({ ...previous, [pane]: Math.max(MINIMUM[pane], Math.min(maximum(pane), size)) }));
  }
  function sash(pane: Pane): React.JSX.Element {
    return <div className="debugger-sash" role="separator" tabIndex={stacked ? -1 : 0} aria-orientation="vertical"
      aria-label={t(pane === "tree" ? "resizeTree" : "resizeInspector")} aria-valuemin={MINIMUM[pane]} aria-valuemax={Math.round(maximum(pane))} aria-valuenow={Math.round(fitted[pane])}
      onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { pane, x: event.clientX, size: fitted[pane] }; }}
      onPointerMove={(event) => { if (drag.current?.pane === pane) resize(pane, drag.current.size + (event.clientX - drag.current.x) * (pane === "tree" ? 1 : -1)); }}
      onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); drag.current = null; }}
      onLostPointerCapture={() => { drag.current = null; }}
      onDoubleClick={() => resize(pane, DEFAULTS[pane])}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 32 : 8;
        if (event.key === "Home") resize(pane, MINIMUM[pane]);
        else if (event.key === "End") resize(pane, maximum(pane));
        else if (event.key === "ArrowLeft" || event.key === "ArrowRight") resize(pane, fitted[pane] + (event.key === "ArrowRight" ? step : -step) * (pane === "tree" ? 1 : -1));
        else return;
        event.preventDefault();
      }} />;
  }
  return <div ref={root} className="debugger-grid" data-layout={stacked ? "stacked" : "columns"}
    style={{ "--debugger-tree-width": `${tree}px`, "--debugger-inspector-width": `${inspector}px` } as CSSProperties}>
    {props.tree}{sash("tree")}{props.activity}{sash("inspector")}{props.inspector}
  </div>;
}
