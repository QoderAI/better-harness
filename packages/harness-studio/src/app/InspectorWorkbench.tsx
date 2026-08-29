import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
    <div className="inspector-native-host" aria-label="React Harness Inspector Workbench" ref={(host) => {
      if (host && !shadow) setShadow(host.shadowRoot ?? host.attachShadow({ mode: "open" }));
    }} />
    {loaded && shadow ? createPortal(<><style>{loaded.css}{REACT_CSS}</style><ReactInspector report={loaded.report} /></>, shadow) : null}
  </div>;
}

function ReactInspector({ report }: { report: Report }): React.JSX.Element {
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
      <aside className="scope-picker" aria-label="Scope picker">
        <div className="brand"><div className="brand-copy"><strong>Harness Inspector</strong><span>{workspaceName}</span></div><button className="picker-toggle" type="button" aria-expanded={!pickerCollapsed} aria-label={pickerCollapsed ? "Expand capability tree" : "Collapse capability tree"} onClick={() => setPickerCollapsed((value) => !value)}><span className="collapse-label">Hide</span><span className="expand-label">Show tree</span></button></div>
        <div className="mode-tabs" role="tablist" aria-label="Picker mode"><button role="tab" aria-selected={mode === "feature"} tabIndex={mode === "feature" ? 0 : -1} className={mode === "feature" ? "active" : undefined} onClick={() => changeMode("feature")} onKeyDown={(event) => moveInspectorTab(event, "date", changeMode)}>Capability</button><button role="tab" aria-selected={mode === "date"} tabIndex={mode === "date" ? 0 : -1} className={mode === "date" ? "active" : undefined} onClick={() => changeMode("date")} onKeyDown={(event) => moveInspectorTab(event, "feature", changeMode)}>Date</button></div>
        <section className={`picker-panel${mode === "feature" ? " active" : ""}`} role="tabpanel" hidden={mode !== "feature"}><div className="picker-heading"><strong>Capability tree</strong><span>{nodes.length} nodes</span></div>{nodes.length ? <FeatureTree roots={report.featureTree?.roots ?? []} byNode={byNode} selected={scope} collapsed={collapsedBranches} onSelect={setScope} onToggle={(id) => setCollapsedBranches(toggle(collapsedBranches, id))} /> : <p className="picker-empty">No Feature Tree yet. Date mode still exposes observed repository activity.</p>}</section>
        <section className={`picker-panel date-picker-panel${mode === "date" ? " active" : ""}`} role="tabpanel" hidden={mode !== "date"}><DatePicker days={days} bySession={bySession} selected={scope} onSelect={setScope} /></section>
      </aside>
      <main className="workspace">
        <header className="workspace-header"><nav className="workspace-breadcrumb" aria-label="Workbench breadcrumb"><span>Harness Inspector</span><i>/</i><strong>{mode === "date" ? scope : byNode.get(scope)?.title ?? "Delivery Workbench"}</strong></nav><div className="workspace-header-meta"><div className="scope-metrics" aria-label="Scope metrics"><Metric value={itemStories.size} label="stories" singular="story" /><Metric value={itemSessions.length} label="sessions" singular="session" /><Metric value={itemSessions.reduce((sum, session) => sum + totalCalls(session), 0)} label="calls" singular="call" /><Metric value={itemCommits.size} label="commits" singular="commit" /></div><span className="window-badge">{platformBadge(report)} · {sessions.length} sessions</span></div></header>
        <div className="workspace-scroll">{(report.diagnostics?.length ?? 0) > 0 && <details className="react-diagnostics"><summary>Inspector boundaries · {report.diagnostics!.length}</summary><ul>{report.diagnostics!.map((diagnostic) => <li key={diagnostic}>{diagnostic}</li>)}</ul></details>}<section className="workbench-list" aria-live="polite">{items.length ? items.map((item, index) => <WorkbenchCard key={`${item.session?.sessionId ?? item.story?.id ?? "commit"}-${index}`} item={item} commits={commitsFor(item, byCommit)} collapsed={collapsedCards.has(index)} onToggle={() => setCollapsedCards(toggleNumber(collapsedCards, index))} onOpen={openSession} />) : <div className="empty-state">No provenance workbench exists in this scope.</div>}</section></div>
      </main>
    </div>
    {selectedSession && <SessionView workspaceName={workspaceName} session={selectedSession} commits={commitsFor({ session: selectedSession }, byCommit)} onClose={closeSession} />}
  </div>;
}

function FeatureTree(props: { roots: string[]; byNode: Map<string, FeatureNode>; selected: string; collapsed: Set<string>; onSelect(id: string): void; onToggle(id: string): void }): React.JSX.Element {
  const render = (node: FeatureNode): React.JSX.Element => {
    const children = (node.children ?? []).map((id) => props.byNode.get(id)).filter((child): child is FeatureNode => Boolean(child));
    const expanded = !props.collapsed.has(node.id);
    const status = node.status === "complete" ? "complete" : node.status === "todo" ? "todo" : "neutral";
    // The node's own type is already carried by the row class, so a generic
    // "capability" caption would only repeat itself under every row.
    const detail = children.length ? `${children.length} items` : node.stage ?? undefined;
    return <li key={node.id} className={`tree-item ${node.type ?? "feature"}`} role="treeitem" aria-expanded={children.length ? expanded : undefined}><div className="tree-line">{children.length ? <button className="tree-branch-toggle" type="button" aria-expanded={expanded} aria-label={`${expanded ? "Collapse" : "Expand"} ${node.title}`} onClick={() => props.onToggle(node.id)}><span aria-hidden="true">{expanded ? "⌄" : "›"}</span></button> : <span className="tree-branch-spacer" />}<button className={`tree-row ${node.type ?? "feature"}${props.selected === node.id ? " active" : ""}`} type="button" onClick={() => props.onSelect(node.id)}><span className={`tree-check ${status}`} role="img" aria-label={status}><span aria-hidden="true">{status === "complete" ? "✓" : ""}</span></span><span className="tree-copy"><strong>{node.title}</strong>{detail !== undefined && <small>{detail}</small>}</span>{node.evidence && node.evidence !== "declared" && <span className={`evidence ${node.evidence}`}>{node.evidence}</span>}</button></div>{children.length > 0 && expanded && <ul className="tree-children" role="group">{children.map(render)}</ul>}</li>;
  };
  const roots = props.roots.map((id) => props.byNode.get(id)).filter((node): node is FeatureNode => Boolean(node));
  return <ul className="capability-tree" role="tree" aria-label="Capability tree">{roots.map(render)}</ul>;
}

function DatePicker({ days, bySession, selected, onSelect }: { days: Day[]; bySession: Map<string, Session>; selected: string; onSelect(value: string): void }): React.JSX.Element {
  const byDate = useMemo(() => new Map(days.map((day) => [day.date, day])), [days]);
  const months = useMemo(() => [...new Set(days.map((day) => day.date.slice(0, 7)))].sort(), [days]);
  const latestMonth = months.at(-1) ?? "";
  const selectedMonth = byDate.has(selected) ? selected.slice(0, 7) : "";
  const [month, setMonth] = useState(() => selectedMonth || latestMonth);
  useEffect(() => {
    setMonth((current) => selectedMonth || (months.includes(current) ? current : latestMonth));
  }, [latestMonth, months, selectedMonth]);
  if (!days.length) return <p className="picker-empty">No timestamped sessions or commits in this window.</p>;
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
    cells.push(day ? <button key={date} className={`date-cell${selected === date ? " active" : ""}`} type="button" aria-current={selected === date ? "date" : undefined} aria-label={`${formatDate(date)}, ${day.sessionIds?.length ?? 0} sessions, ${day.commitHashes?.length ?? 0} commits`} onClick={() => onSelect(date)}><time dateTime={date}>{cursor.getUTCDate()}</time><span className="date-activity" /></button> : <span key={date} className={`date-cell empty${inMonth ? "" : " outside"}`} aria-hidden="true"><time dateTime={date}>{cursor.getUTCDate()}</time></span>);
  }
  const day = byDate.get(selected);
  const sessions = (day?.sessionIds ?? []).map((id) => bySession.get(id)).filter((session): session is Session => Boolean(session));
  const label = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(first);
  return <><div className="date-calendar"><header><div className="date-calendar-nav"><button type="button" aria-label="Previous month" disabled={monthIndex <= 0} onClick={() => setMonth(months[monthIndex - 1]!)}><span aria-hidden="true">‹</span></button><strong>{label}</strong><button type="button" aria-label="Next month" disabled={monthIndex >= months.length - 1} onClick={() => setMonth(months[monthIndex + 1]!)}><span aria-hidden="true">›</span></button></div><span className="date-calendar-zone">UTC</span></header><div className="date-weekdays" aria-hidden="true">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((value) => <span key={value}>{value}</span>)}</div><div className="date-grid" role="group" aria-label={`${label} evidence calendar`}>{cells}</div><div className="date-selection-summary" aria-live="polite"><strong>{day ? formatDate(day.date) : "Select a date"}</strong><span>{day ? `${day.sessionIds?.length ?? 0} sessions · ${day.commitHashes?.length ?? 0} commits` : ""}</span></div></div><nav className="date-session-navigator" aria-label="Sessions on selected date"><div className="date-session-heading"><strong>Sessions</strong><span>{sessions.length}</span></div><div className="date-session-list">{sessions.length ? sessions.map((session) => <a className="date-session-row" href={`#workbench-${encodeURIComponent(session.sessionId)}`} key={session.sessionId}><span className="date-session-row-top"><span className="date-session-row-meta"><strong>{session.platform ?? "agent"}</strong><time>{formatClock(session.firstSeen)}</time><span>{formatDuration(session.durationMs)}</span></span><span className="date-session-row-stat">{totalCalls(session)} calls</span></span><span className="date-session-title">{sessionTitle(session)}</span></a>) : <p className="picker-empty">No Sessions were observed on this date.</p>}</div></nav></>;
}

function Metric({ value, label, singular }: { value: number; label: string; singular: string }): React.JSX.Element | null {
  return value ? <span className="metric" aria-label={`${value} ${value === 1 ? singular : label}`}><strong>{value}</strong><span className="metric-label">{value === 1 ? singular : label}</span><span className="metric-short">{label.slice(0, 5)}</span></span> : null;
}

function WorkbenchCard({ item, commits, collapsed, onToggle, onOpen }: { item: Item; commits: Commit[]; collapsed: boolean; onToggle(): void; onOpen(session: Session, trigger?: HTMLElement): void }): React.JSX.Element {
  const session = item.session;
  // A scope that retained nothing collapses to its title row. Three empty lanes
  // read as a completed dashboard, and repeating them down a long scope buries
  // the scopes that do carry evidence.
  const retained = Boolean(item.story?.refs?.prompts?.[0])
    || (session?.prompts?.length ?? 0) > 0
    || (session?.toolActivity?.calls?.length ?? 0) > 0
    || commits.length > 0;
  const head = <header className="workbench-head"><div className="workbench-title-line"><div className="workbench-meta">{session ? <><span className="workbench-provider">{session.platform ?? "agent"}</span><span>{formatClock(session.firstSeen)}</span><span>{formatDuration(session.durationMs)}</span></> : <span>No linked Session</span>}</div><h3>{item.story?.title ?? (session ? sessionTitle(session) : "Commits without a linked Session")}</h3></div><div className="head-actions">{session && <button className="prepare-button" type="button" onClick={(event) => onOpen(session, event.currentTarget)}>Open session</button>}{retained && <button className="card-collapse" type="button" aria-expanded={!collapsed} onClick={onToggle}>{collapsed ? "+" : "−"}</button>}</div></header>;
  if (!retained) return <article className="workbench workbench-unevidenced" id={session ? `workbench-${encodeURIComponent(session.sessionId)}` : undefined}>{head}{session ? <p className="workbench-unevidenced-note">No prompt, tool call, or commit was retained for this Session.</p> : null}</article>;
  return <article className={`workbench${collapsed ? " card-collapsed" : ""}`} id={session ? `workbench-${encodeURIComponent(session.sessionId)}` : undefined}>{head}<div className="workbench-grid"><PromptLane item={item} onOpen={onOpen} /><div className="lane-resizer prompt" role="separator" /><ActivityLane session={session} onOpen={onOpen} /><div className="lane-resizer delivery" role="separator" /><DeliveryLane commits={commits} /></div></article>;
}

function PromptLane({ item, onOpen }: { item: Item; onOpen(session: Session, trigger?: HTMLElement): void }): React.JSX.Element {
  const prompts = item.session?.prompts ?? [];
  const declared = item.story?.refs?.prompts?.[0];
  return <section className={`lane prompt-lane${declared || prompts.length ? "" : " lane-empty"}`}><div className="lane-title"><strong>User prompts</strong><span>{prompts.length} retained</span></div>{declared && <div className="intent-card declared-intent"><p>{declared}</p><small>Feature Tree intent · {item.story?.evidence ?? "declared"}</small></div>}{prompts.map((prompt, index) => <div className="intent-card" key={`${prompt.timestamp ?? index}-${index}`}><p>{prompt.text}</p><small>{prompt.turnIndex ? `User turn ${prompt.turnIndex}` : "Retained prompt"}{prompt.timestamp ? ` · ${formatClock(prompt.timestamp)}` : ""}</small></div>)}{!declared && !prompts.length && <div className="empty-state">No retained privacy-safe user turn for this scope.</div>}{item.session && <button className="lane-more" type="button" onClick={(event) => onOpen(item.session!, event.currentTarget)}>Open Session View</button>}</section>;
}

function ActivityLane({ session, onOpen }: { session?: Session; onOpen(session: Session, trigger?: HTMLElement): void }): React.JSX.Element {
  const calls = session?.toolActivity?.calls ?? [];
  if (!session || !calls.length) return <section className="lane activity-lane lane-empty"><div className="lane-title"><strong>Checkpoint activity</strong><span>0 calls</span></div><div className="empty-state">No normalized tool call was retained for this Session.</div></section>;
  const counts = countActions(calls).slice(0, 6);
  const max = Math.max(...counts.map(([, value]) => value.count), 1);
  return <section className="lane activity-lane"><div className="lane-title"><strong>Checkpoint activity</strong><span>{session.toolActivity?.files?.length ?? session.files?.length ?? 0} paths</span></div><div className="activity-summary"><div className="activity-total"><strong>{calls.length}</strong><span>calls · {session.toolActivity?.failedCalls ?? calls.filter((call) => call.status === "failed").length} failed</span></div><div className="family-bars">{counts.map(([label, value]) => <div className="family-row" key={label}><span title={label}><i className="family-dot" style={{ background: familyColor(value.family) }} />{label}</span><div className="family-track"><div className="family-fill" style={{ width: `${Math.max(2, value.count / max * 100)}%`, background: familyColor(value.family) }} /></div><strong>{value.count}</strong></div>)}</div></div><details className="activity-details"><summary><span>Expand {calls.length} normalized actions</span><small>focus view</small></summary><div className="react-action-list">{calls.map((call) => <ToolRow call={call} key={call.id} />)}</div><div className="activity-actions"><button className="activity-action primary" type="button" onClick={(event) => onOpen(session, event.currentTarget)}>Open Session</button></div></details></section>;
}

function DeliveryLane({ commits }: { commits: Commit[] }): React.JSX.Element {
  if (!commits.length) return <section className="lane delivery-lane lane-empty"><div className="lane-title"><strong>Commits / files</strong><span>0 commits</span></div><div className="empty-state">No commit is linked to this Session or Story.</div></section>;
  return <section className="lane delivery-lane"><div className="lane-title"><strong>Commits / files</strong><span>{commits.length} commits</span></div><div className="delivery-content">{commits.map((commit) => <details className="commit-card commit-card-expanded" open key={commit.hash}><summary className="commit-head"><div className="commit-head-line"><span className="commit-id"><span className="commit-chevron">›</span><code>{commit.shortHash ?? commit.hash.slice(0, 8)}</code></span><span className="evidence observed">observed</span></div><p>{commit.subject ?? "Commit evidence"}</p><div className="commit-stats">{commit.fileCount ?? commit.files?.length ?? 0} files · +{commit.linesAdded ?? 0} / -{commit.linesRemoved ?? 0}</div></summary><div className="file-tree">{(commit.files ?? []).map((file) => <div className="file-row" key={file.path}><code>{file.path}</code><span className="delta">{file.added == null ? "bin" : `+${file.added}`} / {file.removed == null ? "bin" : `-${file.removed}`}</span></div>)}</div></details>)}</div></section>;
}

function SessionView({ workspaceName, session, commits, onClose }: { workspaceName: string; session: Session; commits: Commit[]; onClose(): void }): React.JSX.Element {
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
  function setMode(next: ViewMode): void {
    const url = new URL(globalThis.location.href);
    if (next === "replay" || next === "usage") url.searchParams.set("inspector-view", next);
    else {
      url.searchParams.delete("inspector-view");
      url.searchParams.delete("inspector-event");
    }
    if (next !== "replay") url.searchParams.delete("inspector-event");
    globalThis.history.replaceState(globalThis.history.state, "", url);
    setModeState(next);
  }
  return <section ref={view} className="session-view" role="dialog" aria-modal="true" aria-labelledby="session-view-title"><header className="session-nav"><nav className="session-crumbs" aria-label="Session breadcrumb"><span>{workspaceName}</span><i>/</i><span>Sessions</span><i>/</i><strong>{sessionTitle(session)}</strong></nav><button className="session-close" type="button" autoFocus onClick={onClose}>Close</button></header><div className="session-shell"><header className="session-titlebar"><div className="session-notebook-brand"><strong>Harness Inspector</strong></div><div className="session-title-copy"><small>{session.platform ?? "agent"} · retained Session</small><h2 id="session-view-title">{sessionTitle(session)}</h2></div><div className="session-title-actions">{mode === "usage" ? <button className="usage-report-return" type="button" onClick={() => setMode("trace")}>Back to Trace</button> : <div className="session-mode-tabs" role="tablist" aria-label="Session view mode"><button id="react-session-tab-trace" role="tab" aria-controls="react-session-panel-trace" aria-selected={mode === "trace"} tabIndex={mode === "trace" ? 0 : -1} onClick={() => setMode("trace")} onKeyDown={(event) => moveInspectorTab(event, "replay", setMode)}>Trace</button><button id="react-session-tab-replay" role="tab" aria-controls="react-session-panel-replay" aria-selected={mode === "replay"} tabIndex={mode === "replay" ? 0 : -1} onClick={() => setMode("replay")} onKeyDown={(event) => moveInspectorTab(event, "trace", setMode)}>Replay</button></div>}</div></header>{mode === "trace" ? <SessionTrace session={session} commits={commits} onViewUsage={() => setMode("usage")} /> : mode === "replay" ? <SessionReplay session={session} /> : <SessionUsageReport session={session} />}</div></section>;
}

type EvidenceKind = "prompts" | "responses" | "intermediate" | "usage" | "commits" | "tools";

function SessionTrace({ session, commits, onViewUsage }: { session: Session; commits: Commit[]; onViewUsage(): void }): React.JSX.Element {
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
  function setAllProcesses(open: boolean): void { setOpenProcesses(open ? new Set(turns.map(({ turn }) => turn.index)) : new Set()); }
  function jumpTo(value: string): void { cellRefs.current.get(value)?.scrollIntoView({ behavior: "smooth", block: "start" }); }

  return <section id="react-session-panel-trace" role="tabpanel" aria-labelledby="react-session-tab-trace" className="session-mode-panel"><div className="session-layout"><main className="session-notebook-main"><div className="session-timeline" aria-label="Session run cells">
    {turns.length ? turns.map(({ turn, calls: turnCalls, commits: turnCommits }) => {
      const anchor = turn.anchorId ?? `turn-${turn.index}`;
      const processOpen = openProcesses.has(turn.index);
      const intermediateCount = turn.intermediateCount ?? (turn.steps ?? []).filter((step) => step.kind === "note").length;
      const usageEventCount = turn.usageEventCount ?? (turn.steps ?? []).filter((step) => step.kind === "usage").length;
      const eventCount = turn.eventCount ?? intermediateCount + usageEventCount + (turn.toolCallCount ?? turnCalls.length);
      const shown = turn.shownEventCount ?? turn.steps?.length ?? 0;
      const summary = `${turn.processTruncated ? `${shown} of ${eventCount}` : eventCount} process events · ${usageEventCount} model response${usageEventCount === 1 ? "" : "s"} · ${intermediateCount} intermediate response${intermediateCount === 1 ? "" : "s"} · ${turn.toolCallCount ?? turnCalls.length} tool calls${Number.isFinite(turn.durationMs) ? ` · ${formatDuration(turn.durationMs)}` : ""}`;
      return <section className="session-cell" data-session-cell="run" key={anchor} ref={(node) => { if (node) cellRefs.current.set(anchor, node); else cellRefs.current.delete(anchor); }}><header className="session-turn-head"><strong>Turn {turn.index}</strong><span>{summary}</span></header><section className="session-turn" data-turn-index={turn.index}><div className="session-row-marker session-input-marker"><span className="turn-select">In [{turn.index}]</span></div>{kinds.has("prompts") && <article className="session-event prompt"><div className="session-event-body session-prose"><p>{turn.prompt?.text ?? "Prompt unavailable after privacy filtering."}</p></div></article>}<div className="session-row-marker session-process-marker" aria-hidden="true" />{(turn.steps?.length ?? 0) > 0 ? <details className="session-process" open={processOpen} onToggle={(event) => { const open = event.currentTarget.open; setOpenProcesses((current) => open === current.has(turn.index) ? current : toggle(current, turn.index)); }}><summary><span>Process trace</span><em>{shown}{turn.processTruncated ? ` of ${eventCount}` : ""} retained events · observed order</em></summary><div className="session-process-body"><ProcessStream turn={turn} calls={turnCalls} showIntermediate={kinds.has("intermediate")} showUsage={kinds.has("usage")} showTools={kinds.has("tools")} enabledTools={enabledTools} showFiles={showFiles} /></div></details> : <div className="session-process session-process-empty"><span>Process</span><em>No retained process evidence</em></div>}<div className="session-row-marker session-output-marker"><span>Out [{turn.index}]</span></div><div className="session-cell-output"><TurnOutcome turn={turn} calls={turnCalls} commits={kinds.has("commits") ? turnCommits : []} showResponse={kinds.has("responses")} showFiles={showFiles} /></div></section></section>;
    }) : <div className="empty-state">No retained dialogue turns. Unplaced evidence remains available below.</div>}
    {(projection.unplacedCalls.length > 0 || projection.unplacedFiles.length > 0) && <section className="session-cell session-unplaced" data-session-cell="unplaced" ref={(node) => { if (node) cellRefs.current.set("unplaced", node); else cellRefs.current.delete("unplaced"); }}><header className="session-turn-head"><strong>Unplaced evidence</strong><span>{projection.unplacedCalls.length} calls · {projection.unplacedFiles.length} files</span></header><div className="session-cell-marker"><span>[ ]</span></div><section className="session-turn">{kinds.has("tools") && <ToolList calls={projection.unplacedCalls.filter((call) => enabledTools.has(call.toolName ?? call.operation ?? "tool"))} showFiles={showFiles} />}{showFiles && projection.unplacedFiles.length > 0 && <article className="session-event files"><header className="session-event-head"><strong>{projection.unplacedFiles.length} attributed file paths</strong><span>observed tool evidence</span></header><div className="session-file-list">{projection.unplacedFiles.map((file) => <code key={file}>{file}</code>)}</div></article>}</section></section>}
    {kinds.has("commits") && projection.outsideCommits.length > 0 && <section className="session-cell session-outside" data-session-cell="outside" ref={(node) => { if (node) cellRefs.current.set("outside", node); else cellRefs.current.delete("outside"); }}><header className="session-turn-head"><strong>Commits outside Turn windows</strong><span>{projection.outsideCommits.length} commits</span></header><div className="session-cell-marker"><span>[ ]</span></div><section className="session-turn"><div className="session-outside-note">Timestamps fall outside every observed Turn window.</div>{projection.outsideCommits.map(({ commit, relation }) => <CommitEvent commit={commit} relation={relation} key={commit.hash} />)}</section></section>}
    {calls.length > 0 && <SessionActivity calls={calls} />}
  </div></main><aside className="session-sidebar" aria-label="Session outline"><header><div><strong>Session outline</strong><span>Read-only</span></div></header><section><h3>Cells</h3><select className="jump-select" aria-label="Jump to Session cell" defaultValue={turns[0]?.turn.anchorId ?? `turn-${turns[0]?.turn.index ?? 1}`} onChange={(event) => jumpTo(event.target.value)}>{turns.map(({ turn }) => <option value={turn.anchorId ?? `turn-${turn.index}`} key={turn.index}>In [{turn.index}]</option>)}{(projection.unplacedCalls.length > 0 || projection.unplacedFiles.length > 0) && <option value="unplaced">Unplaced evidence</option>}{projection.outsideCommits.length > 0 && <option value="outside">Commits outside Turn windows</option>}</select><div className="session-bulk"><button type="button" onClick={() => setAllProcesses(true)}>Expand process</button><button type="button" onClick={() => setAllProcesses(false)}>Collapse process</button></div></section><details className="session-filter-disclosure"><summary><span>Evidence filters</span><em>{visibleCalls} calls</em></summary><div className="session-filter-list"><Filter label="Prompts" count={turns.length} checked={kinds.has("prompts")} onChange={() => toggleKind("prompts")} /><Filter label="Results" count={responseCount} checked={kinds.has("responses")} onChange={() => toggleKind("responses")} /><Filter label="Intermediate" count={noteCount} checked={kinds.has("intermediate")} onChange={() => toggleKind("intermediate")} /><Filter label="Model usage" count={usageCount} checked={kinds.has("usage")} onChange={() => toggleKind("usage")} /><Filter label="Commits" count={commits.length} checked={kinds.has("commits")} onChange={() => toggleKind("commits")} /><Filter label="Tool calls" count={visibleCalls} checked={kinds.has("tools")} onChange={() => toggleKind("tools")} />{toolNames.slice(0, 8).map((name) => <Filter subtype label={name} count={calls.filter((call) => (call.toolName ?? call.operation ?? "tool") === name).length} checked={enabledTools.has(name)} onChange={() => toggleTool(name)} key={name} />)}<Filter subtype label="File paths" count={session.toolActivity?.files?.length ?? session.files?.length ?? 0} checked={showFiles} onChange={() => setShowFiles((value) => !value)} /></div></details><section className="session-outline-facts"><h3>Session</h3><dl><div><dt>Source</dt><dd>{session.source === "entire-checkpoint" ? "Entire checkpoint" : "Native session"}</dd></div><div><dt>Runtime</dt><dd>{session.platform ?? "unknown"}</dd></div><div><dt>Model</dt><dd title={session.models?.join(", ") || "unavailable"}>{session.models?.join(", ") || "unavailable"}</dd></div><div><dt>Duration</dt><dd>{formatDuration(session.durationMs)}</dd></div><div><dt>Turns</dt><dd>{turns.length}</dd></div><div><dt>Tool calls</dt><dd>{calls.length}</dd></div><div><dt>File edits</dt><dd>{session.fileEditCount ?? 0}</dd></div>{session.dialogue?.truncated && <div><dt>Projection</dt><dd>Truncated</dd></div>}</dl></section><UsageContextSummary session={session} onViewReport={onViewUsage} /></aside></div></section>;
}

interface ContextSegment {
  kind: string;
  label: string;
  tokens: number;
  colorIndex: number;
}

function usageContextPresentation(session: Session): {
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
  if (remaining > 0) segments.push({ kind: observedCategories.length ? "other" : "observed", label: observedCategories.length ? "Other" : "Observed context", tokens: remaining, colorIndex: 7 });
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

function ContextUsageBar({ segments, unusedTokens, label }: { segments: ContextSegment[]; unusedTokens: number; label: string }): React.JSX.Element {
  return <div className="usage-context-bar" role="img" aria-label={label}>
    {segments.map((segment, index) => <i className={`usage-context-segment category-${segment.colorIndex % 8}`} style={{ flexGrow: segment.tokens } as CSSProperties} title={`${segment.label}: ${formatTokenCount(segment.tokens)} tokens`} key={`${segment.kind}-${segment.label}-${index}`} />)}
    {unusedTokens > 0 && <i className="usage-context-unused" style={{ flexGrow: unusedTokens } as CSSProperties} title={`Unused: ${formatTokenCount(unusedTokens)} tokens`} />}
  </div>;
}

function ContextOccupancyBar({ percentFull, label }: { percentFull: number; label: string }): React.JSX.Element {
  return <div className="usage-progress-bar usage-occupancy-bar" role="img" aria-label={label}><i style={{ width: `${percentFull}%` }} /></div>;
}

function progressionBoundaryNote(report: UsageReport): string {
  const notes: string[] = [];
  if (report.contextResetCount > 0) notes.push(`${report.contextResetCount} context shrink/reset${report.contextResetCount === 1 ? "" : "s"}`);
  if (report.modelBoundaryCount > 0) notes.push(`${report.modelBoundaryCount} model boundar${report.modelBoundaryCount === 1 ? "y" : "ies"}`);
  return notes.length ? ` Observed: ${notes.join(" · ")}.` : "";
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

function usagePointDetail(point: UsageProgressionPoint, prompt = point.userPrompt): { primary: string; secondary: string } {
  const stamp = formatUsageStamp(point.timestamp);
  const facts = [...(Number.isFinite(point.turnIndex) ? [`Turn ${point.turnIndex}`] : []), `Response ${point.index}`];
  if (stamp) facts.push(`${stamp} UTC`);
  if (Number.isFinite(point.contextTokens)) facts.push(`${formatTokenCount(Number(point.contextTokens))} context`);
  if (Number.isFinite(point.contextDeltaTokens)) facts.push(formatSignedTokenCount(Number(point.contextDeltaTokens)));
  if (point.boundary === "shrink") facts.push("context shrink/reset");
  if (point.boundary === "model-change") facts.push("model boundary");
  const normalizedPrompt = prompt?.replace(/\s+/gu, " ").trim();
  const promptDetail = normalizedPrompt
    ? normalizedPrompt
    : Number.isFinite(point.turnIndex) || point.promptBoundary
      ? "Linked prompt text was not retained"
      : "No observed linked prompt";
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

function usageBoundaryLabel(point: UsageProgressionPoint): string {
  if (point.boundary === "shrink") return "Context shrink/reset";
  if (point.boundary === "model-change") return "Model boundary";
  if (point.boundary === "baseline") return "Baseline";
  return "Within context cycle";
}

function compactReuse(reuse: CacheReuse | undefined): string {
  if (!reuse) return "—";
  if (reuse.status === "observed" && Number.isFinite(reuse.reusePercent)) return `${reuse.reusePercent}% reused`;
  return `${formatTokenCount(reuse.cacheReadTokens)} cached`;
}

function ResponseDetails({ point, prompt, onStep }: { point?: UsageProgressionPoint; prompt: string | null; onStep(delta: number): void }): React.JSX.Element {
  if (!point) return <aside className="usage-response-detail" aria-live="polite"><strong>Response details</strong><p>Select a chart point or response row to inspect its bounded usage evidence.</p></aside>;
  const facts = [
    ["Context", Number.isFinite(point.contextTokens) ? formatTokenCount(Number(point.contextTokens)) : "not observed"],
    ["Δ context", Number.isFinite(point.contextDeltaTokens) ? formatSignedTokenCount(Number(point.contextDeltaTokens)) : "not comparable"],
    ["Output", Number.isFinite(point.outputTokens) ? formatTokenCount(Number(point.outputTokens)) : "not observed"],
    ["Input reuse", compactReuse(point.cacheReuse)],
    ["Boundary", usageBoundaryLabel(point)],
  ];
  return <aside className="usage-response-detail" aria-live="polite"><header><span>Response details</span><strong>Response {point.index}</strong><small>{formatUsageStamp(point.timestamp) ? `${formatUsageStamp(point.timestamp)} UTC` : "response time unavailable"}</small></header><dl>{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{prompt && <div className="usage-response-prompt"><span>Linked user prompt{Number.isFinite(point.turnIndex) ? ` · T${point.turnIndex}` : ""}</span><p title={prompt}>{prompt}</p></div>}<div className="usage-response-actions"><button type="button" onClick={() => onStep(-1)}>Previous</button><button type="button" onClick={() => onStep(1)}>Next</button></div></aside>;
}

function UsageExplorer({ session, report }: { session: Session; report: UsageReport }): React.JSX.Element {
  const points = report.progression;
  const defaultSize = Math.min(USAGE_WINDOW_SIZE, points.length);
  const minSize = Math.min(USAGE_MIN_WINDOW_SIZE, points.length);
  const lastCycleBoundary = points.reduce((latest, point, index) => ["shrink", "model-change"].includes(point.boundary) ? index : latest, -1);
  const defaultStart = lastCycleBoundary >= 0 && points.length - lastCycleBoundary >= minSize ? lastCycleBoundary : Math.max(0, points.length - defaultSize);
  const [windowRange, setWindowRange] = useState({ start: defaultStart, end: points.length });
  const start = windowRange.start;
  const end = windowRange.end;
  const size = end - start;
  const maxStart = Math.max(0, points.length - size);
  const [selected, setSelected] = useState(points.length - 1);
  const tableRef = useRef<HTMLDivElement>(null);
  const selectedRowRef = useRef<HTMLLIElement>(null);
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
  useEffect(() => {
    const table = tableRef.current;
    const row = selectedRowRef.current;
    if (!table || !row) return;
    const rowRect = row.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    const tableBottom = tableRect.top + table.clientHeight;
    const headerHeight = table.querySelector('.usage-response-head')?.getBoundingClientRect().height ?? 0;
    if (rowRect.top < tableRect.top + headerHeight) table.scrollTop += rowRect.top - tableRect.top - headerHeight;
    else if (rowRect.bottom > tableBottom) table.scrollTop += rowRect.bottom - tableBottom;
  }, [selected, start, end]);
  if (!points.length) return <p className="usage-report-unavailable">Per-response context snapshots were not retained.</p>;
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
  const processedVisible = visible.some((entry) => Number.isFinite(entry.point.processedTokens));
  const first = visible[0]?.point.index;
  const last = visible.at(-1)?.point.index;
  const timed = entries.filter((entry) => formatUsageStamp(entry.point.timestamp));
  const timeRange = timed.length > 1 ? `${formatUsageStamp(timed[0].point.timestamp)} → ${formatUsageStamp(timed.at(-1)?.point.timestamp)} UTC` : "Response timestamps unavailable";
  const brushX = overviewX(entries[start]);
  const brushEnd = overviewX(entries[Math.min(entries.length - 1, end - 1)]);
  const promptEntries = usageTurnEntries(entries);

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
    else if (event.key === "Escape") setSelected(-1);
    else if (event.key === "Enter") select(selected >= 0 ? selected : start);
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
    else if (event.key !== "Enter") return;
    const position = promptEntries[next].position;
    windowAt(position - Math.floor(size / 2));
    setSelected(position);
    event.preventDefault();
    event.stopPropagation();
  }

  return <div className="usage-linked-explorer">
    <div className="usage-overview"><div className="chart-toolbar"><span className="chart-basis">Overview · {entries.length} responses · {promptEntries.length} linked prompts</span><span className="chart-range">{timeRange}</span></div><svg data-usage-overview-chart tabIndex={0} viewBox={`0 0 ${width} 106`} role="img" aria-label="Complete retained context progression. Use Left and Right arrows to move between linked prompts." onKeyDown={onOverviewKeyDown} onClick={(event) => { const position = positionAt(event.clientX, event.currentTarget.getBoundingClientRect(), false); windowAt(position - Math.floor(size / 2)); select(position, false); }}><rect className="usage-overview-surface" x={padX} y="8" width={width - padX * 2} height="88" /><rect className="usage-overview-brush" x={brushX} y="8" width={Math.max(6, brushEnd - brushX)} height="88" />{usageSegments(entries).filter((segment) => segment.length > 1).map((segment, index) => <path className="usage-chart-line" d={usageStepPath(segment, overviewX, overviewY)} key={`overview-${index}`} />)}{promptEntries.map((entry) => { const markerX = overviewX(entry); const label = Number.isFinite(entry.point.turnIndex) ? `T${entry.point.turnIndex}` : "P"; const chipWidth = Math.max(18, 10 + label.length * 5); const halfWidth = chipWidth / 2; const chipX = Math.max(padX + halfWidth, Math.min(width - padX - halfWidth, markerX)); const tooltipWidth = 250; const tooltipX = Math.max(padX, Math.min(width - padX - tooltipWidth, markerX - tooltipWidth / 2)); const hitX = markerX - 7; const hitRight = markerX + 7; const detail = usagePointDetail(entry.point, retainedUsagePrompt(session, entry.point) ?? undefined); return <g className={`usage-overview-turn-marker${entry.position === selected || Number.isFinite(selectedEntry?.point.turnIndex) && entry.point.turnIndex === selectedEntry?.point.turnIndex ? " selected" : ""}`} data-usage-overview-turn-marker data-usage-response-position={entry.position} aria-label={`${detail.primary}. ${detail.secondary}`} onClick={(event) => { event.stopPropagation(); windowAt(entry.position - Math.floor(size / 2)); setSelected(entry.position); }} key={`overview-turn-${entry.point.turnIndex ?? entry.point.id}`}><title>{detail.primary}. {detail.secondary}</title><rect className="usage-overview-turn-hit" x={hitX} y="16" width={hitRight - hitX} height="34" /><line className="usage-overview-turn" x1={markerX} x2={markerX} y1="24" y2="78" /><rect className="usage-overview-turn-chip" x={chipX - halfWidth} y="17" width={chipWidth} height="12" rx="2" /><text className="usage-overview-turn-label" x={chipX} y="26" textAnchor="middle">{label}</text><foreignObject className="usage-overview-prompt-tooltip" x={tooltipX} y="12" width={tooltipWidth} height="38"><div role="tooltip"><strong>{detail.primary}</strong><span>{detail.secondary}</span></div></foreignObject></g>; })}{entries.filter((entry) => ["shrink", "model-change"].includes(entry.point.boundary)).map((entry) => <path className={`usage-overview-event boundary-${entry.point.boundary}`} d={`M${overviewX(entry)} 82 l4 4 -4 4 -4 -4z`} key={`overview-event-${entry.point.id}`} />)}<rect className="usage-overview-handle start" x={brushX - 4} y="52" width="8" height="44" onPointerDown={(event) => beginBrushDrag("start", event)} onPointerMove={moveBrushDrag} onPointerUp={endBrushDrag} onClick={(event) => event.stopPropagation()} /><rect className="usage-overview-handle end" x={brushEnd - 4} y="52" width="8" height="44" onPointerDown={(event) => beginBrushDrag("end", event)} onPointerMove={moveBrushDrag} onPointerUp={endBrushDrag} onClick={(event) => event.stopPropagation()} /><text x={padX} y="14">{formatTokenCount(overviewMax)}</text><text x={padX} y="102">{formatTokenCount(overviewMin)}</text></svg></div>
    <div className="usage-window-toolbar"><div className="usage-window-summary"><strong>Responses {first}–{last}</strong><span>{visible.length} of {entries.length}</span></div><button type="button" disabled={start === 0} onClick={() => windowAt(start - size)}>Previous window</button><div className="usage-window-edge-controls"><label>Start<input type="range" min="0" max={Math.max(0, end - minSize)} value={start} aria-label="Visible response window start" onChange={(event) => windowEdgeAt("start", Number(event.target.value))} /></label><label>End<input type="range" min={Math.min(entries.length, start + minSize)} max={entries.length} value={end} aria-label="Visible response window end" onChange={(event) => windowEdgeAt("end", Number(event.target.value))} /></label></div><button type="button" disabled={end === entries.length} onClick={() => windowAt(start + size)}>Next window</button></div>
    <div className="usage-focus-layout"><div className="usage-context-chart"><div className="chart-toolbar"><span className="chart-basis">Focus · Responses {first}–{last}</span><span className="chart-range">Arrow keys move · Enter selects · Esc clears</span></div><svg className="usage-focus-chart" tabIndex={0} viewBox={`0 0 ${width} 180`} role="img" aria-label={`Focused context progression for responses ${first} through ${last}`} onKeyDown={onExplorerKeyDown} onClick={(event) => select(positionAt(event.clientX, event.currentTarget.getBoundingClientRect(), true))}><rect className="usage-focus-surface" x={padX} y="8" width={width - padX * 2} height="158" />{[0, 0.5, 1].map((ratio) => { const lineY = focusTop + ratio * (focusBottom - focusTop); return <line className="usage-chart-grid" x1={padX} x2={width - padX} y1={lineY} y2={lineY} key={ratio} />; })}{usageSegments(visible).filter((segment) => segment.length > 1).map((segment, index) => <path className="usage-chart-line" d={usageStepPath(segment, focusX, focusY)} key={`focus-${index}`} />)}{selectedVisible && <><line className="usage-selection-line" x1={focusX(selectedEntry)} x2={focusX(selectedEntry)} y1={focusTop} y2="164" /><circle className="usage-selection-point" cx={focusX(selectedEntry)} cy={focusY(selectedEntry)} r="5" /></>}{visible.filter((entry) => ["shrink", "model-change"].includes(entry.point.boundary)).map((entry) => { const markerX = focusX(entry); const detail = usagePointDetail(entry.point, retainedUsagePrompt(session, entry.point) ?? undefined); return <g aria-label={`${detail.primary}. ${detail.secondary}`} onClick={(event) => { event.stopPropagation(); select(entry.position); }} key={`focus-event-${entry.point.id}`}><rect className="usage-chart-point-hit" x={markerX - 8} y="140" width="16" height="22" />{entry.point.boundary === "shrink" ? <path className="usage-focus-event boundary-shrink" d={`M${markerX} 147 l4 4 -4 4 -4 -4z`} /> : <rect className="usage-focus-event boundary-model-change" x={markerX - 4} y="147" width="8" height="8" />}</g>; })}<text x={padX} y={focusTop - 4}>{formatTokenCount(focusMax)}</text><text x={padX} y="172">{formatTokenCount(focusMin)}</text></svg><div className="usage-chart-legend"><span><i className="growth" />Context snapshot</span><span><i className="shrink" />Context shrink/reset</span><span><i className="boundary" />Model boundary</span></div></div><ResponseDetails point={selectedEntry?.point} prompt={selectedEntry ? retainedUsagePrompt(session, selectedEntry.point) : null} onStep={move} /></div>
    <div className="usage-response-table" role="listbox" aria-label={`Responses ${first} through ${last}`} onKeyDown={onExplorerKeyDown} ref={tableRef}><div className={`usage-response-head${processedVisible ? " with-processed" : ""}`} aria-hidden="true"><span>Response</span><span>Time</span><span className="numeric-cell">Context</span><span className="numeric-cell">Δ context</span><span>Reuse</span>{processedVisible && <span className="numeric-cell">Processed</span>}<span className="numeric-cell">Output</span></div><ol>{visible.map((entry) => { const point = entry.point; const isSelected = entry.position === selected; return <li className={`usage-response-row${processedVisible ? " with-processed" : ""}${isSelected ? " selected" : ""}`} role="option" aria-selected={isSelected} tabIndex={isSelected || selected < 0 && entry === visible[0] ? 0 : -1} onClick={() => select(entry.position)} ref={isSelected ? selectedRowRef : undefined} key={point.id}><strong>Response {point.index}</strong><span>{formatUsageStamp(point.timestamp) ?? "—"}</span><strong className="numeric-cell">{Number.isFinite(point.contextTokens) ? formatTokenCount(Number(point.contextTokens)) : "—"}</strong><span className="numeric-cell usage-delta">{Number.isFinite(point.contextDeltaTokens) ? formatSignedTokenCount(Number(point.contextDeltaTokens)) : "—"}</span><em>{compactReuse(point.cacheReuse)}</em>{processedVisible && <span className="numeric-cell">{Number.isFinite(point.processedTokens) ? formatTokenCount(Number(point.processedTokens)) : "—"}</span>}<span className="numeric-cell">{Number.isFinite(point.outputTokens) ? formatTokenCount(Number(point.outputTokens)) : "—"}</span></li>; })}</ol></div>
  </div>;
}

function ProcessingBreakdown({ session, report }: { session: Session; report: UsageReport }): React.JSX.Element | null {
  if (!Number.isFinite(report.processedTokens)) return null;
  const usage = session.tokenUsage;
  const buckets = [
    { kind: "cache-read", label: "Cache read", value: usage?.cacheReadInputTokens },
    { kind: "cache-write", label: "Cache creation", value: usage?.cacheCreationInputTokens },
    { kind: "input", label: "Uncached input", value: usage?.inputTokens },
    { kind: "output", label: "Output", value: usage?.outputTokens },
  ].filter((bucket): bucket is { kind: string; label: string; value: number } => Number.isFinite(bucket.value) && Number(bucket.value) > 0)
    .map((bucket) => ({ ...bucket, value: Number(bucket.value) }));
  const total = Number(report.processedTokens);
  return <section className="usage-report-section">
    <header><div><h4>Session processing breakdown</h4><p>Additive input buckets and output across unique model responses; this is derived usage, not provider total or cost.</p></div><strong>{formatTokenCount(total)} processed</strong></header>
    {buckets.length > 0 && <div className="usage-processing-bar" role="img" aria-label="Derived processed-token breakdown">{buckets.map((bucket) => <i className={`bucket-${bucket.kind}`} style={{ flexGrow: bucket.value }} title={`${bucket.label}: ${formatTokenCount(bucket.value)}`} key={bucket.kind} />)}</div>}
    <ul className="usage-processing-list">{buckets.map((bucket) => <li key={bucket.kind}><i className={`bucket-${bucket.kind}`} /><span>{bucket.label}</span><strong>{formatTokenCount(bucket.value)}</strong><small>{Math.round((bucket.value / total) * 1000) / 10}%</small></li>)}</ul>
  </section>;
}

function formatCacheReuse(reuse: CacheReuse | undefined): string {
  if (!reuse) return "not observed";
  if (reuse.status === "observed" && Number.isFinite(reuse.reusePercent)) return `${reuse.reusePercent}% input reused`;
  if (reuse.status === "inconsistent") return `${formatTokenCount(reuse.cacheReadTokens)} cached · rate unavailable (inconsistent counters)`;
  return `${formatTokenCount(reuse.cacheReadTokens)} cached · rate unavailable`;
}

function CacheReuseBar({ reuse, detailed = false }: { reuse: CacheReuse; detailed?: boolean }): React.JSX.Element | null {
  if (reuse.status !== "observed" || !Number.isFinite(reuse.promptInputTokens) || Number(reuse.promptInputTokens) <= 0) return null;
  const uncachedInput = Number(reuse.uncachedInputTokens);
  const cacheCreation = Number.isFinite(reuse.cacheCreationTokens) ? Math.min(uncachedInput, Number(reuse.cacheCreationTokens)) : 0;
  const buckets = [
    { kind: "cached", label: "Cached input", value: reuse.cacheReadTokens },
    ...(detailed ? [{ kind: "created", label: "Cache creation", value: cacheCreation }] : []),
    { kind: "uncached", label: detailed ? "Other uncached input" : "Uncached input", value: detailed ? Math.max(0, uncachedInput - cacheCreation) : uncachedInput },
  ].filter((bucket) => Number.isFinite(bucket.value) && bucket.value > 0);
  const label = `${reuse.reusePercent}% of ${formatTokenCount(Number(reuse.promptInputTokens))} observed input was served from cache`;
  return <div className="usage-reuse-bar" role="img" aria-label={label}>{buckets.map((bucket) => <i className={`reuse-${bucket.kind}`} style={{ flexGrow: bucket.value }} title={`${bucket.label}: ${formatTokenCount(bucket.value)}`} key={bucket.kind} />)}</div>;
}

function CacheReuseSummary({ reuse }: { reuse: CacheReuse }): React.JSX.Element {
  const observed = reuse.status === "observed" && Number.isFinite(reuse.promptInputTokens);
  const headline = observed ? `${reuse.reusePercent}% reused` : `${formatTokenCount(reuse.cacheReadTokens)} cached`;
  const detail = observed
    ? `${formatTokenCount(reuse.cacheReadTokens)} cached of ${formatTokenCount(Number(reuse.promptInputTokens))} observed input`
    : reuse.status === "inconsistent" ? "Reuse rate unavailable because provider counters are inconsistent" : "Reuse rate unavailable because the cache relationship is unknown";
  return <div className="usage-summary-reuse"><div className="usage-context-meta"><strong>Input reuse</strong><span>{headline}</span></div><CacheReuseBar reuse={reuse} /><p>{detail}</p></div>;
}

function UsageContextSummary({ session, onViewReport }: { session: Session; onViewReport(): void }): React.JSX.Element {
  const usage = session.tokenUsage;
  const context = usageContextPresentation(session);
  const report = session.usageReport ?? EMPTY_USAGE_REPORT;
  const cacheReuse = session.cacheReuse;
  const metrics: Array<{ label: string; value: string }> = [];
  if (Number.isFinite(report.currentContextTokens)) metrics.push({ label: "Current context", value: formatTokenCount(Number(report.currentContextTokens)) });
  else if (context.hasPercentFull) metrics.push({ label: "Current occupancy", value: `${context.percentFull}%` });
  if (cacheReuse) metrics.push({ label: "Input reused", value: cacheReuse.status === "observed" ? `${cacheReuse.reusePercent}%` : formatTokenCount(cacheReuse.cacheReadTokens) });
  if (Number.isFinite(report.processedTokens)) metrics.push({ label: "Session processed", value: formatTokenCount(Number(report.processedTokens)) });
  else if (Number.isFinite(report.providerTotalTokens)) metrics.push({ label: "Provider total", value: formatTokenCount(Number(report.providerTotalTokens)) });
  if (report.actualModelCalls > 0) metrics.push({ label: "Model calls", value: String(report.actualModelCalls) });
  const net = Number.isFinite(report.netContextDeltaTokens) ? ` · ${formatSignedTokenCount(Number(report.netContextDeltaTokens))} net` : "";
  const boundary = context.hasContextWindow ? `${formatTokenCount(context.usedTokens)} / ${formatTokenCount(context.windowTokens)} · ${context.percentFull}% full${net}`
    : context.hasPercentFull ? "Context window size unavailable"
      : context.hasUsedTokens ? "Context window and token categories unavailable" : "Context evidence unavailable";
  return <section className="session-usage-summary" aria-labelledby="session-usage-summary-title">
    <header className="session-usage-head"><div><h3 id="session-usage-summary-title">Usage and context</h3><span>{usage?.coverage ?? session.contextManifest?.status ?? "unobserved"}</span></div><button className="usage-report-link" type="button" onClick={onViewReport}>View report</button></header>
    <dl className="usage-summary-metrics">{metrics.map((metric) => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}</dl>
    {context.hasContextWindow ? <ContextUsageBar segments={context.segments} unusedTokens={context.unusedTokens} label={`${context.percentFull}% of the observed context window is full`} /> : context.hasPercentFull ? <ContextOccupancyBar percentFull={context.percentFull} label={`${context.percentFull}% context occupancy observed; window size unavailable`} /> : null}
    <p className="usage-summary-boundary">{boundary}</p>
    {cacheReuse && <CacheReuseSummary reuse={cacheReuse} />}
    {report.duplicateRecordsCollapsed > 0 && <p className="usage-summary-diagnostics">{report.duplicateRecordsCollapsed} duplicate record{report.duplicateRecordsCollapsed === 1 ? "" : "s"} collapsed{report.conflictingDuplicateRecords > 0 ? ` · ${report.conflictingDuplicateRecords} conflict${report.conflictingDuplicateRecords === 1 ? "" : "s"}` : ""}</p>}
  </section>;
}

function UsageEvidenceDetails({ session, report }: { session: Session; report: UsageReport }): React.JSX.Element {
  const usage = session.tokenUsage;
  const runtime = session.runtime;
  const provider = runtime?.modelProvider ?? session.platform ?? "not observed";
  const contextBasis = session.contextManifest?.basis ?? "not observed";
  const source = usage?.source ?? session.contextManifest?.source ?? "not observed";
  const coverage = usage?.coverage ?? session.contextManifest?.status ?? "unobserved";
  const groups: Array<{ label: string; facts: Array<[string, string | number]> }> = [
    { label: "Observability", facts: [["Coverage", coverage], ["Time basis", session.timestampBasis ?? "unobserved"], ["Raw context", "omitted"]] },
    { label: "Runtime", facts: [["Provider", provider], ["Effort", runtime?.effort ?? "not observed"], ["CLI", runtime?.cliVersion ?? "not observed"]] },
    { label: "Accounting", facts: [["Context basis", contextBasis], ["Processed basis", report.processedTokensBasis ?? "not derived"], ...(report.processedCoverage ? [["Processed coverage", report.processedCoverage] as [string, string]] : [])] },
    { label: "Provenance", facts: [["Evidence source", source], ...(report.duplicateRecordsCollapsed > 0 ? [["Duplicates collapsed", report.duplicateRecordsCollapsed] as [string, number], ["Conflicting duplicates", report.conflictingDuplicateRecords] as [string, number]] : [])] },
  ];
  return <section className="usage-report-evidence" aria-label="Evidence details">
    <div className="usage-evidence-groups">{groups.map((group) => <div className="usage-evidence-group" key={group.label}><strong className="usage-evidence-group-title">{group.label}</strong><dl className="usage-report-facts">{group.facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></div>)}</div>
  </section>;
}

function UsageReportOccupancyTile({ session, report, context }: { session: Session; report: UsageReport; context: ReturnType<typeof usageContextPresentation> }): React.JSX.Element {
  const compactionCount = Number(session.contextManifest?.compactionCount) || 0;
  const boundaryLabel = compactionCount > 0
    ? `${compactionCount} compaction${compactionCount === 1 ? "" : "s"}`
    : report.contextResetCount > 0 ? `${report.contextResetCount} reset${report.contextResetCount === 1 ? "" : "s"}` : null;
  const boundaryTitle = compactionCount > 0
    ? `Provider reported ${compactionCount} compaction boundar${compactionCount === 1 ? "y" : "ies"}`
    : report.contextResetCount > 0 ? `${report.contextResetCount} observed context shrink/reset${report.contextResetCount === 1 ? "" : "s"}` : undefined;
  const value = context.hasUsedTokens ? formatTokenCount(Number(report.currentContextTokens ?? context.usedTokens)) : context.hasPercentFull ? `${context.percentFull}%` : "—";
  const label = context.hasUsedTokens ? "Latest context" : context.hasPercentFull ? "Latest occupancy" : "Occupancy unavailable";
  const detail = context.hasContextWindow ? `${formatTokenCount(context.usedTokens)} / ${formatTokenCount(context.windowTokens)} · ${context.percentFull}% full`
    : context.hasPercentFull ? "Window size not observed" : context.hasUsedTokens ? "Context window not observed" : "No observed context evidence";
  return <div className="usage-report-occupancy"><strong>{value}</strong><div className="usage-summary-tile-heading"><span>{label}</span>{boundaryLabel && <em className="usage-summary-compactions" title={boundaryTitle}>{boundaryLabel}</em>}</div><small>{detail}</small>{context.hasContextWindow ? <ContextUsageBar segments={context.segments} unusedTokens={context.unusedTokens} label={`${context.percentFull}% of the observed context window is full`} /> : context.hasPercentFull ? <ContextOccupancyBar percentFull={context.percentFull} label={`${context.percentFull}% context occupancy observed; window size unavailable`} /> : null}</div>;
}

function UsageReportReuseTile({ reuse }: { reuse: CacheReuse | undefined }): React.JSX.Element {
  const observed = reuse?.status === "observed" && Number.isFinite(reuse.promptInputTokens);
  const value = !reuse ? "not observed" : observed ? `${reuse.reusePercent}%` : "rate unavailable";
  const detail = !reuse ? "No observed cache evidence" : observed
    ? `${formatTokenCount(reuse.cacheReadTokens)} cached · ${formatTokenCount(Number(reuse.uncachedInputTokens))} uncached`
    : `${formatTokenCount(reuse.cacheReadTokens)} cached · rate unavailable`;
  return <div className="usage-report-reuse-tile"><dt>Input reused</dt><dd><strong>{value}</strong>{reuse && <CacheReuseBar reuse={reuse} />}<small>{detail}</small></dd></div>;
}

function ContextStructure({ session }: { session: Session }): React.JSX.Element {
  const layers = (session.contextManifest?.layers ?? []).filter((layer) => Number.isFinite(layer.itemCount) && layer.itemCount > 0);
  const total = layers.reduce((sum, layer) => sum + layer.itemCount, 0);
  return <section className="usage-report-section usage-structure-section">
    <header><div><h4>Context structure</h4><p>Observed layer item counts. Per-layer token sizes were not retained, so K values cannot be derived. Prompt text remains omitted.</p></div>{layers.length > 0 && <strong>{total} items · token sizes unavailable</strong>}</header>
    {layers.length > 0 ? <>
      <div className="usage-structure-bar" role="img" aria-label={`Context structure by observed item count: ${total} items across ${layers.length} layers`}>
        {layers.map((layer, index) => <i className={`category-${index % 8}`} style={{ flexGrow: layer.itemCount }} title={`${layer.kind}: ${layer.itemCount} item${layer.itemCount === 1 ? "" : "s"}`} key={`${layer.kind}-${index}`} />)}
      </div>
      <ul className="usage-structure-list">{layers.map((layer, index) => <li key={`${layer.kind}-${index}`}><i className={`category-${index % 8}`} /><span>{layer.kind}</span><strong>×{layer.itemCount}</strong></li>)}</ul>
    </> : <p className="usage-report-unavailable">Context-layer counts were not observed.</p>}
  </section>;
}

function SessionUsageReport({ session }: { session: Session }): React.JSX.Element {
  const usage = session.tokenUsage;
  const context = usageContextPresentation(session);
  const report: UsageReport = session.usageReport ?? EMPTY_USAGE_REPORT;
  const cacheReuse = session.cacheReuse;
  const compactionCount = Number(session.contextManifest?.compactionCount) || 0;
  const compactionNote = compactionCount > 0 ? ` Provider reported ${compactionCount} compaction boundar${compactionCount === 1 ? "y" : "ies"}.` : "";
  const progressionContexts = report.progression.map((point) => point.contextTokens).filter(Number.isFinite).map(Number);
  const peakContextTokens = progressionContexts.length > 0 ? Math.max(...progressionContexts) : null;
  const processedOrPeak = Number.isFinite(report.processedTokens)
    ? { label: "Session processed", value: formatTokenCount(Number(report.processedTokens)) }
    : { label: "Peak context", value: Number.isFinite(peakContextTokens) ? formatTokenCount(Number(peakContextTokens)) : "not observed" };
  const inputLabel = usage?.cacheAccountingMode === "included-in-input" ? "Total input (includes cached)"
    : usage?.cacheAccountingMode === "separate-input-lane" ? "Uncached input" : "Input (cache relationship unknown)";
  const accounting = [
    ["Provider total", formatObservedTokenCount(usage?.totalTokens)],
    [inputLabel, formatObservedTokenCount(usage?.inputTokens)],
    ["Output", formatObservedTokenCount(usage?.outputTokens)],
    ["Cached input read", formatObservedTokenCount(usage?.cacheReadInputTokens)],
    ["Cache creation", formatObservedTokenCount(usage?.cacheCreationInputTokens)],
    ["Reasoning", formatObservedTokenCount(usage?.reasoningOutputTokens)],
  ];
  return <section className="session-mode-panel usage-report" aria-label="Usage report">
    <header className="usage-report-lead"><h3 className="visually-hidden">Usage report</h3><UsageEvidenceDetails session={session} report={report} /><aside className="usage-report-summary" aria-label="Session usage summary"><UsageReportOccupancyTile session={session} report={report} context={context} /><dl className="usage-report-lead-facts"><UsageReportReuseTile reuse={cacheReuse} /><div><dt>Baseline context</dt><dd>{Number.isFinite(report.baselineContextTokens) ? formatTokenCount(Number(report.baselineContextTokens)) : "not observed"}</dd></div><div><dt>Net vs baseline</dt><dd>{Number.isFinite(report.netContextDeltaTokens) ? formatSignedTokenCount(Number(report.netContextDeltaTokens)) : "not comparable"}</dd></div><div><dt>{processedOrPeak.label}</dt><dd>{processedOrPeak.value}</dd></div><div><dt>Model calls</dt><dd>{report.actualModelCalls || "not observed"}</dd></div></dl></aside></header>
    <section className="usage-report-section"><header><div><h4>Context progression</h4><p>Absolute prompt snapshots across unique model responses. Deltas are net context change, not consumption.{progressionBoundaryNote(report)}{compactionNote}</p></div><strong>{report.actualModelCalls} unique calls</strong></header><UsageExplorer session={session} report={report} /></section>
    <ProcessingBreakdown session={session} report={report} />
    <div className="usage-report-columns"><section className="usage-report-section"><header><div><h4>Provider accounting</h4><p>Observed provider counters. Labels preserve whether cached input is included or reported as a separate lane.</p></div></header><dl className="usage-report-facts">{accounting.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section><ContextStructure session={session} /></div>
  </section>;
}

function Filter({ label, count, checked, subtype = false, onChange }: { label: string; count: number; checked: boolean; subtype?: boolean; onChange(): void }): React.JSX.Element {
  return <label className={`session-filter${subtype ? " subtype" : ""}`}><input type="checkbox" checked={checked} onChange={onChange} /><span>{label}</span><em>{count}</em></label>;
}

function ProcessStream({ turn, calls, showIntermediate, showUsage, showTools, enabledTools, showFiles }: { turn: Turn; calls: ToolCall[]; showIntermediate: boolean; showUsage: boolean; showTools: boolean; enabledTools: ReadonlySet<string>; showFiles: boolean }): React.JSX.Element {
  const byId = new Map(calls.map((call) => [call.id, call]));
  const rows: ReactNode[] = [];
  let pending: ToolCall[] = [];
  let noteIndex = 0;
  let usageIndex = 0;
  const flush = (): void => {
    const visible = pending.filter((call) => enabledTools.has(call.toolName ?? call.operation ?? "tool"));
    pending = [];
    if (!showTools || visible.length === 0) return;
    rows.push(<details className="session-event tools session-process-tool-run" key={`tools-${rows.length}`}><summary className="session-event-head"><strong>{visible.length} tool call{visible.length === 1 ? "" : "s"}</strong><span>{[...new Set(visible.map((call) => call.toolName ?? call.operation ?? "tool"))].slice(0, 3).join(" · ")}</span></summary><ToolList calls={visible} showFiles={showFiles} /></details>);
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
      flush();
      usageIndex += 1;
      if (showUsage) rows.push(<UsageEvidence step={step} index={usageIndex} key={`usage-${usageIndex}`} />);
    }
  }
  flush();
  return <div className="session-process-stream">{rows.length ? rows : <p className="session-process-facts">No process events match the active evidence filters.</p>}</div>;
}

function UsageEvidence({ step, index }: { step: ToolCall; index: number }): React.JSX.Element {
  const source = step.source ?? "normalized model evidence";
  return <article className="session-event usage" data-session-event="usage"><header><strong>Model response {index}</strong><span title={source}>{step.model ?? source}</span></header><dl><div><dt>Tokens</dt><dd>{formatInvocationUsage(step.tokenUsage)}</dd></div>{step.cacheReuse && <div><dt>Input reuse</dt><dd>{formatCacheReuse(step.cacheReuse)}</dd></div>}<div><dt>Context</dt><dd>{formatContextWindowUsage(step.contextUsage)}</dd></div></dl></article>;
}

function ToolList({ calls, showFiles }: { calls: ToolCall[]; showFiles: boolean }): React.JSX.Element {
  const runs = groupToolRuns(calls);
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? runs : runs.slice(0, 14);
  return <div className="session-call-list">{visible.map((run) => run.calls.length === 1 ? <ToolRow call={run.calls[0]!} showFiles={showFiles} key={run.calls[0]!.id} /> : <details className="session-tool-run" data-call-count={run.calls.length} key={run.key}><summary><span className="session-tool-id">{run.calls[0]!.id}–{run.calls.at(-1)!.id}</span><span className="session-tool-copy"><i className="family-dot" style={{ background: familyColor(run.calls[0]!.family ?? "other") }} /><strong>{run.calls[0]!.actionLabel ?? run.calls[0]!.toolName ?? "Tool call"} ×{run.calls.length}</strong><code>{run.calls[0]!.toolName ?? run.calls[0]!.operation ?? "tool"}</code></span><span className="session-tool-time"><code>{formatStamp(run.calls[0]!.startedAt)}</code><small>{formatToolRunDuration(run.calls)}</small></span></summary>{run.calls.map((call) => <ToolRow call={call} showFiles={showFiles} key={call.id} />)}</details>)}{!expanded && runs.length > 14 && <button type="button" className="session-call-more" onClick={() => setExpanded(true)}>Show {runs.length - 14} more grouped rows</button>}</div>;
}

function ToolRow({ call, showFiles = true }: { call: ToolCall; showFiles?: boolean }): React.JSX.Element {
  const files = call.filePaths ?? (call.filePath ? [call.filePath] : []);
  return <div className="session-tool-row" data-tool={call.toolName ?? call.operation ?? "tool"}><span className="session-tool-id">{call.id}</span><span className="session-tool-copy"><i className="family-dot" style={{ background: familyColor(call.family ?? "other") }} /><strong>{call.actionLabel ?? call.toolName ?? "Tool call"}</strong><code>{call.toolName ?? call.operation ?? "tool"}</code>{call.status === "failed" && <em className="session-tool-failed">failed</em>}</span><span className="session-tool-time"><code>{formatStamp(call.startedAt)}</code><small>{call.durationStatus === "observed" ? formatDuration(call.durationMs) : "—"}</small></span>{call.detail && <span className="session-tool-detail-row"><code className="session-tool-detail">{call.detail}</code><em className={`detail-kind ${call.detailKind?.includes("redacted") ? "redacted" : "summary"}`}>{call.detailKind?.includes("redacted") ? "redacted" : "summary"}</em></span>}{showFiles && files.length > 0 && <code className="session-tool-file">{files.join(" · ")}</code>}</div>;
}

function TurnOutcome({ turn, calls, commits, showResponse, showFiles }: { turn: Turn; calls: ToolCall[]; commits: Commit[]; showResponse: boolean; showFiles: boolean }): React.JSX.Element {
  const editCalls = calls.filter((call) => call.family === "change");
  const verifyCalls = calls.filter((call) => call.family === "verify");
  const editPaths = [...new Set(editCalls.flatMap((call) => call.filePaths ?? (call.filePath ? [call.filePath] : [])))];
  const responseStatus = turn.responseStatus ?? (turn.response ? "retained" : "unavailable");
  const statusLabel = responseStatus === "retained" ? "Terminal response retained" : responseStatus === "incomplete" ? "Retained Turn is incomplete" : "Terminal response unavailable";
  return <section className="session-outcome" aria-label={`Turn ${turn.index} outcome`}><header><strong>Outcome</strong><span data-response-status={responseStatus}>{statusLabel}</span></header>{editCalls.length || verifyCalls.length || commits.length ? <ul className="session-outcome-facts">{editCalls.length > 0 && <li><strong>{editCalls.length}</strong> edit calls observed</li>}{verifyCalls.length > 0 && <li><strong>{verifyCalls.length}</strong> verification calls observed</li>}{commits.length > 0 && <li><strong>{commits.length}</strong> correlated commits</li>}</ul> : <p className="session-outcome-empty">No edit, verification, or commit evidence was attributed to this Turn.</p>}{showFiles && editPaths.length > 0 && <div className="session-outcome-paths"><span>Observed edit paths</span><div>{editPaths.map((path) => <code key={path}>{path}</code>)}</div></div>}{editCalls.length > 0 && <p className="session-patch-unavailable">Session-scoped patch was not retained; the current worktree is not used as this Turn’s diff.</p>}{showResponse && (turn.response ? <article className="session-event response"><div className="session-response-label">Assistant response</div><div className="session-event-body"><SessionMarkdown text={turn.response} /></div></article> : <article className="session-event response session-unavailable"><div className="session-event-body"><p>{responseStatus === "incomplete" ? "A later tool call was observed after the last assistant message, so no terminal response is claimed." : "No terminal assistant response was retained after privacy filtering."}</p></div></article>)}{commits.map((commit) => <CommitEvent commit={commit} relation="within this Turn window" key={commit.hash} />)}</section>;
}

function CommitEvent({ commit, relation }: { commit: Commit; relation: string }): React.JSX.Element {
  return <article className="session-event commit"><div className="commit-head"><header className="session-event-head"><strong>{commit.shortHash ?? commit.hash.slice(0, 8)} · {commit.subject ?? "Commit evidence"}</strong><span>{commit.fileCount ?? commit.files?.length ?? 0} files</span></header><div className="session-event-body"><p>+{commit.linesAdded ?? 0} / -{commit.linesRemoved ?? 0} · committed {relation} · shared paths remain contextual.</p></div></div></article>;
}

function SessionActivity({ calls }: { calls: ToolCall[] }): React.JSX.Element {
  const timed = calls.filter((call) => Number.isFinite(call.startedAt));
  const start = Math.min(...timed.map((call) => Number(call.startedAt)));
  const end = Math.max(...timed.map((call) => Number(call.startedAt)));
  return <section className="session-overall-activity"><details className="session-axis-panel"><summary><span>Overall Session activity <em>{calls.length} calls</em></span><small>All retained Turns and unplaced calls</small></summary><div className="react-session-axis" aria-label={`${calls.length} retained calls`}>{timed.length ? timed.slice(0, 180).map((call) => <i key={call.id} title={`${call.actionLabel ?? call.toolName ?? "Tool call"} · ${formatStamp(call.startedAt)}`} style={{ left: `${end > start ? ((Number(call.startedAt) - start) / (end - start)) * 100 : 50}%`, background: familyColor(call.family ?? "other") }} />) : <span>Sequence only · timestamps unavailable</span>}</div></details></section>;
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
  if (!event) return <main className="session-notebook-main"><div className="empty-state">Replay is unavailable because no ordered privacy-safe event ledger was retained.</div></main>;
  const start = session.replay?.startMs;
  const end = session.replay?.endMs;
  const timed = Number.isFinite(start) && Number.isFinite(end) && Number(end) > Number(start);
  return <section id="react-session-panel-replay" role="tabpanel" aria-labelledby="react-session-tab-replay" className="session-mode-panel replay-shell"><div className="replay-boundary"><strong>Read-only evidence playback</strong><span>Replay advances through retained evidence. It never reruns tools, resumes the host Session, or invents missing time.</span></div><div className="replay-layout"><main className="replay-stage" tabIndex={0} aria-label="Current replay event; J and L move between events, Space toggles playback" onKeyDown={(keyboardEvent) => { if (keyboardEvent.key.toLowerCase() === "j") { keyboardEvent.preventDefault(); setIndex(index - 1); } else if (keyboardEvent.key.toLowerCase() === "l") { keyboardEvent.preventDefault(); setIndex(index + 1); } else if (keyboardEvent.key === " ") { keyboardEvent.preventDefault(); togglePlayback(); } }}><article className={`replay-event-card ${event.type}`}><header><div><small>{event.label ?? event.type}</small><h3>{event.title ?? `Event ${index + 1}`}</h3></div><div className="replay-event-badges">{event.status === "failed" && <span className="replay-status failed">Failed</span>}{event.availability === "unavailable" && <span className="replay-availability">Content unavailable</span>}{event.bodyExcerpt && <span className="replay-excerpt">Excerpt</span>}</div></header><div className="replay-event-meta"><span>{replayTiming(event)}</span>{event.meta && <code>{event.meta}</code>}{Number.isFinite(event.durationMs) && <span>{formatDuration(event.durationMs)}</span>}</div><div className="replay-event-body"><p>{event.body ?? "No privacy-safe body retained."}</p></div>{event.files?.length ? <div className="replay-stage-files"><strong>Files</strong>{event.files.map((file) => <button type="button" key={file} onClick={() => { const next = replayIndexForFile(events, files, file); if (next >= 0) setIndex(next); }}><code>{file}</code></button>)}</div> : null}<footer><span>{event.turnIndex ? `Turn ${event.turnIndex}` : "Outside any observed Turn"}</span></footer></article></main><aside className="replay-index"><div className="replay-index-tabs" role="tablist" aria-label="Replay index"><button type="button" role="tab" aria-selected={indexTab === "events"} tabIndex={indexTab === "events" ? 0 : -1} onClick={() => setIndexTab("events")} onKeyDown={(keyEvent) => moveInspectorTab(keyEvent, "files", setIndexTab)}>Events <span>{events.length}</span></button><button type="button" role="tab" aria-selected={indexTab === "files"} tabIndex={indexTab === "files" ? 0 : -1} onClick={() => setIndexTab("files")} onKeyDown={(keyEvent) => moveInspectorTab(keyEvent, "events", setIndexTab)}>Files <span>{files.length}</span></button></div><div className="replay-index-body" role="tabpanel">{indexTab === "events" ? <div className="replay-event-list">{events.map((candidate, candidateIndex) => <button ref={candidateIndex === index ? currentEventRow : undefined} type="button" className={candidateIndex === index ? "replay-current" : undefined} aria-current={candidateIndex === index ? "step" : undefined} key={candidate.id} onClick={() => setIndex(candidateIndex)}><span className="replay-event-order">{candidate.order ?? candidateIndex + 1}</span><span className="replay-event-copy"><strong>{candidate.title ?? candidate.label ?? candidate.type}</strong><small>{replayTiming(candidate)}</small></span><span className="replay-event-kind">{candidate.type.replace("-", " ")}</span></button>)}</div> : files.length ? <div className="replay-file-list">{files.map((file) => <button type="button" key={file.path} onClick={() => { const next = replayIndexForFile(events, files, file.path); if (next >= 0) setIndex(next); }}><code>{file.path}</code><span>{file.eventIds.length} events</span></button>)}</div> : <div className="empty-state">No repository-relative file was retained for Replay.</div>}</div></aside></div><section className="replay-transport" aria-label="Replay controls"><div className="replay-rail-head"><strong>Session timeline</strong><span>{timed ? `${formatStamp(start)} → ${formatStamp(end)} UTC` : "Sequence axis · no observed event timing"}</span></div><div className="react-replay-rail">{events.map((candidate, candidateIndex) => <button type="button" className={`replay-rail-mark ${candidate.type}${candidate.status === "failed" ? " failed" : ""}`} aria-label={`Event ${candidateIndex + 1}: ${candidate.title ?? candidate.type}`} style={{ left: `${timed && Number.isFinite(candidate.atMs) ? ((Number(candidate.atMs) - Number(start)) / (Number(end) - Number(start))) * 100 : (candidateIndex / Math.max(1, events.length - 1)) * 100}%` }} onClick={() => setIndex(candidateIndex)} key={candidate.id} />)}<i className="react-replay-cursor" style={{ left: `${timed && Number.isFinite(event.atMs) ? ((Number(event.atMs) - Number(start)) / (Number(end) - Number(start))) * 100 : (index / Math.max(1, events.length - 1)) * 100}%` }} /></div><div className="replay-rail-legend">{replayLegend(events).map(([type, label]) => <span className={type} key={type}>{label}</span>)}</div><div className="replay-controls"><button type="button" disabled={index === 0} onClick={() => setIndex(index - 1)}>Previous event <kbd>J</kbd></button><button type="button" className="replay-play" aria-pressed={playing} onClick={togglePlayback}>{playing ? "Pause" : "Play"} <kbd>Space</kbd></button><button type="button" disabled={index === events.length - 1} onClick={() => setIndex(index + 1)}>Next event <kbd>L</kbd></button><span className="replay-position">Event {index + 1} / {events.length}</span><div className="replay-speeds" aria-label="Replay speed">{[1, 2, 4, 8].map((value) => <button type="button" aria-pressed={speed === value} onClick={() => setSpeed(value)} key={value}>{value}x</button>)}</div></div></section></section>;
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
    const label = call.actionLabel ?? call.toolName ?? "Use tool";
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
function formatClock(value?: string | null): string { const date = new Date(value ?? ""); return Number.isNaN(date.valueOf()) ? "unknown" : date.toISOString().slice(11, 16); }
function formatDate(value: string): string { const date = new Date(`${value}T00:00:00.000Z`); return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(date); }
function formatStamp(value?: number | null): string { return Number.isFinite(value) ? new Date(Number(value)).toISOString().slice(11, 19) : "time unavailable"; }
function formatDuration(value?: number | null): string { if (!Number.isFinite(value)) return "duration unavailable"; const ms = Math.max(0, Number(value)); return ms < 1_000 ? `${Math.round(ms)} ms` : ms < 60_000 ? `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)} s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1_000)}s`; }
function formatToolRunDuration(calls: ToolCall[]): string { const duration = observedDurationTotal(calls); return duration === undefined ? "—" : `${formatDuration(duration)} total`; }
function replayTiming(event: ReplayEvent): string { return event.timeBasis === "observed" ? `${formatStamp(event.atMs)} UTC · observed time` : event.timeBasis === "turn-boundary" ? `${formatStamp(event.atMs)} UTC · Turn boundary, not exact event time` : "Sequence only · timestamp unavailable"; }
function replayLegend(events: ReplayEvent[]): Array<[string, string]> { const present = new Set(events.map((event) => event.type)); const labels: Array<[string, string]> = [["prompt", "Prompt"], ["intermediate", "Intermediate"], ["response", "Response"], ["tool-call", "Tool call"], ["commit", "Commit"]]; const entries = labels.filter(([type]) => present.has(type)); if (events.some((event) => event.status === "failed")) entries.push(["failed", "Failed"]); return entries; }
function formatTokenCount(value: number): string { return new Intl.NumberFormat("en", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value); }
function formatSignedTokenCount(value: number): string { return value > 0 ? `+${formatTokenCount(value)}` : value < 0 ? `−${formatTokenCount(Math.abs(value))}` : "0"; }
function formatObservedTokenCount(value?: number): string { return Number.isFinite(value) ? formatTokenCount(Number(value)) : "not reported"; }
function formatInvocationUsage(usage?: ToolCall["tokenUsage"]): string {
  if (!usage) return "not observed";
  const parts: string[] = [];
  if (Number.isFinite(usage.totalTokens)) parts.push(`${formatTokenCount(Number(usage.totalTokens))} total`);
  if (Number.isFinite(usage.inputTokens)) parts.push(`${formatTokenCount(Number(usage.inputTokens))} input`);
  if (Number.isFinite(usage.outputTokens)) parts.push(`${formatTokenCount(Number(usage.outputTokens))} output`);
  if (Number.isFinite(usage.cacheReadInputTokens)) parts.push(`${formatTokenCount(Number(usage.cacheReadInputTokens))} cache read`);
  if (Number.isFinite(usage.cacheCreationInputTokens)) parts.push(`${formatTokenCount(Number(usage.cacheCreationInputTokens))} cache write`);
  if (Number.isFinite(usage.reasoningOutputTokens)) parts.push(`${formatTokenCount(Number(usage.reasoningOutputTokens))} reasoning`);
  return parts.join(" · ") || "not observed";
}
function formatContextWindowUsage(context?: ToolCall["contextUsage"]): string {
  if (!context) return "not observed for this response";
  const hasUsed = Number.isFinite(context.usedTokens) && Number(context.usedTokens) >= 0;
  const hasWindow = Number.isFinite(context.windowTokens) && Number(context.windowTokens) > 0;
  const hasPercent = Number.isFinite(context.percentFull) && Number(context.percentFull) >= 0 && Number(context.percentFull) <= 100;
  if (hasUsed && hasWindow) {
    const percent = hasPercent
      ? Number(context.percentFull)
      : Math.min(100, Math.round((Number(context.usedTokens) / Number(context.windowTokens)) * 1_000) / 10);
    return `${formatTokenCount(Number(context.usedTokens))} / ${formatTokenCount(Number(context.windowTokens))} · ${percent}% full`;
  }
  if (hasPercent) return `${context.percentFull}% full · window size not observed`;
  if (hasUsed) return `${formatTokenCount(Number(context.usedTokens))} ${context.basis === "prompt-tokens" ? "observed prompt tokens" : "used tokens"} · context window not observed`;
  return "not observed for this response";
}
function formatTokenUsage(usage?: Session["tokenUsage"]): string {
  if (!usage) return "unavailable";
  if (Number.isFinite(usage.totalTokens)) return `${formatTokenCount(Number(usage.totalTokens))} total`;
  const inputOutput = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  return inputOutput > 0 ? `${formatTokenCount(inputOutput)} input + output` : "usage observed";
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
