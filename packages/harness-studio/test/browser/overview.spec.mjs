import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { sessionFromRetainedRun } from "../../dist/server/debugger-session-transform.js";
import { startHarnessStudioServer } from "../../dist/server/server.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const experimentManifest = resolve(packageRoot, "../harness/examples/checkpoint-experiment/experiment.json");
const layouts = [
  { name: "wide", width: 1440, height: 900 },
  { name: "compact", width: 1024, height: 768 },
  { name: "narrow", width: 390, height: 844 },
];

let sourceStudio;
let workspaceStudio;
let workspaceDirectory;

function retainedRun(id, savedAt, prompt, tools) {
  return {
    id,
    savedAt,
    prompt,
    status: "finished",
    runId: id,
    toolCallCount: tools.length,
    warnings: [],
    timeline: [
      ...tools.map((name, index) => ({ kind: "tool-call", id: `${id}-tool-${index}`, name, argsText: "{}", status: "completed", resultText: "ok" })),
      { kind: "message", id: `${id}-message`, text: `${prompt} complete`, complete: true },
    ],
  };
}

test.beforeAll(async () => {
  sourceStudio = await startHarnessStudioServer({
    appDir: join(packageRoot, "dist", "app"),
    port: 0,
    experimentManifestPath: experimentManifest,
  });

  workspaceDirectory = await mkdtemp(join(tmpdir(), "studio-overview-browser-"));
  const records = [
    retainedRun("recent", "2026-08-26T12:00:00.000Z", "Repair the Studio overview", ["Read", "Edit", "Bash"]),
    retainedRun("earlier", "2026-08-26T10:00:00.000Z", "Inspect the workspace evidence", ["Read"]),
  ];
  workspaceStudio = await startHarnessStudioServer({
    appDir: join(packageRoot, "dist", "app"),
    port: 0,
    workspaceDirectoryPicker: async () => workspaceDirectory,
    workspaceSessionProvider: {
      discover: async () => ({
        label: "better-harness-dashboard",
        providers: [{ provider: "codex", status: "ok", discovered: records.length, included: records.length }],
        sessions: records.map((record) => ({
          summary: {
            id: `codex:${record.id}`,
            savedAt: record.savedAt,
            prompt: record.prompt,
            status: "observed",
            toolCallCount: record.toolCallCount,
            provider: "codex",
            messageCount: 1,
            warningCount: 0,
          },
          debugger: {
            ...sessionFromRetainedRun(record),
            id: `codex:${record.id}`,
            agent: "codex",
            protocol: "Inspector normalized local evidence",
            connection: "observed",
          },
        })),
      }),
    },
  });
  const opened = await fetch(`${workspaceStudio.url}/api/workspace/open`, { method: "POST" });
  if (!opened.ok) throw new Error(`Could not open Overview fixture: ${await opened.text()}`);
});

test.afterAll(async () => {
  await sourceStudio?.close();
  await workspaceStudio?.close();
  if (workspaceDirectory) await rm(workspaceDirectory, { recursive: true, force: true });
});

test("labels a configured source action for the workbench it opens", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${sourceStudio.url}/#/overview`);

  await expect(page.getByRole("heading", { name: "Comparison setup is ready." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Project", exact: true })).toHaveCount(0);
  const action = page.getByRole("button", { name: "Open Compare" });
  await expect(action).toBeVisible();
  await action.focus();
  await expect(action).toBeFocused();
  await action.press("Enter");
  await expect(page).toHaveURL(/#\/compare$/u);
  await expect(page.getByRole("heading", { name: "Compare", exact: true })).toBeVisible();
});

test("renders the connected workspace home across layout modes", async ({ page }, testInfo) => {
  const browserErrors = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(`console: ${message.text()}`); });
  page.on("pageerror", (error) => browserErrors.push(`page: ${error.message}`));

  for (const layout of layouts) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await page.goto(`${workspaceStudio.url}/#/overview`);
    await expect(page.locator(".studio-context-title")).toContainText("better-harness-dashboard");
    await expect(page.getByLabel("Workspace summary")).toContainText("Sessions2");
    await expect(page.getByRole("heading", { name: "Recent Sessions" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open Session: Repair the Studio overview" })).toBeVisible();
    if (layout.name !== "wide") await expect(page.locator(".studio-primary-nav")).not.toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath(`overview-dashboard-${layout.name}.png`) });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${workspaceStudio.url}/#/overview`);
  await page.getByRole("button", { name: "Open Session: Inspect the workspace evidence" }).click();
  await expect(page).toHaveURL(/#\/projects\/project_[a-f0-9]{32}\/sessions$/u);
  await expect(page.getByRole("heading", { name: "Inspect the workspace evidence" })).toBeVisible();
  expect(browserErrors).toEqual([]);
});
