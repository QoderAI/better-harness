import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { InspectorToolCall } from "../inspector-session-model.js";

/** Bounded activity plot. Missing timestamps use call order, never invented time. */
export function ActionGraph({ calls, renderCall }: { calls: InspectorToolCall[]; renderCall(call: InspectorToolCall): ReactNode }): React.JSX.Element {
  const { t } = useTranslation("inspector");
  const [selected, setSelected] = useState(0);
  const [windowSize, setWindowSize] = useState(Math.min(60, calls.length));
  const minWindow = Math.min(15, calls.length);
  const maxWindow = Math.min(240, calls.length);
  const pointButtons = useRef(new Map<number, HTMLButtonElement>());
  const [start, setStart] = useState(0);
  const visible = calls.slice(start, start + windowSize);
  const timed = calls.every((call) => Number.isFinite(call.startedAt));
  const positions = visible.map((call, index) => timed ? Number(call.startedAt) : start + index);
  const low = Math.min(...positions);
  const high = Math.max(...positions);
  const names = [...new Set(visible.map((call) => call.toolName ?? call.operation ?? "tool"))];
  const choose = (index: number, focus = false): void => {
    const next = Math.max(0, Math.min(calls.length - 1, index));
    setSelected(next);
    if (next < start || next >= start + windowSize) setStart(Math.min(Math.max(0, calls.length - windowSize), Math.floor(next / windowSize) * windowSize));
    if (focus) requestAnimationFrame(() => pointButtons.current.get(next)?.focus());
  };
  const moveWindow = (next: number): void => {
    const offset = Math.max(0, Math.min(calls.length - windowSize, next));
    setStart(offset);
    setSelected(offset);
  };
  const zoom = (size: number): void => {
    setWindowSize(size);
    setStart(Math.max(0, Math.min(calls.length - size, selected - Math.floor(size / 2))));
  };
  return <div className="action-graph">
    <div className="action-graph-toolbar">
      <span>{t(timed ? "graph.time" : "graph.sequence")} · {start + 1}–{Math.min(start + windowSize, calls.length)} / {calls.length}</span>
      <button type="button" disabled={start === 0} onClick={() => moveWindow(start - windowSize)}>{t("graph.previous")}</button>
      <button type="button" disabled={start + windowSize >= calls.length} onClick={() => moveWindow(start + windowSize)}>{t("graph.next")}</button>
      <button type="button" disabled={windowSize <= minWindow} onClick={() => zoom(Math.max(minWindow, Math.floor(windowSize / 2)))}>{t("graph.zoomIn")}</button>
      <button type="button" disabled={windowSize >= maxWindow} onClick={() => zoom(Math.min(maxWindow, windowSize * 2))}>{t("graph.zoomOut")}</button>
    </div>
    <div className="action-graph-lanes" role="group" aria-label={t("graph.label")}>
      {names.map((name) => <div className="action-graph-lane" key={name}><span title={name}>{name}</span><div className="action-graph-track">{visible.map((call, index) => (call.toolName ?? call.operation ?? "tool") === name && <button
        type="button" key={call.id} tabIndex={selected === start + index ? 0 : -1} ref={(node) => { if (node) pointButtons.current.set(start + index, node); else pointButtons.current.delete(start + index); }} aria-label={`${start + index + 1} · ${name} · ${call.status ?? "unknown"}`}
        aria-pressed={selected === start + index} title={`${name} · ${call.status ?? "unknown"}`}
        style={{ left: `${high === low ? 50 : (positions[index]! - low) / (high - low) * 100}%` }}
        onClick={() => choose(start + index)}
        onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); choose(selected + (event.key === "ArrowLeft" ? -1 : 1), true); } }}
      ><i data-failed={call.status === "failed"} /></button>)}</div></div>)}
    </div>
    <div className="action-graph-axis"><span>{timed ? new Date(low).toISOString().slice(11, 19) : start + 1}</span><span>{timed ? new Date(high).toISOString().slice(11, 19) + " UTC" : Math.min(start + windowSize, calls.length)}</span></div>
    <div className="action-graph-selection" aria-live="polite">{calls[selected] && renderCall(calls[selected]!)}</div>
    <style>{`
      .action-graph{padding:var(--space-md);min-width:0}
      .action-graph-toolbar{display:flex;align-items:center;gap:var(--space-xs);flex-wrap:wrap;margin-bottom:var(--space-md)}
      .action-graph-toolbar>span{flex:1 0 100%;color:var(--color-text-muted)}
      .action-graph button{cursor:pointer}.action-graph button:focus-visible{outline:2px solid var(--color-focus)}
      .action-graph-toolbar button{background:var(--color-surface);color:var(--color-text);border:1px solid var(--color-border);border-radius:var(--radius-sm);min-height:28px}
      .action-graph-toolbar button:disabled{opacity:.5;cursor:default}
      .action-graph-lane{display:grid;grid-template-columns:minmax(0,100px) minmax(0,1fr);gap:var(--space-md);align-items:center;min-height:28px}
      .action-graph-lane>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .action-graph-track{position:relative;height:28px;margin-inline:12px;background:linear-gradient(var(--color-border),var(--color-border)) center/100% 1px no-repeat}
      .action-graph-track button{position:absolute;transform:translateX(-50%);width:24px;height:28px;padding:0;border:0;background:transparent;display:grid;place-items:center}
      .action-graph-track i{width:5px;height:14px;background:var(--color-categorical-1)}
      .action-graph-track i[data-failed=true]{background:var(--color-danger)}
      .action-graph-track button[aria-pressed=true]{outline:2px solid var(--color-primary);z-index:1}
      .action-graph-axis{display:flex;justify-content:space-between;margin:var(--space-xs) 12px var(--space-md) 112px;color:var(--color-text-muted)}
      .action-graph-selection .session-tool-row{grid-template-columns:40px minmax(0,1fr) auto}.action-graph-selection .session-tool-file{grid-column:2 / -1;white-space:normal;overflow-wrap:anywhere}
      .action-graph-selection{border-top:1px solid var(--color-border);overflow-wrap:anywhere}
    `}</style>
  </div>;
}
