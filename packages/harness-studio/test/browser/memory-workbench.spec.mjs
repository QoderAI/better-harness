import { access, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { startHarnessStudioServer } from '../../dist/server/server.js';
let studio, home, calls = [];
const content = '# User Profile\n\nPrefers concise labels.\n\n# General Tips\n\nKeep source evidence.\n\n# Projects\n\n## /work/alpha\n\nAlpha has an explicit scope.\n\n## /work/beta\n\nBeta has a separate scope.';
test.beforeAll(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'studio-memory-browser-')));
  const root = join(home, '.codex', 'memories');
  await mkdir(join(root, 'rollout_summaries'), { recursive: true });
  await writeFile(join(root, 'memory_summary.md'), content);
  await writeFile(join(root, 'MEMORY.md'), content);
  await Promise.all(Array.from({ length: 256 }, (_, i) => writeFile(join(root, 'rollout_summaries', `episode-${String(i).padStart(3, '0')}.md`), '# Synthetic history\n\nPrior evidence.')));
  for (const relative of ['skills/one/SKILL.md', 'skills/two/SKILL.md', 'extensions/one.md', 'extensions/two.md', 'extensions/three.md', 'extensions/four.md', 'raw_memories.md']) {
    const file = join(root, ...relative.split('/')); await mkdir(dirname(file), { recursive: true }); await writeFile(file, '# Synthetic support material');
  }
  const agent = { command: process.execPath, args: [join(dirname(fileURLToPath(import.meta.url)), '../../../harness/test/fixtures/acp-agent.mjs'), '--conversation', '--session-controls'] };
  studio = await startHarnessStudioServer({ port: 0, appDir: join(dirname(fileURLToPath(import.meta.url)), '../../dist/app'), memoryHome: home, memoryAcpAgents: [{ id: 'fixture', label: 'Fixture ACP', agent }] });
});
test.afterAll(async () => { await studio?.close(); await rm(home, { recursive: true, force: true }); });
async function explorer(page) { await expect(page.locator('.memory-workbench')).toBeVisible(); if (!await page.getByRole('searchbox').isVisible()) await page.getByRole('button', { name: 'Memory navigation', exact: true }).click(); }
async function findOpen(page, name) { await explorer(page); await page.getByRole('searchbox').fill(name); await page.getByRole('treeitem', { name, exact: true }).click(); }
for (const layout of [{ name: 'wide', width: 1440, height: 900 }, { name: 'compact', width: 1024, height: 768 }, { name: 'narrow', width: 390, height: 844 }]) {
  test(`Memory explorer, document tabs and ACP at ${layout.name}`, async ({ page }, info) => {
    const errors = [], reads = [], frames = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('request', request => { if (request.url().endsWith('/api/memory/read')) reads.push(request); });
    await page.setViewportSize(layout);
    await page.goto(`${studio.url}/#/memory`);
    const profile = page.getByRole('treeitem', { name: 'User Profile', exact: true });
    await expect(profile).toBeVisible(); expect(reads).toHaveLength(1);
    await profile.focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'User Profile', exact: true })).toBeVisible();
    await findOpen(page, 'General Tips');
    await expect(page.getByRole('tab')).toHaveCount(2);
    await page.getByRole('tab', { name: 'User Profile', exact: true }).click();
    await expect(page.locator('.memory-reader-body')).toContainText('Prefers concise labels.');
    await page.getByRole('tab', { name: 'General Tips', exact: true }).click();
    await findOpen(page, 'General Tips');
    await expect(page.getByRole('tab')).toHaveCount(2); expect(reads).toHaveLength(1);
    await page.screenshot({ path: info.outputPath(`memory-editor-${layout.name}.png`) });
    await page.getByRole('button', { name: 'AI analysis', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Close analysis', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Connect Agent', exact: true }).click();
    const panel = page.locator('.memory-analysis');
    const model = panel.getByRole('combobox', { name: 'Model', exact: true });
    await expect(model).toHaveValue('fixture-default');
    await model.selectOption('fixture-candidate');
    await expect(model).toHaveValue('fixture-candidate');
    await panel.getByRole('button', { name: 'Send prompt', exact: true }).click();
    await expect(panel.locator('.streaming-message').last()).toContainText('turn:1 session:fixture-session blocks:1 model:fixture-candidate');
    const draft = panel.locator('.acp-composer textarea');
    await draft.fill('wait'); await draft.press('Enter');
    await expect(panel.locator('.streaming-message').last()).toContainText('turn:2');
    await expect(panel.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    // The fixture withholds completion until Stop, proving a visible first chunk.
    await panel.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(panel.locator('.acp-turn-status')).toHaveText('Ready');
    await draft.fill('third'); await draft.press('Enter');
    await expect(panel.locator('.streaming-message').last()).toContainText('turn:3 session:fixture-session');
    if (layout.width > 700) {
      await page.getByRole('tab', { name: 'User Profile', exact: true }).click();
      await expect(panel.locator('.memory-analysis-source')).toContainText('General Tips');
      await expect(panel.locator('.streaming-message').last()).toContainText('turn:3');
    }
    await draft.focus(); expect(await draft.evaluate(node => getComputedStyle(node).outlineStyle)).not.toBe('none');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`memory-acp-${layout.name}.png`) });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.screenshot({ path: info.outputPath(`memory-acp-dark-${layout.name}.png`) });
    await panel.getByRole('button', { name: 'Close session', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Connect Agent', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Close analysis' }).focus(); await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'AI analysis', exact: true })).toBeFocused();
    await page.getByRole('tab', { name: 'General Tips', exact: true }).click();
    await page.getByRole('button', { name: 'Close General Tips', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'User Profile', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'User Profile', exact: true })).toBeFocused();
    await page.reload(); await expect(page.locator('.memory-reader-body')).toContainText('Prefers concise labels.');
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('Prefers concise labels.');
    expect(errors).toEqual([]);
  });
}
test('virtual tree search and keyboard navigation retain open editors', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(`${studio.url}/#/memory?view=sources`);
  await page.getByRole('searchbox').fill('episode-');
  await expect(page.getByRole('treeitem', { name: 'episode-000.md', exact: true })).toBeVisible();
  expect(await page.getByRole('treeitem').count()).toBeLessThan(50);
  await page.locator('.memory-tree-scroll').evaluate(node => { node.scrollTop = node.scrollHeight; });
  await expect(page.getByRole('treeitem', { name: 'episode-255.md', exact: true })).toBeVisible();
  await findOpen(page, 'episode-200.md');
  await expect(page.getByRole('heading', { name: 'Synthetic history' })).toBeVisible();
  await page.getByRole('searchbox').fill('');
  const personal = page.getByRole('treeitem', { name: 'Personal', exact: true });
  await personal.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('treeitem', { name: 'User Profile', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab')).toHaveCount(2);
  await page.getByRole('tab', { name: 'User Profile', exact: true }).focus(); await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'rollout_summaries/episode-200.md', exact: true })).toHaveAttribute('aria-selected', 'true');
});
test('analysis rejects stale, unapproved and cross-origin selections before connecting', async () => {
  const inventory = await (await fetch(`${studio.url}/api/memory`)).json(); const doc = inventory.documents.find(doc => doc.metadata.title === 'memory_summary.md');
  const post = (selection, origin) => fetch(`${studio.url}/api/memory/acp/stream`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ version: 1, prompt: JSON.stringify(selection), threadId: 'memory_thread', runId: 'memory_run' }) });
  expect((await post({ id: doc.id, scope: doc.scope, digest: 'a'.repeat(64) })).status).toBe(400);
  expect((await post({ id: doc.id, scope: doc.scope, digest: 'a'.repeat(64), authorized: true })).status).toBe(409);
  expect((await post({}, 'https://example.com')).status).toBe(403);
});
test('failed index hydration retries its bounded canonical summary', async ({ page }) => {
  const reads = []; await page.route('**/api/memory/read', route => { reads.push(route.request().postDataJSON()); return reads.length === 1 ? route.fulfill({ status: 400, json: {} }) : route.continue(); });
  await page.goto(`${studio.url}/#/memory?view=cross-project`);
  await expect(page.getByRole('alert')).toBeVisible(); await page.getByRole('button', { name: 'Retry reading', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: 'General Tips', exact: true })).toBeVisible(); expect(reads).toHaveLength(2); expect(reads[0].id).toBe(reads[1].id);
});
test('switching editors restores a long entry reading position', async ({ page }) => {
  const file = join(home, '.codex', 'memories', 'memory_summary.md');
  await writeFile(file, content + '\n\n# User Preferences\n\n' + Array.from({ length: 100 }, (_, n) => `Preference ${n}: Keep source available.`).join('\n\n'));
  try {
    await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(`${studio.url}/#/memory?view=personal`);
    await findOpen(page, 'User Preferences'); const body = page.locator('.memory-reader-body');
    await expect(page.getByRole('heading', { name: 'User Preferences', exact: true })).toBeVisible();
    await body.evaluate(node => { node.scrollTop = 500; node.dispatchEvent(new Event('scroll')); });
    await findOpen(page, 'General Tips'); await page.getByRole('tab', { name: 'User Preferences', exact: true }).click();
    await expect.poll(() => body.evaluate(node => node.scrollTop)).toBe(500);
  } finally { await writeFile(file, content); }
});
test('changing the active Studio project preserves global Memory selection and inventory', async ({ page }) => {
  const paths = [join(home, 'project-a'), join(home, 'project-b')];
  await Promise.all(paths.map(path => mkdir(path, { recursive: true })));
  const selections = [...paths];
  const server = await startHarnessStudioServer({ port: 0, appDir: join(dirname(fileURLToPath(import.meta.url)), '../../dist/app'), memoryHome: home, workspaceDirectoryPicker: async () => selections.shift(), workspaceSessionProvider: { discover: async selected => ({ label: basename(selected), sessions: [] }) } });
  try {
    await fetch(`${server.url}/api/projects/open`, { method: 'POST' });
    await fetch(`${server.url}/api/projects/open`, { method: 'POST' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${server.url}/#/memory?view=sources`);
    await page.getByRole('searchbox').fill('memory_summary.md');
    await page.getByRole('treeitem', { name: 'memory_summary.md', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'User Profile' })).toBeVisible();
    const selectedUrl = page.url();
    const inventory = await (await fetch(`${server.url}/api/memory`)).json();
    await page.locator('.studio-project-switcher > button').click();
    await page.getByRole('menuitemradio', { name: /^project-a/ }).click();
    await expect(page.locator('.studio-project-switcher > button strong')).toHaveText('project-a');
    expect(page.url()).toBe(selectedUrl);
    await expect(page.getByRole('heading', { name: 'User Profile' })).toBeVisible();
    const updated = await (await fetch(`${server.url}/api/memory`)).json();
    expect(updated.documents.map(doc => doc.id)).toEqual(inventory.documents.map(doc => doc.id));
  } finally { await server.close(); }
});

test('disconnecting a prepared ACP session removes its temporary directory and control', async () => {
  const inventory = await (await fetch(`${studio.url}/api/memory`)).json();
  const doc = inventory.documents.find(doc => doc.metadata.title === 'memory_summary.md');
  const snapshot = await (await fetch(`${studio.url}/api/memory/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: doc.id, scope: doc.scope, authorized: true }) })).json();
  const controller = new AbortController(), runId = 'memory_cleanup';
  const response = await fetch(`${studio.url}/api/memory/acp/stream`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ kind: 'HarnessRunRequestV1', runId, threadId: 'memory_cleanup_thread', prompt: JSON.stringify({ id: doc.id, scope: doc.scope, authorized: true, digest: snapshot.digest, agentId: 'fixture' }) }) });
  expect(response.status).toBe(200);
  const reader = response.body.getReader(), decoder = new TextDecoder(); let text = '', directory, prepared = false;
  try {
    while (!prepared || !directory) {
      const chunk = await reader.read(); if (chunk.done) throw new Error('Stream closed before preparation'); text += decoder.decode(chunk.value, { stream: true });
      let boundary;
      while ((boundary = text.indexOf('\n\n')) >= 0) {
        const frame = text.slice(0, boundary); text = text.slice(boundary + 2);
        for (const line of frame.split('\n')) if (line.startsWith('data:')) {
          const event = JSON.parse(line.slice(5)).event;
          if (event.type === 'protocol-event' && event.direction === 'Client → Agent' && event.method === 'session/new') directory = event.payload?.params?.cwd;
          if (event.type === 'acp-session-ready' && event.prepared) prepared = true;
        }
      }
    }
    await access(directory);
  } finally { controller.abort(); await reader.cancel().catch(() => undefined); }
  await expect.poll(async () => access(directory).then(() => true, () => false)).toBe(false);
  expect((await fetch(`${studio.url}/api/acp/runs/${runId}/cancel`, { method: 'POST' })).status).toBe(404);
});
