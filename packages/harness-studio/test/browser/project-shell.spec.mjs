import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { HarnessRunEmitter } from "@qoder-ai/harness/exec";
import { startHarnessStudioServer } from "../../dist/server/server.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const layouts = [
  { name: "wide", width: 1440, height: 900 },
  { name: "compact", width: 1024, height: 768 },
  { name: "narrow", width: 390, height: 844 },
];

let studio;
let projectA;
let projectB;
let labelA;
let labelB;
let descriptorA;
let descriptorB;
let observedRunCwd;

test.beforeAll(async () => {
  projectA = await mkdtemp(join(tmpdir(), "studio-shell-a-"));
  projectB = await mkdtemp(join(tmpdir(), "studio-shell-b-"));
  labelA = basename(projectA);
  labelB = basename(projectB);
  const selections = [projectA, projectB];
  studio = await startHarnessStudioServer({
    appDir: join(packageRoot, "dist", "app"),
    port: 0,
    workspaceDirectoryPicker: async () => selections.shift(),
    workspaceSessionProvider: {
      discover: async (selected) => {
        const count = basename(selected) === labelA ? 1 : 2;
        return {
          label: basename(selected),
          providers: [{ provider: "codex", status: "ok", discovered: count, included: count }],
          sessions: Array.from({ length: count }, (_, index) => ({
            summary: {
              id: `codex:session-${basename(selected)}-${index}`,
              savedAt: `2026-08-27T0${index}:00:00.000Z`,
              prompt: `${basename(selected)} Session ${index + 1}`,
              status: "observed",
              toolCallCount: 0,
              provider: "codex",
            },
            debugger: {
              id: `codex:session-${basename(selected)}-${index}`,
              name: `${basename(selected)} Session ${index + 1}`,
              agent: "codex",
              protocol: "Inspector normalized local evidence",
              connection: "observed",
              mode: "Retained run",
              startedAt: "00:00:00",
              finishedAt: "00:00:01",
              events: [],
            },
          })),
        };
      },
    },
    executorFactory: (context) => ({
      host: "qoder",
      async execute(revision, _bundle, task) {
        observedRunCwd = task.cwd;
        const emitter = new HarnessRunEmitter(context.onRunEvent);
        emitter.start({ revisionId: revision.revisionId, host: "qoder" });
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 700));
        emitter.text(`bound project: ${basename(task.cwd ?? "")}`);
        emitter.finish(0);
        return { host: "qoder", revisionId: revision.revisionId, exitCode: 0, output: "finished", errorOutput: "", warnings: [] };
      },
    }),
  });
  const openedA = await (await fetch(`${studio.url}/api/projects/open`, { method: "POST" })).json();
  const openedB = await (await fetch(`${studio.url}/api/projects/open`, { method: "POST" })).json();
  descriptorA = openedA.project;
  descriptorB = openedB.project;
});

test.afterAll(async () => {
  await studio?.close();
  if (projectA) await rm(projectA, { recursive: true, force: true });
  if (projectB) await rm(projectB, { recursive: true, force: true });
});

function projectButton(page, label) {
  return page.getByRole("button", { name: new RegExp(`^${label}`) });
}

test("switches one shared View workbench between remembered Projects", async ({ page }, testInfo) => {
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  await page.setViewportSize(layouts[0]);
  await page.goto(`${studio.url}/#/overview`);

  await expect(projectButton(page, labelB)).toHaveAttribute("aria-current", "true");
  await expect(page).toHaveURL(new RegExp(`#\/projects\/${descriptorB.id}\/overview$`, "u"));
  await expect(page.getByLabel(`${labelB} Views`)).toBeVisible();
  await expect(page.getByLabel(`${labelA} Views`)).toHaveCount(0);
  await expect(page.getByLabel("Workspace summary")).toContainText("Sessions2");

  await projectButton(page, labelA).click();
  await expect(projectButton(page, labelA)).toHaveAttribute("aria-current", "true");
  await expect(page).toHaveURL(new RegExp(`#\/projects\/${descriptorA.id}\/overview$`, "u"));
  await expect(page.getByLabel(`${labelA} Views`)).toBeVisible();
  await expect(page.getByLabel("Workspace summary")).toContainText("Sessions1");

  await page.goBack();
  await expect(projectButton(page, labelB)).toHaveAttribute("aria-current", "true");
  await expect(page.getByLabel("Workspace summary")).toContainText("Sessions2");
  await page.goForward();
  await expect(projectButton(page, labelA)).toHaveAttribute("aria-current", "true");
  await expect(page.getByLabel("Workspace summary")).toContainText("Sessions1");

  await projectButton(page, labelA).focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("button", { name: /^Overview/ })).toBeFocused();
  await page.keyboard.press("End");
  await expect(projectButton(page, labelB)).toBeFocused();

  for (const layout of layouts) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    if (layout.name !== "wide") {
      await expect(page.locator(".studio-primary-nav")).not.toBeInViewport();
      await page.locator(".studio-nav-toggle").click();
      await expect(page.locator(".studio-primary-nav")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
      await expect(projectButton(page, labelA)).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
    const visibleViewNavigations = await page.evaluate(() => [...document.querySelectorAll(".studio-project-views")].filter((node) => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== "hidden").length);
    expect(visibleViewNavigations).toBe(1);
    await page.screenshot({ path: testInfo.outputPath(`project-shell-${layout.name}.png`) });
    if (layout.name === "narrow") {
      await projectButton(page, labelB).click();
      await expect(page.locator(".studio-primary-nav")).not.toBeInViewport();
      await expect(page.locator(".studio-nav-toggle")).toBeFocused();
      await expect(page.locator(".studio-context-title > small")).toHaveText(labelB);
    } else if (layout.name !== "wide") {
      await page.locator(".studio-project-close").click();
      await expect(page.locator(".studio-primary-nav")).not.toBeInViewport();
    }
  }
  expect(errors).toEqual([]);
});

test("keeps a live run bound to its starting Project across a sidebar switch", async ({ page }) => {
  await page.setViewportSize(layouts[0]);
  await page.goto(`${studio.url}/#/projects/${descriptorA.id}/debugger`);
  await expect(projectButton(page, labelA)).toHaveAttribute("aria-current", "true");
  await page.getByRole("button", { name: "New live run" }).click();
  await expect(page.getByRole("dialog", { name: "Start a live harness session" })).toContainText(`Project ${labelA}`);
  await page.getByPlaceholder("Task prompt for the harness run…").fill("prove the Project binding");
  await page.getByRole("button", { name: "Run harness" }).click();
  await expect(page.locator(".debugger-brand")).toContainText(labelA);

  await projectButton(page, labelB).click();
  await expect(projectButton(page, labelB)).toHaveAttribute("aria-current", "true");
  await expect(page.locator(".debugger-brand")).toContainText(labelA);
  await expect(page.locator(".session-notebook")).toContainText(`bound project: ${labelA}`);
  expect(await realpath(observedRunCwd)).toBe(await realpath(projectA));
});

test("keeps configured Sources reachable before a Project is opened", async ({ page }) => {
  const sourceStudio = await startHarnessStudioServer({
    appDir: join(packageRoot, "dist", "app"),
    port: 0,
    workspaceDirectoryPicker: async () => projectA,
    workspaceSessionProvider: { discover: async () => ({ label: labelA, sessions: [] }) },
    sourceCatalog: [{ id: "evidence_fixture", kind: "evidence", label: "Frozen evidence", path: projectA }],
  });
  try {
    await page.setViewportSize(layouts[0]);
    await page.goto(sourceStudio.url);
    await expect(page.getByRole("dialog", { name: "Open a Project to start" })).toHaveCount(0);
    await expect(page.getByLabel("Configured source Views")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Evidence results are ready." })).toBeVisible();
  } finally {
    await sourceStudio.close();
  }
});
