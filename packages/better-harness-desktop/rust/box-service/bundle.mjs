// Build and exercise this crate's NSXPC bundle on its own, without running the
// whole desktop Rust build.
//
//   node rust/box-service/bundle.mjs          # build + bundle + sign
//   node rust/box-service/bundle.mjs --smoke  # ...then boot a VM through it
//
// `scripts/rust.mjs` does the same staging as part of the desktop build. The
// bundle layout itself lives in `scripts/nsxpc-bundle.mjs` beside the other
// three services, so the `ServiceType: User` this one depends on cannot drift
// between the two callers.

import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installBoxXpc } from '../../scripts/nsxpc-bundle.mjs';

const crate = resolve(dirname(fileURLToPath(import.meta.url)));
const desktop = resolve(crate, '..', '..');
const appPath = join(desktop, 'dist', 'native', 'Harness Box.app');

if (process.platform !== 'darwin') throw new Error('The NSXPC bundle is macOS-only');

execFileSync('cargo', ['+1.96.0', 'build', '--release', '--manifest-path', join(crate, 'Cargo.toml')],
  { stdio: 'inherit' });

const binaries = join(crate, 'target', 'release');
await rm(appPath, { recursive: true, force: true });
await installBoxXpc(appPath, binaries, { development: true });
// No entitlements: BoxLite ad-hoc signs its own shim with the hypervisor one.
execFileSync('codesign', ['--force', '--sign', '-', '--deep', appPath], { stdio: 'inherit' });
const client = join(appPath, 'Contents', 'MacOS', 'harness-box-client');
console.log(`\nbundled ${appPath}\nbridge  ${client}`);

if (!process.argv.includes('--smoke')) process.exit(0);

// Drive the bridge the way Studio would. Each request waits for its own reply:
// the host dispatches concurrently, so send order is not reply order.
const { spawn } = await import('node:child_process');
const bridge = spawn(client, { stdio: ['pipe', 'pipe', 'inherit'] });
let id = 0;
const pending = new Map();
let buffer = '';
bridge.stdout.on('data', (chunk) => {
  buffer += chunk;
  for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (!line.trim()) continue;
    const frame = JSON.parse(line);
    if (frame.event) { console.log('  event', JSON.stringify(frame.event)); continue; }
    pending.get(frame.id)?.(frame);
    pending.delete(frame.id);
  }
});
const call = (method, params) => new Promise((done) => {
  const frame = { version: 1, id: ++id, method, ...(params ? { params } : {}) };
  pending.set(frame.id, done);
  bridge.stdin.write(`${JSON.stringify(frame)}\n`);
});

const show = (label, frame) => console.log(`${label}:`, JSON.stringify(frame.result ?? frame.error));
show('describe', await call('host.describe'));
show('create', await call('box.create', { name: 'harness-xpc-smoke', image: 'alpine:latest' }));
show('start', await call('box.start', { name: 'harness-xpc-smoke' }));
show('exec', await call('box.exec', {
  name: 'harness-xpc-smoke',
  command: 'sh',
  args: ['-c', 'echo booted through NSXPC; uname -r'],
}));
await new Promise((wait) => setTimeout(wait, 4000));
show('remove', await call('box.remove', { name: 'harness-xpc-smoke', force: true }));
show('shutdown', await call('shutdown'));
bridge.stdin.end();
