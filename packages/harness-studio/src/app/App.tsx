import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { FolderOpen } from "@phosphor-icons/react/FolderOpen";
import { Gear } from "@phosphor-icons/react/Gear";
import { GitBranch } from "@phosphor-icons/react/GitBranch";
import { Moon } from "@phosphor-icons/react/Moon";
import { SidebarSimple } from "@phosphor-icons/react/SidebarSimple";
import { Sun } from "@phosphor-icons/react/Sun";
import { ArtifactsWorkspace } from "./ArtifactsWorkspace.js";
import { ArtifactView } from "./artifacts/ArtifactView.js";
import { CompareView } from "./CompareView.js";
import { CompareLiveView } from "./CompareLiveView.js";
import { CustomizationView } from "./CustomizationView.js";
import { MemoryView } from "./MemoryView.js";
import { ExperimentView } from "./experiment/ExperimentView.js";
import { GitHistoryView } from "./GitHistoryView.js";
import { RunView } from "./run/RunView.js";
import {
  isArtifactCatalogResponse,
  type ArtifactDescriptor,
} from "../contracts/artifact.js";
import type { DebuggerSession } from "../contracts/debugger-session.js";
import { isStudioProjectCatalog, type StudioProjectCatalog, type StudioProjectDescriptor } from "../contracts/studio-project.js";
import { ProjectSidebar } from "./shell/ProjectSidebar.js";
import {
  STUDIO_DATE_RANGE_PRESETS,
  STUDIO_DEFAULT_DATE_RANGE,
  withinDateRange,
  type StudioDateRange,
} from "./date-range.js";
import { TOOLBAR_ACTIONS_ID, ToolbarActions } from "./shell/ToolbarActions.js";
import { PaneSash } from "./shell/PaneSash.js";
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
  studioDestinations,
  STUDIO_DEFAULT_AREA,
  type StudioArea,
  type StudioCompareSurface,
  type StudioConfig,
} from "./studio-shell-model.js";

const SessionPerformanceWorkspace = lazy(() => import("./performance/SessionPerformanceWorkspace.js"));

const STUDIO_AREAS: readonly StudioArea[] = [
  "memory",
  "memory-sources",
  "customizations",
  "sessions",
  "session-performance",
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
  runEnabled: false,
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

const SIDEBAR_WIDTH_KEY = "harness-studio-sidebar-width";
const SIDEBAR_COLLAPSED_KEY = "harness-studio-sidebar-collapsed";
const DATE_RANGE_KEY = "harness-studio-date-range";
/** Below this width the sidebar is an overlay, so a stored width does not apply. */
const SIDEBAR_OVERLAY_QUERY = "(max-width: 1080px)";

/**
 * Sidebar geometry lives in the token file, which DESIGN.md owns. Reading it back
 * rather than restating the numbers here keeps one source for the contract, so a
 * revised token moves the default and the drag bounds together.
 */
function sidebarBounds(): { min: number; max: number; fallback: number } {
  const declared = (name: string, fallback: number): number => {
    const value = Number.parseInt(getComputedStyle(document.documentElement).getPropertyValue(name), 10);
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    min: declared("--sidebar-min-width", 180),
    max: declared("--sidebar-max-width", 420),
    fallback: declared("--sidebar-width", 236),
  };
}

function storedSidebarWidth(): number {
  const { min, max, fallback } = sidebarBounds();
  let stored = Number.NaN;
  try {
    stored = Number.parseInt(globalThis.localStorage.getItem(SIDEBAR_WIDTH_KEY) ?? "", 10);
  } catch {
    stored = Number.NaN;
  }
  if (!Number.isFinite(stored)) return fallback;
  // Clamped on read: a width stored on a wide display must not strand a window
  // that has since become narrow.
  return Math.min(max, Math.max(min, stored));
}

function storedSidebarCollapsed(): boolean {
  try {
    return globalThis.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * The observation window survives a reload, because a reader who narrowed to
 * "today" is mid-investigation and should not be widened back out by a refresh.
 * A stored value that no longer parses falls back rather than throwing.
 */
function storedDateRange(): StudioDateRange {
  try {
    const raw = globalThis.localStorage.getItem(DATE_RANGE_KEY);
    if (raw === null) return STUDIO_DEFAULT_DATE_RANGE;
    const parsed = JSON.parse(raw) as Partial<StudioDateRange>;
    if (!STUDIO_DATE_RANGE_PRESETS.includes(parsed.preset as StudioDateRange["preset"])) {
      return STUDIO_DEFAULT_DATE_RANGE;
    }
    return {
      preset: parsed.preset as StudioDateRange["preset"],
      ...(typeof parsed.from === "string" ? { from: parsed.from } : {}),
      ...(typeof parsed.to === "string" ? { to: parsed.to } : {}),
    };
  } catch {
    return STUDIO_DEFAULT_DATE_RANGE;
  }
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
  const [projectScanning, setProjectScanning] = useState(false);
  const [projectFailure, setProjectFailure] = useState<string>();
  const [dataRevision, setDataRevision] = useState(0);
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  const [sessionCompareIds, setSessionCompareIds] = useState<[string, string] | undefined>();
  const [sessionOpenId, setSessionOpenId] = useState<string>();
  const [configFailure, setConfigFailure] = useState<string | null>(null);
  const [bootstrapRevision, setBootstrapRevision] = useState(0);
  const [area, setArea] = useState<StudioArea>(areaFromHash);
  const [locationRevision, setLocationRevision] = useState(0);
  // Live comparison is the active workflow. Retained Session evidence is only
  // opened after the reader explicitly selects a pair in Sessions.
  const [compareSurface, setCompareSurface] = useState<StudioCompareSurface>("live");
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(storedSidebarCollapsed);
  const [sidebarWidth, setSidebarWidth] = useState(storedSidebarWidth);
  const [dateRange, setDateRange] = useState<StudioDateRange>(storedDateRange);
  const [overlaySidebar, setOverlaySidebar] = useState(() => globalThis.matchMedia?.(SIDEBAR_OVERLAY_QUERY).matches === true);
  const [theme, setTheme] = useState<StudioTheme>(initialStudioTheme);
  const navigationToggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // The overlay regime is a CSS breakpoint, so the shell asks the same query
  // rather than tracking window width itself and risking a different answer.
  useEffect(() => {
    const media = globalThis.matchMedia?.(SIDEBAR_OVERLAY_QUERY);
    if (media === undefined) return;
    const sync = (event: MediaQueryListEvent): void => setOverlaySidebar(event.matches);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    try {
      globalThis.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
      globalThis.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed));
    } catch {
      // The layout stays usable for this page when storage is blocked.
    }
  }, [sidebarWidth, sidebarCollapsed]);

  useEffect(() => {
    try {
      globalThis.localStorage.setItem(DATE_RANGE_KEY, JSON.stringify(dateRange));
    } catch {
      // The window still applies to this page when storage is blocked.
    }
  }, [dateRange]);

  /**
   * Only a choice made here is stored. Writing on every render would persist the
   * appearance the host happened to have at first paint, and Studio would stop
   * following the system after a single load.
   */
  function chooseTheme(next: StudioTheme): void {
    setTheme(next);
    try {
      globalThis.localStorage.setItem("harness-studio-theme", next);
    } catch {
      // The choice remains usable for this page when storage is blocked.
    }
  }

  // A desktop application tracks the host appearance while it runs, not only at
  // launch, so an unattended window follows the system's own light/dark switch.
  // A stored choice opts out.
  useEffect(() => {
    const media = globalThis.matchMedia?.("(prefers-color-scheme: light)");
    if (media === undefined) return;
    const follow = (event: MediaQueryListEvent): void => {
      let stored: string | null = null;
      try {
        stored = globalThis.localStorage.getItem("harness-studio-theme");
      } catch {
        stored = null;
      }
      if (stored === "light" || stored === "dark") return;
      setTheme(event.matches ? "light" : "dark");
    };
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, []);

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
    if (location.area === "memory" || location.area === "memory-sources") return;
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
      // The View list is a roving group, so its one tab stop is the row to focus;
      // the first button in the DOM may be a row that is deliberately skipped.
      document.querySelector<HTMLButtonElement>('.studio-primary-nav nav button[tabindex="0"]')?.focus();
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
    const nextHash = studioLocationHash({ area: next, ...(activeProjectId === undefined || next === "memory" || next === "memory-sources" ? {} : { projectId: activeProjectId }) });
    if (globalThis.location.hash !== nextHash) globalThis.history.pushState(null, "", nextHash);
    if (next === "memory" || next === "memory-sources") globalThis.dispatchEvent(new Event('popstate'));
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
      setCompareSurface((currentSurface) => compareSurfaces(loaded.config).includes(currentSurface) ? currentSurface : compareSurfaces(loaded.config)[0] ?? "live");
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
    setCompareSurface((currentSurface) => compareSurfaces(loaded.config).includes(currentSurface) ? currentSurface : compareSurfaces(loaded.config)[0] ?? "live");
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
      if (result.project !== undefined && area !== "memory" && area !== "memory-sources") {
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
      if (updateHistory && area !== "memory" && area !== "memory-sources") globalThis.history.pushState(null, "", studioLocationHash({ projectId, area }));
    } catch (error) {
      setProjectFailure(error instanceof Error ? error.message : "Project activation failed.");
      await refreshProjectCatalog();
      closeNavigation();
      if (!updateHistory && area !== "memory" && area !== "memory-sources") {
        globalThis.history.replaceState(null, "", studioLocationHash({ area, ...(activeProjectId === undefined ? {} : { projectId: activeProjectId }) }));
      }
    } finally {
      setProjectOpening(false);
    }
  }

  async function scanStudioProject(): Promise<void> {
    if (activeProjectId === undefined || projectOpening) return;
    setProjectOpening(true);
    setProjectScanning(true);
    setProjectFailure(undefined);
    try {
      const response = await fetch(`api/projects/${encodeURIComponent(activeProjectId)}/scan`, { method: "POST" });
      if (!response.ok) throw new Error(await studioApiError(response));
      await workspaceChanged();
    } catch (error) {
      setProjectFailure(error instanceof Error ? error.message : t("sidebar.scanFailed"));
    } finally {
      setProjectScanning(false);
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
      if (wasActive && area !== "memory" && area !== "memory-sources") globalThis.history.pushState(null, "", studioLocationHash({ area }));
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
  const current = destinations.find((destination) => destination.id === area)
    ?? destinations.find((destination) => destination.id === STUDIO_DEFAULT_AREA)
    ?? destinations[0]!;
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
  // Only a local directory has evidence a scan can read, and only discovery can
  // read it, so the toolbar control and the empty-state CTA share one condition.
  const canScanProject = config.workspaceDiscoveryEnabled && activeProject?.kind === "local";
  const openProjectAction = config.workspaceDiscoveryEnabled
    ? { label: config.workspaceConnected ? t("project.openAnother") : t("project.open"), onClick: () => void openProject() }
    : undefined;
  const projectDiscoveryDetail = config.workspaceDiscoveryEnabled
    ? t("project.discoveryChoose")
    : t("project.discoveryUnavailable");
  const showWelcome = studioProjectGateRequired(config, sources.length > 0, area);
  const dateScopeKey = JSON.stringify(dateRange);

  // Two regimes share one control. Wide windows dock the sidebar and collapse it
  // in place; narrow windows float it over the content, which is the existing
  // `navigationOpen` overlay. The toggle drives whichever one is in force.
  const sidebarVisible = overlaySidebar ? navigationOpen : !sidebarCollapsed;
  function toggleSidebar(): void {
    if (overlaySidebar) setNavigationOpen((value) => !value);
    else setSidebarCollapsed((value) => !value);
  }

  return <StudioThemeContext.Provider value={theme}>
  <div
    className={`studio-control-plane${navigationOpen ? " navigation-open" : ""}`}
    data-sidebar={sidebarCollapsed ? "collapsed" : "expanded"}
    style={{ ["--sidebar-width" as string]: `${sidebarWidth}px` }}
  >
    <ProjectSidebar
      projects={projects}
      activeProjectId={activeProjectId}
      destinations={destinations}
      current={showWelcome ? null : area}
      opening={projectOpening}
      canOpenProject={config.workspaceDiscoveryEnabled}
      onOpenProject={() => void openProject()}
      onActivateProject={(projectId) => void activateStudioProject(projectId)}
      onRemoveProject={(projectId) => void removeStudioProject(projectId)}
      onSelectView={openArea}
      onCollapseSidebar={() => { setSidebarCollapsed(true); navigationToggleRef.current?.focus(); }}
      onCloseNavigation={() => { setNavigationOpen(false); navigationToggleRef.current?.focus(); }}
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
      settings={<SettingsMenu theme={theme} onTheme={chooseTheme} />}
    />
    <SidebarSash width={sidebarWidth} onWidth={setSidebarWidth} />
    <button className="studio-nav-backdrop" type="button" aria-label={t("workspace:gate.closeAria")} onClick={() => { setNavigationOpen(false); navigationToggleRef.current?.focus(); }} />
    <section className="studio-area">
      <header className={`studio-context-bar${contextNavigation ? " has-surface-navigation" : ""}`}>
        <button ref={navigationToggleRef} className="studio-nav-toggle" type="button" title={sidebarVisible ? t("workspace:gate.closeTitle") : t("workspace:gate.openTitle")} aria-label={sidebarVisible ? t("workspace:gate.closeAria") : t("workspace:gate.openAria")} aria-expanded={sidebarVisible} onClick={toggleSidebar}><SidebarSimple aria-hidden="true" size={17} /></button>
        <div className="studio-context-title"><h1>{showWelcome ? t("workspace:welcome.title") : t(`area.${area}`)}</h1></div>
        {contextNavigation && <div className="studio-context-navigation">{contextNavigation}</div>}
        {/* The active View's primary action lands here, so a workbench does not
            open a second bar just to hold one button. */}
        <div className="studio-context-actions" id={TOOLBAR_ACTIONS_ID} />
        {/* Scanning refreshes every View at once, so it is the shell's action
            rather than any View's, and it stays reachable at every width — the
            sidebar that used to hold it is an overlay on narrow windows. */}
        {canScanProject && <div className="studio-shell-actions">
          <ProjectScanAction scanRequired={config.workspaceScanRequired === true} scanning={projectScanning} disabled={projectOpening} onScan={() => void scanStudioProject()} />
        </div>}
        {sources.length > 0 && <SourceSwitcher sources={sources} onSelect={(source) => void selectSource(source)} />}
        {projectFailure !== undefined && <span className="studio-project-failure" role="alert">{projectFailure}</span>}
      </header>
      <div className={`studio-surface studio-surface-${area}`}>
        {(area === "memory" || area === "memory-sources") && <MemoryView dateRange={dateRange} />}
        {showWelcome ? <WorkspaceWelcome onWorkspaceChanged={async () => {
          const projectId = await workspaceChanged();
          globalThis.history.replaceState(null, "", studioLocationHash({ area, ...(projectId === undefined ? {} : { projectId }) }));
        }} /> : config.workspaceScanRequired && !["memory", "memory-sources", "debugger", "compare"].includes(area) ? <EmptyWorkspace eyebrow={activeProject?.label ?? ""} title={t("sidebar.scanPendingTitle")} detail={t("sidebar.scanPendingDetail")} action={canScanProject ? { label: projectScanning ? t("sidebar.scanning") : t("sidebar.scanProject"), onClick: () => void scanStudioProject(), disabled: projectOpening } : undefined} /> : <>
        {area === "session-performance" && <SessionPerformanceWorkspace key={`performance-${config.activeProjectId}-${config.projectRevision}`} config={config} dateRange={dateRange} />}
        {area === "sessions" && <SessionsWorkspace key={`sessions-${dataRevision}-${workspaceRevision}-${sessionOpenId ?? "recent"}-${dateScopeKey}`} dateRange={dateRange} config={config} initialSessionId={sessionOpenId} openProjectAction={openProjectAction} onCompare={(ids) => { setSessionCompareIds(ids); setCompareSurface("sessions"); openArea("compare"); }} />}
        {area === "customizations" && (config.customizationAnalysisEnabled
          ? <CustomizationView key={`customizations-${workspaceRevision}`} analyzed={config.customizationAnalyzed} onAnalyzed={customizationAnalyzed} />
          : <EmptyWorkspace eyebrow={t("customize:empty.eyebrow")} title={t("customize:empty.titleConnected")} detail={t("customize:empty.detailConnected")} />)}
        {area === "commits" && (config.gitEnabled ? <GitHistoryView key={`commits-${workspaceRevision}`} dateRange={dateRange} /> : <EmptyWorkspace eyebrow={t("git:empty.eyebrow")} title={config.workspaceConnected ? t("git:empty.titleConnected") : t("git:empty.titleDisconnected")} detail={config.workspaceConnected ? t("git:empty.detailConnected") : projectDiscoveryDetail} action={openProjectAction} />)}
        {area === "artifacts" && <ArtifactsWorkspace key={`artifacts-${dataRevision}-${workspaceRevision}-${config.artifactsEnabled}-${dateScopeKey}`} dateRange={dateRange} config={config} />}
        {area === "debugger" && <DebuggerWorkspace config={config} openProjectAction={openProjectAction} project={activeProject === undefined ? undefined : { id: activeProject.id, label: activeProject.label, revision: config.projectRevision ?? 0 }} />}
        {area === "compare" && <CompareWorkspace key={`compare-${dataRevision}-${workspaceRevision}-${config.experimentEnabled}-${config.evidenceEnabled}`} config={config} surface={effectiveCompareSurface} navigation={null} sessionIds={sessionCompareIds} openProjectAction={openProjectAction} onOpenSessions={() => openArea("sessions")} project={activeProject === undefined ? undefined : { id: activeProject.id, label: activeProject.label, revision: config.projectRevision ?? 0 }} />}
        </>}
      </div>
      {area === "debugger" ? <footer className="studio-status-bar"><strong>{activeProject?.label}</strong><div id="studio-debugger-status" /></footer> : <StatusBar
        scope={area === "memory" || area === "memory-sources" ? t('area.memory') : activeProject?.label ?? (sources.length > 0 ? t("contextBar.configuredSources") : t("statusBar.noProject"))}
        status={area === "memory-sources" || area === "memory" ? t("memory.readonly") : dateRange.preset !== "all" && (area === "sessions" || area === "artifacts") ? "" : current.status}
        config={config}
        dateRange={dateRange}
      />}
    </section>
  </div>
  </StudioThemeContext.Provider>;
}

function WorkspaceWelcome(props: { onWorkspaceChanged: () => Promise<void> }): React.JSX.Element {
  const { t } = useTranslation("workspace");
  return <section className="studio-welcome" aria-labelledby="studio-welcome-title">
    <div className="studio-welcome-content">
      <GitBranch aria-hidden="true" size={32} />
      <h2 id="studio-welcome-title">{t("welcome.heading")}</h2>
      <p>{t("welcome.description")}</p>
      <ProjectFolderControls onWorkspaceChanged={props.onWorkspaceChanged} />
      <dl>{(["customizations", "sessions", "artifacts"] as const).map((view) => <div key={view}>
        <dt>{t(`common:area.${view}`)}</dt><dd>{t(`welcome.${view}`)}</dd>
      </div>)}</dl>
    </div>
  </section>;
}

/**
 * The macOS status bar: current scope on the leading edge, retained counts on
 * the trailing edge. It also gives the shell a bottom boundary, so a view whose
 * content runs out no longer trails off into bare canvas.
 *
 * The status describes the current evidence; implementation maturity is not
 * part of the reader’s navigation.
 */
function StatusBar(props: {
  scope: string;
  status: string;
  config: StudioConfig;
  dateRange: StudioDateRange;
}): React.JSX.Element {
  const { t } = useTranslation("common");
  // Totals on /api/config are Project-wide. Repeating them while a date window
  // is in force makes the sidebar control look like it did nothing.
  const windowed = props.dateRange.preset !== "all";
  const counts = [
    !windowed && props.config.inputCount > 0 ? t("statusBar.inputs", { count: props.config.inputCount }) : undefined,
    !windowed && props.config.sessionCount > 0 ? t("statusBar.sessions", { count: props.config.sessionCount }) : undefined,
    !windowed && props.config.artifactCount !== undefined && props.config.artifactCount > 0
      ? t("statusBar.artifacts", { count: props.config.artifactCount })
      : undefined,
  ]
    // The current View's status already states one of these counts whenever the
    // reader is looking at that View, and reporting it twice in one bar reads as
    // two separate facts.
    .filter((entry): entry is string => entry !== undefined && entry !== props.status);

  return <footer className="studio-status-bar" aria-label={t("statusBar.aria")}>
    <div className="studio-status-scope" aria-label={t("statusBar.scopeAria")}>
      <strong>{props.scope}</strong>
      {props.status !== "" && <span role="status" aria-label={t("contextBar.viewStatus", { status: props.status })}>{props.status}</span>}
    </div>
    {counts.length > 0 && <div className="studio-status-counts" aria-label={t("statusBar.countsAria")}>
      {counts.map((entry) => <span key={entry}>{entry}</span>)}
    </div>}
  </footer>;
}

/**
 * The sash between the sidebar and the content column. It is a real separator:
 * draggable, focusable, and keyboard operable, because a divider that only
 * responds to a precise drag is unusable without a mouse.
 *
 * The sidebar's leading edge is the window's, so the pointer's x coordinate is
 * the width being asked for. Double-click returns the token default.
 */
function SidebarSash(props: { width: number; onWidth: (width: number) => void }): React.JSX.Element {
  const { t } = useTranslation("common");
  const [dragging, setDragging] = useState(false);
  const bounds = sidebarBounds();

  function commit(next: number): void {
    props.onWidth(Math.min(bounds.max, Math.max(bounds.min, Math.round(next))));
  }

  return <div
    className={`studio-sidebar-sash${dragging ? " dragging" : ""}`}
    role="separator"
    tabIndex={0}
    aria-orientation="vertical"
    aria-label={t("sidebar.resizeAria")}
    aria-valuenow={props.width}
    aria-valuemin={bounds.min}
    aria-valuemax={bounds.max}
    onPointerDown={(event) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    }}
    onPointerMove={(event) => { if (dragging) commit(event.clientX); }}
    onPointerUp={(event) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      setDragging(false);
    }}
    onLostPointerCapture={() => setDragging(false)}
    onDoubleClick={() => commit(bounds.fallback)}
    onKeyDown={(event) => {
      const step = event.shiftKey ? 32 : 8;
      if (event.key === "ArrowLeft") commit(props.width - step);
      else if (event.key === "ArrowRight") commit(props.width + step);
      else if (event.key === "Home") commit(bounds.min);
      else if (event.key === "End") commit(bounds.max);
      else return;
      event.preventDefault();
    }}
  />;
}

/**
 * Appearance and language are set once and rarely changed, so they belong in a
 * Settings pop-up at the quiet end of the window rather than as two permanent
 * buttons in the toolbar, where they competed with the current View's own action.
 *
 * The pop-up opens upward because its trigger sits on the bottom edge.
 */
function SettingsMenu(props: { theme: StudioTheme; onTheme: (theme: StudioTheme) => void }): React.JSX.Element {
  const { t } = useTranslation("common");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return;
      if (rootRef.current?.contains(event.target) === true) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return <div className="studio-settings" ref={rootRef}>
    <button
      className="studio-settings-toggle"
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={t("settings.aria")}
      title={t("settings.title")}
      onClick={() => setOpen((value) => !value)}
    >
      <Gear aria-hidden="true" size={14} />
      <span>{t("settings.title")}</span>
    </button>
    {open && <div className="studio-settings-menu" role="menu" aria-label={t("settings.menuAria")}>
      <h2>{t("settings.appearance")}</h2>
      <ThemeToggle theme={props.theme} onChange={props.onTheme} />
      <h2>{t("settings.language")}</h2>
      <LanguageToggle />
    </div>}
  </div>;
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

/** The width below which the Session panes stack, matching the stylesheet. */
const SESSION_NARROW_QUERY = "(max-width: 760px)";
/** The sash track's own thickness in the Session catalog's pane grid. */
const SESSION_SASH_SIZE = 6;
/** Catalog pane bounds, in px. The detail pane keeps the majority of the width. */
const SESSION_CATALOG_WIDTH: { default: number; min: number } = { default: 300, min: 240 };
const SESSION_DETAIL_MIN_WIDTH = 320;

function SessionsWorkspace(props: {
  config: StudioConfig;
  dateRange: StudioDateRange;
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
  const [retry, setRetry] = useState(0);
  const [detailFailure, setDetailFailure] = useState<string>();
  const sessionRowRefs = useRef(new Map<string, HTMLButtonElement>());
  const [focusedSessionId, setFocusedSessionId] = useState<string>();
  const detailRequest = useRef(0);
  const [agentFilter, setAgentFilter] = useState("all");
  const [catalogWidth, setCatalogWidth] = useState(SESSION_CATALOG_WIDTH.default);
  const [catalogFrame, setCatalogFrame] = useState(0);
  const [catalogStacked, setCatalogStacked] = useState(() => globalThis.matchMedia?.(SESSION_NARROW_QUERY).matches === true);
  const catalogRoot = useRef<HTMLElement>(null);

  // The sash bounds come from the pane area itself, so a dragged width cannot
  // survive a window that no longer has room for it. The stacked regime is the
  // same CSS breakpoint the stylesheet uses rather than a second width guess.
  useEffect(() => {
    const element = catalogRoot.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => setCatalogFrame(entry!.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [props.config.workspaceWorkbenchEnabled]);

  useEffect(() => {
    const media = globalThis.matchMedia?.(SESSION_NARROW_QUERY);
    if (media === undefined) return;
    const sync = (event: MediaQueryListEvent): void => setCatalogStacked(event.matches);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!props.config.workspaceConnected) return;
    setFailure(undefined);
    setSessions(undefined);
    setDetail(undefined);
    setSelected(undefined);
    setDetailFailure(undefined);
    setCompareIds(new Set());
    setAgentFilter("all");
    detailRequest.current += 1;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("api/sessions");
        if (!response.ok) throw new Error(await studioApiError(response));
        const payload = await response.json() as { workspace: { label: string; omittedCount: number }; sessions: SessionSummary[] };
        if (cancelled) return;
        setOmittedCount(payload.workspace.omittedCount);
        setSessions(payload.sessions);
        // Opening Sessions presents an evidence catalog, not an implicit detail
        // navigation. Only an explicit deep-link/session request opens a row.
        const initialSession = props.initialSessionId === undefined
          ? undefined
          : payload.sessions.find((session) => session.id === props.initialSessionId && withinDateRange(session.savedAt, props.dateRange));
        if (initialSession !== undefined) await openSession(initialSession.id, () => cancelled);
      } catch (error) {
        if (!cancelled) setFailure(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => { cancelled = true; };
  }, [props.config.workspaceConnected, props.initialSessionId, props.dateRange, retry]);

  useEffect(() => {
    const visible = sessions?.filter((session) => withinDateRange(session.savedAt, props.dateRange)
      && (agentFilter === "all" || (session.provider ?? t("common:localAgent")) === agentFilter)) ?? [];
    setFocusedSessionId((current) => visible.some((session) => session.id === current)
      ? current
      : visible.find((session) => session.id === selected)?.id ?? visible[0]?.id);
  }, [agentFilter, props.dateRange, selected, sessions, t]);

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
    const rows = sessions.filter((session) => (agentFilter === "all" || (session.provider ?? t("common:localAgent")) === agentFilter)
      && withinDateRange(session.savedAt, props.dateRange));
    if (rows.length === 0) return;
    const index = Math.max(0, rows.findIndex((session) => session.id === id));
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? rows.length - 1
        : event.key === "ArrowDown"
          ? (index + 1) % rows.length
          : (index - 1 + rows.length) % rows.length;
    const nextId = rows[nextIndex]!.id;
    setFocusedSessionId(nextId);
    sessionRowRefs.current.get(nextId)?.focus();
  }

  if (!props.config.workspaceConnected) {
    return <EmptyWorkspace eyebrow={t("empty.eyebrow")} title={t("empty.title")} detail={props.config.workspaceDiscoveryEnabled ? t("empty.discoveryDetail") : t("empty.noDiscoveryDetail")} action={props.openProjectAction} />;
  }
  if (failure !== undefined) {
    return <EmptyWorkspace eyebrow={t("empty.eyebrow")} title={t("empty.discoveryFailed")} detail={failure} action={{ label: t("common:config.retry"), onClick: () => setRetry((value) => value + 1) }} />;
  }
  if (sessions === undefined) return <p className="artifact-status" role="status" aria-busy="true">{t("indexing")}</p>;

  const pair = [...compareIds];
  const agentLabel = (session: SessionSummary): string => session.provider ?? t("common:localAgent");
  // Sessions are the Agent-dimension entry point for Compare, so the catalog can
  // be narrowed to one Agent and always reports how many Agents it observed.
  const agentCounts = sessions.filter((session) => withinDateRange(session.savedAt, props.dateRange))
    .reduce<Map<string, number>>((counts, session) => counts.set(agentLabel(session), (counts.get(agentLabel(session)) ?? 0) + 1), new Map());
  const agents = [...agentCounts.keys()].sort((left, right) => left.localeCompare(right));
  // The sidebar's window narrows before the Agent filter does, so the Agent
  // counts beside each option describe the same span the list shows.
  const datedSessions = sessions.filter((session) => withinDateRange(session.savedAt, props.dateRange));
  const visibleSessions = agentFilter === "all" ? datedSessions : datedSessions.filter((session) => agentLabel(session) === agentFilter);
  // Sizes are clamped to what the frame can hold rather than written back, so a
  // narrowed window borrows space and a widened one returns the reader's choice.
  const catalogMeasured = catalogFrame > 0;
  const catalogMax = catalogMeasured
    ? Math.max(SESSION_CATALOG_WIDTH.min, catalogFrame - SESSION_DETAIL_MIN_WIDTH - SESSION_SASH_SIZE)
    : SESSION_CATALOG_WIDTH.default;
  const fittedCatalogWidth = Math.min(Math.max(catalogWidth, SESSION_CATALOG_WIDTH.min), catalogMax);
  const catalog = <section
    ref={catalogRoot}
    className="session-browser-workspace"
    aria-label={t("workspaceAria")}
    style={catalogMeasured ? { "--session-catalog-width": `${fittedCatalogWidth}px` } as CSSProperties : undefined}
  >
    <aside className="session-catalog-pane">
      <header><h2>{t("common:area.sessions")}</h2><span>{visibleSessions.length}</span></header>
      {agents.length > 1 && <div className="session-agent-filter"><label><span>{t("agentFilterLabel")}</span><select aria-label={t("agentFilterAria")} value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)}><option value="all">{t("allAgents")}</option>{agents.map((agent) => <option key={agent} value={agent}>{t("agentSessionCount", { agent, sessions: agentCounts.get(agent) })}</option>)}</select></label></div>}
      {omittedCount > 0 && <p className="session-omissions">{t("omitted", { count: omittedCount })}</p>}
      {sessions.length > 0 && datedSessions.length === 0
        ? <p className="session-omissions">{t("common:dateRange.emptyWindow")}</p>
        : datedSessions.length < sessions.length && <p className="session-omissions">{t("common:dateRange.filtered", { shown: datedSessions.length, total: sessions.length })}</p>}
      <ul className="session-catalog-rows">{visibleSessions.map((session) => <li key={session.id}>
        <label title={t("selectTitle", { prompt: session.prompt })}><input type="checkbox" aria-label={t("selectAria", { prompt: session.prompt, provider: agentLabel(session), time: formatSessionTime(session.savedAt, studioLocale()) })} checked={compareIds.has(session.id)} disabled={!compareIds.has(session.id) && compareIds.size >= 2} onChange={() => toggleCompare(session.id)} /></label>
        <button ref={(node) => { if (node) sessionRowRefs.current.set(session.id, node); else sessionRowRefs.current.delete(session.id); }} type="button" tabIndex={focusedSessionId === session.id ? 0 : -1} className={selected === session.id ? "selected" : undefined} onFocus={() => setFocusedSessionId(session.id)} onKeyDown={(event) => moveSessionFocus(event, session.id)} onClick={() => { setFocusedSessionId(session.id); void openSession(session.id); }}><small>{agentLabel(session)} · {formatSessionTime(session.savedAt, studioLocale())}</small><strong>{session.prompt}</strong><small>{t("status", { status: session.status, count: session.toolCallCount })}</small></button>
      </li>)}</ul>
      <footer><button type="button" className="primary" disabled={pair.length !== 2} onClick={() => props.onCompare(pair as [string, string])}>{t("compareButton", { pair: pair.length })}</button></footer>
    </aside>
    <PaneSash
      orientation="vertical"
      label={t("resizeCatalogAria")}
      size={fittedCatalogWidth}
      min={SESSION_CATALOG_WIDTH.min}
      max={catalogMax}
      fallback={SESSION_CATALOG_WIDTH.default}
      disabled={catalogStacked || !catalogMeasured}
      onSize={setCatalogWidth}
    />
    <main className="session-detail-pane">
      {detailFailure !== undefined
        ? <p className="artifact-status" role="alert">{detailFailure}</p>
        : detail === undefined
          ? <p className="artifact-status">{t("selectSession")}</p>
          : <SessionDetail session={detail} artifactContext={sessionArtifacts} />}
    </main>
  </section>;

  if (!props.config.workspaceWorkbenchEnabled) return catalog;
  return <div className="session-workbench-surface">
    <Suspense fallback={<p className="artifact-status" role="status">{t("loadingInspector")}</p>}>
      <InspectorWorkbench reportUrl="api/workspace-inspector-report" dateRange={props.dateRange} fallback={catalog} />
    </Suspense>
  </div>;
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
  if (!props.config.runEnabled && !props.config.acpEnabled) {
    return <EmptyWorkspace eyebrow={t("debugger.eyebrow")} title={t("debugger.title")} detail={t("debugger.detail")} command="--harness ./my-agent.harness" />;
  }
  if (props.config.harnessMode === "workspace-default" && !props.config.projectExecutionEnabled) {
    return <EmptyWorkspace eyebrow={t("debugger.projectScopedEyebrow")} title={props.project === undefined ? t("debugger.openProjectTitle") : t("debugger.readOnlyTitle")} detail={props.project === undefined ? (props.config.workspaceDiscoveryEnabled ? t("debugger.openProjectDetail") : t("debugger.noDiscoveryDetail")) : t("debugger.readOnlyDetail")} action={props.openProjectAction} />;
  }
  return <div className="debugger-mode"><RunView embedded runEndpoint="/api/runs/stream" acpEndpoint={props.config.acpEnabled ? "/api/acp/runs/stream" : undefined} acpAgentLabel={props.config.acpAgentLabel} acpAgents={props.config.acpAgents} localRunEnabled={props.config.runEnabled} artifactEndpoint={props.config.artifactsEnabled ? "/api/artifacts" : undefined} harnessLabel={props.config.harnessMode === "workspace-default" ? t("debugger.workspaceDefaultQoder") : t("debugger.liveTrial")} project={props.project} /></div>;
}

function CompareWorkspace(props: {
  config: StudioConfig;
  surface: StudioCompareSurface;
  navigation: ReactNode;
  sessionIds?: [string, string];
  openProjectAction?: { label: string; onClick: () => void };
  onOpenSessions: () => void;
  project?: { id: string; label: string; revision: number };
}): React.JSX.Element {
  const { t } = useTranslation("compare");
  const available = compareSurfaces(props.config);
  if (available.length === 0) {
    // A connected Project is never asked to open a second Project: cross-Agent
    // compare is answered inside this working tree by observing another Agent.
    return props.config.workspaceConnected
      ? <EmptyWorkspace
          eyebrow={t("empty.eyebrow")}
          title={t("empty.titleConnected")}
          detail={props.config.sessionCount === 0 ? t("empty.detailNoSessions") : t("empty.detailConnected")}
          action={{ label: t("empty.openSessions"), onClick: props.onOpenSessions }}
        />
      : <EmptyWorkspace
          eyebrow={t("empty.eyebrow")}
          title={t("empty.titleDisconnected")}
          detail={props.config.workspaceDiscoveryEnabled ? t("empty.discoveryDetail") : t("empty.noDiscoveryDetail")}
          action={props.openProjectAction}
        />;
  }
  if (props.surface === "live") {
    return <CompareLiveView
      agents={props.config.acpAgents ?? []}
      {...(props.project === undefined ? {} : { project: props.project })}
    />;
  }
  if (props.surface === "sessions") {
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
  agent: string;
  retainedEventCount: number;
  toolCallCount: number;
  messageCount: number;
  warningCount: number;
  toolSequence: string[];
  models: string[];
  tokenUsage: Record<string, number>;
  startedAt: string;
  finishedAt: string;
  tools: { id: string; name: string; input: string; output: string; status: string; duration: string; timestamp: string; resources: string[] }[];
  messages: { id: string; role: string; text: string; timestamp: string }[];
  files: string[];
}

interface SessionComparison {
  kind: "observational-session-compare.v1";
  boundary: string;
  crossAgent: boolean;
  left: SessionComparisonSide;
  right: SessionComparisonSide;
}

function SessionCompareView(props: { navigation: ReactNode; initialIds?: [string, string] }): React.JSX.Element {
  const { t } = useTranslation("sessions");
  const [comparison, setComparison] = useState<SessionComparison>();
  const [failure, setFailure] = useState<string>();
  const leftId = props.initialIds?.[0];
  const rightId = props.initialIds?.[1];

  useEffect(() => {
    if (leftId === undefined || rightId === undefined || leftId === rightId) {
      setComparison(undefined);
      setFailure(undefined);
      return;
    }
    const controller = new AbortController();
    setComparison(undefined);
    setFailure(undefined);
    void (async () => {
      try {
        const response = await fetch(`api/session-compare?${new URLSearchParams({ left: leftId, right: rightId })}`, { signal: controller.signal });
        if (!response.ok) throw new Error(await studioApiError(response));
        setComparison(await response.json() as SessionComparison);
      } catch (error) {
        if (!controller.signal.aborted) setFailure(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => controller.abort();
  }, [leftId, rightId]);

  if (leftId === undefined || rightId === undefined || leftId === rightId) {
    return <main className="session-compare-workspace">
      <header><div><small>{t("compare.eyebrow")}</small><h1>{t("compare.title")}</h1></div>{props.navigation}</header>
      <div className="session-compare-empty"><h2>{t("compare.selectPairTitle")}</h2><p>{t("compare.selectPairDetail")}</p></div>
    </main>;
  }

  return <main className="session-compare-workspace">
    <header><div><small>{t("compare.eyebrow")}</small><h1>{t("compare.title")}</h1></div>{props.navigation}</header>
    {failure !== undefined && <p className="session-compare-boundary status-danger" role="alert">{failure}</p>}
    {comparison === undefined ? <p className="artifact-status" role="status">{t("compare.loading")}</p> : <>
      <p className="session-compare-boundary"><strong>{t("compare.noWinner")}</strong> {comparison.boundary}</p>
      <p className={`session-compare-boundary${comparison.crossAgent ? "" : " status-warning"}`} role="status">{comparison.crossAgent ? t("compare.crossAgent") : t("compare.sameAgent", { agent: comparison.left.agent })}</p>
      <div className="session-compare-heads"><article><small>{t("compare.leftSide")} · {comparison.left.agent}</small><h2>{comparison.left.prompt}</h2><span className={`run-badge status-${comparison.left.status}`}>{comparison.left.status}</span></article><article><small>{t("compare.rightSide")} · {comparison.right.agent}</small><h2>{comparison.right.prompt}</h2><span className={`run-badge status-${comparison.right.status}`}>{comparison.right.status}</span></article></div>
      <div className="session-compare-table" role="table" aria-label={t("compare.aria")}>
        <div className="session-compare-columns" role="row"><strong role="columnheader">{t("compare.metricColumn")}</strong><strong role="columnheader">{t("compare.leftSide")}</strong><strong role="columnheader">{t("compare.rightSide")}</strong></div>
        <div role="row"><strong role="rowheader">{t("compare.agentRow")}</strong><span role="cell">{comparison.left.agent}</span><span role="cell">{comparison.right.agent}</span></div>
        {(["retainedEventCount", "toolCallCount", "messageCount", "warningCount"] as const).map((metric) => <div role="row" key={metric}><strong role="rowheader">{sessionMetricLabel(metric, t)}</strong><span role="cell">{comparison.left[metric]}</span><span role="cell">{comparison.right[metric]}</span></div>)}
      </div>
      <div className="session-tool-sequences">{([comparison.left, comparison.right] as const).map((side, index) => <section key={side.id} aria-label={`${index === 0 ? t("compare.leftSide") : t("compare.rightSide")} · ${side.agent}`}>
        <header>{index === 0 ? t("compare.leftToolSequence") : t("compare.rightToolSequence")}</header>
        <p className="session-compare-timing">{side.startedAt} – {side.finishedAt}</p>
        <p className="session-compare-timing">{t("compare.models")}: {side.models.join(", ") || t("compare.unavailable")}</p>
        <details className="session-compare-evidence"><summary>{t("compare.tokens")}</summary><dl className="session-compare-usage">{(["inputTokens", "outputTokens", "cacheReadInputTokens", "cacheCreationInputTokens", "totalTokens"] as const).map((key) => <div key={key}><dt>{t(`compare.${key}`)}</dt><dd>{side.tokenUsage[key]?.toLocaleString() ?? "—"}</dd></div>)}</dl></details>
        <details className="session-compare-evidence"><summary>{t("compare.dialogue")} ({side.messages.length})</summary>
          {side.messages.length === 0 ? <p>{t("compare.unavailable")}</p> : side.messages.map((message) => <details key={message.id} className="session-compare-message"><summary><time>{message.timestamp}</time> · {t(message.role === "user" ? "compare.user" : "compare.assistant")} · {message.text.slice(0, 160)}</summary><pre>{message.text}</pre></details>)}
        </details>
        <details className="session-compare-evidence"><summary>{t("compare.files")} ({side.files.length})</summary>{side.files.length === 0 ? <p>{t("compare.unavailable")}</p> : <ul>{side.files.map((file) => <li key={file}><code>{file}</code></li>)}</ul>}</details>
        <ol className="session-compare-calls">{side.tools.map((tool) => <li key={tool.id}><details><summary><strong>{tool.name}</strong><span>{tool.status} · {tool.duration}</span><span className="session-compare-call-preview">{tool.input.slice(0, 160)}</span></summary><time>{tool.timestamp}</time><h3>{t("compare.input")}</h3><pre>{tool.input}</pre><h3>{t("compare.output")}</h3><pre>{tool.output}</pre>{tool.resources.map((file) => <p key={file}><code>{file}</code></p>)}</details></li>)}</ol>
      </section>)}</div>
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

/**
 * The shell's scan control, as one toolbar icon.
 *
 * Sessions, commits, Skills, MCP, hooks, and plugins have no filesystem watcher,
 * so a scan is how the reader gets everything an Agent produced since the last
 * one. That makes it frequent, which is why it is a permanent toolbar control
 * rather than an item inside the Project menu. It is icon-only because it is a
 * refresh, not the primary decision on any screen; the wording it would have
 * shown stays available as its accessible name, its tooltip, and a status region
 * so a reader who cannot see the spinner still learns the scan is running.
 */
function ProjectScanAction(props: { scanRequired: boolean; scanning: boolean; disabled: boolean; onScan: () => void }): React.JSX.Element {
  const { t } = useTranslation("common");
  const label = props.scanning
    ? t("sidebar.scanning")
    : props.scanRequired ? t("sidebar.scanProject") : t("sidebar.rescanProject");
  return <button
    className="studio-scan-action"
    type="button"
    disabled={props.disabled}
    aria-busy={props.scanning}
    aria-label={label}
    title={`${label} — ${t("sidebar.scanScope")}`}
    onClick={props.onScan}
  >
    {props.scanning ? <span className="studio-project-spinner" aria-hidden="true" /> : <ArrowClockwise aria-hidden="true" size={16} />}
    <span className="sr-only" role="status">{label}</span>
  </button>;
}

function EmptyWorkspace(props: { eyebrow: string; title: string; detail: string; command?: string; action?: { label: string; onClick: () => void; disabled?: boolean } }): React.JSX.Element {
  return <main className="empty-workspace"><span><GitBranch aria-hidden="true" size={22} /></span><small>{props.eyebrow}</small><h1>{props.title}</h1><p>{props.detail}</p>{props.action && <button className="primary" type="button" disabled={props.action.disabled} onClick={props.action.onClick}>{props.action.label}</button>}{props.command && <code>{props.command}</code>}</main>;
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
