// Assemble and sign the POC's NSXPC bundle, so the transport can be exercised
// without touching the desktop build.
//
//   node rust/box-service/bundle.mjs          # build + bundle + sign
//   node rust/box-service/bundle.mjs --smoke  # ...then boot a VM through it
//
// On real integration this becomes an `installBoxXpc` beside the other three in
// `scripts/nsxpc-bundle.mjs`; it is standalone here only to keep the POC from
// editing files it does not own.

import { execFileSync } from 'node:child_process';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const crate = resolve(dirname(fileURLToPath(import.meta.url)));
const desktop = resolve(crate, '..', '..');
const serviceId = 'com.qoder.harness-studio.box';
const appPath = join(desktop, 'dist', 'native', 'Harness Box.app');

const plist = (body) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>${body}</dict></plist>\n`;

if (process.platform !== 'darwin') throw new Error('The NSXPC bundle is macOS-only');

// BoxLite shells out to mke2fs to build a guest rootfs and finds it on PATH.
// Homebrew keeps e2fsprogs keg-only, and an Android platform-tools install
// shadows the name — so put the real one first rather than hoping.
const e2fsprogs = '/opt/homebrew/opt/e2fsprogs/sbin';
const env = { ...process.env, PATH: `${e2fsprogs}:${process.env.PATH ?? ''}` };

execFileSync('cargo', ['+1.96.0', 'build', '--release', '--manifest-path', join(crate, 'Cargo.toml')],
  { stdio: 'inherit', env });

const binaries = join(crate, 'target', 'release');
const contents = join(appPath, 'Contents');
const service = join(contents, 'XPCServices', `${serviceId}.xpc`, 'Contents');
await rm(appPath, { recursive: true, force: true });
await mkdir(join(contents, 'MacOS'), { recursive: true });
await mkdir(join(service, 'MacOS'), { recursive: true });
await cp(join(binaries, 'harness-box-client'), join(contents, 'MacOS', 'harness-box-client'));
await cp(join(binaries, 'harness-box-xpc'), join(service, 'MacOS', 'harness-box-xpc'));
// The service resolves the driver next to its own executable.
await cp(join(binaries, 'harness-box-host'), join(service, 'MacOS', 'harness-box-host'));
await writeFile(join(service, 'Info.plist'), plist(`
<key>CFBundleIdentifier</key><string>${serviceId}</string>
<key>CFBundleExecutable</key><string>harness-box-xpc</string>
<key>CFBundlePackageType</key><string>XPC!</string>
<key>CFBundleVersion</key><string>1</string>
<key>XPCService</key><dict><key>ServiceType</key><string>Application</string></dict>`));
await writeFile(join(contents, 'Info.plist'), plist(`
<key>CFBundleIdentifier</key><string>${serviceId}-development</string>
<key>CFBundleExecutable</key><string>harness-box-client</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSUIElement</key><true/>`));

// No entitlements: BoxLite ad-hoc signs its own shim with the hypervisor one.
execFileSync('codesign', ['--force', '--sign', '-', '--deep', appPath], { stdio: 'inherit' });
const client = join(contents, 'MacOS', 'harness-box-client');
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
