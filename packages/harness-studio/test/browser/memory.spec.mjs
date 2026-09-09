import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { startHarnessStudioServer } from '../../dist/server/server.js';
let studio, home;
test.beforeAll(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'studio-memory-')));
  const root = join(home, '.codex', 'memories');
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'MEMORY.md'), '# Architecture knowledge\n\nKeep **source provenance** with each snapshot.\n\n- Read only\n- No extraction\n\n```ts\nconst memory = "native";\n```\n');
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
  expect(inventory.documents).toHaveLength(3);
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
    await expect(page.getByRole('heading', { name: 'Memory sources', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'MEMORY.md', exact: true }).click();
    expect(reads).toHaveLength(0);
    const read = page.getByRole('button', { name: 'Read this document' });
    await read.focus();
    await expect(read).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Architecture knowledge' })).toBeVisible();
    expect(reads).toHaveLength(1);
    await page.getByText('Snapshot provenance', { exact: true }).click();
    await expect(page.locator('.memory-reader code').filter({ hasText: 'sha256:' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`memory-${layout.name}.png`) });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.reload();
    await page.getByRole('button', { name: 'MEMORY.md', exact: true }).click();
    await page.getByRole('button', { name: 'Read this document' }).click();
    await expect(page.locator('.memory-reader .highlighted-code')).toHaveAttribute('data-highlight-state', 'highlighted');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: info.outputPath(`memory-dark-${layout.name}.png`) });
    await page.getByLabel('Agent', { exact: true }).selectOption('cursor');
    await expect(page.getByText('No Memory documents match these filters. Check Sources for coverage.')).toBeVisible();
    await page.getByRole('tab', { name: /^Sources/ }).click();
    await expect(page.getByText('No native storage contract', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`memory-unavailable-${layout.name}.png`) });
    expect(errors).toEqual([]);
  });
}
test('filter changes discard an in-flight authorized response', async ({ page }) => {
  await page.goto(`${studio.url}/#/memory-sources`);
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route('**/api/memory/read', async route => { await held; await route.continue(); });
  await page.getByRole('button', { name: 'MEMORY.md', exact: true }).click();
  await page.getByRole('button', { name: 'Read this document' }).click();
  await page.getByLabel('Agent', { exact: true }).selectOption('cursor');
  const response = page.waitForResponse('**/api/memory/read');
  release();
  await response;
  await expect(page.getByRole('heading', { name: 'Architecture knowledge' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Memory reader' })).toHaveCount(0);
});
