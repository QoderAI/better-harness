import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { startHarnessStudioServer } from "../../dist/server/server.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = resolve(packageRoot, "../..");
const acpAgentFixture = resolve(packageRoot, "../harness/test/fixtures/acp-agent.mjs");
const layouts = [
  { name: "wide", width: 1440, height: 900 },
  { name: "compact", width: 1024, height: 768 },
  { name: "narrow", width: 390, height: 844 },
];

let studio;
let runDirectory;

async function runAcpPrompt(page, prompt) {
  await page.getByRole("button", { name: "New live run" }).click();
  await page.getByRole("combobox", { name: "Runtime" }).selectOption("acp");
  await page.getByRole("textbox", { name: "Task prompt for the harness run…" }).fill(prompt);
  await page.getByRole("button", { name: "Run harness" }).click();
  await expect(page.getByText("ACP permission requested")).toBeVisible();
  await page.getByRole("button", { name: "Allow once allow_once" }).click();
  await expect(page.getByText("fixture:allow-once", { exact: true })).toBeVisible();
}

test.beforeAll(async () => {
  runDirectory = await mkdtemp(join(tmpdir(), "studio-acp-browser-runs-"));
  studio = await startHarnessStudioServer({
    appDir: resolve(packageRoot, "dist/app"),
    runDirectory,
    workspaceDirectoryPicker: async () => repositoryRoot,
    workspaceSessionProvider: { discover: async () => ({ label: "ACP browser fixture", sessions: [] }) },
    acpAgent: { command: process.execPath, args: [acpAgentFixture], label: "Fixture ACP" },
  });
});

test.afterAll(async () => {
  await studio?.close();
  if (runDirectory !== undefined) await rm(runDirectory, { recursive: true, force: true });
});

test("runs ACP through the Debugger permission gate at wide, compact, and narrow layouts", async ({ page }, testInfo) => {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize(layouts[0]);
  await page.goto(`${studio.url}/#/debugger`);
  await page.getByRole("button", { name: "Choose Project" }).click();
  await expect(page.getByRole("button", { name: "New live run" })).toBeVisible();
  await runAcpPrompt(page, "Verify the browser ACP bridge");
  await expect(page.getByText("session/request_permission", { exact: true })).toBeVisible();
  await expect(page.getByText("session/prompt:response", { exact: true })).toBeVisible();

  for (const layout of layouts.slice(0, 2)) {
    await page.setViewportSize(layout);
    await expect(page.locator(".debugger-shell")).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.documentWidth).toBe(dimensions.innerWidth);
    await page.screenshot({ path: testInfo.outputPath(`acp-debugger-${layout.name}.png`), fullPage: true });
  }
  const narrow = layouts[2];
  await page.setViewportSize(narrow);
  await page.reload();
  await expect(page.getByRole("button", { name: "New live run" })).toBeVisible();
  await runAcpPrompt(page, "Verify the narrow ACP bridge");
  const narrowDimensions = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(narrowDimensions.documentWidth).toBe(narrowDimensions.innerWidth);
  await page.screenshot({ path: testInfo.outputPath("acp-debugger-narrow.png"), fullPage: true });
  expect(errors).toEqual([]);
});
