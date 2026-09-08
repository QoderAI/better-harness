import { access, chmod } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

/** npm archives omit the executable bit on node-pty's macOS spawn helper. */
export async function prepareTerminal(packageDirectory) {
  const require = createRequire(join(packageDirectory, 'package.json'));
  const root = dirname(require.resolve('node-pty/package.json'));
  const prebuild = join(root, 'prebuilds', `${process.platform}-${process.arch}`);
  let prebuilt = true;
  try { await access(prebuild); } catch { prebuilt = false; }
  if (!prebuilt) {
    // Linux has no upstream 1.1.0 prebuild. Build against the host Node headers;
    // node-pty uses Node-API, so this binary also serves Electron's utility host.
    const buildRequire = createRequire(import.meta.url);
    execFileSync(process.execPath, [buildRequire.resolve('node-gyp/bin/node-gyp.js'), 'rebuild'], { cwd: root, stdio: 'inherit' });
  }
  if (process.platform !== 'win32') {
    await chmod(join(prebuilt ? prebuild : join(root, 'build', 'Release'), 'spawn-helper'), 0o755);
  } else {
    execFileSync(process.execPath, [join(root, 'scripts', 'post-install.js')], { cwd: root, stdio: 'inherit' });
  }
}
