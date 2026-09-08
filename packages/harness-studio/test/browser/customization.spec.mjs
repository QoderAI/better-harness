import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { startHarnessStudioServer } from "../../dist/server/server.js";
import { createAgentCustomizationCollector } from "../../dist/server/customization-collector.js";

/**
 * Appearance and language live in a pop-up at the bottom of the sidebar. At or
 * below the 1080px breakpoint that sidebar is an overlay, so Settings is only
 * reachable while it is open and it must be put back afterwards: left open it
 * intercepts clicks meant for the workbench.
 */
async function useStudioSetting(page, action) {
  const overlay = (page.viewportSize()?.width ?? 1280) <= 1080;
  if (overlay) await page.locator(".studio-nav-toggle").click();
  const toggle = page.locator(".studio-settings-toggle");
  await toggle.waitFor({ state: "visible" });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await action();
  if ((await toggle.getAttribute("aria-expanded")) === "true") await toggle.click();
  if (overlay) await page.locator(".studio-project-close").click();
}


const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const layouts = [
  { name: "wide", width: 1440, height: 900 },
  { name: "compact", width: 1024, height: 768 },
  { name: "narrow", width: 390, height: 844 },
];
let studio;
let workspace;
let calls = 0;

test.beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "studio-customization-browser-"));
  const skillPath = join(workspace, ".agents", "skills", "review", "SKILL.md");
  const mcpPath = join(workspace, ".qoder", "mcp.json");
  const pluginRoot = join(workspace, ".codex", "plugins", "review-plugin");
  const pluginManifestPath = join(pluginRoot, ".codex-plugin", "plugin.json");
  await mkdir(dirname(skillPath), { recursive: true });
  await mkdir(dirname(mcpPath), { recursive: true });
  await mkdir(dirname(pluginManifestPath), { recursive: true });
  await writeFile(skillPath, "---\nname: review\ndescription: Review changes.\n---\n", "utf8");
  await writeFile(mcpPath, "{}\n", "utf8");
  await writeFile(pluginManifestPath, "{}\n", "utf8");
  const collector = createAgentCustomizationCollector({
    collectInventory: async ({ provider }) => {
      calls += 1;
      if (provider === "claude") throw new Error(`private ${workspace}`);
      const skill = { id: `${provider}:review`, kind: "skill", scope: "project", name: "review", description: "Review changes.", filePath: skillPath, evidence: { path: skillPath } };
      return {
        provider,
        plugins: provider === "codex" ? [{
          id: "review-plugin",
          name: "review-plugin",
          displayName: "Review Plugin",
          version: "1.0.0",
          installSource: "project",
          enabled: true,
          applicable: true,
          rootPath: pluginRoot,
          evidence: { path: pluginManifestPath },
        }] : [],
        manage: {
          skills: [skill], rules: [], commands: [], subagents: [], hooks: [],
          mcps: provider === "qoder" ? [{
            id: "qoder:schedule",
            kind: "mcp",
            scope: "project",
            name: "schedule",
            command: "npx",
            args: ["schedule-mcp", "--token", "private-token"],
            envKeys: ["API_TOKEN"],
            enabled: true,
            filePath: mcpPath,
            evidence: { path: mcpPath },
          }] : [],
        },
      };
    },
  });
  studio = await startHarnessStudioServer({
    appDir: join(packageRoot, "dist", "app"),
    port: 0,
    workspaceDirectoryPicker: async () => workspace,
    workspaceSessionProvider: { discover: async () => ({ label: "customization-fixture", sessions: [] }) },
    customizationCollector: collector,
  });
  const opened = await fetch(`${studio.url}/api/workspace/open`, { method: "POST" });
  if (!opened.ok) throw new Error(`Could not open customization fixture: ${await opened.text()}`);
});

test.afterAll(async () => {
  await studio?.close();
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

test("category popup preserves the workbench and identifies Agents across layouts", async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if(m.type()==='error') errors.push(m.text()); });
  await page.setViewportSize(layouts[0]);
  let releaseInitialLoad;
  const initialHeld = new Promise(resolve => { releaseInitialLoad = resolve; });
  await page.route('**/api/customizations/analyze', async route => { await initialHeld; await route.continue(); });
  await page.goto(`${studio.url}/#/sessions`);
  const library = page.locator('.customization-library');
  const dialog = page.getByRole('dialog', { name: 'Customizations' });
  const category = dialog.getByLabel('Category', { exact: true });
  const agent = dialog.getByLabel('Agent', { exact: true });
  const entries = dialog.locator('.customization-entry-list');
  await expect(page.locator('.studio-project-views')).not.toContainText('Customizations');
  await expect(library).toHaveAttribute('aria-busy', 'true');
  await expect(library.locator('small')).toHaveCount(0);
  await expect(dialog).toHaveCount(0);
  releaseInitialLoad();
  await expect(library.getByRole('button', { name: /^Skills/ }).locator('small')).toHaveText('1');
  expect(calls).toBe(3);
  await page.unroute('**/api/customizations/analyze');
  await library.getByRole('button', { name: /^Skills/ }).click();
  await expect(category).toHaveValue('skills');
  await expect(dialog.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  await expect(entries).toContainText('review');
  await expect(dialog.locator('.customization-entry-agents')).toHaveText('Codex, Qoder');
  await expect(dialog.getByRole('alert')).toContainText('Claude customization collection failed');
  expect(calls).toBe(3);
  expect(await dialog.innerText()).not.toContain(workspace);
  expect(await dialog.innerText()).not.toContain('private-token');
  await agent.selectOption('claude');
  await expect(entries).toHaveCount(0);
  await expect(dialog).toContainText('No entries in this category');
  await agent.selectOption('qoder');
  await expect(dialog.locator('.customization-entry-agents')).toHaveText('Codex, Qoder');
  await category.selectOption('mcp');
  await expect(entries).toContainText('schedule');
  await expect(dialog.locator('.customization-entry-agents')).toHaveText('Qoder');
  await category.selectOption('plugins');
  await expect(entries).toHaveCount(0);
  await agent.selectOption('codex');
  await expect(entries).toContainText('Review Plugin');
  await category.selectOption('tools');
  await expect(dialog).toContainText('Retained MCP tool descriptors only');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(library.getByRole('button', { name: /^Skills/ })).toBeFocused();
  await expect(page.locator('.studio-context-title')).toHaveText('Sessions');
  await expect(library.getByRole('button', { name: /^Skills/ }).locator('small')).toHaveText('1');
  for(const theme of ['light','dark']) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    for(const layout of layouts) {
      await page.setViewportSize(layout);
      if(layout.width<=1080) await page.locator('.studio-nav-toggle').click();
      await library.getByRole('button', { name: /^Overview/ }).click();
      await category.selectOption('skills');
      await expect(dialog.locator('.customization-entry-agents')).toHaveText('Codex, Qoder');
      const close = dialog.getByRole('button', { name: 'Close customizations' });
      await close.focus();
      await page.keyboard.press('Shift+Tab');
      await expect(dialog.locator('.customization-dialog-content')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(close).toBeFocused();
      expect(await close.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
      const b = await dialog.boundingBox();
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x+b.width).toBeLessThanOrEqual(layout.width);
      expect(b.y+b.height).toBeLessThanOrEqual(layout.height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`popup-${theme}-${layout.name}.png`), animations:'disabled' });
      await page.keyboard.press('Escape');
      const opener = library.getByRole('button', { name: /^Overview/ });
      await expect(opener).toBeFocused();
      await expect(opener).toHaveAttribute('aria-expanded', 'false');
      const focus = () => opener.evaluate(el => {
        const style = getComputedStyle(el);
        const probe = document.createElement('span');
        probe.style.color = 'var(--color-on-primary)';
        probe.style.backgroundColor = 'var(--color-primary)';
        el.append(probe);
        const expected = getComputedStyle(probe);
        const result = { outline: style.outlineStyle, fill: style.backgroundColor === expected.backgroundColor, text: style.color === expected.color };
        probe.remove();
        return result;
      });
      await expect.poll(focus).toEqual({ outline: 'none', fill: true, text: true });
      await page.screenshot({ path: testInfo.outputPath(`sidebar-${theme}-${layout.name}.png`), animations:'disabled' });
      await library.getByRole('button', { name: 'Customizations', exact:true }).click();
      await expect(library.getByRole('button', { name: /^Overview/ })).toHaveCount(0);
      await expect(page.locator('.studio-settings-toggle')).toBeVisible();
      await library.getByRole('button', { name: 'Customizations', exact:true }).click();
      if(layout.width<=1080) await page.locator('.studio-project-close').click();
    }
  }
  await page.setViewportSize(layouts[0]);
  await page.goto(`${studio.url}/#/customizations`);
  await expect(dialog).toBeVisible();
  await expect(category).toHaveValue('overview');
  await expect(entries).toContainText('review');
  expect(calls).toBe(3); // Reload uses the cached catalog, without collecting again.
  await page.mouse.click(1,1);
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.studio-context-title')).toHaveText('Sessions');
  expect(errors).toEqual([]);
});

test('catalog loading failure can be retried explicitly', async ({ page }) => {
  await page.request.post(`${studio.url}/api/customizations/analyze`);
  await page.setViewportSize(layouts[0]);
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route('**/api/customizations', async route => {
    await held;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Catalog unavailable for test' }) });
  });
  await page.goto(`${studio.url}/#/sessions`);
  await page.locator('.customization-library').getByRole('button', { name: 'Overview' }).click();
  const dialog = page.getByRole('dialog', { name: 'Customizations' });
  await expect(dialog.locator('.customization-dialog-content')).toHaveAttribute('aria-busy','true');
  release();
  await expect(dialog.getByRole('alert')).toContainText('Catalog unavailable for test');
  await expect(dialog.locator('.customization-dialog-content')).toHaveAttribute('aria-busy','false');
  await page.unroute('**/api/customizations');
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(dialog.locator('.customization-entry-list')).toContainText('review');
  await dialog.getByRole('button', { name: 'Close customizations' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.customization-library').getByRole('button', { name: 'Overview' })).toBeFocused();
});
