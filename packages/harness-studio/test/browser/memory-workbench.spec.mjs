import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { startHarnessStudioServer } from '../../dist/server/server.js';
let studio;
test.beforeAll(async () => { studio = await startHarnessStudioServer({ port: 0, appDir: join(dirname(fileURLToPath(import.meta.url)), '../../dist/app') }); });
test.afterAll(async () => { await studio?.close(); });

for (const layout of [{ name: 'wide', width: 1440, height: 900 }, { name: 'compact', width: 1024, height: 768 }, { name: 'narrow', width: 390, height: 844 }]) {
  test(`Memory inbox, inspector and promotion at ${layout.name}`, async ({ page }, info) => {
    const errors = [], writes = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('request', request => { if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) writes.push(request.url()); });
    await page.setViewportSize(layout);
    await page.goto(`${studio.url}/#/sessions`);
    if (layout.width <= 1080) await page.locator('.studio-nav-toggle').click();
    await page.getByRole('button', { name: 'Memory', exact: true }).click();
    await expect(page.getByText('Design preview', { exact: true }).first()).toBeVisible();
    await expect(page.locator('.memory-review-card')).toHaveCount(5);
    await expect(page.locator('.memory-review-evidence-list li')).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`memory-review-inbox-${layout.name}.png`) });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: info.outputPath(`memory-review-inbox-dark-${layout.name}.png`) });
    await page.getByRole('combobox', { name: 'Promote to', exact: true }).selectOption('Procedure');
    const accept = page.getByRole('button', { name: 'Accept Procedure' });
    await accept.focus();
    await expect(accept).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.memory-review-card')).toHaveCount(4);
    await page.getByRole('tab', { name: 'Project Memory 1' }).click();
    await expect(page.locator('.memory-review-card')).toHaveCount(1);
    await expect(page.locator('.memory-review-card')).toContainText('Isolate third-party connectors');
    await expect(page.locator('.memory-review-card')).not.toContainText('Claude Code');
    await expect(page.getByText('Promotion lineage', { exact: true })).toBeVisible();
    await expect(page.locator('.memory-review-promotion-line')).toContainText('Human review');
    await page.screenshot({ path: info.outputPath(`memory-review-promoted-${layout.name}.png`) });
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('editing, rejection and conflict review change the preview inbox', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${studio.url}/#/memory`);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Statement', { exact: true }).fill('A reviewed statement about connector isolation.');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.memory-review-card').first()).toContainText('A reviewed statement about connector isolation.');
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(page.locator('.memory-review-card')).toHaveCount(4);
  await page.locator('.memory-review-card').filter({ hasText: 'Resolve the connector process boundary' }).click();
  await expect(page.getByRole('button', { name: 'Accept ADR' })).toBeDisabled();
  await page.screenshot({ path: info.outputPath('memory-review-conflict.png') });
  await page.getByRole('checkbox', { name: 'Use the reviewed statement to resolve this conflict' }).check();
  await page.getByRole('button', { name: 'Accept ADR' }).click();
  await expect(page.getByRole('tab', { name: 'Project Memory 1' })).toBeVisible();
  await page.getByRole('tab', { name: 'Inbox 3' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Project Memory 1' })).toHaveAttribute('aria-selected', 'true');
});

test('filters keep inspector selection in scope and personal routing stays outside Project Memory', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${studio.url}/#/memory`);
  await page.getByRole('button', { name: 'Conflicts 1' }).click();
  await expect(page.locator('.memory-review-card')).toHaveCount(1);
  await expect(page.locator('.memory-review-statement')).toContainText('Resolve the connector process boundary');
  await page.getByRole('button', { name: 'All candidates 5' }).click();
  await page.getByRole('combobox', { name: 'Promote to' }).selectOption('Personal Memory');
  await page.getByRole('button', { name: 'Accept Personal Memory' }).click();
  await expect(page.getByRole('tab', { name: 'Inbox 4' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Project Memory 0' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Filter candidates…' }).fill('revision');
  await expect(page.locator('.memory-review-card')).toHaveCount(1);
  await expect(page.locator('.memory-review-statement')).toHaveCount(0);
  await page.route('**/api/memory', route => route.fulfill({ json: { sources: [], documents: [] } }));
  await page.getByRole('button', { name: 'Memory sources' }).click();
  await expect(page.getByRole('heading', { name: 'Memory sources', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Documents 0' })).toBeVisible();
});
