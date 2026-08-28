import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { FolderOpen } from "@phosphor-icons/react/FolderOpen";
import { GitBranch } from "@phosphor-icons/react/GitBranch";
import { Moon } from "@phosphor-icons/react/Moon";
import { SidebarSimple } from "@phosphor-icons/react/SidebarSimple";
import { Sun } from "@phosphor-icons/react/Sun";
import { ArtifactsWorkspace } from "./ArtifactsWorkspace.js";
import { CompareView } from "./CompareView.js";
import { CustomizationView } from "./CustomizationView.js";
import { ExperimentView } from "./experiment/ExperimentView.js";
import { GitHistoryView } from "./GitHistoryView.js";
import { InputTraceView } from "./InputTraceView.js";
import { RunView } from "./run/RunView.js";
import type { DebuggerSession } from "../contracts/debugger-session.js";
import { isStudioProjectCatalog, type StudioProjectCatalog, type StudioProjectDescriptor } from "../contracts/studio-project.js";
import { ProjectSidebar } from "./shell/ProjectSidebar.js";
import { parseStudioLocation, studioLocationHash } from "./shell/project-routing.js";
import { useRovingFocus } from "./roving-tablist.js";
import { studioApiError } from "./studio-api.js";
import { StudioThemeContext, type StudioTheme } from "./studio-theme.js";

const InspectorWorkbench = lazy(async () => ({ default: (await import("./InspectorWorkbench.js")).InspectorWorkbench }));
import {
  compareSurfaces,
  studioProjectGateRequired,
  studioOverview,
  studioDestinations,
  type StudioArea,
  type StudioCompareSurface,
  type StudioConfig,
} from "./studio-shell-model.js";

// The sidebar already groups these destinations, so the context bar carries the
// view name alone rather than repeating the group as an eyebrow.
const AREA_COPY: Record<StudioArea, string> = {
  overview: "Overview",
  customizations: "Customizations",
  inputs: "Inputs",
  sessions: "Sessions",
  commits: "Commits",
  artifacts: "Artifacts",
  debugger: "Debugger",
  compare: "Compare",
};

type StudioSourceKind = "inspector" | "evidence" | "experiment";
interface StudioSourceOption {
  id: string;
  kind: StudioSourceKind;
  label: string;
  active: boolean;
}

const EMPTY_CONFIG: StudioConfig = {
  aguiEnabled: false,
  acpEnabled: false,
  artifactsEnabled: false,
  evidenceEnabled: false,
  experimentEnabled: false,
  experimentRunnable: false,
  gitEnabled: false,
  harnessMode: "none",
  historyEnabled: false,
  inspectorEnabled: false,
  workspaceWorkbenchEnabled: false,
  workspaceDiscoveryEnabled: false,
  workspaceConnected: false,
  projectExecutionEnabled: false,
  projectRevision: 0,
  sessionCount: 0,
  inputCount: 0,
  intentAnalysisEnabled: false,
  customizationAnalysisEnabled: false,
  customizationAnalyzed: false,
  customizationDefinitionCount: 0,
};

function initialStudioTheme(): StudioTheme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

async function fetchStudioState(): Promise<{ config: StudioConfig; sources: StudioSourceOption[]; projectCatalog: StudioProjectCatalog }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [configResponse, sourcesResponse, projectsResponse] = await Promise.all([
      fetch("api/config"),
      fetch("api/sources"),
      fetch("api/projects"),
    ]);
    if (!configResponse.ok) throw new Error(`Studio config failed (${configResponse.status}).`);
    if (!projectsResponse.ok) throw new Error(`Studio Projects failed (${projectsResponse.status}).`);
    const loaded = { ...EMPTY_CONFIG, ...(await configResponse.json() as Partial<StudioConfig>) };
    const sourcesPayload = sourcesResponse.ok ? await sourcesResponse.json() as { sources?: StudioSourceOption[] } : {};
    const projectCatalog = await projectsResponse.json() as unknown;
    if (!isStudioProjectCatalog(projectCatalog)) throw new Error("Studio Project catalog is unsupported.");
    if (loaded.projectRevision !== projectCatalog.revision || loaded.activeProjectId !== projectCatalog.activeProjectId) {
      if (attempt < 2) continue;
      throw new Error("Studio Project state changed while the workbench was loading.");
    }
    return {
      config: loaded,
      sources: Array.isArray(sourcesPayload.sources) ? sourcesPayload.sources : [],
      projectCatalog,
    };
  }
  throw new Error("Studio Project state is unavailable.");
}

export function App(): React.JSX.Element {
  const [config, setConfig] = useState<StudioConfig | undefined>(undefined);
  const [sources, setSources] = useState<StudioSourceOption[]>([]);
  const [projects, setProjects] = useState<StudioProjectDescriptor[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>();
  const [projectOpening, setProjectOpening] = useState(false);
  const [projectFailure, setProjectFailure] = useState<string>();
  const [dataRevision, setDataRevision] = useState(0);
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  const [sessionCompareIds, setSessionCompareIds] = useState<[string, string] | undefined>();
  const [sessionOpenId, setSessionOpenId] = useState<string>();
  const [configFailure, setConfigFailure] = useState<string | null>(null);
  const [bootstrapRevision, setBootstrapRevision] = useState(0);
  const [area, setArea] = useState<StudioArea>(areaFromHash);
  const [locationRevision, setLocationRevision] = useState(0);
  const [compareSurface, setCompareSurface] = useState<StudioCompareSurface>("sessions");
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [theme, setTheme] = useState<StudioTheme>(initialStudioTheme);
  const navigationToggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      globalThis.localStorage.setItem("harness-studio-theme", theme);
    } catch {
      // Theme preference remains usable for this page when storage is blocked.
    }
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await fetchStudioState();
        if (!cancelled) {
          setConfigFailure(null);
          setSources(loaded.sources);
          setProjects(loaded.projectCatalog.projects);
          setActiveProjectId(loaded.projectCatalog.activeProjectId);
          setConfig(loaded.config);
          setCompareSurface((currentSurface) => compareSurfaces(loaded.config).includes(currentSurface) ? currentSurface : compareSurfaces(loaded.config)[0] ?? "sessions");
        }
      } catch (error) {
        if (!cancelled) {
          setConfigFailure(error instanceof Error ? error.message : "Studio configuration is unavailable.");
          setConfig(EMPTY_CONFIG);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bootstrapRevision]);

  useEffect(() => {
    const onHashChange = (): void => {
      setArea(studioLocationFromHash().area);
      setLocationRevision((revision) => revision + 1);
    };
    globalThis.addEventListener("hashchange", onHashChange);
    globalThis.addEventListener("popstate", onHashChange);
    return () => {
      globalThis.removeEventListener("hashchange", onHashChange);
      globalThis.removeEventListener("popstate", onHashChange);
    };
  }, []);

  useEffect(() => {
    if (config === undefined || projectOpening) return;
    const location = studioLocationFromHash();
    if (location.projectId !== undefined && location.projectId !== activeProjectId && projects.some((project) => project.id === location.projectId)) {
      void activateStudioProject(location.projectId, false);
      return;
    }
    if (location.projectId !== undefined && !projects.some((project) => project.id === location.projectId)) {
      globalThis.history.replaceState(null, "", studioLocationHash({ area: location.area, ...(activeProjectId === undefined ? {} : { projectId: activeProjectId }) }));
      return;
    }
    if (location.projectId === undefined && activeProjectId !== undefined) {
      globalThis.history.replaceState(null, "", studioLocationHash({ projectId: activeProjectId, area: location.area }));
    }
  }, [activeProjectId, config, locationRevision, projectOpening, projects]);

  useEffect(() => {
    if (!navigationOpen) return undefined;
    const focusFrame = globalThis.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(".studio-primary-nav nav button")?.focus();
    });
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setNavigationOpen(false);
      navigationToggleRef.current?.focus();
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => {
      globalThis.cancelAnimationFrame(focusFrame);
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, [navigationOpen]);

  function closeNavigation(): void {
    if (!navigationOpen) return;
    setNavigationOpen(false);
    globalThis.requestAnimationFrame(() => navigationToggleRef.current?.focus());
  }

  function openArea(next: StudioArea): void {
    setArea(next);
    closeNavigation();
    const nextHash = studioLocationHash({ area: next, ...(activeProjectId === undefined ? {} : { projectId: activeProjectId }) });
    if (globalThis.location.hash !== nextHash) globalThis.history.pushState(null, "", nextHash);
  }

  async function selectSource(source: StudioSourceOption): Promise<void> {
    try {
      const response = await fetch("api/sources/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: source.kind, sourceId: source.id }),
      });
      if (!response.ok) throw new Error(`Studio source switch failed (${response.status}).`);
      const loaded = await fetchStudioState();
      setConfigFailure(null);
      setSources(loaded.sources);
      setProjects(loaded.projectCatalog.projects);
      setActiveProjectId(loaded.projectCatalog.activeProjectId);
      setConfig(loaded.config);
      setCompareSurface((currentSurface) => compareSurfaces(loaded.config).includes(currentSurface) ? currentSurface : compareSurfaces(loaded.config)[0] ?? "sessions");
      setDataRevision((revision) => revision + 1);
    } catch (error) {
      setConfigFailure(error instanceof Error ? error.message : "Studio source switch failed.");
    }
  }

  async function workspaceChanged(): Promise<string | undefined> {
    const loaded = await fetchStudioState();
    setConfigFailure(null);
    setSources(loaded.sources);
    setProjects(loaded.projectCatalog.projects);
    setActiveProjectId(loaded.projectCatalog.activeProjectId);
    setConfig(loaded.config);
    setSessionCompareIds(undefined);
    setSessionOpenId(undefined);
    setCompareSurface((currentSurface) => compareSurfaces(loaded.config).includes(currentSurface) ? currentSurface : compareSurfaces(loaded.config)[0] ?? "sessions");
    setWorkspaceRevision((revision) => revision + 1);
    return loaded.projectCatalog.activeProjectId;
  }

  async function refreshProjectCatalog(): Promise<void> {
    try {
      const response = await fetch("api/projects");
      if (!response.ok) return;
      const catalog = await response.json() as unknown;
      if (!isStudioProjectCatalog(catalog)) return;
      setProjects(catalog.projects);
      setActiveProjectId(catalog.activeProjectId);
    } catch {
      // Preserve the last coherent catalog; the Project operation remains the error channel.
    }
  }

  async function openProject(): Promise<void> {
    if (projectOpening) return;
    setProjectOpening(true);
    setProjectFailure(undefined);
    try {
      const response = await fetch("api/projects/open", { method: "POST" });
      if (!response.ok) throw new Error(await studioApiError(response));
      const result = await response.json() as { opened?: boolean; cancelled?: boolean; project?: StudioProjectDescriptor };
      if (result.cancelled || result.opened !== true) return;
      await workspaceChanged();
      if (result.project !== undefined) {
        closeNavigation();
        const hash = studioLocationHash({ projectId: result.project.id, area });
        globalThis.history.pushState(null, "", hash);
      }
    } catch (error) {
      setProjectFailure(error instanceof Error ? error.message : "Project discovery failed.");
      closeNavigation();
    } finally {
      setProjectOpening(false);
    }
  }

  async function activateStudioProject(projectId: string, updateHistory = true): Promise<void> {
    if (projectId === activeProjectId || projectOpening) return;
    setProjectOpening(true);
    setProjectFailure(undefined);
    try {
      const response = await fetch(`api/projects/${encodeURIComponent(projectId)}/activate`, { method: "POST" });
      if (!response.ok) throw new Error(await studioApiError(response));
      await workspaceChanged();
      closeNavigation();
      if (updateHistory) globalThis.history.pushState(null, "", studioLocationHash({ projectId, area }));
    } catch (error) {
      setProjectFailure(error instanceof Error ? error.message : "Project activation failed.");
      await refreshProjectCatalog();
      closeNavigation();
      if (!updateHistory) {
        globalThis.history.replaceState(null, "", studioLocationHash({ area, ...(activeProjectId === undefined ? {} : { projectId: activeProjectId }) }));
      }
    } finally {
      setProjectOpening(false);
    }
  }

  async function removeStudioProject(projectId: string): Promise<void> {
    if (projectOpening) return;
    setProjectOpening(true);
    setProjectFailure(undefined);
    try {
      const response = await fetch(`api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await studioApiError(response));
      const wasActive = projectId === activeProjectId;
      await workspaceChanged();
      closeNavigation();
      if (wasActive) globalThis.history.pushState(null, "", studioLocationHash({ area }));
    } catch (error) {
      setProjectFailure(error instanceof Error ? error.message : "Project removal failed.");
      closeNavigation();
    } finally {
      setProjectOpening(false);
    }
  }

  function customizationAnalyzed(definitionCount: number): void {
    setConfig((current) => current === undefined ? current : {
      ...current,
      customizationAnalyzed: true,
      customizationDefinitionCount: definitionCount,
    });
  }

  if (config === undefined) {
    return <main className="studio-loading"><span className="studio-loading-mark"><GitBranch aria-hidden="true" size={18} weight="bold" /></span><p>Loading Harness control plane…</p></main>;
  }
  if (configFailure !== null) {
    return <main className="studio-loading" role="alert"><span className="studio-loading-mark"><GitBranch aria-hidden="true" size={18} weight="bold" /></span><strong>Cannot load Studio configuration.</strong><p>{configFailure}</p><button className="primary" type="button" onClick={() => { setConfig(undefined); setConfigFailure(null); setBootstrapRevision((revision) => revision + 1); }}>Retry</button></main>;
  }

  const availableCompareSurfaces = compareSurfaces(config);
  const effectiveCompareSurface = availableCompareSurfaces.includes(compareSurface)
    ? compareSurface
    : availableCompareSurfaces[0] ?? compareSurface;
  const destinations = studioDestinations(config, effectiveCompareSurface);
  const current = destinations.find((destination) => destination.id === area) ?? destinations[0]!;
  const compareNavigation = (
    <SurfaceNavigation
      label="Compare surfaces"
      items={availableCompareSurfaces.map((id) => ({
        id,
        label: id === "sessions" ? "Sessions" : id === "bench" ? "Bench" : "Evidence results",
      }))}
      active={effectiveCompareSurface}
      onSelect={setCompareSurface}
    />
  );
  const contextNavigation = area === "compare" && availableCompareSurfaces.length > 1
    ? compareNavigation
    : null;
  const activeProject = projects.find((project) => project.id === activeProjectId);
  const openProjectAction = config.workspaceDiscoveryEnabled
    ? { label: config.workspaceConnected ? "Open Another Project" : "Open Project", onClick: () => void openProject() }
    : undefined;
  const projectDiscoveryDetail = config.workspaceDiscoveryEnabled
    ? "Choose a remembered Project or open another local directory."
    : "This Studio launcher does not provide Project discovery. Start the packaged CLI or connect a workspace Session provider.";
  const workspaceGateOpen = projects.length === 0 && studioProjectGateRequired(config, sources.length > 0);
  const overviewConfig = workspaceGateOpen ? config : { ...config, workspaceDiscoveryEnabled: false };

  return <StudioThemeContext.Provider value={theme}>
  <div className={`studio-control-plane${navigationOpen ? " navigation-open" : ""}`} inert={workspaceGateOpen ? true : undefined} aria-hidden={workspaceGateOpen ? true : undefined}>
    <ProjectSidebar
      projects={projects}
      activeProjectId={activeProjectId}
      destinations={destinations}
      current={area}
      opening={projectOpening}
      canOpenProject={config.workspaceDiscoveryEnabled}
      onOpenProject={() => void openProject()}
      onActivateProject={(projectId) => void activateStudioProject(projectId)}
      onRemoveProject={(projectId) => void removeStudioProject(projectId)}
      onSelectView={openArea}
      onCloseNavigation={() => { setNavigationOpen(false); navigationToggleRef.current?.focus(); }}
    />
    <button className="studio-nav-backdrop" type="button" aria-label="Close Studio navigation" onClick={() => { setNavigationOpen(false); navigationToggleRef.current?.focus(); }} />
    <section className="studio-area">
      <header className={`studio-context-bar${contextNavigation ? " has-surface-navigation" : ""}`}>
        <button ref={navigationToggleRef} className="studio-nav-toggle" type="button" title={navigationOpen ? "Close navigation" : "Open navigation"} aria-label={navigationOpen ? "Close Studio navigation" : "Open Studio navigation"} aria-expanded={navigationOpen} onClick={() => setNavigationOpen((value) => !value)}><SidebarSimple aria-hidden="true" size={17} /></button>
        <div className="studio-context-title"><small>{activeProject?.label ?? (sources.length > 0 ? "Configured sources" : "No Project")}</small><h1>{AREA_COPY[area]}</h1></div>
        {contextNavigation && <div className="studio-context-navigation">{contextNavigation}</div>}
        <ThemeToggle theme={theme} onChange={setTheme} />
        {sources.length > 0 && <SourceSwitcher sources={sources} onSelect={(source) => void selectSource(source)} />}
        <div className="studio-context-state" role="status" aria-label={`View status: ${current.status}`}><span className={`availability-dot availability-${current.availability}`} /><strong>{current.status}</strong></div>
        {projectFailure !== undefined && <span className="studio-project-failure" role="alert">{projectFailure}</span>}
      </header>
      <div className={`studio-surface studio-surface-${area}`}>
        {area === "overview" && <Overview key={`overview-${workspaceRevision}`} config={overviewConfig} onOpen={openArea} onOpenSession={(id) => { setSessionOpenId(id); openArea("sessions"); }} />}
        {area === "customizations" && (config.customizationAnalysisEnabled
          ? <CustomizationView key={`customizations-${workspaceRevision}`} analyzed={config.customizationAnalyzed} onAnalyzed={customizationAnalyzed} />
          : <EmptyWorkspace eyebrow="Customization catalog" title="Customization analysis is unavailable" detail="This Studio launcher does not include the local customization collector. Opening a Project will not enable it." command="npx @qoder-ai/harness-studio" />)}
        {area === "inputs" && (config.workspaceWorkbenchEnabled ? <InputTraceView key={`inputs-${workspaceRevision}`} intentAnalysisEnabled={config.intentAnalysisEnabled} /> : <EmptyWorkspace eyebrow="User input trace" title={config.workspaceConnected ? "No retained input trace is available" : "Open a Project"} detail={config.workspaceConnected ? "This Project source does not include structured Inspector dialogue evidence." : projectDiscoveryDetail} action={openProjectAction} />)}
        {area === "sessions" && <SessionsWorkspace key={`sessions-${dataRevision}-${workspaceRevision}-${sessionOpenId ?? "recent"}`} config={config} initialSessionId={sessionOpenId} openProjectAction={openProjectAction} onCompare={(ids) => { setSessionCompareIds(ids); setCompareSurface("sessions"); openArea("compare"); }} />}
        {area === "commits" && (config.gitEnabled ? <GitHistoryView key={`commits-${workspaceRevision}`} /> : <EmptyWorkspace eyebrow="Repository history" title={config.workspaceConnected ? "The selected Project is not a Git repository" : "Open a Project"} detail={config.workspaceConnected ? "Commit history is available only for a local Project backed by Git." : projectDiscoveryDetail} action={openProjectAction} />)}
        {area === "artifacts" && <ArtifactsWorkspace key={`artifacts-${dataRevision}-${workspaceRevision}-${config.artifactsEnabled}`} config={config} openProjectAction={openProjectAction} />}
        {area === "debugger" && <DebuggerWorkspace config={config} openProjectAction={openProjectAction} project={activeProject === undefined ? undefined : { id: activeProject.id, label: activeProject.label, revision: config.projectRevision ?? 0 }} />}
        {area === "compare" && <CompareWorkspace key={`compare-${dataRevision}-${workspaceRevision}-${config.experimentEnabled}-${config.evidenceEnabled}`} config={config} surface={effectiveCompareSurface} navigation={null} sessionIds={sessionCompareIds} openProjectAction={openProjectAction} />}
      </div>
    </section>
  </div>
  {workspaceGateOpen && <WorkspaceGate onWorkspaceChanged={async () => {
    const projectId = await workspaceChanged();
    const nextHash = studioLocationHash({ area, ...(projectId === undefined ? {} : { projectId }) });
    if (globalThis.location.hash !== nextHash) globalThis.history.pushState(null, "", nextHash);
  }} />}
  </StudioThemeContext.Provider>;
}

function WorkspaceGate(props: { onWorkspaceChanged: () => Promise<void> }): React.JSX.Element {
  return <section className="studio-workspace-gate" role="dialog" aria-modal="true" aria-labelledby="workspace-gate-title" aria-describedby="workspace-gate-description">
    <div className="studio-workspace-gate-panel">
      <header><span><FolderOpen aria-hidden="true" size={22} /></span><div><small>Local Project</small><h1 id="workspace-gate-title">Open a Project to start</h1></div></header>
      <p id="workspace-gate-description">Choose a repository or project directory. Studio will remember it as a Project and discover its matching local agent inputs and Sessions.</p>
      <ProjectFolderControls autoFocus onWorkspaceChanged={props.onWorkspaceChanged} />
      <footer><strong>Project-scoped discovery</strong><span>The selected directory scopes Session lookup; global Session folders are not treated as Project evidence.</span></footer>
    </div>
  </section>;
}

function ThemeToggle(props: { theme: StudioTheme; onChange: (theme: StudioTheme) => void }): React.JSX.Element {
  const next = props.theme === "dark" ? "light" : "dark";
  const label = `${props.theme === "dark" ? "Dark" : "Light"} theme active. Switch to ${next} theme`;
  return <button className="studio-theme-toggle" type="button" title={`Switch to ${next} theme`} aria-label={label} onClick={() => props.onChange(next)}>
    {props.theme === "dark" ? <Moon aria-hidden="true" size={15} weight="fill" /> : <Sun aria-hidden="true" size={15} weight="fill" />}
    <span>{props.theme === "dark" ? "Dark" : "Light"}</span>
  </button>;
}

function SourceSwitcher(props: {
  sources: StudioSourceOption[];
  onSelect: (source: StudioSourceOption) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const active = props.sources.filter((source) => source.active);
  const kinds: StudioSourceKind[] = ["inspector", "evidence", "experiment"];
  return <div className="studio-source-switcher">
    <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`Data sources (${active.length} active)`} title="Data sources" onClick={() => setOpen((value) => !value)}><GitBranch aria-hidden="true" size={14} /><span>Data sources</span><em>{active.length}</em></button>
    {open && <div className="studio-source-menu" role="menu" aria-label="Studio data sources">
      {kinds.map((kind) => {
        const entries = props.sources.filter((source) => source.kind === kind);
        if (entries.length === 0) return null;
        return <section key={kind}>
          <h2>{sourceKindLabel(kind)}</h2>
          {entries.map((source) => <button key={source.id} type="button" role="menuitemradio" aria-checked={source.active} className={source.active ? "selected" : ""} onClick={() => { setOpen(false); if (!source.active) props.onSelect(source); }}><strong>{source.label}</strong><span>{source.active ? "Active" : "Switch"}</span></button>)}
        </section>;
      })}
    </div>}
  </div>;
}

function sourceKindLabel(kind: StudioSourceKind): string {
  if (kind === "inspector") return "Inspector";
  if (kind === "evidence") return "Evidence results";
  return "Experiment bench";
}

function Overview(props: { config: StudioConfig; onOpen: (area: StudioArea) => void; onOpenSession: (id: string) => void }): React.JSX.Element {
  const model = studioOverview(props.config);
  const [recentSessions, setRecentSessions] = useState<SessionSummary[]>();
  const [recentFailure, setRecentFailure] = useState<string>();

  useEffect(() => {
    if (!props.config.workspaceConnected) {
      setRecentSessions(undefined);
      setRecentFailure(undefined);
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("api/sessions");
        if (!response.ok) throw new Error(await studioApiError(response));
        const payload = await response.json() as { sessions: SessionSummary[] };
        if (cancelled) return;
        setRecentSessions(payload.sessions.slice(0, 5));
        setRecentFailure(undefined);
      } catch (error) {
        if (cancelled) return;
        setRecentFailure(error instanceof Error ? error.message : "Recent Sessions are unavailable.");
        setRecentSessions([]);
      }
    })();
    return () => { cancelled = true; };
  }, [props.config.workspaceConnected, props.config.sessionCount]);

  const heading = model.title;
  const context = model.mode === "workspace"
    ? "Project overview"
    : model.mode === "configured"
      ? "Configured local sources"
      : model.mode === "workspace-required"
        ? "Project setup"
        : "Studio setup";

  return <main className={`control-overview overview-mode-${model.mode}`}>
    <section className="overview-summary">
      <div className="overview-lead">
        <small>{context}</small>
        <h1>{heading}</h1>
        <p>{model.detail}</p>
        {model.primaryAction !== undefined && model.mode !== "workspace-required" && <button className="primary" type="button" onClick={() => props.onOpen(model.primaryAction!.area)}>{model.primaryAction.label}<ArrowRight aria-hidden="true" size={15} weight="bold" /></button>}
      </div>
      {model.mode === "workspace" && <dl className="overview-facts" aria-label="Workspace summary">{model.facts.map((fact) => <div key={fact.id}><dt>{fact.label}</dt><dd>{fact.value}</dd><small>{fact.detail}</small></div>)}</dl>}
    </section>

    <div className="overview-workspace">
      {model.mode === "workspace" ? <section className="overview-pane overview-recent">
        <header><h2>Recent Sessions</h2><span>{props.config.sessionCount}</span></header>
        {recentFailure !== undefined
          ? <p className="overview-pane-status" role="alert">{recentFailure}</p>
          : recentSessions === undefined
            ? <p className="overview-pane-status" role="status">Loading retained Sessions…</p>
            : recentSessions.length === 0
              ? <p className="overview-pane-status">No retained Sessions were discovered in this Project.</p>
              : <ol className="overview-session-rows">{recentSessions.map((session) => <li key={session.id}><button type="button" aria-label={`Open Session: ${session.prompt}`} onClick={() => props.onOpenSession(session.id)}><span><small>{session.provider ?? "Local agent"} · {formatSessionTime(session.savedAt)}</small><strong>{session.prompt}</strong></span><em>{session.toolCallCount} calls</em><ArrowRight aria-hidden="true" size={14} /></button></li>)}</ol>}
      </section> : <section className="overview-pane overview-context">
        <header><h2>{model.mode === "configured" ? "Loaded context" : "Getting started"}</h2><span>{model.facts.length || undefined}</span></header>
        {model.facts.length === 0
          ? <p className="overview-pane-status">{model.detail}</p>
          : <dl className="overview-context-rows">{model.facts.map((fact) => <div key={fact.id}><dt><strong>{fact.label}</strong><small>{fact.detail}</small></dt><dd>{fact.value}</dd></div>)}</dl>}
      </section>}

      <aside className="overview-pane overview-actions">
        <header><h2>Next actions</h2><span>{model.secondaryActions.length}</span></header>
        {model.secondaryActions.length === 0
          ? <p className="overview-pane-status">{model.mode === "workspace" ? "Open Sessions to inspect the retained evidence available now." : "Load a working context to enable Studio workbenches."}</p>
          : <ul>{model.secondaryActions.map((action) => <li key={action.area}><button type="button" onClick={() => props.onOpen(action.area)}><span>{action.label}</span><ArrowRight aria-hidden="true" size={14} /></button></li>)}</ul>}
      </aside>
    </div>
  </main>;
}

interface SessionSummary {
  id: string;
  savedAt: string;
  prompt: string;
  status: "finished" | "error" | "observed";
  toolCallCount: number;
  provider?: string;
}

function SessionsWorkspace(props: {
  config: StudioConfig;
  initialSessionId?: string;
  openProjectAction?: { label: string; onClick: () => void };
  onCompare: (ids: [string, string]) => void;
}): React.JSX.Element {
  const [sessions, setSessions] = useState<SessionSummary[]>();
  const [omittedCount, setOmittedCount] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<DebuggerSession>();
  const [failure, setFailure] = useState<string>();
  const [detailFailure, setDetailFailure] = useState<string>();
  const sessionRowRefs = useRef(new Map<string, HTMLButtonElement>());
  const [focusedSessionId, setFocusedSessionId] = useState<string>();
  const [surface, setSurface] = useState<"inspector" | "catalog">(
    props.config.workspaceWorkbenchEnabled ? "inspector" : "catalog",
  );

  useEffect(() => {
    if (!props.config.workspaceConnected) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("api/sessions");
        if (!response.ok) throw new Error(await studioApiError(response));
        const payload = await response.json() as { workspace: { label: string; omittedCount: number }; sessions: SessionSummary[] };
        if (cancelled) return;
        setOmittedCount(payload.workspace.omittedCount);
        setSessions(payload.sessions);
        const initialSession = payload.sessions.find((session) => session.id === props.initialSessionId) ?? payload.sessions[0];
        if (initialSession !== undefined) await openSession(initialSession.id, () => cancelled);
      } catch (error) {
        if (!cancelled) setFailure(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => { cancelled = true; };
  }, [props.config.workspaceConnected, props.initialSessionId]);

  useEffect(() => {
    if (sessions === undefined || sessions.length === 0) return;
    setFocusedSessionId((current) => sessions.some((session) => session.id === current)
      ? current
      : sessions.find((session) => session.id === props.initialSessionId)?.id ?? selected ?? sessions[0]!.id);
  }, [props.initialSessionId, selected, sessions]);

  async function openSession(id: string, cancelled: () => boolean = () => false): Promise<void> {
    try {
      const response = await fetch(`api/sessions/${encodeURIComponent(id)}/debugger`);
      if (!response.ok) throw new Error(await studioApiError(response));
      const loaded = await response.json() as DebuggerSession;
      if (cancelled()) return;
      setDetailFailure(undefined);
      setSelected(id);
      setDetail(loaded);
    } catch (error) {
      if (cancelled()) return;
      const message = error instanceof Error ? error.message : "Session detail failed to load.";
      setDetailFailure(message);
    }
  }

  function toggleCompare(id: string): void {
    setCompareIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < 2) next.add(id);
      return next;
    });
  }

  function moveSessionFocus(event: ReactKeyboardEvent<HTMLButtonElement>, id: string): void {
    if (sessions === undefined || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = Math.max(0, sessions.findIndex((session) => session.id === id));
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? sessions.length - 1
        : event.key === "ArrowDown"
          ? (index + 1) % sessions.length
          : (index - 1 + sessions.length) % sessions.length;
    const nextId = sessions[nextIndex]!.id;
    setFocusedSessionId(nextId);
    sessionRowRefs.current.get(nextId)?.focus();
  }

  if (!props.config.workspaceConnected) {
    return <EmptyWorkspace eyebrow="Project Sessions" title="Open a Project" detail={props.config.workspaceDiscoveryEnabled ? "Choose a remembered Project or open another local directory." : "This Studio launcher does not provide Project discovery."} action={props.openProjectAction} />;
  }
  if (failure !== undefined) {
    return <EmptyWorkspace eyebrow="Project Sessions" title="Session discovery failed" detail={failure} />;
  }
  if (sessions === undefined) return <p className="artifact-status" role="status">Indexing sessions…</p>;

  const pair = [...compareIds];
  const catalog = <section className="session-browser-workspace" aria-label="Project workspace sessions">
    <aside className="session-catalog-pane">
      <header><div><small>Project evidence</small><h2>Sessions</h2></div><span>{sessions.length}</span></header>
      {omittedCount > 0 && <p className="session-omissions">{omittedCount} unsupported or malformed file{omittedCount === 1 ? "" : "s"} omitted.</p>}
      <ul className="session-catalog-rows">{sessions.map((session) => <li key={session.id}>
        <label title={`Select ${session.prompt} for comparison`}><input type="checkbox" aria-label={`Select ${session.prompt} from ${session.provider ?? "Local agent"} at ${formatSessionTime(session.savedAt)} for comparison`} checked={compareIds.has(session.id)} disabled={!compareIds.has(session.id) && compareIds.size >= 2} onChange={() => toggleCompare(session.id)} /></label>
        <button ref={(node) => { if (node) sessionRowRefs.current.set(session.id, node); else sessionRowRefs.current.delete(session.id); }} type="button" tabIndex={focusedSessionId === session.id ? 0 : -1} className={selected === session.id ? "selected" : undefined} onFocus={() => setFocusedSessionId(session.id)} onKeyDown={(event) => moveSessionFocus(event, session.id)} onClick={() => { setFocusedSessionId(session.id); void openSession(session.id); }}><small>{session.provider ?? "Local agent"} · {formatSessionTime(session.savedAt)}</small><strong>{session.prompt}</strong><small>{session.status} · {session.toolCallCount} calls</small></button>
      </li>)}</ul>
      <footer><button type="button" className="primary" disabled={pair.length !== 2} onClick={() => props.onCompare(pair as [string, string])}>Compare {pair.length}/2</button></footer>
    </aside>
    <main className="session-detail-pane">
      {detailFailure !== undefined
        ? <p className="artifact-status" role="alert">{detailFailure}</p>
        : detail === undefined
          ? <p className="artifact-status">Select a session to inspect retained evidence.</p>
          : <SessionDetail session={detail} />}
    </main>
  </section>;

  if (!props.config.workspaceWorkbenchEnabled) return catalog;
  return <section className="session-workbench-stack" aria-label="Workspace Session evidence">
    <header className="session-workbench-toolbar">
      <div><strong>Session evidence</strong><span>Inspector-owned Project observations</span></div>
      <div className="session-surface-tabs" role="tablist" aria-label="Session views">
        <button id="session-tab-inspector" type="button" role="tab" aria-controls="session-workbench-panel" aria-selected={surface === "inspector"} tabIndex={surface === "inspector" ? 0 : -1} className={surface === "inspector" ? "selected" : undefined} onClick={() => setSurface("inspector")} onKeyDown={(event) => { if (event.key === "ArrowRight") { event.preventDefault(); setSurface("catalog"); (event.currentTarget.nextElementSibling as HTMLButtonElement | null)?.focus(); } }}>Inspector</button>
        <button id="session-tab-catalog" type="button" role="tab" aria-controls="session-workbench-panel" aria-selected={surface === "catalog"} tabIndex={surface === "catalog" ? 0 : -1} className={surface === "catalog" ? "selected" : undefined} onClick={() => setSurface("catalog")} onKeyDown={(event) => { if (event.key === "ArrowLeft") { event.preventDefault(); setSurface("inspector"); (event.currentTarget.previousElementSibling as HTMLButtonElement | null)?.focus(); } }}>Catalog &amp; Compare</button>
      </div>
    </header>
    <div id="session-workbench-panel" className="session-workbench-surface" role="tabpanel" aria-labelledby={surface === "inspector" ? "session-tab-inspector" : "session-tab-catalog"}>
      {surface === "inspector"
        ? <Suspense fallback={<p className="artifact-status" role="status">Loading Inspector workbench…</p>}>
            <InspectorWorkbench reportUrl="api/workspace-inspector-report" fallback={catalog} />
          </Suspense>
        : catalog}
    </div>
  </section>;
}

function SessionDetail({ session }: { session: DebuggerSession }): React.JSX.Element {
  const toolCalls = session.events.reduce((count, event) => count + (event.toolCalls?.length ?? 0), 0);
  return <section className="session-detail" aria-label={`Session detail: ${session.name}`}>
    <header><div><small>Retained Session</small><h1>{session.name}</h1></div><span className={`run-badge status-${session.connection}`}>{session.connection}</span></header>
    <dl><div><dt>Agent</dt><dd>{session.agent}</dd></div><div><dt>Protocol</dt><dd>{session.protocol}</dd></div><div><dt>Events</dt><dd>{session.events.length}</dd></div><div><dt>Tool calls</dt><dd>{toolCalls}</dd></div></dl>
    <ol className="session-event-rows">{session.events.map((event) => <li key={event.id}><time>{event.timestamp}</time><span><strong>{event.phase} · {event.title}</strong><small>{event.summary}</small></span>{event.toolCalls && <em>{event.toolCalls.map((tool) => tool.name).join(", ")}</em>}</li>)}</ol>
  </section>;
}

function ProjectFolderControls(props: { autoFocus?: boolean; onWorkspaceChanged: () => Promise<void> }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<"idle" | "choosing" | "discovering" | "opening">("idle");
  const [failure, setFailure] = useState<string>();

  async function openProject(): Promise<void> {
    setBusy(true);
    setFailure(undefined);
    setStage("choosing");
    let monitoring = true;
    const monitor = (async () => {
      while (monitoring) {
        await new Promise((resolve) => window.setTimeout(resolve, 150));
        if (!monitoring) return;
        try {
          const response = await fetch("api/projects/open/status");
          if (!response.ok) continue;
          const result = await response.json() as { stage?: "idle" | "choosing" | "discovering" };
          if (result.stage === "choosing" || result.stage === "discovering") setStage(result.stage);
        } catch {
          // The open request remains the authoritative error channel.
        }
      }
    })();
    try {
      const opened = await fetch("api/projects/open", { method: "POST" });
      if (!opened.ok) throw new Error(await studioApiError(opened));
      const result = await opened.json() as { opened?: boolean; cancelled?: boolean };
      if (result.cancelled || result.opened !== true) {
        return;
      }
      setStage("opening");
      await props.onWorkspaceChanged();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Project discovery failed.");
    } finally {
      monitoring = false;
      await monitor;
      setStage("idle");
      setBusy(false);
    }
  }

  const progressMessage = stage === "discovering"
    ? "Finding matching Project Sessions across local providers…"
    : stage === "opening"
      ? "Opening the Project workbench…"
      : "Waiting for a Project directory selection…";

  return <div className="workspace-folder-controls">
    <button autoFocus={props.autoFocus} className="primary" type="button" disabled={busy} aria-label={busy ? "Opening Project" : "Choose Project"} onClick={() => void openProject()}><FolderOpen aria-hidden="true" size={14} /><span>{busy ? "Opening…" : "Choose Project"}</span></button>
    {busy && <span className="workspace-open-progress" role="status" aria-live="polite"><i aria-hidden="true" /><small>{progressMessage}</small></span>}
    {failure !== undefined && <small className="workspace-folder-error" role="alert">{failure}</small>}
  </div>;
}

function formatSessionTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}


function DebuggerWorkspace(props: { config: StudioConfig; openProjectAction?: { label: string; onClick: () => void }; project?: { id: string; label: string; revision: number } }): React.JSX.Element {
  if (!props.config.aguiEnabled) {
    return <EmptyWorkspace eyebrow="Live runs" title="Load a harness for live runs" detail="The Debugger drives a live harness run over the embedded AG-UI endpoint and saves finished runs for replay." command="--harness ./my-agent.harness" />;
  }
  if (props.config.harnessMode === "workspace-default" && !props.config.projectExecutionEnabled) {
    return <EmptyWorkspace eyebrow="Project-scoped live runs" title={props.project === undefined ? "Open a Project for live runs" : "This Project is read-only evidence"} detail={props.project === undefined ? (props.config.workspaceDiscoveryEnabled ? "Open a local Project before starting the default harness." : "This Studio launcher does not provide Project discovery.") : "Imported retained-run folders can be inspected and compared, but they do not provide a local execution root for the default harness."} action={props.openProjectAction} />;
  }
  return <div className="debugger-mode"><RunView aguiEndpoint="agui" acpEndpoint={props.config.acpEnabled ? "/agui/acp" : undefined} acpAgentLabel={props.config.acpAgentLabel} artifactEndpoint={props.config.artifactsEnabled ? "/api/artifacts" : undefined} harnessLabel={props.config.harnessMode === "workspace-default" ? "Project default · Qoder" : "Live Trial"} project={props.project} /></div>;
}

function CompareWorkspace(props: {
  config: StudioConfig;
  surface: StudioCompareSurface;
  navigation: ReactNode;
  sessionIds?: [string, string];
  openProjectAction?: { label: string; onClick: () => void };
}): React.JSX.Element {
  const available = compareSurfaces(props.config);
  if (available.length === 0) {
    return <EmptyWorkspace eyebrow="Session comparison" title={props.config.workspaceConnected ? "Choose a Project with at least two Sessions" : "Open a Project"} detail={props.config.workspaceConnected ? "The selected Project needs two discovered Sessions before observational comparison is available." : props.config.workspaceDiscoveryEnabled ? "Open a local Project. Studio will discover its matching agent Sessions without startup parameters." : "This Studio launcher does not provide Project discovery."} action={props.openProjectAction} />;
  }
  if (props.surface === "sessions" && props.config.sessionCount >= 2) {
    return <SessionCompareView navigation={props.navigation} initialIds={props.sessionIds} />;
  }
  if (props.surface === "bench" && props.config.experimentEnabled) {
    return <main className="experiment-mode"><ExperimentView historyEnabled={props.config.historyEnabled} navigation={props.navigation} /></main>;
  }
  if (props.surface === "results" && props.config.evidenceEnabled) {
    return <main className="evidence-results"><header><div><small>Frozen comparison</small><h1>Evidence results</h1></div>{props.navigation}</header><CompareView /></main>;
  }
  const fallback = available[0]!;
  return <EmptyWorkspace eyebrow="Surface unavailable" title="Choose a configured compare surface" detail={`The requested surface is not connected. Available now: ${fallback}.`} />;
}

interface SessionComparisonSide {
  id: string;
  prompt: string;
  savedAt: string;
  status: "finished" | "error" | "observed";
  retainedEventCount: number;
  toolCallCount: number;
  messageCount: number;
  warningCount: number;
  toolSequence: string[];
}

interface SessionComparison {
  kind: "observational-session-compare.v1";
  boundary: string;
  left: SessionComparisonSide;
  right: SessionComparisonSide;
}

function SessionCompareView(props: { navigation: ReactNode; initialIds?: [string, string] }): React.JSX.Element {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [leftId, setLeftId] = useState(props.initialIds?.[0] ?? "");
  const [rightId, setRightId] = useState(props.initialIds?.[1] ?? "");
  const [comparison, setComparison] = useState<SessionComparison>();
  const [failure, setFailure] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("api/sessions");
        if (!response.ok) throw new Error(await studioApiError(response));
        const loaded = await response.json() as { sessions: SessionSummary[] };
        if (cancelled) return;
        setSessions(loaded.sessions);
        setLeftId((current) => current || loaded.sessions[0]?.id || "");
        setRightId((current) => current || loaded.sessions[1]?.id || "");
      } catch (error) {
        if (!cancelled) setFailure(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (leftId === "" || rightId === "" || leftId === rightId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`api/session-compare?${new URLSearchParams({ left: leftId, right: rightId })}`, { signal: controller.signal });
        if (!response.ok) throw new Error(await studioApiError(response));
        setFailure(undefined);
        setComparison(await response.json() as SessionComparison);
      } catch (error) {
        if (!controller.signal.aborted) setFailure(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => controller.abort();
  }, [leftId, rightId]);

  return <main className="session-compare-workspace">
    <header><div><small>Observed retained evidence</small><h1>Compare Sessions</h1></div>{props.navigation}</header>
    <div className="session-compare-picker"><label><span>Left Session</span><select value={leftId} onChange={(event) => setLeftId(event.target.value)}>{sessions.map((session) => <option key={session.id} value={session.id} disabled={session.id === rightId}>{session.prompt}</option>)}</select></label><label><span>Right Session</span><select value={rightId} onChange={(event) => setRightId(event.target.value)}>{sessions.map((session) => <option key={session.id} value={session.id} disabled={session.id === leftId}>{session.prompt}</option>)}</select></label></div>
    {failure !== undefined && <p className="session-compare-boundary status-danger" role="alert">{failure}</p>}
    {comparison === undefined ? <p className="artifact-status" role="status">Loading Session comparison…</p> : <>
      <p className="session-compare-boundary"><strong>No winner inferred.</strong> {comparison.boundary}</p>
      <div className="session-compare-heads"><article><small>Left</small><h2>{comparison.left.prompt}</h2><span className={`run-badge status-${comparison.left.status}`}>{comparison.left.status}</span></article><article><small>Right</small><h2>{comparison.right.prompt}</h2><span className={`run-badge status-${comparison.right.status}`}>{comparison.right.status}</span></article></div>
      <div className="session-compare-table" role="table" aria-label="Observed Session differences">
        <div className="session-compare-columns" role="row"><strong role="columnheader">Metric</strong><strong role="columnheader">Left</strong><strong role="columnheader">Right</strong></div>
        {(["retainedEventCount", "toolCallCount", "messageCount", "warningCount"] as const).map((metric) => <div role="row" key={metric}><strong role="rowheader">{sessionMetricLabel(metric)}</strong><span role="cell">{comparison.left[metric]}</span><span role="cell">{comparison.right[metric]}</span></div>)}
      </div>
      <div className="session-tool-sequences"><section><header>Left tool sequence</header><ol>{comparison.left.toolSequence.map((tool, index) => <li key={`${tool}-${index}`}>{tool}</li>)}</ol></section><section><header>Right tool sequence</header><ol>{comparison.right.toolSequence.map((tool, index) => <li key={`${tool}-${index}`}>{tool}</li>)}</ol></section></div>
    </>}
  </main>;
}

function sessionMetricLabel(metric: "retainedEventCount" | "toolCallCount" | "messageCount" | "warningCount"): string {
  return ({ retainedEventCount: "Retained events", toolCallCount: "Tool calls", messageCount: "Messages", warningCount: "Warnings" })[metric];
}

function EmptyWorkspace(props: { eyebrow: string; title: string; detail: string; command?: string; action?: { label: string; onClick: () => void } }): React.JSX.Element {
  return <main className="empty-workspace"><span><GitBranch aria-hidden="true" size={22} /></span><small>{props.eyebrow}</small><h1>{props.title}</h1><p>{props.detail}</p>{props.action && <button className="primary" type="button" onClick={props.action.onClick}>{props.action.label}</button>}{props.command && <code>{props.command}</code>}</main>;
}

// The surface switcher navigates between separate top-level views (each its own
// <main>), so it is roving navigation with aria-current, not an ARIA tab widget.
function SurfaceNavigation<T extends string>(props: {
  label: string;
  items: readonly { id: T; label: string }[];
  active: T;
  onSelect: (value: T) => void;
}): React.JSX.Element | null {
  const roving = useRovingFocus({ ids: props.items.map((item) => item.id), active: props.active, onSelect: props.onSelect });
  if (props.items.length <= 1) return null;
  return <nav className="studio-tabs studio-secondary-tabs" aria-label={props.label} onKeyDown={roving.onKeyDown} style={{ gridTemplateColumns: `repeat(${props.items.length}, minmax(0, 1fr))` }}>{props.items.map((item) => <button key={item.id} ref={roving.itemRef(item.id)} type="button" tabIndex={roving.tabIndexFor(item.id)} aria-current={props.active === item.id ? "page" : undefined} className={props.active === item.id ? "active" : ""} onClick={() => props.onSelect(item.id)}>{item.label}</button>)}</nav>;
}

function studioLocationFromHash(): { area: StudioArea; projectId?: string } {
  return parseStudioLocation(globalThis.location?.hash, new Set(Object.keys(AREA_COPY)));
}

function areaFromHash(): StudioArea {
  return studioLocationFromHash().area;
}
