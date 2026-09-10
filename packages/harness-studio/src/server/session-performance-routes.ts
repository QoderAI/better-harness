import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HarnessStudioServerOptions, HarnessStudioState, StudioWorkspaceSessionSummary } from './studio-types.js';
import { respondJson, sameOriginRequest } from './http-utils.js';
import { isPerformanceResult, isPerformanceSource } from '../contracts/session-performance.js';

type Cache = { revision: number; entries: Map<string, { at: number; result: Promise<Record<string, unknown>> }> };
type TimingSession = Record<string, unknown>;

/**
 * Agents whose retained evidence the native host can time. Everything else is
 * still listed, but as an explicit no-evidence Session rather than a row of
 * zeroes that reads like a measurement.
 */
const TIMED_PROVIDERS = new Set(['qoder', 'claude', 'codex']);

function workspaceSessionTiming(summary: StudioWorkspaceSessionSummary): TimingSession {
  const firstSeenMs = (() => {
    try { const d = new Date(summary.savedAt); return Number.isNaN(d.getTime()) ? null : d.getTime(); } catch { return null; }
  })();
  const label = summary.prompt?.slice(0, 1024) || summary.id;
  return {
    breakdown: { totalMs: 0, activityTotalMs: 0, segments: [] },
    id: summary.id,
    provider: summary.provider || 'unknown',
    label,
    firstSeenMs,
    lastSeenMs: firstSeenMs,
    lastActivityMs: firstSeenMs,
    wallMs: null,
    completedTurnMs: null,
    timedUnionMs: null,
    unattributedTurnMs: null,
    longestMs: null,
    turnCount: 0,
    toolCount: summary.toolCallCount ?? 0,
    retryCount: 0,
    usage: { inputTokens: null, outputTokens: null, cacheReadInputTokens: null, cacheCreationInputTokens: null,
      reasoningOutputTokens: null, totalTokens: null, countedRequests: 0, contextWindow: null, models: [], basis: 'unrecorded' },
    metrics: [],
    subagents: { count: 0, timedCount: 0, cumulativeMs: null, elapsedMs: null, maxMs: null, peakConcurrency: 0, unlinkedCount: 0, unlinkedTurnCount: 0 },
    findings: [],
    coverage: { files: 0, events: 0, invalidLines: 0, invalidTimestamps: 0, unreadableFiles: 0, truncated: false, unpairedEvents: 0, ambiguousPairs: 0, clockConflicts: 0 },
    status: 'no-evidence',
    firstTokenStatus: 'unrecorded',
    firstTokenMs: null,
  };
}
const caches = new WeakMap<HarnessStudioState, Cache>();
export async function sessionPerformanceRoute(request: IncomingMessage, response: ServerResponse, state: HarnessStudioState, options: HarnessStudioServerOptions): Promise<boolean> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname !== '/api/session-performance' && !url.pathname.startsWith('/api/session-performance/')) return false;
  const send = (status: number, body: unknown): void => respondJson(response, status, body, { 'Cache-Control': 'no-store' });
  if (!sameOriginRequest(request) || request.headers['sec-fetch-site'] === 'cross-site') { send(403, { error: 'Same-origin request required' }); return true; }
  if (request.method !== 'GET') { send(405, { error: 'Method not allowed' }); return true; }
  const revision = state.projectRevision, projectId = state.activeProjectId, workspace = state.workspace?.localDirectory;
  if (!workspace || !projectId || request.headers['x-harness-project-id'] !== projectId || request.headers['x-harness-project-revision'] !== String(revision)) {
    send(409, { error: 'project-changed' }); return true;
  }
  if (state.workspace?.scanRequired) { send(409, { error: 'project-scan-required' }); return true; }
  if ([...url.searchParams.keys()].some(k => !['refresh', 'source', 'line'].includes(k))) { send(400, { error: 'unsupported-parameter' }); return true; }
  // A Session id is one path segment the browser percent-encodes, so a
  // provider-namespaced id (`claude:<uuid>`) arrives escaped and must be
  // decoded before it can be recognized or matched against the workspace.
  let sessionId: string;
  try { sessionId = decodeURIComponent(url.pathname.slice('/api/session-performance'.length + 1)); }
  catch { send(400, { error: 'invalid-session-id' }); return true; }
  if (sessionId && (!/^[a-zA-Z0-9_:.-]{1,160}$/u.test(sessionId) || sessionId === '.' || sessionId === '..')) { send(400, { error: 'invalid-session-id' }); return true; }
  const workspaceSession = sessionId ? state.workspace?.sessions.get(sessionId) : undefined;
  // A workspace-discovered Session from an Agent the native host cannot read is
  // reported as having no timing evidence rather than sent to a reader that
  // would not find it.
  if (workspaceSession && !TIMED_PROVIDERS.has(workspaceSession.summary.provider ?? '')) {
    send(200, { schemaVersion: 1, engine: 'rust', session: workspaceSessionTiming(workspaceSession.summary), turns: [], spans: [], totalSpans: 0, omittedSpans: 0 });
    return true;
  }
  const source = url.searchParams.get('source');
  const lineText = url.searchParams.get('line');
  const line = Number(lineText);
  if ((source !== null || lineText !== null) && (!sessionId || !source || source.length > 1024 || !/^[1-9][0-9]*$/u.test(lineText ?? '') || !Number.isSafeInteger(line) || line > 1_000_000)) {
    send(400, { error: 'invalid-source-reference' }); return true;
  }
  const provider = options.sessionPerformanceProvider;
  if (!provider) { send(503, { error: 'native-performance-unavailable' }); return true; }
  let cache = caches.get(state);
  if (!cache || cache.revision !== revision) { cache = { revision, entries: new Map() }; caches.set(state, cache); }
  try {
    if (source) {
      const result = await provider.analyzeSessionPerformance({ workspace, ...(options.sessionPerformanceHome ? { qoderHome: options.sessionPerformanceHome } : {}), sessionId, source: { source, line } });
      if (state.projectRevision !== revision || state.activeProjectId !== projectId) { send(409, { error: 'project-changed' }); return true; }
      if (!isPerformanceSource(result) || result.source !== source || result.line !== line) { send(502, { error: 'invalid-source-response' }); return true; }
      send(200, result); return true;
    }
    const key = sessionId || 'catalog';
    let entry = cache.entries.get(key);
    if (!entry || Date.now() - entry.at > 15000 || url.searchParams.get('refresh') === 'true') {
      if (cache.entries.size >= 10) cache.entries.delete(cache.entries.keys().next().value!);
      const result = provider.analyzeSessionPerformance({ workspace, ...(options.sessionPerformanceHome ? { qoderHome: options.sessionPerformanceHome } : {}), ...(sessionId ? { sessionId } : { maxSessions: 200 }) });
      entry = { at: Date.now(), result }; cache.entries.set(key, entry);
      void result.catch(() => { if (cache.entries.get(key) === entry) cache.entries.delete(key); });
    }
    const result = await entry.result;
    if (state.projectRevision !== revision || state.activeProjectId !== projectId) { send(409, { error: 'project-changed' }); return true; }
    if (!isPerformanceResult(result, !!sessionId)) { send(502, { error: 'invalid-performance-response' }); return true; }
    if (!sessionId && state.workspace) {
      const sessions = result.sessions as TimingSession[];
      const known = new Set(sessions.map((s) => typeof s.id === 'string' ? s.id : ''));
      for (const stored of state.workspace.sessions.values()) {
        if (sessions.length >= 500) break;
        if (known.has(stored.summary.id)) continue;
        // Qoder sessions carry a bare id in the native catalog, so a workspace
        // entry for one would be a duplicate under a `qoder:` id rather than a
        // second Session. Timed Agents that the native reader did discover are
        // already excluded by id above; one it could not reach still belongs in
        // the catalog, stated as having no timing evidence.
        if (stored.summary.provider === 'qoder') continue;
        sessions.push(workspaceSessionTiming(stored.summary));
        known.add(stored.summary.id);
      }
      sessions.sort((a, b) => {
        const aMs = typeof a.lastActivityMs === 'number' ? a.lastActivityMs : (typeof a.longestMs === 'number' ? a.longestMs : 0);
        const bMs = typeof b.lastActivityMs === 'number' ? b.lastActivityMs : (typeof b.longestMs === 'number' ? b.longestMs : 0);
        return bMs - aMs || String(a.id).localeCompare(String(b.id));
      });
    }
    send(200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    // A Session the workspace listed but the timing reader cannot locate still
    // exists for the reader; report it as unmeasured rather than as a failure.
    if (workspaceSession && !source && message.includes('not-found')) {
      send(200, { schemaVersion: 1, engine: 'rust', session: workspaceSessionTiming(workspaceSession.summary), turns: [], spans: [], totalSpans: 0, omittedSpans: 0 });
      return true;
    }
    send(message.includes('source-scan-limit') ? 413 : message.includes('invalid-source') ? 400 : message.includes('not-found') ? 404 : message.includes('unknown method') ? 503 : 502, { error: 'performance-analysis-failed' });
  }
  return true;
}
