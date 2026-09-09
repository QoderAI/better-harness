import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HarnessStudioServerOptions, HarnessStudioState } from './studio-types.js';
import { respondJson, sameOriginRequest } from './http-utils.js';
import { isPerformanceResult, isPerformanceSource } from '../contracts/session-performance.js';

type Cache = { revision: number; entries: Map<string, { at: number; result: Promise<Record<string, unknown>> }> };
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
  const sessionId = url.pathname.slice('/api/session-performance'.length + 1);
  if (sessionId && (!/^[a-zA-Z0-9_.-]{1,160}$/u.test(sessionId) || sessionId === '.' || sessionId === '..')) { send(400, { error: 'invalid-session-id' }); return true; }
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
    send(200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    send(message.includes('source-scan-limit') ? 413 : message.includes('invalid-source') ? 400 : message.includes('not-found') ? 404 : message.includes('unknown method') ? 503 : 502, { error: 'performance-analysis-failed' });
  }
  return true;
}
