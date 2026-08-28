import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ExperimentToolCall } from "../../contracts/experiment-stream-contract.js";
import { isExperimentRunnable } from "../../contracts/experiment-setup.js";
import {
  deriveSimpleComparisonScope,
  deriveSimpleResultFacts,
  resourceComparisonRows,
  type SimpleLaneFacts,
} from "./experiment-comparison-model.js";
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
  onSetup: () => void;
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
  const checkpointReady = isExperimentRunnable(props.preview.setup);
  const runReady = checkpointReady && agentsReady;
  const runtimeLabel = needsAcpAgents ? undefined : "Qoder";
  const readyMessage = !checkpointReady
    ? props.preview.setup.checkpointSource.limitation ?? "The checkpoint source cannot create isolated fresh runs."
    : agentsReady
      ? "Ready"
      : "Select an available ACP Agent for both AIs";
  const hasRun = props.submittedPrompt !== null;
  const baselineModelLabel = agentModelName(baseline, baselineAgent);
  const candidateModelLabel = agentModelName(candidate, candidateAgent);
  const comparisonScope = deriveSimpleComparisonScope(baseline, candidate, baselineAgent, candidateAgent);
  const resultFacts = deriveSimpleResultFacts(baselineLane ?? emptySimpleLane(), candidateLane ?? emptySimpleLane());
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
    if (!props.running && props.prompt.trim() !== "" && runReady) props.onRun();
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
        <div className="simple-project-control" role="group" aria-label="Current project">
          <span>Current project</span>
          <div className="simple-project-value">
            <strong>{project.value}</strong>
            <code title={revision.value}>{shortRevision(revision.value)}</code>
          </div>
          <small>Same checkpoint for both AIs</small>
        </div>
        {needsAcpAgents && <div className="simple-agent-controls" aria-label="ACP Agents">
          <AgentSelect
            id="compare-baseline-agent"
            label="AI 1 Agent"
            profiles={agentProfiles}
            value={props.agentIds[props.baselineId] ?? ""}
            modelLabel={baselineModelLabel}
            disabled={props.running}
            onChange={(value) => props.onAgent(props.baselineId, value)}
          />
          <AgentSelect
            id="compare-candidate-agent"
            label="AI 2 Agent"
            profiles={agentProfiles}
            value={props.agentIds[props.candidateId] ?? ""}
            modelLabel={candidateModelLabel}
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
        <div className={`simple-run-control scope-${comparisonScope.kind}`}>
          <div className="simple-scope-copy" role="region" aria-label="Comparison scope">
            <small>Comparison scope</small>
            <strong>{comparisonScope.title}</strong>
            <span>{comparisonScope.detail}</span>
            <em role="status" aria-live="polite">
              {props.running ? "Both AIs are running…" : props.runError ?? readyMessage}
            </em>
          </div>
          <div className="simple-run-actions">
            <button className="secondary" type="button" onClick={props.onSetup}>Review setup</button>
            <button className="secondary simple-advanced-action" type="button" disabled={!checkpointReady} onClick={props.onAdvanced}>Advanced details</button>
            {props.running
              ? <button className="secondary cancel-comparison" type="button" onClick={props.onCancel}>Cancel</button>
              : <button className="primary" type="submit" disabled={props.prompt.trim() === "" || !runReady}>Run compare</button>}
          </div>
        </div>
      </form>

      <section className={`simple-compare-results${hasRun ? " has-run" : ""}`} aria-label="Comparison result">
        {hasRun && <ResultFacts
          facts={resultFacts}
          baselineAgent={baselineAgent?.label ?? runtimeLabel ?? "Agent"}
          candidateAgent={candidateAgent?.label ?? runtimeLabel ?? "Agent"}
          baselineModel={baselineModelLabel}
          candidateModel={candidateModelLabel}
        />}
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
              baselineAgentLabel={baselineAgent?.label ?? runtimeLabel}
              candidateAgentLabel={candidateAgent?.label ?? runtimeLabel}
              baselineModelLabel={baselineModelLabel}
              candidateModelLabel={candidateModelLabel}
            />
          : <section id="simple-panel-messages" className="simple-lane-grid" role="tabpanel" aria-labelledby="simple-tab-messages" aria-label="AI message streams">
              <SimpleLane
                role="AI 1"
                definition={baseline}
                lane={baselineLane}
                submittedPrompt={props.submittedPrompt}
                agentLabel={baselineAgent?.label ?? runtimeLabel}
                modelLabel={baselineModelLabel}
                onPermission={(runId, requestId, optionId) => props.onPermission(props.baselineId, runId, requestId, optionId)}
              />
              <SimpleLane
                role="AI 2"
                definition={candidate}
                lane={candidateLane}
                submittedPrompt={props.submittedPrompt}
                agentLabel={candidateAgent?.label ?? runtimeLabel}
                modelLabel={candidateModelLabel}
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
  modelLabel: string;
  disabled: boolean;
  onChange: (value: string) => void;
}): React.JSX.Element {
  const selected = props.profiles.find((profile) => profile.id === props.value);
  return <label className="simple-agent-control" htmlFor={props.id} title={selected?.detail}>
    <span>{props.label.replace(" Agent", "")}</span>
    <select id={props.id} aria-label={props.label} value={props.value} disabled={props.disabled} onChange={(event) => props.onChange(event.target.value)}>
      {props.profiles.map((profile) => <option key={profile.id} value={profile.id} disabled={!profile.available}>
        {profile.label}{profile.available ? "" : " · unavailable"}
      </option>)}
    </select>
    <small><span>Model</span><strong>{props.modelLabel}</strong></small>
  </label>;
}

function ResultFacts(props: {
  facts: ReturnType<typeof deriveSimpleResultFacts>;
  baselineAgent: string;
  candidateAgent: string;
  baselineModel: string;
  candidateModel: string;
}): React.JSX.Element {
  const exclusive = props.facts.baselineOnlyResources + props.facts.candidateOnlyResources;
  return <section className="simple-result-facts" aria-label="Observed comparison facts">
    <header>
      <small>Observed result</small>
      <strong>{props.facts.sharedResources} resources used by both AIs</strong>
      <span>{exclusive === 0
        ? "No run-only resources recorded."
        : `${props.facts.baselineOnlyResources} AI 1 only · ${props.facts.candidateOnlyResources} AI 2 only`}</span>
    </header>
    <LaneFacts role="AI 1" agent={props.baselineAgent} model={props.baselineModel} facts={props.facts.baseline} />
    <LaneFacts role="AI 2" agent={props.candidateAgent} model={props.candidateModel} facts={props.facts.candidate} />
  </section>;
}

function LaneFacts(props: { role: string; agent: string; model: string; facts: SimpleLaneFacts }): React.JSX.Element {
  const edits = props.facts.editedResources.length === 0
    ? "no recorded edits"
    : `edited ${props.facts.editedResources.length}`;
  const verification = props.facts.verificationCalls === 0
    ? "no recorded verification"
    : `verified ${props.facts.verificationCalls} time${props.facts.verificationCalls === 1 ? "" : "s"}`;
  return <article>
    <div><small>{props.role}</small><strong>{props.agent}</strong><span>Model: {props.model}</span></div>
    <em className={`lane-status lane-status-${props.facts.status}`}>{props.facts.status}</em>
    <p>{props.facts.resources} resources · {edits} · {verification}</p>
  </article>;
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
        <div role="columnheader"><span>AI 1</span><strong>{props.baselineAgentLabel ?? "Agent"}</strong><small>Model: {baselineModel}</small><em className={`lane-status lane-status-${props.baselineLane?.status ?? "idle"}`}>{props.baselineLane?.status ?? "idle"}</em></div>
        <div role="columnheader">Resource</div>
        <div role="columnheader"><span>AI 2</span><strong>{props.candidateAgentLabel ?? "Agent"}</strong><small>Model: {candidateModel}</small><em className={`lane-status lane-status-${props.candidateLane?.status ?? "idle"}`}>{props.candidateLane?.status ?? "idle"}</em></div>
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
      {result.exitCode !== undefined && <div><dt>Exit code</dt><dd>{result.exitCode}</dd></div>}
      {result.durationMs !== undefined && <div><dt>Duration</dt><dd>{result.durationMs} ms</dd></div>}
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
  return agent?.modelPolicy === "agent-default" ? "Agent default" : modelName(definition, "AI");
}

function shortRevision(value: string): string {
  const normalized = value.replace(/^sha256:/, "");
  return normalized.length <= 12 ? normalized : `${normalized.slice(0, 10)}…`;
}

function emptySimpleLane(): LaneTrace {
  return { status: "idle", calls: [], eventCount: 0, protocolFrameCount: 0, acpSessionIds: [], pendingPermissions: [], activities: [] };
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
  const agent = props.agentLabel ?? "Agent";
  return <article className="simple-lane">
    <header>
      <div><small>{props.role}</small><strong>{agent}</strong><em>Model: {model}</em></div>
      <span className={`lane-status lane-status-${lane.status}`}>{lane.status}</span>
    </header>
    <div className="simple-message-stream" aria-live="polite" aria-label={`${agent} messages`}>
      {props.submittedPrompt !== null && <section className="simple-message user-message"><small>You</small><p>{props.submittedPrompt}</p></section>}
      {lane.activities.map((activity) => {
        if (activity.kind === "assistant") {
          return <section className="simple-message assistant-message" key={activity.id}>
            <small>{agent}</small>
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
