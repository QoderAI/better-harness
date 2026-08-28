import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

import { startHarnessStudioServer } from "../../dist/server/server.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let studio;
let workspace;

function debuggerSession(id, prompt, provider, resources) {
  return {
    id,
    name: prompt,
    agent: provider,
    protocol: "Artifact browser fixture",
    connection: "observed",
    mode: "Retained run",
    startedAt: "11:59:00",
    finishedAt: "12:00:00",
    events: [{
      id: `${id}-change`,
      kind: "change",
      phase: "Change",
      title: "Deliver outputs",
      summary: "Workspace output evidence",
      timestamp: "12:00:00",
      relativeTime: "retained",
      stopConditions: [],
      toolCalls: resources.map((resource, index) => ({
        id: `${id}-write-${index}`,
        name: "Write",
        summary: "Observed output",
        input: "retained",
        output: "retained",
        duration: "1 ms",
        resource,
      })),
      evidence: [],
      rawAcp: {
        direction: "Agent → Client",
        method: "session/tool-call",
        rpcId: `${id}-change`,
        sessionId: id,
        traceContext: "fixture",
        payload: {},
      },
    }],
  };
}

test.beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "studio-workspace-artifact-browser-"));
  await mkdir(join(workspace, "outputs"));
  await mkdir(join(workspace, "docs"));
  await mkdir(join(workspace, "src"));
  await writeFile(join(workspace, "outputs", "diagram.svg"), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 120"><rect width="320" height="120" fill="#172033"/><text x="24" y="68" fill="#e8edf7" font-size="22">Artifact Canvas</text></svg>', "utf8");
  await writeFile(join(workspace, "outputs", "report.md"), "# Current report\n\nThe Artifact workspace is unified.\n", "utf8");
  await writeFile(join(workspace, "docs", "contract.md"), "# Artifact contract\n", "utf8");
  await writeFile(join(workspace, "src", "ordinary.tsx"), "export const ordinary = <span>Source only</span>;\n", "utf8");
  await writeFile(join(workspace, "unobserved.txt"), "must not enter the catalog\n", "utf8");
  const sessions = [
    {
      summary: { id: "codex:new", savedAt: "2026-08-24T04:30:00.000Z", prompt: "Unify the Artifact workspace", status: "observed", toolCallCount: 3, provider: "Codex" },
      debugger: debuggerSession("codex:new", "Unify the Artifact workspace", "Codex", ["outputs/diagram.svg", "outputs/report.md", "src/ordinary.tsx"]),
    },
    {
      summary: { id: "qoder:older", savedAt: "2026-08-23T08:20:00.000Z", prompt: "Define the Artifact contract", status: "observed", toolCallCount: 1, provider: "Qoder" },
      debugger: debuggerSession("qoder:older", "Define the Artifact contract", "Qoder", ["docs/contract.md"]),
    },
  ];
  studio = await startHarnessStudioServer({
    appDir: join(packageRoot, "dist", "app"),
    port: 0,
    workspaceDirectoryPicker: async () => workspace,
    workspaceSessionProvider: {
      discover: async () => ({
        label: "artifact-fixture",
        sessions,
        providers: [
          { provider: "Codex", status: "ok", discovered: 1, included: 1 },
          { provider: "Qoder", status: "ok", discovered: 1, included: 1 },
        ],
      }),
    },
  });
  const opened = await fetch(`${studio.url}/api/workspace/open`, { method: "POST" });
  if (!opened.ok) throw new Error(`Artifact fixture workspace failed to open (${opened.status}).`);
});

test.afterAll(async () => {
  await studio?.close();
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

test("keeps Date, Files, Artifact selection, and Canvas reachable at all target widths", async ({ page }, testInfo) => {
  const failures = [];
  page.on("console", (message) => { if (message.type() === "error") failures.push(message.text()); });
  page.on("pageerror", (error) => failures.push(error.message));

  for (const viewport of [
    { name: "wide", width: 1440, height: 900 },
    { name: "compact", width: 1024, height: 768 },
    { name: "narrow", width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`${studio.url}/#/artifacts`);
    const workspaceRegion = page.getByRole("region", { name: "Project artifacts" });
    if (viewport.width <= 760) await workspaceRegion.getByRole("tab", { name: "Browse" }).click();
    await expect(page.locator(".studio-context-title")).toContainText("artifact-fixture");
    await expect(workspaceRegion.locator(".artifact-scope-pane > header")).toContainText("Project scopeBrowse");
    await expect(workspaceRegion.getByRole("gridcell", { name: /August 24, 2026, 3 artifacts/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".artifact-editor-header small")).toContainText("current ");

    if (viewport.width > 760) {
      await expect(page.locator(".artifact-scope-pane")).toBeVisible();
      await expect(page.locator(".artifact-list-pane")).toBeVisible();
      await expect(page.locator(".artifact-preview-pane")).toBeVisible();
      await page.locator(".artifact-list-pane").getByRole("button", { name: /report\.md/ }).click();
      await expect(page.locator(".artifact-editor-header")).toContainText("report.md");
      await expect(page.getByRole("heading", { name: "Current report" })).toBeVisible();
    } else {
      await expect(workspaceRegion.getByRole("tab", { name: "Browse" })).toHaveAttribute("aria-selected", "true");
      await workspaceRegion.getByRole("tab", { name: "Artifacts", exact: true }).click();
      await page.locator(".artifact-list-pane").getByRole("button", { name: /report\.md/ }).click();
      await expect(workspaceRegion.getByRole("tab", { name: "Preview" })).toHaveAttribute("aria-selected", "true");
      await expect(page.locator(".artifact-editor-header")).toContainText("report.md");
    }

    const overflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
    const focusTarget = workspaceRegion.getByRole("tab", { name: viewport.width > 760 ? "Files" : "Preview" });
    await page.keyboard.press("Tab");
    await focusTarget.focus();
    await expect(focusTarget).toBeFocused();
    const focusedOutline = await focusTarget.evaluate((element) => {
      const style = getComputedStyle(element);
      return { style: style.outlineStyle, width: style.outlineWidth };
    });
    expect(focusedOutline.style).not.toBe("none");
    expect(focusedOutline.width).not.toBe("0px");
    await page.screenshot({ path: testInfo.outputPath(`artifact-workspace-${viewport.name}.png`), fullPage: true });
  }

  expect(failures).toEqual([]);
});

test("switches between Date and file-tree scopes without changing catalog authority", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${studio.url}/#/artifacts`);
  const workspaceRegion = page.getByRole("region", { name: "Project artifacts" });
  await workspaceRegion.getByRole("gridcell", { name: /August 23, 2026, 1 artifact/ }).click();
  await expect(page.locator(".artifact-list-pane").getByRole("button", { name: /contract\.md/ })).toBeVisible();
  await expect(page.locator(".artifact-list-pane").getByRole("button", { name: /report\.md/ })).toHaveCount(0);

  await workspaceRegion.getByRole("tab", { name: "Files" }).click();
  await expect(workspaceRegion.getByRole("tree")).toBeVisible();
  await page.locator('.artifact-tree-folder:has-text("outputs") > button:last-child').click();
  await expect(page.locator(".artifact-list-pane").getByRole("button", { name: /diagram\.svg/ })).toBeVisible();
  await expect(page.locator(".artifact-list-pane").getByRole("button", { name: /report\.md/ })).toBeVisible();
  await expect(page.locator(".artifact-list-pane").getByRole("button", { name: /contract\.md/ })).toHaveCount(0);
});

test("keeps ordinary TSX source-only while Canvas TSX remains the executable format", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${studio.url}/#/artifacts`);
  const catalog = await (await page.request.get(`${studio.url}/api/artifacts`)).json();
  expect(catalog.artifacts.find((artifact) => artifact.label === "src/ordinary.tsx")).toMatchObject({
    format: "tsx",
    backing: "data",
    renderer: { id: "studio.code", type: "native", status: "ready" },
  });
  expect(catalog.artifacts.find((artifact) => artifact.label === "src/ordinary.tsx")).not.toHaveProperty("build");

  await page.locator(".artifact-list-pane").getByRole("button", { name: /ordinary\.tsx/ }).click();
  const source = page.locator('[aria-label="Artifact source: src/ordinary.tsx"]');
  await expect(source).toContainText("Source only");
  await expect(source.locator('[data-highlight-state="highlighted"]')).toBeVisible();
  await expect.poll(async () => new Set(await source.locator("span[style]").evaluateAll((tokens) => tokens.map((token) => getComputedStyle(token).color))).size).toBeGreaterThan(1);
  expect(Number.parseFloat(await source.evaluate((element) => getComputedStyle(element).paddingLeft))).toBeGreaterThanOrEqual(12);
  await expect(page.locator(".artifact-runtime-tabs")).toHaveCount(0);
});
