import { existsSync } from "node:fs";
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
let liveCompareStudio;
let runDirectory;

async function runAcpPrompt(page, prompt) {
  await page.getByRole("button", { name: "New live run" }).click();
  // The composer names the Agent it is about to run, so the fixture is selected
  // by its own label rather than by an opaque runtime word.
  await expect(page.getByRole("combobox", { name: "Agent" }).locator("option:checked")).toHaveText("Fixture ACP");
  await page.getByRole("textbox", { name: "Task", exact: true }).fill(prompt);
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator(".live-inspector > header")).toContainText("Permission required");
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
    // A registered catalog with one selectable entry and one unavailable preset,
    // so the composer has a real Agent decision to make.
    acpAgents: [
      { id: "qodercli", label: "Qoder CLI", agent: { command: process.execPath, args: [acpAgentFixture], label: "Qoder CLI" } },
      { id: "pi", label: "Pi ACP", unavailableReason: "pi-acp is not installed." },
    ],
  });
  // A second Studio registers two launchable Agents so one prompt can be sent to
  // two independently chosen Agents.
  const alpha = { command: process.execPath, args: [acpAgentFixture], label: "Alpha ACP" };
  const beta = { command: process.execPath, args: [acpAgentFixture], label: "Beta ACP" };
  liveCompareStudio = await startHarnessStudioServer({
    appDir: resolve(packageRoot, "dist/app"),
    workspaceDirectoryPicker: async () => repositoryRoot,
    workspaceSessionProvider: { discover: async () => ({ label: "Live compare fixture", sessions: [] }) },
    acpAgent: alpha,
    acpAgents: [
      { id: "alpha", label: "Alpha ACP", agent: alpha },
      { id: "beta", label: "Beta ACP", agent: beta },
      { id: "missing", label: "Missing ACP", unavailableReason: "bridge not installed" },
    ],
  });
});

test.afterAll(async () => {
  await studio?.close();
  await liveCompareStudio?.close();
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
  await expect(page.locator(".debugger-runtime-meta")).toContainText("Fixture ACP");
  await expect(page.getByText("session/request_permission", { exact: true })).toBeVisible();
  await expect(page.getByText("session/prompt:response", { exact: true })).toBeVisible();

  for (const layout of layouts.slice(0, 2)) {
    await page.setViewportSize(layout);
    await expect(page.locator(".debugger-shell")).toBeVisible();
    await expect(page.locator(".debugger-topbar")).toHaveCount(0);
    await expect(page.locator(".studio-status-bar")).toHaveCount(1);
    await expect(page.locator(".timeline-minimap")).toHaveCount(0);
    const newRun = page.getByRole("button", { name: "New live run" });
    await page.keyboard.press("Tab");
    await newRun.focus();
    await expect(newRun).toBeFocused();
    expect(await newRun.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe("none");
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
  await expect(page.getByRole("heading", { name: "Debugger", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("acp-debugger-narrow.png"), fullPage: true });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.setViewportSize(layouts[0]);
  await page.screenshot({ path: testInfo.outputPath("acp-debugger-dark.png"), fullPage: true, animations: "disabled" });
  expect(errors).toEqual([]);
});

test("starts a live run against the ACP Agent chosen by name", async ({ page }, testInfo) => {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize(layouts[0]);
  await page.goto(`${studio.url}/#/debugger`);
  // The Studio server keeps the Project it already opened, so this only picks one
  // when the Debugger still asks for it.
  const chooseProject = page.getByRole("button", { name: "Choose Project" });
  if (await chooseProject.isVisible().catch(() => false)) await chooseProject.click();
  await page.getByRole("button", { name: "New live run" }).click();

  const agentSelect = page.getByRole("combobox", { name: "Agent" });
  await expect(agentSelect.locator("option")).toHaveText([
    "Qoder SDK · Harness stream",
    "Fixture ACP",
    "Qoder CLI",
    "Pi ACP (unavailable)",
  ]);
  // An unavailable preset stays visible with the server's reason and cannot run.
  const unavailable = agentSelect.locator("option", { hasText: "Pi ACP" });
  await expect(unavailable).toHaveAttribute("disabled", "");
  await expect(unavailable).toHaveAttribute("title", "pi-acp is not installed.");

  await agentSelect.selectOption({ label: "Qoder CLI" });
  await page.getByRole("textbox", { name: "Task", exact: true }).fill("Run the named Agent");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator(".debugger-runtime-meta")).toContainText("Qoder CLI");
  await expect(page.locator(".live-inspector > header")).toContainText("Permission required");
  await page.getByRole("button", { name: "Allow once allow_once" }).click();
  await expect(page.getByText("fixture:allow-once", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("acp-debugger-agent-choice.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("sends one prompt to two chosen Agents and compares them side by side", async ({ page }, testInfo) => {
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.setViewportSize(layouts[0]);
  await page.goto(`${liveCompareStudio.url}/#/compare`);
  await page.getByRole("button", { name: "Choose Project" }).click();
  await expect(page.getByRole("textbox", { name: "What should both Agents do?" })).toBeVisible();

  const prompt = page.getByRole("textbox", { name: "What should both Agents do?" });
  const left = page.getByRole("combobox", { name: "Left Agent" });
  const right = page.getByRole("combobox", { name: "Right Agent" });
  const run = page.getByRole("button", { name: "Run both" });

  // Nothing is preselected, so the reader must state both Agents before running.
  await expect(left).toHaveValue("");
  await expect(right).toHaveValue("");
  await expect(run).toBeDisabled();
  await prompt.fill("Compare two Agents on one requirement");
  await expect(run).toBeDisabled();
  await left.selectOption("alpha");
  await expect(run).toBeDisabled();
  await right.selectOption("beta");
  await expect(run).toBeEnabled();
  // An unavailable Agent is listed with its reason but marked unselectable. The
  // launch refusal itself is enforced server-side, not by this attribute.
  const unavailableOptions = page.locator('.live-compare-agents option[value="missing"]');
  await expect(unavailableOptions).toHaveCount(2);
  await expect(unavailableOptions.nth(0)).toHaveAttribute("disabled", "");
  await expect(unavailableOptions.nth(1)).toHaveAttribute("disabled", "");
  await expect(page.locator(".live-compare-composer")).toContainText("can overwrite each other");

  await run.click();
  const lanes = page.locator(".live-compare-lane");
  await expect(lanes).toHaveCount(2);
  await expect(lanes.nth(0)).toContainText("Alpha ACP");
  await expect(lanes.nth(1)).toContainText("Beta ACP");
  // Both Agents really launched: each lane raises its own ACP permission gate,
  // and each is answered inside its own lane so one decision never leaks.
  await expect(page.locator(".live-compare-permission")).toHaveCount(2);
  for (const index of [0, 1]) {
    const allow = lanes.nth(index).locator(".live-compare-permission").getByRole("button", { name: "Allow once" });
    await expect(allow).toBeVisible();
    await allow.click();
    await expect(lanes.nth(index).locator(".live-compare-permission")).toHaveCount(0);
  }
  await expect(lanes.nth(0)).toContainText("fixture:allow-once");
  await expect(lanes.nth(1)).toContainText("fixture:allow-once");
  await expect(lanes.nth(0).locator(".live-compare-counts")).toContainText("1 message");
  await expect(lanes.nth(1).locator(".live-compare-counts")).toContainText("1 message");

  for (const layout of layouts) {
    await page.setViewportSize(layout);
    // The compact/narrow shell docks navigation into a drawer; dismiss it so the
    // comparison itself is what gets reviewed.
    await page.keyboard.press("Escape");
    await expect(page.locator(".studio-control-plane.navigation-open")).toHaveCount(0);
    await expect(page.locator(".live-compare-lane")).toHaveCount(2);
    await expect(page.locator(".live-compare-lane").nth(1)).toContainText("Beta ACP");
    const dimensions = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.documentWidth, `${layout.name} live compare overflows horizontally`).toBe(dimensions.innerWidth);
    await page.screenshot({ path: testInfo.outputPath(`live-compare-${layout.name}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});

test("keeps the compact run dialog bounded and restores keyboard focus", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(`${studio.url}/#/debugger`);
  const choose = page.getByRole("button", { name: "Choose Project" });
  await expect(choose.or(page.getByRole("button", { name: "New live run" }))).toBeVisible();
  if (await choose.isVisible()) await choose.click();
  for (const layout of layouts) {
    await page.setViewportSize(layout);
    await page.emulateMedia({ colorScheme: layout.name === "compact" ? "light" : "dark" });
    const launcher = page.getByRole("button", { name: "New live run" });
    await launcher.click();
    const dialog = page.getByRole("dialog", { name: "New run", exact: true });
    const task = dialog.getByRole("textbox", { name: "Task", exact: true });
    await expect(dialog).toBeVisible();
    await expect(task).toBeFocused();
    await task.fill("   ");
    await expect(dialog.getByRole("button", { name: "Run", exact: true })).toBeDisabled();
    await task.fill("hi");
    await expect(dialog.getByRole("button", { name: "Run", exact: true })).toBeEnabled();
    for (let index = 0; index < 6; index += 1) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    }
    const bounds = await dialog.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(layout.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(layout.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(layout.width);
    await page.screenshot({ path: testInfo.outputPath(`composer-${layout.name}.png`), animations: "disabled" });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(launcher).toBeFocused();
    await launcher.click();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(launcher).toBeFocused();
  }
  expect(errors).toEqual([]);
});

test("resizes both Debugger boundaries with pointer and keyboard", async ({ page }, testInfo) => {
  await page.setViewportSize(layouts[0]);
  await page.goto(`${studio.url}/#/debugger`);
  const choose = page.getByRole("button", { name: "Choose Project" });
  await expect(choose.or(page.getByRole("button", { name: "New live run" }))).toBeVisible();
  if (await choose.isVisible()) await choose.click();
  await expect(page.getByTitle("Toggle Execution Tree")).toHaveCount(0);
  await expect(page.getByTitle("Toggle State Inspector")).toHaveCount(0);
  const tree = page.locator(".execution-tree");
  const center = page.locator(".session-notebook");
  const inspector = page.locator(".state-inspector");
  const widths = async () => Promise.all([tree, center, inspector].map(async (pane) => (await pane.boundingBox()).width));
  for (const name of ["Resize execution tree", "Resize state inspector"]) {
    const sash = page.getByRole("separator", { name });
    await expect(sash).toBeVisible();
    const before = await widths();
    const bounds = await sash.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 60);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 44, bounds.y + 60);
    await page.mouse.up();
    expect(await widths()).not.toEqual(before);
    await sash.focus();
    await page.keyboard.press("Home");
    await expect(sash).toHaveAttribute("aria-valuenow", await sash.getAttribute("aria-valuemin"));
    await page.keyboard.press("End");
    await expect(sash).toHaveAttribute("aria-valuenow", await sash.getAttribute("aria-valuemax"));
    await sash.dblclick();
  }
  for (const layout of layouts) {
    await page.setViewportSize(layout);
    await expect(center).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(layout.width);
    await page.screenshot({ path: testInfo.outputPath(`resizable-${layout.name}.png`), animations: "disabled" });
  }
});

test("shows shared assistant chunks in Debugger and Compare before completion", async ({ page }, testInfo) => {
  const nativeHost = resolve(packageRoot, "../better-harness-desktop/dist/native", process.platform === "win32" ? "harness-acp-host.exe" : "harness-acp-host");
  const agent = { command: process.execPath, args: [acpAgentFixture, "--stream-chunks"], label: "Streaming ACP" };
  const server = await startHarnessStudioServer({
    appDir: resolve(packageRoot, "dist/app"), runDirectory,
    acpHostExecutable: nativeHost,
    workspaceDirectoryPicker: async () => repositoryRoot,
    workspaceSessionProvider: { discover: async () => ({ label: "Streaming fixture", sessions: [] }) },
    acpAgent: agent,
    acpAgents: [{ id: "first", label: "First", agent }, { id: "second", label: "Second", agent }],
  });
  try {
    const config = await (await fetch(`${server.url}/api/config`)).json();
    expect(config.acpRuntimeProfile).toBe(existsSync(nativeHost) ? "acp-v1-rust" : "acp-v1-stdio");
    await testInfo.attach("stream-runtime", { body: config.acpRuntimeProfile, contentType: "text/plain" });
    await page.setViewportSize(layouts[0]);
    await page.goto(`${server.url}/#/debugger`);
    await page.getByRole("button", { name: "Choose Project" }).click();
    await page.getByRole("button", { name: "New live run" }).click();
    await page.getByRole("textbox", { name: "Task", exact: true }).fill("stream in two chunks");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await page.getByRole("button", { name: "Allow once allow_once" }).click();
    const message = page.locator(".streaming-message");
    await expect(message).toContainText("fixture:stream-first");
    await expect(message).not.toContainText("stream-last");
    await expect(page.locator(".debugger-status")).not.toContainText("Run finished");
    await page.getByRole("button", { name: "Continue stream allow_once" }).click();
    await expect(message).toContainText("fixture:stream-first:stream-last");
    await expect(page.locator(".debugger-status")).toContainText("Run finished");
    await page.goto(`${server.url}/#/compare`);
    await page.getByRole("textbox", { name: "What should both Agents do?" }).fill("stream in two lanes");
    await page.getByRole("combobox", { name: "Left Agent" }).selectOption("first");
    await page.getByRole("combobox", { name: "Right Agent" }).selectOption("second");
    await page.getByRole("button", { name: "Run both", exact: true }).click();
    for (const lane of await page.locator(".live-compare-lane").all()) {
      await lane.getByRole("button", { name: "Allow once", exact: true }).click();
      await expect(lane.locator(".streaming-message")).toContainText("fixture:stream-first");
      await expect(lane.locator(".streaming-message")).not.toContainText("stream-last");
      await lane.getByRole("button", { name: "Continue stream", exact: true }).click();
      await expect(lane.locator(".streaming-message")).toContainText("fixture:stream-first:stream-last");
    }
  } finally { await server.close(); }
});
