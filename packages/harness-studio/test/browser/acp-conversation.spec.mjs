import { mkdtemp, rm, cp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { expect, test } from "@playwright/test";
import { startHarnessStudioServer } from "../../dist/server/server.js";
let studio, directory;
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "acp-conversation-"));
  await cp(resolve("dist/app"), join(directory, "app"), { recursive: true });
  const agent = { command: process.execPath, args: [resolve("../harness/test/fixtures/acp-agent.mjs"), "--conversation", "--session-controls", ...(process.env.STUDIO_TEST_RECOVERY_FALLBACK ? ["--no-recovery"] : []), ...(process.env.STUDIO_TEST_RECOVERY_REJECT ? ["--reject-recovery"] : [])], label: "Alpha ACP" };
  studio = await startHarnessStudioServer({ appDir: join(directory, "app"), runDirectory: directory,
    ...(process.env.STUDIO_TEST_ACP_HOST ? { acpHostExecutable: process.env.STUDIO_TEST_ACP_HOST } : {}),
    ...(process.env.STUDIO_TEST_ACP_TRANSPORT ? { acpHostTransport: process.env.STUDIO_TEST_ACP_TRANSPORT } : {}),
    workspaceDirectoryPicker: async () => resolve("."), workspaceSessionProvider: { discover: async () => ({ label: "Conversation fixture", sessions: [] }) },
    acpAgent: agent, acpAgents: [{ id: "alpha", label: "Alpha ACP", agent }, { id: "beta", label: "Beta ACP", agent }],
  });
});
test.afterAll(async () => { await studio?.close(); await rm(directory, { recursive: true, force: true }); });
async function start(page, prompt = "first") {
  await page.goto(`${studio.url}/#/compare`);
  const open = page.getByRole("button", { name: "Open Project", exact: true });
  await expect(open.or(page.getByRole("textbox", { name: "What should these Agents do?" }))).toBeVisible();
  if (await open.isVisible()) await open.click();
  await page.getByRole("textbox", { name: "What should these Agents do?" }).fill(prompt);
  await page.getByRole("button", { name: /^Choose Agents/ }).click();
  for (const name of ["Alpha ACP", "Beta ACP"]) await page.getByRole("menuitemcheckbox", { name: new RegExp(name) }).click();
  await page.keyboard.press("Escape");
  // Agent settings prepare inline in the shared composer; Run is the only
  // transition that creates message lanes and dispatches the initial prompt.
  await page.getByRole("button", { name: "Run 2 Agents", exact: true }).click();
  const lanes = page.locator(".live-compare-lane");
  return [lanes.nth(0), lanes.nth(1)];
}
const draft = lane => lane.locator(".acp-composer textarea");
const ready = lane => expect(lane.locator(".acp-turn-status")).toHaveText("Ready");
test("three turns reuse a session, preserve per-lane drafts across navigation and save each turn", async ({ page }, info) => {
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  const [alpha, beta] = await start(page);
  await ready(alpha); await ready(beta);
  await draft(beta).fill("beta private draft");
  await alpha.getByRole("combobox", { name: "Model", exact: true }).selectOption("fixture-candidate");
  for (const [number, text] of [[2, "second"], [3, "third"]]) {
    await draft(alpha).fill(text); await draft(alpha).press("Enter"); await ready(alpha);
    await expect(alpha).toContainText(`turn:${number} session:fixture-session`);
  }
  await expect(beta).not.toContainText("turn:2");
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(draft(beta)).toHaveValue("beta private draft");
  await expect(alpha).toContainText("turn:3");
  const records = await Promise.all((await readdir(join(directory, "conversations"))).filter(name => name.endsWith(".json")).map(async name => JSON.parse(await readFile(join(directory, "conversations", name), "utf8"))));
  const record = records.find(item => item.snapshot.turns.length === 3);
  expect(record.snapshot.turns.map(turn => turn.stopReason)).toEqual(["end_turn", "end_turn", "end_turn"]);
  expect(record.events.filter(item => item.event.type === "protocol-event" && item.event.direction === "Client → Agent" && item.event.method === "session/new")).toHaveLength(1);
  const prompts = record.events.filter(item => item.event.type === "protocol-event" && item.event.direction === "Client → Agent" && item.event.method === "session/prompt");
  expect(prompts).toHaveLength(3);
  expect(prompts[1].event.payload.params.prompt).toEqual([{ type: "text", text: "second" }]);
  for (const size of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size); await page.emulateMedia({ reducedMotion: "reduce" });
    await draft(alpha).scrollIntoViewIfNeeded(); await draft(alpha).focus();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ animations: "disabled", path: info.outputPath(`conversation-${size.width}.png`) });
  }
  await alpha.getByRole("button", { name: "Close session", exact: true }).click();
  await beta.getByRole("button", { name: "Close session", exact: true }).click();
  expect(errors).toEqual([]);
});
test("queue edit/remove, cancel all permissions, pause queue, immediately send and continue", async ({ page }) => {
  const [alpha, beta] = await start(page, "wait permission");
  await expect(alpha.getByRole("button", { name: "Allow", exact: true })).toHaveCount(2);
  await draft(alpha).fill("queued later"); await draft(alpha).press("Enter");
  await expect(alpha.locator(".acp-message-queue")).toContainText("queued later");
  await alpha.getByRole("button", { name: "Edit", exact: true }).click();
  await draft(alpha).fill("edited later"); await draft(alpha).press("Enter");
  await alpha.getByRole("button", { name: "Stop", exact: true }).click(); await ready(alpha);
  await expect(alpha.getByRole("button", { name: "Allow", exact: true })).toHaveCount(0);
  await expect(alpha.locator(".acp-message-queue")).toContainText("edited later");
  await alpha.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(alpha.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  await expect(alpha.locator(".acp-message-queue")).toHaveCount(0);
  await draft(alpha).fill("wait again");
  await expect(alpha.getByRole("button", { name: "Send", exact: true })).toBeEnabled(); await draft(alpha).press("Enter");
  await expect(alpha).toContainText("turn:2");
  await draft(alpha).fill("immediate"); await alpha.getByRole("button", { name: "Send now", exact: true }).click();
  await ready(alpha); await expect(alpha).toContainText("turn:3");
  await beta.getByRole("button", { name: "Stop", exact: true }).click(); await ready(beta);
  await alpha.getByRole("button", { name: "Close session", exact: true }).click();
  await beta.getByRole("button", { name: "Close session", exact: true }).click();
});

test("attachments, IME, commands, rejected submissions and read-only history", async ({ page }) => {
  const [alpha, beta] = await start(page);
  await ready(alpha); await ready(beta);
  const input = draft(alpha);
  await input.fill("中文");
  await input.dispatchEvent("keydown", { key: "Enter", isComposing: true, keyCode: 229 });
  await expect(input).toHaveValue("中文"); await expect(alpha).not.toContainText("turn:2");
  await input.press("Shift+Enter"); await expect(input).toHaveValue("中文\n");
  await input.fill("/rev"); await input.press("ArrowDown"); await input.press("Tab");
  await expect(input).toHaveValue("/review ");
  await input.fill("/review HEAD");
  await alpha.locator('input[type="file"]').setInputFiles({ name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("context evidence") });
  await expect(alpha.locator(".acp-attachments")).toContainText("note.txt");
  await alpha.locator(".acp-attachments button").click(); await expect(alpha.locator(".acp-attachments")).toHaveCount(0);
  await alpha.locator('input[type="file"]').setInputFiles({ name: "pixel.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0xkAAAAASUVORK5CYII=", "base64") });
  let rejected = false;
  await page.route("**/api/acp/runs/*/session", route => {
    if (!rejected && route.request().postDataJSON().action === "send") { rejected = true; return route.fulfill({ status: 400, json: { error: "Agent rejected prompt; retry" } }); }
    return route.continue();
  });
  await expect(alpha.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
  await input.press("Enter"); await expect(alpha.getByRole("alert")).toContainText("retry");
  await expect(input).toHaveValue("/review HEAD"); await expect(alpha.locator(".acp-attachments li")).toHaveCount(1);
  await input.press("Enter"); await ready(alpha); await expect(alpha).toContainText("turn:2 session:fixture-session blocks:2");
  await alpha.getByRole("button", { name: "Close session", exact: true }).click();
  await beta.getByRole("button", { name: "Close session", exact: true }).click();
  await page.reload();
  await page.locator(".acp-conversation-history > summary").click();
  await page.locator(".acp-history-list button").first().click();
  await expect(page.locator(".acp-history-transcript .acp-session-events")).toContainText("turn:");
  await expect(page.locator(".acp-history-transcript .acp-composer textarea")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Message after recovery" }).fill("restored turn");
  await page.getByRole("button", { name: "Recover and send", exact: true }).click();
  if (process.env.STUDIO_TEST_RECOVERY_REJECT) {
    await expect(page.locator(".acp-conversation-history > [role=alert]")).toContainText("Internal error");
    await expect(page.getByRole("textbox", { name: "Message after recovery" })).toHaveValue("restored turn");
    await expect(page.locator(".acp-history-transcript .acp-composer textarea")).toHaveCount(0);
    return;
  }
  if (!process.env.STUDIO_TEST_RECOVERY_FALLBACK) await expect(page.locator(".acp-history-transcript")).toContainText("Loaded fixture session");
  await expect(page.locator(".acp-history-transcript")).toContainText(`turn:${process.env.STUDIO_TEST_RECOVERY_FALLBACK ? 31 : 21} session:fixture-session`);
  await page.getByRole("button", { name: "Close session", exact: true }).click();
});

test("long transcript preserves reading and expanded tool state across view changes", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const [alpha, beta] = await start(page, "long transcript");
  await ready(alpha); await ready(beta);
  await expect(alpha.locator(".acp-session-events > li")).toHaveCount(253);
  const scroll = alpha.locator(".acp-session-scroll");
  await scroll.evaluate(node => { node.scrollTop = 0; });
  await expect(alpha.getByRole("button", { name: "Back to latest" })).toBeVisible();
  await alpha.locator(".acp-activity-header").click();
  await alpha.locator(".tool-card > .ai-tool-header").click();
  await expect(alpha.locator(".tool-card")).toHaveAttribute("data-state", "open");
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(alpha.locator(".tool-card")).toHaveAttribute("data-state", "open");
  expect(await scroll.evaluate(node => node.scrollTop)).toBeLessThan(500);
  await draft(alpha).fill("next"); await draft(alpha).press("Enter"); await ready(alpha);
  await expect.poll(() => scroll.evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThanOrEqual(24);
  // A 200% desktop zoom is equivalent to halving the CSS viewport.
  await page.setViewportSize({ width: 720, height: 450 });
  await alpha.locator(".acp-session-settings > summary").click();
  await alpha.getByRole("searchbox").focus(); await page.keyboard.press("Escape");
  await expect(alpha.locator(".acp-session-settings > summary")).toBeFocused();
  for (const lane of [alpha, beta]) {
    const model = lane.getByRole("combobox", { name: "Model", exact: true });
    await model.scrollIntoViewIfNeeded();
    const box = await model.boundingBox(); expect(box.y + box.height).toBeLessThanOrEqual(450);
  }
  await page.screenshot({ animations: "disabled", path: info.outputPath("conversation-200percent.png") });
  await alpha.getByRole("button", { name: "Close session", exact: true }).click();
  await beta.getByRole("button", { name: "Close session", exact: true }).click();
});

test("prompt completions preserve caret, IME and drafts; Streamdown formats before completion", async ({ page }, info) => {
  const errors = [], remoteRequests = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", request => { if (request.url().includes("example.com")) remoteRequests.push(request.url()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  const [alpha, beta] = await start(page, "markdown composer fixture");
  const response = alpha.locator(".ai-message-response").filter({ hasText: "Composer review" });
  await expect(response.getByRole("heading", { name: "Composer review" })).toBeVisible();
  await expect(response.locator("strong").filter({ hasText: "重点" })).toBeVisible();
  await expect(response.getByRole("cell", { name: "Ready", exact: true })).toBeVisible();
  await expect(response.locator(".highlighted-code")).toHaveText("const ready = true;");
  await expect(response.locator(".highlighted-code")).toHaveAttribute("data-highlight-state", "highlighted");
  await expect(alpha.locator('.streaming-message[aria-busy=true]').filter({ hasText: 'Composer review' })).toHaveCount(1);
  expect(await page.evaluate(() => window.fixtureInjected)).toBeUndefined();
  await expect(response.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(response.locator("img,script")).toHaveCount(0);
  await expect(response.getByRole("link", { name: "Docs", exact: true })).toHaveAttribute("rel", "noreferrer noopener");
  expect(remoteRequests).toEqual([]);
  const input = draft(alpha);
  await input.fill("Inspect @src later");
  await input.evaluate(node => node.setSelectionRange(12, 12));
  await expect(alpha.getByRole("listbox", { name: "Session files" })).toBeVisible();
  await expect(alpha.getByRole("option").first()).toContainText("src/composer.tsx");
  await input.press("Tab");
  await expect(input).toHaveValue("Inspect @src/composer.tsx later");
  await expect(beta.locator('.acp-composer textarea')).toHaveValue("");
  await input.fill("Earlier text\n/rev HEAD");
  await input.evaluate(node => node.setSelectionRange(17, 17));
  await expect(alpha.getByRole("listbox", { name: "Commands" })).toBeVisible();
  const activeId = await input.getAttribute("aria-activedescendant");
  expect(await page.locator(`[id="${activeId}"]`).getAttribute("aria-selected")).toBe("true");
  await input.dispatchEvent("compositionstart");
  await input.dispatchEvent("keydown", { key: "Enter", keyCode: 229, isComposing: true });
  await expect(input).toHaveValue("Earlier text\n/rev HEAD");
  await input.dispatchEvent("compositionend");
  await input.fill("/rev"); await input.press("Escape");
  await expect(alpha.getByRole("listbox")).toHaveCount(0);
  await input.fill("/review"); await input.press("ArrowUp"); await input.press("Enter");
  await expect(input).toHaveValue("/review ");
  await input.fill("/re"); await input.press("ArrowDown");
  await expect(alpha.getByRole('listbox', { name: 'Commands' }).getByRole('option', { selected: true })).toContainText('/refactor');
  await input.press('Tab'); await expect(input).toHaveValue('/refactor ');
  await input.fill('/re'); await alpha.getByRole('option').filter({ hasText: '/review' }).click();
  await expect(input).toHaveValue('/review '); await expect(input).toBeFocused();
  await expect(alpha.locator(".acp-message-queue")).toHaveCount(0);
  await input.fill("/nothing"); await expect(alpha.getByRole("status").filter({ hasText: "No matching" })).toBeVisible();
  await input.press("Escape");
  await input.fill(Array.from({ length: 30 }, (_, index) => `Line ${index}`).join("\n"));
  expect(await input.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  await input.fill("/rev");
  for (const [name, width, height] of [["wide", 1440, 900], ["compact", 1024, 768], ["narrow", 390, 844]]) {
    await page.setViewportSize({ width, height });
    await input.scrollIntoViewIfNeeded(); await input.focus();
    await expect(alpha.getByRole("listbox", { name: "Commands" })).toBeVisible();
    const bounds = await alpha.locator(".ai-prompt-suggestions").boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1); expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await alpha.locator(".ai-prompt-input").evaluate(node => getComputedStyle(node).outlineStyle)).toBe("solid");
    for (const theme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.screenshot({ animations: "disabled", path: info.outputPath(`composer-${name}-${theme}.png`) });
    }
  }
  await input.press("Escape"); await input.fill("");
  await alpha.getByRole("button", { name: "Finish Markdown", exact: true }).click();
  await beta.getByRole("button", { name: "Finish Markdown", exact: true }).click();
  await ready(alpha); await ready(beta);
  await expect(response.locator("strong").filter({ hasText: "Finished." })).toHaveCount(1);
  await expect(response.locator(".highlighted-code")).toHaveText("const ready = true;");
  // Dropping a text file follows the same ACP attachment path as selection and paste.
  await alpha.locator(".ai-prompt-input").evaluate(node => {
    const dataTransfer = new DataTransfer(); dataTransfer.items.add(new File(["drop evidence"], "drop.txt", { type: "text/plain" }));
    node.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
  });
  await expect(alpha.locator(".acp-attachments")).toContainText("drop.txt");
  await input.fill("@drop"); await input.press("Enter"); await expect(input).toHaveValue("@drop.txt ");
  await input.fill("attachment request"); await input.press("Enter"); await ready(alpha);
  await expect(alpha).toContainText("turn:2 session:fixture-session blocks:2");
  await alpha.getByRole("button", { name: "Close session", exact: true }).click();
  await beta.getByRole("button", { name: "Close session", exact: true }).click();
  expect(errors).toEqual([]);
});
