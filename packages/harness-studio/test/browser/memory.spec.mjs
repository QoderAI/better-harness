import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { startHarnessStudioServer } from '../../dist/server/server.js';
let studio, home;
const skillDocument = 'skills/personal-codex-plugin-scaffold/SKILL.md';
test.beforeAll(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'studio-memory-')));
  const root = join(home, '.codex', 'memories');
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'MEMORY.md'), '# Architecture knowledge\n\nKeep **source provenance** with each snapshot.\n\n- Read only\n- No extraction\n\n```ts\nconst memory = "native";\n```\n');
  await mkdir(join(root, 'skills', 'personal-codex-plugin-scaffold'), { recursive: true });
  await writeFile(join(root, skillDocument), '# Architecture knowledge\n\n```ts\nconst memory = \"native\";\n```\n');
  for (const relative of [['.claude', 'projects', 'example-project', 'memory', 'runtime-boundaries.md'], ['.qwen', 'memories', 'review-preferences.md']]) {
    const file = join(home, ...relative);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, '# Synthetic Memory\n\nPrivate example body.');
  }
  studio = await startHarnessStudioServer({ port: 0, appDir: join(dirname(fileURLToPath(import.meta.url)), '../../dist/app'), memoryHome: home });
});
test.afterAll(async () => { await studio?.close(); await rm(home, { recursive: true, force: true }); });
test('API requires document authorization and scope; inventory has no bodies', async () => {
  const response = await fetch(`${studio.url}/api/memory`);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const inventory = await response.json();
  expect(inventory.documents).toHaveLength(4);
  expect(JSON.stringify(inventory)).not.toContain('source provenance');
  const doc = inventory.documents.find(doc => doc.provenance.host === 'codex');
  for (const body of [{ id: doc.id, scope: 'user' }, { id: doc.id, scope: 'project', authorized: true }, { id: '../MEMORY.md', scope: 'user', authorized: true }]) {
    expect((await fetch(`${studio.url}/api/memory/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(400);
  }
  expect((await fetch(`${studio.url}/api/memory/read`, { method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(403);
});
for (const layout of [{ name: 'wide', width: 1440, height: 900 }, { name: 'compact', width: 1024, height: 768 }, { name: 'narrow', width: 390, height: 844 }]) {
  test(`global Memory table and authorized Markdown at ${layout.name}`, async ({ page }, info) => {
    const errors = [];
    const reads = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('request', request => { if (request.url().endsWith('/api/memory/read')) reads.push(request); });
    await page.setViewportSize(layout);
  await page.goto(`${studio.url}/#/memory-sources`);
    await page.getByRole('searchbox').fill('personal-codex-plugin-scaffold');
    const document = page.getByRole('treeitem', { name: 'SKILL.md', exact: true });
    await document.focus();
    await expect(document).toBeFocused();
    await expect.poll(() => reads.length).toBe(1);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Architecture knowledge' })).toBeVisible();
    expect(reads).toHaveLength(2);
    expect(reads[1].postDataJSON()).toMatchObject({ scope: 'user', authorized: true });
    const provenance = page.locator('.memory-provenance');
    expect(await provenance.evaluate(element => element.open)).toBe(false);
    await expect(provenance.locator('summary')).toContainText(join(home, '.codex', 'memories', skillDocument));
    await expect(provenance.locator('.memory-provenance-path')).toBeVisible();
    await expect(page.locator('.memory-reader-header')).toContainText(skillDocument);
    await expect(page.locator('.memory-reader-header .memory-reader-meta')).toHaveText('CodexUnparsedSkills');
    await page.screenshot({ path: info.outputPath(`memory-collapsed-${layout.name}.png`) });
    await page.getByText('Snapshot provenance', { exact: true }).click();
    await expect(page.locator('.memory-reader code').filter({ hasText: 'sha256:' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`memory-${layout.name}.png`) });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.reload();
    await expect(page.locator('.memory-reader .highlighted-code')).toHaveAttribute('data-highlight-state', 'highlighted');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: info.outputPath(`memory-dark-${layout.name}.png`) });
    if (layout.width <= 700) await page.getByRole('button', { name: 'Memory navigation', exact: true }).click();
    await page.getByLabel('Agent', { exact: true }).selectOption('cursor');
    await expect(page.getByRole('treeitem', { name: 'SKILL.md', exact: true })).toHaveCount(0);
    await page.getByText('Source status', { exact: true }).click();
    await expect(page.getByText('No native storage contract', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`memory-unavailable-${layout.name}.png`) });
    expect(errors).toEqual([]);
  });
}
test('a late read cannot replace the next selected document', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const hydration = page.waitForResponse(response => response.url().endsWith('/api/memory/read'));
  await page.goto(`${studio.url}/#/memory-sources`);
  await (await hydration).finished();
  await expect(page.locator('.memory-index-status')).toHaveCount(0);
  let release, markStarted, markFinished;
  const held = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { markStarted = resolve; });
  const finished = new Promise(resolve => { markFinished = resolve; });
  let reads = 0;
  await page.route('**/api/memory/read', async route => {
    reads++;
    if (reads !== 1) return route.continue();
    const response = await route.fetch();
    markStarted();
    await held;
    await route.fulfill({ response });
    markFinished();
  });
  await page.getByRole('searchbox').fill('personal-codex-plugin-scaffold');
  await page.getByRole('treeitem', { name: 'SKILL.md', exact: true }).click();
  await started;
  await page.getByRole('searchbox').fill('runtime-boundaries.md');
  await page.getByRole('treeitem', { name: 'runtime-boundaries.md', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Synthetic Memory' })).toBeVisible();
  release();
  await finished;
  await expect(page.getByRole('heading', { name: 'Architecture knowledge' })).toHaveCount(0);
  await expect(page.locator('.memory-reader-header')).toContainText('runtime-boundaries.md');
  await page.getByRole('searchbox').fill('runtime-boundaries.md');
  await page.getByRole('treeitem', { name: 'runtime-boundaries.md', exact: true }).first().click();
  expect(reads).toBe(2);
});
test('a selected document can retry after a failed read', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const hydration = page.waitForResponse(response => response.url().endsWith('/api/memory/read'));
  await page.goto(`${studio.url}/#/memory-sources`);
  await (await hydration).finished();
  await expect(page.locator('.memory-index-status')).toHaveCount(0);
  let reads = 0;
  await page.route('**/api/memory/read', route => {
    reads++;
    return reads === 1
      ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Unavailable' }) })
      : route.continue();
  });
  await page.getByRole('searchbox').fill('personal-codex-plugin-scaffold');
  await page.getByRole('treeitem', { name: 'SKILL.md', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Retry reading', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Architecture knowledge' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(reads).toBe(2);
});
