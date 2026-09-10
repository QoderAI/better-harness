import { mkdtemp, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { expect, test } from "@playwright/test";
import { startHarnessStudioServer } from "../../dist/server/server.js";
let studio, directory;
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "acp-controls-"));
  await cp(process.env.STUDIO_TEST_APP_DIR ?? resolve("dist/app"), join(directory, "app"), { recursive: true });
  const agent = { command: process.execPath, args: [resolve("../harness/test/fixtures/acp-agent.mjs"), "--session-controls"], label: "Alpha ACP" };
  studio = await startHarnessStudioServer({
    appDir: join(directory, "app"), runDirectory: directory,
    ...(process.env.STUDIO_TEST_ACP_HOST ? { acpHostExecutable: process.env.STUDIO_TEST_ACP_HOST } : {}),
    ...(process.env.STUDIO_TEST_ACP_TRANSPORT ? { acpHostTransport: process.env.STUDIO_TEST_ACP_TRANSPORT } : {}),
    workspaceDirectoryPicker: async () => resolve("."),
    workspaceSessionProvider: { discover: async () => ({ label: "Configuration fixture", sessions: [] }) },
    acpAgent: agent, acpAgents: [{ id: "alpha", label: "Alpha ACP", agent }, { id: "beta", label: "Beta ACP", agent }],
  });
});
test.afterAll(async () => { await studio?.close(); await rm(directory, { recursive: true, force: true }); });
test("configures model and effort before prompting, retries errors, and isolates lanes", async ({ page }, info) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", msg => { if (msg.type() === "error" && !msg.text().includes("503")) errors.push(msg.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${studio.url}/#/compare`);
  const open = page.getByRole("button", { name: "Open Project", exact: true });
  await expect(open.or(page.getByRole("textbox", { name: "What should these Agents do?" }))).toBeVisible();
  if (await open.isVisible()) await open.click();
  await page.getByRole("textbox", { name: "What should these Agents do?" }).fill("Read configuration evidence");
  await expect(page.locator(".acp-conversation-history")).toHaveCount(0);
  await page.getByRole("button", { name: /^Choose Agents/ }).click();
  for (const name of ["Alpha ACP", "Beta ACP"]) await page.getByRole("menuitemcheckbox", { name: new RegExp(name) }).click();
  await page.keyboard.press("Escape");
  // Selecting an Agent configures it in place: the offered settings belong to
  // the Agent control inside the input region, with no second panel, no separate
  // refresh control, and no transcript before the shared prompt starts.
  const configurations = page.locator(".live-compare-composer .live-compare-agent");
  await expect(configurations).toHaveCount(2);
  await expect(configurations.first().getByRole("combobox", { name: "Mode", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Configure Agents", exact: true })).toHaveCount(0);
  await expect(page.locator(".live-compare-readiness")).toHaveCount(0);
  await expect(page.locator(".live-compare-lane")).toHaveCount(0);
  const alpha = configurations.filter({ hasText: "Alpha ACP" });
  const beta = configurations.filter({ hasText: "Beta ACP" });
  let fail = true, actionUrl;
  await page.route("**/api/acp/runs/*/session", async route => {
    actionUrl = route.request().url();
    if (route.request().postDataJSON().action === "config" && fail) { fail = false; await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Fixture setting unavailable; retry" }) }); }
    else await route.continue();
  });
  const model = alpha.getByRole("combobox", { name: "Model", exact: true });
  await model.selectOption("fixture-candidate");
  await expect(alpha.getByRole("alert")).toContainText("retry");
  await expect(model).toHaveValue("fixture-default");
  await model.selectOption("fixture-candidate");
  await expect(model).toHaveValue("fixture-candidate");
  await expect(alpha.getByRole("combobox", { name: "Reasoning effort" })).toHaveValue("medium");
  await alpha.getByRole("combobox", { name: "Reasoning effort" }).selectOption("low");
  await alpha.locator(".acp-session-settings > summary").click();
  await expect(alpha.getByRole("combobox", { name: "Model", exact: true })).toHaveCount(1);
  await alpha.getByRole("checkbox", { name: "Fast mode" }).click();
  await expect(alpha.getByRole("checkbox", { name: "Fast mode" })).toBeChecked();
  await expect(beta.getByRole("combobox", { name: "Model", exact: true })).toHaveValue("fixture-default");
  expect((await page.request.post(actionUrl, { data: { action: "config", configId: "model", value: "unoffered-model" } })).status()).toBe(400);
  expect((await page.request.post(actionUrl, { headers: { origin: "https://unrelated.example" }, data: { action: "start" } })).status()).toBe(403);
  for (const size of [{ name: "wide", width: 1440, height: 900 }, { name: "compact", width: 1024, height: 768 }, { name: "narrow", width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await page.emulateMedia({ colorScheme: size.name === "compact" ? "light" : "dark", reducedMotion: "reduce" });
    await page.mouse.move(0, 0);
    await model.focus();
    expect(await model.evaluate(node => getComputedStyle(node).outlineStyle)).not.toBe("none");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ animations: "disabled", path: info.outputPath(`acp-settings-${size.name}.png`) });
  }
  await alpha.locator(".acp-session-settings > summary").click();
  await page.getByRole("button", { name: "Run 2 Agents", exact: true }).click();
  const alphaLane = page.locator(".live-compare-lane").filter({ hasText: "Alpha ACP" });
  const betaLane = page.locator(".live-compare-lane").filter({ hasText: "Beta ACP" });
  await alphaLane.getByRole("button", { name: "Allow once", exact: true }).click();
  await expect(alphaLane.locator(".run-badge")).toHaveText("Completed");
  await alphaLane.getByRole("button", { name: "Close session", exact: true }).click();
  expect((await page.request.post(actionUrl, { data: { action: "config", configId: "model", value: "fixture-default" } })).status()).toBe(409);
  await betaLane.getByRole("button", { name: "Reject", exact: true }).click();
  expect(errors).toEqual([]);
});

test("renders rich messages and update-only tool diffs without losing their fields", async ({ page }, info) => {
  const rich = await startHarnessStudioServer({
    appDir: join(directory, "app"),
    ...(process.env.STUDIO_TEST_ACP_HOST ? { acpHostExecutable: process.env.STUDIO_TEST_ACP_HOST } : {}),
    ...(process.env.STUDIO_TEST_ACP_TRANSPORT ? { acpHostTransport: process.env.STUDIO_TEST_ACP_TRANSPORT } : {}),
    workspaceDirectoryPicker: async () => resolve("."),
    workspaceSessionProvider: { discover: async () => ({ label: "Rich content", sessions: [] }) },
    acpAgent: { command: process.execPath, args: [resolve("../harness/test/fixtures/acp-agent.mjs"), "--rich-content"], label: "Rich ACP" },
  });
  try {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(`${rich.url}/#/debugger`);
    await page.getByRole("button", { name: "Open Project", exact: true }).click();
    await page.getByRole("button", { name: "New live run" }).click();
    await page.getByRole("textbox", { name: "Task", exact: true }).fill("Show rich protocol content");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await page.getByRole("button", { name: "Allow once allow_once" }).click();
    const stream = page.locator(".acp-session-stream");
    await expect(stream.getByRole("heading", { name: "Verified" })).toBeVisible();
    await expect(stream.getByText("Replayed user context", { exact: true })).toHaveCount(1);
    await expect(stream.getByRole("img", { name: "Agent image" })).toHaveCount(1);
    await expect(stream.getByRole("link", { name: "Evidence report" })).toHaveAttribute("href", "https://example.com/report");
    await expect(stream).toContainText("Retained resource text");
    for (const activity of await stream.locator(".acp-activity-header").all()) await activity.click();
    const tool = stream.locator(".tool-card").filter({ hasText: "Preview file changes" });
    await tool.locator(".ai-tool-header").click();
    await expect(tool).toContainText("/fixture/readme.md:1");
    await expect(tool).toContainText("Tool progress evidence");
    await expect(tool.locator('[data-artifact-code-view="diff"]')).toHaveCount(1);
    await page.screenshot({ animations: "disabled", path: info.outputPath("acp-rich-content.png") });
  } finally { await rich.close(); }
});
