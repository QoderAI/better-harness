import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { HarnessRunEmitter, MAX_RETAINED_TOOL_RESULT_BYTES } from "@qoder-ai/harness/exec";
import { startHarnessStudioServer } from "../../dist/server/server.js";

const SOURCE = `
  language 0.3
  skill require-tests {
    description "Do not report the task complete until tests prove it."
  }
  workflow single-pass {
    session coder
  }
  harness browser-fixture {
    workflow single-pass
    agent coder {
      use skill require-tests
    }
  }
  runtime qoder {
    adapter "@harness/adapter-qoder"
  }
  deployment browser-fixture-qoder {
    harness browser-fixture
    runtime qoder
  }
`;

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let studio;
let experimentStudio;
let inspectorStudio;
let lockedFixtureDir;
let inspectorFixtureDir;
let runsFixtureDir;
let artifactFixtureDir;

const LAYOUTS = [
  { name: "wide", width: 1440, height: 900 },
  { name: "compact", width: 1024, height: 768 },
  { name: "narrow", width: 390, height: 844 },
];

async function openDestination(page, label) {
  const quickAction = page.getByRole("button", { name: `Go to ${label}` });
  if (await quickAction.isVisible().catch(() => false) && await quickAction.isEnabled()) {
    await quickAction.click();
    return;
  }
  const destination = page.getByRole("navigation", { name: "Harness control plane" }).getByRole("button", { name: new RegExp(`^${label}`) });
  const toggle = page.getByRole("button", { name: "Open Studio navigation" });
  if (await toggle.isVisible() && await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  await destination.click();
  if (await toggle.isVisible()) {
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".studio-primary-nav")).not.toBeInViewport();
  }
}

async function assertRenderedContract(page) {
  const contract = await page.evaluate(() => {
    const directText = (element) => [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
    const visible = (element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    };
    const belowFloor = [...document.body.querySelectorAll("*")]
      .filter((element) => directText(element) && visible(element))
      .map((element) => ({ tag: element.tagName, className: element.className, size: Number.parseFloat(getComputedStyle(element).fontSize), text: element.textContent?.trim().slice(0, 60) }))
      .filter((entry) => entry.size < 12);
    const dockedShadows = [...document.querySelectorAll(".studio-context-bar,.studio-primary-nav,.control-lead,.control-panel,.input-readiness,.builder-primary,.builder-setup,.notebook-context,.notebook-cell-card,.experiment-rail,.execution-tree,.session-notebook,.session-catalog-pane,.state-inspector,.decision-summary,.evidence-table-pane")]
      .filter(visible)
      .map((element) => ({ className: element.className, shadow: getComputedStyle(element).boxShadow }))
      .filter((entry) => entry.shadow !== "none");
    return {
      innerWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyFont: getComputedStyle(document.body).fontFamily,
      belowFloor,
      dockedShadows,
      visibleSurfaceSwitchers: [...document.querySelectorAll('[aria-label="Compare surfaces"]')].filter(visible).length,
      ownedStyleSheets: [...document.styleSheets].filter((sheet) => sheet.href?.includes("/assets/") && sheet.href.endsWith(".css")).length,
    };
  });
  expect(contract.documentWidth).toBe(contract.innerWidth);
  expect(contract.bodyFont).not.toContain("Inter");
  expect(contract.belowFloor).toEqual([]);
  expect(contract.dockedShadows).toEqual([]);
  expect(contract.visibleSurfaceSwitchers).toBeLessThanOrEqual(1);
  expect(contract.ownedStyleSheets).toBe(3);
}

test.beforeAll(async () => {
  runsFixtureDir = await mkdtemp(join(tmpdir(), "studio-browser-runs-"));
  artifactFixtureDir = await mkdtemp(join(tmpdir(), "studio-browser-artifacts-"));
  await writeFile(join(artifactFixtureDir, "actual-run-output.json"), '{"status":"retained"}\n', "utf8");
  studio = await startHarnessStudioServer({
    appDir: resolve(packageRoot, "dist/app"),
    harnessSource: SOURCE,
    runDirectory: join(runsFixtureDir, "live"),
    artifactDirectory: artifactFixtureDir,
    executorFactory: (context) => ({
      host: "qoder",
      async execute(revision) {
        const emitter = new HarnessRunEmitter(context.onRunEvent);
        emitter.start({ revisionId: revision.revisionId, host: "qoder" });
        emitter.text("Running the browser regression.");
        emitter.toolCall("Bash", { toolUseId: "tu_failed", input: { command: "npm test" } });
        emitter.toolResult(
          "tu_failed",
          `command failed\n${"x".repeat(MAX_RETAINED_TOOL_RESULT_BYTES + 1_024)}`,
          { messageId: "result_failed", isError: true },
        );
        emitter.finish(0);
        return {
          host: "qoder",
          revisionId: revision.revisionId,
          exitCode: 0,
          output: "Running the browser regression.",
          errorOutput: "",
          warnings: [],
        };
      },
    }),
  });
  inspectorFixtureDir = await mkdtemp(join(tmpdir(), "studio-browser-inspector-"));
  const inspectorReportPath = join(inspectorFixtureDir, "inspector.html");
  const alternateInspectorReportPath = join(inspectorFixtureDir, "alternate-inspector.html");
  await writeFile(inspectorReportPath, "<!doctype html><title>Inspector fixture</title><main><h1>Delivery evidence workbench</h1><p>Read-only retained evidence.</p></main>", "utf8");
  await writeFile(alternateInspectorReportPath, "<!doctype html><title>Inspector fixture</title><main><h1>Alternate evidence workbench</h1><p>Switched retained evidence.</p></main>", "utf8");
  inspectorStudio = await startHarnessStudioServer({
    appDir: resolve(packageRoot, "dist/app"),
    inspectorReportPath,
    sourceCatalog: [{ id: "inspector_alt", kind: "inspector", label: "Alternate Inspector", path: alternateInspectorReportPath }],
  });
  lockedFixtureDir = await mkdtemp(join(tmpdir(), "studio-browser-lock-"));
  await cp(resolve(packageRoot, "../harness/examples/checkpoint-experiment"), lockedFixtureDir, { recursive: true });
  const historyDescriptor = { id: "browser-project-history-v1", label: "Project agent history" };
  const historyItems = [
    { id: "episode_alpha", title: "Original checkpoint inspection", requestPreview: "Inspect the original checkpoint.", occurredAt: "2026-08-16T08:00:00.000Z", adapter: historyDescriptor, provenance: "unverified-history", checkpointVerified: false },
    { id: "episode_beta", title: "ACP correlation request", requestPreview: "Compare ACP tool chains across lanes.", occurredAt: "2026-08-17T08:00:00.000Z", adapter: historyDescriptor, provenance: "verified-history", checkpointVerified: true },
  ];
  const historyAdapter = {
    descriptor: historyDescriptor,
    async list() { return { adapter: historyDescriptor, items: historyItems }; },
    async resolve(id) {
      const item = historyItems.find((candidate) => candidate.id === id);
      if (!item) throw new Error(`Unknown history item ${id}`);
      return {
        item,
        checkpointRef: { planPath: "/adapter/checkpoint.json", digest: `sha256:${(id === "episode_beta" ? "b" : "a").repeat(64)}` },
        checkpointSource: {
          status: "ready",
          adapter: historyDescriptor,
          resource: { label: "Project", value: "better-harness" },
          revision: { label: "Checkpoint", value: id === "episode_beta" ? "beta-42" : "alpha-17" },
          history: { label: "Episode", value: item.title },
          materialization: { label: "Isolated checkout", value: "10 copies", timing: "on-run", count: 10 },
          capabilities: { isolatedMaterialization: true, observedHistory: true, preserveResult: true },
        },
        request: {
          promptPath: "/adapter/prompt.md",
          prompt: id === "episode_beta" ? "Compare ACP tool chains across lanes.\n" : "Inspect the original checkpoint.\n",
          promptHash: `sha256:${(id === "episode_beta" ? "d" : "c").repeat(64)}`,
          verified: item.provenance === "verified-history",
        },
        observed: { trajectoryPath: "/adapter/trajectory.jsonl", startCheckpointVerified: item.checkpointVerified, identity: { harnessId: "readme-grounded", model: "performance" } },
      };
    },
  };
  experimentStudio = await startHarnessStudioServer({
    appDir: resolve(packageRoot, "dist/app"),
    harnessSource: SOURCE,
    runDirectory: join(runsFixtureDir, "experiment"),
    evidenceDir: resolve(packageRoot, "test/fixtures"),
    experimentManifestPath: resolve(packageRoot, "../harness/examples/checkpoint-experiment/experiment.json"),
    checkpointSourcePreview: {
      status: "ready",
      adapter: { id: "browser-fixture-v1", label: "Versioned project fixture" },
      resource: { label: "Repository", value: "better-harness" },
      revision: { label: "Commit", value: "b80dccd3e3cc", detail: "tree e9b137fe3e0b" },
      history: { label: "Session position", value: "fixture · checkpoint" },
      materialization: {
        label: "Detached worktree",
        value: "10 isolated copies",
        detail: "Created per fresh trial only after Run",
        timing: "on-run",
        count: 10,
      },
      capabilities: { isolatedMaterialization: true, observedHistory: true, preserveResult: true },
    },
    checkpointHistoryAdapter: historyAdapter,
    experimentLocker: async ({ history }) => {
      await writeFile(join(lockedFixtureDir, "prompt.md"), history.request.prompt, "utf8");
      return {
        manifestPath: join(lockedFixtureDir, "experiment.json"),
        receipt: {
          lockId: `lock_${history.item.id}`,
          historyId: history.item.id,
          manifestDigest: `sha256:${"e".repeat(64)}`,
          checkpointDigest: history.checkpointRef.digest,
          manifestName: "experiment.json",
        },
      };
    },
    experimentRunner: async (options) => {
      const emit = (type, laneId, runId, event) => options.onEvent?.({
        type,
        experimentId: options.experimentId,
        laneId,
        runId,
        at: new Date().toISOString(),
        ...(event ? { event } : {}),
      });
      for (const laneId of ["fresh-default", "fresh-minimal"]) {
        const runId = `${options.experimentId}:${laneId}:1`;
        emit("lane-preparing", laneId, runId);
        emit("lane-started", laneId, runId);
        const readInput = laneId === "fresh-default" ? { path: "README.md" } : { file_path: "README.md" };
        emit("lane-event", laneId, runId, { type: "tool-call-started", toolCallId: "read", toolName: "Read", input: readInput });
        emit("lane-event", laneId, runId, { type: "tool-call-result", toolCallId: "read", content: "# fixture" });
        emit("lane-event", laneId, runId, { type: "tool-call-started", toolCallId: "edit", toolName: "Edit", input: { path: "README.md" } });
        emit("lane-event", laneId, runId, { type: "tool-call-result", toolCallId: "edit", content: "updated" });
        emit("lane-event", laneId, runId, { type: "tool-call-started", toolCallId: "test", toolName: "Bash", input: { command: laneId === "fresh-default" ? "npm test" : "npm run test" } });
        emit("lane-event", laneId, runId, { type: "tool-call-result", toolCallId: "test", content: "passed" });
        emit("lane-finished", laneId, runId);
      }
      const compareSet = {
        contrasts: [
          { id: "profile-effect", lanes: ["fresh-default", "fresh-minimal"], status: "accept", reason: "Matched trials favor the candidate profile." },
          { id: "history-context", lanes: ["history", "fresh-default", "fresh-minimal"], status: "descriptive", reason: "Historical identity is incomplete." },
        ],
      };
      options.onEvent?.({
        type: "experiment-finished",
        experimentId: options.experimentId,
        laneId: null,
        runId: null,
        at: new Date().toISOString(),
        compareSet,
      });
      return compareSet;
    },
  });
});

test.afterAll(async () => {
  await studio?.close();
  await experimentStudio?.close();
  await inspectorStudio?.close();
  if (lockedFixtureDir) await rm(lockedFixtureDir, { recursive: true, force: true });
  if (inspectorFixtureDir) await rm(inspectorFixtureDir, { recursive: true, force: true });
  if (runsFixtureDir) await rm(runsFixtureDir, { recursive: true, force: true });
  if (artifactFixtureDir) await rm(artifactFixtureDir, { recursive: true, force: true });
});

test("organizes configured surfaces around the Harness control plane", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(inspectorStudio.url);

  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Harness control plane" })).toContainText("Sessions");
  await expect(page.getByRole("navigation", { name: "Harness control plane" })).toContainText("Debugger");
  await expect(page.getByRole("navigation", { name: "Harness control plane" })).toContainText("Compare");
  await page.getByRole("button", { name: "Open workspace" }).first().click();
  await expect(page.getByRole("heading", { name: "Open a project workspace" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose workspace" })).toBeVisible();
});

test("compares a focused ACP pair across roles, views, filters, and evidence", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 576 });
  const browserErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => browserErrors.push(`page: ${error.message}`));

  await page.goto(experimentStudio.url);
  await openDestination(page, "Compare");
  await expect(page.getByRole("heading", { name: "Compare a past agent run" })).toBeVisible();
  await expect(page.locator(".setup-details")).not.toHaveAttribute("open", "");
  await expect(page.getByLabel("History checkpoint")).toHaveValue("episode_alpha");
  await page.getByLabel("History checkpoint").selectOption("episode_beta");
  await expect(page.locator(".history-picker-meta")).toContainText("Ready");
  await expect(page.locator(".setup-summary")).toContainText("beta-42");
  await expect(page.locator(".setup-summary")).toContainText("qoder-default-v1 vs qoder-minimal-v1");
  await page.locator(".setup-details > summary").click();
  await expect(page.locator(".checkpoint-facts")).toContainText("Checkpoint");
  await expect(page.locator(".checkpoint-facts")).toContainText("beta-42");
  await expect(page.locator(".request-preview")).toContainText("Compare ACP tool chains across lanes.");
  await expect(page.locator(".variant-row")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Lock and compare" })).toBeEnabled();
  await page.getByRole("button", { name: "Lock and compare" }).click();
  await expect(page.getByRole("region", { name: "Comparison notebook" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Context" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Run comparison" })).toBeVisible();
  await expect(page.locator(".notebook-cell")).toHaveCount(2);
  await expect(page.locator(".notebook-context-grid")).toContainText("Starting checkpoint");
  await expect(page.locator(".run-process-summary")).not.toHaveAttribute("open", "");
  await page.locator(".run-process-summary > summary").click();
  await expect(page.locator(".run-process-summary li")).toHaveCount(3);
  await page.locator(".run-process-summary > summary").click();
  await expect(page.locator(".object-card")).toHaveCount(3);
  await expect(page.locator(".object-card").nth(0)).toContainText("Reference");
  await expect(page.locator(".object-card").nth(1)).toContainText("Baseline");
  await expect(page.locator(".object-card").nth(2)).toContainText("Candidate");
  await expect(page.locator(".comparability")).toContainText("Controlled");
  await expect(page.locator(".call-lane")).toHaveCount(2);

  await page.getByRole("button", { name: "Run comparison" }).click();
  await expect(page.locator(".lane-status-finished")).toHaveCount(2);
  await expect(page.locator(".lane-detail")).toHaveCount(0);
  await expect(page.locator(".lane-relation").nth(0)).toContainText("Exact match");
  await expect(page.locator(".lane-relation").nth(1)).toContainText("Same resource");
  await expect(page.locator(".local-chain")).toContainText("Previous → selected → next");
  await expect(page.locator(".local-chain article").nth(0)).toContainText("Read");
  await expect(page.locator(".local-chain article").nth(0)).toContainText("Edit");

  await page.getByLabel("Filter calls").fill("npm test");
  await expect(page.getByRole("treeitem")).toHaveCount(1);
  await page.getByLabel("Filter calls").fill("");
  await expect(page.getByRole("treeitem")).toHaveCount(6);

  await page.getByText("Diff only", { exact: true }).click();
  await expect(page.getByRole("treeitem")).toHaveCount(4);
  await page.getByText("Diff only", { exact: true }).click();
  const candidateBash = page.locator(".call-lane").nth(1).getByRole("treeitem", { name: /Bash command:npm run test/ });
  await candidateBash.click();
  await expect(page.locator(".call-group button.selected")).toHaveCount(2);
  await page.getByText("Sync", { exact: true }).click();
  await page.locator(".call-lane").nth(1).getByRole("treeitem", { name: /Read README\.md/ }).click();
  await expect(page.locator(".call-group button.selected")).toHaveCount(1);

  await page.getByRole("tab", { name: "Summary" }).click();
  await expect(page.locator(".summary-grid")).toContainText("Outcome");
  await expect(page.locator(".summary-grid")).toContainText("accept");
  await page.getByRole("tab", { name: "Trace" }).click();
  await page.getByRole("button", { name: "Resources" }).click();
  await expect(page.locator(".changes-view")).toContainText("shared resources");
  await page.getByRole("button", { name: "Calls", exact: true }).click();
  await page.getByRole("tab", { name: "Evidence", exact: true }).click();
  await expect(page.locator(".evidence-view")).toContainText("No global verdict");
  await expect(page.locator(".status-accept")).toContainText("accept");
  await page.locator("button.object-card.role-candidate").click();
  await expect(page.locator("button.object-card.role-baseline")).toContainText("fresh-minimal");

  // Roving-tablist keyboard behaviour: exactly one Tab stop; arrows wrap and move focus with selection.
  const compareTabs = page.locator(".compare-tabs");
  await expect(compareTabs.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
  await compareTabs.getByRole("tab", { name: "Evidence", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(compareTabs.getByRole("tab", { name: "Summary" })).toBeFocused();
  await expect(compareTabs.getByRole("tab", { name: "Summary" })).toHaveAttribute("aria-selected", "true");
  await expect(compareTabs.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press("End");
  await expect(compareTabs.getByRole("tab", { name: "Evidence", exact: true })).toBeFocused();
  await page.getByRole("tab", { name: "Trace" }).click();

  await page.screenshot({ path: testInfo.outputPath("experiment-tool-correlation.png") });
  const layout = await page.evaluate(() => {
    const shell = document.querySelector(".experiment-shell");
    const rail = document.querySelector(".experiment-rail");
    const workspaceHeader = document.querySelector(".experiment-notebook-bar");
    const surface = document.querySelector(".compare-surface");
    const header = document.querySelector(".call-lane-head");
    const toolList = document.querySelector(".call-lane:first-child .call-tree");
    const rows = [...document.querySelectorAll(".call-lane:first-child .call-group button")];
    const laneRects = [...document.querySelectorAll(".call-lane")].map((element) => element.getBoundingClientRect());
    const rowFontSize = rows[0] ? Number.parseFloat(getComputedStyle(rows[0]).fontSize) : 0;
    return {
      inner: window.innerWidth,
      document: document.documentElement.scrollWidth,
      shellWidth: shell?.getBoundingClientRect().width ?? 0,
      railWidth: rail?.getBoundingClientRect().width ?? 0,
      workspaceHeaderHeight: workspaceHeader?.getBoundingClientRect().height ?? Infinity,
      surfaceTop: surface?.getBoundingClientRect().top ?? Infinity,
      laneHeaderHeight: header?.getBoundingClientRect().height ?? Infinity,
      toolRowHeight: rows[0]?.getBoundingClientRect().height ?? Infinity,
      toolListHeight: toolList?.getBoundingClientRect().height ?? 0,
      firstLaneGap: laneRects.length > 1 ? laneRects[1].left - laneRects[0].right : Infinity,
      rowFontSize,
    };
  });
  expect(layout.document).toBe(layout.inner);
  expect(layout.shellWidth).toBe(layout.inner);
  expect(layout.railWidth).toBe(0);
  expect(layout.workspaceHeaderHeight).toBe(44);
  expect(layout.surfaceTop).toBeLessThanOrEqual(100);
  expect(layout.laneHeaderHeight).toBeLessThanOrEqual(52);
  expect(layout.toolRowHeight).toBeLessThanOrEqual(30);
  expect(layout.rowFontSize).toBeGreaterThanOrEqual(12);
  expect(layout.firstLaneGap).toBeLessThanOrEqual(1);
  expect(layout.toolListHeight / layout.toolRowHeight).toBeGreaterThan(6);
  expect(browserErrors).toEqual([]);
});

test("contains narrow experiment scrolling inside the comparison regions", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 844 });
  await page.goto(experimentStudio.url);
  await openDestination(page, "Compare");
  await expect(page.getByRole("button", { name: "Lock and compare" })).toBeEnabled();
  await page.getByRole("button", { name: "Lock and compare" }).click();
  await expect(page.locator(".object-card")).toHaveCount(3);
  await expect(page.locator(".call-lane")).toHaveCount(2);
  await expect(page.locator(".experiment-rail")).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".experiment-rail")).not.toBeVisible();
  const dimensions = await page.evaluate(() => ({
    inner: window.innerWidth,
    document: document.documentElement.scrollWidth,
    rail: document.querySelector(".experiment-rail")?.getBoundingClientRect().width,
    boardClient: document.querySelector(".experiment-workspace-scroll")?.clientWidth,
    boardScroll: document.querySelector(".experiment-workspace-scroll")?.scrollWidth,
  }));
  expect(dimensions.document).toBe(dimensions.inner);
  expect(dimensions.rail).toBe(0);
  expect(dimensions.boardScroll).toBeGreaterThanOrEqual(dimensions.boardClient);

  await page.getByRole("button", { name: "Show checkpoints" }).click();
  await expect(page.locator(".experiment-rail")).toBeVisible();
  await expect(page.locator(".experiment-rail")).toHaveCSS("width", "312px");
  const expandedWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(expandedWidth).toBe(390);
  await expect(page.getByRole("navigation", { name: "Compare surfaces" })).toBeVisible();
  await page.getByRole("button", { name: "Evidence results", exact: true }).click();
  await expect(page.locator(".decision-summary")).toContainText("Sufficient");
  await page.getByRole("button", { name: "Bench", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Compare a past agent run" })).toBeVisible();
});

test("renders a keyboard-expandable failed and truncated Tool Call at 390px", async ({ page }, testInfo) => {
  const browserErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => browserErrors.push(`page: ${error.message}`));

  await page.goto(studio.url);
  await openDestination(page, "Debugger");
  await page.getByRole("button", { name: "New live run" }).click();
  await page.getByPlaceholder("Task prompt for the harness run…").fill("Run the scripted browser fixture");
  await page.getByRole("button", { name: "Run harness" }).click();

  await expect(page.getByRole("navigation", { name: "Session debugger controls" })).toHaveCount(0);
  await expect(page.getByText("Live observation · no Evidence Cursor")).toBeVisible();

  await expect(page.locator(".run-status strong")).toHaveText("finished");
  const card = page.locator("details.tool-card");
  await expect(card.locator(".tool-status")).toHaveText("Failed");
  const colors = await page.evaluate(() => {
    const resolveColor = (token) => {
      const probe = document.createElement("span");
      probe.style.color = `var(${token})`;
      document.body.append(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    };
    return {
      toolIdentity: getComputedStyle(document.querySelector(".tool-icon")).color,
      expectedToolIdentity: resolveColor("--event-tool"),
      verifyIdentity: getComputedStyle(document.querySelector(".timeline-segment.kind-verify")).backgroundColor,
      expectedVerifyIdentity: resolveColor("--event-verify"),
      interaction: resolveColor("--color-primary"),
      success: resolveColor("--color-success"),
      warning: resolveColor("--color-warning"),
      danger: resolveColor("--color-danger"),
      candidate: resolveColor("--color-candidate"),
    };
  });
  expect(colors.toolIdentity).toBe(colors.expectedToolIdentity);
  expect(colors.verifyIdentity).toBe(colors.expectedVerifyIdentity);
  expect([colors.interaction, colors.success, colors.warning, colors.danger, colors.candidate]).not.toContain(colors.toolIdentity);
  expect([colors.interaction, colors.success, colors.warning, colors.danger, colors.candidate]).not.toContain(colors.verifyIdentity);

  const summary = card.locator("summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(card).toHaveAttribute("open", "");
  await expect(card.getByRole("heading", { name: "Arguments" })).toBeVisible();
  await expect(card.getByText(/Result truncated from [\d,]+ bytes/)).toBeVisible();
  await expect(card.getByText("run_", { exact: false })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("tool-call-390.png"), fullPage: true });

  await page.keyboard.press("Enter");
  await expect(card).not.toHaveAttribute("open", "");
  const dimensions = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  expect(dimensions).toEqual({ innerWidth: 390, documentWidth: 390, bodyWidth: 390 });

  // The finished run is retained in the catalog and replayable through the Evidence Cursor.
  await page.getByRole("button", { name: /Saved runs/ }).click();
  await page.getByRole("menuitem", { name: /Run the scripted browser fixture/ }).click();
  await expect(page.getByRole("navigation", { name: "Session debugger controls" })).toBeVisible();
  await expect(page.locator(".step-controls button")).toHaveCount(7);
  await expect(page.locator(".debugger-event-card").filter({ hasText: "Bash tool call" })).toBeVisible();
  await expect(page.locator(".event-status.failed")).toContainText("failed");
  await page.getByTitle("Toggle State Inspector").click();
  await expect(page.locator(".state-inspector")).toBeVisible();
  await page.locator(".inspector-tabs button").nth(2).click();
  await expect(page.locator(".state-inspector")).toContainText("actual-run-output.json");
  await expect(page.locator(".state-inspector")).not.toContainText("acp-debugger-reference.png");
  expect(browserErrors).toEqual([]);
});

test("keeps visual decisions in owned Studio style sources", async () => {
  const [index, shell, workbench] = await Promise.all([
    readFile(resolve(packageRoot, "src/app/index.html"), "utf8"),
    readFile(resolve(packageRoot, "src/app/styles/shell.css"), "utf8"),
    readFile(resolve(packageRoot, "src/app/styles/workbench.css"), "utf8"),
  ]);

  expect(index).not.toMatch(/<style\b/i);
  expect(index.match(/<link rel="stylesheet"/g)).toHaveLength(3);
  for (const source of [shell, workbench]) {
    expect(source).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(/i);
    expect(source).not.toMatch(/font-size:\s*(?:\d|\.)/);
    expect(source).not.toMatch(/border-radius:\s*(?:\d|\.)/);
    expect(source).not.toContain("!important");
  }
});

test("renders the shell, local workspace intake, and empty compare surfaces at all layout modes", async ({ page }, testInfo) => {
  const browserErrors = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(`console: ${message.text()}`); });
  page.on("pageerror", (error) => browserErrors.push(`page: ${error.message}`));

  for (const layout of LAYOUTS) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await page.goto(experimentStudio.url);
    await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
    await assertRenderedContract(page);
    await page.screenshot({ path: testInfo.outputPath(`overview-${layout.name}.png`) });

    if (layout.name === "wide") {
      const current = page.getByRole("button", { name: /^Overview/ });
      await current.focus();
      await page.keyboard.press("ArrowDown");
      await expect(page.getByRole("button", { name: /^Customizations/ })).toBeFocused();
    } else {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(page.locator(".studio-primary-nav")).toHaveCSS("transition-duration", "0s");
      await page.emulateMedia({ reducedMotion: "no-preference" });
      const toggle = page.getByRole("button", { name: "Open Studio navigation" });
      await toggle.click();
      await expect(page.getByRole("button", { name: /^Overview/ })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(toggle).toBeFocused();
    }

    await openDestination(page, "Sessions");
    await expect(page.getByRole("heading", { name: "Open a project workspace" })).toBeVisible();
    await assertRenderedContract(page);
    await page.screenshot({ path: testInfo.outputPath(`foundation-${layout.name}.png`) });

    await page.goto(inspectorStudio.url);
    await openDestination(page, "Compare");
    await expect(page.getByRole("heading", { name: "Open a project workspace" })).toBeVisible();
    await assertRenderedContract(page);
    await page.screenshot({ path: testInfo.outputPath(`empty-${layout.name}.png`) });

    await openDestination(page, "Sessions");
    await expect(page.getByRole("button", { name: "Choose workspace" })).toBeVisible();
    await assertRenderedContract(page);
    await page.screenshot({ path: testInfo.outputPath(`sessions-${layout.name}.png`) });
  }
  expect(browserErrors).toEqual([]);
});

test("keeps Bench decision workspaces primary at all layout modes", async ({ page }, testInfo) => {
  const browserErrors = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(`console: ${message.text()}`); });
  page.on("pageerror", (error) => browserErrors.push(`page: ${error.message}`));

  for (const layout of LAYOUTS) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await page.goto(experimentStudio.url);
    await openDestination(page, "Compare");
    const action = page.getByRole("button", { name: /^(Lock and compare|Open workbench)$/ });
    await expect(action).toBeEnabled();
    await action.click();
    await expect(page.getByRole("region", { name: "Comparison notebook" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Run comparison" })).toBeInViewport();
    await assertRenderedContract(page);
    const ratio = await page.evaluate(() => {
      const shell = document.querySelector(".experiment-shell")?.getBoundingClientRect();
      const workspace = document.querySelector(".experiment-workspace")?.getBoundingClientRect();
      return shell && workspace ? workspace.width / shell.width : 0;
    });
    expect(ratio).toBeGreaterThanOrEqual(0.5);
    if (layout.name === "wide") await expect(page.locator(".experiment-rail")).toBeVisible();
    else await expect(page.locator(".experiment-rail")).not.toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`bench-${layout.name}.png`) });
  }
  expect(browserErrors).toEqual([]);
});

test("renders meaningful Live trial evidence at all layout modes", async ({ page }, testInfo) => {
  const browserErrors = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(`console: ${message.text()}`); });
  page.on("pageerror", (error) => browserErrors.push(`page: ${error.message}`));

  for (const layout of LAYOUTS) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await page.goto(studio.url);
    await openDestination(page, "Debugger");
    await page.getByRole("button", { name: "New live run" }).click();
    await page.getByPlaceholder("Task prompt for the harness run…").fill(`Verify ${layout.name} live evidence`);
    await page.getByRole("button", { name: "Run harness" }).click();
    await expect(page.locator(".run-status strong")).toHaveText("finished");
    await expect(page.locator("details.tool-card")).toHaveCount(1);
    await assertRenderedContract(page);
    const ratio = await page.evaluate(() => {
      const grid = document.querySelector(".debugger-grid")?.getBoundingClientRect();
      const notebook = document.querySelector(".session-notebook")?.getBoundingClientRect();
      return grid && notebook ? notebook.width / grid.width : 0;
    });
    expect(ratio).toBeGreaterThanOrEqual(0.5);
    await page.screenshot({ path: testInfo.outputPath(`live-trial-${layout.name}.png`) });
  }
  expect(browserErrors).toEqual([]);
});

test("leads Evidence results with the decision at all layout modes", async ({ page }, testInfo) => {
  const browserErrors = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(`console: ${message.text()}`); });
  page.on("pageerror", (error) => browserErrors.push(`page: ${error.message}`));

  for (const layout of LAYOUTS) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await page.goto(experimentStudio.url);
    await openDestination(page, "Compare");
    await page.getByRole("button", { name: "Evidence results", exact: true }).click();
    const decision = page.locator(".decision-summary");
    await expect(decision).toContainText("Sufficient");
    await expect(decision).toContainText("Quality delta");
    await expect(decision).toContainText("Cost guardrail");
    await assertRenderedContract(page);
    const widths = await page.evaluate(() => {
      const report = document.querySelector(".evidence-report")?.getBoundingClientRect();
      const decision = document.querySelector(".decision-summary")?.getBoundingClientRect();
      const tables = [...document.querySelectorAll(".evidence-table-pane .table-scroll")];
      return {
        report: report?.width ?? 0,
        decision: decision?.width ?? 0,
        boundedTables: tables.every((table) => table.clientWidth <= (report?.width ?? 0) && table.scrollWidth >= table.clientWidth),
      };
    });
    expect(widths.decision).toBe(widths.report);
    expect(widths.boundedTables).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`evidence-results-${layout.name}.png`) });
  }
  expect(browserErrors).toEqual([]);
});
