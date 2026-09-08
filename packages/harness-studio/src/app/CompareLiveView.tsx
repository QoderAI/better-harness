import { AcpConversationHistory } from "./run/AcpConversationHistory.js";
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

/** A comparison needs a second opinion; one lane is a Debugger run, not a compare. */
const MIN_LANES = 2;
/**
 * Every lane is one more Agent writing to the *same* working tree at the same
 * time, and one more ACP host process. Four keeps the side-by-side readable at
 * the widths this shell targets and bounds what a single click can start.
 */
const MAX_LANES = 4;

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
  // express the same Agent twice, so the composer can no longer be pointed at a
  // pair that is not a comparison.
  const [chosen, setChosen] = useSessionOwnedState<readonly string[]>(`${owner}:chosen`, []);
  const [comparison, setComparison, liveComparison] = useSessionOwnedState<LiveComparison | undefined>(`${owner}:comparison`, undefined);
  const [, , running] = useSessionOwnedState(`${owner}:running`, false);

  const available = props.agents.filter((agent) => agent.available);
  const active = comparison !== undefined
    && comparison.lanes.some((lane) => lane.state.status === "running");
  const canRun = prompt.trim() !== "" && chosen.length >= MIN_LANES && chosen.every((id) => available.some((agent) => agent.id === id)) && !active;


  function patchLane(key: string, update: (run: LaneRun) => LaneRun): void {
    const current = liveComparison.current;
    if (current === undefined) return;
    const next = { ...current, lanes: current.lanes.map((lane) => lane.key === key ? update(lane) : lane) };
    liveComparison.current = next;
    setComparison(next);
  }

  async function launch(prepare = false): Promise<void> {
    if (!canRun || running.current) return;
    running.current = true;
    const task = prompt.trim();
    const started = chosen.map((agentId) => {
      const key = laneKey();
      return { agentId, key, ...runIdentity(key) };
    });
    const next: LiveComparison = {
      prompt: task,
      lanes: started.map(({ agentId, key, runId }) => ({
        key,
        agentId,
        runId,
        state: { ...initialRunState(), runId, status: "running" },
      })),
    };
    liveComparison.current = next;
    setComparison(next);
    // Every lane is launched together and settles independently, so a slow or
    // failing Agent never withholds another lane's evidence.
    await Promise.all(started.map(async ({ agentId, key, threadId, runId }) => {
      try {
        await streamRun(
          `api/acp/runs/stream?conversation=1&agent=${encodeURIComponent(agentId)}${prepare ? "&prepare=1" : ""}`,
          task,
          threadId,
          runId,
          props.project,
          (events: HarnessRunStreamEventV1[]) => patchLane(key, (run) => ({
            ...run,
            state: events.reduce(applyHarnessRunEvent, run.state),
          })),
        );
      } catch (error) {
        patchLane(key, (run) => ({
          ...run,
          failure: error instanceof Error ? error.message : String(error),
          state: settleRunState({ ...run.state, status: "error" }, "interrupted"),
        }));
      }
    }));
    running.current = false;
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

  const [closeError, setCloseError] = useState<string>();
  async function newComparison(): Promise<void> {
    setCloseError(undefined);
    try {
      await Promise.all((comparison?.lanes ?? []).filter(lane => lane.state.status === "running").map(lane => createAcpSessionActions(lane.runId).execute({ action: "close" })));
      running.current = false; liveComparison.current = undefined; setComparison(undefined);
    } catch (error) { setCloseError(String(error)); }
  }
  const labelFor = (agentId: string): string => props.agents.find((agent) => agent.id === agentId)?.label ?? agentId;

  // No page title or eyebrow: the shell title bar and the sidebar already name
  // this area, and the composer states the decision on its own.
  return <main className="live-compare-workspace" aria-label={t("live.title")}>
    {/* One control, not four regions: the shell owns the border and the focus
        ring, the prompt sits inside it, and the Agent decision plus Run read as
        the composer's own toolbar row. */}
    {closeError && <p role="alert">{closeError}</p>}
    {!comparison && <AcpConversationHistory project={props.project} />}
    {comparison && <div className="acp-compare-toolbar"><SharedTreeNote /><button type="button" onClick={() => void newComparison()}>{t("live.newComparison")}</button></div>}
    <form
      hidden={comparison !== undefined}
      className="live-compare-composer"
      onSubmit={(event) => { event.preventDefault(); void launch(); }}
    >
      <textarea
        className="live-compare-prompt"
        value={prompt}
        rows={2}
        aria-label={t("live.promptLabel")}
        placeholder={t("live.promptPlaceholder")}
        onChange={(event) => setPrompt(event.target.value)}
      />
      <div className="live-compare-bar">
        <AgentPicker
          agents={props.agents}
          chosen={chosen}
          disabled={available.length === 0}
          onToggle={(agentId) => setChosen((current) => current.includes(agentId)
            ? current.filter((candidate) => candidate !== agentId)
            : current.length < MAX_LANES ? [...current, agentId] : current)}
        />
        {/* Removal is named after the Agent it drops rather than a lane index,
            so the control reads the same before and after the row reflows. */}
        {chosen.map((agentId) => <span className="live-compare-chip" key={agentId}>
          <span>{labelFor(agentId)}</span>
          <button
            type="button"
            aria-label={t("live.removeChosenAgent", { agent: labelFor(agentId) })}
            onClick={() => setChosen((current) => current.filter((candidate) => candidate !== agentId))}
          ><X aria-hidden="true" size={11} /></button>
        </span>)}
        {/* Exactly one note, chosen by state. The overwrite consequence is only
            true once two Agents will actually write, so below the floor the row
            states the prerequisite for Run instead. */}
        {available.length === 0
          ? <p className="live-compare-note status-warning" role="alert">{t("live.noAgents")}</p>
          : chosen.length < MIN_LANES
            ? <p className="live-compare-note">{t("live.agentFloor", { count: MIN_LANES })}</p>
            : <SharedTreeNote />}
        {!active && <button type="button" disabled={!canRun} onClick={() => void launch(true)}>{t("live.prepare")}</button>}
        <button className="primary live-compare-run" type="submit" disabled={!canRun}>
          <Play aria-hidden="true" size={14} />
          <span>{active
            ? t(comparison?.lanes.some((lane) => lane.state.acp.prepared) ? "live.configuring" : "live.running")
            : chosen.length < MIN_LANES ? t("live.runIdle") : t("live.run", { count: chosen.length })}</span>
        </button>
      </div>
    </form>

    {comparison === undefined
      ? <p className="artifact-status" role="status">{t("live.idle")}</p>
      : <div className="live-compare-lanes">
          {comparison.lanes.map((lane, index) => <LiveLane
            key={lane.key}
            side={t("live.laneAgent", { index: index + 1 })}
            label={labelFor(lane.agentId)}
            run={lane}
            prompt={comparison.prompt}
            onCancel={() => cancel(lane.key)}
            onDecide={(requestId, optionId) => decide(lane.key, requestId, optionId)}
          />)}
        </div>}
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
      <span className={`run-badge status-${props.run.state.status}`} role="status">{t((props.run.state.acp.prepared || props.run.state.conversation?.status === "idle") ? "live.ready" : `live.status.${props.run.state.status}`)}</span>
      <small className="live-compare-counts">{counts}</small>
      {props.run.state.status === "running" && !props.run.state.conversation && <button type="button" disabled={cancelling} onClick={() => void cancel()}>{t(cancelling ? "live.cancelling" : "live.cancel")}</button>}
    </header>
    <AcpSessionStream actions={createAcpSessionActions(props.run.runId)} state={props.run.state} prompt={props.prompt} failure={actionError ?? props.run.failure} onPermission={props.onDecide} permissionClassName="live-compare-permission" />
  </section>;
}
