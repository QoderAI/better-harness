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

test("analyzes Host customizations only after the explicit action across layouts", async ({ page }, testInfo) => {
  const failures = [];
  page.on("console", (message) => { if (message.type() === "error") failures.push(message.text()); });
  page.on("pageerror", (error) => failures.push(error.message));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${studio.url}/#/customizations`);
  await expect(page.getByRole("heading", { name: "Analysis starts only when requested" })).toBeVisible();
  expect(calls).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("customizations-idle-wide.png"), fullPage: true });

  await page.getByRole("button", { name: "Analyze customizations" }).click();
  await expect(page.getByRole("table")).toContainText("review");
  await expect(page.getByRole("table")).toContainText("Codex, Qoder");
  await expect(page.getByRole("table")).toContainText("MCP Server");
  await expect(page.getByRole("row").filter({ hasText: "schedule" })).toContainText("Qoder");
  const hostFailure = page.getByRole("alert");
  await expect(hostFailure).toContainText("Claude customization collection failed");
  await expect(hostFailure).toContainText("collector runtime failed unexpectedly");
  await expect(hostFailure).toContainText("use Analyze again to retry");
  expect(calls).toBe(3);
  expect(await page.locator("body").innerText()).not.toContain(workspace);
  expect(await page.locator("body").innerText()).not.toContain("private-token");

  const definitionsTab = page.getByRole("tab", { name: "Definitions" });
  const installationsTab = page.getByRole("tab", { name: "Installations" });
  await installationsTab.click();
  await expect(installationsTab).toHaveAttribute("aria-selected", "true");
  await expect(definitionsTab).toHaveAttribute("aria-selected", "false");
  await expect(page.locator(".customization-detail-tabs")).toHaveAttribute("data-active", "installations");
  const tabColors = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll(".customization-detail-tabs button")];
    const root = getComputedStyle(document.documentElement);
    return {
      primary: root.getPropertyValue("--color-primary").trim(),
      definitions: getComputedStyle(tabs[0]).borderBottomColor,
      installations: getComputedStyle(tabs[1]).borderBottomColor,
    };
  });
  expect(tabColors.installations).not.toBe("rgba(0, 0, 0, 0)");
  expect(tabColors.definitions).toBe("rgba(0, 0, 0, 0)");
  expect(tabColors.primary).not.toBe("");
  const installationRow = page.getByRole("row").filter({ hasText: "Review Plugin" });
  await expect(installationRow).toContainText("Codex");
  await expect(installationRow).toContainText("project");
  await expect(installationRow).toContainText("local");
  await expect(installationRow).toContainText("enabled");
  await expect(installationRow).toContainText("applicable");
  await expect(installationRow).toContainText("Workspace/.codex/plugins/review-plugin/.codex-plugin/plugin.json");
  await definitionsTab.click();

  await page.locator(".studio-language-toggle").click();
  await expect(page.getByText("本地自定义目录", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "再次分析" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "定义" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "安装" })).toBeVisible();
  await expect(hostFailure).toContainText("Claude customization collection failed");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await page.locator(".studio-language-toggle").click();
  await expect(page.getByRole("button", { name: "Analyze again" })).toBeVisible();

  for (const layout of layouts) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await expect(page.getByRole("button", { name: "Analyze again" })).toBeVisible();
    if (layout.width <= 1080) {
      await expect(page.locator(".studio-primary-nav")).toHaveCSS("visibility", "hidden");
      await expect(page.locator(".studio-primary-nav")).not.toBeInViewport();
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow, `${layout.name} layout has document overflow`).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`customizations-result-${layout.name}.png`), fullPage: true });
    await installationsTab.click();
    await expect(installationsTab).toHaveAttribute("aria-selected", "true");
    const installationOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(installationOverflow, `${layout.name} installation layout has document overflow`).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`customizations-installations-${layout.name}.png`), fullPage: true });
    await definitionsTab.click();
  }
  expect(failures).toEqual([]);
});
