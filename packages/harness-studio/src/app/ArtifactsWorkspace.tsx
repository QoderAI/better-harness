import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarBlank } from "@phosphor-icons/react/CalendarBlank";
import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { CaretLeft } from "@phosphor-icons/react/CaretLeft";
import { CaretRight } from "@phosphor-icons/react/CaretRight";
import { EyeSlash } from "@phosphor-icons/react/EyeSlash";
import { File } from "@phosphor-icons/react/File";
import { FileCode } from "@phosphor-icons/react/FileCode";
import { FileImage } from "@phosphor-icons/react/FileImage";
import { FilePpt } from "@phosphor-icons/react/FilePpt";
import { Folder } from "@phosphor-icons/react/Folder";
import { FolderOpen } from "@phosphor-icons/react/FolderOpen";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { TreeStructure } from "@phosphor-icons/react/TreeStructure";

import {
  isArtifactCatalogResponse,
  type ArtifactDescriptor,
  type ArtifactHostedIntentOutcomeV1,
  type ArtifactSurfaceSelectionV1,
} from "../contracts/artifact.js";
import {
  isWorkspaceArtifactNavigation,
  type StudioArtifactCatalogResponse,
  type WorkspaceArtifactNavigation,
  type WorkspaceArtifactObservation,
} from "../contracts/workspace-artifact.js";
import { ArtifactView } from "./artifacts/ArtifactView.js";
import { ArtifactInteractionPane } from "./artifacts/ArtifactInteractionPane.js";
import type { ArtifactHostedIntentFailure } from "./artifacts/ArtifactSurface.js";
import { studioLocale } from "./i18n/index.js";
import { useRovingFocus } from "./roving-tablist.js";
import type { StudioConfig } from "./studio-shell-model.js";

type ArtifactScope =
  | { kind: "all" }
  | { kind: "day"; value: string }
  | { kind: "session"; value: string }
  | { kind: "folder"; value: string }
  | { kind: "file"; value: string };
type ArtifactNarrowPane = "scope" | "artifacts" | "preview";
type ArtifactScopeMode = "date" | "files";

interface ArtifactSessionGroup {
  id: string;
  savedAt: string;
  prompt: string;
  provider?: string;
  artifactIds: string[];
}

interface ArtifactDayGroup {
  day: string;
  observations: WorkspaceArtifactObservation[];
  artifactIds: string[];
  sessions: ArtifactSessionGroup[];
}

export function ArtifactsWorkspace(props: { config: StudioConfig; openProjectAction?: { label: string; onClick: () => void } }): React.JSX.Element {
  const { t } = useTranslation("artifacts");
  const [catalog, setCatalog] = useState<StudioArtifactCatalogResponse>();
  const [failure, setFailure] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [scope, setScope] = useState<ArtifactScope>({ kind: "all" });
  const [scopeMode, setScopeMode] = useState<ArtifactScopeMode>("date");
  const [query, setQuery] = useState("");
  const [narrowPane, setNarrowPane] = useState<ArtifactNarrowPane>("scope");
  const [liveGeneration, setLiveGeneration] = useState(0);
  const [liveUpdates, setLiveUpdates] = useState(true);
  const [catalogRefresh, setCatalogRefresh] = useState(0);
  const [surfaceSelection, setSurfaceSelection] = useState<ArtifactSurfaceSelectionV1>();
  const [surfaceIntentOutcome, setSurfaceIntentOutcome] = useState<ArtifactHostedIntentOutcomeV1>();
  const [surfaceIntentFailure, setSurfaceIntentFailure] = useState<ArtifactHostedIntentFailure>();
  const [adoptedIntentId, setAdoptedIntentId] = useState<string>();

  useEffect(() => {
    setSurfaceSelection(undefined);
    setSurfaceIntentOutcome(undefined);
    setSurfaceIntentFailure(undefined);
    setAdoptedIntentId(undefined);
  }, [catalog?.snapshot.catalogId]);

  useEffect(() => {
    setAdoptedIntentId(undefined);
  }, [
    surfaceIntentOutcome?.artifactId,
    surfaceIntentOutcome?.revision,
    surfaceIntentOutcome?.bindingId,
    surfaceIntentOutcome?.intentId,
  ]);

  useEffect(() => {
    if (!props.config.artifactsEnabled) return;
    let cancelled = false;
    let requestSequence = 0;
    const refreshCatalog = async (liveUpdate = false): Promise<void> => {
      const request = ++requestSequence;
      try {
        const response = await fetch("/api/artifacts");
        if (!response.ok) throw new Error(`Artifact catalog failed (${response.status}).`);
        const payload: unknown = await response.json();
        if (!isArtifactCatalogResponse(payload)) throw new Error("Artifact catalog contract is unsupported.");
        const candidate = payload as StudioArtifactCatalogResponse;
        if (candidate.navigation !== undefined && !isWorkspaceArtifactNavigation(candidate.navigation)) {
          throw new Error("Artifact workspace navigation contract is unsupported.");
        }
        if (cancelled || request !== requestSequence) return;
        setFailure(undefined);
        setCatalog(candidate);
        if (liveUpdate) setLiveGeneration((value) => value + 1);
      } catch (error) {
        if (!cancelled && request === requestSequence) setFailure(error instanceof Error ? error.message : String(error));
      }
    };
    void refreshCatalog();
    const events = new EventSource("/api/artifacts/events");
    const invalidate = (): void => { void refreshCatalog(true); };
    events.addEventListener("artifacts.invalidated", invalidate);
    events.addEventListener("open", () => { if (!cancelled) setLiveUpdates(true); });
    events.addEventListener("error", () => {
      if (!cancelled && events.readyState === EventSource.CLOSED) setLiveUpdates(false);
    });
    return () => { cancelled = true; events.close(); };
  }, [catalogRefresh, props.config.artifactsEnabled]);

  const days = useMemo(() => artifactDays(catalog?.navigation), [catalog?.navigation]);
  const effectiveMode: ArtifactScopeMode = catalog?.navigation === undefined ? "files" : scopeMode;
  const scopedArtifacts = useMemo(() => {
    if (catalog === undefined) return [];
    const ids = artifactIdsForScope(scope, catalog.navigation, catalog.artifacts);
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return catalog.artifacts.filter((artifact) => ids.has(artifact.id)
      && artifact.label.toLocaleLowerCase().includes(normalizedQuery));
  }, [catalog, query, scope]);

  useEffect(() => {
    if (catalog === undefined || catalog.artifacts.length === 0) return;
    const selectedStillVisible = scopedArtifacts.some((artifact) => artifact.id === selected);
    if (selectedStillVisible) return;
    if (scope.kind === "all" && catalog.navigation !== undefined && days[0] !== undefined) {
      const nextScope: ArtifactScope = { kind: "day", value: days[0].day };
      const ids = artifactIdsForScope(nextScope, catalog.navigation, catalog.artifacts);
      setScope(nextScope);
      setSelected(catalog.artifacts.find((artifact) => ids.has(artifact.id))?.id);
      return;
    }
    setSelected(scopedArtifacts[0]?.id ?? catalog.artifacts[0]?.id);
  }, [catalog, days, scope, scopedArtifacts, selected]);

  const active = catalog?.artifacts.find((artifact) => artifact.id === selected);
  const activeArtifactId = active?.id;
  const activeRevision = active?.revision.id;
  const activeBindingId = active?.renderer.bindingId;
  const receiveIntentOutcome = useCallback((outcome: ArtifactHostedIntentOutcomeV1): void => {
    if (activeArtifactId === undefined || activeRevision === undefined || activeBindingId === undefined
      || outcome.artifactId !== activeArtifactId || outcome.revision !== activeRevision
      || outcome.bindingId !== activeBindingId) return;
    setSurfaceIntentFailure(undefined);
    setSurfaceIntentOutcome(outcome);
    setSurfaceSelection({
      artifactId: outcome.artifactId,
      revision: outcome.revision,
      bindingId: outcome.bindingId,
      address: outcome.sourceTarget?.address ?? outcome.effect.target.address,
    });
  }, [activeArtifactId, activeBindingId, activeRevision]);

  const receiveIntentFailure = useCallback((intentFailure: ArtifactHostedIntentFailure): void => {
    if (activeArtifactId === undefined || activeRevision === undefined || activeBindingId === undefined
      || intentFailure.artifactId !== activeArtifactId || intentFailure.revision !== activeRevision
      || intentFailure.bindingId !== activeBindingId) return;
    setSurfaceIntentFailure(intentFailure);
  }, [activeArtifactId, activeBindingId, activeRevision]);

  const narrowTabs = useRovingFocus<ArtifactNarrowPane>({
    ids: ["scope", "artifacts", "preview"],
    active: narrowPane,
    onSelect: setNarrowPane,
  });

  if (!props.config.artifactsEnabled) {
    return <ArtifactEmpty title={props.config.workspaceConnected ? t("empty.noAvailableTitle") : t("empty.openWorkspaceTitle")} detail={props.config.workspaceConnected
      ? t("empty.noAvailableDetail")
      : props.config.workspaceDiscoveryEnabled ? t("empty.discoveryDetail") : t("empty.noDiscoveryDetail")} action={props.openProjectAction} />;
  }
  if (failure !== undefined) return <ArtifactEmpty title={t("empty.unreadableTitle")} detail={failure} />;
  if (catalog === undefined) return <p className="artifact-status" role="status">{t("indexing")}</p>;
  if (catalog.artifacts.length === 0) {
    return <ArtifactEmpty title={t("empty.noChangedTitle")} detail={t("empty.noChangedDetail")} action={props.openProjectAction} />;
  }

  const activeObservations = active === undefined ? [] : observationsForArtifact(catalog.navigation, active.id);
  const activeSurfaceSelection = active !== undefined
    && surfaceSelection?.artifactId === active.id
    && surfaceSelection.revision === active.revision.id
    && surfaceSelection.bindingId === active.renderer.bindingId
    ? surfaceSelection
    : undefined;
  const activeIntentOutcome = active !== undefined
    && surfaceIntentOutcome?.artifactId === active.id
    && surfaceIntentOutcome.revision === active.revision.id
    && surfaceIntentOutcome.bindingId === active.renderer.bindingId
    ? surfaceIntentOutcome
    : undefined;
  const activeIntentFailure = active !== undefined
    && surfaceIntentFailure?.artifactId === active.id
    && surfaceIntentFailure.revision === active.revision.id
    && surfaceIntentFailure.bindingId === active.renderer.bindingId
    ? surfaceIntentFailure.message
    : undefined;
  const activeIntentDestination = activeIntentOutcome?.destination;
  const intentDestinationArtifact = activeIntentDestination === undefined
    ? undefined
    : catalog.artifacts.find((artifact) => artifact.id === activeIntentDestination.artifactId
      && artifact.label === activeIntentDestination.artifactLabel
      && artifact.revision.id === activeIntentDestination.revision
      && artifact.renderer.bindingId === activeIntentDestination.bindingId
      && artifact.interaction !== undefined);
  const adoptedDestinationArtifact = activeIntentOutcome?.effect.kind === "steering"
    && activeIntentOutcome.intentId === adoptedIntentId
    ? intentDestinationArtifact
    : undefined;
  const collaborationArtifact = activeIntentOutcome?.effect.kind === "steering" && activeIntentDestination !== undefined
    ? adoptedDestinationArtifact
    : adoptedDestinationArtifact ?? (active?.interaction === undefined ? undefined : active);
  const selectScope = (next: ArtifactScope): void => {
    setScope(next);
    const ids = artifactIdsForScope(next, catalog.navigation, catalog.artifacts);
    setSelected(catalog.artifacts.find((artifact) => ids.has(artifact.id))?.id);
    setNarrowPane("artifacts");
  };
  const selectArtifact = (id: string): void => {
    setSelected(id);
    setNarrowPane("preview");
  };

return <section className="artifact-workspace" data-narrow-pane={narrowPane} aria-label={t("workspaceAria")}>
    <div className="artifact-narrow-tabs" role="tablist" aria-label={t("panesAria")} onKeyDown={narrowTabs.onKeyDown}>
      {(["scope", "artifacts", "preview"] as const).map((pane) => <button
        key={pane}
        type="button"
        role="tab"
        id={`artifact-tab-${pane}`}
        aria-controls={`artifact-${pane}-pane`}
        aria-selected={narrowPane === pane}
        disabled={pane === "preview" && active === undefined}
        ref={narrowTabs.itemRef(pane)}
        tabIndex={narrowTabs.tabIndexFor(pane)}
        onClick={() => setNarrowPane(pane)}
      >{pane === "scope" ? t("panes.browse") : t(`panes.${pane}`)}</button>)}
    </div>

    <aside className="artifact-scope-pane" id="artifact-scope-pane" role="tabpanel" aria-labelledby="artifact-tab-scope">
<header><div><small>{catalog.navigation === undefined ? t("scopeHeader.configuredSource") : t("scopeHeader.projectScope")}</small><h2>{catalog.navigation === undefined ? t("scopeHeader.compatibilityCatalog") : t("scopeHeader.browse")}</h2></div><span>{catalog.artifacts.length}</span></header>
      <div className="artifact-scope-switch" role="tablist" aria-label={t("scopeModeAria")}>
        <button type="button" role="tab" aria-selected={effectiveMode === "date"} disabled={catalog.navigation === undefined} onClick={() => setScopeMode("date")}><CalendarBlank aria-hidden="true" size={14} />{t("scopeMode.date")}</button>
        <button type="button" role="tab" aria-selected={effectiveMode === "files"} onClick={() => setScopeMode("files")}><TreeStructure aria-hidden="true" size={14} />{t("scopeMode.files")}</button>
      </div>
      {effectiveMode === "date" && catalog.navigation !== undefined
        ? <ArtifactDateNavigator days={days} scope={scope} onSelect={selectScope} />
        : <ArtifactFileNavigator artifacts={catalog.artifacts} scope={scope} onSelect={selectScope} />}
      {!liveUpdates && <p className="artifact-pane-note" role="note">{t("liveUpdatesStopped")}</p>}
    </aside>

    <section className="artifact-list-pane" id="artifact-artifacts-pane" role="tabpanel" aria-labelledby="artifact-tab-artifacts">
      <header><div><small>{scopeDescription(scope, catalog.navigation, catalog.artifacts, t)}</small><h2>{t("panes.artifacts")}</h2></div><span>{scopedArtifacts.length}</span></header>
      <label className="artifact-search"><MagnifyingGlass aria-hidden="true" size={14} /><span className="sr-only">{t("search.srOnly")}</span><input value={query} type="search" placeholder={t("search.placeholder")} onChange={(event) => setQuery(event.currentTarget.value)} /></label>
      <nav className="artifact-rows" aria-label={t("scopedAria")}>
        {scopedArtifacts.length === 0
          ? <p className="artifact-list-empty">{query.trim() === "" ? t("noMatch") : t("noMatchQuery", { query })}</p>
          : scopedArtifacts.map((artifact) => <ArtifactRow key={artifact.id} artifact={artifact} selected={artifact.id === selected} onSelect={selectArtifact} />)}
      </nav>
      {catalog.omitted.length > 0 && <p className="artifact-pane-note" role="note">{t("omitted", { count: catalog.omitted.length })}</p>}
    </section>

    <main className="artifact-preview-pane" id="artifact-preview-pane" role="tabpanel" aria-labelledby="artifact-tab-preview">
      {active === undefined
        ? <p className="artifact-status" role="status">{t("selectPreview")}</p>
        : <>
          <header className="artifact-editor-header">
            <div><strong title={active.label}>{basename(active.label)}</strong><small>{formatLabel(active.format)} · {formatBytes(active.size)} · {active.adapter.id} · {t("currentRevision")} {shortRevision(active.revision.id)}</small></div>
            <span title={active.label}>{activeObservations[0] === undefined ? dirname(active.label) : `${activeObservations[0].provider ?? t("common:localAgent")} · ${formatObservedTime(activeObservations[0].savedAt, studioLocale())}`}</span>
          </header>
          <div className={`artifact-shared-workspace${collaborationArtifact === undefined && activeIntentOutcome === undefined && activeIntentFailure === undefined ? " solo" : ""}`}>
            <div className="artifact-surface-slot"><ArtifactView
              authorityId={catalog.snapshot.catalogId}
              artifact={active}
              liveGeneration={liveGeneration}
              onSelection={setSurfaceSelection}
              onIntentOutcome={receiveIntentOutcome}
              onIntentFailure={receiveIntentFailure}
            /></div>
            {collaborationArtifact === undefined && (activeIntentOutcome !== undefined || activeIntentFailure !== undefined)
              && <ArtifactIntentPane
                outcome={activeIntentOutcome}
                failure={activeIntentFailure}
                destinationAvailable={intentDestinationArtifact !== undefined}
                onUseDraft={() => {
                  if (activeIntentOutcome?.effect.kind === "steering" && intentDestinationArtifact !== undefined) {
                    setAdoptedIntentId(activeIntentOutcome.intentId);
                  }
                }}
              />}
            {collaborationArtifact !== undefined && <ArtifactInteractionPane
              artifact={collaborationArtifact}
              agentRunsEnabled={props.config.acpEnabled}
              agentLabel={props.config.acpAgentLabel}
              surfaceSelectedAddress={adoptedDestinationArtifact === undefined
                ? activeSurfaceSelection?.address
                : activeIntentOutcome?.effect.target.address}
              surfaceIntentOutcome={activeIntentOutcome}
              surfaceIntentFailure={activeIntentFailure}
              onSelectedAddressChange={(address) => {
                if (adoptedDestinationArtifact !== undefined) return;
                if (active.renderer.bindingId === undefined) return;
                setSurfaceSelection({
                  artifactId: active.id,
                  revision: active.revision.id,
                  bindingId: active.renderer.bindingId,
                  address,
                });
              }}
              onApplied={() => setCatalogRefresh((value) => value + 1)}
            />}
          </div>
        </>}
    </main>
  </section>;
}

function ArtifactIntentPane(props: {
  outcome?: ArtifactHostedIntentOutcomeV1;
  failure?: string;
  destinationAvailable: boolean;
  onUseDraft: () => void;
}): React.JSX.Element {
  const { t } = useTranslation("artifacts");
  const steering = props.outcome?.effect.kind === "steering" ? props.outcome.effect.steering : undefined;
  return <aside className="artifact-collaboration-pane artifact-intent-pane" aria-label={t("intent.aria")} aria-live="polite">
    <header><div><small>{t("intent.eyebrow")}</small><h2>{props.failure !== undefined ? t("intent.rejected") : steering === undefined ? t("intent.selection") : t("intent.steeringDraft")}</h2></div><span>{props.failure !== undefined ? t("intent.closed") : t("intent.recorded")}</span></header>
    <div className="artifact-collaboration-scroll">
      {props.failure !== undefined
        ? <p className="artifact-collaboration-error" role="alert">{props.failure}</p>
        : props.outcome !== undefined && <section className="artifact-collaboration-section artifact-intent-state">
        <header><span aria-hidden="true">✓</span><div><h3>{t("intent.recordedNotExecuted")}</h3><p>{t("intent.recordedDetail")}</p></div></header>
        <dl>
          <div><dt>{t("intent.target")}</dt><dd>{props.outcome.effect.target.label}</dd></div>
          <div><dt>{t("intent.address")}</dt><dd><code>{props.outcome.effect.target.address}</code></dd></div>
          {props.outcome.destination !== undefined && <div><dt>{t("intent.artifact")}</dt><dd>{props.outcome.destination.artifactLabel}</dd></div>}
          {props.outcome.sourceTarget !== undefined && <div><dt>{t("intent.canvasSource")}</dt><dd><code>{props.outcome.sourceTarget.address}</code></dd></div>}
          {steering !== undefined && <div><dt>{t("intent.draft")}</dt><dd>{steering.message}</dd></div>}
        </dl>
        {steering !== undefined && props.outcome.destination !== undefined && <button
          type="button"
          className="primary artifact-collaboration-primary"
          disabled={!props.destinationAvailable}
          onClick={props.onUseDraft}
        >{props.destinationAvailable ? t("intent.useDraft") : t("intent.destinationChanged")}</button>}
      </section>}
    </div>
  </aside>;
}

function ArtifactDateNavigator(props: { days: ArtifactDayGroup[]; scope: ArtifactScope; onSelect: (scope: ArtifactScope) => void }): React.JSX.Element {
  const { t } = useTranslation("artifacts");
  const sessionScope = props.scope.kind === "session" ? props.scope.value : undefined;
  const activeDay = props.scope.kind === "day"
    ? props.scope.value
    : sessionScope !== undefined
      ? props.days.find((day) => day.sessions.some((session) => session.id === sessionScope))?.day
      : props.days[0]?.day;
  const initial = parseLocalDay(activeDay ?? props.days[0]?.day ?? localDay(new Date()));
  const [month, setMonth] = useState(() => new Date(initial.getFullYear(), initial.getMonth(), 1));
  useEffect(() => {
    const selectedDate = parseLocalDay(activeDay ?? props.days[0]?.day ?? localDay(new Date()));
    setMonth((current) => current.getFullYear() === selectedDate.getFullYear() && current.getMonth() === selectedDate.getMonth()
      ? current
      : new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
  }, [activeDay, props.days]);
  const selectedDay = props.days.find((day) => day.day === activeDay) ?? props.days[0];
  const dayMap = new Map(props.days.map((day) => [day.day, day]));
  const cells = calendarCells(month);
  const locale = studioLocale();
  const weekdays = t("date.weekdays", { returnObjects: true }) as string[];
  const weekdayShorts = t("date.weekdaysShort", { returnObjects: true }) as string[];
  const monthLabel = month.toLocaleDateString(locale, { month: "long", year: "numeric" });
  return <div className="artifact-date-navigator">
    <header className="artifact-calendar-header">
      <button type="button" aria-label={t("date.previousMonth")} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><CaretLeft aria-hidden="true" size={14} /></button>
      <strong>{monthLabel}</strong>
      <button type="button" aria-label={t("date.nextMonth")} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><CaretRight aria-hidden="true" size={14} /></button>
    </header>
    <div className="artifact-calendar" role="grid" aria-label={t("date.activityAria", { month: monthLabel })}>
      {weekdayShorts.map((label, index) => <span key={`${label}-${index}`} role="columnheader" aria-label={weekdays[index]}>{label}</span>)}
      {cells.map((cell, index) => cell === undefined
        ? <i key={`empty-${index}`} aria-hidden="true" />
        : <button
          key={cell.day}
          type="button"
          role="gridcell"
          aria-selected={cell.day === activeDay}
          aria-label={`${cell.date.toLocaleDateString(locale, { dateStyle: "long" })}${dayMap.has(cell.day) ? `, ${t("date.activitySummary", { count: dayMap.get(cell.day)!.artifactIds.length })}` : `, ${t("date.noActivity")}`}`}
          disabled={!dayMap.has(cell.day)}
          onClick={() => props.onSelect({ kind: "day", value: cell.day })}
        ><span>{cell.date.getDate()}</span>{dayMap.has(cell.day) && <small aria-hidden="true" />}</button>)}
    </div>
    {selectedDay !== undefined && <section className="artifact-day-sessions" aria-label={t("date.sessionsOn", { day: selectedDay.day })}>
      <header><strong>{formatDayHeading(selectedDay.day, locale)}</strong><span>{t("date.sessionsAndArtifacts", { sessions: selectedDay.sessions.length, artifacts: selectedDay.artifactIds.length })}</span></header>
      {selectedDay.sessions.map((session) => <button
        key={session.id}
        type="button"
        className={props.scope.kind === "session" && props.scope.value === session.id ? "selected" : undefined}
        aria-current={props.scope.kind === "session" && props.scope.value === session.id ? "true" : undefined}
        onClick={() => props.onSelect({ kind: "session", value: session.id })}
      ><small>{session.provider ?? t("common:localAgent")} · {formatObservedTime(session.savedAt, locale)}</small><strong>{session.prompt}</strong><span>{t("date.sessionArtifactCount", { count: session.artifactIds.length })}</span></button>)}
    </section>}
  </div>;
}

function ArtifactFileNavigator(props: { artifacts: ArtifactDescriptor[]; scope: ArtifactScope; onSelect: (scope: ArtifactScope) => void }): React.JSX.Element {
  const { t } = useTranslation("artifacts");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const folders = fileTreeFolders(props.artifacts);
  const rootFiles = props.artifacts.filter((artifact) => !artifact.label.includes("/"));
  const toggle = (path: string): void => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });
  return <nav className="artifact-file-tree" aria-label={t("fileTree.aria")} role="tree">
    <button type="button" role="treeitem" aria-level={1} className={props.scope.kind === "all" ? "selected" : undefined} onClick={() => props.onSelect({ kind: "all" })}><FolderOpen aria-hidden="true" size={15} /><strong>{t("fileTree.all")}</strong><span>{props.artifacts.length}</span></button>
    {rootFiles.map((artifact) => <button key={artifact.id} type="button" role="treeitem" aria-level={1} className={`artifact-tree-file${props.scope.kind === "file" && props.scope.value === artifact.id ? " selected" : ""}`} aria-current={props.scope.kind === "file" && props.scope.value === artifact.id ? "true" : undefined} onClick={() => props.onSelect({ kind: "file", value: artifact.id })}><File aria-hidden="true" size={14} /><strong>{artifact.label}</strong></button>)}
    {folders.map((folder) => <ArtifactFolderRow key={folder.path} folder={folder} level={1} collapsed={collapsed} scope={props.scope} onToggle={toggle} onSelect={props.onSelect} />)}
  </nav>;
}

interface ArtifactFolderNode {
  name: string;
  path: string;
  folders: ArtifactFolderNode[];
  files: ArtifactDescriptor[];
}

function ArtifactFolderRow(props: { folder: ArtifactFolderNode; level: number; collapsed: Set<string>; scope: ArtifactScope; onToggle: (path: string) => void; onSelect: (scope: ArtifactScope) => void }): React.JSX.Element {
  const { t } = useTranslation("artifacts");
  const isCollapsed = props.collapsed.has(props.folder.path);
  const count = folderArtifactCount(props.folder);
  return <>
    <div className="artifact-tree-folder" role="treeitem" aria-level={props.level} aria-expanded={!isCollapsed} style={{ "--tree-depth": props.level } as React.CSSProperties}>
      <button type="button" className="artifact-tree-disclosure" aria-label={t(`folder.${isCollapsed ? "expand" : "collapse"}`, { path: props.folder.path })} onClick={() => props.onToggle(props.folder.path)}>{isCollapsed ? <CaretRight aria-hidden="true" size={13} /> : <CaretDown aria-hidden="true" size={13} />}</button>
      <button type="button" className={props.scope.kind === "folder" && props.scope.value === props.folder.path ? "selected" : undefined} aria-current={props.scope.kind === "folder" && props.scope.value === props.folder.path ? "true" : undefined} onClick={() => props.onSelect({ kind: "folder", value: props.folder.path })}><Folder aria-hidden="true" size={15} /><strong>{props.folder.name}</strong><span>{count}</span></button>
    </div>
    {!isCollapsed && <div role="group">
      {props.folder.folders.map((folder) => <ArtifactFolderRow key={folder.path} folder={folder} level={props.level + 1} collapsed={props.collapsed} scope={props.scope} onToggle={props.onToggle} onSelect={props.onSelect} />)}
      {props.folder.files.map((artifact) => <button
        key={artifact.id}
        type="button"
        role="treeitem"
        aria-level={props.level + 1}
        style={{ "--tree-depth": props.level + 1 } as React.CSSProperties}
        className={`artifact-tree-file${props.scope.kind === "file" && props.scope.value === artifact.id ? " selected" : ""}`}
        aria-current={props.scope.kind === "file" && props.scope.value === artifact.id ? "true" : undefined}
        onClick={() => props.onSelect({ kind: "file", value: artifact.id })}
      ><File aria-hidden="true" size={14} /><strong>{basename(artifact.label)}</strong></button>)}
    </div>}
  </>;
}

function ArtifactRow(props: { artifact: ArtifactDescriptor; selected: boolean; onSelect: (id: string) => void }): React.JSX.Element {
  const { t } = useTranslation("artifacts");
  const ArtifactIcon = props.artifact.format === "pptx" ? FilePpt : props.artifact.family === "images-diagrams" ? FileImage : props.artifact.family === "source-text" ? FileCode : File;
  const parent = dirname(props.artifact.label);
  return <button type="button" className={`artifact-row${props.selected ? " selected" : ""}`} aria-current={props.selected ? "true" : undefined} onClick={() => props.onSelect(props.artifact.id)}>
    <ArtifactIcon aria-hidden="true" size={16} />
    <span className="artifact-row-copy"><strong>{basename(props.artifact.label)}</strong><small>{parent === "" ? t("row.workspaceRoot") : parent} · {formatLabel(props.artifact.format)} · {formatBytes(props.artifact.size)}</small></span>
    {props.artifact.renderer.status === "unavailable" && <EyeSlash aria-label={props.artifact.renderer.reason ?? t("previewUnavailable")} size={15} />}
  </button>;
}

function ArtifactEmpty(props: { title: string; detail: string; action?: { label: string; onClick: () => void } }): React.JSX.Element {
  const { t } = useTranslation("artifacts");
  return <main className="artifact-empty"><span><FolderOpen aria-hidden="true" size={22} /></span><small>{t("empty.eyebrow")}</small><h1>{props.title}</h1><p>{props.detail}</p>{props.action && <button className="primary" type="button" onClick={props.action.onClick}>{props.action.label}</button>}</main>;
}

function artifactDays(navigation: WorkspaceArtifactNavigation | undefined): ArtifactDayGroup[] {
  if (navigation === undefined) return [];
  const rows = new Map<string, WorkspaceArtifactObservation[]>();
  for (const observation of navigation.observations) {
    const day = localDay(new Date(observation.savedAt));
    const current = rows.get(day) ?? [];
    current.push(observation);
    rows.set(day, current);
  }
  return [...rows.entries()].sort(([left], [right]) => right.localeCompare(left)).map(([day, observations]) => {
    const sessions = new Map<string, ArtifactSessionGroup>();
    for (const observation of observations) {
      const existing = sessions.get(observation.sessionId) ?? {
        id: observation.sessionId,
        savedAt: observation.savedAt,
        prompt: observation.prompt,
        ...(observation.provider === undefined ? {} : { provider: observation.provider }),
        artifactIds: [],
      };
      if (!existing.artifactIds.includes(observation.artifactId)) existing.artifactIds.push(observation.artifactId);
      sessions.set(observation.sessionId, existing);
    }
    return {
      day,
      observations,
      artifactIds: [...new Set(observations.map((observation) => observation.artifactId))],
      sessions: [...sessions.values()].sort((left, right) => right.savedAt.localeCompare(left.savedAt)),
    };
  });
}

function artifactIdsForScope(scope: ArtifactScope, navigation: WorkspaceArtifactNavigation | undefined, artifacts: ArtifactDescriptor[]): Set<string> {
  if (scope.kind === "all") return new Set(artifacts.map((artifact) => artifact.id));
  if (scope.kind === "file") return new Set([scope.value]);
  if (scope.kind === "folder") return new Set(artifacts.filter((artifact) => artifact.label.startsWith(`${scope.value}/`)).map((artifact) => artifact.id));
  if (navigation === undefined) return new Set(artifacts.map((artifact) => artifact.id));
  return new Set(navigation.observations
    .filter((observation) => scope.kind === "session" ? observation.sessionId === scope.value : localDay(new Date(observation.savedAt)) === scope.value)
    .map((observation) => observation.artifactId));
}

function observationsForArtifact(navigation: WorkspaceArtifactNavigation | undefined, artifactId: string): WorkspaceArtifactObservation[] {
  return navigation?.observations.filter((observation) => observation.artifactId === artifactId)
    .sort((left, right) => right.savedAt.localeCompare(left.savedAt)) ?? [];
}

function scopeDescription(scope: ArtifactScope, navigation: WorkspaceArtifactNavigation | undefined, artifacts: ArtifactDescriptor[], t: (key: string, options?: Record<string, unknown>) => string): string {
  if (scope.kind === "all") return t("scopeDescription.all");
  if (scope.kind === "day") return formatDayHeading(scope.value, studioLocale());
  if (scope.kind === "folder") return scope.value;
  if (scope.kind === "file") return artifacts.find((artifact) => artifact.id === scope.value)?.label ?? t("scopeDescription.selectedFile");
  return navigation?.observations.find((observation) => observation.sessionId === scope.value)?.prompt ?? t("scopeDescription.selectedSession");
}

function fileTreeFolders(artifacts: ArtifactDescriptor[]): ArtifactFolderNode[] {
  const root: ArtifactFolderNode = { name: "", path: "", folders: [], files: [] };
  for (const artifact of [...artifacts].sort((left, right) => left.label.localeCompare(right.label))) {
    const parts = artifact.label.split("/");
    if (parts.length === 1) {
      root.files.push(artifact);
      continue;
    }
    let current = root;
    for (const part of parts.slice(0, -1)) {
      const path = current.path === "" ? part : `${current.path}/${part}`;
      let folder = current.folders.find((candidate) => candidate.name === part);
      if (folder === undefined) {
        folder = { name: part, path, folders: [], files: [] };
        current.folders.push(folder);
      }
      current = folder;
    }
    current.files.push(artifact);
  }
  return root.folders;
}

function folderArtifactCount(folder: ArtifactFolderNode): number {
  return folder.files.length + folder.folders.reduce((total, child) => total + folderArtifactCount(child), 0);
}

function calendarCells(month: Date): Array<{ day: string; date: Date } | undefined> {
  const cells: Array<{ day: string; date: Date } | undefined> = Array.from({ length: month.getDay() }, () => undefined);
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  for (let day = 1; day <= count; day += 1) {
    const date = new Date(month.getFullYear(), month.getMonth(), day);
    cells.push({ day: localDay(date), date });
  }
  return cells;
}

function localDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDay(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year!, month! - 1, day!);
}

function formatDayHeading(value: string, locale: string): string {
  return parseLocalDay(value).toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" });
}

function formatObservedTime(value: string, locale: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

function basename(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function dirname(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

const FORMAT_LABELS: Record<string, string> = {
  docx: "Word",
  file: "File",
  lottie: "Lottie",
  md: "Markdown",
  mermaid: "Mermaid",
  mmd: "Mermaid",
  pdf: "PDF",
  pptx: "PowerPoint",
  xlsx: "Excel",
};

function formatLabel(format: string): string {
  return FORMAT_LABELS[format] ?? format.toUpperCase();
}

function shortRevision(value: string): string {
  return `${value.slice(7, 15)}…${value.slice(-6)}`;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
