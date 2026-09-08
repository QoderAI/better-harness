import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
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
let studio;
let workspace;

test.beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "studio-git-browser-"));
  git("init", "-b", "main");
  git("config", "user.name", "Studio Browser");
  git("config", "user.email", "browser@example.com");
  await writeFile(join(workspace, "README.md"), "# Commit view\n", "utf8");
  git("add", "README.md");
  authoredLongAgo("commit", "-m", "docs: add commit view fixture", "-m", "The full body remains visible in details.");
  git("tag", "v1.0.0");
  for (let index = 1; index <= 41; index += 1) {
    authoredLongAgo("commit", "--allow-empty", "-m", `chore: history page ${index}`);
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

/**
 * Resolves a colour token in the page, so an assertion can name the token it
 * depends on instead of restating one theme's literal value.
 */
async function resolvedToken(page, token) {
  return page.evaluate((name) => {
    const sample = document.createElement("span");
    sample.style.color = `var(${name})`;
    document.body.append(sample);
    const color = getComputedStyle(sample).color;
    sample.remove();
    return color;
  }, token);
}

/**
 * A selected commit row paints the selected-surface token, and its graph node
 * takes the same colour so the node reads as part of the row. Resolving the
 * token keeps this about that relationship rather than about one palette, so it
 * holds in either theme.
 */
async function expectSelectedRowCarriesItsGraphNode(page, row) {
  const selected = await resolvedToken(page, "--color-surface-selected");
  await expect.poll(async () => row.evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    ring: getComputedStyle(element.querySelector(".git-commit-node")).stroke,
  }))).toEqual({ background: selected, ring: selected });
}

test("browses refs, commits, changed files, and patches across Studio layouts", async ({ page }, testInfo) => {
  const failures = [];
  page.on("console", (message) => { if (message.type() === "error") failures.push(message.text()); });
  page.on("pageerror", (error) => failures.push(error.message));
  await page.setViewportSize({ width: 1440, height: 960 });
  // Studio follows the host appearance, so the theme flow below needs a known
  // starting point rather than whatever the runner's OS reports.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`${studio.url}/#/commits`);
  // One title: the window toolbar names the View, and the workbench opens with
  // panes only. The branch, the filter, and Refresh join that toolbar.
  await expect(page.getByRole("main", { name: "Commit history" })).toBeVisible();
  await expect(page.locator(".studio-context-bar").getByRole("heading", { name: "Commits" })).toBeVisible();
  await expect(page.locator(".studio-context-actions").getByLabel("Filter commit history")).toBeVisible();
  await expect(page.locator(".studio-context-actions").getByRole("button", { name: "Refresh Git history" })).toBeVisible();
  await expect(page.locator(".git-history-workbench").getByText("Repository evidence")).toHaveCount(0);
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
  await expectSelectedRowCarriesItsGraphNode(page, featureRow);
  await expect(page.getByText("Changed files", { exact: true })).toBeVisible();
  // The message is a caption over the file list, not a band across the pane, so
  // the patch owns the full height of the details column.
  const messagePane = page.locator(".git-commit-message");
  const diffPane = page.locator(".git-file-diff");
  await expect(messagePane).toContainText("feat: add filtered branch commit");
  expect(await messagePane.evaluate((element) => element.getBoundingClientRect().right <= element.parentElement.querySelector(".git-file-diff").getBoundingClientRect().left)).toBe(true);
  expect(await diffPane.evaluate((element) => {
    const grid = element.parentElement.getBoundingClientRect();
    return Math.round(element.getBoundingClientRect().height) === Math.round(grid.height);
  })).toBe(true);
  await page.getByRole("button", { name: /feature\.ts/ }).click();
  await expect(page.locator(".git-file-diff")).toContainText("export const feature");
  const diff = page.locator('.git-file-diff [data-artifact-code-view="diff"] [data-code-diff="pierre"]');
  await expect(diff).toHaveAttribute("data-file-count", "1");
  await expect(diff).toHaveAttribute("data-render-state", "ready");
  await expect(diff.locator("[data-line]").first()).toBeVisible();
  await expect.poll(async () => new Set(await diff.locator("[data-line] *").evaluateAll((elements) => elements.map((element) => getComputedStyle(element).color))).size).toBeGreaterThan(1);
  await page.screenshot({ path: testInfo.outputPath("git-history-wide.png"), fullPage: true });
  await useStudioSetting(page, () => page.getByRole("button", { name: /Dark theme active/ }).click());
  await useStudioSetting(page, () => expect(page.getByRole("button", { name: /Light theme active/ })).toBeVisible());
  await expectSelectedRowCarriesItsGraphNode(page, featureRow);
  await page.screenshot({ path: testInfo.outputPath("git-history-wide-light.png"), fullPage: true });
  await useStudioSetting(page, () => page.getByRole("button", { name: /Light theme active/ }).click());
  await useStudioSetting(page, () => expect(page.getByRole("button", { name: /Dark theme active/ })).toBeVisible());

  // Both dividers are real separators: keyboard operable, bounded, and reset by
  // double-click. The refs sash moves a width; the details sash moves a height.
  const refsPane = page.locator(".git-refs-pane");
  const refsSash = page.getByRole("separator", { name: "Resize the refs pane" });
  await expect(refsSash).toHaveAttribute("aria-valuenow", "220");
  await refsSash.press("Shift+ArrowRight");
  await expect.poll(async () => Math.round((await refsPane.boundingBox())?.width ?? 0)).toBe(252);
  await refsSash.press("Home");
  await expect.poll(async () => Math.round((await refsPane.boundingBox())?.width ?? 0)).toBe(160);
  await refsSash.dblclick();
  await expect.poll(async () => Math.round((await refsPane.boundingBox())?.width ?? 0)).toBe(220);
  const detailPane = page.locator(".git-detail-pane");
  const detailSash = page.getByRole("separator", { name: "Resize the commit details pane" });
  const detailHeight = Math.round((await detailPane.boundingBox())?.height ?? 0);
  await detailSash.press("Shift+ArrowUp");
  await expect.poll(async () => Math.round((await detailPane.boundingBox())?.height ?? 0)).toBe(detailHeight + 32);
  await detailSash.press("Home");
  await expect.poll(async () => Math.round((await refsPane.boundingBox())?.width ?? 0)).toBe(220);
  await expect(page.locator(".git-log-pane")).toBeVisible();
  await detailSash.dblclick();
  await expect.poll(async () => Math.round((await detailPane.boundingBox())?.height ?? 0)).toBe(detailHeight);

  // The message divider is bounded by the file list it sits above.
  const messageSash = page.getByRole("separator", { name: "Resize the commit message" });
  await expect(messageSash).toHaveAttribute("aria-valuenow", "132");
  await messageSash.press("Shift+ArrowDown");
  await expect.poll(async () => Math.round((await messagePane.boundingBox())?.height ?? 0)).toBe(164);
  await messageSash.press("Home");
  await expect.poll(async () => Math.round((await messagePane.boundingBox())?.height ?? 0)).toBe(64);
  await messageSash.press("End");
  await expect.poll(async () => Math.round((await page.locator(".git-changed-files").boundingBox())?.height ?? 0)).toBe(140);
  await messageSash.dblclick();
  await expect.poll(async () => Math.round((await messagePane.boundingBox())?.height ?? 0)).toBe(132);

  const commitTable = page.getByRole("grid", { name: "Commits" });
  // Paging is silent: the log reports failure and retry, never a running count.
  await expect(page.getByText(/More loads automatically/)).toHaveCount(0);
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
  await commitTable.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(page.getByRole("row", { name: /docs: add commit view fixture/ })).toBeVisible();
  expect(await page.locator(".git-commit-rows > button").count()).toBeLessThan(45);
  await commitTable.evaluate((element) => { element.scrollTop = 0; });

  const localGroup = page.getByRole("button", { name: /Local branches/ });
  await expect(localGroup).toHaveAttribute("aria-expanded", "true");
  const featureRef = page.locator('.git-ref-row[title="refs/heads/feature/history-filter"]');
  const mainRef = page.locator('.git-ref-row[title="refs/heads/main"]');
  const refsTrailing = page.locator(".git-refs-pane .git-pane-header span");
  await featureRef.click();
  await expect(featureRef).toHaveAttribute("aria-pressed", "true");
  await expect(refsTrailing).toHaveText("feature/history-filter");
  await expect(page.getByRole("row", { name: /docs: add main guide/ })).toHaveCount(0);
  await expect(page.getByRole("row", { name: /feat: add filtered branch commit/ })).toBeVisible();
  // Refs are single-select: choosing another ref replaces the filter instead of
  // adding to it, so exactly one row stays pressed and the log follows that ref.
  await mainRef.click();
  await expect(mainRef).toHaveAttribute("aria-pressed", "true");
  await expect(featureRef).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator('.git-ref-row[aria-pressed="true"]')).toHaveCount(1);
  await expect(page.getByRole("row", { name: /docs: add main guide/ })).toBeVisible();
  // Clicking the selected ref again returns the log to every ref, and so does
  // the pane header's clear control.
  await mainRef.click();
  await expect(page.locator('.git-ref-row[aria-pressed="true"]')).toHaveCount(0);
  await expect(refsTrailing).toHaveText("All");
  await mainRef.click();
  await page.getByRole("button", { name: "Show commits from all refs" }).click();
  await expect(page.locator('.git-ref-row[aria-pressed="true"]')).toHaveCount(0);
  await expect(refsTrailing).toHaveText("All");
  await featureRef.click();
  await expect(page.getByRole("row", { name: /feat: add filtered branch commit/ })).toBeVisible();
  await page.getByLabel("Filter commit history").fill("browser@example.com");
  await expect(page.getByRole("row", { name: /feat: add filtered branch commit/ })).toBeVisible();

  await page.setViewportSize({ width: 900, height: 760 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: testInfo.outputPath("git-history-compact.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  // Stacked panes have nothing to divide, so both sashes leave the layout.
  await expect(refsSash).toBeHidden();
  await expect(detailSash).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Commit workbench panes" })).toBeVisible();
  await page.getByRole("button", { name: "Refs", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Repository refs" })).toBeVisible();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByRole("button", { name: "History", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "History", exact: true })).toHaveCSS("background-color", await resolvedToken(page, "--color-surface-selected"));
  await expect(page.getByRole("button", { name: "Details", exact: true })).not.toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "Details", exact: true })).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(page.getByRole("region", { name: "Commit history" })).toBeVisible();
  await expect(page.locator(".git-commit-rows > button").first()).toContainText("feat: add filtered branch commit");
  const narrowTable = page.getByRole("grid", { name: "Commits" });
  expect(await narrowTable.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("git-history-narrow.png"), fullPage: true });
  const expectedPageFailures = failures.filter((message) => message.includes("422 (Unprocessable Entity)"));
  expect(expectedPageFailures).toHaveLength(1);
  expect(failures.filter((message) => !expectedPageFailures.includes(message))).toEqual([]);
});

/**
 * A window that excludes the loaded page is not the end of the log.
 *
 * Switching Project remounts the View, so it opens on one page of the new
 * repository's newest commits. When the shared window excludes them the pane used
 * to end at "Nothing in this window" with no way forward, which is what a reader
 * hits after switching to a Project whose work is older than the window. The
 * window is reached by paging when it sits deeper, and named honestly when it
 * does not.
 */
test("reaches a window that sits deeper in the history, and names one it cannot reach", async ({ page }, testInfo) => {
  // Two repositories of ~50 commits each are built with one `git` process per
  // commit, which alone outlasts the default per-test budget.
  test.setTimeout(180_000);
  const failures = [];
  page.on("console", (message) => { if (message.type() === "error") failures.push(message.text()); });
  page.on("pageerror", (error) => failures.push(error.message));
  const fresh = await mkdtemp(join(tmpdir(), "studio-git-fresh-"));
  const stale = await mkdtemp(join(tmpdir(), "studio-git-stale-"));
  // `fresh` keeps a full page of commits newer than a middle band, so a window on
  // that band sits one page deeper than the first request returns. `stale` has no
  // commit newer than 2020, so `Today` is a window it can never reach.
  for (let index = 1; index <= 6; index += 1) commitInto(stale, `chore: stale ${index}`, "2020-06-15T04:05:06+00:00");
  for (let index = 1; index <= 46; index += 1) commitInto(stale, `chore: archived ${index}`, "2020-01-02T03:04:05+00:00");
  for (let index = 1; index <= 6; index += 1) commitInto(fresh, `chore: middle band ${index}`, "2020-06-15T04:05:06+00:00");
  for (let index = 1; index <= 45; index += 1) commitInto(fresh, `chore: recent ${index}`);
  const pickers = [fresh, stale];
  const paged = await startHarnessStudioServer({
    appDir: join(packageRoot, "dist", "app"),
    port: 0,
    workspaceDirectoryPicker: async () => pickers.shift(),
    // The Project label comes from discovery, so it names the fixture directory
    // and the switcher can be driven by which repository a row points at.
    workspaceSessionProvider: { discover: async (directory) => ({ label: basename(directory), sessions: [] }) },
  });
  try {
    for (const label of ["fresh", "stale"]) {
      const opened = await fetch(`${paged.url}/api/workspace/open`, { method: "POST" });
      if (!opened.ok) throw new Error(`Could not open the ${label} fixture: ${await opened.text()}`);
    }
    const pages = [];
    page.on("request", (request) => { if (request.url().includes("/api/git/log?")) pages.push(request.url()); });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(`${paged.url}/#/commits`);
    const rows = page.locator(".git-commit-rows > button");
    const emptyWindow = page.locator(".git-empty-window");
    const window = page.getByLabel("Observation window");
    await expect(rows.first()).toContainText("chore: archived 46");

    // The active Project's whole history predates `Today`. The window cannot be
    // reached by paging, so the pane says what it loaded instead of paging on.
    pages.length = 0;
    await window.selectOption("today");
    await expect(emptyWindow).toBeVisible();
    await expect(emptyWindow).toContainText(/None of the 40 commits loaded so far/);
    await expect(emptyWindow).toContainText(/The newest is from/);
    await page.waitForTimeout(700);
    expect(pages).toHaveLength(0);
    // The deeper history is still reachable rather than a dead end.
    await expect(page.getByRole("button", { name: /Load older commits/ })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("git-history-window-unreachable.png"), fullPage: true });

    // Switching Project under the same window finds that Project's commits.
    await page.locator(".studio-project-switcher > button").click();
    await page.getByRole("menuitemradio", { name: /fresh/ }).click();
    await expect.poll(async () => rows.count()).toBeGreaterThan(0);
    await expect(rows.first()).toContainText("chore: recent 45");
    await expect(emptyWindow).toHaveCount(0);

    // A window one page deeper than the first request is paged to, not reported
    // as empty: exactly one further page, and then the band appears.
    pages.length = 0;
    await window.selectOption("custom");
    await page.getByLabel("From", { exact: true }).fill("2020-06-14");
    await page.getByLabel("To", { exact: true }).fill("2020-06-16");
    await expect.poll(async () => rows.count()).toBe(6);
    await expect(rows.first()).toContainText("chore: middle band 6");
    await expect(emptyWindow).toHaveCount(0);
    await page.waitForTimeout(700);
    expect(pages).toHaveLength(1);

    expect(failures).toEqual([]);
  } finally {
    await paged.close();
    await rm(fresh, { recursive: true, force: true });
    await rm(stale, { recursive: true, force: true });
  }
});

/** Commits an empty change into a fixture repository, initialising it on demand. */
function commitInto(directory, message, authoredAt) {
  const run = (...args) => execFileSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C", ...(authoredAt === undefined ? {} : { GIT_AUTHOR_DATE: authoredAt }) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!existsSync(join(directory, ".git"))) {
    run("init", "-b", "main");
    run("config", "user.name", "Studio Browser");
    run("config", "user.email", "browser@example.com");
    run("config", "commit.gpgsign", "false");
  }
  run("commit", "--allow-empty", "--no-verify", "-m", message);
}

function git(...args) {
  return runGit(args, {});
}

/**
 * Backdates a commit's author date while leaving its committer date at now.
 *
 * The date window filters on the author date the log displays, so this is how a
 * fixture reproduces the reader's situation: a full page of history of which
 * only the newest few commits fall inside `Today`. The committer date is left
 * alone so `--date-order` keeps the order the other assertions rely on.
 */
function authoredLongAgo(...args) {
  return runGit(args, { GIT_AUTHOR_DATE: "2020-01-02T03:04:05+00:00" });
}

function runGit(args, env) {
  return execFileSync("git", args, {
    cwd: workspace,
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
