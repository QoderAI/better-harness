import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { CaretRight } from "@phosphor-icons/react/CaretRight";
import { Clock } from "@phosphor-icons/react/Clock";
import { FileCode } from "@phosphor-icons/react/FileCode";
import { GitBranch } from "@phosphor-icons/react/GitBranch";
import { GitCommit } from "@phosphor-icons/react/GitCommit";
import { Globe } from "@phosphor-icons/react/Globe";
import { Hash } from "@phosphor-icons/react/Hash";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { MapPin } from "@phosphor-icons/react/MapPin";
import { SpinnerGap } from "@phosphor-icons/react/SpinnerGap";
import { Tag } from "@phosphor-icons/react/Tag";
import { User } from "@phosphor-icons/react/User";
import { X } from "@phosphor-icons/react/X";
import {
  isGitCommitDetail,
  isGitFilePatch,
  isGitLogPage,
  isGitRefsSnapshot,
  type GitCommitDetail,
  type GitCommitFileChange,
  type GitFilePatch,
  type GitHistoryCommit,
  type GitHistoryRef,
  type GitLogPage,
  type GitRefsSnapshot,
} from "../git-history-model.js";
import { ArtifactCodeView } from "./ArtifactCodeView.js";

const PAGE_SIZE = 40;
const GIT_LANE_COLOR_TOKENS = [5, 4, 2, 1, 6, 7, 3] as const;
type NarrowPane = "refs" | "history" | "detail";

export function GitHistoryView(): React.JSX.Element {
  const [refs, setRefs] = useState<GitRefsSnapshot>();
  const [commits, setCommits] = useState<GitHistoryCommit[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string>();
  const [searchTruncated, setSearchTruncated] = useState(false);
  const [historyTruncated, setHistoryTruncated] = useState(false);
  const [selectedRefs, setSelectedRefs] = useState<string[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selectedSha, setSelectedSha] = useState<string>();
  const [detail, setDetail] = useState<GitCommitDetail>();
  const [selectedFile, setSelectedFile] = useState<string>();
  const [patch, setPatch] = useState<GitFilePatch>();
  const [loading, setLoading] = useState(true);
  const [refsLoading, setRefsLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [patchLoading, setPatchLoading] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [refsFailure, setRefsFailure] = useState<string>();
  const [loadMoreFailure, setLoadMoreFailure] = useState<string>();
  const [detailFailure, setDetailFailure] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [refsRevision, setRefsRevision] = useState(-1);
  const [loadedLogKey, setLoadedLogKey] = useState<string>();
  const [narrowPane, setNarrowPane] = useState<NarrowPane>("history");
  const logRequest = useRef(0);
  const pageLoadRequest = useRef(false);
  const detailRequest = useRef(0);
  const patchRequest = useRef(0);

  useEffect(() => {
    const timer = globalThis.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => globalThis.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    setRefsFailure(undefined);
    setRefsLoading(true);
    void (async () => {
      try {
        const response = await fetch("/api/git/refs", { cache: "no-store" });
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error(apiError(payload, "Git refs are unavailable."));
        if (!isGitRefsSnapshot(payload)) throw new Error("Git refs use an unsupported contract.");
        if (!cancelled) {
          const available = new Set([payload.head?.id, ...payload.local.map((ref) => ref.id), ...payload.remote.map((ref) => ref.id), ...payload.tags.map((ref) => ref.id)].filter((id): id is string => id !== undefined));
          setRefs(payload);
          setSelectedRefs((current) => current.filter((id) => available.has(id)));
          setRefsRevision(revision);
        }
      } catch (error) {
        if (!cancelled) setRefsFailure(errorMessage(error));
      } finally {
        if (!cancelled) setRefsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [revision]);

  const logQueryKey = `${revision}\0${selectedRefs.join("\0")}\0${search}`;
  const loadLog = useCallback(async (append: boolean): Promise<void> => {
    if (append && (nextCursor === undefined || pageLoadRequest.current)) return;
    pageLoadRequest.current = append;
    const requestId = ++logRequest.current;
    append ? setLoadingMore(true) : setLoading(true);
    append ? setLoadMoreFailure(undefined) : setFailure(undefined);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (append && nextCursor !== undefined) params.set("cursor", nextCursor);
      if (search !== "") params.set("search", search);
      selectedRefs.forEach((ref) => params.append("ref", ref));
      const response = await fetch(`/api/git/log?${params}`, { cache: "no-store" });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(apiError(payload, "Git history is unavailable."));
      if (!isGitLogPage(payload)) throw new Error("Git history uses an unsupported contract.");
      if (requestId !== logRequest.current) return;
      setCommits((current) => append ? appendUnique(current, payload) : payload.commits);
      setTotal(payload.total);
      setHasMore(payload.hasMore);
      setNextCursor(payload.nextCursor);
      setSearchTruncated(payload.searchTruncated);
      setHistoryTruncated(payload.historyTruncated);
      if (!append) {
        setLoadedLogKey(logQueryKey);
        setSelectedSha(undefined);
        setDetail(undefined);
        setSelectedFile(undefined);
        setPatch(undefined);
        setNarrowPane("history");
      }
    } catch (error) {
      if (requestId === logRequest.current) {
        append ? setLoadMoreFailure(errorMessage(error)) : setFailure(errorMessage(error));
      }
    } finally {
      if (requestId === logRequest.current) {
        setLoading(false);
        setLoadingMore(false);
        pageLoadRequest.current = false;
      }
    }
  }, [logQueryKey, nextCursor, search, selectedRefs]);

  useEffect(() => {
    if (refsRevision === revision) void loadLog(false);
  }, [search, selectedRefs, revision, refsRevision]); // eslint-disable-line react-hooks/exhaustive-deps

  async function selectCommit(sha: string): Promise<void> {
    const requestId = ++detailRequest.current;
    setSelectedSha(sha);
    setDetail(undefined);
    setSelectedFile(undefined);
    setPatch(undefined);
    setDetailFailure(undefined);
    setDetailLoading(true);
    setNarrowPane("detail");
    try {
      const response = await fetch(`/api/git/commits/${sha}`, { cache: "no-store" });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(apiError(payload, "Commit detail is unavailable."));
      if (!isGitCommitDetail(payload)) throw new Error("Commit detail uses an unsupported contract.");
      if (requestId === detailRequest.current) setDetail(payload);
    } catch (error) {
      if (requestId === detailRequest.current) setDetailFailure(errorMessage(error));
    } finally {
      if (requestId === detailRequest.current) setDetailLoading(false);
    }
  }

  async function selectFile(file: GitCommitFileChange): Promise<void> {
    if (selectedSha === undefined) return;
    const requestId = ++patchRequest.current;
    setSelectedFile(file.path);
    setPatch(undefined);
    setDetailFailure(undefined);
    setPatchLoading(true);
    try {
      const params = new URLSearchParams({ path: file.path });
      const response = await fetch(`/api/git/commits/${selectedSha}/patch?${params}`, { cache: "no-store" });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(apiError(payload, "File patch is unavailable."));
      if (!isGitFilePatch(payload)) throw new Error("File patch uses an unsupported contract.");
      if (requestId === patchRequest.current) setPatch(payload);
    } catch (error) {
      if (requestId === patchRequest.current) setDetailFailure(errorMessage(error));
    } finally {
      if (requestId === patchRequest.current) setPatchLoading(false);
    }
  }

  function toggleRef(id: string): void {
    setSelectedRefs((current) => current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]);
  }

  const activeCommit = useMemo(() => commits.find((commit) => commit.sha === selectedSha), [commits, selectedSha]);
  const loadNextPage = useCallback(() => { void loadLog(true); }, [loadLog]);
  const canLoadMore = hasMore && !loading && loadedLogKey === logQueryKey;
  return <main className="git-history-workbench" data-narrow-pane={narrowPane}>
    <header className="git-history-titlebar">
      <div><GitCommit aria-hidden="true" size={18} weight="fill" /><span><strong>Commit history</strong><small>{refs?.repository.label ?? "Open workspace"}</small></span></div>
      {refs !== undefined && <span className="git-current-branch"><GitBranch aria-hidden="true" size={14} /><strong>{refs.repository.currentBranch ?? "Detached HEAD"}</strong><code>{refs.repository.headSha?.slice(0, 8) ?? "no commits"}</code></span>}
      <button type="button" title="Refresh Git history" aria-label="Refresh Git history" disabled={loading || refsLoading} onClick={() => setRevision((value) => value + 1)}><ArrowClockwise aria-hidden="true" size={15} className={loading || refsLoading ? "spin" : undefined} /></button>
    </header>
    <nav className="git-narrow-tabs" aria-label="Commit workbench panes">
      {(["refs", "history", "detail"] as const).map((pane) => <button key={pane} type="button" aria-current={narrowPane === pane ? "page" : undefined} onClick={() => setNarrowPane(pane)}>{pane === "refs" ? "Refs" : pane === "history" ? "History" : "Details"}</button>)}
    </nav>
    <aside className="git-refs-pane" aria-label="Repository refs">
      <PaneHeader title="Refs" trailing={selectedRefs.length === 0 ? "All" : `${selectedRefs.length} selected`} />
      <div className="git-refs-scroll">
        {refsFailure !== undefined
          ? <ErrorState message={refsFailure} />
          : refs === undefined
          ? <LoadingState label="Loading refs…" />
          : <RefsTree refs={refs} selected={selectedRefs} onToggle={toggleRef} />}
      </div>
    </aside>
    <section className="git-log-pane" aria-label="Commit history">
      <div className="git-log-toolbar">
        <label><MagnifyingGlass aria-hidden="true" size={14} /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Filter subject, hash, or author" aria-label="Filter commit history" />{searchInput !== "" && <button type="button" aria-label="Clear commit filter" title="Clear commit filter" onClick={() => setSearchInput("")}><X aria-hidden="true" size={13} /></button>}</label>
        {selectedRefs.length > 0 && <button type="button" className="git-clear-filter" onClick={() => setSelectedRefs([])}>Clear refs</button>}
        <span>{total} commit{total === 1 ? "" : "s"}</span>
      </div>
      <div className="git-log-status">
        {searchTruncated && <p className="git-search-limit" role="status">Search is limited to the newest 2,000 commits in the selected refs.</p>}
        {historyTruncated && <p className="git-search-limit" role="status">History is limited to the newest 5,000 of {total} reachable commits. Refine refs or search to inspect older history.</p>}
        {loadMoreFailure !== undefined && <p className="git-page-error" role="alert">{loadMoreFailure} Previously loaded commits remain available.</p>}
      </div>
      {failure !== undefined
        ? <ErrorState message={failure} />
        : loading && commits.length === 0
          ? <LoadingState label="Loading commits…" />
          : commits.length === 0
            ? <EmptyState search={search} />
            : <CommitTable key={logQueryKey} commits={commits} hasMore={canLoadMore} loadingMore={loadingMore} loadMoreFailed={loadMoreFailure !== undefined} selectedSha={selectedSha} onLoadMore={loadNextPage} onSelect={(sha) => void selectCommit(sha)} />}
      <footer className="git-page-progress">{canLoadMore && (loadingMore
        ? <span role="status"><SpinnerGap aria-hidden="true" className="spin" size={14} />Loading more commits…</span>
        : loadMoreFailure !== undefined
          ? <button type="button" onClick={loadNextPage}>Retry loading history</button>
          : <span>{commits.length} of {Math.min(total, 5_000)} · More loads automatically</span>)}
      </footer>
    </section>
    <section className="git-detail-pane" aria-label="Commit detail">
      <PaneHeader title="Commit details" trailing={activeCommit?.shortSha} />
      {detailLoading
        ? <LoadingState label="Loading commit…" />
        : detailFailure !== undefined && detail === undefined
          ? <ErrorState message={detailFailure} />
          : detail === undefined
            ? <div className="git-detail-empty"><GitCommit aria-hidden="true" size={24} /><p>Select a commit to inspect its message, changed files, and patch.</p></div>
            : <CommitDetail detail={detail} selectedFile={selectedFile} patch={patch} patchLoading={patchLoading} failure={detailFailure} onSelectFile={(file) => void selectFile(file)} />}
    </section>
  </main>;
}

function PaneHeader(props: { title: string; trailing?: string }): React.JSX.Element {
  return <header className="git-pane-header"><strong>{props.title}</strong>{props.trailing !== undefined && <span>{props.trailing}</span>}</header>;
}

function RefsTree(props: { refs: GitRefsSnapshot; selected: string[]; onToggle: (id: string) => void }): React.JSX.Element {
  const remotes = groupRemotes(props.refs.remote);
  return <>
    {props.refs.head !== null && <RefGroup label="HEAD" icon={<MapPin aria-hidden="true" size={13} weight="fill" />} count={1} defaultOpen><RefRow gitRef={props.refs.head} selected={props.selected.includes(props.refs.head.id)} onToggle={props.onToggle} /></RefGroup>}
    <RefGroup label="Local branches" icon={<GitBranch aria-hidden="true" size={13} />} count={props.refs.local.length} defaultOpen>{props.refs.local.map((ref) => <RefRow key={ref.id} gitRef={ref} selected={props.selected.includes(ref.id)} onToggle={props.onToggle} />)}</RefGroup>
    <RefGroup label="Remote branches" icon={<Globe aria-hidden="true" size={13} />} count={props.refs.remote.length}>{[...remotes.entries()].map(([remote, refs]) => <RefGroup key={remote} label={remote} icon={<Globe aria-hidden="true" size={12} />} count={refs.length}>{refs.map((ref) => <RefRow key={ref.id} gitRef={ref} selected={props.selected.includes(ref.id)} onToggle={props.onToggle} />)}</RefGroup>)}</RefGroup>
    {props.refs.tags.length > 0 && <RefGroup label="Tags" icon={<Tag aria-hidden="true" size={13} />} count={props.refs.tags.length}>{props.refs.tags.map((ref) => <RefRow key={ref.id} gitRef={ref} selected={props.selected.includes(ref.id)} onToggle={props.onToggle} />)}</RefGroup>}
  </>;
}

function RefGroup(props: { label: string; icon: React.ReactNode; count: number; defaultOpen?: boolean; children: React.ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  return <section className="git-ref-group"><button className="git-ref-group-toggle" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? <CaretDown aria-hidden="true" size={12} /> : <CaretRight aria-hidden="true" size={12} />}{props.icon}<strong>{props.label}</strong><span>{props.count}</span></button>{open && <div>{props.children}</div>}</section>;
}

function RefRow(props: { gitRef: GitHistoryRef; selected: boolean; onToggle: (id: string) => void }): React.JSX.Element {
  const label = props.gitRef.remote === undefined ? props.gitRef.name : props.gitRef.name;
  return <button className="git-ref-row" type="button" aria-pressed={props.selected} title={props.gitRef.id} onClick={() => props.onToggle(props.gitRef.id)}>{props.gitRef.isCurrent && <MapPin aria-label="Current branch" size={11} weight="fill" />}<span>{label}</span><code>{props.gitRef.commitSha.slice(0, 7)}</code></button>;
}

function CommitTable(props: { commits: GitHistoryCommit[]; hasMore: boolean; loadingMore: boolean; loadMoreFailed: boolean; selectedSha?: string; onLoadMore: () => void; onSelect: (sha: string) => void }): React.JSX.Element {
  const { commits, hasMore, loadingMore, loadMoreFailed, onLoadMore } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const laneCount = Math.max(2, ...commits.flatMap((commit) => [commit.lane + 1, ...commit.activeLanes.map((lane) => lane + 1), ...commit.graphEdges.map((edge) => Math.max(edge.fromLane, edge.toLane) + 1)]));
  const rows = useVirtualizer({
    count: commits.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 32,
    overscan: 10,
    getItemKey: (index) => commits[index]!.sha,
  });
  rows.shouldAdjustScrollPositionOnItemSizeChange = () => false;
  useEffect(() => {
    const root = scrollRef.current;
    const target = loadMoreRef.current;
    if (root === null || target === null || !hasMore || loadingMore || loadMoreFailed) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
    }, { root, rootMargin: "0px 0px 160px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [commits.length, hasMore, loadMoreFailed, loadingMore, onLoadMore]);
  return <div ref={scrollRef} className="git-commit-table" role="table" aria-label="Commits" aria-rowcount={commits.length + 1}>
    <div className="git-commit-table-head" role="row"><span style={{ width: laneCount * 16 + 8 }} /><strong>Message</strong><strong>Author</strong><strong>Date</strong><strong>Hash</strong></div>
    <div className="git-commit-rows" role="rowgroup" style={{ height: rows.getTotalSize() }}>{rows.getVirtualItems().map((virtualRow) => {
      const commit = commits[virtualRow.index]!;
      return <button
        key={commit.sha}
        ref={rows.measureElement}
        data-index={virtualRow.index}
        style={{ transform: `translateY(${virtualRow.start}px)` }}
        type="button"
        role="row"
        aria-rowindex={virtualRow.index + 2}
        aria-selected={props.selectedSha === commit.sha}
        onClick={() => props.onSelect(commit.sha)}
      >
        <CommitGraph commit={commit} laneCount={laneCount} />
        <span className="git-commit-subject" role="cell"><span>{commit.refs.map((ref) => <i key={ref.id} data-kind={ref.kind}>{ref.kind === "tag" ? <Tag aria-hidden="true" size={10} /> : <GitBranch aria-hidden="true" size={10} />}{ref.remote === undefined ? ref.name : `${ref.remote}/${ref.name}`}</i>)}</span><strong title={commit.summary}>{commit.summary}</strong></span>
        <span className="git-commit-author" role="cell" title={commit.authorEmail}>{commit.authorName}</span>
        <time role="cell" dateTime={commit.authoredAt} title={new Date(commit.authoredAt).toLocaleString()}>{relativeTime(commit.authoredAt)}</time>
        <code role="cell">{commit.shortSha}</code>
      </button>;
    })}</div>
    <div ref={loadMoreRef} className="git-auto-load-sentinel" aria-hidden="true" />
  </div>;
}

function CommitGraph(props: { commit: GitHistoryCommit; laneCount: number }): React.JSX.Element {
  const laneWidth = 16;
  const height = 32;
  const center = (lane: number): number => lane * laneWidth + 8;
  const color = (lane: number): string => `var(--color-categorical-${GIT_LANE_COLOR_TOKENS[lane % GIT_LANE_COLOR_TOKENS.length]})`;
  return <svg className="git-commit-graph" width={props.laneCount * laneWidth + 8} height={height} aria-hidden="true">
    {props.commit.activeLanes.map((lane) => <line key={`active-${lane}`} x1={center(lane)} y1="0" x2={center(lane)} y2={lane === props.commit.lane ? height / 2 : height} stroke={color(lane)} strokeWidth="1.5" strokeLinecap="round" opacity=".82" />)}
    {props.commit.graphEdges.map((edge, index) => edge.fromLane === edge.toLane
      ? <line key={index} x1={center(edge.fromLane)} y1={height / 2} x2={center(edge.toLane)} y2={height} stroke={color(edge.toLane)} strokeWidth="1.5" strokeLinecap="round" opacity=".82" />
      : <path key={index} d={`M ${center(edge.fromLane)} ${height / 2} C ${center(edge.fromLane)} ${height * .7}, ${center(edge.toLane)} ${height * .72}, ${center(edge.toLane)} ${height}`} fill="none" stroke={color(edge.toLane)} strokeWidth="1.5" strokeLinecap="round" opacity=".82" />)}
    {props.commit.parents.length > 1 && <circle className="git-commit-merge-ring" cx={center(props.commit.lane)} cy={height / 2} r="5.75" fill="none" stroke={color(props.commit.lane)} strokeWidth="1.25" opacity=".9" />}
    <circle className="git-commit-node" cx={center(props.commit.lane)} cy={height / 2} r="3.5" fill={color(props.commit.lane)} stroke="var(--git-graph-node-ring)" strokeWidth="1.5" />
  </svg>;
}

function CommitDetail(props: { detail: GitCommitDetail; selectedFile?: string; patch?: GitFilePatch; patchLoading: boolean; failure?: string; onSelectFile: (file: GitCommitFileChange) => void }): React.JSX.Element {
  const { commit, files } = props.detail;
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  return <div className="git-detail-grid">
    <header className="git-commit-detail-header"><div><strong>{commit.summary}</strong>{commit.message !== commit.summary && <p>{commit.message.slice(commit.summary.length).trim()}</p>}</div><dl>
      <div><dt><Hash aria-hidden="true" size={12} />Commit</dt><dd><code>{commit.sha}</code></dd></div>
      <div><dt><User aria-hidden="true" size={12} />Author</dt><dd>{commit.authorName} <span>&lt;{commit.authorEmail}&gt;</span></dd></div>
      <div><dt><Clock aria-hidden="true" size={12} />Authored</dt><dd><time dateTime={commit.authoredAt}>{new Date(commit.authoredAt).toLocaleString()}</time></dd></div>
      {commit.parents.length > 0 && <div><dt><GitCommit aria-hidden="true" size={12} />Parents</dt><dd>{commit.parents.map((parent) => <code key={parent}>{parent.slice(0, 8)}</code>)}</dd></div>}
    </dl></header>
    <aside className="git-changed-files"><header><strong>Changed files</strong><span>{files.length} · <i>+{additions}</i> / <em>−{deletions}</em></span></header><div>{files.map((file) => <button key={`${file.previousPath ?? ""}:${file.path}`} type="button" aria-pressed={props.selectedFile === file.path} onClick={() => props.onSelectFile(file)}><b data-status={file.status}>{fileStatusLetter(file.status)}</b><span><strong>{file.path.split("/").at(-1)}</strong><small>{file.path}</small>{file.previousPath !== undefined && <small>from {file.previousPath}</small>}</span><code>{file.binary ? "binary" : `+${file.additions} / −${file.deletions}`}</code></button>)}</div></aside>
    <section className="git-file-diff" aria-label="Selected file patch">
      {props.patchLoading
        ? <LoadingState label="Loading patch…" />
        : props.failure !== undefined
          ? <ErrorState message={props.failure} />
          : props.patch === undefined
            ? <div className="git-diff-empty"><FileCode aria-hidden="true" size={22} /><p>Select a changed file to inspect its commit patch.</p></div>
            : props.patch.binary || props.patch.patch.trim() === ""
              ? <div className="git-diff-empty"><FileCode aria-hidden="true" size={22} /><p>{props.patch.binary ? "Binary changes do not have a text patch." : "Git reported no text patch for this file."}</p></div>
              : <ArtifactCodeView mode="diff" patch={props.patch.patch} label={`Git patch: ${props.patch.path}`} />}
    </section>
  </div>;
}

function LoadingState(props: { label: string }): React.JSX.Element { return <div className="git-loading" role="status"><SpinnerGap aria-hidden="true" size={16} className="spin" /><span>{props.label}</span></div>; }
function ErrorState(props: { message: string }): React.JSX.Element { return <p className="git-error" role="alert">{props.message}</p>; }
function EmptyState(props: { search: string }): React.JSX.Element { return <div className="git-empty"><GitCommit aria-hidden="true" size={24} /><strong>{props.search === "" ? "No commits yet" : "No matching commits"}</strong><p>{props.search === "" ? "The selected refs do not contain a commit." : "Try a different message, hash, author, or ref filter."}</p></div>; }

function appendUnique(current: GitHistoryCommit[], page: GitLogPage): GitHistoryCommit[] {
  const known = new Set(current.map((commit) => commit.sha));
  return [...current, ...page.commits.filter((commit) => !known.has(commit.sha))];
}

function groupRemotes(refs: GitHistoryRef[]): Map<string, GitHistoryRef[]> {
  const groups = new Map<string, GitHistoryRef[]>();
  for (const ref of refs) groups.set(ref.remote ?? "remote", [...(groups.get(ref.remote ?? "remote") ?? []), ref]);
  return groups;
}

function relativeTime(value: string): string {
  const elapsed = Math.max(0, Date.now() - new Date(value).valueOf());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo` : `${Math.floor(months / 12)}y`;
}

function fileStatusLetter(status: GitCommitFileChange["status"]): string {
  if (status === "added") return "A";
  if (status === "deleted") return "D";
  if (status === "renamed") return "R";
  if (status === "copied") return "C";
  if (status === "type-changed") return "T";
  return "M";
}

function apiError(payload: unknown, fallback: string): string {
  return payload !== null && typeof payload === "object" && "error" in payload && typeof payload.error === "string" ? payload.error : fallback;
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : "Git history is unavailable."; }
