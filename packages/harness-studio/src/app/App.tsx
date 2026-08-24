import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import type { Icon } from "@phosphor-icons/react";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { Binoculars } from "@phosphor-icons/react/Binoculars";
import { BugBeetle } from "@phosphor-icons/react/BugBeetle";
import { ChatText } from "@phosphor-icons/react/ChatText";
import { Flask } from "@phosphor-icons/react/Flask";
import { FolderOpen } from "@phosphor-icons/react/FolderOpen";
import { GitBranch } from "@phosphor-icons/react/GitBranch";
import { Moon } from "@phosphor-icons/react/Moon";
import { Package } from "@phosphor-icons/react/Package";
import { PuzzlePiece } from "@phosphor-icons/react/PuzzlePiece";
import { SidebarSimple } from "@phosphor-icons/react/SidebarSimple";
import { SquaresFour } from "@phosphor-icons/react/SquaresFour";
import { Sun } from "@phosphor-icons/react/Sun";
import { ArtifactsWorkspace } from "./ArtifactsWorkspace.js";
import { CompareView } from "./CompareView.js";
import { CustomizationView } from "./CustomizationView.js";
import { ExperimentView } from "./ExperimentView.js";
import { GitHistoryView } from "./GitHistoryView.js";
import { InputTraceView } from "./InputTraceView.js";
import { RunView } from "./RunView.js";
import type { DebuggerSession } from "./session-debugger-model.js";
import { useRovingFocus } from "./roving-tablist.js";
import { studioApiError } from "./studio-api.js";
import { StudioThemeContext, type StudioTheme } from "./studio-theme.js";

const InspectorWorkbench = lazy(async () => ({ default: (await import("./InspectorWorkbench.js")).InspectorWorkbench }));
import {
  capabilitySummary,
  compareSurfaces,
  studioDestinations,
  type StudioArea,
  type StudioCompareSurface,
  type StudioConfig,
  type StudioDestination,
} from "./studio-shell-model.js";

const NAV_ICONS: Record<StudioArea, Icon> = {
  overview: SquaresFour,
  customizations: PuzzlePiece,
  inputs: ChatText,
  sessions: Binoculars,
  commits: GitBranch,
  artifacts: Package,
  debugger: BugBeetle,
  compare: Flask,
};

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
  gitEnabled: false,
  harnessMode: "none",
  historyEnabled: false,
  inspectorEnabled: false,
  workspaceWorkbenchEnabled: false,
  workspaceDiscoveryEnabled: false,
  workspaceConnected: false,
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

async function fetchStudioState(): Promise<{ config: StudioConfig; sources: StudioSourceOption[] }> {
  const [configResponse, sourcesResponse] = await Promise.all([
    fetch("api/config"),
    fetch("api/sources"),
  ]);
  if (!configResponse.ok) throw new Error(`Studio config failed (${configResponse.status}).`);
  const loaded = { ...EMPTY_CONFIG, ...(await configResponse.json() as Partial<StudioConfig>) };
  const sourcesPayload = sourcesResponse.ok ? await sourcesResponse.json() as { sources?: StudioSourceOption[] } : {};
  return {
    config: loaded,
    sources: Array.isArray(sourcesPayload.sources) ? sourcesPayload.sources : [],
  };
}

export function App(): React.JSX.Element {
  const [config, setConfig] = useState<StudioConfig | undefined>(undefined);
  const [sources, setSources] = useState<StudioSourceOption[]>([]);
  const [dataRevision, setDataRevision] = useState(0);
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  const [sessionCompareIds, setSessionCompareIds] = useState<[string, string] | undefined>();
  const [configFailure, setConfigFailure] = useState<string | null>(null);
  const [area, setArea] = useState<StudioArea>(areaFromHash);
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
  }, []);

  useEffect(() => {
    const onHashChange = (): void => setArea(areaFromHash());
    globalThis.addEventListener("hashchange", onHashChange);
    globalThis.addEventListener("popstate", onHashChange);
    return () => {
      globalThis.removeEventListener("hashchange", onHashChange);
      globalThis.removeEventListener("popstate", onHashChange);
    };
  }, []);

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

  function openArea(next: StudioArea): void {
    setArea(next);
    setNavigationOpen(false);
    if (area !== next) globalThis.history.pushState(null, "", `#/${next}`);
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
      setConfig(loaded.config);
      setCompareSurface((currentSurface) => compareSurfaces(loaded.config).includes(currentSurface) ? currentSurface : compareSurfaces(loaded.config)[0] ?? "sessions");
      setDataRevision((revision) => revision + 1);
    } catch (error) {
      setConfigFailure(error instanceof Error ? error.message : "Studio source switch failed.");
    }
  }

  async function workspaceChanged(): Promise<void> {
    const loaded = await fetchStudioState();
    setConfigFailure(null);
    setSources(loaded.sources);
    setConfig(loaded.config);
    setSessionCompareIds(undefined);
    setCompareSurface((currentSurface) => compareSurfaces(loaded.config).includes(currentSurface) ? currentSurface : compareSurfaces(loaded.config)[0] ?? "sessions");
    setWorkspaceRevision((revision) => revision + 1);
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
    return <main className="studio-loading" role="alert"><span className="studio-loading-mark"><GitBranch aria-hidden="true" size={18} weight="bold" /></span><strong>Cannot load Studio configuration.</strong><p>{configFailure}</p></main>;
  }

  const destinations = studioDestinations(config);
  const current = destinations.find((destination) => destination.id === area) ?? destinations[0]!;
  const compareNavigation = (
    <SurfaceNavigation
      label="Compare surfaces"
      items={compareSurfaces(config).map((id) => ({
        id,
        label: id === "sessions" ? "Sessions" : id === "bench" ? "Bench" : "Evidence results",
      }))}
      active={compareSurface}
      onSelect={setCompareSurface}
    />
  );
  const contextNavigation = area === "compare" && compareSurfaces(config).length > 1
    ? compareNavigation
    : null;
  const workspaceGateOpen = config.workspaceDiscoveryEnabled && !config.workspaceConnected;

  return <StudioThemeContext.Provider value={theme}>
  <div className={`studio-control-plane${navigationOpen ? " navigation-open" : ""}`} inert={workspaceGateOpen ? true : undefined} aria-hidden={workspaceGateOpen ? true : undefined}>
    <PrimaryNavigation destinations={destinations} current={area} onSelect={openArea} />
    <button className="studio-nav-backdrop" type="button" aria-label="Close Studio navigation" onClick={() => { setNavigationOpen(false); navigationToggleRef.current?.focus(); }} />
    <section className="studio-area">
      <header className={`studio-context-bar${contextNavigation ? " has-surface-navigation" : ""}`}>
        <button ref={navigationToggleRef} className="studio-nav-toggle" type="button" title={navigationOpen ? "Close navigation" : "Open navigation"} aria-label={navigationOpen ? "Close Studio navigation" : "Open Studio navigation"} aria-expanded={navigationOpen} onClick={() => setNavigationOpen((value) => !value)}><SidebarSimple aria-hidden="true" size={17} /></button>
        <div className="studio-context-title"><h1>{AREA_COPY[area]}</h1></div>
        {contextNavigation && <div className="studio-context-navigation">{contextNavigation}</div>}
        {config.workspaceDiscoveryEnabled && config.workspaceConnected && <WorkspaceFolderControls compact onWorkspaceChanged={workspaceChanged} />}
        <ThemeToggle theme={theme} onChange={setTheme} />
        {sources.length > 0 && <SourceSwitcher sources={sources} onSelect={(source) => void selectSource(source)} />}
        <div className="studio-context-state"><span className={`availability-dot availability-${current.availability}`} /><strong>{current.status}</strong></div>
      </header>
      <div className={`studio-surface studio-surface-${area}`}>
        {area === "overview" && <Overview config={config} onOpen={openArea} />}
        {area === "customizations" && (config.customizationAnalysisEnabled
          ? <CustomizationView key={`customizations-${workspaceRevision}`} analyzed={config.customizationAnalyzed} onAnalyzed={customizationAnalyzed} />
          : <EmptyWorkspace eyebrow="Customization catalog" title={config.workspaceConnected ? "Customization analysis is unavailable" : "Open a project workspace"} detail={config.workspaceConnected ? "This Studio launcher does not include the local customization collector." : "Choose the project directory in Sessions before analyzing Host customizations."} />)}
        {area === "inputs" && (config.workspaceWorkbenchEnabled ? <InputTraceView key={`inputs-${workspaceRevision}`} intentAnalysisEnabled={config.intentAnalysisEnabled} /> : <EmptyWorkspace eyebrow="User input trace" title={config.workspaceConnected ? "No retained input trace is available" : "Open a project workspace"} detail={config.workspaceConnected ? "This workspace source does not include structured Inspector dialogue evidence." : "Choose the project directory in Sessions before browsing retained user inputs and exact file operations."} />)}
        {area === "sessions" && <SessionsWorkspace key={`sessions-${dataRevision}-${workspaceRevision}`} config={config} onWorkspaceChanged={workspaceChanged} onCompare={(ids) => { setSessionCompareIds(ids); setCompareSurface("sessions"); openArea("compare"); }} />}
        {area === "commits" && (config.gitEnabled ? <GitHistoryView key={`commits-${workspaceRevision}`} /> : <EmptyWorkspace eyebrow="Repository history" title={config.workspaceConnected ? "The open workspace is not a Git repository" : "Open a project workspace"} detail={config.workspaceConnected ? "Commit history is available only for a local workspace backed by Git." : "Choose the project directory in Sessions before browsing its local commit history."} />)}
        {area === "artifacts" && <ArtifactsWorkspace key={`artifacts-${dataRevision}-${workspaceRevision}-${config.artifactsEnabled}`} config={config} />}
        {area === "debugger" && <DebuggerWorkspace config={config} />}
        {area === "compare" && <CompareWorkspace key={`compare-${dataRevision}-${workspaceRevision}-${config.experimentEnabled}-${config.evidenceEnabled}`} config={config} surface={compareSurface} navigation={compareNavigation} sessionIds={sessionCompareIds} />}
      </div>
    </section>
  </div>
  {workspaceGateOpen && <WorkspaceGate onWorkspaceChanged={async () => {
    await workspaceChanged();
    openArea(area === "overview" ? "sessions" : area);
  }} />}
  </StudioThemeContext.Provider>;
}

function WorkspaceGate(props: { onWorkspaceChanged: () => Promise<void> }): React.JSX.Element {
  return <section className="studio-workspace-gate" role="dialog" aria-modal="true" aria-labelledby="workspace-gate-title" aria-describedby="workspace-gate-description">
    <div className="studio-workspace-gate-panel">
      <header><span><FolderOpen aria-hidden="true" size={22} /></span><div><small>Local Web workspace</small><h1 id="workspace-gate-title">Open a workspace to start</h1></div></header>
      <p id="workspace-gate-description">Choose the repository or project directory you worked in. Studio will discover matching local agent inputs and Sessions before opening the workbench.</p>
      <WorkspaceFolderControls autoFocus onWorkspaceChanged={props.onWorkspaceChanged} />
      <footer><strong>Workspace-scoped discovery</strong><span>The selected directory scopes Session lookup; Studio does not treat a global Session folder as the project.</span></footer>
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
    <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}><GitBranch aria-hidden="true" size={14} /><span>Data sources</span><em>{active.length}</em></button>
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

function PrimaryNavigation(props: {
  destinations: readonly StudioDestination[];
  current: StudioArea;
  onSelect: (area: StudioArea) => void;
}): React.JSX.Element {
  const groups = [...new Set(props.destinations.map((destination) => destination.group))];
  const buttonRefs = useRef(new Map<StudioArea, HTMLButtonElement>());

  function onNavigationKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const destinations = props.destinations.map((destination) => destination.id);
    const focused = [...buttonRefs.current.entries()].find(([, button]) => button === document.activeElement)?.[0];
    const currentIndex = Math.max(0, destinations.indexOf(focused ?? props.current));
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? destinations.length - 1
        : event.key === "ArrowDown"
          ? (currentIndex + 1) % destinations.length
          : (currentIndex - 1 + destinations.length) % destinations.length;
    buttonRefs.current.get(destinations[nextIndex]!)?.focus();
  }

  return <aside className="studio-primary-nav" aria-label="Studio navigation">
    <header className="studio-product-brand"><span><GitBranch aria-hidden="true" size={18} weight="bold" /></span><div><strong>Better Harness</strong><small>Studio</small></div></header>
    <nav aria-label="Harness control plane" onKeyDown={onNavigationKeyDown}>
      {groups.map((group) => <section className="studio-nav-group" key={group}><h2>{group}</h2>{props.destinations.filter((destination) => destination.group === group).map((destination) => {
        const NavIcon = NAV_ICONS[destination.id];
        return <button key={destination.id} ref={(node) => { if (node) buttonRefs.current.set(destination.id, node); else buttonRefs.current.delete(destination.id); }} type="button" tabIndex={props.current === destination.id ? 0 : -1} aria-current={props.current === destination.id ? "page" : undefined} onClick={() => props.onSelect(destination.id)}>
          <NavIcon aria-hidden="true" size={17} weight={props.current === destination.id ? "fill" : "regular"} />
          <span><strong>{destination.label}</strong><small>{destination.status}</small></span>
          <i className={`availability-dot availability-${destination.availability}`} aria-label={destination.availability} />
        </button>;
      })}</section>)}
    </nav>
  </aside>;
}

function Overview(props: { config: StudioConfig; onOpen: (area: StudioArea) => void }): React.JSX.Element {
  const summary = capabilitySummary(props.config);
  const nextArea: StudioArea = props.config.workspaceConnected
    ? "inputs"
    : props.config.aguiEnabled
      ? "debugger"
      : props.config.experimentEnabled || props.config.evidenceEnabled
        ? "compare"
        : "sessions";
  // Each row states what the input unlocks and how to supply it, so an absent
  // input teaches its own next action instead of only reporting "Not supplied".
  const inputs: Array<{ label: string; connected: boolean; purpose: string; flag?: string }> = [
    { label: "Project workspace", connected: props.config.workspaceConnected, purpose: "Discovers local agent inputs and Sessions" },
    { label: "Customization collector", connected: props.config.customizationAnalysisEnabled, purpose: "Analyzes Codex, Claude, and Qoder only on request" },
    { label: "Inspector workbench", connected: props.config.workspaceWorkbenchEnabled || props.config.inspectorEnabled, purpose: "Capability and date evidence", flag: "--inspector" },
    { label: "Harness runtime", connected: props.config.aguiEnabled, purpose: "Live runs in the Debugger", flag: "--harness" },
    { label: "Compare evidence", connected: props.config.evidenceEnabled, purpose: "Frozen verdict and trials", flag: "--evidence" },
    { label: "Experiment manifest", connected: props.config.experimentEnabled, purpose: "Three-lane experiment trace", flag: "--experiment" },
    { label: "Artifact catalog", connected: props.config.artifactsEnabled, purpose: "Read-only run outputs", flag: "--artifacts" },
    { label: "History adapter", connected: props.config.historyEnabled, purpose: "Checkpoint picker in the Builder", flag: "--history-catalog" },
  ];
  const connectedCount = inputs.filter((input) => input.connected).length;
  return <main className="control-overview">
    <section className="control-lead">
      <h1>{props.config.workspaceConnected
        ? `${props.config.inputCount} retained inputs discovered in this workspace.`
        : "Choose a project workspace to begin."}</h1>
      <p>{props.config.workspaceConnected
        ? "Open Inputs to trace each retained user prompt to exact observed file reads and changes."
        : "Studio discovers agent Sessions for the directory you pick, using the same provider code as Inspector. Nothing is read until you choose."}</p>
      <div className="control-lead-actions">
        <button className="primary" type="button" onClick={() => props.onOpen(nextArea)}>{props.config.workspaceConnected ? "Open Inputs" : "Open workspace"}<ArrowRight aria-hidden="true" size={15} weight="bold" /></button>
        <span>{summary.ready} ready · {summary.partial} partial · {summary.foundation} foundations</span>
      </div>
    </section>

    <section className="control-panel">
      <header><h2>Inputs</h2><span>{connectedCount} of {inputs.length} connected</span></header>
      <ul className="input-readiness">{inputs.map((input) => <li key={input.label} data-connected={input.connected ? "true" : "false"}>
        <span className={`availability-dot ${input.connected ? "availability-ready" : "availability-foundation"}`} aria-hidden="true" />
        <strong>{input.label}</strong>
        <em>{input.purpose}</em>
        {input.connected
          ? <span className="input-state">Connected</span>
          : input.flag
            ? <code>{input.flag}</code>
            : <span className="input-state">Choose in Studio</span>}
      </li>)}</ul>
    </section>
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
  onWorkspaceChanged: () => Promise<void>;
  onCompare: (ids: [string, string]) => void;
}): React.JSX.Element {
  const [sessions, setSessions] = useState<SessionSummary[]>();
  const [workspaceLabel, setWorkspaceLabel] = useState("Project workspace");
  const [omittedCount, setOmittedCount] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<DebuggerSession>();
  const [failure, setFailure] = useState<string>();
  const [detailFailure, setDetailFailure] = useState<string>();
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
        setWorkspaceLabel(payload.workspace.label);
        setOmittedCount(payload.workspace.omittedCount);
        setSessions(payload.sessions);
        if (payload.sessions[0] !== undefined) await openSession(payload.sessions[0].id, () => cancelled);
      } catch (error) {
        if (!cancelled) setFailure(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => { cancelled = true; };
  }, [props.config.workspaceConnected]);

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

  async function disconnect(): Promise<void> {
    const response = await fetch("api/workspace", { method: "DELETE" });
    if (!response.ok) {
      setFailure(await studioApiError(response));
      return;
    }
    await props.onWorkspaceChanged();
  }

  if (!props.config.workspaceConnected) {
    return <WorkspaceIntake onWorkspaceChanged={props.onWorkspaceChanged} />;
  }
  if (failure !== undefined) {
    return <WorkspaceIntake title="Choose another project workspace" detail={failure} onWorkspaceChanged={props.onWorkspaceChanged} />;
  }
  if (sessions === undefined) return <p className="artifact-status" role="status">Indexing sessions…</p>;

  const pair = [...compareIds];
  const catalog = <section className="session-browser-workspace" aria-label="Project workspace sessions">
    <aside className="session-catalog-pane">
      <header><div><small>Local workspace</small><h2 title={workspaceLabel}>{workspaceLabel}</h2></div><span>{sessions.length}</span></header>
      {omittedCount > 0 && <p className="session-omissions">{omittedCount} unsupported or malformed file{omittedCount === 1 ? "" : "s"} omitted.</p>}
      <ul className="session-catalog-rows">{sessions.map((session) => <li key={session.id}>
        <label title="Select for comparison"><input type="checkbox" checked={compareIds.has(session.id)} disabled={!compareIds.has(session.id) && compareIds.size >= 2} onChange={() => toggleCompare(session.id)} /></label>
        <button type="button" className={selected === session.id ? "selected" : undefined} onClick={() => void openSession(session.id)}><small>{session.provider ?? "Local agent"} · {formatSessionTime(session.savedAt)}</small><strong>{session.prompt}</strong><small>{session.status} · {session.toolCallCount} calls</small></button>
      </li>)}</ul>
      <footer><button type="button" className="primary" disabled={pair.length !== 2} onClick={() => props.onCompare(pair as [string, string])}>Compare {pair.length}/2</button><button type="button" onClick={() => void disconnect()}>Disconnect</button></footer>
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
      <div><strong>{workspaceLabel}</strong><span>Inspector-owned workspace evidence</span></div>
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

function WorkspaceIntake(props: { title?: string; detail?: string; onWorkspaceChanged: () => Promise<void> }): React.JSX.Element {
  return <main className="workspace-intake empty-workspace"><span><FolderOpen aria-hidden="true" size={22} /></span><small>Local Web workspace</small><h1>{props.title ?? "Open a project workspace"}</h1><p>{props.detail ?? "Choose the repository or project directory you worked in. Studio uses Inspector's provider discovery to find matching Sessions in local agent evidence stores."}</p><WorkspaceFolderControls onWorkspaceChanged={props.onWorkspaceChanged} /></main>;
}

function WorkspaceFolderControls(props: { autoFocus?: boolean; compact?: boolean; onWorkspaceChanged: () => Promise<void> }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<"idle" | "choosing" | "discovering" | "opening">("idle");
  const [failure, setFailure] = useState<string>();

  async function openWorkspace(): Promise<void> {
    setBusy(true);
    setFailure(undefined);
    setStage("choosing");
    let monitoring = true;
    const monitor = (async () => {
      while (monitoring) {
        await new Promise((resolve) => window.setTimeout(resolve, 150));
        if (!monitoring) return;
        try {
          const response = await fetch("api/workspace/open/status");
          if (!response.ok) continue;
          const result = await response.json() as { stage?: "idle" | "choosing" | "discovering" };
          if (result.stage === "choosing" || result.stage === "discovering") setStage(result.stage);
        } catch {
          // The open request remains the authoritative error channel.
        }
      }
    })();
    try {
      const opened = await fetch("api/workspace/open", { method: "POST" });
      if (!opened.ok) throw new Error(await studioApiError(opened));
      const result = await opened.json() as { opened?: boolean; cancelled?: boolean };
      if (result.cancelled || result.opened !== true) {
        return;
      }
      setStage("opening");
      await props.onWorkspaceChanged();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Workspace discovery failed.");
    } finally {
      monitoring = false;
      await monitor;
      setStage("idle");
      setBusy(false);
    }
  }

  const progressMessage = stage === "discovering"
    ? "Finding matching Sessions across local providers…"
    : stage === "opening"
      ? "Opening the discovered Session list…"
      : "Waiting for a project folder selection…";

  return <div className={`workspace-folder-controls${props.compact ? " is-compact" : ""}`}>
    <button autoFocus={props.autoFocus} className={props.compact ? undefined : "primary"} type="button" disabled={busy} aria-label={busy ? "Opening workspace" : props.compact ? "Change workspace" : "Choose workspace"} onClick={() => void openWorkspace()}><FolderOpen aria-hidden="true" size={14} /><span>{busy ? "Opening…" : props.compact ? "Change workspace" : "Choose workspace"}</span></button>
    {busy && <span className="workspace-open-progress" role="status" aria-live="polite"><i aria-hidden="true" /><small>{progressMessage}</small></span>}
    {failure !== undefined && <small className="workspace-folder-error" role="alert">{failure}</small>}
  </div>;
}

function formatSessionTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}


function DebuggerWorkspace(props: { config: StudioConfig }): React.JSX.Element {
  if (!props.config.aguiEnabled) {
    return <EmptyWorkspace eyebrow="Live runs" title="Load a harness for live runs" detail="The Debugger drives a live harness run over the embedded AG-UI endpoint and saves finished runs for replay." command="--harness ./my-agent.harness" />;
  }
  return <div className="debugger-mode"><RunView aguiEndpoint="agui" acpEndpoint={props.config.acpEnabled ? "/agui/acp" : undefined} acpAgentLabel={props.config.acpAgentLabel} artifactEndpoint={props.config.artifactsEnabled ? "/api/artifacts" : undefined} harnessLabel={props.config.harnessMode === "workspace-default" ? "Workspace default · Qoder" : "Live Trial"} /></div>;
}

function CompareWorkspace(props: {
  config: StudioConfig;
  surface: StudioCompareSurface;
  navigation: ReactNode;
  sessionIds?: [string, string];
}): React.JSX.Element {
  const available = compareSurfaces(props.config);
  if (available.length === 0) {
    return <EmptyWorkspace eyebrow="Session comparison" title={props.config.workspaceConnected ? "Choose a workspace with at least two Sessions" : "Open a project workspace"} detail={props.config.workspaceConnected ? "The current workspace needs two discovered Sessions before observational comparison is available." : "Choose the project directory in Sessions. Studio discovers its matching local agent Sessions without startup parameters."} />;
  }
  if (props.surface === "sessions" && props.config.sessionCount >= 2) {
    return <SessionCompareView navigation={props.navigation} initialIds={props.sessionIds} />;
  }
  if (props.surface === "bench" && props.config.experimentEnabled) {
    return <main className="experiment-mode"><ExperimentView navigation={props.navigation} /></main>;
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
        {(["retainedEventCount", "toolCallCount", "messageCount", "warningCount"] as const).map((metric) => <div role="row" key={metric}><strong role="rowheader">{sessionMetricLabel(metric)}</strong><span role="cell">{comparison.left[metric]}</span><span role="cell">{comparison.right[metric]}</span></div>)}
      </div>
      <div className="session-tool-sequences"><section><header>Left tool sequence</header><ol>{comparison.left.toolSequence.map((tool, index) => <li key={`${tool}-${index}`}>{tool}</li>)}</ol></section><section><header>Right tool sequence</header><ol>{comparison.right.toolSequence.map((tool, index) => <li key={`${tool}-${index}`}>{tool}</li>)}</ol></section></div>
    </>}
  </main>;
}

function sessionMetricLabel(metric: "retainedEventCount" | "toolCallCount" | "messageCount" | "warningCount"): string {
  return ({ retainedEventCount: "Retained events", toolCallCount: "Tool calls", messageCount: "Messages", warningCount: "Warnings" })[metric];
}

function EmptyWorkspace(props: { eyebrow: string; title: string; detail: string; command?: string }): React.JSX.Element {
  return <main className="empty-workspace"><span><GitBranch aria-hidden="true" size={22} /></span><small>{props.eyebrow}</small><h1>{props.title}</h1><p>{props.detail}</p>{props.command && <code>{props.command}</code>}</main>;
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

function areaFromHash(): StudioArea {
  const candidate = globalThis.location?.hash.replace(/^#\/?/, "") as StudioArea | undefined;
  return candidate !== undefined && Object.hasOwn(AREA_COPY, candidate) ? candidate : "overview";
}
