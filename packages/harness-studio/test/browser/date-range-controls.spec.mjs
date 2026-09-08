import { expect, test } from '@playwright/test';
import { startSharedScopeFixture } from './fixtures/shared-scope.mjs';
let studio;
test.beforeAll(async () => { studio = await startSharedScopeFixture(); });
test.afterAll(async () => { await studio.close(); });

for (const theme of ['light', 'dark']) {
  test(`date selection and focus remain compact in ${theme}`, async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    for (const layout of [
      { name: 'wide', width: 1440, height: 900 },
      { name: 'compact', width: 1024, height: 768 },
      { name: 'narrow', width: 390, height: 844 },
    ]) {
      await page.setViewportSize(layout);
      await page.goto(studio.url);
      if (layout.width <= 1080) await page.getByRole('button', { name: 'Open Studio navigation', exact: true }).click();
      const preset = page.getByRole('combobox', { name: 'Observation window' });
      await preset.selectOption('custom');
      const from = page.getByLabel('From', { exact: true });
      const to = page.getByLabel('To', { exact: true });
      await from.fill('2026-08-01');
      await to.fill('2026-09-08');
      await page.getByRole('heading', { name: 'Views', exact: true }).click();
      await expect(preset).toHaveValue('custom');
      await expect(page.getByRole('group', { name: 'Custom range' })).toBeVisible();
      await expect(page.locator('.studio-date-range-summary')).toHaveCount(0);
      await expect(from).toHaveValue('2026-08-01');
      await expect(to).toHaveValue('2026-09-08');
      const before = await preset.boundingBox();
      await page.screenshot({ path: testInfo.outputPath(`date-selected-${theme}-${layout.name}.png`), animations: 'disabled' });
      await page.keyboard.press('Tab');
      await preset.focus();
      await expect(preset).toBeFocused();
      expect(await preset.boundingBox()).toEqual(before);
      await expect(preset).toHaveCSS('outline-style', 'solid');
      await expect(preset).toHaveCSS('outline-width', '2px');
      await expect(preset).toHaveCSS('outline-offset', '-2px');
      await page.screenshot({ path: testInfo.outputPath(`date-focus-${theme}-${layout.name}.png`), animations: 'disabled' });
      await page.keyboard.press('Tab');
      await expect(from).toBeFocused();
      await expect(from).toHaveCSS('outline-style', 'solid');
      await expect(from).toHaveCSS('outline-offset', '-2px');
      expect(await page.locator('.studio-date-range').evaluate(root => {
        const bounds = root.getBoundingClientRect();
        return [...root.querySelectorAll('input,select,svg')].every(el => {
          const rect = el.getBoundingClientRect();
          return rect.left >= bounds.left && rect.right <= bounds.right;
        });
      })).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    expect(errors).toEqual([]);
  });
}

test('inverted range exposes its field error and recovers', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(studio.url);
  await page.getByRole('combobox', { name: 'Observation window' }).selectOption('custom');
  const from = page.getByLabel('From', { exact: true });
  const to = page.getByLabel('To', { exact: true });
  await from.fill('2026-09-08');
  await to.fill('2026-08-01');
  await expect(page.getByRole('alert')).toHaveText('The start is after the end.');
  await expect(from).toHaveAttribute('aria-invalid', 'true');
  await expect(to).toHaveAccessibleDescription('The start is after the end.');
  await to.fill('2026-09-09');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(from).not.toHaveAttribute('aria-invalid', 'true');
});
