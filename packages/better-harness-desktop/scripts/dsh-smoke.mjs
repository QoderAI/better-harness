import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('..', import.meta.url));
const entry = process.env.DSH_WEB_ENTRY;
if (!entry) throw new Error('Set DSH_WEB_ENTRY to an installed, built official DSH CLI entry. No runtime is installed by this smoke.');
const output = join(root, 'dist/dsh-acceptance');
await mkdir(output, { recursive: true });
await writeFile(join(output, "receipt.json"), JSON.stringify({ kind: "studio.dsh-desktop-smoke.v1", passed: false, status: "running" }));
const temp = await mkdtemp(join(tmpdir(), 'dsh-desktop-ui-'));
const bin = join(temp, 'bin'); await mkdir(bin);
const project = join(temp, 'project'); await mkdir(project);
const launcher = `import ${JSON.stringify(pathToFileURL(resolve(entry)).href)};\n`;
if (process.platform === 'win32') {
  // Model an npm installation. Desktop resolves its .cmd entry to this JS bin.
  const npmRoot = join(bin, 'node_modules', '@deepseek-ai', 'dsh');
  await mkdir(npmRoot, { recursive: true });
  await writeFile(join(npmRoot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', type: 'module', bin: { dsh: 'launcher.mjs' } }));
  await writeFile(join(npmRoot, 'launcher.mjs'), launcher);
  await writeFile(join(bin, 'dsh.cmd'), '@echo off\r\n');
} else await writeFile(join(bin, 'dsh'), `#!${process.execPath}\n${launcher}`, { mode: 0o755 });

let app;
try {
  app = await electron.launch({ ...(process.env.DSH_DESKTOP_EXECUTABLE ? { executablePath: process.env.DSH_DESKTOP_EXECUTABLE } : {}), args: [...(process.env.DSH_DESKTOP_EXECUTABLE ? [] : [root]), `--user-data-dir=${join(temp, 'user')}`], env: { ...process.env, SSH_CONNECTION: 'native-smoke-browser-picker', PATH: `${bin}${delimiter}${process.env.PATH}` }, timeout: 60000 });
  const page = await app.firstWindow(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const foreignHeaders = [];
  page.on('request', request => {
    if (page.url().startsWith('http:') && request.url().startsWith('http:') && new URL(request.url()).origin !== new URL(page.url()).origin) {
      foreignHeaders.push(request.allHeaders().then(headers => assert.equal(headers['x-harness-studio-token'], undefined)));
    }
  });
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.waitForLoadState('networkidle');
  const config = await page.evaluate(async () => (await fetch('/api/config')).json());
  assert.equal(config.dshWebEnabled, true);
  assert.equal(config.acpAgents.find(agent => agent.id === 'dsh')?.available, true);
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, project);
  await page.getByRole('button', { name: 'Harness Design', exact: true }).click();
  await page.locator('.studio-project-switcher > button').click();
  await page.getByRole('menuitem', { name: 'Open project', exact: true }).click();
  await expect(page.locator('.dsh-workspace button')).toHaveCount(1);
  await expect(page.locator('#studio-toolbar-actions button')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start DSH', exact: true })).toBeEnabled();
  await page.screenshot({ path: join(output, 'desktop-dsh-launch.png') });
  await page.getByRole('button', { name: 'Start DSH', exact: true }).click();
  await expect(page.locator('iframe.dsh-native-frame')).toBeVisible({ timeout: 60000 });
  const frame = page.frameLocator('iframe.dsh-native-frame');
  await expect(frame.locator('body')).not.toContainText('Unauthorized');
  await expect(frame.getByRole('button', { name: 'Settings', exact: true })).toBeVisible({ timeout: 20000 });
  const notice = frame.getByRole('button', { name: 'Continue', exact: true });
  await notice.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
  if (await notice.isVisible()) await notice.click();
  const later = frame.getByRole('button', { name: 'Configure later', exact: true });
  await later.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
  if (await later.isVisible()) await later.click();
  await expect(later).toBeHidden();
  const choose = frame.getByRole('button', { name: 'Choose workspace', exact: true });
  if (await choose.isVisible()) {
    await choose.click(); await frame.getByRole('button', { name: 'Edit path', exact: true }).click();
    const field = frame.getByRole('textbox', { name: 'Edit path', exact: true });
    await field.fill(project); await field.press('Enter'); await frame.getByRole('button', { name: 'Open', exact: true }).click();
  }
  await expect(page.locator('.dsh-design-status')).toHaveAttribute('role', 'status', { timeout: 15000 });
  await expect(page.locator('.dsh-design-status')).toContainText('harness_compile_plugin');
  const editor = frame.locator('[contenteditable="true"][role="textbox"]');
  await expect(editor).toBeVisible();
  await editor.fill('Review this project with DSH — draft only, not submitted.');
  await expect(editor).toBeFocused();
  await page.getByRole('button', { name: 'Sessions', exact: true }).click();
  await page.getByRole('button', { name: 'Harness Design', exact: true }).click();
  await expect(editor).toContainText('draft only');
  for (const [name, width, height] of [['wide', 1440, 900], ['compact', 1024, 768], ['narrow', 390, 844]]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), [width, height]);
    if (name !== 'wide') {
      await expect(page.locator('.studio-nav-toggle')).toHaveAttribute('aria-expanded', 'false');
      await expect.poll(async () => Math.round((await page.locator('iframe.dsh-native-frame').boundingBox()).width)).toBe(width);
    }
    await page.waitForTimeout(300);
    if (name !== 'wide') {
      const collapse = frame.getByRole('button', { name: 'Collapse sidebar', exact: true });
      if (await collapse.isVisible()) await collapse.click();
    }
    await editor.click();
    await expect(editor).toBeFocused();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(output, `desktop-dsh-official-${name}.png`) });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  await editor.fill('');

  const prefs = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
  assert.equal(prefs.sandbox, true); assert.equal(prefs.nodeIntegration, false);
  await expect(page.locator('#studio-toolbar-actions button')).toHaveCount(0);
  const dshUrl = await page.locator('iframe.dsh-native-frame').getAttribute('src');
  await Promise.all(foreignHeaders);
  const interactionErrors = [...errors];
  assert.deepEqual(interactionErrors, []);
  await app.close(); app = undefined;
  await assert.rejects(fetch(dshUrl));
  await writeFile(join(output, 'receipt.json'), JSON.stringify({ kind: 'studio.dsh-desktop-smoke.v1', passed: true, shell: 'Electron development', transport: 'official-dsh-web-http', nativeDsh: true, modelPrompt: false, screenshots: ['wide', 'compact', 'narrow'].map(size => `desktop-dsh-official-${size}.png`), errors: interactionErrors, shutdownDiagnostics: errors.slice(interactionErrors.length) }, null, 2));
  console.log('DSH official Web embedded in Electron; no model prompt sent.');
} finally { await app?.close(); await rm(temp, { recursive: true, force: true }); }
