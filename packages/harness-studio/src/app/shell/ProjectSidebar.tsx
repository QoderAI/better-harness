import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Icon } from "@phosphor-icons/react";
import { BookOpen } from "@phosphor-icons/react/BookOpen";
import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { CaretRight } from "@phosphor-icons/react/CaretRight";
import { Gauge } from "@phosphor-icons/react/Gauge";
import { HardDrives } from "@phosphor-icons/react/HardDrives";
import { Binoculars } from "@phosphor-icons/react/Binoculars";
import { Brain } from "@phosphor-icons/react/Brain";
import { BugBeetle } from "@phosphor-icons/react/BugBeetle";
import { CaretUpDown } from "@phosphor-icons/react/CaretUpDown";
import { Flask } from "@phosphor-icons/react/Flask";
import { FolderOpen } from "@phosphor-icons/react/FolderOpen";
import { GitBranch } from "@phosphor-icons/react/GitBranch";
import { Lightbulb } from "@phosphor-icons/react/Lightbulb";
import { Lightning } from "@phosphor-icons/react/Lightning";
import { Package } from "@phosphor-icons/react/Package";
import { Plug } from "@phosphor-icons/react/Plug";
import { Plus } from "@phosphor-icons/react/Plus";
import { PuzzlePiece } from "@phosphor-icons/react/PuzzlePiece";
import { Robot } from "@phosphor-icons/react/Robot";
import { SidebarSimple } from "@phosphor-icons/react/SidebarSimple";
import { Terminal } from "@phosphor-icons/react/Terminal";
import { Wrench } from "@phosphor-icons/react/Wrench";
import { X } from "@phosphor-icons/react/X";
import type { StudioProjectDescriptor } from "../../contracts/studio-project.js";
import type { StudioDateRange } from "../date-range.js";
import { CUSTOMIZATION_CATEGORIES, type CustomizationCategory } from "../customization-library.js";
import { DateRangeFilter } from "./DateRangeFilter.js";
import type { StudioArea, StudioDestination } from "../studio-shell-model.js";

const VIEW_ICONS: Record<StudioArea, Icon> = {
  "memory-sources": Brain,
  memory: Brain,
  customizations: PuzzlePiece,
  sessions: Binoculars,
  "session-performance": Gauge,
  commits: GitBranch,
  artifacts: Package,
  debugger: BugBeetle,
  compare: Flask,
};

const CATEGORY_ICONS: Record<CustomizationCategory, Icon> = {
  plugins: Plug,
  mcp: HardDrives,
  skills: Lightbulb,
  instructions: BookOpen,
  agents: Robot,
  hooks: Lightning,
  tools: Wrench,
  commands: Terminal,
};

/** The two Views whose sub-routes are rows of the primary sidebar. */
type StudioNavGroup = "sessions" | "customizations";

/** Which Views a group's rows navigate to, for auto-expansion and selection. */
const GROUP_AREAS: Record<StudioNavGroup, readonly StudioArea[]> = {
  sessions: ["sessions", "session-performance", "commits"],
  customizations: ["customizations"],
};

export function ProjectSidebar(props: {
  projects: readonly StudioProjectDescriptor[];
  activeProjectId?: string;
  destinations: readonly StudioDestination[];
  /** Welcome belongs to the shell and does not select a project view. */
  current: StudioArea | null;
  opening: boolean;
  canOpenProject: boolean;
  onOpenProject: () => void;
  onActivateProject: (projectId: string) => void;
  onRemoveProject: (projectId: string) => void;
  onSelectView: (area: StudioArea) => void;
  /** The catalog kind the Customizations View is showing. */
  customizationCategory: CustomizationCategory;
  /** Entry count per catalog kind, when the retained catalog has been read. */
  customizationCounts: Partial<Record<CustomizationCategory, number>>;
  onSelectCustomizationCategory: (category: CustomizationCategory) => void;
  onCollapseSidebar: () => void;
  onCloseNavigation: () => void;
  /** The Studio-wide observation window every "observe" View reads. */
  dateRange: StudioDateRange;
  /** Sessions inside the window the bounded scan could not return. */
  omittedCount?: number;
  onDateRangeChange: (range: StudioDateRange) => void;
  /** Rendered as the sidebar's last row: appearance and language live here. */
  settings: ReactNode;
}): React.JSX.Element {
  const { t } = useTranslation("common");
  // Category names belong to the Customizations catalog, not to the shell copy.
  const { t: customizeT } = useTranslation("customize");
  const navigationRefs = useRef(new Map<string, HTMLButtonElement>());
  const switcherRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const activeProject = props.projects.find((project) => project.id === props.activeProjectId);

  // The sidebar now carries one level, so the roving tab stop covers the View
  // rows only. Projects moved to the switcher, which is a menu button with its
  // own keyboard contract.
  const memory = props.destinations.find(destination => destination.id === "memory");
  // The Customizations group is a catalog of definitions rather than a reading of
  // the Project, so it closes the View list after the evidence workbenches.
  const viewDestinations = [
    ...props.destinations.filter(destination => destination.id !== "memory" && destination.id !== "customizations"),
    ...(memory === undefined ? [] : [memory]),
    ...props.destinations.filter(destination => destination.id === "customizations"),
  ];
  // Two Views navigate by sub-route. Their rows are the sidebar's second level
  // rather than a strip inside the workspace, so the reader picks a Session
  // reading or a catalog kind in the same list that picks every other View.
  const [expanded, setExpanded] = useState<Record<StudioNavGroup, boolean>>({ sessions: true, customizations: true });
  const groupRows = (group: StudioNavGroup): string[] => group === "sessions"
    ? ["toggle:sessions", "view:sessions", "view:session-performance", "view:commits"]
    : CUSTOMIZATION_CATEGORIES.map(category => `category:${category}`);
  const groupOf = (destination: StudioDestination): StudioNavGroup | undefined => destination.id === "sessions"
    ? "sessions"
    : destination.id === "customizations" ? "customizations" : undefined;
  const nested = new Set<StudioArea>(["session-performance", "commits"]);
  const rowDestinations = viewDestinations.filter(destination => !nested.has(destination.id));
  const orderedIds = rowDestinations.flatMap((destination) => {
    const group = groupOf(destination);
    if (group === undefined) return [`view:${destination.id}`];
    return [`group:${group}`, ...(expanded[group] ? groupRows(group) : [])];
  });
  useEffect(() => {
    const current = props.current;
    if (current === null) return;
    const group = (Object.keys(GROUP_AREAS) as StudioNavGroup[]).find(key => GROUP_AREAS[key].includes(current));
    if (group !== undefined) setExpanded(value => value[group] ? value : { ...value, [group]: true });
  }, [props.current]);
  const selectedNavigationId = props.current === null
    ? ""
    : props.current === "customizations"
      ? `category:${props.customizationCategory}`
      : `view:${props.current === "memory-sources" ? "memory" : props.current}`;
  const [focusedNavigationId, setFocusedNavigationId] = useState(selectedNavigationId);
  const tabStopId = orderedIds.includes(focusedNavigationId)
    ? focusedNavigationId
    : orderedIds.includes(selectedNavigationId)
      ? selectedNavigationId
      : orderedIds[0];

  useEffect(() => {
    setFocusedNavigationId(selectedNavigationId);
  }, [props.activeProjectId, selectedNavigationId]);

  // A menu that stays open behind a click elsewhere reads as a stuck panel, and
  // Escape is the expected way out of a macOS pop-up.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return;
      if (switcherRef.current?.contains(event.target) === true) return;
      setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  function onNavigationKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
    const focusedKey = [...navigationRefs.current.entries()].find(([, button]) => button === document.activeElement)?.[0] ?? "";
    const owningGroup = (Object.keys(GROUP_AREAS) as StudioNavGroup[])
      .find(group => focusedKey === `group:${group}` || focusedKey === `toggle:${group}` || groupRows(group).includes(focusedKey));
    if (owningGroup !== undefined && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      setExpanded(value => ({ ...value, [owningGroup]: event.key === "ArrowRight" }));
      if (event.key === "ArrowLeft") { setFocusedNavigationId(`group:${owningGroup}`); navigationRefs.current.get(`group:${owningGroup}`)?.focus(); }
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    if (orderedIds.length === 0) return;
    event.preventDefault();
    const currentIndex = Math.max(0, orderedIds.indexOf(focusedKey === "" ? selectedNavigationId : focusedKey));
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? orderedIds.length - 1
        : event.key === "ArrowDown"
          ? (currentIndex + 1) % orderedIds.length
          : (currentIndex - 1 + orderedIds.length) % orderedIds.length;
    const nextId = orderedIds[nextIndex]!;
    setFocusedNavigationId(nextId);
    navigationRefs.current.get(nextId)?.focus();
  }

  /** View navigation carries identity; evidence status belongs in its view. */
  function renderView(destination: StudioDestination, label = destination.label): React.JSX.Element {
    const ViewIcon = VIEW_ICONS[destination.id];
    const selected = props.current === destination.id || (props.current === "memory-sources" && destination.id === "memory");
    const navigationId = `view:${destination.id}`;
    return <button
      key={destination.id}
      ref={(node) => { if (node) navigationRefs.current.set(navigationId, node); else navigationRefs.current.delete(navigationId); }}
      type="button"
      tabIndex={tabStopId === navigationId ? 0 : -1}
      aria-current={selected ? "page" : undefined}
      title={destination.status}
      onFocus={() => setFocusedNavigationId(navigationId)}
      onClick={() => { setFocusedNavigationId(navigationId); props.onSelectView(destination.id); }}
    >
      <ViewIcon aria-hidden="true" size={15} weight={selected ? "fill" : "regular"} />
      <strong>{label}</strong>
    </button>;
  }

  /** One catalog kind of the Customizations View, as a row of its group. */
  function renderCategory(category: CustomizationCategory): React.JSX.Element {
    const CategoryIcon = CATEGORY_ICONS[category];
    const selected = props.current === "customizations" && props.customizationCategory === category;
    const navigationId = `category:${category}`;
    const count = props.customizationCounts[category];
    return <button
      key={category}
      ref={(node) => { if (node) navigationRefs.current.set(navigationId, node); else navigationRefs.current.delete(navigationId); }}
      type="button"
      tabIndex={tabStopId === navigationId ? 0 : -1}
      aria-current={selected ? "page" : undefined}
      onFocus={() => setFocusedNavigationId(navigationId)}
      onClick={() => { setFocusedNavigationId(navigationId); props.onSelectCustomizationCategory(category); }}
    >
      <CategoryIcon aria-hidden="true" size={15} weight={selected ? "fill" : "regular"} />
      <strong>{customizeT(`library.categories.${category}`)}</strong>
      {count !== undefined && <small>{count}</small>}
    </button>;
  }

  /** Sessions keeps its children visible while other Views are open, and the
   *  label itself navigates to Overview. The caret is the only control that
   *  collapses the group, so switching to Compare cannot hide Sessions. */
  function renderGroup(group: StudioNavGroup, destination: StudioDestination): React.JSX.Element {
    const GroupIcon = VIEW_ICONS[destination.id];
    const open = expanded[group];
    const navigationId = `group:${group}`;
    const children = open && <div id={`studio-nav-group-${group}`} className="studio-nav-group-children">
      {group === "sessions"
        ? <>
          {renderView(destination, t("area.sessionOverview"))}
          {renderView(props.destinations.find(d => d.id === "session-performance")!)}
          {renderView(props.destinations.find(d => d.id === "commits")!)}
        </>
        : CUSTOMIZATION_CATEGORIES.map(renderCategory)}
    </div>;
    if (group === "sessions") {
      return <div key={group} className="studio-nav-group">
        <div className="studio-nav-group-row">
          <button
            type="button"
            className="studio-nav-group-label"
            ref={(node) => { if (node) navigationRefs.current.set(navigationId, node); else navigationRefs.current.delete(navigationId); }}
            tabIndex={tabStopId === navigationId ? 0 : -1}
            onFocus={() => setFocusedNavigationId(navigationId)}
            onClick={() => {
              setExpanded((value) => value[group] ? value : { ...value, [group]: true });
              setFocusedNavigationId(`view:${destination.id}`);
              props.onSelectView(destination.id);
            }}
          >
            <GroupIcon aria-hidden="true" size={15} />
            <strong>{destination.label}</strong>
          </button>
          <button
            type="button"
            className="studio-nav-group-toggle"
            aria-expanded={open}
            aria-controls={`studio-nav-group-${group}`}
            aria-label={t("sidebar.groupToggleAria", { label: destination.label })}
            ref={(node) => { if (node) navigationRefs.current.set(`toggle:${group}`, node); else navigationRefs.current.delete(`toggle:${group}`); }}
            tabIndex={tabStopId === `toggle:${group}` ? 0 : -1}
            onFocus={() => setFocusedNavigationId(`toggle:${group}`)}
            onClick={() => setExpanded((value) => ({ ...value, [group]: !value[group] }))}
          >
            {open ? <CaretDown aria-hidden="true" size={13} /> : <CaretRight aria-hidden="true" size={13} />}
          </button>
        </div>
        {children}
      </div>;
    }
    return <div key={group} className="studio-nav-group">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`studio-nav-group-${group}`}
        ref={(node) => { if (node) navigationRefs.current.set(navigationId, node); else navigationRefs.current.delete(navigationId); }}
        tabIndex={tabStopId === navigationId ? 0 : -1}
        onFocus={() => setFocusedNavigationId(navigationId)}
        onClick={() => setExpanded((value) => ({ ...value, [group]: !value[group] }))}
      >
        <GroupIcon aria-hidden="true" size={15} />
        <strong>{destination.label}</strong>
        {open ? <CaretDown aria-hidden="true" size={13} /> : <CaretRight aria-hidden="true" size={13} />}
      </button>
      {children}
    </div>;
  }

  return <aside className="studio-primary-nav studio-project-sidebar" aria-label={t("sidebar.aria")}>
    <header className="studio-product-brand">
      <button className="studio-sidebar-collapse" type="button" aria-label={t("sidebar.collapseAria")} title={t("sidebar.collapseTitle")} onClick={props.onCollapseSidebar}><SidebarSimple aria-hidden="true" size={17} /></button>
      <div><strong>{t("brand.product")}</strong><small>{t("brand.studio")}</small></div>
      <button className="studio-project-close" type="button" aria-label={t("workspace:gate.closeAria")} onClick={props.onCloseNavigation}><X aria-hidden="true" size={15} /></button>
    </header>

    {/* The Project is the sidebar's scope, not one of its rows. A switcher states
        that scope in one line and keeps every remembered Project one click away,
        so a second Project can no longer appear below the View list. */}
    <div className="studio-project-switcher" ref={switcherRef}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        disabled={props.opening}
        aria-label={t("sidebar.switcherAria", { label: activeProject?.label ?? t("sidebar.noProject") })}
        onClick={() => setMenuOpen((value) => !value)}
      >
        <FolderOpen aria-hidden="true" size={15} weight={activeProject === undefined ? "regular" : "fill"} />
        <strong>{activeProject?.label ?? t("sidebar.noProject")}</strong>
        {activeProject !== undefined && activeProject.availability === "unavailable" && <small>{t("sidebar.unavailable")}</small>}
        <CaretUpDown aria-hidden="true" size={13} />
      </button>
      {menuOpen && <div className="studio-project-menu" role="menu" aria-label={t("sidebar.projectMenuAria")}>
        {props.projects.length === 0 && <p className="studio-project-empty"><FolderOpen aria-hidden="true" size={16} /><span>{t("sidebar.empty")}</span></p>}
        {props.projects.map((project) => {
          const active = project.id === props.activeProjectId;
          const detail = project.availability === "unavailable"
            ? t("sidebar.unavailable")
            : t("sidebar.projectMeta", { count: project.sessionCount, kind: project.gitEnabled ? t("sidebar.git") : t("sidebar.folder") });
          return <div className={`studio-project-menu-row${active ? " active" : ""}`} key={project.id}>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={active}
              aria-keyshortcuts="Delete"
              onKeyDown={(event) => { if (event.key === "Delete") { event.preventDefault(); props.onRemoveProject(project.id); } }}
              onClick={() => { setMenuOpen(false); props.onActivateProject(project.id); }}
            >
              <strong>{project.label}</strong>
              <small>{detail}</small>
            </button>
            <button className="studio-project-remove" type="button" tabIndex={-1} disabled={props.opening} aria-label={t("sidebar.removeAria", { label: project.label })} title={t("sidebar.removeTitle", { label: project.label })} onClick={() => props.onRemoveProject(project.id)}><X aria-hidden="true" size={13} /></button>
          </div>;
        })}
        <button
          className="studio-project-open"
          type="button"
          role="menuitem"
          disabled={props.opening || !props.canOpenProject}
          title={props.canOpenProject ? t("sidebar.openProject") : t("sidebar.noDiscovery")}
          onClick={() => { setMenuOpen(false); props.onOpenProject(); }}
        >
          {props.opening ? <span className="studio-project-spinner" aria-hidden="true" /> : <Plus aria-hidden="true" size={15} />}
          <span>{props.opening ? t("sidebar.openingAria") : props.canOpenProject ? t("sidebar.openProject") : t("sidebar.openingUnavailable")}</span>
        </button>
      </div>}
    </div>

    {/* The Project says where to look; this says when. Both scope every View
        below, which is why neither is one of the rows. Scanning is an action on
        that scope rather than part of it, so it lives in the toolbar. */}
    <DateRangeFilter range={props.dateRange} omittedCount={props.omittedCount} onChange={props.onDateRangeChange} />

    <nav aria-label={t("sidebar.navAria")} onKeyDown={onNavigationKeyDown}>
      <section
        className="studio-project-views"
        aria-label={activeProject === undefined ? t("sidebar.configuredViewsAria") : t("sidebar.viewsAria", { label: activeProject.label })}
      >
        <h2>{t("sidebar.views")}</h2>
        {rowDestinations.map((destination) => {
          const group = groupOf(destination);
          return group === undefined ? renderView(destination) : renderGroup(group, destination);
        })}
      </section>
    </nav>

    <footer className="studio-sidebar-footer">{props.settings}</footer>
  </aside>;
}
