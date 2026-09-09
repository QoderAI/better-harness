import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { House } from "@phosphor-icons/react/House";
import { Plug } from "@phosphor-icons/react/Plug";
import { HardDrives } from "@phosphor-icons/react/HardDrives";
import { Lightbulb } from "@phosphor-icons/react/Lightbulb";
import { BookOpen } from "@phosphor-icons/react/BookOpen";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { Robot } from "@phosphor-icons/react/Robot";
import { Lightning } from "@phosphor-icons/react/Lightning";
import { Users } from "@phosphor-icons/react/Users";
import { Wrench } from "@phosphor-icons/react/Wrench";
import { Terminal } from "@phosphor-icons/react/Terminal";
import type { ColumnDef } from "@tanstack/react-table";
import type { CustomizationAnalysisResponseV1 } from "@qoder-ai/harness/customization";
import { studioApiError } from "./studio-api.js";
import { DataTable } from "./shell/DataTable.js";
import { PaneSash } from "./shell/PaneSash.js";
import { ToolbarActions } from "./shell/ToolbarActions.js";
import {
  CUSTOMIZATION_CATEGORIES,
  customizationAgentFacets,
  customizationLibraryRows,
  filterCustomizationRows,
  searchCustomizationRows,
  type CustomizationCategory,
  type CustomizationLibraryRow,
} from "./customization-library.js";

const ICONS = { overview: House, plugins: Plug, mcp: HardDrives, skills: Lightbulb, instructions: BookOpen, agents: Robot, hooks: Lightning, tools: Wrench, commands: Terminal };

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
 * Coding Agent exposes it — and a reader needs to see both while looking at one.
 * They are the secondary sidebar's two sections rather than two `select` menus,
 * so the categories that exist, the Agents that were observed, and how many
 * entries each holds are all readable without opening anything. Entries stay in
 * the shared table, and the trailing pane answers "where did this come from" for
 * the selected row.
 */
export function CustomizationView(props: {
  analyzed: boolean;
  onAnalyzed: (definitionCount: number) => void;
}): React.JSX.Element {
  const { t } = useTranslation("customize");
  const [analysis, setAnalysis] = useState<CustomizationAnalysisResponseV1>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string>();
  const [category, setCategory] = useState<CustomizationCategory>("overview");
  const [agent, setAgent] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string>();
  const [navWidth, setNavWidth] = useState(NAV_WIDTH.default);
  const [frame, setFrame] = useState(0);
  const [focusedRow, setFocusedRow] = useState("category:overview");
  const navRefs = useRef(new Map<string, HTMLButtonElement>());
  const root = useRef<HTMLElement>(null);
  const alive = useRef(true);
  const detailStacked = useMediaQuery(DETAIL_STACK_QUERY);
  const narrow = useMediaQuery(NARROW_QUERY);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // The sash bounds come from the pane area itself, so a dragged width cannot
  // survive a window that no longer has room for it.
  useEffect(() => {
    const element = root.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => setFrame(entry!.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // One load per mounted View, including effect replay: the catalog is retained
  // on the server, so returning to the View reads it instead of collecting again.
  const initialLoad = useRef<Promise<CustomizationAnalysisResponseV1> | undefined>(undefined);
  const onAnalyzed = useRef(props.onAnalyzed);
  onAnalyzed.current = props.onAnalyzed;
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    initialLoad.current ??= (async () => {
      let response = await fetch(props.analyzed ? "api/customizations" : "api/customizations/analyze", props.analyzed ? undefined : { method: "POST" });
      if (props.analyzed && response.status === 404) response = await fetch("api/customizations/analyze", { method: "POST" });
      if (!response.ok) throw new Error(await studioApiError(response));
      return await response.json() as CustomizationAnalysisResponseV1;
    })();
    void initialLoad.current.then((value) => {
      if (!cancelled) { setAnalysis(value); setFailure(undefined); onAnalyzed.current(value.summary.definitionCount); }
    }).catch((error: unknown) => {
      if (!cancelled) setFailure(String(error));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function analyze(): Promise<void> {
    setBusy(true); setFailure(undefined);
    try {
      const response = await fetch("api/customizations/analyze", { method: "POST" });
      if (!response.ok) throw new Error(await studioApiError(response));
      const value = await response.json() as CustomizationAnalysisResponseV1;
      if (!alive.current) return;
      // A fresh collection replaces the retained catalog, so the failed initial
      // read must not be replayed if this View remounts.
      initialLoad.current = Promise.resolve(value);
      setAnalysis(value); props.onAnalyzed(value.summary.definitionCount);
    } catch (error) { if (alive.current) setFailure(String(error)); }
    finally { if (alive.current) setBusy(false); }
  }

  const rows = useMemo(() => analysis === undefined ? [] : customizationLibraryRows(analysis.catalog), [analysis]);
  const hosts = analysis?.catalog.hosts ?? [];
  const hostLabel = (id: string): string => hosts.find((item) => item.id === id)?.label ?? id;
  const agents = useMemo(() => customizationAgentFacets({ rows, category, hosts }), [rows, category, hosts]);
  const scoped = filterCustomizationRows(rows, category, agent);
  const visible = searchCustomizationRows(scoped, query);
  const detail = visible.find((row) => rowKey(row) === selected);
  const agentName = (id: string): string => id === "all" ? t("library.allAgents") : id === "unassigned" ? t("library.unassigned") : hostLabel(id);
  const busyState = loading || busy;

  // Both sections are one Tab stop and one Arrow-key ring: focus moves without
  // applying a filter, so a reader can look down the list before choosing.
  const navIds = [...CUSTOMIZATION_CATEGORIES.map((key) => `category:${key}`), ...agents.map((facet) => `agent:${facet.id}`)];
  const tabStop = navIds.includes(focusedRow) ? focusedRow : navIds[0]!;
  function moveNavFocus(event: ReactKeyboardEvent<HTMLElement>): void {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = Math.max(0, navIds.indexOf(focusedRow));
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? navIds.length - 1
        : event.key === "ArrowDown"
          ? (current + 1) % navIds.length
          : (current - 1 + navIds.length) % navIds.length;
    const id = navIds[next]!;
    setFocusedRow(id);
    navRefs.current.get(id)?.focus();
  }
  function navRow(options: { id: string; label: string; current: boolean; count?: number; status?: string; icon?: React.JSX.Element; onSelect: () => void }): React.JSX.Element {
    return <button
      key={options.id}
      ref={(node) => { if (node) navRefs.current.set(options.id, node); else navRefs.current.delete(options.id); }}
      type="button"
      tabIndex={tabStop === options.id ? 0 : -1}
      aria-current={options.current ? "true" : undefined}
      onFocus={() => setFocusedRow(options.id)}
      onClick={() => { setFocusedRow(options.id); options.onSelect(); }}
    >
      {options.icon}
      <span>{options.label}</span>
      {options.status === undefined
        ? options.count !== undefined && <small>{options.count}</small>
        : <small className="customization-nav-status">{t(`hosts.status.${options.status}`)}</small>}
    </button>;
  }

  const columns = useMemo<ColumnDef<CustomizationLibraryRow, never>[]>(() => [
    {
      id: "name",
      header: t("library.cols.name"),
      accessorFn: (row) => row.name,
      meta: { width: category === "overview" ? "28%" : "34%" },
      cell: ({ row }) => <button
        type="button"
        className="customization-name-cell"
        onClick={() => setSelected(rowKey(row.original))}
      >
        <strong>{row.original.name}</strong>
        {row.original.description !== undefined && row.original.description !== "" && <small title={row.original.description}>{row.original.description}</small>}
      </button>,
    },
    ...(category === "overview" ? [{
      id: "category",
      header: t("library.cols.category"),
      accessorFn: (row: CustomizationLibraryRow) => t(`library.categories.${row.category}`),
      meta: { width: "13%" },
    } as ColumnDef<CustomizationLibraryRow, never>] : []),
    {
      id: "agents",
      header: t("library.cols.agents"),
      accessorFn: (row) => row.hosts.length === 0 ? t("library.unassigned") : row.hosts.map(hostLabel).join(", "),
      meta: { width: category === "overview" ? "17%" : "18%" },
    },
    {
      id: "scope",
      header: t("library.cols.scope"),
      accessorFn: (row) => t(`library.scopes.${row.scope}`),
      meta: { width: "11%" },
    },
    {
      id: "evidence",
      header: t("library.cols.evidence"),
      accessorFn: (row) => t(`library.evidence.${row.evidence}`),
      meta: { width: category === "overview" ? "13%" : "15%" },
    },
    {
      id: "source",
      header: t("library.cols.source"),
      accessorFn: (row) => row.source ?? t("results.opaqueSource"),
      meta: { width: category === "overview" ? "18%" : "22%" },
      cell: ({ getValue }) => <code className="customization-source-cell" title={String(getValue())}>{String(getValue())}</code>,
    },
  ], [category, hosts, t]);

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
      <button type="button" disabled={busyState} onClick={() => void analyze()}>
        <ArrowClockwise aria-hidden="true" size={15} />
        {busyState ? t("analyzing") : failure === undefined ? t("library.refresh") : t("library.retry")}
      </button>
    </ToolbarActions>

    <nav className="customization-nav" aria-label={t("library.filtersAria")} onKeyDown={moveNavFocus}>
      <section aria-labelledby="customization-nav-library">
        <h2 id="customization-nav-library">{t("library.sections.library")}</h2>
        {CUSTOMIZATION_CATEGORIES.map((key) => {
          const Icon = ICONS[key];
          return navRow({
            id: `category:${key}`,
            label: t(`library.categories.${key}`),
            current: category === key,
            ...(analysis === undefined ? {} : { count: filterCustomizationRows(rows, key, agent).length }),
            icon: <Icon size={16} aria-hidden="true" weight={category === key ? "fill" : "regular"} />,
            onSelect: () => setCategory(key),
          });
        })}
      </section>
      <section aria-labelledby="customization-nav-agents">
        <h2 id="customization-nav-agents">{t("library.sections.agents")}</h2>
        {agents.map((facet) => navRow({
          id: `agent:${facet.id}`,
          label: agentName(facet.id),
          current: agent === facet.id,
          count: facet.count,
          ...(facet.status === undefined ? {} : { status: facet.status }),
          icon: facet.id === "all"
            ? <Users size={16} aria-hidden="true" weight={agent === "all" ? "fill" : "regular"} />
            : <Robot size={16} aria-hidden="true" weight={agent === facet.id ? "fill" : "regular"} />,
          onSelect: () => setAgent(facet.id),
        }))}
      </section>
    </nav>

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
        {failure !== undefined && <p role="alert">{failure}</p>}
        {busyState && analysis !== undefined && <p role="status">{t("loadingCatalog")}</p>}
        {category === "tools" && <p>{t("library.toolsBoundary")}</p>}
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
          minWidth={category === "overview" ? "680px" : "580px"}
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
            <div><dt>{t("library.cols.source")}</dt><dd><code>{detail.source ?? t("results.opaqueSource")}</code></dd></div>
          </dl>
        </div>}
    </aside>
  </section>;
}
