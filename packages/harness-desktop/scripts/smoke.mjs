import { _electron as electron } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist', 'smoke');
const userData = await mkdtemp(join(tmpdir(), 'harness-desktop-smoke-'));
await mkdir(output, { recursive: true });
const packagedExecutable = process.platform === 'darwin'
  ? join(root, 'dist', 'installers', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Harness Studio.app', 'Contents', 'MacOS', 'Harness Studio')
  : process.platform === 'win32'
    ? join(root, 'dist', 'installers', 'win-unpacked', 'Harness Studio.exe')
    : join(root, 'dist', 'installers', 'linux-unpacked', 'harness-studio');
const executablePath = process.env.HARNESS_DESKTOP_EXECUTABLE
  ?? (process.argv.includes('--packaged') ? packagedExecutable : undefined);
const instance = await electron.launch({
  ...(executablePath ? { executablePath } : {}),
  args: [...(executablePath ? [] : [root]), `--user-data-dir=${userData}`],
  timeout: 60_000,
});
let receipt;
let nativeProof;
let nativeLog = '';
instance.process().stdout.on('data', (chunk) => {
  nativeLog += chunk.toString();
  for (;;) {
    const end = nativeLog.indexOf('\n');
    if (end === -1) break;
    const line = nativeLog.slice(0, end);
    nativeLog = nativeLog.slice(end + 1);
    try {
      const value = JSON.parse(line);
      if (value.kind === 'harness-desktop.oxc-proof') nativeProof = value;
    } catch { /* Other host diagnostics are not the native receipt. */ }
  }
  if (nativeLog.length > 64 * 1024) nativeLog = '';
});
try {
  const page = await instance.firstWindow({ timeout: 30_000 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (entry) => { if (entry.type() === 'error') errors.push(entry.text()); });
  await page.waitForLoadState('networkidle');
  await page.locator('body').waitFor();
  assert.ok((await page.locator('body').innerText()).length > 100);
  const origin = new URL(page.url()).origin;
  assert.equal((await fetch(`${origin}/api/config`)).status, 401);
  assert.equal(await page.evaluate(async () => (await fetch('/api/config')).status), 200);
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.evaluate(() => typeof window.process), 'undefined');
  const proof = await instance.evaluate(({ app, BrowserWindow }) => ({
    mainPid: process.pid, node: process.versions.node,
    metrics: app.getAppMetrics().filter((entry) => entry.name === 'Harness Studio Service'),
    preferences: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
  }));
  assert.equal(proof.preferences.sandbox, true);
  assert.equal(proof.preferences.contextIsolation, true);
  assert.equal(proof.preferences.nodeIntegration, false);
  assert.equal(proof.metrics.length, 1);
  assert.equal(nativeProof?.rust, true);
  assert.equal(nativeProof.oxcNativeLoaded, false);
  assert.equal(nativeProof.studioPid, proof.metrics[0].pid);
  assert.notEqual(nativeProof.oxcPid, nativeProof.studioPid);
  assert.notEqual(nativeProof.oxcPid, proof.mainPid);
  assert.equal(nativeProof.transport, process.platform === 'darwin' ? 'nsxpc' : 'stdio');
  if (nativeProof.transport === 'nsxpc') assert.notEqual(nativeProof.oxcPid, nativeProof.bridgePid);
  // The bridge belongs to Studio; the NSXPC service lifetime belongs to launchd.
  assert.throws(() => process.kill(nativeProof.bridgePid, 0), { code: 'ESRCH' });
  assert.notEqual(proof.metrics[0].pid, proof.mainPid);
  // Stub only the OS dialog, exercise real HTTP -> utility -> main -> utility flow.
  await instance.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });
  const cancelled = await page.evaluate(async () => (await fetch('/api/projects/open', { method: 'POST' })).json());
  assert.equal(cancelled.cancelled, true);
  await instance.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
  }, userData);
  const selected = await page.evaluate(async () => {
    const response = await fetch('/api/projects/open', { method: 'POST' });
    return { status: response.status, body: await response.json() };
  });
  assert.equal(selected.status, 200);
  assert.equal(selected.body.opened, true);
  await page.reload({ waitUntil: 'networkidle' });
  for (const [name, width, height] of [['wide', 1440, 900], ['compact', 1024, 768], ['narrow', 390, 844]]) {
    await page.setViewportSize({ width, height });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(output, `${name}.png`), animations: 'disabled' });
  }
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement !== document.body), true);
  assert.deepEqual(errors, []);
  receipt = { nativeProof, oxcStartupProbe: true, directorySelection: true, origin, node: proof.node, mainPid: proof.mainPid, servicePid: proof.metrics[0].pid,
    rendererSandbox: true, httpAuthorization: true, directoryCancellation: true, errors };
} finally {
  // A blocking native startup error dialog must not hang a headless CI job.
  const forceClose = setTimeout(() => instance.process().kill('SIGKILL'), 5_000);
  try { await instance.close(); }
  finally { clearTimeout(forceClose); }
  await rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
if (receipt) {
  await assert.rejects(fetch(`${receipt.origin}/api/config`));
  receipt.serviceClosed = true;
  await writeFile(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt, null, 2));
}
