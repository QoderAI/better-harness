import { execFileSync } from 'node:child_process';
import { cp, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installNsxpc, installAcpXpc } from './nsxpc-bundle.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const test = process.argv.includes('--test');

/** Build or test one Rust capability service, sharing the dist target cache. */
function cargo(crate) {
  execFileSync('cargo', ['+1.96.0', test ? 'test' : 'build', '--release', '--locked',
    '--manifest-path', join(root, 'rust', crate, 'Cargo.toml'),
    '--target-dir', join(root, 'dist', 'rust')], { stdio: 'inherit' });
}

/** Stage a built executable outside dist/rust so packaging never ships the cache. */
async function stage(name) {
  const binary = process.platform === 'win32' ? `${name}.exe` : name;
  await mkdir(join(root, 'dist', 'native'), { recursive: true });
  await cp(join(root, 'dist', 'rust', 'release', binary), join(root, 'dist', 'native', binary));
}

cargo('oxc-service');
cargo('acp-host');
if (!test) {
  await stage('harness-oxc-service');
  // Windows/Linux spawn the ACP driver directly; macOS reaches it through the
  // NSXPC bundle below. Staging it also keeps one path rule across platforms.
  await stage('harness-acp-host');
}

if (!test && process.platform === 'darwin') {
  const binaries = join(root, 'dist', 'rust', 'release');
  for (const binary of ['harness-oxc-client', 'harness-oxc-xpc', 'harness-acp-client', 'harness-acp-xpc']) {
    await cp(join(binaries, binary), join(root, 'dist', 'native', binary));
  }
  const oxcApp = join(root, 'dist', 'native', 'Harness OXC.app');
  await installNsxpc(oxcApp, binaries, { development: true });
  execFileSync('codesign', ['--force', '--sign', '-', '--deep', oxcApp], { stdio: 'inherit' });
  const acpApp = join(root, 'dist', 'native', 'Harness ACP.app');
  await installAcpXpc(acpApp, binaries, { development: true });
  execFileSync('codesign', ['--force', '--sign', '-', '--deep', acpApp], { stdio: 'inherit' });
}
