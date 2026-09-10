import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { startHarnessStudioServer, type StartedHarnessStudioServer } from '../src/server/server.js';
import { isPerformanceResult, isPerformanceSource } from '../src/contracts/session-performance.js';
import { parseStudioLocation, studioLocationHash } from '../src/app/shell/project-routing.js';

const empty = { schemaVersion: 1, engine: 'rust', provider: 'qoder', status: 'no-evidence', sessions: [], coverage: { discoveredSessions: 0, omittedSessions: 0, directoryLimitReached: false, unreadableDirectories: 0 } };
let server: StartedHarnessStudioServer | undefined;
let root: string | undefined;
afterEach(async () => { await server?.close(); server = undefined; if (root) await rm(root, { recursive: true, force: true }); });
async function start(options?: { provider?: (params: Record<string, unknown>) => Promise<Record<string, unknown>>; workspaceSessions?: unknown[] }) {
  root = await mkdtemp(join(tmpdir(), 'performance-api-'));
  await writeFile(join(root, 'index.html'), '<!doctype html>');
  const workspace = join(root, 'project'); await mkdir(workspace);
  server = await startHarnessStudioServer({ appDir: root, port: 0, workspaceDirectoryPicker: async () => workspace,
    workspaceSessionProvider: { discover: async () => ({ label: 'fixture', sessions: options?.workspaceSessions ?? [] }) },
    ...(options?.provider ? { sessionPerformanceProvider: { analyzeSessionPerformance: options.provider } } : {}), sessionPerformanceHome: join(root, 'qoder') });
  await fetch(`${server.url}/api/projects/open`, { method: 'POST' });
  const config = await (await fetch(`${server.url}/api/config`)).json();
  return { url: `${server.url}/api/session-performance`, headers: { 'x-harness-project-id': config.activeProjectId, 'x-harness-project-revision': String(config.projectRevision) }, workspace };
}
it('binds timing to the active project, caches reads and rejects browser host paths', async () => {
  const calls: Record<string, unknown>[] = [];
  const { url, headers, workspace } = await start({ provider: async params => { calls.push(params); return empty; } });
  expect((await fetch(url)).status).toBe(409);
  expect((await fetch(url, { headers: { ...headers, origin: 'https://foreign.example' } })).status).toBe(403);
  expect((await fetch(`${url}?qoderHome=elsewhere`, { headers })).status).toBe(400);
  expect((await fetch(`${url}/invalid%2Fid`, { headers })).status).toBe(400);
  expect((await fetch(url, { method: 'POST', headers })).status).toBe(405);
  expect(await (await fetch(url, { headers })).json()).toEqual(empty);
  await fetch(url, { headers }); expect(calls).toHaveLength(1);
  expect(calls[0]?.workspace).toBe(await realpath(workspace));
  expect(calls[0]?.qoderHome).toBe(join(root!, 'qoder'));
  await fetch(`${url}?refresh=true`, { headers }); expect(calls).toHaveLength(2);
});
it('exposes missing native capability explicitly', async () => { const { url, headers } = await start(); expect((await fetch(url, { headers })).status).toBe(503); });
it('rejects incompatible native output', async () => { const { url, headers } = await start({ provider: async () => ({ ...empty, schemaVersion: 999 }) }); expect((await fetch(url, { headers })).status).toBe(502); });
it('discards a response when the project revision changes during analysis', async () => {
  let release!: (value: Record<string, unknown>) => void;
  let entered!: () => void;
  const began = new Promise<void>(resolve => { entered = resolve; });
  const { url, headers } = await start({ provider: async () => { entered(); return await new Promise(resolve => { release = resolve; }); } });
  const pending = fetch(url, { headers }); await began;
  await fetch(`${server!.url}/api/projects/open`, { method: 'POST' });
  release(empty); expect((await pending).status).toBe(409);
});
it('preserves nested project route and rejects unsupported schema shapes', () => {
  const projectId = `project_${'a'.repeat(32)}`;
  expect(studioLocationHash({ projectId, area: 'session-performance' })).toBe(`#/projects/${projectId}/sessions/performance`);
  expect(parseStudioLocation(`#/projects/${projectId}/sessions/performance?session=one`, new Set(['sessions','session-performance']))).toEqual({ projectId, area: 'session-performance' });
  expect(isPerformanceResult(empty, false)).toBe(true);
  expect(isPerformanceResult({ ...empty, sessions: [{}] }, false)).toBe(false);
  expect(isPerformanceResult({ ...empty, engine: 'javascript' }, false)).toBe(false);
  const timed = { breakdown: { totalMs: 1, activityTotalMs: 1, segments: [] },
    id: 'claude:x', provider: 'claude', label: 'x', firstSeenMs: 1, lastSeenMs: 1, lastActivityMs: 1,
    wallMs: 1, completedTurnMs: null, timedUnionMs: null, unattributedTurnMs: null, longestMs: 1,
    turnCount: 0, toolCount: 0, retryCount: 0, metrics: [], findings: [], firstTokenStatus: 'unrecorded',
    usage: { inputTokens: null, outputTokens: null, cacheReadInputTokens: null, cacheCreationInputTokens: null,
      reasoningOutputTokens: null, totalTokens: null, countedRequests: 0, contextWindow: null, models: [], basis: 'unrecorded' },
    subagents: { count: 0, timedCount: 0, cumulativeMs: null, elapsedMs: null, maxMs: null, peakConcurrency: 0, unlinkedCount: 0, unlinkedTurnCount: 0 },
    coverage: { files: 0, events: 0, invalidLines: 0, invalidTimestamps: 0, unreadableFiles: 0, truncated: false, unpairedEvents: 0, ambiguousPairs: 0, clockConflicts: 0 },
    status: 'ok' };
  expect(isPerformanceResult({ ...empty, provider: 'multi', sessions: Array.from({ length: 500 }, (_, i) => ({ ...timed, id: `claude:x${i}` })) }, false)).toBe(true);
  expect(isPerformanceResult({ ...empty, provider: 'multi', sessions: Array.from({ length: 501 }, (_, i) => ({ ...timed, id: `claude:x${i}` })) }, false)).toBe(false);
});
it('reports an older native host as unavailable', async () => { const { url, headers } = await start({ provider: async () => { throw new Error('unknown method sessions.performance'); } }); expect((await fetch(url, { headers })).status).toBe(503); });

it('reads a bounded source window without running catalog or detail analysis', async () => {
  const calls: Record<string, unknown>[] = [];
  const source = { schemaVersion: 1, engine: 'rust', source: '1/segments/a.jsonl', line: 44, startLine: 43, content: '{}\n{}\n{}', truncated: false, scannedBytes: 1000 };
  const { url, headers } = await start({ provider: async params => { calls.push(params); return source; } });
  const query = new URLSearchParams({ source: source.source, line: '44' });
  expect(await (await fetch(`${url}/sample?${query}`, { headers })).json()).toEqual(source);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ sessionId: 'sample', source: { source: source.source, line: 44 } });
  for (const suffix of ['?line=44', '?source=x', '?source=x&line=-1', '?source=x&line=1000001']) {
    expect((await fetch(`${url}/sample${suffix}`, { headers })).status).toBe(400);
  }
  expect(isPerformanceSource({ ...source, startLine: 45 })).toBe(false);
  expect(isPerformanceSource({ ...source, content: '{}\n'.repeat(8) })).toBe(false);
  expect(isPerformanceSource({ ...source, content: 'x'.repeat(60001) })).toBe(false);
});
it('discards source responses after project changes', async () => {
  let release!: (value: Record<string, unknown>) => void;
  let entered!: () => void;
  const began = new Promise<void>(resolve => { entered = resolve; });
  const { url, headers } = await start({ provider: async () => { entered(); return await new Promise(resolve => { release = resolve; }); } });
  const pending = fetch(`${url}/sample?source=1%2Fsegments%2Fa.jsonl&line=44`, { headers });
  await began;
  await fetch(`${server!.url}/api/projects/open`, { method: 'POST' });
  release({}); expect((await pending).status).toBe(409);
});

it('reports the native source scan limit without returning a log', async () => {
  const { url, headers } = await start({ provider: async () => { throw new Error('source-scan-limit'); } });
  const response = await fetch(`${url}/sample?source=1%2Fsegments%2Fa.jsonl&line=44`, { headers });
  expect(response.status).toBe(413);
});

function fixtureSession(id: string, provider: string) {
  return {
    summary: { id, savedAt: '2026-09-08T10:00:00.000Z', prompt: `${provider} fixture`, status: 'observed', toolCallCount: 0, provider },
    debugger: { id, name: id, agent: provider, protocol: provider, connection: 'observed', mode: 'Retained run', startedAt: '10:00:00', finishedAt: '10:00:00', events: [] },
  };
}

// The browser sends one percent-encoded path segment, so a provider-namespaced
// id only reaches the reader if the route decodes it.
it('reads a provider-prefixed session id exactly as the browser encodes it', async () => {
  const asked: Record<string, unknown>[] = [];
  const detail = { schemaVersion: 1, engine: 'rust', totalSpans: 0, omittedSpans: 0, turns: [], spans: [],
    session: { breakdown: { totalMs: 4200, activityTotalMs: 4200, segments: [] },
      id: 'claude:abc123', provider: 'claude', label: 'Fix the startup', firstSeenMs: 1, lastSeenMs: 2, lastActivityMs: 2,
      wallMs: 4200, completedTurnMs: null, timedUnionMs: null, unattributedTurnMs: null, longestMs: 4200,
      turnCount: 1, toolCount: 0, retryCount: 0, metrics: [], findings: [], firstTokenStatus: 'recorded', firstTokenMs: 640,
      usage: { inputTokens: 120, outputTokens: 45, cacheReadInputTokens: null, cacheCreationInputTokens: null,
        reasoningOutputTokens: null, totalTokens: 165, countedRequests: 1, contextWindow: 200000,
        models: [{ model: 'claude-opus-5', requests: 1, durationMs: 4200, outputTokens: 45, inputTokens: 120 }], basis: 'per-request' },
      subagents: { count: 0, timedCount: 0, cumulativeMs: null, elapsedMs: null, maxMs: null, peakConcurrency: 0, unlinkedCount: 0, unlinkedTurnCount: 0 },
      coverage: { files: 1, events: 4, invalidLines: 0, invalidTimestamps: 0, unreadableFiles: 0, truncated: false, unpairedEvents: 0, ambiguousPairs: 0, clockConflicts: 0 },
      status: 'ok' } };
  const { url, headers } = await start({
    provider: async params => { asked.push(params); return detail as unknown as Record<string, unknown>; },
    workspaceSessions: [fixtureSession('claude:abc123', 'claude')],
  });
  const response = await fetch(`${url}/${encodeURIComponent('claude:abc123')}`, { headers });
  expect(response.status).toBe(200);
  expect((await response.json()).session.breakdown.totalMs).toBe(4200);
  expect(asked.at(-1)?.sessionId).toBe('claude:abc123');
});

it('states no timing evidence for an agent the native reader cannot read', async () => {
  const { url, headers } = await start({ provider: async () => empty, workspaceSessions: [fixtureSession('cursor:abc123', 'cursor')] });
  const detail = await (await fetch(`${url}/${encodeURIComponent('cursor:abc123')}`, { headers })).json();
  expect(detail.session.status).toBe('no-evidence');
  expect(detail.session.provider).toBe('cursor');
  expect(detail.session.lastActivityMs).toBeGreaterThan(0);
});

// A timed Agent whose transcript the reader cannot locate is still a Session
// the reader can see; it must not read as a failed request.
it('falls back to no-evidence when a timed session is missing from the native reader', async () => {
  const { url, headers } = await start({
    provider: async params => { if (params.sessionId) throw new Error('session-timing-not-found'); return empty; },
    workspaceSessions: [fixtureSession('claude:gone123', 'claude')],
  });
  const response = await fetch(`${url}/${encodeURIComponent('claude:gone123')}`, { headers });
  expect(response.status).toBe(200);
  expect((await response.json()).session.status).toBe('no-evidence');
  expect((await (await fetch(`${url}/${encodeURIComponent('claude:unknown9')}`, { headers })).json()).error).toBe('performance-analysis-failed');
});

it('does not duplicate Qoder workspace sessions in the performance catalog', async () => {
  const qoderWorkspace = {
    summary: { id: 'qoder:qod123', savedAt: '2026-09-08T10:00:00.000Z', prompt: 'Qoder workspace fixture', status: 'observed', toolCallCount: 0, provider: 'qoder' },
    debugger: { id: 'qoder:qod123', name: 'qoder:qod123', agent: 'qoder', protocol: 'qoder', connection: 'observed', mode: 'Retained run', startedAt: '10:00:00', finishedAt: '10:00:00', events: [] },
  };
  const codexWorkspace = {
    summary: { id: 'codex:cod123', savedAt: '2026-09-08T10:00:00.000Z', prompt: 'Codex fixture', status: 'observed', toolCallCount: 0, provider: 'codex' },
    debugger: { id: 'codex:cod123', name: 'codex:cod123', agent: 'codex', protocol: 'codex', connection: 'observed', mode: 'Retained run', startedAt: '10:00:00', finishedAt: '10:00:00', events: [] },
  };
  const { url, headers } = await start({ provider: async () => empty, workspaceSessions: [qoderWorkspace, codexWorkspace] });
  const catalog = await (await fetch(url, { headers })).json();
  const ids = catalog.sessions.map((s: { id: string }) => s.id);
  expect(ids).toContain('codex:cod123');
  expect(ids).not.toContain('qoder:qod123');
});
