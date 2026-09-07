import { memo, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Play } from "@phosphor-icons/react/Play";
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

type LaneId = "left" | "right";

const LANES: readonly LaneId[] = ["left", "right"];

/** Distance from the bottom that still counts as following the stream. */
const FOLLOW_THRESHOLD_PX = 24;

interface LaneRun {
  agentId: string;
  runId: string;
  state: HarnessRunState;
  failure?: string;
}

/** One prompt dispatched to two independently selected Agents. */
interface LiveComparison {
  prompt: string;
  left: LaneRun;
  right: LaneRun;
}

function runIdentity(lane: LaneId): { threadId: string; runId: string } {
  const seed = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { threadId: `live-compare-${seed}`, runId: `live-${lane}-${seed}` };
}

export function CompareLiveView(props: {
  agents: readonly StudioAcpAgentOption[];
  project?: { id: string; label: string; revision: number };
}): React.JSX.Element {
  const { t } = useTranslation("compare");
  const [prompt, setPrompt] = useState("");
  // Both selections start empty: the reader states which two Agents answer the
  // prompt rather than inheriting a default that hides the choice.
  const [agentIds, setAgentIds] = useState<Record<LaneId, string>>({ left: "", right: "" });
  const [comparison, setComparison] = useState<LiveComparison>();
  const running = useRef(false);

  const available = props.agents.filter((agent) => agent.available);
  const chosen = LANES.every((lane) => agentIds[lane] !== "");
  const active = comparison !== undefined
    && LANES.some((lane) => comparison[lane].state.status === "running");
  const canRun = prompt.trim() !== "" && chosen && !active;

  useEffect(() => () => { running.current = false; }, []);

  function patchLane(lane: LaneId, update: (run: LaneRun) => LaneRun): void {
    setComparison((current) => current === undefined ? current : { ...current, [lane]: update(current[lane]) });
  }

  async function launch(): Promise<void> {
    if (!canRun) return;
    const task = prompt.trim();
    const identities = { left: runIdentity("left"), right: runIdentity("right") };
    const lane = (id: LaneId): LaneRun => ({
      agentId: agentIds[id],
      runId: identities[id].runId,
      state: { ...initialRunState(), status: "running" },
    });
    setComparison({ prompt: task, left: lane("left"), right: lane("right") });
    running.current = true;
    // Both lanes are launched together and settle independently, so a slow or
    // failing Agent never withholds the other lane's evidence.
    await Promise.all(LANES.map(async (id) => {
      const { threadId, runId } = identities[id];
      try {
        await streamRun(
          `api/acp/runs/stream?agent=${encodeURIComponent(agentIds[id])}`,
          task,
          threadId,
          runId,
          props.project,
          (events: HarnessRunStreamEventV1[]) => patchLane(id, (run) => ({
            ...run,
            state: events.reduce(applyHarnessRunEvent, run.state),
          })),
        );
      } catch (error) {
        patchLane(id, (run) => ({
          ...run,
          failure: error instanceof Error ? error.message : String(error),
          state: { ...run.state, status: "error" },
        }));
      }
    }));
    running.current = false;
  }

  async function cancel(lane: LaneId): Promise<void> {
    const runId = comparison?.[lane].runId;
    if (runId === undefined) return;
    await fetch(`api/acp/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" }).catch(() => undefined);
  }

  async function decide(lane: LaneId, requestId: string, optionId: string): Promise<void> {
    const runId = comparison?.[lane].runId;
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
        {LANES.map((lane) => <select
          key={lane}
          aria-label={t(`live.${lane}Agent`)}
          value={agentIds[lane]}
          onChange={(event) => setAgentIds((current) => ({ ...current, [lane]: event.target.value }))}
        >
          <option value="">{t("live.chooseAgent")}</option>
          {props.agents.map((agent) => <option key={agent.id} value={agent.id} disabled={!agent.available} title={agent.detail}>
            {agent.available ? agent.label : t("live.agentUnavailable", { agent: agent.label })}
          </option>)}
        </select>)}
        <button className="primary" type="submit" disabled={!canRun}>
          <Play aria-hidden="true" size={14} />
          <span>{active ? t("live.running") : t("live.run")}</span>
        </button>
      </div>
      {available.length === 0
        ? <p className="live-compare-boundary status-warning" role="alert">{t("live.noAgents")}</p>
        : <p className="live-compare-boundary">{t("live.sharedWorkingTree")}</p>}
    </form>

    {comparison === undefined
      ? <p className="artifact-status" role="status">{t("live.idle")}</p>
      : <div className="live-compare-lanes">
          {LANES.map((lane) => <LiveLane
            key={lane}
            side={t(`live.${lane}Agent`)}
            label={labelFor(comparison[lane].agentId)}
            run={comparison[lane]}
            onCancel={() => void cancel(lane)}
            onDecide={(requestId, optionId) => void decide(lane, requestId, optionId)}
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
  // describe rather than in a separate grid above both lanes. A warning count of
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
 * frames do not re-render the other's transcript.
 */
const LaneMessage = memo(function LaneMessage(
  { item }: { item: Extract<TimelineItem, { kind: "message" }> },
): React.JSX.Element {
  return <li className="live-compare-message"><StreamingMessage item={item} /></li>;
});
