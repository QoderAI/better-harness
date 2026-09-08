import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { localDayKey, resolveDateRange, withinDateRange, type StudioDateRange } from "./date-range.js";
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
import { PaneSash } from "./shell/PaneSash.js";
import { ToolbarActions } from "./shell/ToolbarActions.js";

const PAGE_SIZE = 40;
const GIT_LANE_COLOR_TOKENS = [5, 4, 2, 1, 6, 7, 3] as const;
type NarrowPane = "refs" | "history" | "detail";

/** The width below which the panes stack behind tabs, matching the stylesheet. */
const NARROW_QUERY = "(max-width: 760px)";
/** The sash track's own thickness in the stylesheet's pane grids. */
const SASH_SIZE = 6;
/** Pane bounds, in px. The log keeps the majority of the height by default. */
const REFS_WIDTH: { default: number; min: number } = { default: 220, min: 160 };
const LOG_HEIGHT_RATIO = 0.58;
const LOG_MIN_HEIGHT = 180;
const DETAIL_MIN_HEIGHT = 200;
const LOG_MIN_WIDTH = 360;
/** The commit message opens as a caption over the file list, not as a band. */
const MESSAGE_HEIGHT: { default: number; min: number } = { default: 132, min: 64 };
const FILES_MIN_HEIGHT = 140;
/** The commit row's own height in the stylesheet, which the virtualizer mirrors. */
const COMMIT_ROW_HEIGHT = 32;
/**
 * How close to the end of the loaded rows a scroll must land to buy the next
 * page, and — below it — how much scroll range makes scrolling a usable request
 * for one at all. A list that cannot travel this far offers a control instead.
 */
const PREFETCH_MARGIN = 160;
/** Rows a `PageDown` or `PageUp` travels, matching the sidebar's coarse step. */
const KEYBOARD_PAGE_ROWS = 10;

export function GitHistoryView(props: { dateRange: StudioDateRange }): React.JSX.Element {
  const { t } = useTranslation("git");
  const [refs, setRefs] = useState<GitRefsSnapshot>();
  const [commits, setCommits] = useState<GitHistoryCommit[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string>();
  const [searchTruncated, setSearchTruncated] = useState(false);
  const [historyTruncated, setHistoryTruncated] = useState(false);
  const [selectedRef, setSelectedRef] = useState<string>();
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
  const [refsWidth, setRefsWidth] = useState(REFS_WIDTH.default);
  const [logHeight, setLogHeight] = useState<number>();
  const [logFixedHeight, setLogFixedHeight] = useState<number>();
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [stacked, setStacked] = useState(() => globalThis.matchMedia?.(NARROW_QUERY).matches === true);
  const workbench = useRef<HTMLElement>(null);
  const logPane = useRef<HTMLElement>(null);
  const logRequest = useRef(0);
  const pageLoadRequest = useRef(false);
  const detailRequest = useRef(0);
  const patchRequest = useRef(0);

  useEffect(() => {
    const timer = globalThis.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => globalThis.clearTimeout(timer);
  }, [searchInput]);

  // Sash bounds come from the pane area itself, so a dragged size cannot survive
  // a window that no longer has room for it. The stacked regime is the same CSS
  // breakpoint the stylesheet uses, rather than a second width guess.
  useEffect(() => {
    const element = workbench.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry!.contentRect;
      setFrame({ width: box.width, height: box.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const media = globalThis.matchMedia?.(NARROW_QUERY);
    if (media === undefined) return;
    const sync = (event: MediaQueryListEvent): void => setStacked(event.matches);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

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
          setSelectedRef((current) => current !== undefined && available.has(current) ? current : undefined);
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

  const logQueryKey = `${revision}\0${selectedRef ?? ""}\0${search}`;
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
      if (selectedRef !== undefined) params.set("ref", selectedRef);
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
  }, [logQueryKey, nextCursor, search, selectedRef]);

  useEffect(() => {
    if (refsRevision === revision) void loadLog(false);
  }, [search, selectedRef, revision, refsRevision]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // One ref at a time: the log answers "what is reachable from here", and a set
  // union of several refs is a question the reader cannot see the shape of.
  // Clicking the selected ref again returns the log to every ref.
  function selectRef(id: string): void {
    setSelectedRef((current) => current === id ? undefined : id);
  }

  const activeCommit = useMemo(() => commits.find((commit) => commit.sha === selectedSha), [commits, selectedSha]);
  const loadNextPage = useCallback(() => { void loadLog(true); }, [loadLog]);
  const canLoadMore = hasMore && !loading && loadedLogKey === logQueryKey;
  // The window narrows what is already loaded. Paging stays available, because a
  // page that falls entirely outside the window is not the end of the history.
  const datedCommits = useMemo(
    () => commits.filter((commit) => withinDateRange(commit.authoredAt, props.dateRange)),
    [commits, props.dateRange],
  );
  const remainingCommits = Math.max(total - commits.length, 1);
  /** Is the log itself on screen, rather than a loading, empty, or failed state? */
  const showsTable = failure === undefined && datedCommits.length > 0;
  /**
   * Has paging not yet reached the window?
   *
   * The log is newest-first, so a window can only sit deeper in the history
   * while the oldest loaded commit is still newer than the window's last day.
   * Once the loaded range has passed that day, an empty window is the answer —
   * paging further would walk the whole repository to find nothing.
   */
  const windowUnreached = useMemo(() => {
    if (datedCommits.length > 0) return false;
    const end = resolveDateRange(props.dateRange).to;
    const oldest = commits.at(-1)?.authoredAt;
    if (end === undefined || oldest === undefined) return false;
    const authored = new Date(oldest);
    if (Number.isNaN(authored.getTime())) return false;
    return localDayKey(authored) > end;
  }, [commits, datedCommits.length, props.dateRange]);

  // Switching Project or narrowing to a past window can leave the first page
  // entirely outside it. Advancing to the window is the reader's intent, so it
  // happens without a click — and it stops the moment the window is behind us.
  useEffect(() => {
    if (windowUnreached && canLoadMore && !loadingMore && loadMoreFailure === undefined) loadNextPage();
  }, [canLoadMore, loadMoreFailure, loadNextPage, loadingMore, windowUnreached]);

  const selectedRefLabel = useMemo(() => refDisplayName(refs, selectedRef), [refs, selectedRef]);
  /**
   * The log pane's height that is not virtualized rows: its header, the status
   * band, the paging footer, the sticky column head, and the paging control.
   *
   * It is measured rather than restated from the stylesheet, and it does not move
   * when the pane's own height does, so the natural height derived from it below
   * settles in one pass. Reading it after every render is what keeps it right
   * when the status band gains or loses a line.
   */
  useLayoutEffect(() => {
    const pane = logPane.current;
    const table = pane?.querySelector(".git-commit-table");
    if (pane === null || pane === undefined || table === null || table === undefined) return;
    const head = pane.querySelector(".git-commit-table-head");
    const control = pane.querySelector(".git-load-older");
    const fixed = pane.clientHeight - table.clientHeight
      + (head?.getBoundingClientRect().height ?? 0)
      + (control?.getBoundingClientRect().height ?? 0);
    setLogFixedHeight((current) => Math.abs((current ?? -1) - fixed) < 1 ? current : fixed);
  });
  // Sizes are clamped to what the frame can hold rather than written back, so a
  // narrowed window borrows space and a widened one returns the reader's choice.
  // Before the frame is measured the stylesheet's own defaults stand, so the
  // first paint is the docked layout rather than two collapsed panes.
  const measured = frame.width > 0 && frame.height > 0;
  const refsMax = measured ? Math.max(REFS_WIDTH.min, frame.width - LOG_MIN_WIDTH - SASH_SIZE) : REFS_WIDTH.default;
  const fittedRefsWidth = Math.min(Math.max(refsWidth, REFS_WIDTH.min), refsMax);
  const logMax = measured ? Math.max(LOG_MIN_HEIGHT, frame.height - DETAIL_MIN_HEIGHT - SASH_SIZE) : LOG_MIN_HEIGHT;
  const logFallback = measured ? Math.round(frame.height * LOG_HEIGHT_RATIO) : LOG_MIN_HEIGHT;
  // A pane never holds a void open: a log shorter than its share of the frame
  // hands the rest to the details pane. The row count is the stylesheet's own row
  // height rather than the virtualizer's running total, so the height does not
  // depend on a measurement that lags a window change.
  const naturalLogHeight = showsTable && logFixedHeight !== undefined
    ? logFixedHeight + COMMIT_ROW_HEIGHT * datedCommits.length
    : Number.POSITIVE_INFINITY;
  const fittedLogHeight = Math.min(Math.min(Math.max(logHeight ?? logFallback, LOG_MIN_HEIGHT), logMax), naturalLogHeight);
  const refreshing = loading || refsLoading;
  return <main
    ref={workbench}
    className="git-history-workbench"
    aria-label={t("titlebar.title")}
    data-narrow-pane={narrowPane}
    style={measured ? { "--git-refs-width": `${fittedRefsWidth}px`, "--git-log-height": `${fittedLogHeight}px` } as CSSProperties : undefined}
  >
    {/* The window toolbar already names this View, so the branch, the filter, and
        Refresh join that title instead of opening a second bar to repeat it. */}
    <ToolbarActions>
      <div className="git-history-toolbar">
        {refs !== undefined && <span className="git-current-branch"><GitBranch aria-hidden="true" size={14} /><strong>{refs.repository.currentBranch ?? t("titlebar.detachedHead")}</strong><code>{refs.repository.headSha?.slice(0, 8) ?? t("titlebar.noCommits")}</code></span>}
        <label className="git-log-filter"><MagnifyingGlass aria-hidden="true" size={14} /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder={t("log.filterPlaceholder")} aria-label={t("log.filterAria")} />{searchInput !== "" && <button type="button" aria-label={t("log.clearFilterAria")} title={t("log.clearFilterTitle")} onClick={() => setSearchInput("")}><X aria-hidden="true" size={13} /></button>}</label>
        <button className="git-refresh" type="button" title={t("titlebar.refreshTitle")} aria-label={t("titlebar.refreshAria")} disabled={refreshing} onClick={() => setRevision((value) => value + 1)}><ArrowClockwise aria-hidden="true" size={15} className={refreshing ? "spin" : undefined} /></button>
      </div>
    </ToolbarActions>
    <nav className="git-narrow-tabs" aria-label={t("panes.aria")}>
      {(["refs", "history", "detail"] as const).map((pane) => <button key={pane} type="button" aria-current={narrowPane === pane ? "page" : undefined} onClick={() => setNarrowPane(pane)}>{t(`panes.${pane}`)}</button>)}
    </nav>
    <aside className="git-refs-pane" aria-label={t("refs.aria")}>
      <PaneHeader
        title={t("refs.title")}
        trailing={selectedRefLabel ?? t("refs.all")}
        action={selectedRef !== undefined && <button type="button" className="git-clear-filter" title={t("refs.clearTitle")} aria-label={t("refs.clearAria")} onClick={() => setSelectedRef(undefined)}><X aria-hidden="true" size={12} /></button>}
      />
      <div className="git-refs-scroll">
        {refsFailure !== undefined
          ? <ErrorState message={refsFailure} />
          : refs === undefined
          ? <LoadingState label={t("refs.loading")} />
          : <RefsTree refs={refs} selected={selectedRef} onSelect={selectRef} />}
      </div>
    </aside>
    <PaneSash
      orientation="vertical"
      label={t("panes.resizeRefs")}
      size={fittedRefsWidth}
      min={REFS_WIDTH.min}
      max={refsMax}
      fallback={REFS_WIDTH.default}
      disabled={stacked || !measured}
      onSize={setRefsWidth}
    />
    <section className="git-log-pane" ref={logPane} aria-label={t("log.aria")}>
      <PaneHeader title={t("log.title")} trailing={t("log.count", { count: total })} />
      <div className="git-log-status">
        {searchTruncated && <p className="git-search-limit" role="status">{t("log.searchLimited")}</p>}
        {historyTruncated && <p className="git-search-limit" role="status">{t("log.historyLimited", { total })}</p>}
        {loadMoreFailure !== undefined && <p className="git-page-error" role="alert">{loadMoreFailure} {t("log.pageErrorSuffix")}</p>}
        {datedCommits.length < commits.length && <p className="git-search-limit" role="status">{t("common:dateRange.filtered", { shown: datedCommits.length, total: commits.length })}</p>}
      </div>
      {failure !== undefined
        ? <ErrorState message={failure} />
        : loading && commits.length === 0
          ? <LoadingState label={t("log.loading")} />
          : commits.length === 0
            ? <EmptyState search={search} />
            : datedCommits.length === 0
              ? <EmptyWindowState
                  loaded={commits.length}
                  newest={commits[0]?.authoredAt}
                  advancing={windowUnreached}
                  remaining={canLoadMore && !loadingMore && loadMoreFailure === undefined ? remainingCommits : undefined}
                  onLoadMore={loadNextPage}
                />
              : <CommitTable key={logQueryKey} commits={datedCommits} remaining={remainingCommits} hasMore={canLoadMore} loadingMore={loadingMore} loadMoreFailed={loadMoreFailure !== undefined} selectedSha={selectedSha} onLoadMore={loadNextPage} onSelect={(sha) => void selectCommit(sha)} />}
      <footer className="git-page-progress">{canLoadMore && (loadingMore
        ? <span role="status"><SpinnerGap aria-hidden="true" className="spin" size={14} />{t("log.loadingMore")}</span>
        : loadMoreFailure !== undefined
          ? <button type="button" onClick={loadNextPage}>{t("log.retry")}</button>
          : null)}
      </footer>
    </section>
    <PaneSash
      orientation="horizontal"
      label={t("panes.resizeDetail")}
      size={fittedLogHeight}
      min={LOG_MIN_HEIGHT}
      max={logMax}
      fallback={logFallback}
      disabled={stacked || !measured}
      onSize={setLogHeight}
    />
    <section className="git-detail-pane" aria-label={t("detail.aria")}>
      <PaneHeader title={t("detail.title")} trailing={activeCommit?.shortSha} />
      {detailLoading
        ? <LoadingState label={t("detail.loadingCommit")} />
        : detailFailure !== undefined && detail === undefined
          ? <ErrorState message={detailFailure} />
          : detail === undefined
            ? <div className="git-detail-empty"><GitCommit aria-hidden="true" size={24} /><p>{t("detail.selectHint")}</p></div>
            : <CommitDetail detail={detail} selectedFile={selectedFile} patch={patch} patchLoading={patchLoading} failure={detailFailure} stacked={stacked} onSelectFile={(file) => void selectFile(file)} />}
    </section>
  </main>;
}

function PaneHeader(props: { title: string; trailing?: string; action?: React.ReactNode }): React.JSX.Element {
  return <header className="git-pane-header"><strong>{props.title}</strong>{props.trailing !== undefined && <span>{props.trailing}</span>}{props.action}</header>;
}

function RefsTree(props: { refs: GitRefsSnapshot; selected?: string; onSelect: (id: string) => void }): React.JSX.Element {
  const { t } = useTranslation("git");
  const remotes = groupRemotes(props.refs.remote);
  return <>
    {props.refs.head !== null && <RefGroup label={t("refs.head")} icon={<MapPin aria-hidden="true" size={13} weight="fill" />} count={1} defaultOpen><RefRow gitRef={props.refs.head} selected={props.selected === props.refs.head.id} onSelect={props.onSelect} /></RefGroup>}
    <RefGroup label={t("refs.localBranches")} icon={<GitBranch aria-hidden="true" size={13} />} count={props.refs.local.length} defaultOpen>{props.refs.local.map((ref) => <RefRow key={ref.id} gitRef={ref} selected={props.selected === ref.id} onSelect={props.onSelect} />)}</RefGroup>
    <RefGroup label={t("refs.remoteBranches")} icon={<Globe aria-hidden="true" size={13} />} count={props.refs.remote.length}>{[...remotes.entries()].map(([remote, refs]) => <RefGroup key={remote} label={remote} icon={<Globe aria-hidden="true" size={12} />} count={refs.length}>{refs.map((ref) => <RefRow key={ref.id} gitRef={ref} selected={props.selected === ref.id} onSelect={props.onSelect} />)}</RefGroup>)}</RefGroup>
    {props.refs.tags.length > 0 && <RefGroup label={t("refs.tags")} icon={<Tag aria-hidden="true" size={13} />} count={props.refs.tags.length}>{props.refs.tags.map((ref) => <RefRow key={ref.id} gitRef={ref} selected={props.selected === ref.id} onSelect={props.onSelect} />)}</RefGroup>}
  </>;
}

function RefGroup(props: { label: string; icon: React.ReactNode; count: number; defaultOpen?: boolean; children: React.ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  return <section className="git-ref-group"><button className="git-ref-group-toggle" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? <CaretDown aria-hidden="true" size={12} /> : <CaretRight aria-hidden="true" size={12} />}{props.icon}<strong>{props.label}</strong><span>{props.count}</span></button>{open && <div>{props.children}</div>}</section>;
}

function RefRow(props: { gitRef: GitHistoryRef; selected: boolean; onSelect: (id: string) => void }): React.JSX.Element {
  const { t } = useTranslation("git");
  return <button className="git-ref-row" type="button" aria-pressed={props.selected} title={props.gitRef.id} onClick={() => props.onSelect(props.gitRef.id)}>{props.gitRef.isCurrent && <MapPin aria-label={t("refs.currentBranch")} size={11} weight="fill" />}<span>{props.gitRef.name}</span><code>{props.gitRef.commitSha.slice(0, 7)}</code></button>;
}

/**
 * The window emptied the log, so the pane says what it actually knows.
 *
 * "Nothing in this window" on its own leaves the reader guessing whether the
 * repository is empty, whether the window is wrong, or whether the history
 * simply has not been paged that far yet. Naming what was loaded and how recent
 * it is answers all three, and the paging control keeps the deeper history
 * reachable instead of ending the pane here.
 */
function EmptyWindowState(props: { loaded: number; newest?: string; advancing: boolean; remaining?: number; onLoadMore: () => void }): React.JSX.Element {
  const { t } = useTranslation("git");
  const newestDay = props.newest === undefined ? undefined : new Date(props.newest);
  return <div className="git-empty-window">
    <Clock aria-hidden="true" size={22} />
    <p role="status">{newestDay === undefined || Number.isNaN(newestDay.getTime())
      ? t("log.emptyWindow", { count: props.loaded })
      : t("log.emptyWindowNewest", { count: props.loaded, date: newestDay.toLocaleDateString(studioLocale()) })}</p>
    {props.advancing
      ? <p role="status"><SpinnerGap aria-hidden="true" className="spin" size={13} />{t("log.emptyWindowAdvancing")}</p>
      : <p>{t("log.emptyWindowHint")}</p>}
    {props.remaining !== undefined && !props.advancing && <LoadOlderCommits remaining={props.remaining} onLoadMore={props.onLoadMore} />}
  </div>;
}

/** The one paging affordance for a log that cannot be scrolled for the next page. */
function LoadOlderCommits(props: { remaining: number; onLoadMore: () => void }): React.JSX.Element {
  const { t } = useTranslation("git");
  return <button className="git-load-older" type="button" onClick={props.onLoadMore}>{t("log.loadOlder", { count: props.remaining })}</button>;
}

/**
 * The commit log pages for the reader, not at them.
 *
 * The rendered rows are the loaded history narrowed by the date window, while a
 * page is fetched from the unnarrowed history, so "the end of the list is in
 * view" is not on its own a request for more: a window that admits a dozen
 * commits keeps the end permanently in view and would drain the whole history
 * without the reader touching anything. Paging therefore follows the scroll
 * gesture — one arrival at the end buys one page — and a list with nothing to
 * scroll offers the page as a control instead of taking it silently.
 */
function CommitTable(props: { commits: GitHistoryCommit[]; remaining: number; hasMore: boolean; loadingMore: boolean; loadMoreFailed: boolean; selectedSha?: string; onLoadMore: () => void; onSelect: (sha: string) => void }): React.JSX.Element {
  const { t } = useTranslation("git");
  const { commits, hasMore, loadingMore, loadMoreFailed, onLoadMore } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [scrollRange, setScrollRange] = useState(0);
  const pendingFocus = useRef(false);
  const laneCount = Math.max(2, ...commits.flatMap((commit) => [commit.lane + 1, ...commit.activeLanes.map((lane) => lane + 1), ...commit.graphEdges.map((edge) => Math.max(edge.fromLane, edge.toLane) + 1)]));
  const rows = useVirtualizer({
    count: commits.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => COMMIT_ROW_HEIGHT,
    overscan: 10,
    getItemKey: (index) => commits[index]!.sha,
  });
  rows.shouldAdjustScrollPositionOnItemSizeChange = () => false;
  const virtualRows = rows.getVirtualItems();
  const lastIndex = commits.length - 1;
  const focused = Math.min(focusIndex, lastIndex);
  // A virtualized list can lose the focused row to the recycler, so the tab stop
  // falls back to a rendered row: the list must never stop being reachable.
  const tabStop = virtualRows.some((row) => row.index === focused) ? focused : virtualRows[0]?.index ?? 0;
  const canPrefetch = hasMore && !loadingMore && !loadMoreFailed;
  const scrollable = scrollRange > PREFETCH_MARGIN;
  const renderedRange = `${virtualRows[0]?.index ?? -1}:${virtualRows.length}`;

  useEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;
    const sync = (): void => setScrollRange(element.scrollHeight - element.clientHeight);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    return () => observer.disconnect();
  }, [commits.length]);

  // Focus lands only once the virtualizer has rendered the target row, so the
  // effect re-checks whenever the rendered range changes rather than assuming
  // the scroll and the paint happened in the same tick.
  useEffect(() => {
    if (!pendingFocus.current) return;
    const node = scrollRef.current?.querySelector<HTMLButtonElement>(`.git-commit-rows > button[data-index="${focused}"]`);
    if (node === null || node === undefined) return;
    pendingFocus.current = false;
    node.focus();
  }, [focused, renderedRange]);

  function prefetchOnScroll(event: React.UIEvent<HTMLDivElement>): void {
    if (!canPrefetch || !scrollable) return;
    const element = event.currentTarget;
    if (element.scrollHeight - element.clientHeight - element.scrollTop > PREFETCH_MARGIN) return;
    onLoadMore();
  }

  // Focus travel does not wrap. The Sessions list wraps because it is a closed
  // set; this log is a paged timeline, so its last loaded row leads to the next
  // page rather than back to HEAD.
  function moveFocus(event: React.KeyboardEvent<HTMLButtonElement>, index: number): void {
    if (!["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "ArrowDown" && index === lastIndex) {
      if (canPrefetch) onLoadMore();
      return;
    }
    const target = event.key === "Home"
      ? 0
      : event.key === "End"
        ? lastIndex
        : event.key === "ArrowDown"
          ? index + 1
          : event.key === "ArrowUp"
            ? index - 1
            : event.key === "PageDown"
              ? index + KEYBOARD_PAGE_ROWS
              : index - KEYBOARD_PAGE_ROWS;
    const next = Math.min(Math.max(target, 0), lastIndex);
    if (next === index) return;
    pendingFocus.current = true;
    setFocusIndex(next);
    rows.scrollToIndex(next);
  }

  return <div ref={scrollRef} className="git-commit-table" role="grid" aria-label={t("table.aria")} aria-rowcount={commits.length + 1} onScroll={prefetchOnScroll}>
    <div className="git-commit-table-head" role="row"><span role="columnheader" aria-label={t("table.graph")} style={{ width: laneCount * 16 + 8 }} /><strong role="columnheader">{t("table.message")}</strong><strong role="columnheader">{t("table.author")}</strong><strong role="columnheader">{t("table.date")}</strong><strong role="columnheader">{t("table.hash")}</strong></div>
    <div className="git-commit-rows" role="rowgroup" style={{ height: rows.getTotalSize() }}>{virtualRows.map((virtualRow) => {
      const commit = commits[virtualRow.index]!;
      return <button
        key={commit.sha}
        ref={rows.measureElement}
        data-index={virtualRow.index}
        style={{ transform: `translateY(${virtualRow.start}px)` }}
        type="button"
        role="row"
        tabIndex={virtualRow.index === tabStop ? 0 : -1}
        aria-rowindex={virtualRow.index + 2}
        aria-selected={props.selectedSha === commit.sha}
        onFocus={() => setFocusIndex(virtualRow.index)}
        onKeyDown={(event) => moveFocus(event, virtualRow.index)}
        onClick={() => props.onSelect(commit.sha)}
      >
        <CommitGraph commit={commit} laneCount={laneCount} />
        <span className="git-commit-subject" role="gridcell"><span>{commit.refs.map((ref) => <i key={ref.id} data-kind={ref.kind}>{ref.kind === "tag" ? <Tag aria-hidden="true" size={10} /> : <GitBranch aria-hidden="true" size={10} />}{ref.remote === undefined ? ref.name : `${ref.remote}/${ref.name}`}</i>)}</span><strong title={commit.summary}>{commit.summary}</strong></span>
        <span className="git-commit-author" role="gridcell" title={commit.authorEmail}>{commit.authorName}</span>
        <time role="gridcell" dateTime={commit.authoredAt} title={new Date(commit.authoredAt).toLocaleString(studioLocale())}>{relativeTime(commit.authoredAt)}</time>
        <code role="gridcell">{commit.shortSha}</code>
      </button>;
    })}</div>
    {canPrefetch && !scrollable && <LoadOlderCommits remaining={props.remaining} onLoadMore={onLoadMore} />}
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

/**
 * The commit's own text is a caption over its file list, not a band across the
 * detail pane: the patch is what the reader came for, so it takes the full
 * height of the pane and the message shares the file list's column.
 */
function CommitDetail(props: { detail: GitCommitDetail; selectedFile?: string; patch?: GitFilePatch; patchLoading: boolean; failure?: string; stacked: boolean; onSelectFile: (file: GitCommitFileChange) => void }): React.JSX.Element {
  const { t } = useTranslation("git");
  const { commit, files } = props.detail;
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  const grid = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  const [frameHeight, setFrameHeight] = useState(0);
  useEffect(() => {
    const element = grid.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => setFrameHeight(entry!.contentRect.height));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const measured = frameHeight > 0;
  const messageMax = measured ? Math.max(MESSAGE_HEIGHT.min, frameHeight - FILES_MIN_HEIGHT - SASH_SIZE) : MESSAGE_HEIGHT.default;
  const messageHeight = Math.min(Math.max(height ?? MESSAGE_HEIGHT.default, MESSAGE_HEIGHT.min), messageMax);
  return <div
    ref={grid}
    className="git-detail-grid"
    style={measured ? { "--git-message-height": `${messageHeight}px` } as CSSProperties : undefined}
  >
    <div className="git-commit-message">
      <strong>{commit.summary}</strong>
      {commit.message !== commit.summary && <p>{commit.message.slice(commit.summary.length).trim()}</p>}
      <dl>
        <div><dt><Hash aria-hidden="true" size={12} />{t("detail.commit")}</dt><dd><code>{commit.sha}</code></dd></div>
        <div><dt><User aria-hidden="true" size={12} />{t("detail.author")}</dt><dd>{commit.authorName} <span>&lt;{commit.authorEmail}&gt;</span></dd></div>
        <div><dt><Clock aria-hidden="true" size={12} />{t("detail.authored")}</dt><dd><time dateTime={commit.authoredAt}>{new Date(commit.authoredAt).toLocaleString(studioLocale())}</time></dd></div>
        {commit.parents.length > 0 && <div><dt><GitCommit aria-hidden="true" size={12} />{t("detail.parents")}</dt><dd>{commit.parents.map((parent) => <code key={parent}>{parent.slice(0, 8)}</code>)}</dd></div>}
      </dl>
    </div>
    <PaneSash
      orientation="horizontal"
      label={t("panes.resizeMessage")}
      size={messageHeight}
      min={MESSAGE_HEIGHT.min}
      max={messageMax}
      fallback={MESSAGE_HEIGHT.default}
      disabled={props.stacked || !measured}
      onSize={setHeight}
    />
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

/**
 * The refs pane header names the selected ref, so the reader can see the filter
 * without scrolling the tree back to the row that set it. A ref that the latest
 * snapshot no longer carries falls back to its id rather than reading as cleared.
 */
function refDisplayName(snapshot: GitRefsSnapshot | undefined, id: string | undefined): string | undefined {
  if (id === undefined) return undefined;
  if (snapshot === undefined) return id;
  const match = [...(snapshot.head === null ? [] : [snapshot.head]), ...snapshot.local, ...snapshot.remote, ...snapshot.tags]
    .find((ref) => ref.id === id);
  if (match === undefined) return id;
  return match.remote === undefined ? match.name : `${match.remote}/${match.name}`;
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
