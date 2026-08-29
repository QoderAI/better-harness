import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type { Icon } from "@phosphor-icons/react";
import { Binoculars } from "@phosphor-icons/react/Binoculars";
import { BugBeetle } from "@phosphor-icons/react/BugBeetle";
import { ChatText } from "@phosphor-icons/react/ChatText";
import { Flask } from "@phosphor-icons/react/Flask";
import { FolderOpen } from "@phosphor-icons/react/FolderOpen";
import { GitBranch } from "@phosphor-icons/react/GitBranch";
import { Package } from "@phosphor-icons/react/Package";
import { Plus } from "@phosphor-icons/react/Plus";
import { PuzzlePiece } from "@phosphor-icons/react/PuzzlePiece";
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
  onCloseNavigation: () => void;
}): React.JSX.Element {
  const { t } = useTranslation("common");
  const navigationRefs = useRef(new Map<string, HTMLButtonElement>());
  const showUnscopedViews = props.activeProjectId === undefined;
  const orderedIds = [
    ...props.projects.flatMap((project) => [
      `project:${project.id}`,
      ...(project.id === props.activeProjectId ? props.destinations.map((destination) => `view:${destination.id}`) : []),
    ]),
    ...(showUnscopedViews ? props.destinations.map((destination) => `view:${destination.id}`) : []),
  ];
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

  function onNavigationKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    if (orderedIds.length === 0) return;
    event.preventDefault();
    const focused = [...navigationRefs.current.entries()].find(([, button]) => button === document.activeElement)?.[0];
    const currentIndex = Math.max(0, orderedIds.indexOf(focused ?? `project:${props.activeProjectId ?? props.projects[0]?.id ?? ""}`));
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

  return <aside className="studio-primary-nav studio-project-sidebar" aria-label={t("sidebar.aria")}>
    <header className="studio-product-brand"><span><GitBranch aria-hidden="true" size={18} weight="bold" /></span><div><strong>{t("brand.product")}</strong><small>{t("brand.studio")}</small></div><button className="studio-project-close" type="button" aria-label={t("workspace:gate.closeAria")} onClick={props.onCloseNavigation}><X aria-hidden="true" size={15} /></button></header>
    <div className="studio-project-heading"><div><strong>{t("sidebar.projects")}</strong><span>{props.projects.length}</span></div><button type="button" disabled={props.opening || !props.canOpenProject} aria-label={props.opening ? t("sidebar.openingAria") : props.canOpenProject ? t("sidebar.openProject") : t("sidebar.openingUnavailable")} title={props.canOpenProject ? t("sidebar.openProject") : t("sidebar.noDiscovery")} onClick={props.onOpenProject}>{props.opening ? <span className="studio-project-spinner" aria-hidden="true" /> : <Plus aria-hidden="true" size={15} />}</button></div>
    <nav aria-label={t("sidebar.navAria")} onKeyDown={onNavigationKeyDown}>
      <section className="studio-project-list" aria-label={t("sidebar.projectsAria")}>
        {props.projects.length === 0 && <p className="studio-project-empty"><FolderOpen aria-hidden="true" size={16} /><span>{t("sidebar.empty")}</span></p>}
        {props.projects.map((project) => {
          const active = project.id === props.activeProjectId;
          return <div className={`studio-project-entry${active ? " active" : ""}${project.availability === "unavailable" ? " unavailable" : ""}`} key={project.id}>
            <div className="studio-project-row">
              <button ref={(node) => { if (node) navigationRefs.current.set(`project:${project.id}`, node); else navigationRefs.current.delete(`project:${project.id}`); }} type="button" tabIndex={tabStopId === `project:${project.id}` ? 0 : -1} disabled={props.opening} aria-current={active ? "true" : undefined} aria-keyshortcuts="Delete" title={t("sidebar.projectTitle", { label: project.label })} onFocus={() => setFocusedNavigationId(`project:${project.id}`)} onKeyDown={(event) => { if (event.key === "Delete") { event.preventDefault(); props.onRemoveProject(project.id); } }} onClick={() => { setFocusedNavigationId(`project:${project.id}`); props.onActivateProject(project.id); }}>
                <FolderOpen aria-hidden="true" size={15} weight={active ? "fill" : "regular"} />
                <span><strong>{project.label}</strong><small>{project.availability === "unavailable" ? t("sidebar.unavailable") : t("sidebar.projectMeta", { count: project.sessionCount, kind: project.gitEnabled ? t("sidebar.git") : t("sidebar.folder") })}</small></span>
              </button>
              <button className="studio-project-remove" type="button" tabIndex={-1} disabled={props.opening} aria-label={t("sidebar.removeAria", { label: project.label })} title={t("sidebar.removeTitle", { label: project.label })} onClick={() => props.onRemoveProject(project.id)}><X aria-hidden="true" size={13} /></button>
            </div>
            {active && <section className="studio-project-views" aria-label={t("sidebar.viewsAria", { label: project.label })}>
              <h2>{t("sidebar.views")}</h2>
              {props.destinations.map((destination) => {
                const ViewIcon = VIEW_ICONS[destination.id];
                return <button key={destination.id} ref={(node) => { if (node) navigationRefs.current.set(`view:${destination.id}`, node); else navigationRefs.current.delete(`view:${destination.id}`); }} type="button" tabIndex={tabStopId === `view:${destination.id}` ? 0 : -1} aria-current={props.current === destination.id ? "page" : undefined} onFocus={() => setFocusedNavigationId(`view:${destination.id}`)} onClick={() => { setFocusedNavigationId(`view:${destination.id}`); props.onSelectView(destination.id); }}>
                  <ViewIcon aria-hidden="true" size={15} weight={props.current === destination.id ? "fill" : "regular"} />
                  <span><strong>{destination.label}</strong><small>{destination.status}</small></span>
                  <i className={`availability-dot availability-${destination.availability}`} aria-label={t(`availability.${destination.availability}`)} />
                </button>;
              })}
            </section>}
          </div>;
        })}
      </section>
      {showUnscopedViews && <section className="studio-project-views studio-configured-views" aria-label={t("sidebar.configuredViewsAria")}>
        <h2>{t("sidebar.views")}</h2>
        {props.destinations.map((destination) => {
          const ViewIcon = VIEW_ICONS[destination.id];
          return <button key={destination.id} ref={(node) => { if (node) navigationRefs.current.set(`view:${destination.id}`, node); else navigationRefs.current.delete(`view:${destination.id}`); }} type="button" tabIndex={tabStopId === `view:${destination.id}` ? 0 : -1} aria-current={props.current === destination.id ? "page" : undefined} onFocus={() => setFocusedNavigationId(`view:${destination.id}`)} onClick={() => { setFocusedNavigationId(`view:${destination.id}`); props.onSelectView(destination.id); }}>
            <ViewIcon aria-hidden="true" size={15} weight={props.current === destination.id ? "fill" : "regular"} />
            <span><strong>{destination.label}</strong><small>{destination.status}</small></span>
            <i className={`availability-dot availability-${destination.availability}`} aria-label={t(`availability.${destination.availability}`)} />
          </button>;
        })}
      </section>}
    </nav>
  </aside>;
}