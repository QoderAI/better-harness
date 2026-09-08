import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHarnessStudioServer } from '../../../dist/server/server.js';

export async function startSharedScopeFixture() {
  const workspace = await mkdtemp(join(tmpdir(), 'studio-shared-scope-'));
  await mkdir(join(workspace, 'outputs'));
  const records = [
    { id: 'codex:recent', savedAt: new Date().toISOString(), prompt: 'Review current workflow', resource: 'outputs/current.md' },
    { id: 'codex:old', savedAt: '2000-01-01T12:00:00.000Z', prompt: 'Review archived workflow', resource: 'outputs/archived.md' },
  ];
  for (const record of records) await writeFile(join(workspace, record.resource), `# ${record.prompt}\n\nRetained project output.\n`);
  const inspectorReport = {
    kind: 'HarnessInspectorReportV1', workspace: { name: 'Scope fixture' },
    sessions: records.map(record => ({ sessionId: record.id, platform: 'Codex', firstSeen: record.savedAt,
      lastSeen: record.savedAt, prompts: [{ text: record.prompt, timestamp: record.savedAt }], toolCallCount: 1,
      toolActivity: { totalCalls: 1, calls: [] } })),
    days: records.map(record => ({ date: record.savedAt.slice(0, 10), sessionIds: [record.id], commitHashes: [] })),
    commits: [], stories: [], featureTree: { roots: [], nodes: [] },
  };
  let cancel = false;
  let pickerCalls = 0;
  const studio = await startHarnessStudioServer({
    appDir: resolve(dirname(fileURLToPath(import.meta.url)), '../../../dist/app'), port: 0,
    workspaceDirectoryPicker: async () => { pickerCalls += 1; return cancel ? undefined : workspace; },
    workspaceSessionProvider: { discover: async () => ({ label: 'Scope fixture', inspectorReport,
      providers: [{ provider: 'codex', status: 'ok', discovered: 2, included: 2 }],
      sessions: records.map(record => ({ summary: { ...record, status: 'observed', toolCallCount: 1, provider: 'Codex' },
        debugger: { id: record.id, name: record.prompt, agent: 'Codex', protocol: 'fixture', connection: 'observed', mode: 'Retained run',
          startedAt: '12:00:00', finishedAt: '12:00:01', events: [{ id: `${record.id}-write`, kind: 'change', phase: 'Change', title: 'Write output',
            summary: 'Retained output', timestamp: '12:00:00', relativeTime: 'retained', stopConditions: [], evidence: [],
            toolCalls: [{ id: `${record.id}-tool`, name: 'Write', summary: 'Write output', input: '', output: '', duration: '1 ms', resource: record.resource }],
            rawAcp: { direction: 'Agent → Client', method: 'session/tool-call', rpcId: record.id, sessionId: record.id, traceContext: 'fixture', payload: {} } }] } })) }) },
  });
  return { ...studio, get pickerCalls() { return pickerCalls; }, setCancel(value) { cancel = value; },
    async close() { await studio.close(); await rm(workspace, { recursive: true, force: true }); } };
}
