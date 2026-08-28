import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ExperimentToolCall } from "../../contracts/experiment-stream-contract.js";
import { resourceComparisonRows } from "./experiment-comparison-model.js";
import { summarizeToolResult, type ToolOperation, type ToolOperationKind } from "./experiment-trace-model.js";
import type { ExperimentPreview, LaneDefinition, LaneTrace } from "./experiment-view-types.js";

type SimpleResultView = "resources" | "messages";

export function SimpleCompareView(props: {
  preview: ExperimentPreview;
  lanes: Record<string, LaneTrace>;
  baselineId: string;
  candidateId: string;
  prompt: string;
  submittedPrompt: string | null;
  running: boolean;
  runError?: string;
  agentIds: Record<string, string>;
  onPrompt: (value: string) => void;
  onAgent: (laneId: string, agentId: string) => void;
  onRun: () => void;
  onCancel: () => void;
  onPermission: (laneId: string, runId: string, requestId: string, optionId: string) => void;
  onAdvanced: () => void;
}): React.JSX.Element {
  const baseline = props.preview.manifest.lanes.find((lane) => lane.id === props.baselineId);
  const candidate = props.preview.manifest.lanes.find((lane) => lane.id === props.candidateId);
  const baselineLane = props.lanes[props.baselineId];
  const candidateLane = props.lanes[props.candidateId];
  const project = props.preview.setup.checkpointSource.resource;
  const revision = props.preview.setup.checkpointSource.revision;
  const [resultView, setResultView] = useState<SimpleResultView>("messages");
  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null);
  const agentProfiles = props.preview.acpAgents?.agents ?? [];
  const baselineAgent = agentProfiles.find((agent) => agent.id === props.agentIds[props.baselineId]);
  const candidateAgent = agentProfiles.find((agent) => agent.id === props.agentIds[props.candidateId]);
  const needsAcpAgents = props.preview.manifest.runtime?.host === "acp";
  const agentsReady = !needsAcpAgents || (baselineAgent?.available === true && candidateAgent?.available === true);
  const hasRun = props.submittedPrompt !== null;
  useEffect(() => {
    if (props.running) {
      setResultView("messages");
      setSelectedOperationId(null);
      return;
    }
    if (hasRun && isSettled(baselineLane) && isSettled(candidateLane)) setResultView("resources");
  }, [props.running, hasRun, baselineLane?.status, candidateLane?.status]);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!props.running && props.prompt.trim() !== "" && agentsReady) props.onRun();
  };
  const selectResultViewFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const views: SimpleResultView[] = ["resources", "messages"];
    const current = views.indexOf(resultView);
    const next = event.key === "ArrowRight" ? (current + 1) % views.length
      : event.key === "ArrowLeft" ? (current - 1 + views.length) % views.length
        : event.key === "Home" ? 0
          : event.key === "End" ? views.length - 1
            : -1;
    if (next < 0) return;
    event.preventDefault();
    setResultView(views[next]!);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  return <section className="simple-compare-shell">
    <main className="simple-compare-main">
      <form className={`simple-compare-composer${needsAcpAgents ? " has-agent-catalog" : ""}`} onSubmit={submit}>
        <div className="simple-project-control" aria-label="Checkpoint project">
          <span>Checkpoint project</span>
          <strong>{project.value}</strong>
          <span id="compare-project-detail">Current checkpoint · {revision.value}</span>
        </div>
        {needsAcpAgents && <div className="simple-agent-controls" aria-label="ACP Agents">
          <AgentSelect
            id="compare-baseline-agent"
            label="AI 1 Agent"
            profiles={agentProfiles}
            value={props.agentIds[props.baselineId] ?? ""}
            disabled={props.running}
            onChange={(value) => props.onAgent(props.baselineId, value)}
          />
          <AgentSelect
            id="compare-candidate-agent"
            label="AI 2 Agent"
            profiles={agentProfiles}
            value={props.agentIds[props.candidateId] ?? ""}
            disabled={props.running}
            onChange={(value) => props.onAgent(props.candidateId, value)}
          />
        </div>}
        <label className="simple-prompt-control" htmlFor="compare-prompt">
          <span>User prompt</span>
          <textarea
            id="compare-prompt"
            value={props.prompt}
            onChange={(event) => props.onPrompt(event.target.value)}
            placeholder="Ask both AIs to work on this project…"
            rows={4}
          />
        </label>
        <div className="simple-run-control">
          <span role="status" aria-live="polite">
            {props.running ? "Both AIs are running…" : props.runError ?? (agentsReady ? "Ready" : "Select an available ACP Agent for both AIs")}
          </span>
          <div>
            <button className="secondary" type="button" onClick={props.onAdvanced}>Advanced evidence</button>
            {props.running
              ? <button className="secondary cancel-comparison" type="button" onClick={props.onCancel}>Cancel</button>
              : <button type="submit" disabled={props.prompt.trim() === "" || !agentsReady}>Run compare</button>}
          </div>
        </div>
      </form>

      <section className="simple-compare-results" aria-label="Comparison result">
        {hasRun && <header className="simple-result-toolbar">
          <div>
            <strong>{resultView === "resources" ? "Resource map" : "Messages"}</strong>
            <span>{resultView === "resources"
              ? "Recorded operations aligned by project resource."
              : "Original assistant messages and ACP tool calls."}</span>
          </div>
          <div className="simple-result-switcher" role="tablist" aria-label="Comparison result views">
            <button id="simple-tab-resources" type="button" role="tab" aria-controls="simple-panel-resources" aria-selected={resultView === "resources"} tabIndex={resultView === "resources" ? 0 : -1} onKeyDown={selectResultViewFromKeyboard} onClick={() => setResultView("resources")}>Resources</button>
            <button id="simple-tab-messages" type="button" role="tab" aria-controls="simple-panel-messages" aria-selected={resultView === "messages"} tabIndex={resultView === "messages" ? 0 : -1} onKeyDown={selectResultViewFromKeyboard} onClick={() => setResultView("messages")}>Messages</button>
          </div>
        </header>}
        {hasRun && resultView === "resources"
          ? <ResourceMap
              baseline={baseline}
              candidate={candidate}
              baselineLane={baselineLane}
              candidateLane={candidateLane}
              selectedOperationId={selectedOperationId}
              onSelectOperation={(id) => setSelectedOperationId((current) => current === id ? null : id)}
              baselineAgentLabel={baselineAgent?.label}
              candidateAgentLabel={candidateAgent?.label}
              baselineModelLabel={agentModelName(baseline, baselineAgent)}
              candidateModelLabel={agentModelName(candidate, candidateAgent)}
            />
          : <section id="simple-panel-messages" className="simple-lane-grid" role="tabpanel" aria-labelledby="simple-tab-messages" aria-label="AI message streams">
              <SimpleLane
                role="AI 1"
                definition={baseline}
                lane={baselineLane}
                submittedPrompt={props.submittedPrompt}
                agentLabel={baselineAgent?.label}
                modelLabel={agentModelName(baseline, baselineAgent)}
                onPermission={(runId, requestId, optionId) => props.onPermission(props.baselineId, runId, requestId, optionId)}
              />
              <SimpleLane
                role="AI 2"
                definition={candidate}
                lane={candidateLane}
                submittedPrompt={props.submittedPrompt}
                agentLabel={candidateAgent?.label}
                modelLabel={agentModelName(candidate, candidateAgent)}
                onPermission={(runId, requestId, optionId) => props.onPermission(props.candidateId, runId, requestId, optionId)}
              />
            </section>}
      </section>
    </main>
  </section>;
}

function AgentSelect(props: {
  id: string;
  label: string;
  profiles: Array<{
    id: string;
    label: string;
    available: boolean;
    modelPolicy: "lane" | "agent-default";
    detail: string;
  }>;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}): React.JSX.Element {
  const selected = props.profiles.find((profile) => profile.id === props.value);
  return <label className="simple-agent-control" htmlFor={props.id}>
    <span>{props.label}</span>
    <select id={props.id} value={props.value} disabled={props.disabled} onChange={(event) => props.onChange(event.target.value)}>
      {props.profiles.map((profile) => <option key={profile.id} value={profile.id} disabled={!profile.available}>
        {profile.label}{profile.available ? "" : " · unavailable"}
      </option>)}
    </select>
    <small>{selected?.detail ?? "No ACP Agent is available on this Studio server."}</small>
  </label>;
}

function ResourceMap(props: {
  baseline?: LaneDefinition;
  candidate?: LaneDefinition;
  baselineLane?: LaneTrace;
  candidateLane?: LaneTrace;
  selectedOperationId: string | null;
  onSelectOperation: (id: string) => void;
  baselineAgentLabel?: string;
  candidateAgentLabel?: string;
  baselineModelLabel: string;
  candidateModelLabel: string;
}): React.JSX.Element {
  const baselineCalls = props.baselineLane?.calls ?? [];
  const candidateCalls = props.candidateLane?.calls ?? [];
  const rows = useMemo(
    () => resourceComparisonRows(baselineCalls, candidateCalls),
    [baselineCalls, candidateCalls],
  );
  const selected = rows.flatMap((row) => [...row.baseline, ...row.candidate])
    .find((operation) => operation.id === props.selectedOperationId);
  const shared = rows.filter((row) => row.baseline.length > 0 && row.candidate.length > 0).length;
  const changed = rows.filter((row) => [...row.baseline, ...row.candidate].some((operation) => operation.kind === "edit"));
  const baselineModel = props.baselineModelLabel;
  const candidateModel = props.candidateModelLabel;

  return <section id="simple-panel-resources" className="simple-resource-map" role="tabpanel" aria-labelledby="simple-tab-resources" aria-label="Resource comparison">
    <p className="resource-map-summary" role="status">
      <strong>{shared} shared</strong>
      <span>{rows.length} observed resources</span>
      <span>{changed.length === 0 ? "No recorded edits" : `${changed.length} edited`}</span>
    </p>
    <div className="resource-map-table" role="table" aria-label="ACP operations aligned by resource">
      <div className="resource-map-header" role="row">
        <div role="columnheader"><span>AI 1</span><strong>{props.baselineAgentLabel ?? "Agent"} · {baselineModel}</strong><em className={`lane-status lane-status-${props.baselineLane?.status ?? "idle"}`}>{props.baselineLane?.status ?? "idle"}</em></div>
        <div role="columnheader">Resource</div>
        <div role="columnheader"><span>AI 2</span><strong>{props.candidateAgentLabel ?? "Agent"} · {candidateModel}</strong><em className={`lane-status lane-status-${props.candidateLane?.status ?? "idle"}`}>{props.candidateLane?.status ?? "idle"}</em></div>
      </div>
      {rows.length === 0
        ? <p className="resource-map-empty">Waiting for recorded file and command activity…</p>
        : rows.map((row) => <div className="resource-map-row" role="row" key={row.resource}>
            <div className="resource-map-operations baseline-operations" role="cell">
              {row.baseline.map((operation) => <OperationButton
                key={operation.id}
                operation={operation}
                role="AI 1"
                selected={operation.id === selected?.id}
                onSelect={props.onSelectOperation}
              />)}
              {selected !== undefined && row.baseline.some((operation) => operation.id === selected.id) && <OperationInspector
                operation={selected}
                call={baselineCalls.find((call) => call.id === selected.callId)}
                laneLabel="AI 1"
              />}
              {row.baseline.length === 0 && <span className="resource-map-none">No recorded operation</span>}
            </div>
            <div className="resource-map-resource" role="rowheader">
              <code>{displayResource(row.resource)}</code>
              <span>{row.baseline.length > 0 && row.candidate.length > 0 ? "shared" : "one run only"}</span>
            </div>
            <div className="resource-map-operations candidate-operations" role="cell">
              {row.candidate.map((operation) => <OperationButton
                key={operation.id}
                operation={operation}
                role="AI 2"
                selected={operation.id === selected?.id}
                onSelect={props.onSelectOperation}
              />)}
              {selected !== undefined && row.candidate.some((operation) => operation.id === selected.id) && <OperationInspector
                operation={selected}
                call={candidateCalls.find((call) => call.id === selected.callId)}
                laneLabel="AI 2"
              />}
              {row.candidate.length === 0 && <span className="resource-map-none">No recorded operation</span>}
            </div>
          </div>)}
    </div>
  </section>;
}

function OperationButton(props: {
  operation: ToolOperation;
  role: string;
  selected: boolean;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  const label = operationLabel(props.operation.kind);
  return <button
    className={`resource-operation operation-${props.operation.kind}`}
    type="button"
    aria-pressed={props.selected}
    aria-label={`${props.role} ${label} ${displayResource(props.operation.resource)}, call ${Math.floor(props.operation.callSequence) + 1}, ${props.operation.status}`}
    onClick={() => props.onSelect(props.operation.id)}
  >
    <strong>{label}</strong>
    <span>Call {Math.floor(props.operation.callSequence) + 1}</span>
    <em>{props.operation.status}</em>
  </button>;
}

function OperationInspector(props: {
  operation?: ToolOperation;
  call?: ExperimentToolCall;
  laneLabel: string;
}): React.JSX.Element {
  if (props.operation === undefined || props.call === undefined) {
    return <aside className="operation-inspector empty" aria-label="Tool result">
      <strong>Tool result</strong>
      <span>Select an operation to inspect its recorded call and result.</span>
    </aside>;
  }
  const result = summarizeToolResult(props.call);
  return <aside className="operation-inspector" aria-label="Tool result">
    <header>
      <div><strong>{props.laneLabel} · {operationLabel(props.operation.kind)} {displayResource(props.operation.resource)}</strong><span>{props.call.name}</span></div>
      <em className={`operation-outcome outcome-${result.outcome}`}>{result.outcome}</em>
    </header>
    <dl>
      <div><dt>Call</dt><dd>{props.operation.callSequence + 1}</dd></div>
      <div><dt>Exit code</dt><dd>{result.exitCode ?? "Not recorded"}</dd></div>
      <div><dt>Duration</dt><dd>{result.durationMs === undefined ? "Not recorded" : `${result.durationMs} ms`}</dd></div>
    </dl>
    {result.excerpt !== undefined && <pre>{result.excerpt}</pre>}
  </aside>;
}

function isSettled(lane: LaneTrace | undefined): boolean {
  return lane !== undefined && ["finished", "failed", "cancelled"].includes(lane.status);
}

function modelName(definition: LaneDefinition | undefined, fallback: string): string {
  return definition?.runtime?.model ?? definition?.id ?? fallback;
}

function agentModelName(
  definition: LaneDefinition | undefined,
  agent: { modelPolicy: "lane" | "agent-default" } | undefined,
): string {
  return agent?.modelPolicy === "agent-default" ? "Agent default model" : modelName(definition, "AI");
}

function displayResource(resource: string): string {
  return resource === "." ? "Project root" : resource;
}

function operationLabel(kind: ToolOperationKind): string {
  return kind === "read" ? "Read"
    : kind === "edit" ? "Edit"
      : kind === "search" ? "Search"
        : kind === "list" ? "List"
          : kind === "verify" ? "Verify"
            : "Run";
}

function SimpleLane(props: {
  role: string;
  definition?: LaneDefinition;
  lane?: LaneTrace;
  submittedPrompt: string | null;
  agentLabel?: string;
  modelLabel?: string;
  onPermission: (runId: string, requestId: string, optionId: string) => void;
}): React.JSX.Element {
  const lane = props.lane ?? {
    status: "idle" as const,
    calls: [],
    eventCount: 0,
    protocolFrameCount: 0,
    acpSessionIds: [],
    pendingPermissions: [],
    activities: [],
  };
  const model = props.modelLabel ?? props.definition?.runtime?.model ?? props.definition?.id ?? "AI";
  return <article className="simple-lane">
    <header>
      <div><small>{props.role}</small><strong>{model}</strong><em>{props.agentLabel ?? "Agent"}</em></div>
      <span className={`lane-status lane-status-${lane.status}`}>{lane.status}</span>
    </header>
    <div className="simple-message-stream" aria-live="polite" aria-label={`${model} messages`}>
      {props.submittedPrompt !== null && <section className="simple-message user-message"><small>You</small><p>{props.submittedPrompt}</p></section>}
      {lane.activities.map((activity) => {
        if (activity.kind === "assistant") {
          return <section className="simple-message assistant-message" key={activity.id}>
            <small>{model}</small>
            <p>{activity.text || (activity.complete ? "No text response." : "Thinking…")}</p>
          </section>;
        }
        const call = lane.calls.find((item) => item.id === `${activity.runId}:${activity.toolCallId}`);
        return <div className="simple-tool-activity" key={activity.id}>
          <span>{call?.status === "running" ? "Running" : call?.status ?? "Observed"}</span>
          <strong>{call?.name ?? "Tool"}</strong>
        </div>;
      })}
      {props.submittedPrompt === null && lane.activities.length === 0 && <p className="simple-stream-empty">Run once to see this AI's messages and tool activity here.</p>}
      {props.submittedPrompt !== null && lane.activities.length === 0 && lane.status !== "failed" && <p className="simple-stream-empty">Waiting for this AI…</p>}
      {lane.pendingPermissions.map((permission) => <section className="simple-permission" key={`${permission.runId}:${permission.requestId}`}>
        <div><small>Permission needed</small><strong>{permission.title}</strong></div>
        <div>{permission.options.map((option) => <button key={option.optionId} type="button" onClick={() => props.onPermission(permission.runId, permission.requestId, option.optionId)}>{option.name}</button>)}</div>
      </section>)}
      {lane.detail && <p className="simple-lane-error">{lane.detail}</p>}
    </div>
  </article>;
}
