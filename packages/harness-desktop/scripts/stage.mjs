import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = resolve(root, '../..');
const staging = join(root, 'dist', 'app');
const tarballs = join(root, 'dist', 'tarballs');
// Use npm's JS entrypoint so Windows does not need a shell to run npm.cmd.
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run staging through npm run stage');
function run(args, cwd) {
  return execFileSync(process.execPath, [npm, ...args], { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
}
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
await mkdir(tarballs, { recursive: true });
const archives = [];
for (const name of ['harness', 'harness-studio']) {
  const packed = JSON.parse(run(['pack', '--ignore-scripts', '--json', '--pack-destination', tarballs], join(repository, 'packages', name)));
  archives.push(join(tarballs, packed[0].filename));
}
const source = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
await writeFile(join(staging, 'package.json'), JSON.stringify({
  name: source.name, version: source.version, private: true, type: 'module',
  main: source.main, description: source.description, license: source.license,
  author: "Qoder",
}, null, 2));
await cp(join(root, 'src'), join(staging, 'src'), { recursive: true });
// Install only the two local public artifacts and their production closure.
// This avoids copying repository dev dependencies into the desktop distribution.
process.stdout.write(run(['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', ...archives], staging));
console.log(`Staged desktop runtime: ${staging}`);
