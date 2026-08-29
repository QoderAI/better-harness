import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  canLockCompare,
  isExperimentRunnable,
  type CheckpointHistoryPreview,
  type ExperimentSetupPreview,
  type ResolvedHistoryDraftPreview,
} from "../../contracts/experiment-setup.js";
import { deriveTreatmentSummary, shortDigest } from "./experiment-comparison-model.js";
import { studioLocale } from "../i18n/index.js";
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
  const { t } = useTranslation("experiment");
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
  const runnable = isExperimentRunnable(setup);
  const canOpenWorkbench = runnable && (selectedHistoryLocked || loadedDefinition);
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
    ? t("builder.locking")
    : !runnable
      ? t("builder.checkpointUnavailable")
      : canOpenWorkbench
        ? t("builder.openWorkbench")
        : t("builder.lockAndCompare");
  const status = builderStatus(props.history, props.historyAction, lockable, canOpenWorkbench, runnable, source.limitation, t);

  return <section className="builder-shell">
    <header className="builder-topbar">
      <div className="builder-brand"><strong>Harness Bench</strong><span>{t("builder.design")}</span></div>
      {props.navigation}
      <div className="builder-state">
        <span>{props.preview.lock ? t("builder.locked") : t("builder.draft")}</span>
        <code>{shortDigest(props.historyDraft?.checkpoint.digest ?? props.preview.checkpoint.digest)}</code>
      </div>
    </header>
    <main className="builder-main">
      <header className="builder-title"><div>
        <small>{historical ? t("builder.titleHistorical") : t("builder.titleNew")}</small>
        <h1>{historical ? t("builder.h1Historical") : t("builder.h1New")}</h1>
        <p>{historical
          ? t("builder.detailHistorical")
          : t("builder.detailNew")}</p>
      </div></header>

      <section className="builder-primary" aria-labelledby="history-title">
        <header className="flow-section-header"><div>
          <h2 id="history-title">{historical ? t("builder.pastRequest") : t("builder.request")}</h2>
          <p>{historical
            ? t("builder.historyDetailHistorical")
            : t("builder.historyDetailNew")}</p>
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
          ? <details className="provenance-details"><summary>{t("builder.referenceIncomplete")}</summary><p>{historyLimitation}</p></details>
          : null}
      </section>

      <section className="builder-setup" aria-labelledby="setup-title">
        <header className="flow-section-header"><div>
          <h2 id="setup-title">{t("builder.compareTitle")}</h2>
          <p>{t("builder.compareDetail", { count: executeRuns.length })}</p>
        </div><span className={`source-status status-${source.status}`}>{source.status === "ready" ? t("builder.ready") : t("builder.blocked")}</span></header>
        <div className="setup-summary">
          <article><small>{t("builder.startingPoint")}</small><strong title={`${source.resource.value} · ${source.revision.value}`}>{source.resource.value} · {shortDigest(source.revision.value)}</strong><span>{t("builder.sharedByRuns")}</span></article>
          <article className={treatment.controlled ? "treatment-controlled" : "treatment-uncontrolled"}><small>{treatment.label}</small><strong>{treatment.value}</strong><span>{treatment.controlled ? t("builder.onlySetting") : t("builder.descriptive")}</span></article>
          <article><small>{t("builder.freshRuns")}</small><strong>{t("builder.isolatedCopies", { count: executeRuns.length })}</strong><span>{t("builder.createdOnRun")}</span></article>
        </div>
        <details className="setup-details">
          <summary>{t("builder.technicalDetails")}</summary>
          <div className="checkpoint-facts">{facts.map((fact) => <article key={`${fact.label}:${fact.value}`}><small>{fact.label}</small><strong title={fact.value}>{fact.value}</strong><p>{fact.detail ?? t("builder.checkpointFact")}</p></article>)}</div>
          <p className="adapter-detail">{t("builder.adapter", { label: source.adapter.label })} <code>{source.adapter.id}</code></p>
          <div className="variant-table" role="table" aria-label={t("builder.runsAria")}>
            <div className="variant-row variant-head" role="row"><span>{t("builder.cols.role")}</span><span>{t("builder.cols.run")}</span><span>{t("builder.cols.source")}</span><span>{t("builder.cols.harness")}</span><span>{t("builder.cols.model")}</span><span>{t("builder.cols.trials")}</span></div>
            {props.preview.manifest.lanes.map((lane, index) => <div className="variant-row" role="row" key={lane.id}><strong>{builderRole(lane, index, props.preview.manifest.lanes, t)}</strong><code>{lane.id}</code><span>{lane.origin === "observed" ? t("builder.recorded") : t("builder.fresh")}</span><span>{laneHarness(lane, t)}</span><span>{laneRuntime(lane, t)}</span><span>{lane.trials ?? t("builder.recorded")}</span></div>)}
          </div>
          {source.limitation ? <p className="builder-warning"><strong>{t("builder.startUnavailable")}</strong> {source.limitation}</p> : null}
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
  const { t } = useTranslation("experiment");
  if (props.history.phase === "disabled") return null;
  if (props.history.phase === "loading") {
    return <div className="history-picker history-loading" role="status"><strong>{t("builder.history.loading")}</strong><span>{t("builder.history.loadingDetail")}</span></div>;
  }
  if (props.history.phase === "error") {
    return <div className="history-picker history-error" role="alert"><strong>{t("builder.history.unavailable")}</strong><span>{props.history.detail}</span></div>;
  }
  if (props.history.preview.items.length === 0) {
    return <div className="history-picker history-empty"><strong>{t("builder.history.emptyTitle")}</strong><span>{t("builder.history.emptyDetail")}</span></div>;
  }
  const selected = props.history.preview.items.find((item) => item.id === props.selectedId)
    ?? props.history.preview.items[0]!;
  return <div className="history-picker">
    <label><span>{t("builder.history.requestLabel")}</span><select aria-label={t("builder.history.checkpointAria")} value={selected.id} onChange={(event) => props.onSelect(event.target.value)}>{props.history.preview.items.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.requestPreview}</option>)}</select></label>
    <div className="history-picker-meta"><span>{selected.occurredAt ? new Date(selected.occurredAt).toLocaleString(studioLocale()) : t("builder.history.noTimestamp")}</span><strong>{props.action.phase === "resolving" ? t("builder.history.checking") : props.draft?.selection.id === selected.id ? t("builder.history.ready") : t("builder.history.selectToCheck")}</strong></div>
  </div>;
}

function builderStatus(
  history: HistoryLoadState,
  action: HistoryActionState,
  lockable: boolean,
  canOpenWorkbench: boolean,
  runnable: boolean,
  limitation: string | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): { title: string; detail: string } {
  if (action.phase === "locking") return { title: t("builder.status.locking"), detail: t("builder.status.lockingDetail") };
  if (action.phase === "error") return { title: t("builder.status.notReady"), detail: t("builder.status.notReadyDetail", { detail: action.detail }) };
  if (history.phase === "loading") return { title: t("builder.status.checking"), detail: t("builder.status.checkingDetail") };
  if (history.phase === "error") return { title: t("builder.status.historyUnavailable"), detail: t("builder.status.historyUnavailableDetail", { detail: history.detail }) };
  if (!runnable) return { title: t("builder.status.blocked"), detail: limitation ?? t("builder.status.blockedDetail") };
  if (canOpenWorkbench) return { title: t("builder.status.ready"), detail: t("builder.status.readyDetail") };
  if (lockable) return { title: t("builder.status.readyToCompare"), detail: t("builder.status.readyToCompareDetail") };
  return { title: t("builder.status.chooseValid"), detail: t("builder.status.chooseValidDetail") };
}

function builderRole(lane: LaneDefinition, index: number, lanes: LaneDefinition[], t: (key: string) => string): string {
  if (lane.origin === "observed") return t("builder.role.reference");
  const freshIndex = lanes.slice(0, index).filter((item) => item.origin === "execute").length;
  return freshIndex === 0 ? t("builder.role.baseline") : t("builder.role.candidate");
}

function laneHarness(lane: LaneDefinition, t: (key: string) => string): string {
  return lane.origin === "observed" ? lane.identity?.harnessId ?? t("builder.unverified") : lane.harnessId ?? "unknown";
}

function laneRuntime(lane: LaneDefinition, t: (key: string) => string): string {
  const identity = lane.origin === "observed" ? lane.identity : lane.runtime;
  return [identity?.model, identity?.profile].filter(Boolean).join(" · ") || t("builder.unverified");
}

export function requestProvenanceLabel(provenance: ExperimentSetupPreview["request"]["provenance"], t: (key: string) => string): string {
  if (provenance === "verified-history") return t("provenance.verifiedHistory");
  if (provenance === "unverified-history") return t("provenance.unverifiedHistory");
  return t("provenance.newRequest");
}

export function compactPrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  return normalized.length > 92 ? `${normalized.slice(0, 89)}…` : normalized;
}
