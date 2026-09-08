import { mkdtemp, rm, cp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { expect, test } from "@playwright/test";
import { startHarnessStudioServer } from "../../dist/server/server.js";
let studio, directory;
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "acp-connection-"));
  await cp(resolve("dist/app"), join(directory, "app"), { recursive: true });
  const agent = { command: process.execPath, args: [resolve("../harness/test/fixtures/acp-agent.mjs"), "--conversation", "--session-controls", "--connection-actions"] };
  const unsupported = { ...agent, args: agent.args.filter(value => value !== "--connection-actions") };
  studio = await startHarnessStudioServer({ appDir: join(directory, "app"), runDirectory: directory,
    ...(process.env.STUDIO_TEST_ACP_HOST ? { acpHostExecutable: process.env.STUDIO_TEST_ACP_HOST } : {}),
    ...(process.env.STUDIO_TEST_ACP_TRANSPORT ? { acpHostTransport: process.env.STUDIO_TEST_ACP_TRANSPORT } : {}),
    workspaceDirectoryPicker: async () => resolve("."), workspaceSessionProvider: { discover: async () => ({ label: "Connection fixture", sessions: [] }) },
    acpAgent: agent, acpAgents: [{ id: "alpha", label: "Alpha ACP", agent }, { id: "beta", label: "Beta ACP", agent: unsupported }],
  });
});
test.afterAll(async () => { await studio?.close(); await rm(directory, { recursive: true, force: true }); });
async function connect(page) {
  await page.goto(`${studio.url}/#/compare`);
  const open = page.getByRole("button", { name: "Open Project", exact: true });
  await expect(open.or(page.getByRole("textbox", { name: "What should these Agents do?" }))).toBeVisible();
  if (await open.isVisible()) await open.click();
  await page.getByRole("textbox", { name: "What should these Agents do?" }).fill("Continue the selected conversation");
  await page.getByRole("button", { name: /^Choose Agents/ }).click();
  for (const name of ["Alpha ACP", "Beta ACP"]) await page.getByRole("menuitemcheckbox", { name: new RegExp(name) }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Choose sessions", exact: true }).click();
  const lanes = page.locator(".live-compare-lane");
  await expect(lanes.nth(0).getByRole("button", { name: "Browse Agent history" })).toBeVisible();
  return [lanes.nth(0), lanes.nth(1)];
}
test("discover, authenticate, paginate and restore the selected Agent session", async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = []; page.on("pageerror", error => errors.push(error.message)); page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const [alpha, beta] = await connect(page);
  await expect(beta).toContainText("This Agent does not support session discovery.");
  await expect(beta.getByRole("button", { name: "Browse Agent history" })).toHaveCount(0);
  await alpha.getByText("Sign in", { exact: true }).click();
  await alpha.getByRole("button", { name: "Fixture login", exact: true }).click();
  await expect(alpha).toContainText("Authentication completed.");
  await alpha.getByRole("button", { name: "Browse Agent history" }).click();
  await expect(alpha.getByTitle("fixture-recent", { exact: true })).toBeVisible();
  await alpha.getByRole("button", { name: "Load more sessions" }).click();
  await expect(alpha.getByTitle("fixture-older", { exact: true })).toBeVisible();
  await expect(alpha.getByRole("button", { name: "Load more sessions" })).toHaveCount(0);
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const choice = alpha.getByTitle("fixture-older", { exact: true });
    await choice.scrollIntoViewIfNeeded(); await choice.focus(); await expect(choice).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`connection-${width}.png`), animations: "disabled" });
  }
  await alpha.getByTitle("fixture-older", { exact: true }).press("Enter");
  await expect(alpha.locator(".acp-turn-status")).toHaveText("Ready");
  await expect(alpha).toContainText("Loaded fixture session");
  await expect(alpha).toContainText("session:fixture-older");
  await alpha.locator(".acp-composer textarea").fill("one more turn");
  await alpha.locator(".acp-composer textarea").press("Enter");
  await expect(alpha).toContainText("turn:22 session:fixture-older");
  await beta.getByRole("button", { name: "Start new session" }).click();
  await expect(beta.locator(".acp-turn-status")).toHaveText("Ready");
  await alpha.getByRole("button", { name: "Close session", exact: true }).click();
  await beta.getByRole("button", { name: "Close session", exact: true }).click();
  const records = await Promise.all((await readdir(join(directory, "conversations"))).filter(name => name.endsWith(".json")).map(async name => JSON.parse(await readFile(join(directory, "conversations", name), "utf8"))));
  const record = records.find(item => item.snapshot.sessionId === "fixture-older");
  expect(record).toBeDefined();
  const methods = record.events.filter(item => item.event.type === "protocol-event" && item.event.direction === "Client → Agent").map(item => item.event.method);
  expect(methods.filter(method => method === "session/load")).toHaveLength(1);
  expect(methods).not.toContain("session/new");
  expect(errors).toEqual([]);
});

test("closing preparation releases the connection without creating a session", async ({ page }) => {
  const [alpha, beta] = await connect(page);
  await alpha.getByRole("button", { name: "Close session", exact: true }).click();
  await expect(alpha.locator(".acp-connection-panel")).toHaveCount(0);
  await expect(alpha.locator(".acp-composer")).toHaveCount(0);
  await beta.getByRole("button", { name: "Close session", exact: true }).click();
  await page.getByRole("button", { name: "New comparison", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "What should these Agents do?" })).toHaveValue("Continue the selected conversation");
});

test("Debugger returns failed session setup to authentication and retries the original prompt", async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${studio.url}/#/debugger`);
  const open = page.getByRole("button", { name: "Open Project", exact: true });
  await expect(open.or(page.getByRole("button", { name: "New live run" }))).toBeVisible();
  if (await open.isVisible()) await open.click();
  await page.getByRole("button", { name: "New live run" }).click();
  await page.getByRole("textbox", { name: "Task", exact: true }).fill("Retry my original prompt");
  await expect(page.getByRole("button", { name: "Choose session", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  const panel = page.locator(".acp-connection-panel");
  await expect(panel.getByRole("alert")).toBeVisible();
  await panel.getByRole("button", { name: "Fixture login", exact: true }).click();
  await expect(panel).toContainText("Authentication completed.");
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await panel.getByRole("button", { name: "Start new session" }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`debugger-connection-${width}.png`) });
  }
  await panel.getByRole("button", { name: "Start new session" }).click();
  await expect(page.locator(".acp-turn-status")).toHaveText("Ready");
  await expect(page.locator(".acp-session-events")).toContainText("Retry my original prompt");
  await page.getByRole("button", { name: "Close session", exact: true }).click();
  expect(errors).toEqual([]);
});
