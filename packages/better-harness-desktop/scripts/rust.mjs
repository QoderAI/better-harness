import { execFileSync } from 'node:child_process';
import { cp, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installNsxpc } from './nsxpc-bundle.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const test = process.argv.includes('--test');
execFileSync('cargo', ['+1.96.0', test ? 'test' : 'build', '--release', '--locked',
  '--manifest-path', join(root, 'rust', 'oxc-service', 'Cargo.toml'),
  '--target-dir', join(root, 'dist', 'rust')], { stdio: 'inherit' });
if (!test) {
  const binary = process.platform === 'win32' ? 'harness-oxc-service.exe' : 'harness-oxc-service';
  await mkdir(join(root, 'dist', 'native'), { recursive: true });
  await cp(join(root, 'dist', 'rust', 'release', binary), join(root, 'dist', 'native', binary));
}

if (!test && process.platform === 'darwin') {
  const binaries = join(root, 'dist', 'rust', 'release');
  for (const binary of ['harness-oxc-client', 'harness-oxc-xpc']) {
    await cp(join(binaries, binary), join(root, 'dist', 'native', binary));
  }
  const app = join(root, 'dist', 'native', 'Harness OXC.app');
  await installNsxpc(app, binaries, { development: true });
  execFileSync('codesign', ['--force', '--sign', '-', '--deep', app], { stdio: 'inherit' });
}
