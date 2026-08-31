import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { studioI18n, studioLocale } from "./i18n/index.js";
import {
  filteredCallCount,
  groupToolRuns,
  observedDurationTotal,
  projectSessionTrace,
  EMPTY_USAGE_REPORT,
  replayIndexForFile,
  sessionTurns,
  type InspectorCommit as Commit,
  type InspectorCacheReuse as CacheReuse,
  type InspectorReplayEvent as ReplayEvent,
  type InspectorSession as Session,
  type InspectorToolCall as ToolCall,
  type InspectorTurn as Turn,
  type InspectorUsageProgressionPoint as UsageProgressionPoint,
  type InspectorUsageReport as UsageReport,
} from "./inspector-session-model.js";

/** Module-level translate bound to the live instance; safe because every
 *  caller re-renders through useTranslation when the language changes. */
function inspectorT(key: string, options?: Record<string, unknown>): string {
  return studioI18n.t(`inspector:${key}`, options);
}

type Mode = "feature" | "date";
type ViewMode = "trace" | "replay" | "usage";

interface FeatureNode {
  id: string;
  title: string;
  type?: string;
  stage?: string | null;
  status?: string | null;
  evidence?: string;
  children?: string[];
  refs?: { prompts?: string[] };
}

interface Story extends FeatureNode {
  sessionLinks?: Array<{ sessionId: string; evidenceKind?: string; confidence?: string }>;
  commitHashes?: string[];
}

interface Day {
  date: string;
  sessionIds?: string[];
  commitHashes?: string[];
}

interface Report {
  kind: "HarnessInspectorReportV1";
  generatedAt?: string;
  workspace?: { name?: string };
  featureTree?: { roots?: string[]; nodes?: FeatureNode[] };
  stories?: Story[];
  days?: Day[];
  sessions?: Session[];
  commits?: Commit[];
  providers?: Array<{ platform: string; sessionCount: number }>;
  filters?: { platform?: string };
  diagnostics?: string[];
}

interface Item {
  story?: Story;
  session?: Session;
  date?: Day;
  commitHashes?: string[];
}

export function InspectorWorkbench(props: { fallback: ReactNode; reportUrl?: string }): React.JSX.Element {
  const [loaded, setLoaded] = useState<{ report: Report; css: string }>();
  const [failure, setFailure] = useState<string>();
  const [shadow, setShadow] = useState<ShadowRoot>();

  useEffect(() => {
    let cancelled = false;
    setLoaded(undefined);
    setFailure(undefined);
    void (async () => {
      try {
        const [reportResponse, cssResponse] = await Promise.all([
          fetch(props.reportUrl ?? "api/inspector-report"),
          fetch("assets/inspector-workbench.css"),
        ]);
        if (!reportResponse.ok) throw new Error(`Inspector report failed (${reportResponse.status}).`);
        if (!cssResponse.ok) throw new Error("Inspector workbench stylesheet is unavailable.");
        const report = await reportResponse.json() as Report;
        if (report.kind !== "HarnessInspectorReportV1") throw new Error("Inspector report contract is unsupported.");
        const css = scopeCss(await cssResponse.text());
        if (!cancelled) setLoaded({ report, css });
      } catch (error) {
        if (!cancelled) setFailure(error instanceof Error ? error.message : "React Inspector failed to load.");
      }
    })();
    return () => { cancelled = true; };
  }, [props.reportUrl]);

  if (failure) return <div className="inspector-fallback-shell"><p className="inspector-fallback-message" role="status">{failure}</p>{props.fallback}</div>;
  return <div className="inspector-native-shell">
    {!loaded && <p className="inspector-native-status" role="status">Loading React Inspector workbench…</p>}
    <div className="inspector-native-host" aria-label={inspectorT("workbenchAria")} ref={(host) => {
      if (host && !shadow) setShadow(host.shadowRoot ?? host.attachShadow({ mode: "open" }));
    }} />
    {loaded && shadow ? createPortal(<><style>{loaded.css}{REACT_CSS}</style><ReactInspector report={loaded.report} /></>, shadow) : null}
  </div>;
}

function ReactInspector({ report }: { report: Report }): React.JSX.Element {
  const { t } = useTranslation("inspector");
  const nodes = report.featureTree?.nodes ?? [];
  const stories = report.stories ?? [];
  const days = report.days ?? [];
  const sessions = report.sessions ?? [];
  const commits = report.commits ?? [];
  const hasFeatureEvidence = stories.some((story) => (story.sessionLinks?.length ?? 0) + (story.commitHashes?.length ?? 0) > 0);
  const initialMode: Mode = nodes.length && hasFeatureEvidence ? "feature" : "date";
  const [mode, setMode] = useState<Mode>(initialMode);
  const [scope, setScope] = useState(initialMode === "feature" ? report.featureTree?.roots?.[0] ?? nodes[0]?.id ?? "" : days.at(-1)?.date ?? "");
  const [pickerCollapsed, setPickerCollapsed] = useState(false);
  const [collapsedBranches, setCollapsedBranches] = useState<Set<string>>(new Set());
  const [collapsedCards, setCollapsedCards] = useState<Set<number>>(new Set());
  const [selectedSession, setSelectedSession] = useState<Session>();
  const sessionTrigger = useRef<HTMLElement | null>(null);
  const inspectorRoot = useRef<HTMLDivElement>(null);
  const workbenchScrollTop = useRef(0);
  const sessionWasOpen = useRef(false);
  const byNode = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const byStory = useMemo(() => new Map(stories.map((story) => [story.id, story])), [stories]);
  const bySession = useMemo(() => new Map(sessions.map((session) => [session.sessionId, session])), [sessions]);
  const byCommit = useMemo(() => new Map(commits.map((commit) => [commit.hash, commit])), [commits]);
  const items = useMemo(() => itemsForScope(mode, scope, days, byNode, byStory, bySession), [mode, scope, days, byNode, byStory, bySession]);
  const itemSessions = [...new Map(items.filter((item) => item.session).map((item) => [item.session!.sessionId, item.session!])).values()];
  const itemCommits = new Set(items.flatMap((item) => commitsFor(item, byCommit).map((commit) => commit.hash)));
  const itemStories = new Set(items.flatMap((item) => item.story ? [item.story.id] : []));
  const workspaceName = report.workspace?.name ?? "workspace";

  useEffect(() => {
    const syncSessionFromUrl = (): void => {
      const sessionId = new URL(globalThis.location.href).searchParams.get("inspector-session");
      setSelectedSession(sessionId ? bySession.get(sessionId) : undefined);
    };
    syncSessionFromUrl();
    globalThis.addEventListener("popstate", syncSessionFromUrl);
    return () => globalThis.removeEventListener("popstate", syncSessionFromUrl);
  }, [bySession]);

  function openSession(session: Session, trigger?: HTMLElement): void {
    sessionTrigger.current = trigger ?? null;
    const url = new URL(globalThis.location.href);
    url.searchParams.set("inspector-session", session.sessionId);
    url.searchParams.delete("inspector-view");
    url.searchParams.delete("inspector-event");
    globalThis.history.pushState({ inspectorSession: session.sessionId }, "", url);
    setSelectedSession(session);
  }

  function closeSession(): void {
    const url = new URL(globalThis.location.href);
    if (url.searchParams.has("inspector-session") && globalThis.history.state?.inspectorSession === selectedSession?.sessionId) {
      globalThis.history.back();
      return;
    }
    url.searchParams.delete("inspector-session");
    url.searchParams.delete("inspector-view");
    url.searchParams.delete("inspector-event");
    globalThis.history.replaceState(globalThis.history.state, "", url);
    setSelectedSession(undefined);
  }

  useEffect(() => {
    if (selectedSession !== undefined) return;
    const trigger = sessionTrigger.current;
    sessionTrigger.current = null;
    if (trigger?.isConnected) globalThis.requestAnimationFrame(() => trigger.focus());
  }, [selectedSession]);

  useEffect(() => {
    const root = inspectorRoot.current;
    if (!root) return;
    if (selectedSession !== undefined && !sessionWasOpen.current) {
      workbenchScrollTop.current = root.scrollTop;
      root.scrollTop = 0;
      sessionWasOpen.current = true;
    } else if (selectedSession === undefined && sessionWasOpen.current) {
      sessionWasOpen.current = false;
      globalThis.requestAnimationFrame(() => { root.scrollTop = workbenchScrollTop.current; });
    }
  }, [selectedSession]);

  function changeMode(next: Mode): void {
    setMode(next);
    setScope(next === "feature" ? report.featureTree?.roots?.[0] ?? nodes[0]?.id ?? "" : days.at(-1)?.date ?? "");
  }

  return <div ref={inspectorRoot} className={`native-inspector-root${selectedSession ? " session-open" : ""}`} data-studio-native-inspector data-react-inspector-workbench>
    <div
      className={`app${pickerCollapsed ? " picker-collapsed" : ""}`}
      data-harness-inspector
      inert={selectedSession ? true : undefined}
      aria-hidden={selectedSession ? true : undefined}
    >
      <aside className="scope-picker" aria-label={inspectorT("scopePickerAria")}>
        <div className="brand"><div className="brand-copy"><strong>Harness Inspector</strong><span>{workspaceName}</span></div><button className="picker-toggle" type="button" aria-expanded={!pickerCollapsed} aria-label={pickerCollapsed ? inspectorT("expandTree") : inspectorT("collapseTree")} onClick={() => setPickerCollapsed((value) => !value)}><span className="collapse-label">{inspectorT("hide")}</span><span className="expand-label">{inspectorT("showTree")}</span></button></div>
        <div className="mode-tabs" role="tablist" aria-label={inspectorT("pickerModeAria")}><button role="tab" aria-selected={mode === "feature"} tabIndex={mode === "feature" ? 0 : -1} className={mode === "feature" ? "active" : undefined} onClick={() => changeMode("feature")} onKeyDown={(event) => moveInspectorTab(event, "date", changeMode)}>{t("capability")}</button><button role="tab" aria-selected={mode === "date"} tabIndex={mode === "date" ? 0 : -1} className={mode === "date" ? "active" : undefined} onClick={() => changeMode("date")} onKeyDown={(event) => moveInspectorTab(event, "feature", changeMode)}>{t("date")}</button></div>
        <section className={`picker-panel${mode === "feature" ? " active" : ""}`} role="tabpanel" hidden={mode !== "feature"}><div className="picker-heading"><strong>{t("capabilityTree")}</strong><span>{t("nodeCount", { count: nodes.length })}</span></div>{nodes.length ? <FeatureTree roots={report.featureTree?.roots ?? []} byNode={byNode} selected={scope} collapsed={collapsedBranches} onSelect={setScope} onToggle={(id) => setCollapsedBranches(toggle(collapsedBranches, id))} /> : <p className="picker-empty">{t("noFeatureTree")}</p>}</section>
        <section className={`picker-panel date-picker-panel${mode === "date" ? " active" : ""}`} role="tabpanel" hidden={mode !== "date"}><DatePicker days={days} bySession={bySession} selected={scope} onSelect={setScope} /></section>
      </aside>
      <main className="workspace">
        <header className="workspace-header"><nav className="workspace-breadcrumb" aria-label={t("breadcrumbAria")}><span>Harness Inspector</span><i>/</i><strong>{mode === "date" ? scope : byNode.get(scope)?.title ?? t("deliveryWorkbench")}</strong></nav><div className="workspace-header-meta"><div className="scope-metrics" aria-label={t("scopeMetricsAria")}><Metric value={itemStories.size} label={t("metrics.stories")} singular={t("metrics.story")} /><Metric value={itemSessions.length} label={t("metrics.sessions")} singular={t("metrics.session")} /><Metric value={itemSessions.reduce((sum, session) => sum + totalCalls(session), 0)} label={t("metrics.calls")} singular={t("metrics.call")} /><Metric value={itemCommits.size} label={t("metrics.commits")} singular={t("metrics.commit")} /></div><span className="window-badge">{platformBadge(report)} · {t("sessionCount", { count: sessions.length })}</span></div></header>
        <div className="workspace-scroll">{(report.diagnostics?.length ?? 0) > 0 && <details className="react-diagnostics"><summary>{t("diagnostics", { count: report.diagnostics!.length })}</summary><ul>{report.diagnostics!.map((diagnostic) => <li key={diagnostic}>{diagnostic}</li>)}</ul></details>}<section className="workbench-list" aria-live="polite">{items.length ? items.map((item, index) => <WorkbenchCard key={`${item.session?.sessionId ?? item.story?.id ?? "commit"}-${index}`} item={item} commits={commitsFor(item, byCommit)} collapsed={collapsedCards.has(index)} onToggle={() => setCollapsedCards(toggleNumber(collapsedCards, index))} onOpen={openSession} />) : <div className="empty-state">{t("emptyScope")}</div>}</section></div>
      </main>
    </div>
    {selectedSession && <SessionView workspaceName={workspaceName} generatedAt={report.generatedAt} session={selectedSession} commits={commitsFor({ session: selectedSession }, byCommit)} onClose={closeSession} />}
  </div>;
}

function FeatureTree(props: { roots: string[]; byNode: Map<string, FeatureNode>; selected: string; collapsed: Set<string>; onSelect(id: string): void; onToggle(id: string): void }): React.JSX.Element {
  const { t } = useTranslation("inspector");
  const render = (node: FeatureNode): React.JSX.Element => {
    const children = (node.children ?? []).map((id) => props.byNode.get(id)).filter((child): child is FeatureNode => Boolean(child));
    const expanded = !props.collapsed.has(node.id);
    const status = node.status === "complete" ? "complete" : node.status === "todo" ? "todo" : "neutral";
    // The node's own type is already carried by the row class, so a generic
    // "capability" caption would only repeat itself under every row.
    const detail = children.length ? `${children.length} items` : node.stage ?? undefined;
    return <li key={node.id} className={`tree-item ${node.type ?? "feature"}`} role="treeitem" aria-expanded={children.length ? expanded : undefined}><div className="tree-line">{children.length ? <button className="tree-branch-toggle" type="button" aria-expanded={expanded} aria-label={t(`${expanded ? "collapse" : "expand"}Branch`, { title: node.title })} onClick={() => props.onToggle(node.id)}><span aria-hidden="true">{expanded ? "⌄" : "›"}</span></button> : <span className="tree-branch-spacer" />}<button className={`tree-row ${node.type ?? "feature"}${props.selected === node.id ? " active" : ""}`} type="button" onClick={() => props.onSelect(node.id)}><span className={`tree-check ${status}`} role="img" aria-label={status}><span aria-hidden="true">{status === "complete" ? "✓" : ""}</span></span><span className="tree-copy"><strong>{node.title}</strong>{detail !== undefined && <small>{detail}</small>}</span>{node.evidence && node.evidence !== "declared" && <span className={`evidence ${node.evidence}`}>{node.evidence}</span>}</button></div>{children.length > 0 && expanded && <ul className="tree-children" role="group">{children.map(render)}</ul>}</li>;
  };
  const roots = props.roots.map((id) => props.byNode.get(id)).filter((node): node is FeatureNode => Boolean(node));
  return <ul className="capability-tree" role="tree" aria-label={t("capabilityTree")}>{roots.map(render)}</ul>;
}

function DatePicker({ days, bySession, selected, onSelect }: { days: Day[]; bySession: Map<string, Session>; selected: string; onSelect(value: string): void }): React.JSX.Element {
  const { t } = useTranslation("inspector");
  const locale = studioLocale();
  const byDate = useMemo(() => new Map(days.map((day) => [day.date, day])), [days]);
  const months = useMemo(() => [...new Set(days.map((day) => day.date.slice(0, 7)))].sort(), [days]);
  const latestMonth = months.at(-1) ?? "";
  const selectedMonth = byDate.has(selected) ? selected.slice(0, 7) : "";
  const [month, setMonth] = useState(() => selectedMonth || latestMonth);
  useEffect(() => {
    setMonth((current) => selectedMonth || (months.includes(current) ? current : latestMonth));
  }, [latestMonth, months, selectedMonth]);
  if (!days.length) return <p className="picker-empty">{t("noTimestamped")}</p>;
  const monthIndex = months.indexOf(month);
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const last = new Date(Date.UTC(year, monthNumber, 0));
  const start = new Date(first); start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  const end = new Date(last); end.setUTCDate(end.getUTCDate() + ((7 - end.getUTCDay()) % 7));
  const cells: ReactNode[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    const inMonth = cursor.getUTCFullYear() === year && cursor.getUTCMonth() === monthNumber - 1;
    const day = inMonth ? byDate.get(date) : undefined;
    cells.push(day ? <button key={date} className={`date-cell${selected === date ? " active" : ""}`} type="button" aria-current={selected === date ? "date" : undefined} aria-label={`${formatDate(date, locale)}, ${t("datePicker.selectionSummary", { sessions: day.sessionIds?.length ?? 0, commits: day.commitHashes?.length ?? 0 })}`} onClick={() => onSelect(date)}><time dateTime={date}>{cursor.getUTCDate()}</time><span className="date-activity" /></button> : <span key={date} className={`date-cell empty${inMonth ? "" : " outside"}`} aria-hidden="true"><time dateTime={date}>{cursor.getUTCDate()}</time></span>);
  }
  const day = byDate.get(selected);
  const sessions = (day?.sessionIds ?? []).map((id) => bySession.get(id)).filter((session): session is Session => Boolean(session));
  const contextSummary = dayContextSnapshotPresentation(sessions, t);
  const label = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(first);
  return <><div className="date-calendar"><header><div className="date-calendar-nav"><button type="button" aria-label={t("datePicker.prevMonth")} disabled={monthIndex <= 0} onClick={() => setMonth(months[monthIndex - 1]!)}><span aria-hidden="true">‹</span></button><strong>{label}</strong><button type="button" aria-label={t("datePicker.nextMonth")} disabled={monthIndex >= months.length - 1} onClick={() => setMonth(months[monthIndex + 1]!)}><span aria-hidden="true">›</span></button></div><span className="date-calendar-zone">{t("datePicker.utc")}</span></header><div className="date-weekdays" aria-hidden="true">{(t("datePicker.weekdaysShort", { returnObjects: true }) as string[]).map((value, index) => <span key={`${value}-${index}`}>{value}</span>)}</div><div className="date-grid" role="group" aria-label={t("datePicker.calendarAria", { label })}>{cells}</div><div className="date-selection-summary" aria-live="polite"><strong>{day ? formatDate(day.date, locale) : t("datePicker.selectDate")}</strong><span>{day ? t("datePicker.selectionSummary", { sessions: day.sessionIds?.length ?? 0, commits: day.commitHashes?.length ?? 0 }) : ""}</span></div>{(contextSummary.observedSessions > 0 || contextSummary.compactionCount > 0) && <div className="date-context-summary"><strong>{contextSummary.observedSessions > 0 ? t("datePicker.daySnapshotSum", { tokens: formatTokenCount(contextSummary.snapshotTokenSum) }) : t("datePicker.dayContextUnavailable")}</strong><span>{t("datePicker.dayContextCoverage", { observed: contextSummary.observedSessions, total: sessions.length, count: contextSummary.compactionCount })}</span></div>}</div><nav className="date-session-navigator" aria-label={t("datePicker.sessionsOnAria")}><div className="date-session-heading"><strong>{t("datePicker.sessionsLabel")}</strong><span>{sessions.length}</span></div><div className="date-session-list">{sessions.length ? sessions.map((session) => { const summary = sessionContextSnapshotPresentation(session, t); return <a className="date-session-row" href={`#workbench-${encodeURIComponent(session.sessionId)}`} key={session.sessionId}><span className="date-session-row-top"><span className="date-session-row-meta"><strong>{session.platform ?? t("datePicker.agent")}</strong><time>{formatClock(session.firstSeen)}</time><span>{formatDuration(session.durationMs)}</span></span><span className="date-session-row-stat">{t("datePicker.callsCount", { count: totalCalls(session) })}</span></span><span className="date-session-title">{sessionTitle(session)}</span>{summary.compact && <span className="date-session-token-summary" title={summary.title}>{summary.compact}</span>}</a>; }) : <p className="picker-empty">{t("datePicker.noSessionsOnDate")}</p>}</div></nav></>;
}

function Metric({ value, label, singular }: { value: number; label: string; singular: string }): React.JSX.Element | null {
  return value ? <span className="metric" aria-label={`${value} ${value === 1 ? singular : label}`}><strong>{value}</strong><span className="metric-label">{value === 1 ? singular : label}</span><span className="metric-short">{label.slice(0, 5)}</span></span> : null;
}

function WorkbenchCard({ item, commits, collapsed, onToggle, onOpen }: { item: Item; commits: Commit[]; collapsed: boolean; onToggle(): void; onOpen(session: Session, trigger?: HTMLElement): void }): React.JSX.Element {
  const { t } = useTranslation("inspector");
  const session = item.session;
  // A scope that retained nothing collapses to its title row. Three empty lanes
  // read as a completed dashboard, and repeating them down a long scope buries
  // the scopes that do carry evidence.
  const retained = Boolean(item.story?.refs?.prompts?.[0])
    || (session?.prompts?.length ?? 0) > 0
    || (session?.toolActivity?.calls?.length ?? 0) > 0
    || commits.length > 0;
  const contextSummary = session ? sessionContextSnapshotPresentation(session, t) : null;
  const head = <header className="workbench-head"><div className="workbench-title-line"><div className="workbench-meta">{session ? <><span className="workbench-provider">{session.platform ?? t("datePicker.agent")}</span><span>{formatClock(session.firstSeen)}</span><span className="workbench-duration">{formatDuration(session.durationMs)}</span>{contextSummary?.compact && <span className="workbench-token-summary" title={contextSummary.title}>{contextSummary.compact}</span>}</> : <span>No linked Session</span>}</div><h3>{item.story?.title ?? (session ? sessionTitle(session) : "Commits without a linked Session")}</h3></div><div className="head-actions">{session && <button className="prepare-button" type="button" onClick={(event) => onOpen(session, event.currentTarget)}>Open session</button>}{retained && <button className="card-collapse" type="button" aria-expanded={!collapsed} onClick={onToggle}>{collapsed ? "+" : "−"}</button>}</div></header>;
  if (!retained) return <article className="workbench workbench-unevidenced" id={session ? `workbench-${encodeURIComponent(session.sessionId)}` : undefined}>{head}{session ? <p className="workbench-unevidenced-note">No prompt, tool call, or commit was retained for this Session.</p> : null}</article>;
  return <article className={`workbench${collapsed ? " card-collapsed" : ""}`} id={session ? `workbench-${encodeURIComponent(session.sessionId)}` : undefined}>{head}<div className="workbench-grid"><PromptLane item={item} onOpen={onOpen} /><div className="lane-resizer prompt" role="separator" /><ActivityLane session={session} onOpen={onOpen} /><div className="lane-resizer delivery" role="separator" /><DeliveryLane commits={commits} /></div></article>;
}

function PromptLane({ item, onOpen }: { item: Item; onOpen(session: Session, trigger?: HTMLElement): void }): React.JSX.Element {
  const { t } = useTranslation("inspector");
  const prompts = item.session?.prompts ?? [];
  const declared = item.story?.refs?.prompts?.[0];
  return <section className={`lane prompt-lane${declared || prompts.length ? "" : " lane-empty"}`}><div className="lane-title"><strong>{t("lanes.prompts")}</strong><span>{t("lanes.promptsRetained", { count: prompts.length })}</span></div>{declared && <div className="intent-card declared-intent"><p>{declared}</p><small>{t("lanes.featureTreeIntent", { evidence: item.story?.evidence ?? "declared" })}</small></div>}{prompts.map((prompt, index) => <div className="intent-card" key={`${prompt.timestamp ?? index}-${index}`}><p>{prompt.text}</p><small>{prompt.turnIndex ? t("lanes.userTurn", { index: prompt.turnIndex }) : t("lanes.retainedPrompt")}{prompt.timestamp ? ` · ${formatClock(prompt.timestamp)}` : ""}</small></div>)}{!declared && !prompts.length && <div className="empty-state">{t("lanes.noPrompt")}</div>}{item.session && <button className="lane-more" type="button" onClick={(event) => onOpen(item.session!, event.currentTarget)}>{t("lanes.openSessionView")}</button>}</section>;
}

function ActivityLane({ session, onOpen }: { session?: Session; onOpen(session: Session, trigger?: HTMLElement): void }): React.JSX.Element {
  const { t } = useTranslation("inspector");
  const calls = session?.toolActivity?.calls ?? [];
  if (!session || !calls.length) return <section className="lane activity-lane lane-empty"><div className="lane-title"><strong>{t("lanes.activity")}</strong><span>{t("lanes.zeroCalls")}</span></div><div className="empty-state">{t("lanes.noToolCall")}</div></section>;
  const counts = countActions(calls).slice(0, 6);
  const max = Math.max(...counts.map(([, value]) => value.count), 1);
  return <section className="lane activity-lane"><div className="lane-title"><strong>{t("lanes.activity")}</strong><span>{t("lanes.pathsCount", { count: session.toolActivity?.files?.length ?? session.files?.length ?? 0 })}</span></div><div className="activity-summary"><div className="activity-total"><strong>{calls.length}</strong><span>{t("lanes.callsFailed", { count: session.toolActivity?.failedCalls ?? calls.filter((call) => call.status === "failed").length })}</span></div><div className="family-bars">{counts.map(([label, value]) => <div className="family-row" key={label}><span title={label}><i className="family-dot" style={{ background: familyColor(value.family) }} />{label}</span><div className="family-track"><div className="family-fill" style={{ width: `${Math.max(2, value.count / max * 100)}%`, background: familyColor(value.family) }} /></div><strong>{value.count}</strong></div>)}</div></div><details className="activity-details"><summary><span>{t("lanes.expandActions", { count: calls.length })}</span><small>{t("lanes.focusView")}</small></summary><div className="react-action-list">{calls.map((call) => <ToolRow call={call} key={call.id} />)}</div><div className="activity-actions"><button className="activity-action primary" type="button" onClick={(event) => onOpen(session, event.currentTarget)}>{t("lanes.openSession")}</button></div></details></section>;
}

function DeliveryLane({ commits }: { commits: Commit[] }): React.JSX.Element {
  const { t } = useTranslation("inspector");
  if (!commits.length) return <section className="lane delivery-lane lane-empty"><div className="lane-title"><strong>{t("lanes.commitsFiles")}</strong><span>{t("lanes.zeroCommits")}</span></div><div className="empty-state">{t("lanes.noCommit")}</div></section>;
  return <section className="lane delivery-lane"><div className="lane-title"><strong>{t("lanes.commitsFiles")}</strong><span>{t("lanes.commitsCount", { count: commits.length })}</span></div><div className="delivery-content">{commits.map((commit) => <details className="commit-card commit-card-expanded" open key={commit.hash}><summary className="commit-head"><div className="commit-head-line"><span className="commit-id"><span className="commit-chevron">›</span><code>{commit.shortHash ?? commit.hash.slice(0, 8)}</code></span><span className="evidence observed">{t("lanes.observed")}</span></div><p>{commit.subject ?? t("lanes.commitEvidence")}</p><div className="commit-stats">{t("lanes.filesCount", { count: commit.fileCount ?? commit.files?.length ?? 0 })} · +{commit.linesAdded ?? 0} / -{commit.linesRemoved ?? 0}</div></summary><div className="file-tree">{(commit.files ?? []).map((file) => <div className="file-row" key={file.path}><code>{file.path}</code><span className="delta">{file.added == null ? t("lanes.binary") : `+${file.added}`} / {file.removed == null ? t("lanes.binary") : `-${file.removed}`}</span></div>)}</div></details>)}</div></section>;
}

function SessionView({ workspaceName, generatedAt, session, commits, onClose }: { workspaceName: string; generatedAt?: string; session: Session; commits: Commit[]; onClose(): void }): React.JSX.Element {
  const { t } = useTranslation("inspector");
  const [mode, setModeState] = useState<ViewMode>(() => {
    const requested = new URL(globalThis.location.href).searchParams.get("inspector-view");
    return requested === "replay" || requested === "usage" ? requested : "trace";
  });
  const view = useRef<HTMLElement>(null);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  useEffect(() => { if (view.current) view.current.scrollTop = 0; }, [mode]);
  function setMode(next: ViewMode, restoreFocus = false): void {
    const url = new URL(globalThis.location.href);
    if (next === "replay" || next === "usage") url.searchParams.set("inspector-view", next);
    else {
      url.searchParams.delete("inspector-view");
      url.searchParams.delete("inspector-event");
    }
    if (next !== "replay") url.searchParams.delete("inspector-event");
    globalThis.history.replaceState(globalThis.history.state, "", url);
    setModeState(next);
    if (restoreFocus && next === "trace") globalThis.requestAnimationFrame(() => view.current?.querySelector<HTMLElement>("#react-session-panel-trace")?.focus());
  }
  return <section ref={view} className="session-view" role="dialog" aria-modal="true" aria-labelledby="session-view-title"><header className="session-nav"><nav className="session-crumbs" aria-label={t("session.crumbsAria")}><span>{workspaceName}</span><i>/</i><span>{t("session.sessionsLabel")}</span><i>/</i><strong>{sessionTitle(session)}</strong></nav><button className="session-close" type="button" autoFocus onClick={onClose}>{t("session.close")}</button></header><div className="session-shell"><header className="session-titlebar"><div className="session-notebook-brand"><strong>Harness Inspector</strong></div><div className="session-title-copy"><small>{t("session.retainedCopy", { platform: session.platform ?? t("datePicker.agent") })}</small><h2 id="session-view-title">{sessionTitle(session)}</h2></div><div className="session-title-actions">{mode === "usage" ? <button className="usage-report-return" type="button" onClick={() => setMode("trace", true)}>{t("session.backToTrace")}</button> : <div className="session-mode-tabs" role="tablist" aria-label={t("session.modeAria")}><button id="react-session-tab-trace" role="tab" aria-controls="react-session-panel-trace" aria-selected={mode === "trace"} tabIndex={mode === "trace" ? 0 : -1} onClick={() => setMode("trace")} onKeyDown={(event) => moveInspectorTab(event, "replay", setMode)}>{t("session.trace")}</button><button id="react-session-tab-replay" role="tab" aria-controls="react-session-panel-replay" aria-selected={mode === "replay"} tabIndex={mode === "replay" ? 0 : -1} onClick={() => setMode("replay")} onKeyDown={(event) => moveInspectorTab(event, "trace", setMode)}>{t("session.replay")}</button></div>}</div></header>{mode === "trace" ? <SessionTrace session={session} commits={commits} generatedAt={generatedAt} onViewUsage={() => setMode("usage")} /> : mode === "replay" ? <SessionReplay session={session} /> : <SessionUsageReport session={session} generatedAt={generatedAt} />}</div></section>;
}

type EvidenceKind = "prompts" | "responses" | "intermediate" | "usage" | "commits" | "tools";

function SessionTrace({ session, commits, generatedAt, onViewUsage }: { session: Session; commits: Commit[]; generatedAt?: string; onViewUsage(): void }): React.JSX.Element {
  const { t } = useTranslation("inspector");
  const projection = useMemo(() => projectSessionTrace(session, commits), [session, commits]);
  const turns = projection.turns;
  const calls = session.toolActivity?.calls ?? [];
  const toolNames = useMemo(() => [...new Set(calls.map((call) => call.toolName ?? call.operation ?? "tool"))], [calls]);
  const [kinds, setKinds] = useState<Set<EvidenceKind>>(() => new Set(["prompts", "responses", "intermediate", "usage", "commits", "tools"]));
  const [enabledTools, setEnabledTools] = useState<Set<string>>(() => new Set(toolNames));
  const [showFiles, setShowFiles] = useState(true);
  const [openProcesses, setOpenProcesses] = useState<Set<number>>(new Set());
  const cellRefs = useRef(new Map<string, HTMLElement>());
  const visibleCalls = filteredCallCount(calls, enabledTools);
  const responseCount = session.dialogue?.responseCount ?? turns.filter(({ turn }) => turn.response).length;
  const noteCount = session.dialogue?.noteCount ?? turns.reduce((sum, { turn }) => sum + (turn.steps ?? []).filter((step) => step.kind === "note").length, 0);
  const usageCount = turns.reduce((sum, { turn }) => sum + (turn.usageEventCount ?? (turn.steps ?? []).filter((step) => step.kind === "usage").length), 0);

  function toggleKind(kind: EvidenceKind): void { setKinds((current) => toggle(current, kind)); }
  function toggleTool(name: string): void { setEnabledTools((current) => toggle(current, name)); }
  function jumpTo(value: string): void { cellRefs.current.get(value)?.scrollIntoView({ behavior: "smooth", block: "start" }); }

  return <section id="react-session-panel-trace" role="tabpanel" aria-labelledby="react-session-tab-trace" className="session-mode-panel" tabIndex={-1}><div className="session-layout"><main className="session-notebook-main"><div className="session-timeline" aria-label={t("session.cellsAria")}>
    {calls.length > 0 && <SessionActivity calls={calls} />}
    {turns.length ? turns.map(({ turn, calls: turnCalls, commits: turnCommits }) => {
      const anchor = turn.anchorId ?? `turn-${turn.index}`;
      const processOpen = openProcesses.has(turn.index);
      const intermediateCount = turn.intermediateCount ?? (turn.steps ?? []).filter((step) => step.kind === "note").length;
      const usageEventCount = turn.usageEventCount ?? (turn.steps ?? []).filter((step) => step.kind === "usage").length;
      const eventCount = turn.eventCount ?? intermediateCount + usageEventCount + (turn.toolCallCount ?? turnCalls.length);
      const shown = turn.shownEventCount ?? turn.steps?.length ?? 0;
      const summary = t("turn.summary", { events: turn.processTruncated ? t("turn.processTruncatedSummary", { shown, total: eventCount }) : String(eventCount), responses: usageEventCount, intermediate: intermediateCount, tools: turn.toolCallCount ?? turnCalls.length, duration: Number.isFinite(turn.durationMs) ? ` · ${formatDuration(turn.durationMs)}` : "" });
      return <section className="session-cell" data-session-cell="run" key={anchor} ref={(node) => { if (node) cellRefs.current.set(anchor, node); else cellRefs.current.delete(anchor); }}><header className="session-turn-head"><strong>{t("turn.head", { index: turn.index })}</strong><span>{summary}</span></header><section className="session-turn" data-turn-index={turn.index}>{kinds.has("prompts") && <><div className="session-row-marker session-input-marker"><span className="turn-select">{t("turn.inMarker", { index: turn.index })}</span></div><article className="session-event prompt"><div className="session-event-body session-prose"><p>{turn.prompt?.text ?? t("turn.promptUnavailable")}</p></div></article></>}<div className="session-row-marker session-process-marker" aria-hidden="true" />{(turn.steps?.length ?? 0) > 0 ? <details className="session-process" open={processOpen} onToggle={(event) => { const open = event.currentTarget.open; setOpenProcesses((current) => open === current.has(turn.index) ? current : toggle(current, turn.index)); }}><summary><span>{t("turn.processTrace")}</span><em>{t("turn.processMeta", { shown: turn.processTruncated ? t("turn.processTruncatedSummary", { shown, total: eventCount }) : String(shown) })}</em></summary><div className="session-process-body"><ProcessStream turn={turn} calls={turnCalls} showIntermediate={kinds.has("intermediate")} showUsage={kinds.has("usage")} showTools={kinds.has("tools")} enabledTools={enabledTools} showFiles={showFiles} /></div></details> : <div className="session-process session-process-empty"><span>{t("turn.process")}</span><em>{t("turn.noProcessEvidence")}</em></div>}<div className="session-row-marker session-output-marker"><span>{t("turn.outMarker", { index: turn.index })}</span></div><div className="session-cell-output"><TurnOutcome turn={turn} calls={turnCalls} commits={kinds.has("commits") ? turnCommits : []} showResponse={kinds.has("responses")} showFiles={showFiles} /></div></section></section>;
    }) : <div className="empty-state">{t("session.noTurns")}</div>}
    {(projection.unplacedCalls.length > 0 || projection.unplacedFiles.length > 0) && <section className="session-cell session-unplaced" data-session-cell="unplaced" ref={(node) => { if (node) cellRefs.current.set("unplaced", node); else cellRefs.current.delete("unplaced"); }}><header className="session-turn-head"><strong>{t("session.unplaced")}</strong><span>{t("session.unplacedMeta", { calls: projection.unplacedCalls.length, files: projection.unplacedFiles.length })}</span></header><div className="session-cell-marker"><span>[ ]</span></div><section className="session-turn">{kinds.has("tools") && <ToolList calls={projection.unplacedCalls.filter((call) => enabledTools.has(call.toolName ?? call.operation ?? "tool"))} showFiles={showFiles} />}{showFiles && projection.unplacedFiles.length > 0 && <article className="session-event files"><header className="session-event-head"><strong>{projection.unplacedFiles.length} attributed file paths</strong><span>observed tool evidence</span></header><div className="session-file-list">{projection.unplacedFiles.map((file) => <code key={file}>{file}</code>)}</div></article>}</section></section>}
    {kinds.has("commits") && projection.outsideCommits.length > 0 && <section className="session-cell session-outside" data-session-cell="outside" ref={(node) => { if (node) cellRefs.current.set("outside", node); else cellRefs.current.delete("outside"); }}><header className="session-turn-head"><strong>{t("session.outside")}</strong><span>{t("session.outsideMeta", { count: projection.outsideCommits.length })}</span></header><div className="session-cell-marker"><span>[ ]</span></div><section className="session-turn"><div className="session-outside-note">{t("session.outsideNote")}</div>{projection.outsideCommits.map(({ commit, relation }) => <CommitEvent commit={commit} relation={relation} key={commit.hash} />)}</section></section>}
  </div></main><aside className="session-sidebar" aria-label={t("session.outlineAria")}><header><strong>{t("session.outline")}</strong></header><section className="session-outline-controls"><select className="jump-select" aria-label={t("session.jumpAria")} defaultValue={turns[0]?.turn.anchorId ?? `turn-${turns[0]?.turn.index ?? 1}`} onChange={(event) => jumpTo(event.target.value)}>{turns.map(({ turn }) => <option value={turn.anchorId ?? `turn-${turn.index}`} key={turn.index}>{t("turn.inMarker", { index: turn.index })}</option>)}{(projection.unplacedCalls.length > 0 || projection.unplacedFiles.length > 0) && <option value="unplaced">{t("session.unplaced")}</option>}{projection.outsideCommits.length > 0 && <option value="outside">{t("session.outside")}</option>}</select></section><details className="session-filter-disclosure"><summary><span>{t("session.filtersSummary")}</span><em>{t("session.filterCalls", { count: visibleCalls })}</em></summary><div className="session-filter-list"><Filter label={t("session.filterLabels.prompts")} count={turns.length} checked={kinds.has("prompts")} onChange={() => toggleKind("prompts")} /><Filter label={t("session.filterLabels.results")} count={responseCount} checked={kinds.has("responses")} onChange={() => toggleKind("responses")} /><Filter label={t("session.filterLabels.intermediate")} count={noteCount} checked={kinds.has("intermediate")} onChange={() => toggleKind("intermediate")} /><Filter label={t("session.filterLabels.modelUsage")} count={usageCount} checked={kinds.has("usage")} onChange={() => toggleKind("usage")} /><Filter label={t("session.filterLabels.commits")} count={commits.length} checked={kinds.has("commits")} onChange={() => toggleKind("commits")} /><Filter label={t("session.filterLabels.toolCalls")} count={visibleCalls} checked={kinds.has("tools")} onChange={() => toggleKind("tools")} />{toolNames.map((name) => <Filter subtype label={name} count={calls.filter((call) => (call.toolName ?? call.operation ?? "tool") === name).length} checked={enabledTools.has(name)} onChange={() => toggleTool(name)} key={name} />)}<Filter subtype label={t("session.filterLabels.filePaths")} count={session.toolActivity?.files?.length ?? session.files?.length ?? 0} checked={showFiles} onChange={() => setShowFiles((value) => !value)} /></div></details><section className="session-facts-compact session-outline-facts" aria-labelledby="session-facts-title"><h3 id="session-facts-title">{t("session.facts.session")}</h3><dl><div><dt>{t("session.facts.runtime")}</dt><dd>{session.platform ?? t("meta.unknown")}</dd></div><div><dt>{t("session.facts.model")}</dt><dd title={session.models?.join(", ") || t("usage.unavailable")}>{session.models?.join(", ") || t("usage.unavailable")}</dd></div><div><dt>{t("session.facts.duration")}</dt><dd>{formatDuration(session.durationMs)}</dd></div></dl></section><UsageContextSummary session={session} generatedAt={generatedAt} onViewReport={onViewUsage} /></aside></div></section>;
}

interface ContextSegment {
  kind: string;
  label: string;
  tokens: number;
  colorIndex: number;
}

function usageContextPresentation(session: Session, t: TFunction): {
  segments: ContextSegment[];
  unusedTokens: number;
  hasCategoryBreakdown: boolean;
  hasContextWindow: boolean;
  hasUsedTokens: boolean;
  hasPercentFull: boolean;
  usedTokens: number;
  windowTokens: number;
  percentFull: number;
} {
  const context = session.contextManifest;
  const hasUsedTokens = Number.isFinite(context?.usedTokens) && Number(context?.usedTokens) >= 0;
  const hasWindowTokens = Number.isFinite(context?.windowTokens) && Number(context?.windowTokens) > 0;
  const hasContextWindow = hasUsedTokens && hasWindowTokens;
  const hasPercentFull = Number.isFinite(context?.percentFull)
    && Number(context?.percentFull) >= 0
    && Number(context?.percentFull) <= 100;
  const windowTokens = hasWindowTokens ? Number(context?.windowTokens) : 0;
  const usedTokens = hasUsedTokens ? Math.min(hasWindowTokens ? windowTokens : Number.POSITIVE_INFINITY, Number(context?.usedTokens)) : 0;
  const percentFull = hasPercentFull
    ? Math.max(0, Math.min(100, Number(context?.percentFull)))
    : hasContextWindow
      ? Math.round((usedTokens / windowTokens) * 1000) / 10
      : 0;
  let remaining = usedTokens;
  const observedCategories = hasUsedTokens ? (context?.categories ?? []).filter((category) => Number.isFinite(category.estimatedTokens) && category.estimatedTokens > 0) : [];
  const segments = observedCategories.flatMap((category, index) => {
    const tokens = Math.min(remaining, category.estimatedTokens);
    remaining -= tokens;
    return tokens > 0 ? [{ kind: category.kind, label: category.label, tokens, colorIndex: index }] : [];
  });
  if (remaining > 0) segments.push({ kind: observedCategories.length ? "other" : "observed", label: observedCategories.length ? t("usage.otherContext") : t("usage.observedContext"), tokens: remaining, colorIndex: 7 });
  return {
    segments,
    unusedTokens: hasContextWindow ? Math.max(0, windowTokens - usedTokens) : 0,
    hasCategoryBreakdown: observedCategories.length > 0,
    hasContextWindow,
    hasUsedTokens,
    hasPercentFull: hasPercentFull || hasContextWindow,
    usedTokens,
    windowTokens,
    percentFull,
  };
}

function ContextUsageBar({ segments, unusedTokens, label, t }: { segments: ContextSegment[]; unusedTokens: number; label: string; t: TFunction }): React.JSX.Element {
  return <div className="usage-context-bar" role="img" aria-label={label}>
    {segments.map((segment, index) => <i className={`usage-context-segment category-${segment.colorIndex % 8}`} style={{ flexGrow: segment.tokens } as CSSProperties} title={t("usage.segmentTokens", { label: segment.label, tokens: formatTokenCount(segment.tokens) })} key={`${segment.kind}-${segment.label}-${index}`} />)}
    {unusedTokens > 0 && <i className="usage-context-unused" style={{ flexGrow: unusedTokens } as CSSProperties} title={t("usage.unusedTokens", { tokens: formatTokenCount(unusedTokens) })} />}
  </div>;
}

function ContextOccupancyBar({ percentFull, label }: { percentFull: number; label: string }): React.JSX.Element {
  return <div className="usage-progress-bar usage-occupancy-bar" role="img" aria-label={label}><i style={{ width: `${percentFull}%` }} /></div>;
}

function progressionBoundaryNote(report: UsageReport, t: TFunction): string {
  const notes: string[] = [];
  if (report.contextResetCount > 0) notes.push(t("usage.shrinks", { count: report.contextResetCount }));
  if (report.modelBoundaryCount > 0) notes.push(t("usage.modelBoundaries", { count: report.modelBoundaryCount }));
  return notes.length ? t("usage.observed", { notes: notes.join(", ") }) : "";
}

function formatUsageStamp(value?: string): string | null {
  const date = new Date(value ?? "");
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(11, 19);
}

function retainedUsagePrompt(session: Session, point: UsageProgressionPoint): string | null {
  const turn = Number.isFinite(point.turnIndex) ? session.dialogue?.turns?.find((candidate) => candidate.index === point.turnIndex) : undefined;
  const prompt = point.userPrompt ?? turn?.prompt?.text ?? (Number.isFinite(point.turnIndex) ? session.prompts?.find((candidate) => candidate.turnIndex === point.turnIndex)?.text : undefined);
  const normalized = prompt?.replace(/\s+/gu, " ").trim();
  return normalized || null;
}

function usagePointDetail(point: UsageProgressionPoint, t: TFunction, prompt = point.userPrompt): { primary: string; secondary: string } {
  const stamp = formatUsageStamp(point.timestamp);
  const facts = [...(Number.isFinite(point.turnIndex) ? [t("usage.userTurn", { index: point.turnIndex })] : []), t("usage.responseIndex", { index: point.index })];
  if (stamp) facts.push(t("usage.utcStamp", { time: stamp }));
  if (Number.isFinite(point.contextTokens)) facts.push(t("usage.contextTokens", { count: formatTokenCount(Number(point.contextTokens)) }));
  if (Number.isFinite(point.contextDeltaTokens)) facts.push(formatSignedTokenCount(Number(point.contextDeltaTokens)));
  if (point.boundary === "shrink") facts.push(t("usage.shrinkReset"));
  if (point.boundary === "model-change") facts.push(t("usage.modelBoundary"));
  const normalizedPrompt = prompt?.replace(/\s+/gu, " ").trim();
  const promptDetail = normalizedPrompt
    ? normalizedPrompt
    : Number.isFinite(point.turnIndex) || point.promptBoundary
      ? t("usage.promptNotRetained")
      : t("usage.noLinkedPrompt");
  return { primary: promptDetail, secondary: facts.join(" · ") };
}

const USAGE_WINDOW_SIZE = 60;
const USAGE_MIN_WINDOW_SIZE = 10;
type UsageEntry = { point: UsageProgressionPoint; position: number };

function usageSegments(entries: UsageEntry[]): UsageEntry[][] {
  const segments: UsageEntry[][] = [];
  let current: UsageEntry[] = [];
  for (const entry of entries) {
    if (entry.point.boundary === "model-change" && current.length) {
      segments.push(current);
      current = [];
    }
    if (Number.isFinite(entry.point.contextTokens)) current.push(entry);
  }
  if (current.length) segments.push(current);
  return segments;
}

function usageTurnEntries(entries: UsageEntry[]): UsageEntry[] {
  const turns = new Set<number>();
  return entries.filter((entry) => {
    if (Number.isFinite(entry.point.turnIndex)) {
      const turn = Number(entry.point.turnIndex);
      if (turns.has(turn)) return false;
      turns.add(turn);
      return true;
    }
    return Boolean(entry.point.promptBoundary);
  });
}

function usageStepPath(segment: UsageEntry[], x: (entry: UsageEntry) => number, y: (entry: UsageEntry) => number): string {
  return segment.reduce((path, entry, index) => {
    const pointX = x(entry);
    const pointY = y(entry);
    return index === 0 ? `M${pointX} ${pointY}` : `${path} H${pointX} V${pointY}`;
  }, "");
}

function usageBoundaryLabel(point: UsageProgressionPoint, t: TFunction): string {
  if (point.boundary === "shrink") return t("usage.shrinkReset");
  if (point.boundary === "model-change") return t("usage.modelBoundary");
  if (point.boundary === "baseline") return t("usage.baselineLabel");
  return t("usage.withinContextCycle");
}

function compactReuse(reuse: CacheReuse | undefined, t: TFunction): string {
  if (!reuse) return "\u2014";
  if (reuse.status === "observed" && Number.isFinite(reuse.reusePercent)) return t("usage.compactReused", { count: reuse.reusePercent });
  return t("usage.compactCached", { count: formatTokenCount(reuse.cacheReadTokens) });
}

function ResponseDetails({ point, prompt, onStep, t }: { point?: UsageProgressionPoint; prompt: string | null; onStep(delta: number): void; t: TFunction }): React.JSX.Element {
  if (!point) return <aside className="usage-response-detail" aria-live="polite"><strong>{t("usage.responseDetails")}</strong><p>{t("usage.selectChartPoint")}</p></aside>;
  const facts = [
    [t("usage.context"), Number.isFinite(point.contextTokens) ? formatTokenCount(Number(point.contextTokens)) : t("usage.notObserved")],
    [t("usage.deltaContext"), Number.isFinite(point.contextDeltaTokens) ? formatSignedTokenCount(Number(point.contextDeltaTokens)) : t("usage.notComparable")],
    [t("usage.output"), Number.isFinite(point.outputTokens) ? formatTokenCount(Number(point.outputTokens)) : t("usage.notObserved")],
    [t("usage.inputReuse"), compactReuse(point.cacheReuse, t)],
    [t("usage.usageBoundaryLabel"), usageBoundaryLabel(point, t)],
  ];
  return <aside className="usage-response-detail" aria-live="polite"><header><span>{t("usage.responseDetails")}</span><strong>{t("usage.responseIndex", { index: point.index })}</strong><small>{formatUsageStamp(point.timestamp) ? t("usage.utcStamp", { time: formatUsageStamp(point.timestamp) }) : t("usage.responseTimeUnavailable")}</small></header><dl>{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{prompt && <div className="usage-response-prompt"><span>{t("usage.linkedPrompt")}{Number.isFinite(point.turnIndex) ? t("usage.turnSuffix", { index: point.turnIndex }) : ""}</span><p title={prompt}>{prompt}</p></div>}<div className="usage-response-actions"><button type="button" onClick={() => onStep(-1)}>{t("usage.previousResponse")}</button><button type="button" onClick={() => onStep(1)}>{t("usage.nextResponse")}</button></div></aside>;
}

function UsageInspectStrip({ entry, hovered, processedVisible, t }: { entry?: UsageEntry; hovered: boolean; processedVisible: boolean; t: TFunction }): React.JSX.Element {
  if (!entry) return <div className="usage-inspect-strip empty" data-usage-inspect-strip aria-label={t("usage.inspectStripAria")}><p>{t("usage.inspectStripHint")}</p></div>;
  const point = entry.point;
  const facts = [
    [t("usage.progressTime"), formatUsageStamp(point.timestamp) ? t("usage.utcStamp", { time: formatUsageStamp(point.timestamp) }) : "—"],
    [t("usage.progressContext"), Number.isFinite(point.contextTokens) ? formatTokenCount(Number(point.contextTokens)) : "—"],
    [t("usage.progressDelta"), Number.isFinite(point.contextDeltaTokens) ? formatSignedTokenCount(Number(point.contextDeltaTokens)) : "—"],
    [t("usage.progressReuse"), compactReuse(point.cacheReuse, t)],
    ...(processedVisible ? [[t("usage.progressProcessed"), Number.isFinite(point.processedTokens) ? formatTokenCount(Number(point.processedTokens)) : "—"]] : []),
    [t("usage.progressOutput"), Number.isFinite(point.outputTokens) ? formatTokenCount(Number(point.outputTokens)) : "—"],
  ];
  return <div className={`usage-inspect-strip${processedVisible ? " with-processed" : ""}`} data-usage-inspect-strip aria-label={t("usage.inspectStripAria")} data-usage-inspect-mode={hovered ? "hover" : "selected"} data-usage-inspect-position={entry.position}><div className="usage-inspect-identity"><small>{t(hovered ? "usage.inspectHover" : "usage.inspectSelected")}</small><strong>{t("usage.responseIndex", { index: point.index })}</strong></div>{facts.map(([label, value]) => <span key={label}><small>{label}</small><strong>{value}</strong></span>)}</div>;
}

function UsageExplorer({ session, report }: { session: Session; report: UsageReport }): React.JSX.Element {
  const { t } = useTranslation("inspector");
  const points = report.progression;
  const defaultSize = Math.min(USAGE_WINDOW_SIZE, points.length);
  const minSize = Math.min(USAGE_MIN_WINDOW_SIZE, points.length);
  const lastCycleBoundary = points.reduce((latest, point, index) => ["shrink", "model-change"].includes(point.boundary) ? index : latest, -1);
  const lastCycleLength = lastCycleBoundary >= 0 ? points.length - lastCycleBoundary : 0;
  const defaultStart = lastCycleBoundary >= 0 && lastCycleLength >= minSize && lastCycleLength <= defaultSize ? lastCycleBoundary : Math.max(0, points.length - defaultSize);
  const [windowRange, setWindowRange] = useState({ start: defaultStart, end: points.length });
  const start = windowRange.start;
  const end = windowRange.end;
  const size = end - start;
  const maxStart = Math.max(0, points.length - size);
  const [selected, setSelected] = useState(points.length - 1);
  const [hovered, setHovered] = useState<number | null>(null);
  const brushDrag = useRef<{ edge: "start" | "end"; rect: DOMRect; pointerId: number } | null>(null);
  useEffect(() => {
    setWindowRange((current) => {
      let nextStart = Math.max(0, Math.min(Math.max(0, points.length - minSize), current.start));
      let nextEnd = Math.max(nextStart, Math.min(points.length, current.end));
      if (nextEnd - nextStart < minSize) {
        if (nextStart + minSize <= points.length) nextEnd = nextStart + minSize;
        else nextStart = Math.max(0, nextEnd - minSize);
      }
      return { start: nextStart, end: nextEnd };
    });
    setSelected((current) => current >= -1 && current < points.length ? current : points.length - 1);
  }, [minSize, points.length]);
  if (!points.length) return <p className="usage-report-unavailable">{t("usage.progressUnavailable")}</p>;
  const entries = points.map((point, position) => ({ point, position }));
  const visible = entries.slice(start, end);
  const numeric = entries.filter((entry) => Number.isFinite(entry.point.contextTokens));
  const values = numeric.map((entry) => Number(entry.point.contextTokens));
  const overviewMin = values.length ? Math.min(...values) : 0;
  const overviewMax = values.length ? Math.max(...values) : 1;
  const overviewRange = Math.max(1, overviewMax - overviewMin);
  const focusValues = visible.map((entry) => Number(entry.point.contextTokens)).filter(Number.isFinite);
  const focusMin = focusValues.length ? Math.min(...focusValues) : overviewMin;
  const focusMax = focusValues.length ? Math.max(...focusValues) : overviewMax;
  const focusRange = Math.max(1, focusMax - focusMin);
  const width = 960;
  const padX = 28;
  const overviewTop = 34;
  const overviewBottom = 78;
  const focusTop = 30;
  const focusBottom = 132;
  const overviewX = (entry: UsageEntry): number => padX + (entry.position / Math.max(1, entries.length - 1)) * (width - padX * 2);
  const focusX = (entry: UsageEntry): number => padX + ((entry.position - start) / Math.max(1, visible.length - 1)) * (width - padX * 2);
  const overviewY = (entry: UsageEntry): number => overviewBottom - ((Number(entry.point.contextTokens) - overviewMin) / overviewRange) * (overviewBottom - overviewTop);
  const focusY = (entry: UsageEntry): number => focusBottom - ((Number(entry.point.contextTokens) - focusMin) / focusRange) * (focusBottom - focusTop);
  const selectedEntry = entries[selected];
  const selectedVisible = selectedEntry && selectedEntry.position >= start && selectedEntry.position < end && Number.isFinite(selectedEntry.point.contextTokens);
  const hoveredEntry = hovered !== null && hovered >= start && hovered < end ? entries[hovered] : undefined;
  const inspectEntry = hoveredEntry ?? selectedEntry;
  const processedVisible = visible.some((entry) => Number.isFinite(entry.point.processedTokens));
  const first = visible[0]?.point.index;
  const last = visible.at(-1)?.point.index;
  const timed = entries.filter((entry) => formatUsageStamp(entry.point.timestamp));
  const timeRange = timed.length > 1 ? t("usage.chartRange", { start: formatUsageStamp(timed[0].point.timestamp), end: formatUsageStamp(timed.at(-1)?.point.timestamp) }) : t("usage.chartNoStamps");
  const brushX = overviewX(entries[start]);
  const brushEnd = overviewX(entries[Math.min(entries.length - 1, end - 1)]);
  const promptEntries = usageTurnEntries(entries);
  const activePromptPosition = selected < 0 ? undefined : promptEntries.reduce<number | undefined>((active, entry) => entry.position <= selected ? entry.position : active, undefined);
  const hasWindowControls = entries.length > USAGE_WINDOW_SIZE;

  function select(position: number, reveal = true): void {
    const next = Math.max(0, Math.min(points.length - 1, position));
    setSelected(next);
    if (!reveal) return;
    if (next < start) setWindowRange({ start: next, end: Math.min(points.length, next + size) });
    else if (next >= end) {
      const nextEnd = Math.min(points.length, next + 1);
      setWindowRange({ start: Math.max(0, nextEnd - size), end: nextEnd });
    }
  }
  function move(delta: number): void { select((selected >= 0 ? selected : start) + delta); }
  function windowAt(next: number): void {
    const clamped = Math.max(0, Math.min(maxStart, Math.round(next)));
    const nextEnd = clamped + size;
    setWindowRange({ start: clamped, end: nextEnd });
    setSelected((current) => current < clamped ? clamped : current >= nextEnd ? nextEnd - 1 : current);
  }
  function windowEdgeAt(edge: "start" | "end", value: number): void {
    const nextStart = edge === "start" ? Math.max(0, Math.min(end - minSize, Math.round(value))) : start;
    const nextEnd = edge === "end" ? Math.min(points.length, Math.max(start + minSize, Math.round(value))) : end;
    setWindowRange({ start: nextStart, end: nextEnd });
    setSelected((current) => current < nextStart ? nextStart : current >= nextEnd ? nextEnd - 1 : current);
  }
  function beginBrushDrag(edge: "start" | "end", event: React.PointerEvent<SVGRectElement>): void {
    const surface = event.currentTarget.ownerSVGElement?.querySelector<SVGRectElement>(".usage-overview-surface");
    if (!surface) return;
    brushDrag.current = { edge, rect: surface.getBoundingClientRect(), pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }
  function moveBrushDrag(event: React.PointerEvent<SVGRectElement>): void {
    const drag = brushDrag.current;
    if (!drag) return;
    const ratio = Math.max(0, Math.min(1, (event.clientX - drag.rect.left) / Math.max(1, drag.rect.width)));
    const position = Math.round(ratio * Math.max(0, points.length - 1));
    windowEdgeAt(drag.edge, drag.edge === "end" ? position + 1 : position);
    event.preventDefault();
    event.stopPropagation();
  }
  function endBrushDrag(event: React.PointerEvent<SVGRectElement>): void {
    if (brushDrag.current?.pointerId === event.pointerId) brushDrag.current = null;
    event.stopPropagation();
  }
  function positionAt(clientX: number, rect: DOMRect, focusWindow: boolean): number {
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    return (focusWindow ? start : 0) + Math.round(ratio * Math.max(0, (focusWindow ? size : points.length) - 1));
  }
  function onExplorerKeyDown(event: React.KeyboardEvent): void {
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") move(-1);
    else if (event.key === "ArrowRight" || event.key === "ArrowDown") move(1);
    else if (event.key === "Home") select(start);
    else if (event.key === "End") select(end - 1);
    else if (event.key === "Escape") setSelected(-1);
    else return;
    event.preventDefault();
    event.stopPropagation();
  }
  function onOverviewKeyDown(event: React.KeyboardEvent): void {
    if (!promptEntries.length) return;
    const selectedTurn = selectedEntry?.point.turnIndex;
    let current = promptEntries.findIndex((entry) => entry.position === selected
      || Number.isFinite(selectedTurn) && entry.point.turnIndex === selectedTurn);
    if (current < 0) {
      const next = promptEntries.findIndex((entry) => entry.position > selected);
      current = next > 0 ? next - 1 : next === 0 ? 0 : promptEntries.length - 1;
    }
    let next = current;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = Math.max(0, current - 1);
    else if (event.key === "ArrowRight" || event.key === "ArrowDown") next = Math.min(promptEntries.length - 1, current + 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = promptEntries.length - 1;
    else if (event.key === "Escape") { setSelected(-1); event.preventDefault(); event.stopPropagation(); return; }
    else return;
    if (next === current) { event.preventDefault(); event.stopPropagation(); return; }
    const position = promptEntries[next].position;
    windowAt(position - Math.floor(size / 2));
    setSelected(position);
    event.preventDefault();
    event.stopPropagation();
  }

  return <div className={`usage-linked-explorer${hasWindowControls ? " has-window-controls" : " short-session"}`}>
    {hasWindowControls && <><div className="usage-overview"><div className="chart-toolbar"><span className="chart-basis">{t("usage.overviewBasis", { responses: entries.length, prompts: promptEntries.length })}</span><span className="chart-range">{timeRange}</span></div><svg data-usage-overview-chart tabIndex={promptEntries.length ? 0 : -1} viewBox={`0 0 ${width} 106`} role="group" aria-roledescription={t("usage.interactiveChart")} aria-label={t(promptEntries.length ? "usage.overviewChartAria" : "usage.overviewNoLinkedPromptsAria")} onKeyDown={onOverviewKeyDown} onClick={(event) => { const position = positionAt(event.clientX, event.currentTarget.getBoundingClientRect(), false); windowAt(position - Math.floor(size / 2)); select(position, false); }}><rect className="usage-overview-surface" x={padX} y="8" width={width - padX * 2} height="88" /><rect className="usage-overview-brush" x={brushX} y="8" width={Math.max(6, brushEnd - brushX)} height="88" />{usageSegments(entries).filter((segment) => segment.length > 1).map((segment, index) => <path className="usage-chart-line" d={usageStepPath(segment, overviewX, overviewY)} key={`overview-${index}`} />)}{promptEntries.map((entry) => { const markerX = overviewX(entry); const label = Number.isFinite(entry.point.turnIndex) ? `T${entry.point.turnIndex}` : "P"; const chipWidth = Math.max(18, 10 + label.length * 5); const halfWidth = chipWidth / 2; const chipX = Math.max(padX + halfWidth, Math.min(width - padX - halfWidth, markerX)); const tooltipWidth = 250; const tooltipX = Math.max(padX, Math.min(width - padX - tooltipWidth, markerX - tooltipWidth / 2)); const hitX = markerX - 11; const hitRight = markerX + 11; const detail = usagePointDetail(entry.point, t, retainedUsagePrompt(session, entry.point) ?? undefined); return <g className={`usage-overview-turn-marker${entry.position === activePromptPosition ? " selected" : ""}`} data-usage-overview-turn-marker data-usage-response-position={entry.position} aria-label={`${detail.primary}. ${detail.secondary}`} onClick={(event) => { event.stopPropagation(); windowAt(entry.position - Math.floor(size / 2)); setSelected(entry.position); }} key={`overview-turn-${entry.point.turnIndex ?? entry.point.id}`}><title>{detail.primary}. {detail.secondary}</title><rect className="usage-overview-turn-hit" x={hitX} y="8" width={hitRight - hitX} height="44" /><line className="usage-overview-turn" x1={markerX} x2={markerX} y1="24" y2="78" /><rect className="usage-overview-turn-chip" x={chipX - halfWidth} y="17" width={chipWidth} height="12" rx="2" /><text className="usage-overview-turn-label" x={chipX} y="26" textAnchor="middle">{label}</text><foreignObject className="usage-overview-prompt-tooltip" x={tooltipX} y="12" width={tooltipWidth} height="38"><div role="tooltip"><strong>{detail.primary}</strong><span>{detail.secondary}</span></div></foreignObject></g>; })}{entries.filter((entry) => ["shrink", "model-change"].includes(entry.point.boundary)).map((entry) => <path className={`usage-overview-event boundary-${entry.point.boundary}`} d={`M${overviewX(entry)} 82 l4 4 -4 4 -4 -4z`} key={`overview-event-${entry.point.id}`} />)}<rect className="usage-overview-handle-hit start" x={brushX - 11} y="48" width="22" height="48" onPointerDown={(event) => beginBrushDrag("start", event)} onPointerMove={moveBrushDrag} onPointerUp={endBrushDrag} onClick={(event) => event.stopPropagation()} /><rect className="usage-overview-handle start" x={brushX - 4} y="52" width="8" height="44" /><rect className="usage-overview-handle-hit end" x={brushEnd - 11} y="48" width="22" height="48" onPointerDown={(event) => beginBrushDrag("end", event)} onPointerMove={moveBrushDrag} onPointerUp={endBrushDrag} onClick={(event) => event.stopPropagation()} /><rect className="usage-overview-handle end" x={brushEnd - 4} y="52" width="8" height="44" /><text x={padX} y="14">{formatTokenCount(overviewMax)}</text><text x={padX} y="102">{formatTokenCount(overviewMin)}</text></svg><div className="usage-overview-prompt-actions" aria-label={t("usage.linkedPromptActionsAria")}>{promptEntries.map((entry) => { const label = Number.isFinite(entry.point.turnIndex) ? `T${entry.point.turnIndex}` : "P"; const detail = usagePointDetail(entry.point, t, retainedUsagePrompt(session, entry.point) ?? undefined); const active = entry.position === activePromptPosition; return <button type="button" className={active ? "selected" : undefined} aria-pressed={active} tabIndex={-1} aria-label={`${detail.primary}. ${detail.secondary}`} onClick={() => { windowAt(entry.position - Math.floor(size / 2)); setSelected(entry.position); }} key={`prompt-action-${entry.point.turnIndex ?? entry.point.id}`}>{label}</button>; })}</div></div>
    <div className="usage-window-toolbar"><div className="usage-window-summary"><strong>{t("usage.responsesRange", { first, last })}</strong><span>{t("usage.responsesCount", { shown: visible.length, total: entries.length })}</span></div><button type="button" disabled={start === 0} onClick={() => windowAt(start - size)}>{t("usage.previousWindow")}</button><div className="usage-window-edge-controls"><label>{t("usage.windowStart")}<input type="range" min="0" max={Math.max(0, end - minSize)} value={start} aria-label={t("usage.windowStartAria")} aria-valuetext={t("usage.responseIndex", { index: entries[start]?.point.index ?? start + 1 })} onChange={(event) => windowEdgeAt("start", Number(event.target.value))} /></label><label>{t("usage.windowEnd")}<input type="range" min={Math.min(entries.length, start + minSize)} max={entries.length} value={end} aria-label={t("usage.windowEndAria")} aria-valuetext={t("usage.responseIndex", { index: entries[Math.max(0, end - 1)]?.point.index ?? end })} onChange={(event) => windowEdgeAt("end", Number(event.target.value))} /></label></div><button type="button" disabled={end === entries.length} onClick={() => windowAt(start + size)}>{t("usage.nextWindow")}</button></div></>}
    <div className="usage-focus-layout"><div className="usage-context-chart"><div className="chart-toolbar"><span className="chart-basis">{hasWindowControls ? t("usage.focusBasis", { first, last }) : t("usage.progressionBasis", { first, last })}</span><span className="chart-range">{t("usage.focusHint")}</span></div><svg className="usage-focus-chart" tabIndex={0} viewBox={`0 0 ${width} 180`} role="group" aria-roledescription={t("usage.interactiveChart")} aria-label={t("usage.focusChartAria", { first, last })} onKeyDown={onExplorerKeyDown} onClick={(event) => select(positionAt(event.clientX, event.currentTarget.getBoundingClientRect(), true))}><rect className="usage-focus-surface" x={padX} y="8" width={width - padX * 2} height="158" />{[0, 0.5, 1].map((ratio) => { const lineY = focusTop + ratio * (focusBottom - focusTop); return <line className="usage-chart-grid" x1={padX} x2={width - padX} y1={lineY} y2={lineY} key={ratio} />; })}{usageSegments(visible).filter((segment) => segment.length > 1).map((segment, index) => <path className="usage-chart-line" d={usageStepPath(segment, focusX, focusY)} key={`focus-${index}`} />)}{visible.map((entry, index) => { const markerX = focusX(entry); const markerY = Number.isFinite(entry.point.contextTokens) ? focusY(entry) : focusBottom; const previousX = index > 0 ? focusX(visible[index - 1]) : padX; const nextX = index < visible.length - 1 ? focusX(visible[index + 1]) : width - padX; const hitLeft = index > 0 ? (previousX + markerX) / 2 : padX; const hitRight = index < visible.length - 1 ? (markerX + nextX) / 2 : width - padX; return <g className={`usage-focus-point${entry.position === selected ? " selected" : ""}`} data-usage-focus-point data-usage-response-position={entry.position} aria-hidden="true" onPointerEnter={() => setHovered(entry.position)} onPointerLeave={() => setHovered((current) => current === entry.position ? null : current)} onClick={(event) => { event.stopPropagation(); select(entry.position); }} key={`focus-point-${entry.point.id}`}><rect className="usage-focus-point-hit" x={hitLeft} y="8" width={Math.max(1, hitRight - hitLeft)} height="158" /><line className="usage-hover-line" x1={markerX} x2={markerX} y1={focusTop} y2="164" /><circle className="usage-hover-point" cx={markerX} cy={markerY} r="5" /></g>; })}{selectedVisible && <><line className="usage-selection-line" x1={focusX(selectedEntry)} x2={focusX(selectedEntry)} y1={focusTop} y2="164" /><circle className="usage-selection-point" cx={focusX(selectedEntry)} cy={focusY(selectedEntry)} r="5" /></>}{visible.filter((entry) => ["shrink", "model-change"].includes(entry.point.boundary)).map((entry) => { const markerX = focusX(entry); return <g aria-hidden="true" key={`focus-event-${entry.point.id}`}>{entry.point.boundary === "shrink" ? <path className="usage-focus-event boundary-shrink" d={`M${markerX} 147 l4 4 -4 4 -4 -4z`} /> : <rect className="usage-focus-event boundary-model-change" x={markerX - 4} y="147" width="8" height="8" />}</g>; })}<text x={padX} y={focusTop - 4}>{formatTokenCount(focusMax)}</text><text x={padX} y="172">{formatTokenCount(focusMin)}</text></svg><div className="usage-chart-legend"><span><i className="growth" />{t("usage.chartLegendSnapshot")}</span><span><i className="shrink" />{t("usage.chartLegendShrink")}</span><span><i className="boundary" />{t("usage.chartLegendBoundary")}</span></div><UsageInspectStrip entry={inspectEntry} hovered={Boolean(hoveredEntry)} processedVisible={processedVisible} t={t} /></div><ResponseDetails point={selectedEntry?.point} prompt={selectedEntry ? retainedUsagePrompt(session, selectedEntry.point) : null} onStep={move} t={t} /></div>
  </div>;
}

function ProcessingBreakdown({ session, report }: { session: Session; report: UsageReport }): React.JSX.Element | null {
  const { t } = useTranslation("inspector");
  if (!Number.isFinite(report.processedTokens)) return null;
  const usage = session.tokenUsage;
  const buckets = [
    { kind: "cache-read", label: t("usage.bucketCacheRead"), value: usage?.cacheReadInputTokens },
    { kind: "cache-write", label: t("usage.bucketCacheCreation"), value: usage?.cacheCreationInputTokens },
    { kind: "input", label: t("usage.bucketUncachedInput"), value: usage?.inputTokens },
    { kind: "output", label: t("usage.bucketOutput"), value: usage?.outputTokens },
  ].filter((bucket): bucket is { kind: string; label: string; value: number } => Number.isFinite(bucket.value) && Number(bucket.value) > 0)
    .map((bucket) => ({ ...bucket, value: Number(bucket.value) }));
  const total = Number(report.processedTokens);
  return <section className="usage-report-section">
    <header><div><h4>{t("usage.processedBreakdownTitle")}</h4><p>{t("usage.processedBreakdownDetail")}</p></div><strong>{t("usage.processedLabel", { count: formatTokenCount(total) })}</strong></header>
    {buckets.length > 0 && <div className="usage-processing-bar" role="img" aria-label={t("usage.processedBarAria")}>{buckets.map((bucket) => <i className={`bucket-${bucket.kind}`} style={{ flexGrow: bucket.value }} title={`${bucket.label}: ${formatTokenCount(bucket.value)}`} key={bucket.kind} />)}</div>}
    <ul className="usage-processing-list">{buckets.map((bucket) => <li key={bucket.kind}><i className={`bucket-${bucket.kind}`} /><span>{bucket.label}</span><strong>{formatTokenCount(bucket.value)}</strong><small>{Math.round((bucket.value / total) * 1000) / 10}%</small></li>)}</ul>
  </section>;
}

function formatCacheReuse(reuse: CacheReuse | undefined): string {
  if (!reuse) return inspectorT("usage.cacheReuseNotObserved");
  if (reuse.status === "observed" && Number.isFinite(reuse.reusePercent)) return inspectorT("usage.inputReusedPercent", { count: reuse.reusePercent });
  if (reuse.status === "inconsistent") return inspectorT("usage.reuseRateUnavailableInconsistent", { count: formatTokenCount(reuse.cacheReadTokens) });
  return inspectorT("usage.reuseRateUnavailable", { count: formatTokenCount(reuse.cacheReadTokens) });
}

function CacheReuseBar({ reuse, detailed = false }: { reuse: CacheReuse; detailed?: boolean }): React.JSX.Element | null {
  const { t } = useTranslation("inspector");
  if (reuse.status !== "observed" || !Number.isFinite(reuse.promptInputTokens) || Number(reuse.promptInputTokens) <= 0) return null;
  const uncachedInput = Number(reuse.uncachedInputTokens);
  const cacheCreation = Number.isFinite(reuse.cacheCreationTokens) ? Math.min(uncachedInput, Number(reuse.cacheCreationTokens)) : 0;
  const buckets = [
    { kind: "cached", label: t("usage.cachedInput"), value: reuse.cacheReadTokens },
    ...(detailed ? [{ kind: "created", label: t("usage.cacheCreation"), value: cacheCreation }] : []),
    { kind: "uncached", label: detailed ? t("usage.otherUncachedInput") : t("usage.uncachedInput"), value: detailed ? Math.max(0, uncachedInput - cacheCreation) : uncachedInput },
  ].filter((bucket) => Number.isFinite(bucket.value) && bucket.value > 0);
  const label = t("usage.reuseBarAria", { count: reuse.reusePercent, input: formatTokenCount(Number(reuse.promptInputTokens)) });
  return <div className="usage-reuse-bar" role="img" aria-label={label}>{buckets.map((bucket) => <i className={`reuse-${bucket.kind}`} style={{ flexGrow: bucket.value }} title={`${bucket.label}: ${formatTokenCount(bucket.value)}`} key={bucket.kind} />)}</div>;
}

function CacheReuseSummary({ reuse }: { reuse: CacheReuse }): React.JSX.Element {
  const { t } = useTranslation("inspector");
  const observed = reuse.status === "observed" && Number.isFinite(reuse.promptInputTokens);
  const headline = observed ? t("usage.reusePercentHeadline", { count: reuse.reusePercent }) : t("usage.cachedHeadline", { count: formatTokenCount(reuse.cacheReadTokens) });
  const detail = observed
    ? t("usage.reuseDetailObserved", { cached: formatTokenCount(reuse.cacheReadTokens), input: formatTokenCount(Number(reuse.promptInputTokens)) })
    : reuse.status === "inconsistent" ? t("usage.reuseDetailInconsistent") : t("usage.reuseDetailUnknown");
  return <div className="usage-summary-reuse"><div className="usage-context-meta"><strong>{t("usage.inputReuseTitle")}</strong><span>{headline}</span></div><CacheReuseBar reuse={reuse} /><p>{detail}</p></div>;
}

function UsageContextSummary({ session, generatedAt, onViewReport }: { session: Session; generatedAt?: string; onViewReport(): void }): React.JSX.Element {
  const { t } = useTranslation("inspector");
  const usage = session.tokenUsage;
  const context = usageContextPresentation(session, t);
  const report = session.usageReport ?? EMPTY_USAGE_REPORT;
  const freshness = usageSnapshotFreshness(session, generatedAt, t);
  const cacheReuse = session.cacheReuse;
  const metrics: Array<{ label: string; value: string }> = [];
  if (Number.isFinite(report.currentContextTokens)) metrics.push({ label: t("usage.currentContext"), value: formatTokenCount(Number(report.currentContextTokens)) });
  else if (context.hasPercentFull) metrics.push({ label: t("usage.currentOccupancy"), value: `${context.percentFull}%` });
  if (cacheReuse) metrics.push({ label: t("usage.inputReused"), value: cacheReuse.status === "observed" ? `${cacheReuse.reusePercent}%` : formatTokenCount(cacheReuse.cacheReadTokens) });
  metrics.push({ label: t("usage.sessionProcessed"), value: Number.isFinite(report.processedTokens) ? formatTokenCount(Number(report.processedTokens)) : t("usage.notDerived") });
  if (report.actualModelCalls > 0) metrics.push({ label: t("usage.modelCalls"), value: String(report.actualModelCalls) });
  const net = Number.isFinite(report.netContextDeltaTokens) ? ` · ${formatSignedTokenCount(Number(report.netContextDeltaTokens))} ${t("usage.net")}` : "";
  const boundary = context.hasContextWindow ? t("usage.windowSummary", { used: formatTokenCount(context.usedTokens), window: formatTokenCount(context.windowTokens), percent: context.percentFull, net })
    : context.hasPercentFull ? t("usage.windowUnavailable")
      : context.hasUsedTokens ? t("usage.windowAndCategoriesUnavailable") : t("usage.contextEvidenceUnavailable");
  return <section className="session-usage-summary" aria-labelledby="session-usage-summary-title">
    <header className="session-usage-head"><div><h3 id="session-usage-summary-title">{t("usage.usageAndContext")}</h3><span>{usage?.coverage ?? session.contextManifest?.status ?? t("usage.unobserved")}</span></div><button className="usage-report-link" type="button" onClick={onViewReport}>{t("usage.viewReport")}</button></header>
    <p className="usage-summary-freshness">{freshness.note}</p>
    <dl className="usage-summary-metrics">{metrics.map((metric) => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}</dl>
    {context.hasContextWindow ? <ContextUsageBar segments={context.segments} unusedTokens={context.unusedTokens} label={t("usage.windowFullAria", { count: context.percentFull })} t={t} /> : context.hasPercentFull ? <ContextOccupancyBar percentFull={context.percentFull} label={t("usage.occupancyAria", { count: context.percentFull })} /> : null}
    <p className="usage-summary-boundary">{boundary}</p>
    {cacheReuse && <CacheReuseSummary reuse={cacheReuse} />}
    {report.duplicateRecordsCollapsed > 0 && <p className="usage-summary-diagnostics">{t("usage.duplicatesCollapsed", { count: report.duplicateRecordsCollapsed })}{report.conflictingDuplicateRecords > 0 ? ` · ${t("usage.duplicatesConflicts", { count: report.conflictingDuplicateRecords })}` : ""}</p>}
  </section>;
}

function UsageEvidenceDetails({ session, report, freshness }: { session: Session; report: UsageReport; freshness: ReturnType<typeof usageSnapshotFreshness> }): React.JSX.Element {
  const { t } = useTranslation("inspector");
  const usage = session.tokenUsage;
  const runtime = session.runtime;
  const provider = runtime?.modelProvider ?? session.platform ?? t("usage.notObserved");
  const contextBasis = session.contextManifest?.basis ?? t("usage.notObserved");
  const source = usage?.source ?? session.contextManifest?.source ?? t("usage.notObserved");
  const coverage = usage?.coverage ?? session.contextManifest?.status ?? t("usage.unobserved");
  const groups: Array<{ label: string; facts: Array<[string, string | number]> }> = [
    { label: t("usage.evidenceObservability"), facts: [[t("usage.coverage"), coverage], [t("usage.snapshot"), freshness.evidence], [t("usage.timeBasis"), session.timestampBasis ?? t("usage.unobserved")], [t("usage.rawContext"), t("usage.omitted")]] },
    { label: t("usage.evidenceRuntime"), facts: [[t("usage.provider"), provider], [t("usage.effort"), runtime?.effort ?? t("usage.notObserved")], [t("usage.cli"), runtime?.cliVersion ?? t("usage.notObserved")]] },
    { label: t("usage.evidenceAccounting"), facts: [[t("usage.contextBasis"), contextBasis], [t("usage.processedBasis"), report.processedTokensBasis ?? t("usage.notDerived")], ...(report.processedCoverage ? [[t("usage.processedCoverage"), report.processedCoverage] as [string, string]] : [])] },
    { label: t("usage.evidenceProvenance"), facts: [[t("usage.evidenceSource"), source], ...(report.duplicateRecordsCollapsed > 0 ? [[t("usage.duplicatesCollapsedLabel"), report.duplicateRecordsCollapsed] as [string, number], [t("usage.conflictingDuplicates"), report.conflictingDuplicateRecords] as [string, number]] : [])] },
  ];
  return <details className="usage-report-evidence">
    <summary><span>{t("usage.evidenceDetailsTitle")}</span><small>{t("usage.evidenceDetailsDetail")}</small></summary>
    <div className="usage-evidence-groups">{groups.map((group) => <div className="usage-evidence-group" key={group.label}><strong className="usage-evidence-group-title">{group.label}</strong><dl className="usage-report-facts">{group.facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={String(value)}>{value}</dd></div>)}</dl></div>)}</div>
  </details>;
}

function UsageReportOccupancyTile({ session, report, context, freshness }: { session: Session; report: UsageReport; context: ReturnType<typeof usageContextPresentation>; freshness: ReturnType<typeof usageSnapshotFreshness> }): React.JSX.Element {
  const { t } = useTranslation("inspector");
  const snapshotData = contextSnapshotData(session);
  const compactionCount = snapshotData.compactionCount;
  const compactionSnapshots = snapshotData.compactionSnapshots;
  const showCompactionSnapshots = compactionSnapshots.length > 0;
  const boundaryLabel = compactionCount > 0
    ? t("usage.compactionsCount", { count: compactionCount })
    : report.contextResetCount > 0 ? t("usage.resetsCount", { count: report.contextResetCount }) : null;
  const missingSnapshots = Math.max(0, compactionCount - compactionSnapshots.length);
  const boundaryTitle = compactionSnapshots.length > 0
    ? [
      ...compactionSnapshots.map((event) => t("usage.compactionSnapshotDetail", {
        time: formatClock(event.timestamp),
        tokens: formatTokenCount(event.contextTokens),
        snapshotTime: event.contextSnapshotTimestamp ? formatClock(event.contextSnapshotTimestamp) : t("meta.unknown"),
      })),
      ...(missingSnapshots > 0 ? [t("datePicker.missingCompactionSnapshots", { count: missingSnapshots })] : []),
    ].join("\n")
    : compactionCount > 0 ? t("usage.compactionBoundaries", { count: compactionCount })
    : report.contextResetCount > 0 ? t("usage.observedShrinks", { count: report.contextResetCount }) : undefined;
  const historyValue = compactionSnapshots.map((event) => formatTokenCount(event.contextTokens)).join(" + ");
  const currentContextTokens = snapshotData.currentTokens;
  const hasCurrentContext = currentContextTokens !== null;
  const value = currentContextTokens !== null ? formatTokenCount(currentContextTokens) : context.hasPercentFull ? `${context.percentFull}%` : "\u2014";
  const label = showCompactionSnapshots
    ? hasCurrentContext ? t("usage.contextSnapshots") : t("usage.historicalCompactionSnapshots")
    : hasCurrentContext ? t("usage.latestContext") : context.hasPercentFull ? t("usage.latestOccupancy") : t("usage.occupancyUnavailable");
  const detail = context.hasContextWindow ? t("usage.windowSummary", { used: formatTokenCount(context.usedTokens), window: formatTokenCount(context.windowTokens), percent: context.percentFull, net: "" })
    : context.hasPercentFull ? t("usage.windowSizeNotObserved") : hasCurrentContext ? t("usage.contextWindowNotObserved") : t("usage.noContextEvidence");
  return <div className="usage-report-occupancy"><div className="usage-occupancy-value"><div className="usage-context-values"><strong className="usage-context-current">{value}</strong>{showCompactionSnapshots && <><span className="usage-context-plus" aria-hidden="true">+</span><strong className="usage-context-history" title={boundaryTitle}>{historyValue}</strong></>}</div><div className="usage-summary-tile-heading"><span>{label}</span>{boundaryLabel && <em className="usage-summary-compactions" title={boundaryTitle}>{boundaryLabel}</em>}</div></div><small>{detail}</small><p className="usage-report-freshness">{freshness.note}</p>{context.hasContextWindow ? <ContextUsageBar segments={context.segments} unusedTokens={context.unusedTokens} label={t("usage.windowFullAria", { count: context.percentFull })} t={t} /> : context.hasPercentFull ? <ContextOccupancyBar percentFull={context.percentFull} label={t("usage.occupancyAria", { count: context.percentFull })} /> : null}</div>;
}

function UsageReportReuseTile({ reuse }: { reuse: CacheReuse | undefined }): React.JSX.Element {
  const { t } = useTranslation("inspector");
  const observed = reuse?.status === "observed" && Number.isFinite(reuse.promptInputTokens);
  const value = !reuse ? t("usage.notObserved") : observed ? `${reuse.reusePercent}%` : t("usage.reuseRateUnavailableLabel");
  const detail = !reuse ? t("usage.noCacheEvidence") : observed
    ? t("usage.cachedUncached", { cached: formatTokenCount(reuse.cacheReadTokens), uncached: formatTokenCount(Number(reuse.uncachedInputTokens)) })
    : t("usage.cachedRateUnavailable", { count: formatTokenCount(reuse.cacheReadTokens) });
  return <div className="usage-report-reuse-tile"><dt>{t("usage.inputReused")}</dt><dd><strong>{value}</strong>{reuse && <CacheReuseBar reuse={reuse} />}<small>{detail}</small></dd></div>;
}

function ContextStructure({ session }: { session: Session }): React.JSX.Element {
  const { t } = useTranslation("inspector");
  const layers = (session.contextManifest?.layers ?? []).filter((layer) => Number.isFinite(layer.itemCount) && layer.itemCount > 0);
  const total = layers.reduce((sum, layer) => sum + layer.itemCount, 0);
  return <section className="usage-report-section usage-structure-section">
    <header><div><h4>{t("usage.contextStructureTitle")}</h4><p>{t("usage.contextStructureDetail")}</p></div>{layers.length > 0 && <strong>{t("usage.structureItemsSummary", { count: total })}</strong>}</header>
    {layers.length > 0
      ? <ul className="usage-structure-list count-only" aria-label={t("usage.structureAria", { total, count: layers.length })}>{layers.map((layer, index) => <li key={`${layer.kind}-${index}`}><span>{layer.kind}</span><strong>×{layer.itemCount}</strong><small>{t("usage.layerItemCount", { kind: layer.kind, count: layer.itemCount })}</small></li>)}</ul>
      : <p className="usage-report-unavailable">{t("usage.structureNotObserved")}</p>}
  </section>;
}

function SessionUsageReport({ session, generatedAt }: { session: Session; generatedAt?: string }): React.JSX.Element {
  const { t } = useTranslation("inspector");
  const usage = session.tokenUsage;
  const context = usageContextPresentation(session, t);
  const report: UsageReport = session.usageReport ?? EMPTY_USAGE_REPORT;
  const freshness = usageSnapshotFreshness(session, generatedAt, t);
  const cacheReuse = session.cacheReuse;
  const compactionCount = Number(session.contextManifest?.compactionCount) || 0;
  const compactionNote = compactionCount > 0 ? t("usage.compactionBoundaries", { count: compactionCount }) : "";
  const inputLabel = usage?.cacheAccountingMode === "included-in-input" ? t("usage.inputIncludesCached")
    : usage?.cacheAccountingMode === "separate-input-lane" ? t("usage.uncachedInput") : t("usage.inputCacheRelationshipUnknown");
  const accounting = [
    [t("usage.providerTotal"), formatObservedTokenCount(usage?.totalTokens)],
    [inputLabel, formatObservedTokenCount(usage?.inputTokens)],
    [t("usage.output"), formatObservedTokenCount(usage?.outputTokens)],
    [t("usage.cachedInputRead"), formatObservedTokenCount(usage?.cacheReadInputTokens)],
    [t("usage.cacheCreation"), formatObservedTokenCount(usage?.cacheCreationInputTokens)],
    [t("usage.reasoning"), formatObservedTokenCount(usage?.reasoningOutputTokens)],
  ];
  return <section className="session-mode-panel usage-report" aria-label={t("usage.reportAria")}>
    <header className="usage-report-lead"><div className="usage-report-heading"><h3>{t("usage.reportTitle")}</h3><p>{t("usage.reportDecisionDetail")}</p></div><aside className="usage-report-summary" aria-label={t("usage.sessionUsageSummaryAria")}><UsageReportOccupancyTile session={session} report={report} context={context} freshness={freshness} /><dl className="usage-report-lead-facts"><UsageReportReuseTile reuse={cacheReuse} /><div><dt>{t("usage.baselineContext")}</dt><dd>{Number.isFinite(report.baselineContextTokens) ? formatTokenCount(Number(report.baselineContextTokens)) : t("usage.notObserved")}</dd></div><div><dt>{t("usage.netVsBaseline")}</dt><dd>{Number.isFinite(report.netContextDeltaTokens) ? formatSignedTokenCount(Number(report.netContextDeltaTokens)) : t("usage.notComparable")}</dd></div><div><dt>{t("usage.sessionProcessed")}</dt><dd>{Number.isFinite(report.processedTokens) ? formatTokenCount(Number(report.processedTokens)) : t("usage.notDerived")}</dd></div><div><dt>{t("usage.modelCalls")}</dt><dd>{report.actualModelCalls || t("usage.notObserved")}</dd></div></dl></aside><p className="usage-report-context-note">{t("usage.inputReuseDetail")}</p></header>
    <UsageEvidenceDetails session={session} report={report} freshness={freshness} />
    <section className="usage-report-section"><header><div><h4>{t("usage.contextProgressionTitle")}</h4><p>{t("usage.contextProgressionDetail")}{progressionBoundaryNote(report, t)}{compactionNote}</p></div><strong>{t("usage.uniqueCalls", { count: report.actualModelCalls })}</strong></header><UsageExplorer session={session} report={report} /></section>
    <ProcessingBreakdown session={session} report={report} />
    <div className="usage-report-columns"><section className="usage-report-section"><header><div><h4>{t("usage.providerAccountingTitle")}</h4><p>{t("usage.providerAccountingDetail")}</p></div></header><dl className="usage-report-facts">{accounting.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section><ContextStructure session={session} /></div>
  </section>;
}

function Filter({ label, count, checked, subtype = false, onChange }: { label: string; count: number; checked: boolean; subtype?: boolean; onChange(): void }): React.JSX.Element {
  return <label className={`session-filter${subtype ? " subtype" : ""}`}><input type="checkbox" checked={checked} onChange={onChange} /><span>{label}</span><em>{count}</em></label>;
}

function ProcessStream({ turn, calls, showIntermediate, showUsage, showTools, enabledTools, showFiles }: { turn: Turn; calls: ToolCall[]; showIntermediate: boolean; showUsage: boolean; showTools: boolean; enabledTools: ReadonlySet<string>; showFiles: boolean }): React.JSX.Element {
  const { t } = useTranslation("inspector");
  const byId = new Map(calls.map((call) => [call.id, call]));
  const rows: ReactNode[] = [];
  let pending: ToolCall[] = [];
  let noteIndex = 0;
  let usageIndex = 0;
  const flush = (usage?: { step: ToolCall; index: number }): void => {
    const visible = pending.filter((call) => enabledTools.has(call.toolName ?? call.operation ?? "tool"));
    pending = [];
    const toolsVisible = showTools && visible.length > 0;
    const usageVisible = showUsage && usage;
    if (!toolsVisible && !usageVisible) return;
    if (!toolsVisible && usageVisible) {
      rows.push(<UsageEvidence step={usageVisible.step} index={usageVisible.index} key={`usage-${usageVisible.index}`} />);
      return;
    }
    const names = [...new Set(visible.map((call) => call.toolName ?? call.operation ?? "tool"))];
    rows.push(<details className={`session-event tools session-process-tool-run session-process-combined${usageVisible ? " with-usage" : ""}`} key={`tools-${rows.length}`}><summary className="session-event-head session-process-combined-summary"><span className="session-process-tool-summary"><strong>{visible.length} tool call{visible.length === 1 ? "" : "s"}</strong><span>{names.slice(0, 3).join(" · ")}{names.length > 3 ? ` +${names.length - 3}` : ""}</span></span>{usageVisible && <UsageEvidence compact step={usageVisible.step} index={usageVisible.index} />}</summary><ToolList calls={visible} showFiles={showFiles} /></details>);
  };
  for (const step of turn.steps ?? []) {
    if (step.kind === "tool") {
      const call = byId.get(step.callId ?? step.id);
      if (call) pending.push(call);
      else {
        flush();
        if (showTools) rows.push(<article className="session-event session-tool-unavailable" key={`missing-${rows.length}`}><div className="session-event-body"><strong>{step.toolName ?? "Tool call"}</strong><span>Structured call detail was not retained.</span></div></article>);
      }
    } else if (step.kind === "note") {
      flush();
      noteIndex += 1;
      if (showIntermediate) rows.push(<article className="session-event intermediate" key={`note-${noteIndex}`}><div className="session-note-label">Intermediate {noteIndex}</div><SessionMarkdown text={step.text ?? ""} /></article>);
    } else if (step.kind === "usage") {
      usageIndex += 1;
      flush({ step, index: usageIndex });
    }
  }
  flush();
  return <div className="session-process-stream">{rows.length ? rows : <p className="session-process-facts">No process events match the active evidence filters.</p>}</div>;
}

function UsageEvidence({ step, index, compact = false }: { step: ToolCall; index: number; compact?: boolean }): React.JSX.Element {
  const { t } = useTranslation("inspector");
  const source = step.source ?? t("usage.normalizedModelEvidence");
  const tokenTotal = Number.isFinite(step.tokenUsage?.totalTokens)
    ? Number(step.tokenUsage?.totalTokens)
    : Number(step.tokenUsage?.inputTokens ?? 0) + Number(step.tokenUsage?.outputTokens ?? 0);
  const compactTokens = tokenTotal > 0 ? t("usage.tokenCount", { tokens: formatTokenCount(tokenTotal) }) : t("usage.usageObservedCompact");
  const context = formatContextWindowUsage(step.contextUsage);
  const detail = `${formatInvocationUsage(step.tokenUsage)} · ${step.cacheReuse ? `${formatCacheReuse(step.cacheReuse)} · ` : ""}${context}`;
  const label = t("usage.modelResponse", { index });
  if (compact) return <span className="session-usage-inline" data-session-event="usage" title={`${step.model ?? source} · ${detail}`}><strong>{label}</strong><span>{compactTokens} · {context}</span></span>;
  return <article className="session-event usage session-usage-compact" data-session-event="usage" title={`${step.model ?? source} · ${detail}`}><strong>{label}</strong><span>{compactTokens} · {context}</span></article>;
}

function ToolList({ calls, showFiles = true }: { calls: ToolCall[]; showFiles?: boolean }): React.JSX.Element {
  const { t } = useTranslation("inspector");
  const runs = groupToolRuns(calls);
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? runs : runs.slice(0, 14);
  return <div className="session-call-list">{visible.map((run) => run.calls.length === 1 ? <ToolRow call={run.calls[0]!} showFiles={showFiles} key={run.calls[0]!.id} /> : <details className="session-tool-run" data-call-count={run.calls.length} key={run.key}><summary><span className="session-tool-id">{run.calls[0]!.id}–{run.calls.at(-1)!.id}</span><span className="session-tool-copy"><i className="family-dot" style={{ background: familyColor(run.calls[0]!.family ?? "other") }} /><strong>{run.calls[0]!.actionLabel ?? run.calls[0]!.toolName ?? "Tool call"} ×{run.calls.length}</strong><code>{run.calls[0]!.toolName ?? run.calls[0]!.operation ?? "tool"}</code></span><span className="session-tool-time"><code>{formatStamp(run.calls[0]!.startedAt)}</code><small>{formatToolRunDuration(run.calls)}</small></span></summary>{run.calls.map((call) => <ToolRow call={call} showFiles={showFiles} key={call.id} />)}</details>)}{!expanded && runs.length > 14 && <button type="button" className="session-call-more" onClick={() => setExpanded(true)}>Show {runs.length - 14} more grouped rows</button>}</div>;
}

function ToolRow({ call, showFiles = true }: { call: ToolCall; showFiles?: boolean }): React.JSX.Element {
  const { t } = useTranslation("inspector");
  const files = call.filePaths ?? (call.filePath ? [call.filePath] : []);
  return <div className="session-tool-row" data-tool={call.toolName ?? call.operation ?? "tool"}><span className="session-tool-id">{call.id}</span><span className="session-tool-copy"><i className="family-dot" style={{ background: familyColor(call.family ?? "other") }} /><strong>{call.actionLabel ?? call.toolName ?? "Tool call"}</strong><code>{call.toolName ?? call.operation ?? "tool"}</code>{call.status === "failed" && <em className="session-tool-failed">failed</em>}</span><span className="session-tool-time"><code>{formatStamp(call.startedAt)}</code><small>{call.durationStatus === "observed" ? formatDuration(call.durationMs) : "—"}</small></span>{call.detail && <span className="session-tool-detail-row"><code className="session-tool-detail">{call.detail}</code><em className={`detail-kind ${call.detailKind?.includes("redacted") ? "redacted" : "summary"}`}>{call.detailKind?.includes("redacted") ? "redacted" : "summary"}</em></span>}{showFiles && files.length > 0 && <code className="session-tool-file">{files.join(" · ")}</code>}</div>;
}

function TurnOutcome({ turn, calls, commits, showResponse, showFiles }: { turn: Turn; calls: ToolCall[]; commits: Commit[]; showResponse: boolean; showFiles: boolean }): React.JSX.Element {
  const { t } = useTranslation("inspector");
  const editCalls = calls.filter((call) => call.family === "change");
  const verifyCalls = calls.filter((call) => call.family === "verify");
  const editPaths = [...new Set(editCalls.flatMap((call) => call.filePaths ?? (call.filePath ? [call.filePath] : [])))];
  const responseStatus = turn.responseStatus ?? (turn.response ? "retained" : "unavailable");
  const statusLabel = responseStatus === "retained" ? "Terminal response retained" : responseStatus === "incomplete" ? "Retained Turn is incomplete" : "Terminal response unavailable";
  return <section className="session-outcome" aria-label={`Turn ${turn.index} outcome`}><header><strong>Outcome</strong><span data-response-status={responseStatus}>{statusLabel}</span></header>{editCalls.length || verifyCalls.length || commits.length ? <ul className="session-outcome-facts">{editCalls.length > 0 && <li><strong>{editCalls.length}</strong> edit calls observed</li>}{verifyCalls.length > 0 && <li><strong>{verifyCalls.length}</strong> verification calls observed</li>}{commits.length > 0 && <li><strong>{commits.length}</strong> correlated commits</li>}</ul> : <p className="session-outcome-empty">No edit, verification, or commit evidence was attributed to this Turn.</p>}{showFiles && editPaths.length > 0 && <div className="session-outcome-paths"><span>Observed edit paths</span><div>{editPaths.map((path) => <code key={path}>{path}</code>)}</div></div>}{editCalls.length > 0 && <p className="session-patch-unavailable">Session-scoped patch was not retained; the current worktree is not used as this Turn’s diff.</p>}{showResponse && (turn.response ? <article className="session-event response"><div className="session-response-label">{t("turn.assistantResponse")}</div><div className="session-event-body"><SessionMarkdown text={turn.response} /></div></article> : <article className="session-event response session-unavailable"><div className="session-event-body"><p>{responseStatus === "incomplete" ? "A later tool call was observed after the last assistant message, so no terminal response is claimed." : "No terminal assistant response was retained after privacy filtering."}</p></div></article>)}{commits.map((commit) => <CommitEvent commit={commit} relation="within this Turn window" key={commit.hash} />)}</section>;
}

function CommitEvent({ commit, relation }: { commit: Commit; relation: string }): React.JSX.Element {
  const { t } = useTranslation("inspector");
  return <article className="session-event commit"><div className="commit-head"><header className="session-event-head"><strong>{commit.shortHash ?? commit.hash.slice(0, 8)} · {commit.subject ?? t("lanes.commitEvidence")}</strong><span>{commit.fileCount ?? commit.files?.length ?? 0} files</span></header><div className="session-event-body"><p>+{commit.linesAdded ?? 0} / -{commit.linesRemoved ?? 0} · committed {relation} · shared paths remain contextual.</p></div></div></article>;
}

function SessionActivity({ calls }: { calls: ToolCall[] }): React.JSX.Element {
  const { t } = useTranslation("inspector");
  const timed = calls.filter((call) => Number.isFinite(call.startedAt));
  const start = Math.min(...timed.map((call) => Number(call.startedAt)));
  const end = Math.max(...timed.map((call) => Number(call.startedAt)));
  return <section className="session-overall-activity"><details className="session-axis-panel"><summary><span>Overall Session activity <em>{calls.length} calls</em></span><small>All retained Turns and unplaced calls</small></summary><div className="react-session-axis" aria-label={`${calls.length} retained calls`}>{timed.length ? timed.slice(0, 180).map((call) => <i key={call.id} title={`${call.actionLabel ?? call.toolName ?? "Tool call"} · ${formatStamp(call.startedAt)}`} style={{ left: `${end > start ? ((Number(call.startedAt) - start) / (end - start)) * 100 : 50}%`, background: familyColor(call.family ?? "other") }} />) : <span>{t("activity.sequenceOnly")}</span>}</div></details></section>;
}

function SessionMarkdown({ text }: { text: string }): React.JSX.Element {
  const blocks = text.replace(/\r\n?/gu, "\n").split(/\n{2,}/u).filter(Boolean);
  return <div className="session-markdown">{blocks.map((block, index) => {
    if (/^```/u.test(block)) return <pre key={index}><code>{block.replace(/^```[^\n]*\n?/u, "").replace(/\n?```$/u, "")}</code></pre>;
    const heading = block.match(/^(#{1,3})\s+(.+)$/u);
    if (heading) { const level = heading[1]!.length; return level === 1 ? <h3 key={index}>{heading[2]}</h3> : level === 2 ? <h4 key={index}>{heading[2]}</h4> : <h5 key={index}>{heading[2]}</h5>; }
    const lines = block.split("\n");
    if (lines.every((line) => /^[-*]\s+/u.test(line))) return <ul key={index}>{lines.map((line, lineIndex) => <li key={lineIndex}>{line.replace(/^[-*]\s+/u, "")}</li>)}</ul>;
    return <p key={index}>{lines.map((line, lineIndex) => <span key={lineIndex}>{line}{lineIndex < lines.length - 1 && <br />}</span>)}</p>;
  })}</div>;
}

function SessionReplay({ session }: { session: Session }): React.JSX.Element {
  const { t } = useTranslation("inspector");
  const events = session.replay?.events ?? [];
  const files = session.replay?.files ?? [];
  const [index, setIndexState] = useState(() => {
    const eventId = new URL(globalThis.location.href).searchParams.get("inspector-event");
    const found = events.findIndex((event) => event.id === eventId);
    return found >= 0 ? found : 0;
  });
  const [indexTab, setIndexTab] = useState<"events" | "files">("events");
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const currentEventRow = useRef<HTMLButtonElement>(null);
  const event = events[index];
  function setIndex(next: number): void {
    const bounded = Math.max(0, Math.min(events.length - 1, next));
    const url = new URL(globalThis.location.href);
    const nextEvent = events[bounded];
    if (nextEvent) url.searchParams.set("inspector-event", nextEvent.id);
    globalThis.history.replaceState(globalThis.history.state, "", url);
    setIndexState(bounded);
  }
  useEffect(() => {
    if (!playing) return undefined;
    if (index >= events.length - 1) { setPlaying(false); return undefined; }
    const timer = globalThis.setTimeout(() => setIndex(index + 1), Math.max(90, 900 / speed));
    return () => globalThis.clearTimeout(timer);
  }, [events.length, index, playing, speed]);
  useEffect(() => { currentEventRow.current?.scrollIntoView({ block: "nearest" }); }, [index, indexTab]);
  function togglePlayback(): void {
    if (playing) { setPlaying(false); return; }
    if (index >= events.length - 1) setIndex(0);
    setPlaying(true);
  }
  if (!event) return <main className="session-notebook-main"><div className="empty-state">{t("replay.unavailable")}</div></main>;
  const start = session.replay?.startMs;
  const end = session.replay?.endMs;
  const timed = Number.isFinite(start) && Number.isFinite(end) && Number(end) > Number(start);
  return <section id="react-session-panel-replay" role="tabpanel" aria-labelledby="react-session-tab-replay" className="session-mode-panel replay-shell"><div className="replay-boundary"><strong>{t("replay.boundary")}</strong><span>{t("replay.boundaryDetail")}</span></div><div className="replay-layout"><main className="replay-stage" tabIndex={0} aria-label={t("replay.stageAria")} onKeyDown={(keyboardEvent) => { if (keyboardEvent.key.toLowerCase() === "j") { keyboardEvent.preventDefault(); setIndex(index - 1); } else if (keyboardEvent.key.toLowerCase() === "l") { keyboardEvent.preventDefault(); setIndex(index + 1); } else if (keyboardEvent.key === " ") { keyboardEvent.preventDefault(); togglePlayback(); } }}><article className={`replay-event-card ${event.type}`}><header><div><small>{event.label ?? event.type}</small><h3>{event.title ?? t("replay.eventTitle", { index: index + 1 })}</h3></div><div className="replay-event-badges">{event.status === "failed" && <span className="replay-status failed">{t("replay.failed")}</span>}{event.availability === "unavailable" && <span className="replay-availability">{t("replay.contentUnavailable")}</span>}{event.bodyExcerpt && <span className="replay-excerpt">{t("replay.excerpt")}</span>}</div></header><div className="replay-event-meta"><span>{replayTiming(event)}</span>{event.meta && <code>{event.meta}</code>}{Number.isFinite(event.durationMs) && <span>{formatDuration(event.durationMs)}</span>}</div><div className="replay-event-body"><p>{event.body ?? t("replay.noBody")}</p></div>{event.files?.length ? <div className="replay-stage-files"><strong>{t("replay.files")}</strong>{event.files.map((file) => <button type="button" key={file} onClick={() => { const next = replayIndexForFile(events, files, file); if (next >= 0) setIndex(next); }}><code>{file}</code></button>)}</div> : null}<footer><span>{event.turnIndex ? t("replay.turn", { index: event.turnIndex }) : t("replay.outsideTurn")}</span></footer></article></main><aside className="replay-index"><div className="replay-index-tabs" role="tablist" aria-label={t("replay.indexAria")}><button type="button" role="tab" aria-selected={indexTab === "events"} tabIndex={indexTab === "events" ? 0 : -1} onClick={() => setIndexTab("events")} onKeyDown={(keyEvent) => moveInspectorTab(keyEvent, "files", setIndexTab)}>{t("replay.events")} <span>{events.length}</span></button><button type="button" role="tab" aria-selected={indexTab === "files"} tabIndex={indexTab === "files" ? 0 : -1} onClick={() => setIndexTab("files")} onKeyDown={(keyEvent) => moveInspectorTab(keyEvent, "events", setIndexTab)}>{t("replay.filesTab")} <span>{files.length}</span></button></div><div className="replay-index-body" role="tabpanel">{indexTab === "events" ? <div className="replay-event-list">{events.map((candidate, candidateIndex) => <button ref={candidateIndex === index ? currentEventRow : undefined} type="button" className={candidateIndex === index ? "replay-current" : undefined} aria-current={candidateIndex === index ? "step" : undefined} key={candidate.id} onClick={() => setIndex(candidateIndex)}><span className="replay-event-order">{candidate.order ?? candidateIndex + 1}</span><span className="replay-event-copy"><strong>{candidate.title ?? candidate.label ?? candidate.type}</strong><small>{replayTiming(candidate)}</small></span><span className="replay-event-kind">{candidate.type.replace("-", " ")}</span></button>)}</div> : files.length ? <div className="replay-file-list">{files.map((file) => <button type="button" key={file.path} onClick={() => { const next = replayIndexForFile(events, files, file.path); if (next >= 0) setIndex(next); }}><code>{file.path}</code><span>{t("replay.eventsCount", { count: file.eventIds.length })}</span></button>)}</div> : <div className="empty-state">{t("replay.noFiles")}</div>}</div></aside></div><section className="replay-transport" aria-label={t("replay.transportAria")}><div className="replay-rail-head"><strong>{t("replay.sessionTimeline")}</strong><span>{timed ? `${formatStamp(start)} → ${formatStamp(end)} UTC` : t("replay.sequenceAxis")}</span></div><div className="react-replay-rail">{events.map((candidate, candidateIndex) => <button type="button" className={`replay-rail-mark ${candidate.type}${candidate.status === "failed" ? " failed" : ""}`} aria-label={t("replay.eventAria", { index: candidateIndex + 1, title: candidate.title ?? candidate.type })} style={{ left: `${timed && Number.isFinite(candidate.atMs) ? ((Number(candidate.atMs) - Number(start)) / (Number(end) - Number(start))) * 100 : (candidateIndex / Math.max(1, events.length - 1)) * 100}%` }} onClick={() => setIndex(candidateIndex)} key={candidate.id} />)}<i className="react-replay-cursor" style={{ left: `${timed && Number.isFinite(event.atMs) ? ((Number(event.atMs) - Number(start)) / (Number(end) - Number(start))) * 100 : (index / Math.max(1, events.length - 1)) * 100}%` }} /></div><div className="replay-rail-legend">{replayLegend(events).map(([type, label]) => <span className={type} key={type}>{label}</span>)}</div><div className="replay-controls"><button type="button" disabled={index === 0} onClick={() => setIndex(index - 1)}>{t("replay.previous")} <kbd>J</kbd></button><button type="button" className="replay-play" aria-pressed={playing} onClick={togglePlayback}>{playing ? t("replay.pause") : t("replay.play")} <kbd>Space</kbd></button><button type="button" disabled={index === events.length - 1} onClick={() => setIndex(index + 1)}>{t("replay.next")} <kbd>L</kbd></button><span className="replay-position">{t("replay.position", { index: index + 1, total: events.length })}</span><div className="replay-speeds" aria-label={t("replay.speedAria")}>{[1, 2, 4, 8].map((value) => <button type="button" aria-pressed={speed === value} onClick={() => setSpeed(value)} key={value}>{value}x</button>)}</div></div></section></section>;
}

function itemsForScope(mode: Mode, scope: string, days: Day[], byNode: Map<string, FeatureNode>, byStory: Map<string, Story>, bySession: Map<string, Session>): Item[] {
  if (mode === "date") {
    const day = days.find((candidate) => candidate.date === scope);
    if (!day) return [];
    const rows = (day.sessionIds ?? []).map((id) => ({ session: bySession.get(id), date: day })).filter((item): item is { session: Session; date: Day } => Boolean(item.session));
    return day.commitHashes?.length ? [...rows, { date: day, commitHashes: day.commitHashes }] : rows;
  }
  const start = byNode.get(scope);
  if (!start) return [];
  const found: Story[] = [];
  const queue = [start];
  while (queue.length) {
    const node = queue.shift()!;
    if (node.type === "story" && byStory.has(node.id)) found.push(byStory.get(node.id)!);
    queue.push(...(node.children ?? []).map((id) => byNode.get(id)).filter((node): node is FeatureNode => Boolean(node)));
  }
  return found.flatMap((story) => story.sessionLinks?.length ? story.sessionLinks.map((link) => ({ story, session: bySession.get(link.sessionId) })) : [{ story }]);
}

function commitsFor(item: Item, byCommit: Map<string, Commit>): Commit[] {
  const hashes = new Set([...(item.story?.commitHashes ?? []), ...(item.session?.commitLinks ?? []).map((link) => link.hash), ...(item.commitHashes ?? [])]);
  return [...hashes].map((hash) => byCommit.get(hash)).filter((commit): commit is Commit => Boolean(commit));
}

function countActions(calls: ToolCall[]): Array<[string, { count: number; family: string }]> {
  const counts = new Map<string, { count: number; family: string }>();
  for (const call of calls) {
    const label = call.actionLabel ?? call.toolName ?? inspectorT("process.useTool");
    const value = counts.get(label) ?? { count: 0, family: call.family ?? "other" };
    counts.set(label, { ...value, count: value.count + 1 });
  }
  return [...counts].sort((left, right) => right[1].count - left[1].count);
}

function toggle<T>(values: Set<T>, value: T): Set<T> { const next = new Set(values); if (next.has(value)) next.delete(value); else next.add(value); return next; }
function toggleNumber(values: Set<number>, value: number): Set<number> { const next = new Set(values); if (next.has(value)) next.delete(value); else next.add(value); return next; }
function moveInspectorTab<T extends string>(event: React.KeyboardEvent<HTMLButtonElement>, next: T, select: (value: T) => void): void { if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return; event.preventDefault(); select(next); const target = event.currentTarget.nextElementSibling ?? event.currentTarget.previousElementSibling; (target as HTMLButtonElement | null)?.focus(); }
function sessionTitle(session: Session): string { return session.prompts?.[0]?.text ?? session.locator ?? session.sessionId; }
function totalCalls(session: Session): number { return session.toolActivity?.totalCalls ?? session.toolActivity?.calls?.length ?? 0; }
function familyColor(family: string): string { return `var(--family-${["inspect", "change", "execute", "verify", "coordinate", "deliver"].includes(family) ? family : "other"})`; }
function platformBadge(report: Report): string { const values = (report.providers ?? []).filter((provider) => provider.sessionCount > 0); return values.length === 0 ? report.filters?.platform ?? "all" : values.length <= 3 ? values.map((provider) => provider.platform).join(" · ") : `${values.length} providers`; }
function formatClock(value?: string | null): string { const date = new Date(value ?? ""); return Number.isNaN(date.valueOf()) ? inspectorT("meta.unknown") : date.toISOString().slice(11, 16); }
function formatDate(value: string, locale = studioLocale()): string { const date = new Date(`${value}T00:00:00.000Z`); return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(date); }
function formatStamp(value?: number | null): string { return Number.isFinite(value) ? new Date(Number(value)).toISOString().slice(11, 19) : inspectorT("meta.timeUnavailable"); }
function formatUsageSnapshotTime(value?: string | null): string | null { const date = new Date(value ?? ""); return Number.isNaN(date.valueOf()) ? null : `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`; }
function usageSnapshotFreshness(session: Session, generatedAt: string | undefined, t: TFunction): { note: string; evidence: string } {
  const projectedAt = formatUsageSnapshotTime(session.usageSnapshot?.timestamp);
  if (session.usageSnapshot?.status === "observed-through" && projectedAt) return { note: t("usage.staticSnapshotObservedThrough", { time: projectedAt }), evidence: t("usage.observedThrough", { time: projectedAt }) };
  if (session.usageSnapshot?.status === "generated-at" && projectedAt) return { note: t("usage.staticSnapshotGeneratedAt", { time: projectedAt }), evidence: t("usage.generatedAt", { time: projectedAt }) };
  if (session.usageSnapshot?.status === "unavailable") return { note: t("usage.staticSnapshotUnavailable"), evidence: t("usage.freshnessUnavailable") };
  const progression = session.usageReport?.progression ?? [];
  const observedAt = [...progression].reverse().map((point) => formatUsageSnapshotTime(point.timestamp)).find((value): value is string => Boolean(value));
  if (observedAt) return { note: t("usage.staticSnapshotObservedThrough", { time: observedAt }), evidence: t("usage.observedThrough", { time: observedAt }) };
  const generated = formatUsageSnapshotTime(generatedAt);
  if (generated) return { note: t("usage.staticSnapshotGeneratedAt", { time: generated }), evidence: t("usage.generatedAt", { time: generated }) };
  return { note: t("usage.staticSnapshotUnavailable"), evidence: t("usage.freshnessUnavailable") };
}
function formatDuration(value?: number | null): string { if (!Number.isFinite(value)) return inspectorT("meta.durationUnavailable"); const ms = Math.max(0, Number(value)); return ms < 1_000 ? `${Math.round(ms)} ms` : ms < 60_000 ? `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)} s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1_000)}s`; }
function formatToolRunDuration(calls: ToolCall[]): string { const duration = observedDurationTotal(calls); return duration === undefined ? "\u2014" : `${formatDuration(duration)}${inspectorT("meta.total")}`; }
function replayTiming(event: ReplayEvent): string { return event.timeBasis === "observed" ? inspectorT("meta.observedTime", { time: formatStamp(event.atMs) }) : event.timeBasis === "turn-boundary" ? inspectorT("meta.turnBoundary", { time: formatStamp(event.atMs) }) : inspectorT("meta.sequenceOnly"); }
function replayLegend(events: ReplayEvent[]): Array<[string, string]> { const present = new Set(events.map((event) => event.type)); const labels: Array<[string, string]> = [["prompt", inspectorT("replay.legend.prompt")], ["intermediate", inspectorT("replay.legend.intermediate")], ["response", inspectorT("replay.legend.response")], ["tool-call", inspectorT("replay.legend.toolCall")], ["commit", inspectorT("replay.legend.commit")]]; const entries = labels.filter(([type]) => present.has(type)); if (events.some((event) => event.status === "failed")) entries.push(["failed", inspectorT("replay.legend.failed")]); return entries; }
function formatTokenCount(value: number): string { return new Intl.NumberFormat(studioLocale(), { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value); }
function contextSnapshotData(session: Session): {
  currentTokens: number | null;
  compactionCount: number;
  compactionSnapshots: Array<{ timestamp: string; contextTokens: number; contextSnapshotTimestamp?: string }>;
  snapshotTokenSum: number;
  observedSnapshotCount: number;
} {
  const reportedCurrent = session.usageReport?.currentContextTokens;
  const manifestCurrent = session.contextManifest?.usedTokens;
  const hasReportedCurrent = reportedCurrent !== null && reportedCurrent !== undefined && Number.isFinite(Number(reportedCurrent)) && Number(reportedCurrent) >= 0;
  const hasManifestCurrent = manifestCurrent !== null && manifestCurrent !== undefined && Number.isFinite(Number(manifestCurrent)) && Number(manifestCurrent) >= 0;
  const currentTokens = hasReportedCurrent
    ? Math.round(Number(reportedCurrent))
    : hasManifestCurrent ? Math.round(Number(manifestCurrent)) : null;
  const compactionSnapshots = (session.contextManifest?.compactionEvents ?? [])
    .filter((event) => Number.isFinite(Number(event.contextTokens)) && Number(event.contextTokens) >= 0)
    .map((event) => ({ ...event, contextTokens: Math.round(Number(event.contextTokens)) }));
  const compactionCount = Math.max(0, Math.round(Number(session.contextManifest?.compactionCount) || 0));
  const snapshotTokenSum = (currentTokens ?? 0) + compactionSnapshots.reduce((sum, event) => sum + event.contextTokens, 0);
  return {
    currentTokens,
    compactionCount,
    compactionSnapshots,
    snapshotTokenSum,
    observedSnapshotCount: (currentTokens === null ? 0 : 1) + compactionSnapshots.length,
  };
}
function sessionContextSnapshotPresentation(session: Session, t: TFunction) {
  const summary = contextSnapshotData(session);
  const compactionTokenSum = summary.compactionSnapshots.reduce((sum, event) => sum + event.contextTokens, 0);
  const parts: string[] = [];
  if (summary.currentTokens !== null) parts.push(t("datePicker.currentContextCompact", { tokens: formatTokenCount(summary.currentTokens) }));
  if (summary.compactionSnapshots.length > 0) parts.push(t("datePicker.compactionContextCompact", { tokens: formatTokenCount(compactionTokenSum), count: summary.compactionSnapshots.length, total: summary.compactionCount }));
  else if (summary.compactionCount > 0) parts.push(t("datePicker.compactionTokensUnavailable", { count: summary.compactionCount }));
  const titleParts: string[] = [];
  if (summary.currentTokens !== null) titleParts.push(t("datePicker.currentContextTitle", { tokens: formatTokenCount(summary.currentTokens) }));
  summary.compactionSnapshots.forEach((event, index) => titleParts.push(t("datePicker.compactionSnapshotTitle", { index: index + 1, tokens: formatTokenCount(event.contextTokens) })));
  if (summary.compactionCount > summary.compactionSnapshots.length) titleParts.push(t("datePicker.missingCompactionSnapshots", { count: summary.compactionCount - summary.compactionSnapshots.length }));
  return { ...summary, compact: parts.join(" · "), title: titleParts.join("\n") };
}
function dayContextSnapshotPresentation(sessions: Session[], t: TFunction) {
  const summaries = sessions.map((session) => sessionContextSnapshotPresentation(session, t));
  return {
    snapshotTokenSum: summaries.reduce((sum, summary) => sum + summary.snapshotTokenSum, 0),
    observedSessions: summaries.filter((summary) => summary.observedSnapshotCount > 0).length,
    compactionCount: summaries.reduce((sum, summary) => sum + summary.compactionCount, 0),
  };
}
function formatSignedTokenCount(value: number): string { return value > 0 ? `+${formatTokenCount(value)}` : value < 0 ? `−${formatTokenCount(Math.abs(value))}` : "0"; }
function formatObservedTokenCount(value?: number): string { return Number.isFinite(value) ? formatTokenCount(Number(value)) : inspectorT("usage.notReported"); }
function formatInvocationUsage(usage?: ToolCall["tokenUsage"]): string {
  if (!usage) return inspectorT("usage.notObserved");
  const parts: string[] = [];
  if (Number.isFinite(usage.totalTokens)) parts.push(`${formatTokenCount(Number(usage.totalTokens))} ${inspectorT("usage.total").toLowerCase()}`);
  if (Number.isFinite(usage.inputTokens)) parts.push(`${formatTokenCount(Number(usage.inputTokens))} ${inspectorT("usage.input").toLowerCase()}`);
  if (Number.isFinite(usage.outputTokens)) parts.push(`${formatTokenCount(Number(usage.outputTokens))} ${inspectorT("usage.output").toLowerCase()}`);
  if (Number.isFinite(usage.cacheReadInputTokens)) parts.push(`${formatTokenCount(Number(usage.cacheReadInputTokens))} ${inspectorT("usage.cacheRead").toLowerCase()}`);
  if (Number.isFinite(usage.cacheCreationInputTokens)) parts.push(`${formatTokenCount(Number(usage.cacheCreationInputTokens))} ${inspectorT("usage.cacheWrite").toLowerCase()}`);
  if (Number.isFinite(usage.reasoningOutputTokens)) parts.push(`${formatTokenCount(Number(usage.reasoningOutputTokens))} ${inspectorT("usage.reasoning").toLowerCase()}`);
  return parts.join(" \u00b7 ") || inspectorT("usage.notObserved");
}
function formatContextWindowUsage(context?: ToolCall["contextUsage"]): string {
  if (!context) return inspectorT("usage.notObservedForResponse");
  const hasUsed = Number.isFinite(context.usedTokens) && Number(context.usedTokens) >= 0;
  const hasWindow = Number.isFinite(context.windowTokens) && Number(context.windowTokens) > 0;
  const hasPercent = Number.isFinite(context.percentFull) && Number(context.percentFull) >= 0 && Number(context.percentFull) <= 100;
  if (hasUsed && hasWindow) {
    const percent = hasPercent
      ? Number(context.percentFull)
      : Math.min(100, Math.round((Number(context.usedTokens) / Number(context.windowTokens)) * 1_000) / 10);
    return `${formatTokenCount(Number(context.usedTokens))} / ${formatTokenCount(Number(context.windowTokens))} · ${percent}% ${inspectorT("usage.full")}`;
  }
  if (hasPercent) return `${context.percentFull}% ${inspectorT("usage.full")} · ${inspectorT("usage.windowSizeNotObserved")}`;
  if (hasUsed) return `${formatTokenCount(Number(context.usedTokens))} ${context.basis === "prompt-tokens" ? inspectorT("usage.observedPromptTokens") : inspectorT("usage.usedTokens")} · ${inspectorT("usage.contextWindowNotObserved")}`;
  return inspectorT("usage.notObservedForResponse");
}
function formatTokenUsage(usage?: Session["tokenUsage"]): string {
  if (!usage) return inspectorT("usage.unavailable");
  if (Number.isFinite(usage.totalTokens)) return `${formatTokenCount(Number(usage.totalTokens))} ${inspectorT("usage.total").toLowerCase()}`;
  const inputOutput = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  return inputOutput > 0 ? `${formatTokenCount(inputOutput)} ${inspectorT("usage.inputPlusOutput")}` : inspectorT("usage.usageObserved");
}
/**
 * The standalone report carries its own literal copy of the palette so it can
 * open offline. Studio owns the active *theme*, so the report's literal
 * `--color-*` values and `color-scheme` are dropped and inherit from Studio's
 * tokens instead of pinning this pane to the report's light palette.
 *
 * Shape and metric literals stay report-owned. They are not theme state, and
 * adopting Studio's scale silently reshapes a surface this package does not
 * otherwise migrate — a 14px checkbox drawn at Studio's `radius-md` becomes a
 * circle.
 */
function inheritStudioTheme(block: string): string {
  const kept = block
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .split(";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration.startsWith("--"))
    .filter((declaration) => declaration.includes("var(") || !declaration.startsWith("--color-"));
  return `:host, .native-inspector-root { ${kept.join("; ")}; }`;
}

function scopeCss(css: string): string { return css.replace(/:root\s*\{([^}]*)\}/u, (_match, block: string) => inheritStudioTheme(block)).replace(/html,\s*body\s*\{[^}]*\}/u, ".native-inspector-root { margin:0; min-width:320px; min-height:100%; font:14px/1.45 var(--font-ui); color:var(--color-text); background:var(--color-workspace); }").replace(/html:has\(body\.session-open\)\s*\{[^}]*\}/u, ".native-inspector-root.session-open { overflow:hidden; }"); }

// Studio owns presentation for this embedded pane. The standalone report drops
// its metric labels to truncated stems ("stori", "sessi") at narrow widths;
// broken words are not an abbreviation, so the strip keeps whole labels and
// scrolls instead.
const NARROW_METRIC_CSS = ".workspace-header-meta{min-width:0}.scope-metrics{min-width:0;overflow-x:auto;overscroll-behavior-x:contain}.scope-metrics .metric{flex:none}.metric .metric-short{display:none}.metric .metric-label{display:inline}";

// The report styles focus for buttons and summaries only, so its one anchor row
// reaches keyboard focus with no visible ring.
const LINK_FOCUS_CSS = ".date-session-row:focus-visible{outline:2px solid var(--color-focus);outline-offset:2px}";

const REACT_CSS = `
  ${NARROW_METRIC_CSS}
  ${LINK_FOCUS_CSS}
  :host,.native-inspector-root{display:block;width:100%;height:100%;min-height:0}.native-inspector-root{position:relative}.native-inspector-root .session-view{position:absolute;inset:0;width:100%;height:100%}.date-session-row{text-decoration:none}.react-action-list{display:grid;max-height:280px;overflow:auto;border-top:1px solid var(--color-border)}.react-action-list .session-tool-row{grid-template-columns:52px minmax(100px,1fr) 74px}.workbench-unevidenced .workbench-head{border-bottom:0}.workbench-unevidenced-note{margin:0;padding:0 12px 10px 12px;color:var(--color-text-muted);font-size:12px;line-height:16px}.react-diagnostics{margin:10px 12px 0;border:1px solid var(--color-border);border-radius:var(--radius-lg);color:var(--color-text-muted);background:var(--color-surface-subtle);font-size:12px}.react-diagnostics summary{padding:7px 9px;cursor:pointer;font-weight:700}.react-diagnostics ul{margin:0;padding:0 26px 9px}.react-session-axis{position:relative;height:52px;margin:4px 0 10px;border-bottom:1px solid var(--color-border);background:linear-gradient(to right,var(--color-border) 1px,transparent 1px);background-size:25% 100%}.react-session-axis>i{position:absolute;bottom:0;width:2px;min-height:12px;height:58%;transform:translateX(-1px);border-radius:1px}.react-session-axis>span{display:grid;height:100%;place-items:center;color:var(--color-text-muted);font-size:12px}.replay-transport{background:var(--color-surface);box-shadow:var(--shadow-popover)}.react-replay-rail{position:relative;height:30px;margin:4px 8px 10px;border-bottom:2px solid var(--color-border-strong)}.react-replay-rail .replay-rail-mark{position:absolute;bottom:-4px;width:7px;height:14px;transform:translateX(-50%);border:0;border-radius:2px;background:var(--color-categorical-2);cursor:pointer}.react-replay-rail .replay-rail-mark.prompt{background:var(--color-categorical-1)}.react-replay-rail .replay-rail-mark.response{background:var(--color-success)}.react-replay-rail .replay-rail-mark.commit{background:var(--color-warning)}.react-replay-rail .replay-rail-mark.failed{box-shadow:0 0 0 2px var(--color-danger)}.react-replay-cursor{position:absolute;top:0;bottom:-5px;width:2px;transform:translateX(-1px);background:var(--color-primary);pointer-events:none}.session-view button:focus-visible,.session-view summary:focus-visible,.session-view select:focus-visible{outline:2px solid var(--color-focus);outline-offset:2px}.session-tool-copy .family-dot{flex:none}.session-process-stream>.session-process-facts{padding:10px}.session-markdown{display:block}
`;
