import { mkdtemp, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { startHarnessStudioServer } from '../../dist/server/server.js';
let studio, directory;
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'compare-workspace-'));
  await cp(resolve('dist/app'), join(directory, 'app'), { recursive: true });
  const agent = { command: process.execPath, args: [resolve('../harness/test/fixtures/acp-agent.mjs'), '--conversation', '--session-controls', '--compare-files'], label: 'Alpha ACP' };
  studio = await startHarnessStudioServer({ appDir: join(directory, 'app'), runDirectory: directory,
    workspaceDirectoryPicker: async () => resolve('.'), workspaceSessionProvider: { discover: async () => ({ label: 'Compare fixture', sessions: [] }) },
    acpAgent: agent, acpAgents: [{ id: 'alpha', label: 'Alpha ACP', agent }, { id: 'beta', label: 'Beta ACP', agent: { ...agent, args: [...agent.args, '--compare-read-failure'] } }],
  });
});
test.afterAll(async () => { await studio?.close(); await rm(directory, { recursive: true, force: true }); });

test('compact activity preserves streaming expansion, visible failures, permissions and nested file reveal', async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${studio.url}/#/compare`);
  const open = page.getByRole('button', { name: 'Open Project', exact: true });
  const input = page.getByRole('textbox', { name: 'What should these Agents do?' });
  await expect(open.or(input)).toBeVisible(); if (await open.isVisible()) await open.click();
  await input.fill('compact activity fixture');
  await page.getByRole('button', { name: /^Choose Agents/ }).click();
  for (const name of ['Alpha ACP', 'Beta ACP']) await page.getByRole('menuitemcheckbox', { name: new RegExp(name) }).click();
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Run 2 Agents' }).click();
  const alpha = page.locator('.live-compare-lane').first();
  const activity = alpha.locator('.acp-activity-header');
  await expect(alpha.getByRole('button', { name: 'Finish activity', exact: true })).toBeVisible();
  await expect(activity).toHaveCount(1);
  await expect(activity).toHaveAttribute('aria-expanded', 'false');
  await expect(activity).toContainText('1 failed'); await expect(activity).toContainText('running');
  expect((await activity.boundingBox()).height).toBeLessThanOrEqual(32);
  await expect(alpha.locator('.tool-card')).toHaveCount(0);
  await page.keyboard.press('Tab'); await activity.focus(); expect(await activity.evaluate(node => getComputedStyle(node).outlineStyle)).toBe('solid');
  await page.keyboard.press('Enter');
  await expect(alpha.locator('.acp-thought')).toContainText('Inspect the source');
  await expect(alpha.locator('.tool-card')).toHaveCount(5);
  await alpha.getByRole('button', { name: 'Finish activity', exact: true }).click();
  await expect(alpha.locator('.acp-turn-status')).toHaveText('Ready');
  await expect(activity).toHaveAttribute('aria-expanded', 'true');
  await expect(alpha.locator('.tool-card')).toHaveCount(6);
  await expect(activity).not.toContainText('running'); await expect(activity).toContainText('1 failed');
  await page.getByRole('button', { name: 'Sessions', exact: true }).click();
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(activity).toHaveAttribute('aria-expanded', 'true');
  await activity.click();
  await expect(alpha.getByText('The source review is complete.', { exact: false })).toBeVisible();
  const beta = page.locator('.live-compare-lane').nth(1);
  await beta.getByRole('button', { name: 'Finish activity', exact: true }).click();
  await expect(beta.locator('.acp-turn-status')).toHaveText('Ready');
  for (const theme of ['light', 'dark']) for (const layout of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' }); await page.setViewportSize(layout);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await activity.focus();
    const bounds = await activity.boundingBox(); expect(bounds.x + bounds.width).toBeLessThanOrEqual(layout.width);
    await page.screenshot({ animations: 'disabled', path: info.outputPath(`compact-activity-${theme}-${layout.width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('.compare-files > summary').click();
  const row = page.locator('.compare-files tbody tr').filter({ hasText: 'src/shared.ts' });
  await row.getByRole('button', { name: /Alpha ACP/ }).click();
  await expect(activity).toHaveAttribute('aria-expanded', 'true');
  const tool = alpha.locator('.ai-tool-header').filter({ hasText: 'Read conversation evidence' });
  await expect(tool).toBeFocused(); await expect(tool).toHaveAttribute('aria-expanded', 'true');
  await page.screenshot({ animations: 'disabled', path: info.outputPath('compact-activity-expanded.png') });
  expect(errors).toEqual([]);
});

test('bottom composer, resizable conversations and linked file outcomes work across layouts', async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${studio.url}/#/compare`);
  const open = page.getByRole('button', { name: 'Open Project', exact: true });
  const input = page.getByRole('textbox', { name: 'What should these Agents do?' });
  await expect(open.or(input)).toBeVisible(); if (await open.isVisible()) await open.click();
  for (const layout of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(layout);
    const composer = await page.locator('.live-compare-composer').boundingBox();
    const workspace = await page.locator('.live-compare-workspace').boundingBox();
    expect(workspace.y + workspace.height - composer.y - composer.height).toBeLessThan(20);
    await page.getByRole('button', { name: /^Choose Agents/ }).click();
    const menu = page.getByRole('menu', { name: 'Available Agents' });
    await expect(menu).toBeVisible();
    const bounds = await menu.boundingBox(); expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThan(composer.y + composer.height);
    await page.keyboard.press('Escape');
    await page.screenshot({ animations: 'disabled', path: info.outputPath(`compare-idle-${layout.width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await input.fill('Inspect shared file');
  await page.getByRole('button', { name: /^Choose Agents/ }).click();
  for (const name of ['Alpha ACP', 'Beta ACP']) await page.getByRole('menuitemcheckbox', { name: new RegExp(name) }).click();
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Run 2 Agents' }).click();
  const lanes = page.locator('.live-compare-lane'), alpha = lanes.nth(0), beta = lanes.nth(1);
  await expect(alpha.locator('.acp-turn-status')).toHaveText('Ready');
  await expect(beta.locator('.acp-turn-status')).toHaveText('Ready');
  await expect(alpha.locator('.run-badge')).toHaveText('Completed');
  const pathSummary = alpha.locator('.acp-activity-path').filter({ hasText: 'src/shared.ts' });
  await expect(pathSummary).toBeVisible(); expect((await pathSummary.boundingBox()).width).toBeGreaterThan(20);
  await beta.locator('textarea').fill('Private beta draft');
  const sash = page.getByRole('separator', { name: 'Resize Alpha ACP and Beta ACP' });
  const before = (await alpha.boundingBox()).width;
  await sash.focus(); await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await alpha.boundingBox()).width).toBeGreaterThan(before + 20);
  const sashBox = await sash.boundingBox();
  await page.mouse.move(sashBox.x + sashBox.width / 2, sashBox.y + sashBox.height / 2);
  await page.mouse.down(); await page.mouse.move(sashBox.x - 80, sashBox.y + 20); await page.mouse.up();
  await expect.poll(async () => (await alpha.boundingBox()).width).toBeLessThan(before);
  const resized = (await alpha.boundingBox()).width;
  await page.getByRole('button', { name: 'Sessions', exact: true }).click();
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  expect(Math.abs((await alpha.boundingBox()).width - resized)).toBeLessThan(2);
  await expect(beta.locator('textarea')).toHaveValue('Private beta draft');
  await sash.dblclick(); expect(Math.abs((await alpha.boundingBox()).width - (await beta.boundingBox()).width)).toBeLessThan(2);
  await page.locator('.compare-files > summary').click();
  const row = page.locator('.compare-files tbody tr').filter({ hasText: 'src/shared.ts' });
  await expect(row).toHaveCount(1); await expect(row).toContainText('Completed'); await expect(row).toContainText('Failed');
  await expect(page.locator('.compare-files tbody tr').filter({ hasText: 'src/beta-only.ts' })).toContainText('Not observed');
  await row.getByRole('button', { name: /Beta ACP/ }).click();
  const betaTool = beta.locator('.ai-tool-header').filter({ hasText: 'Read conversation evidence' });
  await expect(betaTool).toBeFocused(); await expect(betaTool).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(async () => {
    const header = await betaTool.boundingBox(), transcript = await beta.locator('.acp-session-scroll').boundingBox();
    return header.y >= transcript.y && header.y + header.height <= transcript.y + transcript.height;
  }).toBe(true);
  await expect(alpha.locator('.acp-activity-header')).toHaveAttribute('aria-expanded', 'false');
  await expect(beta.locator('textarea')).toHaveValue('Private beta draft');
  for (const theme of ['light', 'dark']) for (const layout of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' }); await page.setViewportSize(layout);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const bounds = await page.locator('.live-compare-lanes').boundingBox(); expect(bounds.height).toBeGreaterThan(200);
    if (layout.width === 390) {
      await expect(sash).toBeHidden();
      const result = await row.getByRole('button', { name: /Beta ACP/ }).boundingBox();
      expect(result.x + result.width).toBeLessThanOrEqual(390);
    }
    await page.screenshot({ animations: 'disabled', path: info.outputPath(`compare-files-${theme}-${layout.width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await alpha.locator('textarea').fill('wait for cancellation'); await alpha.locator('textarea').press('Enter');
  await expect(alpha.locator('.run-badge')).toHaveText('running');
  await alpha.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(alpha.locator('.run-badge')).toHaveText('Interrupted');
  expect(errors).toEqual([]);
});

test('one Agent runs, streams and accepts a follow-up across layouts', async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${studio.url}/#/compare`);
  const open = page.getByRole('button', { name: 'Open Project', exact: true });
  const input = page.getByRole('textbox', { name: 'What should these Agents do?' });
  await expect(open.or(input)).toBeVisible(); if (await open.isVisible()) await open.click();
  await input.fill('Inspect shared file');
  await page.getByRole('button', { name: /^Choose Agents/ }).click();
  await page.getByRole('menuitemcheckbox', { name: /Alpha ACP/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.live-compare-shared-tree')).toHaveCount(0);
  await page.getByRole('button', { name: 'Run 1 Agent', exact: true }).click();
  const lane = page.locator('.live-compare-lane');
  await expect(lane).toHaveCount(1);
  await expect(lane.locator('.acp-turn-status')).toHaveText('Ready');
  await expect(lane.locator('.run-badge')).toHaveText('Completed');
  for (const layout of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(layout);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await lane.locator('textarea').focus();
    await expect(lane.locator('textarea')).toBeFocused();
    await page.screenshot({ path: info.outputPath(`single-agent-${layout.width}.png`) });
  }
  await lane.locator('textarea').fill('Continue inspecting');
  await lane.locator('textarea').press('Enter');
  await expect(lane.locator('.acp-turn-status')).toHaveText('Ready');
  await expect(lane).toContainText('Continue inspecting');
  expect(errors).toEqual([]);
});
