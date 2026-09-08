import { mkdir, readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const npm = process.env.npm_execpath;
const destination = process.argv.indexOf('--out');
if (!npm || destination < 0 || !process.argv[destination + 1]) throw new Error('Use npm exec -- node packages/better-harness-desktop/scripts/compare-agent-footprint.mjs --out <new directory>');
const root = resolve(process.argv[destination + 1]);
await mkdir(root); // Never overwrite a previous measurement or install into the checkout.
const agents = [
  { id: 'pi', name: '@earendil-works/pi-coding-agent', version: '0.85.1' },
  { id: 'dsh', name: '@deepseek-ai/dsh', version: '0.1.2-rc.1' },
];
async function size(directory) {
  let bytes = 0, files = 0;
  for (const name of await readdir(directory)) {
    const path = join(directory, name), stat = await lstat(path);
    if (stat.isDirectory()) { const child = await size(path); bytes += child.bytes; files += child.files; }
    else if (stat.isFile()) { bytes += stat.size; files++; }
    // Symlinks have no payload; their targets are already counted in the closure.
  }
  return { bytes, files };
}
const results = [];
for (const agent of agents) {
  const directory = join(root, agent.id);
  await mkdir(directory);
  await writeFile(join(directory, 'package.json'), JSON.stringify({
    name: `studio-footprint-${agent.id}`, version: '1.0.0', private: true,
    dependencies: { [agent.name]: agent.version }, bundledDependencies: [agent.name],
  }, null, 2));
  const install = await run(process.execPath, [npm, 'install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: directory, maxBuffer: 16 * 1024 * 1024 });
  await writeFile(join(directory, 'install.log'), install.stdout + install.stderr);
  const lock = await readFile(join(directory, 'package-lock.json'));
  const installed = JSON.parse(await readFile(join(directory, 'node_modules', ...agent.name.split('/'), 'package.json'), 'utf8'));
  const closure = await size(join(directory, 'node_modules'));
  const packed = JSON.parse((await run(process.execPath, [npm, 'pack', '--ignore-scripts', '--json'], { cwd: directory, maxBuffer: 16 * 1024 * 1024 })).stdout)[0];
  const archive = await readFile(join(directory, packed.filename));
  results.push({ ...agent, installedVersion: installed.version, closure, archiveBytes: archive.length,
    archive: `${agent.id}/${packed.filename}`, archiveSha256: createHash('sha256').update(archive).digest('hex'),
    lockSha256: createHash('sha256').update(lock).digest('hex'),
  });
  console.log(`${agent.id}: ${closure.bytes} installed bytes, ${archive.length} archive bytes`);
}
// Shared local runtime is informational, never added to just one agent's size.
const repository = fileURLToPath(new URL('../../..', import.meta.url));
const shared = [];
for (const relative of ['node_modules/electron/dist', 'node_modules/node-pty', 'node_modules/node-addon-api', 'node_modules/@xterm/xterm', 'node_modules/@xterm/addon-fit']) {
  try { shared.push({ path: relative, ...(await size(join(repository, ...relative.split('/')))) }); }
  catch { shared.push({ path: relative, unavailable: true }); }
}
const report = { kind: 'studio.agent-footprint.v1', measuredAt: new Date().toISOString(),
  platform: process.platform, arch: process.arch, node: process.version,
  npm: (await run(process.execPath, [npm, '--version'])).stdout.trim(),
  method: 'Separate npm production installs with scripts disabled; logical regular-file bytes and npm-pack gzip tarballs with bundled dependency closures. Lockfiles and archives retained.',
  exclusions: ['Node/Electron', 'Studio and its PTY/terminal bridge', 'package-manager cache', 'user profiles/sessions', 'postinstall downloads', 'filesystem block allocation', 'runtime memory'],
  results, shared,
};
await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(join(root, 'report.json'));
