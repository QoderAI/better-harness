import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { startHarnessStudioServer } from "../../dist/server/server.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const projectId = `project_${"a".repeat(32)}`;
const layouts = [
  { name: "wide", width: 1440, height: 900 },
  { name: "compact", width: 1024, height: 768 },
  { name: "narrow", width: 390, height: 844 },
];

for (const theme of ["light", "dark"]) for (const layout of layouts) {
  test(`restores without scanning and scans from the sidebar at ${layout.name} ${theme}`, async ({ page }, testInfo) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "studio-scan-browser-")));
    const workspace = join(root, "project");
    const projectStateRoot = join(root, "state");
    await mkdir(workspace); await mkdir(projectStateRoot);
    await writeFile(join(projectStateRoot, "projects.json"), JSON.stringify({
      version: 1, activeProjectId: projectId,
      projects: [{ id: projectId, label: "Scan fixture", kind: "local", localDirectory: workspace,
        lastOpenedAt: "2026-09-09T00:00:00.000Z", sessionCount: 42, inputCount: 0, artifactCount: 0,
        gitEnabled: false, workspaceWorkbenchEnabled: false }],
    }));
    let scans = 0;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const studio = await startHarnessStudioServer({
      appDir: join(packageRoot, "dist", "app"), projectStateRoot, port: 0,
      workspaceSessionProvider: { discover: async () => { scans += 1; await gate; return { label: "Scan fixture", sessions: [] }; } },
    });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    try {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.setViewportSize(layout);
      await page.goto(`${studio.url}/#/projects/${projectId}/sessions`);
      await expect(page.getByRole("heading", { name: "Project ready to scan" })).toBeVisible();
      expect(scans).toBe(0);
      // Other Project views share the same unscanned state, without starting
      // their own provider discovery as a side effect of navigation.
      await page.goto(`${studio.url}/#/projects/${projectId}/session-performance`);
      await expect(page.getByRole("heading", { name: "Project ready to scan" })).toBeVisible();
      expect(scans).toBe(0);
      if (layout.name !== "wide") await page.locator(".studio-nav-toggle").click();
      const scan = page.getByRole("button", { name: "Scan project", exact: true });
      await expect(scan).toBeVisible();
      await expect(page.getByText("Project restored. Scan to load evidence.", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Every retained day", { exact: true })).toHaveCount(0);
      const viewNames = await page.locator(".studio-project-views button strong").allTextContents();
      expect(viewNames.indexOf("Memory")).toBe(viewNames.indexOf("Customizations") + 1);
      await scan.hover();
      await page.keyboard.press("Tab");
      await scan.focus();
      await expect(scan).toBeFocused();
      expect(await scan.evaluate(node => getComputedStyle(node).outlineStyle)).not.toBe("none");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`scan-ready-${layout.name}-${theme}.png`) });
      await page.keyboard.press("Enter");
      await expect(page.getByRole("button", { name: "Scanning project…", exact: true })).toBeDisabled();
      await expect.poll(() => scans).toBe(1);
      await page.screenshot({ path: testInfo.outputPath(`scan-busy-${layout.name}-${theme}.png`) });
      // Switch to a view backed by this scan while it is in flight.
      await page.evaluate(() => { location.hash = location.hash.replace("session-performance", "sessions"); });
      release();
      await expect(page.getByRole("button", { name: "Rescan project", exact: true })).toBeEnabled();
      await expect(page.getByRole("heading", { name: "Project ready to scan" })).toHaveCount(0);
      expect(scans).toBe(1);
      const config = await (await fetch(`${studio.url}/api/config`)).json();
      expect(config.workspaceScanRequired).toBe(false);
      await page.screenshot({ path: testInfo.outputPath(`scan-complete-${layout.name}-${theme}.png`) });
      expect(errors).toEqual([]);
    } finally {
      release();
      await studio.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}
