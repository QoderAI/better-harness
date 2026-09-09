import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import { startHarnessStudioServer } from '../../dist/server/server.js';
import { createDshWebHost } from '../../dist/server/dsh-web-host.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const layouts = [{ name: 'wide', width: 1440, height: 900 }, { name: 'compact', width: 1024, height: 768 }, { name: 'narrow', width: 390, height: 844 }];
let directory, server, foreign, opens, stops;
async function start({ native = false, missing = false } = {}) {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'studio-dsh-ui-')));
  opens = []; stops = 0;
  let current = { status: 'stopped' };
  if (!native && !missing) {
    foreign = createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><body><label>Foreign application draft<textarea></textarea></label><button>Foreign settings</button></body></html>'); });
    await new Promise(done => foreign.listen(0, '127.0.0.1', done));
  }
  const dshWebHost = missing ? undefined : native
    ? createDshWebHost({ command: process.env.DSH_WEB_COMMAND, args: JSON.parse(process.env.DSH_WEB_ARGS ?? '[]') })
    : { state: () => current, open: async cwd => { opens.push(cwd); current = { status: 'ready', url: `http://127.0.0.1:${foreign.address().port}/?token=fixture` }; return current; }, stop: async () => { stops++; current = { status: 'stopped' }; }, close: async () => {} };
  server = await startHarnessStudioServer({ appDir: process.env.STUDIO_TEST_APP_DIR ?? join(root, 'dist/app'), dshWebHost, runDirectory: join(directory, 'runs'), harnessMode: 'workspace-default',
    workspaceDirectoryPicker: async () => directory, workspaceSessionProvider: { discover: async () => ({ label: 'DSH test project', sessions: [] }) } });
}
test.afterEach(async () => { await server?.close(); server = undefined; if (foreign) { await new Promise(done => foreign.close(done)); foreign = undefined; } if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined; });
async function open(page) {
  await page.goto(`${server.url}/#/dsh`);
  const switcher = page.locator('.studio-project-switcher > button');
  if (await page.locator('.studio-nav-toggle').getAttribute('aria-expanded') === 'false') await page.locator('.studio-nav-toggle').click();
  await switcher.click();
  await page.getByRole('menuitem', { name: 'Open project', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start DSH', exact: true })).toBeEnabled();
}
for (const layout of layouts) test(`official application container preserves focus and draft at ${layout.name}`, async ({ page }, info) => {
  await start(); const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize(layout); await open(page);
  await expect(page.getByRole('heading', { name: 'Harness Design', exact: true })).toBeVisible();
  await expect(page.locator('.studio-project-views').getByRole('button', { name: 'Harness Design', exact: true })).toHaveCount(1);
  await expect(page.locator('.studio-project-views').getByRole('button', { name: /^(DSH|Pi)$/ })).toHaveCount(0);
  const launch = page.getByRole('button', { name: 'Start DSH', exact: true });
  await expect(page.locator('.dsh-workspace button')).toHaveCount(1);
  await expect(page.locator('#studio-toolbar-actions button')).toHaveCount(0);
  if (layout.width <= 1080) await expect(page.locator('.studio-project-sidebar')).toBeHidden();
  await page.screenshot({ path: info.outputPath(`dsh-launch-${layout.name}.png`) });
  await page.keyboard.press('Tab'); await launch.focus(); await expect(launch).toBeFocused();
  expect(await launch.evaluate(node => getComputedStyle(node).outlineStyle)).not.toBe('none');
  await page.keyboard.press('Enter');
  const frame = page.frameLocator('iframe.dsh-native-frame');
  const draft = frame.getByRole('textbox', { name: 'Foreign application draft' });
  await draft.fill('keep the upstream draft'); await expect(draft).toBeFocused();
  const runtimeNavigation = page.getByRole('navigation', { name: 'Harness Design', exact: true });
  await runtimeNavigation.getByRole('button', { name: 'DSH', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(runtimeNavigation.getByRole('button', { name: 'Pi', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Start Pi', exact: true })).toBeVisible();
  await page.goBack();
  await expect(draft).toBeVisible();
  await expect(draft).toHaveValue('keep the upstream draft');
  const sessions = page.getByRole('button', { name: 'Sessions', exact: true });
  if (await page.locator('.studio-nav-toggle').getAttribute('aria-expanded') === 'false') await page.locator('.studio-nav-toggle').click();
  await sessions.click();
  const dshNav = page.getByRole('button', { name: 'Harness Design', exact: true });
  if (await page.locator('.studio-nav-toggle').getAttribute('aria-expanded') === 'false') await page.locator('.studio-nav-toggle').click();
  await dshNav.click();
  await expect(draft).toHaveValue('keep the upstream draft');
  expect(opens).toEqual([directory]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect.poll(async () => (await page.locator('iframe.dsh-native-frame').boundingBox()).width).toBeGreaterThan(200);
  const bounds = await page.locator('iframe.dsh-native-frame').boundingBox();
  expect(bounds.width).toBeGreaterThan(200); expect(bounds.x + bounds.width).toBeLessThanOrEqual(layout.width);
  if (layout.width <= 1080) await expect(page.locator('.studio-project-sidebar')).toBeHidden();
  await page.screenshot({ path: info.outputPath(`dsh-container-${layout.name}.png`) });
  await expect(page.locator('#studio-toolbar-actions button')).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('Web setup is independent of ACP and control rejects cross-origin and stale Project requests', async ({ page }) => {
  await start(); await open(page);
  const config = await (await page.request.get(`${server.url}/api/config`)).json();
  expect(config.dshWebEnabled).toBe(true); expect(config.acpEnabled).toBe(false);
  const headers = { 'X-Harness-Project-Id': config.activeProjectId, 'X-Harness-Project-Revision': String(config.projectRevision) };
  expect((await page.request.post(`${server.url}/api/dsh/web`, { headers: { ...headers, Origin: 'https://evil.test' } })).status()).toBe(403);
  expect((await page.request.post(`${server.url}/api/dsh/web`, { headers: { ...headers, 'X-Harness-Project-Revision': '0' } })).status()).toBe(409);
  expect(opens).toEqual([]);
});
test('missing native Web host displays setup', async ({ page }) => {
  await start({ missing: true }); await page.goto(`${server.url}/#/dsh`);
  await expect(page.getByText('DSH Web is unavailable.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start DSH', exact: true })).toBeDisabled();
  await expect(page.locator('iframe.dsh-native-frame')).toHaveCount(0);
});
test('installed official DSH interface loads and keeps its native controls', async ({ page }, info) => {
  test.skip(!process.env.DSH_WEB_COMMAND, 'Set DSH_WEB_COMMAND and DSH_WEB_ARGS to an installed official CLI.');
  test.setTimeout(90000);
  await start({ native: true }); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize(layouts[0]); await open(page);
  await page.getByRole('button', { name: 'Start DSH', exact: true }).click();
  await expect(page.locator('iframe.dsh-native-frame')).toBeVisible({ timeout: 60000 });
  const frame = page.frameLocator('iframe.dsh-native-frame');
  await expect(frame.locator('body')).not.toContainText('Unauthorized');
  await expect(frame.getByRole('button', { name: 'Settings', exact: true })).toBeVisible({ timeout: 20000 });
  const later = frame.getByRole('button', { name: 'Configure later', exact: true });
  await later.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
  if (await later.isVisible()) await later.click();
  await expect(later).toBeHidden();
  await frame.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(frame.getByText('General', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('official-dsh-settings.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
