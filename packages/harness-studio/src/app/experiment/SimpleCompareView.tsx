import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("experiment");
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
    ? props.preview.setup.checkpointSource.limitation ?? t("simple.blockedDetail")
    : agentsReady
      ? t("simple.ready")
      : t("simple.selectAgents");
  const hasRun = props.submittedPrompt !== null;
  const baselineModelLabel = agentModelName(baseline, baselineAgent, t);
  const candidateModelLabel = agentModelName(candidate, candidateAgent, t);
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
        <div className="simple-project-control" role="group" aria-label={t("simple.currentProjectAria")}>
          <span>{t("simple.currentProject")}</span>
          <div className="simple-project-value">
            <strong>{project.value}</strong>
            <code title={revision.value}>{shortRevision(revision.value)}</code>
          </div>
          <small>{t("simple.sameCheckpoint")}</small>
        </div>
        {needsAcpAgents && <div className="simple-agent-controls" aria-label={t("simple.agentsAria")}>
          <AgentSelect
            id="compare-baseline-agent"
            label={t("simple.agentLabel", { role: t("simple.ai1") })}
            profiles={agentProfiles}
            value={props.agentIds[props.baselineId] ?? ""}
            modelLabel={baselineModelLabel}
            disabled={props.running}
            onChange={(value) => props.onAgent(props.baselineId, value)}
          />
          <AgentSelect
            id="compare-candidate-agent"
            label={t("simple.agentLabel", { role: t("simple.ai2") })}
            profiles={agentProfiles}
            value={props.agentIds[props.candidateId] ?? ""}
            modelLabel={candidateModelLabel}
            disabled={props.running}
            onChange={(value) => props.onAgent(props.candidateId, value)}
          />
        </div>}
        <label className="simple-prompt-control" htmlFor="compare-prompt">
          <span>{t("simple.promptLabel")}</span>
          <textarea
            id="compare-prompt"
            value={props.prompt}
            onChange={(event) => props.onPrompt(event.target.value)}
            placeholder={t("simple.promptPlaceholder")}
            rows={4}
          />
        </label>
        <div className={`simple-run-control scope-${comparisonScope.kind}`}>
          <div className="simple-scope-copy" role="region" aria-label={t("simple.scope")}>
            <small>{t("simple.scope")}</small>
            <strong>{comparisonScope.title}</strong>
            <span>{comparisonScope.detail}</span>
            <em role="status" aria-live="polite">
{props.running ? t("simple.running") : props.runError ?? readyMessage}
            </em>
          </div>
          <div className="simple-run-actions">
            <button className="secondary" type="button" onClick={props.onSetup}>{t("simple.reviewSetup")}</button>
            <button className="secondary simple-advanced-action" type="button" disabled={!checkpointReady} onClick={props.onAdvanced}>{t("simple.advanced")}</button>
            {props.running
              ? <button className="secondary cancel-comparison" type="button" onClick={props.onCancel}>{t("simple.cancel")}</button>
              : <button className="primary" type="submit" disabled={props.prompt.trim() === "" || !runReady}>{t("simple.runCompare")}</button>}
          </div>
        </div>
      </form>

      <section className={`simple-compare-results${hasRun ? " has-run" : ""}`} aria-label={t("simple.resultAria")}>
        {hasRun && <ResultFacts
          facts={resultFacts}
baselineAgent={baselineAgent?.label ?? runtimeLabel ?? t("resourceMap.agent")}
          candidateAgent={candidateAgent?.label ?? runtimeLabel ?? t("resourceMap.agent")}
          baselineModel={baselineModelLabel}
          candidateModel={candidateModelLabel}
        />}
        {hasRun && <header className="simple-result-toolbar">
          <div>
            <strong>{resultView === "resources" ? t("simple.resourceMap") : t("simple.messages")}</strong>
            <span>{resultView === "resources"
              ? t("simple.resourceDetail")
              : t("simple.messagesDetail")}</span>
          </div>
          <div className="simple-result-switcher" role="tablist" aria-label={t("simple.resultViewsAria")}>
            <button id="simple-tab-resources" type="button" role="tab" aria-controls="simple-panel-resources" aria-selected={resultView === "resources"} tabIndex={resultView === "resources" ? 0 : -1} onKeyDown={selectResultViewFromKeyboard} onClick={() => setResultView("resources")}>{t("simple.tabs.resources")}</button>
            <button id="simple-tab-messages" type="button" role="tab" aria-controls="simple-panel-messages" aria-selected={resultView === "messages"} tabIndex={resultView === "messages" ? 0 : -1} onKeyDown={selectResultViewFromKeyboard} onClick={() => setResultView("messages")}>{t("simple.tabs.messages")}</button>
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
          : <section id="simple-panel-messages" className="simple-lane-grid" role="tabpanel" aria-labelledby="simple-tab-messages" aria-label={t("simple.messageStreamsAria")}>
              <SimpleLane
                role={t("simple.ai1")}
                definition={baseline}
                lane={baselineLane}
                submittedPrompt={props.submittedPrompt}
                agentLabel={baselineAgent?.label ?? runtimeLabel}
                modelLabel={baselineModelLabel}
                onPermission={(runId, requestId, optionId) => props.onPermission(props.baselineId, runId, requestId, optionId)}
              />
              <SimpleLane
                role={t("simple.ai2")}
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
  const { t } = useTranslation("experiment");
  const selected = props.profiles.find((profile) => profile.id === props.value);
  return <label className="simple-agent-control" htmlFor={props.id} title={selected?.detail}>
    <span>{props.label.replace(" Agent", "")}</span>
    <select id={props.id} aria-label={props.label} value={props.value} disabled={props.disabled} onChange={(event) => props.onChange(event.target.value)}>
      {props.profiles.map((profile) => <option key={profile.id} value={profile.id} disabled={!profile.available}>
        {profile.label}{profile.available ? "" : t("simple.unavailableSuffix")}
      </option>)}
    </select>
    <small><span>{t("simple.modelLabel")}</span><strong>{props.modelLabel}</strong></small>
  </label>;
}

function ResultFacts(props: {
  facts: ReturnType<typeof deriveSimpleResultFacts>;
  baselineAgent: string;
  candidateAgent: string;
  baselineModel: string;
  candidateModel: string;
}): React.JSX.Element {
  const { t } = useTranslation("experiment");
  const exclusive = props.facts.baselineOnlyResources + props.facts.candidateOnlyResources;
  return <section className="simple-result-facts" aria-label={t("facts.aria")}>
    <header>
      <small>{t("facts.result")}</small>
      <strong>{t("facts.sharedResources", { count: props.facts.sharedResources })}</strong>
      <span>{exclusive === 0
        ? t("facts.noExclusive")
        : t("facts.exclusive", { baseline: props.facts.baselineOnlyResources, candidate: props.facts.candidateOnlyResources })}</span>
    </header>
    <LaneFacts role={t("simple.ai1")} agent={props.baselineAgent} model={props.baselineModel} facts={props.facts.baseline} />
    <LaneFacts role={t("simple.ai2")} agent={props.candidateAgent} model={props.candidateModel} facts={props.facts.candidate} />
  </section>;
}

function LaneFacts(props: { role: string; agent: string; model: string; facts: SimpleLaneFacts }): React.JSX.Element {
  const { t } = useTranslation("experiment");
  const edits = props.facts.editedResources.length === 0
    ? t("facts.noEdits")
    : t("facts.edited", { count: props.facts.editedResources.length });
  const verification = props.facts.verificationCalls === 0
    ? t("facts.noVerification")
    : t("facts.verified", { count: props.facts.verificationCalls });
  return <article>
    <div><small>{props.role}</small><strong>{props.agent}</strong><span>{t("facts.model", { model: props.model })}</span></div>
    <em className={`lane-status lane-status-${props.facts.status}`}>{props.facts.status}</em>
    <p>{t("facts.summary", { resources: props.facts.resources, edits, verification })}</p>
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
  const { t } = useTranslation("experiment");
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

  return <section id="simple-panel-resources" className="simple-resource-map" role="tabpanel" aria-labelledby="simple-tab-resources" aria-label={t("resourceMap.aria")}>
    <p className="resource-map-summary" role="status">
      <strong>{t("resourceMap.shared", { count: shared })}</strong>
      <span>{t("resourceMap.observed", { count: rows.length })}</span>
      <span>{changed.length === 0 ? t("resourceMap.noEdits") : t("resourceMap.edited", { count: changed.length })}</span>
    </p>
    <div className="resource-map-table" role="table" aria-label={t("resourceMap.tableAria")}>
      <div className="resource-map-header" role="row">
        <div role="columnheader"><span>{t("simple.ai1")}</span><strong>{props.baselineAgentLabel ?? t("resourceMap.agent")}</strong><small>{t("facts.model", { model: baselineModel })}</small><em className={`lane-status lane-status-${props.baselineLane?.status ?? "idle"}`}>{props.baselineLane?.status ?? "idle"}</em></div>
        <div role="columnheader">{t("resourceMap.resource")}</div>
        <div role="columnheader"><span>{t("simple.ai2")}</span><strong>{props.candidateAgentLabel ?? t("resourceMap.agent")}</strong><small>{t("facts.model", { model: candidateModel })}</small><em className={`lane-status lane-status-${props.candidateLane?.status ?? "idle"}`}>{props.candidateLane?.status ?? "idle"}</em></div>
      </div>
      {rows.length === 0
        ? <p className="resource-map-empty">{t("resourceMap.waiting")}</p>
        : rows.map((row) => <div className="resource-map-row" role="row" key={row.resource}>
            <div className="resource-map-operations baseline-operations" role="cell">
              {row.baseline.map((operation) => <OperationButton
                key={operation.id}
                operation={operation}
                role={t("simple.ai1")}
                selected={operation.id === selected?.id}
                onSelect={props.onSelectOperation}
              />)}
              {selected !== undefined && row.baseline.some((operation) => operation.id === selected.id) && <OperationInspector
                operation={selected}
                call={baselineCalls.find((call) => call.id === selected.callId)}
                laneLabel={t("simple.ai1")}
              />}
              {row.baseline.length === 0 && <span className="resource-map-none">{t("resourceMap.noOperation")}</span>}
            </div>
            <div className="resource-map-resource" role="rowheader">
              <code>{displayResource(row.resource, t)}</code>
              <span>{row.baseline.length > 0 && row.candidate.length > 0 ? t("resourceMap.sharedTag") : t("resourceMap.oneRun")}</span>
            </div>
            <div className="resource-map-operations candidate-operations" role="cell">
              {row.candidate.map((operation) => <OperationButton
                key={operation.id}
                operation={operation}
                role={t("simple.ai2")}
                selected={operation.id === selected?.id}
                onSelect={props.onSelectOperation}
              />)}
              {selected !== undefined && row.candidate.some((operation) => operation.id === selected.id) && <OperationInspector
                operation={selected}
                call={candidateCalls.find((call) => call.id === selected.callId)}
                laneLabel={t("simple.ai2")}
              />}
              {row.candidate.length === 0 && <span className="resource-map-none">{t("resourceMap.noOperation")}</span>}
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
  const { t } = useTranslation("experiment");
  const label = operationLabel(props.operation.kind, t);
  return <button
    className={`resource-operation operation-${props.operation.kind}`}
    type="button"
    aria-pressed={props.selected}
    aria-label={t("operations.aria", { role: props.role, label, resource: displayResource(props.operation.resource, t), call: Math.floor(props.operation.callSequence) + 1, status: props.operation.status })}
    onClick={() => props.onSelect(props.operation.id)}
  >
    <strong>{label}</strong>
    <span>{t("operations.call", { call: Math.floor(props.operation.callSequence) + 1 })}</span>
    <em>{props.operation.status}</em>
  </button>;
}

function OperationInspector(props: {
  operation?: ToolOperation;
  call?: ExperimentToolCall;
  laneLabel: string;
}): React.JSX.Element {
  const { t } = useTranslation("experiment");
  if (props.operation === undefined || props.call === undefined) {
    return <aside className="operation-inspector empty" aria-label={t("operations.inspectorAria")}>
      <strong>{t("operations.toolResult")}</strong>
      <span>{t("operations.selectHint")}</span>
    </aside>;
  }
  const result = summarizeToolResult(props.call);
  return <aside className="operation-inspector" aria-label={t("operations.inspectorAria")}>
    <header>
      <div><strong>{props.laneLabel} · {operationLabel(props.operation.kind, t)} {displayResource(props.operation.resource, t)}</strong><span>{props.call.name}</span></div>
      <em className={`operation-outcome outcome-${result.outcome}`}>{result.outcome}</em>
    </header>
    <dl>
      <div><dt>{t("operations.callField")}</dt><dd>{props.operation.callSequence + 1}</dd></div>
      {result.exitCode !== undefined && <div><dt>{t("operations.exitCode")}</dt><dd>{result.exitCode}</dd></div>}
      {result.durationMs !== undefined && <div><dt>{t("operations.duration")}</dt><dd>{result.durationMs} ms</dd></div>}
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
  t: (key: string) => string,
): string {
  return agent?.modelPolicy === "agent-default" ? t("simple.agentDefault") : modelName(definition, t("simple.ai"));
}

function shortRevision(value: string): string {
  const normalized = value.replace(/^sha256:/, "");
  return normalized.length <= 12 ? normalized : `${normalized.slice(0, 10)}…`;
}

function emptySimpleLane(): LaneTrace {
  return { status: "idle", calls: [], eventCount: 0, protocolFrameCount: 0, acpSessionIds: [], pendingPermissions: [], activities: [] };
}

function displayResource(resource: string, t: (key: string) => string): string {
  return resource === "." ? t("resourceMap.projectRoot") : resource;
}

function operationLabel(kind: ToolOperationKind, t: (key: string) => string): string {
  return t(`operations.${kind}`);
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
  const { t } = useTranslation("experiment");
  const lane = props.lane ?? {
    status: "idle" as const,
    calls: [],
    eventCount: 0,
    protocolFrameCount: 0,
    acpSessionIds: [],
    pendingPermissions: [],
    activities: [],
  };
  const model = props.modelLabel ?? props.definition?.runtime?.model ?? props.definition?.id ?? t("simple.ai");
  const agent = props.agentLabel ?? t("resourceMap.agent");
  return <article className="simple-lane">
    <header>
      <div><small>{props.role}</small><strong>{agent}</strong><em>{t("facts.model", { model })}</em></div>
      <span className={`lane-status lane-status-${lane.status}`}>{lane.status}</span>
    </header>
    <div className="simple-message-stream" aria-live="polite" aria-label={`${agent} messages`}>
      {props.submittedPrompt !== null && <section className="simple-message user-message"><small>{t("lane.you")}</small><p>{props.submittedPrompt}</p></section>}
      {lane.activities.map((activity) => {
        if (activity.kind === "assistant") {
          return <section className="simple-message assistant-message" key={activity.id}>
            <small>{agent}</small>
            <p>{activity.text || (activity.complete ? t("lane.noTextResponse") : t("lane.thinking"))}</p>
          </section>;
        }
        const call = lane.calls.find((item) => item.id === `${activity.runId}:${activity.toolCallId}`);
        return <div className="simple-tool-activity" key={activity.id}>
          <span>{call?.status === "running" ? t("lane.running") : call?.status ?? t("lane.observed")}</span>
          <strong>{call?.name ?? t("lane.tool")}</strong>
        </div>;
      })}
      {props.submittedPrompt === null && lane.activities.length === 0 && <p className="simple-stream-empty">{t("lane.runOnce")}</p>}
      {props.submittedPrompt !== null && lane.activities.length === 0 && lane.status !== "failed" && <p className="simple-stream-empty">{t("lane.waiting")}</p>}
      {lane.pendingPermissions.map((permission) => <section className="simple-permission" key={`${permission.runId}:${permission.requestId}`}>
        <div><small>{t("lane.permissionNeeded")}</small><strong>{permission.title}</strong></div>
        <div>{permission.options.map((option) => <button key={option.optionId} type="button" onClick={() => props.onPermission(permission.runId, permission.requestId, option.optionId)}>{option.name}</button>)}</div>
      </section>)}
      {lane.detail && <p className="simple-lane-error">{lane.detail}</p>}
    </div>
  </article>;
}
