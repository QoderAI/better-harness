import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { Robot } from "@phosphor-icons/react/Robot";
import { Users } from "@phosphor-icons/react/Users";
import type { ColumnDef } from "@tanstack/react-table";
import type { CustomizationAnalysisResponseV1 } from "@qoder-ai/harness/customization";
import type { CustomizationUsageV1 } from "../contracts/customization-usage.js";
import { FacetNavigation } from "./shell/FacetNavigation.js";
import { DataTable } from "./shell/DataTable.js";
import { PaneSash } from "./shell/PaneSash.js";
import { ToolbarActions } from "./shell/ToolbarActions.js";
import {
  customizationAgentFacets,
  customizationLibraryRows,
  customizationRowUsage,
  customizationUsageObservable,
  filterCustomizationRows,
  searchCustomizationRows,
  type CustomizationCategory,
  type CustomizationLibraryRow,
} from "./customization-library.js";

/** Filter-pane bounds, in px. The entries pane keeps the majority of the width. */
const NAV_WIDTH: { default: number; min: number; max: number } = { default: 200, min: 168, max: 320 };
const ENTRIES_MIN_WIDTH = 360;
/** The sash track's own thickness in the workbench grid. */
const NAV_SASH_SIZE = 6;
/** `--secondary-pane-width`: the provenance column, while it is a column. */
const DETAIL_WIDTH = 312;
/** The width below which the detail pane moves under the entries, per the stylesheet. */
const DETAIL_STACK_QUERY = "(max-width: 1080px)";
/** The width below which every region stacks, per the stylesheet. */
const NARROW_QUERY = "(max-width: 760px)";

function rowKey(row: CustomizationLibraryRow): string {
  return `${row.category}:${row.id}`;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => globalThis.matchMedia?.(query).matches === true);
  useEffect(() => {
    const media = globalThis.matchMedia?.(query);
    if (media === undefined) return;
    setMatches(media.matches);
    const sync = (event: MediaQueryListEvent): void => setMatches(event.matches);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [query]);
  return matches;
}

/**
 * The Customizations View: a docked workbench, not a pop-up.
 *
 * The catalog has two independent dimensions — what a definition is, and which
 * Coding Agent exposes it. The kind is a row of the primary sidebar and the
 * catalog itself is shell state, so this workbench renders the shell's catalog
 * and keeps the Agent dimension beside the entries it scopes. Entries stay in
 * the shared table, and the trailing pane answers "where did this come from" for
 * the selected row.
 */
export function CustomizationView(props: {
  /** The catalog kind to show, owned by the shell's sidebar and route. */
  category: CustomizationCategory;
  /** The retained catalog, loaded by the shell so the sidebar can count it too. */
  analysis?: CustomizationAnalysisResponseV1;
  loading: boolean;
  /** A re-collection is in flight, e.g. from the toolbar Refresh action. */
  busy: boolean;
  failure?: string;
  onAnalyze: () => void;
}): React.JSX.Element {
  const { t } = useTranslation("customize");
  const category = props.category;
  const [agent, setAgent] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string>();
  const [usage, setUsage] = useState<CustomizationUsageV1>();
  const [navWidth, setNavWidth] = useState(NAV_WIDTH.default);
  const [frame, setFrame] = useState(0);
  const root = useRef<HTMLElement>(null);
  const detailStacked = useMediaQuery(DETAIL_STACK_QUERY);
  const narrow = useMediaQuery(NARROW_QUERY);

  // The sash bounds come from the pane area itself, so a dragged width cannot
  // survive a window that no longer has room for it.
  useEffect(() => {
    const element = root.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => setFrame(entry!.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Observed invocations are a separate, optional reading of retained Sessions. A
  // Project whose provider cannot supply them keeps the catalog exactly as it is.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("api/customizations/usage");
        if (!response.ok) return;
        const value = await response.json() as CustomizationUsageV1;
        if (!cancelled && Array.isArray(value.entries)) setUsage(value);
      } catch {
        // Usage is supplementary; the catalog remains the View's evidence.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const analysis = props.analysis;
  const rows = useMemo(() => analysis === undefined ? [] : customizationLibraryRows(analysis.catalog), [analysis]);
  const hosts = analysis?.catalog.hosts ?? [];
  const hostLabel = (id: string): string => hosts.find((item) => item.id === id)?.label ?? id;
  const agents = useMemo(() => customizationAgentFacets({ rows, category, hosts }), [rows, category, hosts]);
  const scoped = filterCustomizationRows(rows, category, agent);
  const visible = searchCustomizationRows(scoped, query);
  const detail = visible.find((row) => rowKey(row) === selected);
  const detailUsage = detail === undefined ? undefined : customizationRowUsage(detail, usage, agent);
  // A column of dashes over a category no rule can observe would claim Studio
  // looked; the column appears only where an invocation is observable.
  const usageColumn = usage !== undefined && customizationUsageObservable(category);
  const agentName = (id: string): string => id === "all" ? t("library.allAgents") : id === "unassigned" ? t("library.unassigned") : hostLabel(id);
  const busyState = props.loading || props.busy;

  const columns = useMemo<ColumnDef<CustomizationLibraryRow, never>[]>(() => [
    {
      id: "name",
      header: t("library.cols.name"),
      accessorFn: (row) => row.name,
      meta: { width: usageColumn ? "32%" : "34%" },
      cell: ({ row }) => <button
        type="button"
        className="customization-name-cell"
        onClick={() => setSelected(rowKey(row.original))}
      >
        <strong>{row.original.name}</strong>
        {row.original.description !== undefined && row.original.description !== "" && <small title={row.original.description}>{row.original.description}</small>}
      </button>,
    },
    {
      id: "agents",
      header: t("library.cols.agents"),
      accessorFn: (row) => row.hosts.length === 0 ? t("library.unassigned") : row.hosts.map(hostLabel).join(", "),
      meta: { width: "18%" },
    },
    {
      id: "scope",
      header: t("library.cols.scope"),
      accessorFn: (row) => t(`library.scopes.${row.scope}`),
      meta: { width: "10%" },
    },
    {
      id: "evidence",
      header: t("library.cols.evidence"),
      accessorFn: (row) => t(`library.evidence.${row.evidence}`),
      meta: { width: "14%" },
    },
    // Observed invocations. Sorting treats an unobserved row as the lowest value
    // while the cell keeps saying "not observed", because a rendered 0 would claim
    // Studio proved the definition never ran.
    ...(usageColumn ? [{
      id: "uses",
      header: t("library.cols.uses"),
      accessorFn: (row: CustomizationLibraryRow) => customizationRowUsage(row, usage, agent)?.count ?? 0,
      meta: { width: "11%", numeric: true },
      cell: ({ row }: { row: { original: CustomizationLibraryRow } }) => {
        const observed = customizationRowUsage(row.original, usage, agent);
        return observed === undefined
          ? <span title={t("library.usage.notObserved")}>{"\u2014"}</span>
          : <span title={observed.lastObservedAt === undefined
            ? t("library.usage.observed", { count: observed.count })
            : t("library.usage.observedOn", { count: observed.count, date: observed.lastObservedAt.slice(0, 10) })}>{observed.count}</span>;
      },
    } as ColumnDef<CustomizationLibraryRow, never>] : []),
    {
      id: "source",
      header: t("library.cols.source"),
      accessorFn: (row) => row.source ?? t("results.opaqueSource"),
      // The declared widths total 100%: the trailing path column absorbs whatever
      // the Uses column is not using.
      meta: { width: usageColumn ? "15%" : "24%" },
      cell: ({ getValue }) => <code className="customization-source-cell" title={String(getValue())}>{String(getValue())}</code>,
    },
  ], [agent, hosts, t, usage, usageColumn]);

  const measured = frame > 0;
  const navMax = measured
    ? Math.max(NAV_WIDTH.min, Math.min(NAV_WIDTH.max, frame - ENTRIES_MIN_WIDTH - NAV_SASH_SIZE - (detailStacked ? 0 : DETAIL_WIDTH)))
    : NAV_WIDTH.default;
  const fittedNavWidth = Math.min(Math.max(navWidth, NAV_WIDTH.min), navMax);

  return <section
    ref={root}
    className="customization-workbench"
    aria-label={t("library.title")}
    style={measured ? { "--customization-nav-width": `${fittedNavWidth}px` } as CSSProperties : undefined}
  >
    <ToolbarActions>
      <button type="button" disabled={busyState} onClick={props.onAnalyze}>
        <ArrowClockwise aria-hidden="true" size={15} />
        {busyState ? t("analyzing") : props.failure === undefined ? t("library.refresh") : t("library.retry")}
      </button>
    </ToolbarActions>

    <FacetNavigation className="customization-nav" label={t("library.filtersAria")} groups={[
      { id: "agents", label: t("library.sections.agents"), items: agents.map(facet => ({
        id: `agent:${facet.id}`, label: agentName(facet.id), current: agent === facet.id, count: facet.count,
        ...(facet.status === undefined ? {} : { status: t(`hosts.status.${facet.status}`) }),
        icon: facet.id === "all" ? <Users size={16} aria-hidden="true" weight={agent === "all" ? "fill" : "regular"} /> : <Robot size={16} aria-hidden="true" weight={agent === facet.id ? "fill" : "regular"} />,
        onSelect: () => setAgent(facet.id),
      })) },
    ]} />

    <PaneSash
      orientation="vertical"
      label={t("library.resizeNavAria")}
      size={fittedNavWidth}
      min={NAV_WIDTH.min}
      max={navMax}
      fallback={NAV_WIDTH.default}
      disabled={narrow || !measured}
      onSize={setNavWidth}
    />

    <section className="customization-entries" aria-label={t("library.entriesAria")} aria-busy={busyState}>
      <header>
        <h2>{t(`library.categories.${category}`)}</h2>
        <span>{t("library.entryCount", { count: visible.length })}</span>
        <label className="customization-search">
          <MagnifyingGlass size={14} aria-hidden="true" />
          <input type="search" aria-label={t("library.searchLabel")} placeholder={t("library.searchLabel")} value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
      </header>
      <div className="customization-notices">
        {props.failure !== undefined && <p role="alert">{props.failure}</p>}
        {busyState && analysis !== undefined && <p role="status">{t("loadingCatalog")}</p>}
        {category === "tools" && <p>{t("library.toolsBoundary")}</p>}
        {usageColumn && <p>{t("library.usage.boundary", { count: usage.observedSessions, from: usage.window.from?.slice(0, 10) ?? "—", to: usage.window.to?.slice(0, 10) ?? "—" })}</p>}
        {analysis?.catalog.runtimeObservations.map((item) => item.kind === "host-collection" && item.message !== undefined && (agent === "all" || agent === item.hostId)
          ? <p key={item.id} role={item.status === "error" ? "alert" : "status"}>{hostLabel(item.hostId)}: {item.message}</p>
          : null)}
      </div>
      {analysis === undefined
        ? <p className="customization-entries-empty">{busyState ? t("collecting") : t("library.loadFailed")}</p>
        : <DataTable
          label={t(`library.categories.${category}`)}
          columns={columns}
          rows={visible}
          rowId={rowKey}
          minWidth={usageColumn ? "660px" : "580px"}
          initialSorting={[{ id: "name", desc: false }]}
          emptyMessage={query.trim() === "" ? t("library.noEntries") : t("library.noMatches")}
          onSelectRow={(row) => setSelected(rowKey(row))}
          {...(selected === undefined ? {} : { selectedRowId: selected })}
        />}
    </section>

    {/* One provenance pane in every layout. Where it sits, and whether a narrow
        window spends a region on its empty prompt, is the stylesheet's call. */}
    <aside className="customization-detail" aria-label={t("library.details.title")}>
      <header><h2>{t("library.details.title")}</h2></header>
      {detail === undefined
        ? <p className="customization-detail-empty">{t("library.details.empty")}</p>
        : <div className="customization-detail-scroll">
          <h3>{detail.name}</h3>
          {detail.description !== undefined && detail.description !== "" && <p>{detail.description}</p>}
          <dl>
            <div><dt>{t("library.cols.category")}</dt><dd>{t(`library.categories.${detail.category}`)}</dd></div>
            <div><dt>{t("library.cols.agents")}</dt><dd>{detail.hosts.length === 0 ? t("library.unassigned") : detail.hosts.map(hostLabel).join(", ")}</dd></div>
            <div><dt>{t("library.cols.scope")}</dt><dd>{t(`library.scopes.${detail.scope}`)}</dd></div>
            <div><dt>{t("library.cols.evidence")}</dt><dd>{t(`library.evidence.${detail.evidence}`)}</dd></div>
            {customizationUsageObservable(detail.category) && usage !== undefined && <div>
              <dt>{t("library.cols.uses")}</dt>
              <dd>{detailUsage === undefined
                ? t("library.usage.notObserved")
                : detailUsage.lastObservedAt === undefined
                  ? t("library.usage.observed", { count: detailUsage.count })
                  : t("library.usage.observedOn", { count: detailUsage.count, date: detailUsage.lastObservedAt.slice(0, 10) })}</dd>
            </div>}
            <div><dt>{t("library.cols.source")}</dt><dd><code>{detail.source ?? t("results.opaqueSource")}</code></dd></div>
          </dl>
        </div>}
    </aside>
  </section>;
}
