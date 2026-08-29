import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { FolderOpen } from "@phosphor-icons/react/FolderOpen";
import { GitBranch } from "@phosphor-icons/react/GitBranch";
import { Moon } from "@phosphor-icons/react/Moon";
import { SidebarSimple } from "@phosphor-icons/react/SidebarSimple";
import { Sun } from "@phosphor-icons/react/Sun";
import { ArtifactsWorkspace } from "./ArtifactsWorkspace.js";
import { ArtifactView } from "./artifacts/ArtifactView.js";
import { CompareView } from "./CompareView.js";
import { CustomizationView } from "./CustomizationView.js";
import { ExperimentView } from "./experiment/ExperimentView.js";
import { GitHistoryView } from "./GitHistoryView.js";
import { InputTraceView } from "./InputTraceView.js";
import { RunView } from "./run/RunView.js";
import {
  isArtifactCatalogResponse,
  type ArtifactDescriptor,
} from "../contracts/artifact.js";
import type { DebuggerSession } from "../contracts/debugger-session.js";
import { isStudioProjectCatalog, type StudioProjectCatalog, type StudioProjectDescriptor } from "../contracts/studio-project.js";
import { ProjectSidebar } from "./shell/ProjectSidebar.js";
import { parseStudioLocation, studioLocationHash } from "./shell/project-routing.js";
import {
  isWorkspaceArtifactNavigation,
  type StudioArtifactCatalogResponse,
} from "../contracts/workspace-artifact.js";
import { useRovingFocus } from "./roving-tablist.js";
import { studioApiError } from "./studio-api.js";
import { StudioThemeContext, type StudioTheme } from "./studio-theme.js";
import {
  studioLocale,
  switchStudioLanguage,
  type StudioLanguage,
} from "./i18n/index.js";

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

const STUDIO_AREAS: readonly StudioArea[] = [
  "overview",
  "customizations",
  "inputs",
  "sessions",
  "commits",
  "artifacts",
  "debugger",
  "compare",
];

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
  const { t } = useTranslation("common");
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
          setConfigFailure(error instanceof Error ? error.message : t("config.unavailable"));
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
      setConfigFailure(error instanceof Error ? error.message : t("config.sourceSwitchFailed"));
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
    return <main className="studio-loading"><span className="studio-loading-mark"><GitBranch aria-hidden="true" size={18} weight="bold" /></span><p>{t("loading")}</p></main>;
  }
  if (configFailure !== null) {
    return <main className="studio-loading" role="alert"><span className="studio-loading-mark"><GitBranch aria-hidden="true" size={18} weight="bold" /></span><strong>{t("config.failed")}</strong><p>{configFailure}</p><button className="primary" type="button" onClick={() => { setConfig(undefined); setConfigFailure(null); setBootstrapRevision((revision) => revision + 1); }}>{t("config.retry")}</button></main>;
  }

  const availableCompareSurfaces = compareSurfaces(config);
  const effectiveCompareSurface = availableCompareSurfaces.includes(compareSurface)
    ? compareSurface
    : availableCompareSurfaces[0] ?? compareSurface;
  const destinations = studioDestinations(config, effectiveCompareSurface, t);
  const current = destinations.find((destination) => destination.id === area) ?? destinations[0]!;
  const compareNavigation = (
    <SurfaceNavigation
      label={t("compare:surfaces.label")}
      items={availableCompareSurfaces.map((id) => ({
        id,
        label: t(`compare:surfaces.${id}`),
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
    ? { label: config.workspaceConnected ? t("project.openAnother") : t("project.open"), onClick: () => void openProject() }
    : undefined;
  const projectDiscoveryDetail = config.workspaceDiscoveryEnabled
    ? t("project.discoveryChoose")
    : t("project.discoveryUnavailable");
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
    <button className="studio-nav-backdrop" type="button" aria-label={t("workspace:gate.closeAria")} onClick={() => { setNavigationOpen(false); navigationToggleRef.current?.focus(); }} />
    <section className="studio-area">
      <header className={`studio-context-bar${contextNavigation ? " has-surface-navigation" : ""}`}>
        <button ref={navigationToggleRef} className="studio-nav-toggle" type="button" title={navigationOpen ? t("workspace:gate.closeTitle") : t("workspace:gate.openTitle")} aria-label={navigationOpen ? t("workspace:gate.closeAria") : t("workspace:gate.openAria")} aria-expanded={navigationOpen} onClick={() => setNavigationOpen((value) => !value)}><SidebarSimple aria-hidden="true" size={17} /></button>
        <div className="studio-context-title"><small>{activeProject?.label ?? (sources.length > 0 ? t("contextBar.configuredSources") : t("contextBar.noProject"))}</small><h1>{t(`area.${area}`)}</h1></div>
        {contextNavigation && <div className="studio-context-navigation">{contextNavigation}</div>}
        <ThemeToggle theme={theme} onChange={setTheme} />
        <LanguageToggle />
        {sources.length > 0 && <SourceSwitcher sources={sources} onSelect={(source) => void selectSource(source)} />}
        <div className="studio-context-state" role="status" aria-label={t("contextBar.viewStatus", { status: current.status })}><span className={`availability-dot availability-${current.availability}`} /><strong>{current.status}</strong></div>
        {projectFailure !== undefined && <span className="studio-project-failure" role="alert">{projectFailure}</span>}
      </header>
      <div className={`studio-surface studio-surface-${area}`}>
        {area === "overview" && <Overview key={`overview-${workspaceRevision}`} config={overviewConfig} onOpen={openArea} onOpenSession={(id) => { setSessionOpenId(id); openArea("sessions"); }} />}
        {area === "customizations" && (config.customizationAnalysisEnabled
          ? <CustomizationView key={`customizations-${workspaceRevision}`} analyzed={config.customizationAnalyzed} onAnalyzed={customizationAnalyzed} />
          : <EmptyWorkspace eyebrow={t("customize:empty.eyebrow")} title={t("customize:empty.titleConnected")} detail={t("customize:empty.detailConnected")} command="npx @qoder-ai/harness-studio" />)}
        {area === "inputs" && (config.workspaceWorkbenchEnabled ? <InputTraceView key={`inputs-${workspaceRevision}`} intentAnalysisEnabled={config.intentAnalysisEnabled} /> : <EmptyWorkspace eyebrow={t("inputs:empty.eyebrow")} title={config.workspaceConnected ? t("inputs:empty.titleConnected") : t("inputs:empty.titleDisconnected")} detail={config.workspaceConnected ? t("inputs:empty.detailConnected") : projectDiscoveryDetail} action={openProjectAction} />)}
        {area === "sessions" && <SessionsWorkspace key={`sessions-${dataRevision}-${workspaceRevision}-${sessionOpenId ?? "recent"}`} config={config} initialSessionId={sessionOpenId} openProjectAction={openProjectAction} onCompare={(ids) => { setSessionCompareIds(ids); setCompareSurface("sessions"); openArea("compare"); }} />}
        {area === "commits" && (config.gitEnabled ? <GitHistoryView key={`commits-${workspaceRevision}`} /> : <EmptyWorkspace eyebrow={t("git:empty.eyebrow")} title={config.workspaceConnected ? t("git:empty.titleConnected") : t("git:empty.titleDisconnected")} detail={config.workspaceConnected ? t("git:empty.detailConnected") : projectDiscoveryDetail} action={openProjectAction} />)}
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
  const { t } = useTranslation("workspace");
  return <section className="studio-workspace-gate" role="dialog" aria-modal="true" aria-labelledby="workspace-gate-title" aria-describedby="workspace-gate-description">
    <div className="studio-workspace-gate-panel">
      <header><span><FolderOpen aria-hidden="true" size={22} /></span><div><small>{t("gate.eyebrow")}</small><h1 id="workspace-gate-title">{t("gate.title")}</h1></div></header>
      <p id="workspace-gate-description">{t("gate.description")}</p>
      <ProjectFolderControls autoFocus onWorkspaceChanged={props.onWorkspaceChanged} />
      <footer><strong>{t("gate.footerTitle")}</strong><span>{t("gate.footerDetail")}</span></footer>
    </div>
  </section>;
}

function ThemeToggle(props: { theme: StudioTheme; onChange: (theme: StudioTheme) => void }): React.JSX.Element {
  const { t } = useTranslation("common");
  const next = props.theme === "dark" ? "light" : "dark";
  const themeLabel = (theme: StudioTheme): string => theme === "dark" ? t("theme.dark") : t("theme.light");
  const label = t("theme.active", { current: themeLabel(props.theme), next: themeLabel(next) });
  return <button className="studio-theme-toggle" type="button" title={t("theme.switchTo", { theme: themeLabel(next) })} aria-label={label} onClick={() => props.onChange(next)}>
    {props.theme === "dark" ? <Moon aria-hidden="true" size={15} weight="fill" /> : <Sun aria-hidden="true" size={15} weight="fill" />}
    <span>{themeLabel(props.theme)}</span>
  </button>;
}

function LanguageToggle(): React.JSX.Element {
  const { t, i18n } = useTranslation("common");
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const active: StudioLanguage = language === "zh-CN" ? "zh-CN" : "en";
  const next: StudioLanguage = active === "zh-CN" ? "en" : "zh-CN";
  const labelFor = (candidate: StudioLanguage): string => t(`language.${candidate === "zh-CN" ? "zhCN" : "en"}`);
  return <button
    className="studio-language-toggle"
    type="button"
    title={t("language.switchTo", { language: labelFor(next) })}
    aria-label={t("language.current", { language: labelFor(active) })}
    onClick={() => switchStudioLanguage(next)}
  ><span>{active === "zh-CN" ? "中文" : "EN"}</span></button>;
}

function SourceSwitcher(props: {
  sources: StudioSourceOption[];
  onSelect: (source: StudioSourceOption) => void;
}): React.JSX.Element {
  const { t } = useTranslation("workspace");
  const [open, setOpen] = useState(false);
  const active = props.sources.filter((source) => source.active);
  const kinds: StudioSourceKind[] = ["inspector", "evidence", "experiment"];
  return <div className="studio-source-switcher">
    <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={t("sources.buttonAria", { count: active.length })} title={t("sources.button")} onClick={() => setOpen((value) => !value)}><GitBranch aria-hidden="true" size={14} /><span>{t("sources.button")}</span><em>{active.length}</em></button>
    {open && <div className="studio-source-menu" role="menu" aria-label={t("sources.menuAria")}>
      {kinds.map((kind) => {
        const entries = props.sources.filter((source) => source.kind === kind);
        if (entries.length === 0) return null;
        return <section key={kind}>
          <h2>{sourceKindLabel(kind, t)}</h2>
          {entries.map((source) => <button key={source.id} type="button" role="menuitemradio" aria-checked={source.active} className={source.active ? "selected" : ""} onClick={() => { setOpen(false); if (!source.active) props.onSelect(source); }}><strong>{source.label}</strong><span>{source.active ? t("sources.active") : t("sources.switch")}</span></button>)}
        </section>;
      })}
    </div>}
  </div>;
}

function sourceKindLabel(kind: StudioSourceKind, t: TFunction): string {
  if (kind === "inspector") return t("sources.inspector");
  if (kind === "evidence") return t("sources.evidence");
  return t("sources.bench");
}

function Overview(props: { config: StudioConfig; onOpen: (area: StudioArea) => void; onOpenSession: (id: string) => void }): React.JSX.Element {
  const { t } = useTranslation("overview");
  const model = studioOverview(props.config, t);
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
        setRecentFailure(error instanceof Error ? error.message : t("panes.recentUnavailable"));
        setRecentSessions([]);
      }
    })();
    return () => { cancelled = true; };
  }, [props.config.workspaceConnected, props.config.sessionCount]);

  const heading = model.title;
  const context = model.mode === "workspace"
    ? t("context.workspace")
    : model.mode === "configured"
      ? t("context.configured")
      : model.mode === "workspace-required"
        ? t("context.workspaceRequired")
        : t("context.studio");

  return <main className={`control-overview overview-mode-${model.mode}`}>
    <section className="overview-summary">
      <div className="overview-lead">
        <small>{context}</small>
        <h1>{heading}</h1>
        <p>{model.detail}</p>
        {model.primaryAction !== undefined && model.mode !== "workspace-required" && <button className="primary" type="button" onClick={() => props.onOpen(model.primaryAction!.area)}>{model.primaryAction.label}<ArrowRight aria-hidden="true" size={15} weight="bold" /></button>}
      </div>
      {model.mode === "workspace" && <dl className="overview-facts" aria-label={t("panes.workspaceSummaryAria")}>{model.facts.map((fact) => <div key={fact.id}><dt>{fact.label}</dt><dd>{fact.value}</dd><small>{fact.detail}</small></div>)}</dl>}
    </section>

    <div className="overview-workspace">
      {model.mode === "workspace" ? <section className="overview-pane overview-recent">
        <header><h2>{t("panes.recentSessions")}</h2><span>{props.config.sessionCount}</span></header>
        {recentFailure !== undefined
          ? <p className="overview-pane-status" role="alert">{recentFailure}</p>
          : recentSessions === undefined
            ? <p className="overview-pane-status" role="status">{t("panes.loadingSessions")}</p>
            : recentSessions.length === 0
              ? <p className="overview-pane-status">{t("panes.noneRetained")}</p>
              : <ol className="overview-session-rows">{recentSessions.map((session) => <li key={session.id}><button type="button" aria-label={t("panes.openSessionAria", { prompt: session.prompt })} onClick={() => props.onOpenSession(session.id)}><span><small>{session.provider ?? t("common:localAgent")} · {formatSessionTime(session.savedAt, studioLocale())}</small><strong>{session.prompt}</strong></span><em>{t("panes.calls", { count: session.toolCallCount })}</em><ArrowRight aria-hidden="true" size={14} /></button></li>)}</ol>}
      </section> : <section className="overview-pane overview-context">
        <header><h2>{model.mode === "configured" ? t("panes.loadedContext") : t("panes.gettingStarted")}</h2><span>{model.facts.length || undefined}</span></header>
        {model.facts.length === 0
          ? <p className="overview-pane-status">{model.detail}</p>
          : <dl className="overview-context-rows">{model.facts.map((fact) => <div key={fact.id}><dt><strong>{fact.label}</strong><small>{fact.detail}</small></dt><dd>{fact.value}</dd></div>)}</dl>}
      </section>}

      <aside className="overview-pane overview-actions">
        <header><h2>{t("panes.nextActions")}</h2><span>{model.secondaryActions.length}</span></header>
        {model.secondaryActions.length === 0
          ? <p className="overview-pane-status">{model.mode === "workspace" ? t("panes.openSessionsHint") : t("panes.loadContextHint")}</p>
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

interface SessionArtifactContext {
  authorityId: string;
  artifacts: ArtifactDescriptor[];
}

function SessionsWorkspace(props: {
  config: StudioConfig;
  initialSessionId?: string;
  openProjectAction?: { label: string; onClick: () => void };
  onCompare: (ids: [string, string]) => void;
}): React.JSX.Element {
  const { t } = useTranslation("sessions");
  const [sessions, setSessions] = useState<SessionSummary[]>();
  const [omittedCount, setOmittedCount] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<DebuggerSession>();
  const [sessionArtifacts, setSessionArtifacts] = useState<SessionArtifactContext | null>();
  const [failure, setFailure] = useState<string>();
  const [detailFailure, setDetailFailure] = useState<string>();
  const sessionRowRefs = useRef(new Map<string, HTMLButtonElement>());
  const [focusedSessionId, setFocusedSessionId] = useState<string>();
  const detailRequest = useRef(0);
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
    const request = ++detailRequest.current;
    try {
      setSessionArtifacts(undefined);
      const [response, artifactResponse] = await Promise.all([
        fetch(`api/sessions/${encodeURIComponent(id)}/debugger`),
        fetch("api/artifacts"),
      ]);
      if (!response.ok) throw new Error(await studioApiError(response));
      const loaded = await response.json() as DebuggerSession;
      const artifacts = artifactResponse.ok
        ? sessionArtifactContext(await artifactResponse.json() as unknown, id)
        : null;
      if (cancelled() || request !== detailRequest.current) return;
      setDetailFailure(undefined);
      setSelected(id);
      setDetail(loaded);
      setSessionArtifacts(artifacts);
    } catch (error) {
      if (cancelled() || request !== detailRequest.current) return;
      const message = error instanceof Error ? error.message : t("detailLoadFailed");
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
    return <EmptyWorkspace eyebrow={t("empty.eyebrow")} title={t("empty.title")} detail={props.config.workspaceDiscoveryEnabled ? t("empty.discoveryDetail") : t("empty.noDiscoveryDetail")} action={props.openProjectAction} />;
  }
  if (failure !== undefined) {
    return <EmptyWorkspace eyebrow={t("empty.eyebrow")} title={t("empty.discoveryFailed")} detail={failure} />;
  }
  if (sessions === undefined) return <p className="artifact-status" role="status">{t("indexing")}</p>;

  const pair = [...compareIds];
  const catalog = <section className="session-browser-workspace" aria-label={t("workspaceAria")}>
    <aside className="session-catalog-pane">
      <header><div><small>{t("evidenceEyebrow")}</small><h2>{t("common:area.sessions")}</h2></div><span>{sessions.length}</span></header>
      {omittedCount > 0 && <p className="session-omissions">{t("omitted", { count: omittedCount })}</p>}
      <ul className="session-catalog-rows">{sessions.map((session) => <li key={session.id}>
        <label title={t("selectTitle", { prompt: session.prompt })}><input type="checkbox" aria-label={t("selectAria", { prompt: session.prompt, provider: session.provider ?? t("common:localAgent"), time: formatSessionTime(session.savedAt, studioLocale()) })} checked={compareIds.has(session.id)} disabled={!compareIds.has(session.id) && compareIds.size >= 2} onChange={() => toggleCompare(session.id)} /></label>
        <button ref={(node) => { if (node) sessionRowRefs.current.set(session.id, node); else sessionRowRefs.current.delete(session.id); }} type="button" tabIndex={focusedSessionId === session.id ? 0 : -1} className={selected === session.id ? "selected" : undefined} onFocus={() => setFocusedSessionId(session.id)} onKeyDown={(event) => moveSessionFocus(event, session.id)} onClick={() => { setFocusedSessionId(session.id); void openSession(session.id); }}><small>{session.provider ?? t("common:localAgent")} · {formatSessionTime(session.savedAt, studioLocale())}</small><strong>{session.prompt}</strong><small>{t("status", { status: session.status, count: session.toolCallCount })}</small></button>
      </li>)}</ul>
      <footer><button type="button" className="primary" disabled={pair.length !== 2} onClick={() => props.onCompare(pair as [string, string])}>{t("compareButton", { pair: pair.length })}</button></footer>
    </aside>
    <main className="session-detail-pane">
      {detailFailure !== undefined
        ? <p className="artifact-status" role="alert">{detailFailure}</p>
        : detail === undefined
          ? <p className="artifact-status">{t("selectSession")}</p>
          : <SessionDetail session={detail} artifactContext={sessionArtifacts} />}
    </main>
  </section>;

  if (!props.config.workspaceWorkbenchEnabled) return catalog;
  return <section className="session-workbench-stack" aria-label={t("workbenchAria")}>
    <header className="session-workbench-toolbar">
      <div><strong>{t("workbenchTitle")}</strong><span>{t("workbenchDetail")}</span></div>
      <div className="session-surface-tabs" role="tablist" aria-label={t("viewsTablist")}>
        <button id="session-tab-inspector" type="button" role="tab" aria-controls="session-workbench-panel" aria-selected={surface === "inspector"} tabIndex={surface === "inspector" ? 0 : -1} className={surface === "inspector" ? "selected" : undefined} onClick={() => setSurface("inspector")} onKeyDown={(event) => { if (event.key === "ArrowRight") { event.preventDefault(); setSurface("catalog"); (event.currentTarget.nextElementSibling as HTMLButtonElement | null)?.focus(); } }}>{t("inspectorTab")}</button>
        <button id="session-tab-catalog" type="button" role="tab" aria-controls="session-workbench-panel" aria-selected={surface === "catalog"} tabIndex={surface === "catalog" ? 0 : -1} className={surface === "catalog" ? "selected" : undefined} onClick={() => setSurface("catalog")} onKeyDown={(event) => { if (event.key === "ArrowLeft") { event.preventDefault(); setSurface("inspector"); (event.currentTarget.previousElementSibling as HTMLButtonElement | null)?.focus(); } }}>{t("catalogTab")}</button>
      </div>
    </header>
    <div id="session-workbench-panel" className="session-workbench-surface" role="tabpanel" aria-labelledby={surface === "inspector" ? "session-tab-inspector" : "session-tab-catalog"}>
      {surface === "inspector"
        ? <Suspense fallback={<p className="artifact-status" role="status">{t("loadingInspector")}</p>}>
            <InspectorWorkbench reportUrl="api/workspace-inspector-report" fallback={catalog} />
          </Suspense>
        : catalog}
    </div>
  </section>;
}

function SessionDetail({ session, artifactContext }: { session: DebuggerSession; artifactContext?: SessionArtifactContext | null }): React.JSX.Element {
  const { t } = useTranslation("sessions");
  const [activeArtifactId, setActiveArtifactId] = useState<string>();
  useEffect(() => setActiveArtifactId(undefined), [session.id]);
  const toolCalls = session.events.reduce((count, event) => count + (event.toolCalls?.length ?? 0), 0);
  const activeArtifact = artifactContext?.artifacts.find((artifact) => artifact.id === activeArtifactId);
  const openArtifact = (artifact: ArtifactDescriptor): void => setActiveArtifactId(artifact.id);
  return <section className="session-detail" aria-label={t("detail.aria", { name: session.name })}>
    <header><div><small>{t("detail.retained")}</small><h1>{session.name}</h1></div><span className={`run-badge status-${session.connection}`}>{session.connection}</span></header>
    <dl><div><dt>{t("detail.agent")}</dt><dd>{session.agent}</dd></div><div><dt>{t("detail.protocol")}</dt><dd>{session.protocol}</dd></div><div><dt>{t("detail.events")}</dt><dd>{session.events.length}</dd></div><div><dt>{t("detail.toolCalls")}</dt><dd>{toolCalls}</dd></div></dl>
    <div className="session-detail-workspace">
      <section className="session-detail-ledger" aria-label={t("detail.ledgerAria")}>
        <section className="session-artifact-files" aria-label={t("detail.filesAria")}>
          <header><strong>{t("detail.files")}</strong><span>{artifactContext?.artifacts.length ?? 0}</span></header>
          {artifactContext === undefined
            ? <p>{t("detail.indexingFiles")}</p>
            : artifactContext === null || artifactContext.artifacts.length === 0
              ? <p>{t("detail.noCatalogFiles")}</p>
              : <ul>{artifactContext.artifacts.map((artifact) => <li key={artifact.id}><button
                type="button"
                aria-pressed={activeArtifactId === artifact.id}
                aria-label={t("detail.openArtifactAria", { label: artifact.label })}
                title={t("detail.openHint")}
                onClick={() => openArtifact(artifact)}
                onDoubleClick={() => openArtifact(artifact)}
              ><span><strong>{artifact.label}</strong><small>{artifact.format.toUpperCase()} · {t("detail.exactRevision", { id: artifact.revision.id.slice(0, 18) })}</small></span><em>{artifact.renderer.status === "ready" ? artifact.renderer.label : t("detail.previewUnavailable")}</em></button></li>)}</ul>}
        </section>
        <ol className="session-event-rows">{session.events.map((event) => <li key={event.id}><time>{event.timestamp}</time><span><strong>{event.phase} · {event.title}</strong><small>{event.summary}</small></span>{event.toolCalls && <em>{event.toolCalls.map((tool) => tool.name).join(", ")}</em>}</li>)}</ol>
      </section>
      <aside className="session-artifact-preview" aria-label={t("detail.artifactViewAria")}>
        {activeArtifact === undefined || artifactContext == null
          ? <div className="session-artifact-empty"><small>{t("detail.artifactView")}</small><strong>{t("detail.selectFile")}</strong><p>{t("detail.selectFileDetail")}</p></div>
          : <>
            <header><div><strong>{activeArtifact.label}</strong><small>{activeArtifact.format.toUpperCase()} · {activeArtifact.adapter.id}</small></div><span title={activeArtifact.revision.id}>{activeArtifact.revision.id.slice(0, 18)}</span></header>
            <div className="session-artifact-surface" data-native-session-artifact={activeArtifact.label}>
              <ArtifactView authorityId={artifactContext.authorityId} artifact={activeArtifact} liveGeneration={0} />
            </div>
          </>}
      </aside>
    </div>
  </section>;
}

function sessionArtifactContext(value: unknown, sessionId: string): SessionArtifactContext | null {
  if (!isArtifactCatalogResponse(value)) return null;
  const catalog = value as StudioArtifactCatalogResponse;
  if (catalog.navigation === undefined || !isWorkspaceArtifactNavigation(catalog.navigation)) return null;
  const artifactIds = new Set(catalog.navigation.observations
    .filter((observation) => observation.sessionId === sessionId)
    .map((observation) => observation.artifactId));
  return {
    authorityId: catalog.snapshot.catalogId,
    artifacts: catalog.artifacts.filter((artifact) => artifactIds.has(artifact.id)),
  };
}

function ProjectFolderControls(props: { autoFocus?: boolean; onWorkspaceChanged: () => Promise<void> }): React.JSX.Element {
  const { t } = useTranslation("workspace");
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
      setFailure(error instanceof Error ? error.message : t("folderControls.discoveryFailed"));
    } finally {
      monitoring = false;
      await monitor;
      setStage("idle");
      setBusy(false);
    }
  }

  const progressMessage = stage === "discovering"
    ? t("folderControls.discovering")
    : stage === "opening"
      ? t("folderControls.openingList")
      : t("folderControls.waiting");

  return <div className="workspace-folder-controls">
    <button autoFocus={props.autoFocus} className="primary" type="button" disabled={busy} aria-label={busy ? t("folderControls.openingAria") : t("folderControls.choose")} onClick={() => void openProject()}><FolderOpen aria-hidden="true" size={14} /><span>{busy ? t("folderControls.opening") : t("folderControls.choose")}</span></button>
    {busy && <span className="workspace-open-progress" role="status" aria-live="polite"><i aria-hidden="true" /><small>{progressMessage}</small></span>}
    {failure !== undefined && <small className="workspace-folder-error" role="alert">{failure}</small>}
  </div>;
}

function formatSessionTime(value: string, locale: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString(locale);
}

function DebuggerWorkspace(props: { config: StudioConfig; openProjectAction?: { label: string; onClick: () => void }; project?: { id: string; label: string; revision: number } }): React.JSX.Element {
  const { t } = useTranslation("common");
  if (!props.config.aguiEnabled) {
    return <EmptyWorkspace eyebrow={t("debugger.eyebrow")} title={t("debugger.title")} detail={t("debugger.detail")} command="--harness ./my-agent.harness" />;
  }
  if (props.config.harnessMode === "workspace-default" && !props.config.projectExecutionEnabled) {
    return <EmptyWorkspace eyebrow={t("debugger.projectScopedEyebrow")} title={props.project === undefined ? t("debugger.openProjectTitle") : t("debugger.readOnlyTitle")} detail={props.project === undefined ? (props.config.workspaceDiscoveryEnabled ? t("debugger.openProjectDetail") : t("debugger.noDiscoveryDetail")) : t("debugger.readOnlyDetail")} action={props.openProjectAction} />;
  }
  return <div className="debugger-mode"><RunView aguiEndpoint="agui" acpEndpoint={props.config.acpEnabled ? "/agui/acp" : undefined} acpAgentLabel={props.config.acpAgentLabel} artifactEndpoint={props.config.artifactsEnabled ? "/api/artifacts" : undefined} harnessLabel={props.config.harnessMode === "workspace-default" ? t("debugger.workspaceDefaultQoder") : t("debugger.liveTrial")} project={props.project} /></div>;
}

function CompareWorkspace(props: {
  config: StudioConfig;
  surface: StudioCompareSurface;
  navigation: ReactNode;
  sessionIds?: [string, string];
  openProjectAction?: { label: string; onClick: () => void };
}): React.JSX.Element {
  const { t } = useTranslation("compare");
  const available = compareSurfaces(props.config);
  if (available.length === 0) {
    return <EmptyWorkspace eyebrow={t("empty.eyebrow")} title={props.config.workspaceConnected ? t("empty.titleConnected") : t("empty.titleDisconnected")} detail={props.config.workspaceConnected ? t("empty.detailConnected") : props.config.workspaceDiscoveryEnabled ? t("empty.discoveryDetail") : t("empty.noDiscoveryDetail")} action={props.openProjectAction} />;
  }
  if (props.surface === "sessions" && props.config.sessionCount >= 2) {
    return <SessionCompareView navigation={props.navigation} initialIds={props.sessionIds} />;
  }
  if (props.surface === "bench" && props.config.experimentEnabled) {
    return <main className="experiment-mode"><ExperimentView historyEnabled={props.config.historyEnabled} navigation={props.navigation} /></main>;
  }
  if (props.surface === "results" && props.config.evidenceEnabled) {
    return <main className="evidence-results"><header><div><small>{t("frozen.eyebrow")}</small><h1>{t("frozen.title")}</h1></div>{props.navigation}</header><CompareView /></main>;
  }
  const fallback = available[0]!;
  return <EmptyWorkspace eyebrow={t("unavailable.eyebrow")} title={t("unavailable.title")} detail={t("unavailable.detail", { surfaces: fallback })} />;
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
  const { t } = useTranslation("sessions");
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
    <header><div><small>{t("compare.eyebrow")}</small><h1>{t("compare.title")}</h1></div>{props.navigation}</header>
    <div className="session-compare-picker"><label><span>{t("compare.left")}</span><select value={leftId} onChange={(event) => setLeftId(event.target.value)}>{sessions.map((session) => <option key={session.id} value={session.id} disabled={session.id === rightId}>{session.prompt}</option>)}</select></label><label><span>{t("compare.right")}</span><select value={rightId} onChange={(event) => setRightId(event.target.value)}>{sessions.map((session) => <option key={session.id} value={session.id} disabled={session.id === leftId}>{session.prompt}</option>)}</select></label></div>
    {failure !== undefined && <p className="session-compare-boundary status-danger" role="alert">{failure}</p>}
    {comparison === undefined ? <p className="artifact-status" role="status">{t("compare.loading")}</p> : <>
      <p className="session-compare-boundary"><strong>{t("compare.noWinner")}</strong> {comparison.boundary}</p>
      <div className="session-compare-heads"><article><small>{t("compare.leftSide")}</small><h2>{comparison.left.prompt}</h2><span className={`run-badge status-${comparison.left.status}`}>{comparison.left.status}</span></article><article><small>{t("compare.rightSide")}</small><h2>{comparison.right.prompt}</h2><span className={`run-badge status-${comparison.right.status}`}>{comparison.right.status}</span></article></div>
      <div className="session-compare-table" role="table" aria-label={t("compare.aria")}>
        <div className="session-compare-columns" role="row"><strong role="columnheader">{t("compare.metricColumn")}</strong><strong role="columnheader">{t("compare.leftSide")}</strong><strong role="columnheader">{t("compare.rightSide")}</strong></div>
        {(["retainedEventCount", "toolCallCount", "messageCount", "warningCount"] as const).map((metric) => <div role="row" key={metric}><strong role="rowheader">{sessionMetricLabel(metric, t)}</strong><span role="cell">{comparison.left[metric]}</span><span role="cell">{comparison.right[metric]}</span></div>)}
      </div>
      <div className="session-tool-sequences"><section><header>{t("compare.leftToolSequence")}</header><ol>{comparison.left.toolSequence.map((tool, index) => <li key={`${tool}-${index}`}>{tool}</li>)}</ol></section><section><header>{t("compare.rightToolSequence")}</header><ol>{comparison.right.toolSequence.map((tool, index) => <li key={`${tool}-${index}`}>{tool}</li>)}</ol></section></div>
    </>}
  </main>;
}

function sessionMetricLabel(metric: "retainedEventCount" | "toolCallCount" | "messageCount" | "warningCount", t: TFunction): string {
  return ({
    retainedEventCount: t("compare.metrics.retainedEvents"),
    toolCallCount: t("compare.metrics.toolCalls"),
    messageCount: t("compare.metrics.messages"),
    warningCount: t("compare.metrics.warnings"),
  })[metric];
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
  return parseStudioLocation(globalThis.location?.hash, new Set<string>(STUDIO_AREAS));
}

function areaFromHash(): StudioArea {
  return studioLocationFromHash().area;
}