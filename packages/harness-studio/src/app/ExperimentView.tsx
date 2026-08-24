import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CheckpointHistoryPreview, ResolvedHistoryDraftPreview } from "../experiment-setup.js";
import { applyLaneEvent, emptyLane, mergeCallPage } from "./experiment-comparison-model.js";
import { ExperimentBuilder, type HistoryActionState, type HistoryLoadState } from "./ExperimentBuilder.js";
import { ExperimentWorkbench } from "./ExperimentWorkbench.js";
import { createSseParser } from "./sse-client.js";
import type {
  CompareView,
  ExperimentPreview,
  LaneTrace,
  Selection,
  StreamEvent,
  TraceLens,
} from "./experiment-view-types.js";

type ExperimentSurface = "builder" | "workbench";
type LoadState =
  | { phase: "loading" }
  | { phase: "error"; detail: string }
  | { phase: "ready"; preview: ExperimentPreview };

export function ExperimentView(props: { navigation?: ReactNode } = {}): React.JSX.Element {
  const [load, setLoad] = useState<LoadState>({ phase: "loading" });
  const [lanes, setLanes] = useState<Record<string, LaneTrace>>({});
  const [selection, setSelection] = useState<Selection | null>(null);
  const [baselineId, setBaselineId] = useState<string | null>(null);
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<CompareView>("trace");
  const [traceLens, setTraceLens] = useState<TraceLens>("calls");
  const [filter, setFilter] = useState("");
  const [diffOnly, setDiffOnly] = useState(false);
  const [syncSelection, setSyncSelection] = useState(true);
  const [experimentId, setExperimentId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [compareSet, setCompareSet] = useState<StreamEvent["compareSet"]>();
  const [surface, setSurface] = useState<ExperimentSurface>("builder");
  const [history, setHistory] = useState<HistoryLoadState>({ phase: "loading" });
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [historyDraft, setHistoryDraft] = useState<ResolvedHistoryDraftPreview | null>(null);
  const [historyAction, setHistoryAction] = useState<HistoryActionState>({ phase: "idle" });
  const [railCollapsed, setRailCollapsed] = useState(() => globalThis.matchMedia?.("(max-width: 1080px)").matches ?? false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("api/experiment");
        const payload = await response.json() as ExperimentPreview & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? `Experiment request failed (${response.status}).`);
        if (cancelled) return;
        initializePreview(payload);
      } catch (error) {
        if (!cancelled) setLoad({ phase: "error", detail: error instanceof Error ? error.message : String(error) });
        return;
      }
      try {
        const historyResponse = await fetch("api/checkpoint-history");
        if (historyResponse.status === 404) {
          setHistory({ phase: "disabled" });
          return;
        }
        const historyPayload = await historyResponse.json() as CheckpointHistoryPreview & { error?: string };
        if (!historyResponse.ok) throw new Error(historyPayload.error ?? `History request failed (${historyResponse.status}).`);
        setHistory({ phase: "ready", preview: historyPayload });
        const first = historyPayload.items[0];
        if (first !== undefined) {
          setHistoryId(first.id);
          await resolveHistory(first.id);
        }
      } catch (error) {
        if (!cancelled) setHistory({ phase: "error", detail: error instanceof Error ? error.message : String(error) });
      }
    })();
    return () => { cancelled = true; abortRef.current?.abort(); };
  }, []);

  useEffect(() => {
    const media = globalThis.matchMedia?.("(max-width: 1080px)");
    if (media === undefined) return;
    const listener = (event: MediaQueryListEvent): void => setRailCollapsed(event.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  function initializePreview(payload: ExperimentPreview): void {
    const initial: Record<string, LaneTrace> = {};
    for (const lane of payload.manifest.lanes) {
      const calls = lane.origin === "observed" ? payload.observedCalls[lane.id] ?? [] : [];
      initial[lane.id] = {
        status: lane.origin === "observed" ? "history" : "idle",
        calls,
        eventCount: payload.observedCallPages?.[lane.id]?.parsedLines ?? calls.length,
        ...(payload.observedCallPages?.[lane.id]?.nextCursor === undefined ? {} : { nextCursor: payload.observedCallPages[lane.id]!.nextCursor }),
        ...(lane.origin === "observed" ? { hasMore: payload.observedCallPages?.[lane.id]?.complete === false } : {}),
      };
    }
    const fresh = payload.manifest.lanes.filter((lane) => lane.origin === "execute");
    const baseline = fresh[0];
    const candidate = fresh[1] ?? fresh[0];
    setLoad({ phase: "ready", preview: payload });
    setLanes(initial);
    setBaselineId(baseline?.id ?? "");
    setCandidateId(candidate?.id ?? baseline?.id ?? "");
    setCompareSet(undefined);
    setSelection(null);
  }

  async function loadMoreCalls(laneId: string): Promise<void> {
    const lane = lanes[laneId];
    if (lane?.loadingMore || !lane?.hasMore || lane.nextCursor === undefined) return;
    setLanes((current) => ({ ...current, [laneId]: { ...current[laneId]!, loadingMore: true } }));
    try {
      const query = new URLSearchParams({ laneId, cursor: lane.nextCursor, limit: "100" });
      const response = await fetch(`api/experiment/observed-calls?${query}`);
      const page = await response.json() as {
        calls?: LaneTrace["calls"];
        nextCursor?: string;
        complete?: boolean;
        parsedLines?: number;
        error?: string;
      };
      if (!response.ok || page.calls === undefined) throw new Error(page.error ?? `Observed calls failed (${response.status}).`);
      setLanes((current) => {
        const existing = current[laneId] ?? emptyLane();
        return { ...current, [laneId]: {
          ...existing,
          calls: mergeCallPage(existing.calls, page.calls!),
          eventCount: page.parsedLines ?? existing.eventCount,
          ...(page.nextCursor === undefined ? { nextCursor: undefined } : { nextCursor: page.nextCursor }),
          hasMore: page.complete === false,
          loadingMore: false,
        } };
      });
    } catch (error) {
      setLanes((current) => ({ ...current, [laneId]: {
        ...(current[laneId] ?? emptyLane()),
        loadingMore: false,
        detail: error instanceof Error ? error.message : String(error),
      } }));
    }
  }

  async function resolveHistory(id: string): Promise<void> {
    setHistoryAction({ phase: "resolving" });
    setHistoryDraft(null);
    try {
      const response = await fetch("api/checkpoint-history/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ historyId: id }),
      });
      const payload = await response.json() as ResolvedHistoryDraftPreview & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? `History resolve failed (${response.status}).`);
      setHistoryDraft(payload);
      setHistoryAction({ phase: "idle" });
    } catch (error) {
      setHistoryAction({ phase: "error", detail: error instanceof Error ? error.message : String(error) });
    }
  }

  function selectHistory(id: string): void {
    setHistoryId(id);
    void resolveHistory(id);
  }

  async function lockBuilder(): Promise<void> {
    if (history.phase === "disabled") {
      setSurface("workbench");
      return;
    }
    if (history.phase !== "ready" || historyId === null || historyDraft?.selection.id !== historyId) return;
    if (load.phase === "ready" && load.preview.lock?.historyId === historyId) {
      setSurface("workbench");
      return;
    }
    setHistoryAction({ phase: "locking" });
    try {
      const response = await fetch("api/experiment/lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ historyId }),
      });
      const payload = await response.json() as ExperimentPreview & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? `Experiment lock failed (${response.status}).`);
      initializePreview(payload);
      setHistoryAction({ phase: "idle" });
      setSurface("workbench");
    } catch (error) {
      setHistoryAction({ phase: "error", detail: error instanceof Error ? error.message : String(error) });
    }
  }

  function applyStreamEvent(event: StreamEvent): void {
    if (event.compareSet !== undefined) setCompareSet(event.compareSet);
    if (event.laneId === null) return;
    setLanes((current) => {
      const lane = current[event.laneId!] ?? emptyLane();
      return { ...current, [event.laneId!]: applyLaneEvent(lane, event) };
    });
  }

  async function runExperiment(): Promise<void> {
    const nextId = `exp_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
    const controller = new AbortController();
    abortRef.current = controller;
    setExperimentId(nextId);
    setRunning(true);
    setCompareSet(undefined);
    setSelection(null);
    setLanes((current) => Object.fromEntries(Object.entries(current).map(([laneId, lane]) => [
      laneId,
      lane.status === "history" ? lane : emptyLane(),
    ])));
    try {
      const response = await fetch("api/experiment/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ experimentId: nextId }),
        signal: controller.signal,
      });
      if (!response.ok || response.body === null) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error ?? `Experiment start failed (${response.status}).`);
      }
      const parser = createSseParser<StreamEvent>(applyStreamEvent);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        parser.push(decoder.decode(chunk.value, { stream: true }));
      }
      parser.push(decoder.decode());
      parser.end();
    } catch (error) {
      if (!controller.signal.aborted) {
        setLanes((current) => Object.fromEntries(Object.entries(current).map(([laneId, lane]) => [
          laneId,
          lane.status === "running" || lane.status === "preparing"
            ? { ...lane, status: "failed", detail: error instanceof Error ? error.message : String(error) }
            : lane,
        ])));
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  async function cancelExperiment(): Promise<void> {
    if (experimentId === null) return;
    await fetch(`api/experiment/runs/${encodeURIComponent(experimentId)}`, { method: "DELETE" });
    abortRef.current?.abort();
    setRunning(false);
    setLanes((current) => Object.fromEntries(Object.entries(current).map(([laneId, lane]) => [
      laneId,
      lane.status === "running" || lane.status === "preparing" ? { ...lane, status: "cancelled" } : lane,
    ])));
  }

  if (load.phase === "loading") return <p>Loading comparison…</p>;
  if (load.phase === "error") return <p className="warning">Cannot load comparison: {load.detail}</p>;
  const { preview } = load;
  const fresh = preview.manifest.lanes.filter((lane) => lane.origin === "execute");
  const focusedBaselineId = baselineId ?? fresh[0]?.id ?? "";
  const focusedCandidateId = candidateId ?? fresh[1]?.id ?? focusedBaselineId;

  if (surface === "builder") {
    return <ExperimentBuilder
      preview={preview}
      navigation={props.navigation}
      history={history}
      selectedHistoryId={historyId}
      historyDraft={historyDraft}
      historyAction={historyAction}
      onSelectHistory={selectHistory}
      onLock={() => void lockBuilder()}
    />;
  }

  function selectRun(id: string): void {
    if (id === focusedBaselineId) return;
    if (id === focusedCandidateId) {
      setBaselineId(focusedCandidateId);
      setCandidateId(focusedBaselineId);
    } else {
      setCandidateId(id);
    }
    setSelection(null);
  }

  return <ExperimentWorkbench
    preview={preview}
    navigation={props.navigation}
    lanes={lanes}
    baselineId={focusedBaselineId}
    candidateId={focusedCandidateId}
    selection={selection}
    activeView={activeView}
    traceLens={traceLens}
    filter={filter}
    diffOnly={diffOnly}
    syncSelection={syncSelection}
    running={running}
    experimentId={experimentId}
    compareSet={compareSet}
    railCollapsed={railCollapsed}
    onRailCollapsed={setRailCollapsed}
    onSetup={() => setSurface("builder")}
    onRun={() => void runExperiment()}
    onCancel={() => void cancelExperiment()}
    onSelectRun={selectRun}
    onSelectCall={setSelection}
    onActiveView={setActiveView}
    onTraceLens={setTraceLens}
    onFilter={setFilter}
    onDiffOnly={setDiffOnly}
    onSyncSelection={setSyncSelection}
    onLoadMore={(laneId) => void loadMoreCalls(laneId)}
  />;
}
