import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installEsbuildXpc } from './nsxpc-bundle.mjs';

if (process.argv.includes('--desktop') && process.platform !== 'darwin') {
  console.info('Desktop Go esbuild remains disabled on Windows/Linux.');
  process.exit(0);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'go', 'esbuild-service');
const native = join(root, 'dist', 'native');
const cache = join(root, 'dist', 'go');
const goos = { darwin: 'darwin', win32: 'windows', linux: 'linux' }[process.platform];
const goarch = { arm64: 'arm64', x64: 'amd64', ia32: '386' }[process.arch];
if (!goos || !goarch) throw new Error('Unsupported Go service target');
function run(command, args, extraEnv = {}) {
  execFileSync(command, args, { cwd: source, stdio: 'inherit',
    env: { ...process.env, GOOS: goos, GOARCH: goarch, ...extraEnv } });
}
if (process.argv.includes('--test')) {
  run('go', ['test', '-mod=readonly', './linker']);
} else {
  await mkdir(native, { recursive: true });
  await mkdir(cache, { recursive: true });
  run('go', ['mod', 'download', 'github.com/evanw/esbuild', 'golang.org/x/sys']);
  const notices = [];
  for (const dependency of ['github.com/evanw/esbuild', 'golang.org/x/sys']) {
    const module = JSON.parse(execFileSync('go', ['list', '-m', '-json', dependency], { cwd: source, encoding: 'utf8' }));
    notices.push(`${dependency} ${module.Version}\n\n${await readFile(join(module.Dir, dependency.endsWith('/esbuild') ? 'LICENSE.md' : 'LICENSE'), 'utf8')}`);
  }
  const goroot = execFileSync('go', ['env', 'GOROOT'], { encoding: 'utf8' }).trim();
  // Some packaged toolchains put the license beside their libexec GOROOT.
  let goLicense;
  for (const directory of [goroot, dirname(goroot)]) {
    try { goLicense = await readFile(join(directory, 'LICENSE'), 'utf8'); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!goLicense) throw new Error('Go toolchain license was not found');
  notices.push(`Go runtime\n\n${goLicense}`);
  await writeFile(join(native, 'harness-esbuild-service.NOTICES.txt'), notices.join('\n\n'));
  run('go', ['build', '-mod=readonly', '-trimpath', '-ldflags=-s -w', '-o',
    join(native, `harness-esbuild-service${process.platform === 'win32' ? '.exe' : ''}`), './cmd/harness-esbuild-service'], { CGO_ENABLED: '0' });
  if (process.platform === 'darwin') {
    run('go', ['build', '-mod=readonly', '-trimpath', '-buildmode=c-archive', '-ldflags=-s -w',
      '-o', join(cache, 'libharness_esbuild.a'), './cmd/harness-esbuild-archive'], { CGO_ENABLED: '1' });
    const flags = ['-arch', process.arch === 'arm64' ? 'arm64' : 'x86_64', '-fobjc-arc', '-fblocks', '-O2', '-framework', 'Foundation'];
    run('xcrun', ['clang', ...flags, '-I', cache, 'xpc/service.m', join(cache, 'libharness_esbuild.a'),
      '-framework', 'CoreFoundation', '-framework', 'Security', '-lresolv', '-o', join(native, 'harness-esbuild-xpc')]);
    run('xcrun', ['clang', ...flags, 'xpc/client.m', '-o', join(native, 'harness-esbuild-client')]);
    const app = join(native, 'Harness Esbuild.app');
    await installEsbuildXpc(app, native, { development: true });
    run('codesign', ['--force', '--sign', '-', '--deep', app]);
  }
}
