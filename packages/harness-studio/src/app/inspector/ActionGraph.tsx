import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { InspectorToolCall } from "../inspector-session-model.js";

/** Inspector 风格的活动图；缺失时间戳时按调用顺序展示，绝不虚构时间。 */
export function ActionGraph({ calls, renderCall }: { calls: InspectorToolCall[]; renderCall(call: InspectorToolCall): ReactNode }): React.JSX.Element {
  const { t } = useTranslation("inspector");
  const chart = useRef<HTMLElement>(null);
  const pointButtons = useRef(new Map<number, SVGRectElement>());
  const [width, setWidth] = useState(640);
  const model = useMemo(() => buildChartModel(calls, width), [calls, width]);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    const element = chart.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(300, Math.floor(entry!.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => setSelected((current) => Math.min(current, Math.max(0, model.marks.length - 1))), [model.marks.length]);

  const choose = (index: number, focus = false): void => {
    const next = Math.max(0, Math.min(model.marks.length - 1, index));
    setSelected(next);
    if (focus) requestAnimationFrame(() => pointButtons.current.get(next)?.focus());
  };
  const selectedMark = model.marks[selected];
  const selectedCall = selectedMark === undefined ? undefined : calls[selectedMark.callIndexes[0]!];
  const failedCalls = calls.filter((call) => call.status === "failed").length;
  const range = model.timeBasis
    ? `${formatAxisTime(model.min)} → ${formatAxisTime(model.max)} UTC`
    : `${model.min}–${model.max}`;
  const chartAria = `${calls.length} ${t("graph.label")} · ${t(model.timeBasis ? "graph.time" : "graph.sequence")}`;

  return <section ref={chart} className="action-graph chart-card" data-react-activity-chart role="group" aria-label={chartAria}>
    <div className="chart-toolbar">
      <span className={`chart-basis${model.timeBasis ? "" : " fallback"}`}>{t(model.timeBasis ? "graph.time" : "graph.sequence")}</span>
      <span className="chart-range">{range}</span>
    </div>
    <svg className="activity-chart" width={model.width} height={model.height} viewBox={`0 0 ${model.width} ${model.height}`} role="img" aria-label={chartAria}>
      <title>{chartAria}</title>
      <desc>{model.timeBasis ? "Observed calls are positioned by their retained timestamps." : "Timestamps are unavailable, so calls are positioned by sequence."}</desc>
      <rect className="chart-surface" x={model.plotLeft} y={model.topPad} width={model.plotWidth} height={model.laneArea - model.topPad} />
      {model.gaps.map((gap) => <g className="chart-gap" key={gap.key}><rect x={gap.x} y={model.topPad} width={gap.width} height={model.laneArea - model.topPad}><title>{gap.label}</title></rect>{gap.width > 46 && <text className="chart-gap-label" x={gap.x + gap.width / 2} y={model.topPad + 10} textAnchor="middle">{gap.shortLabel}</text>}</g>)}
      {model.ticks.map((tick) => <g key={tick.x}><line className="chart-grid-line" x1={tick.x} x2={tick.x} y1={model.topPad} y2={model.laneArea} /><text className="chart-tick" x={tick.x} y={model.laneArea + 17} textAnchor="middle">{tick.label}</text></g>)}
      {model.timeBasis && <g className="chart-ribbon"><rect className="chart-ribbon-base" x={model.plotLeft} y={8} width={model.plotWidth} height={22} rx={3} />{model.ribbon.map((call) => <rect className={`chart-ribbon-block${call.failed ? " failed" : ""}`} key={call.id} x={call.x} y={8} width={call.width} height={22} fill={call.tone}><title>{call.label}</title></rect>)}<text className="chart-lane-label chart-ribbon-label" x={model.labelWidth - 10} y={23} textAnchor="end">{t("graph.allActivity")}</text></g>}
      {model.lanes.map((lane, index) => <g className="chart-lane" key={lane.label}>{index % 2 === 1 && <rect className="chart-row-alt" x={model.labelWidth} y={model.laneTop(index)} width={model.width - model.labelWidth} height={model.rowHeight} />}<line className="chart-lane-line" x1={model.plotLeft - 6} x2={model.plotRight + 6} y1={model.laneTop(index) + model.rowHeight - 3} y2={model.laneTop(index) + model.rowHeight - 3} /><text className="chart-lane-label" x={model.labelWidth - 10} y={model.laneCenter(index) + 3} textAnchor="end"><title>{`${lane.title} · ${lane.count} calls`}</title>{lane.label}</text></g>)}
      {model.marks.map((mark, index) => <rect
        className={`chart-${mark.aggregate ? "bin" : "mark"}${mark.failed ? " failed" : ""}`}
        key={mark.key}
        ref={(node) => { if (node) pointButtons.current.set(index, node); else pointButtons.current.delete(index); }}
        x={mark.x}
        y={mark.y}
        width={mark.width}
        height={mark.height}
        rx={mark.aggregate ? 1 : 2}
        fill={mark.tone}
        tabIndex={selected === index ? 0 : -1}
        role="button"
        aria-pressed={selected === index}
        aria-label={mark.label}
        onClick={() => choose(index)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          choose(index + (event.key === "ArrowLeft" ? -1 : 1), true);
        }}
      ><title>{mark.label}</title></rect>)}
      <line className="chart-axis-line" x1={model.labelWidth} x2={model.plotRight + 6} y1={model.laneArea} y2={model.laneArea} />
      <text className="chart-axis-label" x={model.labelWidth - 10} y={model.laneArea + 17} textAnchor="end">{model.timeBasis ? "UTC" : t("graph.callAxis")}</text>
    </svg>
    <footer className="chart-statusbar">
      <div className="chart-inspector" aria-live="polite">{selectedCall && renderCall(selectedCall)}</div>
      <span className="chart-status-summary">{calls.length} / {calls.length} {t("lanes.callsFailed", { count: failedCalls })}</span>
      <span className="chart-status-legends"><span><i className="legend-dot failed" aria-hidden="true" />{failedCalls}</span>{model.gaps.length > 0 && <span><i className="legend-dot gap" aria-hidden="true" />{t("graph.idle")}</span>}</span>
    </footer>
  </section>;
}

interface ChartLane {
  label: string;
  title: string;
  count: number;
}

interface ChartMark {
  key: string;
  callIndexes: number[];
  x: number;
  y: number;
  width: number;
  height: number;
  tone: string;
  failed: boolean;
  aggregate: boolean;
  label: string;
}

interface ChartGap {
  key: string;
  x: number;
  width: number;
  label: string;
  shortLabel: string;
}

function buildChartModel(calls: InspectorToolCall[], availableWidth: number) {
  const hasObservedTime = calls.length > 0 && calls.every((call) => Number.isFinite(call.startedAt));
  const observedStarts = calls.map((call) => Number(call.startedAt));
  const observedMin = Math.min(...observedStarts);
  const observedMax = Math.max(...calls.map((call, index) => observedStarts[index]! + (call.durationStatus === "observed" && Number.isFinite(call.durationMs) ? Math.max(1, Number(call.durationMs)) : 0)));
  // 少于一秒的时间窗不足以形成可读时间轴；改用调用顺序，避免虚构无法区分调用的毫秒刻度。
  const timeBasis = hasObservedTime && observedMax - observedMin >= 1_000;
  const labelWidth = 132;
  const rowHeight = 26;
  const width = Math.max(300, Math.floor(availableWidth));
  const plotLeft = labelWidth + 12;
  const plotRight = width - 14;
  const plotWidth = Math.max(60, plotRight - plotLeft);
  const labels = calls.map(actionLabel);
  const positions = calls.map((call, index) => timeBasis ? Number(call.startedAt) : index + 1);
  const min = Math.min(...positions);
  const maxObserved = timeBasis ? observedMax : Math.max(...positions);
  const max = maxObserved > min ? maxObserved : min + 1;
  const counts = new Map<string, { count: number; first: number }>();
  for (const [index, label] of labels.entries()) {
    const current = counts.get(label);
    counts.set(label, current ? { ...current, count: current.count + 1 } : { count: 1, first: index });
  }
  const ranked = [...counts.entries()].sort(([left, leftValue], [right, rightValue]) => rightValue.count - leftValue.count || leftValue.first - rightValue.first || left.localeCompare(right));
  const visibleCount = ranked.length > 7 ? 6 : 7;
  const visible = new Set(ranked.slice(0, visibleCount).map(([label]) => label));
  const lanes: ChartLane[] = ranked.slice(0, visibleCount).map(([label, value]) => ({ label: truncate(label), title: label, count: value.count }));
  if (ranked.length > visibleCount) {
    const hidden = ranked.slice(visibleCount);
    lanes.push({ label: "Other activity", title: `Other activity: ${hidden.slice(0, 6).map(([label]) => label).join(", ")}`, count: hidden.reduce((total, [, value]) => total + value.count, 0) });
  }
  const laneFor = (index: number): number => {
    const label = labels[index]!;
    const visibleLabel = visible.has(label) ? label : "Other activity";
    return lanes.findIndex((lane) => lane.title === visibleLabel || lane.label === visibleLabel);
  };
  const topPad = timeBasis ? 44 : 8;
  const laneArea = topPad + lanes.length * rowHeight + 4;
  const fractionFor = (position: number): number => Math.max(0, Math.min(1, (position - min) / (max - min)));
  const xFor = (position: number): number => plotLeft + fractionFor(position) * plotWidth;
  const laneTop = (index: number): number => topPad + index * rowHeight;
  const laneCenter = (index: number): number => laneTop(index) + rowHeight / 2;
  const binCount = Math.max(1, Math.min(600, Math.floor(plotWidth / 5)));
  const bins = new Map<string, { lane: number; bin: number; callIndexes: number[]; failed: number; family?: string }>();
  for (const [index, position] of positions.entries()) {
    const lane = laneFor(index);
    const bin = Math.min(binCount - 1, Math.floor(fractionFor(position) * binCount));
    const key = `${lane}:${bin}`;
    const current = bins.get(key) ?? { lane, bin, callIndexes: [], failed: 0, family: calls[index]!.family };
    current.callIndexes.push(index);
    if (calls[index]!.status === "failed") current.failed += 1;
    bins.set(key, current);
  }
  const maxBin = Math.max(1, ...[...bins.values()].map((bin) => bin.callIndexes.length));
  const aggregate = maxBin > 1;
  const marks = [...bins.values()].sort((left, right) => left.lane - right.lane || left.bin - right.bin).map((bin): ChartMark => {
    const count = bin.callIndexes.length;
    const call = calls[bin.callIndexes[0]!]!;
    const position = positions[bin.callIndexes[0]!]!;
    const markWidth = aggregate ? Math.max(2, plotWidth / binCount - 1) : timeBasis && call.durationStatus === "observed" && Number.isFinite(call.durationMs) ? Math.max(3, Math.min(plotWidth, Number(call.durationMs) / (max - min) * plotWidth)) : 4;
    const height = aggregate ? 4 + Math.sqrt(count / maxBin) * (rowHeight - 11) : 10;
    const x = aggregate ? plotLeft + (bin.bin + 0.5) / binCount * plotWidth - markWidth / 2 : xFor(position);
    const y = aggregate ? laneTop(bin.lane) + rowHeight - 3 - height : laneCenter(bin.lane) - height / 2;
    const failed = bin.failed > 0;
    const tone = graphColor(bin.family, failed);
    const label = aggregate
      ? `${count} calls · ${lanes[bin.lane]!.title} · ${timeBasis ? formatAxisTime(position) + " UTC" : `calls ${bin.callIndexes[0]! + 1}–${bin.callIndexes.at(-1)! + 1}`}${bin.failed ? ` · ${bin.failed} failed` : ""}`
      : callLabel(call, bin.callIndexes[0]! + 1, timeBasis);
    return { key: `${bin.lane}-${bin.bin}`, callIndexes: bin.callIndexes, x, y, width: markWidth, height, tone, failed, aggregate, label };
  });
  const ordered = positions.filter((_, index) => timeBasis).sort((left, right) => left - right);
  const gaps: ChartGap[] = [];
  if (timeBasis && ordered.length > 1) {
    const threshold = Math.max(45_000, (max - min) / 120);
    for (let index = 1; index < ordered.length; index += 1) {
      const gap = ordered[index]! - ordered[index - 1]!;
      if (gap < threshold) continue;
      const x = xFor(ordered[index - 1]!);
      const right = xFor(ordered[index]!);
      gaps.push({ key: `${ordered[index - 1]}-${ordered[index]}`, x, width: Math.max(2, right - x), label: `No observed call for ${formatDuration(gap)}`, shortLabel: `idle ${formatDuration(gap)}` });
    }
  }
  const tickCount = Math.max(2, Math.min(7, Math.floor(plotWidth / 92)));
  const ticks = Array.from({ length: tickCount }, (_, index) => {
    const position = min + (max - min) * index / (tickCount - 1);
    return { x: xFor(position), label: timeBasis ? formatAxisTime(position) : String(Math.round(position)) };
  });
  const ribbon = timeBasis ? calls.map((call, index) => {
    const position = positions[index]!;
    const duration = call.durationStatus === "observed" && Number.isFinite(call.durationMs) ? Number(call.durationMs) : 0;
    return { id: call.id, x: xFor(position), width: Math.max(1.5, Math.min(plotWidth, duration / (max - min) * plotWidth || 1.5)), tone: graphColor(call.family, call.status === "failed"), failed: call.status === "failed", label: callLabel(call, index + 1, true) };
  }) : [];
  return { timeBasis, width, height: laneArea + 30, min, max, labelWidth, rowHeight, plotLeft, plotRight, plotWidth, topPad, laneArea, laneTop, laneCenter, lanes, marks, gaps, ticks, ribbon };
}

function actionLabel(call: InspectorToolCall): string {
  return call.actionLabel ?? call.toolName ?? call.operation ?? "Use tool";
}

function callLabel(call: InspectorToolCall, index: number, timeBasis: boolean): string {
  return `${index} · ${actionLabel(call)} · ${call.status ?? "observed"}${timeBasis ? ` · ${formatAxisTime(Number(call.startedAt))} UTC` : ""}`;
}

function formatAxisTime(value: number): string {
  return new Date(value).toISOString().slice(11, 19);
}

function formatDuration(value: number): string {
  if (value >= 3_600_000) return `${Math.round(value / 3_600_000)}h`;
  if (value >= 60_000) return `${Math.round(value / 60_000)}m`;
  return `${Math.max(1, Math.round(value / 1_000))}s`;
}

function graphColor(family: string | undefined, failed: boolean): string {
  if (failed) return "var(--color-danger)";
  const key = family ?? "other";
  const index = [...key].reduce((total, character) => total + character.codePointAt(0)!, 0) % 7 + 1;
  return `var(--color-categorical-${index})`;
}

function truncate(value: string): string {
  return [...value].length > 18 ? `${[...value].slice(0, 17).join("")}…` : value;
}
