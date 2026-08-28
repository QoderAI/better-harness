import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Icon } from "@phosphor-icons/react";
import { ArrowBendDownRight } from "@phosphor-icons/react/ArrowBendDownRight";
import { ArrowBendUpLeft } from "@phosphor-icons/react/ArrowBendUpLeft";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { Binoculars } from "@phosphor-icons/react/Binoculars";
import { BracketsCurly } from "@phosphor-icons/react/BracketsCurly";
import { BugBeetle } from "@phosphor-icons/react/BugBeetle";
import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { CaretLeft } from "@phosphor-icons/react/CaretLeft";
import { CaretRight } from "@phosphor-icons/react/CaretRight";
import { ChatCircleText } from "@phosphor-icons/react/ChatCircleText";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { ClipboardText } from "@phosphor-icons/react/ClipboardText";
import { Clock } from "@phosphor-icons/react/Clock";
import { ClockCounterClockwise } from "@phosphor-icons/react/ClockCounterClockwise";
import { Code } from "@phosphor-icons/react/Code";
import { Database } from "@phosphor-icons/react/Database";
import { Eye } from "@phosphor-icons/react/Eye";
import { FileText } from "@phosphor-icons/react/FileText";
import { Flask } from "@phosphor-icons/react/Flask";
import { FolderOpen } from "@phosphor-icons/react/FolderOpen";
import { GitBranch } from "@phosphor-icons/react/GitBranch";
import { GitDiff } from "@phosphor-icons/react/GitDiff";
import { ImageSquare } from "@phosphor-icons/react/ImageSquare";
import { LinkSimple } from "@phosphor-icons/react/LinkSimple";
import { ListChecks } from "@phosphor-icons/react/ListChecks";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { Pause } from "@phosphor-icons/react/Pause";
import { PencilSimple } from "@phosphor-icons/react/PencilSimple";
import { Play } from "@phosphor-icons/react/Play";
import { Plus } from "@phosphor-icons/react/Plus";
import { SidebarSimple } from "@phosphor-icons/react/SidebarSimple";
import { SkipForward } from "@phosphor-icons/react/SkipForward";
import { SquaresFour } from "@phosphor-icons/react/SquaresFour";
import {
  isArtifactCatalogResponse,
  type ArtifactDescriptor,
} from "../../contracts/artifact.js";
import { TerminalWindow } from "@phosphor-icons/react/TerminalWindow";
import { TestTube } from "@phosphor-icons/react/TestTube";
import { TreeStructure } from "@phosphor-icons/react/TreeStructure";
import { UserCircle } from "@phosphor-icons/react/UserCircle";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { Wrench } from "@phosphor-icons/react/Wrench";
import { XCircle } from "@phosphor-icons/react/XCircle";
import type { AguiEvent } from "@qoder-ai/harness-ui";
import { useVirtualizer } from "@tanstack/react-virtual";
import { applyAguiEvent, initialRunState, timelineItems, type AguiRunState, type TimelineItem } from "./agui-store.js";
import { ArtifactCodeView } from "../code/ArtifactCodeView.js";
import { createSseParser } from "../sse-client.js";
import { useRovingTablist } from "../roving-tablist.js";
import {
  STOP_CONDITIONS,
  type DebuggerCursor,
  type DebuggerEvent,
  type DebuggerEventKind,
  type DebuggerFileChange,
  type DebuggerSession,
  type DebuggerToolCall,
  type EvidenceLevel,
  type RetainedRunRecord,
  type StopCondition,
  type StopConditionState,
} from "../../contracts/debugger-session.js";
import {
  cumulativeFileChanges,
  cursorForNode,
  cursorNodeId,
  DEFAULT_DEBUGGER_CURSOR,
  DEFAULT_STOP_CONDITIONS,
  defaultCursorForSession,
  eventForCursor,
  nextStopCursor,
  previousStateCursor,
  priorStopEvent,
  stepIntoCursor,
  stepOutCursor,
  stepOverCursor,
  toolForCursor,
} from "./debugger-cursor.js";
import { SAMPLE_DEBUGGER_SESSION } from "./sample-debugger-session.js";
import { describeToolPayload } from "./tool-call-model.js";
import { buildTimelineBins, groupLiveTimeline, semanticToolKind, type LiveTimelineGroup, type TimelineBin } from "./timeline-model.js";

/** Post one AG-UI run and fold the SSE stream into state updates. */
async function streamRun(
  endpoint: string,
  prompt: string,
  threadId: string,
  runId: string,
  project: { id: string; label: string; revision: number } | undefined,
  onEvents: (events: AguiEvent[]) => void,
): Promise<void> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(project === undefined ? {} : {
        "X-Harness-Project-Id": project.id,
        "X-Harness-Project-Revision": String(project.revision),
      }),
    },
    body: JSON.stringify({
      threadId,
      runId,
      messages: [{ id: "m1", role: "user", content: prompt }],
    }),
  });
  if (!response.ok || response.body === null) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Run request failed (${response.status}): ${detail}`);
  }
  let pendingEvents: AguiEvent[] = [];
  let frame: number | undefined;
  const flush = (): void => {
    frame = undefined;
    const events = pendingEvents;
    pendingEvents = [];
    if (events.length > 0) onEvents(events);
  };
  const apply = (event: AguiEvent): void => {
    pendingEvents.push(event);
    frame ??= globalThis.requestAnimationFrame(flush);
  };
  const parser = createSseParser(apply);
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
  parser.end();
  if (frame !== undefined) globalThis.cancelAnimationFrame(frame);
  flush();
}

type MessageTimelineItem = Extract<TimelineItem, { kind: "message" }>;
type ToolCallTimelineItem = Extract<TimelineItem, { kind: "tool-call" }>;
type InspectorTab = "changes" | "files" | "artifacts" | "tests" | "terminal" | "plan" | "evidence" | "raw";
type SurfaceMode = "recorded" | "live";
type LiveRuntime = "qoder" | "acp";

interface SavedRunSummary {
  id: string;
  savedAt: string;
  prompt: string;
  status: "finished" | "error";
  toolCallCount: number;
}

type SavedRunRecord = RetainedRunRecord & {
  timeline: TimelineItem[];
};

const EVENT_ICONS: Record<DebuggerEventKind, Icon> = {
  prompt: UserCircle,
  plan: ListChecks,
  explore: Binoculars,
  change: PencilSimple,
  verify: TestTube,
  response: ChatCircleText,
};

const INSPECTOR_TABS: Array<{ id: InspectorTab; label: string; icon: Icon }> = [
  { id: "changes", label: "Changes", icon: GitDiff },
  { id: "files", label: "Files", icon: FolderOpen },
  { id: "artifacts", label: "Artifacts", icon: SquaresFour },
  { id: "tests", label: "Tests", icon: Flask },
  { id: "terminal", label: "Terminal", icon: TerminalWindow },
  { id: "plan", label: "Plan", icon: ClipboardText },
  { id: "evidence", label: "Evidence", icon: LinkSimple },
  { id: "raw", label: "Raw ACP", icon: BracketsCurly },
];

const STOP_LABELS: Record<StopCondition, string> = {
  changes: "Changes",
  failures: "Failures",
  permissions: "Permissions",
  tests: "Tests",
  responses: "Responses",
};

const PLAN_ITEMS = [
  "Inspect current workbench structure and related UI components",
  "Analyze Jupyter-style session notebook patterns",
  "Redesign Session Detail with a notebook metaphor",
  "Implement Harness Studio UI improvements",
  "Update timeline and event visualization",
];

const MessageEntry = memo(function MessageEntry({ item }: { item: MessageTimelineItem }): React.JSX.Element {
  return <div className="entry message"><span className="entry-tag">Assistant</span><pre>{item.text}{item.complete ? "" : " ▌"}</pre></div>;
});

const ToolCallEntry = memo(function ToolCallEntry({ item }: { item: ToolCallTimelineItem }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const argumentsView = useMemo(() => describeToolPayload(item.argsText, "No arguments retained"), [item.argsText]);
  const resultView = useMemo(
    () => item.resultText === undefined ? undefined : describeToolPayload(item.resultText, "Empty result"),
    [item.resultText],
  );
  return <details className={`tool-card status-${item.status}`} onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary>
      <span className="tool-icon" aria-hidden="true"><Wrench size={15} weight="bold" /></span>
      <span className="tool-title"><small>Tool call</small><strong>{item.name}</strong><code>{argumentsView.summary}</code></span>
      <span className="tool-status" aria-live="polite">{toolStatusLabel(item.status)}</span>
      <CaretDown className="tool-chevron" size={14} aria-hidden="true" />
    </summary>
    {expanded && <div className="tool-detail">
      <section><h4>Arguments</h4><ArtifactCodeView mode="source" content={argumentsView.formatted} sourceHint={argumentsView.structured ? "tool-input.json" : "tool-input.txt"} className={argumentsView.structured ? "structured" : ""} label="Tool call arguments" /></section>
      <section><h4>Result</h4>{resultView ? <>{item.resultTruncated ? <p className="tool-notice">Result truncated{item.resultOriginalBytes === undefined ? "" : ` from ${item.resultOriginalBytes.toLocaleString()} bytes`}.</p> : null}<ArtifactCodeView mode="source" content={resultView.formatted} sourceHint={resultView.structured ? "tool-result.json" : "tool-result.txt"} className={resultView.structured ? "structured" : ""} label="Tool call result" /></> : <p className="tool-empty">{item.status === "running" || item.status === "preparing" ? "Waiting for the tool result…" : item.status === "result-unavailable" ? "The run finished without a retained result payload." : "No result payload was retained."}</p>}</section>
      <footer><span>Call ID</span><code title={item.id}>{item.id}</code></footer>
    </div>}
  </details>;
});

const TimelineEntry = memo(function TimelineEntry({ item }: { item: TimelineItem }): React.JSX.Element {
  return item.kind === "message" ? <MessageEntry item={item} /> : <ToolCallEntry item={item} />;
});

function toolStatusLabel(status: ToolCallTimelineItem["status"]): string {
  switch (status) {
    case "preparing": return "Preparing";
    case "running": return "Running";
    case "completed": return "Completed";
    case "failed": return "Failed";
    case "result-unavailable": return "Result unavailable";
    case "interrupted": return "Interrupted";
  }
}

function ControlButton(props: {
  label: string;
  icon: Icon;
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
}): React.JSX.Element {
  const ControlIcon = props.icon;
  return <button type="button" className={props.primary ? "primary" : ""} disabled={props.disabled} onClick={props.onClick}><ControlIcon size={13} weight="bold" aria-hidden="true" /><span>{props.label}</span></button>;
}

function stopConditionLabel(enabled: StopConditionState): string {
  const count = STOP_CONDITIONS.filter((condition) => enabled[condition]).length;
  return `${count} of ${STOP_CONDITIONS.length} stop conditions enabled`;
}

export function RunView({
  aguiEndpoint,
  acpEndpoint,
  acpAgentLabel = "ACP Agent",
  artifactEndpoint,
  harnessLabel = "Live Trial",
  navigation,
  initialMode = "live",
  project,
}: {
  aguiEndpoint: string;
  acpEndpoint?: string;
  acpAgentLabel?: string;
  artifactEndpoint?: string;
  harnessLabel?: string;
  navigation?: ReactNode;
  initialMode?: SurfaceMode;
  project?: { id: string; label: string; revision: number };
}): React.JSX.Element {
  const [surfaceMode, setSurfaceMode] = useState<SurfaceMode>(initialMode);
  const [prompt, setPrompt] = useState("");
  const [runtime, setRuntime] = useState<LiveRuntime>("qoder");
  const [activeRuntime, setActiveRuntime] = useState<LiveRuntime>("qoder");
  const [submittedPrompt, setSubmittedPrompt] = useState("");
  const [runProject, setRunProject] = useState(project);
  const [state, setState] = useState<AguiRunState>(initialRunState);
  const [cursor, setCursor] = useState<DebuggerCursor>(DEFAULT_DEBUGGER_CURSOR);
  const [stopConditions, setStopConditions] = useState<StopConditionState>(DEFAULT_STOP_CONDITIONS);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => new Set(["session", "turn"]));
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("changes");
  const [composerOpen, setComposerOpen] = useState(false);
  const [savedRuns, setSavedRuns] = useState<SavedRunSummary[]>([]);
  const [runsPanelOpen, setRunsPanelOpen] = useState(false);
  const [savedRun, setSavedRun] = useState<SavedRunRecord | null>(null);
  const [retainedSession, setRetainedSession] = useState<DebuggerSession>(SAMPLE_DEBUGGER_SESSION);
  const [treeCollapsed, setTreeCollapsed] = useState(() => globalThis.matchMedia?.("(max-width: 900px)").matches ?? false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(() => globalThis.matchMedia?.("(max-width: 900px)").matches ?? false);
  const busy = useRef(false);
  const permissionOpenedInspector = useRef(false);
  const firstCursorRender = useRef(true);
  const liveStateRef = useRef<AguiRunState>(initialRunState());

  const selectedEvent = eventForCursor(retainedSession, cursor);
  const viewState = state;
  const viewPrompt = submittedPrompt;
  const liveTimeline = useMemo(() => timelineItems(viewState), [viewState, viewState.timelineRevision]);
  const liveGroups = useMemo(() => groupLiveTimeline(liveTimeline), [liveTimeline]);
  const liveBins = useMemo(
    () => buildTimelineBins(liveTimeline, 64, (item) => item.kind === "message" ? "response" : semanticToolKind(item)),
    [liveTimeline],
  );

  useEffect(() => {
    const media = globalThis.matchMedia?.("(max-width: 900px)");
    if (media === undefined) return;
    const listener = (event: MediaQueryListEvent): void => {
      setTreeCollapsed(event.matches);
      setInspectorCollapsed(event.matches);
    };
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  useEffect(() => {
    if (state.pendingPermission !== undefined && inspectorCollapsed) {
      permissionOpenedInspector.current = true;
      setInspectorCollapsed(false);
      return;
    }
    if (state.pendingPermission === undefined && permissionOpenedInspector.current) {
      permissionOpenedInspector.current = false;
      setInspectorCollapsed(true);
    }
  }, [inspectorCollapsed, state.pendingPermission]);

  useEffect(() => {
    if (firstCursorRender.current) {
      firstCursorRender.current = false;
      return;
    }
    if (surfaceMode !== "recorded") return;
    globalThis.document?.querySelector(`[data-notebook-event="${selectedEvent.id}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedEvent.id, surfaceMode]);

  const selectCursor = useCallback((next: DebuggerCursor): void => {
    if (next.toolCallId !== undefined) setExpandedNodes((previous) => new Set(previous).add(next.eventId));
    setCursor(next);
  }, []);

  const selectNode = useCallback((nodeId: string): void => {
    const next = cursorForNode(retainedSession, nodeId);
    if (next !== undefined) selectCursor(next);
  }, [retainedSession, selectCursor]);

  const toggleExpanded = useCallback((nodeId: string): void => {
    setExpandedNodes((previous) => {
      const next = new Set(previous);
      if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId);
      return next;
    });
  }, []);

  const refreshRuns = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("api/runs");
      if (!response.ok) return;
      const payload = await response.json() as { runs?: SavedRunSummary[] };
      setSavedRuns(Array.isArray(payload.runs) ? payload.runs : []);
    } catch {
      // Saved runs stay optional; a fetch failure never blocks the live view.
    }
  }, []);

  useEffect(() => {
    setSavedRuns([]);
    void refreshRuns();
  }, [project?.id, project?.revision, refreshRuns]);

  const openSavedRun = useCallback(async (id: string): Promise<void> => {
    try {
      const [recordResponse, sessionResponse] = await Promise.all([
        fetch(`api/runs/${encodeURIComponent(id)}`),
        fetch(`api/runs/${encodeURIComponent(id)}/session`),
      ]);
      if (!recordResponse.ok || !sessionResponse.ok) return;
      const record = await recordResponse.json() as SavedRunRecord;
      const session = await sessionResponse.json() as DebuggerSession;
      setSavedRun(record);
      setRetainedSession(session);
      setCursor(defaultCursorForSession(session));
      setExpandedNodes(new Set(["session", "turn"]));
      setSurfaceMode("recorded");
      setRunsPanelOpen(false);
    } catch {
      // Leave the current view untouched when the record cannot be read.
    }
  }, []);

  const start = useCallback(async () => {
    if (busy.current || prompt.trim().length === 0) return;
    busy.current = true;
    const promptText = prompt.trim();
    const selectedRuntime = runtime === "acp" && acpEndpoint !== undefined ? "acp" : "qoder";
    const endpoint = selectedRuntime === "acp" ? acpEndpoint! : aguiEndpoint;
    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const threadId = `thread_${stamp}`;
    const runId = `run_${stamp}`;
    setActiveRuntime(selectedRuntime);
    setSubmittedPrompt(promptText);
    setRunProject(project);
    setSurfaceMode("live");
    setSavedRun(null);
    setRetainedSession(SAMPLE_DEBUGGER_SESSION);
    setRunsPanelOpen(false);
    setComposerOpen(false);
    const fresh: AguiRunState = { ...initialRunState(), status: "running" };
    liveStateRef.current = fresh;
    setState(fresh);
    try {
      await streamRun(endpoint, promptText, threadId, runId, project, (events) => {
        // Fold outside any React updater: applyAguiEvent mutates the keyed
        // map for O(1) deltas and each batch must be applied exactly once.
        liveStateRef.current = events.reduce(applyAguiEvent, liveStateRef.current);
        setState(liveStateRef.current);
      });
    } catch (error) {
      liveStateRef.current = { ...liveStateRef.current, status: "error", error: error instanceof Error ? error.message : String(error) };
      setState(liveStateRef.current);
    } finally {
      busy.current = false;
    }
    const final = liveStateRef.current;
    if (final.status === "finished" || final.status === "error") {
      try {
        await fetch("api/runs", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(project === undefined ? {} : {
              "X-Harness-Project-Id": project.id,
              "X-Harness-Project-Revision": String(project.revision),
            }),
          },
          body: JSON.stringify({
            prompt: promptText,
            status: final.status,
            runId: final.runId,
            threadId: final.threadId,
            warnings: final.warnings,
            error: final.error,
            result: final.result,
            timeline: timelineItems(final),
          }),
        });
        void refreshRuns();
      } catch {
        // Saving is best-effort evidence retention; the live view already holds the run.
      }
    }
  }, [acpEndpoint, aguiEndpoint, project, prompt, refreshRuns, runtime]);

  const cancelLiveRun = useCallback(async (): Promise<void> => {
    if (activeRuntime !== "acp" || state.runId === undefined) return;
    await fetch(`/api/acp/runs/${encodeURIComponent(state.runId)}/cancel`, { method: "POST" }).catch(() => undefined);
  }, [activeRuntime, state.runId]);

  const decidePermission = useCallback(async (requestId: string, optionId: string): Promise<void> => {
    if (state.runId === undefined) return;
    await fetch(`/api/acp/runs/${encodeURIComponent(state.runId)}/permissions/${encodeURIComponent(requestId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ optionId }),
    });
  }, [state.runId]);

  const live = surfaceMode === "live";
  const saved = savedRun !== null;
  const sessionName = live ? (viewPrompt || "New harness run") : retainedSession.name;
  const connectionState = live ? viewState.status : retainedSession.connection;
  const liveStatus = liveRunStatusLabel(viewState);
  const liveObservation = liveObservationCopy(viewState);
  const runMode = saved ? "Saved run · Evidence Cursor" : live ? `Live · ${liveStatus}` : retainedSession.mode;
  const visibleProject = submittedPrompt === "" ? project : runProject;

  return <section className={`debugger-shell${treeCollapsed ? " tree-collapsed" : ""}${inspectorCollapsed ? " inspector-collapsed" : ""}`}>
    <header className="debugger-topbar">
      <div className="debugger-brand"><span className="debugger-mark"><BugBeetle size={18} weight="fill" /></span><strong>{live ? "Harness Run" : "Inspector"}</strong><span title={visibleProject === undefined ? undefined : `Project ${visibleProject.label}, revision ${visibleProject.revision}`}>{live ? `${harnessLabel}${visibleProject === undefined ? "" : ` · ${visibleProject.label}`}` : saved ? "Retained Session Debugger" : "Session Debugger · Demo"}</span></div>
      <div className="debugger-session-meta"><span>Session</span><strong title={sessionName}>{sessionName}</strong><em className={live ? "live" : "recorded"}>{runMode}</em></div>
      <div className="debugger-runtime-meta"><span className={`connection-dot status-${connectionState}`} /><strong>{connectionState}</strong><i /><span>Agent</span><strong>{live ? activeRuntime === "acp" ? acpAgentLabel : "local harness" : retainedSession.agent}</strong><i /><span>Protocol</span><strong>{live ? activeRuntime === "acp" ? "ACP v1 · AG-UI projection" : "AG-UI" : retainedSession.protocol}</strong></div>
      <div className="debugger-top-actions">{navigation}{live && activeRuntime === "acp" && state.status === "running" ? <button type="button" className="cancel-live-run" onClick={() => void cancelLiveRun()}><XCircle size={15} />Cancel run</button> : null}<div className="saved-runs"><button type="button" onClick={() => { setRunsPanelOpen((value) => !value); void refreshRuns(); }} aria-expanded={runsPanelOpen} aria-haspopup="true"><ClockCounterClockwise size={15} /><span>Saved runs{savedRuns.length > 0 ? ` (${savedRuns.length})` : ""}</span></button>{runsPanelOpen && <div className="saved-runs-panel" role="menu" aria-label="Saved runs">{saved && <button type="button" role="menuitem" className="saved-runs-live" onClick={() => { setSavedRun(null); setRetainedSession(SAMPLE_DEBUGGER_SESSION); setSurfaceMode("live"); setRunsPanelOpen(false); }}>Back to live view</button>}{savedRuns.length === 0 ? <p className="saved-runs-empty">No saved runs yet. Finish a run to retain it when storage is available.</p> : savedRuns.map((run) => <button type="button" role="menuitem" key={run.id} className={savedRun?.id === run.id ? "selected" : ""} onClick={() => void openSavedRun(run.id)}><strong title={run.prompt}>{run.prompt}</strong><span><em className={`run-badge status-${run.status}`}>{run.status}</em>{run.toolCallCount} call{run.toolCallCount === 1 ? "" : "s"} · {run.savedAt.slice(0, 19).replace("T", " ")}</span></button>)}</div>}</div><button type="button" onClick={() => setTreeCollapsed((value) => !value)} aria-pressed={!treeCollapsed} title="Toggle Execution Tree"><TreeStructure size={15} /></button><button type="button" onClick={() => setInspectorCollapsed((value) => !value)} aria-pressed={!inspectorCollapsed} title="Toggle State Inspector"><SidebarSimple size={15} /></button><button type="button" className="new-run" onClick={() => setComposerOpen(true)}><Plus size={14} weight="bold" />New live run</button></div>
    </header>

    {!live ? <nav className="debugger-toolbar" aria-label="Session debugger controls">
      <div className="step-controls">
        <ControlButton label="Previous Stop" icon={CaretLeft} onClick={() => selectCursor(nextStopCursor(retainedSession, cursor, stopConditions, -1))} />
        <ControlButton label="Continue" icon={Play} primary onClick={() => selectCursor(nextStopCursor(retainedSession, cursor, stopConditions))} />
        <ControlButton label="Next Stop" icon={SkipForward} onClick={() => selectCursor(nextStopCursor(retainedSession, cursor, stopConditions))} />
        <span className="toolbar-divider" />
        <ControlButton label="Step Into" icon={ArrowBendDownRight} disabled={selectedEvent.toolCalls === undefined} onClick={() => selectCursor(stepIntoCursor(retainedSession, cursor))} />
        <ControlButton label="Step Over" icon={ArrowRight} onClick={() => selectCursor(stepOverCursor(retainedSession, cursor))} />
        <ControlButton label="Step Out" icon={ArrowBendUpLeft} disabled={cursor.toolCallId === undefined} onClick={() => selectCursor(stepOutCursor(cursor))} />
        <ControlButton label="Previous State" icon={ClockCounterClockwise} onClick={() => selectCursor(previousStateCursor(retainedSession, cursor))} />
      </div>
      <fieldset className="stop-conditions" aria-label={stopConditionLabel(stopConditions)}><legend>Stop on</legend>{STOP_CONDITIONS.map((condition) => <label key={condition}><input type="checkbox" checked={stopConditions[condition]} onChange={(event) => setStopConditions((previous) => ({ ...previous, [condition]: event.target.checked }))} /><span>{STOP_LABELS[condition]}</span></label>)}</fieldset>
      <div className="pause-boundary"><Pause size={13} weight="fill" /><span>Evidence Cursor</span></div>
    </nav> : <div className="live-observation-bar" role="status"><span><i className={`status-dot status-${viewState.status}`} aria-hidden="true" />{liveObservation.title}</span><strong>{liveObservation.detail}</strong></div>}

    <div className="debugger-grid">
      {live ? <LiveExecutionTree state={viewState} prompt={viewPrompt} /> : <ExecutionTree session={retainedSession} cursor={cursor} expanded={expandedNodes} onToggle={toggleExpanded} onSelect={selectNode} />}
      {live ? <LiveNotebook state={viewState} prompt={viewPrompt} groups={liveGroups} /> : <SessionNotebook session={retainedSession} cursor={cursor} expanded={expandedNodes} onSelect={selectCursor} onToggle={toggleExpanded} />}
      {live ? <LiveInspector state={viewState} runtime={activeRuntime} onPermission={decidePermission} /> : <StateInspector session={retainedSession} cursor={cursor} activeTab={inspectorTab} artifactEndpoint={artifactEndpoint} onTab={setInspectorTab} onPrevious={() => selectCursor(previousStateCursor(retainedSession, cursor))} />}
    </div>

    {live ? <LiveTimeline state={viewState} bins={liveBins} eventCount={liveTimeline.length} /> : <TimelineMinimap session={retainedSession} cursor={cursor} onSelect={selectCursor} />}

    {composerOpen && <div className="live-composer-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setComposerOpen(false); }}><section className="live-composer" role="dialog" aria-modal="true" aria-labelledby="live-composer-title"><header><div><small>{harnessLabel}</small><h2 id="live-composer-title">Start a live harness session</h2></div><button type="button" onClick={() => setComposerOpen(false)} aria-label="Close live run dialog"><XCircle size={19} /></button></header><p>Live events use {project === undefined ? "the configured runtime context" : `Project ${project.label} at revision ${project.revision}`}. The run keeps that binding if the selected Project changes later. ACP runs expose the configured local Agent's real protocol evidence.</p>{acpEndpoint !== undefined ? <label className="live-runtime-select"><span>Runtime</span><select value={runtime} onChange={(event) => setRuntime(event.target.value as LiveRuntime)}><option value="qoder">Qoder SDK · AG-UI</option><option value="acp">{acpAgentLabel} · ACP v1</option></select></label> : null}<textarea value={prompt} placeholder="Task prompt for the harness run…" onChange={(event) => setPrompt(event.target.value)} rows={5} autoFocus /><footer><button type="button" onClick={() => setComposerOpen(false)}>Cancel</button><button type="button" className="primary" onClick={() => void start()} disabled={state.status === "running" || prompt.trim().length === 0}><Play size={14} weight="fill" />Run harness</button></footer></section></div>}
  </section>;
}

function TreeRow(props: {
  nodeId: string;
  label: string;
  detail?: string;
  icon: Icon;
  selected: boolean;
  depth: number;
  expandable?: boolean;
  expanded?: boolean;
  status?: string;
  onSelect: (id: string) => void;
  onToggle?: (id: string) => void;
}): React.JSX.Element {
  const RowIcon = props.icon;
  return <div className={`execution-tree-row${props.selected ? " selected" : ""}`} style={{ "--tree-depth": props.depth } as React.CSSProperties}>
    {props.expandable ? <button type="button" className="tree-caret" aria-label={`${props.expanded ? "Collapse" : "Expand"} ${props.label}`} aria-expanded={props.expanded} onClick={() => props.onToggle?.(props.nodeId)}>{props.expanded ? <CaretDown size={11} /> : <CaretRight size={11} />}</button> : <span className="tree-caret-spacer" />}
    <button type="button" className="tree-node" aria-current={props.selected ? "true" : undefined} onClick={() => props.onSelect(props.nodeId)}><RowIcon size={13} weight={props.selected ? "fill" : "regular"} /><span><strong>{props.label}</strong>{props.detail && <small>{props.detail}</small>}</span>{props.status && <em>{props.status}</em>}</button>
  </div>;
}

function ExecutionTree(props: { session: DebuggerSession; cursor: DebuggerCursor; expanded: Set<string>; onToggle: (id: string) => void; onSelect: (id: string) => void }): React.JSX.Element {
  const selectedNode = cursorNodeId(props.cursor);
  const sessionOpen = props.expanded.has("session");
  const turnOpen = props.expanded.has("turn");
  return <aside className="execution-tree" aria-label="Execution Tree">
    <header><div><small>Execution Tree</small><strong>Observed stages</strong></div><span>{props.session.events.length} events</span></header>
    <div className="execution-tree-scroll" role="tree">
      <TreeRow nodeId="session" label="Session" detail={props.session.name} icon={Database} selected={false} depth={0} expandable expanded={sessionOpen} onSelect={() => props.onToggle("session")} onToggle={props.onToggle} />
      {sessionOpen && <div role="group">
        <TreeRow nodeId="turn" label="Turn 1" detail={`${props.session.startedAt}–${props.session.finishedAt}`} icon={GitBranch} selected={false} depth={1} expandable expanded={turnOpen} onSelect={() => props.onToggle("turn")} onToggle={props.onToggle} />
        {turnOpen && props.session.events.map((event) => {
          const EventIcon = EVENT_ICONS[event.kind];
          const eventExpanded = props.expanded.has(event.id);
          return <div key={event.id} role="treeitem" aria-selected={selectedNode === event.id}>
            <TreeRow nodeId={event.id} label={event.phase} detail={event.title} icon={EventIcon} selected={selectedNode === event.id} depth={2} expandable={event.toolCalls !== undefined} expanded={eventExpanded} status={event.validation?.status ?? (event.fileChanges ? `+${event.fileChanges[0]?.additions ?? 0} −${event.fileChanges[0]?.deletions ?? 0}` : undefined)} onSelect={props.onSelect} onToggle={props.onToggle} />
            {event.toolCalls !== undefined && eventExpanded && <div role="group">{event.toolCalls.map((tool) => <TreeRow key={tool.id} nodeId={tool.id} label={tool.name} detail={tool.summary.replace(`${tool.name} `, "")} icon={tool.name === "Read" ? FileText : tool.name === "Search" ? MagnifyingGlass : ImageSquare} selected={selectedNode === tool.id} depth={3} status={tool.duration} onSelect={props.onSelect} />)}</div>}
          </div>;
        })}
      </div>}
    </div>
    <footer><span><Eye size={12} />Recorded evidence</span></footer>
  </aside>;
}

function SessionNotebook(props: { session: DebuggerSession; cursor: DebuggerCursor; expanded: Set<string>; onSelect: (cursor: DebuggerCursor) => void; onToggle: (id: string) => void }): React.JSX.Element {
  const [view, setView] = useState<"notebook" | "events" | "diff">("notebook");
  const tablist = useRovingTablist({ ids: ["notebook", "events", "diff"] as const, active: view, onSelect: setView, panelId: "session-notebook-panel" });
  return <main className="session-notebook" aria-label="Session Notebook">
    <header className="notebook-viewbar"><nav aria-label="Notebook views" {...tablist.tablistProps}><button type="button" {...tablist.getTabProps("notebook")} className={view === "notebook" ? "active" : ""} onClick={() => setView("notebook")}><ClipboardText size={13} />Notebook</button><button type="button" {...tablist.getTabProps("events")} className={view === "events" ? "active" : ""} onClick={() => setView("events")}><Code size={13} />Events <span>{props.session.events.length}</span></button><button type="button" {...tablist.getTabProps("diff")} className={view === "diff" ? "active" : ""} onClick={() => setView("diff")}><GitDiff size={13} />Diff view</button></nav><span>Turn 1 · {props.session.startedAt}–{props.session.finishedAt}</span></header>
    <div className="session-notebook-scroll" id="session-notebook-panel" role="tabpanel">
      {view === "notebook" && props.session.events.map((event) => <NotebookEvent key={event.id} event={event} cursor={props.cursor} expanded={props.expanded.has(event.id)} onSelect={props.onSelect} onToggle={props.onToggle} />)}
      {view === "events" && <EventsNotebookView session={props.session} cursor={props.cursor} onSelect={props.onSelect} />}
      {view === "diff" && <DiffNotebookView session={props.session} cursor={props.cursor} onSelect={props.onSelect} onToggle={props.onToggle} />}
    </div>
  </main>;
}

function EventsNotebookView(props: { session: DebuggerSession; cursor: DebuggerCursor; onSelect: (cursor: DebuggerCursor) => void }): React.JSX.Element {
  return <section className="notebook-events-table" aria-label="Retained ACP events"><header><strong>Retained semantic events</strong><span>{props.session.events.length} retained events projected to stages</span></header><ol>{props.session.events.map((event, index) => <li key={event.id}><button type="button" className={props.cursor.eventId === event.id ? "selected" : ""} onClick={() => props.onSelect({ eventId: event.id })}><span>{String(index + 1).padStart(2, "0")}</span><time>{event.timestamp}</time><strong>{event.phase}</strong><code>{event.rawAcp.method}</code><em>{event.rawAcp.direction}</em></button></li>)}</ol></section>;
}

function DiffNotebookView(props: { session: DebuggerSession; cursor: DebuggerCursor; onSelect: (cursor: DebuggerCursor) => void; onToggle: (id: string) => void }): React.JSX.Element {
  const changed = props.session.events.filter((event) => event.diff !== undefined);
  return <section className="notebook-diff-view"><header><strong>Observed file changes</strong><span>{changed.length} bounded diff{changed.length === 1 ? "" : "s"} · no workspace restore state</span></header>{changed.length === 0 ? <p className="inspector-empty">No retained file diffs in this session.</p> : changed.map((event) => <NotebookEvent key={event.id} event={event} cursor={props.cursor} expanded={false} onSelect={props.onSelect} onToggle={props.onToggle} />)}</section>;
}

function NotebookEvent(props: { event: DebuggerEvent; cursor: DebuggerCursor; expanded: boolean; onSelect: (cursor: DebuggerCursor) => void; onToggle: (id: string) => void }): React.JSX.Element {
  const selected = props.cursor.eventId === props.event.id;
  const EventIcon = EVENT_ICONS[props.event.kind];
  return <article className={`debugger-event event-${props.event.kind}${selected ? " selected" : ""}`} data-notebook-event={props.event.id}>
    <div className="event-rail"><span><EventIcon size={13} weight={selected ? "fill" : "regular"} /></span></div>
    <div className="debugger-event-card">
      <header><button type="button" className="event-card-select" onClick={() => props.onSelect({ eventId: props.event.id })}><time>{props.event.timestamp}</time><strong>{props.event.title}</strong>{props.event.validation && <em className={`event-status ${props.event.validation.status}`}>{props.event.validation.status}</em>}</button><span>{props.event.phase}{props.event.stopConditions.length > 0 && ` · Stop`}</span></header>
      <EventContent {...props} />
    </div>
  </article>;
}

function EventContent(props: { event: DebuggerEvent; cursor: DebuggerCursor; expanded: boolean; onSelect: (cursor: DebuggerCursor) => void; onToggle: (id: string) => void }): React.JSX.Element {
  if (props.event.kind === "prompt") return <section className="prompt-cell"><small>Prompt</small><p>{props.event.summary}</p></section>;
  if (props.event.kind === "plan") return <section className="plan-cell"><small>Plan · Revision 1</small><ol>{PLAN_ITEMS.map((item) => <li key={item}>{item}</li>)}</ol><span>Thought for 12s · retained assistant update</span></section>;
  if (props.event.kind === "explore") return <ExploreCell event={props.event} cursor={props.cursor} expanded={props.expanded} onSelect={props.onSelect} onToggle={props.onToggle} />;
  if (props.event.diff !== undefined) return <DiffCell event={props.event} />;
  if (props.event.validation !== undefined) return <ValidationCell event={props.event} />;
  return <section className="response-cell"><small>Final response</small><p>{props.event.summary}</p><div><CheckCircle size={14} weight="fill" /><span>Observed edits and passing verification are linked in Evidence.</span></div></section>;
}

function ExploreCell(props: { event: DebuggerEvent; cursor: DebuggerCursor; expanded: boolean; onSelect: (cursor: DebuggerCursor) => void; onToggle: (id: string) => void }): React.JSX.Element {
  const tools = props.event.toolCalls ?? [];
  return <section className="explore-cell" onClick={(event) => event.stopPropagation()}>
    <button type="button" className="execution-group-summary" aria-expanded={props.expanded} onClick={() => props.onToggle(props.event.id)}><span><CaretRight size={12} /><strong>Execution group</strong><em>9 tool calls</em></span><small>Read files ×5 · Search repository ×3 · Inspect image ×1</small></button>
    <div className="execution-group-files"><span>Files read</span><code>workbench.js</code><code>index.html</code><code>replay.js</code><code>experiment-trace-model.ts</code><code>App.tsx</code></div>
    {props.expanded && <ol className="explore-tool-list">{tools.map((tool, index) => <li key={tool.id}><button type="button" className={props.cursor.toolCallId === tool.id ? "selected" : ""} onClick={() => props.onSelect({ eventId: props.event.id, toolCallId: tool.id })}><span>{String(index + 1).padStart(2, "0")}</span><strong>{tool.name}</strong><code>{tool.summary}</code><em>{tool.duration}</em></button>{props.cursor.toolCallId === tool.id && <ToolCallDetail tool={tool} />}</li>)}</ol>}
  </section>;
}

function ToolCallDetail({ tool }: { tool: DebuggerToolCall }): React.JSX.Element {
  return <div className="mock-tool-detail"><section><small>Input</small><ArtifactCodeView mode="source" content={tool.input} sourceHint="tool-input.json" label="Tool call input" /></section><section><small>Retained result</small><ArtifactCodeView mode="source" content={tool.output} sourceHint={tool.resource ?? "tool-result.txt"} label="Retained tool result" /></section>{tool.resource && <footer><FileText size={12} /><code>{tool.resource}</code></footer>}</div>;
}

function DiffCell({ event }: { event: DebuggerEvent }): React.JSX.Element {
  const diff = event.diff!;
  return <section className="diff-cell"><div className="diff-toolbar"><span><GitDiff size={13} /><code>{diff.path}</code></span><span className="diff-stats">+{event.fileChanges?.[0]?.additions ?? 0} <i>−{event.fileChanges?.[0]?.deletions ?? 0}</i></span></div><ArtifactCodeView mode="diff" diff={diff} label={`Session patch: ${diff.path}`} /></section>;
}

function ValidationCell({ event }: { event: DebuggerEvent }): React.JSX.Element {
  const validation = event.validation!;
  const StatusIcon = validation.status === "passed" ? CheckCircle : XCircle;
  return <section className={`validation-cell ${validation.status}`}><header><span><StatusIcon size={15} weight="fill" /><strong>{validation.command}</strong></span><time>{validation.duration}</time></header><p>{validation.summary}</p><ul>{validation.output.map((line) => <li key={line}>{line}</li>)}</ul></section>;
}

function StateInspector(props: { session: DebuggerSession; cursor: DebuggerCursor; activeTab: InspectorTab; artifactEndpoint?: string; onTab: (tab: InspectorTab) => void; onPrevious: () => void }): React.JSX.Element {
  const event = eventForCursor(props.session, props.cursor);
  const previous = priorStopEvent(props.session, props.cursor);
  const tablist = useRovingTablist({ ids: INSPECTOR_TABS.map((tab) => tab.id), active: props.activeTab, onSelect: props.onTab, panelId: "state-inspector-panel" });
  return <aside className="state-inspector" aria-label="State Inspector">
    <header><div><small>State Inspector</small><strong>{event.phase} · {event.timestamp}</strong></div><span>{props.cursor.toolCallId ? "Tool Call Cursor" : "Evidence Cursor"}</span></header>
    <nav className="inspector-tabs" aria-label="State Inspector views" {...tablist.tablistProps}>{INSPECTOR_TABS.map((tab) => { const TabIcon = tab.icon; return <button key={tab.id} type="button" {...tablist.getTabProps(tab.id)} onClick={() => props.onTab(tab.id)}><TabIcon size={14} /><span>{tab.label}</span></button>; })}</nav>
    <div className="inspector-scroll" id="state-inspector-panel" role="tabpanel"><div className="inspector-comparison"><strong>{INSPECTOR_TABS.find((tab) => tab.id === props.activeTab)?.label} at {event.timestamp}</strong><span>Compared with {previous?.timestamp ?? "session start"}</span></div><InspectorContent session={props.session} tab={props.activeTab} cursor={props.cursor} artifactEndpoint={props.artifactEndpoint} /></div>
    <footer><button type="button" onClick={props.onPrevious}><ClockCounterClockwise size={13} />Previous State</button><button type="button"><Clock size={13} />View History</button></footer>
  </aside>;
}

function InspectorContent({ session, tab, cursor, artifactEndpoint }: { session: DebuggerSession; tab: InspectorTab; cursor: DebuggerCursor; artifactEndpoint?: string }): React.JSX.Element {
  const event = eventForCursor(session, cursor);
  const tool = toolForCursor(session, cursor);
  const cumulative = cumulativeFileChanges(session, cursor);
  if (tab === "changes") return <ChangesInspector event={event} cumulative={cumulative} />;
  if (tab === "files") return <FilesInspector session={session} files={cumulative} />;
  if (tab === "artifacts") return <ArtifactsInspector endpoint={artifactEndpoint} />;
  if (tab === "tests") return <TestsInspector session={session} event={event} />;
  if (tab === "terminal") return <TerminalInspector event={event} />;
  if (tab === "plan") return <PlanInspector event={event} />;
  if (tab === "evidence") return <EvidenceInspector event={event} />;
  const rawAcp = tool === undefined ? event.rawAcp : { ...event.rawAcp, toolCallId: tool.id, payload: { name: tool.name, input: tool.input, retainedResult: tool.output } };
  return <section className="raw-acp"><dl><div><dt>Direction</dt><dd>{rawAcp.direction}</dd></div><div><dt>Method</dt><dd>{rawAcp.method}</dd></div><div><dt>RPC ID</dt><dd>{rawAcp.rpcId}</dd></div><div><dt>Session ID</dt><dd>{rawAcp.sessionId}</dd></div>{rawAcp.toolCallId && <div><dt>Tool Call ID</dt><dd>{rawAcp.toolCallId}</dd></div>}<div><dt>Trace Context</dt><dd>{rawAcp.traceContext}</dd></div></dl><ArtifactCodeView mode="source" content={JSON.stringify({ jsonrpc: "2.0", id: rawAcp.rpcId, method: rawAcp.method, params: rawAcp.payload }, null, 2)} sourceHint="event.json" label="Raw ACP JSON" /></section>;
}

function ChangesInspector({ event, cumulative }: { event: DebuggerEvent; cumulative: DebuggerFileChange[] }): React.JSX.Element {
  const changes = event.fileChanges ?? [];
  return <>
    <InspectorSection title="Changed since previous stop" count={changes.length}>{changes.length === 0 ? <p className="inspector-empty">No file delta at this cursor.</p> : <FileRows files={changes} />}</InspectorSection>
    <InspectorSection title="Git working tree"><dl className="fact-list"><div><dt>Status</dt><dd>{cumulative.length} modified</dd></div><div><dt>Base commit</dt><dd><code>a1b2c3d</code></dd></div><div><dt>HEAD</dt><dd><code>a1b2c3d</code></dd></div><div><dt>Workspace mutation</dt><dd>Not performed by cursor</dd></div></dl></InspectorSection>
    <InspectorSection title="State boundary"><ul className="checkpoint-boundary"><li className="available"><CheckCircle size={13} weight="fill" /><span><strong>Evidence Cursor</strong><small>Available · read-only</small></span></li><li className="available"><CheckCircle size={13} weight="fill" /><span><strong>Conversation checkpoint</strong><small>Retained prompt and response</small></span></li><li><WarningCircle size={13} weight="fill" /><span><strong>Workspace checkpoint</strong><small>Not retained · Restore unavailable</small></span></li><li><WarningCircle size={13} weight="fill" /><span><strong>Runtime checkpoint</strong><small>Not retained · Fork unavailable</small></span></li></ul></InspectorSection>
    <InspectorSection title="Usage"><dl className="fact-list"><div><dt>Token usage</dt><dd>Not retained</dd></div><div><dt>Context window</dt><dd>Not retained</dd></div><div><dt>Artifact revision</dt><dd>Sample r4</dd></div></dl></InspectorSection>
  </>;
}

function FilesInspector({ session, files }: { session: DebuggerSession; files: DebuggerFileChange[] }): React.JSX.Element {
  const resources = session.events.flatMap((event) => event.toolCalls ?? []).flatMap((tool) => tool.resource === undefined ? [] : [tool.resource]);
  return <><InspectorSection title="Observed files" count={files.length}>{files.length > 0 ? <FileRows files={files} /> : <p className="inspector-empty">No modified file observed before this cursor.</p>}</InspectorSection><InspectorSection title="Exploration ledger" count={resources.length}>{resources.length === 0 ? <p className="inspector-empty">No retained file resources in this session.</p> : <ul className="simple-rows">{resources.map((file, index) => <li key={`${file}:${index}`}><FileText size={13} /><code>{file}</code><span>Retained</span></li>)}</ul>}</InspectorSection></>;
}

function ArtifactsInspector({ endpoint }: { endpoint?: string }): React.JSX.Element {
  const [artifacts, setArtifacts] = useState<ArtifactDescriptor[]>();
  const [failure, setFailure] = useState<string>();
  useEffect(() => {
    if (endpoint === undefined) return;
    const controller = new AbortController();
    void fetch(endpoint, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(`Artifact catalog failed (${response.status}).`);
      const payload: unknown = await response.json();
      if (!isArtifactCatalogResponse(payload)) throw new Error("Artifact catalog contract is unsupported.");
      setArtifacts(payload.artifacts);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setFailure(error instanceof Error ? error.message : String(error));
    });
    return () => controller.abort();
  }, [endpoint]);
  if (endpoint === undefined) return <InspectorSection title="Retained artifacts"><p className="inspector-empty">No artifact directory is configured for this Studio run.</p></InspectorSection>;
  if (failure !== undefined) return <InspectorSection title="Retained artifacts"><p className="inspector-empty">{failure}</p></InspectorSection>;
  if (artifacts === undefined) return <InspectorSection title="Retained artifacts"><p className="inspector-empty">Loading artifact catalog…</p></InspectorSection>;
  return <><InspectorSection title="Retained artifacts" count={artifacts.length}>{artifacts.length === 0 ? <p className="inspector-empty">The configured artifact directory is empty.</p> : <ul className="simple-rows">{artifacts.map((artifact) => <li key={artifact.id}><FileText size={13} /><span>{artifact.label}</span><em>{artifact.renderer.label}</em></li>)}</ul>}</InspectorSection><InspectorSection title="Boundary"><p className="inspector-note">These rows come from the configured read-only artifact catalog. They are not a restorable workspace snapshot.</p></InspectorSection></>;
}

function TestsInspector({ session, event }: { session: DebuggerSession; event: DebuggerEvent }): React.JSX.Element {
  const validations = session.events.filter((candidate) => candidate.validation !== undefined);
  return <InspectorSection title="Validation history" count={validations.length}>{validations.length === 0 ? <p className="inspector-empty">No retained validation event in this session.</p> : <ul className="test-history">{validations.map((candidate) => { const validation = candidate.validation!; const StatusIcon = validation.status === "passed" ? CheckCircle : XCircle; return <li key={candidate.id} className={`${event.id === candidate.id ? "selected " : ""}${validation.status}`}><StatusIcon size={14} weight="fill" /><span><strong>{validation.command}</strong><small>{validation.summary}</small></span><time>{validation.duration}</time></li>; })}</ul>}</InspectorSection>;
}

function TerminalInspector({ event }: { event: DebuggerEvent }): React.JSX.Element {
  if (event.validation === undefined) return <InspectorSection title="Terminal"><p className="inspector-empty">No terminal result is linked to this cursor.</p></InspectorSection>;
  return <InspectorSection title="Terminal"><div className={`terminal-card ${event.validation.status}`}><header><TerminalWindow size={13} /><code>{event.validation.command}</code><span>{event.validation.duration}</span></header><ArtifactCodeView mode="source" content={event.validation.output.join("\n")} sourceHint="terminal.txt" label="Terminal output" /></div></InspectorSection>;
}

function PlanInspector({ event }: { event: DebuggerEvent }): React.JSX.Element {
  const phaseIndex = { prompt: 0, plan: 1, explore: 2, change: 3, verify: 4, response: 5 }[event.kind];
  return <InspectorSection title="Plan · revision 1"><ol className="plan-progress">{PLAN_ITEMS.map((item, index) => <li key={item} className={index < phaseIndex ? "done" : index === phaseIndex ? "current" : ""}><span>{index < phaseIndex ? <CheckCircle size={13} weight="fill" /> : index + 1}</span><p>{item}</p></li>)}</ol></InspectorSection>;
}

function EvidenceInspector({ event }: { event: DebuggerEvent }): React.JSX.Element {
  return <InspectorSection title="Evidence links" count={event.evidence.length}><ul className="evidence-links">{event.evidence.map((link) => <li key={`${link.level}:${link.label}`}><EvidenceBadge level={link.level} /><span><strong>{link.label}</strong><small>{link.detail}</small></span></li>)}</ul><p className="inspector-note">Exact is retained protocol evidence. Correlated shares an observed id, path, or order. Inferred is a labeled UI projection.</p></InspectorSection>;
}

function EvidenceBadge({ level }: { level: EvidenceLevel }): React.JSX.Element {
  return <em className={`evidence-badge ${level.toLowerCase()}`}>{level}</em>;
}

function InspectorSection({ title, count, children }: { title: string; count?: number; children: ReactNode }): React.JSX.Element {
  return <section className="inspector-section"><header><strong>{title}</strong>{count !== undefined && <span>{count}</span>}</header>{children}</section>;
}

function FileRows({ files }: { files: DebuggerFileChange[] }): React.JSX.Element {
  return <ul className="file-rows">{files.map((file) => <li key={file.path}><FileText size={13} /><code title={file.path}>{file.path}</code><span>+{file.additions}</span><em>−{file.deletions}</em><CaretRight size={11} /></li>)}</ul>;
}

function TimelineMinimap(props: { session: DebuggerSession; cursor: DebuggerCursor; onSelect: (cursor: DebuggerCursor) => void }): React.JSX.Element {
  const selectedIndex = props.session.events.findIndex((event) => event.id === props.cursor.eventId);
  return <footer className="timeline-minimap" aria-label="Session Timeline Minimap"><div className="timeline-range"><span>{props.session.startedAt}</span><strong>Semantic timeline · call sequence</strong><span>{props.session.finishedAt}</span></div><div className="timeline-track">{props.session.events.map((event) => <button key={event.id} type="button" className={`timeline-segment kind-${event.kind}${event.id === props.cursor.eventId ? " selected" : ""}`} aria-label={`${event.phase}: ${event.title}`} aria-current={event.id === props.cursor.eventId ? "true" : undefined} onClick={() => props.onSelect({ eventId: event.id })}><span>{event.phase}</span></button>)}</div><div className="timeline-footer"><div className="timeline-legend">{(["prompt", "plan", "explore", "change", "verify", "response"] as DebuggerEventKind[]).map((kind) => <span key={kind}><i className={`kind-${kind}`} />{kind}</span>)}</div><div><span>Cursor {selectedIndex + 1} / {props.session.events.length}</span><strong>Read-only history</strong></div></div></footer>;
}

function LiveExecutionTree({ state, prompt }: { state: AguiRunState; prompt: string }): React.JSX.Element {
  return <aside className="execution-tree live-tree" aria-label="Execution Tree"><header><div><small>Execution Tree</small><strong>Live observations</strong></div><span>{state.timelineKeys.length} events</span></header><div className="execution-tree-scroll"><TreeRow nodeId="live-session" label="Session" detail={state.runId ?? "starting"} icon={Database} selected={false} depth={0} expandable expanded onSelect={() => undefined} /><TreeRow nodeId="live-turn" label="Turn 1" detail={prompt} icon={GitBranch} selected={false} depth={1} expandable expanded onSelect={() => undefined} /><TreeRow nodeId="live-prompt" label="Prompt" detail={prompt} icon={UserCircle} selected={false} depth={2} onSelect={() => undefined} /><TreeRow nodeId="live-tools" label="Explore / Change / Verify" detail={`${state.toolCallCount} tool calls`} icon={Wrench} selected={false} depth={2} status={state.status} onSelect={() => undefined} /></div></aside>;
}

function LiveNotebook({ state, prompt, groups }: { state: AguiRunState; prompt: string; groups: LiveTimelineGroup[] }): React.JSX.Element {
  return <main className="session-notebook live-notebook" aria-label="Live Session Notebook"><header className="notebook-viewbar"><nav><button type="button" className="active"><ClipboardText size={13} />Live notebook</button></nav><span>{state.toolCallCount} tool call{state.toolCallCount === 1 ? "" : "s"}</span></header><div className="session-notebook-scroll"><article className="debugger-event event-prompt"><div className="event-rail"><span><UserCircle size={13} /></span></div><div className="debugger-event-card"><header><div><strong>User request</strong></div><span>Prompt</span></header><section className="prompt-cell"><p>{prompt}</p></section></div></article><section className="live-session-stage"><p className="status-line run-status"><span className={`status-dot status-${state.status}`} aria-hidden="true" />status: <strong>{state.status}</strong>{state.runId ? <span> · run {state.runId}</span> : null}</p>{state.warnings.map((warning, index) => <p className="warning" key={index}><WarningCircle size={14} />{warning}</p>)}{state.error ? <p className="error"><XCircle size={14} />{state.error}</p> : null}<section className="activity-panel" aria-label="Live agent activity"><header className="activity-panel-head"><div><small>Semantic stages</small><h2>Agent activity</h2></div><span>{state.toolCallCount} tool call{state.toolCallCount === 1 ? "" : "s"} · {groups.length} groups</span></header><VirtualLiveTimeline groups={groups} followLatest={state.status === "running"} /></section>{state.result !== undefined ? <details className="live-run-result"><summary>Run result</summary><pre>{JSON.stringify(state.result, null, 2)}</pre></details> : null}</section></div></main>;
}

function VirtualLiveTimeline(props: { groups: LiveTimelineGroup[]; followLatest: boolean }): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: props.groups.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => props.groups[index]?.key ?? index,
    estimateSize: () => 72,
    overscan: 5,
    initialRect: { width: 720, height: 520 },
    useFlushSync: false,
  });
  useEffect(() => {
    if (props.followLatest && props.groups.length > 0) virtualizer.scrollToIndex(props.groups.length - 1, { align: "end" });
  }, [props.followLatest, props.groups.length, virtualizer]);
  if (props.groups.length === 0) return <p className="activity-empty">Waiting for the first retained message or tool call…</p>;
  return <div className="timeline virtual-live-timeline" ref={scrollRef}><div className="virtual-live-spacer" style={{ height: virtualizer.getTotalSize() }}>{virtualizer.getVirtualItems().map((virtualItem) => { const group = props.groups[virtualItem.index]!; return <div className="virtual-live-row" data-index={virtualItem.index} key={group.key} ref={virtualizer.measureElement} style={{ transform: `translateY(${virtualItem.start}px)` }}><LiveGroupEntry group={group} /></div>; })}</div></div>;
}

function LiveGroupEntry({ group }: { group: LiveTimelineGroup }): React.JSX.Element {
  const first = group.items[0]!;
  if (group.items.length === 1) return <TimelineEntry item={first} />;
  const tool = first as ToolCallTimelineItem;
  return <details className={`live-tool-group kind-${group.kind}`}><summary><span>{group.kind}</span><strong>{tool.name} ×{group.items.length}</strong><em>Tool Group</em></summary><div>{group.items.map((item) => <ToolCallEntry item={item as ToolCallTimelineItem} key={item.id} />)}</div></details>;
}

function LiveInspector({ state, runtime, onPermission }: { state: AguiRunState; runtime: LiveRuntime; onPermission: (requestId: string, optionId: string) => Promise<void> }): React.JSX.Element {
  const status = liveRunStatusLabel(state);
  return <aside className="state-inspector live-inspector" aria-label="State Inspector"><header><div><small>State Inspector</small><strong>Live observation</strong></div><span>{status}</span></header><div className="inspector-scroll"><InspectorSection title="Runtime boundary"><ul className="checkpoint-boundary"><li className="available"><CheckCircle size={13} weight="fill" /><span><strong>Event stream</strong><small>{status}</small></span></li><li className={state.pendingPermission === undefined ? "" : "available"}>{state.pendingPermission === undefined ? <WarningCircle size={13} weight="fill" /> : <CheckCircle size={13} weight="fill" />}<span><strong>Permission</strong><small>{state.pendingPermission === undefined ? "No request" : "Action required"}</small></span></li></ul></InspectorSection>{state.pendingPermission !== undefined ? <InspectorSection title="ACP permission"><div className="acp-permission"><strong>{state.pendingPermission.title}</strong><small>Tool call {state.pendingPermission.toolCallId}</small><div>{state.pendingPermission.options.map((option) => <button type="button" key={option.optionId} onClick={() => void onPermission(state.pendingPermission!.requestId, option.optionId)}>{option.name}<span>{option.kind}</span></button>)}</div></div></InspectorSection> : null}<InspectorSection title="Observed state"><dl className="fact-list"><div><dt>Run ID</dt><dd>{state.runId ?? "Pending"}</dd></div><div><dt>Thread ID</dt><dd>{state.threadId ?? "Pending"}</dd></div><div><dt>Tool calls</dt><dd>{state.toolCallCount}</dd></div><div><dt>Warnings</dt><dd>{state.warnings.length}</dd></div>{runtime === "acp" ? <div><dt>ACP frames</dt><dd>{state.protocolEvents.length}</dd></div> : null}</dl></InspectorSection>{runtime === "acp" ? <><InspectorSection title="Raw ACP"><div className="acp-protocol-list">{state.protocolEvents.length === 0 ? <p className="inspector-note">Waiting for ACP protocol frames.</p> : state.protocolEvents.slice(-12).map((event, index) => <details key={`${event.direction}:${event.rpcId ?? index}:${index}`}><summary><span>{event.direction}</span><strong>{event.method}</strong></summary><pre>{JSON.stringify(event.payload, null, 2)}</pre></details>)}</div></InspectorSection><InspectorSection title="Protocol boundary"><p className="inspector-note">ACP frames are redacted, bounded evidence from the server-owned connection. Cancel requests the Agent to stop the active Session.</p></InspectorSection></> : null}</div></aside>;
}

function LiveTimeline({ state, bins, eventCount }: { state: AguiRunState; bins: TimelineBin<DebuggerEventKind>[]; eventCount: number }): React.JSX.Element {
  return <footer className="timeline-minimap live-minimap"><div className="timeline-range"><span>Live</span><strong>Live activity timeline</strong><span>{liveRunStatusLabel(state)}</span></div><div className="timeline-track">{bins.length === 0 ? <span className="live-track-empty">Waiting for events</span> : bins.map((bin) => <span key={bin.index} className={`timeline-segment kind-${bin.kind}`} title={`${bin.count} events`} />)}</div><div className="timeline-footer"><strong>{eventCount} retained events</strong></div></footer>;
}

function liveRunStatusLabel(state: AguiRunState): string {
  if (state.pendingPermission !== undefined) return "Permission required";
  if (state.status === "running") return "Running";
  if (state.status === "finished") return "Finished";
  if (state.status === "error") return "Failed";
  return "Ready";
}

function liveObservationCopy(state: AguiRunState): { title: string; detail: string } {
  if (state.pendingPermission !== undefined) return { title: "Permission required", detail: "Choose an option in the State Inspector to continue." };
  if (state.status === "running") return { title: "Live run in progress", detail: "Following messages, tool calls, and server events." };
  if (state.status === "finished") return { title: "Run finished", detail: "Review the completed messages and tool calls. Saved runs appear after retention succeeds." };
  if (state.status === "error") return { title: "Run failed", detail: "Review the visible error and retained events before retrying." };
  return { title: "Ready for a live run", detail: "Start a run to observe messages and tool calls." };
}
