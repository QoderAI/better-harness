import { useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
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
  const navigationRefs = useRef(new Map<string, HTMLButtonElement>());
  const showConfiguredViews = props.projects.length === 0;
  const orderedIds = props.projects.length === 0
    ? props.destinations.map((destination) => `view:${destination.id}`)
    : props.projects.flatMap((project) => [
      `project:${project.id}`,
      ...(project.id === props.activeProjectId ? props.destinations.map((destination) => `view:${destination.id}`) : []),
    ]);

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
    navigationRefs.current.get(orderedIds[nextIndex]!)?.focus();
  }

  return <aside className="studio-primary-nav studio-project-sidebar" aria-label="Studio Projects">
    <header className="studio-product-brand"><span><GitBranch aria-hidden="true" size={18} weight="bold" /></span><div><strong>Better Harness</strong><small>Studio</small></div><button className="studio-project-close" type="button" aria-label="Close Studio navigation" onClick={props.onCloseNavigation}><X aria-hidden="true" size={15} /></button></header>
    <div className="studio-project-heading"><div><strong>Projects</strong><span>{props.projects.length}</span></div><button type="button" disabled={props.opening || !props.canOpenProject} aria-label={props.opening ? "Opening project" : props.canOpenProject ? "Open project" : "Project opening unavailable"} title={props.canOpenProject ? "Open project" : "This launcher has no local Project discovery provider"} onClick={props.onOpenProject}>{props.opening ? <span className="studio-project-spinner" aria-hidden="true" /> : <Plus aria-hidden="true" size={15} />}</button></div>
    <nav aria-label="Studio project and View navigation" onKeyDown={onNavigationKeyDown}>
      <section className="studio-project-list" aria-label="Projects">
        {props.projects.length === 0 && <p className="studio-project-empty"><FolderOpen aria-hidden="true" size={16} /><span>No Project is open.</span></p>}
        {props.projects.map((project) => {
          const active = project.id === props.activeProjectId;
          return <div className={`studio-project-entry${active ? " active" : ""}${project.availability === "unavailable" ? " unavailable" : ""}`} key={project.id}>
            <div className="studio-project-row">
              <button ref={(node) => { if (node) navigationRefs.current.set(`project:${project.id}`, node); else navigationRefs.current.delete(`project:${project.id}`); }} type="button" disabled={props.opening} aria-current={active ? "true" : undefined} onClick={() => props.onActivateProject(project.id)}>
                <FolderOpen aria-hidden="true" size={15} weight={active ? "fill" : "regular"} />
                <span><strong>{project.label}</strong><small>{project.availability === "unavailable" ? "Unavailable · refresh failed" : `${project.sessionCount} Sessions · ${project.gitEnabled ? "Git" : "Folder"}`}</small></span>
              </button>
              <button className="studio-project-remove" type="button" disabled={props.opening} aria-label={`Remove Project: ${project.label}`} title={`Remove ${project.label}`} onClick={() => props.onRemoveProject(project.id)}><X aria-hidden="true" size={13} /></button>
            </div>
            {active && <section className="studio-project-views" aria-label={`${project.label} Views`}>
              <h2>Views</h2>
              {props.destinations.map((destination) => {
                const ViewIcon = VIEW_ICONS[destination.id];
                return <button key={destination.id} ref={(node) => { if (node) navigationRefs.current.set(`view:${destination.id}`, node); else navigationRefs.current.delete(`view:${destination.id}`); }} type="button" tabIndex={props.current === destination.id ? 0 : -1} aria-current={props.current === destination.id ? "page" : undefined} onClick={() => props.onSelectView(destination.id)}>
                  <ViewIcon aria-hidden="true" size={15} weight={props.current === destination.id ? "fill" : "regular"} />
                  <span><strong>{destination.label}</strong><small>{destination.status}</small></span>
                  <i className={`availability-dot availability-${destination.availability}`} aria-label={destination.availability} />
                </button>;
              })}
            </section>}
          </div>;
        })}
      </section>
      {showConfiguredViews && <section className="studio-project-views studio-configured-views" aria-label="Configured source Views">
        <h2>Views</h2>
        {props.destinations.map((destination) => {
          const ViewIcon = VIEW_ICONS[destination.id];
          return <button key={destination.id} ref={(node) => { if (node) navigationRefs.current.set(`view:${destination.id}`, node); else navigationRefs.current.delete(`view:${destination.id}`); }} type="button" tabIndex={props.current === destination.id ? 0 : -1} aria-current={props.current === destination.id ? "page" : undefined} onClick={() => props.onSelectView(destination.id)}>
            <ViewIcon aria-hidden="true" size={15} weight={props.current === destination.id ? "fill" : "regular"} />
            <span><strong>{destination.label}</strong><small>{destination.status}</small></span>
            <i className={`availability-dot availability-${destination.availability}`} aria-label={destination.availability} />
          </button>;
        })}
      </section>}
    </nav>
  </aside>;
}
