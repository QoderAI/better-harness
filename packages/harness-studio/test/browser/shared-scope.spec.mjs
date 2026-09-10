import { expect, test } from '@playwright/test';
import { startSharedScopeFixture } from './fixtures/shared-scope.mjs';

const layouts = [ { name: 'wide', width: 1440, height: 900 }, { name: 'compact', width: 1024, height: 768 }, { name: 'narrow', width: 390, height: 844 } ];
let studio;
test.beforeEach(async () => { studio = await startSharedScopeFixture(); });
test.afterEach(async () => { await studio.close(); });

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}
async function checkLayout(page, testInfo, name) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true, animations: "disabled" });
}
async function openProject(page, view = 'sessions') {
  await page.request.post(`${studio.url}/api/projects/open`);
  await page.goto(`${studio.url}/#/${view}`);
}

for (const theme of ['light', 'dark']) {
  test(`welcome is a non-blocking workbench in ${theme}`, async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    for (const layout of layouts) {
      await page.setViewportSize(layout);
      await page.goto(studio.url);
      await expect(page.getByRole('heading', { name: 'Your local agent workbench' })).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.locator('.studio-project-views [aria-current="page"]')).toHaveCount(0);
      await expect(page.locator('.studio-project-views button[tabindex="0"]')).toHaveCount(1);
      const open = page.getByRole('button', { name: 'Open Project', exact: true });
      await page.keyboard.press('Tab');
      await open.focus();
      expect(await open.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
      await checkLayout(page, testInfo, `welcome-${theme}-${layout.name}`);
      if (layout.width <= 1080) await page.getByRole('button', { name: 'Open Studio navigation', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Settings: appearance and language' })).toBeVisible();
      await expect(page.locator('.studio-project-views small')).toHaveCount(0);
      await expect(page.locator('.studio-status-scope .availability-dot')).toHaveCount(0);
      await page.getByRole('navigation', { name: 'Studio View navigation' }).getByRole('button', { name: 'Artifacts', exact: true }).click();
      await expect(page.locator('.artifact-workspace')).toBeVisible();
      await expect(page.locator('.studio-project-views [aria-current="page"]')).toHaveText('Artifacts');
    }
    expect(studio.pickerCalls).toBe(0);
    expect(errors).toEqual([]);
  });
}

test('cancel keeps welcome usable; opening and reloading enters the project directly', async ({ page }) => {
  await page.setViewportSize(layouts[0]);
  await page.goto(studio.url);
  studio.setCancel(true);
  await page.getByRole('button', { name: 'Open Project', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Project', exact: true })).toBeEnabled();
  await expect(page.locator('.studio-welcome')).toBeVisible();
  studio.setCancel(false);
  await page.getByRole('button', { name: 'Open Project', exact: true }).click();
  await expect(page.locator('.studio-welcome')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.studio-project-switcher')).toContainText('Scope fixture');
  await expect(page.locator('.studio-welcome')).toHaveCount(0);
  await expect(page.locator('.studio-project-views [aria-current="page"]')).toHaveText('Overview');
  expect(studio.pickerCalls).toBe(2);
});

test('Sessions loads and recomputes the shared range in Inspector, preserving the active view', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await page.setViewportSize(layouts[0]);
  await openProject(page);
  await expect(page.locator('.workbench-list > article')).toHaveCount(2);
  await expect(page.getByRole('tab', { name: 'Date', exact: true })).toHaveCount(0);
  await expect(page.locator('.studio-status-bar')).toContainText('2 sessions');
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  await page.route('**/api/sessions', async route => { await blocked; await route.continue(); }, { times: 1 });
  const range = page.getByRole('combobox', { name: 'Observation window' });
  await range.selectOption('today');
  await expect(page.locator('.studio-surface-sessions [aria-busy="true"]')).toBeVisible();
  await checkLayout(page, testInfo, 'sessions-loading');
  release();
  await expect(page.locator('.workbench-list > article')).toHaveCount(1);
  await expect(page.locator('.workbench-list')).toContainText('Review current workflow');
  await expect(page.locator('.workbench-list')).not.toContainText('Review archived workflow');
  await expect(page.locator('.studio-status-bar')).not.toContainText('2 sessions');
  await range.selectOption('all');
  await expect(page.locator('.workbench-list > article')).toHaveCount(2);
  await expect(page.locator('.studio-status-bar')).toContainText('2 sessions');
  await range.selectOption('today');
  await expect(page.locator('.workbench-list > article')).toHaveCount(1);
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    for (const layout of layouts) {
      await page.setViewportSize(layout);
      await expect(page.locator('.workbench-list > article')).toHaveCount(1);
      await checkLayout(page, testInfo, `sessions-${theme}-${layout.name}`);
    }
  }
  expect(errors).toEqual([]);
});

test('Artifacts refreshes all panes, clears empty previews, and ignores a superseded response', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await page.setViewportSize(layouts[0]);
  await openProject(page, 'artifacts');
  await expect(page.locator('.artifact-rows > button')).toHaveCount(2);
  await expect(page.getByRole('tab', { name: 'Date', exact: true })).toHaveCount(0);
  const range = page.getByRole('combobox', { name: 'Observation window' });
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  await page.route('**/api/artifacts', async route => { const response = await route.fetch(); await blocked; await route.fulfill({ response }); }, { times: 1 });
  await range.selectOption('today');
  await expect(page.locator('.studio-surface-artifacts [aria-busy="true"]')).toBeVisible();
  await checkLayout(page, testInfo, 'artifacts-loading');
  await range.selectOption('all');
  await expect(page.locator('.artifact-rows > button')).toHaveCount(2);
  release();
  await expect(page.locator('.artifact-rows > button')).toHaveCount(2);
  await range.selectOption('today');
  await expect(page.locator('.artifact-rows > button')).toHaveCount(1);
  await expect(page.locator('.artifact-file-tree')).not.toContainText('archived.md');
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    for (const layout of layouts) { await page.setViewportSize(layout); await checkLayout(page, testInfo, `artifacts-${theme}-${layout.name}`); }
  }
  await page.setViewportSize(layouts[0]);
  await range.selectOption('custom');
  await page.getByLabel('From', { exact: true }).fill('1990-01-01');
  await page.getByLabel('To', { exact: true }).fill('1990-01-02');
  await expect(page.locator('.artifact-rows > button')).toHaveCount(0);
  await expect(page.locator('.artifact-editor-header')).toHaveCount(0);
  await expect(page.locator('.artifact-scope-pane')).toContainText('Widen the date range');
  expect(errors).toEqual([]);
});

for (const view of ['sessions', 'artifacts']) {
  test(`${view} recovers a failed range load with Retry`, async ({ page }) => {
    await page.setViewportSize(layouts[0]);
    await openProject(page, view);
    await expect(page.locator(view === 'sessions' ? '.workbench-list > article' : '.artifact-rows > button')).toHaveCount(2);
    await page.route(`**/api/${view}`, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary fixture failure' }) }), { times: 1 });
    await page.getByRole('combobox', { name: 'Observation window' }).selectOption('today');
    const retry = page.getByRole('button', { name: 'Retry', exact: true });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(page.locator(view === 'sessions' ? '.workbench-list > article' : '.artifact-rows > button')).toHaveCount(1);
  });
}

test('Inspector retry reattaches its workbench after a failed report load', async ({ page }) => {
  await page.setViewportSize(layouts[0]);
  await page.route('**/api/workspace-inspector-report', route => route.fulfill({ status: 503, body: 'temporary failure' }), { times: 1 });
  await openProject(page);
  await expect(page.locator('.inspector-fallback-shell')).toBeVisible();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('.workbench-list > article')).toHaveCount(2);
});
