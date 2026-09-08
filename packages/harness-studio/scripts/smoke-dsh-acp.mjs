// Keyless native DSH control-plane smoke. Never prompts a model or installs DSH.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const command = process.env.DSH_ACP_COMMAND ?? 'dsh';
const args = process.env.DSH_ACP_ARGS ? JSON.parse(process.env.DSH_ACP_ARGS) : ['--profile', 'acp'];
assert.ok(Array.isArray(args) && args.every(item => typeof item === 'string'));
const cwd = await mkdtemp(join(tmpdir(), 'studio-dsh-control-'));
const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
let sequence = 0, stderr = '';
const pending = new Map();
const lines = createInterface({ input: child.stdout });
const rejectAll = error => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); } pending.clear(); };
child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4096); });
child.on('error', rejectAll);
const exited = new Promise(resolve => child.once('close', code => { rejectAll(new Error(`DSH exited (${code}): ${stderr}`)); resolve(code); }));
lines.on('line', line => {
  let frame;
  try { frame = JSON.parse(line); } catch { rejectAll(new Error('DSH stdout is not JSON-RPC')); child.kill(); return; }
  const item = pending.get(frame.id);
  if (!item) return;
  clearTimeout(item.timer); pending.delete(frame.id);
  if (frame.error) item.reject(new Error(JSON.stringify(frame.error)));
  else item.resolve(frame.result);
});
function request(method, params) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}
const watchdog = setTimeout(() => { rejectAll(new Error('DSH smoke deadline')); child.kill('SIGKILL'); }, 60000);
try {
  const hello = await request('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'better-harness-dsh-smoke', version: '1' } });
  assert.equal(hello.protocolVersion, 1);
  assert.ok(hello.agentCapabilities?.sessionCapabilities?.resume);
  const session = await request('session/new', { cwd, mcpServers: [] });
  assert.equal(typeof session.sessionId, 'string');
  assert.ok(Array.isArray(session.configOptions));
  const model = session.configOptions.find(option => option.id === 'model');
  if (model) {
    const changed = await request('session/set_config_option', { sessionId: session.sessionId, configId: model.id, value: model.currentValue });
    assert.ok(changed.configOptions.some(option => option.id === model.id && option.currentValue === model.currentValue));
  }
  await request('session/close', { sessionId: session.sessionId });
  const listed = await request('session/list', { cwd });
  assert.ok(listed.sessions.some(item => item.sessionId === session.sessionId));
  const restored = await request('session/resume', { sessionId: session.sessionId, cwd, mcpServers: [] });
  assert.ok(Array.isArray(restored.configOptions));
  await request('session/close', { sessionId: session.sessionId });
  child.stdin.end();
  assert.equal(await exited, 0);
  process.stdout.write(`${JSON.stringify({ kind: 'studio.dsh-control-smoke.v1', passed: true, initialize: true, create: true, configuration: Boolean(model), list: true, resume: true, close: true, modelPrompt: false })}\n`);
} finally {
  clearTimeout(watchdog); rejectAll(new Error('Smoke closed')); lines.close();
  if (child.exitCode === null) { child.kill('SIGKILL'); await exited; }
  await rm(cwd, { recursive: true, force: true });
}
