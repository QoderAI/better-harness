import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
} from "../contracts/git-history.js";
import { ArtifactCodeView } from "./code/ArtifactCodeView.js";
import { studioLocale } from "./i18n/index.js";

const PAGE_SIZE = 40;
const GIT_LANE_COLOR_TOKENS = [5, 4, 2, 1, 6, 7, 3] as const;
type NarrowPane = "refs" | "history" | "detail";

export function GitHistoryView(): React.JSX.Element {
  const { t } = useTranslation("git");
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
        if (!response.ok) throw new Error(apiError(payload, t("errors.refsUnavailable")));
        if (!isGitRefsSnapshot(payload)) throw new Error("Git refs use an unsupported contract.");
        if (!cancelled) {
          const available = new Set([payload.head?.id, ...payload.local.map((ref) => ref.id), ...payload.remote.map((ref) => ref.id), ...payload.tags.map((ref) => ref.id)].filter((id): id is string => id !== undefined));
          setRefs(payload);
          setSelectedRefs((current) => current.filter((id) => available.has(id)));
          setRefsRevision(revision);
        }
      } catch (error) {
        if (!cancelled) setRefsFailure(errorMessage(error, t));
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
      if (!response.ok) throw new Error(apiError(payload, t("errors.historyUnavailable")));
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
        append ? setLoadMoreFailure(errorMessage(error, t)) : setFailure(errorMessage(error, t));
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
      if (!response.ok) throw new Error(apiError(payload, t("errors.commitUnavailable")));
      if (!isGitCommitDetail(payload)) throw new Error("Commit detail uses an unsupported contract.");
      if (requestId === detailRequest.current) setDetail(payload);
    } catch (error) {
      if (requestId === detailRequest.current) setDetailFailure(errorMessage(error, t));
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
      if (!response.ok) throw new Error(apiError(payload, t("errors.patchUnavailable")));
      if (!isGitFilePatch(payload)) throw new Error("File patch uses an unsupported contract.");
      if (requestId === patchRequest.current) setPatch(payload);
    } catch (error) {
      if (requestId === patchRequest.current) setDetailFailure(errorMessage(error, t));
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
      <div><GitCommit aria-hidden="true" size={18} weight="fill" /><span><strong>{t("titlebar.title")}</strong><small>{t("titlebar.evidence")}</small></span></div>
      {refs !== undefined && <span className="git-current-branch"><GitBranch aria-hidden="true" size={14} /><strong>{refs.repository.currentBranch ?? t("titlebar.detachedHead")}</strong><code>{refs.repository.headSha?.slice(0, 8) ?? t("titlebar.noCommits")}</code></span>}
      <button type="button" title={t("titlebar.refreshTitle")} aria-label={t("titlebar.refreshAria")} disabled={loading || refsLoading} onClick={() => setRevision((value) => value + 1)}><ArrowClockwise aria-hidden="true" size={15} className={loading || refsLoading ? "spin" : undefined} /></button>
    </header>
    <nav className="git-narrow-tabs" aria-label={t("panes.aria")}>
      {(["refs", "history", "detail"] as const).map((pane) => <button key={pane} type="button" aria-current={narrowPane === pane ? "page" : undefined} onClick={() => setNarrowPane(pane)}>{t(`panes.${pane}`)}</button>)}
    </nav>
    <aside className="git-refs-pane" aria-label={t("refs.aria")}>
      <PaneHeader title={t("refs.title")} trailing={selectedRefs.length === 0 ? t("refs.all") : t("refs.selected", { count: selectedRefs.length })} />
      <div className="git-refs-scroll">
        {refsFailure !== undefined
          ? <ErrorState message={refsFailure} />
          : refs === undefined
          ? <LoadingState label={t("refs.loading")} />
          : <RefsTree refs={refs} selected={selectedRefs} onToggle={toggleRef} />}
      </div>
    </aside>
    <section className="git-log-pane" aria-label={t("log.aria")}>
      <div className="git-log-toolbar">
        <label><MagnifyingGlass aria-hidden="true" size={14} /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder={t("log.filterPlaceholder")} aria-label={t("log.filterAria")} />{searchInput !== "" && <button type="button" aria-label={t("log.clearFilterAria")} title={t("log.clearFilterTitle")} onClick={() => setSearchInput("")}><X aria-hidden="true" size={13} /></button>}</label>
        {selectedRefs.length > 0 && <button type="button" className="git-clear-filter" onClick={() => setSelectedRefs([])}>{t("log.clearRefs")}</button>}
        <span>{t("log.count", { count: total })}</span>
      </div>
      <div className="git-log-status">
        {searchTruncated && <p className="git-search-limit" role="status">{t("log.searchLimited")}</p>}
        {historyTruncated && <p className="git-search-limit" role="status">{t("log.historyLimited", { total })}</p>}
        {loadMoreFailure !== undefined && <p className="git-page-error" role="alert">{loadMoreFailure} {t("log.pageErrorSuffix")}</p>}
      </div>
      {failure !== undefined
        ? <ErrorState message={failure} />
        : loading && commits.length === 0
          ? <LoadingState label={t("log.loading")} />
          : commits.length === 0
            ? <EmptyState search={search} />
            : <CommitTable key={logQueryKey} commits={commits} hasMore={canLoadMore} loadingMore={loadingMore} loadMoreFailed={loadMoreFailure !== undefined} selectedSha={selectedSha} onLoadMore={loadNextPage} onSelect={(sha) => void selectCommit(sha)} />}
      <footer className="git-page-progress">{canLoadMore && (loadingMore
        ? <span role="status"><SpinnerGap aria-hidden="true" className="spin" size={14} />{t("log.loadingMore")}</span>
        : loadMoreFailure !== undefined
          ? <button type="button" onClick={loadNextPage}>{t("log.retry")}</button>
          : <span>{t("log.progress", { loaded: commits.length, total: Math.min(total, 5_000) })}</span>)}
      </footer>
    </section>
    <section className="git-detail-pane" aria-label={t("detail.aria")}>
      <PaneHeader title={t("detail.title")} trailing={activeCommit?.shortSha} />
      {detailLoading
        ? <LoadingState label={t("detail.loadingCommit")} />
        : detailFailure !== undefined && detail === undefined
          ? <ErrorState message={detailFailure} />
          : detail === undefined
            ? <div className="git-detail-empty"><GitCommit aria-hidden="true" size={24} /><p>{t("detail.selectHint")}</p></div>
            : <CommitDetail detail={detail} selectedFile={selectedFile} patch={patch} patchLoading={patchLoading} failure={detailFailure} onSelectFile={(file) => void selectFile(file)} />}
    </section>
  </main>;
}

function PaneHeader(props: { title: string; trailing?: string }): React.JSX.Element {
  return <header className="git-pane-header"><strong>{props.title}</strong>{props.trailing !== undefined && <span>{props.trailing}</span>}</header>;
}

function RefsTree(props: { refs: GitRefsSnapshot; selected: string[]; onToggle: (id: string) => void }): React.JSX.Element {
  const { t } = useTranslation("git");
  const remotes = groupRemotes(props.refs.remote);
  return <>
    {props.refs.head !== null && <RefGroup label={t("refs.head")} icon={<MapPin aria-hidden="true" size={13} weight="fill" />} count={1} defaultOpen><RefRow gitRef={props.refs.head} selected={props.selected.includes(props.refs.head.id)} onToggle={props.onToggle} /></RefGroup>}
    <RefGroup label={t("refs.localBranches")} icon={<GitBranch aria-hidden="true" size={13} />} count={props.refs.local.length} defaultOpen>{props.refs.local.map((ref) => <RefRow key={ref.id} gitRef={ref} selected={props.selected.includes(ref.id)} onToggle={props.onToggle} />)}</RefGroup>
    <RefGroup label={t("refs.remoteBranches")} icon={<Globe aria-hidden="true" size={13} />} count={props.refs.remote.length}>{[...remotes.entries()].map(([remote, refs]) => <RefGroup key={remote} label={remote} icon={<Globe aria-hidden="true" size={12} />} count={refs.length}>{refs.map((ref) => <RefRow key={ref.id} gitRef={ref} selected={props.selected.includes(ref.id)} onToggle={props.onToggle} />)}</RefGroup>)}</RefGroup>
    {props.refs.tags.length > 0 && <RefGroup label={t("refs.tags")} icon={<Tag aria-hidden="true" size={13} />} count={props.refs.tags.length}>{props.refs.tags.map((ref) => <RefRow key={ref.id} gitRef={ref} selected={props.selected.includes(ref.id)} onToggle={props.onToggle} />)}</RefGroup>}
  </>;
}

function RefGroup(props: { label: string; icon: React.ReactNode; count: number; defaultOpen?: boolean; children: React.ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  return <section className="git-ref-group"><button className="git-ref-group-toggle" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? <CaretDown aria-hidden="true" size={12} /> : <CaretRight aria-hidden="true" size={12} />}{props.icon}<strong>{props.label}</strong><span>{props.count}</span></button>{open && <div>{props.children}</div>}</section>;
}

function RefRow(props: { gitRef: GitHistoryRef; selected: boolean; onToggle: (id: string) => void }): React.JSX.Element {
  const { t } = useTranslation("git");
  const label = props.gitRef.remote === undefined ? props.gitRef.name : props.gitRef.name;
  return <button className="git-ref-row" type="button" aria-pressed={props.selected} title={props.gitRef.id} onClick={() => props.onToggle(props.gitRef.id)}>{props.gitRef.isCurrent && <MapPin aria-label={t("refs.currentBranch")} size={11} weight="fill" />}<span>{label}</span><code>{props.gitRef.commitSha.slice(0, 7)}</code></button>;
}

function CommitTable(props: { commits: GitHistoryCommit[]; hasMore: boolean; loadingMore: boolean; loadMoreFailed: boolean; selectedSha?: string; onLoadMore: () => void; onSelect: (sha: string) => void }): React.JSX.Element {
  const { t } = useTranslation("git");
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
  return <div ref={scrollRef} className="git-commit-table" role="table" aria-label={t("table.aria")} aria-rowcount={commits.length + 1}>
    <div className="git-commit-table-head" role="row"><span style={{ width: laneCount * 16 + 8 }} /><strong>{t("table.message")}</strong><strong>{t("table.author")}</strong><strong>{t("table.date")}</strong><strong>{t("table.hash")}</strong></div>
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
        <time role="cell" dateTime={commit.authoredAt} title={new Date(commit.authoredAt).toLocaleString(studioLocale())}>{relativeTime(commit.authoredAt)}</time>
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
  const { t } = useTranslation("git");
  const { commit, files } = props.detail;
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  return <div className="git-detail-grid">
    <header className="git-commit-detail-header"><div><strong>{commit.summary}</strong>{commit.message !== commit.summary && <p>{commit.message.slice(commit.summary.length).trim()}</p>}</div><dl>
      <div><dt><Hash aria-hidden="true" size={12} />{t("detail.commit")}</dt><dd><code>{commit.sha}</code></dd></div>
      <div><dt><User aria-hidden="true" size={12} />{t("detail.author")}</dt><dd>{commit.authorName} <span>&lt;{commit.authorEmail}&gt;</span></dd></div>
      <div><dt><Clock aria-hidden="true" size={12} />{t("detail.authored")}</dt><dd><time dateTime={commit.authoredAt}>{new Date(commit.authoredAt).toLocaleString(studioLocale())}</time></dd></div>
      {commit.parents.length > 0 && <div><dt><GitCommit aria-hidden="true" size={12} />{t("detail.parents")}</dt><dd>{commit.parents.map((parent) => <code key={parent}>{parent.slice(0, 8)}</code>)}</dd></div>}
    </dl></header>
    <aside className="git-changed-files"><header><strong>{t("detail.changedFiles")}</strong><span>{files.length} · <i>+{additions}</i> / <em>−{deletions}</em></span></header><div>{files.map((file) => <button key={`${file.previousPath ?? ""}:${file.path}`} type="button" aria-pressed={props.selectedFile === file.path} onClick={() => props.onSelectFile(file)}><b data-status={file.status}>{fileStatusLetter(file.status)}</b><span><strong>{file.path.split("/").at(-1)}</strong><small>{file.path}</small>{file.previousPath !== undefined && <small>{t("detail.from", { path: file.previousPath })}</small>}</span><code>{file.binary ? "binary" : `+${file.additions} / −${file.deletions}`}</code></button>)}</div></aside>
    <section className="git-file-diff" aria-label={t("detail.patchAria")}>
      {props.patchLoading
        ? <LoadingState label={t("detail.loadingPatch")} />
        : props.failure !== undefined
          ? <ErrorState message={props.failure} />
          : props.patch === undefined
            ? <div className="git-diff-empty"><FileCode aria-hidden="true" size={22} /><p>{t("detail.selectFileHint")}</p></div>
            : props.patch.binary || props.patch.patch.trim() === ""
              ? <div className="git-diff-empty"><FileCode aria-hidden="true" size={22} /><p>{props.patch.binary ? t("detail.binaryPatch") : t("detail.noTextPatch")}</p></div>
              : <ArtifactCodeView mode="diff" patch={props.patch.patch} label={t("detail.patchLabel", { path: props.patch.path })} />}
    </section>
  </div>;
}

function LoadingState(props: { label: string }): React.JSX.Element { return <div className="git-loading" role="status"><SpinnerGap aria-hidden="true" size={16} className="spin" /><span>{props.label}</span></div>; }
function ErrorState(props: { message: string }): React.JSX.Element { return <p className="git-error" role="alert">{props.message}</p>; }
function EmptyState(props: { search: string }): React.JSX.Element {
  const { t } = useTranslation("git");
  return <div className="git-empty"><GitCommit aria-hidden="true" size={24} /><strong>{props.search === "" ? t("log.emptyTitle") : t("log.emptyTitleSearch")}</strong><p>{props.search === "" ? t("log.emptyDetail") : t("log.emptyDetailSearch")}</p></div>;
}

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

function errorMessage(error: unknown, t: (key: string) => string): string { return error instanceof Error ? error.message : t("errors.historyUnavailable"); }
