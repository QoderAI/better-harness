import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  filteredCallCount,
  groupToolRuns,
  observedDurationTotal,
  projectSessionTrace,
  replayIndexForFile,
  sessionTurns,
  type InspectorCommit as Commit,
  type InspectorReplayEvent as ReplayEvent,
  type InspectorSession as Session,
  type InspectorToolCall as ToolCall,
  type InspectorTurn as Turn,
} from "./inspector-session-model.js";

type Mode = "feature" | "date";
type ViewMode = "trace" | "replay";

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
        <section className={`picker-panel${mode === "date" ? " active" : ""}`} role="tabpanel" hidden={mode !== "date"}><DatePicker days={days} bySession={bySession} selected={scope} onSelect={setScope} /></section>
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
  if (!days.length) return <p className="picker-empty">No timestamped sessions or commits in this window.</p>;
  const byDate = new Map(days.map((day) => [day.date, day]));
  const first = new Date(`${days[0]!.date}T00:00:00.000Z`);
  const last = new Date(`${days.at(-1)!.date}T00:00:00.000Z`);
  const start = new Date(first); start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  const end = new Date(last); end.setUTCDate(end.getUTCDate() + ((7 - end.getUTCDay()) % 7));
  const cells: ReactNode[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    const day = byDate.get(date);
    cells.push(day ? <button key={date} className={`date-cell${selected === date ? " active" : ""}`} type="button" aria-current={selected === date ? "date" : undefined} aria-label={`${formatDate(date)}, ${day.sessionIds?.length ?? 0} sessions, ${day.commitHashes?.length ?? 0} commits`} onClick={() => onSelect(date)}><time dateTime={date}>{cursor.getUTCDate()}</time><span className="date-activity" /></button> : <span key={date} className="date-cell empty"><time dateTime={date}>{cursor.getUTCDate()}</time></span>);
  }
  const day = byDate.get(selected);
  const sessions = (day?.sessionIds ?? []).map((id) => bySession.get(id)).filter((session): session is Session => Boolean(session));
  return <><div className="date-calendar"><header><strong>{new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(last)}</strong><span>UTC</span></header><div className="date-weekdays">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((value) => <span key={value}>{value}</span>)}</div><div className="date-grid">{cells}</div><div className="date-selection-summary" aria-live="polite"><strong>{day ? formatDate(day.date) : "Select a date"}</strong><span>{day ? `${day.sessionIds?.length ?? 0} sessions · ${day.commitHashes?.length ?? 0} commits` : ""}</span></div></div><nav className="date-session-navigator" aria-label="Sessions on selected date"><div className="date-session-heading"><strong>Sessions</strong><span>{sessions.length}</span></div><div className="date-session-list">{sessions.length ? sessions.map((session) => <a className="date-session-row" href={`#workbench-${encodeURIComponent(session.sessionId)}`} key={session.sessionId}><span className="date-session-row-top"><span className="date-session-row-meta"><strong>{session.platform ?? "agent"}</strong><time>{formatClock(session.firstSeen)}</time><span>{formatDuration(session.durationMs)}</span></span><span className="date-session-row-stat">{totalCalls(session)} calls</span></span><span className="date-session-title">{sessionTitle(session)}</span></a>) : <p className="picker-empty">No Sessions were observed on this date.</p>}</div></nav></>;
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
  const [mode, setModeState] = useState<ViewMode>(() => new URL(globalThis.location.href).searchParams.get("inspector-view") === "replay" ? "replay" : "trace");
  const view = useRef<HTMLElement>(null);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  useEffect(() => { if (view.current) view.current.scrollTop = 0; }, [mode]);
  function setMode(next: ViewMode): void {
    const url = new URL(globalThis.location.href);
    if (next === "replay") url.searchParams.set("inspector-view", "replay");
    else {
      url.searchParams.delete("inspector-view");
      url.searchParams.delete("inspector-event");
    }
    globalThis.history.replaceState(globalThis.history.state, "", url);
    setModeState(next);
  }
  return <section ref={view} className="session-view" role="dialog" aria-modal="true" aria-labelledby="session-view-title"><header className="session-nav"><nav className="session-crumbs" aria-label="Session breadcrumb"><span>{workspaceName}</span><i>/</i><span>Sessions</span><i>/</i><strong>{sessionTitle(session)}</strong></nav><button className="session-close" type="button" autoFocus onClick={onClose}>Close</button></header><div className="session-shell"><header className="session-titlebar"><div className="session-notebook-brand"><strong>Harness Inspector</strong></div><div className="session-title-copy"><small>{session.platform ?? "agent"} · retained Session</small><h2 id="session-view-title">{sessionTitle(session)}</h2></div><div className="session-title-actions"><div className="session-mode-tabs" role="tablist" aria-label="Session view mode"><button id="react-session-tab-trace" role="tab" aria-controls="react-session-panel-trace" aria-selected={mode === "trace"} tabIndex={mode === "trace" ? 0 : -1} onClick={() => setMode("trace")} onKeyDown={(event) => moveInspectorTab(event, "replay", setMode)}>Trace</button><button id="react-session-tab-replay" role="tab" aria-controls="react-session-panel-replay" aria-selected={mode === "replay"} tabIndex={mode === "replay" ? 0 : -1} onClick={() => setMode("replay")} onKeyDown={(event) => moveInspectorTab(event, "trace", setMode)}>Replay</button></div></div></header>{mode === "trace" ? <SessionTrace session={session} commits={commits} /> : <SessionReplay session={session} />}</div></section>;
}

type EvidenceKind = "prompts" | "responses" | "intermediate" | "usage" | "commits" | "tools";

function SessionTrace({ session, commits }: { session: Session; commits: Commit[] }): React.JSX.Element {
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
  </div></main><aside className="session-sidebar" aria-label="Session outline"><header><div><strong>Session outline</strong><span>Read-only</span></div></header><section><h3>Cells</h3><select className="jump-select" aria-label="Jump to Session cell" defaultValue={turns[0]?.turn.anchorId ?? `turn-${turns[0]?.turn.index ?? 1}`} onChange={(event) => jumpTo(event.target.value)}>{turns.map(({ turn }) => <option value={turn.anchorId ?? `turn-${turn.index}`} key={turn.index}>In [{turn.index}]</option>)}{(projection.unplacedCalls.length > 0 || projection.unplacedFiles.length > 0) && <option value="unplaced">Unplaced evidence</option>}{projection.outsideCommits.length > 0 && <option value="outside">Commits outside Turn windows</option>}</select><div className="session-bulk"><button type="button" onClick={() => setAllProcesses(true)}>Expand process</button><button type="button" onClick={() => setAllProcesses(false)}>Collapse process</button></div></section><details className="session-filter-disclosure"><summary><span>Evidence filters</span><em>{visibleCalls} calls</em></summary><div className="session-filter-list"><Filter label="Prompts" count={turns.length} checked={kinds.has("prompts")} onChange={() => toggleKind("prompts")} /><Filter label="Results" count={responseCount} checked={kinds.has("responses")} onChange={() => toggleKind("responses")} /><Filter label="Intermediate" count={noteCount} checked={kinds.has("intermediate")} onChange={() => toggleKind("intermediate")} /><Filter label="Model usage" count={usageCount} checked={kinds.has("usage")} onChange={() => toggleKind("usage")} /><Filter label="Commits" count={commits.length} checked={kinds.has("commits")} onChange={() => toggleKind("commits")} /><Filter label="Tool calls" count={visibleCalls} checked={kinds.has("tools")} onChange={() => toggleKind("tools")} />{toolNames.slice(0, 8).map((name) => <Filter subtype label={name} count={calls.filter((call) => (call.toolName ?? call.operation ?? "tool") === name).length} checked={enabledTools.has(name)} onChange={() => toggleTool(name)} key={name} />)}<Filter subtype label="File paths" count={session.toolActivity?.files?.length ?? session.files?.length ?? 0} checked={showFiles} onChange={() => setShowFiles((value) => !value)} /></div></details><section className="session-outline-facts"><h3>Session</h3><dl><div><dt>Source</dt><dd>{session.source === "entire-checkpoint" ? "Entire checkpoint" : "Native session"}</dd></div><div><dt>Runtime</dt><dd>{session.platform ?? "unknown"}</dd></div><div><dt>Model</dt><dd>{session.models?.join(", ") || "unavailable"}</dd></div><div><dt>Duration</dt><dd>{formatDuration(session.durationMs)}</dd></div><div><dt>Turns</dt><dd>{turns.length}</dd></div><div><dt>Tool calls</dt><dd>{calls.length}</dd></div><div><dt>File edits</dt><dd>{session.fileEditCount ?? 0}</dd></div><div><dt>Token usage</dt><dd>{formatTokenUsage(session.tokenUsage)}</dd></div>{session.dialogue?.truncated && <div><dt>Projection</dt><dd>Truncated</dd></div>}</dl></section><UsageContextFacts session={session} /></aside></div></section>;
}

function UsageContextFacts({ session }: { session: Session }): React.JSX.Element {
  const usage = session.tokenUsage;
  const context = session.contextManifest;
  const runtime = session.runtime;
  const layers = context?.layers?.map((layer) => `${layer.kind} ×${layer.itemCount}`).join(" · ") || "not observed";
  const categories = context?.categories?.map((category) => `${category.label} ${formatTokenCount(category.estimatedTokens)}`).join(" · ") || "not observed";
  const contextWindow = Number.isFinite(context?.windowTokens) && Number.isFinite(context?.usedTokens)
    ? `${formatTokenCount(Number(context?.usedTokens))} / ${formatTokenCount(Number(context?.windowTokens))} (${context?.percentFull ?? 0}%)`
    : "not observed";
  return <details className="session-usage-disclosure"><summary><span>Usage and context</span><em>{usage?.coverage ?? context?.status ?? "unobserved"}</em></summary><dl>
    <div><dt>Total</dt><dd>{Number.isFinite(usage?.totalTokens) ? formatTokenCount(Number(usage?.totalTokens)) : "not reported"}</dd></div>
    <div><dt>Input</dt><dd>{formatObservedTokenCount(usage?.inputTokens)}</dd></div>
    <div><dt>Output</dt><dd>{formatObservedTokenCount(usage?.outputTokens)}</dd></div>
    <div><dt>Cache read</dt><dd>{formatObservedTokenCount(usage?.cacheReadInputTokens)}</dd></div>
    <div><dt>Cache write</dt><dd>{formatObservedTokenCount(usage?.cacheCreationInputTokens)}</dd></div>
    <div><dt>Reasoning</dt><dd>{formatObservedTokenCount(usage?.reasoningOutputTokens)}</dd></div>
    <div><dt>Context window</dt><dd>{contextWindow}</dd></div>
    <div><dt>Context layers</dt><dd title={layers}>{layers}</dd></div>
    <div><dt>Context categories</dt><dd title={categories}>{categories}</dd></div>
    <div><dt>Compactions</dt><dd>{context ? context.compactionCount ?? 0 : "not observed"}</dd></div>
    <div><dt>Effort</dt><dd>{runtime?.effort ?? "not observed"}</dd></div>
    <div><dt>Provider</dt><dd>{runtime?.modelProvider ?? "not observed"}</dd></div>
    <div><dt>CLI</dt><dd>{runtime?.cliVersion ?? "not observed"}</dd></div>
    <div><dt>Time basis</dt><dd>{session.timestampBasis ?? "unobserved"}</dd></div>
    <div><dt>Evidence source</dt><dd title={usage?.source ?? context?.source}>{usage?.source ?? context?.source ?? "not observed"}</dd></div>
    <div><dt>Raw context</dt><dd>omitted</dd></div>
  </dl></details>;
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
  return <article className="session-event usage" data-session-event="usage"><header><strong>Model response {index}</strong><span title={source}>{step.model ?? source}</span></header><dl><div><dt>Tokens</dt><dd>{formatInvocationUsage(step.tokenUsage)}</dd></div><div><dt>Context</dt><dd>{formatContextWindowUsage(step.contextUsage)}</dd></div></dl></article>;
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
  if (!context || !Number.isFinite(context.usedTokens) || !Number.isFinite(context.windowTokens)) return "not observed for this response";
  const percent = Number.isFinite(context.percentFull)
    ? context.percentFull
    : Math.min(100, Math.round((context.usedTokens / context.windowTokens) * 1_000) / 10);
  return `${formatTokenCount(context.usedTokens)} / ${formatTokenCount(context.windowTokens)} · ${percent}% full`;
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
