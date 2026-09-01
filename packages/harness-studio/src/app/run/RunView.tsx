import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
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
import {
  HARNESS_RUN_REQUEST_KIND,
  parseHarnessRunStreamEventV1,
  type HarnessRunStreamEventV1,
} from "@qoder-ai/harness/protocol";
import { useVirtualizer } from "@tanstack/react-virtual";
import { applyHarnessRunEvent, initialRunState, timelineItems, type HarnessRunState, type TimelineItem } from "./run-store.js";
import { ArtifactCodeView } from "../code/ArtifactCodeView.js";
import { studioLocale } from "../i18n/index.js";
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

/** Post one Harness run and fold its native event stream into state updates. */
async function streamRun(
  endpoint: string,
  prompt: string,
  threadId: string,
  runId: string,
  project: { id: string; label: string; revision: number } | undefined,
  onEvents: (events: HarnessRunStreamEventV1[]) => void,
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
      kind: HARNESS_RUN_REQUEST_KIND,
      threadId,
      runId,
      prompt,
    }),
  });
  if (!response.ok || response.body === null) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Run request failed (${response.status}): ${detail}`);
  }
  let pendingEvents: HarnessRunStreamEventV1[] = [];
  let frame: number | undefined;
  const flush = (): void => {
    frame = undefined;
    const events = pendingEvents;
    pendingEvents = [];
    if (events.length > 0) onEvents(events);
  };
  const apply = (event: HarnessRunStreamEventV1): void => {
    pendingEvents.push(event);
    frame ??= globalThis.requestAnimationFrame(flush);
  };
  const parser = createSseParser<unknown>((event) => apply(parseHarnessRunStreamEventV1(event)));
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

const INSPECTOR_TABS: Array<{ id: InspectorTab; icon: Icon }> = [
  { id: "changes", icon: GitDiff },
  { id: "files", icon: FolderOpen },
  { id: "artifacts", icon: SquaresFour },
  { id: "tests", icon: Flask },
  { id: "terminal", icon: TerminalWindow },
  { id: "plan", icon: ClipboardText },
  { id: "evidence", icon: LinkSimple },
  { id: "raw", icon: BracketsCurly },
];

const PLAN_ITEMS = [
  "Inspect current workbench structure and related UI components",
  "Analyze Jupyter-style session notebook patterns",
  "Redesign Session Detail with a notebook metaphor",
  "Implement Harness Studio UI improvements",
  "Update timeline and event visualization",
];

const MessageEntry = memo(function MessageEntry({ item }: { item: MessageTimelineItem }): React.JSX.Element {
  const { t } = useTranslation("run");
  return <div className="entry message"><span className="entry-tag">{t("assistant")}</span><pre>{item.text}{item.complete ? "" : " ▌"}</pre></div>;
});

const ToolCallEntry = memo(function ToolCallEntry({ item }: { item: ToolCallTimelineItem }): React.JSX.Element {
  const { t } = useTranslation("run");
  const [expanded, setExpanded] = useState(false);
  const argumentsView = useMemo(() => describeToolPayload(item.argsText, t("entry.noArguments")), [item.argsText]);
  const resultView = useMemo(
    () => item.resultText === undefined ? undefined : describeToolPayload(item.resultText, t("entry.emptyResult")),
    [item.resultText],
  );
  return <details className={`tool-card status-${item.status}`} onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary>
      <span className="tool-icon" aria-hidden="true"><Wrench size={15} weight="bold" /></span>
      <span className="tool-title"><small>{t("toolCall")}</small><strong>{item.name}</strong><code>{argumentsView.summary}</code></span>
      <span className="tool-status" aria-live="polite">{toolStatusLabel(item.status, t)}</span>
      <CaretDown className="tool-chevron" size={14} aria-hidden="true" />
    </summary>
    {expanded && <div className="tool-detail">
      <section><h4>{t("entry.arguments")}</h4><ArtifactCodeView mode="source" content={argumentsView.formatted} sourceHint={argumentsView.structured ? "tool-input.json" : "tool-input.txt"} className={argumentsView.structured ? "structured" : ""} label={t("entry.argumentsLabel")} /></section>
      <section><h4>{t("entry.result")}</h4>{resultView ? <>{item.resultTruncated ? <p className="tool-notice">{item.resultOriginalBytes === undefined ? t("entry.resultTruncated") : t("entry.resultTruncatedFrom", { bytes: item.resultOriginalBytes.toLocaleString(studioLocale()) })}</p> : null}<ArtifactCodeView mode="source" content={resultView.formatted} sourceHint={resultView.structured ? "tool-result.json" : "tool-result.txt"} className={resultView.structured ? "structured" : ""} label={t("entry.resultLabel")} /></> : <p className="tool-empty">{item.status === "running" || item.status === "preparing" ? t("entry.waitingForResult") : item.status === "result-unavailable" ? t("entry.noRetainedResult") : t("entry.noResultPayload")}</p>}</section>
      <footer><span>{t("entry.callId")}</span><code title={item.id}>{item.id}</code></footer>
    </div>}
  </details>;
});

const TimelineEntry = memo(function TimelineEntry({ item }: { item: TimelineItem }): React.JSX.Element {
  return item.kind === "message" ? <MessageEntry item={item} /> : <ToolCallEntry item={item} />;
});

function toolStatusLabel(status: ToolCallTimelineItem["status"], t: (key: string) => string): string {
  switch (status) {
    case "preparing": return t("toolStatus.preparing");
    case "running": return t("toolStatus.running");
    case "completed": return t("toolStatus.completed");
    case "failed": return t("toolStatus.failed");
    case "result-unavailable": return t("toolStatus.resultUnavailable");
    case "interrupted": return t("toolStatus.interrupted");
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

function stopConditionLabel(enabled: StopConditionState, t: (key: string, options?: Record<string, unknown>) => string): string {
  const count = STOP_CONDITIONS.filter((condition) => enabled[condition]).length;
  return t("stopConditions", { count, total: STOP_CONDITIONS.length });
}

export function RunView({
  runEndpoint,
  acpEndpoint,
  acpAgentLabel,
  artifactEndpoint,
  harnessLabel,
  navigation,
  initialMode = "live",
  project,
}: {
  runEndpoint: string;
  acpEndpoint?: string;
  acpAgentLabel?: string;
  artifactEndpoint?: string;
  harnessLabel?: string;
  navigation?: ReactNode;
  initialMode?: SurfaceMode;
  project?: { id: string; label: string; revision: number };
}): React.JSX.Element {
  const { t } = useTranslation("run");
  const agentLabel = acpAgentLabel ?? t("acpAgent");
  const harnessName = harnessLabel ?? t("liveTrial");
  const [surfaceMode, setSurfaceMode] = useState<SurfaceMode>(initialMode);
  const [prompt, setPrompt] = useState("");
  const [runtime, setRuntime] = useState<LiveRuntime>("qoder");
  const [activeRuntime, setActiveRuntime] = useState<LiveRuntime>("qoder");
  const [submittedPrompt, setSubmittedPrompt] = useState("");
  const [runProject, setRunProject] = useState(project);
  const [state, setState] = useState<HarnessRunState>(initialRunState);
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
  const liveStateRef = useRef<HarnessRunState>(initialRunState());

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
    const endpoint = selectedRuntime === "acp" ? acpEndpoint! : runEndpoint;
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
    const fresh: HarnessRunState = { ...initialRunState(), status: "running" };
    liveStateRef.current = fresh;
    setState(fresh);
    try {
      await streamRun(endpoint, promptText, threadId, runId, project, (events) => {
        // Fold outside any React updater: the run store mutates its keyed map
        // for O(1) deltas and sequence ids reject duplicate frames.
        liveStateRef.current = events.reduce(applyHarnessRunEvent, liveStateRef.current);
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
  }, [acpEndpoint, project, prompt, refreshRuns, runEndpoint, runtime]);

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
  const sessionName = live ? (viewPrompt || t("newHarnessRun")) : retainedSession.name;
  const connectionState = live ? viewState.status : retainedSession.connection;
const ranWithProject = submittedPrompt === "" ? project : runProject;
  const runMode = saved ? t("mode.savedRun") : live ? t("mode.liveWithStatus", { status: liveRunStatusLabel(viewState, t) }) : retainedSession.mode;
  const liveObservation = liveObservationCopy(viewState, t);

  return <section className={`debugger-shell${treeCollapsed ? " tree-collapsed" : ""}${inspectorCollapsed ? " inspector-collapsed" : ""}`}>
    <header className="debugger-topbar">
      <div className="debugger-brand"><span className="debugger-mark"><BugBeetle size={18} weight="fill" /></span><strong>{live ? t("title.liveRun") : t("labels.inspector")}</strong><span title={ranWithProject === undefined ? undefined : t("projectMeta", { label: ranWithProject.label, revision: ranWithProject.revision })}>{live ? `${harnessName}${ranWithProject === undefined ? "" : ` · ${ranWithProject.label}`}` : saved ? t("mode.retainedDebugger") : t("mode.demoDebugger")}</span></div>
      <div className="debugger-session-meta"><span>{t("labels.session")}</span><strong title={sessionName}>{sessionName}</strong><em className={live ? "live" : "recorded"}>{runMode}</em></div>
      <div className="debugger-runtime-meta"><span className={`connection-dot status-${connectionState}`} /><strong>{connectionState}</strong><i /><span>{t("labels.agent")}</span><strong>{live ? activeRuntime === "acp" ? agentLabel : t("localHarness") : retainedSession.agent}</strong><i /><span>{t("labels.protocol")}</span><strong>{live ? activeRuntime === "acp" ? t("acpStream") : t("harnessStream") : retainedSession.protocol}</strong></div>
      <div className="debugger-top-actions">{navigation}{live && activeRuntime === "acp" && state.status === "running" ? <button type="button" className="cancel-live-run" onClick={() => void cancelLiveRun()}><XCircle size={15} />{t("cancelRun")}</button> : null}<div className="saved-runs"><button type="button" onClick={() => { setRunsPanelOpen((value) => !value); void refreshRuns(); }} aria-expanded={runsPanelOpen} aria-haspopup="true"><ClockCounterClockwise size={15} /><span>{t("savedRuns")}{savedRuns.length > 0 ? ` (${savedRuns.length})` : ""}</span></button>{runsPanelOpen && <div className="saved-runs-panel" role="menu" aria-label={t("savedRuns")}>{saved && <button type="button" role="menuitem" className="saved-runs-live" onClick={() => { setSavedRun(null); setRetainedSession(SAMPLE_DEBUGGER_SESSION); setSurfaceMode("live"); setRunsPanelOpen(false); }}>{t("backToLive")}</button>}{savedRuns.length === 0 ? <p className="saved-runs-empty">{t("noSavedRuns")}</p> : savedRuns.map((run) => <button type="button" role="menuitem" key={run.id} className={savedRun?.id === run.id ? "selected" : ""} onClick={() => void openSavedRun(run.id)}><strong title={run.prompt}>{run.prompt}</strong><span><em className={`run-badge status-${run.status}`}>{run.status}</em>{t("savedRunMeta", { count: run.toolCallCount, time: run.savedAt.slice(0, 19).replace("T", " ") })}</span></button>)}</div>}</div><button type="button" onClick={() => setTreeCollapsed((value) => !value)} aria-pressed={!treeCollapsed} title={t("toggleTree")}><TreeStructure size={15} /></button><button type="button" onClick={() => setInspectorCollapsed((value) => !value)} aria-pressed={!inspectorCollapsed} title={t("toggleInspector")}><SidebarSimple size={15} /></button><button type="button" className="new-run" onClick={() => setComposerOpen(true)}><Plus size={14} weight="bold" />{t("newLiveRun")}</button></div>
    </header>

    {!live ? <nav className="debugger-toolbar" aria-label={t("controlsAria")}>
      <div className="step-controls">
        <ControlButton label={t("controls.previousStop")} icon={CaretLeft} onClick={() => selectCursor(nextStopCursor(retainedSession, cursor, stopConditions, -1))} />
        <ControlButton label={t("controls.continue")} icon={Play} primary onClick={() => selectCursor(nextStopCursor(retainedSession, cursor, stopConditions))} />
        <ControlButton label={t("controls.nextStop")} icon={SkipForward} onClick={() => selectCursor(nextStopCursor(retainedSession, cursor, stopConditions))} />
        <span className="toolbar-divider" />
        <ControlButton label={t("controls.stepInto")} icon={ArrowBendDownRight} disabled={selectedEvent.toolCalls === undefined} onClick={() => selectCursor(stepIntoCursor(retainedSession, cursor))} />
        <ControlButton label={t("controls.stepOver")} icon={ArrowRight} onClick={() => selectCursor(stepOverCursor(retainedSession, cursor))} />
        <ControlButton label={t("controls.stepOut")} icon={ArrowBendUpLeft} disabled={cursor.toolCallId === undefined} onClick={() => selectCursor(stepOutCursor(cursor))} />
        <ControlButton label={t("controls.previousState")} icon={ClockCounterClockwise} onClick={() => selectCursor(previousStateCursor(retainedSession, cursor))} />
      </div>
<fieldset className="stop-conditions" aria-label={stopConditionLabel(stopConditions, t)}><legend>{t("stopOnLabel")}</legend>{STOP_CONDITIONS.map((condition) => <label key={condition}><input type="checkbox" checked={stopConditions[condition]} onChange={(event) => setStopConditions((previous) => ({ ...previous, [condition]: event.target.checked }))} /><span>{t(`stopOn.${condition}`)}</span></label>)}</fieldset>
      <div className="pause-boundary"><Pause size={13} weight="fill" /><span>{t("evidenceCursor")}</span></div>
    </nav> : <div className="live-observation-bar" role="status"><span><i className={`status-dot status-${viewState.status}`} aria-hidden="true" />{liveObservation.title}</span><strong>{liveObservation.detail}</strong></div>}

    <div className="debugger-grid">
      {live ? <LiveExecutionTree state={viewState} prompt={viewPrompt} /> : <ExecutionTree session={retainedSession} cursor={cursor} expanded={expandedNodes} onToggle={toggleExpanded} onSelect={selectNode} />}
      {live ? <LiveNotebook state={viewState} prompt={viewPrompt} groups={liveGroups} /> : <SessionNotebook session={retainedSession} cursor={cursor} expanded={expandedNodes} onSelect={selectCursor} onToggle={toggleExpanded} />}
      {live ? <LiveInspector state={viewState} runtime={activeRuntime} onPermission={decidePermission} /> : <StateInspector session={retainedSession} cursor={cursor} activeTab={inspectorTab} artifactEndpoint={artifactEndpoint} onTab={setInspectorTab} onPrevious={() => selectCursor(previousStateCursor(retainedSession, cursor))} />}
    </div>

    {live ? <LiveTimeline state={viewState} bins={liveBins} eventCount={liveTimeline.length} /> : <TimelineMinimap session={retainedSession} cursor={cursor} onSelect={selectCursor} />}

{composerOpen && <div className="live-composer-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setComposerOpen(false); }}><section className="live-composer" role="dialog" aria-modal="true" aria-labelledby="live-composer-title"><header><div><small>{harnessName}</small><h2 id="live-composer-title">{t("composer.title")}</h2></div><button type="button" onClick={() => setComposerOpen(false)} aria-label={t("composer.closeAria")}><XCircle size={19} /></button></header><p>{t("composer.detail", { context: project === undefined ? t("composer.configuredContext") : t("composer.projectContext", { label: project.label, revision: project.revision }) })}</p>{acpEndpoint !== undefined ? <label className="live-runtime-select"><span>{t("composer.runtime")}</span><select value={runtime} onChange={(event) => setRuntime(event.target.value as LiveRuntime)}><option value="qoder">{t("composer.qoderOption")}</option><option value="acp">{t("composer.acpOption", { agent: agentLabel })}</option></select></label> : null}<textarea value={prompt} placeholder={t("composer.promptPlaceholder")} onChange={(event) => setPrompt(event.target.value)} rows={5} autoFocus /><footer><button type="button" onClick={() => setComposerOpen(false)}>{t("composer.cancel")}</button><button type="button" className="primary" onClick={() => void start()} disabled={state.status === "running" || prompt.trim().length === 0}><Play size={14} weight="fill" />{t("composer.run")}</button></footer></section></div>}
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
  const { t } = useTranslation("run");
  const RowIcon = props.icon;
  return <div className={`execution-tree-row${props.selected ? " selected" : ""}`} style={{ "--tree-depth": props.depth } as React.CSSProperties}>
    {props.expandable ? <button type="button" className="tree-caret" aria-label={t(`tree.${props.expanded ? "collapse" : "expand"}`, { label: props.label })} aria-expanded={props.expanded} onClick={() => props.onToggle?.(props.nodeId)}>{props.expanded ? <CaretDown size={11} /> : <CaretRight size={11} />}</button> : <span className="tree-caret-spacer" />}
    <button type="button" className="tree-node" aria-current={props.selected ? "true" : undefined} onClick={() => props.onSelect(props.nodeId)}><RowIcon size={13} weight={props.selected ? "fill" : "regular"} /><span><strong>{props.label}</strong>{props.detail && <small>{props.detail}</small>}</span>{props.status && <em>{props.status}</em>}</button>
  </div>;
}

function ExecutionTree(props: { session: DebuggerSession; cursor: DebuggerCursor; expanded: Set<string>; onToggle: (id: string) => void; onSelect: (id: string) => void }): React.JSX.Element {
  const { t } = useTranslation("run");
  const selectedNode = cursorNodeId(props.cursor);
  const sessionOpen = props.expanded.has("session");
  const turnOpen = props.expanded.has("turn");
  return <aside className="execution-tree" aria-label={t("tree.title")}>
    <header><div><small>{t("tree.title")}</small><strong>{t("tree.observedStages")}</strong></div><span>{t("tree.eventCount", { count: props.session.events.length })}</span></header>
    <div className="execution-tree-scroll" role="tree">
      <TreeRow nodeId="session" label={t("tree.session")} detail={props.session.name} icon={Database} selected={false} depth={0} expandable expanded={sessionOpen} onSelect={() => props.onToggle("session")} onToggle={props.onToggle} />
      {sessionOpen && <div role="group">
        <TreeRow nodeId="turn" label={t("tree.turn", { turn: 1 })} detail={`${props.session.startedAt}–${props.session.finishedAt}`} icon={GitBranch} selected={false} depth={1} expandable expanded={turnOpen} onSelect={() => props.onToggle("turn")} onToggle={props.onToggle} />
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
    <footer><span><Eye size={12} />{t("tree.recordedEvidence")}</span></footer>
  </aside>;
}

function SessionNotebook(props: { session: DebuggerSession; cursor: DebuggerCursor; expanded: Set<string>; onSelect: (cursor: DebuggerCursor) => void; onToggle: (id: string) => void }): React.JSX.Element {
  const { t } = useTranslation("run");
  const [view, setView] = useState<"notebook" | "events" | "diff">("notebook");
  const tablist = useRovingTablist({ ids: ["notebook", "events", "diff"] as const, active: view, onSelect: setView, panelId: "session-notebook-panel" });
  return <main className="session-notebook" aria-label={t("notebook.aria")}>
    <header className="notebook-viewbar"><nav aria-label={t("notebook.viewsAria")} {...tablist.tablistProps}><button type="button" {...tablist.getTabProps("notebook")} className={view === "notebook" ? "active" : ""} onClick={() => setView("notebook")}><ClipboardText size={13} />{t("notebook.tabs.notebook")}</button><button type="button" {...tablist.getTabProps("events")} className={view === "events" ? "active" : ""} onClick={() => setView("events")}><Code size={13} />{t("notebook.tabs.events")} <span>{props.session.events.length}</span></button><button type="button" {...tablist.getTabProps("diff")} className={view === "diff" ? "active" : ""} onClick={() => setView("diff")}><GitDiff size={13} />{t("notebook.tabs.diff")}</button></nav><span>{t("notebook.turnRange", { start: props.session.startedAt, end: props.session.finishedAt })}</span></header>
    <div className="session-notebook-scroll" id="session-notebook-panel" role="tabpanel">
      {view === "notebook" && props.session.events.map((event) => <NotebookEvent key={event.id} event={event} cursor={props.cursor} expanded={props.expanded.has(event.id)} onSelect={props.onSelect} onToggle={props.onToggle} />)}
      {view === "events" && <EventsNotebookView session={props.session} cursor={props.cursor} onSelect={props.onSelect} />}
      {view === "diff" && <DiffNotebookView session={props.session} cursor={props.cursor} onSelect={props.onSelect} onToggle={props.onToggle} />}
    </div>
  </main>;
}

function EventsNotebookView(props: { session: DebuggerSession; cursor: DebuggerCursor; onSelect: (cursor: DebuggerCursor) => void }): React.JSX.Element {
  const { t } = useTranslation("run");
  return <section className="notebook-events-table" aria-label={t("events.aria")}><header><strong>{t("events.title")}</strong><span>{t("events.detail", { count: props.session.events.length })}</span></header><ol>{props.session.events.map((event, index) => <li key={event.id}><button type="button" className={props.cursor.eventId === event.id ? "selected" : ""} onClick={() => props.onSelect({ eventId: event.id })}><span>{String(index + 1).padStart(2, "0")}</span><time>{event.timestamp}</time><strong>{event.phase}</strong><code>{event.rawAcp.method}</code><em>{event.rawAcp.direction}</em></button></li>)}</ol></section>;
}

function DiffNotebookView(props: { session: DebuggerSession; cursor: DebuggerCursor; onSelect: (cursor: DebuggerCursor) => void; onToggle: (id: string) => void }): React.JSX.Element {
  const { t } = useTranslation("run");
  const changed = props.session.events.filter((event) => event.diff !== undefined);
  return <section className="notebook-diff-view"><header><strong>{t("diff.title")}</strong><span>{t("diff.detail", { count: changed.length })}</span></header>{changed.length === 0 ? <p className="inspector-empty">{t("diff.empty")}</p> : changed.map((event) => <NotebookEvent key={event.id} event={event} cursor={props.cursor} expanded={false} onSelect={props.onSelect} onToggle={props.onToggle} />)}</section>;
}

function NotebookEvent(props: { event: DebuggerEvent; cursor: DebuggerCursor; expanded: boolean; onSelect: (cursor: DebuggerCursor) => void; onToggle: (id: string) => void }): React.JSX.Element {
  const { t } = useTranslation("run");
  const selected = props.cursor.eventId === props.event.id;
  const EventIcon = EVENT_ICONS[props.event.kind];
  return <article className={`debugger-event event-${props.event.kind}${selected ? " selected" : ""}`} data-notebook-event={props.event.id}>
    <div className="event-rail"><span><EventIcon size={13} weight={selected ? "fill" : "regular"} /></span></div>
    <div className="debugger-event-card">
      <header><button type="button" className="event-card-select" onClick={() => props.onSelect({ eventId: props.event.id })}><time>{props.event.timestamp}</time><strong>{props.event.title}</strong>{props.event.validation && <em className={`event-status ${props.event.validation.status}`}>{props.event.validation.status}</em>}</button><span>{props.event.phase}{props.event.stopConditions.length > 0 && t("notebook.stopSuffix")}</span></header>
      <EventContent {...props} />
    </div>
  </article>;
}

function EventContent(props: { event: DebuggerEvent; cursor: DebuggerCursor; expanded: boolean; onSelect: (cursor: DebuggerCursor) => void; onToggle: (id: string) => void }): React.JSX.Element {
  const { t } = useTranslation("run");
  if (props.event.kind === "prompt") return <section className="prompt-cell"><small>{t("event.prompt")}</small><p>{props.event.summary}</p></section>;
  if (props.event.kind === "plan") return <section className="plan-cell"><small>{t("event.plan")}</small><ol>{PLAN_ITEMS.map((item) => <li key={item}>{item}</li>)}</ol><span>{t("event.planMeta")}</span></section>;
  if (props.event.kind === "explore") return <ExploreCell event={props.event} cursor={props.cursor} expanded={props.expanded} onSelect={props.onSelect} onToggle={props.onToggle} />;
  if (props.event.diff !== undefined) return <DiffCell event={props.event} />;
  if (props.event.validation !== undefined) return <ValidationCell event={props.event} />;
  return <section className="response-cell"><small>{t("event.finalResponse")}</small><p>{props.event.summary}</p><div><CheckCircle size={14} weight="fill" /><span>{t("event.evidenceNote")}</span></div></section>;
}

function ExploreCell(props: { event: DebuggerEvent; cursor: DebuggerCursor; expanded: boolean; onSelect: (cursor: DebuggerCursor) => void; onToggle: (id: string) => void }): React.JSX.Element {
  const { t } = useTranslation("run");
  const tools = props.event.toolCalls ?? [];
  return <section className="explore-cell" onClick={(event) => event.stopPropagation()}>
    <button type="button" className="execution-group-summary" aria-expanded={props.expanded} onClick={() => props.onToggle(props.event.id)}><span><CaretRight size={12} /><strong>{t("explore.executionGroup")}</strong><em>{t("explore.toolCalls", { count: 9 })}</em></span><small>Read files ×5 · Search repository ×3 · Inspect image ×1</small></button>
    <div className="execution-group-files"><span>{t("explore.filesRead")}</span><code>workbench.js</code><code>index.html</code><code>replay.js</code><code>experiment-trace-model.ts</code><code>App.tsx</code></div>
    {props.expanded && <ol className="explore-tool-list">{tools.map((tool, index) => <li key={tool.id}><button type="button" className={props.cursor.toolCallId === tool.id ? "selected" : ""} onClick={() => props.onSelect({ eventId: props.event.id, toolCallId: tool.id })}><span>{String(index + 1).padStart(2, "0")}</span><strong>{tool.name}</strong><code>{tool.summary}</code><em>{tool.duration}</em></button>{props.cursor.toolCallId === tool.id && <ToolCallDetail tool={tool} />}</li>)}</ol>}
  </section>;
}

function ToolCallDetail({ tool }: { tool: DebuggerToolCall }): React.JSX.Element {
  const { t } = useTranslation("run");
  return <div className="mock-tool-detail"><section><small>{t("toolDetail.input")}</small><ArtifactCodeView mode="source" content={tool.input} sourceHint="tool-input.json" label={t("toolDetail.inputLabel")} /></section><section><small>{t("toolDetail.retainedResult")}</small><ArtifactCodeView mode="source" content={tool.output} sourceHint={tool.resource ?? "tool-result.txt"} label={t("toolDetail.resultLabel")} /></section>{tool.resource && <footer><FileText size={12} /><code>{tool.resource}</code></footer>}</div>;
}

function DiffCell({ event }: { event: DebuggerEvent }): React.JSX.Element {
  const { t } = useTranslation("run");
  const diff = event.diff!;
  return <section className="diff-cell"><div className="diff-toolbar"><span><GitDiff size={13} /><code>{diff.path}</code></span><span className="diff-stats">+{event.fileChanges?.[0]?.additions ?? 0} <i>−{event.fileChanges?.[0]?.deletions ?? 0}</i></span></div><ArtifactCodeView mode="diff" diff={diff} label={t("diff.patchLabel", { path: diff.path })} /></section>;
}

function ValidationCell({ event }: { event: DebuggerEvent }): React.JSX.Element {
  const validation = event.validation!;
  const StatusIcon = validation.status === "passed" ? CheckCircle : XCircle;
  return <section className={`validation-cell ${validation.status}`}><header><span><StatusIcon size={15} weight="fill" /><strong>{validation.command}</strong></span><time>{validation.duration}</time></header><p>{validation.summary}</p><ul>{validation.output.map((line) => <li key={line}>{line}</li>)}</ul></section>;
}

function StateInspector(props: { session: DebuggerSession; cursor: DebuggerCursor; activeTab: InspectorTab; artifactEndpoint?: string; onTab: (tab: InspectorTab) => void; onPrevious: () => void }): React.JSX.Element {
  const { t } = useTranslation("run");
  const event = eventForCursor(props.session, props.cursor);
  const previous = priorStopEvent(props.session, props.cursor);
  const tablist = useRovingTablist({ ids: INSPECTOR_TABS.map((tab) => tab.id), active: props.activeTab, onSelect: props.onTab, panelId: "state-inspector-panel" });
  return <aside className="state-inspector" aria-label={t("inspector.stateAria")}>
    <header><div><small>{t("inspector.title")}</small><strong>{event.phase} · {event.timestamp}</strong></div><span>{props.cursor.toolCallId ? t("inspector.toolCallCursor") : t("inspector.evidenceCursor")}</span></header>
    <nav className="inspector-tabs" aria-label={t("inspector.viewsAria")} {...tablist.tablistProps}>{INSPECTOR_TABS.map((tab) => { const TabIcon = tab.icon; return <button key={tab.id} type="button" {...tablist.getTabProps(tab.id)} onClick={() => props.onTab(tab.id)}><TabIcon size={14} /><span>{t(`inspectorTabs.${tab.id}`)}</span></button>; })}</nav>
    <div className="inspector-scroll" id="state-inspector-panel" role="tabpanel"><div className="inspector-comparison"><strong>{t("inspector.tabAt", { label: t(`inspectorTabs.${props.activeTab}`), timestamp: event.timestamp })}</strong><span>{t("inspector.comparedWith", { when: previous?.timestamp ?? t("inspector.sessionStart") })}</span></div><InspectorContent session={props.session} tab={props.activeTab} cursor={props.cursor} artifactEndpoint={props.artifactEndpoint} /></div>
    <footer><button type="button" onClick={props.onPrevious}><ClockCounterClockwise size={13} />{t("controls.previousState")}</button><button type="button"><Clock size={13} />{t("inspector.viewHistory")}</button></footer>
  </aside>;
}

function InspectorContent({ session, tab, cursor, artifactEndpoint }: { session: DebuggerSession; tab: InspectorTab; cursor: DebuggerCursor; artifactEndpoint?: string }): React.JSX.Element {
  const { t } = useTranslation("run");
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
  return <section className="raw-acp"><dl><div><dt>{t("raw.direction")}</dt><dd>{rawAcp.direction}</dd></div><div><dt>{t("raw.method")}</dt><dd>{rawAcp.method}</dd></div><div><dt>{t("raw.rpcId")}</dt><dd>{rawAcp.rpcId}</dd></div><div><dt>{t("raw.sessionId")}</dt><dd>{rawAcp.sessionId}</dd></div>{rawAcp.toolCallId && <div><dt>{t("raw.toolCallId")}</dt><dd>{rawAcp.toolCallId}</dd></div>}<div><dt>{t("raw.traceContext")}</dt><dd>{rawAcp.traceContext}</dd></div></dl><ArtifactCodeView mode="source" content={JSON.stringify({ jsonrpc: "2.0", id: rawAcp.rpcId, method: rawAcp.method, params: rawAcp.payload }, null, 2)} sourceHint="event.json" label={t("raw.jsonLabel")} /></section>;
}

function ChangesInspector({ event, cumulative }: { event: DebuggerEvent; cumulative: DebuggerFileChange[] }): React.JSX.Element {
  const { t } = useTranslation("run");
  const changes = event.fileChanges ?? [];
  return <>
    <InspectorSection title={t("changes.sincePreviousStop")} count={changes.length}>{changes.length === 0 ? <p className="inspector-empty">{t("changes.noDelta")}</p> : <FileRows files={changes} />}</InspectorSection>
    <InspectorSection title={t("changes.workingTree")}><dl className="fact-list"><div><dt>{t("changes.status")}</dt><dd>{t("changes.modified", { count: cumulative.length })}</dd></div><div><dt>{t("changes.baseCommit")}</dt><dd><code>a1b2c3d</code></dd></div><div><dt>{t("changes.head")}</dt><dd><code>a1b2c3d</code></dd></div><div><dt>{t("changes.mutation")}</dt><dd>{t("changes.noMutation")}</dd></div></dl></InspectorSection>
    <InspectorSection title={t("changes.boundary")}><ul className="checkpoint-boundary"><li className="available"><CheckCircle size={13} weight="fill" /><span><strong>{t("changes.cursorTitle")}</strong><small>{t("changes.cursorDetail")}</small></span></li><li className="available"><CheckCircle size={13} weight="fill" /><span><strong>{t("changes.checkpointTitle")}</strong><small>{t("changes.checkpointDetail")}</small></span></li><li><WarningCircle size={13} weight="fill" /><span><strong>{t("changes.workspaceCheckpoint")}</strong><small>{t("changes.restoreUnavailable")}</small></span></li><li><WarningCircle size={13} weight="fill" /><span><strong>{t("changes.runtimeCheckpoint")}</strong><small>{t("changes.forkUnavailable")}</small></span></li></ul></InspectorSection>
    <InspectorSection title={t("changes.usage")}><dl className="fact-list"><div><dt>{t("changes.tokenUsage")}</dt><dd>{t("changes.notRetained")}</dd></div><div><dt>{t("changes.contextWindow")}</dt><dd>{t("changes.notRetained")}</dd></div><div><dt>{t("changes.artifactRevision")}</dt><dd>Sample r4</dd></div></dl></InspectorSection>
  </>;
}

function FilesInspector({ session, files }: { session: DebuggerSession; files: DebuggerFileChange[] }): React.JSX.Element {
  const { t } = useTranslation("run");
  const resources = session.events.flatMap((event) => event.toolCalls ?? []).flatMap((tool) => tool.resource === undefined ? [] : [tool.resource]);
  return <><InspectorSection title={t("files.observed")} count={files.length}>{files.length > 0 ? <FileRows files={files} /> : <p className="inspector-empty">{t("files.noModified")}</p>}</InspectorSection><InspectorSection title={t("files.ledger")} count={resources.length}>{resources.length === 0 ? <p className="inspector-empty">{t("files.noResources")}</p> : <ul className="simple-rows">{resources.map((file, index) => <li key={`${file}:${index}`}><FileText size={13} /><code>{file}</code><span>{t("files.retained")}</span></li>)}</ul>}</InspectorSection></>;
}

function ArtifactsInspector({ endpoint }: { endpoint?: string }): React.JSX.Element {
  const { t } = useTranslation("run");
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
  if (endpoint === undefined) return <InspectorSection title={t("artifacts.title")}><p className="inspector-empty">{t("artifacts.noDirectory")}</p></InspectorSection>;
  if (failure !== undefined) return <InspectorSection title={t("artifacts.title")}><p className="inspector-empty">{failure}</p></InspectorSection>;
  if (artifacts === undefined) return <InspectorSection title={t("artifacts.title")}><p className="inspector-empty">{t("artifacts.loading")}</p></InspectorSection>;
  return <><InspectorSection title={t("artifacts.title")} count={artifacts.length}>{artifacts.length === 0 ? <p className="inspector-empty">{t("artifacts.empty")}</p> : <ul className="simple-rows">{artifacts.map((artifact) => <li key={artifact.id}><FileText size={13} /><span>{artifact.label}</span><em>{artifact.renderer.label}</em></li>)}</ul>}</InspectorSection><InspectorSection title={t("artifacts.boundary")}><p className="inspector-note">{t("artifacts.boundaryDetail")}</p></InspectorSection></>;
}

function TestsInspector({ session, event }: { session: DebuggerSession; event: DebuggerEvent }): React.JSX.Element {
  const { t } = useTranslation("run");
  const validations = session.events.filter((candidate) => candidate.validation !== undefined);
  return <InspectorSection title={t("tests.validationHistory")} count={validations.length}>{validations.length === 0 ? <p className="inspector-empty">{t("tests.empty")}</p> : <ul className="test-history">{validations.map((candidate) => { const validation = candidate.validation!; const StatusIcon = validation.status === "passed" ? CheckCircle : XCircle; return <li key={candidate.id} className={`${event.id === candidate.id ? "selected " : ""}${validation.status}`}><StatusIcon size={14} weight="fill" /><span><strong>{validation.command}</strong><small>{validation.summary}</small></span><time>{validation.duration}</time></li>; })}</ul>}</InspectorSection>;
}

function TerminalInspector({ event }: { event: DebuggerEvent }): React.JSX.Element {
  const { t } = useTranslation("run");
  if (event.validation === undefined) return <InspectorSection title={t("terminal.title")}><p className="inspector-empty">{t("terminal.empty")}</p></InspectorSection>;
  return <InspectorSection title={t("terminal.title")}><div className={`terminal-card ${event.validation.status}`}><header><TerminalWindow size={13} /><code>{event.validation.command}</code><span>{event.validation.duration}</span></header><ArtifactCodeView mode="source" content={event.validation.output.join("\n")} sourceHint="terminal.txt" label={t("terminal.outputLabel")} /></div></InspectorSection>;
}

function PlanInspector({ event }: { event: DebuggerEvent }): React.JSX.Element {
  const { t } = useTranslation("run");
  const phaseIndex = { prompt: 0, plan: 1, explore: 2, change: 3, verify: 4, response: 5 }[event.kind];
  return <InspectorSection title={t("plan.title")}><ol className="plan-progress">{PLAN_ITEMS.map((item, index) => <li key={item} className={index < phaseIndex ? "done" : index === phaseIndex ? "current" : ""}><span>{index < phaseIndex ? <CheckCircle size={13} weight="fill" /> : index + 1}</span><p>{item}</p></li>)}</ol></InspectorSection>;
}

function EvidenceInspector({ event }: { event: DebuggerEvent }): React.JSX.Element {
  const { t } = useTranslation("run");
  return <InspectorSection title={t("evidence.links")} count={event.evidence.length}><ul className="evidence-links">{event.evidence.map((link) => <li key={`${link.level}:${link.label}`}><EvidenceBadge level={link.level} /><span><strong>{link.label}</strong><small>{link.detail}</small></span></li>)}</ul><p className="inspector-note">{t("evidence.note")}</p></InspectorSection>;
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
  const { t } = useTranslation("run");
  const selectedIndex = props.session.events.findIndex((event) => event.id === props.cursor.eventId);
  return <footer className="timeline-minimap" aria-label={t("minimap.aria")}><div className="timeline-range"><span>{props.session.startedAt}</span><strong>{t("minimap.title")}</strong><span>{props.session.finishedAt}</span></div><div className="timeline-track">{props.session.events.map((event) => <button key={event.id} type="button" className={`timeline-segment kind-${event.kind}${event.id === props.cursor.eventId ? " selected" : ""}`} aria-label={t("minimap.segmentAria", { phase: event.phase, title: event.title })} aria-current={event.id === props.cursor.eventId ? "true" : undefined} onClick={() => props.onSelect({ eventId: event.id })}><span>{event.phase}</span></button>)}</div><div className="timeline-footer"><div className="timeline-legend">{(["prompt", "plan", "explore", "change", "verify", "response"] as DebuggerEventKind[]).map((kind) => <span key={kind}><i className={`kind-${kind}`} />{kind}</span>)}</div><div><span>{t("minimap.cursor", { index: selectedIndex + 1, total: props.session.events.length })}</span><strong>{t("minimap.readOnly")}</strong></div></div></footer>;
}

function LiveExecutionTree({ state, prompt }: { state: HarnessRunState; prompt: string }): React.JSX.Element {
  const { t } = useTranslation("run");
  return <aside className="execution-tree live-tree" aria-label={t("tree.title")}><header><div><small>{t("tree.title")}</small><strong>{t("tree.liveObservations")}</strong></div><span>{t("tree.eventCount", { count: state.timelineKeys.length })}</span></header><div className="execution-tree-scroll"><TreeRow nodeId="live-session" label={t("tree.session")} detail={state.runId ?? t("tree.starting")} icon={Database} selected={false} depth={0} expandable expanded onSelect={() => undefined} /><TreeRow nodeId="live-turn" label={t("tree.turn", { turn: 1 })} detail={prompt} icon={GitBranch} selected={false} depth={1} expandable expanded onSelect={() => undefined} /><TreeRow nodeId="live-prompt" label={t("tree.prompt")} detail={prompt} icon={UserCircle} selected={false} depth={2} onSelect={() => undefined} /><TreeRow nodeId="live-tools" label={t("tree.stages")} detail={t("tree.toolCallCount", { count: state.toolCallCount })} icon={Wrench} selected={false} depth={2} status={state.status} onSelect={() => undefined} /></div></aside>;
}

function LiveNotebook({ state, prompt, groups }: { state: HarnessRunState; prompt: string; groups: LiveTimelineGroup[] }): React.JSX.Element {
  const { t } = useTranslation("run");
  return <main className="session-notebook live-notebook" aria-label={t("live.aria")}><header className="notebook-viewbar"><nav><button type="button" className="active"><ClipboardText size={13} />{t("live.notebookTitle")}</button></nav><span>{t("live.toolCalls", { count: state.toolCallCount })}</span></header><div className="session-notebook-scroll"><article className="debugger-event event-prompt"><div className="event-rail"><span><UserCircle size={13} /></span></div><div className="debugger-event-card"><header><div><strong>{t("live.userRequest")}</strong></div><span>{t("event.prompt")}</span></header><section className="prompt-cell"><p>{prompt}</p></section></div></article><section className="live-session-stage"><p className="status-line run-status"><span className={`status-dot status-${state.status}`} aria-hidden="true" />{t("live.statusLabel")}<strong>{state.status}</strong>{state.runId ? <span>{t("live.runId", { id: state.runId })}</span> : null}</p>{state.warnings.map((warning, index) => <p className="warning" key={index}><WarningCircle size={14} />{warning}</p>)}{state.error ? <p className="error"><XCircle size={14} />{state.error}</p> : null}<section className="activity-panel" aria-label={t("live.agentActivity")}><header className="activity-panel-head"><div><small>{t("live.semanticStages")}</small><h2>{t("live.agentActivity")}</h2></div><span>{t("live.activitySummary", { calls: state.toolCallCount, groups: groups.length })}</span></header><VirtualLiveTimeline groups={groups} followLatest={state.status === "running"} /></section>{state.result !== undefined ? <details className="live-run-result"><summary>{t("live.runResult")}</summary><pre>{JSON.stringify(state.result, null, 2)}</pre></details> : null}</section></div></main>;
}

function VirtualLiveTimeline(props: { groups: LiveTimelineGroup[]; followLatest: boolean }): React.JSX.Element {
  const { t } = useTranslation("run");
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
  if (props.groups.length === 0) return <p className="activity-empty">{t("live.waiting")}</p>;
  return <div className="timeline virtual-live-timeline" ref={scrollRef}><div className="virtual-live-spacer" style={{ height: virtualizer.getTotalSize() }}>{virtualizer.getVirtualItems().map((virtualItem) => { const group = props.groups[virtualItem.index]!; return <div className="virtual-live-row" data-index={virtualItem.index} key={group.key} ref={virtualizer.measureElement} style={{ transform: `translateY(${virtualItem.start}px)` }}><LiveGroupEntry group={group} /></div>; })}</div></div>;
}

function LiveGroupEntry({ group }: { group: LiveTimelineGroup }): React.JSX.Element {
  const { t } = useTranslation("run");
  const first = group.items[0]!;
  if (group.items.length === 1) return <TimelineEntry item={first} />;
  const tool = first as ToolCallTimelineItem;
  return <details className={`live-tool-group kind-${group.kind}`}><summary><span>{group.kind}</span><strong>{tool.name} ×{group.items.length}</strong><em>{t("live.toolGroup")}</em></summary><div>{group.items.map((item) => <ToolCallEntry item={item as ToolCallTimelineItem} key={item.id} />)}</div></details>;
}

function LiveInspector({ state, runtime, onPermission }: { state: HarnessRunState; runtime: LiveRuntime; onPermission: (requestId: string, optionId: string) => Promise<void> }): React.JSX.Element {
const { t } = useTranslation("run");
  return <aside className="state-inspector live-inspector" aria-label={t("inspector.stateAria")}><header><div><small>{t("inspector.title")}</small><strong>{t("inspector.liveObservation")}</strong></div><span>{liveRunStatusLabel(state, t)}</span></header><div className="inspector-scroll"><InspectorSection title={t("inspector.runtimeBoundary")}><ul className="checkpoint-boundary"><li className="available"><CheckCircle size={13} weight="fill" /><span><strong>{t("inspector.evidenceStream")}</strong><small>{state.status}</small></span></li><li className={state.pendingPermission === undefined ? "" : "available"}>{state.pendingPermission === undefined ? <WarningCircle size={13} weight="fill" /> : <CheckCircle size={13} weight="fill" />}<span><strong>{t("inspector.gatePause")}</strong><small>{state.pendingPermission === undefined ? t("inspector.notReported") : t("inspector.permissionRequested")}</small></span></li><li><WarningCircle size={13} weight="fill" /><span><strong>{t("inspector.hardPause")}</strong><small>{t("inspector.notReported")}</small></span></li></ul></InspectorSection>{state.pendingPermission !== undefined ? <InspectorSection title={t("inspector.acpPermission")}><div className="acp-permission"><strong>{state.pendingPermission.title}</strong><small>{t("inspector.toolCall", { id: state.pendingPermission.toolCallId })}</small><div>{state.pendingPermission.options.map((option) => <button type="button" key={option.optionId} onClick={() => void onPermission(state.pendingPermission!.requestId, option.optionId)}>{option.name}<span>{option.kind}</span></button>)}</div></div></InspectorSection> : null}<InspectorSection title={t("inspector.observedState")}><dl className="fact-list"><div><dt>{t("inspector.runId")}</dt><dd>{state.runId ?? t("inspector.pending")}</dd></div><div><dt>{t("inspector.threadId")}</dt><dd>{state.threadId ?? t("inspector.pending")}</dd></div><div><dt>{t("inspector.toolCalls")}</dt><dd>{state.toolCallCount}</dd></div><div><dt>{t("inspector.warnings")}</dt><dd>{state.warnings.length}</dd></div>{runtime === "acp" ? <div><dt>{t("inspector.acpFrames")}</dt><dd>{state.protocolEvents.length}</dd></div> : null}</dl></InspectorSection>{runtime === "acp" ? <InspectorSection title={t("raw.rawAcp")}><div className="acp-protocol-list">{state.protocolEvents.length === 0 ? <p className="inspector-note">{t("raw.waiting")}</p> : state.protocolEvents.slice(-12).map((event, index) => <details key={`${event.direction}:${event.rpcId ?? index}:${index}`}><summary><span>{event.direction}</span><strong>{event.method}</strong></summary><pre>{JSON.stringify(event.payload, null, 2)}</pre></details>)}</div></InspectorSection> : null}{runtime === "acp" ? <InspectorSection title={t("inspector.meaning")}><p className="inspector-note">{t("inspector.acpMeaning")}</p></InspectorSection> : null}</div></aside>;
}

function LiveTimeline({ state, bins, eventCount }: { state: HarnessRunState; bins: TimelineBin<DebuggerEventKind>[]; eventCount: number }): React.JSX.Element {
  const { t } = useTranslation("run");
  return <footer className="timeline-minimap live-minimap"><div className="timeline-range"><span>{t("live.liveLabel")}</span><strong>{t("live.semanticTimeline")}</strong><span>{state.status}</span></div><div className="timeline-track">{bins.length === 0 ? <span className="live-track-empty">{t("live.waitingEvents")}</span> : bins.map((bin) => <span key={bin.index} className={`timeline-segment kind-${bin.kind}`} title={t("live.binEvents", { count: bin.count })} />)}</div><div className="timeline-footer"><strong>{t("live.retainedEvents", { count: eventCount })}</strong></div></footer>;
}

function liveRunStatusLabel(state: HarnessRunState, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (state.pendingPermission !== undefined) return t("status.permissionRequired");
  if (state.status === "running") return t("status.running");
  if (state.status === "finished") return t("status.finished");
  if (state.status === "error") return t("status.failed");
  return t("status.ready");
}

function liveObservationCopy(state: HarnessRunState, t: (key: string, options?: Record<string, unknown>) => string): { title: string; detail: string } {
  if (state.pendingPermission !== undefined) return { title: t("observation.permissionTitle"), detail: t("observation.permissionDetail") };
  if (state.status === "running") return { title: t("observation.runningTitle"), detail: t("observation.runningDetail") };
  if (state.status === "finished") return { title: t("observation.finishedTitle"), detail: t("observation.finishedDetail") };
  if (state.status === "error") return { title: t("observation.failedTitle"), detail: t("observation.failedDetail") };
  return { title: t("observation.readyTitle"), detail: t("observation.readyDetail") };
}
