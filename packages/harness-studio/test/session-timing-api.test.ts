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
async function start(provider?: (params: Record<string, unknown>) => Promise<Record<string, unknown>>) {
  root = await mkdtemp(join(tmpdir(), 'performance-api-'));
  await writeFile(join(root, 'index.html'), '<!doctype html>');
  const workspace = join(root, 'project'); await mkdir(workspace);
  server = await startHarnessStudioServer({ appDir: root, port: 0, workspaceDirectoryPicker: async () => workspace,
    workspaceSessionProvider: { discover: async () => ({ label: 'fixture', sessions: [] }) },
    ...(provider ? { sessionPerformanceProvider: { analyzeSessionPerformance: provider } } : {}), sessionPerformanceHome: join(root, 'qoder') });
  await fetch(`${server.url}/api/projects/open`, { method: 'POST' });
  const config = await (await fetch(`${server.url}/api/config`)).json();
  return { url: `${server.url}/api/session-performance`, headers: { 'x-harness-project-id': config.activeProjectId, 'x-harness-project-revision': String(config.projectRevision) }, workspace };
}
it('binds timing to the active project, caches reads and rejects browser host paths', async () => {
  const calls: Record<string, unknown>[] = [];
  const { url, headers, workspace } = await start(async params => { calls.push(params); return empty; });
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
it('rejects incompatible native output', async () => { const { url, headers } = await start(async () => ({ ...empty, schemaVersion: 999 })); expect((await fetch(url, { headers })).status).toBe(502); });
it('discards a response when the project revision changes during analysis', async () => {
  let release!: (value: Record<string, unknown>) => void;
  let entered!: () => void;
  const began = new Promise<void>(resolve => { entered = resolve; });
  const { url, headers } = await start(async () => { entered(); return await new Promise(resolve => { release = resolve; }); });
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
});
it('reports an older native host as unavailable', async () => { const { url, headers } = await start(async () => { throw new Error('unknown method sessions.performance'); }); expect((await fetch(url, { headers })).status).toBe(503); });

it('reads a bounded source window without running catalog or detail analysis', async () => {
  const calls: Record<string, unknown>[] = [];
  const source = { schemaVersion: 1, engine: 'rust', source: '1/segments/a.jsonl', line: 44, startLine: 43, content: '{}\n{}\n{}', truncated: false, scannedBytes: 1000 };
  const { url, headers } = await start(async params => { calls.push(params); return source; });
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
  const { url, headers } = await start(async () => { entered(); return await new Promise(resolve => { release = resolve; }); });
  const pending = fetch(`${url}/sample?source=1%2Fsegments%2Fa.jsonl&line=44`, { headers });
  await began;
  await fetch(`${server!.url}/api/projects/open`, { method: 'POST' });
  release({}); expect((await pending).status).toBe(409);
});

it('reports the native source scan limit without returning a log', async () => {
  const { url, headers } = await start(async () => { throw new Error('source-scan-limit'); });
  const response = await fetch(`${url}/sample?source=1%2Fsegments%2Fa.jsonl&line=44`, { headers });
  expect(response.status).toBe(413);
});
