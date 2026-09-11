import { execFileSync } from 'node:child_process';
import { cp, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installNsxpc, installAcpXpc, installEvidenceXpc } from './nsxpc-bundle.mjs';

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

/** BoxLite compiles from source and needs protoc; no other service does. */
function hasProtoc() {
  try {
    execFileSync('protoc', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

cargo('oxc-service');
cargo('acp-host');
cargo('evidence-host');
// The microVM shim is optional. Without protoc the rest of the build still
// succeeds, Studio is given no `boxExecExecutable`, and the Debugger hides the
// microVM placement rather than offering one it cannot honour.
const box = process.platform !== 'win32' && hasProtoc();
if (box) cargo('box-service');
else console.warn('[rust] skipping box-service: needs protoc >= 3.12 (brew install protobuf) on macOS or Linux');
if (!test) {
  await stage('harness-oxc-service');
  // Windows/Linux spawn the ACP driver directly; macOS reaches it through the
  // NSXPC bundle below. Staging it also keeps one path rule across platforms.
  await stage('harness-acp-host');
  await stage('harness-evidence-host');
  // Studio spawns the shim directly in an Agent's place, so it is a plain
  // staged executable rather than an NSXPC bundle.
  if (box) await stage('harness-box-exec');
}

if (!test && process.platform === 'darwin') {
  const binaries = join(root, 'dist', 'rust', 'release');
  for (const binary of [
    'harness-oxc-client', 'harness-oxc-xpc',
    'harness-acp-client', 'harness-acp-xpc',
    'harness-evidence-client', 'harness-evidence-xpc',
  ]) {
    await cp(join(binaries, binary), join(root, 'dist', 'native', binary));
  }
  const oxcApp = join(root, 'dist', 'native', 'Harness OXC.app');
  await installNsxpc(oxcApp, binaries, { development: true });
  execFileSync('codesign', ['--force', '--sign', '-', '--deep', oxcApp], { stdio: 'inherit' });
  const acpApp = join(root, 'dist', 'native', 'Harness ACP.app');
  await installAcpXpc(acpApp, binaries, { development: true });
  execFileSync('codesign', ['--force', '--sign', '-', '--deep', acpApp], { stdio: 'inherit' });
  const evidenceApp = join(root, 'dist', 'native', 'Harness Evidence.app');
  await installEvidenceXpc(evidenceApp, binaries, { development: true });
  execFileSync('codesign', ['--force', '--sign', '-', '--deep', evidenceApp], { stdio: 'inherit' });
}
