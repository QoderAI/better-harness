import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { startHarnessStudioServer } from '../../dist/server/server.js';
import { createPiTerminalHost } from '../../dist/server/pi-terminal-host.js';
let directory, server, host;
async function start() {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'studio-pi-ui-')));
  host = createPiTerminalHost({ command: process.execPath, args: [fileURLToPath(new URL('../fixtures/pi-terminal.mjs', import.meta.url))] });
  server = await startHarnessStudioServer({ piTerminalHost: host, appDir: fileURLToPath(new URL('../../dist/app', import.meta.url)), harnessMode: 'workspace-default',
    runDirectory: join(directory, 'runs'), workspaceDirectoryPicker: async () => directory,
    workspaceSessionProvider: { discover: async () => ({ label: 'Pi test project', sessions: [] }) } });
}
test.afterEach(async () => { await server?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });
async function nav(page, name) {
  if (await page.locator('.studio-nav-toggle').getAttribute('aria-expanded') === 'false') await page.locator('.studio-nav-toggle').click();
  await page.getByRole('button', { name, exact: true }).click();
}
for (const [name, width, height] of [['wide', 1440, 900], ['compact', 1024, 768], ['narrow', 390, 844]]) test(`Pi terminal preserves native input and fits ${name}`, async ({ page }, info) => {
  await start(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width, height }); await page.goto(`${server.url}/#/pi`);
  if (await page.locator('.studio-nav-toggle').getAttribute('aria-expanded') === 'false') await page.locator('.studio-nav-toggle').click();
  await page.locator('.studio-project-switcher > button').click();
  await page.getByRole('menuitem', { name: 'Open project', exact: true }).click();
  await expect(page.locator('.studio-project-switcher > button')).toContainText('Pi test project');
  await nav(page, 'Pi');
  if (await page.locator('.studio-nav-toggle').isVisible() && await page.locator('.studio-nav-toggle').getAttribute('aria-expanded') === 'true') await page.locator('.studio-nav-toggle').click();
  const launch = page.getByRole('button', { name: 'Start Pi', exact: true });
  await expect(page.locator('.pi-workspace button')).toHaveCount(1);
  await expect(page.locator('#studio-toolbar-actions button')).toHaveCount(0);
  await expect(launch).toBeEnabled(); await launch.focus(); await expect(launch).toBeFocused(); await page.keyboard.press('Enter');
  const screen = page.locator('.xterm-accessibility-tree');
  await expect(screen).toContainText('PI_FIXTURE_READY');
  const input = page.locator('.xterm-helper-textarea');
  await input.focus(); await expect(input).toBeFocused(); await page.keyboard.type('native draft');
  await expect(screen).toContainText('native draft');
  await nav(page, 'Sessions'); await nav(page, 'Pi');
  await expect(screen).toContainText('native draft');
  await expect(page.locator('#studio-toolbar-actions button')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const bounds = await page.locator('.pi-terminal').boundingBox();
  expect(bounds.width).toBeGreaterThan(200); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
  await input.focus(); await page.keyboard.press('Control+Shift+F6'); await expect(input).not.toBeFocused();
  await page.screenshot({ path: info.outputPath(`pi-terminal-${name}.png`) });
  expect(errors).toEqual([]);
});
test('Pi control rejects foreign origin, stale Project and stale process generation', async ({ page }) => {
  await start(); await page.goto(`${server.url}/#/pi`);
  if (await page.locator('.studio-nav-toggle').getAttribute('aria-expanded') === 'false') await page.locator('.studio-nav-toggle').click();
  await page.locator('.studio-project-switcher > button').click(); await page.getByRole('menuitem', { name: 'Open project', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start Pi', exact: true })).toBeEnabled();
  const config = await (await page.request.get(`${server.url}/api/config`)).json();
  const headers = { 'X-Harness-Project-Id': config.activeProjectId, 'X-Harness-Project-Revision': String(config.projectRevision) };
  expect((await page.request.post(`${server.url}/api/pi/terminal`, { headers: { ...headers, Origin: 'https://evil.test' } })).status()).toBe(403);
  expect((await page.request.post(`${server.url}/api/pi/terminal`, { headers: { ...headers, 'X-Harness-Project-Revision': '0' } })).status()).toBe(409);
  const launched = await (await page.request.post(`${server.url}/api/pi/terminal`, { headers })).json();
  expect(launched.status).toBe('ready');
  expect((await page.request.patch(`${server.url}/api/pi/terminal`, { headers, data: { id: 'stale', data: 'x' } })).status()).toBe(409);
});
