import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { startHarnessStudioServer } from "../../dist/server/server.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let studio;
let workspace;

test.beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "studio-git-browser-"));
  git("init", "-b", "main");
  git("config", "user.name", "Studio Browser");
  git("config", "user.email", "browser@example.com");
  await writeFile(join(workspace, "README.md"), "# Commit view\n", "utf8");
  git("add", "README.md");
  git("commit", "-m", "docs: add commit view fixture", "-m", "The full body remains visible in details.");
  git("tag", "v1.0.0");
  for (let index = 1; index <= 41; index += 1) {
    git("commit", "--allow-empty", "-m", `chore: history page ${index}`);
  }
  git("switch", "-c", "feature/history-filter");
  await writeFile(join(workspace, "feature.ts"), "export const feature = true;\n", "utf8");
  git("add", "feature.ts");
  git("commit", "-m", "feat: add filtered branch commit");
  git("switch", "main");
  await mkdir(join(workspace, "docs"));
  await writeFile(join(workspace, "docs", "guide.md"), "Guide\n", "utf8");
  git("add", "docs/guide.md");
  git("commit", "-m", "docs: add main guide");
  git("merge", "--no-ff", "feature/history-filter", "-m", "merge: history fixture");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  studio = await startHarnessStudioServer({
    appDir: join(packageRoot, "dist", "app"),
    port: 0,
    workspaceDirectoryPicker: async () => workspace,
    workspaceSessionProvider: { discover: async () => ({ label: "commit-view-fixture", sessions: [] }) },
  });
  const opened = await fetch(`${studio.url}/api/workspace/open`, { method: "POST" });
  if (!opened.ok) throw new Error(`Could not open Git fixture: ${await opened.text()}`);
});

test.afterAll(async () => {
  await studio?.close();
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

test("browses refs, commits, changed files, and patches across Studio layouts", async ({ page }, testInfo) => {
  const failures = [];
  page.on("console", (message) => { if (message.type() === "error") failures.push(message.text()); });
  page.on("pageerror", (error) => failures.push(error.message));
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(`${studio.url}/#/commits`);
  await expect(page.getByRole("main", { name: "" }).filter({ has: page.getByText("Commit history", { exact: true }) })).toBeVisible();
  await expect(page.getByText("main", { exact: true }).first()).toBeVisible();
  const mergeRow = page.getByRole("row", { name: /merge: history fixture/ });
  await expect(mergeRow).toBeVisible();
  const mergeGraph = mergeRow.locator(".git-commit-graph");
  await expect(mergeGraph.locator("circle")).toHaveCount(2);
  const graphPalette = await mergeGraph.evaluate((svg) => {
    const node = svg.querySelector(".git-commit-node");
    const line = svg.querySelector("line");
    const resolveColor = (token) => {
      const sample = document.createElement("span");
      sample.style.color = `var(${token})`;
      document.body.append(sample);
      const color = getComputedStyle(sample).color;
      sample.remove();
      return color;
    };
    return { fill: getComputedStyle(node).fill, laneZero: resolveColor("--color-categorical-5"), primary: resolveColor("--color-primary"), lineOpacity: Number(getComputedStyle(line).opacity) };
  });
  expect(graphPalette.fill).toBe(graphPalette.laneZero);
  expect(graphPalette.fill).not.toBe(graphPalette.primary);
  expect(graphPalette.lineOpacity).toBeGreaterThanOrEqual(0.8);
  const featureRow = page.getByRole("row", { name: /feat: add filtered branch commit/ });
  await featureRow.click();
  await expect.poll(async () => featureRow.evaluate((row) => ({ background: getComputedStyle(row).backgroundColor, ring: getComputedStyle(row.querySelector(".git-commit-node")).stroke }))).toEqual(expect.objectContaining({ background: "rgb(20, 41, 74)", ring: "rgb(20, 41, 74)" }));
  await expect(page.getByText("Changed files", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /feature\.ts/ }).click();
  await expect(page.locator(".git-file-diff")).toContainText("export const feature");
  const diff = page.locator('.git-file-diff [data-artifact-code-view="diff"] [data-code-diff="pierre"]');
  await expect(diff).toHaveAttribute("data-file-count", "1");
  await expect(diff).toHaveAttribute("data-render-state", "ready");
  await expect(diff.locator("[data-line]").first()).toBeVisible();
  await expect.poll(async () => new Set(await diff.locator("[data-line] *").evaluateAll((elements) => elements.map((element) => getComputedStyle(element).color))).size).toBeGreaterThan(1);
  await page.screenshot({ path: testInfo.outputPath("git-history-wide.png"), fullPage: true });
  await page.getByRole("button", { name: /Dark theme active/ }).click();
  await expect(page.getByRole("button", { name: /Light theme active/ })).toBeVisible();
  await expect.poll(async () => featureRow.evaluate((row) => ({ background: getComputedStyle(row).backgroundColor, ring: getComputedStyle(row.querySelector(".git-commit-node")).stroke }))).toEqual(expect.objectContaining({ background: "rgb(227, 237, 253)", ring: "rgb(227, 237, 253)" }));
  await page.screenshot({ path: testInfo.outputPath("git-history-wide-light.png"), fullPage: true });
  await page.getByRole("button", { name: /Light theme active/ }).click();
  await expect(page.getByRole("button", { name: /Dark theme active/ })).toBeVisible();

  const commitTable = page.getByRole("table", { name: "Commits" });
  await expect(page.getByText("40 of 45 · More loads automatically", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Load more/ })).toHaveCount(0);
  let failNextPage = true;
  await page.route("**/api/git/log?*", async (route) => {
    if (failNextPage && new URL(route.request().url()).searchParams.has("cursor")) {
      failNextPage = false;
      await route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: "Git could not read this workspace.", code: "GIT_READ_FAILED" }) });
      return;
    }
    await route.continue();
  });
  const failedPage = page.waitForResponse((response) => response.url().includes("/git/log?") && response.url().includes("cursor=") && response.status() === 422);
  await commitTable.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  expect((await failedPage).status()).toBe(422);
  await expect(page.getByRole("alert")).toContainText("Previously loaded commits remain available.");
  await commitTable.evaluate((element) => { element.scrollTop = 0; });
  await expect(page.getByRole("row", { name: /feat: add filtered branch commit/ })).toBeVisible();
  await page.unroute("**/api/git/log?*");
  const nextPage = page.waitForResponse((response) => response.url().includes("/git/log?") && response.url().includes("cursor="));
  await page.getByRole("button", { name: "Retry loading history" }).click();
  expect((await nextPage).ok()).toBe(true);
  await expect(page.getByText(/More loads automatically/)).toHaveCount(0);
  await commitTable.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(page.getByRole("row", { name: /docs: add commit view fixture/ })).toBeVisible();
  expect(await page.locator(".git-commit-rows > button").count()).toBeLessThan(45);
  await commitTable.evaluate((element) => { element.scrollTop = 0; });

  const localGroup = page.getByRole("button", { name: /Local branches/ });
  await expect(localGroup).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: /feature\/history-filter/ }).click();
  await expect(page.getByRole("row", { name: /docs: add main guide/ })).toHaveCount(0);
  await expect(page.getByRole("row", { name: /feat: add filtered branch commit/ })).toBeVisible();
  await page.getByLabel("Filter commit history").fill("browser@example.com");
  await expect(page.getByRole("row", { name: /feat: add filtered branch commit/ })).toBeVisible();

  await page.setViewportSize({ width: 900, height: 760 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: testInfo.outputPath("git-history-compact.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  await expect(page.getByRole("navigation", { name: "Commit workbench panes" })).toBeVisible();
  await page.getByRole("button", { name: "Refs", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Repository refs" })).toBeVisible();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByRole("button", { name: "History", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "History", exact: true })).toHaveCSS("background-color", "rgb(20, 41, 74)");
  await expect(page.getByRole("button", { name: "Details", exact: true })).not.toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "Details", exact: true })).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(page.getByRole("region", { name: "Commit history" })).toBeVisible();
  await expect(page.locator(".git-commit-rows > button").first()).toContainText("feat: add filtered branch commit");
  const narrowTable = page.getByRole("table", { name: "Commits" });
  expect(await narrowTable.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("git-history-narrow.png"), fullPage: true });
  const expectedPageFailures = failures.filter((message) => message.includes("422 (Unprocessable Entity)"));
  expect(expectedPageFailures).toHaveLength(1);
  expect(failures.filter((message) => !expectedPageFailures.includes(message))).toEqual([]);
});

function git(...args) {
  return execFileSync("git", args, {
    cwd: workspace,
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
