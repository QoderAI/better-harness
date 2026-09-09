import { CompareFiles } from "./run/CompareFiles.js";
import { ResizableComparePanes } from "./run/ResizableComparePanes.js";
import { comparisonLaneStatus } from "./run/compare-evidence.js";
import { PromptInput, PromptInputFooter, PromptInputTextarea } from "./components/ai-elements/prompt-input.js";
import { AcpSessionSettings } from "./run/AcpSessionSettings.js";
import { useSessionOwnedState } from "./run/session-view-store.js";
import { createAcpSessionActions } from "./run/acp-session-actions.js";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { Check } from "@phosphor-icons/react/Check";
import { Info } from "@phosphor-icons/react/Info";
import { Play } from "@phosphor-icons/react/Play";
import { Warning } from "@phosphor-icons/react/Warning";
import { X } from "@phosphor-icons/react/X";
import type { HarnessRunStreamEventV1 } from "@qoder-ai/harness/protocol";
import {
  applyHarnessRunEvent,
  initialRunState,
  timelineItems,
  settleRunState,
  type HarnessRunState,
} from "./run/run-store.js";
import { streamRun } from "./run/stream-run.js";
import { AcpSessionStream } from "./run/AcpSessionStream.js";
import { postAcpRunAction } from "./run/acp-run-actions.js";
import type { StudioAcpAgentOption } from "./studio-shell-model.js";

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
  const [refreshing, setRefreshing] = useState(false);
  const [queuedLaunch, setQueuedLaunch] = useState<string>();
  const [reveal, setReveal] = useState<{ laneKey: string; id: string; token: number }>();
  const [closeError, setCloseError] = useState<string>();
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

  async function refreshConfiguration(): Promise<void> {
    if (chosen.length < MIN_LANES || refreshing || active) return;
    setRefreshing(true);
    setQueuedLaunch(undefined);
    releasePrepared(preparedRef.current);
    updatePrepared(() => []);
    preparingAgents.current.clear();
    setPreparationRevision((current) => current + 1);
    setRefreshing(false);
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
      setPreparationRevision((current) => current + 1);
    } catch (error) { setCloseError(String(error)); }
  }

  const labelFor = (agentId: string): string => props.agents.find((agent) => agent.id === agentId)?.label ?? agentId;
  const readiness = available.length === 0
    ? t("live.noAgents")
    : chosen.length < MIN_LANES
      ? t("live.agentFloor", { count: MIN_LANES })
      : refreshing || !configurationReady || queuedLaunch !== undefined
        ? t("live.configuring")
        : t("live.ready");

  // No page title or eyebrow: the shell title bar and the sidebar already name
  // this area, and the composer states the decision on its own.
  return <main className="live-compare-workspace" aria-label={t("live.title")}>
    {closeError && <p role="alert">{closeError}</p>}
    {comparison && <div className="acp-compare-toolbar">{comparison.lanes.length > 1 && <SharedTreeNote />}<button type="button" onClick={() => void newComparison()}>{t(comparison.lanes.length === 1 ? "live.newRun" : "live.newComparison")}</button></div>}
    {comparison === undefined
      ? <div className="live-compare-empty" aria-hidden="true" />
      : <>
        <CompareFiles owner={owner} lanes={comparison.lanes.map((lane) => ({ ...lane, label: labelFor(lane.agentId) }))}
          onReveal={(laneKey, id) => setReveal((previous) => ({ laneKey, id, token: (previous?.token ?? 0) + 1 }))} />
        <ResizableComparePanes owner={owner} panes={comparison.lanes.map((lane, index) => ({
          key: lane.key, label: labelFor(lane.agentId), content: <LiveLane
            side={t("live.laneAgent", { index: index + 1 })}
            label={labelFor(lane.agentId)} run={lane} prompt={comparison.prompt}
            revealTool={reveal?.laneKey === lane.key ? reveal : undefined}
            onCancel={() => cancel(lane.key)}
            onDecide={(requestId, optionId) => decide(lane.key, requestId, optionId)} />,
        }))} />
      </>}
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
        <AgentPicker
          agents={props.agents}
          chosen={chosen}
          disabled={available.length === 0}
          onToggle={(agentId) => setChosen((current) => current.includes(agentId)
            ? current.filter((candidate) => candidate !== agentId)
            : current.length < MAX_LANES ? [...current, agentId] : current)}
        />
        {chosen.map((agentId) => <span className="live-compare-chip" key={agentId}>
          <span>{labelFor(agentId)}</span>
          <button
            type="button"
            aria-label={t("live.removeChosenAgent", { agent: labelFor(agentId) })}
            onClick={() => setChosen((current) => current.filter((candidate) => candidate !== agentId))}
          ><X aria-hidden="true" size={11} /></button>
        </span>)}
        {chosen.length > 1 && <SharedTreeNote />}
        <span className={`live-compare-readiness${available.length === 0 ? " status-warning" : ""}`} role="status">{readiness}</span>
        <button type="button" disabled={chosen.length < MIN_LANES || refreshing || active} onClick={() => void refreshConfiguration()}>{t("live.prepare")}</button>
        <button className="primary live-compare-run" type="submit" disabled={!canRequestRun}>
          <Play aria-hidden="true" size={14} />
          <span>{chosen.length < MIN_LANES ? t("live.runIdle") : t("live.run", { count: chosen.length })}</span>
        </button>
        {chosen.length > 0 && <div className="live-compare-configurations" aria-label={t("live.settingsAria")}>
          {chosen.map((agentId) => {
            const lane = prepared.find((candidate) => candidate.agentId === agentId);
            return <section className="live-compare-configuration" key={agentId} aria-label={t("live.agentSettingsAria", { agent: labelFor(agentId) })}>
              <strong>{labelFor(agentId)}</strong>
              {lane?.state.acp.prepared === true
                ? <AcpSessionSettings session={lane.state.acp} runId={lane.runId} active={lane.state.status === "running"} actions={createAcpSessionActions(lane.runId)} agentId={agentId} compact={false} />
                : <span className="live-compare-config-status" role="status">{t("live.configuring")}</span>}
              {lane?.failure !== undefined && <p role="alert">{lane.failure}</p>}
            </section>;
          })}
        </div>}
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
  const items = timelineItems(props.run.state);
  const warnings = props.run.state.warnings.length;
  const status = comparisonLaneStatus(props.run.state);
  const counts = [
    t("live.laneTools", { count: props.run.state.toolCallCount }),
    t("live.laneMessages", { count: items.filter((item) => item.kind === "message" && item.role === undefined).length }),
    ...(warnings > 0 ? [t("live.laneWarnings", { count: warnings })] : []),
  ].join(" · ");
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
  return <section className="live-compare-lane" aria-label={t("live.laneAria", { side: props.side, agent: props.label })}>
    <header>
      <strong>{props.label}</strong>
      <span className={`run-badge status-${status}`} role="status">{t(`live.status.${status}`)}</span>
      <small className="live-compare-counts">{counts}</small>
      {props.run.state.status === "running" && !props.run.state.conversation && !props.run.state.connection && <button type="button" disabled={cancelling} onClick={() => void cancel()}>{t(cancelling ? "live.cancelling" : "live.cancel")}</button>}
    </header>
    <AcpSessionStream revealTool={props.revealTool} actions={createAcpSessionActions(props.run.runId)} state={props.run.state} prompt={props.prompt} failure={actionError ?? props.run.failure} onPermission={props.onDecide} permissionClassName="live-compare-permission" agentId={props.run.agentId} />
  </section>;
}
