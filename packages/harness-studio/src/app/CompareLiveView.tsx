import { ResizableComparePanes } from "./run/ResizableComparePanes.js";
import { PromptInput, PromptInputFooter, PromptInputTextarea, PromptInputTools } from "./components/ai-elements/prompt-input.js";
import { AcpSessionSettings } from "./run/AcpSessionSettings.js";
import { useSessionOwnedState } from "./run/session-view-store.js";
import { createAcpSessionActions } from "./run/acp-session-actions.js";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { Check } from "@phosphor-icons/react/Check";
import { ClockCounterClockwise } from "@phosphor-icons/react/ClockCounterClockwise";
import { Info } from "@phosphor-icons/react/Info";
import { Play } from "@phosphor-icons/react/Play";
import { Warning } from "@phosphor-icons/react/Warning";
import { X } from "@phosphor-icons/react/X";
import type { HarnessRunStreamEventV1 } from "@qoder-ai/harness/protocol";
import {
  applyHarnessRunEvent,
  initialRunState,
  settleRunState,
  type HarnessRunState,
} from "./run/run-store.js";
import { streamRun } from "./run/stream-run.js";
import { AcpSessionStream } from "./run/AcpSessionStream.js";
import { AcpConnectionPanel } from "./run/AcpConnectionPanel.js";
import { AcpConversationHistory, loadAcpConversation } from "./run/AcpConversationHistory.js";
import { postAcpRunAction } from "./run/acp-run-actions.js";
import { ToolbarActions } from "./shell/ToolbarActions.js";
import { PaneSash } from "./shell/PaneSash.js";
import type { StudioAcpAgentOption } from "./studio-shell-model.js";

const HISTORY_WIDTH_DEFAULT = 240;
const HISTORY_WIDTH_MIN = 180;
const HISTORY_WIDTH_MAX = 360;

/** The same workspace supports a single Agent or a multi-Agent comparison. */
const MIN_LANES = 1;
/**
 * Every lane is one more Agent writing to the *same* working tree at the same
 * time, and one more ACP host process. Four keeps the side-by-side readable at
 * the widths this shell targets and bounds what a single click can start.
 */
const MAX_LANES = 4;
/** The stream protocol forbids an empty request; prepared ACP sessions replace
 * this transport placeholder with the reader's prompt before `start`. */
const PREPARE_PROMPT = "Prepare the Agent session configuration.";

function laneKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface LaneRun {
  key: string;
  agentId: string;
  runId: string;
  state: HarnessRunState;
  failure?: string;
}

/** One prompt dispatched to every independently selected Agent. */
interface LiveComparison {
  prompt: string;
  lanes: readonly LaneRun[];
}

function runIdentity(key: string): { threadId: string; runId: string } {
  const seed = laneKey();
  return { threadId: `live-compare-${seed}`, runId: `live-${key}-${seed}` };
}

export function CompareLiveView(props: {
  agents: readonly StudioAcpAgentOption[];
  project?: { id: string; label: string; revision: number };
  onOpenSession?: (id: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation("compare");
  const owner = `compare:${props.project?.id ?? "default"}`;
  const [prompt, setPrompt] = useSessionOwnedState(`${owner}:prompt`, "");
  // The chosen Agents are a set, in the order they were chosen. A set cannot
  // express the same Agent twice.
  const [chosen, setChosen] = useSessionOwnedState<readonly string[]>(`${owner}:chosen`, []);
  const [comparison, setComparison, liveComparison] = useSessionOwnedState<LiveComparison | undefined>(`${owner}:comparison`, undefined);
  const [, , running] = useSessionOwnedState(`${owner}:running`, false);
  const [prepared, setPrepared] = useState<readonly LaneRun[]>([]);
  const preparedRef = useRef<readonly LaneRun[]>([]);
  const preparingAgents = useRef(new Map<string, string>());
  const preparedControllers = useRef(new Map<string, AbortController>());
  const launchBusy = useRef(false);
  const [preparationRevision, setPreparationRevision] = useState(0);
  const [queuedLaunch, setQueuedLaunch] = useState<string>();
  const [closeError, setCloseError] = useState<string>();
  const [historyWidth, setHistoryWidth] = useSessionOwnedState(`${owner}:history-width`, HISTORY_WIDTH_DEFAULT);
  const [historyOpen, setHistoryOpen] = useSessionOwnedState(`${owner}:history-open`, false);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [historyView, setHistoryView] = useState<{ id: string; prompt: string; state: HarnessRunState }>();
  const available = props.agents.filter((agent) => agent.available);
  const active = comparison !== undefined
    && comparison.lanes.some((lane) => lane.state.status === "running");
  const configurationReady = chosen.length >= MIN_LANES && chosen.every((agentId) => {
    const lane = prepared.find((candidate) => candidate.agentId === agentId);
    return lane?.state.status === "running" && lane.state.acp.prepared === true;
  });
  const canRequestRun = prompt.trim() !== "" && chosen.length >= MIN_LANES
    && chosen.every((id) => available.some((agent) => agent.id === id)) && !active;

  function updatePrepared(update: (current: readonly LaneRun[]) => readonly LaneRun[]): void {
    const next = update(preparedRef.current);
    preparedRef.current = next;
    setPrepared(next);
  }

  function patchLane(key: string, update: (run: LaneRun) => LaneRun): void {
    const current = liveComparison.current;
    if (current === undefined) {
      updatePrepared((runs) => runs.map((lane) => lane.key === key ? update(lane) : lane));
      return;
    }
    const next = { ...current, lanes: current.lanes.map((lane) => lane.key === key ? update(lane) : lane) };
    liveComparison.current = next;
    setComparison(next);
  }

  function releasePrepared(lanes: readonly LaneRun[]): void {
    for (const lane of lanes) {
      preparedControllers.current.get(lane.key)?.abort();
      preparedControllers.current.delete(lane.key);
      void postAcpRunAction(lane.runId, "cancel").catch(() => undefined);
    }
  }

  function prepareAgent(agentId: string): void {
    if (!available.some((agent) => agent.id === agentId) || preparingAgents.current.has(agentId)) return;
    const key = laneKey();
    const { threadId, runId } = runIdentity(key);
    const controller = new AbortController();
    preparingAgents.current.set(agentId, key);
    preparedControllers.current.set(key, controller);
    updatePrepared((current) => [...current, { key, agentId, runId, state: { ...initialRunState(), runId, status: "running" } }]);
    void streamRun(
      `api/acp/runs/stream?conversation=1&prepare=1&agent=${encodeURIComponent(agentId)}`,
      PREPARE_PROMPT,
      threadId,
      runId,
      props.project,
      (events: HarnessRunStreamEventV1[]) => patchLane(key, (run) => ({ ...run, state: events.reduce(applyHarnessRunEvent, run.state) })),
      controller.signal,
    ).catch((error) => {
      if (controller.signal.aborted) return;
      patchLane(key, (run) => ({
        ...run,
        failure: error instanceof Error ? error.message : String(error),
        state: settleRunState({ ...run.state, status: "error" }, "interrupted"),
      }));
    }).finally(() => {
      if (preparingAgents.current.get(agentId) === key) preparingAgents.current.delete(agentId);
      preparedControllers.current.delete(key);
    });
  }

  useEffect(() => {
    const selected = new Set(chosen);
    const obsolete = preparedRef.current.filter((lane) => !selected.has(lane.agentId));
    if (obsolete.length > 0) {
      releasePrepared(obsolete);
      updatePrepared((current) => current.filter((lane) => selected.has(lane.agentId)));
    }
    for (const agentId of chosen) {
      if (!preparedRef.current.some((lane) => lane.agentId === agentId)) prepareAgent(agentId);
    }
  }, [chosen, preparationRevision, props.project?.id, props.project?.revision]);

  useEffect(() => () => {
    // A live comparison is session-owned and may survive a view switch. A
    // configuration-only preparation has no visible work to preserve.
    if (liveComparison.current === undefined) releasePrepared(preparedRef.current);
  }, []);

  async function startPrepared(task: string): Promise<void> {
    if (launchBusy.current || liveComparison.current !== undefined) return;
    const lanes = prepared.filter((lane) => chosen.includes(lane.agentId));
    if (lanes.length !== chosen.length || lanes.some((lane) => lane.state.status !== "running" || !lane.state.acp.prepared)) {
      setQueuedLaunch(task);
      return;
    }
    launchBusy.current = true;
    running.current = true;
    setQueuedLaunch(undefined);
    try {
      // Retain the current draft before mounting the lanes. They then use the
      // established ACP stream start path, including its conversation capture.
      await Promise.all(lanes.map((lane) => createAcpSessionActions(lane.runId).execute({ action: "set-prompt", prompt: task })));
      const next: LiveComparison = { prompt: task, lanes };
      liveComparison.current = next;
      setComparison(next);
    } catch (error) {
      setCloseError(error instanceof Error ? error.message : String(error));
    } finally {
      running.current = false;
      launchBusy.current = false;
    }
  }

  function launch(): void {
    if (!canRequestRun) return;
    const task = prompt.trim();
    if (!configurationReady) {
      setQueuedLaunch(task);
      return;
    }
    void startPrepared(task);
  }

  useEffect(() => {
    if (queuedLaunch !== undefined && configurationReady && !active) void startPrepared(queuedLaunch);
  }, [active, configurationReady, queuedLaunch]);

  /** Preparation is automatic, so a failed Agent needs its own way back rather
   * than a composer-wide refresh that would discard the settled Agents too. */
  function retryAgent(agentId: string): void {
    if (active) return;
    releasePrepared(preparedRef.current.filter((lane) => lane.agentId === agentId));
    updatePrepared((current) => current.filter((lane) => lane.agentId !== agentId));
    preparingAgents.current.delete(agentId);
    prepareAgent(agentId);
  }

  const runIdFor = (key: string): string | undefined =>
    comparison?.lanes.find((lane) => lane.key === key)?.runId;

  async function cancel(key: string): Promise<void> {
    const runId = runIdFor(key);
    if (runId === undefined) return;
    await postAcpRunAction(runId, "cancel");
  }

  async function decide(key: string, requestId: string, optionId: string): Promise<void> {
    const runId = runIdFor(key);
    if (runId === undefined) throw new Error("ACP run is no longer available.");
    await postAcpRunAction(runId, { requestId, optionId });
  }

  async function newComparison(): Promise<void> {
    setCloseError(undefined);
    try {
      await Promise.all((comparison?.lanes ?? []).filter((lane) => lane.state.status === "running").map((lane) => createAcpSessionActions(lane.runId).execute({ action: "close" })));
      releasePrepared(preparedRef.current);
      updatePrepared(() => []);
      preparingAgents.current.clear();
      running.current = false;
      liveComparison.current = undefined;
      setComparison(undefined);
      setHistoryView(undefined);
      setHistoryRevision((current) => current + 1);
      setPreparationRevision((current) => current + 1);
    } catch (error) { setCloseError(String(error)); }
  }

  async function openHistory(id: string, fallbackPrompt = ""): Promise<void> {
    if (liveComparison.current !== undefined) return;
    try {
      const loaded = await loadAcpConversation(id);
      setHistoryView({ id, prompt: loaded.prompt || fallbackPrompt, state: loaded.state });
      setCloseError(undefined);
    } catch {
      setCloseError(t("live.historyUnavailable"));
    }
  }

  const labelFor = (agentId: string): string => props.agents.find((agent) => agent.id === agentId)?.label ?? agentId;
  // Each chosen Agent states its own preparation on its own control, so the
  // composer only speaks for what no Agent row can: an empty or unusable choice.
  const prerequisite = available.length === 0
    ? t("live.noAgents")
    : chosen.length < MIN_LANES
      ? t("live.agentFloor", { count: MIN_LANES })
      : undefined;

  // No page title or eyebrow: the shell title bar and the sidebar already name
  // this area, and the composer states the decision on its own.
  const fittedHistory = Math.min(HISTORY_WIDTH_MAX, Math.max(HISTORY_WIDTH_MIN, historyWidth));
  return <main className="live-compare-workspace" aria-label={t("live.title")} style={{ ["--compare-history-width" as string]: `${fittedHistory}px` } as CSSProperties}>
    <ToolbarActions>
      <button
        type="button"
        aria-pressed={historyOpen}
        aria-label={t(historyOpen ? "live.historyHide" : "live.historyShow")}
        title={t(historyOpen ? "live.historyHide" : "live.historyShow")}
        onClick={() => setHistoryOpen((value) => !value)}
      >
        <ClockCounterClockwise aria-hidden="true" size={15} />
        <span>{t("live.history")}</span>
      </button>
      {comparison && <button type="button" className="new-run" onClick={() => void newComparison()}>{t(comparison.lanes.length === 1 ? "live.newRun" : "live.newComparison")}</button>}
    </ToolbarActions>
    {closeError && <p role="alert">{closeError}</p>}
    {comparison && comparison.lanes.length > 1 && <div className="acp-compare-toolbar"><SharedTreeNote /></div>}
    <div className={`live-compare-body${historyOpen ? " has-history" : ""}`}>
      <div className="live-compare-main">
        {comparison === undefined
          ? historyView
            ? <AcpSessionStream compact showComposer={false} state={historyView.state} prompt={historyView.prompt} />
            : <div className="live-compare-empty" aria-hidden="true" />
          : <>
            <ResizableComparePanes owner={owner} panes={comparison.lanes.map((lane, index) => ({
              key: lane.key, label: labelFor(lane.agentId), content: <LiveLane
                labeled={comparison.lanes.length > 1}
                side={t("live.laneAgent", { index: index + 1 })}
                label={labelFor(lane.agentId)} run={lane} prompt={comparison.prompt}
                revealTool={undefined}
                onCancel={() => cancel(lane.key)}
                onDecide={(requestId, optionId) => decide(lane.key, requestId, optionId)} />,
            }))} />
          </>}
      </div>
      {historyOpen && <>
        <PaneSash
          invert
          orientation="vertical"
          label={t("live.historyResize")}
          size={fittedHistory}
          min={HISTORY_WIDTH_MIN}
          max={HISTORY_WIDTH_MAX}
          fallback={HISTORY_WIDTH_DEFAULT}
          onSize={setHistoryWidth}
        />
        <AcpConversationHistory
          variant="pane"
          project={props.project}
          refreshKey={historyRevision}
          selectedId={historyView?.id}
          onClose={() => setHistoryOpen(false)}
          onSelect={comparison === undefined ? (record) => void openHistory(record.runId, record.prompt) : undefined}
          onOpenSession={props.onOpenSession}
        />
      </>}
    </div>
    <PromptInput
      hidden={comparison !== undefined}
      className="live-compare-composer"
      onSubmit={(event) => { event.preventDefault(); launch(); }}
    >
      <PromptInputTextarea
        className="live-compare-prompt"
        value={prompt}
        rows={2}
        aria-label={t("live.promptLabel")}
        placeholder={t("live.promptPlaceholder")}
        onValueChange={setPrompt}
      />
      <PromptInputFooter className="live-compare-bar">
        <PromptInputTools>
          <AgentPicker
            agents={props.agents}
            chosen={chosen}
            disabled={available.length === 0}
            onToggle={(agentId) => setChosen((current) => current.includes(agentId)
              ? current.filter((candidate) => candidate !== agentId)
              : current.length < MAX_LANES ? [...current, agentId] : current)}
          />
          {/* One control per chosen Agent: its name, the configuration it
              actually offers, and the way to drop it, in the input region the
              reader is already in. */}
          {chosen.map((agentId) => {
            const lane = prepared.find((candidate) => candidate.agentId === agentId);
            const failed = lane !== undefined && (lane.failure !== undefined || lane.state.status === "error");
            return <div className="live-compare-agent" key={agentId} role="group" aria-label={t("live.agentSettingsAria", { agent: labelFor(agentId) })}>
              <span className="live-compare-agent-name">{labelFor(agentId)}</span>
              {failed
                ? <button type="button" className="live-compare-agent-retry" title={lane.failure ?? lane.state.error} onClick={() => retryAgent(agentId)}>{t("live.retry")}</button>
                : lane?.state.acp.prepared === true
                  ? <AcpSessionSettings session={lane.state.acp} runId={lane.runId} active={lane.state.status === "running"} actions={createAcpSessionActions(lane.runId)} agentId={agentId} />
                  : <span className="live-compare-agent-status" role="status">{t("live.configuring")}</span>}
              <button
                type="button"
                className="live-compare-agent-remove"
                aria-label={t("live.removeChosenAgent", { agent: labelFor(agentId) })}
                onClick={() => setChosen((current) => current.filter((candidate) => candidate !== agentId))}
              ><X aria-hidden="true" size={11} /></button>
            </div>;
          })}
          {/* An Agent that needs a session decision before it can answer states
              that decision in the input region it already owns. Preparation
              cannot finish without it, so Run would otherwise never unlock. */}
          {chosen.map((agentId) => {
            const lane = prepared.find((candidate) => candidate.agentId === agentId);
            if (lane?.state.connection == null) return null;
            return <div
              className="live-compare-connection"
              key={`connection-${agentId}`}
              role="group"
              aria-label={t("live.agentSettingsAria", { agent: labelFor(agentId) })}
            >
              <AcpConnectionPanel
                connection={lane.state.connection}
                actions={createAcpSessionActions(lane.runId)}
                runId={lane.runId}
              />
            </div>;
          })}
          {chosen.length > 1 && <SharedTreeNote />}
          {prerequisite !== undefined && <span className={`live-compare-readiness${available.length === 0 ? " status-warning" : ""}`} role="status">{prerequisite}</span>}
        </PromptInputTools>
        <button className="primary live-compare-run" type="submit" disabled={!canRequestRun}>
          <Play aria-hidden="true" size={14} />
          <span>{chosen.length < MIN_LANES ? t("live.runIdle") : t("live.run", { count: chosen.length })}</span>
        </button>
      </PromptInputFooter>
    </PromptInput>
  </main>;
}

/**
 * One popup over the whole bounded catalog, replacing a `<select>` per lane.
 *
 * Checkbox semantics are what make a duplicate pair unexpressible, and they let
 * an unavailable Agent keep the server's reason as readable text instead of an
 * `<option title>` no reader reliably sees.
 */
function AgentPicker(props: {
  agents: readonly StudioAcpAgentOption[];
  chosen: readonly string[];
  disabled: boolean;
  onToggle: (agentId: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation("compare");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const full = props.chosen.length >= MAX_LANES;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return;
      if (rootRef.current?.contains(event.target) === true) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return <div className="live-compare-picker" ref={rootRef}>
    <button
      ref={toggleRef}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={t("live.agentsAria", { count: props.chosen.length })}
      disabled={props.disabled}
      onClick={() => setOpen((value) => !value)}
    >
      <span>{t("live.agents")}</span>
      <CaretDown aria-hidden="true" size={11} />
    </button>
    {open && <div className="live-compare-menu" role="menu" aria-label={t("live.agentsMenuAria")}>
      {props.agents.map((agent) => {
        const checked = props.chosen.includes(agent.id);
        return <button
          key={agent.id}
          type="button"
          role="menuitemcheckbox"
          aria-checked={checked}
          className={checked ? "selected" : ""}
          // At the ceiling only the chosen stay operable, so the menu never
          // offers a click it would refuse.
          disabled={!agent.available || (full && !checked)}
          onClick={() => props.onToggle(agent.id)}
        >
          {/* The check is what states the selection; the tinted row alone would
              leave the state carried by colour. */}
          <Check aria-hidden="true" size={12} weight="bold" />
          <strong>{agent.available ? agent.label : t("live.agentUnavailable", { agent: agent.label })}</strong>
          {agent.detail !== undefined && <span>{agent.detail}</span>}
        </button>;
      })}
      {/* The prerequisite for choosing a fifth Agent is stated once, where the
          disabled entries are, rather than as a banner over the composer. */}
      {full && <p>{t("live.agentCeiling", { count: MAX_LANES })}</p>}
    </div>}
  </div>;
}

/**
 * A labelled warning that keeps its consequence reachable.
 *
 * The scope fact stays on the row because losing another Agent's edits is not a
 * detail. The full consequence and the Bench alternative are longer than the row
 * can carry, so they are disclosed on hover, on focus, and on click-to-pin, and
 * are bound to the control with `aria-describedby` so the text reaches assistive
 * technology in every visual state rather than only while pointing at it.
 */
function SharedTreeNote(): React.JSX.Element {
  const { t } = useTranslation("compare");
  const [pinned, setPinned] = useState(false);
  const detailId = useId();
  return <p className="live-compare-note live-compare-shared-tree">
    <Warning aria-hidden="true" size={12} />
    <span>{t("live.sharedTree")}</span>
    <button
      type="button"
      className="live-compare-note-toggle"
      aria-expanded={pinned}
      aria-describedby={detailId}
      aria-label={t("live.sharedTreeAria")}
      onClick={() => setPinned((value) => !value)}
    ><Info aria-hidden="true" size={13} /></button>
    <span className="live-compare-note-detail" id={detailId} role="note">{t("live.sharedTreeDetail")}</span>
  </p>;
}

function LiveLane(props: {
  revealTool?: { id: string; token: number };
  labeled: boolean;
  side: string;
  label: string;
  prompt: string;
  run: LaneRun;
  onCancel: () => Promise<void>;
  onDecide: (requestId: string, optionId: string) => Promise<void>;
}): React.JSX.Element {
  const { t } = useTranslation("compare");
  const [cancelling, setCancelling] = useState(false);
  const cancelBusy = useRef(false);
  const [actionError, setActionError] = useState<string>();
  async function cancel(): Promise<void> {
    if (cancelBusy.current) return;
    cancelBusy.current = true;
    setCancelling(true);
    setActionError(undefined);
    try { await props.onCancel(); }
    catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
      setCancelling(false);
      cancelBusy.current = false;
    }
  }
  const preparing = props.run.state.status === "running" && !props.run.state.conversation && !props.run.state.connection;
  return <section className={`live-compare-lane${props.labeled ? "" : " live-compare-lane-plain"}`} aria-label={t("live.laneAria", { side: props.side, agent: props.label })}>
    {props.labeled && <header>
      <strong>{props.label}</strong>
      {preparing && <button type="button" disabled={cancelling} onClick={() => void cancel()}>{t(cancelling ? "live.cancelling" : "live.cancel")}</button>}
    </header>}
    <AcpSessionStream compact revealTool={props.revealTool} actions={createAcpSessionActions(props.run.runId)} state={props.run.state} prompt={props.prompt} failure={actionError ?? props.run.failure} onPermission={props.onDecide} permissionClassName="live-compare-permission" agentId={props.run.agentId} />
  </section>;
}
