import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist', 'smoke');
const userData = await mkdtemp(join(tmpdir(), 'better-harness-desktop-smoke-'));
await mkdir(output, { recursive: true });
await rm(join(output, 'receipt.json'), { force: true });
const projectDirectory = join(userData, 'project');
await mkdir(projectDirectory, { recursive: true });
await writeFile(join(projectDirectory, 'native-linker.agent.canvas.tsx'), [
  'import {defineArtifactView} from "@studio/agent-react";',
  'import {useState} from "react";',
  'function NativeLinker(){const [count,setCount]=useState(0);return <main><h1>Go linker 你好😀</h1><button onClick={()=>setCount(count+1)}>Count {count}</button></main>}',
  'export default defineArtifactView({id:"native-linker",component:NativeLinker});',
].join('\n'));

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
let nativeStderr = '';
instance.process().stderr.on('data', (chunk) => { nativeStderr = (nativeStderr + chunk.toString()).slice(-16 * 1024); });
instance.process().stdout.on('data', (chunk) => {
  nativeLog += chunk.toString();
  for (;;) {
    const end = nativeLog.indexOf('\n');
    if (end === -1) break;
    const line = nativeLog.slice(0, end);
    nativeLog = nativeLog.slice(end + 1);
    try {
      const value = JSON.parse(line);
      if (value.kind === 'better-harness-desktop.oxc-proof') nativeProof = value;
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
  const studioConfig = await page.evaluate(async () => {
    const response = await fetch('/api/config');
    return { status: response.status, body: await response.json() };
  });
  assert.equal(studioConfig.status, 200);
  assert.equal(studioConfig.body.acpRuntimeProfile, process.platform === 'darwin' ? 'acp-v1-nsxpc' : 'acp-v1-rust');
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
  if (process.platform === 'darwin') {
    assert.equal(nativeProof.esbuildVersion, 'esbuild-go-0.28.2+link-v1');
    assert.equal(nativeProof.esbuildTransport, 'nsxpc');
    assert.ok(nativeProof.esbuildPid > 0);
    assert.notEqual(nativeProof.esbuildPid, nativeProof.studioPid);
    assert.notEqual(nativeProof.esbuildPid, proof.mainPid);
    if (nativeProof.esbuildTransport === 'nsxpc') assert.notEqual(nativeProof.esbuildPid, nativeProof.esbuildBridgePid);
    assert.throws(() => process.kill(nativeProof.esbuildBridgePid, 0), { code: 'ESRCH' });
  } else {
    assert.equal(nativeProof.esbuildTransport, 'wasm');
    assert.equal(nativeProof.esbuildPid, undefined);
    assert.equal(nativeProof.esbuildVersion, undefined);
  }
  assert.equal(nativeProof.studioPid, proof.metrics[0].pid);
  assert.notEqual(nativeProof.oxcPid, nativeProof.studioPid);
  assert.notEqual(nativeProof.oxcPid, proof.mainPid);
  assert.equal(nativeProof.transport, process.platform === 'darwin' ? 'nsxpc' : 'stdio');
  if (nativeProof.transport === 'nsxpc') assert.notEqual(nativeProof.oxcPid, nativeProof.bridgePid);
  assert.equal(nativeProof.acpTransport, process.platform === 'darwin' ? 'nsxpc' : 'stdio');
  assert.equal(nativeProof.acpRuntime, process.platform === 'darwin' ? 'acp-v1-nsxpc' : 'acp-v1-rust');
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
  }, projectDirectory);
  const selected = await page.evaluate(async () => {
    const response = await fetch('/api/projects/open', { method: 'POST' });
    return { status: response.status, body: await response.json() };
  });
  assert.equal(selected.status, 200);
  assert.equal(selected.body.opened, true);
  await page.reload({ waitUntil: 'networkidle' });
  await page.setViewportSize({ width: 1440, height: 900 });
  // Workspace catalogs contain observed outputs. Import this standalone test
  // source through the real artifact API instead of bypassing that ownership.
  await page.evaluate(async (source) => {
    const sessionResponse = await fetch('/api/artifact-imports', { method: 'POST' });
    if (!sessionResponse.ok) throw new Error('Artifact import session failed');
    const { sessionId } = await sessionResponse.json();
    const uploaded = await fetch(`/api/artifact-imports/${sessionId}/files?name=native-linker.agent.canvas.tsx`, { method: 'PUT', body: source });
    if (!uploaded.ok) throw new Error('Artifact source upload failed');
    const committed = await fetch(`/api/artifact-imports/${sessionId}/commit`, { method: 'POST' });
    if (!committed.ok) throw new Error('Artifact import commit failed');
  }, await readFile(join(projectDirectory, 'native-linker.agent.canvas.tsx'), 'utf8'));
  await page.goto(`${origin}/#/artifacts`);
  await page.locator('.artifact-list-pane').getByRole('button', { name: /native-linker\.agent\.canvas\.tsx/ }).click({ timeout: 30_000 });
  const nativePreview = page.frameLocator('iframe[title="Live AgentReact preview: native-linker.agent.canvas.tsx"]');
  await expect(nativePreview.getByRole('heading', { name: 'Go linker 你好😀' })).toBeVisible({ timeout: 30_000 });
  await nativePreview.getByRole('button', { name: 'Count 0' }).click();
  await expect(nativePreview.getByRole('button', { name: 'Count 1' })).toBeVisible();

  for (const [name, width, height] of [['wide', 1440, 900], ['compact', 1024, 768], ['narrow', 390, 844]]) {
    await page.setViewportSize({ width, height });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(output, `${name}.png`), animations: 'disabled' });
  }
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement !== document.body), true);
  assert.deepEqual(errors, []);
  // Snapshot active-renderer errors before intentional HTTP/EventSource shutdown.
  receipt = { nativeProof, nativeArtifactRendered: true, nativeArtifactInteraction: true, oxcStartupProbe: true, acpRuntimeProfile: studioConfig.body.acpRuntimeProfile, acpAgentCount: studioConfig.body.acpAgents?.filter((agent) => agent.available).length ?? 0, directorySelection: true, origin, node: proof.node, mainPid: proof.mainPid, servicePid: proof.metrics[0].pid,
    rendererSandbox: true, httpAuthorization: true, directoryCancellation: true, errors: [...errors] };
} finally {
  if (!receipt && nativeStderr) console.error(nativeStderr);
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
