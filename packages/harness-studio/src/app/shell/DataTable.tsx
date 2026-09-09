import { useState } from "react";
import { CaretUpDown } from "@phosphor-icons/react/CaretUpDown";
import { CaretUp } from "@phosphor-icons/react/CaretUp";
import { CaretDown } from "@phosphor-icons/react/CaretDown";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";

/**
 * The one data table for docked Studio panes.
 *
 * Every View used to hand-roll its own `<table>`, which is how the same pane
 * ended up with unbounded columns, a header that scrolled away, and rows whose
 * height came from whatever the longest cell happened to contain. TanStack is
 * headless, so the markup and the semantic tokens stay here while columns
 * declare only what the data means: how wide the column may get and whether it
 * carries numbers.
 *
 * DESIGN.md rules this component owns so callers cannot skip them: the header is
 * frozen in the local scroll region, numeric columns are marked rather than
 * inferred from position, value columns are bounded instead of splitting the
 * viewport into `1fr` lanes, and a row keeps the dense row height.
 */
export interface DataTableColumnMeta {
  /** Marks the cell and its header with the shared numeric role. */
  numeric?: boolean;
  /**
   * Bounds the column against the table width. Required: under a fixed layout a
   * column without a declared width divides the remainder equally, which is how
   * a status column ends up as wide as a path.
   */
  width: string;
}

export interface DataTableProps<Row> {
  columns: ColumnDef<Row, never>[];
  rows: Row[];
  rowId: (row: Row) => string;
  /** Names the table for assistive technology; panes have no visible caption. */
  label: string;
  /** The width below which the region scrolls horizontally instead of crushing columns. */
  minWidth: string;
  initialSorting?: SortingState;
  className?: string;
  /** Set when the table is the panel of a tablist. */
  role?: string;
  emptyMessage?: string;
  /** Optional document selection; cell buttons provide keyboard activation. */
  onSelectRow?: (row: Row) => void;
  selectedRowId?: string;
}

export function DataTable<Row>(props: DataTableProps<Row>): React.JSX.Element {
  const [sorting, setSorting] = useState<SortingState>(props.initialSorting ?? []);
  const table = useReactTable({
    data: props.rows,
    columns: props.columns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (row) => props.rowId(row),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    sortDescFirst: false,
  });
  const headers = table.getHeaderGroups();
  const rows = table.getRowModel().rows;

  return <div
    className={`data-table-scroll${props.className === undefined ? "" : ` ${props.className}`}`}
    role={props.role}
  >
    <table className="data-table" aria-label={props.label} style={{ minWidth: props.minWidth }}>
      <colgroup>{table.getAllLeafColumns().map((column) => {
        const meta = column.columnDef.meta as DataTableColumnMeta | undefined;
        return <col key={column.id} style={{ width: meta?.width }} />;
      })}</colgroup>
      <thead>{headers.map((group) => <tr key={group.id}>{group.headers.map((header) => {
        const meta = header.column.columnDef.meta as DataTableColumnMeta | undefined;
        const direction = header.column.getIsSorted();
        const label = flexRender(header.column.columnDef.header, header.getContext());
        return <th
          key={header.id}
          className={meta?.numeric === true ? "numeric" : undefined}
          aria-sort={direction === false ? undefined : direction === "asc" ? "ascending" : "descending"}
          scope="col"
        >
          {/* The visible column name is the button's accessible name and
             `aria-sort` on the header reports the state, so no extra label is
             needed and none can drift out of sync with the heading. */}
          {header.column.getCanSort()
            ? <button
              type="button"
              className="data-table-sort"
              onClick={header.column.getToggleSortingHandler()}
            >
              <span>{label}</span>
              {direction === false
                ? <CaretUpDown aria-hidden="true" size={11} />
                : direction === "asc"
                  ? <CaretUp aria-hidden="true" size={11} />
                  : <CaretDown aria-hidden="true" size={11} />}
            </button>
            : label}
        </th>;
      })}</tr>)}</thead>
      <tbody>{rows.length === 0 && props.emptyMessage !== undefined
        ? <tr className="data-table-empty"><td colSpan={table.getAllLeafColumns().length}>{props.emptyMessage}</td></tr>
        : rows.map((row) => <tr key={row.id} aria-selected={props.onSelectRow === undefined ? undefined : props.selectedRowId === row.id} onClick={props.onSelectRow === undefined ? undefined : () => props.onSelectRow?.(row.original)}>{row.getVisibleCells().map((cell) => {
          const meta = cell.column.columnDef.meta as DataTableColumnMeta | undefined;
          // Every column here clips, so a plain text value carries its full form
          // on hover. Cells that render their own markup own their own title.
          const value = cell.getValue();
          return <td
            key={cell.id}
            className={meta?.numeric === true ? "numeric" : undefined}
            title={cell.column.columnDef.cell === undefined && typeof value === "string" ? value : undefined}
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </td>;
        })}</tr>)}</tbody>
    </table>
  </div>;
}
