import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Raw Qoder events, processed by the actual Rust executable in browser tests. */
export async function writePerformanceFixture(root) {
  const workspace = join(root, 'project'); await mkdir(workspace, { recursive: true });
  const canonical = await realpath(workspace);
  const home = join(root, 'qoder');
  const slug = canonical.replaceAll('\\', '/').replace(/[^a-zA-Z0-9_-]/gu, '-');
  const base = Date.parse('2026-09-08T09:00:00Z');
  const events = [];
  const add = (type, ms, turn_id = 'main', tool_call_id = '', data = {}, request_id = '') => events.push({ type, ts: new Date(base + ms).toISOString(), turn_id, tool_call_id, request_id, loop_id: turn_id, data });
  add('turn.started', 0);
  add('tool.requested', 100, 'main', 'bash', { tool_name: 'Bash' });
  add('hook.started', 345092, 'main', 'bash', { hook_name: 'PreToolUse:Bash', hook_event_name: 'PreToolUse', source: 'user' });
  add('hook.finished', 346228, 'main', 'bash', { hook_name: 'PreToolUse:Bash', hook_event_name: 'PreToolUse', source: 'user', duration_ms: 1136 });
  add('tool.shell.started', 348249, 'main', 'bash');
  add('tool.shell.finished', 348357, 'main', 'bash', { exit_code: 0 });
  add('tool.execution.finished', 349282, 'main', 'bash', { tool_name: 'Bash' });
  add('tool.requested', 1000, 'main', 'agent-a', { tool_name: 'Agent' });
  add('turn.started', 2000, 'child-a', '', { is_subagent: true });
  add('model.request.started', 2100, 'child-a', '', { model: 'performance', request_index: 1 }, 'child-model');
  add('model.response.completed', 52000, 'child-a', '', { model: 'performance', request_index: 1 }, 'child-model');
  add('turn.finished', 53000, 'child-a');
  add('tool.execution.finished', 55000, 'main', 'agent-a', { tool_name: 'Agent' });
  add('tool.requested', 40000, 'main', 'agent-b', { tool_name: 'Agent' });
  add('tool.execution.finished', 70000, 'main', 'agent-b', { tool_name: 'Agent' });
  for (let i=0; i<240; i++) {
    add('model.request.started', 350000 + i*500, 'main', '', { model: `model-${i}`, request_index: i+2 }, `request-${i}`);
    add('model.response.completed', 350400 + i*500, 'main', '', { model: `model-${i}`, request_index: i+2 }, `request-${i}`);
  }
  add('model.request.attempt_failed', 51900, 'child-a', '', { error_name: 'NetworkAttemptError', attempt: 1, will_retry: true });
  add('turn.finished', 480000);
  add('session.ended', 86400000);
  events.sort((a,b) => a.ts.localeCompare(b.ts));
  const dir = join(home, 'logs', 'sessions', slug, 'slow-session', 'segments'); await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'timing.jsonl'), events.map((event, index) => JSON.stringify({ ...event, seq: index })).join('\n')+'\n');
  for (let i=0; i<44; i++) {
    const other = join(home, 'logs', 'sessions', slug, `small-${i}`, 'segments'); await mkdir(other, { recursive: true });
    await writeFile(join(other, 'timing.jsonl'), [ { type: 'turn.started', ts: new Date(base+i).toISOString(), turn_id: 'one' }, { type:'turn.finished', ts: new Date(base+100+i).toISOString(), turn_id:'one' } ].map(v => JSON.stringify(v)).join('\n'));
  }
  return { workspace: canonical, home };
}
