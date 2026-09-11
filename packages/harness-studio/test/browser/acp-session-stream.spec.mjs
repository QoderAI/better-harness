import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { startHarnessStudioServer } from "../../dist/server/server.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const layouts = [{ name: "wide", width: 1440, height: 900 }, { name: "compact", width: 1024, height: 768 }, { name: "narrow", width: 390, height: 844 }];
let directory;
let studio;
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "acp-stream-browser-"));
  // A stable build snapshot protects an active browser run from another local
  // task rebuilding the shared workspace's dist directory.
  await cp(process.env.STUDIO_TEST_APP_DIR ?? join(root, "dist", "app"), join(directory, "app"), { recursive: true });
  const agent = { command: process.execPath, args: [resolve(root, "../harness/test/fixtures/acp-agent.mjs"), "--session-stream"], label: "Alpha ACP" };
  studio = await startHarnessStudioServer({
    appDir: join(directory, "app"),
    ...(process.env.STUDIO_TEST_ACP_HOST === undefined ? {} : { acpHostExecutable: process.env.STUDIO_TEST_ACP_HOST }),
    runDirectory: join(directory, "runs"),
    workspaceDirectoryPicker: async () => root,
    workspaceSessionProvider: { discover: async () => ({ label: "Stream fixture", sessions: [] }) },
    acpAgent: agent,
    acpAgents: [{ id: "alpha", label: "Alpha ACP", agent }, { id: "beta", label: "Beta ACP", agent: { ...agent, label: "Beta ACP" } }],
  });
});
test.afterAll(async () => { await studio?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });

async function openProject(page, area) {
  await page.goto(`${studio.url}/#/${area}`);
  const choose = page.getByRole("button", { name: "Open Project", exact: true });
  const ready = area === "debugger" ? page.getByRole("button", { name: "New live run" }) : page.getByRole("textbox", { name: "What should these Agents do?" });
  await expect(choose.or(ready)).toBeVisible();
  if (await choose.isVisible()) await choose.click();
}

test("compares rich ACP streams with isolated retryable decisions, stable reading position and responsive tools", async ({ page }, info) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("503")) errors.push(message.text()); });
  await page.setViewportSize(layouts[0]);
  await openProject(page, "compare");
  await page.getByRole("textbox", { name: "What should these Agents do?" }).fill("Inspect session stream evidence");
  await page.getByRole("button", { name: /^Choose Agents/ }).click();
  for (const name of ["Alpha ACP", "Beta ACP"]) await page.getByRole("menuitemcheckbox", { name: new RegExp(name) }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Run 2 Agents" }).click();
  const lanes = page.locator(".live-compare-lane");
  await expect(lanes).toHaveCount(2);
  await expect(page.locator(".live-compare-permission")).toHaveCount(2);
  let attempts = 0;
  await page.route("**/api/acp/runs/*/permissions/*", async (route) => {
    attempts += 1;
    if (attempts === 1) await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Decision unavailable; retry" }) });
    else await route.continue();
  });
  const alpha = lanes.nth(0);
  const beta = lanes.nth(1);
  await alpha.getByRole("button", { name: "Allow once", exact: true }).click();
  await expect(alpha.getByRole("alert")).toContainText("Decision unavailable; retry");
  await expect(alpha.getByRole("button", { name: "Allow once", exact: true })).toBeEnabled();
  await alpha.getByRole("button", { name: "Allow once", exact: true }).click();
  await expect(alpha.getByRole("button", { name: "Continue stream", exact: true })).toBeVisible();
  await expect(beta.getByRole("button", { name: "Allow once", exact: true })).toBeVisible();
  // The first lane progressed while the second lane is still gated.
  await expect(alpha.getByRole("combobox", { name: "Model", exact: true })).toHaveValue("stream-model");

  // A compact lane states context use as a bounded percentage badge; the full
  // used/size facts belong to the non-compact Debugger metadata disclosure.
  await expect(alpha.locator(".ai-prompt-usage")).toHaveText("4%");
  const scroll = alpha.locator(".acp-session-scroll");
  await expect(alpha.locator(".streaming-message").last()).toContainText("Evidence row 50");
  const entries = alpha.locator(".acp-session-events > li");
  await expect(entries.filter({ hasText: "Starting inspection." })).toHaveCount(1);
  await expect.poll(() => scroll.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThanOrEqual(24);
  for (const activity of await alpha.locator(".acp-activity-header").all()) await activity.click();
  await expect(entries.locator(".acp-thought")).toHaveCount(1);
  await expect(entries.locator(".tool-card").filter({ hasText: "Read stream fixture" })).toHaveCount(1);
  await scroll.evaluate((node) => { node.scrollTop = 0; });
  await expect(alpha.getByRole("button", { name: "Back to latest" })).toBeVisible();
  // Compact lanes keep the transcript only: the metadata disclosure (title,
  // context facts and plan) belongs to the non-compact Debugger surface.
  await expect(alpha.locator(".acp-thought")).toContainText("Inspecting the evidence.");
  const tool = alpha.locator(".tool-card").filter({ hasText: "Read stream fixture" });
  await page.keyboard.press("Tab");
  await tool.getByRole("button", { name: /Read stream fixture/ }).focus();
  expect(await tool.getByRole("button", { name: /Read stream fixture/ }).evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(tool).toContainText('"path": "fixture.txt"');
  await expect(tool).toContainText('"verified": true');
  // Keep the transcript parked at the top while a new chunk completes the turn.
  await scroll.evaluate((node) => { node.scrollTop = 0; });
  await alpha.getByRole("button", { name: "Continue stream", exact: true }).click();
  // A live lane states completion through its transcript; the run badge that
  // summarized status was retired from live lanes.
  await expect(alpha.locator(".streaming-message").last()).toContainText("stream:complete");
  expect(await scroll.evaluate((node) => node.scrollTop)).toBe(0);
  await alpha.getByRole("button", { name: "Back to latest" }).focus();
  await page.keyboard.press("Enter");
  await expect(scroll).toBeFocused();
  await expect.poll(() => scroll.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThanOrEqual(24);
  // A failed cancel is visible and retryable; the sibling stays finished.
  let cancels = 0;
  await page.route("**/api/acp/runs/*/session", async (route) => {
    cancels += 1;
    if (cancels === 1) await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Cancel unavailable; retry" }) });
    else await route.continue();
  });
  await beta.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(beta.getByRole("alert")).toContainText("Cancel unavailable; retry");
  await expect(beta.getByRole("alert")).toBeVisible();
  await expect(beta.getByRole("button", { name: "Stop", exact: true })).toBeEnabled();
  await beta.getByRole("button", { name: "Stop", exact: true }).click();
  // The retired run badge is replaced by the transcript stating the stop.
  await expect(beta).toContainText("Turn stopped: cancelled");
  await expect(beta.locator(".acp-permission-gate")).toHaveCount(0);
  for (const layout of layouts) {
    await page.setViewportSize(layout);
    await page.keyboard.press("Escape");
    await page.emulateMedia({ colorScheme: layout.name === "compact" ? "light" : "dark", reducedMotion: "reduce" });
    await scroll.evaluate((node) => { node.scrollTop = 0; });
    await expect(alpha.locator(".acp-session-events")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(layout.width);
    expect(await scroll.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    if (layout.name === "narrow") {
      const first = await alpha.boundingBox();
      const second = await beta.boundingBox();
      expect(first.y + first.height).toBeLessThanOrEqual(second.y + 1);
    }
    await page.screenshot({ path: info.outputPath(`session-stream-${layout.name}.png`), fullPage: true, animations: "disabled" });
  }
  expect(errors).toEqual([]);
});

test("reuses the ACP stream and permission gate in Debugger", async ({ page }, info) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize(layouts[0]);
  await openProject(page, "debugger");
  await page.getByRole("button", { name: "New live run" }).click();
  await page.getByRole("textbox", { name: "Task", exact: true }).fill("Inspect shared stream");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.getByRole("button", { name: "Allow once allow_once" }).click();
  await expect(page.locator(".live-notebook .acp-session-stream")).toHaveCount(1);
  await expect(page.getByRole("combobox", { name: "Model", exact: true })).toHaveValue("stream-model");
  await page.getByRole("button", { name: "Continue stream allow_once" }).click();
  await expect(page.locator(".live-inspector > header")).toContainText("Ready");

  // Observed state reads as one counter row plus complete identifiers, and the
  // frame list carries its own window and per-frame gaps.
  const counters = page.locator(".live-inspector .observed-counters > li");
  await expect(counters).toHaveCount(3);
  await expect(counters.nth(2)).toContainText("ACP frames");
  const ids = page.locator(".live-inspector .fact-list-ids > div");
  await expect(ids).toHaveCount(2);
  await expect(ids.nth(0)).toContainText("run_");
  await expect(ids.nth(1)).toContainText("thread_");
  const frameWindow = page.locator(".acp-observation-span");
  await expect(frameWindow.locator("time")).toHaveCount(2);
  await expect(frameWindow.locator("time").nth(0)).toHaveText(/^\d{2}:\d{2}:\d{2}$/u);
  await expect(frameWindow.locator("strong")).toHaveText(/^\d/u);
  const retained = Number(await counters.nth(2).locator("strong").innerText());
  const frames = page.locator(".live-inspector .acp-protocol-list > details");
  await expect(frames).toHaveCount(Math.min(retained, 12));
  await expect(frames.nth(1).locator(".acp-frame-delta")).toHaveText(/^\+\d/u);
  // The run's first frame has no predecessor; a tail whose predecessor is
  // off-screen still reports its true gap.
  if (retained <= 12) await expect(frames.nth(0).locator(".acp-frame-delta")).toHaveCount(0);
  else await expect(frames.nth(0).locator(".acp-frame-delta")).toHaveText(/^\+\d/u);
  // Neither the frame list nor the last section draws a box the pane repeats.
  const listBorder = await page.locator(".live-inspector .acp-protocol-list").evaluate((node) => getComputedStyle(node).borderTopWidth);
  expect(listBorder).toBe("0px");
  const sectionBorder = await page.locator(".live-inspector .inspector-section").last().evaluate((node) => getComputedStyle(node).borderBottomWidth);
  expect(sectionBorder).toBe("0px");
  // The live tree reserves no disclosure column, so its root row starts at the edge.
  await expect(page.locator(".live-tree .tree-caret-spacer").first()).toBeHidden();

  for (const layout of layouts) {
    await page.setViewportSize(layout);
    await page.keyboard.press("Escape");
    await page.locator(".acp-session-scroll").evaluate((node) => { node.scrollTop = 0; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(layout.width);
    await page.screenshot({ path: info.outputPath(`debugger-stream-${layout.name}.png`), fullPage: true, animations: "disabled" });
  }
  expect(errors).toEqual([]);
});
