import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { startHarnessStudioServer } from "../../dist/server/server.js";

/**
 * Appearance and language live in a pop-up at the bottom of the sidebar. At or
 * below the 1080px breakpoint that sidebar is an overlay, so Settings is only
 * reachable while it is open and it must be put back afterwards: left open it
 * intercepts clicks meant for the workbench.
 */
async function useStudioSetting(page, action) {
  const overlay = (page.viewportSize()?.width ?? 1280) <= 1080;
  if (overlay) await page.locator(".studio-nav-toggle").click();
  const toggle = page.locator(".studio-settings-toggle");
  await toggle.waitFor({ state: "visible" });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await action();
  if ((await toggle.getAttribute("aria-expanded")) === "true") await toggle.click();
  if (overlay) await page.locator(".studio-project-close").click();
}


const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

let sourceStudio;

test.beforeAll(async () => {
  sourceStudio = await startHarnessStudioServer({
    appDir: join(packageRoot, "dist", "app"),
    port: 0,
  });
});

let browserErrors;
let origin;

test.beforeEach(async ({ page }) => {
  origin = `${sourceStudio.url}/#/sessions`;
  browserErrors = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(`console: ${message.text()}`); });
  page.on("pageerror", (error) => browserErrors.push(`page: ${error.message}`));
  await page.goto(origin);
});

test("boots in English by default without a stored preference", async ({ page }) => {
  await expect(page.locator(".studio-context-title h1")).toHaveText("Sessions");
  await expect(page.locator(".studio-primary-nav")).toContainText("Sessions");
  await useStudioSetting(page, () => expect(page.locator(".studio-language-toggle")).toContainText("EN"));
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(browserErrors).toEqual([]);
});

test("switches the whole UI to Simplified Chinese in place and persists the choice", async ({ page }) => {
  await useStudioSetting(page, () => page.locator(".studio-language-toggle").click());
  await expect(page.locator(".studio-context-title h1")).toHaveText("会话");
  await useStudioSetting(page, () => expect(page.locator(".studio-language-toggle")).toContainText("中文"));
  await expect(page.locator(".studio-primary-nav")).toContainText("会话");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  expect(browserErrors).toEqual([]);

  await page.reload();
  await expect(page.locator(".studio-context-title h1")).toHaveText("会话");

  // Overriding the stored preference back to English is honoured after reload.
  await page.evaluate(() => localStorage.setItem("harness-studio-language", "en"));
  await page.reload();
  await expect(page.locator(".studio-context-title h1")).toHaveText("Sessions");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(browserErrors).toEqual([]);
});

test("switches back to English", async ({ page }) => {
  await useStudioSetting(page, () => page.locator(".studio-language-toggle").click());
  await expect(page.locator(".studio-context-title h1")).toHaveText("会话");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await useStudioSetting(page, () => page.locator(".studio-language-toggle").click());
  await expect(page.locator(".studio-context-title h1")).toHaveText("Sessions");
});

test("auto-detects a Chinese browser language without a stored preference", async ({ browser }) => {
  const context = await browser.newContext({ locale: "zh-CN" });
  const page = await context.newPage();
  await page.goto(origin);
  await expect(page.locator(".studio-context-title h1")).toHaveText("会话");
  await context.close();
});
