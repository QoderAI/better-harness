import { memo, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Play } from "@phosphor-icons/react/Play";
import { Plus } from "@phosphor-icons/react/Plus";
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

/** One chosen (or not yet chosen) Agent slot in the composer. */
interface LaneSlot {
  key: string;
  agentId: string;
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
  // Every selection starts empty: the reader states which Agents answer the
  // prompt rather than inheriting a default that hides the choice.
  const [slots, setSlots] = useState<readonly LaneSlot[]>(
    () => Array.from({ length: MIN_LANES }, () => ({ key: laneKey(), agentId: "" })),
  );
  const [comparison, setComparison] = useState<LiveComparison>();
  const running = useRef(false);

  const available = props.agents.filter((agent) => agent.available);
  const chosen = slots.every((slot) => slot.agentId !== "");
  const active = comparison !== undefined
    && comparison.lanes.some((lane) => lane.state.status === "running");
  const canRun = prompt.trim() !== "" && chosen && !active;

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
    const started = slots.map((slot) => ({ slot, ...runIdentity(slot.key) }));
    setComparison({
      prompt: task,
      lanes: started.map(({ slot, runId }) => ({
        key: slot.key,
        agentId: slot.agentId,
        runId,
        state: { ...initialRunState(), status: "running" },
      })),
    });
    running.current = true;
    // Every lane is launched together and settles independently, so a slow or
    // failing Agent never withholds another lane's evidence.
    await Promise.all(started.map(async ({ slot, threadId, runId }) => {
      try {
        await streamRun(
          `api/acp/runs/stream?agent=${encodeURIComponent(slot.agentId)}`,
          task,
          threadId,
          runId,
          props.project,
          (events: HarnessRunStreamEventV1[]) => patchLane(slot.key, (run) => ({
            ...run,
            state: events.reduce(applyHarnessRunEvent, run.state),
          })),
        );
      } catch (error) {
        patchLane(slot.key, (run) => ({
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
      <div className="live-compare-agents">
        {slots.map((slot, index) => <div className="live-compare-agent-slot" key={slot.key}>
          <select
            aria-label={t("live.laneAgent", { index: index + 1 })}
            value={slot.agentId}
            onChange={(event) => setSlots((current) => current.map((candidate) =>
              candidate.key === slot.key ? { ...candidate, agentId: event.target.value } : candidate))}
          >
            <option value="">{t("live.chooseAgent")}</option>
            {props.agents.map((agent) => <option key={agent.id} value={agent.id} disabled={!agent.available} title={agent.detail}>
              {agent.available ? agent.label : t("live.agentUnavailable", { agent: agent.label })}
            </option>)}
          </select>
          {/* Removing is offered only above the floor, so the control never
              appears in a state where pressing it would be refused. */}
          {slots.length > MIN_LANES && <button
            className="live-compare-drop-agent"
            type="button"
            aria-label={t("live.removeAgent", { index: index + 1 })}
            onClick={() => setSlots((current) => current.filter((candidate) => candidate.key !== slot.key))}
          ><X aria-hidden="true" size={12} /></button>}
        </div>)}
        <div className="live-compare-agent-actions">
          {slots.length < MAX_LANES && <button
            type="button"
            onClick={() => setSlots((current) => [...current, { key: laneKey(), agentId: "" }])}
          >
            <Plus aria-hidden="true" size={12} />
            <span>{t("live.addAgent")}</span>
          </button>}
          <button className="primary" type="submit" disabled={!canRun}>
            <Play aria-hidden="true" size={14} />
            <span>{active ? t("live.running") : t("live.run", { count: slots.length })}</span>
          </button>
        </div>
      </div>
      {available.length === 0
        ? <p className="live-compare-boundary status-warning" role="alert">{t("live.noAgents")}</p>
        : <p className="live-compare-boundary">{t("live.sharedWorkingTree")}</p>}
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
