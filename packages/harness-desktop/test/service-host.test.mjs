import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { connectStudioService } from '../src/service-host.mjs';
import { isStudioUrl, isExternalUrl, isSameOrigin, message } from '../src/protocol.mjs';

class Child extends EventEmitter {
  sent = [];
  killed = false;
  postMessage(data) { this.sent.push(data); }
  kill() { this.killed = true; this.emit('exit', 1); }
}
const setup = (overrides = {}) => {
  const child = new Child();
  const failures = [];
  const service = connectStudioService(child, {
    token: 'a'.repeat(64), dataDirectory: 'test-data', pickDirectory: async () => undefined,
    onFailure: (error) => failures.push(error), ...overrides,
  });
  return { child, service, failures };
};
const ready = (child) => child.emit('message', message('ready', { url: 'http://127.0.0.1:3311' }));

test('only a credential-free ephemeral IPv4 loopback origin can become the Studio URL', () => {
  assert.equal(isStudioUrl('http://127.0.0.1:3311'), true);
  for (const value of ['file:///tmp/a', 'http://evil.test:3311', 'http://127.0.0.1', 'http://u:p@127.0.0.1:3311', 'http://127.0.0.1:3311/path']) assert.equal(isStudioUrl(value), false);
  assert.equal(isSameOrigin('http://127.0.0.1:3311/api/config', 'http://127.0.0.1:3311'), true);
  assert.equal(isSameOrigin('http://127.0.0.1:3312/api/config', 'http://127.0.0.1:3311'), false);
  for (const value of ['file:///a', 'javascript:alert(1)', 'vscode://test', 'garbage']) assert.equal(isExternalUrl(value), false);
  assert.equal(isExternalUrl('https://example.com'), true);
});

test('startup sends the versioned contract and returns the validated ready result', async () => {
  const { child, service } = setup();
  assert.equal(child.sent[0].type, 'start');
  assert.equal(child.sent[0].version, 1);
  ready(child);
  assert.equal((await service.started).url, 'http://127.0.0.1:3311');
  const stopping = service.stop();
  assert.equal(service.stop(), stopping);
  child.emit('exit', 0);
  await stopping;
});

test('picker selection, cancellation and failure always settle the matching request', async () => {
  for (const outcome of ['/workspace', undefined, new Error('dialog failed')]) {
    const { child, service } = setup({ pickDirectory: async () => { if (outcome instanceof Error) throw outcome; return outcome; } });
    ready(child);
    await service.started;
    child.emit('message', message('pick-directory', { id: 4 }));
    await new Promise(setImmediate);
    const result = child.sent.at(-1);
    assert.equal(result.id, 4);
    assert.equal(result.type, 'directory-result');
    if (outcome instanceof Error) assert.equal(typeof result.error, 'string');
    else assert.equal(result.path, outcome);
    const stop = service.stop(); child.emit('exit', 0); await stop;
  }
});

test('startup crash and invalid ready URL reject instead of hanging', async () => {
  for (const invalid of [false, true]) {
    const { child, service } = setup();
    if (invalid) child.emit('message', message('ready', { url: 'https://evil.test' }));
    else child.emit('exit', 2);
    await assert.rejects(service.started);
  }
});

test('startup timeout kills the service and rejects', async () => {
  const { child, service } = setup({ startupTimeout: 5 });
  await assert.rejects(service.started, /timed out/);
  assert.equal(child.killed, true);
});

test('unexpected post-start exit is reported and stalled shutdown is killed', async () => {
  const first = setup(); ready(first.child); await first.service.started;
  first.child.emit('exit', 3);
  assert.equal(first.failures.length, 1);
  const second = setup({ shutdownTimeout: 5 }); ready(second.child); await second.service.started;
  await second.service.stop();
  assert.equal(second.child.killed, true);
  assert.equal(second.failures.length, 0);
});
