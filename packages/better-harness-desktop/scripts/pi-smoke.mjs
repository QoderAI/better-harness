import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('..', import.meta.url));
const entry = process.env.PI_CLI_ENTRY;
if (!entry) throw new Error('Set PI_CLI_ENTRY to an installed official Pi CLI entry.');
const output = join(root, 'dist/pi-acceptance'); await mkdir(output, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), 'pi-desktop-ui-'));
const bin = join(temp, 'bin'); await mkdir(bin);
const project = join(temp, 'project'); await mkdir(project);
const launcher = `import ${JSON.stringify(pathToFileURL(resolve(entry)).href)};\n`;
if (process.platform === 'win32') {
  const packageRoot = join(bin, 'node_modules', '@earendil-works', 'pi-coding-agent');
  await mkdir(join(packageRoot, 'dist'), { recursive: true });
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', type: 'module', main: 'dist/index.js', bin: { pi: 'launcher.mjs' } }));
  await writeFile(join(packageRoot, 'dist', 'index.js'), '');
  await writeFile(join(packageRoot, 'launcher.mjs'), launcher);
  await writeFile(join(bin, 'pi.cmd'), '@echo off\r\n');
} else await writeFile(join(bin, 'pi'), `#!${process.execPath}\n${launcher}`, { mode: 0o755 });
let app;
try {
  app = await electron.launch({ args: [root, `--user-data-dir=${join(temp, 'user')}`],
    env: { ...process.env, PI_CODING_AGENT_DIR: join(temp, 'pi-profile'), PATH: `${bin}${delimiter}${process.env.PATH}` }, timeout: 60000 });
  const page = await app.firstWindow(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.waitForLoadState('networkidle');
  assert.equal(await page.evaluate(async () => (await (await fetch('/api/config')).json()).piTerminalEnabled), true);
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, project);
  await page.getByRole('button', { name: 'Pi', exact: true }).click();
  await page.locator('.studio-project-switcher > button').click(); await page.getByRole('menuitem', { name: 'Open project', exact: true }).click();
  const launch = page.getByRole('button', { name: 'Start Pi', exact: true });
  await expect(launch).toBeEnabled(); await expect(page.locator('.pi-workspace button')).toHaveCount(1);
  await expect(page.locator('#studio-toolbar-actions button')).toHaveCount(0);
  await page.screenshot({ path: join(output, 'desktop-pi-launch.png') });
  await launch.focus(); await page.keyboard.press('Enter');
  const screen = page.locator('.xterm-accessibility-tree'), input = page.locator('.xterm-helper-textarea');
  await expect(screen).toContainText('v0.85.1', { timeout: 30000 });
  await input.focus(); await page.keyboard.type('Review this project - draft only');
  await expect(screen).toContainText('draft only');
  await page.getByRole('button', { name: 'Sessions', exact: true }).click(); await page.getByRole('button', { name: 'Pi', exact: true }).click();
  await expect(screen).toContainText('draft only');
  for (const [name, width, height] of [['wide', 1440, 900], ['compact', 1024, 768], ['narrow', 390, 844]]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), [width, height]);
    if (name !== 'wide') await expect(page.locator('.studio-nav-toggle')).toHaveAttribute('aria-expanded', 'false');
    await page.waitForTimeout(500);
    await input.focus(); await expect(input).toBeFocused();
    await expect(screen).toContainText('draft only');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const bounds = await page.locator('.pi-terminal').boundingBox(); assert.ok(bounds.width > 200 && bounds.x + bounds.width <= width);
    await page.screenshot({ path: join(output, `desktop-pi-official-${name}.png`) });
  }
  // Clear the draft without sending a model request.
  await input.focus(); await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+Shift+F6'); await expect(input).not.toBeFocused();
  assert.deepEqual(errors, []);
  const web = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
  assert.equal(web.sandbox, true); assert.equal(web.nodeIntegration, false);
  await app.close(); app = undefined;
  await writeFile(join(output, 'receipt.json'), JSON.stringify({ kind: 'studio.pi-desktop-smoke.v1', passed: true, nativePi: true, modelPrompt: false,
    shell: 'Electron development', errors, screenshots: ['wide', 'compact', 'narrow'].map(name => `desktop-pi-official-${name}.png`) }, null, 2));
  console.log(join(output, 'receipt.json'));
} catch (error) {
  if (app) { const page = await app.firstWindow().catch(() => undefined); await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {}); }
  await writeFile(join(output, 'receipt.json'), JSON.stringify({ kind: 'studio.pi-desktop-smoke.v1', passed: false, error: String(error) }, null, 2));
  throw error;
} finally { await app?.close().catch(() => {}); await rm(temp, { recursive: true, force: true }); }
