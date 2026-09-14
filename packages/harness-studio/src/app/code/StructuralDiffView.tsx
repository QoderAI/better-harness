import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { CaretUp } from "@phosphor-icons/react/CaretUp";
import { FileCode } from "@phosphor-icons/react/FileCode";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { StructuralDiff, StructuralDiffLine, StructuralDiffSide } from "../../contracts/structural-diff.js";
import type { StudioCodeToken } from "./code-highlight.js";
import {
  blockIndexByRow,
  paintSegments,
  revisionSource,
  structuralChangeBlocks,
  structuralRowChange,
  type StructuralPaintedSegment,
  type StructuralRevision,
  type StructuralRowChange,
} from "./structural-diff-model.js";
import { useStudioTheme } from "../studio-theme.js";

/**
 * The structural reading of one changed file: aligned older/newer lines with
 * only the runs the engine flagged marked on each side.
 *
 * Removed runs borrow the danger role and added runs the success role, which is
 * the polarity Studio's validation surfaces already use. Inventing a diff-only
 * colour for the same meaning is exactly the token drift DESIGN.md forbids.
 *
 * The code itself is coloured by the same highlighter every other Studio code
 * surface uses, so a novel run reads as a marked region of ordinary source
 * rather than as the only legible thing on screen.
 */

type LineTokens = readonly (readonly StudioCodeToken[])[] | undefined;

export function StructuralDiffView(props: { diff: StructuralDiff; label: string }): React.JSX.Element {
  const { t } = useTranslation("git");
  const theme = useStudioTheme();
  const lines = props.diff.lines;
  const blocks = useMemo(() => structuralChangeBlocks(lines), [lines]);
  const blockByRow = useMemo(() => blockIndexByRow(blocks), [blocks]);
  const sources = useMemo(() => ({ lhs: revisionSource(lines, "lhs"), rhs: revisionSource(lines, "rhs") }), [lines]);
  const [tokens, setTokens] = useState<{ lhs: LineTokens; rhs: LineTokens }>({ lhs: undefined, rhs: undefined });
  const [state, setState] = useState<"plain" | "loading" | "highlighted">("plain");
  const rows = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(-1);

  useEffect(() => {
    let cancelled = false;
    setTokens({ lhs: undefined, rhs: undefined });
    setState("loading");
    void import("./code-highlight.js")
      .then(async ({ highlightStudioCode }) => ({
        lhs: await highlightStudioCode(sources.lhs.text, props.diff.path, theme),
        rhs: await highlightStudioCode(sources.rhs.text, props.diff.path, theme),
      }))
      .then((next) => {
        if (cancelled) return;
        setTokens(next);
        setState(next.lhs === undefined && next.rhs === undefined ? "plain" : "highlighted");
      })
      .catch(() => { if (!cancelled) setState("plain"); });
    return () => { cancelled = true; };
  }, [sources, props.diff.path, theme]);

  // A new file starts unvisited: the previous file's position means nothing here.
  useEffect(() => { setCurrent(-1); }, [props.diff.sha, props.diff.path]);

  /** Move by change region, wrapping, and take the reader there. */
  function jump(direction: 1 | -1): void {
    if (blocks.length === 0) return;
    const next = current === -1
      ? (direction === 1 ? 0 : blocks.length - 1)
      : (current + direction + blocks.length) % blocks.length;
    setCurrent(next);
    rows.current
      ?.querySelector(`[data-row="${blocks[next]!.firstRow}"]`)
      ?.scrollIntoView({ block: "center", inline: "nearest" });
  }

  const changed = lines.filter((line) => structuralRowChange(line) !== "unchanged").length;
  return <div
    className="structural-diff"
    data-structural-diff="ready"
    data-diff-status={props.diff.status}
    data-language={props.diff.language}
    data-highlight-state={state}
    aria-label={props.label}
  >
    <header className="structural-diff-summary">
      <strong>{props.diff.language}</strong>
      <span>{t("structural.summary", { changed, total: lines.length })}</span>
      <div className="structural-diff-nav" role="group" aria-label={t("structural.navAria")}>
        <span aria-live="polite" data-change-position={current + 1}>{current === -1
          ? t("structural.changes", { total: blocks.length })
          : t("structural.changePosition", { index: current + 1, total: blocks.length })}</span>
        <button
          type="button"
          title={t("structural.previousChange")}
          aria-label={t("structural.previousChange")}
          disabled={blocks.length === 0}
          onClick={() => jump(-1)}
        ><CaretUp aria-hidden="true" size={12} /></button>
        <button
          type="button"
          title={t("structural.nextChange")}
          aria-label={t("structural.nextChange")}
          disabled={blocks.length === 0}
          onClick={() => jump(1)}
        ><CaretDown aria-hidden="true" size={12} /></button>
      </div>
    </header>
    {lines.length === 0
      ? <div className="git-diff-empty"><FileCode aria-hidden="true" size={22} /><p>{t("structural.noChanges")}</p></div>
      : <div className="structural-diff-rows" ref={rows}>
        {lines.map((line, index) => <Row
          key={`${index}:${line.lhs?.lineNumber ?? ""}:${line.rhs?.lineNumber ?? ""}`}
          line={line}
          index={index}
          tokens={tokens}
          sources={sources}
          block={blockByRow.get(index)}
          current={blockByRow.get(index) === current}
        />)}
      </div>}
  </div>;
}

interface RowContext {
  tokens: { lhs: LineTokens; rhs: LineTokens };
  sources: Record<StructuralRevision, { lineForRow: readonly number[] }>;
}

function Row(props: RowContext & {
  line: StructuralDiffLine;
  index: number;
  block: number | undefined;
  current: boolean;
}): React.JSX.Element {
  const change = structuralRowChange(props.line);
  const shared = {
    row: props.index,
    change,
    current: props.current,
    block: props.block,
  };
  return <div className="structural-diff-row" data-line={props.index} data-change={change} data-changed={change !== "unchanged"}>
    <Side {...shared} side={props.line.lhs} revision="lhs" tokens={lineTokens(props, "lhs")} />
    <ChangeMarker {...shared} />
    <Side {...shared} side={props.line.rhs} revision="rhs" tokens={lineTokens(props, "rhs")} />
  </div>;
}

function lineTokens(props: RowContext & { index: number }, revision: StructuralRevision): readonly StudioCodeToken[] | undefined {
  const line = props.sources[revision].lineForRow[props.index] ?? -1;
  if (line < 0) return undefined;
  return props.tokens[revision]?.[line];
}

/**
 * The change gutter between the two revisions: where the changes are, readable
 * while scrolling rather than only through the navigator. It is decorative -
 * the polarity of the runs and the navigator's live position already carry the
 * same information to assistive technology, and a control per row would add a
 * tab stop per line of the file.
 */
function ChangeMarker(props: { row: number; change: StructuralRowChange; current: boolean; block: number | undefined }): React.JSX.Element {
  return <span
    className="structural-diff-marker"
    aria-hidden="true"
    data-row={props.row}
    data-change={props.change}
    data-current={props.current}
    data-block={props.block}
  >{MARKER_GLYPH[props.change]}</span>;
}

const MARKER_GLYPH: Record<StructuralRowChange, string> = {
  added: "+",
  removed: "\u2212",
  modified: "\u2248",
  unchanged: "",
};

/**
 * Both sides always occupy a column, even when a line exists on only one of
 * them, so the two revisions stay aligned.
 */
function Side(props: {
  side: StructuralDiffSide | null;
  revision: StructuralRevision;
  row: number;
  change: StructuralRowChange;
  current: boolean;
  tokens: readonly StudioCodeToken[] | undefined;
}): React.JSX.Element {
  if (props.side === null) {
    return <div
      className="structural-diff-side"
      data-side={props.revision}
      data-row={props.row}
      data-absent="true"
      aria-hidden="true"
    />;
  }
  const painted = paintSegments(props.side.segments, props.tokens);
  return <div
    className="structural-diff-side"
    data-side={props.revision}
    data-row={props.row}
    data-change={props.change}
    data-current={props.current}
    data-line-number={props.side.lineNumber}
  >
    <span className="structural-diff-number" aria-hidden="true">{props.side.lineNumber}</span>
    <code className="structural-diff-code">{painted.length === 0
      ? "\u00a0"
      : painted.map((segment, index) => <span
        key={index}
        className={segment.novel ? "structural-diff-run" : undefined}
        style={segmentStyle(segment)}
        data-novel={segment.novel}
        data-highlight={segment.highlight}
      >{segment.text}</span>)}</code>
  </div>;
}

/**
 * The theme's foreground for this piece. It is an inline style, so it wins over
 * the run's polarity colour when the file is highlighted and leaves the polarity
 * colour in place when it is not.
 */
function segmentStyle(segment: StructuralPaintedSegment): React.CSSProperties | undefined {
  if (segment.color === undefined && (segment.fontStyle === undefined || segment.fontStyle === 0)) return undefined;
  const style = segment.fontStyle ?? 0;
  return {
    ...(segment.color === undefined ? {} : { color: segment.color }),
    ...((style & 1) === 0 ? {} : { fontStyle: "italic" }),
    ...((style & 2) === 0 ? {} : { fontWeight: 700 }),
    ...((style & 4) === 0 ? {} : { textDecoration: "underline" }),
  };
}
