import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { startHarnessStudioServer } from "../../dist/server/server.js";
import { createAgentCustomizationCollector } from "../../dist/server/customization-collector.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const layouts = [
  { name: "wide", width: 1440, height: 900 },
  { name: "compact", width: 1024, height: 768 },
  { name: "narrow", width: 390, height: 844 },
];
let studio;
let workspace;
let calls = 0;

/** At or below the 1080px breakpoint the primary sidebar is an overlay. */
async function openView(page, name) {
  const overlay = (page.viewportSize()?.width ?? 1280) <= 1080;
  if (overlay) await page.locator(".studio-nav-toggle").click();
  await page.locator(".studio-project-views").getByRole("button", { name }).click();
  if (overlay && (await page.locator(".studio-primary-nav").isVisible())) await page.locator(".studio-project-close").click();
}

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
    workspaceSessionProvider: {
      discover: async () => ({
        label: "customization-fixture",
        sessions: [],
        // What retained Sessions were observed invoking, per Host. Codex names the
        // Skill through its plugin, which is the case the matching rule exists for.
        customizationUsage: {
          kind: "BetterHarnessCustomizationUsageV1",
          schemaVersion: 1,
          observedSessions: 4,
          window: { from: "2026-09-01T00:00:00.000Z", to: "2026-09-08T00:00:00.000Z" },
          entries: [
            { kind: "skill", hostId: "codex", name: "review", count: 2, lastObservedAt: "2026-09-07T00:00:00.000Z" },
            { kind: "skill", hostId: "qoder", name: "review", count: 5, lastObservedAt: "2026-09-08T00:00:00.000Z" },
            { kind: "mcp-server", hostId: "qoder", name: "schedule", count: 3, lastObservedAt: "2026-09-06T00:00:00.000Z" },
          ],
        },
      }),
    },
    customizationCollector: collector,
  });
  const opened = await fetch(`${studio.url}/api/workspace/open`, { method: "POST" });
  if (!opened.ok) throw new Error(`Could not open customization fixture: ${await opened.text()}`);
});

test.afterAll(async () => {
  await studio?.close();
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

test("browses the catalog as a docked View with sidebar kinds and Agent rows", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize(layouts[0]);
  let releaseInitialLoad;
  const initialHeld = new Promise((resolve) => { releaseInitialLoad = resolve; });
  await page.route("**/api/customizations/analyze", async (route) => { await initialHeld; await route.continue(); });
  await page.goto(`${studio.url}/#/customizations`);

  const workbench = page.locator(".customization-workbench");
  const views = page.locator(".studio-project-views");
  // The row's accessible name carries its trailing count ("Plugins 1"), so a
  // prefix match finds the row both before and after the count arrives.
  const kind = (name) => views.getByRole("button", { name: new RegExp(`^${name}( \\d+)?$`) });
  const filters = page.getByRole("navigation", { name: "Customization filters" });
  const entries = page.locator(".customization-entries");
  const provenance = page.locator(".customization-detail");
  const table = entries.getByRole("table");

  // The View replaces the pop-up: it owns the workspace and no dialog takes part.
  await expect(page.locator(".studio-context-title h1")).toHaveText("Customizations");
  // The catalog's kinds are rows of the primary sidebar, under one disclosure, so
  // a bare route lands on a real kind rather than an aggregate list.
  await expect(kind("Customizations")).toHaveAttribute("aria-expanded", "true");
  await expect(kind("Plugins")).toHaveAttribute("aria-current", "page");
  // The Tools kind is retired: it is neither a catalog row nor a route.
  await expect(kind("Tools")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(entries).toHaveAttribute("aria-busy", "true");
  releaseInitialLoad();
  await expect(entries.getByRole("heading", { name: "Plugins" })).toBeVisible();
  await expect(table).toContainText("Review Plugin");
  // The same retained catalog the table renders also fills the sidebar counts,
  // one per kind, so the Customizations group reads as a catalog index.
  await expect(kind("Plugins").locator("small")).toHaveText("1");
  await expect(kind("Skills").locator("small")).toHaveText("1");
  await expect(kind("Instructions").locator("small")).toHaveCount(0);
  expect(calls).toBe(3);
  await page.unroute("**/api/customizations/analyze");

  // Every Agent the collector reached is a row, and the one that failed reports
  // its status rather than an apparently clean zero.
  await expect(filters.getByRole("button", { name: "All Agents 1" })).toHaveAttribute("aria-current", "true");
  await expect(filters.getByRole("button", { name: /^Claude/ })).toContainText("Error");
  await expect(entries.getByRole("alert")).toContainText("Claude customization collection failed");

  // One kind per View, named by the entries heading. No aggregate list remains,
  // so no row has to state which kind it is.
  await kind("Skills").click();
  // The kind is part of the route, alongside the Project scope.
  await expect(page).toHaveURL(/\/customizations\/skills$/);
  await expect(entries.getByRole("heading", { name: "Skills" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: /Category/ })).toHaveCount(0);
  await expect(table.getByRole("row").filter({ hasText: "review" })).toContainText("Codex, Qoder");
  expect(await workbench.innerText()).not.toContain(workspace);
  expect(await workbench.innerText()).not.toContain("private-token");

  // Kind and Agent compose, and each keeps the other's choice.
  await filters.getByRole("button", { name: /^Claude/ }).click();
  await expect(entries).toContainText("No entries in this category");
  await filters.getByRole("button", { name: /^Qoder/ }).click();
  await expect(table).toContainText("review");
  await kind("Plugins").click();
  await expect(entries).toContainText("No entries in this category");
  await filters.getByRole("button", { name: /^Codex/ }).click();
  await expect(table).toContainText("Review Plugin");

  // Selecting a row updates the provenance pane; it does not open anything.
  await filters.getByRole("button", { name: "All Agents" }).click();
  await kind("MCP Servers").click();
  await expect(provenance).toContainText("Select an entry");
  await table.getByRole("button", { name: "schedule" }).click();
  await expect(provenance.getByRole("heading", { name: "schedule" })).toBeVisible();
  await expect(provenance).toContainText("Qoder");
  await expect(provenance).toContainText("Project");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The Agent list is one Tab stop: arrows move focus without applying a filter.
  const allAgents = filters.getByRole("button", { name: "All Agents" });
  await allAgents.focus();
  await page.keyboard.press("ArrowDown");
  await expect(filters.getByRole("button", { name: /^Claude/ })).toBeFocused();
  await expect(allAgents).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("Enter");
  await expect(filters.getByRole("button", { name: /^Claude/ })).toHaveAttribute("aria-current", "true");
  await filters.getByRole("button", { name: "All Agents" }).click();

  // The text filter narrows the scoped rows and says so when nothing matches.
  await kind("Skills").click();
  const search = entries.getByRole("searchbox", { name: "Filter entries" });
  await search.fill("review");
  await expect(table).toContainText("review");
  await search.fill("no-such-entry");
  await expect(entries).toContainText("No entries match this filter");
  await search.fill("");

  // Observed invocations: a count per exposing Agent, following the Agent filter,
  // and an honest boundary instead of a zero for what was never observed.
  const usesHeader = table.getByRole("columnheader", { name: /Uses/ });
  await expect(usesHeader).toBeVisible();
  const reviewRow = table.getByRole("row").filter({ hasText: "review" });
  await expect(reviewRow).toContainText("7");
  await expect(entries).toContainText("4 retained Sessions of this Project");
  await filters.getByRole("button", { name: /^Codex/ }).click();
  await expect(reviewRow).toContainText("2");
  await filters.getByRole("button", { name: /^Qoder/ }).click();
  await expect(reviewRow).toContainText("5");
  await table.getByRole("button", { name: "review" }).click();
  await expect(provenance).toContainText("5 observed invocations, last on 2026-09-08");
  // Sorting by the column brings the most-used definition to the top.
  await usesHeader.getByRole("button").click();
  await expect(usesHeader).toHaveAttribute("aria-sort", "ascending");

  // A category no rule can observe does not grow a column of dashes.
  await filters.getByRole("button", { name: "All Agents" }).click();
  await kind("Hooks").click();
  await expect(table.getByRole("columnheader", { name: /Uses/ })).toHaveCount(0);
  await kind("MCP Servers").click();
  await expect(table.getByRole("row").filter({ hasText: "schedule" })).toContainText("3");
  await kind("Skills").click();

  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    for (const layout of layouts) {
      await page.setViewportSize(layout);
      await expect(entries.getByRole("heading", { name: "Skills" })).toBeVisible();
      const entriesBox = await entries.boundingBox();
      const workbenchBox = await workbench.boundingBox();
      // The catalog stays the primary region: side panes give way before it does.
      if (layout.width > 1080) expect(entriesBox.width).toBeGreaterThanOrEqual(workbenchBox.width / 2);
      expect(entriesBox.y + entriesBox.height).toBeLessThanOrEqual(layout.height + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`customizations-${theme}-${layout.name}.png`), animations: "disabled" });
    }
  }

  await page.setViewportSize(layouts[0]);
  await page.emulateMedia({ colorScheme: "dark" });
  // The kind is part of the route, so a reload returns to it rather than to the
  // first row of the sidebar group.
  await page.goto(`${studio.url}/#/customizations/skills`);
  await expect(page.locator(".studio-context-title h1")).toHaveText("Customizations");
  await expect(kind("Skills")).toHaveAttribute("aria-current", "page");
  await expect(entries.getByRole("table")).toContainText("review");
  expect(calls).toBe(3); // The retained catalog is read back without collecting again.

  // The View is reachable from the sidebar's View list, like every other View.
  await openView(page, "Overview");
  await expect(page.locator(".studio-context-title h1")).toHaveText("Sessions");
  await openView(page, "Instructions");
  await expect(page.locator(".customization-workbench")).toBeVisible();
  await expect(entries.getByRole("heading", { name: "Instructions" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("catalog loading failure can be retried from the toolbar", async ({ page }) => {
  await page.request.post(`${studio.url}/api/customizations/analyze`);
  await page.setViewportSize(layouts[0]);
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/customizations", async (route) => {
    await held;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Catalog unavailable for test" }) });
  });
  await page.goto(`${studio.url}/#/customizations/skills`);
  const entries = page.locator(".customization-entries");
  await expect(entries).toHaveAttribute("aria-busy", "true");
  release();
  await expect(entries.getByRole("alert")).toContainText("Catalog unavailable for test");
  await expect(entries).toHaveAttribute("aria-busy", "false");
  await page.unroute("**/api/customizations");
  await page.locator(".studio-context-actions").getByRole("button", { name: "Retry" }).click();
  await expect(entries.getByRole("table")).toContainText("review");
  await expect(page.locator(".studio-context-actions").getByRole("button", { name: "Refresh" })).toBeEnabled();
});
