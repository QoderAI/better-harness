import type { ReactNode } from "react";
import {
  canLockCompare,
  type CheckpointHistoryPreview,
  type ExperimentSetupPreview,
  type ResolvedHistoryDraftPreview,
} from "../experiment-setup.js";
import { deriveTreatmentSummary, shortDigest } from "./experiment-comparison-model.js";
import type { ExperimentPreview, LaneDefinition } from "./experiment-view-types.js";

export type HistoryLoadState =
  | { phase: "loading" }
  | { phase: "disabled" }
  | { phase: "error"; detail: string }
  | { phase: "ready"; preview: CheckpointHistoryPreview };

export type HistoryActionState =
  | { phase: "idle" }
  | { phase: "resolving" }
  | { phase: "locking" }
  | { phase: "error"; detail: string };

export function ExperimentBuilder(props: {
  preview: ExperimentPreview;
  navigation?: ReactNode;
  history: HistoryLoadState;
  selectedHistoryId: string | null;
  historyDraft: ResolvedHistoryDraftPreview | null;
  historyAction: HistoryActionState;
  onSelectHistory: (id: string) => void;
  onLock: () => void;
}): React.JSX.Element {
  const setup = props.historyDraft?.setup ?? props.preview.setup;
  const source = setup.checkpointSource;
  const historyRequiresDraft = props.history.phase === "ready";
  const loadedDefinition = props.history.phase === "disabled";
  const lockable = historyRequiresDraft
    ? props.historyDraft?.lockable === true && props.historyDraft.selection.id === props.selectedHistoryId
    : loadedDefinition && canLockCompare(setup);
  const selectedHistoryLocked = props.preview.lock !== undefined
    && historyRequiresDraft
    && props.preview.lock.historyId === props.selectedHistoryId;
  const canOpenWorkbench = selectedHistoryLocked || loadedDefinition;
  const facts = [source.resource, source.revision, ...(source.history ? [source.history] : []), source.materialization];
  const executeRuns = props.preview.manifest.lanes.filter((lane) => lane.origin === "execute");
  const treatment = deriveTreatmentSummary(props.preview);
  const historicalGapText = setup.historicalGaps
    .map((item) => `${item.laneId}: ${item.missing.join(", ")}`)
    .join("; ");
  const historyLimitation = [
    setup.request.limitation,
    historicalGapText ? `Reference gaps — ${historicalGapText}.` : "",
  ].filter(Boolean).join(" ");
  const historical = setup.scenario === "historical-replay";
  const busy = props.historyAction.phase === "locking" || props.historyAction.phase === "resolving";
  const actionEnabled = (lockable || canOpenWorkbench) && !busy;
  const actionLabel = props.historyAction.phase === "locking"
    ? "Locking…"
    : canOpenWorkbench
      ? "Open workbench"
      : "Lock and compare";
  const status = builderStatus(props.history, props.historyAction, lockable, canOpenWorkbench);

  return <section className="builder-shell">
    <header className="builder-topbar">
      <div className="builder-brand"><strong>Harness Bench</strong><span>Design</span></div>
      {props.navigation}
      <div className="builder-state">
        <span>{props.preview.lock ? "Locked" : "Draft"}</span>
        <code>{shortDigest(props.historyDraft?.checkpoint.digest ?? props.preview.checkpoint.digest)}</code>
      </div>
    </header>
    <main className="builder-main">
      <header className="builder-title"><div>
        <small>{historical ? "Historical comparison" : "New request comparison"}</small>
        <h1>{historical ? "Compare a past agent run" : "Compare agents on one request"}</h1>
        <p>{historical
          ? "Choose a recorded request, confirm what changes, then compare the fresh runs."
          : "Confirm the shared request and treatment before opening the workbench."}</p>
      </div></header>

      <section className="builder-primary" aria-labelledby="history-title">
        <header className="flow-section-header"><div>
          <h2 id="history-title">{historical ? "Past request" : "Request"}</h2>
          <p>{historical
            ? "The recorded trajectory stays visible as the Reference run."
            : "Every fresh run receives this same request."}</p>
        </div></header>
        <HistoryPicker
          history={props.history}
          selectedId={props.selectedHistoryId}
          draft={props.historyDraft}
          action={props.historyAction}
          onSelect={props.onSelectHistory}
        />
        <div className="request-preview"><div>
          <small>{setup.request.label}</small>
          <code>{shortDigest(setup.request.promptHash)}</code>
        </div><p>{setup.request.prompt}</p></div>
        {historyLimitation
          ? <details className="provenance-details"><summary>Reference identity incomplete</summary><p>{historyLimitation}</p></details>
          : null}
      </section>

      <section className="builder-setup" aria-labelledby="setup-title">
        <header className="flow-section-header"><div>
          <h2 id="setup-title">Comparison</h2>
          <p>One checkpoint, one Reference, and {executeRuns.length} fresh runs.</p>
        </div><span className={`source-status status-${source.status}`}>{source.status === "ready" ? "Ready" : "Blocked"}</span></header>
        <div className="setup-summary">
          <article><small>Starting point</small><strong title={`${source.resource.value} · ${source.revision.value}`}>{source.resource.value} · {shortDigest(source.revision.value)}</strong><span>Shared by every fresh run</span></article>
          <article className={treatment.controlled ? "treatment-controlled" : "treatment-uncontrolled"}><small>{treatment.label}</small><strong>{treatment.value}</strong><span>{treatment.controlled ? "Only this setting changes" : "Comparison is descriptive"}</span></article>
          <article><small>Fresh runs</small><strong>{executeRuns.length} isolated copies</strong><span>Created only when Run starts</span></article>
        </div>
        <details className="setup-details">
          <summary>Technical details</summary>
          <div className="checkpoint-facts">{facts.map((fact) => <article key={`${fact.label}:${fact.value}`}><small>{fact.label}</small><strong title={fact.value}>{fact.value}</strong><p>{fact.detail ?? "Checkpoint fact"}</p></article>)}</div>
          <p className="adapter-detail">Checkpoint adapter: <strong>{source.adapter.label}</strong> <code>{source.adapter.id}</code></p>
          <div className="variant-table" role="table" aria-label="Comparison runs">
            <div className="variant-row variant-head" role="row"><span>Role</span><span>Run</span><span>Source</span><span>Harness</span><span>Model / profile</span><span>Trials</span></div>
            {props.preview.manifest.lanes.map((lane, index) => <div className="variant-row" role="row" key={lane.id}><strong>{builderRole(lane, index, props.preview.manifest.lanes)}</strong><code>{lane.id}</code><span>{lane.origin === "observed" ? "recorded" : "fresh"}</span><span>{laneHarness(lane)}</span><span>{laneRuntime(lane)}</span><span>{lane.trials ?? "recorded"}</span></div>)}
          </div>
          {source.limitation ? <p className="builder-warning"><strong>Starting point unavailable:</strong> {source.limitation}</p> : null}
        </details>
      </section>
    </main>
    <footer className="builder-footer"><div>
      <span className={`preflight-dot ${actionEnabled ? "ready" : "blocked"}`} />
      <div><strong>{status.title}</strong><p>{status.detail}</p></div>
    </div><button type="button" disabled={!actionEnabled} onClick={props.onLock}>{actionLabel}</button></footer>
  </section>;
}

function HistoryPicker(props: {
  history: HistoryLoadState;
  selectedId: string | null;
  draft: ResolvedHistoryDraftPreview | null;
  action: HistoryActionState;
  onSelect: (id: string) => void;
}): React.JSX.Element | null {
  if (props.history.phase === "disabled") return null;
  if (props.history.phase === "loading") {
    return <div className="history-picker history-loading" role="status"><strong>Project history</strong><span>Finding comparable requests…</span></div>;
  }
  if (props.history.phase === "error") {
    return <div className="history-picker history-error" role="alert"><strong>Project history unavailable</strong><span>{props.history.detail}</span></div>;
  }
  if (props.history.preview.items.length === 0) {
    return <div className="history-picker history-empty"><strong>Project history</strong><span>No comparable requests were found.</span></div>;
  }
  const selected = props.history.preview.items.find((item) => item.id === props.selectedId)
    ?? props.history.preview.items[0]!;
  return <div className="history-picker">
    <label><span>Historical request</span><select aria-label="History checkpoint" value={selected.id} onChange={(event) => props.onSelect(event.target.value)}>{props.history.preview.items.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.requestPreview}</option>)}</select></label>
    <div className="history-picker-meta"><span>{selected.occurredAt ? new Date(selected.occurredAt).toLocaleString() : "Timestamp unavailable"}</span><strong>{props.action.phase === "resolving" ? "Checking…" : props.draft?.selection.id === selected.id ? "Ready" : "Select to check"}</strong></div>
  </div>;
}

function builderStatus(
  history: HistoryLoadState,
  action: HistoryActionState,
  lockable: boolean,
  canOpenWorkbench: boolean,
): { title: string; detail: string } {
  if (action.phase === "locking") return { title: "Locking comparison…", detail: "Writing the immutable request and checkpoint definition." };
  if (action.phase === "error") return { title: "Comparison not ready", detail: action.detail };
  if (history.phase === "loading") return { title: "Checking project history", detail: "The lock action will appear after history is ready." };
  if (history.phase === "error") return { title: "Project history unavailable", detail: history.detail };
  if (canOpenWorkbench) return { title: "Comparison ready", detail: "Isolated copies are created only when Run starts." };
  if (lockable) return { title: "Ready to compare", detail: "Lock the selected request and checkpoint before opening the workbench." };
  return { title: "Choose a valid request", detail: "Resolve a request with a valid checkpoint and at least one fresh run." };
}

function builderRole(lane: LaneDefinition, index: number, lanes: LaneDefinition[]): string {
  if (lane.origin === "observed") return "Reference";
  const freshIndex = lanes.slice(0, index).filter((item) => item.origin === "execute").length;
  return freshIndex === 0 ? "Baseline" : "Candidate";
}

function laneHarness(lane: LaneDefinition): string {
  return lane.origin === "observed" ? lane.identity?.harnessId ?? "unverified" : lane.harnessId ?? "unknown";
}

function laneRuntime(lane: LaneDefinition): string {
  const identity = lane.origin === "observed" ? lane.identity : lane.runtime;
  return [identity?.model, identity?.profile].filter(Boolean).join(" · ") || "unverified";
}

export function requestProvenanceLabel(provenance: ExperimentSetupPreview["request"]["provenance"]): string {
  if (provenance === "verified-history") return "Verified history";
  if (provenance === "unverified-history") return "Reference unverified";
  return "New request";
}

export function compactPrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  return normalized.length > 92 ? `${normalized.slice(0, 89)}…` : normalized;
}
