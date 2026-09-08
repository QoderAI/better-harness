import { memo, useEffect, useId, useRef, useState } from "react";
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
  type HarnessRunState,
  type TimelineItem,
} from "./run/run-store.js";
import { streamRun } from "./run/stream-run.js";
import { StreamingMessage } from "./run/StreamingMessage.js";
import type { StudioAcpAgentOption } from "./studio-shell-model.js";

/** A comparison needs a second opinion; one lane is a Debugger run, not a compare. */
const MIN_LANES = 2;
/**
 * Every lane is one more Agent writing to the *same* working tree at the same
 * time, and one more ACP host process. Four keeps the side-by-side readable at
 * the widths this shell targets and bounds what a single click can start.
 */
const MAX_LANES = 4;

/** Distance from the bottom that still counts as following the stream. */
const FOLLOW_THRESHOLD_PX = 24;

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
  const [prompt, setPrompt] = useState("");
  // The chosen Agents are a set, in the order they were chosen. A set cannot
  // express the same Agent twice, so the composer can no longer be pointed at a
  // pair that is not a comparison.
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const [comparison, setComparison] = useState<LiveComparison>();
  const running = useRef(false);

  const available = props.agents.filter((agent) => agent.available);
  const active = comparison !== undefined
    && comparison.lanes.some((lane) => lane.state.status === "running");
  const canRun = prompt.trim() !== "" && chosen.length >= MIN_LANES && !active;

  useEffect(() => () => { running.current = false; }, []);

  function patchLane(key: string, update: (run: LaneRun) => LaneRun): void {
    setComparison((current) => current === undefined ? current : {
      ...current,
      lanes: current.lanes.map((lane) => lane.key === key ? update(lane) : lane),
    });
  }

  async function launch(): Promise<void> {
    if (!canRun) return;
    const task = prompt.trim();
    const started = chosen.map((agentId) => {
      const key = laneKey();
      return { agentId, key, ...runIdentity(key) };
    });
    setComparison({
      prompt: task,
      lanes: started.map(({ agentId, key, runId }) => ({
        key,
        agentId,
        runId,
        state: { ...initialRunState(), status: "running" },
      })),
    });
    running.current = true;
    // Every lane is launched together and settles independently, so a slow or
    // failing Agent never withholds another lane's evidence.
    await Promise.all(started.map(async ({ agentId, key, threadId, runId }) => {
      try {
        await streamRun(
          `api/acp/runs/stream?agent=${encodeURIComponent(agentId)}`,
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
          state: { ...run.state, status: "error" },
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
    await fetch(`api/acp/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" }).catch(() => undefined);
  }

  async function decide(key: string, requestId: string, optionId: string): Promise<void> {
    const runId = runIdFor(key);
    if (runId === undefined) return;
    await fetch(`api/acp/runs/${encodeURIComponent(runId)}/permissions/${encodeURIComponent(requestId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ optionId }),
    }).catch(() => undefined);
  }

  const labelFor = (agentId: string): string => props.agents.find((agent) => agent.id === agentId)?.label ?? agentId;

  // No page title or eyebrow: the shell title bar and the sidebar already name
  // this area, and the composer states the decision on its own.
  return <main className="live-compare-workspace" aria-label={t("live.title")}>
    {/* One control, not four regions: the shell owns the border and the focus
        ring, the prompt sits inside it, and the Agent decision plus Run read as
        the composer's own toolbar row. */}
    <form
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
        <button className="primary live-compare-run" type="submit" disabled={!canRun}>
          <Play aria-hidden="true" size={14} />
          <span>{active
            ? t("live.running")
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
            onCancel={() => void cancel(lane.key)}
            onDecide={(requestId, optionId) => void decide(lane.key, requestId, optionId)}
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
  run: LaneRun;
  onCancel: () => void;
  onDecide: (requestId: string, optionId: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation("compare");
  const items = timelineItems(props.run.state);
  const permission = props.run.state.pendingPermission;
  const warnings = props.run.state.warnings.length;
  // The counts the removed metric table carried, next to the evidence they
  // describe rather than in a separate grid above every lane. A warning count of
  // zero is not a fact worth spending a lane header on.
  const counts = [
    t("live.laneTools", { count: props.run.state.toolCallCount }),
    t("live.laneMessages", { count: items.filter((item) => item.kind === "message").length }),
    ...(warnings > 0 ? [t("live.laneWarnings", { count: warnings })] : []),
  ].join(" · ");
  const events = useRef<HTMLOListElement>(null);
  const following = useRef(true);

  // Follow the newest event only while the reader is already at the bottom.
  // Scrolling up is a deliberate act of reading back; the stream must not undo
  // it. Measured before paint so the check uses the pre-append position.
  useEffect(() => {
    const list = events.current;
    if (list === null || !following.current) return;
    list.scrollTop = list.scrollHeight;
  });

  return <section className="live-compare-lane" aria-label={t("live.laneAria", { side: props.side, agent: props.label })}>
    <header>
      <strong>{props.label}</strong>
      <span className={`run-badge status-${props.run.state.status}`}>{t(`live.status.${props.run.state.status}`)}</span>
      <small className="live-compare-counts">{counts}</small>
      {props.run.state.status === "running" && <button type="button" onClick={props.onCancel}>{t("live.cancel")}</button>}
    </header>
    {props.run.failure !== undefined && <p className="live-compare-boundary status-danger" role="alert">{props.run.failure}</p>}
    {props.run.state.error !== undefined && props.run.failure === undefined
      && <p className="live-compare-boundary status-danger" role="alert">{props.run.state.error}</p>}
    {permission !== undefined && <div className="live-compare-permission" role="alertdialog" aria-label={t("live.permissionAria")}>
      <strong>{permission.title}</strong>
      <div>{permission.options.map((option) => <button
        key={option.optionId}
        type="button"
        onClick={() => props.onDecide(permission.requestId, option.optionId)}
      >{option.name}</button>)}</div>
    </div>}
    <ol
      className="live-compare-events"
      ref={events}
      onScroll={(event) => {
        const list = event.currentTarget;
        following.current = list.scrollHeight - list.scrollTop - list.clientHeight <= FOLLOW_THRESHOLD_PX;
      }}
    >
      {items.length === 0
        ? <li className="live-compare-waiting">{t("live.waiting")}</li>
        : items.map((item) => item.kind === "message"
          ? <LaneMessage key={`message-${item.id}`} item={item} />
          : <li key={`tool-${item.id}`} className={`live-compare-tool status-${item.status}`}>
              <strong>{item.name}</strong>
              <small>{t(`live.toolStatus.${item.status}`)}</small>
            </li>)}
    </ol>
  </section>;
}

/**
 * One assistant message, revealed rather than repainted.
 *
 * An ACP Agent's text reaches the browser in coalesced bursts, so rendering the
 * delta directly makes a live turn land as a block. Memoized so one lane's
 * frames do not re-render another's transcript.
 */
const LaneMessage = memo(function LaneMessage(
  { item }: { item: Extract<TimelineItem, { kind: "message" }> },
): React.JSX.Element {
  return <li className="live-compare-message"><StreamingMessage item={item} /></li>;
});
