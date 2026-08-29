import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useRovingTablist } from "../roving-tablist.js";
import type { ExperimentToolCall } from "../../contracts/experiment-stream-contract.js";
import { isExperimentRunnable } from "../../contracts/experiment-setup.js";
import {
  activityPhaseSequence,
  alignToolCalls,
  localToolChain,
  normalizeToolCall,
  projectActivities,
  type RelatedToolCall,
} from "./experiment-trace-model.js";
import {
  deriveComparability,
  aggregateToolCalls,
  deriveTreatmentSummary,
  emptyLane,
  exactSelected,
  filterCalls,
  firstPhaseDivergence,
  focusedRelations,
  groupActivities,
  laneIdentityLabel,
  relationCounts,
  relationLabel,
  resourceLedger,
  resultForPair,
  roleFor,
  selectedCallForPair,
  shortDigest,
} from "./experiment-comparison-model.js";
import { fixedVirtualWindow } from "./virtual-list-model.js";
import { compactPrompt, requestProvenanceLabel } from "./ExperimentBuilder.js";
import type {
  Comparability,
  CompareView,
  ContrastResult,
  ExperimentPreview,
  LaneDefinition,
  LaneTrace,
  Selection,
  StreamEvent,
  TraceLens,
} from "./experiment-view-types.js";

const COMPARE_VIEWS: Array<{ id: CompareView }> = [
  { id: "summary" },
  { id: "trace" },
  { id: "evidence" },
];

export function ExperimentWorkbench(props: {
  preview: ExperimentPreview;
  navigation?: ReactNode;
  lanes: Record<string, LaneTrace>;
  baselineId: string;
  candidateId: string;
  selection: Selection | null;
  activeView: CompareView;
  traceLens: TraceLens;
  filter: string;
  diffOnly: boolean;
  syncSelection: boolean;
  running: boolean;
  experimentId: string | null;
  compareSet?: StreamEvent["compareSet"];
  agentIds?: Readonly<Record<string, string>>;
  railCollapsed: boolean;
  onRailCollapsed: (value: boolean) => void;
  onSetup: () => void;
  onSimple: () => void;
  onRun: () => void;
  onCancel: () => void;
  onPermission: (laneId: string, runId: string, requestId: string, optionId: string) => void;
  onSelectRun: (id: string) => void;
  onSelectCall: (selection: Selection) => void;
  onActiveView: (view: CompareView) => void;
  onTraceLens: (lens: TraceLens) => void;
  onFilter: (value: string) => void;
  onDiffOnly: (value: boolean) => void;
  onSyncSelection: (value: boolean) => void;
  onLoadMore: (laneId: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation("experiment");
  const baselineDefinition = props.preview.manifest.lanes.find((lane) => lane.id === props.baselineId);
  const candidateDefinition = props.preview.manifest.lanes.find((lane) => lane.id === props.candidateId);
  const baseline = props.lanes[props.baselineId] ?? emptyLane();
  const candidate = props.lanes[props.candidateId] ?? emptyLane();
  const selectedCall = selectedCallForPair(props.selection, baseline, candidate);
  const relations = focusedRelations(selectedCall, props.baselineId, baseline, props.candidateId, candidate);
  const resultRows = props.compareSet?.contrasts
    ?? props.preview.contrasts.map((item) => ({ id: item.id, lanes: item.lanes, status: "not-run", reason: item.attribution.detail }));
  const focusedResult = resultForPair(resultRows, props.baselineId, props.candidateId);
  const comparability = deriveComparability(props.preview, baselineDefinition, candidateDefinition, baseline, candidate, props.agentIds);
  const totalCalls = Object.values(props.lanes).reduce((count, lane) => count + lane.calls.length, 0);
  const pendingPermissions = Object.entries(props.lanes).flatMap(([laneId, lane]) =>
    lane.pendingPermissions.map((permission) => ({ laneId, permission })));
  const treatment = deriveTreatmentSummary(props.preview);
  const freshDefinitions = props.preview.manifest.lanes.filter((lane) => lane.origin === "execute");
  const harnesses = [...new Set(freshDefinitions.map((lane) => lane.harnessId ?? "unknown"))].join(" · ");
  const runtimes = [...new Set(freshDefinitions.map((lane) => laneIdentityLabel(lane)))].join(" ↔ ");
  const agentLabels = new Map((props.preview.acpAgents?.agents ?? []).map((agent) => [agent.id, agent.label]));
  const selectedAgents = [props.agentIds?.[props.baselineId], props.agentIds?.[props.candidateId]]
    .filter((id): id is string => typeof id === "string" && id !== "")
    .map((id) => agentLabels.get(id) ?? id)
    .join(" ↔ ");
  const acpHosted = props.preview.manifest.runtime?.host === "acp";
  const executionIdentity = acpHosted ? selectedAgents || t("workbench.acpAgentUnavailable") : t("workbench.qoderIdentity", { runtimes: runtimes || t("workbench.runtimeUnavailable") });
  const runnable = isExperimentRunnable(props.preview.setup);
  const runState = props.running ? t("workbench.streaming") : runnable ? t("workbench.ready") : t("workbench.blocked");
  const runDetail = runnable
    ? t("workbench.runDetailFresh", { runtime: t(acpHosted ? "workbench.acpRuntime" : "workbench.qoderRuntime") })
    : props.preview.setup.checkpointSource.limitation ?? t("workbench.runBlocked");
  const compareTablist = useRovingTablist({ ids: COMPARE_VIEWS.map((view) => view.id), active: props.activeView, onSelect: props.onActiveView, panelId: "compare-view-panel" });

  return <section className={`experiment-shell${props.railCollapsed ? " rail-collapsed" : ""}`}>
    <header className="experiment-notebook-bar">
      <div className="notebook-brand"><strong>Harness Bench</strong><span>{t("workbench.subtitle")}</span></div>
      <div className="notebook-navigation">{props.navigation}</div>
<div className="notebook-document"><strong>{t("workbench.document")}</strong><span>{treatment.value}</span></div>
      <div className="notebook-bar-actions"><span className={`notebook-save-state${props.running ? " running" : ""}`}>{props.running ? t("workbench.running") : runnable ? t("workbench.saved") : t("workbench.blocked")}</span><button type="button" onClick={props.onSimple}>{t("workbench.simpleCompare")}</button><button type="button" onClick={props.onSetup}>{t("workbench.setup")}</button><button className="rail-toggle" type="button" aria-label={props.railCollapsed ? t("workbench.showCheckpoints") : t("workbench.hideCheckpoints")} aria-expanded={!props.railCollapsed} onClick={() => props.onRailCollapsed(!props.railCollapsed)}>{props.railCollapsed ? t("workbench.checkpoints") : t("workbench.hideRail")}</button></div>
    </header>

    <div className="experiment-workspace">
      <div className="experiment-workspace-scroll"><section className="compare-surface comparison-notebook" aria-label={t("workbench.notebookAria")}>
        <section className="notebook-context" aria-labelledby="notebook-context-title">
          <header><div><h1 id="notebook-context-title">{t("workbench.context")}</h1></div><span>{props.preview.lock ? t("workbench.locked") : t("workbench.loadedDefinition")}</span></header>
          <div className="notebook-context-grid">
<article className="notebook-request"><small>{t("workbench.request")}</small><p>{compactPrompt(props.preview.setup.request.prompt)}</p><span>{requestProvenanceLabel(props.preview.setup.request.provenance, t)}</span></article>
            <article><small>{t("workbench.startingCheckpoint")}</small><code title={props.preview.checkpoint.digest}>{shortDigest(props.preview.checkpoint.digest)}</code><span>{props.preview.setup.checkpointSource.revision.value}</span></article>
            <article><small>{t("workbench.harness")}</small><strong>{harnesses || t("workbench.unverified")}</strong><span>{executionIdentity}</span></article>
            <article><small>{treatment.label}</small><strong>{treatment.value}</strong><span>{treatment.controlled ? t("workbench.singleSetting") : t("workbench.descriptiveComparison")}</span></article>
          </div>
        </section>

        <section className="notebook-cell notebook-run-cell" aria-labelledby="run-cell-title">
          <div className="notebook-cell-marker"><span>In [1]</span></div>
          <div className="notebook-cell-card">
<header className="compare-titlebar"><div><h2 id="run-cell-title">{t("workbench.runComparison")}</h2><p>{runDetail}</p></div><div className="compare-actions"><span className={`live-state${props.running ? " running" : ""}`}>{runState}</span>{props.running ? <button className="secondary" onClick={props.onCancel}>{t("workbench.cancelComparison")}</button> : <button disabled={!runnable} onClick={props.onRun}>{t("workbench.runComparison")}</button>}</div></header>
            <section className="run-prompt"><small>{t("workbench.prompt")}</small><p>{compactPrompt(props.preview.setup.request.prompt)}</p></section>
            {pendingPermissions.length > 0 && <section className="acp-permission-queue" aria-live="polite" aria-label={t("workbench.acpPermissions")}><header><strong>{t("workbench.acpPermissions")}</strong><span>{t("workbench.permissionCount", { count: pendingPermissions.length })}</span></header>{pendingPermissions.map(({ laneId, permission }) => <article key={`${permission.runId}:${permission.requestId}`}><div><small>{laneId}</small><strong>{permission.title}</strong><code>{permission.toolCallId}</code></div><div>{permission.options.map((option) => <button key={option.optionId} type="button" onClick={() => props.onPermission(laneId, permission.runId, permission.requestId, option.optionId)}>{option.name}</button>)}</div></article>)}</section>}
            <details className="run-process-summary"><summary><span>{t("workbench.process")}</span><em>{t("workbench.processDetail", { calls: totalCalls, runs: props.preview.manifest.lanes.length })}</em></summary><ol>{props.preview.manifest.lanes.map((definition) => {
              const run = props.lanes[definition.id] ?? emptyLane();
              const sessions = run.acpSessionIds.map(shortDigest).join(", ");
              return <li key={definition.id}><strong>{roleFor(definition, props.baselineId, props.candidateId)} · {definition.id}</strong><span>{run.status}</span><em>{run.eventCount}{run.hasMore ? "+" : ""} events{run.protocolFrameCount > 0 ? ` · ${run.protocolFrameCount} ACP` : ""}{sessions ? ` · ${sessions}` : ""}</em></li>;
            })}</ol></details>
            <div className="run-output-label"><strong>{t("workbench.outputs")}</strong><span>{t("workbench.outputsDetail")}</span></div>
            <div className="object-bar" aria-label={t("workbench.runsAria")}>{props.preview.manifest.lanes.map((definition) => {
              const run = props.lanes[definition.id] ?? emptyLane();
              const role = roleFor(definition, props.baselineId, props.candidateId);
              const content = <><div><small>{role}</small><strong>{definition.id}</strong><span>{laneIdentityLabel(definition)} · {run.status}</span></div><code>{run.calls.length}</code></>;
              return definition.origin === "observed"
                ? <article key={definition.id} className="object-card role-reference">{content}</article>
                : <button key={definition.id} type="button" className={`object-card role-${role.toLowerCase()}`} aria-pressed={definition.id === props.baselineId || definition.id === props.candidateId} onClick={() => props.onSelectRun(definition.id)}>{content}</button>;
            })}</div>
          </div>
        </section>

        <section className="notebook-cell notebook-result-cell" aria-labelledby="result-cell-title">
          <div className="notebook-cell-marker output"><span>Out [1]</span></div>
          <div className="notebook-cell-card">
            <header className="compare-result-head"><div><h2 id="result-cell-title">{t("workbench.compareTitle", { baseline: props.baselineId, candidate: props.candidateId })}</h2></div><div className={`comparability level-${comparability.level.toLowerCase()}`} role="status"><strong>{comparability.level}</strong><span>{comparability.detail}</span>{comparability.axis && <code>{comparability.axis}</code>}</div></header>
            <nav className="compare-tabs" aria-label={t("workbench.viewsAria")} {...compareTablist.tablistProps}>{COMPARE_VIEWS.map((view) => <button key={view.id} type="button" {...compareTablist.getTabProps(view.id)} onClick={() => props.onActiveView(view.id)}>{t(`workbench.viewTabs.${view.id}`)}</button>)}</nav>
            <div className="compare-view" id="compare-view-panel" role="tabpanel">
              {props.activeView === "summary" && <SummaryView baseline={baseline} candidate={candidate} result={focusedResult} comparability={comparability} />}
              {props.activeView === "trace" && <TraceView lens={props.traceLens} onLens={props.onTraceLens} baseline={baseline} candidate={candidate} baselineDefinition={baselineDefinition} candidateDefinition={candidateDefinition} selectedCall={selectedCall} relations={relations} filter={props.filter} diffOnly={props.diffOnly} syncSelection={props.syncSelection} onFilter={props.onFilter} onDiffOnly={props.onDiffOnly} onSyncSelection={props.onSyncSelection} onSelect={(call) => props.onSelectCall({ laneId: call.laneId, callId: call.id })} />}
              {props.activeView === "evidence" && <EvidenceView baseline={baseline} candidate={candidate} resultRows={resultRows} comparability={comparability} focusedResult={focusedResult} />}
            </div>
          </div>
        </section>
<footer className="notebook-footer" aria-label={t("workbench.actionsAria")}><button type="button" onClick={props.onSetup}>{t("workbench.editSetup")}</button><button type="button" onClick={props.onRun} disabled={props.running || !runnable}>{t("workbench.runAgain")}</button><button type="button" onClick={() => props.onActiveView("summary")}>{t("workbench.openSummary")}</button></footer>
      </section></div>
    </div>

    <aside className="experiment-rail" aria-label={t("workbench.railAria")}>
      <header className="checkpoint-rail-head"><div><strong>{t("workbench.checkpoints")}</strong><span>{t("workbench.stateCount", { count: props.preview.manifest.lanes.length + 1 })}</span></div><button className="rail-toggle" type="button" aria-label={t("workbench.hideCheckpoints")} onClick={() => props.onRailCollapsed(true)}>{t("workbench.hide")}</button></header>
      <div className="rail-content">
        <section className="checkpoint-start"><span className="checkpoint-dot status-history" /><div><strong>{t("workbench.start")}</strong><code title={props.preview.setup.checkpointSource.resource.detail}>{props.preview.setup.checkpointSource.resource.value}</code><small>{props.preview.setup.checkpointSource.revision.value}</small></div></section>
        <ol className="rail-lanes">{props.preview.manifest.lanes.map((definition) => {
          const run = props.lanes[definition.id] ?? emptyLane();
          const role = roleFor(definition, props.baselineId, props.candidateId);
          const content = <><span className={`rail-lane-dot status-${run.status}`} /><span><strong>{definition.id}</strong><small>{role} · {run.status}</small><em>{t("workbench.railRunMeta", { calls: run.calls.length, events: `${run.eventCount}${run.hasMore ? "+" : ""}` })}</em></span></>;
          return <li key={definition.id}>{definition.origin === "observed" ? <article className="checkpoint-run paged-run">{content}{run.hasMore && <button type="button" className="load-more-calls" disabled={run.loadingMore} onClick={() => props.onLoadMore(definition.id)}>{run.loadingMore ? t("workbench.loading") : t("workbench.loadMore")}</button>}</article> : <button type="button" className="checkpoint-run" aria-pressed={definition.id === props.baselineId || definition.id === props.candidateId} onClick={() => props.onSelectRun(definition.id)}>{content}</button>}</li>;
        })}</ol>
        <section className="checkpoint-detail"><header><strong>{props.candidateId}</strong><span>{t("workbench.candidate")}</span></header><dl><div><dt>{t("workbench.harness")}</dt><dd>{candidateDefinition?.harnessId ?? t("workbench.unverified")}</dd></div><div><dt>{t("workbench.runtime")}</dt><dd>{candidateDefinition ? laneIdentityLabel(candidateDefinition) : t("workbench.runtimeUnavailable")}</dd></div><div><dt>{t("workbench.status")}</dt><dd>{candidate.status}</dd></div><div><dt>{t("workbench.evidence")}</dt><dd>{t("workbench.evidenceCount", { count: candidate.calls.length })}</dd></div></dl><footer><button type="button" onClick={() => props.onActiveView("evidence")}>{t("workbench.viewEvidence")}</button><button type="button" onClick={() => props.onActiveView("trace")}>{t("workbench.inspectTrace")}</button></footer></section>
      </div>
<footer className="rail-footer"><div><strong>{props.running ? t("workbench.comparisonRunning") : runnable ? t("workbench.toolCalls", { count: totalCalls }) : t("workbench.comparisonBlocked")}</strong><span>{props.experimentId ? shortDigest(props.experimentId) : runnable ? t("workbench.ready") : t("workbench.blocked")}</span></div><button className="secondary" onClick={props.onSetup}>{t("workbench.setup")}</button></footer>
    </aside>
  </section>;
}

function SummaryView(props: { baseline: LaneTrace; candidate: LaneTrace; result?: ContrastResult; comparability: Comparability }): React.JSX.Element {
  const { t } = useTranslation("experiment");
  const matches = relationCounts(props.baseline.calls, props.candidate.calls);
  const divergence = firstPhaseDivergence(activityPhaseSequence(props.baseline.calls), activityPhaseSequence(props.candidate.calls));
  return <div className="summary-grid">
    <section><small>{t("workbench.outcome")}</small><strong className={`summary-value status-${props.result?.status ?? "not-run"}`}>{props.result?.status ?? t("workbench.notRun")}</strong><p>{props.result?.reason ?? t("workbench.notRunReason")}</p></section>
    <section><small>{t("workbench.process")}</small><strong className="summary-value">{divergence.label}</strong><p>{divergence.detail}</p></section>
    <section><small>{t("workbench.volume")}</small><strong className="summary-value">{t("workbench.volumeCalls", { baseline: props.baseline.calls.length, candidate: props.candidate.calls.length })}</strong><p>{t("workbench.volumeDetail")}</p></section>
    <section><small>{t("workbench.evidence")}</small><strong className="summary-value">{t("workbench.evidenceMatches", { exact: matches.exact, resource: matches["same-resource"] })}</strong><p>{t("workbench.comparability", { level: props.comparability.level, detail: props.comparability.detail })}</p></section>
  </div>;
}

function TraceView(props: {
  lens: TraceLens;
  onLens: (lens: TraceLens) => void;
  baseline: LaneTrace;
  candidate: LaneTrace;
  baselineDefinition?: LaneDefinition;
  candidateDefinition?: LaneDefinition;
  selectedCall?: ExperimentToolCall;
  relations: Map<string, RelatedToolCall>;
  filter: string;
  diffOnly: boolean;
  syncSelection: boolean;
  onFilter: (value: string) => void;
  onDiffOnly: (value: boolean) => void;
  onSyncSelection: (value: boolean) => void;
  onSelect: (call: ExperimentToolCall) => void;
}): React.JSX.Element {
  const { t } = useTranslation("experiment");
  return <section className="trace-view">
    <div className="trace-lenses" role="group" aria-label={t("workbench.traceLensAria")}><button type="button" aria-pressed={props.lens === "calls"} onClick={() => props.onLens("calls")}>{t("workbench.lens.calls")}</button><button type="button" aria-pressed={props.lens === "resources"} onClick={() => props.onLens("resources")}>{t("workbench.lens.resources")}</button><span>{t("workbench.lensDetail")}</span></div>
    {props.lens === "calls"
      ? <CallsView {...props} />
      : <ResourcesView baseline={props.baseline} candidate={props.candidate} baselineId={props.baselineDefinition?.id ?? "baseline"} candidateId={props.candidateDefinition?.id ?? "candidate"} />}
  </section>;
}

function CallsView(props: {
  baseline: LaneTrace; candidate: LaneTrace; baselineDefinition?: LaneDefinition; candidateDefinition?: LaneDefinition;
  selectedCall?: ExperimentToolCall; relations: Map<string, RelatedToolCall>; filter: string; diffOnly: boolean; syncSelection: boolean;
  onFilter: (value: string) => void; onDiffOnly: (value: boolean) => void; onSyncSelection: (value: boolean) => void; onSelect: (call: ExperimentToolCall) => void;
}): React.JSX.Element {
  const { t } = useTranslation("experiment");
  const baselineId = props.baselineDefinition?.id ?? "baseline";
  const candidateId = props.candidateDefinition?.id ?? "candidate";
  const alignment = alignToolCalls(props.baseline.calls, props.candidate.calls);
  const exactLeft = new Set([...alignment].filter(([, relation]) => relation.relation === "exact").map(([id]) => id));
  const exactRight = new Set([...alignment.values()].filter((relation) => relation.relation === "exact" && relation.call).map((relation) => relation.call!.id));
  const left = filterCalls(props.baseline.calls, props.filter, props.diffOnly ? exactLeft : undefined);
  const right = filterCalls(props.candidate.calls, props.filter, props.diffOnly ? exactRight : undefined);
  const counterpart = props.selectedCall === undefined || !props.syncSelection
    ? undefined
    : props.relations.get(props.selectedCall.laneId === baselineId ? candidateId : baselineId)?.call ?? undefined;
  return <section className="calls-view">
    <div className="calls-toolbar"><label className="call-filter"><span>{t("workbench.filter")}</span><input value={props.filter} onChange={(event) => props.onFilter(event.target.value)} placeholder={t("workbench.filterPlaceholder")} aria-label={t("workbench.filterAria")} /></label><label className="switch-control"><input type="checkbox" checked={props.syncSelection} onChange={(event) => props.onSyncSelection(event.target.checked)} />{t("workbench.sync")}</label><label className="switch-control"><input type="checkbox" checked={props.diffOnly} onChange={(event) => props.onDiffOnly(event.target.checked)} />{t("workbench.diffOnly")}</label></div>
    <div className="overview-pair" aria-label={t("workbench.overviewAria")}><CallOverview calls={left} selectedCall={props.selectedCall} onSelect={props.onSelect} /><CallOverview calls={right} selectedCall={props.selectedCall} counterpart={counterpart} onSelect={props.onSelect} /></div>
    <div className="pair-board call-board" role="region" aria-label={t("workbench.focusedAria")} tabIndex={0}>
      <CallLane role={t("workbench.baseline")} definition={props.baselineDefinition} lane={props.baseline} calls={left} selectedCall={props.selectedCall} counterpart={counterpart} relation={props.selectedCall?.laneId === baselineId ? exactSelected(props.selectedCall) : props.relations.get(baselineId)} onSelect={props.onSelect} />
      <CallLane role={t("workbench.candidate")} definition={props.candidateDefinition} lane={props.candidate} calls={right} selectedCall={props.selectedCall} counterpart={counterpart} relation={props.selectedCall?.laneId === candidateId ? exactSelected(props.selectedCall) : props.relations.get(candidateId)} onSelect={props.onSelect} />
    </div>
    {props.selectedCall && <LocalChainInspector baseline={props.baseline} candidate={props.candidate} baselineId={baselineId} candidateId={candidateId} selectedCall={props.selectedCall} relations={props.relations} syncSelection={props.syncSelection} />}
  </section>;
}

function CallOverview(props: { calls: ExperimentToolCall[]; selectedCall?: ExperimentToolCall; counterpart?: ExperimentToolCall; onSelect: (call: ExperimentToolCall) => void }): React.JSX.Element {
  const { t } = useTranslation("experiment");
  return <div className="call-overview">{props.calls.length === 0 ? <span /> : props.calls.map((call) => {
    const phase = projectActivities([call])[0]?.phase ?? t("workbench.execute");
    const active = call.id === props.selectedCall?.id || call.id === props.counterpart?.id;
    const resource = normalizeToolCall(call).resource ?? t("workbench.noResource");
    return <button key={call.id} className={`phase-${phase.toLowerCase()}${active ? " active" : ""}`} title={`${call.name} · ${resource}`} aria-label={t("workbench.selectCallAria", { name: call.name, resource })} onClick={() => props.onSelect(call)} />;
  })}</div>;
}

function CallLane(props: { role: string; definition?: LaneDefinition; lane: LaneTrace; calls: ExperimentToolCall[]; selectedCall?: ExperimentToolCall; counterpart?: ExperimentToolCall; relation?: RelatedToolCall; onSelect: (call: ExperimentToolCall) => void }): React.JSX.Element {
  const { t } = useTranslation("experiment");
  const groups = groupActivities(projectActivities(props.calls));
  const selectedId = props.selectedCall?.laneId === props.definition?.id ? props.selectedCall?.id : undefined;
  const counterpartId = props.counterpart?.laneId === props.definition?.id ? props.counterpart?.id : undefined;
  const highlightedId = selectedId ?? counterpartId;
  const rows = groups.flatMap((group, groupIndex) => [
    { type: "phase" as const, id: `${group.phase}:${groupIndex}`, phase: group.phase, count: group.items.length },
    ...aggregateToolCalls(group.items.map(({ call }) => call)).map((toolGroup) => ({ type: "tools" as const, ...toolGroup })),
  ]);
  return <article className="call-lane"><header className="call-lane-head"><div><small>{props.role}</small><strong>{props.definition?.id ?? props.role}</strong></div><span className={`lane-status lane-status-${props.lane.status}`}>{props.lane.status}</span></header><div className="lane-relation"><span className={`relation relation-${props.relation?.relation ?? "none"}`}>{props.selectedCall ? relationLabel(props.relation?.relation ?? "none") : t("workbench.noSelection")}</span><small>{props.relation?.basis ?? t("workbench.canonicalEvents", { count: props.lane.eventCount })}{props.lane.hasMore ? "+" : ""}</small></div>{rows.length === 0 ? <div className="call-tree" role="tree"><p className="trace-empty">{props.calls.length === 0 && props.lane.calls.length > 0 ? t("workbench.noCallsMatch") : t("workbench.waitingForCalls")}</p></div> : rows.length > 100 ? <VirtualCallRows rows={rows} highlightedId={highlightedId} onSelect={props.onSelect} /> : <div className="call-tree" role="tree">{groups.map((group, groupIndex) => <section key={`${group.phase}:${groupIndex}`} className="call-group" role="group"><header><span className={`phase-dot phase-${group.phase.toLowerCase()}`} /><strong>{group.phase}</strong><em>{group.items.length}</em></header>{aggregateToolCalls(group.items.map(({ call }) => call)).map((toolGroup) => <ToolGroupRow key={toolGroup.id} group={toolGroup} highlightedId={highlightedId} onSelect={props.onSelect} />)}</section>)}</div>}{props.lane.detail && <p className="lane-detail">{props.lane.detail}</p>}</article>;
}

type CallLaneRow =
  | { type: "phase"; id: string; phase: string; count: number }
  | { type: "tools"; id: string; name: string; calls: ExperimentToolCall[] };

function VirtualCallRows(props: { rows: CallLaneRow[]; highlightedId?: string; onSelect: (call: ExperimentToolCall) => void }): React.JSX.Element {
  const [scrollTop, setScrollTop] = useState(0);
  const rowHeight = 44;
  const window = useMemo(() => fixedVirtualWindow(props.rows.length, rowHeight, scrollTop, 360), [props.rows.length, scrollTop]);
  return <div className="call-tree virtual-call-tree" role="tree" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}><div className="virtual-call-spacer" style={{ height: window.totalSize }}><div className="virtual-call-window" style={{ transform: `translateY(${window.offset}px)` }}>{props.rows.slice(window.start, window.end).map((row) => row.type === "phase" ? <header className="virtual-phase-row" key={row.id}><span className={`phase-dot phase-${row.phase.toLowerCase()}`} /><strong>{row.phase}</strong><em>{row.count}</em></header> : <ToolGroupRow key={row.id} group={row} highlightedId={props.highlightedId} onSelect={props.onSelect} />)}</div></div></div>;
}

function ToolGroupRow(props: { group: { id: string; name: string; calls: ExperimentToolCall[] }; highlightedId?: string; onSelect: (call: ExperimentToolCall) => void }): React.JSX.Element {
  const { t } = useTranslation("experiment");
  const first = props.group.calls[0]!;
  const active = props.group.calls.some((call) => call.id === props.highlightedId);
  const normalized = normalizeToolCall(first);
  const statuses = new Set(props.group.calls.map((call) => call.status));
  const status = statuses.has("failed") ? "failed" : statuses.has("running") ? "running" : first.status;
  return <button key={props.group.id} role="treeitem" className={active ? "selected" : ""} aria-selected={active} onClick={() => props.onSelect(first)}><span className="tool-sequence">{String(first.sequence + 1).padStart(2, "0")}</span><span className="tool-summary"><strong>{props.group.name}{props.group.calls.length > 1 ? ` ×${props.group.calls.length}` : ""}</strong><small>{props.group.calls.length > 1 ? t("workbench.consecutiveCalls", { count: props.group.calls.length }) : normalized.resource ?? t("workbench.noResourceKey")}</small></span><span className={`call-status call-status-${status}`}>{status}</span></button>;
}

function LocalChainInspector(props: { baseline: LaneTrace; candidate: LaneTrace; baselineId: string; candidateId: string; selectedCall: ExperimentToolCall; relations: Map<string, RelatedToolCall>; syncSelection: boolean }): React.JSX.Element {
  const { t } = useTranslation("experiment");
  const pairs = [[props.baselineId, props.baseline], [props.candidateId, props.candidate]] as const;
  return <section className="local-chain" aria-label={t("workbench.chainAria")}><header><small>{t("workbench.localChain")}</small><strong>{t("workbench.chainTitle")}</strong><span>{t("workbench.chainDetail")}</span></header><div>{pairs.map(([id, lane]) => {
    const match = props.selectedCall.laneId === id ? props.selectedCall : props.syncSelection ? props.relations.get(id)?.call ?? undefined : undefined;
    const relation = props.selectedCall.laneId === id ? "exact" : props.relations.get(id)?.relation ?? "none";
    const chain = match ? localToolChain(lane.calls, match.id) : [];
    return <article key={id}><div><strong>{id}</strong><span className={`relation relation-${relation}`}>{relationLabel(relation)}</span></div>{chain.length === 0 ? <p>{t("workbench.noCounterpart")}</p> : <ol>{chain.map((call) => <li key={call.id} className={call.id === match?.id ? "selected" : ""}><b>{call.name}</b><code>{normalizeToolCall(call).resource ?? t("workbench.noResource")}</code></li>)}</ol>}</article>;
  })}</div></section>;
}

function ResourcesView(props: { baseline: LaneTrace; candidate: LaneTrace; baselineId: string; candidateId: string }): React.JSX.Element {
  const { t } = useTranslation("experiment");
  const left = resourceLedger(props.baseline.calls);
  const right = resourceLedger(props.candidate.calls);
  const shared = new Set([...left.keys()].filter((resource) => right.has(resource)));
  return <section className="changes-view"><header className="view-explainer"><div><strong>{t("workbench.resourceActivity")}</strong><span>{t("workbench.resourceActivityDetail")}</span></div><p><b>{t("workbench.sharedResources", { count: shared.size })}</b></p></header><div className="pair-board resource-board"><ResourceLane role={t("workbench.baseline")} id={props.baselineId} resources={left} shared={shared} /><ResourceLane role={t("workbench.candidate")} id={props.candidateId} resources={right} shared={shared} /></div></section>;
}

function ResourceLane(props: { role: string; id: string; resources: Map<string, Set<string>>; shared: Set<string> }): React.JSX.Element {
  const { t } = useTranslation("experiment");
  return <article className="resource-lane"><header><small>{props.role}</small><strong>{props.id}</strong><span>{t("workbench.resourceCount", { count: props.resources.size })}</span></header><ol>{props.resources.size === 0 ? <li className="trace-empty">{t("workbench.noResourceKeys")}</li> : [...props.resources].map(([resource, tools]) => <li key={resource} className={props.shared.has(resource) ? "shared" : ""}><code>{resource}</code><span>{[...tools].join(" · ")}</span><em>{props.shared.has(resource) ? t("workbench.sharedTag") : t("workbench.runOnly")}</em></li>)}</ol></article>;
}

function EvidenceView(props: { baseline: LaneTrace; candidate: LaneTrace; resultRows: ContrastResult[]; comparability: Comparability; focusedResult?: ContrastResult }): React.JSX.Element {
  const { t } = useTranslation("experiment");
  const matches = relationCounts(props.baseline.calls, props.candidate.calls);
  const conclusion = props.focusedResult === undefined || props.focusedResult.status === "not-run"
    ? t("workbench.noVerdict")
    : props.focusedResult.reason;
  return <section className="evidence-view"><div className="evidence-layers"><article><small>{t("workbench.observedFacts")}</small><strong>{t("workbench.vsCalls", { baseline: props.baseline.calls.length, candidate: props.candidate.calls.length })}</strong><p>{t("workbench.matchSummary", { exact: matches.exact, sameResource: matches["same-resource"], sameTool: matches["same-tool"], unmatched: matches.none })}</p></article><article><small>{t("workbench.candidateExplanation")}</small><strong>{props.comparability.axis ? t("workbench.axisChanged", { axis: props.comparability.axis }) : t("workbench.noTreatment")}</strong><p>{t("workbench.treatmentDetail")}</p></article><article><small>{t("workbench.supportedConclusion")}</small><strong>{props.focusedResult?.status ?? t("workbench.notRun")}</strong><p>{conclusion}</p></article></div><section className="verdict-table"><header><small>{t("workbench.perComparison")}</small><strong>{t("workbench.noGlobalVerdict")}</strong></header>{props.resultRows.map((result) => <article key={result.id}><span className={`result-status status-${result.status}`}>{result.status}</span><strong>{result.id}</strong><code>{result.lanes.join(" ↔ ")}</code><p>{result.reason}</p></article>)}</section><p className="evidence-limit"><strong>{t("workbench.limitation")}</strong></p></section>;
}
