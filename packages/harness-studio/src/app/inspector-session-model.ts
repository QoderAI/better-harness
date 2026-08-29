export interface InspectorTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  reasoningOutputTokens?: number;
  totalTokens?: number;
  basis?: string;
  source?: string;
  coverage?: "observed" | "partial" | "unobserved";
  cacheAccountingMode?: InspectorCacheAccountingMode;
}

export type InspectorCacheAccountingMode = "included-in-input" | "separate-input-lane" | "relationship-unknown";

export interface InspectorCacheReuse {
  status: "observed" | "partial" | "inconsistent";
  accountingMode: InspectorCacheAccountingMode;
  cacheReadTokens: number;
  cacheCreationTokens?: number;
  promptInputTokens?: number;
  uncachedInputTokens?: number;
  reusePercent?: number;
}

export interface InspectorContextWindowUsage {
  usedTokens?: number;
  windowTokens?: number;
  percentFull?: number;
  basis?: string;
}

export interface InspectorToolCall {
  id: string;
  callId?: string;
  kind?: "note" | "tool" | "usage";
  text?: string;
  toolName?: string;
  actionLabel?: string;
  operation?: string;
  family?: string;
  status?: string;
  startedAt?: number | null;
  durationMs?: number | null;
  durationStatus?: string;
  detail?: string;
  detailKind?: string;
  filePath?: string | null;
  filePaths?: string[];
  tokenUsage?: InspectorTokenUsage;
  cacheReuse?: InspectorCacheReuse;
  contextUsage?: InspectorContextWindowUsage;
  basis?: string;
  source?: string;
  model?: string;
  processedTokens?: number;
  processedTokensBasis?: string;
  timestamp?: string | null;
}

export interface InspectorUsageProgressionPoint {
  id: string;
  index: number;
  timestamp?: string;
  model?: string;
  contextTokens?: number;
  windowTokens?: number;
  percentFull?: number;
  contextDeltaTokens?: number;
  processedTokens?: number;
  outputTokens?: number;
  cacheReuse?: InspectorCacheReuse;
  turnIndex?: number;
  userPrompt?: string;
  promptBoundary?: boolean;
  boundary: "baseline" | "growth" | "steady" | "shrink" | "model-change" | "unobserved";
}

export interface InspectorUsageReport {
  actualModelCalls: number;
  duplicateRecordsCollapsed: number;
  conflictingDuplicateRecords: number;
  currentContextTokens?: number;
  baselineContextTokens?: number;
  netContextDeltaTokens?: number;
  contextResetCount: number;
  modelBoundaryCount: number;
  processedTokens?: number;
  processedTokensBasis?: string;
  processedCoverage?: "observed" | "partial";
  providerTotalTokens?: number;
  progressionTotalCount: number;
  progressionTruncated: boolean;
  progression: InspectorUsageProgressionPoint[];
}

// Mirrors EMPTY_USAGE_REPORT in scripts/session-analysis/usage-progression.mjs.
// A Session projected by the current report model always carries a usage
// report; this covers older persisted reports without letting each view invent
// its own "nothing observed" shape.
export const EMPTY_USAGE_REPORT: InspectorUsageReport = {
  actualModelCalls: 0,
  duplicateRecordsCollapsed: 0,
  conflictingDuplicateRecords: 0,
  contextResetCount: 0,
  modelBoundaryCount: 0,
  progressionTotalCount: 0,
  progressionTruncated: false,
  progression: [],
};

export interface InspectorTurn {
  index: number;
  anchorId?: string;
  prompt?: { text?: string; timestamp?: string | null };
  steps?: InspectorToolCall[];
  toolCallCount?: number;
  intermediateCount?: number;
  usageEventCount?: number;
  eventCount?: number;
  shownEventCount?: number;
  processTruncated?: boolean;
  response?: string | null;
  responseStatus?: string;
  startMs?: number | null;
  endMs?: number | null;
  durationMs?: number | null;
}

export interface InspectorReplayEvent {
  id: string;
  type: string;
  title?: string;
  label?: string;
  body?: string;
  bodyExcerpt?: boolean;
  availability?: string;
  status?: string;
  meta?: string;
  durationMs?: number | null;
  turnIndex?: number | null;
  timeBasis?: string;
  atMs?: number | null;
  order?: number;
  files?: string[];
}

export interface InspectorReplayFile {
  path: string;
  eventIds: string[];
}

export interface InspectorCommit {
  hash: string;
  shortHash?: string;
  subject?: string;
  committedAt?: string;
  authoredAt?: string;
  fileCount?: number;
  linesAdded?: number;
  linesRemoved?: number;
  files?: Array<{ path: string; added?: number | null; removed?: number | null }>;
}

export interface InspectorSession {
  sessionId: string;
  locator?: string;
  platform?: string;
  source?: string;
  firstSeen?: string | null;
  lastSeen?: string | null;
  durationMs?: number | null;
  fileEditCount?: number;
  files?: string[];
  prompts?: Array<{ text: string; timestamp?: string | null; turnIndex?: number | null }>;
  models?: string[];
  tokenUsage?: InspectorTokenUsage;
  cacheReuse?: InspectorCacheReuse;
  usageReport?: InspectorUsageReport;
  runtime?: { modelProvider?: string; cliVersion?: string; effort?: string } | null;
  contextManifest?: {
    status?: "observed" | "partial" | "unobserved";
    source?: string;
    rawTextOmitted?: boolean;
    usedTokens?: number;
    windowTokens?: number;
    percentFull?: number;
    basis?: string;
    compactionCount?: number;
    layers?: Array<{ kind: string; itemCount: number }>;
    categories?: Array<{ kind: string; label: string; estimatedTokens: number }>;
  } | null;
  timestampBasis?: "native-event" | "native-metadata" | "source-file-mtime" | "unobserved";
  toolActivity?: {
    totalCalls?: number;
    failedCalls?: number;
    files?: Array<string | { path: string }>;
    calls?: InspectorToolCall[];
  };
  dialogue?: {
    turns?: InspectorTurn[];
    responseCount?: number;
    noteCount?: number;
    truncated?: boolean;
  };
  replay?: {
    events?: InspectorReplayEvent[];
    files?: InspectorReplayFile[];
    eventCount?: number;
    startMs?: number | null;
    endMs?: number | null;
  };
  commitLinks?: Array<{ hash: string }>;
}

export interface ProjectedTurn {
  turn: InspectorTurn;
  calls: InspectorToolCall[];
  commits: InspectorCommit[];
}

export interface SessionTraceProjection {
  turns: ProjectedTurn[];
  unplacedCalls: InspectorToolCall[];
  unplacedFiles: string[];
  outsideCommits: Array<{ commit: InspectorCommit; relation: string }>;
}

export function sessionTurns(session: InspectorSession): InspectorTurn[] {
  if (session.dialogue?.turns?.length) return session.dialogue.turns;
  return (session.prompts ?? []).map((prompt, index) => {
    const turnIndex = prompt.turnIndex ?? index + 1;
    return {
      index: turnIndex,
      anchorId: `turn-${turnIndex}`,
      prompt,
      steps: [],
      response: null,
      responseStatus: "unavailable",
      toolCallCount: 0,
    };
  });
}

export function projectSessionTrace(session: InspectorSession, commits: InspectorCommit[]): SessionTraceProjection {
  const turns = sessionTurns(session);
  const calls = session.toolActivity?.calls ?? [];
  const callsById = new Map(calls.map((call) => [call.id, call]));
  const placedCallIds = new Set<string>();
  const commitsByTurn = new Map<number, InspectorCommit[]>();
  const outsideCommits: Array<{ commit: InspectorCommit; relation: string }> = [];
  const sessionStart = Date.parse(session.firstSeen ?? "");
  const sessionEnd = Date.parse(session.lastSeen ?? "");

  for (const commit of commits) {
    const time = Date.parse(commit.committedAt ?? commit.authoredAt ?? "");
    const turn = turns.find((candidate) => Number.isFinite(candidate.startMs)
      && Number.isFinite(candidate.endMs)
      && time >= Number(candidate.startMs)
      && time <= Number(candidate.endMs));
    if (turn) {
      const bucket = commitsByTurn.get(turn.index) ?? [];
      bucket.push(commit);
      commitsByTurn.set(turn.index, bucket);
      continue;
    }
    const relation = Number.isFinite(sessionStart) && time < sessionStart
      ? "before this Session started"
      : Number.isFinite(sessionEnd) && time > sessionEnd
        ? "after this Session ended"
        : "between observed Turn windows";
    outsideCommits.push({ commit, relation });
  }

  const projectedTurns = turns.map((turn) => {
    const turnCalls = (turn.steps ?? [])
      .filter((step) => step.kind === "tool")
      .map((step) => callsById.get(step.callId ?? step.id))
      .filter((call): call is InspectorToolCall => call !== undefined);
    for (const call of turnCalls) placedCallIds.add(call.id);
    return { turn, calls: turnCalls, commits: commitsByTurn.get(turn.index) ?? [] };
  });

  const unplacedCalls = calls
    .filter((call) => !placedCallIds.has(call.id))
    .slice()
    .sort((left, right) => {
      const leftTime = Number.isFinite(left.startedAt) ? Number(left.startedAt) : Number.POSITIVE_INFINITY;
      const rightTime = Number.isFinite(right.startedAt) ? Number(right.startedAt) : Number.POSITIVE_INFINITY;
      return leftTime - rightTime || left.id.localeCompare(right.id);
    });
  const unplacedFiles = (unplacedCalls.length || turns.length === 0)
    ? (session.toolActivity?.files ?? []).map((file) => typeof file === "string" ? file : file.path)
    : [];
  return { turns: projectedTurns, unplacedCalls, unplacedFiles, outsideCommits };
}

export interface ToolRun {
  key: string;
  calls: InspectorToolCall[];
}

export function groupToolRuns(calls: InspectorToolCall[]): ToolRun[] {
  const runs: ToolRun[] = [];
  for (const call of calls) {
    const key = [call.actionLabel, call.toolName, call.status, call.detail ?? "", (call.filePaths ?? []).join(",")].join("|");
    const current = runs.at(-1);
    if (current?.key === key) current.calls.push(call);
    else runs.push({ key, calls: [call] });
  }
  return runs;
}

export function filteredCallCount(calls: InspectorToolCall[], enabledTools: ReadonlySet<string>): number {
  return calls.filter((call) => enabledTools.has(call.toolName ?? call.operation ?? "tool")).length;
}

export function observedDurationTotal(calls: InspectorToolCall[]): number | undefined {
  const observed = calls
    .filter((call) => call.durationStatus === "observed" && Number.isFinite(call.durationMs))
    .map((call) => Number(call.durationMs));
  return observed.length > 0 ? observed.reduce((sum, duration) => sum + duration, 0) : undefined;
}

export function replayIndexForFile(events: InspectorReplayEvent[], files: InspectorReplayFile[], path: string): number {
  const eventId = files.find((file) => file.path === path)?.eventIds[0];
  if (eventId === undefined) return -1;
  return events.findIndex((event) => event.id === eventId);
}
