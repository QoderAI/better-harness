import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

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

interface ToolCall {
  id: string;
  callId?: string;
  kind?: "note" | "tool";
  text?: string;
  toolName?: string;
  actionLabel?: string;
  operation?: string;
  family?: string;
  status?: string;
  startedAt?: number | null;
  durationMs?: number | null;
  detail?: string;
  detailKind?: string;
  filePath?: string | null;
  filePaths?: string[];
}

interface Turn {
  index: number;
  anchorId?: string;
  prompt?: { text?: string; timestamp?: string | null };
  steps?: ToolCall[];
  toolCallCount?: number;
  response?: string | null;
  responseStatus?: string;
  durationMs?: number | null;
}

interface ReplayEvent {
  id: string;
  type: string;
  title?: string;
  label?: string;
  body?: string;
  turnIndex?: number | null;
  timeBasis?: string;
  atMs?: number | null;
  files?: string[];
}

interface Session {
  sessionId: string;
  locator?: string;
  platform?: string;
  firstSeen?: string | null;
  durationMs?: number | null;
  files?: string[];
  prompts?: Array<{ text: string; timestamp?: string | null; turnIndex?: number | null }>;
  models?: string[];
  toolActivity?: { totalCalls?: number; failedCalls?: number; files?: string[]; calls?: ToolCall[] };
  dialogue?: { turns?: Turn[] };
  replay?: { events?: ReplayEvent[] };
  commitLinks?: Array<{ hash: string }>;
}

interface Commit {
  hash: string;
  shortHash?: string;
  subject?: string;
  fileCount?: number;
  linesAdded?: number;
  linesRemoved?: number;
  files?: Array<{ path: string; added?: number | null; removed?: number | null }>;
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
  const byNode = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const byStory = useMemo(() => new Map(stories.map((story) => [story.id, story])), [stories]);
  const bySession = useMemo(() => new Map(sessions.map((session) => [session.sessionId, session])), [sessions]);
  const byCommit = useMemo(() => new Map(commits.map((commit) => [commit.hash, commit])), [commits]);
  const items = useMemo(() => itemsForScope(mode, scope, days, byNode, byStory, bySession), [mode, scope, days, byNode, byStory, bySession]);
  const itemSessions = [...new Map(items.filter((item) => item.session).map((item) => [item.session!.sessionId, item.session!])).values()];
  const itemCommits = new Set(items.flatMap((item) => commitsFor(item, byCommit).map((commit) => commit.hash)));
  const itemStories = new Set(items.flatMap((item) => item.story ? [item.story.id] : []));
  const workspaceName = report.workspace?.name ?? "workspace";

  function changeMode(next: Mode): void {
    setMode(next);
    setScope(next === "feature" ? report.featureTree?.roots?.[0] ?? nodes[0]?.id ?? "" : days.at(-1)?.date ?? "");
  }

  return <div className={`native-inspector-root${selectedSession ? " session-open" : ""}`} data-studio-native-inspector data-react-inspector-workbench>
    <div className={`app${pickerCollapsed ? " picker-collapsed" : ""}`} data-harness-inspector>
      <aside className="scope-picker" aria-label="Scope picker">
        <div className="brand"><div className="brand-copy"><strong>Harness Inspector</strong><span>{workspaceName}</span></div><button className="picker-toggle" type="button" aria-expanded={!pickerCollapsed} aria-label={pickerCollapsed ? "Expand capability tree" : "Collapse capability tree"} onClick={() => setPickerCollapsed((value) => !value)}><span className="collapse-label">Hide</span><span className="expand-label">Show tree</span></button></div>
        <div className="mode-tabs" role="tablist" aria-label="Picker mode"><button role="tab" aria-selected={mode === "feature"} tabIndex={mode === "feature" ? 0 : -1} className={mode === "feature" ? "active" : undefined} onClick={() => changeMode("feature")} onKeyDown={(event) => moveInspectorTab(event, "date", changeMode)}>Capability</button><button role="tab" aria-selected={mode === "date"} tabIndex={mode === "date" ? 0 : -1} className={mode === "date" ? "active" : undefined} onClick={() => changeMode("date")} onKeyDown={(event) => moveInspectorTab(event, "feature", changeMode)}>Date</button></div>
        <section className={`picker-panel${mode === "feature" ? " active" : ""}`} role="tabpanel" hidden={mode !== "feature"}><div className="picker-heading"><strong>Capability tree</strong><span>{nodes.length} nodes</span></div>{nodes.length ? <FeatureTree roots={report.featureTree?.roots ?? []} byNode={byNode} selected={scope} collapsed={collapsedBranches} onSelect={setScope} onToggle={(id) => setCollapsedBranches(toggle(collapsedBranches, id))} /> : <p className="picker-empty">No Feature Tree yet. Date mode still exposes observed repository activity.</p>}</section>
        <section className={`picker-panel${mode === "date" ? " active" : ""}`} role="tabpanel" hidden={mode !== "date"}><DatePicker days={days} bySession={bySession} selected={scope} onSelect={setScope} /></section>
      </aside>
      <main className="workspace">
        <header className="workspace-header"><nav className="workspace-breadcrumb" aria-label="Workbench breadcrumb"><span>Harness Inspector</span><i>/</i><strong>{mode === "date" ? scope : byNode.get(scope)?.title ?? "Delivery Workbench"}</strong></nav><div className="workspace-header-meta"><div className="scope-metrics" aria-label="Scope metrics"><Metric value={itemStories.size} label="stories" singular="story" /><Metric value={itemSessions.length} label="sessions" singular="session" /><Metric value={itemSessions.reduce((sum, session) => sum + totalCalls(session), 0)} label="calls" singular="call" /><Metric value={itemCommits.size} label="commits" singular="commit" /></div><span className="window-badge">{platformBadge(report)} · {sessions.length} sessions</span></div></header>
        <div className="workspace-scroll">{(report.diagnostics?.length ?? 0) > 0 && <details className="react-diagnostics"><summary>Inspector boundaries · {report.diagnostics!.length}</summary><ul>{report.diagnostics!.map((diagnostic) => <li key={diagnostic}>{diagnostic}</li>)}</ul></details>}<section className="workbench-list" aria-live="polite">{items.length ? items.map((item, index) => <WorkbenchCard key={`${item.session?.sessionId ?? item.story?.id ?? "commit"}-${index}`} item={item} commits={commitsFor(item, byCommit)} collapsed={collapsedCards.has(index)} onToggle={() => setCollapsedCards(toggleNumber(collapsedCards, index))} onOpen={setSelectedSession} />) : <div className="empty-state">No provenance workbench exists in this scope.</div>}</section></div>
      </main>
    </div>
    {selectedSession && <SessionView workspaceName={workspaceName} session={selectedSession} onClose={() => setSelectedSession(undefined)} />}
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

function WorkbenchCard({ item, commits, collapsed, onToggle, onOpen }: { item: Item; commits: Commit[]; collapsed: boolean; onToggle(): void; onOpen(session: Session): void }): React.JSX.Element {
  const session = item.session;
  // A scope that retained nothing collapses to its title row. Three empty lanes
  // read as a completed dashboard, and repeating them down a long scope buries
  // the scopes that do carry evidence.
  const retained = Boolean(item.story?.refs?.prompts?.[0])
    || (session?.prompts?.length ?? 0) > 0
    || (session?.toolActivity?.calls?.length ?? 0) > 0
    || commits.length > 0;
  const head = <header className="workbench-head"><div className="workbench-title-line"><div className="workbench-meta">{session ? <><span className="workbench-provider">{session.platform ?? "agent"}</span><span>{formatClock(session.firstSeen)}</span><span>{formatDuration(session.durationMs)}</span></> : <span>No linked Session</span>}</div><h3>{item.story?.title ?? (session ? sessionTitle(session) : "Commits without a linked Session")}</h3></div><div className="head-actions">{session && <button className="prepare-button" type="button" onClick={() => onOpen(session)}>Open session</button>}{retained && <button className="card-collapse" type="button" aria-expanded={!collapsed} onClick={onToggle}>{collapsed ? "+" : "−"}</button>}</div></header>;
  if (!retained) return <article className="workbench workbench-unevidenced" id={session ? `workbench-${encodeURIComponent(session.sessionId)}` : undefined}>{head}{session ? <p className="workbench-unevidenced-note">No prompt, tool call, or commit was retained for this Session.</p> : null}</article>;
  return <article className={`workbench${collapsed ? " card-collapsed" : ""}`} id={session ? `workbench-${encodeURIComponent(session.sessionId)}` : undefined}>{head}<div className="workbench-grid"><PromptLane item={item} onOpen={onOpen} /><div className="lane-resizer prompt" role="separator" /><ActivityLane session={session} onOpen={onOpen} /><div className="lane-resizer delivery" role="separator" /><DeliveryLane commits={commits} /></div></article>;
}

function PromptLane({ item, onOpen }: { item: Item; onOpen(session: Session): void }): React.JSX.Element {
  const prompts = item.session?.prompts ?? [];
  const declared = item.story?.refs?.prompts?.[0];
  return <section className={`lane prompt-lane${declared || prompts.length ? "" : " lane-empty"}`}><div className="lane-title"><strong>User prompts</strong><span>{prompts.length} retained</span></div>{declared && <div className="intent-card declared-intent"><p>{declared}</p><small>Feature Tree intent · {item.story?.evidence ?? "declared"}</small></div>}{prompts.map((prompt, index) => <div className="intent-card" key={`${prompt.timestamp ?? index}-${index}`}><p>{prompt.text}</p><small>{prompt.turnIndex ? `User turn ${prompt.turnIndex}` : "Retained prompt"}{prompt.timestamp ? ` · ${formatClock(prompt.timestamp)}` : ""}</small></div>)}{!declared && !prompts.length && <div className="empty-state">No retained privacy-safe user turn for this scope.</div>}{item.session && <button className="lane-more" type="button" onClick={() => onOpen(item.session!)}>Open Session View</button>}</section>;
}

function ActivityLane({ session, onOpen }: { session?: Session; onOpen(session: Session): void }): React.JSX.Element {
  const calls = session?.toolActivity?.calls ?? [];
  if (!session || !calls.length) return <section className="lane activity-lane lane-empty"><div className="lane-title"><strong>Checkpoint activity</strong><span>0 calls</span></div><div className="empty-state">No normalized tool call was retained for this Session.</div></section>;
  const counts = countActions(calls).slice(0, 6);
  const max = Math.max(...counts.map(([, value]) => value.count), 1);
  return <section className="lane activity-lane"><div className="lane-title"><strong>Checkpoint activity</strong><span>{session.toolActivity?.files?.length ?? session.files?.length ?? 0} paths</span></div><div className="activity-summary"><div className="activity-total"><strong>{calls.length}</strong><span>calls · {session.toolActivity?.failedCalls ?? calls.filter((call) => call.status === "failed").length} failed</span></div><div className="family-bars">{counts.map(([label, value]) => <div className="family-row" key={label}><span title={label}><i className="family-dot" style={{ background: familyColor(value.family) }} />{label}</span><div className="family-track"><div className="family-fill" style={{ width: `${Math.max(2, value.count / max * 100)}%`, background: familyColor(value.family) }} /></div><strong>{value.count}</strong></div>)}</div></div><details className="activity-details"><summary><span>Expand {calls.length} normalized actions</span><small>focus view</small></summary><div className="react-action-list">{calls.map((call) => <ToolRow call={call} key={call.id} />)}</div><div className="activity-actions"><button className="activity-action primary" type="button" onClick={() => onOpen(session)}>Open Session</button></div></details></section>;
}

function DeliveryLane({ commits }: { commits: Commit[] }): React.JSX.Element {
  if (!commits.length) return <section className="lane delivery-lane lane-empty"><div className="lane-title"><strong>Commits / files</strong><span>0 commits</span></div><div className="empty-state">No commit is linked to this Session or Story.</div></section>;
  return <section className="lane delivery-lane"><div className="lane-title"><strong>Commits / files</strong><span>{commits.length} commits</span></div><div className="delivery-content">{commits.map((commit) => <details className="commit-card commit-card-expanded" open key={commit.hash}><summary className="commit-head"><div className="commit-head-line"><span className="commit-id"><span className="commit-chevron">›</span><code>{commit.shortHash ?? commit.hash.slice(0, 8)}</code></span><span className="evidence observed">observed</span></div><p>{commit.subject ?? "Commit evidence"}</p><div className="commit-stats">{commit.fileCount ?? commit.files?.length ?? 0} files · +{commit.linesAdded ?? 0} / -{commit.linesRemoved ?? 0}</div></summary><div className="file-tree">{(commit.files ?? []).map((file) => <div className="file-row" key={file.path}><code>{file.path}</code><span className="delta">{file.added == null ? "bin" : `+${file.added}`} / {file.removed == null ? "bin" : `-${file.removed}`}</span></div>)}</div></details>)}</div></section>;
}

function SessionView({ workspaceName, session, onClose }: { workspaceName: string; session: Session; onClose(): void }): React.JSX.Element {
  const [mode, setMode] = useState<ViewMode>("trace");
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return <section className="session-view" role="dialog" aria-modal="true" aria-labelledby="session-view-title"><header className="session-nav"><nav className="session-crumbs"><span>{workspaceName}</span><i>/</i><span>Sessions</span><i>/</i><strong>{sessionTitle(session)}</strong></nav><button className="session-close" type="button" autoFocus onClick={onClose}>Close</button></header><div className="session-shell"><header className="session-titlebar"><div className="session-notebook-brand"><strong>Harness Inspector</strong></div><div className="session-title-copy"><small>{session.platform ?? "agent"} · retained Session</small><h2 id="session-view-title">{sessionTitle(session)}</h2></div><div className="session-title-actions"><div className="session-mode-tabs" role="tablist"><button role="tab" aria-selected={mode === "trace"} tabIndex={mode === "trace" ? 0 : -1} onClick={() => setMode("trace")} onKeyDown={(event) => moveInspectorTab(event, "replay", setMode)}>Trace</button><button role="tab" aria-selected={mode === "replay"} tabIndex={mode === "replay" ? 0 : -1} onClick={() => setMode("replay")} onKeyDown={(event) => moveInspectorTab(event, "trace", setMode)}>Replay</button></div></div></header>{mode === "trace" ? <SessionTrace session={session} /> : <SessionReplay session={session} />}</div></section>;
}

function SessionTrace({ session }: { session: Session }): React.JSX.Element {
  const turns = session.dialogue?.turns ?? [];
  const calls = session.toolActivity?.calls ?? [];
  return <div className="session-layout"><main className="session-notebook-main"><div className="session-timeline">{turns.length ? turns.map((turn) => <article className="session-cell" key={turn.anchorId ?? turn.index}><header className="session-turn-head"><strong>Turn {turn.index}</strong><span>{turn.toolCallCount ?? 0} calls · {formatDuration(turn.durationMs)}</span></header><div className="session-cell-marker"><span className="turn-select">IN {turn.index}</span><span>OUT</span></div><div className="session-turn"><article className="session-event prompt"><div className="session-event-head"><strong>Prompt</strong><span>{formatClock(turn.prompt?.timestamp)}</span></div><div className="session-event-body session-markdown"><p>{turn.prompt?.text ?? "Prompt unavailable after privacy filtering."}</p></div></article><details className="session-process" open><summary><span>Process</span><em>{turn.toolCallCount ?? 0} tool calls</em></summary><div className="session-process-body">{(turn.steps ?? []).map((step, index) => step.kind === "note" ? <article className="session-event intermediate" key={`note-${index}`}><div className="session-note-label">Intermediate</div><p>{step.text}</p></article> : <ToolRow call={{ ...step, id: step.callId ?? step.id ?? `tool-${index}` }} key={step.callId ?? step.id ?? index} />)}</div></details><article className="session-event response"><div className="session-event-head"><strong>Response</strong><span>{turn.responseStatus ?? "retained"}</span></div><div className="session-event-body session-markdown"><p>{turn.response ?? "No privacy-safe response retained."}</p></div></article></div></article>) : <div className="empty-state">No retained dialogue turns. The normalized tool ledger remains in the outline.</div>}</div></main><aside className="session-sidebar"><header><div><strong>Session outline</strong><span>{session.locator ?? session.sessionId}</span></div></header><section className="session-outline-facts"><h3>Observed facts</h3><dl><div><dt>Provider</dt><dd>{session.platform ?? "unknown"}</dd></div><div><dt>Turns</dt><dd>{turns.length}</dd></div><div><dt>Tool calls</dt><dd>{calls.length}</dd></div><div><dt>Files</dt><dd>{session.files?.length ?? 0}</dd></div><div><dt>Model</dt><dd>{session.models?.join(", ") || "not retained"}</dd></div></dl></section><section><h3>Files</h3><div className="session-file-list">{session.files?.length ? session.files.map((file) => <code key={file}>{file}</code>) : <span className="empty-state">No paths retained.</span>}</div></section></aside></div>;
}

function ToolRow({ call }: { call: ToolCall }): React.JSX.Element {
  const files = call.filePaths ?? (call.filePath ? [call.filePath] : []);
  return <div className="session-tool-row"><span className="session-tool-id">{call.id}</span><span className="session-tool-copy"><strong>{call.actionLabel ?? call.toolName ?? "Tool call"}</strong><code>{call.toolName ?? call.operation ?? "tool"}</code></span><span className="session-tool-time"><code>{formatStamp(call.startedAt)}</code><small>{formatDuration(call.durationMs)}</small></span>{call.detail && <span className="session-tool-detail-row"><em className={`detail-kind ${call.detailKind?.includes("redacted") ? "redacted" : "summary"}`}>{call.detailKind?.includes("redacted") ? "redacted" : "summary"}</em><span className="session-tool-detail">{call.detail}</span></span>}{files.length > 0 && <code className="session-tool-file">{files.join(" · ")}</code>}</div>;
}

function SessionReplay({ session }: { session: Session }): React.JSX.Element {
  const events = session.replay?.events ?? [];
  const [index, setIndex] = useState(0);
  const event = events[index];
  if (!event) return <main className="session-notebook-main"><div className="empty-state">Replay is unavailable because no ordered privacy-safe event ledger was retained.</div></main>;
  return <main className="session-notebook-main replay-shell"><p className="replay-boundary"><strong>Ordered evidence replay</strong><span>Replay follows retained event order; it never executes the Session again.</span></p><div className="replay-layout"><section className="replay-stage"><article className={`replay-event-card ${event.type}`}><header><div><small>{event.label ?? event.type}</small><h3>{event.title ?? `Event ${index + 1}`}</h3></div><div className="replay-event-badges"><span className="replay-excerpt">{event.timeBasis ?? "sequence"}</span></div></header><div className="replay-event-meta"><code>{formatStamp(event.atMs)}</code><span>Turn {event.turnIndex ?? "—"}</span><span>{index + 1} / {events.length}</span></div><div className="replay-event-body"><p>{event.body ?? "No privacy-safe body retained."}</p></div>{event.files?.length ? <div className="replay-stage-files"><strong>Files</strong>{event.files.map((file) => <button type="button" key={file}><code>{file}</code></button>)}</div> : null}</article></section><aside className="replay-index"><div className="replay-index-tabs"><button type="button" aria-selected="true">Events <span>{events.length}</span></button><button type="button" aria-selected="false">Files <span>{session.files?.length ?? 0}</span></button></div><div className="replay-index-body"><div className="replay-event-list">{events.map((candidate, candidateIndex) => <button type="button" className={candidateIndex === index ? "replay-current" : undefined} key={candidate.id} onClick={() => setIndex(candidateIndex)}><span className="replay-event-order">{candidateIndex + 1}</span><span className="replay-event-copy"><strong>{candidate.title ?? candidate.label ?? candidate.type}</strong><small>{candidate.body ?? "No body retained"}</small></span><span className="replay-event-kind">{candidate.type}</span></button>)}</div></div></aside></div><nav className="react-replay-controls"><button type="button" disabled={index === 0} onClick={() => setIndex((value) => Math.max(0, value - 1))}>Previous</button><strong>Event {index + 1} of {events.length}</strong><button type="button" disabled={index === events.length - 1} onClick={() => setIndex((value) => Math.min(events.length - 1, value + 1))}>Next</button></nav></main>;
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

function toggle(values: Set<string>, value: string): Set<string> { const next = new Set(values); if (next.has(value)) next.delete(value); else next.add(value); return next; }
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
  :host,.native-inspector-root{display:block;width:100%;height:100%;min-height:0}.date-session-row{text-decoration:none}.react-action-list{display:grid;max-height:280px;overflow:auto;border-top:1px solid var(--color-border)}.react-action-list .session-tool-row{grid-template-columns:52px minmax(100px,1fr) 74px}.workbench-unevidenced .workbench-head{border-bottom:0}.workbench-unevidenced-note{margin:0;padding:0 12px 10px 12px;color:var(--color-text-muted);font-size:12px;line-height:16px}.react-diagnostics{margin:10px 12px 0;border:1px solid var(--color-border);border-radius:var(--radius-lg);color:var(--color-text-muted);background:var(--color-surface-subtle);font-size:12px}.react-diagnostics summary{padding:7px 9px;cursor:pointer;font-weight:700}.react-diagnostics ul{margin:0;padding:0 26px 9px}.react-replay-controls{position:sticky;bottom:0;margin-top:14px;padding:10px 12px;display:flex;align-items:center;justify-content:center;gap:12px;border:1px solid var(--color-border);border-radius:var(--radius-lg);background:var(--color-surface);box-shadow:var(--shadow-popover)}.react-replay-controls button{min-height:30px;border:1px solid var(--color-border);border-radius:var(--radius-lg);padding:4px 9px;color:var(--color-text);background:var(--color-surface);cursor:pointer}.react-replay-controls button:disabled{opacity:.45;cursor:not-allowed}.react-replay-controls strong{font-size:12px}
`;
