import { useRef, useState } from "react";

/**
 * The divider between two docked panes. It is a real separator: draggable,
 * focusable, and keyboard operable, because a divider that only answers a
 * precise drag is unusable without a mouse.
 *
 * The sash always resizes the pane *before* it, so a caller places one between
 * two panes and reports that pane's current size and bounds. Double-click
 * returns the layout default.
 */
export function PaneSash(props: {
  orientation: "vertical" | "horizontal";
  label: string;
  size: number;
  min: number;
  max: number;
  fallback: number;
  disabled?: boolean;
  onSize: (size: number) => void;
}): React.JSX.Element {
  const drag = useRef<{ origin: number; size: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const vertical = props.orientation === "vertical";

  function commit(next: number): void {
    props.onSize(Math.round(Math.min(props.max, Math.max(props.min, next))));
  }

  return <div
    className={`studio-pane-sash${dragging ? " dragging" : ""}`}
    data-orientation={props.orientation}
    role="separator"
    tabIndex={props.disabled === true ? -1 : 0}
    aria-orientation={props.orientation}
    aria-label={props.label}
    aria-valuenow={Math.round(props.size)}
    aria-valuemin={Math.round(props.min)}
    aria-valuemax={Math.round(props.max)}
    onPointerDown={(event) => {
      if (event.button !== 0 || props.disabled === true) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { origin: vertical ? event.clientX : event.clientY, size: props.size };
      setDragging(true);
    }}
    onPointerMove={(event) => {
      const active = drag.current;
      if (active === null) return;
      commit(active.size + ((vertical ? event.clientX : event.clientY) - active.origin));
    }}
    onPointerUp={(event) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      drag.current = null;
      setDragging(false);
    }}
    onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
    onDoubleClick={() => commit(props.fallback)}
    onKeyDown={(event) => {
      const step = event.shiftKey ? 32 : 8;
      const shrink = vertical ? "ArrowLeft" : "ArrowUp";
      const grow = vertical ? "ArrowRight" : "ArrowDown";
      if (event.key === shrink) commit(props.size - step);
      else if (event.key === grow) commit(props.size + step);
      else if (event.key === "Home") commit(props.min);
      else if (event.key === "End") commit(props.max);
      else return;
      event.preventDefault();
    }}
  />;
}
