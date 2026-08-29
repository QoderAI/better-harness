import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type {
  XlsxCellSnapshot,
  XlsxMergedRange,
  XlsxWorksheetSnapshot,
} from "../../../contracts/artifact.js";
import { ArtifactDiagnostics } from "../ArtifactDiagnostics.js";
import type { ArtifactSurfaceMountContext } from "../ArtifactSurface.js";
import { useArtifactSnapshot } from "../useArtifactSnapshot.js";

export function XlsxArtifactView({ artifact }: ArtifactSurfaceMountContext): React.JSX.Element {
  const { t } = useTranslation("artifactViewers");
  const { snapshot, failure } = useArtifactSnapshot(artifact, "xlsx/v1", "XLSX");
  const [sheetRequest, setSheetRequest] = useState<{ revisionId: string; sheetIndex: number }>();
  const [selection, setSelection] = useState<{ revisionId: string; address: string }>();
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const requestedSheetIndex = sheetRequest?.revisionId === artifact.revision.id ? sheetRequest.sheetIndex : undefined;
  const selectedAddress = selection?.revisionId === artifact.revision.id ? selection.address : undefined;
  const setSelectedAddress = (address: string): void => {
    setSelection({ revisionId: artifact.revision.id, address });
  };

  if (failure !== undefined) return <p className="artifact-status" role="alert">{failure}</p>;
  if (snapshot === undefined) return <p className="artifact-status" role="status">{t("xlsx.adapting")}</p>;

  const sheetIndex = requestedSheetIndex ?? snapshot.payload.activeSheetIndex;
  const sheet = snapshot.payload.sheets[Math.min(sheetIndex, snapshot.payload.sheets.length - 1)];
  if (sheet === undefined) return <p className="artifact-status" role="alert">{t("xlsx.noWorksheets")}</p>;
  const selectedCell = selectedAddress === undefined ? undefined : sheet.cells.find((cell) => cell.address === selectedAddress);
  return <div className="xlsx-artifact-viewer">
    <header className="xlsx-formula-bar">
      <strong>{selectedAddress ?? sheet.label}</strong>
      <span>{selectedCell?.formula === undefined ? (selectedCell?.display ?? t("xlsx.readOnlyWorkbook")) : `=${selectedCell.formula}`}</span>
    </header>
    <div ref={setScrollElement} className="xlsx-grid-scroll" aria-label={t("xlsx.worksheetAria", { label: sheet.label })}>
      <XlsxGrid sheet={sheet} selectedAddress={selectedAddress} onSelect={setSelectedAddress} scrollElement={scrollElement} />
    </div>
    <nav className="xlsx-sheet-tabs" aria-label={t("xlsx.worksheetsAria")}>
      {snapshot.payload.sheets.map((candidate, index) => <button
        key={candidate.id}
        type="button"
        className={candidate.id === sheet.id ? "selected" : undefined}
        aria-current={candidate.id === sheet.id}
        onClick={() => {
          setSheetRequest({ revisionId: artifact.revision.id, sheetIndex: index });
          setSelection(undefined);
        }}
      >{candidate.label}</button>)}
    </nav>
    <footer className="xlsx-diagnostics">
      <span>{snapshot.adapter.id}@{snapshot.adapter.version} · {t("readOnly")}</span>
      <ArtifactDiagnostics diagnostics={snapshot.diagnostics} />
    </footer>
  </div>;
}

function XlsxGrid(props: {
  sheet: XlsxWorksheetSnapshot;
  selectedAddress?: string;
  onSelect: (address: string) => void;
  scrollElement: HTMLDivElement | null;
}): React.JSX.Element {
  const model = useMemo(() => gridModel(props.sheet), [props.sheet]);
  const rowVirtualizer = useVirtualizer({
    count: props.sheet.rowCount,
    getScrollElement: () => props.scrollElement,
    estimateSize: (index) => rowHeight(props.sheet, index + 1),
    overscan: 8,
  });
  const columnVirtualizer = useVirtualizer({
    count: props.sheet.columnCount,
    getScrollElement: () => props.scrollElement,
    estimateSize: (index) => columnWidth(props.sheet, index + 1),
    horizontal: true,
    overscan: 4,
  });
  const rowItems = rowVirtualizer.getVirtualItems();
  const columnItems = columnVirtualizer.getVirtualItems();
  const rowOffsets = useMemo(
    () => dimensionOffsets(props.sheet.rowCount, (index) => rowHeight(props.sheet, index)),
    [props.sheet],
  );
  const columnOffsets = useMemo(
    () => dimensionOffsets(props.sheet.columnCount, (index) => columnWidth(props.sheet, index)),
    [props.sheet],
  );
  const rowWindow = expandMergedWindow(
    rowItems[0]?.index === undefined ? 1 : rowItems[0].index + 1,
    rowItems.at(-1)?.index === undefined ? Math.min(1, props.sheet.rowCount) : rowItems.at(-1)!.index + 1,
    props.sheet.mergedRanges,
    "row",
  );
  const columnWindow = expandMergedWindow(
    columnItems[0]?.index === undefined ? 1 : columnItems[0].index + 1,
    columnItems.at(-1)?.index === undefined ? Math.min(1, props.sheet.columnCount) : columnItems.at(-1)!.index + 1,
    props.sheet.mergedRanges,
    "column",
  );
  const rows = integerRange(rowWindow.start, rowWindow.end);
  const columns = integerRange(columnWindow.start, columnWindow.end);
  const topSpacer = rowOffsets[rowWindow.start - 1] ?? 0;
  const bottomSpacer = (rowOffsets.at(-1) ?? 0) - (rowOffsets[rowWindow.end] ?? 0);
  const leftSpacer = columnOffsets[columnWindow.start - 1] ?? 0;
  const rightSpacer = (columnOffsets.at(-1) ?? 0) - (columnOffsets[columnWindow.end] ?? 0);
  const physicalColumnCount = 1 + columns.length + Number(leftSpacer > 0) + Number(rightSpacer > 0);
  return <table className="xlsx-grid" role="grid" aria-rowcount={props.sheet.rowCount} aria-colcount={props.sheet.columnCount}>
    <colgroup>
      <col className="xlsx-row-number-column" />
      {leftSpacer > 0 && <col className="xlsx-column-spacer" style={{ width: `${leftSpacer}px` }} />}
      {columns.map((column) => <col key={column} style={{ width: `${columnWidth(props.sheet, column)}px` }} />)}
      {rightSpacer > 0 && <col className="xlsx-column-spacer" style={{ width: `${rightSpacer}px` }} />}
    </colgroup>
    <thead><tr>
      <th aria-hidden="true" />
      {leftSpacer > 0 && <th className="xlsx-column-spacer" aria-hidden="true" />}
      {columns.map((column) => <th key={column} scope="col">{columnLabel(column)}</th>)}
      {rightSpacer > 0 && <th className="xlsx-column-spacer" aria-hidden="true" />}
    </tr></thead>
    <tbody>
      {topSpacer > 0 && <tr className="xlsx-virtual-spacer" aria-hidden="true"><td colSpan={physicalColumnCount} style={{ height: `${topSpacer}px` }} /></tr>}
      {rows.map((row) => <tr key={row} data-index={row - 1} ref={rowVirtualizer.measureElement} style={{ height: `${rowHeight(props.sheet, row)}px` }}>
        <th scope="row">{row}</th>
        {leftSpacer > 0 && <td className="xlsx-column-spacer" aria-hidden="true" />}
        {columns.map((column) => {
          const key = coordinateKey(row, column);
          if (model.covered.has(key)) return undefined;
          const cell = model.cells.get(key);
          const merge = model.merges.get(key);
          const address = cell?.address ?? `${columnLabel(column)}${row}`;
          const selected = address === props.selectedAddress;
          return <td
            key={column}
            role="gridcell"
            tabIndex={selected || (props.selectedAddress === undefined && row === 1 && column === 1) ? 0 : -1}
            aria-selected={selected}
            aria-label={`${address}${cell?.display === undefined || cell.display === "" ? "" : ` ${cell.display}`}`}
            data-row={row}
            data-column={column}
            data-address={address}
            colSpan={merge === undefined ? undefined : merge.endColumn - merge.startColumn + 1}
            rowSpan={merge === undefined ? undefined : merge.endRow - merge.startRow + 1}
            className={selected ? "selected" : undefined}
            style={cellStyle(cell)}
            onClick={() => props.onSelect(address)}
            onKeyDown={(event) => handleCellKeyDown(
              event,
              address,
              props.sheet.rowCount,
              props.sheet.columnCount,
              props.onSelect,
              (index, options) => rowVirtualizer.scrollToIndex(index, options),
              (index, options) => columnVirtualizer.scrollToIndex(index, options),
            )}
          >{cell?.display ?? ""}</td>;
        })}
        {rightSpacer > 0 && <td className="xlsx-column-spacer" aria-hidden="true" />}
      </tr>)}
      {bottomSpacer > 0 && <tr className="xlsx-virtual-spacer" aria-hidden="true"><td colSpan={physicalColumnCount} style={{ height: `${bottomSpacer}px` }} /></tr>}
    </tbody>
  </table>;
}

function dimensionOffsets(count: number, size: (index: number) => number): number[] {
  const offsets = Array.from({ length: count + 1 }, () => 0);
  for (let index = 1; index <= count; index += 1) offsets[index] = offsets[index - 1]! + size(index);
  return offsets;
}

function expandMergedWindow(
  start: number,
  end: number,
  merges: readonly XlsxMergedRange[],
  axis: "column" | "row",
): { start: number; end: number } {
  let nextStart = start;
  let nextEnd = end;
  let changed = true;
  while (changed) {
    changed = false;
    for (const merge of merges) {
      const mergeStart = axis === "row" ? merge.startRow : merge.startColumn;
      const mergeEnd = axis === "row" ? merge.endRow : merge.endColumn;
      if (mergeEnd < nextStart || mergeStart > nextEnd) continue;
      if (mergeStart < nextStart) {
        nextStart = mergeStart;
        changed = true;
      }
      if (mergeEnd > nextEnd) {
        nextEnd = mergeEnd;
        changed = true;
      }
    }
  }
  return { start: nextStart, end: nextEnd };
}

function integerRange(start: number, end: number): number[] {
  return end < start ? [] : Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function gridModel(sheet: XlsxWorksheetSnapshot): {
  cells: Map<string, XlsxCellSnapshot>;
  merges: Map<string, XlsxMergedRange>;
  covered: Set<string>;
} {
  const cells = new Map(sheet.cells.map((cell) => [coordinateKey(cell.row, cell.column), cell]));
  const merges = new Map<string, XlsxMergedRange>();
  const covered = new Set<string>();
  for (const merge of sheet.mergedRanges) {
    const anchor = coordinateKey(merge.startRow, merge.startColumn);
    merges.set(anchor, merge);
    for (let row = merge.startRow; row <= merge.endRow; row += 1) {
      for (let column = merge.startColumn; column <= merge.endColumn; column += 1) {
        const key = coordinateKey(row, column);
        if (key !== anchor) covered.add(key);
      }
    }
  }
  return { cells, merges, covered };
}

function handleCellKeyDown(
  event: KeyboardEvent<HTMLTableCellElement>,
  address: string,
  rowCount: number,
  columnCount: number,
  onSelect: (address: string) => void,
  scrollToRow: (index: number, options?: { align?: "auto" | "center" | "end" | "start" }) => void,
  scrollToColumn: (index: number, options?: { align?: "auto" | "center" | "end" | "start" }) => void,
): void {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onSelect(address);
    return;
  }
  const delta = ({
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
    ArrowUp: [-1, 0],
  } as const)[event.key as "ArrowDown" | "ArrowLeft" | "ArrowRight" | "ArrowUp"];
  if (delta === undefined) return;
  event.preventDefault();

  const grid = event.currentTarget.closest<HTMLElement>("[role='grid']");
  let row = Number(event.currentTarget.dataset.row) + delta[0];
  let column = Number(event.currentTarget.dataset.column) + delta[1];
  while (row >= 1 && row <= rowCount && column >= 1 && column <= columnCount) {
    let target = grid?.querySelector<HTMLElement>(`[role='gridcell'][data-row='${row}'][data-column='${column}']`);
    if (target !== undefined && target !== null) {
      const targetAddress = target.dataset.address;
      if (targetAddress !== undefined) onSelect(targetAddress);
      target.focus();
      return;
    }
    const address = `${columnLabel(column)}${row}`;
    onSelect(address);
    scrollToRow(row - 1, { align: "auto" });
    scrollToColumn(column - 1, { align: "auto" });
    globalThis.requestAnimationFrame?.(() => {
      target = grid?.querySelector<HTMLElement>(`[role='gridcell'][data-row='${row}'][data-column='${column}']`);
      target?.focus();
    });
    return;
  }
}

function cellStyle(cell: XlsxCellSnapshot | undefined): CSSProperties | undefined {
  const style = cell?.style;
  if (style === undefined) return undefined;
  return {
    ...(style.fill === undefined ? {} : { backgroundColor: style.fill }),
    ...(style.color === undefined ? {} : { color: style.color }),
    ...(style.fontFamily === undefined ? {} : { fontFamily: `${JSON.stringify(style.fontFamily)}, system-ui, sans-serif` }),
    ...(style.fontSizePoints === undefined ? {} : { fontSize: `${style.fontSizePoints}pt` }),
    ...(style.bold === true ? { fontWeight: 700 } : {}),
    ...(style.italic === true ? { fontStyle: "italic" } : {}),
    ...(style.horizontalAlignment === undefined ? {} : { textAlign: style.horizontalAlignment }),
    ...(style.verticalAlignment === undefined ? {} : { verticalAlign: style.verticalAlignment }),
    ...(style.wrapText === true ? { whiteSpace: "normal", overflowWrap: "anywhere" } : {}),
  };
}

function columnWidth(sheet: XlsxWorksheetSnapshot, index: number): number {
  const width = sheet.columns.find((column) => column.index === index)?.width;
  return width === undefined ? 96 : Math.min(320, Math.max(48, Math.round(width * 7 + 12)));
}

function rowHeight(sheet: XlsxWorksheetSnapshot, index: number): number {
  const height = sheet.rows.find((row) => row.index === index)?.height;
  return height === undefined ? 24 : Math.min(160, Math.max(24, Math.round(height * 4 / 3)));
}

function coordinateKey(row: number, column: number): string {
  return `${row}:${column}`;
}

function columnLabel(column: number): string {
  let value = column;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}
