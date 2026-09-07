import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import { Play } from "@phosphor-icons/react/Play";
import type { HarnessRunStreamEventV1 } from "@qoder-ai/harness/protocol";
import {
  applyHarnessRunEvent,
  initialRunState,
  timelineItems,
  type HarnessRunState,
} from "./run/run-store.js";
import { streamRun } from "./run/stream-run.js";
import type { StudioAcpAgentOption } from "./studio-shell-model.js";

type LaneId = "left" | "right";

const LANES: readonly LaneId[] = ["left", "right"];

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
  navigation: ReactNode;
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

  return <main className="live-compare-workspace">
    <header>
      <div><small>{t("live.eyebrow")}</small><h1>{t("live.title")}</h1></div>
      {props.navigation}
    </header>

    <form
      className="live-compare-composer"
      onSubmit={(event) => { event.preventDefault(); void launch(); }}
    >
      <label className="live-compare-prompt">
        <span>{t("live.promptLabel")}</span>
        <textarea
          value={prompt}
          rows={3}
          placeholder={t("live.promptPlaceholder")}
          onChange={(event) => setPrompt(event.target.value)}
        />
      </label>
      <div className="live-compare-agents">
        {LANES.map((lane) => <label key={lane}>
          <span>{t(`live.${lane}Agent`)}</span>
          <select
            value={agentIds[lane]}
            onChange={(event) => setAgentIds((current) => ({ ...current, [lane]: event.target.value }))}
          >
            <option value="">{t("live.chooseAgent")}</option>
            {props.agents.map((agent) => <option key={agent.id} value={agent.id} disabled={!agent.available} title={agent.detail}>
              {agent.available ? agent.label : t("live.agentUnavailable", { agent: agent.label })}
            </option>)}
          </select>
        </label>)}
        <button className="primary" type="submit" disabled={!canRun}>
          <Play aria-hidden="true" size={14} />
          <span>{active ? t("live.running") : t("live.run")}</span>
        </button>
      </div>
      {available.length === 0
        ? <p className="live-compare-boundary status-warning" role="alert">{t("live.noAgents")}</p>
        : <p className="live-compare-boundary status-warning">{t("live.sharedWorkingTree")}</p>}
    </form>

    {comparison === undefined
      ? <p className="artifact-status" role="status">{t("live.idle")}</p>
      : <>
          <p className="live-compare-boundary">
            <strong>{t("live.noWinner")}</strong> {t("live.samePrompt", { prompt: comparison.prompt })}
          </p>
          <div className="live-compare-metrics" role="table" aria-label={t("live.metricsAria")}>
            <div className="live-compare-columns" role="row">
              <strong role="columnheader">{t("live.metricColumn")}</strong>
              <strong role="columnheader">{labelFor(comparison.left.agentId)}</strong>
              <strong role="columnheader">{labelFor(comparison.right.agentId)}</strong>
            </div>
            {([
              ["status", (run: LaneRun) => t(`live.status.${run.state.status}`)],
              ["toolCalls", (run: LaneRun) => String(run.state.toolCallCount)],
              ["messages", (run: LaneRun) => String(timelineItems(run.state).filter((item) => item.kind === "message").length)],
              ["warnings", (run: LaneRun) => String(run.state.warnings.length)],
            ] as const).map(([metric, read]) => <div role="row" key={metric}>
              <strong role="rowheader">{t(`live.metrics.${metric}`)}</strong>
              <span role="cell">{read(comparison.left)}</span>
              <span role="cell">{read(comparison.right)}</span>
            </div>)}
          </div>
          <div className="live-compare-lanes">
            {LANES.map((lane) => <LiveLane
              key={lane}
              side={t(`live.${lane}Agent`)}
              label={labelFor(comparison[lane].agentId)}
              run={comparison[lane]}
              onCancel={() => void cancel(lane)}
              onDecide={(requestId, optionId) => void decide(lane, requestId, optionId)}
            />)}
          </div>
        </>}
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
  return <section className="live-compare-lane" aria-label={t("live.laneAria", { side: props.side, agent: props.label })}>
    <header>
      <div><small>{props.side}</small><strong>{props.label}</strong></div>
      <span className={`run-badge status-${props.run.state.status}`}>{t(`live.status.${props.run.state.status}`)}</span>
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
    <ol className="live-compare-events">
      {items.length === 0
        ? <li className="live-compare-waiting">{t("live.waiting")}</li>
        : items.map((item) => item.kind === "message"
          ? <li key={`message-${item.id}`} className="live-compare-message">{item.text}</li>
          : <li key={`tool-${item.id}`} className={`live-compare-tool status-${item.status}`}>
              <strong>{item.name}</strong>
              <small>{t(`live.toolStatus.${item.status}`)}</small>
            </li>)}
    </ol>
  </section>;
}
