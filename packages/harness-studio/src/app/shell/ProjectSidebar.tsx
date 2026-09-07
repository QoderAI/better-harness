import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Icon } from "@phosphor-icons/react";
import { Binoculars } from "@phosphor-icons/react/Binoculars";
import { BugBeetle } from "@phosphor-icons/react/BugBeetle";
import { CaretUpDown } from "@phosphor-icons/react/CaretUpDown";
import { ChatText } from "@phosphor-icons/react/ChatText";
import { Flask } from "@phosphor-icons/react/Flask";
import { FolderOpen } from "@phosphor-icons/react/FolderOpen";
import { GitBranch } from "@phosphor-icons/react/GitBranch";
import { Package } from "@phosphor-icons/react/Package";
import { Plus } from "@phosphor-icons/react/Plus";
import { PuzzlePiece } from "@phosphor-icons/react/PuzzlePiece";
import { SidebarSimple } from "@phosphor-icons/react/SidebarSimple";
import { SquaresFour } from "@phosphor-icons/react/SquaresFour";
import { X } from "@phosphor-icons/react/X";
import type { StudioProjectDescriptor } from "../../contracts/studio-project.js";
import type { StudioArea, StudioDestination } from "../studio-shell-model.js";

const VIEW_ICONS: Record<StudioArea, Icon> = {
  overview: SquaresFour,
  customizations: PuzzlePiece,
  inputs: ChatText,
  sessions: Binoculars,
  commits: GitBranch,
  artifacts: Package,
  debugger: BugBeetle,
  compare: Flask,
};

export function ProjectSidebar(props: {
  projects: readonly StudioProjectDescriptor[];
  activeProjectId?: string;
  destinations: readonly StudioDestination[];
  current: StudioArea;
  opening: boolean;
  canOpenProject: boolean;
  onOpenProject: () => void;
  onActivateProject: (projectId: string) => void;
  onRemoveProject: (projectId: string) => void;
  onSelectView: (area: StudioArea) => void;
  onCollapseSidebar: () => void;
  onCloseNavigation: () => void;
  /** Rendered as the sidebar's last row: appearance and language live here. */
  settings: ReactNode;
}): React.JSX.Element {
  const { t } = useTranslation("common");
  const navigationRefs = useRef(new Map<string, HTMLButtonElement>());
  const switcherRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const activeProject = props.projects.find((project) => project.id === props.activeProjectId);

  // The sidebar now carries one level, so the roving tab stop covers the View
  // rows only. Projects moved to the switcher, which is a menu button with its
  // own keyboard contract.
  const orderedIds = props.destinations.map((destination) => `view:${destination.id}`);
  const selectedNavigationId = `view:${props.current}`;
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
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    if (orderedIds.length === 0) return;
    event.preventDefault();
    const focused = [...navigationRefs.current.entries()].find(([, button]) => button === document.activeElement)?.[0];
    const currentIndex = Math.max(0, orderedIds.indexOf(focused ?? selectedNavigationId));
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

  /**
   * A macOS source-list row: one line of icon, name, and a trailing slot. The
   * trailing slot names an availability that is not `ready`, so the state is
   * carried by a word rather than by a colored dot. The former prose subtitle
   * moves to the tooltip, where it no longer doubles the row height.
   */
  function renderView(destination: StudioDestination): React.JSX.Element {
    const ViewIcon = VIEW_ICONS[destination.id];
    const selected = props.current === destination.id;
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
      <strong>{destination.label}</strong>
      {destination.availability !== "ready" && <small className={`availability-${destination.availability}`}>{t(`availability.${destination.availability}`)}</small>}
    </button>;
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

    <nav aria-label={t("sidebar.navAria")} onKeyDown={onNavigationKeyDown}>
      <section
        className="studio-project-views"
        aria-label={activeProject === undefined ? t("sidebar.configuredViewsAria") : t("sidebar.viewsAria", { label: activeProject.label })}
      >
        <h2>{t("sidebar.views")}</h2>
        {props.destinations.map((destination) => renderView(destination))}
      </section>
    </nav>

    {/* Settings closes the sidebar's column: a full-width row pinned to the
        bottom, the position a macOS source list uses for library-wide controls. */}
    <footer className="studio-sidebar-footer">{props.settings}</footer>
  </aside>;
}
